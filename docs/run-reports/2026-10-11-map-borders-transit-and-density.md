# Run report — map overhaul: borders, transit, density, labels

Date: 2026-10-11 · Branch: `gh-pages` (worked in place at the user's instruction)

## Run report

**Files**

CREATED
  `Reputation-Matrix2/app/pages/maps/map-province-arcs.js`   ~370 lines — shared-arc border topology, smoothing, pin guard
  `tools/tests/test-map-province-arcs.mjs`                   12 checks over all 25 `_full` realms
  `docs/run-reports/2026-10-11-map-borders-transit-and-density.md`  this report

EDITED
  `Reputation-Matrix2/app/pages/maps/atlas-map-v2.js`   fills and ink drawn from arcs; routes via the transit engine; route dossier on click; layer order; auto density; label anchors and cap
  `Reputation-Matrix2/app/pages/maps/atlas-map-v2.css`  `.atlas-v2-edge` fill/join; capacity weight, status styles, route hit target
  `Reputation-Matrix2/app/pages/maps/map-transit.js`    `air` mode, route-mode alias table, `waypointPathD`, `networkFromRoutes`, `assembleNetwork` extracted, dossier status/capacity rows
  `Reputation-Matrix2/data/maps/map-routes.js`          `air` mode; per-route `name`, `line`, `status`, `capacity`; `ROUTE_STATUS`, `ROUTE_CAPACITY`; `degree`, `lines`
  `Reputation-Matrix2/app/pages/maps/maps.js`           deprecation header only (legacy page kept: nav menu and `*-maps.html` redirects still land on it)
  `index.html`                                          cache tokens `atlas-map-v2.{js,css}?v=map20` → `map21` (4 occurrences)
  `tools/check-all.py`                                  + province border arcs, transport routes, atlas border geometry (when jsdom present)
  `tools/tests/atlas-borders-geometry.mjs`              reads path edges, even-odd sides
  `tools/tests/atlas-routes-smoke.mjs`                  + capacity/status, layer order, click-to-dossier
  `tools/tests/atlas-modes-smoke.mjs`                   density cycle now auto → all → key
  `tools/tests/atlas-fullscreen-smoke.mjs`              marker floor lowered for auto density
  `tools/tests/test-map-lenses.mjs`                     default sheet is key-only; `pinDensity:'all'` draws every pin
  `tools/tests/test-map-transit.mjs`                    6 modes; waypoint, adapter and dossier checks

GENERATED   none touched. `provinceCensus.json` not regenerated.
DELETED     none. (Legacy `maps-view.html` / `maps.js` family is still reachable and was deprecated, not removed.)

**Events filed** — none (code run)
**XP** — No XP awarded this run
**Index** — not applicable
**RNN** — not applicable

## Verification

| Command | Result |
|---|---|
| `node tools/tests/test-map-province-arcs.mjs` | 12 passed — 785 arcs (606 shared), 33 guard pull-backs, no crossings, area conserved, no pin moved |
| `node tools/tests/atlas-borders-geometry.mjs` | 29 passed — 10,695 edges over 25 realms |
| `node tools/tests/test-map-transit.mjs` | 103 passed |
| `node tools/tests/test-map-routes.mjs` | 11 passed |
| `node tools/tests/test-map-provinces.mjs` | 70 passed |
| `node tools/tests/test-map-lenses.mjs` | 82 passed |
| `node tools/tests/atlas-provinces-smoke.mjs` / `atlas-fullscreen-smoke.mjs` / `test-atlas-province-card.mjs` | 70 / 16 / 31 passed |
| `test-map-tiers`, `test-map-census`, `test-map-poi-types`, `test-planar-map`, `test-location-map-preview`, `check-province-census`, `check-map-integrity` | pass |

## What is not done / open

  · NOT LOOKED AT IN A BROWSER. Smoothness, route legibility and label placement were measured by tests and corner counts (674 → 145 corners over 45°), not by eye. Check Midlands and Mushroom Kingdom at continent, kingdom and province zoom.
  · PRE-EXISTING FAILURES, unchanged by this run (identical on untouched HEAD):
      - `atlas-modes-smoke`: 8 failing — pin colours read `#ffd166`; four cluster/inset checks assume clustering is the default, which was turned off deliberately (`atlas-map-v2.js` "Clustering is OFF by default").
      - `atlas-routes-smoke`: 2 failing — expects 174 Mushroom Kingdom pins and no `poi_nbc_/iio_/si_` pins; the sheet now holds 271 and the filed routes themselves use `poi_nbc_*` and `poi_si_*`. The expectations are stale, not the code.
      - `build-province-census.mjs --check` reports the filed snapshot out of date.
    None of these were "fixed" to make the run look clean; they need a decision on what the right expectation is.
  · NO HAND-FILED `via` WAYPOINTS WERE ADDED. The mechanism works (`links[].via` in `MUSHROOM_KINGDOM_ROUTES`, drawn through every point), but choosing a line's course needs the painted sheet, which this run could not see. Routes still run straight (rail/road/trail) or on a gentle arc (boat/air).
  · NO `air` ROUTES ARE FILED. The mode, style and engine support exist; filing is a content decision.
  · BORDER-AWARE ROUTING (lines bending to follow frontiers) was not built; waypoints cover the stated need.
  · REALM-LEVEL LABELS (a tier above province names) not built; overview hierarchy is a per-zoom cap on province labels (14 under 1.6×, 32 under 4×).
  · LEGACY PAGE kept. `maps-view.html` is still the target of the nav menu ("Tactical Maps" → `maps.html`) and of every `*-maps.html` redirect stub. Removing it means repointing those first.
  · NOT COMMITTED. The working tree also carries unrelated actor / `foundry-bridge.py` / `CLAUDE.md` changes that predate this run.
  · Assumed (unverified): `jsdom@26.1.0` was installed with `--no-save` for testing; `node_modules/` is untracked.

---

## Addendum — route look, big dots by default, island absorption

**Files**

EDITED
  `Reputation-Matrix2/app/pages/maps/map-provinces.js`   `absorbIslands` + `skipCenter`; one pure import (map-province-arcs.js); census result gains `absorbed`
  `Reputation-Matrix2/app/pages/maps/map-province-arcs.js` `islands` export (raw loop, host, no-rim test)
  `Reputation-Matrix2/app/pages/maps/atlas-map-v2.js`    cased rail/road with ties and centre line; HTML station rings (junctions named); `bigPins` default on
  `Reputation-Matrix2/app/pages/maps/atlas-map-v2.css`   casing, ties, station and junction styles
  `index.html`                                           cache tokens `map21` → `map22` (4)
  `tools/tests/test-map-province-arcs.mjs`               + no island left, + absorption happened (14 checks)
  `tools/tests/atlas-routes-smoke.mjs`                   + stations, junction names, cased rail
  `tools/tests/test-map-lenses.mjs`                      big dots on by default, toggle returns to small

GENERATED
  `Reputation-Matrix2/data/provinceCensus.json`          rebuilt by `node tools/build-province-census.mjs` (pins moved between provinces; also folds in the drift the earlier `--check` already reported)

**Island absorption (census change)**
  · A province's detached piece that another single province wholly encircles (no sheet-edge contact) now belongs to that province. 24 islands found; 23 pins involved across 8 realms.
  · Zero-pin islands were the province "centre anchor" landing in foreign land; those anchors are dropped instead.
  · Pins filed at one coordinate sit on the shared edge after the 0.06 nudge, so a pin within 0.1 of an island's edge counts as inside it.
  · Provinces after: 271 (unchanged); no province removed.
  · KEPT: a hand-filed province's only piece. `filed:rohan` (1 pin, inside `filed:eriador`) is the single case. Absorbing it would delete a region the archive filed.

**Verification** — arcs 14/14, provinces 70/70, census check 14/14, snapshot `--check` matches (271 provinces), borders geometry 29/29, province smoke 70/70, lenses 82/82, routes smoke 20/22 (2 pre-existing stale expectations).

**Not done / open**
  · Not looked at in a browser — station ring size, junction label collisions and rail tie spacing are untested by eye.
  · 21 hand-filed ledgers now read a different hand than the census (was reported before this run too; absorption moves some pins between provinces, so individual deltas shifted). `docs/PROVINCE_CENSUS_GUIDE.md` does not yet describe island absorption.
  · Detached pieces of hand-filed provinces (Northern Lands, The Empire, Jester's Playground …) were absorbed per the instruction; if the archive should keep those pins with their filed province, restrict `absorbIslands` to `kind === 'merged'`.
  · Absorbed pins are listed on the census as `absorbed: [{poiId, from, to}]` but not yet shown in the province dossier.

---

## Addendum 2 — map modes

**Cause.** An earlier redesign made every single pin a type-coloured dot of 4–7px in every numeric lens, so Population, Military, Economy and Influence produced identical colours and near-identical sizes. Species, Religion and Culture only colour pins with filed character presence; every other pin fell back to the flat `#5b6b8a` badge, which read as a grey map.

**Files**
EDITED
  `Reputation-Matrix2/app/pages/maps/atlas-map-v2.js`   Provinces mode removed; numeric lenses restore their own colour (green/red/gold/violet); dot size 4–11px and brightness follow the value; new Places lens carries the type colours; uncategorised pins in a categorical lens become quiet dots
  `Reputation-Matrix2/app/pages/maps/atlas-map-v2.css`  `.atlas-v2-uncat`
  `index.html`                                          cache tokens `map22` → `map23` (4)
  `tools/tests/atlas-provinces-smoke.mjs`               Provinces lens assertions replaced by "no Provinces mode, plots still drawn as a layer"
  `tools/tests/test-map-lenses.mjs`                     ten lenses incl. Places; unfiled pins are quiet dots; numeric dots wear the lens colour; Places varies colour

**Verification** — lenses 84/84, modes smoke 30 pass / 4 fail (the four cluster/inset checks that predate this work; the four "pins read green/red/gold/violet" checks that failed before now pass), provinces smoke 67/67.

**Not done / open**
  · Species / Religion / Culture still colour only pins with filed character presence (`wahCensusByPoi` in `index.html`); coverage is thin by nature of the data. They now show that honestly (quiet dots) instead of a grey wash. A regional-majority fallback would be inventing per-pin facts and was not added.
  · Province fills do not change with the mode (they show the controlling faction); unclaimed provinces stay slate grey by design.
  · Not looked at in a browser.

---

## Addendum 3 — dots follow the data

  · Dot diameter now scales with the lens value (4 + w^1.4 × 15 px, log-weighted): on Midlands the top-quarter population dots average ~12px against ~4px for the bottom quarter. Big-dot scale for dots lowered 1.9× → 1.5× because size now carries meaning.
  · Each stat lens has its own shape: population disc, military diamond, economy hollow ring, influence dot with halo (pure CSS, no clip-path, so hover/selection outlines still work). The legend shows the glyph.
  · Larger dots are drawn first so small ones stay on top and clickable.
  · Files: `atlas-map-v2.js`, `atlas-map-v2.css`, `index.html` (`map24`), `tools/tests/test-map-lenses.mjs` (87 checks: size tracks population, per-lens shapes).
  · Not looked at in a browser. Max dot size (≈15px, 22px with big dots) is a judgement call and easy to tune: the constant is the `15` in the dot diameter line.

