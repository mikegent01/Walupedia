#!/usr/bin/env python3
"""Foundry VTT ⇄ repo bridge for actors (stdlib only).

The loop the table runs at the end of every session:

  1. In Foundry: Mass export (module button or macros/export-all-actors.js)
     -> <world>-all-actors.json. Commit it.
  2. split    the export into one file per actor, in directories that mirror
              the Foundry folder tree, plus a manifest.
  3. link-images  connect actors to repo art (characters.json portraits first,
              then portraits/ by name), validate icon paths; report or --write.
  4. apply    a changes file (set fields, add/remove items or effects, rename,
              move folders, delete) across the split files; report or --write.
  5. combine  the files (any directories, e.g. the split world plus
              actors/peachs-castle-955) back into ONE import payload with the
              folder tree rebuilt — the module imports it by upload, Data path
              or raw GitHub URL, updating existing actors in place.
  6. install-images  copy every repo image the actors reference into the
              Foundry Data folder (never deletes, never overwrites a newer
              file without --force). This is how the art reaches Foundry.
  6b. prune-images  only for packets built with `combine --art-base` (art by
              URL on the archive's own server — opt-in since 1.9; it was the
              default in 1.8 and did not hold up: blank art whenever start.py
              was down, nothing for players elsewhere): removes the Data copies
              the world no longer points at, once the server serves the same
              bytes.
  check       validates a directory of actor files: ids, duplicates, item
              identifiers dnd5e accepts, ownership maps Foundry accepts, no art
              by URL, the party roster (actors/folders.json players.roster: who
              sits in Players, who carries a character sheet), images.
  check-packet  the same validation on a combined import.json — what the suite
              runs before anything is published to Foundry or committed.

Accepted export shapes: the module's `waluipedia-actors/1` payload, the old
macro `{ "actors": [...] }`, a bare array (Players.json), or one actor.

Folder placement travels as flags["waluipedia-mass-import"].folderPath on each
actor; `split` writes it, directories mirror it, `combine` prefers the flag and
falls back to the directory path (and `--folder` prefixes everything).

Examples (Windows: `py tools\\foundry-bridge.py ...`):

  python3 tools/foundry-bridge.py split exports/dnd-part-2-all-actors.json \\
          --out Reputation-Matrix2/actors/worlds/dnd-part-2
  python3 tools/foundry-bridge.py link-images Reputation-Matrix2/actors/worlds/dnd-part-2 --write
  python3 tools/foundry-bridge.py apply changes.json Reputation-Matrix2/actors/worlds/dnd-part-2 --write
  python3 tools/foundry-bridge.py combine Reputation-Matrix2/actors/worlds/dnd-part-2 \\
          Reputation-Matrix2/actors/peachs-castle-955 --out imports/dnd-part-2-import.json
  python3 tools/foundry-bridge.py install-images Reputation-Matrix2/actors/worlds/dnd-part-2 \\
          --foundry-data "C:\\Users\\mikeg\\AppData\\Local\\FoundryVTT\\Data"
"""
from __future__ import annotations

import argparse
import copy
import datetime
import filecmp
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RM = os.path.join(ROOT, "Reputation-Matrix2")
MODULE_ID = "waluipedia-mass-import"
SHEETS_FLAG = "waluipedia-sheets"   # the sheet builder's flag scope (era / tags / colour)
FORMAT = "waluipedia-actors/1"
FOUNDRY_ID = re.compile(r"^[A-Za-z0-9]{16}$")
PLACEHOLDERS = {"", "icons/svg/mystery-man.svg", "icons/svg/item-bag.svg", None}
# Paths Foundry itself, the game system or an installed module provide. They
# cannot be verified from the repo and must never be "fixed" away.
SERVER_ROOTS = ("icons/", "systems/", "modules/", "ui/", "cards/", "fonts/", "sounds/", "worlds/")
# Paths the repo manages: a reference under one of these that the repo does
# not have is really missing (as opposed to a GM upload we merely cannot see).
REPO_ROOTS = ("portraits/",)
IMAGE_EXTS = (".png", ".webp", ".jpg", ".jpeg", ".gif", ".svg")
SKIP_FILES = {"manifest.json", "import.json", "players-import.json", "export.json", "folders.json", "changes.json", "packets.json"}
# dnd5e's IdentifierField: anything else makes the whole embedded item invalid
IDENTIFIER_RE = re.compile(r"^[a-z0-9_-]+$", re.I)
IDENTIFIER_KEYS = ("identifier", "classIdentifier", "sourceClass")
# Foundry's DocumentOwnershipField: keys are "default" or 16-character user
# ids, values CONST.DOCUMENT_OWNERSHIP_LEVELS (INHERIT -1 … OWNER 3); anything
# else fails validation and the whole update is refused
OWNERSHIP_LEVELS = {-1, 0, 1, 2, 3}
# art by URL (the 1.8 scheme): a loopback host is wrong on every machine but the GM's
LOOPBACK_URL = re.compile(r"^https?://(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?/", re.I)
DEFAULT_FOLDER_SCHEME = os.path.join(RM, "actors", "folders.json")
# The world the party is played in (actors/worlds/<world>). `combine` puts the
# party block (players_payload) in that world's packet only — folders.json
# players.world overrides this when the table moves. An era packet
# (actors/peachs-castle-955 and friends) is a record of a past table with no
# players of its own, and its import.json IS committed and checked, so a roster
# or permission edit must not churn five historical packets.
LIVE_WORLD = "midlands"

DEFAULT_PORTRAITS = os.path.join(RM, "portraits")
DEFAULT_CHARACTERS = os.path.join(RM, "data", "characters.json")
DEFAULT_IMAGE_LIB = os.path.join(RM, "tools", "item sheet examples", "image paths.txt")


# ------------------------------------------------------------------ helpers

def sid(*parts):
    """Deterministic 16-char Foundry id (same recipe as the actor builders)."""
    h = hashlib.sha256("::".join(str(p) for p in parts).encode("utf-8")).digest()
    alnum = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    n = int.from_bytes(h, "big")
    out = []
    for _ in range(16):
        n, r = divmod(n, len(alnum))
        out.append(alnum[r])
    return "".join(out)


def slugify(name):
    slug = str(name).lower().replace("'", "").replace("\u2019", "")
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return slug or "actor"


def slug_identifier(text):
    """What dnd5e derives from a name (String#slugify strict): lower-case
    ASCII, one dash between words, apostrophes dropped, nothing else."""
    import unicodedata
    t = unicodedata.normalize("NFKD", str(text or ""))
    t = "".join(ch for ch in t if not unicodedata.combining(ch)).lower()
    t = t.replace("'", "").replace("\u2019", "")
    t = re.sub(r"[^a-z0-9_]+", "-", t)
    t = re.sub(r"-+", "-", t).strip("-")
    return t


def invalid_identifiers(doc):
    """[(item, key, value)] for every embedded item identifier dnd5e would refuse."""
    out = []
    for it in doc.get("items") or []:
        sysd = it.get("system") if isinstance(it, dict) else None
        if not isinstance(sysd, dict):
            continue
        for key in IDENTIFIER_KEYS:
            val = sysd.get(key)
            if isinstance(val, str) and val and not IDENTIFIER_RE.match(val):
                out.append((it, key, val))
    return out


def repair_identifiers(doc):
    """Slugify, in place, the identifiers dnd5e would refuse ("toad-—-eager-variant"
    from a player's own export). Returns [(item name, key, before, after)]."""
    fixes = []
    for it, key, val in invalid_identifiers(doc):
        after = slug_identifier(val) or slug_identifier(it.get("name")) or "item"
        it["system"][key] = after
        fixes.append((it.get("name") or "?", key, val, after))
    return fixes


# dnd5e's one-per-character items (metadata.singleton): a second creation is
# refused, and system.details.race / .background name the one the sheet uses
SINGLETON_TYPES = ("race", "background")


def applied_singleton_id(doc, item_type):
    """The id system.details.race / .background names (None for the legacy
    free-text background or nothing at all)."""
    val = ((doc.get("system") or {}).get("details") or {}).get(item_type)
    if isinstance(val, dict):
        val = val.get("_id") or val.get("id")
    return val if isinstance(val, str) and FOUNDRY_ID.match(val) else None


def singleton_shells(doc, broken=None):
    """[(item, applied item)]: a character's species / background item dnd5e
    refuses (an invalid identifier — invisible on the sheet) while
    details.race / .background names ANOTHER, valid item of that type. A
    leftover the sheet never used (the archive's own "Toad — Eager Variant"
    beside the Grung the player applied): repairing it would put a second
    species on the sheet, which dnd5e refuses, so the module could only offer
    to swap the live one out. Dropped instead. `broken(item)` says which items
    count as refused — by default the ones invalid right now."""
    if doc.get("type") != "character":
        return []
    items = [it for it in doc.get("items") or [] if isinstance(it, dict)]
    by_id = {it.get("_id"): it for it in items}
    invalid = {id(it) for it, _k, _v in invalid_identifiers(doc)}
    is_broken = broken or (lambda it: id(it) in invalid)
    out = []
    for it in items:
        if it.get("type") not in SINGLETON_TYPES or not is_broken(it):
            continue
        applied = applied_singleton_id(doc, it["type"])
        live = by_id.get(applied) if applied and applied != it.get("_id") else None
        if live is not None and live.get("type") == it["type"] and id(live) not in invalid and not is_broken(live):
            out.append((it, live))
    return out


def drop_singleton_shells(doc, broken=None):
    """Remove them in place (before repair_identifiers, which would hide the
    sign). Returns [(item name, type, applied item name)]."""
    shells = singleton_shells(doc, broken)
    if not shells:
        return []
    gone = {id(it) for it, _live in shells}
    doc["items"] = [it for it in doc["items"] if id(it) not in gone]
    return [(it.get("name") or "?", it.get("type"), live.get("name") or "?") for it, live in shells]


def invalid_ownership(doc):
    """[(where, problem)] for every ownership map Foundry would refuse on the
    actor or its items: a key that is neither "default" nor a 16-character
    user id (a "-=default" deletion, a slug, a name), a level outside -1..3,
    a map that is not an object at all."""
    out = []

    def look(where, own):
        if own is None:
            return
        if not isinstance(own, dict):
            out.append((where, f"ownership is {type(own).__name__}, not a map"))
            return
        for k, v in own.items():
            key = str(k)
            if key.startswith("-="):
                if not FOUNDRY_ID.match(key[2:]) or v is not None:
                    out.append((where, f"ownership key {key!r} — deletions need a user id and null"))
                continue
            if key != "default" and not FOUNDRY_ID.match(key):
                out.append((where, f"ownership key {key!r} is neither 'default' nor a user id"))
            if isinstance(v, bool) or not isinstance(v, int) or v not in OWNERSHIP_LEVELS:
                out.append((where, f"ownership[{key!r}] = {v!r} is not a permission level (-1..3)"))

    look("actor", doc.get("ownership"))
    for it in doc.get("items") or []:
        if isinstance(it, dict):
            look(f"item {it.get('name')!r}", it.get("ownership"))
            for fx in it.get("effects") or []:
                if isinstance(fx, dict):
                    look(f"item {it.get('name')!r} effect {fx.get('name')!r}", fx.get("ownership"))
    for fx in doc.get("effects") or []:
        if isinstance(fx, dict):
            look(f"effect {fx.get('name')!r}", fx.get("ownership"))
    return out


