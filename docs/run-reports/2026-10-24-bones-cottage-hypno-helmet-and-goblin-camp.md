# Run Report — *The Locked Cottage, the Hypno-Helmet, and the Dragon at the Goblin Camp* (`2026-10-24`)

## Canonical Date & Placement Decision
- **Assigned in-world date:** `2 Aethel, 1040 BF` — a provisional next-day continuation after Bones’s tree-rest on `1 Aethel`; **no clock hour is filed**.
- **Time code:** `TC:1040-09-02/MAT`.
- **Uncertainty:** the session may cross midnight during the one-hour map measurement, but the source gives no boundary or exact time. The date remains an estimated start, not a claim that every beat happened on the same day.
- **Retrospective filing:** the Material clock has already advanced to `5 Aethel, 1040 BF`, so this `2 Aethel` record is retrospective. The global event manifest places it after the Archive Hall filing for filing order; that array position is not used to infer scene chronology. The new event was added to the manifest before rebuilding the stores.

## Filed Beat Order
1. Bones wakes in an unexplained cottage, held by two armed, unnamed Toad guards. Their phrase “bonding ritual” is kept as their explanation, not accepted as proof of consent.
2. The key swipe fails. The emergency-release button succeeds and unlocks every door.
3. In the woodland, the account mentions an unnamed green-cloaked figure and someone called Mimbus; neither is matched to a canonical identity. Fawful’s “I HAVE DRAGONS” is filed as a claim.
4. A Fawful hypno-helmet drone attacks an unnamed person. Bones intervenes; its vines lash him. The older woman and fox-eared Toad help remove the helmet. The victim’s identity and outcome remain unknown.
5. The conversation invokes the Emerald Enclave, its reported closed admission, and the effort to stop Fawful’s dragon-linked ritual. Bones receives the recorded 20-gold payment.
6. Bones takes an unnamed guard’s outer clothes, deliberately leaves the shorts, disguises himself, and escapes through a broken window.
7. Fawful’s sacrifice preparations and a **separate** clockwork mustard drone drive the next pursuit. Bones strikes a hulking Bean with his existing Shortsword while hoping unnamed poison works; neither the poison’s effect nor the target’s outcome is established. Bones flees while the woman and fox-eared companion are held in the pursuit.
8. At an unnamed goblin camp, the fart-spray gag is preserved without assigning its user, target, or effect. A figure called an “Archie bot” uses “WATERBALL!” to put out the fire and is recruited by the goblins.
9. A dragon arrives and leaves with an Archie-like figure. The account does not identify the dragon, passenger, summoner, or ritual result.
10. Bones declines the invitation, sleeps in the trees still disguised, and spends one hour measuring a map. Its route, origin, region, scale, and destination are not transcribed.

## Identity, Custody & Balance Guardrails
- The fox-eared Toad is **not** identified as roster #73, Toad ie Foxx. The roster remains `seen: false`; “Konathin” and the unclear “Toad ie Fox” wording remain unreconciled. No roster update was made.
- The figure called Mimbus is not merged with the historical 1035 operative. The woman, guards, green-cloaked figure, helmet victim, goblin-camp figure and dragon remain unnamed or unlinked where the record is unclear.
- The camp’s “Archie bot” and the dragon’s passenger are not equated with Archie Miser. The dragon is not equated with The Supplied Dragon. The Bowser’s Castle file receives a comparison lead, not an identity retcon.
- The map docket records the one-hour measurement only; it does not draw a route or name a destination.
- The wallet’s `17 gold` remains the **last recorded amount**, not a current balance. The event records a 20-gold payment and an unquantified, unattributed camp-side gold exchange; no final total is asserted.
- The event carries a **900-XP preview**. The authoritative XP ledger remains unchanged pending table confirmation.

## Visual Assets
Five reference-based, 1376×768 JPEGs were added under `Reputation-Matrix2/assets/images/events/bones-cottage-and-the-dragon/`:
1. `bc-01-locked-cottage.jpg`
2. `bc-02-hypno-helmet.jpg`
3. `bc-03-disguise-window.jpg`
4. `bc-04-mustard-pursuit.jpg`
5. `bc-05-dragon-at-goblin-camp.jpg` — uses the Castle dragon portrait as a **possible visual comparison only**, not an identity claim.

