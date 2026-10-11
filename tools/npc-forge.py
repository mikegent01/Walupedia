#!/usr/bin/env python3
"""NPC Forge — pick a faction, get a packet: rosters → renders → token plates → Foundry actors.

The Forge is the loop around `tools/build-forge-packets.py`. A roster
(`Reputation-Matrix2/data/forge/<packet>.json`) says who the NPCs are and what
they look like; the Forge renders each one on the local ComfyUI
(Qwen-Image-2.1, text-to-image, the house recipe on a flat magenta field),
cuts the render into a 512-px token plate, drops both into the prepared
folders (`npc-forge/<packet>/renders/`, `portraits/<packet>/`) and rebuilds
the packet's actors — ready to commit, to sync into Foundry, or to hand over.
Without a GPU it still does everything but the drawing: it drafts a roster
for any faction, writes the render jobs as a hand-off brief (prompts, seeds,
sizes, file names) for Claude or any image model, and cuts whatever renders
land in the folder.

    python3 tools/npc-forge.py                         # the page (http://127.0.0.1:8768/)
    python3 tools/npc-forge.py --list                  # rosters and their art state
    python3 tools/npc-forge.py draft <packet> --faction koopa_troop --name "Koopa Troop" --count 8
    python3 tools/npc-forge.py draft <packet> --name "X" --input rows.json   # the suite builds its own roster
    python3 tools/npc-forge.py collect <packet> --from-site [--match TEXT]   # grow it from the website's articles
    python3 tools/npc-forge.py collect <packet> --input rows.json [--tier 1] [--framing fullbody|bust|head]
    python3 tools/npc-forge.py ingest <packet> --dir FOLDER [--watch]  # auto-collect the AI's output, no drag & drop
    python3 tools/npc-forge.py prompt <packet> [ids]   # the recipe any image model asks for
    python3 tools/npc-forge.py run <packet> [--only-missing] [--steps render,cut,build]
    python3 tools/npc-forge.py cut <packet>            # cut the renders in the folder (no Comfy needed)
    python3 tools/npc-forge.py handoff <packet>        # write npc-forge/<packet>/handoff.md + jobs.jsonl

Renders go through ComfyUI (COMFY_URL, else 127.0.0.1 ports 8188, 8000, 8189,
8190); the page can start Comfy Desktop. Pillow + numpy are needed for the cut.
"""

import argparse
import datetime as dt
import importlib.util
import json
from html import unescape
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RM = os.path.join(ROOT, "Reputation-Matrix2")
HTML = os.path.join(HERE, "npc-forge.html")
FACTIONS = os.path.join(RM, "data", "factions.json")
FOLDER_SCHEME = os.path.join(RM, "actors", "folders.json")
PORT = 8768
SLUG = re.compile(r"[^a-z0-9]+")
_LOCAL = os.environ.get("LOCALAPPDATA") or ""
COMFY_DESKTOP_EXE = (os.path.join(_LOCAL, "Programs", "Comfy Desktop", "Comfy Desktop.exe"),
                     os.path.join(_LOCAL, "Programs", "@comfyorgcomfyui-electron", "ComfyUI.exe"),
                     os.path.join(_LOCAL, "Programs", "ComfyUI", "ComfyUI.exe"))
# Where Foundry itself keeps art an actor can point at: the user Data folder
# (systems/dnd5e/tokens/…, modules/…) and the install's public folder (the core
# icons/… library). FOUNDRY_DATA / FOUNDRY_PUBLIC override the Windows defaults.
FOUNDRY_ART_ROOTS = tuple(p for p in (
    os.environ.get("FOUNDRY_DATA") or (os.path.join(_LOCAL, "FoundryVTT", "Data") if _LOCAL else ""),
    os.environ.get("FOUNDRY_PUBLIC") or os.path.join(os.environ.get("ProgramFiles") or r"C:\Program Files",
                                                     "Foundry Virtual Tabletop", "resources", "app", "public"),
) if p)
FOUNDRY_ART_PREFIX = "foundry-art/"      # /file?p=foundry-art/<path> serves from FOUNDRY_ART_ROOTS
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".avif")
# Art the installed Foundry modules ship for creatures and people (House Divided's
# creatures/portraits and tokens-topdown, the 3D miniature compendiums, ...). A
# module image counts as art for an NPC only when it sits under one of these
# folder names - dice, tiles and map pieces share the same modules.
MODULE_ART_DIRS = frozenset(("portraits", "portrait", "tokens", "token", "tokens-topdown", "creatures", "creature",
                             "actors", "actor", "npcs", "npc", "characters", "character", "miniatures", "bestiary"))
MODULE_ART_EXT = (".png", ".jpg", ".jpeg", ".webp", ".avif")

# Draft statblocks by tier — enough to import and fight with while the real
# numbers are written. (abilities, AC, HP, HP formula, attack dice, attacks)
TIERS = {
    "0.5": {"cr": 0.5, "abilities": [12, 12, 12, 8, 10, 8], "ac": 13, "hp": 16, "hp_formula": "3d8+3", "dmg": [1, 6], "attacks": 1},
    "1": {"cr": 1, "abilities": [14, 12, 14, 8, 10, 8], "ac": 13, "hp": 27, "hp_formula": "5d8+5", "dmg": [1, 8], "attacks": 1},
    "2": {"cr": 2, "abilities": [15, 12, 14, 8, 10, 8], "ac": 14, "hp": 39, "hp_formula": "6d8+12", "dmg": [1, 8], "attacks": 2},
    "3": {"cr": 3, "abilities": [16, 12, 15, 8, 10, 8], "ac": 14, "hp": 52, "hp_formula": "8d8+16", "dmg": [1, 10], "attacks": 2},
    "4": {"cr": 4, "abilities": [17, 12, 16, 8, 11, 9], "ac": 15, "hp": 68, "hp_formula": "8d10+24", "dmg": [2, 6], "attacks": 2},
    "5": {"cr": 5, "abilities": [18, 13, 16, 10, 12, 12], "ac": 15, "hp": 90, "hp_formula": "12d8+36", "dmg": [2, 8], "attacks": 2},
    "7": {"cr": 7, "abilities": [19, 14, 18, 12, 13, 14], "ac": 16, "hp": 120, "hp_formula": "16d8+48", "dmg": [2, 10], "attacks": 2},
}
DEFAULT_PLAN = ["0.5", "0.5", "1", "2", "2", "3", "4", "5"]      # eight draft entries: a minion pair up to a lieutenant