def art_by_url(doc):
    """[(where, url)] for every image field that names repo art by URL (the
    1.8 scheme) or any loopback URL: a committed mirror and a packet to publish
    must name art by Data path — install-images puts the file there."""
    out = []
    for container, key in image_fields(doc):
        p = container.get(key)
        if isinstance(p, str) and p.startswith(("http://", "https://")) and (art_path(p) or LOOPBACK_URL.match(p)):
            where = "img" if container is doc else ("token" if key == "src" else f"item {container.get('name')!r}")
            out.append((where, p))
    return out


def load_roster(scheme=None):
    """The party roster from the folder scheme (players.roster / players.companions):
    {folder, rows, ids: {actor id: row}, characters: {website id: row},
    names: {name lower: row}, companions: {actor id}, companion_names: {name lower}}.
    Empty maps when the scheme has no roster — every rule that needs one then stays quiet."""
    scheme = load_folder_scheme() if scheme is None else scheme
    players = (scheme or {}).get("players") or {}
    rows = [r for r in (players.get("roster") or []) if isinstance(r, dict) and (r.get("actor") or r.get("name"))]
    comps = [r for r in (players.get("companions") or []) if isinstance(r, dict) and (r.get("actor") or r.get("name"))]
    retired = [r for r in (players.get("retired") or []) if isinstance(r, dict) and (r.get("actor") or r.get("name"))]
    return {
        "scheme": scheme or {},
        # former player characters: not players (they file by faction, no ledger promotion,
        # no permissions) — the website still shows their sheets with the party's
        "retired": {r["character"]: r for r in retired if r.get("character")},
        "folder": players.get("folder") or "Players",
        "rows": rows,
        "ids": {r["actor"]: r for r in rows if r.get("actor")},
        "characters": {r["character"]: r for r in rows if r.get("character")},
        "names": {str(r.get("name") or "").strip().lower(): r for r in rows if r.get("name")},
        "companions": {r["actor"] for r in comps if r.get("actor")},
        "companion_names": {str(r.get("name") or "").strip().lower() for r in comps if r.get("name")},
    }


PERMISSION_NAMES = {"none": 0, "limited": 1, "observer": 2, "owner": 3}  # the words actors/folders.json players.permissions uses


def load_permissions(scheme=None, roster=None):
    """players.permissions — who may open which sheet, by Foundry USER NAME:

        {"default": 0, "users": {"Keaneu": {"owner": ["Archie Miser", "Eager"], "observer": [...]}, ...}}

    -> {"default": 0, "users": {name: {actor id: level}}, "actors": {actor id: {name: level}},
        "names": [user names], "problems": [...]}. Actor names resolve against the
    roster and the companions (case-insensitive); anything else is a problem
    (check reports it) and is left out. Empty maps when the scheme has none."""
    scheme = load_folder_scheme() if scheme is None else scheme
    roster = load_roster(scheme) if roster is None else roster
    block = ((scheme or {}).get("players") or {}).get("permissions") or {}
    out = {"default": 0, "users": {}, "actors": {}, "names": [], "problems": []}
    if not isinstance(block, dict):
        out["problems"].append("players.permissions must be an object")
        return out
    default = block.get("default", 0)
    if default not in (0, 1, 2, 3):
        out["problems"].append(f"players.permissions.default must be 0–3, not {default!r}")
        default = 0
    out["default"] = default
    by_name = {}
    for r in roster.get("rows") or []:
        if r.get("actor") and r.get("name"):
            by_name[str(r["name"]).strip().lower()] = r["actor"]
    comp_rows = ((scheme or {}).get("players") or {}).get("companions") or []
    for r in comp_rows:
        if isinstance(r, dict) and r.get("actor") and r.get("name"):
            by_name[str(r["name"]).strip().lower()] = r["actor"]
    users = block.get("users") or {}
    if not isinstance(users, dict):
        out["problems"].append("players.permissions.users must be an object keyed by Foundry user name")
        users = {}
    for user, grants in users.items():
        user = str(user).strip()
        if not user:
            out["problems"].append("players.permissions.users: an empty user name")
            continue
        if user.lower() in {n.lower() for n in out["names"]}:
            out["problems"].append(f"players.permissions.users: {user} is listed twice (names match case-insensitively)")
            continue
        out["names"].append(user)
        mine = out["users"].setdefault(user, {})
        if not isinstance(grants, dict):
            out["problems"].append(f"players.permissions.users.{user} must be an object of level: [actor names]")
            continue
        for level_name, names in grants.items():
            level = PERMISSION_NAMES.get(str(level_name).strip().lower())
            if level is None:
                out["problems"].append(f"players.permissions.users.{user}: unknown level {level_name!r} (owner / observer / limited / none)")
                continue
            for name in (names if isinstance(names, list) else [names]):
                aid = by_name.get(str(name).strip().lower())
                if not aid:
                    out["problems"].append(f"players.permissions.users.{user}: {name!r} is not on the roster or a companion (actors/folders.json players.roster / companions)")
                    continue
                if aid in mine and mine[aid] != level:
                    out["problems"].append(f"players.permissions.users.{user}: {name} is granted twice with different levels ({mine[aid]} and {level})")
                    continue
                mine[aid] = level
                out["actors"].setdefault(aid, {})[user] = level
    return out


def live_world(scheme=None):
    """The world the party is played in — actors/folders.json players.world,
    else LIVE_WORLD. `combine` carries the party block for that world's packet
    (and for a combine that names no world at all) and for nothing else."""
    scheme = load_folder_scheme() if scheme is None else scheme
    name = str(((scheme or {}).get("players") or {}).get("world") or "").strip()
    return name or LIVE_WORLD


def players_payload(scheme=None, roster=None, permissions=None):
    """The `players` block a packet carries for the module: the roster and the
    companions (live ids + names), the permissions resolved to actor ids, the
    user names involved. None when the scheme has no roster."""
    scheme = load_folder_scheme() if scheme is None else scheme
    roster = load_roster(scheme) if roster is None else roster
    if not roster.get("rows"):
        return None
    permissions = load_permissions(scheme, roster) if permissions is None else permissions
    players = (scheme or {}).get("players") or {}
    return {
        "folder": roster["folder"],
        "roster": [{"actor": r.get("actor"), "name": r.get("name")} for r in roster["rows"]],
        "companions": [{"actor": r.get("actor"), "name": r.get("name")} for r in (players.get("companions") or []) if isinstance(r, dict)],
        "default": permissions["default"],
        "users": list(permissions["names"]),
        "permissions": {aid: dict(grants) for aid, grants in sorted(permissions["actors"].items())},
    }


def roster_row(doc, roster):
    """The roster row this actor document is (by live id; by name only for a
    character sheet, so an NPC statblock named like a player never counts), or None."""
    if not roster or not isinstance(doc, dict):
        return None
    row = roster["ids"].get(doc.get("_id"))
    if row:
        return row
    if doc.get("type") == "character":
        return roster["names"].get(str(doc.get("name") or "").strip().lower())
    return None


def is_companion(doc, roster):
    if not roster or not isinstance(doc, dict):
        return False
    return doc.get("_id") in roster["companions"] or str(doc.get("name") or "").strip().lower() in roster["companion_names"]


def load_folder_scheme(path=DEFAULT_FOLDER_SCHEME):
    """actors/folders.json — folder colours / descriptions by path. {} when absent."""
    try:
        scheme = read_json(path)
    except (OSError, ValueError):
        return {}
    return scheme if isinstance(scheme, dict) else {}


def folder_styles(scheme, paths):
    """{"A / B": {"color", "description"}} for every folder chain in `paths`
    (lists of names) the scheme has a colour for: Players, Bestiary and its
    creature types, the website groups (top level or under any one parent,
    e.g. "Imports / Iron Legion"), an era sub-folder under a group ("Koopa
    Troop / 955 BF — Peach's Castle" wears the era's colour and description)
    and the sub-folders a committed packet names ("Liberated Toads / Pond
    Patrol")."""
    if not scheme:
        return {}
    players = scheme.get("players") or {}
    bestiary = scheme.get("bestiary") or {}
    groups = scheme.get("groups") or {}
    types = bestiary.get("types") or {}
    eras = era_folders(scheme)
    subs = packet_subfolders(scheme)
    styles = {}
    for path in paths:
        for i in range(len(path or [])):
            chain = list(path[: i + 1])
            key = " / ".join(chain)
            if key in styles:
                continue
            name = chain[-1]
            style = None
            if name == players.get("folder") and len(chain) == 1:
                style = players
            elif name == bestiary.get("folder") and len(chain) == 1:
                style = bestiary
            elif len(chain) == 2 and chain[0] == bestiary.get("folder"):
                color = types.get(name.lower())
                style = {"color": color} if color else None
            elif len(chain) >= 2 and name in eras and chain[0] != bestiary.get("folder"):
                style = eras[name]
            elif key in subs:
                style = subs[key]
            elif name in groups and len(chain) <= 2 and (len(chain) == 1 or chain[0] != bestiary.get("folder")):
                style = groups[name]
            if style and (style.get("color") or style.get("description")):
                styles[key] = {"color": style.get("color"), "description": style.get("description")}
    return styles


def era_folders(scheme):
    """{era sub-folder name: {"dir", "era", "color", ...}} from the scheme's
    `eras` — the folder each era's actors sit in UNDER their faction's group
    folder ("955 BF — Peach's Castle" under Koopa Troop and under Mushroom
    Regency & Kingdom)."""
    out = {}
    for d, e in ((scheme or {}).get("eras") or {}).items():
        if isinstance(e, dict) and e.get("folder"):
            out[e["folder"]] = dict(e, dir=d)
    return out


def packet_dirs(scheme):
    """[(dir, entry)] for every committed packet the scheme names — the eras
    first, then `packets` (the Liberated Toads cohorts). `entry["era"]` is
    the era label for an era packet, None otherwise."""
    out = []
    for d, e in ((scheme or {}).get("eras") or {}).items():
        if isinstance(e, dict) and e.get("folder"):
            out.append((d, dict(e, dir=d, era=e.get("era"))))
    for d, e in ((scheme or {}).get("packets") or {}).items():
        if isinstance(e, dict):
            out.append((d, dict(e, dir=d, era=None)))
    return out


