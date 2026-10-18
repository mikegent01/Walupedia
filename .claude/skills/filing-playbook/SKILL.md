---
name: filing-playbook
description: Hands-on recipes and traps for filing a session end to end on Windows — manifest edits, shard appends, props splicing, time codes, XP, exhibits, commentary vs analysis, and ComfyUI plates. Use alongside session-filing and json-stores when you are actually writing the records.
---

# Filing playbook

`session-filing` says what order to work in. This says how each step actually
goes wrong. Learned filing *The Golden Palace and the Ink Throat*.

## 0. Shell setup (Windows / Git Bash)

- `export PYTHONUTF8=1 PYTHONIOENCODING=utf-8` before any `filing-context.py`
  call, or it dies on `—` and emoji with a cp1252 error.
- `filing-context.py get` prints JSON: pipe it through `python3 -c` to print
  chosen keys truncated. Never print a whole event.
- Never `rm` with a variable or glob (`rm $D/*.png`). Use literal paths, or
  leave the file and tell the user. The user has vetoed this once.
- Do not `cd` into deep folders in a chained command; the working directory
  sticks between calls.

## 1. Adding records to the stores

- Shards are 2-space JSON arrays, UTF-8, LF, trailing newline.
  `json.dumps(arr, indent=2, ensure_ascii=False) + "\n"` round-trips them
  byte-identically — check before you append (`dumps(loads(t)) == t`).
- Append to an existing shard (locations, characters) with a small script
  that loads, asserts the id is new, appends, saves. Diffs stay clean.
- A fat year shard (~250 KB) gets a sibling file: `1040-aethel-b.json`.
- **`--build` only emits ids listed in `stores/manifest.json`.** After adding a
  record you must append its id to `order` and map it in `shards`, and bump
  `n`, for each store you touched (events, characters, locations,
  commentaries, articleAnalyses). Otherwise the build "passes" with the old
  counts and your record is silently absent. Confirm the `built … (N records)`
  line went up.
- Investigations: edit the one arc file (`mario_charred_note_file` for the
  Mario arc): append `sessions[]`, `relatedEvents[]`, bump `lastFiled`.

## 2. Dating (the checker's rules)

- Every event: `timeCode: TC:YYYY-MM-DDThh:mm/CLOCK` plus a `timeWindow`
  that says the hour is an estimate and where it is anchored (end of session).