## Cross-System Surfaces Updated
- **Event & order:** `bones_cottage_hypno_helmet_and_goblin_dragon` in `data/stores/events/material/1040-aethel-b.json`; appended to `data/stores/manifest.json`; JSON stores rebuilt.
- **Characters:** Bones and Fawful profiles updated. Bones’s current status reflects the later `4–5 Aethel` induced-coma report, not the earlier cottage or Alpine Inn. Mimbus, Toad ie Foxx, Archie Miser and The Supplied Dragon profiles were not changed.
- **Faction:** added an explicitly limited Emerald Enclave record and color. It records only what the witnesses said; scale, leadership, headquarters, membership and formal allies/enemies remain unknown. Fawful’s Forces was updated with the witness report, not a claimed ritual success.
- **Investigation:** added the one-hour map docket as an exhibit and recovery lead in `mushroom_civil_war_file`; added a cautious Castle-dragon comparison lead to `bowser_castle_succession_file`.
- **Prop & inventory:** added `prop_bones_one_hour_map` and registry entries for the map, borrowed outer disguise, and Shortsword session use. The Shortsword entry aliases the already-equipped standard weapon on Bones’s live actor; no duplicate sword or poison item was created. `spoils-midlands.json` queues the map and disguise for the normal table-approved Foundry sync; the live actor was not hand-edited.
- **Technology:** added separate entries for the cottage swipe/release system, hypno-helmet drone, clockwork mustard drone, and reported Archie bot. Added and rendered a neutral emergency-button schematic. The 1035 Castle drone remains a separate record.
- **Wallet:** added an explicit unreconciled-balance note; left the last recorded currency amount unchanged.
- **Discovery surfaces:** updated `mainPage.json`, `SITE_UPDATES[0]`, derived campaign cover, RNN pending queue (filing date `2026-10-24`), and one Waluigi WahWire post. The event is the latest filed Material front under the site’s existing `MAT → Mario` campaign mapping.
- **Filing ledger:** stamped `filing-updates.json` at pass 20.
- **Spoils tooling:** fixed `spoils-to-changes.py` to preserve existing `filedOn` dates when a new holding is added; added a regression test.

## Verification
**Passed:** JSON-store build; `check-event-art.py` (138/138); `check-home-feed.py`; `check-timecodes.py --strict`; `check-local-paths.py`; `build-campaign-fronts.py --check`; `track-filing-updates.py --check`; `spoils-to-changes.py --check`; `test-spoils-to-changes.py` (23/23); and the emergency-button 3D model render.

**Passed with existing warnings:** `check-exhibits.py` (0 errors; its inventory-key parser warns on the site’s JS `INVENTORY_SYSTEM` boot stub); `check-investigations.py` (0 errors, 8 warnings); `check-rolls.py` (0 errors, 12 similar inventory-parser warnings); `check-references.py` (pass with 365 legacy unresolved-reference warnings); and `check-wahnotes.py` (wiring passes, 207/208 records covered).

**Known unrelated validation debt:** `check-technology.py` reports five existing verbatim-quote mismatches in `tech_wario_transport_helicopter` and `tech_paulos_courier_pistol`, both citing `the_rot_zone_at_star_hill`. The new technology entries’ quotes validate. `test-session-loot.py` reports 37 passes and one existing missing-actor-path failure; its missing paths are unrelated to this filing.

## Follow-up — companion tracks (commentary + analysis)

Added the two companion tracks the filing owed, both as new shards rebuilt into the site bundles.

**Commentary — `bones_cottage_hypno_helmet_and_goblin_dragon_commentary`** (`stores/commentaries/…json`, route `#/commentary/…`)
- 10 sections · 3,264 words · **1.17× the 2,799-word source** · sections 303–354w.
- Voice floors: **Waluigi/1k 18.7** (≥12), **CAPS/1k 33.4** (≥20), **WAH 5**. Passes every `--strict` floor; no thin, oversized, silent, or ledger-word section.
- Conceit: a **reading-room screening of the report text** — the account is projected one paragraph at a time with the pause key. It is explicitly *not* a claim that anyone filmed the cottage, so nothing outside the report (no camera, no maintenance crew, no offscreen faces) enters the cut.
- Quarantine observed: `relatedArticles` is empty, per the commentary rules; no cross-filing references.
- Guardrails carried over: the hypno-helmet drone and the clockwork mustard drone stay **separate devices**; the camp fart-spray beat is preserved as an **unassigned** gag; the disguise keeps its “outer clothes, **not the shorts**” exception; the dragon’s arrival is kept as **arrival, not causation**; the one-hour map records a **duration, not a route**.
- Filed retrospectively: `5 Aethel, 1040 BF — the screening desk, after the report; exact hour unrecorded`, `TC:1040-09-05/COM`. The `COM` suffix is a commentary-desk timecode; the event’s own `TC:1040-09-02/MAT` is unchanged.