def packet_subfolders(scheme):
    """{"Liberated Toads / Pond Patrol": {"color", "description"}} — the
    sub-folder styles the scheme's `packets` declare."""
    out = {}
    for _, e in packet_dirs(scheme):
        if e.get("era") or not e.get("folder"):
            continue
        for name, style in (e.get("subfolders") or {}).items():
            if isinstance(style, dict):
                out[f"{e['folder']} / {name}"] = style
    return out


def folder_path_of(doc, rel_parts=()):
    """The folder an actor file stands for: its folderPath flag, else the
    directory it sits in (relative to the tree root)."""
    flag = (doc.get("flags") or {}).get(MODULE_ID, {}).get("folderPath")
    if isinstance(flag, list):
        return [str(p) for p in flag]
    return list(rel_parts)


def era_actors(scheme, actors_dir=None):
    """{(name lower, type): {"path", "folder", "era", "dir", "file",
    "generated"}} for every actor of the committed packets the scheme names
    (`eras` and `packets`, actors/<dir>/) plus the generated era versions of
    the cast (actors/cast/eras/, `generated` True). The path is the packet's
    own folderPath flag — an era actor's sits under its faction's group folder
    ("Koopa Troop", "955 BF — Peach's Castle"); `folder` is the era sub-folder
    (or the packet's folder) and `era` the era label (None for a packet that
    is not an era). A mirror actor with the same name and type is that
    packet's copy and files the same way."""
    actors_dir = actors_dir or os.path.join(RM, "actors")
    out = {}
    for d, e in packet_dirs(scheme):
        base = os.path.join(actors_dir, d)
        if not os.path.isdir(base):
            continue
        for p, rel_parts in actor_files([base]):
            doc = load_actor_file(p)
            if doc is None:
                continue
            path = folder_path_of(doc, rel_parts)
            key = (str(doc.get("name") or "").strip().lower(), doc.get("type"))
            out.setdefault(key, {"path": path, "folder": e.get("folder"), "era": e.get("era"), "dir": d, "file": p, "generated": False})
    by_label = {e.get("era"): e for _, e in packet_dirs(scheme) if e.get("era")}
    cast_eras = os.path.join(actors_dir, "cast", "eras")
    if os.path.isdir(cast_eras):
        for p, rel_parts in actor_files([cast_eras]):
            doc = load_actor_file(p)
            if doc is None:
                continue
            label = (((doc.get("flags") or {}).get(SHEETS_FLAG) or {}).get("era") or {}).get("era")
            e = by_label.get(label)
            if not e:
                continue
            # the version's faction, then the era sub-folder — whatever the last
            # build folded (a sub-folder too small that pass folds into the
            # faction folder; the caller applies its own fold over the whole
            # population)
            path = folder_path_of(doc, rel_parts)
            if path and e.get("folder") and path[-1] != e["folder"]:
                path = [path[0], e["folder"]]
            key = (str(doc.get("name") or "").strip().lower(), doc.get("type"))
            out.setdefault(key, {"path": path, "folder": e.get("folder"), "era": label, "dir": "cast/eras", "file": p, "generated": True})
    return out


def world_population(actors_dir=None):
    """[(name lower, type), path] for every actor of every world mirror
    (actors/worlds/*) — what the mirrors put in Foundry."""
    actors_dir = actors_dir or os.path.join(RM, "actors")
    base = os.path.join(actors_dir, "worlds")
    out = []
    if not os.path.isdir(base):
        return out
    for d in sorted(os.listdir(base)):
        wd = os.path.join(base, d)
        if not os.path.isdir(wd):
            continue
        for p, rel_parts in actor_files([wd]):
            doc = load_actor_file(p)
            if doc is None:
                continue
            out.append(((str(doc.get("name") or "").strip().lower(), doc.get("type")), folder_path_of(doc, rel_parts)))
    return out


def fold_singletons(targets, scheme):
    """Pure. targets: {key: [folder names]} for EVERY actor the packet will carry
    (world mirror + generated cast + era packets). Returns {key: path} with the
    scheme's `minimum` applied: a sub-folder holding fewer actors than that is
    folded into its parent (Bestiary / Ooze with one ooze -> Bestiary), a
    top-level folder holding fewer into `fallback` (Elsewhere). Never folded:
    Players (and the `keep` list), Bestiary itself, the fallback, and the
    root. Repeats until stable."""
    minimum = int((scheme or {}).get("minimum") or 1)
    out = {k: list(v or []) for k, v in targets.items()}
    if minimum <= 1:
        return out
    players = ((scheme or {}).get("players") or {}).get("folder", "Players")
    bestiary = ((scheme or {}).get("bestiary") or {}).get("folder", "Bestiary")
    fallback = (scheme or {}).get("fallback") or "Elsewhere"
    exempt_roots = {players, bestiary, fallback, *(scheme or {}).get("keep", [])}
    for _ in range(8):
        # a folder's population is everything at or below it: a parent whose
        # actors all sit in sub-folders is a container, not a lone actor
        counts = {}
        for path in out.values():
            for i in range(1, len(path) + 1):
                counts[tuple(path[:i])] = counts.get(tuple(path[:i]), 0) + 1
        changed = False
        for key, path in out.items():
            n = counts.get(tuple(path), 0)
            if not path or n >= minimum:
                continue
            if len(path) >= 2:
                out[key] = path[:-1]
                changed = True
            elif path[0] not in exempt_roots:
                out[key] = [fallback]
                changed = True
        if not changed:
            break
    return out