def _load_module(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def slugify(text):
    return SLUG.sub("-", str(text).lower()).strip("-") or "npc"


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


class Forge:
    def __init__(self, url=None):
        self.bfp = _load_module("bfp", "tools/build-forge-packets.py")
        self.mtp = _load_module("mtp", "tools/make-token-plates.py")
        self.url = url or None
        self.comfy = None
        self.engine = None
        self.models = dict(self.mtp.QWEN21_MODELS)
        self.choices = {}
        self.lock = threading.Lock()
        self.jobs = {}
        self.current = None
        self.stop_flag = False
        self.batch = None

    # -------------------------------------------------------------- comfy --
    def connect(self, url=None):
        self.url = url or self.url
        comfy = self.mtp.Comfy.discover(self.url)
        if not comfy.alive():
            self.comfy, self.engine = None, None
            return self.connection()
        self.comfy, self.url, self.engine = comfy, comfy.url, comfy.engine()
        if self.engine == "qwen21":
            self.choices = {"unet": comfy.choices("UNETLoader", "unet_name"), "clip": comfy.choices("CLIPLoader", "clip_name"),
                            "vae": comfy.choices("VAELoader", "vae_name")}
            for k, want in self.mtp.QWEN21_MODELS.items():
                have = self.choices.get(k) or []
                if want in have or not have:
                    self.models[k] = want
                elif self.models.get(k) not in have:
                    self.models[k] = have[0]
        return self.connection()

    def connection(self):
        return {"connected": self.comfy is not None, "url": self.url or "", "engine": self.engine,
                "can_render": self.engine == "qwen21", "models": self.models, "choices": self.choices,
                "ports": list(self.mtp.COMFY_PORTS)}

    def start_comfy(self):
        for exe in COMFY_DESKTOP_EXE:
            if exe and os.path.isfile(exe):
                try:
                    subprocess.Popen([exe], close_fds=True)
                    return {"started": True, "exe": exe}
                except OSError as exc:
                    return {"started": False, "error": str(exc)}
        return {"started": False, "error": "Comfy Desktop not found — open it by hand, launch your instance, then Connect"}

    def t2i_workflow(self, width, height, steps=None, cfg=None, resolution=None):
        """The builtin Qwen-Image-2.1 graph as text-to-image at the roster's
        canvas: no LoadImage, the encoder's image slots gone, an
        EmptyLatentImage feeding the sampler (what tools/make-token-plates.py
        does for a character without a reference)."""
        m = self.mtp
        wf = m.workflow_tune(m.BUILTIN_QWEN21, steps=steps, cfg=cfg, resolution=resolution, models=self.models, engine="qwen21",
                             cache=self.comfy.has_node("QwenImage21Cache"))
        wf["456"] = {"class_type": "EmptyLatentImage", "inputs": {"width": int(width), "height": int(height), "batch_size": 1}}
        for k in [k for k, v in wf.items() if v.get("class_type") == "LoadImage"]:
            del wf[k]
        for v in wf.values():
            if v.get("class_type") == "TextEncodeQwenImage21":
                for key in [k for k in v["inputs"] if k.startswith("images.")]:
                    del v["inputs"][key]
            if v.get("class_type") in m.SAMPLERS:
                v["inputs"]["latent_image"] = ["456", 0]
        return wf

    def ref_workflow(self, width, height, steps=None, cfg=None, resolution=None):
        """The builtin Qwen-Image-2.1 graph with reference image (LoadImage wired
        into TextEncodeQwenImage21 images.image_1) for reference-conditioned rendering."""
        m = self.mtp
        wf = m.workflow_tune(m.BUILTIN_QWEN21, steps=steps, cfg=cfg, resolution=resolution, models=self.models, engine="qwen21",
                             cache=self.comfy.has_node("QwenImage21Cache"))
        return wf

    def resolve_base_image_path(self, roster, entry):
        """Find the local filesystem path to the base reference image for an entry."""
        if entry.get("base_image") in ("none", "None", "") or entry.get("no_base_image"):
            return None
        candidates = []
        if entry.get("base_image"):
            candidates.append(entry["base_image"])
        if entry.get("source_img"):
            candidates.append(entry["source_img"])
        if entry.get("site_img"):
            candidates.append(entry["site_img"])

        articles = read_json(os.path.join(self.bfp.RM, "data", "characters.json"), []) or []
        art = None
        eid = entry.get("id") or ""
        for a in articles:
            if not isinstance(a, dict):
                continue
            if entry.get("site") and a.get("id") == entry["site"]:
                art = a
                break
            if a.get("id") in (eid, eid.replace("-", "_")):
                art = a
                break
            if slugify(a.get("name") or "") == slugify(entry.get("name") or ""):
                art = a
                break
        if art:
            if art.get("image"):
                candidates.append(art["image"])
            if art.get("fullBody"):
                candidates.append(art["fullBody"])

        site_id = (art.get("id") if art else entry.get("site")) or ""
        for name in (eid, eid.replace("-", "_"), site_id, site_id.replace("-", "_")):
            if name:
                candidates.extend([
                    f"portraits/{name}.png", f"portraits/{name}.jpg", f"portraits/{name}.webp",
                    f"portraits/player/fullbody/{name}.png",
                    f"Reputation-Matrix2/portraits/{name}.png", f"Reputation-Matrix2/portraits/{name}.jpg",
                ])

        for c in candidates:
            if not c or not isinstance(c, str):
                continue
            c = c.replace("\\", "/").lstrip("/")
            for prefix in (ROOT, self.bfp.RM, os.path.join(self.bfp.RM, "portraits")):
                p = os.path.realpath(os.path.join(prefix, *c.split("/"))) if not os.path.isabs(c) else c
                if os.path.isfile(p):
                    return p
        return None

    def find_existing_fullbody(self, entry, art=None):
        """Check if an established transparent full-body plate exists in portraits/player/fullbody."""
        eid = entry.get("id") or ""
        site_id = (art.get("id") if art else entry.get("site")) or ""
        names = [eid, eid.replace("-", "_")]
        if site_id:
            names.extend([site_id, site_id.replace("-", "_")])
        if art and art.get("name"):
            names.append(slugify(art["name"]))
        fb_dir = os.path.join(self.bfp.RM, "portraits", "player", "fullbody")
        for name in names:
            if not name:
                continue
            p = os.path.join(fb_dir, f"{name}.png")
            if os.path.isfile(p):
                return p
        if art and art.get("fullBody"):
            p = os.path.join(self.bfp.RM, *art["fullBody"].replace("\\", "/").split("/"))
            if os.path.isfile(p):
                return p
        return None

    def use_fullbody(self, packet, entry_id=None, ids=None):
        """Adopt existing full-body sprite plates from portraits/player/fullbody into
        the roster's portraits folder, updating the plate files and building Foundry packet."""
        roster = self.bfp.find_roster(packet)
        target_ids = set()
        if entry_id:
            target_ids.add(entry_id)
        if ids:
            target_ids.update(ids)
        entries = roster.get("entries") or []
        articles = read_json(os.path.join(self.bfp.RM, "data", "characters.json"), []) or []
        articles_by_id = {a.get("id"): a for a in articles if isinstance(a, dict) and a.get("id")}
        adopted = []
        for e in entries:
            if target_ids and e["id"] not in target_ids:
                continue
            art = articles_by_id.get(e.get("site")) or articles_by_id.get(e["id"]) or articles_by_id.get(e["id"].replace("-", "_"))
            if not art:
                slug_name = slugify(e.get("name") or "")
                for a in articles:
                    if isinstance(a, dict) and slugify(a.get("name") or "") == slug_name:
                        art = a
                        break
            fb = self.find_existing_fullbody(e, art)
            if fb and os.path.isfile(fb):
                dst = self.bfp.plate_file(roster, e)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(fb, dst)
                adopted.append({"id": e["id"], "plate": rel(dst), "source": rel(fb)})
        if adopted:
            self.build(roster)
        return {"packet": packet, "adopted": adopted, "count": len(adopted)}

    def upload_base(self, packet, entry_id, data):
        """Save an uploaded image as the character's base reference image."""
        if not data:
            raise RuntimeError("no image data received")
        roster = self.bfp.find_roster(packet)
        target = next((e for e in roster.get("entries", []) if e["id"] == entry_id), None)
        if not target:
            raise KeyError(f"entry {entry_id!r} not found in {packet}")
        refs_dir = os.path.join(self.bfp.RM, "npc-forge", packet, "refs")
        os.makedirs(refs_dir, exist_ok=True)
        ext = ".png"
        if data.startswith(b"\xff\xd8"):
            ext = ".jpg"
        elif data.startswith(b"RIFF") and b"WEBP" in data[:16]:
            ext = ".webp"
        dest = os.path.join(refs_dir, f"{entry_id}-base{ext}")
        with open(dest, "wb") as fh:
            fh.write(data)
        rel_path = rel(dest)
        target["base_image"] = rel_path
        target.pop("no_base_image", None)
        r_path = os.path.join(self.bfp.ROSTERS, packet + ".json")
        write_json(r_path, roster)
        return {"base_image": rel_path, "packet": packet, "id": entry_id}

    def clear_base(self, packet, entry_id):
        """Clear base reference image so the character renders via text-to-image only."""
        roster = self.bfp.find_roster(packet)
        target = next((e for e in roster.get("entries", []) if e["id"] == entry_id), None)
        if not target:
            raise KeyError(f"entry {entry_id!r} not found in {packet}")
        target["base_image"] = "none"
        target["no_base_image"] = True
        r_path = os.path.join(self.bfp.ROSTERS, packet + ".json")
        write_json(r_path, roster)
        return {"base_image": None, "packet": packet, "id": entry_id}

    def reset_base(self, packet, entry_id):
        """Reset base reference image to the character's original source/site image."""
        roster = self.bfp.find_roster(packet)
        target = next((e for e in roster.get("entries", []) if e["id"] == entry_id), None)
        if not target:
            raise KeyError(f"entry {entry_id!r} not found in {packet}")
        target.pop("base_image", None)
        target.pop("no_base_image", None)
        r_path = os.path.join(self.bfp.ROSTERS, packet + ".json")
        write_json(r_path, roster)
        base_src = self.resolve_base_image_path(roster, target)
        return {"base_image": rel(base_src) if base_src else None, "packet": packet, "id": entry_id}

    # ------------------------------------------------------------ rosters --
    def rosters(self):
        out = []
        for path in self.bfp.roster_paths():
            try:
                r = self.bfp.load_roster(path)
            except ValueError as exc:
                out.append({"packet": os.path.basename(path), "error": str(exc)})
                continue
            out.append(self.roster_view(r))
        return out

    def roster_view(self, r):
        actors_dir, _, _ = self.bfp.packet_paths(r)
        prefix = r.get("file_prefix") or f"fvtt-Actor-{r['packet']}-"
        entries = []
        articles = read_json(os.path.join(self.bfp.RM, "data", "characters.json"), []) or []
        articles_by_id = {a.get("id"): a for a in articles if isinstance(a, dict) and a.get("id")}
        for e in r.get("entries") or []:
            render, plate = self.bfp.render_file(r, e), self.bfp.plate_file(r, e)
            source_exists = False
            if e.get("source_actor"):
                try:
                    source_exists = os.path.isfile(self.bfp.source_actor_path(e))
                except (OSError, ValueError):
                    source_exists = False
            source_img = e.get("source_img")
            if source_img and not os.path.isfile(os.path.join(ROOT, *source_img.split("/"))):
                source_img = None
            site_id = e.get("site")
            art = articles_by_id.get(site_id) if site_id else None
            if not art:
                art = articles_by_id.get(e["id"])
            if not art:
                art = articles_by_id.get(e["id"].replace("-", "_"))
            if not art:
                slug_name = slugify(e.get("name") or "")
                for a in articles:
                    if isinstance(a, dict) and slugify(a.get("name") or "") == slug_name:
                        art = a
                        break
            if art and not site_id:
                site_id = art.get("id")
            site_img = self._foundry_image(art.get("image") or art.get("fullBody")) if art else None

            # Resolve base image and existing fullbody plate
            base_src = self.resolve_base_image_path(r, e)
            base_img_rel = rel(base_src) if base_src else None
            existing_fb = self.find_existing_fullbody(e, art)
            existing_fb_rel = rel(existing_fb) if existing_fb else None

            framing = e.get("framing") or r.get("framing") or "fullbody"
            framing_preset = "fullbody" if "fullbody" in str(framing).lower() or framing == self.bfp.FRAMINGS.get("fullbody") else (
                "bust" if "bust" in str(framing).lower() or framing == self.bfp.FRAMINGS.get("bust") else (
                    "head" if "head" in str(framing).lower() or framing == self.bfp.FRAMINGS.get("head") else "custom"
                )
            )
            entries.append({
                "id": e["id"], "name": e["name"], "folder": e.get("folder"), "tier": e.get("tier"), "role": e.get("role"),
                "cr": e.get("cr"), "type": e.get("type"), "size": e.get("size"), "seed": e.get("seed"), "look": e.get("look") or "",
                "framing": framing, "framing_preset": framing_preset, "site": site_id,
                "prompt": self.bfp.prompt_for(r, e, with_reference=bool(base_img_rel)),
                "prompt_t2i": self.bfp.prompt_for(r, e, with_reference=False),
                "token_size": e.get("token_size") or 1,
                "render": rel(render) if os.path.exists(render) else None,
                "plate": rel(plate) if os.path.exists(plate) else None,
                "source_img": source_img, "source_has_img": bool(e.get("source_has_img") or site_img),
                "site_img": site_img,
                "base_img": base_img_rel, "has_base_img": bool(base_img_rel),
                "base_image_name": os.path.basename(base_src) if base_src else None,
                "existing_fullbody": existing_fb_rel,
                "foundry_art": self._entry_foundry_art(e),
                "replaced": bool(e.get("replaced")), "replaced_at": e.get("replaced_at"),
                "actor": os.path.exists(os.path.join(actors_dir, f"{prefix}{e['id']}.json")) or source_exists,
            })
        style_preset = r.get("style_preset") or self.bfp.detect_style_preset(r.get("style")) or self.bfp.style_preset_for(r.get("group") or r.get("faction") or "") or "custom"
        return {"packet": r["packet"], "name": r.get("name"), "title": r.get("title"), "faction": r.get("faction"), "group": r.get("group"),
                "foundry_source": r.get("foundry_source"),
                "color": r.get("color"), "subfolders": r.get("subfolders") or {}, "render_size": r.get("render_size") or [1408, 768],
                "plate_size": r.get("plate_size") or 512, "style": r.get("style"), "style_preset": style_preset,
                "style_presets": self.bfp.STYLE_PRESETS,
                "framing": r.get("framing"), "negative": r.get("negative"),
                "path": rel(os.path.join(self.bfp.ROSTERS, r["packet"] + ".json")),
                "renders_dir": rel(self.bfp.packet_paths(r)[2]), "portraits_dir": rel(self.bfp.packet_paths(r)[1]), "actors_dir": rel(actors_dir),
                "entries": entries,
                "counts": {"entries": len(entries), "rendered": sum(1 for e in entries if e["render"]),
                           "plates": sum(1 for e in entries if e["plate"]), "actors": sum(1 for e in entries if e["actor"]),
                           "replaced": sum(1 for e in entries if e["replaced"]),
                           "with_base": sum(1 for e in entries if e["has_base_img"])}}

    def factions(self):
        scheme = read_json(FOLDER_SCHEME, {}) or {}
        groups = scheme.get("groups") or {}
        by_faction = {v.get("faction"): g for g, v in groups.items() if isinstance(v, dict) and v.get("faction")}
        out = []
        for f in read_json(FACTIONS, []) or []:
            if not isinstance(f, dict) or not f.get("id"):
                continue
            group = by_faction.get(f["id"])
            if not group:
                words = {w for w in re.split(r"\W+", f.get("name", "").lower()) if len(w) > 3}
                for g in groups:
                    if words & {w for w in re.split(r"\W+", g.lower()) if len(w) > 3}:
                        group = g
                        break
            out.append({"id": f["id"], "name": f.get("name"), "type": f.get("type"), "status": f.get("status"), "leader": f.get("leader"),
                        "summary": f.get("summary"), "group": group, "color": (groups.get(group) or {}).get("color") if group else None})
        return {"factions": sorted(out, key=lambda x: x["name"] or ""), "groups": {g: v.get("color") for g, v in groups.items() if isinstance(v, dict)},
                "rosters": [os.path.splitext(os.path.basename(p))[0] for p in self.bfp.roster_paths()]}

    def _foundry_world(self, world=None):
        scheme = self.bfp.P955.load_folder_scheme()
        name = str(world or (scheme.get("players") or {}).get("world") or "midlands").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
            raise RuntimeError(f"invalid Foundry world name: {name!r}")
        return name, scheme

    def _foundry_actor_rows(self, group=None, world=None):
        """NPC documents in the live Foundry world mirror, grouped by their
        explicit folderPath flag (falling back to the mirrored directories)."""
        world, scheme = self._foundry_world(world)
        world_dir = os.path.join(self.bfp.ACTORS_ROOT, "worlds", world)
        if not os.path.isdir(world_dir):
            return world, scheme, []
        player_folder = (scheme.get("players") or {}).get("folder") or "Players"
        rows, seen = [], set()
        for base, dirs, files in os.walk(world_dir):
            dirs.sort(key=str.casefold)
            for filename in sorted(files, key=str.casefold):
                if not filename.lower().endswith(".json"):
                    continue
                path = os.path.join(base, filename)
                doc = read_json(path)
                if not isinstance(doc, dict) or doc.get("type") != "npc":
                    continue
                actor_id = str(doc.get("_id") or "")
                if not self.bfp.FOUNDRY_ID.match(actor_id) or actor_id in seen:
                    continue
                flag = ((doc.get("flags") or {}).get(self.bfp.MODULE_ID) or {}).get("folderPath")
                rel_parts = os.path.relpath(path, world_dir).split(os.sep)[:-1]
                folder_path = [str(part) for part in flag] if isinstance(flag, list) and flag else rel_parts
                if not folder_path or folder_path[0] == player_folder:
                    continue
                if group is not None and folder_path[0] != group:
                    continue
                seen.add(actor_id)
                rows.append({"doc": doc, "path": path, "folder_path": folder_path,
                             "relative_path": os.path.relpath(path, self.bfp.ACTORS_ROOT).replace(os.sep, "/")})
        rows.sort(key=lambda row: (row["folder_path"][0].casefold(), "/".join(row["folder_path"]).casefold(),
                                   str(row["doc"].get("name") or "").casefold(), row["doc"].get("_id") or ""))
        return world, scheme, rows

    def foundry_groups(self, world=None):
        """Groups and NPC counts discovered in actors/worlds/<live world>.
        This is read-only; the UI imports a group only after an explicit click."""
        world, _scheme, rows = self._foundry_actor_rows(world=world)
        groups = {}
        for row in rows:
            name = row["folder_path"][0]
            info = groups.setdefault(name, {"name": name, "count": 0, "folders": set()})
            info["count"] += 1
            info["folders"].add(" / ".join(row["folder_path"][1:]) or "(group root)")
        return {"world": world, "path": rel(os.path.join(self.bfp.ACTORS_ROOT, "worlds", world)),
                "groups": [{"name": name, "count": info["count"], "folders": sorted(info["folders"], key=str.casefold),
                            "packet": "foundry-" + slugify(name)}
                           for name, info in sorted(groups.items(), key=lambda item: item[0].casefold())]}

    def _foundry_image(self, image):
        """Return a repo-relative image path when a Foundry image is in this
        checkout; Foundry's built-in and external paths stay untouched."""
        if not isinstance(image, str) or not image or image.startswith(("http://", "https://", "data:")):
            return None
        image = image.replace("\\", "/").lstrip("/")
        rm_root = os.path.realpath(self.bfp.RM)
        if image.startswith("Reputation-Matrix2/"):
            candidate = os.path.join(os.path.dirname(rm_root), *image.split("/"))
        else:
            candidate = os.path.join(rm_root, *image.split("/"))
        candidate = os.path.realpath(candidate)
        try:
            if os.path.commonpath((rm_root, candidate)) != rm_root or not os.path.isfile(candidate):
                return None
        except ValueError:
            return None
        return os.path.relpath(candidate, ROOT).replace(os.sep, "/")

    def foundry_art_path(self, image):
        """Absolute path of an image that ships with Foundry (its Data folder or
        the install's core icons), or None. The mystery-man placeholder is not art."""
        if not isinstance(image, str) or not image or image.startswith(("http://", "https://", "data:")):
            return None
        image = urllib.parse.unquote(image.split("?", 1)[0]).replace("\\", "/").lstrip("/")
        if image == self.bfp.PENDING_IMG or "*" in image or not image.lower().endswith(IMAGE_EXT):
            return None
        if os.path.basename(image).lower().startswith("blank"):      # importer placeholders (blank-2024.webp)
            return None
        for root in FOUNDRY_ART_ROOTS:
            root = os.path.realpath(root)
            candidate = os.path.realpath(os.path.join(root, *image.split("/")))
            try:
                if os.path.commonpath((root, candidate)) == root and os.path.isfile(candidate):
                    return candidate
            except ValueError:
                continue
        return None

    def _foundry_art(self, doc):
        """`foundry-art/<path>` for an actor whose portrait or token already is
        Foundry-installed art - it needs no generated sprite. Art that lives in
        this checkout (portraits/… mirrored into the Data folder) is the Forge's
        own and keeps going through the sprite stages."""
        if not isinstance(doc, dict):
            return None
        texture = (doc.get("prototypeToken") or {}).get("texture") or {}
        for image in (doc.get("img"), texture.get("src")):
            if self.foundry_art_path(image) and not self._foundry_image(image):
                return FOUNDRY_ART_PREFIX + urllib.parse.unquote(image.split("?", 1)[0]).replace("\\", "/").lstrip("/")
        return None

    # -------------------------------------------------- module art index --
    def module_art_index(self):
        """slug -> [path under the Foundry Data folder] for every creature / portrait / token image the
        installed modules ship (see MODULE_ART_DIRS). Built once per process; reads nothing else."""
        idx = self.__dict__.get("_module_art")
        if idx is not None:
            return idx
        idx = {}
        for root in FOUNDRY_ART_ROOTS[:1]:              # the user Data folder: that is where modules/ lives
            mods = os.path.join(root, "modules")
            if not os.path.isdir(mods):
                continue
            for base, _dirs, files in os.walk(mods):
                rel_dir = os.path.relpath(base, mods).replace(os.sep, "/").lower().split("/")
                if not MODULE_ART_DIRS.intersection(rel_dir[1:]):
                    continue
                for fn in files:
                    if not fn.lower().endswith(MODULE_ART_EXT):
                        continue
                    path = "modules/" + os.path.relpath(os.path.join(base, fn), mods).replace(os.sep, "/")
                    idx.setdefault(slugify(os.path.splitext(fn)[0]), []).append(path)
        for paths in idx.values():
            paths.sort(key=lambda q: ("portrait" not in q.lower(), len(q), q))
        self._module_art = idx
        return idx

    def _module_art_exact(self, name):
        """`foundry-art/<path>` when an installed module ships an image named exactly like this NPC."""
        if not name:
            return None
        base = re.sub(r"\([^)]*\)", "", str(name)).strip()
        for cand in (str(name), base):
            hit = self.module_art_index().get(slugify(cand))
            if hit:
                return FOUNDRY_ART_PREFIX + hit[0]
        return None

    def module_art_candidates(self, name, limit=3):
        """Looser module-art matches for review only (never counted as art): a file whose name starts or
        ends with this NPC's name, e.g. `kryn` -> `kryn-corvinarus`."""
        slug = slugify(re.sub(r"\([^)]*\)", "", str(name or "")).strip())
        if len(slug) < 4 or slug == "npc":
            return []
        out = []
        for stem, paths in self.module_art_index().items():
            if stem != slug and (stem.startswith(slug + "-") or stem.endswith("-" + slug)):
                out.append(paths[0])
        return sorted(out)[:limit]

    def _entry_foundry_art(self, entry):
        """Foundry-installed art for a roster entry: its source actor's own, else an installed module's
        image named like the NPC (House Divided's portraits and tokens, the 3D miniatures)."""
        return self._entry_actor_art(entry) or self._module_art_exact(entry.get("name"))

    def _entry_actor_art(self, entry):
        """_foundry_art for a roster entry, read from its source actor (cached by mtime)."""
        if not entry.get("source_actor"):
            return None
        try:
            path = self.bfp.source_actor_path(entry)
            mtime = os.path.getmtime(path)
        except (OSError, ValueError):
            return None
        cache = self.__dict__.setdefault("_art_cache", {})
        hit = cache.get(path)
        if not hit or hit[0] != mtime:
            hit = cache[path] = (mtime, self._foundry_art(read_json(path)))
        return hit[1]

    def _claimed(self):
        """(actor ids, name slugs) already carried by some roster entry - the Foundry NPCs the
        Forge has already imported, however the roster was made."""
        ids, names = set(), set()
        for path in self.bfp.roster_paths():
            try:
                r = self.bfp.load_roster(path)
            except ValueError:
                continue
            for e in r.get("entries") or []:
                if e.get("source_actor_id"):
                    ids.add(e["source_actor_id"])
                names.add(slugify(e.get("id") or ""))
                names.add(slugify(e.get("name") or ""))
        return ids, names

    def import_foundry(self, group, packet=None, world=None, only_unclaimed=False):
        """Create an art-only Forge roster from existing NPCs in one Foundry
        folder. The source actors are references in the world mirror; a later
        Build carries their original sheets forward and changes only art."""
        if not group:
            raise RuntimeError("choose a Foundry group folder")
        world, scheme, rows = self._foundry_actor_rows(group=group, world=world)
        if only_unclaimed:
            ids, names = self._claimed()
            rows = [x for x in rows if str(x["doc"].get("_id")) not in ids and slugify(str(x["doc"].get("name") or "")) not in names]
        if not rows:
            raise KeyError(f"no NPC actors found in {group!r} under actors/worlds/{world}")
        packet = slugify(packet or ("foundry-" + slugify(group)))
        roster_path = os.path.join(self.bfp.ROSTERS, packet + ".json")
        if os.path.exists(roster_path):
            raise RuntimeError(f"data/forge/{packet}.json exists — choose another packet id")
        style_key = self.bfp.style_preset_for(group)
        default_style = self.bfp.STYLE_PRESETS.get(style_key, self.bfp.STYLE_PRESETS["gritty"])

        articles = read_json(os.path.join(self.bfp.RM, "data", "characters.json"), []) or []
        articles_by_id = {a.get("id"): a for a in articles if isinstance(a, dict) and a.get("id")}
        group_info = (scheme.get("groups") or {}).get(group) or {}
        color = group_info.get("color") or "#888888"
        faction = group_info.get("faction")
        folder_styles = {}
        for spec in (scheme.get("packets") or {}).values():
            if isinstance(spec, dict) and spec.get("folder") == group:
                folder_styles.update(spec.get("subfolders") or {})
        for spec in (scheme.get("eras") or {}).values():
            if isinstance(spec, dict) and spec.get("folder"):
                folder_styles.setdefault(spec["folder"], spec)

        entries, subfolders, used = [], {}, set()
        for index, row in enumerate(rows, 1):
            doc = row["doc"]
            foundry_id = str(doc.get("_id") or "")
            name = str(doc.get("name") or foundry_id)
            eid = slugify(name)
            if eid in used:
                eid = f"{eid}-{slugify(foundry_id[-6:])}"
            suffix = 2
            base_id = eid
            while eid in used:
                eid = f"{base_id}-{suffix}"
                suffix += 1
            used.add(eid)
            folder_parts = row["folder_path"][1:]
            folder = " / ".join(folder_parts) if folder_parts else "General"
            style = folder_styles.get(folder) or {}
            subfolders.setdefault(folder, {
                "color": style.get("color") or color,
                "description": style.get("description") or f"Existing Foundry folder under {group}.",
            })
            sysdoc = doc.get("system") or {}
            details = sysdoc.get("details") or {}
            actor_type = details.get("type") or {}
            if isinstance(actor_type, dict):
                actor_type = actor_type.get("value") or actor_type.get("custom") or "npc"
            traits = sysdoc.get("traits") or {}
            sheet_flags = ((doc.get("flags") or {}).get(self.bfp.SHEETS_FLAG) or {})
            site_id = sheet_flags.get("characterId")
            article = articles_by_id.get(site_id)
            if article:
                look = " ".join(str(article[k]) for k in ("summary", "description") if article.get(k))[:600].strip()
            else:
                biography = details.get("biography") or {}
                biography = biography.get("value", "") if isinstance(biography, dict) else biography
                look = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", str(biography or "")))).strip()[:600]
            if not look:
                subtype = (actor_type if isinstance(actor_type, str) else "npc")
                detail_type = details.get("type") or {}
                subtype = detail_type.get("subtype") if isinstance(detail_type, dict) else ""
                look = f"{name}, a {subtype or actor_type or 'fantasy'} creature in {group}."
            width = (doc.get("prototypeToken") or {}).get("width") or 1
            height = (doc.get("prototypeToken") or {}).get("height") or 1
            source_img = self._foundry_image(doc.get("img"))
            entry = {
                "id": eid, "name": name, "folder": folder, "tier": sheet_flags.get("role") or "Foundry NPC",
                "role": sheet_flags.get("role") or "Existing Foundry NPC", "cr": details.get("cr") or 0,
                "type": actor_type, "size": traits.get("size") or "med", "token_size": max(int(width), int(height)),
                "look": look, "seed": 600000 + index,
                "source_actor": row["relative_path"], "source_actor_id": foundry_id,
                "source_folder_path": list(row["folder_path"]),
                "source_img": source_img,
                "base_image": source_img,
                "source_has_img": bool(doc.get("img") and doc.get("img") != self.bfp.PENDING_IMG),
            }
            if site_id:
                entry["site"] = site_id
            entries.append(entry)

        roster = {
            "format": self.bfp.FORMAT, "packet": packet, "name": group,
            "title": f"{group} — existing NPCs from Foundry world {world}", "faction": faction,
            "group": group, "color": color, "disposition": -1,
            "file_prefix": f"fvtt-Actor-{packet}-", "portraits": f"portraits/{packet}",
            "renders": f"npc-forge/{packet}/renders",
            "source": f"Foundry world mirror: actors/worlds/{world}/{group}",
            "foundry_source": {"world": world, "group": group},
            "style_preset": style_key,
            "style": default_style,
            "framing": self.bfp.FRAMINGS["fullbody"],
            "negative": "photorealistic, 3d render, blurry, cropped, cut off, multiple characters, text, watermark, signature, border, frame, ground shadow, floor, background scenery, gradient background",
            "background": "#FF00FF", "render_size": [1408, 768], "plate_size": 512,
            "subfolders": subfolders, "entries": entries,
        }
        write_json(roster_path, roster)
        self.ensure_scheme(roster)
        return self.roster_view(roster)

    def _tier_entry(self, eid, name, folder, tier, look, seed, faction=None, roster_name=None, framing=None):
        """A draft statblock at `tier` with the given look — the shape both `draft`
        (templated plan) and `collect` (website articles, input rows) file."""
        t = TIERS.get(str(tier)) or TIERS["1"]
        officer = t["cr"] >= 5
        dmg_n, dmg_d = t["dmg"]
        entry = {
            "id": eid, "name": name, "folder": folder, "tier": "officer" if officer else str(tier), "role": "draft — write me",
            "type": "humanoid", "subtype": "", "size": "med", "alignment": "Unaligned", "cr": t["cr"],
            "abilities": list(t["abilities"]), "saves": [], "skills": {}, "ac": t["ac"], "ac_words": "draft", "hp": t["hp"], "hp_formula": t["hp_formula"],
            "speed": {"walk": 30}, "senses": {}, "languages": {"value": ["common"], "custom": ""}, "di": [], "dr": [], "dv": [], "ci": [],
            "traits": [], "attacks": [{"name": "Weapon", "icon": "strike", "kind": "melee", "ability": "str", "wtype": "natural", "reach": 5,
                                        "dmg": [dmg_n, dmg_d, "slashing"], "extra": [], "props": [],
                                        "text": f"<p><em>Melee Weapon Attack:</em> reach 5 ft., one target. <em>Hit:</em> {dmg_n}d{dmg_d} + {max(0, (t['abilities'][0] - 10) // 2)} slashing damage.</p>"}],
            "actions": [],
            "multiattack": f"The creature makes {t['attacks']} attacks." if t["attacks"] > 1 else None,
            "look": look,
            "seed": seed, "plate": eid, "token_size": 1,
            "bio": [f"<p><strong>Draft.</strong> Drafted by the NPC Forge for {roster_name or name}" + (f" (faction <code>{faction}</code>)" if faction else "") +
                    "; the numbers are the tier template until someone writes the real statblock, the look is a placeholder until the render says otherwise.</p>"],
            "tags": [slugify(roster_name or name), "draft"],
        }
        if framing:
            entry["framing"] = framing
        return entry

    # ---------------------------------------------------- roster inputs --
    def site_candidates(self, match=None):
        """Website articles the roster can collect: they have prose to render and
        no forge roster claims them yet (by id or by `site`)."""
        arts = read_json(os.path.join(self.bfp.RM, "data", "characters.json"), []) or []
        taken = set()
        for r in self.rosters():
            for e in r.get("entries") or []:
                taken.add(e.get("id"))
                taken.add(e.get("site"))
        out = []
        for a in arts:
            aid = a.get("id") or ""
            if not aid or aid in taken:
                continue
            where = f"{a.get('affiliation') or ''} {a.get('title') or ''}".lower()
            if match and match.lower() not in where:
                continue
            look = " ".join(str(a[k]) for k in ("summary", "description") if a.get(k))[:600].strip()
            if not look:
                continue
            out.append({"site": aid, "name": a.get("name") or aid, "affiliation": a.get("affiliation") or "",
                        "status": a.get("status") or "", "look": look,
                        "image": self._foundry_image(a.get("image")),
                        "fullBody": self._foundry_image(a.get("fullBody"))})
        return out

    def collect(self, packet, rows, tier="1", folder=None, framing=None):
        """Grow an existing roster from input rows — website candidates
        (`{"site": id, "name":…, "look":…}`) or hand-written ones. Ids are
        slugified; rows already in the roster are skipped, never duplicated."""
        path = os.path.join(self.bfp.ROSTERS, packet + ".json")
        r = self.bfp.load_roster(path)
        entries = r.setdefault("entries", [])
        have = {e["id"] for e in entries} | {e.get("site") for e in entries}
        subs = list((r.get("subfolders") or {}) or [None])
        added = []
        for i, row in enumerate(rows, 1):
            eid = slugify(row.get("id") or row.get("site") or row.get("name") or "")
            if not eid or eid in have:
                continue
            have.add(eid)
            e = self._tier_entry(eid, row.get("name") or eid.replace("-", " ").title(),
                                 row.get("folder") or folder or subs[0], row.get("tier") or tier,
                                 row.get("look") or "", int(row.get("seed") or 520000 + i),
                                 faction=r.get("faction"), roster_name=r.get("name"),
                                 framing=row.get("framing") or framing)
            if row.get("site"):
                e["site"] = row["site"]
                e["bio"] = [f"<p>Collected from the website article <code>{row['site']}</code> by the NPC Forge; the look is the article's own prose.</p>"]
                e["role"] = f"site article — {row.get('status') or 'written'}"
            src_img = row.get("source_img") or row.get("image") or row.get("fullBody")
            if src_img:
                e["source_img"] = src_img
                e["source_has_img"] = True
            entries.append(e)
            added.append(eid)
        if added:
            write_json(path, r)
        return {"packet": packet, "added": added, "entries": len(entries)}

    def ingest(self, directory, packet=None, cut=True):
        """Auto-collect renders that landed in a folder — Comfy's output, the
        Downloads folder, anywhere an image model wrote files — instead of
        dragging them onto the page. Files match pending jobs by entry id
        (`<id>.png`, `<id>-<seed>.png`, `<name-slug>-*`) or by the exact render
        file name; the newest match wins and is cut straight away."""
        if not directory or not os.path.isdir(directory):
            raise FileNotFoundError(f"no such folder: {directory}")
        got = []
        for r in self.rosters():
            if r.get("error") or (packet and r["packet"] != packet):
                continue
            roster = self.bfp.find_roster(r["packet"])
            for e in roster["entries"]:
                dst = self.bfp.render_file(roster, e)
                if os.path.exists(dst):
                    continue
                slug = slugify(e["name"])
                cands = []
                for f in os.listdir(directory):
                    if not f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                        continue
                    stem = re.sub(r"\.(png|jpe?g|webp)$", "", f, flags=re.I)
                    if f == os.path.basename(dst) or stem == e["id"] or stem.startswith(e["id"] + "-") or (slug and stem.startswith(slug + "-")):
                        cands.append(os.path.join(directory, f))
                if not cands:
                    continue
                src = max(cands, key=os.path.getmtime)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(src, dst)
                item = {"packet": r["packet"], "id": e["id"], "render": rel(dst), "from": rel(src)}
                if cut:
                    facts = self.cut_one(roster, e)
                    item.update({"plate": rel(self.bfp.plate_file(roster, e)), "border_clear": facts.get("border_clear")})
                got.append(item)
        return got

    def draft(self, packet, name, faction=None, group=None, color=None, plan=None, subfolders=None, style=None, title=None, rows=None, framing=None):
        """A new roster with templated entries for a faction — a packet that
        imports today and gets its real numbers, names and looks written in
        the roster afterwards."""
        packet = slugify(packet)
        path = os.path.join(self.bfp.ROSTERS, packet + ".json")
        if os.path.exists(path):
            raise RuntimeError(f"data/forge/{packet}.json exists — edit it, or pick another packet id")
        facts = self.factions()
        f = next((x for x in facts["factions"] if x["id"] == faction), None) if faction else None
        group = group or (f or {}).get("group") or name
        color = color or (f or {}).get("color") or "#888888"
        subs = subfolders or {"Rank and File": {"color": color, "description": f"The {name} as the party meets them — drafted by the NPC Forge."},
                              "Officers": {"color": color, "description": f"Those who give the orders in the {name}."}}
        sub_names = list(subs)
        summary = (f or {}).get("summary") or ""
        tier_default = "1"
        entries = []
        if rows:
            # the suite's own input: names, looks, tiers, folders, framing — from a
            # file, from the website collector, from the page
            for i, row in enumerate(rows, 1):
                eid = slugify(row.get("id") or row.get("site") or row.get("name") or f"{packet}-{i}")
                officer = (TIERS.get(str(row.get("tier") or tier_default)) or TIERS["1"])["cr"] >= 5
                folder = row.get("folder") or (sub_names[-1] if officer and len(sub_names) > 1 else sub_names[0])
                e = self._tier_entry(eid, row.get("name") or eid.replace("-", " ").title(), folder,
                                     row.get("tier") or tier_default, row.get("look") or "",
                                     int(row.get("seed") or 520000 + i), faction=faction, roster_name=name,
                                     framing=row.get("framing") or framing)
                if row.get("site"):
                    e["site"] = row["site"]
                    e["bio"] = [f"<p>Collected from the website article <code>{row['site']}</code> by the NPC Forge; the look is the article's own prose.</p>"]
                entries.append(e)
        for i, tier in enumerate(plan if not rows else [], 1):
            t = TIERS.get(tier) or TIERS["1"]
            officer = t["cr"] >= 5
            folder = sub_names[-1] if officer and len(sub_names) > 1 else sub_names[0]
            eid = f"draft-{i:02d}"
            look = f"A member of {name}: {summary[:160]}".strip() if summary else f"A member of {name}, in the faction's colours and gear."
            entries.append(self._tier_entry(eid, f"{name} draft {i}", folder, tier, look, 500000 + i,
                                            faction=faction, roster_name=name, framing=framing))
        style_preset = self.bfp.style_preset_for(group or faction or name)
        default_style = self.bfp.STYLE_PRESETS.get(style_preset, self.bfp.STYLE_PRESETS["gritty"])
        roster = {
            "format": self.bfp.FORMAT, "packet": packet, "name": name, "title": title or f"{name} — drafted by the NPC Forge",
            "faction": faction, "group": group, "color": color, "disposition": -1, "file_prefix": f"fvtt-Actor-{packet}-",
            "portraits": f"portraits/{packet}", "renders": f"npc-forge/{packet}/renders",
            "source": f"data/factions.json → {faction}" if faction else "drafted by hand",
            "style_preset": style_preset,
            "style": style or default_style,
            "framing": "Full body, whole figure visible, three-quarter view, centred, isolated on a plain flat solid magenta background (#FF00FF), no floor, no ground shadow, no text, no border.",
            "negative": "photorealistic, 3d render, blurry, cropped, cut off, multiple characters, text, watermark, signature, border, frame, ground shadow, floor, background scenery, gradient background",
            "background": "#FF00FF", "render_size": [1408, 768], "plate_size": 512,
            "subfolders": subs, "entries": entries,
        }
        write_json(path, roster)
        self.ensure_scheme(roster)
        return self.roster_view(roster)

    def ensure_scheme(self, roster):
        """actors/folders.json `packets.<packet>` with the roster's folders and
        colours — the builder refuses a packet the scheme does not file."""
        scheme = read_json(FOLDER_SCHEME, {}) or {}
        packets = scheme.setdefault("packets", {})
        entry = packets.get(roster["packet"]) or {}
        want = {"folder": roster["group"],
                "description": entry.get("description") or f"{roster['name']} (actors/{roster['packet']}, built by tools/build-forge-packets.py from the NPC Forge roster data/forge/{roster['packet']}.json).",
                "subfolders": {k: {"color": v.get("color"), "description": v.get("description", "")} for k, v in (roster.get("subfolders") or {}).items()}}
        if entry == want:
            return False
        packets[roster["packet"]] = want
        groups = scheme.setdefault("groups", {})
        bestiary_folder = (scheme.get("bestiary") or {}).get("folder")
        if roster["group"] not in groups and roster["group"] != bestiary_folder:
            groups[roster["group"]] = {"color": roster.get("color") or "#888888", "faction": roster.get("faction")}
        write_json(FOLDER_SCHEME, scheme)
        return True

    def save_entry(self, packet, entry_id, fields):
        """Edit the roster's own words for one entry (name, folder, tier,
        role, cr, type, size, look, seed, token_size …) — the Forge's page
        edits looks and names; the statblock stays a JSON edit."""
        r = self.bfp.find_roster(packet)
        path = os.path.join(self.bfp.ROSTERS, packet + ".json")
        for e in r["entries"]:
            if e["id"] == entry_id:
                for k, v in fields.items():
                    if k in ("id", "attacks", "actions", "traits", "bio"):
                        continue
                    if k == "folder" and v not in (r.get("subfolders") or {}):
                        raise RuntimeError(f"folder {v!r} is not one of the roster's sub-folders")
                    if k == "framing":
                        v = self.bfp.FRAMINGS.get(v, v)
                    if k == "base_image" and v in ("none", "None", ""):
                        e["base_image"] = "none"
                        e["no_base_image"] = True
                        continue
                    if k == "base_image" and v == "reset":
                        e.pop("base_image", None)
                        e.pop("no_base_image", None)
                        continue
                    e[k] = v
                write_json(path, r)
                return self.roster_view(r)
        raise KeyError(entry_id)

    def save_roster_fields(self, packet, fields):
        r = self.bfp.find_roster(packet)
        for k in ("style", "style_preset", "framing", "negative", "render_size", "plate_size", "name", "title", "color"):
            if k in fields:
                r[k] = fields[k]
        write_json(os.path.join(self.bfp.ROSTERS, packet + ".json"), r)
        return self.roster_view(r)

    # ---------------------------------------------------------------- jobs --
    def _log(self, job, line):
        with self.lock:
            job["log"].append(f"{dt.datetime.now().strftime('%H:%M:%S')}  {line}")

    def _new_job(self, kind, packet):
        with self.lock:
            if self.current and self.current.get("alive"):
                raise RuntimeError("a job is running — stop it or wait")
            jid = f"{kind}-{int(time.time() * 1000)}"
            job = {"id": jid, "kind": kind, "packet": packet, "alive": True, "ok": None, "log": [], "done": 0, "total": 0, "started": time.time()}
            self.jobs[jid] = job
            self.current = job
            self.stop_flag = False
        return job

    def job(self, jid=None):
        job = self.jobs.get(jid) if jid else self.current
        return job

    def stop(self):
        self.stop_flag = True
        return {"stopping": True}

    def render_one(self, roster, entry, job, steps=None, cfg=None, resolution=None, seed=None, retries=1):
        """Queue → wait → download → cut → QC; a failed QC re-rolls the seed
        (`retries` times) and keeps the rejects beside the render."""
        rdir = self.bfp.packet_paths(roster)[2]
        os.makedirs(rdir, exist_ok=True)
        w, h = roster.get("render_size") or [1408, 768]
        base_src = self.resolve_base_image_path(roster, entry)
        negative = entry.get("negative") or roster.get("negative") or self.mtp.NEGATIVE
        seed = int(seed if seed is not None else (entry.get("seed") or 1))
        dst = self.bfp.render_file(roster, entry)

        if base_src and os.path.isfile(base_src):
            self._log(job, f"{entry['id']}: using base reference image {rel(base_src)}")
            ref_png = os.path.join(rdir, f"{entry['id']}.ref.png")
            try:
                self.mtp.prep_reference(base_src, ref_png, "magenta", full_body=False, size=(w, h), plan="biped")
            except Exception as exc:
                self._log(job, f"{entry['id']}: prep_reference fallback ({exc})")
                shutil.copyfile(base_src, ref_png)
            upload_name = f"npc-forge-{roster['packet']}-{entry['id']}.png"
            image_name = self.comfy.upload(ref_png, upload_name)
            wf = self.ref_workflow(w, h, steps=steps, cfg=cfg, resolution=resolution)
            prompt = self.bfp.prompt_for(roster, entry, with_reference=True)
        else:
            self._log(job, f"{entry['id']}: no base image — generating text-to-image")
            wf = self.t2i_workflow(w, h, steps=steps, cfg=cfg, resolution=resolution)
            prompt = self.bfp.prompt_for(roster, entry, with_reference=False)
            image_name = ""

        for attempt in range(retries + 1):
            if self.stop_flag:
                return None
            filled = self.mtp.workflow_fill(wf, prompt, image_name, f"npc-forge/{roster['packet']}/{entry['id']}", seed + attempt, negative=negative)
            ref_tag = f" with ref {image_name}" if image_name else ""
            self._log(job, f"{entry['id']}: rendering seed {seed + attempt} ({w}x{h}){ref_tag}")
            try_path = dst if attempt == 0 else dst[:-4] + f".try{attempt}.png"
            self.comfy.run(filled, try_path, timeout=900)
            why = self.qc(try_path)
            if not why:
                if try_path != dst:
                    os.replace(try_path, dst)
                return seed + attempt
            self._log(job, f"{entry['id']}: QC failed ({'; '.join(why)})" + (" — re-rolling" if attempt < retries else ""))
            rej = os.path.join(rdir, "rejects")
            os.makedirs(rej, exist_ok=True)
            os.replace(try_path, os.path.join(rej, f"{entry['id']}.{seed + attempt}.png"))
        return None

    def qc(self, render):
        """Does the render key cleanly? (border all field, one figure, nothing left in the audit)"""
        tmp = render + ".qc.png"
        why = []
        try:
            facts = self.mtp.cut(render, tmp, key="auto")
            if facts.get("border_clear", 0) < 0.98:
                why.append(f"border not clear ({facts.get('border_clear')})")
            fw, fh = facts.get("figure") or (0, 0)
            sw, sh = facts.get("size") or (1, 1)
            if fw * fh < 0.05 * sw * sh:
                why.append(f"figure too small ({fw}x{fh} on {sw}x{sh})")
            if self.mtp.background_audit(tmp):
                why.append("field left in the plate")
        except SystemExit as exc:
            why.append(str(exc))
        except Exception as exc:  # noqa: BLE001
            why.append(f"{type(exc).__name__}: {exc}")
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        return why

    def cut_one(self, roster, entry, job=None, key="auto"):
        render_path = self.bfp.render_file(roster, entry)
        source_img = entry.get("source_img")
        source_path = os.path.join(ROOT, *source_img.split("/")) if source_img else None
        src = render_path if os.path.isfile(render_path) else (source_path if source_path and os.path.isfile(source_path) else None)
        if not src:
            raise FileNotFoundError(f"no render or source image found for {entry['id']}")
        dst = self.bfp.plate_file(roster, entry)
        facts = self.bfp.cut_plate(src, dst, size=int(roster.get("plate_size") or 512), key=key)
        if job:
            self._log(job, f"{entry['id']}: plate {rel(dst)} — figure {facts['figure'][0]}x{facts['figure'][1]}, border clear {facts['border_clear']}, healed {facts.get('healed', 0)} px"
                           + (f"  AUDIT {facts['audit']}" if facts.get("audit") else ""))
        return facts

    def remove_bg(self, packet, entry_id=None, ids=None, key="auto", job=None):
        """Step 2 of the asset pipeline: remove background from render or source image
        to produce a transparent 512px full-body sprite plate."""
        roster = self.bfp.find_roster(packet)
        target_ids = set()
        if entry_id:
            target_ids.add(entry_id)
        if ids:
            target_ids.update(ids)
        entries = roster.get("entries") or []
        to_cut = [e for e in entries if e["id"] in target_ids] if target_ids else [
            e for e in entries if os.path.isfile(self.bfp.render_file(roster, e)) or (e.get("source_img") and os.path.isfile(os.path.join(ROOT, *e["source_img"].split("/"))))
        ]
        results = []
        for e in to_cut:
            try:
                facts = self.cut_one(roster, e, job=job, key=key)
                dst = self.bfp.plate_file(roster, e)
                results.append({"id": e["id"], "plate": rel(dst), "border_clear": facts.get("border_clear"),
                                "healed": facts.get("healed", 0), "audit": facts.get("audit")})
            except Exception as exc:  # noqa: BLE001
                if job:
                    self._log(job, f"{e['id']}: remove-bg failed: {exc}")
                results.append({"id": e["id"], "error": str(exc)})
        return {"packet": packet, "cut": results, "count": sum(1 for r in results if "plate" in r)}

    def replace_one(self, roster, entry, replace_website=True, replace_foundry=True, replace_lead=True, replace_file=False):
        """Replace the current image on the website and in Foundry with the
        cut full-body usable sprite plate."""
        packet = roster["packet"]
        plate_path = self.bfp.plate_file(roster, entry)
        if not os.path.isfile(plate_path):
            render_path = self.bfp.render_file(roster, entry)
            source_img = entry.get("source_img")
            source_path = os.path.join(ROOT, *source_img.split("/")) if source_img else None
            src = render_path if os.path.isfile(render_path) else (source_path if source_path and os.path.isfile(source_path) else None)
            if src:
                self.bfp.cut_plate(src, plate_path, size=int(roster.get("plate_size") or 512))
            else:
                raise FileNotFoundError(f"cannot replace art for {entry['id']}: no plate or render available to cut")

        token_rel = f"{(roster.get('portraits') or 'portraits/' + packet).rstrip('/')}/{entry.get('plate') or entry['id']}.png"
        results = {"id": entry["id"], "plate": token_rel, "website": None, "foundry": []}

        # 1. Replace website assets in characters.json
        if replace_website:
            chars_path = os.path.join(self.bfp.RM, "data", "characters.json")
            if os.path.isfile(chars_path):
                chars = read_json(chars_path, []) or []
                target = None
                target_site = entry.get("site")
                for c in chars:
                    if not isinstance(c, dict):
                        continue
                    if target_site and c.get("id") == target_site:
                        target = c
                        break
                    if c.get("id") == entry["id"]:
                        target = c
                        break
                    if slugify(c.get("name") or "") == slugify(entry.get("name") or ""):
                        target = c
                        break
                if target:
                    target["fullBody"] = token_rel
                    target["fullBodyCaption"] = (f"Full-body token plate — {target.get('name', entry['name'])} whole on a transparent field; "
                                                f"NPC Forge on {time.strftime('%Y-%m-%d')} for the table's token.")
                    if replace_lead:
                        old_img = target.get("image")
                        if old_img and old_img != token_rel:
                            alts = target.setdefault("imageAlternates", [])
                            alt_srcs = [a if isinstance(a, str) else a.get("src") for a in alts]
                            if old_img not in alt_srcs:
                                alts.append({"src": old_img, "caption": target.get("imageCaption") or "Original portrait."})
                        target["image"] = token_rel
                    write_json(chars_path, chars)
                    results["website"] = target["id"]

        # 2. Replace Foundry actor in world mirror and packet
        if replace_foundry:
            foundry_updated = []
            # A) Source actor in world mirror
            if entry.get("source_actor"):
                try:
                    src_actor_file = self.bfp.source_actor_path(entry)
                    if os.path.isfile(src_actor_file):
                        doc = read_json(src_actor_file)
                        if isinstance(doc, dict):
                            doc["img"] = token_rel
                            proto = doc.setdefault("prototypeToken", {})
                            proto.setdefault("texture", {})["src"] = token_rel
                            sheets = (doc.get("flags") or {}).get(self.bfp.SHEETS_FLAG) or {}
                            if isinstance(sheets, dict) and sheets.get("art") == "pending":
                                sheets.pop("art", None)
                            write_json(src_actor_file, doc)
                            foundry_updated.append(rel(src_actor_file))
                except Exception as exc:
                    print(f"  replace: source actor update error: {exc}")

            # B) Packet actor in Reputation-Matrix2/actors/<packet>/
            actors_dir = self.bfp.packet_paths(roster)[0]
            prefix = roster.get("file_prefix") or f"fvtt-Actor-{packet}-"
            packet_actor_file = os.path.join(actors_dir, f"{prefix}{entry['id']}.json")
            if os.path.isfile(packet_actor_file):
                pdoc = read_json(packet_actor_file)
                if isinstance(pdoc, dict):
                    pdoc["img"] = token_rel
                    proto = pdoc.setdefault("prototypeToken", {})
                    proto.setdefault("texture", {})["src"] = token_rel
                    sheets = (pdoc.get("flags") or {}).get(self.bfp.SHEETS_FLAG) or {}
                    if isinstance(sheets, dict) and sheets.get("art") == "pending":
                        sheets.pop("art", None)
                    write_json(packet_actor_file, pdoc)
                    foundry_updated.append(rel(packet_actor_file))

            # C) If not source_actor, check live world mirror for actor matching ID or name
            world = (roster.get("foundry_source") or {}).get("world") or self._foundry_world()[0]
            world_dir = os.path.join(self.bfp.ACTORS_ROOT, "worlds", world)
            if os.path.isdir(world_dir) and not entry.get("source_actor"):
                for base, _dirs, files in os.walk(world_dir):
                    for fn in files:
                        if fn.endswith(".json") and fn.startswith("fvtt-Actor-"):
                            fp = os.path.join(base, fn)
                            wdoc = read_json(fp)
                            if isinstance(wdoc, dict) and (wdoc.get("_id") == entry.get("source_actor_id") or slugify(wdoc.get("name") or "") == slugify(entry.get("name") or "")):
                                wdoc["img"] = token_rel
                                proto = wdoc.setdefault("prototypeToken", {})
                                proto.setdefault("texture", {})["src"] = token_rel
                                sheets = (wdoc.get("flags") or {}).get(self.bfp.SHEETS_FLAG) or {}
                                if isinstance(sheets, dict) and sheets.get("art") == "pending":
                                    sheets.pop("art", None)
                                write_json(fp, wdoc)
                                foundry_updated.append(rel(fp))
                                break

            # D) If replace_file is True and source_img exists under portraits/, overwrite it with new sprite
            if replace_file and entry.get("source_img"):
                try:
                    source_full = os.path.realpath(os.path.join(ROOT, *entry["source_img"].split("/")))
                    rm_portraits = os.path.realpath(os.path.join(self.bfp.RM, "portraits"))
                    if source_full.startswith(rm_portraits + os.sep) and os.path.isfile(source_full):
                        shutil.copyfile(plate_path, source_full)
                        foundry_updated.append(f"file: {rel(source_full)}")
                except Exception as exc:
                    print(f"  replace: file overwrite error: {exc}")

            results["foundry"] = foundry_updated

        # 3. Mark entry as replaced in the roster
        entry["replaced"] = True
        entry["replaced_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        r_path = os.path.join(self.bfp.ROSTERS, packet + ".json")
        write_json(r_path, roster)

        return results

    def replace(self, packet, id=None, ids=None, replace_website=True, replace_foundry=True, replace_lead=True, replace_file=False):
        """Batch or single replacement of current assets on the website and Foundry."""
        roster = self.bfp.find_roster(packet)
        target_ids = set()
        if id:
            target_ids.add(id)
        if ids:
            target_ids.update(ids)
        entries = roster.get("entries") or []
        if not target_ids:
            # Batch mode: replace all entries that have plates or renders
            to_replace = [e for e in entries if os.path.isfile(self.bfp.plate_file(roster, e)) or os.path.isfile(self.bfp.render_file(roster, e))]
        else:
            to_replace = [e for e in entries if e["id"] in target_ids]

        replaced = []
        for e in to_replace:
            res = self.replace_one(roster, e, replace_website=replace_website, replace_foundry=replace_foundry,
                                   replace_lead=replace_lead, replace_file=replace_file)
            replaced.append(res)

        # Rebuild packet to ensure actors/<packet>/import.json is up-to-date
        self.build(roster)

        # If any source actors in a world mirror were updated, re-combine world import.json if available
        world = (roster.get("foundry_source") or {}).get("world")
        if world:
            world_dir = os.path.join(self.bfp.ACTORS_ROOT, "worlds", world)
            world_out = os.path.join(world_dir, "import.json")
            if os.path.isdir(world_dir) and os.path.isfile(world_out):
                cmd = [sys.executable, os.path.join(HERE, "foundry-bridge.py"), "combine", rel(world_dir), "--out", rel(world_out), "--world", world]
                subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")

        return {"packet": packet, "replaced": replaced, "count": len(replaced)}

    def build(self, roster, job=None):
        lib = self.bfp.P955.load_image_lib()
        scheme = self.bfp.P955.load_folder_scheme()
        expected, problems, pending = self.bfp.build_packet(roster, lib, scheme)
        if problems:
            if job:
                for p in problems:
                    self._log(job, "  " + p)
            raise RuntimeError(f"{len(problems)} roster problem(s) — the packet was not written")
        self.bfp.write_packet(roster, expected)
        actors_dir = self.bfp.packet_paths(roster)[0]
        out = os.path.join(actors_dir, "import.json")
        cmd = [sys.executable, os.path.join(HERE, "foundry-bridge.py"), "combine", rel(actors_dir), "--out", rel(out), "--world", roster["packet"]]
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if job:
            self._log(job, f"built {len(expected)} actors in {rel(actors_dir)}" + (f" ({len(pending)} awaiting art: {', '.join(pending)})" if pending else ""))
            self._log(job, (res.stdout or res.stderr).strip().splitlines()[-1] if (res.stdout or res.stderr).strip() else "combine: done")
        if res.returncode:
            raise RuntimeError("combine failed: " + (res.stderr or res.stdout).strip()[-400:])
        return {"actors": len(expected), "pending": pending, "import": rel(out)}

    def run(self, packet, ids=None, steps=("render", "cut", "build"), only_missing=True, seed_mode="roster", sampler_steps=None, cfg=None,
            resolution=None, retries=1, record_seed=True):
        roster = self.bfp.find_roster(packet)
        steps = tuple(steps)
        if "render" in steps and not (self.comfy and self.engine == "qwen21"):
            self.connect()
            if not (self.comfy and self.engine == "qwen21"):
                raise RuntimeError("no Qwen-Image-2.1 ComfyUI to render on — start Comfy Desktop and Connect, or run the cut/build steps only")
        want = [e for e in roster["entries"] if not ids or e["id"] in set(ids)]
        job = self._new_job("run", packet)
        job["total"] = len(want)
        job["steps"] = list(steps)

        def loop():
            ok = True
            try:
                import random
                for e in want:
                    if self.stop_flag:
                        self._log(job, "stopped")
                        ok = False
                        break
                    render, plate = self.bfp.render_file(roster, e), self.bfp.plate_file(roster, e)
                    try:
                        if "render" in steps and (not only_missing or not os.path.exists(render)):
                            seed = None if seed_mode == "roster" else random.randint(1, 2 ** 31 - 1)
                            used = self.render_one(roster, e, job, steps=sampler_steps, cfg=cfg, resolution=resolution, seed=seed, retries=retries)
                            if used is None:
                                self._log(job, f"{e['id']}: no usable render")
                                ok = False
                                job["done"] += 1
                                continue
                            if record_seed and used != e.get("seed"):
                                self.save_entry(packet, e["id"], {"seed": used})
                                e["seed"] = used
                            if os.path.exists(plate):
                                os.remove(plate)                       # a new render means a new plate
                        if "cut" in steps and os.path.exists(render) and (not only_missing or not os.path.exists(plate)):
                            self.cut_one(roster, e, job)
                        elif "cut" in steps and not os.path.exists(render):
                            self._log(job, f"{e['id']}: no render to cut")
                    except Exception as exc:  # noqa: BLE001
                        self._log(job, f"{e['id']}: {type(exc).__name__}: {exc}")
                        ok = False
                    job["done"] += 1
                if "build" in steps and not self.stop_flag:
                    try:
                        self.build(self.bfp.find_roster(packet), job)
                    except Exception as exc:  # noqa: BLE001
                        self._log(job, f"build: {exc}")
                        ok = False
                if "replace" in steps and not self.stop_flag:
                    try:
                        rep_ids = [e["id"] for e in want]
                        rep_res = self.replace(packet, ids=rep_ids)
                        self._log(job, f"replace: updated {rep_res['count']} art asset(s) in website & Foundry")
                    except Exception as exc:  # noqa: BLE001
                        self._log(job, f"replace: {exc}")
                        ok = False
            finally:
                job["ok"] = ok
                job["alive"] = False
                self._log(job, "done" if ok else "finished with problems")
        threading.Thread(target=loop, daemon=True).start()
        return {"id": job["id"], "total": job["total"]}

    def import_render(self, packet, entry_id, data, cut=True):
        """A render made elsewhere (Claude, a Qwen GUI, a drawing) dropped on
        the page: saved as the entry's render, cut when asked."""
        roster = self.bfp.find_roster(packet)
        e = next((x for x in roster["entries"] if x["id"] == entry_id), None)
        if not e:
            raise KeyError(entry_id)
        dst = self.bfp.render_file(roster, e)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as fh:
            fh.write(data)
        out = {"render": rel(dst)}
        if cut:
            facts = self.cut_one(roster, e)
            out.update({"plate": rel(self.bfp.plate_file(roster, e)), "audit": facts.get("audit"), "border_clear": facts.get("border_clear")})
        return out

    def handoff(self, packet, only_missing=True):
        """npc-forge/<packet>/handoff.md + jobs.jsonl — the brief for whoever
        draws: one line per entry with the prompt, the negative, the seed, the
        canvas and the exact file to write; and what to run afterwards."""
        roster = self.bfp.find_roster(packet)
        folder = os.path.dirname(self.bfp.packet_paths(roster)[2])
        os.makedirs(folder, exist_ok=True)
        jobs = [self.bfp.render_job(roster, e) for e in roster["entries"]
                if not only_missing or not os.path.exists(self.bfp.render_file(roster, e))]
        with open(os.path.join(folder, "jobs.jsonl"), "w", encoding="utf-8") as fh:
            for j in jobs:
                fh.write(json.dumps(j, ensure_ascii=False) + "\n")
        w, h = roster.get("render_size") or [1408, 768]
        lines = [f"# {roster['name']} — render hand-off", "",
                 f"Roster `{rel(os.path.join(self.bfp.ROSTERS, packet + '.json'))}`; {len(jobs)} render(s) wanted"
                 + (" (entries without a render)" if only_missing else "") + f". Written {dt.datetime.now().strftime('%Y-%m-%d %H:%M')} by tools/npc-forge.py.", "",
                 "## The recipe", "",
                 f"- Canvas {w}×{h}, one figure, flat **{roster.get('background') or '#FF00FF'}** background (the cut keys it off; a real alpha channel works too).",
                 f"- Style: {roster.get('style')}", f"- Framing: {roster.get('framing')}",
                 f"- Negative: {roster.get('negative')}", "",
                 "## The renders", "",
                 "Write each PNG to the path given; then `python3 tools/build-forge-packets.py plates " + packet + "` cuts the plates and "
                 "`python3 tools/build-forge-packets.py " + packet + "` rebuilds the actors (or press **Cut + build** on the Forge page).", ""]
        for j in jobs:
            lines += [f"### {j['name']} (`{j['id']}`)", "", f"- file: `{j['render']}` → plate `{j['plate']}` ({j['plate_size']} px)",
                      f"- seed: {j['seed']}", f"- prompt: {j['prompt']}", ""]
        with open(os.path.join(folder, "handoff.md"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines))
        return {"handoff": rel(os.path.join(folder, "handoff.md")), "jobs": rel(os.path.join(folder, "jobs.jsonl")), "count": len(jobs)}

    # ------------------------------------------- everything, tabulated --
    SITE_PACKET = "website-characters"

    def _site_article(self, name, site, articles):
        for a in articles:
            if isinstance(a, dict) and ((site and a.get("id") == site) or slugify(a.get("name") or "") == slugify(name or "")):
                return a
        return None

    def catalog(self, match=None):
        """One table of every character the Forge can draw: roster entries (imported), Foundry NPCs and
        website articles that no roster carries yet (not imported). `needs` = no transparent full-body
        sprite anywhere and no Foundry-installed art on the actor - what Generate missing makes."""
        articles = read_json(os.path.join(self.bfp.RM, "data", "characters.json"), []) or []
        rows = []
        for r in self.rosters():
            if r.get("error"):
                continue
            for e in r["entries"]:
                sprite = bool(e["plate"] or e["existing_fullbody"])
                have = sprite or bool(e["foundry_art"])
                stage = "sprite" if sprite else ("foundry" if have else ("render" if e["render"] else ("reference" if e["has_base_img"] else "none")))
                rows.append({"key": f"{r['packet']}/{e['id']}", "packet": r["packet"], "id": e["id"], "name": e["name"],
                             "group": r.get("group") or r.get("name"), "folder": e.get("folder"), "source": "roster",
                             "imported": True, "stage": stage, "needs": not have, "has_ref": e["has_base_img"],
                             "thumb": e["plate"] or e["existing_fullbody"] or e["render"] or e["foundry_art"] or e["base_img"] or e["site_img"],
                             "replaced": e["replaced"], "cr": e.get("cr")})
        ids, names = self._claimed()
        try:
            _world, _scheme, actor_rows = self._foundry_actor_rows()
        except RuntimeError:
            actor_rows = []
        seen_names, seen_sites = set(names), set()
        for x in actor_rows:
            doc = x["doc"]
            name = str(doc.get("name") or "")
            if str(doc.get("_id")) in ids or slugify(name) in names:
                continue
            flags = (doc.get("flags") or {}).get(self.bfp.SHEETS_FLAG) or {}
            seen_names.add(slugify(name))
            if flags.get("characterId"):
                seen_sites.add(flags["characterId"])
            art = self._site_article(name, flags.get("characterId"), articles)
            fb = self.find_existing_fullbody({"id": slugify(name), "site": flags.get("characterId")}, art)
            img = self._foundry_image(doc.get("img"))
            stock = self._foundry_art(doc) or self._module_art_exact(name)
            rows.append({"key": "foundry/" + str(doc.get("_id")), "packet": None, "id": slugify(name), "name": name,
                         "group": x["folder_path"][0], "folder": " / ".join(x["folder_path"][1:]) or "General", "source": "foundry",
                         "imported": False, "stage": "sprite" if fb else ("foundry" if stock else ("reference" if img else "none")),
                         "needs": not (fb or stock),
                         "has_ref": bool(img), "thumb": rel(fb) if fb else (stock or img), "replaced": False, "cr": None})
        for c in self.site_candidates():
            if c["site"] in seen_sites or slugify(c["name"]) in seen_names:
                continue        # the same character is already a Foundry NPC row
            art = self._site_article(c["name"], c["site"], articles)
            fb = self.find_existing_fullbody({"id": c["site"], "site": c["site"]}, art)
            mod = self._module_art_exact(c["name"])
            rows.append({"key": "site/" + c["site"], "packet": None, "id": c["site"], "name": c["name"],
                         "group": c.get("affiliation") or "Website", "folder": c.get("status") or "", "source": "site",
                         "imported": False,
                         "stage": "sprite" if fb else ("foundry" if mod else ("reference" if c.get("image") else "none")),
                         "needs": not (fb or mod), "has_ref": bool(c.get("image")),
                         "thumb": rel(fb) if fb else (mod or c.get("fullBody") or c.get("image")),
                         "replaced": False, "cr": None})
        if match:
            m = match.lower()
            rows = [x for x in rows if m in f"{x['name']} {x['group']} {x['folder']} {x['packet'] or ''}".lower()]
        for x in rows:
            if x["needs"]:
                cands = self.module_art_candidates(x["name"])
                if cands:
                    x["module_candidates"] = cands
        counts = {"rows": len(rows), "imported": sum(1 for x in rows if x["imported"]), "unimported": sum(1 for x in rows if not x["imported"]),
                  "missing": sum(1 for x in rows if x["needs"]), "sprites": sum(1 for x in rows if x["stage"] == "sprite"),
                  "foundry_art": sum(1 for x in rows if x["stage"] == "foundry"),
                  "module_candidates": sum(1 for x in rows if x.get("module_candidates"))}
        return {"rows": rows, "counts": counts, "batch": self.batch}

    def art_audit(self):
        """The true picture of art: every module / system / world image path the actor files point at, checked
        against the Foundry Data folder (per module), the module art index, and what is still missing."""
        data = FOUNDRY_ART_ROOTS[0] if FOUNDRY_ART_ROOTS else ""
        pat = re.compile(r'"((?:modules|systems|worlds)/[^"]+?\.(?:webp|png|jpe?g|svg|gif|avif))"', re.I)
        per = {}
        for base, _dirs, files in os.walk(os.path.join(self.bfp.ACTORS_ROOT)):
            for fn in files:
                if not fn.lower().endswith(".json"):
                    continue
                try:
                    text = open(os.path.join(base, fn), encoding="utf-8").read()
                except (OSError, UnicodeDecodeError):
                    continue
                for m in pat.finditer(text):
                    ref = urllib.parse.unquote(m.group(1))
                    if "*" in ref or "{" in ref or "," in ref:
                        continue            # a token-ring pattern or a list, not one file
                    parts = ref.split("/")
                    key = "/".join(parts[:2])
                    d = per.setdefault(key, {"module": key, "refs": set(), "missing": set()})
                    d["refs"].add(ref)
                    if not (data and os.path.isfile(os.path.join(data, *parts))):
                        d["missing"].add(ref)
        modules = []
        for key, d in sorted(per.items()):
            installed = bool(data and os.path.isdir(os.path.join(data, *key.split("/"))))
            modules.append({"module": key, "installed": installed, "refs": len(d["refs"]),
                            "missing": sorted(d["missing"])})
        cat = self.catalog()
        needs = [r for r in cat["rows"] if r["needs"]]
        return {"data": data, "modules": modules, "module_art_files": sum(len(v) for v in self.module_art_index().values()),
                "counts": cat["counts"], "needs": needs,
                "module_matches": [r for r in cat["rows"] if r["stage"] == "foundry" and str(r.get("thumb") or "").startswith(FOUNDRY_ART_PREFIX + "modules/")]}

    def import_all(self):
        """Make every Foundry NPC and website article a roster entry: one roster per Foundry folder the
        Forge has no entries from, one `website-characters` roster for the articles. Idempotent."""
        made, added = [], 0
        try:
            _world, _scheme, actor_rows = self._foundry_actor_rows()
        except RuntimeError:
            actor_rows = []
        ids, names = self._claimed()
        groups = []
        for x in actor_rows:
            doc = x["doc"]
            if str(doc.get("_id")) in ids or slugify(str(doc.get("name") or "")) in names:
                continue
            if x["folder_path"][0] not in groups:
                groups.append(x["folder_path"][0])
        for group in groups:
            packet = "foundry-" + slugify(group)
            if os.path.exists(os.path.join(self.bfp.ROSTERS, packet + ".json")):
                packet = packet + "-2"
                if os.path.exists(os.path.join(self.bfp.ROSTERS, packet + ".json")):
                    continue
            try:
                self.import_foundry(group, packet=packet, only_unclaimed=True)
                made.append(packet)
            except (KeyError, RuntimeError):
                pass
        site = self.site_candidates()
        if site:
            path = os.path.join(self.bfp.ROSTERS, self.SITE_PACKET + ".json")
            if not os.path.exists(path):
                self.draft(self.SITE_PACKET, "Website characters", group="Website characters", plan=[], rows=[], framing="fullbody")
                made.append(self.SITE_PACKET)
            res = self.collect(self.SITE_PACKET, site, framing=self.bfp.FRAMINGS["fullbody"])
            added = len(res["added"])
        return {"rosters": made, "site_entries": added, "catalog": self.catalog()["counts"]}

    def generate_missing(self, packets=None, ids=None, render=True, retries=1):
        """Import everything, adopt sprites that already exist, then render + cut + build every entry still
        without a full-body sprite. Without a Qwen Comfy it cuts the renders it has and writes hand-off
        briefs for the rest. `ids` is a list of "packet/id" keys to limit the run."""
        if self.batch and self.batch.get("alive"):
            raise RuntimeError("a batch is already running - stop it or wait")
        imported = self.import_all()
        if render and not (self.comfy and self.engine == "qwen21"):
            self.connect()
        can_render = bool(render and self.comfy and self.engine == "qwen21")
        wanted = set(ids or [])
        batch = {"alive": True, "log": [], "done": 0, "total": 0, "can_render": can_render, "imported": imported, "started": time.time()}
        self.batch = batch
        self.stop_flag = False
        plan = []
        for r in self.rosters():
            if r.get("error") or (packets and r["packet"] not in packets):
                continue
            # Foundry-installed art counts as done unless the entry was asked for by key
            todo = [e["id"] for e in r["entries"] if not (e["plate"] or e["existing_fullbody"])
                    and (f"{r['packet']}/{e['id']}" in wanted if wanted else not e["foundry_art"])]
            adopt = [e["id"] for e in r["entries"] if not e["plate"] and e["existing_fullbody"]
                     and (not wanted or f"{r['packet']}/{e['id']}" in wanted)]
            if todo or adopt:
                plan.append((r["packet"], todo, adopt))
        batch["total"] = sum(len(t) + len(a) for _p, t, a in plan)

        def say(line):
            batch["log"].append(f"{dt.datetime.now().strftime('%H:%M:%S')}  {line}")

        def work():
            try:
                for packet, todo, adopt in plan:
                    if self.stop_flag:
                        say("stopped")
                        break
                    if adopt:
                        got = self.use_fullbody(packet, ids=adopt)
                        say(f"{packet}: adopted {got['count']} existing sprite(s)")
                        batch["done"] += len(adopt)
                    if not todo:
                        continue
                    roster = self.bfp.find_roster(packet)
                    by_id = {e["id"]: e for e in roster["entries"]}
                    rendered = [i for i in todo if os.path.exists(self.bfp.render_file(roster, by_id[i]))]
                    steps = ("render", "cut", "build") if can_render else ("cut", "build")
                    run_ids = todo if can_render else rendered
                    if run_ids:
                        say(f"{packet}: {'render + ' if can_render else ''}cut {len(run_ids)} entr(ies)")
                        try:
                            job = self.run(packet, ids=run_ids, steps=steps, only_missing=True, retries=retries)
                        except RuntimeError as exc:
                            say(f"{packet}: {exc}")
                            batch["done"] += len(todo)
                            continue
                        while True:
                            j = self.jobs.get(job["id"]) or {}
                            if not j.get("alive"):
                                break
                            time.sleep(1)
                        batch["log"].extend("    " + ln for ln in (j.get("log") or [])[-6:])
                    if not can_render:
                        left = [i for i in todo if i not in rendered]
                        if left:
                            self.handoff(packet, only_missing=True)
                            say(f"{packet}: no Comfy - hand-off brief written for {len(left)} entr(ies) (npc-forge/{packet}/handoff.md)")
                    batch["done"] += len(todo)
            except Exception as exc:  # noqa: BLE001
                say(f"{type(exc).__name__}: {exc}")
            finally:
                batch["alive"] = False
                say("done")
        if plan:
            threading.Thread(target=work, daemon=True).start()
        else:
            batch["alive"] = False
            say("nothing missing")
        return {"imported": imported, "queued": batch["total"], "can_render": can_render}

    def state(self):
        return {"connection": self.connection(), "rosters": self.rosters(), "foundry": self.foundry_groups(),
                "job": self.current, "batch": self.batch, "root": ROOT,
                "tiers": {k: {"cr": v["cr"], "ac": v["ac"], "hp": v["hp"]} for k, v in TIERS.items()}, "default_plan": DEFAULT_PLAN}


# ------------------------------------------------------------------- http --

class Handler(BaseHTTPRequestHandler):
    forge = None

    def log_message(self, fmt, *args):
        if os.environ.get("FORGE_LOG"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _file(self, rel_path):
        if rel_path.startswith(FOUNDRY_ART_PREFIX):
            path = self.forge.foundry_art_path(rel_path[len(FOUNDRY_ART_PREFIX):])
            if not path:
                return self._send(404, {"error": "not found"})
        else:
            path = os.path.realpath(os.path.join(ROOT, rel_path))
            if not path.startswith(os.path.realpath(ROOT) + os.sep) or not os.path.isfile(path):
                return self._send(404, {"error": "not found"})
        ext = os.path.splitext(path)[1].lower()
        ctype = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json; charset=utf-8",
                 ".svg": "image/svg+xml", ".gif": "image/gif", ".avif": "image/avif",
                 ".md": "text/markdown; charset=utf-8"}.get(ext, "application/octet-stream")
        with open(path, "rb") as fh:
            self._send(200, fh.read(), ctype)

    def do_GET(self):
        f = self.forge
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        try:
            if u.path in ("/", "/index.html"):
                with open(HTML, "rb") as fh:
                    return self._send(200, fh.read(), "text/html; charset=utf-8")
            if u.path == "/file":
                return self._file(q.get("p", "").replace("\\", "/").lstrip("/"))
            if u.path == "/api/state":
                return self._send(200, f.state())
            if u.path == "/api/catalog":
                return self._send(200, f.catalog(q.get("match") or None))
            if u.path == "/api/factions":
                return self._send(200, f.factions())
            if u.path == "/api/job":
                job = f.job(q.get("id") or None)
                return self._send(200 if job else 404, job or {"error": "no job"})
            if u.path == "/api/jobs":
                r = f.bfp.find_roster(q.get("packet", ""))
                return self._send(200, {"jobs": [f.bfp.render_job(r, e) for e in r["entries"]]})
            if u.path == "/api/site":
                return self._send(200, {"candidates": f.site_candidates(q.get("match") or None)})
            if u.path == "/api/prompts":
                r = f.bfp.find_roster(q.get("packet", ""))
                ids = (q.get("ids") or "").split(",") if q.get("ids") else None
                out_prompts = []
                for e in r["entries"]:
                    if ids and e["id"] not in ids:
                        continue
                    base_src = f.resolve_base_image_path(r, e)
                    out_prompts.append({
                        "id": e["id"], "name": e["name"],
                        "prompt": f.bfp.prompt_for(r, e, with_reference=bool(base_src)),
                        "prompt_t2i": f.bfp.prompt_for(r, e, with_reference=False),
                        "negative": e.get("negative") or r.get("negative") or "",
                        "framing": e.get("framing") or r.get("framing") or "fullbody",
                        "seed": e.get("seed"), "render": rel(f.bfp.render_file(r, e)),
                        "base_image": rel(base_src) if base_src else None,
                        "has_base_image": bool(base_src),
                    })
                return self._send(200, {"prompts": out_prompts})
            return self._send(404, {"error": "no route " + u.path})
        except (KeyError, FileNotFoundError) as exc:
            return self._send(404, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"error": "%s: %s" % (type(exc).__name__, exc)})

    def do_POST(self):
        f = self.forge
        n = int(self.headers.get("Content-Length") or 0)
        path = urllib.parse.urlsplit(self.path).path
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
        raw = self.rfile.read(n) if n else b""
        try:
            if path == "/api/upload-render":
                return self._send(200, f.import_render(q["packet"], q["id"], raw, cut=q.get("cut", "1") != "0"))
            if path == "/api/upload-base":
                return self._send(200, f.upload_base(q["packet"], q["id"], raw))
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except ValueError:
                return self._send(400, {"error": "bad JSON"})
            if path == "/api/clear-base":
                return self._send(200, f.clear_base(body["packet"], body["id"]))
            if path == "/api/reset-base":
                return self._send(200, f.reset_base(body["packet"], body["id"]))
            if path == "/api/use-fullbody":
                return self._send(200, f.use_fullbody(body["packet"], entry_id=body.get("id"), ids=body.get("ids")))
            if path == "/api/connect":
                return self._send(200, f.connect(body.get("url") or None))
            if path == "/api/start-comfy":
                return self._send(200, f.start_comfy())
            if path == "/api/draft":
                return self._send(200, f.draft(body["packet"], body["name"], faction=body.get("faction"), group=body.get("group"), color=body.get("color"),
                                               plan=body.get("plan"), subfolders=body.get("subfolders"), style=body.get("style"), title=body.get("title"),
                                               rows=body.get("rows"), framing=body.get("framing")))
            if path == "/api/import-all":
                return self._send(200, f.import_all())
            if path == "/api/generate-missing":
                return self._send(202, f.generate_missing(packets=body.get("packets"), ids=body.get("ids"),
                                                          render=body.get("render", True), retries=int(body.get("retries", 1))))
            if path == "/api/import-foundry":
                return self._send(200, f.import_foundry(body.get("group"), packet=body.get("packet"), world=body.get("world")))
            if path == "/api/collect":
                rows = body.get("rows")
                if rows is None and body.get("fromSite") is not None:
                    rows = f.site_candidates(body.get("fromSite") or None)[: int(body.get("limit") or 8)]
                return self._send(200, f.collect(body["packet"], rows or [], tier=body.get("tier") or "1",
                                                 folder=body.get("folder"), framing=body.get("framing")))
            if path == "/api/ingest":
                return self._send(200, {"collected": f.ingest(body.get("dir") or "", packet=body.get("packet"), cut=body.get("cut", True))})
            if path == "/api/entry":
                return self._send(200, f.save_entry(body["packet"], body["id"], body.get("fields") or {}))
            if path == "/api/roster":
                return self._send(200, f.save_roster_fields(body["packet"], body.get("fields") or {}))
            if path == "/api/run":
                return self._send(202, f.run(body["packet"], ids=body.get("ids"), steps=body.get("steps") or ("render", "cut", "build"),
                                             only_missing=body.get("only_missing", True), seed_mode=body.get("seed_mode", "roster"),
                                             sampler_steps=body.get("sampler_steps"), cfg=body.get("cfg"), resolution=body.get("resolution"),
                                             retries=int(body.get("retries", 1)), record_seed=body.get("record_seed", True)))
            if path in ("/api/remove-bg", "/api/cut"):
                return self._send(200, f.remove_bg(body["packet"], entry_id=body.get("id"), ids=body.get("ids"), key=body.get("key", "auto")))
            if path == "/api/replace":
                return self._send(200, f.replace(body["packet"], id=body.get("id"), ids=body.get("ids"),
                                                 replace_website=body.get("replace_website", True),
                                                 replace_foundry=body.get("replace_foundry", True),
                                                 replace_lead=body.get("replace_lead", True),
                                                 replace_file=body.get("replace_file", False)))
            if path == "/api/stop":
                return self._send(200, f.stop())
            if path == "/api/build":
                return self._send(200, f.build(f.bfp.find_roster(body["packet"])))
            if path == "/api/handoff":
                return self._send(200, f.handoff(body["packet"], only_missing=body.get("only_missing", True)))
            return self._send(404, {"error": "no route " + path})
        except (KeyError, FileNotFoundError) as exc:
            return self._send(404, {"error": str(exc)})
        except RuntimeError as exc:
            return self._send(409, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"error": "%s: %s" % (type(exc).__name__, exc)})


