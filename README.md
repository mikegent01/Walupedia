# Waluipedia — The Vigilance Terminal

**START HERE.** This is the readme for the readmes. If you are an AI agent, a
new contributor, or returning after a break, read this page to the end before
touching anything. It says what the project is, how the work is done, and
which document owns each topic.

---

## Once you've read this — open a pull request

**Finished reading? Do not work on `gh-pages` directly.** Create a branch, do
the work, then open a PR into `gh-pages` with the purpose stated up front. The
PR *is* the run report's cover letter: a future reader (human or agent) should
understand what changed and why without opening a single file.

### PR guidelines

1. **Purpose in the title.** `feat:`, `fix:`, `docs:`, `remaster:` — then the
   change in one line. *"feat: Waluigi Chat joins the RNN late slot"* beats
   *"updates"* the way a filed article beats a rumour.
2. **One purpose per PR.** A PR that fixes the exhibit checker *and* adds a
   broadcast *and* renames portraits cannot be reviewed, reverted, or cited.
   Split it.
3. **Description template — fill all four:**
   - **Purpose** — why this change exists, in-world and out-of-world.
   - **What changed** — every file, grouped: hand-written vs generated.
   - **Verification** — the commands you ran (`build-rnn-broadcast.py --check`,
     `check-exhibits.py`, audits) and their results. Unverified = unmerged.
   - **Run report** — link or paste the report per `docs/RUN_REPORT_FORMAT.md`.
4. **Never hand-edit generated files in a PR.** Edit the generator, run it, and
   commit both together (`rnn-broadcasts.js` and the `RNN:LAST-WEEK` README
   blocks are *outputs*). A PR whose generated files don't match its sources
   is a broken PR.
5. **Generated art and big media:** new assets must be referenced by something
   in the same PR. Unreferenced uploads rot. Follow `docs/ASSET_MAP.md` for
   where things live.
6. **Remaster, don't rewrite.** PRs that delete working context to impose a
   "cleaner" structure will be asked to justify every deletion (see the
   philosophy below — especially rules 3 and 4).
7. **Small diffs, matched indentation.** Never reformat a whole data file to
   add one entry. Match the file's existing style exactly.
8. **Don't load the stores.** Filing bundles (`events.json`,
   `characters.json`, `locations.json`, `battles.json`,
   `investigations.json`, `commentaries.json`, `articleAnalyses.json`)
   are **generated**. Edit a shard under
   `Reputation-Matrix2/data/stores/`, then
   `python3 tools/build-json-stores.py --build --check`. Pull one
   record with `python3 tools/filing-context.py`. Layout:
   [`Reputation-Matrix2/data/stores/README.md`](Reputation-Matrix2/data/stores/README.md).
   Brief: [`CLAUDE.md`](CLAUDE.md).

---

## Rule zero — `mike` is a GM name, not a character

**The single most important thing on this page.**

Session transcripts are recorded at a real table, and the name **`mike`** in
them is the **GM** — the person running the game. It is not a character. It is
not canon. It is not a person in the world.

```
Wherever you see `mike`, ignore it.
Never write `mike` into new narrative prose.
Never treat `mike` as a person who was in the room, in-world.
```

A `mike` entry exists in `Reputation-Matrix2/data/characters.json` because the
name was once mistakenly filed as a character. **That entry stays** — deleting
it would break links from older filings — but it is a historical artifact, not
a precedent. The Mount Ebot narrative, where it first appeared, has been
rewritten without it; his actions in that expedition are now carried by named
in-world characters.

The general form of this rule: **table names are not character names.** GM
names, player names, and Discord handles never become people in the fiction.
If a transcript hands you one, invent an in-world name or leave the character
unnamed and refer to them by role — *the hire*, *the charter pilot*, *the boy*.
Unnamed is always safe; it invents no canon and can be named later without a
retcon. Full rule:
[`docs/STORY_FORMAT_GUIDE.md` → Naming rule](docs/STORY_FORMAT_GUIDE.md#naming-rule--table-names-are-not-character-names).

---

## What this project is

An in-world encyclopedia, campaign chronicle and faction-simulation terminal
for the Waluipedia tabletop campaign. `index.html` is the encyclopedia shell;
`Reputation-Matrix2/` is the systems layer (factions, reputation, maps, laws,
newspapers, standalone pages); `tools/` holds the Python generators that keep
the two in sync.

It is a **static site** — no build step for the pages themselves, no framework.
The Python tools generate data and splice HTML; they are not a pipeline you must
run to view the site.

### Running it — `python3 start.py`

```bash
python3 start.py                                      # serve + the control panel in the browser (http://localhost:8765/panel)
python3 start.py --no-gui                             # plain terminal mode: serve, print the address, Ctrl-C to stop
python3 start.py --no-gui --workflow                  # …and run workflow/server.py (chat saves, archive routes, LM Studio bridge)
python3 start.py --route "#/article/the_belly_of_the_beast"
python3 start.py --no-browser --host 0.0.0.0 --port 9000
python3 start.py --no-tts                             # serve without launching the TTS studio
python3 start.py --no-sheets                          # serve without the character-sheet suite
```

The **control panel** (`tools/control-panel.html`, served by `start.py` itself
at `/panel`; double-click `start.bat` on Windows) is the start page: a row with
a status light and **Start / Stop** for each thing that can run — the workflow
server, the **character-sheet suite**, the **Qwen3-TTS studio (off unless you
tick it)**, the **Waluipedia Hub** (8777), the **Token Plate Studio** (8766)
and the **NPC Forge** (8768; the last four run in their own windows and are
closed there) — plus LM Studio's light, **Open** buttons for every room (the
archive, the chatroom, `#/sheets`, each tool), the settings (port, "reachable
from other machines", workflow port, LM Studio URL, Foundry Data folder, art
base, two-way-with-GitHub, what Home opens) with *Remember*, which keeps them
in `~/.waluipedia-start.json`, and the log pane with the servers' lines. The
ticked services start with `start.py`, so one double-click brings everything
up; **Shut down** on the panel (or Ctrl-C in the console) stops what it
started. `--no-gui` is the plain terminal server — the panel page still
answers there, it just does not open by itself. The flags above override the
remembered ticks for one run without changing the file.