def dir_name(folder_name):
    """A folder name that is safe on Windows and still readable."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", str(folder_name)).strip(" .")
    return cleaned or "_"


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def render(doc):
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def write_text(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def write_if_changed(path, text):
    """write_text, but a file that already holds exactly `text` is left alone
    (same bytes, same mtime): a split of 500 actors then touches only the
    sheets that moved. Returns True when the file was written."""
    try:
        with open(path, encoding="utf-8") as fh:
            if fh.read() == text:
                return False
    except (OSError, ValueError):
        pass
    write_text(path, text)
    return True


# Foundry stamps these on every write — the sync's own included — so a mirror
# that carried them changed in git whenever anything touched an actor, content
# or not. The mirror leaves them out; combine puts the export's time back into
# the packet (a build artefact), which is all the module's newer-than check reads.
VOLATILE_STATS = ("modifiedTime", "lastModifiedBy")


def strip_volatile_stats(node):
    """Drop VOLATILE_STATS from every `_stats` in the document (actor, items, effects). Returns the count."""
    n = 0
    if isinstance(node, dict):
        st = node.get("_stats")
        if isinstance(st, dict):
            for k in VOLATILE_STATS:
                if k in st:
                    del st[k]
                    n += 1
        for v in node.values():
            n += strip_volatile_stats(v)
    elif isinstance(node, list):
        for v in node:
            n += strip_volatile_stats(v)
    return n


def iso_ms(stamp):
    """An ISO-8601 Zulu stamp as epoch milliseconds, or None."""
    try:
        return int(datetime.datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp() * 1000)
    except (TypeError, ValueError):
        return None


def stripped_export_ms(base):
    """The export time (ms) of the mirror `base` belongs to, when its split
    left the volatile stats out; None for any other tree (cast, era packets)."""
    d = os.path.abspath(base)
    for _ in range(3):
        m = os.path.join(d, "manifest.json")
        if os.path.exists(m):
            try:
                man = read_json(m)
            except (OSError, ValueError):
                return None
            return iso_ms(man.get("exportedAt")) if man.get("volatileStats") == "stripped" else None
        d = os.path.dirname(d)
    return None


def get_path(obj, dotted):
    cur = obj
    for key in dotted.split("."):
        if isinstance(cur, list):
            cur = cur[int(key)]
        elif isinstance(cur, dict):
            if key not in cur:
                return None
            cur = cur[key]
        else:
            return None
    return cur


def set_path(obj, dotted, value):
    keys = dotted.split(".")
    cur = obj
    for key in keys[:-1]:
        if isinstance(cur, list):
            cur = cur[int(key)]
        else:
            if key not in cur or not isinstance(cur[key], (dict, list)):
                cur[key] = {}
            cur = cur[key]
    if isinstance(cur, list):
        cur[int(keys[-1])] = value
    else:
        cur[keys[-1]] = value


def unset_path(obj, dotted):
    keys = dotted.split(".")
    cur = obj
    for key in keys[:-1]:
        cur = cur[int(key)] if isinstance(cur, list) else cur.get(key)
        if cur is None:
            return False
    if isinstance(cur, dict) and keys[-1] in cur:
        del cur[keys[-1]]
        return True
    return False


def folder_path_of(actor, folders_by_id):
    """Folder path of an actor as a list of names.

    Returns [] for an actor that is really at the root and **None** when the
    export only has a folder id we cannot resolve (the old macro export has
    no folder names). None must stay None: stamping [] would tell the module
    to move the actor to the root on the next import.
    """
    flag = (actor.get("flags") or {}).get(MODULE_ID, {}).get("folderPath")
    if isinstance(flag, list):
        return [str(p) for p in flag]
    fid = actor.get("folder")
    if not fid:
        return []
    if fid not in folders_by_id:
        return None
    path, seen = [], set()
    while fid and fid not in seen and fid in folders_by_id:
        seen.add(fid)
        f = folders_by_id[fid]
        path.insert(0, str(f.get("name", "")))
        fid = f.get("folder") or f.get("parent")
    return path


def set_folder_flag(actor, path):
    flags = actor.setdefault("flags", {})
    scope = flags.get(MODULE_ID)
    if not isinstance(scope, dict):
        scope = {}
        flags[MODULE_ID] = scope
    scope["folderPath"] = list(path)


def normalize_payload(raw):
    """-> (meta, folders, actors) for every accepted export shape."""
    if isinstance(raw, list):
        return {}, [], raw
    if isinstance(raw, dict) and isinstance(raw.get("actors"), list):
        meta = {k: v for k, v in raw.items() if k not in ("actors", "folders")}
        return meta, list(raw.get("folders") or []), raw["actors"]
    if isinstance(raw, dict) and raw.get("name") and raw.get("type"):
        return {}, [], [raw]
    raise SystemExit("not an actor export: expected an actor, a list of actors, or {actors: [...]}")


def actor_files(dirs):
    """Yield (path, relative_dir_parts) for every actor json under the dirs."""
    for base in dirs:
        base = os.path.abspath(base)
        if os.path.isfile(base):
            yield base, ()
            continue
        for cur, subdirs, files in os.walk(base):
            subdirs.sort()
            for fn in sorted(files):
                if not fn.endswith(".json") or fn in SKIP_FILES or fn.startswith("original-"):
                    continue
                rel = os.path.relpath(cur, base)
                parts = () if rel == "." else tuple(rel.split(os.sep))
                yield os.path.join(cur, fn), parts


def load_actor_file(path):
    doc = read_json(path)
    if not (isinstance(doc, dict) and doc.get("name") and doc.get("type")):
        return None
    return doc


def actor_filename(actor):
    aid = actor.get("_id")
    stem = f"fvtt-Actor-{slugify(actor.get('name', 'actor'))}"
    return f"{stem}-{aid}.json" if aid else f"{stem}.json"


# -------------------------------------------------------------------- split

def split(export_path, out_dir, flat=False, prune=False):
    raw = read_json(export_path)
    meta, folders, actors = normalize_payload(raw)
    folders_by_id = {f.get("_id"): f for f in folders if isinstance(f, dict)}
    written, paths, unresolved, repaired, dropped = [], [], {}, [], []
    kept = [a for a in actors if isinstance(a, dict) and a.get("name")]
    changed = 0
    for actor in kept:
        path = folder_path_of(actor, folders_by_id)
        doc = copy.deepcopy(actor)
        # a broken species / background beside the one the sheet applies is a
        # leftover: out of the mirror (the module then deletes the world's copy)
        dropped.extend((actor.get("name"), *d) for d in drop_singleton_shells(doc))
        # an invalid identifier is an invisible item in Foundry: fix it in the
        # mirror so the next import puts a valid one back
        repaired.extend((actor.get("name"), *f) for f in repair_identifiers(doc))
        # art served by start.py comes back as the repo path it was built from
        relink_images(doc, lambda p: art_path(p) or p)
        strip_volatile_stats(doc)
        if path is None:
            # folder id without a name: keep the id, stamp nothing, file at the top
            unresolved[actor.get("folder")] = unresolved.get(actor.get("folder"), 0) + 1
            target_dir = out_dir
        else:
            set_folder_flag(doc, path)
            target_dir = out_dir if flat else os.path.join(out_dir, *[dir_name(p) for p in path])
        target = os.path.join(target_dir, actor_filename(doc))
        changed += write_if_changed(target, render(doc))
        written.append(target)
        paths.append(" / ".join(path or []))
    manifest = {
        "format": meta.get("format") or ("legacy-macro" if meta.get("exportedFrom") else "bare"),
        "exportedFrom": meta.get("exportedFrom"),
        "exportedAt": meta.get("exportedAt"),
        "system": meta.get("system"),
        "systemVersion": meta.get("systemVersion"),
        "coreVersion": meta.get("coreVersion"),
        "exportedBy": meta.get("exportedBy"),
        "lastSync": meta.get("lastSync"),  # module 1.7.1: {applied: {stamp, at, exportedAt}, seen} — what the table took from a packet
        "source": os.path.relpath(os.path.abspath(export_path), ROOT).replace(os.sep, "/"),
        "actorCount": len(written),
        "volatileStats": "stripped",  # _stats.modifiedTime / lastModifiedBy are not mirrored; combine stamps exportedAt instead
        "filesChanged": changed,
        "folders": sorted({p for p in paths if p}),
        "identifiersRepaired": [{"actor": a, "item": i, "key": k, "from": b, "to": t} for a, i, k, b, t in repaired],
        "leftoversDropped": [{"actor": a, "item": i, "type": t, "applied": l} for a, i, t, l in dropped],
        "players": players_payload(),
        "unresolvedFolderIds": dict(sorted(unresolved.items())),
        "note": ("" if not unresolved else
                 f"{sum(unresolved.values())} actor(s) carry a folder id this export gives no name for; "
                 "they keep that id (the module leaves them where they are). Re-export with the "
                 "Waluipedia Mass Import module to get named folders here."),
        "actors": sorted(
            ({"name": a.get("name"), "type": a.get("type"), "_id": a.get("_id"),
              "file": os.path.relpath(w, out_dir).replace(os.sep, "/")}
             for a, w in zip(kept, written)),
            key=lambda r: r["file"]),
    }
    write_text(os.path.join(out_dir, "manifest.json"), render(manifest))
    pruned = []
    if prune:
        keep = {os.path.abspath(w) for w in written}
        for path, _ in list(actor_files([out_dir])):
            if os.path.abspath(path) not in keep:
                os.remove(path)
                pruned.append(path)
    return written, pruned, manifest


# --------------------------------------------------------------------- heal

def heal(world_dir):
    """Re-apply split's leftover rule to a mirror an older bridge split: its
    manifest remembers which identifiers that split repaired, so a species /
    background repaired there that is not the one the sheet applies is dropped
    now (and recorded under leftoversDropped). Returns [(file, actor, item
    name, type, applied name)]; nothing to do on a clean mirror."""
    manifest_path = os.path.join(world_dir, "manifest.json")
    manifest = read_json(manifest_path) if os.path.exists(manifest_path) else {}
    repaired = {(r.get("actor"), r.get("item")) for r in manifest.get("identifiersRepaired") or [] if isinstance(r, dict)}
    out = []
    for path, _rel in actor_files([world_dir]):
        doc = load_actor_file(path)
        if doc is None or doc.get("type") != "character" or not repaired:
            continue
        name = doc.get("name")
        dropped = drop_singleton_shells(doc, broken=lambda it, n=name: (n, it.get("name")) in repaired)
        if not dropped:
            continue
        write_text(path, render(doc))
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        out.extend((rel, name, i, t, a) for i, t, a in dropped)
    if out and manifest:
        rows = (manifest.get("leftoversDropped") or []) + [{"actor": n, "item": i, "type": t, "applied": a} for _f, n, i, t, a in out]
        # the key where split puts it (after identifiersRepaired), not at the end
        healed = {}
        for key, val in manifest.items():
            if key != "leftoversDropped":
                healed[key] = val
            if key == "identifiersRepaired":
                healed["leftoversDropped"] = rows
        healed.setdefault("leftoversDropped", rows)
        write_text(manifest_path, render(healed))
    return out


# ------------------------------------------------------------------ combine

def combine(dirs, folder_prefix=None, world=None, ignore_dirs=False, scheme=None, dedupe=None, art_base=None):
    """Actor files -> one import payload. With several dirs the first one wins
    a name + type clash (dedupe, default on for 2+ dirs): the live world keeps
    its copy of a 955 BF guard, the era packet's copy is left out and listed
    under `omitted`. Duplicates *within* one dir are kept (two different
    "Guard" statblocks are two actors). `art_base`: repo art becomes URLs
    there (see art_url). `world`: the packet's exportedFrom; the party block
    (players_payload — the roster, the companions, who may open which sheet)
    rides only with the live world's packet or with a combine that names no
    world, never with an era packet's committed import.json."""
    prefix = [p.strip() for p in str(folder_prefix or "").split("/") if p.strip()]
    scheme = load_folder_scheme() if scheme is None else scheme
    dedupe = (len(dirs) > 1) if dedupe is None else bool(dedupe)
    rows, omitted = [], []
    seen_names, seen_src_ids = {}, {}
    for base_index, base in enumerate(dirs):
        export_ms = stripped_export_ms(base)
        for path, rel_parts in actor_files([base]):
            doc = load_actor_file(path)
            if doc is None:
                continue
            if export_ms and not (doc.get("_stats") or {}).get("modifiedTime"):
                # the mirror's copy is as old as its export: the module keeps a
                # world actor that changed after that, exactly as before
                doc.setdefault("_stats", {})["modifiedTime"] = export_ms
            key = (str(doc.get("name") or "").strip().lower(), doc.get("type"))
            if dedupe:
                first = seen_names.get(key)
                # the same actor under another name: the GM renamed it in the
                # world (X.O. -> P.S); the earlier source's copy is that actor
                same_id = seen_src_ids.get(doc.get("_id")) if doc.get("_id") else None
                if first is None and same_id is not None and same_id != base_index:
                    first = same_id
                if first is not None and first != base_index:
                    omitted.append({"name": doc.get("name"), "type": doc.get("type"), "_id": doc.get("_id"),
                                    "file": os.path.relpath(path, ROOT).replace(os.sep, "/"),
                                    "keptFrom": os.path.relpath(os.path.abspath(dirs[first]), ROOT).replace(os.sep, "/")})
                    continue
                seen_names.setdefault(key, base_index)
                if doc.get("_id"):
                    seen_src_ids.setdefault(doc["_id"], base_index)
            rows.append(_combine_row(doc, rel_parts, path, prefix, ignore_dirs))
    rows.sort(key=lambda r: (r[0] is None, r[0] or [], r[1], r[2]))
    payload, dupes = _combine_payload(rows, scheme, world, omitted)
    if art_base:
        n = 0
        for doc in payload["actors"]:
            n += len(relink_images(doc, lambda p: art_url(p, art_base)))
        payload["artBase"] = art_base
        payload["artLinks"] = n
    return payload, dupes


ROSTER_CELLS = "assets/images/toads/roster/"
ROSTER_PLATES = "portraits/liberated-toads/roster/"


def roster_plate(path):
    """A Liberated Toads roster cell (the website's card art, a Toad on a cream field) has
    a transparent twin under portraits/liberated-toads/roster/<same name>. Actor art is the
    plate, never the cell — the cell's cream field is the white rectangle a token shows on
    a dark map. The website keeps the cell. Returns the plate path, or None."""
    path = (path or "").replace("\\", "/")
    name = path.rsplit("/", 1)[-1]
    if ROSTER_CELLS not in path or not name.startswith("toad_") or not name.endswith(".png"):
        return None
    plate = ROSTER_PLATES + name
    return plate if os.path.exists(os.path.join(RM, plate)) else None


_ROSTER_TWINS = None


def roster_twins():
    """toad_<name>.png -> portraits/liberated-toads/roster/toad_<nn>_<name>.png: the numbered
    plate is the one full-body portrait a Liberated Toad has (the unnumbered second cut under
    portraits/player/fullbody/ was deleted in the single-plate refactor)."""
    global _ROSTER_TWINS
    if _ROSTER_TWINS is None:
        d = os.path.join(RM, ROSTER_PLATES)
        _ROSTER_TWINS = {re.sub(r"^toad_\d+_", "toad_", f): ROSTER_PLATES + f
                         for f in os.listdir(d) if f.startswith("toad_")} if os.path.isdir(d) else {}
    return _ROSTER_TWINS


def fullbody_twin(path):
    """Where an old world export still points a toad at the deleted fullbody twin."""
    path = (path or "").replace("\\", "/")
    name = path.rsplit("/", 1)[-1]
    if not path.startswith("portraits/player/fullbody/toad_") or not name.endswith(".png"):
        return None
    return roster_twins().get(name)


FULLBODY_DIR = "portraits/fullbody"
FULLBODY_FROM = ("portraits/", "npc/", "player/")


def fullbody_sprite(path):
    """Actor art -> its full-body sprite, when tools/fullbody-portraits.py made one.

    ``portraits/alice.jpg`` or ``npc/wario.png`` becomes
    ``portraits/fullbody/alice.png`` when that file exists in the repo
    (Reputation-Matrix2/portraits/fullbody/, cut to transparency by
    tools/cutout-fullbody.py). Applied when packets are combined and when art
    is installed, so the GM's exported mirror keeps the art it had."""
    if not isinstance(path, str) or not path:
        return None
    rel = urllib.parse.unquote(path.split("?")[0].replace("\\", "/").lstrip("/"))
    if rel.startswith(FULLBODY_DIR + "/") or not rel.startswith(FULLBODY_FROM):
        return None
    stem = os.path.splitext(rel.rsplit("/", 1)[-1])[0]
    cand = f"{FULLBODY_DIR}/{stem}.png"
    return cand if os.path.isfile(os.path.join(RM, *cand.split("/"))) else None


