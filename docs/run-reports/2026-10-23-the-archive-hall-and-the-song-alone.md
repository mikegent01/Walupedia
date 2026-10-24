# Run Report — *The Archive Hall and the Song "Alone"* (`2026-10-23`)

## Canonical Date & Placement Decision
- **Assigned In-Game Date:** `3 Aethel, 1035 BF` (`TC:1035-09-03/MAT`, evening into late night; exact clock hour omitted per `docs/DATE_FILING_GUIDE.md` Rule 2).
- **Evidence Chain:**
  1. **Direct continuity from `2 Aethel, 1035 BF` (*The Rot-Zone at Star Hill*, `TC:1035-09-02/MAT`):** Waluigi opens carrying the bruised ribs and surviving red-annotated scrap after losing his working notebook at Star Hill the night before; Wario still carries the worn *Contract of Accord* in his coat pocket; and the Archive Hall connects directly via gaslit interior passages to the Star Hill clinic corridors.
  2. **Internal clock markers:** Wario audits schedules *"sent over this morning"*, checks them for three hours before waking Mr. T, and whispers that the connected clinic hallways are *"supposed to be empty this time of [night]"* during a thunderstorm.
  3. **Cross-session payoff:** Outside Star Hill Clinic on `2 Aethel, 1035 BF`, courier Paulo mistook Mr. L in green for *"skinny T."* On `3 Aethel, 1035 BF` in the connected Archive Hall, gaunt Toad courier-auditor **Mr. T** appears cleaning Wario's and Waluigi's dirty laundry (`"a courier who knows too much about gambling debts"`).

## Verbatim Song Preservation (Both Songs Uncut)
1. **Song 1 — *"Mario, Luigi, Wario, Waluigi, Bowser, and Wario Bowser"* (The *Wawario* Sheet):**
   - Preserved **100% word-for-word** (including every `[music]` cue, the *Mario Kart 64* / *Super Smash Bros.* / *New Super Mario Bros. Wii* lines, the zigzag / L-shaped / Bowser mustache verse, *Wart Bowser*, and *WAWARIO SAYS WAH* x3) across **three** independent surfaces:
     - Event prose Section I (`events/material/1035-aethel.json`)
     - Paper exhibit modal `prop_wawario_affiliations_sheet` (`data/props.json`, showing `<del>WALUIGI</del>` blacked out in fresh ink)
     - Jukebox entry `song_wario_bowser_and_wawario` (`data/songs-data.js`)
2. **Song 2 — *"Alone"* (Beta Luigi's Lament, Ghost Chorus & Mario's Disembodied Italian Duet):**
   - Preserved **100% word-for-word** (doorway ghost chorus, King Boo chasm hum, Fire Flower lines, full weeping verses, full English + Italian duet — *"Ti perdono. Vai avanti"*, *"Tocca a te salvarli"*, *"Mario non c'è più — non farmi morire invano"*, *"Mostra loro che sei il fratello di Mario! Sei Luigi!"* — and closing vow) in both Event prose Sections V–VI and Jukebox entry `song_alone_archive_hall_lament` (`data/songs-data.js`).

## Visual Assets Generated & Verified (`read_file` Inspected, `<280 KB` JPEG)
- `portraits/mr_t.jpg` (97 KB) — Toad courier-auditor portrait anchored to `big_t.jpg` / `green_t.png` / `paulo.jpg`.
- `portraits/beta_luigi.jpg` (74 KB) — Hollow-eyed Beta Luigi portrait anchored to `luigi.jpg` & `mr_l.jpg`.
- `Reputation-Matrix2/assets/images/events/archive-hall-alone/`:
  1. `aha-01-wawario-sheet.jpg` (243 KB)
  2. `aha-02-scored-name-and-leak.jpg` (244 KB)
  3. `aha-03-explosive-accountant-ledgers.jpg` (276 KB)
  4. `aha-04-crushed-fire-flower.jpg` (223 KB)
  5. `aha-05-crimson-ghost-ti-perdono.jpg` (259 KB)
  6. `aha-06-contract-of-accord-corridor.jpg` (228 KB)
- Library SVG Covers: `assets/covers/complete_ledger_warios_enterprise.svg`, `assets/covers/archive_hall_missing_volume_1035.svg`.

## Cross-System Surfaces Updated
- **Location:** `the_archive_hall` (`locations/material-b.json`)
- **Characters & Sheets:** `mr_t`, `beta_luigi` (`characters/material-d.json`), status updates on `waluigi` & `wario` (`characters/shadeward-a.json`), generated sheets & Foundry actors (`sheets.json`, `actors/cast/fvtt-Actor-mr_t.json`, `fvtt-Actor-beta_luigi.json`, `import.json`)
- **Event & Props:** `the_archive_hall_and_the_song_alone` (`events/material/1035-aethel.json`), `prop_wawario_affiliations_sheet`, `prop_warios_enterprise_ledger_discrepancy`, `prop_archive_hall_haunting_docket` (`data/props.json`)
- **Commentary & Analysis:** `the_archive_hall_and_the_song_alone_commentary` (4,707w, 0 errors, 0 warnings) & `the_archive_hall_and_the_song_alone_waluigi_analysis`
- **Investigation Board:** Session #8 (`s_archive_hall_alone`), 2 new threads, 3 leads (including `mr_t` -> `'skinny T'`), and 3 interactive d6 exhibits in `mario_charred_note_file.json`
- **Inventory & Spoils:** `complete_ledger_of_warios_enterprise`, `warios_filing_cabinet_brass_key`, `waluigis_scorched_notebook_1035` (`inventory.json` + `actors/changes/spoils-midlands.json`)
- **Jukebox, Library, WahWire, Home Feed & RNN Queue:** 2 tracks in `songs-data.js`, 2 books in `books.json`, 4 posts in `wahwire/posts.json`, lead feature/cover/gallery in `mainPage.json`, `SITE_UPDATES[0]` in `index.html`, and entry in `tools/rnn-scripts/pending-news-articles.json`.