**Analysis — `bones_cottage_hypno_helmet_and_goblin_dragon_waluigi_analysis`** (`stores/articleAnalyses/…json`, route `#/article-analysis/…`)
- 6 sections + thesis and verdict · **2,204 words** · every section carries a `sourceAnchor`.
- Argument (interpretation only, no new canon): the emergency release proves an escape, **not the route into the cottage**; the Emerald Enclave has **witness testimony, not a roster**; Fawful’s preparations and the camp dragon are **adjacent, not a demonstrated causal chain**; “Archie bot” is a **camp label, not an identity match**; the map has a **duration** and the purse has **transactions**, neither of which supplies the missing field; and the tree-rest is a **stopping point, not safety** — the later `4–5 Aethel` induced-coma report updates Bones’s present status without explaining the gap between them.
- Verdict preserves the boundaries rather than closing them: keep the map route blank, leave the purse unreconciled, leave the roster and character identities unchanged, and compare the dragon only against the prior Castle record.
- `relatedArticles` uses existing IDs only and all resolve (`emerald_enclave`, `fawful`, `fawful_forces`, `toad_ie_foxx`, `the_assault_on_bowsers_castle`, `the_toadalnaec_and_the_three_lies`, `archie_miser`, `the_medical_extortion_incident`, the prior Bones filing, and the event itself).
- `check-readability.py --analysis … --strict`: **nothing flagged** (FRE 61.2 · FK 8.6 · Fog 11.2 · aphorisms 10.4/1k).

**Stores:** both records were appended to `data/stores/manifest.json` and rebuilt — **commentaries 22, article Analyses 32**; `build-json-stores.py --check` PASS.

### Follow-up verification
- **Pass:** `build-json-stores.py --check`; `check-commentaries.py --strict` for the new track (all floors met); `check-readability.py --strict` for the new analysis; `check-timecodes.py --strict` (28/208 coded); `check-local-paths.py` (0 missing); `check-annotation-variety.py`; `check-boot-refs.py`; `check-home-feed.py` (latest = the Bones filing, 138 events); `build-campaign-fronts.py --check` (5 fronts); `track-filing-updates.py --check` (pass 20, 138 tracked).
- **Pass with pre-existing warnings:** `check-exhibits.py` (0 errors, 1 warning), `check-investigations.py` (0 errors, 8 warnings), `check-rolls.py` (0 errors, 12 warnings), `check-references.py` (365 legacy warnings).
- **Pre-existing debt, untouched by this run:** `check-commentaries.py --strict` still exits 1 on **older** tracks — `the_golden_palace_and_the_ink_throat_commentary` (0.0 Waluigi/1k, 0.31× source, 11 thin sections) and `the_toadalnaec_and_the_three_lies_commentary` (9.2 Waluigi/1k, 15.8 CAPS/1k, 0.61× source). `check-battles.py` fails on three unrelated `relatedArticles` that resolve nowhere; `battles.json` has an empty diff this run. `tools/tests/test-appearance-chronology.mjs` aborts with a `ReferenceError: deadlineMovers is not defined` inside its running-deadlines block, so its own “newest filing has a commentary track” assertion is never reached — I verified that condition directly instead (latest event’s id matches both new `sourceArticle` values, the analysis links resolve, and the commentary stays quarantined).

## Pull Request
Committed as `4899bd86` on `arena/eb96791b-walupedia` and pushed to `origin`; the companion tracks follow in a second commit. The filing is included in the existing open **PR #94**, whose title and description were updated to cover both the Archive Hall and Bones filings; no duplicate PR was opened.
