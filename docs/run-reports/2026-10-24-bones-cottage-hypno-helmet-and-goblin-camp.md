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

## Pull Request
Committed as `4899bd86` on `arena/eb96791b-walupedia` and pushed to `origin`. The filing is included in the existing open **PR #94**, whose title and description were updated to cover both the Archive Hall and Bones filings; no duplicate PR was opened.
