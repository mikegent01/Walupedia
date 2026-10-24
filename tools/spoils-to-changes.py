#!/usr/bin/env python3
"""spoils-to-changes — the items the record says a character holds, written as a
changes file for the Foundry mirror.

The event-filing step for loot is one line in the archive's item registry:
register the item under ``items`` in Reputation-Matrix2/data/inventory.json and
list it under the holder in ``inventories``. This tool does the rest — it is the
bridge from "the record says Hjumpik pocketed a ring" to "the ring is on the
sheet at the table".

Reads
  Reputation-Matrix2/data/inventory.json      the registry: ``items`` and ``inventories``
                                              (holder article id -> [{itemId, status, known}])
  Reputation-Matrix2/data/sheets.json         which character articles have a live sheet, and where
  Reputation-Matrix2/actors/worlds/<world>/   the mirror: the exported sheets as the table last had them
                                              (plus whatever earlier changes files already put on them)
Writes
  Reputation-Matrix2/actors/changes/spoils-<world>.json   GENERATED — re-run this tool, never hand-edit.
  tools/sheets-suite.py runs it before the changes step; tools/foundry-bridge.py apply
  puts the items on the mirror, the packet carries them, the module's Sync shows them as
  "changed" rows and asks first.

A registry item becomes a sheet item when
  * the holder's article has a live sheet — party sheets by default, every live sheet with --all;
  * the holding is ``known`` and the item's ``visibility`` is "known" (hidden slots stay hidden —
    the mirror is public);
  * neither the item nor the holding says ``"foundry": false``;
  * the table's sheet does not already carry it — checked against the export the mirror was split
    from (manifest.json ``source``), so an item this tool put on the mirror still counts as missing
    until the table has it; "carries it" means an item flagged flags.waluipedia.inventoryItem ==
    <itemId>, or one whose name matches the registry name, the name without the holder's possessive
    ("Eager's Pepper Spray" -> "Pepper Spray"), without a leading "The", or any name in the item's
    ``foundry.aliases`` — quotes, case, punctuation and a trailing "(...)" ignored;
  * the table has not already dropped it (below).

Declined at the table. The file remembers when each item first entered it (``filed``). When the
mirror's export says the module applied a packet after that (``lastSync.applied.at`` in the export,
module 1.7.1+) and the item is still not on the sheet, the GM saw it and removed it — it moves to
``declined`` and is not added again. Delete its ``declined`` row to offer it once more.

Shape. ``foundry`` on a registry item may set ``type`` (loot / equipment / consumable / tool),
``subtype`` (equipment: trinket, clothing, ...; consumable: trinket, food, potion, ...),
``img`` (must be in tools/item sheet examples/image paths.txt), ``name``, ``quantity``, ``weight``
and a ``system`` dict merged on top. Without it the type is read off the registry ``type`` words
and the icon off a small keyword table. Weapons are filed as loot unless ``foundry.type`` says
otherwise with a full ``foundry.system`` — a half-built weapon is worse than a described one.

usage:
  python3 tools/spoils-to-changes.py                    # write spoils-midlands.json and report
  python3 tools/spoils-to-changes.py --check            # exit 1 when the file on disk is stale or the registry is wired wrong
  python3 tools/spoils-to-changes.py --all              # every live sheet, not just the party
  python3 tools/spoils-to-changes.py --world <id>       # another mirror under actors/worlds/
"""
import argparse
import copy
import datetime as _dt
import glob
import hashlib
import html
import json
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RM = os.path.join(ROOT, "Reputation-Matrix2")
INVENTORY = os.path.join(RM, "data", "inventory.json")
SHEETS_JSON = os.path.join(RM, "data", "sheets.json")
WORLDS = os.path.join(RM, "actors", "worlds")
CHANGES_DIR = os.path.join(RM, "actors", "changes")
IMAGE_LIB = os.path.join(RM, "tools", "item sheet examples", "image paths.txt")
TOOL = "tools/spoils-to-changes.py"