The **character-sheet suite** (`tools/sheets-suite.py --watch`, on by default,
`--no-sheets` to skip) is the Foundry loop as one process: when the GM's
export (`<world>-all-actors.json`, in the repo root or freshly landed in
Downloads) is newer than the world mirror it is split into
`Reputation-Matrix2/actors/worlds/<world>/`; player characters are kept on
`character` sheets (never NPC statblocks) with XP pinned to the ledger
(`tools/promote-player-sheets.py`); the spoils files in
`Reputation-Matrix2/actors/changes/` are applied; `data/sheets.json` and the
cast packet are rebuilt; and two import packets are combined for Foundry to
pull straight off this server (`…/worlds/<world>/players-import.json` for the
Players folder, `…/import.json` for the whole world — paste the printed URL
into **Mass import → URL**; the server sends `Access-Control-Allow-Origin: *`
so Foundry can fetch it). Who the **player characters** are is one list,
`Reputation-Matrix2/actors/folders.json` → `players.roster` (live Foundry id,
sheet name, website id, ledger key): the organizer files those into Players
and tags them `pc`, the sheets page shows them to everyone, and nobody else
counts — a dnd5e *character* sheet does not make a player character (the GM
builds NPCs on them too). Every pass **checks before it publishes**: the mirror
(`foundry-bridge.py check`) and the combined packets (`check-packet`) must
pass — ids, item identifiers, item ownership, art paths, the roster — and
`check-sheets.py` / `promote-player-sheets.py --check` must be green, or
nothing is copied into Foundry's Data folder and nothing is committed or
pushed. The art those packets name — portraits, token plates, repo item
icons — is **copied into Foundry's Data folder** with the packets
(`foundry-bridge.py install-images`: only files that are missing or differ);
serving it by URL from this server instead is an opt-in (`--art-base`) that
needs this server reachable from every Foundry client whenever Foundry is
open. It re-runs whenever an export, `Players.json` or a changes file
changes; `python3 tools/sheets-suite.py --check` is the read-only pass
`tools/check-all.py` runs. See `docs/SHEETS_SYSTEM.md`.

`start.py` sits in the repository root, serves the archive over HTTP and opens
the control panel for you (on Windows, `start.bat` double-clicks it; `start.bat
studio` opens the Token Plate Studio on its own, `start.bat forge` the NPC Forge
— `docs/NPC_FORGE.md` — and `start.bat plates` runs the full token-plate batch
— `docs/IMAGE_GUIDELINES.md` §4b). **Use it rather than double-clicking
`index.html`.**
Opening the file directly still renders the shell, but the browser blocks
`fetch()` on `file://`, so `Reputation-Matrix2/data/*.json` never loads and
events, characters, exhibits and investigations silently come up empty. The
script also sends `Cache-Control: no-store`, which kills the "I filed it but the
page shows the old version" problem. Ctrl-C to stop; it writes nothing and
builds nothing.

If `Downloads/qw/Run Qwen3 TTS.bat` exists, terminal mode launches it in its
own window on the way up so the local Qwen3-TTS studio (the voice behind
**Read aloud**) is warming while the site opens — both run, side by side
(`--no-tts` to skip it; in the window it is a tick, off by default). If the
studio's port already answers, or the bat is not there, the site starts
anyway and Read aloud simply needs the studio started by hand.

## Intake first — decide what the data becomes

Do not start by writing an event just because the user pasted campaign data.
First decide which archive object the data actually calls for. The dedicated
guide is:

**→ [`docs/INTAKE_DECISION_GUIDE.md`](docs/INTAKE_DECISION_GUIDE.md)** — when
to create an event, battle, exhibit, investigation update, article analysis,
shop item, XP award, character/location/faction record, annotation, RNN
episode, or nothing yet.

Then, if the answer is a session filing, follow
[`docs/SESSION_FILING_PROCESS.md`](docs/SESSION_FILING_PROCESS.md) in order.
The short rule remains:

