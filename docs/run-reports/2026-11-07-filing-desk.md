# Run report — Filing Desk (local-model filing and editing)

## 1. Files created or edited

**CREATED**
- `workflow/desk.html` — the Filing Desk chat page (`/desk`): file a session, edit an event, lead image, plain chat; live steps, checks, run report and Undo on every job.
- `workflow/desk_api.py` — background jobs for the desk, one writer at a time; per-role model calls; VRAM swap around renders.
- `workflow/desk-models.json` — model per role (reader / writer / json), contexts, swap.
- `Reputation-Matrix2/tools/local-agent/filing_desk.py` — the pipeline: facts → stubs → outline → story part by part → apparatus → file → checks; edit mode part by part.
- `Reputation-Matrix2/tools/local-agent/desk_store.py` — shard + manifest upserts, byte-exact undo backups, build and checks, time codes, rule-zero handle guard, banned words.
- `Reputation-Matrix2/tools/local-agent/desk_prompts.py` — the STORY_FORMAT_GUIDE rules each step needs.
- `Reputation-Matrix2/tools/local-agent/desk_image.py` — multi-slot image planning per IMAGE_GENERATION_GUIDE (count by filing size, portrait-only references chosen in code, no-portrait people flagged/unticked, rotating camera, six-part prompt anatomy), then ComfyUI render through `tools/make-token-plates.py`'s client, JPEG compression, and wiring (lead on the record, section plates as `![caption](path)` figures).
- `Reputation-Matrix2/tools/local-agent/desk_vram.py` — LM Studio unload/load (REST v1) and ComfyUI `/free`.
- `tools/tests/test-filing-desk.py` — 21 checks with a fake model and a temp store.
- `docs/run-reports/2026-11-07-filing-desk.md` — this report.