ITEM_TYPES = ("loot", "equipment", "consumable", "tool", "weapon")
# registry `type` words -> dnd5e item type (first hit wins, in this order)
TYPE_WORDS = [
    ("equipment", ("ring", "amulet", "glove", "gloves", "hat", "uniform", "armor", "armour", "cloak", "clothes",
                   "clothing", "garment", "onesie", "gear", "boots", "restraint", "cuffs", "handcuffs")),
    ("consumable", ("potion", "spray", "grenade", "bomb", "mushroom", "food", "drink", "wine", "brandy",
                    "consumable", "ammunition", "ammo", "poison")),
    ("tool", ("tool", "tools", "kit", "instrument", "chisel", "chisels")),
    ("loot", ("key", "letter", "note", "notes", "pages", "ledger", "remains", "fragments", "book", "card",
              "document", "recipe", "map", "evidence", "record", "token", "photo", "invitation", "contract",
              "badge", "artifact", "deck", "crystal", "mirror")),
]
# name/type words -> icon (each must be in the library; the first present wins; the last row is the fallback)
ICON_WORDS = [
    (("ring", "signet"), "icons/equipment/finger/ring-band-engraved-scrolls-gold.webp"),
    (("crystal", "gem"), "icons/commodities/gems/gem-faceted-round-black.webp"),
    (("key",), "icons/sundries/misc/key-brass.webp"),
    (("card", "ticket"), "icons/sundries/misc/admission-ticket-blue.webp"),
    (("deck", "tarot"), "icons/sundries/gaming/playing-cards-brown.webp"),
    (("pages", "note", "notes", "letter", "ledger", "document", "recipe", "contract", "evidence", "record"),
     "icons/sundries/documents/document-bound-white-tan.webp"),
    (("book", "tome", "diary"), "icons/sundries/books/book-embossed-bound-brown.webp"),
    (("fragments", "remains", "gear", "cog"), "icons/commodities/tech/cog-brass.webp"),
    (("cuffs", "handcuffs", "shackles", "manacles"), "icons/sundries/survival/cuffs-hand.webp"),
    (("pelt", "fur", "onesie"), "icons/commodities/leather/fur-pelt-brown.webp"),
    (("glove", "gloves"), "icons/equipment/hand/glove-cuffed-leather-brown-gold.webp"),
    (("wand",), "icons/weapons/wands/wand-gem-purple.webp"),
    (("badge", "medal"), "icons/commodities/treasure/medal-brass-red.webp"),
    (("chisel", "chisels"), "icons/tools/hand/chisel-steel-brown.webp"),
    (("trowel", "spade"), "icons/tools/hand/shovel-hand.webp"),
    ((), "icons/containers/bags/pouch-leather-brown-green.webp"),
]
POSSESSIVE = re.compile(r"^(.*?)'s\s+")


# ------------------------------------------------------------------ helpers