def make_server(forge, host="127.0.0.1", port=PORT):
    Handler.forge = forge
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    return srv


# -------------------------------------------------------------------- cli --

def watch_loop(forge, directory, packet=None, interval=6):
    """Keep collecting renders from `directory` as they land — the headless twin of
    the page's auto-collect: an image model (or Comfy, or a download) writes a file
    that matches a pending job, and it is filed and cut without anyone dragging."""
    seen = set()
    print(f"watching {directory} for renders of pending jobs (Ctrl+C stops)")
    while True:
        time.sleep(interval)
        try:
            for it in forge.ingest(directory, packet=packet):
                key = (it["packet"], it["id"])
                if key in seen:
                    continue
                seen.add(key)
                print(f"  collected {it['id']} ({it['packet']}) ← {it['from']} → {it.get('plate') or it['render']}")
        except KeyboardInterrupt:
            print(f"stopped — {len(seen)} render(s) collected")
            return
        except Exception as exc:  # noqa: BLE001 — a bad folder must not kill the watch
            print(f"  ingest: {type(exc).__name__}: {exc}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="NPC Forge — faction → roster → renders → token plates → Foundry packet")
    ap.add_argument("command", nargs="?", default="serve",
                    choices=["serve", "draft", "collect", "ingest", "prompt", "run", "cut", "build", "handoff", "replace", "remove-bg", "import-all", "generate-missing", "art-audit"])
    ap.add_argument("packet", nargs="?")
    ap.add_argument("--list", action="store_true", help="rosters and their art state, then exit")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--url", default=None, help="ComfyUI server (default: COMFY_URL, else probe 127.0.0.1 ports 8188, 8000, 8189, 8190)")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--faction", default=None, help="draft: faction id from data/factions.json")
    ap.add_argument("--name", default=None, help="draft: the packet's display name")
    ap.add_argument("--group", default=None, help="draft: the Foundry group folder (default: the faction's group)")
    ap.add_argument("--count", type=int, default=None, help="draft: how many entries (default plan: %s)" % ",".join(DEFAULT_PLAN))
    ap.add_argument("--plan", default=None, help="draft: tiers, e.g. 0.5,0.5,1,2,3,5")
    ap.add_argument("--input", default=None, help="draft/collect: roster input file (a JSON list of rows: name, look, tier, folder, framing, seed, site)")
    ap.add_argument("--from-site", action="store_true", help="collect: take the rows from the website's articles (--match filters them)")
    ap.add_argument("--match", default=None, help="collect --from-site / site candidates: only articles whose affiliation/title contains this")
    ap.add_argument("--limit", type=int, default=None, help="collect --from-site: how many candidates at most")
    ap.add_argument("--tier", default=None, help="collect: default tier for rows that don't name one")
    ap.add_argument("--folder", default=None, help="collect: default subfolder for rows that don't name one")
    ap.add_argument("--framing", default=None, help="draft/collect: framing preset (fullbody, bust, head) or a sentence of your own")
    ap.add_argument("--dir", default=None, help="ingest: the folder to collect renders from (Comfy output, Downloads, …)")
    ap.add_argument("--watch", action="store_true", help="ingest: keep collecting from --dir until Ctrl+C")
    ap.add_argument("--ids", default=None, help="run/cut: only these entry ids (comma-separated)")
    ap.add_argument("--all", action="store_true", help="run/cut: redo entries that already have art")
    ap.add_argument("--steps", default="render,cut,build", help="run: which steps (render,cut,build)")
    ap.add_argument("--random-seeds", action="store_true", help="run: roll new seeds instead of the roster's (the seed used is written back)")
    ap.add_argument("--retries", type=int, default=1)
    ap.add_argument("--no-website", action="store_true", help="replace: do not update characters.json")
    ap.add_argument("--no-foundry", action="store_true", help="replace: do not update Foundry actors")
    ap.add_argument("--no-lead", action="store_true", help="replace: do not overwrite lead article image (only set fullBody)")
    a = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    forge = Forge(url=a.url)
    if a.list:
        for r in forge.rosters():
            if r.get("error"):
                print(f"{r['packet']}: {r['error']}")
                continue
            c = r["counts"]
            print(f"{r['packet']}: {r['name']} — {c['entries']} entries, {c['rendered']} rendered, {c['plates']} plates, {c['actors']} actors")
        return 0
    if a.command == "draft":
        if not a.packet or not a.name:
            ap.error("draft needs <packet> and --name")
        rows = None
        if a.input:
            loaded = read_json(a.input, [])
            rows = loaded if isinstance(loaded, list) else (loaded.get("rows") or loaded.get("entries") or [])
        plan = a.plan.split(",") if a.plan else (DEFAULT_PLAN[:a.count] if a.count and a.count <= len(DEFAULT_PLAN) else
                                                 (DEFAULT_PLAN + ["2"] * (a.count - len(DEFAULT_PLAN)) if a.count else None))
        r = forge.draft(a.packet, a.name, faction=a.faction, group=a.group, plan=plan, rows=rows, framing=a.framing)
        print(f"drafted data/forge/{r['packet']}.json with {r['counts']['entries']} entries under {r['group']!r}; "
              f"write the looks, then `npc-forge.py run {r['packet']}` or `handoff {r['packet']}`")
        return 0
    if a.command == "collect":
        if not a.packet:
            ap.error("collect needs <packet>")
        if a.input:
            loaded = read_json(a.input, [])
            rows = loaded if isinstance(loaded, list) else (loaded.get("rows") or loaded.get("entries") or [])
        elif a.from_site:
            rows = forge.site_candidates(a.match)[: a.limit] if a.limit else forge.site_candidates(a.match)
        else:
            ap.error("collect needs --from-site or --input FILE")
        out = forge.collect(a.packet, rows, tier=a.tier or "1", folder=a.folder, framing=a.framing)
        print(f"collect: {len(out['added'])} new entr(ies) in data/forge/{a.packet}.json ({out['entries']} total): "
              + (", ".join(out["added"]) or "nothing new — every candidate was already in the roster"))
        return 0
    if a.command == "ingest":
        if not a.dir:
            ap.error("ingest needs --dir FOLDER")
        if a.watch:
            watch_loop(forge, a.dir, packet=a.packet)
            return 0
        out = forge.ingest(a.dir, packet=a.packet)
        for it in out:
            print(f"  collected {it['id']} ({it['packet']}) ← {it['from']} → {it.get('plate') or it['render']}")
        print(f"ingest: {len(out)} render(s) collected and cut" + ("" if out else " — nothing in that folder matched a pending job"))
        return 0
    if a.command == "prompt":
        if not a.packet:
            ap.error("prompt needs <packet>")
        r = forge.bfp.find_roster(a.packet)
        ids = [s.strip() for s in a.ids.split(",")] if a.ids else None
        for e in r["entries"]:
            if ids and e["id"] not in ids:
                continue
            print(f"{e['id']}  {e['name']}")
            print(f"  prompt:   {forge.bfp.prompt_for(r, e)}")
            print(f"  negative: {e.get('negative') or r.get('negative') or ''}")
            print(f"  seed: {e.get('seed')}  canvas: {'x'.join(str(v) for v in (e.get('render_size') or r.get('render_size') or [1408, 768]))}"
                  f"  → {rel(forge.bfp.render_file(r, e))}")
        return 0
    if a.command in ("run", "cut", "build", "handoff"):
        if not a.packet:
            ap.error(f"{a.command} needs <packet>")
        if a.command == "handoff":
            out = forge.handoff(a.packet, only_missing=not a.all)
            print(f"wrote {out['handoff']} and {out['jobs']} ({out['count']} render job(s))")
            return 0
        if a.command == "build":
            out = forge.build(forge.bfp.find_roster(a.packet))
            print(f"built {out['actors']} actors → {out['import']}" + (f" ({len(out['pending'])} awaiting art)" if out["pending"] else ""))
            return 0
        steps = ("cut", "build") if a.command == "cut" else tuple(s.strip() for s in a.steps.split(",") if s.strip())
        ids = [s.strip() for s in a.ids.split(",")] if a.ids else None
        info = forge.run(a.packet, ids=ids, steps=steps, only_missing=not a.all, seed_mode="random" if a.random_seeds else "roster", retries=a.retries)
        job = forge.job(info["id"])
        shown = 0
        while job["alive"]:
            time.sleep(0.5)
            while shown < len(job["log"]):
                print(job["log"][shown])
                shown += 1
        while shown < len(job["log"]):
            print(job["log"][shown])
            shown += 1
        return 0 if job["ok"] else 1
    if a.command == "replace":
        if not a.packet:
            ap.error("replace needs <packet>")
        ids = [s.strip() for s in a.ids.split(",")] if a.ids else None
        res = forge.replace(a.packet, ids=ids, replace_website=not a.no_website,
                            replace_foundry=not a.no_foundry, replace_lead=not a.no_lead)
        print(f"replace: {res['count']} entr(ies) updated in website and Foundry for packet {a.packet}")
        for r in res["replaced"]:
            print(f"  {r['id']}: plate {r['plate']} -> website {r['website'] or 'none'}, foundry: {', '.join(r['foundry']) if r['foundry'] else 'none'}")
        return 0
    if a.command == "art-audit":
        res = forge.art_audit()
        c = res["counts"]
        print(f"art-audit - Foundry Data: {res['data'] or '(not found)'}  ·  {res['module_art_files']} module creature/portrait/token images indexed")
        print("\nmodule / system / world art the actors point at:")
        for m in res["modules"]:
            state = "installed" if m["installed"] else "NOT INSTALLED"
            print(f"  {m['module']:42s} {state:14s} {m['refs']:4d} refs, {len(m['missing']):3d} missing")
            for p in m["missing"][:5]:
                print(f"      - {p}")
        print(f"\nNPCs matched to an installed module's art by name: {len(res['module_matches'])}")
        for r in res["module_matches"]:
            print(f"  {r['name']}  ->  {str(r['thumb'])[len(FOUNDRY_ART_PREFIX):]}")
        print(f"\ncatalog: {c['rows']} characters · {c['sprites']} sprites · {c['foundry_art']} with Foundry/module art · "
              f"{c['missing']} still need art ({c.get('module_candidates', 0)} with a module-art candidate to review)")
        by = {}
        for r in res["needs"]:
            by.setdefault(r["group"] or "(none)", []).append(r)
        for g, rows in sorted(by.items(), key=lambda kv: -len(kv[1])):
            print(f"\n  {g}  ({len(rows)})")
            for r in rows:
                cand = f"   ~ candidate: {', '.join(r['module_candidates'])}" if r.get("module_candidates") else ""
                print(f"    - {r['name']}  [{r['source']}]{cand}")
        return 0
    if a.command == "import-all":
        res = forge.import_all()
        print(f"import-all: {len(res['rosters'])} roster(s) written, {res['site_entries']} website article(s) added; {res['catalog']}")
        return 0
    if a.command == "generate-missing":
        res = forge.generate_missing(packets=[a.packet] if a.packet else None, render=True, retries=a.retries)
        print(f"generate-missing: {res['queued']} queued (render={'yes' if res['can_render'] else 'no Comfy - cut + hand-off only'})")
        while forge.batch and forge.batch.get("alive"):
            time.sleep(2)
        print("\n".join(forge.batch["log"]))
        return 0
    if a.command == "remove-bg":
        if not a.packet:
            ap.error("remove-bg needs <packet>")
        ids = [s.strip() for s in a.ids.split(",")] if a.ids else None
        res = forge.remove_bg(a.packet, ids=ids)
        print(f"remove-bg: cut {res['count']} entr(ies) into transparent plates")
        forge.build(forge.bfp.find_roster(a.packet))
        return 0
    info = forge.connect()
    srv = make_server(forge, a.host, a.port)
    where = "http://%s:%d/" % ("127.0.0.1" if a.host in ("0.0.0.0", "") else a.host, srv.server_address[1])
    print("NPC Forge at %s" % where)
    print("ComfyUI: %s" % (("%s — %s" % (info["url"], info["engine"] or "no Qwen node")) if info["connected"] else "not running (open Comfy Desktop, then press Connect — drafting, cutting and building work without it)"))
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(where)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nforge closed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