```text
classify the input → locations → characters → XP → event prose
→ exhibits → investigation → index/home → artifacts/RNN → run report
```

### README maintenance standard

Keep README files as routing documents, not crowded changelogs. A README
should answer three things quickly: **what this area owns, where the source of
truth lives, and which checks prove it works.** Put long decision trees in
`docs/`, then link them from the README.

When adding a system, document:

1. source of truth;
2. generated outputs, if any;
3. reader/player surface;
4. canon boundaries;
5. verification commands;
6. what must not be hand-edited.

Do not paste a giant recent-PR matrix into the root README. If a change needs
that much explanation, it needs its own guide.

## The philosophy

Seven habits explain nearly every decision in this repository:

1. **It is written from inside the world.** Articles are filed by in-world
   authors — chiefly Waluigi, who is opinionated, petty, and frequently right.
   Nothing is written in the neutral voice of a rulebook.
2. **A story with a commentator, not a report with scenes attached.** The
   difference between a filing that works and one that does not is almost
   always physical detail: quoted speech, named objects, sounds. Commentary is
   the second layer, never the first. **If Waluigi was in the room, the
   commentator is a witness:** asides say *I said*, *I heard*, *I told him*.
   He files names he caught. He does not write "the record missed it" about a
   roll call he stood through — that is in
   [`docs/STORY_FORMAT_GUIDE.md` §7](docs/STORY_FORMAT_GUIDE.md#7-voice-and-point-of-view).
3. **Remaster, don't rewrite.** What exists, stays. Improve it, extend it,
   navigate it better. Wholesale replacement destroys context that took
   sessions to accumulate. When a remaster is proposed and the page's owner
   prefers the original, the original wins — see
   [`docs/AUDIT_SCRIPTS.md` → Readability audit](docs/AUDIT_SCRIPTS.md#readability-audit)
   for how a failed remaster gets recorded rather than repeated.
4. **Never cut for the sake of cutting.** Length is not a defect. If prose
   cannot be trimmed without sounding worse, do not trim it. Story-critical
   content is never removed to satisfy a word band — the bands are aim, not
   target. Improve instead of cutting.
5. **Process before prose.** Locations, characters and XP are settled *before*
   the event is written. The event is written last. See the filing process.
6. **If the prose says a document exists, the reader can open it.** Invoices,
   wires, demands and addendums are filed as exhibits in `props.json`, written
   in the issuing body's voice. A filing that only describes its paper is a
   summary of an archive.
7. **Generated files are never hand-edited.** Edit the generator, then run it.

---

## Every readme, and what it owns

**Start with intake. Once you know the data should become a session filing, the filing process is the spine.**

### How the work is done

| Document | Owns | Read when |
|---|---|---|
| **[`docs/INTAKE_DECISION_GUIDE.md`](docs/INTAKE_DECISION_GUIDE.md)** | **What to create from supplied data.** Event vs battle vs exhibit vs investigation vs shop item vs XP vs character/location/faction vs annotation vs nothing yet | **First. Before deciding the task shape** |
| **[`docs/NPC_FOLDER_SORT.md`](docs/NPC_FOLDER_SORT.md)** | **How the npc/ drop box was sorted.** 271 unsorted files → portraits/props/scenes; how updated sprites were matched to existing portraits by perceptual hash and confirmed by eye; what was deleted (first-party rips, soundtrack audio, a 403 page saved as .jpg) and why | Adding art, or wondering where an npc/ file went |
| **[`docs/FILING_HUB_GUIDE.md`](docs/FILING_HUB_GUIDE.md)** | **The filing desk.** The menu shown before a record that has been filed more than one way: Story / Analysis / Commentary / Investigation / XP, why Arc was dropped in favour of XP, the ≥2-doors gate, and how to add a sixth door | Adding a new way to read a filing, or wondering why a record skipped the menu |
| **[`docs/COMMENTARY_MODE_GUIDE.md`](docs/COMMENTARY_MODE_GUIDE.md)** | **Waluigi's Cut — the comedy commentary track.** Retell the whole story with the opinions cut in continuously; "During" time stance, quote-and-heckle structure, third-person performance, mandatory framing conceit (screening/reading minutes), no ledger words; voice floors enforced by `tools/check-commentaries.py` | Filing a commentary, or when an article reads flat |
| **[`docs/DATE_FILING_GUIDE.md`](docs/DATE_FILING_GUIDE.md)** | **How to date new and backfilled articles.** Tense before dates; walk backward to the prior solid date, then forward through the chain; repair vague earlier dates when touched. Includes the mandatory **time filing code** (`TC:1040-08-30T23:50/SHD`) enforced by `tools/check-timecodes.py` | Before setting any event date |

> **Date warning:** a missing timestamp is not permission to use the current clock. Resolve relative clues such as “a week ago” first; seven days before 5 Aethel is 28 Harvestide. If the clue and the chain disagree, stop and mark the date inferred or ask rather than silently filing at “now.”

> **Canon warning:** read the referenced character and source articles before dating from a name. Princess Peach is deceased, assassinated on Highsun 1, 955 BF; a Peach keepsake in a later scene is not a recent Peach action.
| **[`docs/SESSION_FILING_PROCESS.md`](docs/SESSION_FILING_PROCESS.md)** | **The ordered process.** Locations → characters → XP → *then* the event → exhibits → the investigation file → index → artifacts | After intake says "this is a session/event filing" |
| **[`docs/INVESTIGATIONS.md`](docs/INVESTIGATIONS.md)** | **The investigations system** that replaced the quest board. One accreting case file per arc; exhibits, layered analysis behind d6+1 rolls, XP, leads | Adding a session's paper to an arc |
| **[`docs/TECHNOLOGY_SYSTEM.md`](docs/TECHNOLOGY_SYSTEM.md)** | **Discovered Technology** (`#/technology`) — the ledger of machines and weapons the filings actually show, each with verbatim quotes, a turnable 3D model drawn by the site's own renderer (no library, no CDN), and an authored `pressure`; the **tension board** derives Calm → Crisis per territory and faction strain from the ledger, by year. Replaces the old unrouted research tree | A filing shows a machine, weapon, vehicle or device doing something |
| **[`docs/SHEETS_SYSTEM.md`](docs/SHEETS_SYSTEM.md)** | **Character Sheets** (`#/sheets`) — a Foundry dnd5e sheet behind every character article: the real exports where they exist, otherwise one generated from the article's own words with quoted evidence and a CR capped by the XP ledger — the hand-authored main cast as player-character sheets at the ledger level. **Only Disaster Inc. sheets are public; debug mode (Settings → Developer) shows the whole cast.** `tools/build-character-sheets.py`, `tools/check-sheets.py` | Adding or changing a character; the Mass Import loop |
| [`docs/NPC_FORGE.md`](docs/NPC_FORGE.md) | **NPC Forge** — faction → roster → full-body renders → reviewed transparent plates → website + Foundry replacement. A JSON roster per packet (`data/forge/`), `tools/build-forge-packets.py` makes the actors, `tools/npc-forge.py` (port 8768) inventories `characters.json` plus Foundry folders, collects website/input rows and AI output folders, batches renders, and requires a human review before publishing; without a GPU it writes a hand-off brief. First roster: Fawful's Forces | Giving a faction things to fight; replacing missing or weak NPC art |
| [`docs/sessions/bowsers-castle-1035-the-castle-comes-down.md`](docs/sessions/bowsers-castle-1035-the-castle-comes-down.md) | **Session run-sheet** for *The Bowser Jr. That Wasn't III* (18 Harvestide 1035 BF): the castle as a nine-floor descent, the evacuation clock, the dragon as weather, Fawthful's side as a side, the Omega Bowser swap, the train sideplot seeded only, and the filing order afterwards. Pairs with the `bowsers-castle-1035` actor packet | Running or filing that session; the template for the next prepared session |
| [`Reputation-Matrix2/Foundry/mass_import/README.md`](Reputation-Matrix2/Foundry/mass_import/README.md) | **Foundry Mass Import / Export** module and the **Foundry++ character editor suite** (`tools/foundry-studio.py`: sort / name / faction the art folder, link it and the actor trees into Foundry's Data folder, past-self versions, bridge change files) | Running sessions in Foundry; sorting the portrait and token folder |
| **[`docs/PROVINCE_CENSUS_GUIDE.md`](docs/PROVINCE_CENSUS_GUIDE.md)** | **The province census.** POIs merged into provinces, the controller each area's filed faction data crowns, borders drawn from that census, the shortlist that helps a player pick a pin, and how Power Projection reads the same numbers | Reading the atlas or the map, filing a province, or arguing about who holds what |
| [`docs/ARTICLE_ANALYSES.md`](docs/ARTICLE_ANALYSES.md) | Waluigi's **opinionated 20/80 companion analysis** for a filed article; "After" hindsight stance, claim-based structure (claim → anchor → argument → verdict), "I" only at a desk under a lamp, audit register, required cross-references, and optional research desk | Writing or editing a dedicated analysis |
| [`docs/ARTICLE_REVISIONS.md`](docs/ARTICLE_REVISIONS.md) | **Revisions on one record** — `revisions[]`, the `.vhistory` bar, when to amend instead of re-file or duplicate | Amending, expanding or correcting a filing |
| [`docs/STORY_FORMAT_GUIDE.md`](docs/STORY_FORMAT_GUIDE.md) | Craft standard for **canon session events** — prose, asides, apparatus, exhibits, battle pages | Writing an event |
| [`docs/WHATIF_FORMAT_GUIDE.md`](docs/WHATIF_FORMAT_GUIDE.md) | Craft standard for **non-canon What-Ifs** — decision engine, ledger, findings, verdict | Writing a What-If |
| [`docs/RNN_BROADCAST_GUIDE.md`](docs/RNN_BROADCAST_GUIDE.md) | The news broadcast. **One episode per ~10 events**, the pending list, the voice | Cutting an episode |
| [`docs/BATTLES_GUIDE.md`](docs/BATTLES_GUIDE.md) | **Battle records** — `data/battles.json` + `data/majorBattles.json`: what earns a record, schema, ledger-truth rules, the home feed item | Filing a battle |
| [`docs/BETWEEN_TURNS_GUIDE.md`](docs/BETWEEN_TURNS_GUIDE.md) | **Dead time at the table** — why adding options to a sheet makes it worse, and the four levers (reactions, reaction shots, readied actions, companions on their own initiative) that fill the gap between turns | A player says they have nothing to do on their turn |
| [`docs/BATTLE_STORY_FORMAT_GUIDE.md`](docs/BATTLE_STORY_FORMAT_GUIDE.md) | **Battle craft** — the six-part war-report shape, mechanics→consequences translation, pacing tells | Writing a battle article |
| [`docs/ARTICLE_QA.md`](docs/ARTICLE_QA.md) | **Content QA** — the six checks over every article before it ships; the Hanging-Tree exemplar | Reviewing any article |
| [`docs/CROSS_SYSTEM_UPDATES.md`](docs/CROSS_SYSTEM_UPDATES.md) | **Cross-system triggers** — Pond Patrol, dynasties, POIs, bros attacks, currencies, WAHwire, songs, books: what every filing must also touch | After any filing |
| [`docs/IMAGE_GENERATION_GUIDE.md`](docs/IMAGE_GENERATION_GUIDE.md) | **Prompt sheet before generating.** Art direction from the prose, when text belongs in an image, editing over rerolling. New substantial articles ship with images. **A known character is always pulled from `portraits/` as a reference — never described from scratch** | Illustrating any filing |
| [`docs/CSS_STYLE_GUIDE.md`](docs/CSS_STYLE_GUIDE.md) | **CSS without breaking the archive.** Scoped selectors, fluid layouts, long Waluigi assessments, reputation panels, theme checks | Changing site styles |
| [`docs/VERIFICATION_AND_ORGANIZATION.md`](docs/VERIFICATION_AND_ORGANIZATION.md) | Checks that catch breakage; rules that prevent bloat; where files go | Before calling a run done |
| [`docs/RUN_REPORT_FORMAT.md`](docs/RUN_REPORT_FORMAT.md) | How to report at the end of a run — every file, every event, every XP award | End of every run |
| [`docs/AUDIT_SCRIPTS.md`](docs/AUDIT_SCRIPTS.md) | The craft-audit scripts — event, what-if and readability (advisory); exhibits, investigations, rolls (pass/fail) | Checking a draft's numbers |
| [`docs/INJURY_TABLE_GUIDE.md`](docs/INJURY_TABLE_GUIDE.md) | The permanent injury d100 desk, character references, spinner, and assignment tool | Rolling or healing a lasting injury |
| [`docs/ARCHIVE_RANKING.md`](docs/ARCHIVE_RANKING.md) | Which filings set the standard and why | Arguing about standards |

### How the code and data are built

| Document | Owns |
|---|---|
| [`Reputation-Matrix2/gemini.md`](Reputation-Matrix2/gemini.md) | **Engineering conventions** — architecture, data contracts, house style. Canonical copy |
| [`Reputation-Matrix2/README.md`](Reputation-Matrix2/README.md) | The systems layer: factions, reputation, maps, laws, standalone pages. Canonical copy |
| [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) | Directory-by-directory map of the repository |
| [`docs/ASSET_MAP.md`](docs/ASSET_MAP.md) | Where images, sprites and media live |
| [`docs/ARCHITECTURE_AUDIT.md`](docs/ARCHITECTURE_AUDIT.md), [`docs/FINAL_STRUCTURE_AUDIT.md`](docs/FINAL_STRUCTURE_AUDIT.md) | Point-in-time audits. Historical record |
| [`docs/LEGACY_FILES.md`](docs/LEGACY_FILES.md) | What is dead, and why it has not been deleted |
| [`docs/CHATROOM_GUIDE.md`](docs/CHATROOM_GUIDE.md) | **The chatroom** — `chatroom.html` and `workflow/roleplay.html`, both generated by `tools/build-chatroom.py` from `assets/chatroom/`. Cross-chat memory, world lore, perspective replay, import/export |

### Sub-project readmes

| Document | Owns |
|---|---|
| [`wahsim/README.md`](wahsim/README.md) | The Wahsim simulator — its own tool, its own docs |
| [`Reputation-Matrix2/tools/hub/README.md`](Reputation-Matrix2/tools/hub/README.md) | The tools hub |
| [`Reputation-Matrix2/tools/item sheet examples/README.md`](Reputation-Matrix2/tools/item%20sheet%20examples/README.md) | Foundry item-sheet examples |
| [`timeline/README.md`](timeline/README.md) | Bundled sidecar React timeline app. Separate subject/data pipeline; keep changes isolated and do not treat it as Waluipedia canon |

---

<!-- RNN:LAST-WEEK:START -->
## 📺 Last Week on the Rakasha News Network

> **EP 005 — The Unlocked Cell, and the King Takes the Chair**  
> Hunt Day AETHEL 5, 1040 BF — late edition · covering fifteen unaired nights, oldest first — a dungeon in 955 BF to a room full of socks in 1045 BF, aired the same Hunt Day as the fourth because the desk had already stopped apologising · runtime 6:48  
> **Whisper-in-Wind**, Death Speaker, Spirit-Walker Clan · **Waluigi**, Host, Waluigi Chat · encyclopaedist of the unthanked · **Wario**, Caller — thirty per cent of a notebook, on the shell-phone · **Bowser**, Guest — came through the wall uninvited, 955 BF; lost a throne room, 1035; refused a trap, 922 by the Feyward clock

**▶ [Watch the broadcast](Reputation-Matrix2/app/pages/standalone/rakasha-news-network.html)** — the jungle bulletin first, then the late slot: WALUIGI CHAT, composited live from `animation_frames/` and `portraits/player/sprite-sheets/`.

| Segment | Story | Cold open line |
|---|---|---|
| **COLD OPEN** | Rakasha News Network | Iron rusts. Flesh rots. Maps lie. Only the Hunt remains. |
| **THE JUNGLE SEES ALL** | Fifteen Nights, Oldest First | Eighty-five years cold, in the castle of the Mushroom Queen, one in the morning, the kart races … |
| **WALUIGI CHAT** | The King Who Was Not Invited | Good Aethel, late slot. This is Waluigi Chat, and tonight's guest has been through more walls th… |
| **THE CALLER** | Thirty Per Cent of a Notebook | The shell-phone. Of course the shell-phone. State your name for the minutes, caller, and state i… |
| **SIGN OFF** | Sign Off | The longhouse is returned. Fifteen nights aired; one guest came in through the door for once, an… |

*Cadence: **one episode per ~10 filed events, not one per event.** File the session, add the event id to `tools/rnn-scripts/pending-news-articles.json`, and when the list reaches ten write the next script in `tools/rnn-scripts/` and run `python3 tools/build-rnn-broadcast.py`. Full rules: [`docs/RNN_BROADCAST_GUIDE.md`](docs/RNN_BROADCAST_GUIDE.md). The newest episode always sits here.*

<!-- RNN:LAST-WEEK:END -->

---

## Where things live

| Path | What it is |
|---|---|
| `index.html` | The Waluipedia shell: router, article renderer, home feed, operator toolkit |
| `Reputation-Matrix2/data/` | Canonical data — `events.json`, `characters.json`, `voices.json` (how the cast talks, for the chatroom), books, clans, broadcasts |
| `Reputation-Matrix2/app/pages/standalone/` | Self-contained pages (field journal, simulator, RNN broadcast) |
| `Reputation-Matrix2/app/core/` | Shared renderers, including `rakasha-news.js` (The Blood-Echo broadsheet) |
| `Reputation-Matrix2/animation_frames/` | Rakasha News Network anchor sprites and title card |
| `tools/` | Python build scripts and audits (`update-index-home.py`, `build-rnn-broadcast.py`, `check-readability.py`, …) |
| `tools/rnn-scripts/` | Episode scripts + `pending-news-articles.json` (events awaiting a broadcast) |
| `docs/` | Process, craft guides, structure maps, audits |

## Routine jobs

- **File a session** → follow
  [`docs/SESSION_FILING_PROCESS.md`](docs/SESSION_FILING_PROCESS.md) in order.
  Locations, characters and XP come **before** the prose; exhibits, the
  investigation file, the home feed and the RNN pending list come after.
- **File the paper a story mentions** → add it to
  `Reputation-Matrix2/data/props.json`, wire it with `[[prop:id|text]]`, then
  `python3 tools/check-exhibits.py`. Craft standard:
  [`docs/STORY_FORMAT_GUIDE.md` §9B](docs/STORY_FORMAT_GUIDE.md#9b-exhibits--the-documents-the-story-names).
- **Add a session to an arc's investigation** → new `sessions[]` row, two or
  three exhibits with three analysis layers each, any leads the session created,
  in `Reputation-Matrix2/data/investigations.json`. No JS, no CSS.
  [`docs/INVESTIGATIONS.md`](docs/INVESTIGATIONS.md).
- **Show a new session on the home page** → append it to
  `Reputation-Matrix2/data/events.json` (last = newest filing), then set
  `mainPage.json` `latestUpdate` / `featuredArticle` and prepend
  `SITE_UPDATES` in `index.html`. **Do not paste a card into the Recent
  Adventures HTML.** `view_home()` builds that list from `events.json` via
  `homeRecentAdventuresHtml()`. Prove it:
  `python3 tools/check-home-feed.py` and
  `node tools/tests/test-home-feed-render.mjs`.
  `python3 tools/update-index-home.py` is a no-op on the live feed.
- **Update the "Current fronts" strip** → `mainPage.json` `campaignCovers`,
  **one cover per campaign**. The strip answers "where is each campaign right
  now", so a new session's cover *replaces* that campaign's existing cover
  rather than stacking on it — two covers for one campaign push another
  campaign off the strip. The newest filing wins, ordered by position in
  `events.json`, so the strip re-points itself as sessions land.
  `homeCoversHtml()` also de-duplicates by campaign at render time.
  Prove it: `python3 tools/check-covers.py`.
- **Cut the news** → only when ~10 events are pending;
  `python3 tools/build-rnn-broadcast.py` (see the cadence rule above).
- **Check what the news owes** → `python3 tools/build-rnn-broadcast.py --unaired`.
- **Check what the map owes the locations** → `node tools/check-location-map-coverage.mjs`
  (which location articles show a tactical-map pin, which are still unplotted; the
  survey queue and the clue that placed every pin live in
  `docs/worklists/LOCATION_MAP_COVERAGE.md`).
- **Re-file the province census** → `node tools/build-province-census.mjs`
  (provinces merged from the POIs + `PROVINCE_POLITICS`, borders, and the realm
  roll-up), then `node tools/check-province-census.mjs` to prove no pin was lost,
  every border closes inside the sheet, and the filed snapshot still matches
  `map-provinces.js`. **Never hand-edit `data/provinceCensus.json`.** The atlas
  and the Cartography Desk compute the same census live from that module, so the
  table and the borders cannot drift apart. Full rules:
  [`docs/PROVINCE_CENSUS_GUIDE.md`](docs/PROVINCE_CENSUS_GUIDE.md).
- **Audit references site-wide** → `python3 tools/check-references.py`
  (dangling ids, missing art; `--strict` to fail on legacy links).
- **Run the routine checker set** → `python3 tools/check-all.py` (local paths,
  references, exhibits, investigations, rolls, battles, background blurbs,
  home feed contract, RNN check, Bros sync/test).
- **Check a draft's readability** → `python3 tools/check-readability.py` with
  `--event <id>` / `--whatif <id>` / `--analysis <id>` / `--file draft.md`
  before filing. Advisory only — it surfaces machine-gun rhythm and aphorism
  density that grade scores can't see; a flag starts an argument, and a flag
  can be closed as intentional voice
  ([`docs/AUDIT_SCRIPTS.md`](docs/AUDIT_SCRIPTS.md#readability-audit)).
- **Mages Guild Codex emoji spam** → `python3 tools/gen-mages-guild-code.py --check-emoji`
  (also filters new pages on every generate).
- **Refresh update stamps** → `node generate-updates.js`.
- **Check system freshness** → `python3 tools/check-freshness.py`
  (stalest-first lag report for every living system vs `currentDate.json`;
  registry: `docs/system-freshness.json`; the standing order that makes the
  stalest system the next filing lives in
  [`Reputation-Matrix2/gemini.md`](Reputation-Matrix2/gemini.md)).

## Never do these

```
· Never write `mike` into narrative prose — it is the GM's name (rule zero)
· Never hand-edit a generated file — edit the generator and run it
  (rnn-broadcasts.js · the RNN:LAST-WEEK README blocks)
· Never paste a session card into the home Recent Adventures HTML —
  the feed is rendered from events.json. Update mainPage.latestUpdate.
· Never let one campaign hold two Current-fronts covers — one per campaign,
  newest filing wins; a second card evicts another campaign from the strip
· Never pass a scene/location image as a generation reference — bases are for
  PEOPLE (portraits/) only, or every plate comes back the same background
· Never date a filing by the clock before placing the story in time —
  tense first, then the chain (docs/DATE_FILING_GUIDE.md)
· Never cut story-critical content to hit a word count
· Never reformat a whole data file to add one entry — match its indentation
· Never invent a CSS class; only .prose blockquote, .prose h2, .wiki-lead, .wnote
· Never put raw <div> in prose — mdToHtml() escapes it and it renders as text
· Never describe a known character in an image from scratch — pull the
  portrait from portraits/ and pass it as a reference
  (docs/IMAGE_GENERATION_GUIDE.md → Characters)
· Never finish a run without a run report
```

## The calendar — date every filing in-world

The world runs on the **Regal Empire Standard Calendar**, and it is data, not
vibes: `Reputation-Matrix2/data/calendarMonths.json` (the months),
`calendarWeekdays.json`, `calendarSeasons.json`, `calendarHolidays.json`,
`calendarMeta.json` (the rules) — and **`currentDate.json` is the world
clock**. Check it before dating anything.

- **12 months, 30 days each** — except **Deepwinter, which has 35** (365
  total). There is no "Harvestide 31." After day 30 comes the 1st of the next
  month.
- **Month order:** Firstlight · Chillwind · Veridia · Bloom · Floria ·
  Efferd · Highsun · **Harvestide** · **Aethel** · Darkmoon · Frostfall ·
  Deepwinter. Aethel comes *after* Harvestide — check the order, don't assume
  it from the name.
- **7 weekdays**; Venerias and Saturias are rest days.
- **BF counts UP.** 722 BF is the oldest dated record, 1040 BF is the
  present. A larger year is closer to now — it is a chronicle page number,
  not a countdown.

Rules:

```
· Tense before dates. A filing can sit in the world's past, its present,
  or after its present. Decide from the story which one it is — then date
  it there. A recovered record, a backfilled arc, or a history page takes
  the date its events happened, however far that sits from the clock; a
  correct date in 955 BF beats a wrong date near 1040 BF. Only a session
  played at the table now belongs near currentDate.json, and even then
  the clock is a check, not the answer.
· To date a filing in the present: chain back through the prior filings
  to the last solid date and work forward. Never copy currentDate.json
  blindly — confirm the chain first, then check the clock against it.
· Every date in every filing is a calendar date. Real-world / table-side
  dates never appear in-world (a provenance note in prose is the exception).
· "Harvestside" and "Harvestnoon" appear in ~20 legacy filings; the
  canonical months are Harvestide and Aethel. Do not introduce new
  non-canonical month names; normalize them only when their record is
  next touched.
· Every NEW filing also carries a time code beside its prose date:
    "date":     "30 Harvestide, 1040 BF — continuing the same storm-night"
    "timeCode": "TC:1040-08-30T23:50/SHD"
  year-month-day, optional Thh:mm, and the clock (MAT/SHD/FEY/SUBJ).
  Leave the hour off if the record never established one. Do not invent it.
  Checked by tools/check-timecodes.py, which runs inside check-all.py.
· Full procedure: docs/DATE_FILING_GUIDE.md.
```

### Planar timekeeping — there are three clocks, and none of them agree

`currentDate.json` is the **Material Plane's** clock. It is not the world's
only clock, and treating it as universal has misdated filings before.
(Snapshot below goes stale; the file is the truth — read it, don't quote this
line.)

| Clock | Where it applies | State |
|---|---|---|
| **Material (imperial)** | the default; `currentDate.json` | Aethel 5, 1040 BF |
| **Shadowfell** | Shadowfell-side filings (Tymnas's cottage, the Estate) | Imperial reckoning, but *drifting* — a month-plus has passed there since the planar fracture; Shadowfell dates carry the drift forward |
| **Feyward** | everything inside the Feyward | **Its own year entirely: 922 BF by its own count** — over a century behind the Material, and it is not catching up. "Feyward-relative" filings borrow imperial month names for readability, but the year is the Feyward's own |
| **Mount Ebott** | the Monster Underground and the Ebott survey arc | **Its own arc clock, running ~1045 BF** — five years ahead of the Material present. It is not the Mario campaign and must never be filed as `MAT`; use `EBO` |

Rules for planar dates:

```
· Feyward filings: "<month> <day>, 922 BF (Feyward clock)" — the Material's
  date goes in a parenthetical only if the prose needs the comparison.
· Never synchronize the clocks in data. The disagreement is canon; a
  filing that makes 922 and 1040 agree has made an error, not a repair.
· Cross-plane causality ("this happened while that was happening") is
  prose, not dates — hedge it in the text, not in the date field.
```

### Running deadlines — the clock moves when you file, not when you remember

Some filings start a **timer** that is still running: the Feyward tether cut is
the live one. Timers live in `calendarMeta.json` → `deadlines[]`, and the site
renders them as a countdown on the home page and the calendar page.

**The remaining time is derived, never stored.** The site finds the newest filed
session on the timer's own `clock`, reads that filing's `timeCode`, and
subtracts it from `startedOn`. There is no counter to decrement.

So the rule is short:

```
· Filing a session on a timer's clock IS how the timer advances. Give the
  session an accurate timeCode — with the HOUR when the record supports one
  (TC:0922-09-05T14:00/FEY) — and the countdown falls by itself.
· A Feyward session in the present moves the Feyward clock. Do not file one
  with a date earlier than the previous Feyward session; the countdown reads
  the NEWEST filing on that clock and time does not run backwards.
· Never hand-edit the remaining time, and never add an `elapsedDays` field.
  A stored counter drifts out of sync with the filings the first time
  somebody forgets it. There is a test asserting the field is absent.
· `startedOn` is the moment the term began. It does not move, ever.
· Only set an hour you can point at in the record. If the session does not
  establish a time, leave the timeCode at day precision — the countdown
  simply measures whole days, which is honest.
```

**When a timer reaches zero:** it has fired. Resolve it in the fiction — file the
session where the consequence lands — then set the deadline's `status` to
`"resolved"` and **delete this section's entry from the live list below**. The
panel only renders timers whose status is not `resolved`, so a fired timer
disappears from the home page on its own, but the README list is hand-kept and
must be pruned in the same commit.

**Live timers:**

| Timer | Clock | Term | Fires | Consequence |
|---|---|---|---|---|
| `feyward_tether_cut` | FEY | 21 days from 3 Aethel, 922 BF (set in the Shepherd's Garden; heard upstairs in the Soul-Ring session) | 24 Aethel, 922 BF (Feyward clock) | The planar tether joining the Feyward to the Material sanctum is cut, closing the route between the Feyward party and the sanctum |

*(When that row fires: resolve it, mark it `resolved`, and remove the row. If the
table is left with no rows, delete the table and leave the rule above.)*