def _combine_row(doc, rel_parts, path, prefix, ignore_dirs):
    """(folder path or None, name, id, doc, file) — the folder comes from the
    folderPath flag, else from the directory the file sits in."""
    flag = (doc.get("flags") or {}).get(MODULE_ID, {}).get("folderPath")
    if isinstance(flag, list):
        fpath = [str(p) for p in flag]
    elif ignore_dirs or not rel_parts:
        # no flag and not inside a sub-directory: the actor's folder is
        # unknown — keep its folder id and let the module leave it alone
        fpath = None if doc.get("folder") else []
    else:
        fpath = list(rel_parts)
    if fpath is not None:
        fpath = prefix + fpath
    return (fpath, doc.get("name", ""), doc.get("_id") or "", doc, path)


def _combine_payload(rows, scheme, world, omitted):
    folders, folder_ids = [], {}
    styles = folder_styles(scheme, [r[0] for r in rows if r[0]])
    for fpath, *_ in rows:
        for i in range(len(fpath or [])):
            chain = tuple(fpath[: i + 1])
            if chain in folder_ids:
                continue
            fid = sid("folder", "/".join(chain))
            folder_ids[chain] = fid
            style = styles.get(" / ".join(chain)) or {}
            folders.append({"_id": fid, "name": chain[-1], "type": "Actor",
                            "folder": folder_ids.get(chain[:-1]), "sorting": "a",
                            "sort": 0, "color": style.get("color"), "description": style.get("description"),
                            "path": list(chain)})
    actors, seen_ids, dupes = [], {}, []
    unresolved = 0
    for fpath, name, aid, doc, path in rows:
        doc = copy.deepcopy(doc)
        plate = roster_plate(doc.get("img")) or fullbody_twin(doc.get("img"))
        if plate:
            doc["img"] = plate          # a roster cell is the website's cream card, never actor art
        tok = (doc.get("prototypeToken") or {}).get("texture") or {}
        plate = roster_plate(tok.get("src")) or fullbody_twin(tok.get("src"))
        if plate:
            tok["src"] = plate
        sprite = fullbody_sprite(doc.get("img"))
        if sprite:
            doc["img"] = sprite         # the full-body sprite wins over a face crop
        sprite = fullbody_sprite(tok.get("src"))
        if sprite:
            tok["src"] = sprite
        if fpath is None:
            unresolved += 1  # keep doc["folder"] as exported
        else:
            set_folder_flag(doc, fpath)
            doc["folder"] = folder_ids.get(tuple(fpath))
        if aid:
            if aid in seen_ids:
                dupes.append((aid, seen_ids[aid], path))
            seen_ids[aid] = path
        actors.append(doc)
    system = next((a.get("_stats", {}).get("systemId") for a in actors if a.get("_stats", {}).get("systemId")), None)
    payload = {
        "format": FORMAT,
        "generatedBy": "tools/foundry-bridge.py combine",
        "exportedFrom": world,
        "system": system,
        "actorCount": len(actors),
        "folderCount": len(folders),
        "unresolvedFolderActors": unresolved,
        "folderStyles": styles,
        "folders": folders,
        "actors": actors,
    }
    players = players_payload(scheme) if world in (None, live_world(scheme)) else None
    if players:
        payload["players"] = players  # the roster, the companions, who may open which sheet (the module applies it)
    if omitted:
        payload["omitted"] = omitted
    return payload, dupes


# -------------------------------------------------------------- link-images

def repo_file_for(image_path):
    """Return the repo file a Foundry-relative image path maps to, or None."""
    if not image_path or not isinstance(image_path, str):
        return None
    if image_path.startswith(("http://", "https://", "data:")):
        return None
    rel = image_path.split("?")[0].replace("\\", "/").lstrip("/")
    # Foundry keeps paths URL-encoded ("npc/MLSS%2BBM_Art.png"); the file is not
    for cand_rel in dict.fromkeys((rel, urllib.parse.unquote(rel))):
        for base in (RM, ROOT):
            cand = os.path.join(base, *cand_rel.split("/"))
            if os.path.isfile(cand):
                return cand
    return None


# ------------------------------------------------------------------- art URLs
# From 1.8 the art the sheets reference is not copied into Foundry's Data
# folder: the packets carry URLs on the archive's own server (start.py), so
# one file serves the website and every Foundry client. `art_url` turns a
# repo path into that URL (combine, when given --art-base); `art_path` turns
# it back (split, so the committed mirror stays host-free).

def image_fields(doc):
    """(container, key) for every image field a packet may carry: the actor's
    portrait, its prototype token, each item's icon."""
    out = [(doc, "img")]
    tex = ((doc.get("prototypeToken") or {}).get("texture") or {})
    if isinstance(tex, dict):
        out.append((tex, "src"))
    for it in doc.get("items") or []:
        if isinstance(it, dict):
            out.append((it, "img"))
    return out


def image_paths_of(doc):
    return [c.get(k) for c, k in image_fields(doc) if isinstance(c.get(k), str) and c.get(k)]


def relink_images(doc, fn):
    """Apply fn(path) -> path to every image field of doc, in place; the
    fields that changed, as (before, after)."""
    changed = []
    for container, key in image_fields(doc):
        p = container.get(key)
        if not isinstance(p, str) or not p:
            continue
        q = fn(p)
        if isinstance(q, str) and q != p:
            container[key] = q
            changed.append((p, q))
    return changed


def art_url(image_path, base):
    """A repo-managed image path -> its URL under `base` (the archive's own
    server, e.g. http://192.168.1.20:8765/); anything else comes back as is."""
    if not base or not isinstance(image_path, str):
        return image_path
    src = repo_file_for(image_path)
    if not src:
        return image_path
    rel = os.path.relpath(src, ROOT).replace(os.sep, "/")
    return base.rstrip("/") + "/" + urllib.parse.quote(rel, safe="/")


def art_path(url):
    """The repo-relative Foundry path (`portraits/...`) for a URL that points
    at a repo file on the archive's server — whichever host it names; None
    when the URL is not that."""
    if not isinstance(url, str) or not re.match(r"^https?://[^/]+/", url):
        return None
    rel = urllib.parse.unquote(url.split("?")[0].split("#")[0].split("/", 3)[3])
    cand = os.path.join(ROOT, *rel.split("/"))
    if not os.path.isfile(cand):
        return None
    for base in (RM, ROOT):
        try:
            inside = os.path.commonpath([os.path.abspath(cand), os.path.abspath(base)]) == os.path.abspath(base)
        except ValueError:
            inside = False
        if inside:
            return os.path.relpath(cand, base).replace(os.sep, "/")
    return None


def image_status(p, lib=frozenset()):
    """placeholder | ok (in repo) | library | server | external | missing | unknown.

    `missing` is only used for repo-managed roots (REPO_ROOTS); anything else
    the repo cannot see is `unknown` — most likely a file the GM uploaded to
    the Foundry Data folder — and is reported, never rewritten by default.
    """
    if p in PLACEHOLDERS or not isinstance(p, str):
        return "placeholder"
    if p.startswith(("http://", "https://", "data:")):
        return "external"
    if repo_file_for(p):
        return "ok"
    if p.replace("\\", "/") in lib:
        return "library"
    if p.replace("\\", "/").lstrip("/").startswith(SERVER_ROOTS):
        return "server"
    if p.replace("\\", "/").lstrip("/").startswith(REPO_ROOTS):
        return "missing"
    return "unknown"


def load_image_lib(path=DEFAULT_IMAGE_LIB):
    if not path or not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8", errors="replace") as fh:
        return {ln.strip().replace("\\", "/") for ln in fh if ln.strip()}


def load_character_portraits(path=DEFAULT_CHARACTERS):
    """name (lower) and slug -> portrait path, from characters.json."""
    out = {}
    if not path or not os.path.exists(path):
        return out
    data = read_json(path)
    records = data if isinstance(data, list) else data.get("characters", data)
    items = records if isinstance(records, list) else list(records.values())
    for rec in items:
        if not isinstance(rec, dict):
            continue
        img = rec.get("image") or rec.get("portrait")
        name = rec.get("name")
        if not (img and name):
            continue
        out.setdefault(str(name).lower(), img)
        out.setdefault(slugify(name), img)
    return out


def find_portrait(name, portraits_dir=DEFAULT_PORTRAITS):
    """portraits/<slug>.<ext> by name, underscore and hyphen spellings."""
    if not portraits_dir or not os.path.isdir(portraits_dir):
        return None
    slug = slugify(name)
    for stem in (slug.replace("-", "_"), slug):
        for ext in IMAGE_EXTS:
            cand = os.path.join(portraits_dir, stem + ext)
            if os.path.isfile(cand):
                rel = os.path.relpath(cand, RM).replace(os.sep, "/")
                return rel
    return None


def link_images(dirs, write=False, portraits_dir=DEFAULT_PORTRAITS,
                characters_json=DEFAULT_CHARACTERS, image_lib=DEFAULT_IMAGE_LIB,
                replace_unknown=False):
    """Point placeholder / missing portraits at repo images (by character name).

    Fixable statuses are `placeholder` and `missing`; `unknown` paths (GM
    uploads the repo cannot see, e.g. `npc/foo.webp`) are only replaced with
    replace_unknown=True. `server` and `external` paths are never touched.
    """
    lib = load_image_lib(image_lib)
    by_name = load_character_portraits(characters_json)
    fixable = {"placeholder", "missing"} | ({"unknown"} if replace_unknown else set())
    report = []
    for path, _ in actor_files(dirs):
        doc = load_actor_file(path)
        if doc is None:
            continue
        name = doc.get("name", "")
        changed = False
        rows = []

        def status(p):
            return image_status(p, lib)

        img = doc.get("img")
        token = ((doc.get("prototypeToken") or {}).get("texture") or {}).get("src")
        suggestion = None
        if status(img) in fixable or status(token) in fixable:
            suggestion = by_name.get(str(name).lower()) or by_name.get(slugify(name)) or find_portrait(name, portraits_dir)
            if suggestion and not repo_file_for(suggestion):
                suggestion = None
        for where, current in (("img", img), ("token", token)):
            st = status(current)
            row = {"actor": name, "where": where, "path": current, "status": st, "fix": None}
            if st in fixable and suggestion:
                row["fix"] = suggestion
                if write:
                    if where == "img":
                        doc["img"] = suggestion
                    else:
                        doc.setdefault("prototypeToken", {}).setdefault("texture", {})["src"] = suggestion
                    changed = True
            rows.append(row)
        for it in doc.get("items") or []:
            if not isinstance(it, dict):
                continue
            st = status(it.get("img"))
            if st in ("missing", "unknown"):
                rows.append({"actor": name, "where": f"item:{it.get('name')}", "path": it.get("img"), "status": st, "fix": None})
        report.extend(rows)
        if changed:
            write_text(path, render(doc))
    return report


