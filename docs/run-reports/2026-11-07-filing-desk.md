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