- A `/MAT` filing dated **after the world clock** (newest filing's date) fails
  `check-timecodes.py --strict`. Date it inside the clock, or set
  `laterDated: true` on purpose. A late-arriving account can be dated earlier
  than its filing: say so in `date` ("filed late, on 5 Aethel").
- Month numbers: Efferd 06, Highsun 07, Harvestide 08, Aethel 09. `dateSort`
  on XP rows: recent filings use `YYYYMMDD` (e.g. `10400820`).
- When bulk-replacing a date string, replace inside parsed records you own,
  not in raw text: `"5 Aethel"` also matches `"15 Aethel"`.

## 3. Writing the event

- The account's own lines carry the story: keep protected dialogue verbatim
  (reveals, refrains, catchphrases, every shouted line that defines a beat).
- Inline `*WAH!` asides: own paragraph, single asterisks, ~1 per section,
  welded to the beat above. Leave one section clean.
- Banned in story prose: implies, implication, assessment, structural,
  mechanism, classification, procedural, institutional, doctrine, category,
  finding, capability, jurisdiction. A verbatim quote is the only excuse.
- Table names: the in-fiction name is fine; handles and GM names never. Unknown
  facts (who issued a badge, who paid) stay unfiled and Waluigi says so.
- `sections[]` = `{name, icon, overview, waluigi_note?}`. Add `description`
  (opener), `aftermath`, `waluigiAssessment`, `notableFeatures`.

## 4. XP, exhibits, props

- XP rows are previews: `xpKey` need not exist in `XP_SUMMARY` yet
  (precedent: `darianmarsh`). Say so in the run report. Do not hand-edit the
  ledger.
- `data/props.json` is **CRLF** and does not round-trip through `json.dumps`
  (a few escapes differ). Splice new entries as text before the closing
  `\r\n    }\r\n  }\r\n}\r\n`, 4-space indent, CRLF line ends, and
  `json.loads` the result before writing.
- Use only documented `.pd-*` classes (and `pp-*` for `passport`). Raw `<div>`
  is allowed in props, not in prose.
- Voice: the issuer on the paper, Waluigi only in `pd-margin` / `pd-wah` and
  the tile `note`. Quote the account verbatim in tables.
- Wire each prop with `[[prop:id|text]]` on the sentence that mentions it
  (event sections or `waluigiAssessment`), and list `articles[]`.
- Don't invent paper the story never named, and say plainly when fields on a
  prop (badge, receipt) are the archive's reconstruction.

## 5. Commentary vs analysis (two different pages)

- **Commentary track** (`commentaries/`): loud, petty, funny. Quips, rankings,
  scorecards, grievances, one serious beat. Waluigi roasts what the person did.
  Sections 200–400 words; the checker wants ≥240.
- **Article analysis** (`articleAnalyses/`): first person "I", an argument.
  Each section needs a `sourceAnchor` (a verbatim line), a thesis, a verdict.
- If a draft reads like an argument, move it to analysis and write the jokes
  fresh. The checker warns when the two share many 6-word phrases (quoted
  transcript lines trigger it; paraphrase the rest).
- Both need a manifest entry and the event's id in `sourceArticle`.

## 6. Front page and queue

- `mainPage.json`: `featuredArticle` + `latestUpdate` (id + excerpt); replace
  the campaign's cover in `campaignCovers`, don't stack. Round-trips cleanly.
- `SITE_UPDATES` in `index.html` is one huge line: insert with a byte-level
  `replace('let SITE_UPDATES=[', 'let SITE_UPDATES=[' + entry + ',')` after
  asserting exactly one match. Never read the file.
- `tools/rnn-scripts/pending-news-articles.json`: append
  `{id, filed, note}`; one broadcast per ~10 pending, not per event.
- `build-campaign-fronts --check` may complain about another campaign;
  that is not yours to fix.

## 7. Images (ComfyUI plates)

- Write the prompt first. New characters get no reference; known ones come from
  `portraits/`. Describe a recurring new character the same way every time.
- Drive the server with the repo's own helper, not hand-rolled workflows:
  load `tools/npc-forge.py` via importlib, `Forge().connect()`,
  `t2i_workflow(w, h)`, `mtp.workflow_fill(wf, prompt, "", prefix, seed,
  negative=...)`, `comfy.run(filled, dst, timeout=1500)`. Server on :8188.
- Sizes: scene plates 1408×768, portraits 896×1152. Run renders in the
  background with `run_in_background`; one plate takes about a minute.
- No Pillow in the default python. `ffmpeg -y -loglevel error -i x.png -q:v 3
  x.jpg` converts; `py` has PIL if you need it. Reference only the `.jpg`.
- Look at every render before wiring it. Leave the `.png` originals for the
  user to delete.
- Output: `Reputation-Matrix2/assets/images/events/<slug>/` (event + gallery
  with `alt` and `caption`), `portraits/<id>.jpg` for characters
  (`image` + `imageCaption`).

## 8. Verification (the short list)

```bash
python3 tools/build-json-stores.py --build --check
python3 tools/check-timecodes.py --strict
python3 tools/check-references.py        # PASS with ~365 legacy warnings is normal
python3 tools/check-exhibits.py          # the INVENTORY_SYSTEM warning is normal
python3 tools/check-commentaries.py
python3 tools/check-investigations.py
python3 tools/check-home-feed.py
python3 tools/check-event-art.py
python3 tools/check-covers.py
```

Grep the output for your own ids; pre-existing legacy warnings are not yours.

## 9. Close out

Run report (`docs/RUN_REPORT_FORMAT.md`): every file touched, XP rows as
previews, what was deliberately skipped (sheets rebuild, growth edits), what
was estimated (date, hour), and any leftover files the user must delete.
Shipping: branch off `gh-pages`, one purpose per PR.
