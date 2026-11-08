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
                           "date": {"stated": True, "year": 1041, "month": 1, "day": 2, "hour": 21, "clock": "MAT"},
                           "type": "political drama\n\neconomic collapse\n- war"})
    if prompt.startswith("Write short character records"):
        return json.dumps({"characters": [{"name": "Funky Kong", "summary": "A pilot."}]})   # wrapped list
    if prompt.startswith("Plan an archive article"):
        return json.dumps({"parts": [{"heading": "Dock", "beats": "DK finds it", "lines": []},
                                     {"heading": "Jetpack", "beats": "Funky lands", "lines": []},
                                     {"heading": "North", "beats": "they leave", "lines": []}]})
    if prompt.startswith("Write Part"):
        return "## Heading the model should not write\n\n**Dock**\n\n" + ("The dock creaked under the cold torchlight. " * 60) + "\n\nmike watched."
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
        mp = (root / "Reputation-Matrix2/data/mainPage.json").read_bytes()
        check("CRLF kept on mainPage write", b"\r\n" in mp)
        check("mainPage keeps its 2-space indent on a CRLF copy", b'\r\n  "latestUpdate"' in mp and b'\r\n    "latestUpdate"' not in mp)
        check("type flattened to one line", ev["type"] == "political drama / economic collapse / war", ev["type"])
        check("repeated bold heading stripped", "**Dock**" not in ev["description"])

        # the digest must keep the ending (the DK run lost its cliffhanger to a tail cut)
        long_t = ("Opening beat. " * 900) + "\nEddie: \"It is not your time.\" THE-ENDING-LINE"

        def digest_llm(system, prompt, max_tokens, role):
            if prompt.startswith("Summarise this part"):
                body = prompt.split("PART ", 1)[-1]
                tail = " THE-ENDING-LINE" if "THE-ENDING-LINE" in body else " beat"
                return ("- a beat " * 400) + tail        # every note overflows its share
            return "{}"
        dg = FilingDesk(store, digest_llm, run_checks=False, digest_chars=4000).digest(long_t)
        check("digest fits the window", len(dg) <= 4010, str(len(dg)))
        check("digest keeps the ending line, never cuts the tail", dg.rstrip().endswith("THE-ENDING-LINE"), dg[-200:])
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

        # ---- commentary + analysis tracks (same desk, different prompts) ----
        import desk_tracks as dt
        fixed: list[str] = []

        def track_llm(system, prompt, max_tokens, role):
            calls.append(role)
            if prompt.startswith("Plan Waluigi's Cut"):
                return json.dumps({"conceit": "screening the footage at a projector", "subtitle": "In Which Waluigi Screams",
                                   "standfirst": "Waluigi watches the dock tape.", "headings": ["THE DOCK", "", "NORTH!"]})
            if prompt.startswith("Write section") and "Waluigi's Cut" in prompt:
                return ("Waluigi leans in. STOP THE TAPE. " * 30 + '\n\n"The dock creaked under the cold torchlight." WAH! '
                        + ('"I am a quote nobody ever said aloud."' if not fixed else "") + " Waluigi was FILED and RULED.")
            if prompt.startswith("Rewrite this section of Waluigi's commentary"):
                fixed.append("x")
                return "Waluigi howls. NO NO NO. " * 40 + '\n\n"The dock creaked under the cold torchlight." WAH!'
            if prompt.startswith("Plan Waluigi's Article Analysis"):
                return json.dumps({"subtitle": "The lantern was never the point", "summary": "The dock decided it.",
                                   "claims": [{"heading": f"Claim {k}", "sourceAnchor": "The dock creaked under the cold torchlight." if k != 2 else "A line nobody wrote",
                                               "parts": [1], "crossRef": "old_event"} for k in range(1, 6)]})
            if prompt.startswith("Write the THESIS") or prompt.startswith("Write the VERDICT"):
                return "The lamp is low. I read it twice. " * 10          # 80 words: must be lengthened
            if prompt.startswith("This is ") and "it must be at least" in prompt:
                return "The lamp is low and the tea is cold. I read it again. " * 30
            if prompt.startswith("Write section") and "of the analysis" in prompt:
                return "I hold the page to the lamp. I think the dock was the point. " * 40 + "\n\n\"The dock creaked under the cold torchlight.\""
            return "{}"

        calls.clear()
        tr = dt.Tracks(store, FilingDesk(store, track_llm, run_checks=False))
        rc = tr.commentary(rep["id"])
        com = store.get("commentaries", rc["id"])
        cblob = " ".join(s["body"] for s in com["sections"])
        check("commentary: filed one-file-per-id and in the manifest",
              rc["shard"] == f"commentaries/{rep['id']}_commentary.json" and com["sourceArticle"] == rep["id"])
        check("commentary: one section per source beat, heading fallback for a blank one",
              len(com["sections"]) == 3 and com["sections"][1]["heading"] == "JETPACK" and com["sections"][0]["heading"] == "THE DOCK",
              str([s["heading"] for s in com["sections"]]))
        check("commentary: invented quote and ledger words rewritten away",
              "nobody ever said" not in cblob and not re.search(r"\b(filed|ruled)\b", cblob, re.I) and fixed)
        check("commentary: timeCode on the commentary clock, kicker, pullQuote",
              com["timeCode"].endswith("/COM") and com["kicker"].startswith("Waluigi's Cut") and com["pullQuote"])
        check("commentary: notes the <6 sections the short source allows", any("source has only 3 beats" in n for n in tr.notes), tr.notes)
        check("commentary: plan on json, prose on writer", calls[0] == "json" and set(calls[1:]) == {"writer"}, str(calls[:6]))

        ra = tr.analysis(rep["id"])
        ana = store.get("articleAnalyses", ra["id"])
        check("analysis: filed with the guide's fields",
              all(k in ana for k in ("kicker", "archivist", "filed", "summary", "thesis", "sections", "verdict"))
              and ana["kicker"] == "Waluigi's Article Analysis" and ana["title"] == ev2["title"])
        check("analysis: 5 claim sections, each with a sourceAnchor found in the event",
              len(ana["sections"]) == 5 and all(s["sourceAnchor"] and "nobody wrote" not in s["sourceAnchor"] for s in ana["sections"]))
        check("analysis: short thesis/verdict lengthened to the 180-word floor",
              len(ana["thesis"].split()) >= 180 and len(ana["verdict"].split()) >= 180)
        check("analysis: relatedArticles starts with the source, existing ids only",
              ana["relatedArticles"][0] == rep["id"] and all(i for i in ana["relatedArticles"]))
        check("participants as bare id strings (old filings) are accepted",
              dt.pid("donkey_kong") == "donkey_kong" and dt.pid({"id": "x"}) == "x"
              and dt.related_events(store, {"id": "z", "participants": ["donkey_kong"], "relatedArticles": []}) is not None)
        rc2 = tr.commentary(rep["id"])
        check("tracks: writing it again replaces, never duplicates",
              store.manifest()["commentaries"]["order"].count(rc2["id"]) == 1)

        # ---- salvage: truncated JSON, apparatus fallback, checkpoint + continue ----
        cut = '{"title": "T", "summary": "S", "notableFeatures": ["a", "b"], "aftermath": "half a sent'
        check("parse_json repairs a reply cut off mid-object (not its inner list)",
              parse_json(cut) == {"title": "T", "summary": "S", "notableFeatures": ["a", "b"]}, str(parse_json(cut)))

        def broken_apparatus(system, prompt, max_tokens, role):
            if prompt.startswith("From this article plan"):
                return '["only", "a", "list"]'          # unusable on every model
            return fake_llm(system, prompt, max_tokens, role)
        rep_ph = FilingDesk(store, broken_apparatus, run_checks=False).file_session(TRANSCRIPT + " Placeholder run.")
        ev_ph = store.get("events", rep_ph["id"])
        check("apparatus failure files the story with placeholders and says so",
              ev_ph and ev_ph["description"].count("\n## ") == 3 and any("PLACEHOLDERS" in m for m in rep_ph["manual"]))

        saved: dict = {}
        boom = {"armed": True}
        writes: list[int] = []

        def dies_at_part_2(system, prompt, max_tokens, role):
            if prompt.startswith("Write Part"):
                writes.append(int(prompt.split("Write Part ", 1)[1].split()[0]))
                if boom["armed"] and prompt.startswith("Write Part 2 "):
                    raise ValueError("LM Studio answered 500")
            return fake_llm(system, prompt, max_tokens, role)
        s2 = ds.Store(root, backup_dir=root / "backups")
        d2 = FilingDesk(s2, dies_at_part_2, run_checks=False, checkpoint=lambda st: saved.update(json.loads(json.dumps(st))))
        try:
            d2.file_session(TRANSCRIPT + " Second session at the dock.")
            died = False
        except ValueError:
            died = True
        s2.save_backup("failedjob")
        stub_count = sum(1 for i in s2.manifest()["characters"]["order"] if i.startswith("funky_kong"))
        check("a failed run leaves a checkpoint with the parts it wrote",
              died and len(saved.get("body") or []) == 1 and "filed" in saved and saved.get("transcript"))
        boom["armed"] = False
        writes.clear()
        s3 = ds.Store(root, backup_dir=root / "backups")
        s3.adopt("failedjob")
        rep3 = FilingDesk(s3, dies_at_part_2, run_checks=False).file_session(saved["transcript"], saved["hints"], state=saved)
        ev3 = s3.get("events", rep3["id"])
        check("continue writes only the missing parts", writes == [2, 3], str(writes))
        check("continue files no duplicate stubs",
              sum(1 for i in s3.manifest()["characters"]["order"] if i.startswith("funky_kong")) == stub_count)
        check("continued event has every part", ev3 and ev3["description"].count("\n## ") == 3)
        check("continue adopts the failed run's originals (one Undo for both)",
              set(s2.touched) <= set(s3.touched) and all(s3.touched[k] == v for k, v in s2.touched.items()))

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
