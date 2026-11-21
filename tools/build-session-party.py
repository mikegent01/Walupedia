#!/usr/bin/env python3
"""Build one session's party as Foundry player character sheets.

Reads a party file (``Reputation-Matrix2/data/session-parties/<session>.json``)
and writes one dnd5e ``character`` actor per member that does not already have
one into ``Reputation-Matrix2/actors/<packet>/``, filed under the party's
folder. ``tools/sheets-suite.py`` then carries that directory into the import
packet once ``actors/folders.json`` names it under ``packets`` (and lists the
folder under ``keep`` so the organizer leaves it alone after the round trip).

Each built sheet starts from ``base``, an NPC statblock the archive already
has, so the art, token and kit carry over; class, subclass, species and
background items, ability scores, saves, skills and hit points are made by the
same code that promoted the standing party's sheets
(``tools/promote-player-sheets.py`` → ``promote_convert``). Every assumption
goes into the biography so the player can revise it in Foundry.

Art: when a full-body sprite exists at ``portraits/fullbody/<stem>.png``
(``tools/fullbody-portraits.py``), the sheet and token use it; otherwise the
base's portrait.

  python3 tools/build-session-party.py Reputation-Matrix2/data/session-parties/the-feywild-house.json
  python3 tools/build-session-party.py <party.json> --check   # is the committed packet current?
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RM = os.path.join(ROOT, "Reputation-Matrix2")
ACTORS = os.path.join(RM, "actors")
MIRROR = os.path.join(ACTORS, "worlds", "midlands")
ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


PROMOTE = _load("promote_player_sheets", "tools/promote-player-sheets.py")
B = PROMOTE.B


def foundry_id(seed):
    """A stable 16-character Foundry id from a seed string."""
    n = int.from_bytes(hashlib.sha256(seed.encode("utf-8")).digest(), "big")
    out = []
    for _ in range(16):
        n, r = divmod(n, len(ALNUM))
        out.append(ALNUM[r])
    return "".join(out)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dumps(doc):
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def find_mirror_actor(aid):
    for dirpath, _dirs, files in os.walk(MIRROR):
        for fn in files:
            if fn.endswith(f"-{aid}.json"):
                return os.path.join(dirpath, fn)
    return None


def fullbody_art(img):
    """portraits/x.jpg -> portraits/fullbody/x.png when that sprite exists."""
    if not img or not img.startswith("portraits/"):
        return img
    stem = os.path.splitext(os.path.basename(img))[0]
    cand = f"portraits/fullbody/{stem}.png"
    return cand if os.path.isfile(os.path.join(RM, cand)) else img


def xp_for(member):
    level = int(member["level"])
    return {member["character"]: {"currentXP": B.XP_FOR_LEVEL[level - 1], "level": level}}


def build_member(party, m):
    base = read_json(os.path.join(ROOT, m["base"]))
    aid = foundry_id(f"{party['session']}:{m['character']}")
    live = copy.deepcopy(base)
    live["_id"] = aid
    live["name"] = m["name"]
    live["folder"] = None
    live["ownership"] = {"default": 0}
    live.pop("_stats", None)
    flags = live.setdefault("flags", {})
    flags.pop("waluipedia-sheets", None)
    promo = {
        "id": aid, "name": m["name"], "mode": "convert", "build": tuple(m["build"]),
        "level": m["level"], "ledger": m["character"], "folderPath": [party["folder"]],
        "why": f"player sheet for the session {party['session']} ({party['plan']})",
        "scores": m["scores"], "saves": tuple(m["saves"]), "skills": m["skills"],
        "languages": m["languages"], "assumptions": m["assumptions"],
    }
    PROMOTE.PROMOTED_ON = party.get("built") or PROMOTE.PROMOTED_ON
    doc = PROMOTE.promote_convert(live, promo, xp_for(m))
    doc["_id"] = aid
    art = fullbody_art(base.get("img"))
    doc["img"] = art
    tok = doc.setdefault("prototypeToken", {})
    tok.setdefault("texture", {})["src"] = art
    sheets = doc["flags"].setdefault("waluipedia-sheets", {})
    sheets["characterId"] = m["character"]
    sheets["sessionParty"] = party["session"]
    sheets["base"] = m["base"]
    doc["flags"]["waluipedia-mass-import"]["source"] = "tools/build-session-party.py"
    slug = m["character"].replace("_", "-")
    return f"fvtt-Actor-{slug}-{aid}.json", doc


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("party", help="data/session-parties/<session>.json")
    ap.add_argument("--check", action="store_true", help="verify the committed packet, write nothing")
    args = ap.parse_args(argv)
    party = read_json(args.party)
    out_dir = os.path.join(ACTORS, party["packet"])
    problems, wrote = [], []
    for m in party["members"]:
        if m.get("reuse"):
            path = find_mirror_actor(m["reuse"])
            if not path:
                problems.append(f"{m['name']}: reuse id {m['reuse']} is not in the world mirror")
                continue
            kind = read_json(path).get("type")
            if kind != "character":
                problems.append(f"{m['name']}: {m['reuse']} is a {kind}, not a character sheet — build it instead")
            print(f"  reuse  {m['name']:<12} {os.path.relpath(path, ROOT)}")
            continue
        fn, doc = build_member(party, m)
        path = os.path.join(out_dir, fn)
        text = dumps(doc)
        current = os.path.isfile(path) and open(path, encoding="utf-8").read() == text
        if args.check:
            if not current:
                problems.append(f"{m['name']}: {os.path.relpath(path, ROOT)} is missing or stale")
        elif not current:
            os.makedirs(out_dir, exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            wrote.append(fn)
        cls, sub = m["build"][0], m["build"][1]
        print(f"  build  {m['name']:<12} {cls} {m['level']} ({sub})  art {doc['img']}  -> {fn}")
    for p in problems:
        print("error:", p)
    verb = "checked" if args.check else f"wrote {len(wrote)}"
    print(f"build-session-party: {party['session']} — {verb}, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
