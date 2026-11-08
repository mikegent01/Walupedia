#!/usr/bin/env python3
"""Filing Desk: the deterministic half, with a fake model and a throwaway store tree.

    python tools/tests/test-filing-desk.py

No LM Studio, ComfyUI or real stores are touched.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Reputation-Matrix2" / "tools" / "local-agent"))

import desk_store as ds  # noqa: E402
from filing_desk import FilingDesk, parse_json, words  # noqa: E402

FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(("PASS  " if cond else "FAIL  ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def tree() -> Path:
    root = Path(tempfile.mkdtemp(prefix="desk-test-"))
    data = root / "Reputation-Matrix2" / "data"
    st = data / "stores"
    for sub in ("events/material", "characters", "locations"):
        (st / sub).mkdir(parents=True, exist_ok=True)
    old = {"id": "old_event", "name": "Old", "description": "x"}
    dk = {"id": "donkey_kong", "name": "Donkey Kong"}
    kb = {"id": "kongo_bongo", "name": "Kongo Bongo"}
    (st / "events/material/1040.json").write_text(json.dumps([old], indent=2) + "\n", encoding="utf-8")
    (st / "characters/material-a.json").write_text(json.dumps([dk], indent=2) + "\n", encoding="utf-8")
    (st / "locations/material-a.json").write_text(json.dumps([kb], indent=2) + "\n", encoding="utf-8")
    manifest = {
        "events": {"bundle": "events.json", "n": 1, "order": ["old_event"], "shards": {"old_event": "events/material/1040.json"}},
        "characters": {"bundle": "characters.json", "n": 1, "order": ["donkey_kong"], "shards": {"donkey_kong": "characters/material-a.json"}},
        "locations": {"bundle": "locations.json", "n": 1, "order": ["kongo_bongo"], "shards": {"kongo_bongo": "locations/material-a.json"}},
    }
    (st / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    for kind, rows in (("events", [old]), ("characters", [dk]), ("locations", [kb])):
        (data / f"{kind}.json").write_text(json.dumps(rows), encoding="utf-8")
    (data / "currentDate.json").write_text('{"year": 1040, "monthIndex": 8, "day": 5}', encoding="utf-8")
    # CRLF on purpose: undo must give these back byte for byte
    (data / "mainPage.json").write_bytes(b'{\r\n  "latestUpdate": {"id": "old_event", "label": "", "excerpt": ""}\r\n}\r\n')
    (root / "index.html").write_bytes(b'<script>\r\nlet SITE_UPDATES=[{"id":"old_event","kind":"event"}];\r\n</script>\r\n')
    (root / "tools" / "rnn-scripts").mkdir(parents=True)
    (root / "tools/rnn-scripts/pending-news-articles.json").write_text('{"pending": []}\n', encoding="utf-8")
    return root


TRANSCRIPT = (
    "mike: Late evening on the Kongo Bongo dock.\n"
    "xx_gorb99: DK picks up the lantern.\n"
    'Donkey Kong: "This thing is humming!"\n'
    'Lantern Voice: "Return me to Brasswick."\n'
    "Funky Kong arrives on a jetpack. " * 20
)


def fake_llm(system: str, prompt: str, max_tokens: int, role: str) -> str:
    calls.append(role)
    if prompt.startswith("From this session account"):
        return json.dumps({"name": "The Humming Lantern", "world": "unsorted", "location": "Kongo Bongo, the dock",
                           "newLocations": [{"name": "Brasswick", "type": "Town"}],
                           "participants": [{"name": "Donkey Kong", "role": "finds it"},
                                            {"name": "Funky Kong", "role": "flies in"},
                                            {"name": "xx_gorb99", "role": "player"}],
                           "date": {"stated": True, "year": 1041, "month": 1, "day": 2, "hour": 21, "clock": "MAT"}})
    if prompt.startswith("Write short character records"):
        return json.dumps({"characters": [{"name": "Funky Kong", "summary": "A pilot."}]})   # wrapped list
    if prompt.startswith("Plan an archive article"):
        return json.dumps({"parts": [{"heading": "Dock", "beats": "DK finds it", "lines": []},
                                     {"heading": "Jetpack", "beats": "Funky lands", "lines": []},
                                     {"heading": "North", "beats": "they leave", "lines": []}]})
    if prompt.startswith("Write Part"):
        return "## Heading the model should not write\n\n" + ("The dock creaked under the cold torchlight. " * 60) + "\n\nmike watched."
    if prompt.startswith("From this article plan"):
        return json.dumps([{"title": "T", "summary": "S", "waluigiAssessment": {"findings": ["1. a"], "recommendation": "b"},
                            "notableFeatures": "one\ntwo", "tags": ["x"]}])   # wrapped object, dict verdict
    if prompt.startswith("Here is an archive event"):
        return json.dumps({"fields": {"outcome": "New outcome."}, "rewriteParts": [2], "partNote": "tighten"})
    if prompt.startswith("Rewrite this part"):
        return "Short."   # too short: must be refused, old text kept
    return "{}"


calls: list[str] = []


def main() -> int:
    check("parse_json: fenced object with braces in strings",
          parse_json('```json\n{"a": "x}y", "b": "q\\"}"}\n```') == {"a": "x}y", "b": 'q"}'})
    check("banned words match by stem", ds.banned_word_hits("their capabilities and categories") == ["capability", "category"])
    check("banned words ignore quotes", ds.banned_word_hits('He said "the mechanism".') == [])
    handles = ds.speaker_handles(TRANSCRIPT + "Guard: halt\n", {"donkey kong"})
    check("handles: mike + discord-style, not NPC labels", "mike" in handles and "xx_gorb99" in handles and "Guard" not in handles,
          str(handles))
    tc, window, later, _ = ds.time_code({"stated": False, "hour": 22}, "material", (1040, 9, 5))
    check("time code: no date → world clock day, hour estimated", tc == "TC:1040-09-05T22:00/MAT" and "estimate" in window, tc)

    root = tree()
    try:
        store = ds.Store(root, backup_dir=root / "backups")
        check("pick_shard: missing world falls back to material",
              store.pick_shard("characters", "unsorted") == "characters/material-a.json")
        before = {p: (root / p).read_bytes() for p in ("Reputation-Matrix2/data/mainPage.json", "index.html")}
        desk = FilingDesk(store, fake_llm, run_checks=False)
        rep = desk.file_session(TRANSCRIPT)
        ev = store.get("events", rep["id"])
        blob = json.dumps(ev)
        check("event filed and in manifest", ev is not None and rep["id"] in store.manifest()["events"]["order"])
        check("location qualifier resolved to existing place", ev["location"] == "Kongo Bongo" and "kongo_bongo" in ev["relatedArticles"])
        check("unsorted world never used", "unsorted" not in json.dumps(store.manifest()))
        check("stated later date flagged laterDated", ev.get("laterDated") is True and ev["timeCode"].startswith("TC:1041-01-02"))
        check("player handles scrubbed", "mike" not in blob.lower() and "xx_gorb99" not in blob)
        check("new character stub from wrapped list", store.get("characters", "funky_kong") is not None)
        check("model's own heading stripped, desk headings used",
              "Heading the model" not in ev["description"] and ev["description"].count("\n## ") == 3)
        check("dict verdict flattened to text", isinstance(ev["waluigiAssessment"], str) and "Recommendation: b" in ev["waluigiAssessment"])
        check("notableFeatures kept as a list", ev["notableFeatures"] == ["one", "two"])
        check("CRLF kept on mainPage write", b"\r\n" in (root / "Reputation-Matrix2/data/mainPage.json").read_bytes())
        check("roles grouped: reader → writer → json",
              calls.index("writer") > max(i for i, r in enumerate(calls) if r == "reader")
              and calls.index("json") > max(i for i, r in enumerate(calls) if r == "writer"), str(calls))

        desc_before = ev["description"]
        rep2 = FilingDesk(store, fake_llm, run_checks=False).edit_event(rep["id"], "change the outcome")
        ev2 = store.get("events", rep["id"])
        check("edit: short field changed", ev2["outcome"] == "New outcome.")
        check("edit: too-short part rewrite refused, story intact", ev2["description"] == desc_before, rep2["notes"])

        # ---- images (guide: count by size, one portrait per slot, varied camera, wired in place) ----
        import desk_image as di
        check("slot budget follows the guide's table",
              (di.slot_budget(3, 1200), di.slot_budget(6, 3000), di.slot_budget(10, 5000), di.slot_budget(14, 6000)) == (2, 4, 5, 7))
        check("names: titles and generic words are not first names",
              di._mentions("the rakasha waits", {"name": "The Unnamed Rakasha", "id": "the_unnamed_rakasha"}) == 0
              and di._mentions("a Toad gathers plants", {"name": "Toad Lee", "id": "toad_lee"}) == 0
              and di._mentions("Herniva smiles", {"name": "Herniva Saltmere", "id": "herniva"}) > 0)
        portraits = root / "Reputation-Matrix2" / "portraits"
        portraits.mkdir(parents=True, exist_ok=True)
        (portraits / "donkey_kong.png").write_bytes(b"png")

        def img_llm(system, prompt, max_tokens, role):
            if prompt.startswith("An archive article has these story parts"):
                return json.dumps({"parts": [3, 2, 2, 9]})          # unordered, duplicate, out of range
            if prompt.startswith("Write one block"):
                dk = "§2" in prompt   # §2 shows Donkey Kong (has a portrait); the lead names Funky (none)
                return json.dumps({"subject": "Donkey Kong lifts the lantern" if dk else "Funky Kong on the dock",
                                   "castId": "funky_kong", "objects": ["a brass lantern", "colours: none"],
                                   "light": {"src": "torchlight"}, "mustAppear": ["lantern", "Funky Kong"] if not dk else ["lantern"],
                                   "caption": "The lantern on the dock.", "alt": "A lantern.", "text": "NONE"})
            return "{}"
        sheet = di.plan(store, FilingDesk(store, img_llm, run_checks=False), rep["id"])
        slots = sheet["slots"]
        check("plan: lead + chosen parts in story order, capped at the short-event budget (2)", [s["part"] for s in slots] == [0, 2], str([s["part"] for s in slots]))
        check("plan: portrait only for a cast member who has one",
              slots[1]["cast"] and slots[1]["cast"]["id"] == "donkey_kong" and slots[0]["cast"] is None)
        check("plan: no Python reprs or junk in prompts", not any("[" in s["prompt"] or "{" in s["prompt"] or "none" in s["prompt"].lower() for s in slots),
              slots[0]["prompt"])
        check("plan: portrait-less person flagged, dropped from must-appear, slot unticked",
              slots[0]["needsPortrait"] == ["Funky Kong"] and "Funky Kong" not in slots[0]["mustAppear"] and slots[0]["render"] is False)
        check("plan: no-people rule only on place plates",
              "No people" in slots[0]["prompt"] and "No people" not in slots[1]["prompt"])
        check("plan: camera differs per slot", len({s["camera"] for s in slots}) == len(slots))
        check("plan: house register opens every prompt", all(s["prompt"].startswith(di.REGISTER) for s in slots))
        di._wire(store, rep["id"], [{"part": 0, "image": "assets/images/events/x/l-01-lead.jpg", "caption": "Lead cap", "alt": "A"},
                                    {"part": 2, "image": "assets/images/events/x/l-02-jetpack.jpg", "caption": "A [bad] cap", "alt": "B"}])
        ev3 = store.get("events", rep["id"])
        p2 = ev3["description"].split("\n## ")[2]
        check("wire: lead on the record", ev3["image"].endswith("l-01-lead.jpg") and ev3["imageCaption"] == "Lead cap")
        check("wire: section plate after the part's first paragraph, one line mdToHtml accepts",
              re.search(r"^Jetpack\n\n[^\n]+\n\n!\[A \[bad\) cap\]\(assets/images/events/x/l-02-jetpack\.jpg\)$", p2, re.M) is not None
              or "![A (bad) cap](assets/images/events/x/l-02-jetpack.jpg)" in p2, p2[:300])
        di._wire(store, rep["id"], [{"part": 2, "image": "assets/images/events/x/l-02-jetpack-v2.jpg", "caption": "v2", "alt": ""}])
        p2b = store.get("events", rep["id"])["description"].split("\n## ")[2]
        check("wire: re-roll replaces the part's plate", p2b.count("![") == 1 and "v2" in p2b)

        def keep_llm(system, prompt, max_tokens, role):
            if prompt.startswith("Here is an archive event"):
                return json.dumps({"fields": {}, "rewriteParts": [2], "partNote": "tighten"})
            if prompt.startswith("Rewrite this part"):
                return "The jetpack roared over the cold dock. " * 40
            return "{}"
        FilingDesk(store, keep_llm, run_checks=False).edit_event(rep["id"], "tighten part 2")
        p2c = store.get("events", rep["id"])["description"].split("\n## ")[2]
        check("edit: part rewrite keeps its plate", "](assets/images/events/x/l-02-jetpack-v2.jpg)" in p2c and "roared" in p2c)

        store.save_backup("job1")
        ds.Store(root, backup_dir=root / "backups").undo("job1")
        after = {p: (root / p).read_bytes() for p in before}
        check("undo restores CRLF files byte for byte", after == before)
        check("undo removes the event from the manifest", rep["id"] not in json.loads(
            (root / "Reputation-Matrix2/data/stores/manifest.json").read_text(encoding="utf-8"))["events"]["order"])
    finally:
        shutil.rmtree(root, ignore_errors=True)
    print(f"\n{'FAIL' if FAILS else 'OK'}  {len(FAILS)} failure(s)")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