# -------------------------------------------------------------------- apply

def _match(change, doc):
    m = change.get("match") or {}
    if not m:
        return False
    if "_id" in m and doc.get("_id") != m["_id"]:
        return False
    if "name" in m and doc.get("name") != m["name"]:
        return False
    if "type" in m and doc.get("type") != m["type"]:
        return False
    if "nameContains" in m and str(m["nameContains"]).lower() not in str(doc.get("name", "")).lower():
        return False
    return True


def _resolve_item(spec, base_dir):
    """An item spec: inline item dict, or {"fromFile": "...", "item": "Name"}."""
    if "fromFile" in spec:
        src_path = spec["fromFile"]
        if not os.path.isabs(src_path):
            cand = os.path.join(base_dir, src_path)
            src_path = cand if os.path.exists(cand) else os.path.join(ROOT, src_path)
        src = read_json(src_path)
        pool = src.get("items", []) if isinstance(src, dict) and src.get("type") else (src if isinstance(src, list) else [src])
        wanted = spec.get("item")
        for it in pool:
            if isinstance(it, dict) and (wanted is None or it.get("name") == wanted or it.get("_id") == wanted):
                return copy.deepcopy(it)
        raise LookupError(f"item {wanted!r} not found in {src_path}")
    return copy.deepcopy(spec)


def apply_changes(changes_path, dirs, write=False):
    spec = read_json(changes_path)
    changes = spec.get("changes", spec) if isinstance(spec, dict) else spec
    if not isinstance(changes, list):
        raise SystemExit("apply: changes file must be a list or {\"changes\": [...]}")
    base_dir = os.path.dirname(os.path.abspath(changes_path))
    docs = []
    for path, _ in actor_files(dirs):
        doc = load_actor_file(path)
        if doc is not None:
            docs.append([path, doc, False, False])  # path, doc, changed, delete
    log = []
    for idx, change in enumerate(changes):
        targets = [row for row in docs if _match(change, row[1])]
        if not targets:
            log.append(f"change #{idx + 1}: no actor matches {change.get('match')}")
            continue
        for row in targets:
            path, doc = row[0], row[1]
            label = f"{doc.get('name')} ({os.path.relpath(path, ROOT)})"
            if change.get("delete"):
                row[3] = True
                log.append(f"{label}: DELETE")
                continue
            for dotted, value in (change.get("set") or {}).items():
                set_path(doc, dotted, value)
                log.append(f"{label}: set {dotted} = {json.dumps(value, ensure_ascii=False)}")
            for dotted in change.get("unset") or []:
                if unset_path(doc, dotted):
                    log.append(f"{label}: unset {dotted}")
            if "rename" in change:
                log.append(f"{label}: rename -> {change['rename']}")
                doc["name"] = change["rename"]
                if isinstance(doc.get("prototypeToken"), dict):
                    doc["prototypeToken"]["name"] = change["rename"]
            if "folderPath" in change:
                set_folder_flag(doc, [str(p) for p in change["folderPath"]])
                log.append(f"{label}: folderPath -> {' / '.join(change['folderPath'])}")
            for name in change.get("removeItems") or []:
                before = len(doc.get("items") or [])
                doc["items"] = [it for it in doc.get("items") or [] if it.get("name") != name and it.get("_id") != name]
                log.append(f"{label}: removeItems {name!r} ({before - len(doc['items'])} removed)")
            for n, item_spec in enumerate(change.get("addItems") or []):
                try:
                    item = _resolve_item(item_spec, base_dir)
                except (LookupError, OSError, ValueError) as exc:
                    log.append(f"{label}: ERROR addItems — {exc}")
                    continue
                if not item.get("_id"):
                    item["_id"] = sid(doc.get("_id") or doc.get("name"), "item", item.get("name"), n)
                existing = [it for it in doc.get("items") or [] if it.get("_id") == item["_id"]]
                if existing:
                    doc["items"] = [item if it.get("_id") == item["_id"] else it for it in doc["items"]]
                    log.append(f"{label}: addItems {item.get('name')!r} (replaced, same id)")
                else:
                    doc.setdefault("items", []).append(item)
                    log.append(f"{label}: addItems {item.get('name')!r}")
            for name in change.get("removeEffects") or []:
                before = len(doc.get("effects") or [])
                doc["effects"] = [ef for ef in doc.get("effects") or [] if ef.get("name") != name and ef.get("_id") != name]
                log.append(f"{label}: removeEffects {name!r} ({before - len(doc['effects'])} removed)")
            for n, effect in enumerate(change.get("addEffects") or []):
                effect = copy.deepcopy(effect)
                if not effect.get("_id"):
                    effect["_id"] = sid(doc.get("_id") or doc.get("name"), "effect", effect.get("name"), n)
                doc.setdefault("effects", []).append(effect)
                log.append(f"{label}: addEffects {effect.get('name')!r}")
            row[2] = True
    if write:
        for path, doc, changed, delete in docs:
            if delete:
                os.remove(path)
            elif changed:
                write_text(path, render(doc))
    return log


# -------------------------------------------------------------------- check

def check_docs(docs, image_lib=DEFAULT_IMAGE_LIB, strict_images=False, roster=None, allow_art_url=False):
    """The validation behind `check` and `check-packet`. `docs` yields
    (label, doc) — a file's repo path or a packet's actor name. Returns
    (count, errors, warnings). `roster` (load_roster) brings the party rules:
    only roster characters and companions sit in the players folder, and a
    roster character carries a character sheet; None = no roster rules."""
    lib = load_image_lib(image_lib)
    errors, warnings, ids, unknown = [], [], {}, []
    count = 0
    players = (roster or {}).get("folder") or "Players"
    seen_roster = {}
    for rel, doc in docs:
        if isinstance(doc, Exception):
            errors.append(f"{rel}: invalid JSON ({doc})")
            continue
        if not (isinstance(doc, dict) and doc.get("name") and doc.get("type")):
            warnings.append(f"{rel}: not an actor (no name/type) — skipped")
            continue
        count += 1
        aid = doc.get("_id")
        if aid is not None and not FOUNDRY_ID.match(str(aid)):
            errors.append(f"{rel}: _id {aid!r} is not 16 alphanumerics")
        if aid:
            if aid in ids:
                errors.append(f"{rel}: duplicate _id {aid} (also {ids[aid]})")
            ids[aid] = rel
        if doc.get("type") not in ("character", "npc", "vehicle", "group"):
            warnings.append(f"{rel}: unusual actor type {doc.get('type')!r}")
        flag = (doc.get("flags") or {}).get(MODULE_ID, {}).get("folderPath")
        if flag is not None and not (isinstance(flag, list) and all(isinstance(p, str) for p in flag)):
            errors.append(f"{rel}: flags.{MODULE_ID}.folderPath must be a list of strings")
        item_ids = [it.get("_id") for it in doc.get("items") or [] if isinstance(it, dict) and it.get("_id")]
        if len(item_ids) != len(set(item_ids)):
            errors.append(f"{rel}: duplicate item _id")
        for it in doc.get("items") or []:
            if isinstance(it, dict) and it.get("type") in ("race", "class", "subclass", "background") and doc.get("type") == "npc":
                warnings.append(f"{rel}: npc carries a {it['type']} item ({it.get('name')})")
        if doc.get("type") == "character":
            for kind in SINGLETON_TYPES:
                twins = [it for it in doc.get("items") or [] if isinstance(it, dict) and it.get("type") == kind]
                if len(twins) > 1:
                    applied = applied_singleton_id(doc, kind)
                    names = " / ".join(str(it.get("name")) for it in twins)
                    using = next((it.get("name") for it in twins if it.get("_id") == applied), None)
                    warnings.append(f"{rel}: {len(twins)} {kind} items ({names}) — dnd5e keeps one per character"
                                    + (f"; the sheet applies {using!r}" if using else f"; details.{kind} names none of them"))
        for it, key, val in invalid_identifiers(doc):
            errors.append(f"{rel}: item {it.get('name')!r} system.{key} {val!r} is not letters/digits/-/_ — dnd5e rejects the item "
                          f"(split repairs this; expected {slug_identifier(val) or slug_identifier(it.get('name'))!r})")
        for where, problem in invalid_ownership(doc):
            errors.append(f"{rel}: {where}: {problem} — Foundry refuses the whole update")
        if not allow_art_url:
            for where, url in art_by_url(doc):
                errors.append(f"{rel}: {where} names art by URL ({url}) — art travels as a Data path (install-images copies the file); "
                              "re-split the export / run the suite without --art-base")
        # the party: the roster decides, never the sheet type
        if roster and roster.get("rows"):
            row = roster_row(doc, roster)
            here = flag if isinstance(flag, list) else None
            in_players = bool(here) and here[0] == players
            if row:
                if row.get("actor") and aid and row["actor"] != aid:
                    warnings.append(f"{rel}: {doc.get('name')} is on the roster under id {row['actor']}, this copy is {aid}")
                elif aid:
                    seen_roster.setdefault(aid, rel)
                if doc.get("type") != "character":
                    errors.append(f"{rel}: {doc.get('name')} is on the party roster but is a {doc.get('type')!r} sheet — "
                                  "player characters carry character sheets (tools/promote-player-sheets.py)")
                if here is not None and not in_players:
                    warnings.append(f"{rel}: {doc.get('name')} is on the party roster but sits in {' / '.join(here) or 'the root'}, not {players}")
            elif in_players and not is_companion(doc, roster):
                errors.append(f"{rel}: {doc.get('name')} sits in {players} but is not on the party roster (actors/folders.json players.roster) "
                              "— a character sheet does not make a player character; add the row or move the actor")
        images = [("img", doc.get("img")), ("token", ((doc.get("prototypeToken") or {}).get("texture") or {}).get("src"))]
        images += [(f"item:{it.get('name')}", it.get("img")) for it in doc.get("items") or [] if isinstance(it, dict)]
        unknown_here = []
        for where, p in images:
            st = image_status(p, lib)
            if st == "missing":
                (errors if strict_images else warnings).append(f"{rel}: {where} image missing from the repo: {p}")
            elif st == "unknown":
                unknown_here.append(p)
        if unknown_here:
            unknown.extend(unknown_here)
            warnings.append(f"{rel}: {len(unknown_here)} image path(s) the repo cannot see (GM uploads?) e.g. {unknown_here[0]}")
    if unknown:
        warnings.append(f"{len(set(unknown))} distinct image path(s) outside the repo, system and modules — the module's import-time image check verifies them in Foundry")
    # who may open which sheet: the scheme's permissions must resolve (a name
    # that is not on the roster, an unknown level) — the module applies them
    if roster and roster.get("rows") and roster.get("scheme") is not None:
        perms = load_permissions(roster["scheme"], roster)
        for problem in perms["problems"]:
            errors.append(f"actors/folders.json: {problem}")
    return count, errors, warnings


