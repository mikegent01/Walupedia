#!/usr/bin/env python3
"""tools/spoils-to-changes.py — the loot step of filing an event, as a tool.

Builds a throwaway Reputation-Matrix2 (registry, sheets index, one mirror with
two live sheets and a manifest) and proves: a registered holding becomes a
flagged sheet item of the right type and icon; the sheet's own copy under
another name (alias, possessive, parenthetical, flag) is never doubled;
hidden slots and ``foundry: false`` stay off the sheet; a weapon without a
``foundry.system`` and an icon outside the library are problems; what the
table removed after a packet was applied is declined once and re-offered on
request; the generated file keeps its clock when nothing changed and
``--check`` says when it is stale; and finally the real registry against the
real mirror — the Feyward spoils on Hjumpik's sheet.

    python3 tools/tests/test-spoils-to-changes.py
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PY = sys.executable
RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append(bool(cond))
    print(f"  {'ok  ' if cond else 'FAIL'} {name}" + ("" if cond or not detail else f"\n       {detail}"))


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def actor(aid, name, items):
    return {"_id": aid, "name": name, "type": "character", "items": items, "flags": {}, "system": {"details": {"xp": {"value": 1}}}}


def item(name, kind="loot", flags=None):
    return {"_id": f"i{abs(hash(name)) % 10**12:012d}"[:16].ljust(16, "x"), "name": name, "type": kind, "system": {}, "flags": flags or {}}


S = load("spoils", "tools/spoils-to-changes.py")
LIB = {"icons/sundries/misc/key-brass.webp", "icons/equipment/finger/ring-band-engraved-scrolls-gold.webp",
       "icons/sundries/books/book-embossed-bound-brown.webp", "icons/containers/bags/pouch-leather-brown-green.webp",
       "icons/sundries/documents/document-bound-white-tan.webp", "icons/commodities/tech/cog-brass.webp"}

with tempfile.TemporaryDirectory() as tmp:
    rm = Path(tmp) / "Reputation-Matrix2"
    world = rm / "actors" / "worlds" / "testw"
    hj = actor("Hj1aaaaaaaaaaaaa", "Hjumpik Deldkur", [item("Warhammer", "weapon"), item("Key", "consumable")])
    eg = actor("Eg1aaaaaaaaaaaaa", "Eager", [item("Pepper Spray", "consumable"), item("Dagger", "weapon"),
                                             item("Mirror of True Reflection (custody)", "equipment"),
                                             item("Already Flagged", "loot", {"waluipedia": {"inventoryItem": "flagged_thing"}})])
    write(world / "Players" / "fvtt-Actor-hjumpik-Hj1aaaaaaaaaaaaa.json", hj)
    write(world / "Players" / "fvtt-Actor-eager-Eg1aaaaaaaaaaaaa.json", eg)
    export_path = world / "testw-all-actors.json"  # the table's truth, what the mirror was split from
    write(export_path, {"exportedAt": "2026-10-04T17:21:43.770Z", "actors": [hj, eg]})
    write(world / "manifest.json", {"exportedAt": "2026-10-04T17:21:43.770Z", "source": "testw-all-actors.json"})
    sheets = {"sheets": [
        {"id": "hjumpik", "name": "Hjumpik Deldkur", "sheetName": "Hjumpik Deldkur", "source": "live", "party": True,
         "file": "actors/worlds/testw/Players/fvtt-Actor-hjumpik-Hj1aaaaaaaaaaaaa.json"},
        {"id": "eager", "name": "Eager", "sheetName": "Eager", "source": "live", "party": True,
         "file": "actors/worlds/testw/Players/fvtt-Actor-eager-Eg1aaaaaaaaaaaaa.json"},
        {"id": "nobody", "name": "Nobody", "sheetName": "Nobody", "source": "live", "party": False,
         "file": "actors/worlds/testw/Players/fvtt-Actor-hjumpik-Hj1aaaaaaaaaaaaa.json"},
        {"id": "ghost", "name": "Ghost", "sheetName": "Ghost", "source": "generated", "party": True, "file": "actors/cast/x.json"},
    ]}
    write(rm / "data" / "sheets.json", sheets)
    registry = {
        "items": {
            "morel_key": {"name": "Mystic Morel’s Feyward Key", "type": "Key / Escape Lead", "rarity": "Rare", "visibility": "known",
                          "summary": "A key tossed to Hjumpik.", "features": ["Opens something."], "obtained": "Tossed.",
                          "waluigi": "Never only a key.", "relatedArticles": ["feyward_amnesia_vines_morel_steely", "hjumpik"]},
            "soul_ring": {"name": "The OC Soul Ring", "type": "Soul-Capture Ring", "visibility": "known", "summary": "A ring with a Lady in it.",
                          "relatedArticles": []},
            "hidden": {"name": "Unconfirmed Item Slot", "type": "Unknown", "visibility": "rumored", "summary": "?"},
            "private": {"name": "Private Thing", "type": "Book", "visibility": "known", "summary": "not for the table", "foundry": False},
            "pepper": {"name": "Eager’s Pepper Spray", "type": "Improvised Tool", "visibility": "known", "summary": "spray"},
            "simple_dagger": {"name": "Simple Dagger", "type": "Weapon", "visibility": "known", "summary": "dagger", "foundry": {"aliases": ["Dagger"]}},
            "mirror": {"name": "Mirror of True Reflection", "type": "Portal Artifact / Revelation Tool", "visibility": "known", "summary": "mirror"},
            "flagged_thing": {"name": "Renamed At The Table", "type": "Book", "visibility": "known", "summary": "book"},
            "revolver": {"name": "Eager’s Revolver", "type": "Firearm", "visibility": "known", "summary": "bang", "foundry": {"type": "weapon"}},
            "bad_icon": {"name": "Odd Thing", "type": "Book", "visibility": "known", "summary": "x", "foundry": {"img": "icons/nope.webp"}},
            "tea_book": {"name": "Tea Leaf Syndicate Tea Book", "type": "Book / Cultural Doctrine", "visibility": "known", "summary": "tea",
                         "description": "Read; learned [[prop:prop_x|nothing]]."},
        },
        "inventories": {
            "hjumpik": [{"itemId": "morel_key", "status": "received", "known": True}, {"itemId": "soul_ring", "status": "custody", "known": True},
                        {"itemId": "hidden", "status": "?", "known": False}, {"itemId": "private", "status": "x", "known": True},
                        {"itemId": "missing_from_registry", "status": "x", "known": True}],
            "eager": [{"itemId": "pepper", "status": "carried", "known": True}, {"itemId": "simple_dagger", "status": "thrown", "known": True},
                      {"itemId": "mirror", "status": "held", "known": True}, {"itemId": "flagged_thing", "status": "kept", "known": True},
                      {"itemId": "revolver", "status": "?", "known": True}, {"itemId": "bad_icon", "status": "?", "known": True},
                      {"itemId": "tea_book", "status": "read; learned nothing", "known": True}],
            "nobody": [{"itemId": "tea_book", "status": "x", "known": True}],
            "ghost": [{"itemId": "tea_book", "status": "x", "known": True}],
        },
    }
    write(rm / "data" / "inventory.json", registry)
    events = {"feyward_amnesia_vines_morel_steely"}
    kw = dict(root_rm=str(rm), inventory_path=str(rm / "data" / "inventory.json"), sheets_path=str(rm / "data" / "sheets.json"),
              lib=LIB, events=events, now="2026-10-05T10:00:00Z", filed_on="2026-10-05")

    doc, rep = S.generate("testw", party_only=True, **kw)

    # A later registry addition must not make every still-pending item appear
    # newly filed; preserve each existing item's original flag date.
    registry["items"]["second_key"] = {"name": "A Second Key", "type": "Key", "visibility": "known", "summary": "another key"}
    registry["inventories"]["hjumpik"].append({"itemId": "second_key", "status": "received", "known": True})
    write(rm / "data" / "inventory.json", registry)
    growth, _ = S.generate("testw", party_only=True, previous=doc,
                           **{**kw, "now": "2026-10-06T10:00:00Z", "filed_on": "2026-10-06"})
    growth_hj = next(c for c in growth["changes"] if c["match"]["_id"] == "Hj1aaaaaaaaaaaaa")
    growth_dates = {i["flags"]["waluipedia"]["inventoryItem"]: i["flags"]["waluipedia"]["filedOn"]
                    for i in growth_hj["addItems"]}
    check("adding a new holding preserves existing filedOn dates and dates the new item today",
          growth_dates["morel_key"] == "2026-10-05" and growth_dates["second_key"] == "2026-10-06",
          json.dumps(growth_dates))
    registry["items"].pop("second_key")
    registry["inventories"]["hjumpik"].pop()
    write(rm / "data" / "inventory.json", registry)

    by_actor = {c["match"]["_id"]: c for c in doc["changes"]}
    hj_items = {i["flags"]["waluipedia"]["inventoryItem"]: i for i in by_actor["Hj1aaaaaaaaaaaaa"]["addItems"]}
    eg_items = {i["flags"]["waluipedia"]["inventoryItem"]: i for i in by_actor["Eg1aaaaaaaaaaaaa"]["addItems"]}
    check("a registered holding becomes a sheet item: Morel's key is loot with the key icon, flagged with its inventory id, the event and the status",
          set(hj_items) == {"morel_key", "soul_ring"} and hj_items["morel_key"]["type"] == "loot"
          and hj_items["morel_key"]["img"] == "icons/sundries/misc/key-brass.webp"
          and hj_items["morel_key"]["flags"]["waluipedia"]["event"] == "feyward_amnesia_vines_morel_steely"
          and hj_items["morel_key"]["flags"]["waluipedia"]["note"] == "received"
          and hj_items["morel_key"]["flags"]["waluipedia"]["filedOn"] == "2026-10-05", json.dumps(list(hj_items)))
    check("the description carries the summary, the features, how it was obtained, the record's status and Waluigi's line, escaped",
          all(s in hj_items["morel_key"]["system"]["description"]["value"] for s in
              ("<p>A key tossed to Hjumpik.</p>", "<li>Opens something.</li>", "<em>Obtained:</em> Tossed.", "<em>On the record:</em> received.",
               "<blockquote>Never only a key. — W.</blockquote>", "<code>morel_key</code>")),
          hj_items["morel_key"]["system"]["description"]["value"])
    check("a ring is equipment (trinket) with the ring icon; its id is deterministic (actor id + inventory id)",
          hj_items["soul_ring"]["type"] == "equipment" and hj_items["soul_ring"]["system"]["type"]["value"] == "trinket"
          and hj_items["soul_ring"]["img"].endswith("ring-band-engraved-scrolls-gold.webp")
          and hj_items["soul_ring"]["_id"] == S.sid("Hj1aaaaaaaaaaaaa", "inventory", "soul_ring"))
    check("the sheet's own copies are recognised — possessive (Eager's Pepper Spray = Pepper Spray), alias (Simple Dagger = Dagger), "
          "parenthetical (Mirror … (custody)), the flag (renamed at the table) — none is doubled",
          set(eg_items) == {"tea_book", "revolver", "bad_icon"} and len(rep["present"]) == 4
          and any("'Pepper Spray'" in line for line in rep["present"]) and any("'Dagger'" in line for line in rep["present"])
          and any("(custody)" in line for line in rep["present"]) and any("'Already Flagged'" in line for line in rep["present"]),
          json.dumps(rep["present"]))
    check("hidden slots and foundry:false stay off the sheet; a holding the registry lacks is a problem, not a crash",
          sum(1 for line in rep["skipped"] if "not public" in line) == 1 and sum(1 for line in rep["skipped"] if "foundry: false" in line) == 1
          and any("missing_from_registry" in p for p in rep["problems"]), json.dumps(rep["skipped"] + rep["problems"]))
    check("foundry.type weapon without foundry.system and an icon outside the library are problems (the weapon is filed as loot meanwhile)",
          any("Revolver" in p and "weapon" in p for p in rep["problems"]) and any("icons/nope.webp" in p for p in rep["problems"])
          and eg_items["revolver"]["type"] == "loot", json.dumps(rep["problems"]))
    check("[[prop:…|label]] markup is flattened in the description and the book gets the book icon",
          "learned nothing." in eg_items["tea_book"]["system"]["description"]["value"]
          and "[[" not in eg_items["tea_book"]["system"]["description"]["value"]
          and eg_items["tea_book"]["img"].endswith("book-embossed-bound-brown.webp"))
    check("party only: the non-party live sheet and the generated sheet are left alone; --all brings the live one in",
          "Nobody" not in json.dumps(doc) and any(c["match"]["name"] == "Hjumpik Deldkur" for c in S.generate("testw", party_only=False, **kw)[0]["changes"]))
    check("appliesTo carries the mirror's export stamp; filed remembers every item that came through, by actor id / item id",
          doc["appliesTo"] == {"world": "testw", "exportedAtOrBefore": "2026-10-04T17:21:43.770Z"}
          and set(doc["filed"]) == {"Hj1aaaaaaaaaaaaa/morel_key", "Hj1aaaaaaaaaaaaa/soul_ring", "Eg1aaaaaaaaaaaaa/tea_book",
                                    "Eg1aaaaaaaaaaaaa/revolver", "Eg1aaaaaaaaaaaaa/bad_icon"} and doc["filed"]["Hj1aaaaaaaaaaaaa/morel_key"] == "2026-10-05T10:00:00Z",
          json.dumps(doc["filed"]))

    # the bridge applies it and the items land on the mirror
    out = rm / "actors" / "changes" / "spoils-testw.json"
    write(out, doc)
    r = subprocess.run([PY, str(ROOT / "tools" / "foundry-bridge.py"), "apply", str(out), str(world), "--write"], capture_output=True, text=True)
    hj_after = json.loads((world / "Players" / "fvtt-Actor-hjumpik-Hj1aaaaaaaaaaaaa.json").read_text(encoding="utf-8"))
    check("tools/foundry-bridge.py apply puts them on the mirror (0 problems)", r.returncode == 0 and "0 problem(s)" in r.stdout
          and sum(1 for i in hj_after["items"] if (i.get("flags") or {}).get("waluipedia", {}).get("inventoryItem")) == 2, r.stdout[-300:] + r.stderr[-300:])
    doc2, rep2 = S.generate("testw", party_only=True, previous=doc, **{**kw, "now": "2026-10-05T11:00:00Z"})
    check("run again over the applied mirror: the table has not seen them yet (no export carries them), so the same items are generated again — "
          "same ids, the filed clock kept, the file stable",
          S.same_apart_from_time(doc, doc2) and doc2["filed"]["Hj1aaaaaaaaaaaaa/morel_key"] == "2026-10-05T10:00:00Z"
          and {i["_id"] for c in doc2["changes"] for i in c["addItems"]} == {i["_id"] for c in doc["changes"] for i in c["addItems"]},
          json.dumps([c["match"] for c in doc2["changes"]]))
    # the table took them: an export (the manifest's source) now carries what the apply put on both sheets
    eg_after = json.loads((world / "Players" / "fvtt-Actor-eager-Eg1aaaaaaaaaaaaa.json").read_text(encoding="utf-8"))
    write(export_path, {"exportedAt": "2026-10-06T20:00:00Z", "actors": [hj_after, eg_after]})
    write(world / "manifest.json", {"exportedAt": "2026-10-06T20:00:00Z", "source": "testw-all-actors.json"})
    doc2b, rep2b = S.generate("testw", party_only=True, previous=doc2, **{**kw, "now": "2026-10-06T21:00:00Z"})
    check("once an export carries them (matched by the flag) nothing is generated for Hjumpik; the filed clock is kept for later",
          "Hj1aaaaaaaaaaaaa" not in {c["match"]["_id"] for c in doc2b["changes"]} and sum(1 for line in rep2b["present"] if "morel_key" in line) == 1
          and doc2b["filed"]["Hj1aaaaaaaaaaaaa/morel_key"] == "2026-10-05T10:00:00Z", json.dumps([c["match"] for c in doc2b["changes"]] + rep2b["present"]))

    # the table removed the ring after a packet was applied: a new export without it, lastSync says applied after `filed`
    hj_after["items"] = [i for i in hj_after["items"] if (i.get("flags") or {}).get("waluipedia", {}).get("inventoryItem") != "soul_ring"]
    write(world / "Players" / "fvtt-Actor-hjumpik-Hj1aaaaaaaaaaaaa.json", hj_after)
    write(export_path, {"exportedAt": "2026-10-06T20:00:00Z", "actors": [hj_after, eg_after]})
    write(world / "manifest.json", {"exportedAt": "2026-10-06T20:00:00Z", "source": "testw-all-actors.json", "lastSync": {"applied": {"stamp": "data:x", "at": "2026-10-06T19:00:00Z"}, "seen": "data:x"}})
    doc3, rep3 = S.generate("testw", party_only=True, previous=doc2, **{**kw, "now": "2026-10-07T09:00:00Z"})
    check("declined: the ring is gone from a later export and the world applied a packet after it was filed — it is not re-added, it is listed under declined with why",
          "Hj1aaaaaaaaaaaaa" not in {c["match"]["_id"] for c in doc3["changes"]} and len(doc3["declined"]) == 1
          and doc3["declined"][0]["itemId"] == "soul_ring" and doc3["declined"][0]["appliedAt"] == "2026-10-06T19:00:00Z"
          and any("dropped at the table" in line for line in rep3["declined"]), json.dumps([doc3["declined"], rep3["declined"]]))
    doc4, rep4 = S.generate("testw", party_only=True, previous=doc3, **{**kw, "now": "2026-10-08T09:00:00Z"})
    check("…and stays declined on the next run (no re-add, the row kept)", len(doc4["declined"]) == 1 and "Hj1aaaaaaaaaaaaa" not in {c["match"]["_id"] for c in doc4["changes"]}
          and any("declined at the table" in line for line in rep4["declined"]))
    registry["inventories"]["hjumpik"][1]["foundry"] = True
    write(rm / "data" / "inventory.json", registry)
    doc5, _ = S.generate("testw", party_only=True, previous=doc4, **{**kw, "now": "2026-10-09T09:00:00Z"})
    check("foundry: true on the holding re-offers it (the declined row is overridden)",
          any(i["flags"]["waluipedia"]["inventoryItem"] == "soul_ring" for c in doc5["changes"] for i in c["addItems"]))
    registry["inventories"]["hjumpik"][1].pop("foundry")
    write(rm / "data" / "inventory.json", registry)
    # a packet applied BEFORE the item was filed proves nothing — the item is offered again, not declined
    write(world / "manifest.json", {"exportedAt": "2026-10-06T20:00:00Z", "source": "testw-all-actors.json", "lastSync": {"applied": {"stamp": "data:x", "at": "2026-10-05T09:00:00Z"}}})
    doc6, _ = S.generate("testw", party_only=True, previous=doc2, **{**kw, "now": "2026-10-07T09:00:00Z"})
    check("an apply older than the filing proves nothing: the missing ring is offered again, nothing declined",
          not doc6["declined"] and any(i["flags"]["waluipedia"]["inventoryItem"] == "soul_ring" for c in doc6["changes"] for i in c["addItems"]))
    check("same_apart_from_time ignores the clock only", S.same_apart_from_time(doc, {**doc, "filed": {k: "2000-01-01T00:00:00Z" for k in doc["filed"]}})
          and not S.same_apart_from_time(doc, doc2b))

# the real registry against the real mirror
r = subprocess.run([PY, str(ROOT / "tools" / "spoils-to-changes.py"), "--check"], capture_output=True, text=True)
check("the real file is current (python3 tools/spoils-to-changes.py --check)", r.returncode == 0 and "file current" in r.stdout, r.stdout[-400:] + r.stderr[-400:])
real = json.loads((ROOT / "Reputation-Matrix2" / "actors" / "changes" / "spoils-midlands.json").read_text(encoding="utf-8"))
hj_real = next((c for c in real["changes"] if c["match"]["_id"] == "Qir5aDX8bkL5lt1c"), None)
hj_names = [i["name"] for i in (hj_real or {}).get("addItems", [])]
mirror_hj = json.loads((ROOT / "Reputation-Matrix2" / "actors" / "worlds" / "midlands" / "Players" / "fvtt-Actor-hjumpik-deldkur-Qir5aDX8bkL5lt1c.json").read_text(encoding="utf-8"))
flagged = sorted((i.get("flags") or {}).get("waluipedia", {}).get("inventoryItem") for i in mirror_hj["items"] if (i.get("flags") or {}).get("waluipedia", {}).get("inventoryItem"))
SPOIL_IDS = {"oc_soul_ring", "raventree_signet_ring", "morel_feyward_key", "steely_rusted_fragments",
             "book_of_revised_history", "woodfellow_library_card", "hjumpik_wolf_pelt_onesie"}
filed_hj = {k.split("/", 1)[1] for k in real.get("filed", {}) if k.startswith("Qir5aDX8bkL5lt1c/")}
check("Feyward spoils: Hjumpik's seven are either still offered by the changes file or filed as applied — and the mirror carries them flagged",
      ({"The OC Soul Ring", "The Raventree Signet Ring", "Mystic Morel’s Feyward Key", "Steely’s Rusted Fragments", "The Book of Revised History",
        "Woodfellow Library Card", "Hjumpik’s Wolf-Pelt Onesie"} <= set(hj_names) or SPOIL_IDS <= filed_hj)
      and SPOIL_IDS <= set(flagged), json.dumps([hj_names, flagged, sorted(filed_hj)]))
check("every generated icon is in the image library and every generated item has the inventory flag",
      all(i["img"] in S.load_library() and i["flags"]["waluipedia"]["inventoryItem"] for c in real["changes"] for i in c["addItems"]))
# 1.9: a write pass that changes nothing leaves the file's bytes AND mtime alone (the suite's --watch keys on mtimes and re-ran itself every pass)
_real_path = ROOT / "Reputation-Matrix2" / "actors" / "changes" / "spoils-midlands.json"
_before = (_real_path.stat().st_mtime_ns, _real_path.read_bytes())
w = subprocess.run([PY, str(ROOT / "tools" / "spoils-to-changes.py")], capture_output=True, text=True)
check("a write pass over a current file says 'unchanged' and does not touch it (same bytes, same mtime)",
      w.returncode == 0 and "unchanged" in w.stdout and "wrote" not in w.stdout and (_real_path.stat().st_mtime_ns, _real_path.read_bytes()) == _before, w.stdout[-300:])
with tempfile.TemporaryDirectory() as tmp2:
    p2 = os.path.join(tmp2, "x.json")
    first = S.write_json(p2, {"a": 1})
    m1 = os.stat(p2).st_mtime_ns
    second = S.write_json(p2, {"a": 1})
    third = S.write_json(p2, {"a": 2})
    check("write_json returns True when it wrote, False when the file already held those bytes", first is True and second is False and third is True and (os.stat(p2).st_mtime_ns >= m1))

print(f"spoils-to-changes: {sum(RESULTS)} ok, {len(RESULTS) - sum(RESULTS)} failed")
sys.exit(0 if all(RESULTS) else 1)
