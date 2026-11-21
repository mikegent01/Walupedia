#!/usr/bin/env python3
"""Check the Character Sheets system: the index, the generated actors, the
quotes and the site wiring.

    python3 tools/check-sheets.py

What it proves
    coverage   every character article is either in sheets.json or listed as
               skipped with a reason; nothing is both, nothing is neither
    files      every indexed sheet file exists, parses, and is the type the
               index says (pc <-> character, npc <-> npc)
    eras       every era version (versions[]) exists, is a player-character
               sheet flagged for its character and version, sits at or below
               the XP ledger level, and carries verbatim evidence
    rules      templated actors are NPCs with unlinked tokens, deterministic
               16-char ids, no race/class/subclass/background items, and a CR
               that never exceeds the XP ledger level the site prints;
               hand-authored (bespoke) actors are player characters — linked
               token, exactly one class / species / background item, class
               level equal to the XP ledger level (the authored CR when the
               ledger is silent, never above the ledger either way)
    evidence   every quote on a generated sheet is still verbatim in the
               character's article (same normalisation as the builder)
    party      the public set is exactly the entries the builder's party rule
               produces; nobody outside Disaster Inc. is public
    packet     actors/cast/import.json is the combined packet of the folder
    wiring     index.html loads sheets.js/css, carries the data key, the
               route, the sidebar link, the article panel, the settings row,
               the search kind and the debug hook
    fresh      the committed files match a fresh build (--check round-trip)

Exit status 1 on any failure; prints one line per problem.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RM = os.path.join(ROOT, "Reputation-Matrix2")
SHEETS_JSON = os.path.join(RM, "data", "sheets.json")
INDEX_HTML = os.path.join(ROOT, "index.html")


def load_builder():
    spec = importlib.util.spec_from_file_location("build_character_sheets",
                                                  os.path.join(ROOT, "tools", "build-character-sheets.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    problems = []
    B = load_builder()
    chars = {c["id"]: c for c in B.load_characters()}
    xp = B.load_xp_summary()
    with open(SHEETS_JSON, encoding="utf-8") as fh:
        index = json.load(fh)
    sheets = index.get("sheets") or []
    skipped = index.get("skipped") or []
    ids = [s["id"] for s in sheets]
    skip_ids = [s["id"] for s in skipped]

    # coverage
    if len(ids) != len(set(ids)):
        problems.append("duplicate ids in sheets.json")
    both = set(ids) & set(skip_ids)
    for cid in sorted(both):
        problems.append(f"{cid}: both indexed and skipped")
    for cid in sorted(set(chars) - set(ids) - set(skip_ids)):
        problems.append(f"{cid}: character has neither a sheet nor a skip reason")
    for cid in sorted((set(ids) | set(skip_ids)) - set(chars)):
        problems.append(f"{cid}: in sheets.json but not in characters.json")
    for s in skipped:
        if not (s.get("reason") or "").strip():
            problems.append(f"{s.get('id')}: skipped without a reason")

    # files, rules, evidence, party
    generated = 0
    pcs = 0
    eras = 0
    for e in sheets:
        cid = e["id"]
        # the index is fetched by URL: a backslash from a Windows build is a
        # 404 on the site even though os.path.join would still find the file
        for f in [e["file"]] + [a.get("file") for a in e.get("alternates") or []] + [v.get("file") for v in e.get("versions") or []]:
            if f and "\\" in f:
                problems.append(f"{cid}: backslash in sheet path (built on Windows without normalising?): {f}")
        path = os.path.join(RM, e["file"])
        if not os.path.exists(path):
            problems.append(f"{cid}: sheet file missing: {e['file']}")
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                actor = json.load(fh)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{cid}: sheet file does not parse: {exc}")
            continue
        kind = "pc" if actor.get("type") == "character" else "npc"
        if kind != e.get("kind"):
            problems.append(f"{cid}: index says {e.get('kind')} but the actor is {actor.get('type')}")
        for a in e.get("alternates") or []:
            if not os.path.exists(os.path.join(RM, a["file"])):
                problems.append(f"{cid}: alternate file missing: {a['file']}")
        if e.get("source") == "generated":
            generated += 1
            flags = (actor.get("flags") or {}).get(B.SHEETS_FLAG) or {}
            if flags.get("characterId") != cid:
                problems.append(f"{cid}: generated actor is not flagged for this character")
            bespoke = bool(flags.get("bespoke"))
            if bespoke != (cid in B.PC_BUILD) or bespoke != (cid in B.BESPOKE):
                problems.append(f"{cid}: bespoke flag disagrees with the builder's BESPOKE / PC_BUILD tables")
            if actor.get("type") != ("character" if bespoke else "npc"):
                problems.append(f"{cid}: {'hand-authored sheets are player characters' if bespoke else 'templated sheets are npcs'}, "
                                f"not {actor.get('type')}")
            if not re.match(r"^[A-Za-z0-9]{16}$", actor.get("_id") or ""):
                problems.append(f"{cid}: bad actor _id")
            if bool((actor.get("prototypeToken") or {}).get("actorLink")) != bespoke:
                problems.append(f"{cid}: token must be {'linked for a PC' if bespoke else 'unlinked for an NPC'}")
            kinds = {}
            for it in actor.get("items") or []:
                if it.get("type") in ("race", "class", "subclass", "background"):
                    kinds[it["type"]] = kinds.get(it["type"], 0) + 1
                    if not bespoke:
                        problems.append(f"{cid}: NPC carries a {it['type']} item")
            lvl = (xp.get(cid) or {}).get("level")
            if bespoke:
                pcs += 1
                for k in ("class", "race", "background"):
                    if kinds.get(k) != 1:
                        problems.append(f"{cid}: PC sheet needs exactly one {k} item (has {kinds.get(k, 0)})")
                got = sum(((it.get("system") or {}).get("levels") or 0) for it in actor.get("items") or []
                          if it.get("type") == "class")
                want = B.pc_level((flags.get("pc") or {}).get("cr", 1), lvl)
                if got != want:
                    problems.append(f"{cid}: class level {got} != {'ledger level' if lvl is not None else 'authored CR'} {want}")
                if e.get("level") != got:
                    problems.append(f"{cid}: index level {e.get('level')} != actor level {got}")
                if kinds.get("subclass") and got < 3:
                    problems.append(f"{cid}: subclass before level 3")
                cr = (flags.get("pc") or {}).get("cr")
            else:
                cr = ((actor.get("system") or {}).get("details") or {}).get("cr")
                if e.get("cr") != cr:
                    problems.append(f"{cid}: index CR {e.get('cr')} != actor CR {cr}")
            if lvl is not None and cr is not None and cr > lvl:
                problems.append(f"{cid}: CR {cr} exceeds XP ledger level {lvl}")
            fields = B.article_text(chars[cid])
            evidence = e.get("evidence") or []
            if not evidence:
                problems.append(f"{cid}: generated sheet carries no evidence")
            for ev in evidence:
                if not B.quote_present(fields, ev.get("quote", "")):
                    problems.append(f"{cid}: quote no longer in the article: {ev.get('quote', '')[:80]!r}")
            if "<" in json.dumps(e.get("evidence") or [], ensure_ascii=False) and "<p" in json.dumps(e.get("evidence")):
                problems.append(f"{cid}: evidence contains markup")
        for v in e.get("versions") or []:
            eras += 1
            vpath = os.path.join(RM, v.get("file") or "")
            if not os.path.isfile(vpath):
                problems.append(f"{cid}/{v.get('version')}: era file missing: {v.get('file')}")
                continue
            try:
                with open(vpath, encoding="utf-8") as fh:
                    va = json.load(fh)
            except Exception as exc:  # noqa: BLE001
                problems.append(f"{cid}/{v.get('version')}: era file does not parse: {exc}")
                continue
            vflags = (va.get("flags") or {}).get(B.SHEETS_FLAG) or {}
            if vflags.get("characterId") != cid or (vflags.get("era") or {}).get("version") != v.get("version"):
                problems.append(f"{cid}/{v.get('version')}: era actor is not flagged for this character and version")
            if va.get("type") != "character" or v.get("kind") != "pc":
                problems.append(f"{cid}/{v.get('version')}: era versions are player-character sheets")
            vl = sum(((it.get("system") or {}).get("levels") or 0) for it in va.get("items") or [] if it.get("type") == "class")
            lvl = (xp.get(cid) or {}).get("level")
            if lvl is not None and vl > lvl:
                problems.append(f"{cid}/{v.get('version')}: era level {vl} exceeds XP ledger level {lvl}")
            if v.get("level") != vl:
                problems.append(f"{cid}/{v.get('version')}: index level {v.get('level')} != actor level {vl}")
            if not (v.get("evidence") or []):
                problems.append(f"{cid}/{v.get('version')}: era sheet carries no evidence")
            for ev in v.get("evidence") or []:
                if not B.quote_present(B.article_text(chars[cid]), ev.get("quote", "")):
                    problems.append(f"{cid}/{v.get('version')}: quote no longer in the article: {ev.get('quote', '')[:80]!r}")
        party, why = B.is_party(chars[cid], xp, "npc" if e.get("source") == "generated" else e.get("kind"))
        if bool(e.get("party")) != party:
            problems.append(f"{cid}: party flag {e.get('party')} disagrees with the builder's rule ({party}: {why})")
        if e.get("party") and not (e.get("partyWhy") or "").strip():
            problems.append(f"{cid}: public sheet without a partyWhy")
        if e.get("party") and e.get("group") != "Disaster Inc.":
            problems.append(f"{cid}: public sheet is not grouped under Disaster Inc.")
    meta = index.get("meta") or {}
    party_ids = sorted(s["id"] for s in sheets if s.get("party"))
    if sorted(meta.get("party") or []) != party_ids:
        problems.append("meta.party does not match the public entries")
    # the party roster (actors/folders.json players.roster): every row is a
    # public entry whose primary sheet is the player's own live sheet — and
    # the dnd5e sheet type never made anyone party (the GM builds NPCs on
    # character sheets too)
    by_id = {e["id"]: e for e in sheets}
    for row in B.ROSTER["rows"]:
        e = by_id.get(row.get("character"))
        if not e:
            problems.append(f"roster: {row.get('name')} ({row.get('character')}) has no sheet entry — is the website id right?")
            continue
        if not e.get("party"):
            problems.append(f"{e['id']}: on the party roster but not public")
        if row.get("actor") and not str(e.get("file") or "").endswith(f"-{row['actor']}.json") and e.get("source") == "live":
            problems.append(f"{e['id']}: primary sheet {e.get('file')} is not the roster's live sheet ({row['actor']})")
    for e in sheets:
        if e.get("party") and (e.get("partyWhy") or "").strip() == "player character sheet":
            problems.append(f"{e['id']}: party by sheet type alone — the roster decides who is a player character")
    counts = meta.get("counts") or {}
    if counts.get("sheets") != len(sheets) or counts.get("skipped") != len(skipped) or counts.get("generated") != generated:
        problems.append("meta.counts are stale")

    # packet
    packet = os.path.join(RM, "actors", "cast", "import.json")
    if not os.path.exists(packet):
        problems.append("actors/cast/import.json missing")
    else:
        with open(packet, encoding="utf-8") as fh:
            pk = json.load(fh)
        n = len(pk.get("actors") or [])
        if n != generated + eras:
            problems.append(f"import.json carries {n} actors, the index says {generated} generated + {eras} era versions")
        if (meta.get("counts") or {}).get("eras") != eras:
            problems.append(f"meta.counts.eras {(meta.get('counts') or {}).get('eras')} != {eras} versions indexed")
        # every cast actor files into a folder the scheme knows: a website
        # group (an era version under its era faction), the fallback — never
        # a root of its own
        scheme_path = os.path.join(RM, meta.get("folderScheme") or "actors/folders.json")
        try:
            with open(scheme_path, encoding="utf-8") as fh:
                scheme = json.load(fh)
        except (OSError, ValueError):
            scheme = {}
            problems.append(f"folder scheme {scheme_path} unreadable")
        allowed = set(scheme.get("groups") or {}) | {scheme.get("fallback") or "Elsewhere", (scheme.get("players") or {}).get("folder", "Players")}
        allowed |= {e.get("folder") for e in (scheme.get("eras") or {}).values() if isinstance(e, dict)}
        strays = sorted({str((((a.get("flags") or {}).get("waluipedia-mass-import") or {}).get("folderPath") or ["?"])[0])
                         for a in pk.get("actors") or []} - allowed)
        if strays:
            problems.append(f"import.json files cast actors under folders the scheme does not know: {strays[:5]}")
        if any(len(((a.get("flags") or {}).get("waluipedia-mass-import") or {}).get("folderPath") or []) > 2 for a in pk.get("actors") or []):
            problems.append("import.json nests a cast actor deeper than group / era")
        # a sub-folder of the cast's own is worth having only at the scheme's
        # minimum; an era sub-folder (Koopa Troop / 955 BF — Peach's Castle) is
        # shared with the era packet's actors, so one past self there is fine
        era_subs = {e.get("folder") for e in (scheme.get("eras") or {}).values() if isinstance(e, dict)}
        folders = pk.get("folders") or []
        small = [f["name"] for f in folders if f.get("path") and len(f["path"]) > 1 and f["path"][-1] not in era_subs
                 and sum(1 for a in pk.get("actors") or [] if (((a.get("flags") or {}).get("waluipedia-mass-import") or {}).get("folderPath") or []) == f["path"]) < int(scheme.get("minimum") or 1)]
        if small:
            problems.append(f"import.json keeps sub-folders below the scheme minimum: {small[:5]}")

    # wiring
    with open(INDEX_HTML, encoding="utf-8") as fh:
        html = fh.read()
    for needle, what in [
        ('assets/sheets/sheets.js', "sheets.js script tag"),
        ('assets/sheets/sheets.css', "sheets.css link"),
        ("'technology','sheets']", "sheets in DATA_FILES"),
        ("route==='sheets'", "Router route"),
        ("label:'Character Sheets'", "sidebar link"),
        ("CAST_SHEETS.characterPanel(item)", "character article panel"),
        ("row('📜','Character sheets'", "settings row"),
        ("CAST_SHEETS.searchDocs()", "search docs"),
        ("d.kind==='sheet')return 'Sheet'", "search type label"),
        ("Router.go('#/sheets/'+encodeURIComponent(d.id))", "search result route"),
        ("CAST_SHEETS.refreshSearch()", "debug toggle hook"),
        ('"route": "#/sheets"', "SITE_UPDATES card"),
    ]:
        # SITE_UPDATES is sometimes written minified ("route":"#/sheets"), so ignore the space after the colon
        if needle not in html and needle.replace('": "', '":"') not in html:
            problems.append(f"index.html wiring missing: {what}")

    # fresh
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build-character-sheets.py"), "--check"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        problems.append("builder --check failed: " + (r.stdout.strip().splitlines() or ["?"])[-1])

    if problems:
        print("\n".join(problems))
        print(f"check-sheets: {len(problems)} problem(s)")
        return 1
    print(f"check-sheets: ok ({len(sheets)} sheets, {generated} generated of which {pcs} player characters, "
          f"{eras} era versions, {len(party_ids)} public, {len(skipped)} skipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