def _dir_docs(dirs):
    for path, _ in actor_files(dirs):
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        try:
            yield rel, read_json(path)
        except Exception as exc:  # noqa: BLE001 - report, do not crash
            yield rel, exc


def check(dirs, image_lib=DEFAULT_IMAGE_LIB, strict_images=False, roster=None):
    """Validate a directory tree of actor files (the mirror, an era packet).
    The roster rules apply whenever the folder scheme has a roster."""
    roster = load_roster() if roster is None else roster
    return check_docs(_dir_docs(dirs), image_lib=image_lib, strict_images=strict_images, roster=roster)


def check_packet(path, image_lib=DEFAULT_IMAGE_LIB, strict_images=False, roster=None, allow_art_url=False):
    """Validate one combined import payload (what the module will read)."""
    roster = load_roster() if roster is None else roster
    try:
        raw = read_json(path)
    except Exception as exc:  # noqa: BLE001
        return 0, [f"{os.path.relpath(path, ROOT)}: invalid JSON ({exc})"], []
    meta, folders, actors = normalize_payload(raw)
    name = os.path.relpath(path, ROOT).replace(os.sep, "/") if os.path.abspath(path).startswith(os.path.abspath(ROOT) + os.sep) else os.path.basename(path)
    if isinstance(raw, dict) and raw.get("format") not in (None, FORMAT):
        return 0, [f"{name}: format {raw.get('format')!r} is not {FORMAT}"], []

    def docs():
        for a in actors:
            label = f"{name} · {a.get('name')} [{a.get('_id')}]" if isinstance(a, dict) else name
            yield label, a

    count, errors, warnings = check_docs(docs(), image_lib=image_lib, strict_images=strict_images, roster=roster, allow_art_url=allow_art_url)
    folder_ids = {f.get("_id") for f in folders if isinstance(f, dict)}
    for f in folders:
        if isinstance(f, dict) and f.get("folder") and f["folder"] not in folder_ids:
            errors.append(f"{name}: folder {f.get('name')!r} names a parent {f['folder']} the packet does not carry")
    errors += check_players_block(raw.get("players") if isinstance(raw, dict) else None, actors, name)
    return count, errors, warnings


def check_players_block(players, actors, name):
    """The packet's `players` block (players_payload) — what the module reads to
    set who may open which sheet. Shape, ids and levels; a grant on an actor
    the packet does not carry is fine (the world may have it) but one outside
    the roster + companions is an error (the module would never apply it)."""
    if players is None:
        return []
    out = []
    if not isinstance(players, dict) or not isinstance(players.get("roster"), list):
        return [f"{name}: players block is not {{roster: [...], ...}}"]
    ids = set()
    for key in ("roster", "companions"):
        for row in players.get(key) or []:
            if not isinstance(row, dict) or not FOUNDRY_ID.match(str(row.get("actor") or "")) or not row.get("name"):
                out.append(f"{name}: players.{key} row {row!r} needs a 16-char actor id and a name")
            else:
                ids.add(row["actor"])
    if players.get("default") not in OWNERSHIP_LEVELS:
        out.append(f"{name}: players.default {players.get('default')!r} is not an ownership level")
    users = players.get("users")
    if not isinstance(users, list) or not all(isinstance(u, str) and u.strip() for u in users):
        out.append(f"{name}: players.users must be a list of Foundry user names")
        users = []
    perms = players.get("permissions")
    if not isinstance(perms, dict):
        return out + [f"{name}: players.permissions must map actor id -> {{user name: level}}"]
    for aid, grants in perms.items():
        if aid not in ids:
            out.append(f"{name}: players.permissions grants on {aid}, which is neither roster nor companion")
        if not isinstance(grants, dict):
            out.append(f"{name}: players.permissions[{aid}] must map user name -> level")
            continue
        for user, level in grants.items():
            if user not in users:
                out.append(f"{name}: players.permissions[{aid}] names user {user!r} missing from players.users")
            if level not in OWNERSHIP_LEVELS or level < 0:
                out.append(f"{name}: players.permissions[{aid}][{user!r}] level {level!r} is not 0..3")
    return out


# ----------------------------------------------------------- install-images

def install_images(dirs, foundry_data, dry_run=False, force=False):
    copied, skipped, missing = [], [], []
    seen = set()
    for path, _ in actor_files(dirs):
        doc = load_actor_file(path)
        if doc is None:
            continue
        paths = [doc.get("img"), ((doc.get("prototypeToken") or {}).get("texture") or {}).get("src")]
        paths += [fullbody_sprite(p) for p in paths[:2]]   # combine swaps these in
        paths += [it.get("img") for it in doc.get("items") or [] if isinstance(it, dict)]
        for p in paths:
            if not isinstance(p, str) or p in seen:
                continue
            seen.add(p)
            st = image_status(p)
            if st in ("placeholder", "server", "external", "library"):
                continue
            src = repo_file_for(p)
            if not src:
                if st == "missing":
                    missing.append(p)
                continue  # unknown = a GM upload the repo never had; nothing to copy
            dst = os.path.join(foundry_data, *p.replace("\\", "/").split("/"))
            # the same BYTES, not the same size: a plate cut again (a Toad off its cream field) is often the same size
            if os.path.exists(dst) and not force and filecmp.cmp(src, dst, shallow=False):
                skipped.append(p)
                continue
            if not dry_run:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
            copied.append(p)
    return copied, skipped, missing


# ------------------------------------------------------------- prune-images
# Roots under Foundry's Data folder where install-images used to put copies
# of repo art (portraits/, assets/images/, assets/icons/ …). Only a file whose
# path also exists in the repo, with the same bytes, is ever considered — a
# GM's own assets/srd5e/… are not.
DATA_ART_ROOTS = ("portraits", "assets")


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _norm_ref(p):
    """An image reference as the export/packets spell it -> a repo-root-free
    Data path ("portraits/x.png"), or None for URLs and placeholders."""
    if not isinstance(p, str) or not p or p.startswith(("http://", "https://", "data:")):
        return None
    return urllib.parse.unquote(p.split("?")[0].replace("\\", "/").lstrip("/"))


def world_image_refs(export_path):
    """What the newest export back says the world still points at by Data
    path: every actor's images plus `imagesInUse` (module 1.8+: scenes,
    tokens, tiles, journals, items, macros). Returns (refs, verdict) where a
    verdict other than None means the export cannot vouch for the world."""
    if not export_path or not os.path.exists(export_path):
        return set(), "no export back from Foundry yet (module 1.8 writes one after every change; or Mass export into Data)"
    try:
        raw = read_json(export_path)
    except (OSError, ValueError) as exc:
        return set(), f"export back unreadable ({exc})"
    _, _, actors = normalize_payload(raw)
    refs = set()
    for a in actors:
        if isinstance(a, dict):
            refs.update(r for r in (_norm_ref(p) for p in image_paths_of(a)) if r)
    in_use = raw.get("imagesInUse") if isinstance(raw, dict) else None
    if not isinstance(in_use, list):
        return refs, "export back predates module 1.8 (no imagesInUse list: placed tokens and scenes cannot be checked) — let the module export once more"
    refs.update(r for r in (_norm_ref(p) for p in in_use) if r)
    return refs, None


def fetch_bytes(url, timeout=6.0):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "foundry-bridge"}), timeout=timeout) as resp:
        return resp.read()


def prune_images(foundry_data, art_base, export_path=None, packets=(), write=False, fetch=fetch_bytes):
    """Remove the copies of repo art under <Data>/portraits and
    <Data>/assets/images that nothing needs any more. A copy goes only when
    all of these hold, in this order:
      1. the repo holds the same file (identical bytes) — a GM upload that
         merely shares a name is never touched;
      2. the archive's server returns those very bytes for the file's URL —
         so the art is really served from where the packets now point;
      3. the newest export back from Foundry (module 1.8+, which lists every
         image the world uses: scenes, placed tokens, tiles, journals, items)
         does not reference the Data path;
      4. no published packet references the Data path.
    Returns a report dict; nothing is deleted unless write=True."""
    rep = {"deleted": [], "kept": [], "bytes": 0, "server": None, "verdict": None, "scanned": 0}
    refs, verdict = world_image_refs(export_path)
    rep["verdict"] = verdict
    for pk in packets:
        try:
            _, _, actors = normalize_payload(read_json(pk))
        except (OSError, ValueError):
            continue
        for a in actors:
            if isinstance(a, dict):
                refs.update(r for r in (_norm_ref(p) for p in image_paths_of(a)) if r)
    base = (art_base or "").rstrip("/") + "/"
    candidates = []
    for root in DATA_ART_ROOTS:
        top = os.path.join(foundry_data, root)
        if not os.path.isdir(top):
            continue
        for dirpath, _, files in os.walk(top):
            for fn in files:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, foundry_data).replace(os.sep, "/")
                rep["scanned"] += 1
                src = repo_file_for(rel)
                if not src:
                    continue  # not the repo's: a GM upload sharing the folder
                if os.path.getsize(src) != os.path.getsize(full) or _sha(src) != _sha(full):
                    rep["kept"].append((rel, "differs from the repo's file"))
                    continue
                candidates.append((rel, full, src))
    if not candidates:
        return rep
    if not art_base:
        rep["kept"].extend((rel, "no art base — the packets still point at Data") for rel, _, _ in candidates)
        return rep
    # one probe decides whether the server is up at all
    try:
        probe = fetch(base + urllib.parse.quote(os.path.relpath(candidates[0][2], ROOT).replace(os.sep, "/"), safe="/"))
        rep["server"] = "ok" if probe is not None else "down"
    except Exception as exc:  # noqa: BLE001 — any failure means "not serving"
        rep["server"] = f"down ({exc})"
    if rep["server"] != "ok":
        rep["kept"].extend((rel, f"art server {base} not answering") for rel, _, _ in candidates)
        return rep
    for rel, full, src in candidates:
        if rel in refs:
            rep["kept"].append((rel, "still referenced by the world (export back) or a packet"))
            continue
        if verdict:
            rep["kept"].append((rel, verdict))
            continue
        url = base + urllib.parse.quote(os.path.relpath(src, ROOT).replace(os.sep, "/"), safe="/")
        try:
            served = fetch(url)
        except Exception as exc:  # noqa: BLE001
            rep["kept"].append((rel, f"not served at {url} ({exc})"))
            continue
        if served is None or hashlib.sha256(served).hexdigest() != _sha(src):
            rep["kept"].append((rel, f"the server returns different bytes for {url}"))
            continue
        size = os.path.getsize(full)
        if write:
            os.remove(full)
            d = os.path.dirname(full)
            while d != foundry_data and os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d)
                d = os.path.dirname(d)
        rep["deleted"].append(rel)
        rep["bytes"] += size
    return rep