def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, doc):
    """Write `doc`; leave the file untouched (same bytes, same mtime) when it
    already holds exactly that — the suite's --watch keys on mtimes, and a
    pass that rewrote an unchanged spoils file re-triggered itself forever.
    -> True when the file was written."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    try:
        with open(path, encoding="utf-8") as fh:
            if fh.read() == text:
                return False
    except OSError:
        pass
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)
    return True


def sid(*parts):
    """Deterministic 16-char Foundry id (the actor builders' recipe)."""
    h = hashlib.sha256("::".join(str(p) for p in parts).encode("utf-8")).digest()
    alnum = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    n = int.from_bytes(h, "big")
    out = []
    for _ in range(16):
        n, r = divmod(n, len(alnum))
        out.append(alnum[r])
    return "".join(out)


def load_library(path=IMAGE_LIB):
    """Foundry's core icon paths, forward-slashed; empty when the list is missing (then any icon is trusted)."""
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8", errors="replace") as fh:
        return {line.strip().replace("\\", "/") for line in fh if line.strip()}


def norm(name):
    """Comparable form of an item name: quotes unified, trailing "(...)" dropped, lower-case words."""
    s = str(name or "").replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    s = re.sub(r"\s*\([^)]*\)\s*$", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
    return s


def name_candidates(item, holder_names):
    """Every form of the registry name the sheet might use."""
    out = set()
    base = [item.get("name") or ""]
    base += list(((item.get("foundry") or {}).get("aliases")) or [])
    if (item.get("foundry") or {}).get("name"):
        base.append(item["foundry"]["name"])
    for raw in base:
        n = norm(raw)
        if not n:
            continue
        out.add(n)
        if n.startswith("the "):
            out.add(n[4:])
        m = POSSESSIVE.match(str(raw).replace("\u2019", "'"))
        if m:
            out.add(norm(str(raw).replace("\u2019", "'")[m.end():]))
        for hn in holder_names:
            hn = norm(hn)
            for prefix in (hn + " s ", hn + " "):
                if hn and n.startswith(prefix):
                    out.add(n[len(prefix):])
    return {c for c in out if c}


def table_items(world_dir, manifest, root=ROOT):
    """actor id -> the items the table's export holds (the export manifest.json names as `source`).
    None when there is no export to read — then the mirror minus this tool's own additions stands in."""
    src = manifest.get("source")
    for cand in ([os.path.join(root, src), os.path.join(world_dir, src)] if src else []):
        if os.path.exists(cand):
            try:
                raw = read_json(cand)
            except (OSError, ValueError):
                return None
            actors = raw.get("actors") if isinstance(raw, dict) else raw
            return {a.get("_id"): a.get("items") or [] for a in actors or [] if isinstance(a, dict)}
    return None


def own_addition(it):
    return bool(((it.get("flags") or {}).get("waluipedia") or {}).get("inventoryItem"))


def sheet_has(doc, item_id, candidates):
    """The sheet item that already is this registry item, or None."""
    for it in doc.get("items") or []:
        if not isinstance(it, dict):
            continue
        flag = ((it.get("flags") or {}).get("waluipedia") or {}).get("inventoryItem")
        if flag == item_id:
            return it
    for it in doc.get("items") or []:
        if not isinstance(it, dict):
            continue
        n = norm(it.get("name"))
        if n in candidates or (n.startswith("the ") and n[4:] in candidates):
            return it
    return None


def guess_type(item):
    f = item.get("foundry") or {}
    if f.get("type") in ITEM_TYPES:
        return f["type"]
    words = set(re.findall(r"[a-z]+", f"{item.get('type', '')} {item.get('name', '')}".lower()))
    for kind, keys in TYPE_WORDS:
        if words & set(keys):
            return kind
    return "loot"


def guess_icon(item, lib):
    f = item.get("foundry") or {}
    if f.get("img"):
        return f["img"]
    words = set(re.findall(r"[a-z]+", f"{item.get('name', '')} {item.get('type', '')}".lower()))
    for keys, path in ICON_WORDS:
        if (not keys or words & set(keys)) and (not lib or path in lib):
            return path
    return ICON_WORDS[-1][1]


def plain(text):
    """Registry prose for a sheet: [[prop:x|label]] -> label, markdown emphasis dropped."""
    s = re.sub(r"\[\[[a-z]+:[^|\]]*\|([^\]]*)\]\]", r"\1", str(text or ""))
    s = re.sub(r"\[\[[a-z]+:([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
    return s.replace("**", "").replace("*", "")


def esc(text):
    return html.escape(plain(text), quote=False)


def description_html(item, item_id, holding, holder, events):
    parts = [f"<p>{esc(item.get('summary') or item.get('description') or item.get('name'))}</p>"]
    feats = [f for f in item.get("features") or [] if f]
    if feats:
        parts.append("<ul>" + "".join(f"<li>{esc(f)}</li>" for f in feats) + "</ul>")
    if item.get("obtained"):
        parts.append(f"<p><em>Obtained:</em> {esc(item['obtained'])}</p>")
    if holding.get("status"):
        parts.append(f"<p><em>On the record:</em> {esc(holding['status'])}.</p>")
    if item.get("waluigi"):
        parts.append(f"<blockquote>{esc(item['waluigi'])} — W.</blockquote>")
    tail = f"Waluipedia inventory <code>{esc(item_id)}</code>, held by {esc(holder)}"
    if events:
        tail += " — filed from " + ", ".join(f"<code>{esc(e)}</code>" for e in events)
    parts.append(f"<p><em>{tail}. Mechanics as the table rules them; the archive records custody.</em></p>")
    return "".join(parts)


def item_doc(item_id, item, holding, actor, holder_label, events, filed_on, lib):
    """A dnd5e item document for the registry item, as the grove spoils file shaped them."""
    f = item.get("foundry") or {}
    kind = guess_type(item)
    if kind == "weapon" and not f.get("system"):
        kind = "loot"  # a described weapon beats a half-built one
    name = f.get("name") or item.get("name") or item_id
    ident = re.sub(r"[^a-z0-9_-]+", "-", name.lower().replace("\u2019", "")).strip("-") or item_id.replace("_", "-")
    desc = {"value": description_html(item, item_id, holding, holder_label, events), "chat": ""}
    source = {"custom": f"Waluipedia inventory — {item.get('rarity') or 'on the record'}", "revision": 1, "rules": "2024"}
    qty = int(f.get("quantity") or 1)
    weight = f.get("weight", 1)
    system = {
        "description": desc,
        "source": source,
        "identifier": ident,
        "quantity": qty,
        "weight": {"value": weight, "units": "lb"},
        "price": {"value": 0, "denomination": "gp"},
        "identified": True,
        "unidentified": {"description": ""},
        "container": None,
        "properties": [],
    }
    if kind == "loot":
        system.update({"rarity": "", "type": {"value": f.get("subtype") or "", "subtype": ""}})
    elif kind == "equipment":
        system.update({
            "attunement": "", "attuned": False, "equipped": False, "rarity": "", "cover": None, "crewed": False,
            "uses": {"max": "", "recovery": [], "spent": 0},
            "armor": {"value": None, "dex": None}, "hp": {"value": 0, "max": 0, "dt": None, "conditions": ""},
            "speed": {"value": None, "conditions": "", "units": "ft"}, "strength": None, "proficient": None,
            "type": {"value": f.get("subtype") or "trinket", "baseItem": ""}, "activities": {},
        })
    elif kind == "consumable":
        system.update({
            "attunement": "", "attuned": False, "equipped": False, "rarity": "", "crewed": False,
            "uses": {"max": "", "recovery": [], "spent": 0, "autoDestroy": False},
            "type": {"value": f.get("subtype") or "trinket", "subtype": ""}, "magicalBonus": None, "activities": {},
        })
    elif kind == "tool":
        system.update({
            "attunement": "", "attuned": False, "equipped": False, "rarity": "", "crewed": False,
            "uses": {"max": "", "recovery": [], "spent": 0},
            "type": {"value": f.get("subtype") or "", "baseItem": ""}, "ability": "", "chatFlavor": "",
            "proficient": None, "bonus": "", "activities": {},
        })
    else:  # weapon: only ever with a full foundry.system from the registry
        system.update({"type": {"value": f.get("subtype") or "simpleM", "baseItem": ""}, "activities": {}})
    for key, value in (f.get("system") or {}).items():
        if isinstance(value, dict) and isinstance(system.get(key), dict):
            system[key] = {**system[key], **value}
        else:
            system[key] = value
    return {
        "_id": sid(actor.get("_id") or actor.get("name"), "inventory", item_id),
        "name": name,
        "type": kind,
        "img": guess_icon(item, lib),
        "system": system,
        "effects": [],
        "flags": {"waluipedia": {
            "inventoryItem": item_id,
            "holder": holding["_holder"],
            "event": events[0] if events else None,
            "filedOn": filed_on,
            "note": holding.get("status") or "",
        }},
        "folder": None,
        "ownership": {"default": 0},
    }


# ------------------------------------------------------------------ the pass

def live_sheets(index, world, party_only=True):
    """article id -> sheets.json row, for rows whose live file sits in this world's mirror."""
    out = {}
    prefix = f"actors/worlds/{world}/"
    for row in index.get("sheets") or []:
        if row.get("source") != "live" or not str(row.get("file", "")).startswith(prefix):
            continue
        if party_only and not row.get("party"):
            continue
        out[row["id"]] = row
    return out


def event_ids(item, events):
    return [a for a in item.get("relatedArticles") or [] if a in events]


def generate(world, party_only=True, filed_on=None, now=None, root_rm=RM, inventory_path=INVENTORY,
             sheets_path=SHEETS_JSON, lib=None, previous=None, events=None):
    """Build the changes document. Returns (doc, report) where report = {"added": [...], "present": [...],
    "declined": [...], "skipped": [...], "problems": [...]}."""
    lib = load_library() if lib is None else lib
    now = now or _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    filed_on = filed_on or now[:10]
    reg = read_json(inventory_path)
    index = read_json(sheets_path)
    items = reg.get("items") or {}
    inventories = reg.get("inventories") or {}
    if events is None:
        ev_path = os.path.join(root_rm, "data", "events.json")
        try:
            events = {e.get("id") for e in read_json(ev_path) if isinstance(e, dict)}
        except (OSError, ValueError):
            events = set()
    world_dir = os.path.join(root_rm, "actors", "worlds", world)
    manifest = {}
    mp = os.path.join(world_dir, "manifest.json")
    if os.path.exists(mp):
        try:
            manifest = read_json(mp)
        except (OSError, ValueError):
            manifest = {}
    stamp = manifest.get("exportedAt")
    applied_at = ((manifest.get("lastSync") or {}).get("applied") or {}).get("at") if isinstance(manifest.get("lastSync"), dict) else None
    exported = table_items(world_dir, manifest, root=os.path.dirname(root_rm))
    previous = previous or {}
    filed = dict(previous.get("filed") or {})
    # A generated file may be rebuilt when a new holding is added. Keep each
    # existing sheet item's original filedOn date rather than stamping every
    # still-pending item with today's date again.
    previous_filed_on = {}
    for change in previous.get("changes") or []:
        actor_id = (change.get("match") or {}).get("_id")
        for old_item in change.get("addItems") or []:
            flags = ((old_item.get("flags") or {}).get("waluipedia") or {})
            item_id = flags.get("inventoryItem")
            filed_date = flags.get("filedOn")
            if actor_id and item_id and filed_date:
                previous_filed_on[f"{actor_id}/{item_id}"] = filed_date
    declined = {f"{d.get('actorId')}/{d.get('itemId')}": d for d in previous.get("declined") or [] if isinstance(d, dict)}
    report = {"added": [], "present": [], "declined": [], "skipped": [], "problems": []}
    changes = []
    seen_keys = set()
    sheets = live_sheets(index, world, party_only)
    for holder, holdings in sorted(inventories.items()):
        row = sheets.get(holder)
        if not row:
            continue
        path = os.path.join(root_rm, row["file"])
        if not os.path.exists(path):
            report["problems"].append(f"{holder}: sheets.json points at a missing mirror file {row['file']}")
            continue
        actor = read_json(path)
        holder_names = {row.get("sheetName") or "", row.get("name") or "", actor.get("name") or ""}
        # what the TABLE has: the export's copy of this actor; without one, the mirror minus our own additions
        if exported is not None and actor.get("_id") in exported:
            table = {"items": exported[actor.get("_id")]}
        else:
            table = {"items": [it for it in actor.get("items") or [] if isinstance(it, dict) and not own_addition(it)]}
        add = []
        for holding in holdings or []:
            if not isinstance(holding, dict):
                continue
            item_id = holding.get("itemId")
            item = items.get(item_id)
            if item is None:
                report["problems"].append(f"{holder}: holding {item_id!r} is not in the registry")
                continue
            key = f"{actor.get('_id')}/{item_id}"
            seen_keys.add(key)
            label = f"{actor.get('name')} <- {item.get('name')} ({item_id})"
            if holding.get("known") is False or item.get("visibility") not in (None, "known"):
                report["skipped"].append(f"{label}: not public")
                continue
            if holding.get("foundry") is False or item.get("foundry") is False:
                report["skipped"].append(f"{label}: foundry: false")
                continue
            f = item.get("foundry") or {}
            if f.get("img") and lib and f["img"] not in lib and not str(f["img"]).startswith(("http://", "https://")):
                report["problems"].append(f"{label}: foundry.img {f['img']!r} is not in image paths.txt")
            if f.get("type") and f["type"] not in ITEM_TYPES:
                report["problems"].append(f"{label}: foundry.type {f['type']!r} is not one of {ITEM_TYPES}")
            if f.get("type") == "weapon" and not f.get("system"):
                report["problems"].append(f"{label}: foundry.type weapon needs a full foundry.system — filed as loot until it has one")
            have = sheet_has(table, item_id, name_candidates(item, holder_names))
            if have is not None:
                report["present"].append(f"{label}: on the sheet as {have.get('name')!r}")
                continue
            if key in declined and holding.get("foundry") is not True:
                report["declined"].append(f"{label}: declined at the table ({declined[key].get('at')}) — delete the declined row to re-offer")
                continue
            first = filed.get(key)
            if first and applied_at and str(applied_at) > str(first) and holding.get("foundry") is not True:
                declined[key] = {"itemId": item_id, "holder": holder, "actorId": actor.get("_id"), "sheet": actor.get("name"),
                                 "filed": first, "appliedAt": applied_at, "exportedAt": stamp, "at": now,
                                 "why": "the module applied a packet after this item was filed and the sheet does not carry it"}
                report["declined"].append(f"{label}: dropped at the table after {first} (packet applied {applied_at}) — now declined")
                continue
            filed.setdefault(key, now)
            item_filed_on = previous_filed_on.get(key) or (str(first)[:10] if first else None) or filed_on
            add.append(item_doc(item_id, item, {**holding, "_holder": holder}, actor, row.get("name") or holder,
                                event_ids(item, events), item_filed_on, lib))
            report["added"].append(f"{label}: {add[-1]['type']} / {add[-1]['img']}")
        if add:
            changes.append({"match": {"_id": actor.get("_id"), "name": actor.get("name")}, "addItems": add})
    # forget filings and declines whose holding left the registry
    filed = {k: v for k, v in filed.items() if k in seen_keys}
    declined = {k: v for k, v in declined.items() if k in seen_keys}
    doc = {
        "_README": [
            f"GENERATED by {TOOL} from Reputation-Matrix2/data/inventory.json — re-run the tool, do not edit.",
            "Items the archive's registry says a party character holds and the exported sheet does not carry.",
            "tools/sheets-suite.py regenerates and applies this on every pass; by hand:",
            f"  python3 {TOOL} --world {world}",
            f"  python3 tools/foundry-bridge.py apply Reputation-Matrix2/actors/changes/spoils-{world}.json Reputation-Matrix2/actors/worlds/{world} --write",
            "Items are matched by id (flags.waluipedia.inventoryItem), so re-applying is a no-op.",
            "`filed` remembers when each item first came through; `declined` lists items the table removed after seeing",
            "them (delete a row to offer it again). Nothing here touches XP — tools/promote-player-sheets.py pins that to the ledger.",
        ],
        "generatedBy": TOOL,
        "appliesTo": {"world": world, "exportedAtOrBefore": stamp},
        "scope": "party" if party_only else "all-live",
        "filed": dict(sorted(filed.items())),
        "declined": [declined[k] for k in sorted(declined)],
        "changes": changes,
    }
    return doc, report


def same_apart_from_time(a, b):
    """Two generated documents that differ only in the clock (filed stamps of items first seen now)."""
    def strip(doc):
        d = copy.deepcopy(doc or {})
        d["filed"] = sorted((d.get("filed") or {}).keys())
        for row in d.get("declined") or []:
            row.pop("at", None)
        for ch in d.get("changes") or []:
            for it in ch.get("addItems") or []:
                (it.get("flags") or {}).get("waluipedia", {}).pop("filedOn", None)
        return d
    return strip(a) == strip(b)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--world", default="midlands")
    ap.add_argument("--all", action="store_true", help="every live sheet in the mirror, not just the party")
    ap.add_argument("--check", action="store_true", help="exit 1 when the file on disk is stale or the registry is mis-wired")
    ap.add_argument("--filed-on", default=None, help="date for flags.waluipedia.filedOn (default: today)")
    ap.add_argument("--out", default=None, help="write here instead of actors/changes/spoils-<world>.json")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    say = (lambda *a, **k: None) if args.quiet else print
    world_dir = os.path.join(WORLDS, args.world)
    if not os.path.isdir(world_dir):
        print(f"spoils: no mirror at {os.path.relpath(world_dir, ROOT)} — export the world first")
        return 1
    out_path = args.out or os.path.join(CHANGES_DIR, f"spoils-{args.world}.json")
    previous = None
    if os.path.exists(out_path):
        try:
            previous = read_json(out_path)
        except (OSError, ValueError):
            previous = None
    doc, report = generate(args.world, party_only=not args.all, filed_on=args.filed_on, previous=previous)
    for line in report["problems"]:
        say(f"spoils: PROBLEM {line}")
    for line in report["added"]:
        say(f"spoils: + {line}")
    for line in report["declined"]:
        say(f"spoils: - {line}")
    for line in report["present"]:
        say(f"spoils: = {line}")
    for line in report["skipped"]:
        say(f"spoils: . {line}")
    n_items = sum(len(c["addItems"]) for c in doc["changes"])
    summary = (f"spoils: {n_items} item(s) to add on {len(doc['changes'])} sheet(s), {len(report['present'])} already there, "
               f"{len(doc['declined'])} declined, {len(report['skipped'])} not public" +
               (f", {len(report['problems'])} problem(s)" if report["problems"] else ""))
    if args.check:
        stale = not same_apart_from_time(previous, doc) if (previous is not None or doc["changes"]) else False
        if previous is None and not doc["changes"]:
            stale = False
        if stale:
            print(summary + f" — {os.path.relpath(out_path, ROOT)} is stale: run python3 {TOOL} --world {args.world}")
            return 1
        if report["problems"]:
            print(summary)
            return 1
        print(summary + " — file current")
        return 0
    if not doc["changes"] and not doc["declined"] and not doc["filed"]:
        if os.path.exists(out_path):
            os.remove(out_path)
            say(f"spoils: nothing to add — removed {os.path.relpath(out_path, ROOT)}")
    else:
        if previous is not None and same_apart_from_time(previous, doc):
            doc = previous  # keep the earlier clock
        if write_json(out_path, doc):
            say(f"spoils: wrote {os.path.relpath(out_path, ROOT)}")
        else:
            say(f"spoils: {os.path.relpath(out_path, ROOT)} unchanged")
    print(summary)
    return 1 if report["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())