**EDITED**
- `workflow/server.py` — `/desk`, `/api/desk/{file,edit,sheet,render,undo,status,events}`.
- `start.py` — `http://localhost:8765/desk` starts the workflow server on demand (or restarts the panel's own copy when it predates the desk) and redirects to its `/desk`; `--workflow-port` now reaches the panel's prefs (it was ignored).
- `start.bat` — `start.bat desk`: site + workflow server, opens the Filing Desk.
- `workflow/index.html` — sidebar link to the Filing Desk.
- `workflow/README.md` — "Filing Desk — /desk" section.

## 2. Events filed

None. Three test filings of an invented session (*The Lantern of Brasswick*) and two edits were run live against the real stores with Gemma / Qwen, checked on the site, and undone. The stores, `mainPage.json`, `index.html` and the RNN queue match the branch head.

## 3. XP awarded

None. The desk does not award XP; every filing lists it as left for a person.

## 4. What is not done

- **Render is untested live:** ComfyUI was not running. Planning was tested live on *The Hag of Ferngrove Manor* (21 parts → 7 slots, 5 ticked; both Herniva beats unticked for lack of a portrait; Toad Lee's beat used `toad_lee`'s portrait). Render, compression, `/free`, the model reload and wiring are covered by unit tests only (wiring) or not at all (ComfyUI calls).
- **Leftover empty files from undo** (undo empties files a run created rather than deleting them) — delete by hand: `Reputation-Matrix2/data/stores/characters/unsorted.json`, `Reputation-Matrix2/data/stores/events/unsorted/1040.json`, `Reputation-Matrix2/data/stores/locations/material-c.json` (the last one is reused by the next filing that adds a material location, since `material-b.json` is full).
- The running workflow server (port 8787, started by `start.py`) has the old code: restart it from the panel to get `/desk`. A copy was left running on 8788 for this session.
- Not handled by the desk: XP, exhibits/props, investigation arcs, campaign covers, WAHwire posts, Foundry sheets.
- Story length: parts land at ~300–400 words with Gemma 12B at 8k context; one expansion retry runs under 250. A 3,700-word transcript gives 14 parts (~5,000 words, inside the 4,500–6,500 band), untested at that size.

## Verification

- `python tools/tests/test-filing-desk.py` — 34/34 PASS.
- `python Reputation-Matrix2/tools/local-agent/test_agent_runtime.py` — OK.
- `python tools/tests/test-control-panel.py` — 59 ok, 0 failed.
- `start.py --port 8766 --workflow-port 8789 --no-gui`: `GET /desk` with no workflow server → started it, 302 to `:8789/desk` in 3.6 s, page served.
- `node tools/tests/test-roleplay-server.mjs` — one pre-existing failure ("cast: image URLs point at the static route", data-dependent on the first character's portrait; `characters.json` and the cast code are untouched here).
- Live filing (reader/json qwen3.5-9b, writer gemma-4-12b-qat): 173 s for a 3-part filing; `build-json-stores --build --check`, `check-references`, `check-exhibits`, `check-timecodes --strict`, `check-home-feed` all PASS; article rendered at `#/article/the_lantern_of_brasswick` with three `walu-aside` callouts, no handles, no raw HTML; undo restored every file byte for byte.

## Addendum — commentary and analysis tracks, DK-run fixes (same day)

**CREATED**
- `Reputation-Matrix2/tools/local-agent/desk_tracks.py` — commentary track (COMMENTARY_MODE_GUIDE) and analysis track (ARTICLE_ANALYSES) for any filed event; checker floors measured in code with one rewrite per failing section.

**EDITED**
- `filing_desk.py` — the transcript digest gives every chunk an equal budget and trims the middle of an over-long note, never its tail (the first DK filing lost its ending); the apparatus sees every part's beats plus the ending, not the first 3,000 characters; a no-speaker-label warning; `type`/`era` flattened to one line; a repeated bold heading stripped.
- `desk_store.py` — `mainPage.json` keeps its own indent on a CRLF copy (it was re-indented to 4 spaces).
- `desk_image.py` — participants stored as bare id strings (older filings) accepted.
- `workflow/desk_api.py`, `workflow/server.py`, `workflow/desk.html` — Commentary and Analysis modes, buttons on filing cards, warnings and readability on the result card.

**Verification**
- `python tools/tests/test-filing-desk.py` — 51/51 PASS.
- Live on `the_conductors_mutiny` (qwen3.5-9b json, gemma-4-12b-qat writer): commentary 8 sections / 2,803 words, Waluigi/1k 23.2, CAPS/1k 32.1, `check-commentaries` and `check-references` PASS (~8 min); analysis 5 claims / 2,493 words, 4 cross-references, `check-references` and `check-readability` PASS (~4 min). Both undone.

**Not done**
- The user's desk filing of the DK session (`the_great_banana_disappearance_and_the_inauguration_of_dk3`, uncommitted) has factual errors from the pre-fix run: the caller and the death are attributed to Diddy, "Grandpa Kong" was stubbed instead of Cranky, the ending (sent back from Eddie da Yeti) is missing, and the summary/verdict cover only the opening voicemail. Re-file it (Undo, then file with notes above `---`) rather than commit it.
- Leftover emptied files from test undos: `stores/commentaries/the_conductors_mutiny_commentary.json`, `stores/articleAnalyses/the_conductors_mutiny_waluigi_analysis.json` (plus the three listed above).

## Addendum — salvaging failed runs (same day)

- A user DK re-filing failed at step 6 after 13 parts (~15 min): the apparatus reply was most likely cut off by `max_tokens`, and `parse_json` then returned the object's first complete inner list. `parse_json` now repairs a truncated object (backs up to the last complete value and closes it); `ask_json` retries with more room, then on a fallback model, and logs the unusable reply; the apparatus gets 2,600 tokens, falls back to the writer model, and files placeholders as a last resort.
- `filing_desk.py` checkpoints every step (`state.json`); `desk_store.py` `adopt/save_state/load_state`; `desk_api.py`/`server.py` `continue` job; `desk.html` **Continue from where it stopped** on a failed filing card.
- Tests: 58/58 PASS (truncated-JSON repair, placeholder filing, a run that dies at part 2 continues with parts 2-3 only, no duplicate stubs, one Undo for both runs).
- Not salvageable: the failed DK run `8cfb67d0f426a4e3` predates checkpoints; its stubs (characters/locations) are on disk and its Undo works. `index.html` still carries the first DK filing's `SITE_UPDATES` entry (one line; `git restore index.html` if the DK filing is abandoned — a re-filing reuses it).

## Addendum — ComfyUI model files and MOSS-Image (2026-11-08)

- A render failed with ComfyUI 400: the desk sent the Qwen-Image 2.1 default files (`qwen_image_2.1_int8_convrot`, `qwen3vl_8b_int8_convrot`, `qwen_image_2.1_vae_bf16`) to a ComfyUI that only has MOSS-Image (`moss_image_sft_int8_convrot`, `qwen3.5_9b_w4a8_gptq`, `flux2-vae_small`).
- `desk_image.py`: loader files are read from the server (studio rule: default if present, else the loader's first file; `desk-models.json` `"comfy"` pins); when the Qwen files are absent and MOSS is present, the MOSS t2i template is built in API form. MOSS has no reference input, so character slots are skipped and reported (CLAUDE.md: a known character is always drawn from `portraits/`).
- Verified on the live ComfyUI: one MOSS plate rendered in 40 s to a scratch file (not filed); LM Studio unloaded before and Gemma reloaded after. The test image ignored "empty" and filled the shelves — the guide's look-at-every-image step, and the reason "Must NOT appear" feeds the negative prompt.
- Tests: `test-filing-desk.py` 58/58 PASS.