# ---------------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("split", help="one file per actor, directories mirror the folder tree")
    p.add_argument("export")
    p.add_argument("--out", required=True)
    p.add_argument("--flat", action="store_true", help="no folder directories")
    p.add_argument("--prune", action="store_true", help="delete actor files in --out that the export no longer has")

    p = sub.add_parser("heal", help="a mirror an older bridge split: drop the broken species / background its manifest repaired beside the one the sheet applies (split does this itself now)")
    p.add_argument("world_dir")

    p = sub.add_parser("combine", help="actor files -> one import payload (folders rebuilt)")
    p.add_argument("dirs", nargs="+")
    p.add_argument("--out", required=True)
    p.add_argument("--folder", default=None, help="prefix every folderPath, e.g. \"Imports / Session 42\"")
    p.add_argument("--world", default=None,
                   help="exportedFrom value; combine carries the party block (players_payload) only for the live world "
                        f"(actors/folders.json players.world, else {LIVE_WORLD!r}) or when no world is named — an era packet's committed import.json never churns with the roster")
    p.add_argument("--ignore-dirs", action="store_true", help="only use the folderPath flag, never the directory path")
    p.add_argument("--keep-duplicates", action="store_true", help="with several dirs: keep every actor even when a later dir repeats a name + type of an earlier one")
    p.add_argument("--art-base", default=None, metavar="URL", help="repo art becomes URLs under this base (the archive's own server, e.g. http://192.168.1.20:8765/) instead of Data paths")
    p.add_argument("--check", action="store_true", help="verify --out is current; write nothing")

    p = sub.add_parser("link-images", help="connect actors to repo art; report unless --write")
    p.add_argument("dirs", nargs="+")
    p.add_argument("--write", action="store_true")
    p.add_argument("--portraits", default=DEFAULT_PORTRAITS)
    p.add_argument("--characters", default=DEFAULT_CHARACTERS)
    p.add_argument("--image-lib", default=DEFAULT_IMAGE_LIB)
    p.add_argument("--replace-unknown", action="store_true",
                   help="also replace image paths the repo cannot see (GM uploads such as npc/foo.webp)")

    p = sub.add_parser("apply", help="apply a changes.json across actor files; report unless --write")
    p.add_argument("changes")
    p.add_argument("dirs", nargs="+")
    p.add_argument("--write", action="store_true")

    p = sub.add_parser("check", help="validate actor files (ids, identifiers, ownership, art paths, the party roster, images)")
    p.add_argument("dirs", nargs="+")
    p.add_argument("--image-lib", default=DEFAULT_IMAGE_LIB)
    p.add_argument("--strict-images", action="store_true", help="unknown images are errors, not warnings")

    p = sub.add_parser("check-packet", help="the same validation on a combined import.json (the suite runs it before publishing or committing)")
    p.add_argument("packets", nargs="+")
    p.add_argument("--image-lib", default=DEFAULT_IMAGE_LIB)
    p.add_argument("--strict-images", action="store_true")
    p.add_argument("--allow-art-url", action="store_true", help="the packet was built with combine --art-base on purpose")

    p = sub.add_parser("install-images", help="copy referenced repo images into the Foundry Data folder (the pre-1.8 way; --art-copy in the suite)")
    p.add_argument("dirs", nargs="+")
    p.add_argument("--foundry-data", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force", action="store_true")

    p = sub.add_parser("prune-images", help="delete Data copies of repo art that the packets (now URLs), the world's export back and the art server all vouch are no longer needed; report unless --write")
    p.add_argument("--foundry-data", required=True)
    p.add_argument("--art-base", required=True, metavar="URL")
    p.add_argument("--export", default=None, help="the newest export back from Foundry (module 1.8+ lists every image the world uses)")
    p.add_argument("--packet", action="append", default=[], help="a published packet to honour (repeatable)")
    p.add_argument("--write", action="store_true")

    args = ap.parse_args(argv)

    if args.cmd == "split":
        written, pruned, manifest = split(args.export, args.out, flat=args.flat, prune=args.prune)
        for w in written:
            print(f"  wrote {os.path.relpath(w, ROOT)}")
        for w in pruned:
            print(f"  pruned {os.path.relpath(w, ROOT)}")
        for r in manifest["identifiersRepaired"]:
            print(f"  repaired {r['actor']} · {r['item']} · {r['key']} {r['from']!r} -> {r['to']!r}")
        for r in manifest["leftoversDropped"]:
            print(f"  dropped {r['actor']} · {r['item']} [{r['type']}] — broken, and the sheet's {r['type']} is {r['applied']}")
        print(f"split: {len(written)} actors ({manifest['filesChanged']} file(s) changed) from {manifest['exportedFrom'] or args.export} "
              f"into {len(manifest['folders'])} folder path(s) -> {args.out}"
              + (f", {len(manifest['identifiersRepaired'])} identifier(s) repaired" if manifest["identifiersRepaired"] else "")
              + (f", {len(manifest['leftoversDropped'])} leftover(s) dropped" if manifest["leftoversDropped"] else ""))
        return 0

    if args.cmd == "heal":
        dropped = heal(args.world_dir)
        for rel, _n, item, typ, applied in dropped:
            print(f"  dropped {rel}: {item} [{typ}] — broken in the export, and the sheet's {typ} is {applied}")
        print(f"heal: {len(dropped)} leftover(s) dropped in {args.world_dir}" if dropped else f"heal: nothing to drop in {args.world_dir}")
        return 0

    if args.cmd == "combine":
        payload, dupes = combine(args.dirs, folder_prefix=args.folder, world=args.world, ignore_dirs=args.ignore_dirs,
                                 dedupe=False if args.keep_duplicates else None, art_base=args.art_base)
        for aid, first, second in dupes:
            print(f"  WARNING duplicate _id {aid}: {os.path.relpath(first, ROOT)} and {os.path.relpath(second, ROOT)}", file=sys.stderr)
        text = render(payload)
        if args.check:
            if not os.path.exists(args.out):
                print(f"FAIL combine: {args.out} missing", file=sys.stderr)
                return 1
            with open(args.out, encoding="utf-8") as fh:
                if fh.read() != text:
                    print(f"FAIL combine: {args.out} is stale — rerun without --check", file=sys.stderr)
                    return 1
            print(f"OK combine: {args.out} current ({payload['actorCount']} actors, {payload['folderCount']} folders)")
            return 0
        write_text(args.out, text)
        print(f"combine: {payload['actorCount']} actors, {payload['folderCount']} folders"
              f" ({sum(1 for f in payload['folders'] if f.get('color'))} coloured)"
              + (f", {len(payload['omitted'])} left out (same name + type as an earlier source)" if payload.get("omitted") else "")
              + (f", {payload['artLinks']} image(s) as URLs under {payload['artBase']}" if payload.get("artBase") else "")
              + f" -> {args.out}")
        return 1 if dupes else 0

    if args.cmd == "link-images":
        report = link_images(args.dirs, write=args.write, portraits_dir=args.portraits,
                             characters_json=args.characters, image_lib=args.image_lib,
                             replace_unknown=args.replace_unknown)
        problems = [r for r in report if r["status"] in ("placeholder", "missing")]
        unknown = [r for r in report if r["status"] == "unknown"]
        for r in report:
            if r["status"] in ("ok", "server", "external") or (r["status"] == "library" and r["where"].startswith("item")):
                continue
            if r["status"] == "unknown" and not r["fix"] and r["where"].startswith("item"):
                continue
            fix = f" -> {r['fix']}" if r["fix"] else ""
            print(f"  {r['status']:<11} {r['actor']} · {r['where']} · {r['path']}{fix}")
        fixed = sum(1 for r in report if r["fix"])
        verb = "fixed" if args.write else "fixable"
        print(f"link-images: {len(report)} image refs, {len(problems)} placeholder/missing, "
              f"{len(unknown)} outside the repo (left alone{'' if args.replace_unknown else '; --replace-unknown to swap them'}), {fixed} {verb}"
              + ("" if args.write else " (dry run — add --write)"))
        return 0

    if args.cmd == "apply":
        log = apply_changes(args.changes, args.dirs, write=args.write)
        for line in log:
            print("  " + line)
        errors = [ln for ln in log if ": ERROR " in ln or ln.startswith("change #")]
        print(f"apply: {len(log)} change line(s), {len(errors)} problem(s)" + ("" if args.write else " (dry run — add --write)"))
        return 1 if errors else 0

    if args.cmd == "check":
        count, errors, warnings = check(args.dirs, image_lib=args.image_lib, strict_images=args.strict_images)
        for w in warnings:
            print("  warn  " + w)
        for e in errors:
            print("  ERROR " + e, file=sys.stderr)
        print(f"{'FAIL' if errors else 'OK'} check: {count} actors, {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1 if errors else 0

    if args.cmd == "check-packet":
        total, errors, warnings = 0, [], []
        for pk in args.packets:
            c, e, w = check_packet(pk, image_lib=args.image_lib, strict_images=args.strict_images, allow_art_url=args.allow_art_url)
            total += c
            errors += e
            warnings += w
        for w in warnings:
            print("  warn  " + w)
        for e in errors:
            print("  ERROR " + e, file=sys.stderr)
        print(f"{'FAIL' if errors else 'OK'} check-packet: {total} actors in {len(args.packets)} packet(s), {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1 if errors else 0

    if args.cmd == "install-images":
        copied, skipped, missing = install_images(args.dirs, args.foundry_data, dry_run=args.dry_run, force=args.force)
        for p in copied:
            print(f"  {'would copy' if args.dry_run else 'copied'} {p}")
        for p in missing:
            print(f"  MISSING in repo: {p}", file=sys.stderr)
        print(f"install-images: {len(copied)} copied, {len(skipped)} already there, {len(missing)} missing"
              + (" (dry run)" if args.dry_run else ""))
        return 1 if missing else 0

    if args.cmd == "prune-images":
        rep = prune_images(args.foundry_data, args.art_base, export_path=args.export, packets=args.packet, write=args.write)
        verb = "deleted" if args.write else "would delete"
        for rel in rep["deleted"]:
            print(f"  {verb} {rel}")
        reasons = {}
        for rel, why in rep["kept"]:
            reasons.setdefault(why, []).append(rel)
        for why, rels in reasons.items():
            print(f"  kept {len(rels)}: {why}" + (f" (e.g. {rels[0]})" if rels else ""))
        print(f"prune-images: {len(rep['deleted'])} {verb} ({rep['bytes'] / 1e6:.1f} MB), {len(rep['kept'])} kept, {rep['scanned']} file(s) under "
              + ", ".join(DATA_ART_ROOTS) + (" (dry run)" if not args.write else ""))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
