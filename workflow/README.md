# Waluipedia chat-first assistant

This is a small local chat page for an LM Studio model. It is intentionally
chat-first: ordinary conversation, roleplay, and drafting go directly to the
model. The assistant does not begin by searching the repository, planning a
write, or inventing a tool result.

## Start

From the checkout root:

```bash
python workflow/server.py
```

Open `http://127.0.0.1:8787/`. The server binds to `0.0.0.0` for the sandbox
preview. Set `WORKFLOW_HOST`, `WORKFLOW_PORT`, and `LM_STUDIO_URL` if needed.

## Model endpoint and timeouts

The assistant talks to LM Studio's local server. If it is not at the default
address, it is found automatically: the server probes `127.0.0.1` and
`localhost` on ports `1234`, `1235`, `8000`, and `8080`, and uses the first one
that answers `/v1/models` (results cached 15 seconds; refresh forces a new
probe). The header shows which endpoint is in use, and **⚙** lets you set the
URL by hand — it is stored in the browser and overrides detection. Setting the
`LM_STUDIO_URL` environment variable overrides detection for the whole server.

A slow model is not an offline one. Requests default to a 90-second budget
(`LM_STUDIO_TIMEOUT_SECONDS`), and one automatic retry with a doubled budget
runs before anything is reported. Transient HTTP errors from LM Studio (model
backend channel errors, reloading models) are retried once too.

The model never sees the assistant's own failure notices: they are marked in the
chat page and excluded from the next request, and the server strips them from
any history they reach. The current message is sent once, not twice. While a
profile draft is pending, your notes (“make it sound good, waluigi tone”,
“this is the leader of it i guess”) revise the draft instead of dropping into
plain chat, and the model writes the profile prose itself from the quoted
evidence. Timeouts say so plainly ("did not finish in
time — the server is reachable but slow or busy"); only a refused connection
says offline, and that message names the endpoint it tried. Reply phrasing
keeps its prompt small (short history, small token budget) so slow local
models answer faster.

Note for the hosted preview: the sandbox cannot reach `127.0.0.1` on *your*
machine. Run `python workflow/server.py` locally (next to LM Studio), or point
⚙ at a reachable URL.

## Managing chats

Each chat in the sidebar has **✎ rename** and **✕ delete** buttons (visible on
hover). Renaming sets a permanent title — the automatic first-message title
never overwrites it. Deleting asks for confirmation, switches to the next chat
(or creates a new one), and cannot be undone. Both are blocked while a reply is
in flight. Chats live in `localStorage`, capped at the 30 most recent.

## Filing Desk — `/desk`

`http://127.0.0.1:8787/desk` files sessions and edits events with the local
models. It is a chat page: paste a transcript (or attach / drop the file) and
it runs the filing process; pick an event and say what to change; or just talk
(plain chat goes to the chat-first runtime above).

**File a session.** Notes for the filer (framing, "the middle is a
flashback", "ends on a cliffhanger") go above a line of `---`, the transcript
below it; with an attached file, type the notes in the box. The desk runs, in
`docs/SESSION_FILING_PROCESS.md` order: facts and date → location and
character stubs → outline → the story part by part → summary, aftermath and
Waluigi's verdict → event + manifest + `pending-news-articles.json` +
`mainPage.json latestUpdate` + `SITE_UPDATES` → `build-json-stores.py --build
--check`, `check-references`, `check-exhibits`, `check-timecodes --strict`,
`check-home-feed`. A failed check gets one model repair pass on the short
prose fields.

**What code decides, not the model:** ids, shards (a world with no shard of
its own goes to `material`; a full shard gets a `-b`/`-c` sibling), the
manifest, the time code (no stated date → the world clock's day, hour
estimated and said so in `timeWindow`; a stated later date → `laterDated`),
participants and related articles, part count (≈ one part per 220 transcript
words, 3–14) and the 350–450-word part band from `STORY_FORMAT_GUIDE.md`
(`desk_prompts.py` holds the condensed rules). Rule zero: `mike`, handle-like
speaker labels and `workflow/desk-handles.json` (a JSON list you can create)
are scrubbed from every field.

**Left for a person** (listed on every run): XP rows, campaign cover /
featured article, investigation arc links, exhibits.

**Edit an event.** The model sees the short fields and the list of story
parts, changes short fields directly and rewrites only the parts the change
needs, one at a time — the whole story never goes through the model, so a
short context cannot truncate it. A rewrite that comes back much shorter is
refused.

**Images** (`IMAGE_GENERATION_GUIDE.md`). **Plan images** writes the prompt
sheet first and spends nothing. The number of slots follows the guide's table
— short event (≤3 parts / <1,500 words) 2, normal session 4, long filing 5–7 —
as the lead plus the clearest section beats; the model picks the visually
distinct parts and may pick fewer (never filler). Each slot carries source
lines, must appear, cast, must NOT appear, text, camera, caption and a prompt
in the guide's six-part anatomy (house register first, oil-painting finish
last). Code, not the model, decides the people rules: the reference portrait is
the portrait-holder the slot actually names; people with no portrait are left
out of frame and flagged ("commission a portrait first"); a beat that is about
someone with no portrait is unticked rather than drawn with another face; place
and object plates say "no people"; camera and distance rotate per slot so no
two plates could swap captions; a scene image is never a reference. In the
card, untick slots or edit prompts, then **Render chosen slots**: LM Studio
unloads, ComfyUI renders each slot, the PNG is compressed to JPEG (≤1600 px,
~300 KB, needs Pillow — `start.py`'s Python has it) at
`assets/images/events/<slug>/<prefix>-NN-<subject>.jpg`, ComfyUI frees its
memory and the chat model reloads. The lead goes on the record
(`image`/`imageCaption`/`image_alt`); each section plate becomes a
`![caption](path)` figure after its part's first paragraph. **Which ComfyUI
graph:** the Qwen-Image graph (portrait references) when its model files are
installed; otherwise, if ComfyUI has MOSS-Image, the MOSS text-to-image
template in API form (1344×768, its recommended negative, skip-layer 22).
MOSS takes no reference image, so a character in frame is drawn from their
archive record instead (name, title, race and the established-look caption, if
the record has one); the card lists those slots so each face can be checked
against `portraits/`. `"comfy": {"portraitRule": true}` skips them instead. Loader files are read from the server (a missing default falls back to
what the loader offers); pin them, or the engine, in `desk-models.json` under
`"comfy": {"engine": "moss"|"qwen", "unet", "clip", "vae"}`. Section plates
render through `mdToHtml()` as captioned figures, and edits keep them in place. Every image shows in
the card with **Re-roll slot N**. Look at each one before keeping it (guide
step 4). Undo restores the record; image files stay on disk.

**Commentary and analysis tracks** (`desk_tracks.py`). Pick an event and the
**Commentary** or **Analysis** mode, or press the button on a filing card;
optional notes steer the angle. Same models and settings, different prompts:

- *Commentary* (`COMMENTARY_MODE_GUIDE.md`) — the json model picks a framing
  conceit, subtitle, standfirst and loud headings; the writer retells each
  story part in order, during-stance, third-person Waluigi heckling every few
  sentences, quoting the source verbatim, with one concession beat in the back
  half. Parts are merged to at most 14 sections. Before filing, code measures
  the `check-commentaries.py` floors per section (≥240 words, Waluigi ≥12/1k,
  CAPS ≥20/1k, no ledger words, quotes that exist in the source) and rewrites a
  failing section once. Filed as `stores/commentaries/<event>_commentary.json`.
- *Analysis* (`ARTICLE_ANALYSES.md`) — the json model plans 5–9 claims, each
  with a `sourceAnchor` (checked against the event; replaced if not found) and
  a related filing to cross-reference (filings sharing cast or place); the
  writer writes the thesis, each claim (desk beat → reaction → two readings →
  consequence for the other filing → admission → recommendation, first-person,
  no shouting) and the verdict. Filed as
  `stores/articleAnalyses/<event>_waluigi_analysis.json`; `check-readability
  --analysis` runs as advice.

Writing a track again replaces it. `relatedArticles` keeps only ids the archive
resolves. Both run `build-json-stores`, `check-references` and their own
checker; warnings about the new record show on the card.

**Speaker labels.** A transcript with no `Name:` lines (a subtitle dump) makes
the model guess who speaks — the desk warns, and the fix is notes above the
`---` line saying who is who, what is a flashback and how it ends. Long
transcripts are condensed with an equal budget per chunk and never cut at the
tail, so the ending reaches the writer.

**Continue.** A session filing saves a checkpoint after every step
(`workflow/saves/desk/<job>/state.json`: the digest, facts, profiles, outline,
the stubs it filed, every story part, the apparatus). When a run fails, its
card offers **Continue from where it stopped**: a new run reloads the
checkpoint, skips what is done — the stubs are not filed twice, written parts
are not rewritten — and takes over the failed run's backup, so its Undo
reverses both. A JSON reply cut off by the token limit is repaired rather than
discarded; a JSON step that still fails is asked again with more room, then on
the writer model; and if the summary/verdict step fails on both, the story is
filed with placeholder fields and the card says to edit them.

**Undo.** Every run backs up each file it touched (byte for byte) to
`workflow/saves/desk/<job>/`; **Undo this run** restores them and rebuilds.
Files the run created are emptied, not deleted — delete those by hand.

**Models.** `workflow/desk-models.json` picks a model per role and is read per
job: `reader` (digest, facts, outline), `writer` (story parts), `json`
(apparatus, guards, edit plans). Calls are grouped so a filing swaps models at
most twice; `swap: true` unloads the others first (one GPU). Prompts are sized
to the smaller of the reader's and writer's context. The 2026-11-07 bake-off:
qwen3.5-9b extracts and outlines ~4× faster than Gemma with valid JSON but as
a writer ignored part scope and asides; gemma-4-12b-qat kept scope, verbatim
lines and the `*WAH!` aside; anubis-mini-8b wrote the richest prose but broke
the rules. Raise the context in the file (16384+) if VRAM allows — longer
transcripts then need fewer digest passes.

Code: `Reputation-Matrix2/tools/local-agent/` (`filing_desk.py` pipeline,
`desk_store.py` shards/undo/checks/time codes, `desk_prompts.py`,
`desk_image.py`, `desk_vram.py`) and `workflow/desk_api.py` (jobs).
Tests: `python tools/tests/test-filing-desk.py` (fake model, temp store).

## Roleplay — the chatroom

`http://127.0.0.1:8787/roleplay` (linked from the assistant's sidebar) is a
separate page styled like a modern character-chat app: light theme, a left
rail with **Create / Discover / Feed / Charms / Labs**, search, dated recents
(Today / Yesterday / This Month / Older), a dashboard of character cards and
scene covers, and a chat page with a right-hand character panel (New chat /
Voice / History / Customize / Pinned / Persona / Style / Memory / Replay /
Script / Export).

**The page is generated.** `workflow/roleplay.html` and the repository-root
`chatroom.html` are both built from `assets/chatroom/` by
`python3 tools/build-chatroom.py`. Never hand-edit either page; edit the
source and rebuild (`--check` fails when they are stale). The whole system —
memory, lore, replay, backups — is documented in
[`docs/CHATROOM_GUIDE.md`](../docs/CHATROOM_GUIDE.md).

- **The cast is the archive itself.** `/api/characters` serves every character
  in `characters.json` (portraits included, via `/rm/…` static routes), browsed
  under alphabetical letter dividers. The account row links to the actual site
  (`WALUIPEDIA_URL`, default `http://127.0.0.1:8765/`), and both the account
  and the interaction counts on the cards are real: your display name, your
  handle, your own played turns — nothing invented.
- **Scenes from the sessions, from other perspectives.** `/api/scenes` turns
  the newest filed sessions into scene starters. The filed event **runs on
  its own script** — beats taken from its filed timeline fire on schedule
  (auto-advance every two turns, or **⏩ Next beat** manually) while you play
  *other* characters doing their own things around it. Each scene card shows
  its **suggested cast** (the event's own participants, resolved to playable
  characters) and **✨ Suggest a cast** lets the model pick an interesting
  combination instead.
- **Group chats, with a director.** The **👥 Group chat** button (or any scene
  card, wire post or collection) opens a cast picker. Each reply is generated
  as one character only — the prompt forbids writing the others' lines — and
  after every reply the model is asked who speaks next: another character, or
  **you**. It hands back on its own, and always at the ceiling
  (`max chain`, default 4 character turns), so a multi-bot room is never a
  loop. Switch it off in the character panel → **Director**.
- **Openers written from the lore.** A scenario's opening is not a template:
  the model is handed the brief, the character cards, the script and what
  these characters did in the reader's other chats, and asked for a title, a
  90–150 word second-person opener that starts mid-action with filed details
  in it, and the stakes. Generic answers ("you find yourself", no filed names,
  too short) are rejected and asked again; with no model at all the page falls
  back to its own cold open.
- **Continue the story.** Filed events grouped into sagas by their era line;
  the newest filing of each is offered as a starting point, and the room picks
  up in the minutes after the last filed line. Everything filed is canon and
  cannot be contradicted; everything after is invented in play — including
  characters, introduced with `[[NEW: Name | role | what they look like]]`.
  Nobody has drawn them, so the description is the portrait: it shows in the
  character panel under *Described, not drawn*, and they are kept for later.
- **Fate — the model does not owe you a yes.** Before each reply to something
  you attempted, the page rolls: it works, it works at a price, something cuts
  across it, it fails outright, or the character refuses you. The result is
  handed to the model as an order ("never soften it into a partial success"),
  the dice are never narrated, and being wounded shifts the odds against you.
  Off / gentle / normal / harsh in the character panel → 🎲 Fate.
- **Most Used Backfills.** The events every filing points at and nobody ever
  wrote — scanned out of the `keyEvents` lists — ranked by how often they have
  been played here. Playing one produces the missing account.
- **Sequels.** 📖 Sequel in any chat carries the cast, the sheets, the pinned
  lines and the unfired beats into the next scene, and opens in the middle.
- **🎒 An emoji inventory grid.** Eight slots per character, one emoji per
  thing, in-hand lit, quantities and notes; click for hand / use / drop. The
  model sets icons itself and may only use what is on the sheet.
- **🩸 Conditions that bite.** `[[COND: Name bleeding 3 -2hp | …]]` costs 2 HP
  a turn for three turns and then passes, automatically.
- **🎨 Colour.** `{red|the door}` / `{#8e2b20|the stain}` — a safe palette or
  any hex, escaped first, and the prompt tells the model to use it on two or
  three words at most.
- **📜 Rolling recap.** When the history outgrows the window the older turns
  are folded into a "story so far" by the background model. The turns stay;
  only the prompt shrinks.
- **Character state.** Every room keeps HP, MP, conditions (with notes and a
  turn count that ticks down), counters and an inventory of real items (note,
  quantity, in hand or stowed) per character, shown under 🩺 States and editable by hand. Scenario
  setup decides what everyone walks in carrying (a battle at 50% HP with
  `wounded` set), and the model updates the sheets itself with stage
  directions — `[[HP: Name -12]]`, `[[FLAG: Name bleeding]]`, `[[ITEM: …]]` —
  which are stripped from the prose and applied to the record. It may also
  `[[ENTER:]]` and `[[EXIT:]]` characters as the story demands.
- **The What If board.** A dozen long scenarios, composed by the page from
  filed records — the archive's own What-Ifs, the 🚧 **wanted pages** (people
  named in filings nobody has written up, playable at last), filed sessions
  turned at their hinge, the chambers (Midlands Diet, Pond Patrol, Council of
  Seven, Glazed Congress) and the loudest posts on the wire. Each card carries
  a full brief, a cast with reasons, and a five-to-eight beat script; anything
  thin is dropped rather than padded. **✍️ Create a scenario** composes the
  same thing from your own description by matching archive records — no model
  call. Served by `/api/archive`.
- **The wire.** `/api/wahwire` serves the 196 filed posts; the **Wire** tab
  sorts them **newest first**, most liked or most argued over, and filters to
  **Unused** — the posts nobody has played yet — or the drafts the archive
  never posted. Any post plays as a scenario on its own.
- **Collections.** `/api/collections` serves the archive's own groupings; one
  click preselects the whole table in the cast picker.
- **No advertisements.** The dashboard has no ad slot and the page contains no
  ad code.
- **🎙 Commentary mode.** Waluigi and Luigi commentating, debating or deep
  diving on any subject in the archive: podcast and debate run 15–60 minutes,
  a deep dive runs 30 minutes to two hours. The runtime is planned into
  ~600-word segments and generated one call at a time, each handed the
  outline, the last thing said and what has already been covered — so a local
  model can actually finish an 18,000-word episode. The material comes from
  the filed record with its ids and dates, and the standing rule is never to
  invent a filing. 🔊 Read it aloud sends it through the local Qwen3-TTS
  studio with one voice profile per speaker, falling back to the browser.
- **📓 The lore book.** Written in the background while you play: every few
  turns the last stretch of the scene is queued, and a separate small call
  files what is new — places, people, events, things, facts and a diary entry
  — appending each page at the bottom. One job at a time, never beside a
  roleplay turn, with a queue cap and a session budget so a local model on a
  laptop is never asked to do two things at once. The whole book is handed
  back to the model as established truth.
- **Citations.** Everything loaded is indexed with its date; before each turn
  the page offers the model the filings that are actually relevant *and* whose
  dates have already passed in this scene, with their ids, and names the ones
  dated later as unknowable. The prompt is budgeted so the reference material
  is trimmed before the scene's own instructions ever are.
- **The calendar.** Every room has an in-world date (from the scenario, or
  `currentDate.json`). Filings attached to the cast are sorted into *already
  history* and *has not happened yet*, so nobody reminisces about their own
  future, and every memory is filed with both clocks — the in-world date and
  when you played it.
- **Characters play like their filing.** The full filed description goes into
  the prompt with a behaviour line inferred from it, plus affiliation, faith,
  status and standing.
- **A browsable cast.** Sort by name, play count, recency, standing, power,
  memory or filings; group by A–Z, race, affiliation, status or standing;
  filter by race, affiliation, played/never-played/has-a-portrait/invented;
  search the whole dossier.
- **Memory that crosses chats.** Every opening, fired beat, pin and 🧠
  *remember* is filed in a world log; characters carry their own memory
  (lines said and heard, taught facts, a mood, relationship scores). Both are
  handed to the model in later chats, so the cast knows what happened in the
  other room. **Charms** holds world lore nodes, treated as established truth
  and matched to the cast or the scene.
- **Perspective dynamic replay.** **Labs → Perspective dynamic replay** (or
  **Replay** in the character panel) re-runs a played chat or a filed session
  from another vantage point: the same beats on the same schedule, a new cast,
  and a prompt block that limits them to what they could see from where they
  stood.
- **Character cards.** PNG cards (the JSON base64'd into a `chara` tEXt
  chunk — SillyTavern, Chub, Agnai) and JSON cards (`chara_card_v2` with v1
  fields alongside) are both read and written. Exporting an archive character
  writes the card into their own filed portrait, so the file is a picture and
  a card at once; the archive's fields ride along under
  `extensions.waluipedia`.
- **🧾 An audit per scene.** One button checks the room's date against the
  filing it came from, finds cast who have not spoken in six turns, and
  spots lore pages stamped after the scene — and fixes all three in one
  press, undoably. Search also refuses anything filed after the scene, so a
  1035 BF chat cannot quote a 1040 BF reckoning.
- **An audit harness.** `node tools/tests/audit-chatroom.mjs 100` plays a
  hundred varied turns and checks the invariants after each one;
  `MOCK_ADVERSARIAL=1` makes the stand-in model misbehave on purpose so the
  guards are proved rather than assumed.
- **🔎 The cast can search.** Every turn the query is the recent lines plus
  the scene's own filing plus the speaker's filings, and
  the best matching *passages* (not summaries, not whole files) are handed to
  the model with their ids. It can also ask for itself mid-turn with
  `[[LOOKUP: …]]` — the page searches, files what it finds into the lore book
  and has the turn rewritten with the passage in hand — and file its own
  notes with `[[REMEMBER: name | fact]]`.
- **The session knows what it is.** A chat opened from a filed event carries
  that filing's dossier — what happened, where, how it ended, what it left
  behind, who was in it with their roles, and how it ran, beat by beat — into
  every prompt, so the cast can actually quote the material.
- **The right mouth.** If a reply is plainly another character's line, it is
  filed under the person who really spoke rather than mislabelled, and an
  empty reply is retried instead of becoming a blank card.
- **It reads the room.** A turn written to yourself — muttering, reading,
  grieving — is flagged private and gets narration at most; nobody walks in
  from off-stage to comment. The header pins a scene 🔒 Alone or 🔓 Open, and
  the party bar's ◉/◌ dots say who is actually present (absent characters
  cannot be staged at all).
- **Out-of-character instructions.** ((double brackets)), `/ooc` or
  `[[OOC: …]]` in a turn are stripped from the prose and sent as orders that
  outrank the rest of the prompt; 📝 Special instructions holds the standing
  version for this chat and for every chat.
- **The sequencer.** You write, one small planning call decides who reacts
  and in what order (or that nobody does), the page plays exactly that, and
  the scene hands back. Replaces one-speaker-at-a-time turn taking.
- **Branch and undo.** 🌿 forks a chat from any line without touching the
  original; ↩ / Ctrl+Z rolls back the last turn, sheets included.
- **A persona sheet** that carries across chats, **keyword lore** that
  injects exact facts the moment a trigger word appears, **macros** above the
  composer, and sampler controls (top_p, top_k, repetition penalty, min_p)
  plus a separate background model for the utility calls.
- **Snappy by default.** A reply-length dial (snappy 25–60 words / normal /
  rich) goes into both the prompt and `max_tokens`, with the world's own
  turns given one band more room than dialogue.
- **Turns finish their sentences.** Every length band tells the model to
  land on a full stop; a reply that ends mid-sentence (no terminal
  punctuation, a trailing comma, an unbalanced quote) is detected and the
  model is asked to continue from exactly where it stopped, with the seam
  stitched out. Anything still dangling is trimmed back to a full stop.
- **◍ The Director narrates.** Four voices (Director / world / room /
  archive), the cinematic one by default. Every voice is told to *resolve
  what the player actually did* — read the notes, show the notes — while
  whether it goes well stays with the Fate roll. Narration is now in the
  model's history and the scene's established details are listed back as
  "already described", which is what stops it re-hanging the same moon every
  turn.
- **◍ The world takes a turn.** Star the character you play and the model
  stops speaking as them; when nobody else is in the room the world
  describes the scene in second person and moves the hour along, and the
  director can call on it mid-scene instead of stalling.
- **▶ Auto** plays a few turns by itself and stops the moment you type.
- **One card per turn.** The fate roll, state changes and fired beats are
  chips along the bottom of the turn they belong to, not separate cards.
- **Every line is editable.** ✏️ rewrite, 👁 mute (on screen, out of the
  model's head), 🗑 delete — plus a per-room context window, so an imported
  300-turn story does not drag on every reply.
- **＋ New on the speaker rail** brings somebody in mid-scene: from the
  archive, invented on the spot, from a character card, or by asking the
  model to write them in.
- **Pick the model.** ⚙ lists what the endpoint has loaded and lets you
  choose; the choice is saved with the endpoint.
- **A smart filing budget.** Rather than one call per three turns, the
  backlog is read in bigger stretches, always including the end of the chat,
  spending the rest on the parts that actually establish something. 313 turns
  costs 6 calls instead of 104, and the dialog lets you change both the call
  count and the session budget.
- **LM Studio without this server.** The page detects an OpenAI-style
  endpoint (`…/v1`) and calls `\/chat/completions` directly, so LM Studio on
  127.0.0.1:1234 works on its own — ⚙ has presets for both, a Test button,
  and the model name fills itself in. With nothing configured the page looks
  for LM Studio by itself before complaining. (LM Studio needs *Enable CORS*
  on in its Developer tab.)
- **👍 / 👎 steer the writing.** Each rating keeps an excerpt; the excerpts go
  into later prompts as "write more like these, never like those", with the
  target length derived from what was kept.
- **One importer for every shape.** v1 cards, v2 cards, PNG cards, JSONL and
  JSON chat logs, chatroom bundles and plain transcripts all go through the
  same sniffing step, which strips byte-order marks, accepts bytes or text,
  and — when it has to refuse — says what the file actually looked like
  rather than "unsupported".
- **Importing into an open chat.** The character panel's 📥 *Import into this
  chat* appends a story to the chat you are already in (speakers matched, a
  divider marking the seam, play carrying on from the bottom) or walks a
  character card in mid-scene — with the PNG card's own picture cropped and
  shrunk into their portrait, and their greeting as their first line.
- **Catching up the lore book.** After an import the page counts the unfiled
  turns and says what filing them would cost in model calls before spending
  anything; the work goes through the same one-at-a-time queue and budget.
- **Saves that outlive the cache.** `POST /api/chatroom-save` writes the whole
  state to `workflow/saves/` (ten timestamped backups behind it),
  `GET /api/chatroom-saves` lists them and `GET /api/chatroom-save?name=`
  reads one back. Labs has Save / Restore / Autosave, and save names are
  filenames rather than paths.
- **Stories in and out.** Paste or open a transcript — `Name: line`,
  `**Name:** line`, or prose — and it becomes a playable chat with the
  speakers matched to the cast.
- **Two kinds of export.** A ✍️ **story brief** trimmed for a writing model
  (who, when, the situation, the beats, the turns, the end state, what was
  established — no ids, no swipes, no error notices) and a 📦 **full bundle**
  another chatroom can import, plus markdown and plain text.
- **🔍 What the model is sent.** Labs shows the live system prompt, its size
  against the budget, and its ten largest blocks.
- **Import / export.** Chats, lore and memory export as JSON together or
  separately, and import by merge or replace; a single chat also exports as a
  markdown transcript for filing back into the wiki.
- **Adding onto stories.** **➤ Continue** moves the scene forward without
  your input, **Persona** sets who you play, **Style** switches narration
  (novel / script / casual / archivist), **⏱ Script** toggles beat
  auto-advance.
- **Voice** reads messages aloud with the browser's speech synthesis, a
  stable per-character pitch.
- Roleplay turns go straight to the model through `POST /api/roleplay` — no
  agent loop, no repository tools, nothing written. Everything the reader
  makes lives in this browser's `localStorage` (chats capped at 30).

## Routing rules

The runtime makes a deterministic decision before contacting repository tools:

- **Chat:** normal questions, greetings, opinions, roleplay, brainstorming, and
  prose drafts. One normal chat completion; zero repository/image calls.
- **Clarify:** vague creation requests or wording that could be either a
  conversation or an archive operation. One question; zero repository calls.
- **Read:** only an explicit request such as “read the article,” “find Freddy in
  the repository,” or “what does this source say.” One focused read/search,
  then a grounded answer.
- **Write:** only an explicit canonical/file change. The target is read first;
  the runtime never silently writes a file.
- **Image:** a concrete image request. A vague image request asks for a subject
  instead of searching unrelated files.

A mention of “character,” “article,” “file,” or a canon name by itself is not a
tool request. If LM Studio is offline, the page says so plainly; it does not
pretend a search happened or produce a fake archive answer.

Source-backed character creation is explicit but unstaged: a request naming a
person, a profile, and a source record resolves the source and participant,
lets the model write the profile prose from the quoted evidence, and **writes
it to `characters.json` immediately** — the archive lives in git, version
control is the undo, and there is no approval step. Re-running a profile
updates the record in place, and later notes (“make it sound good, waluigi
tone”, “write it better, flesh out the description”) revise and rewrite it the
same way. For example, Freddy plus `The Seven Nights at Fazbear: A Complete
Record` resolves to the source participant `gabriel_freddy`, and Cosmic Jester
plus `the factions json` resolves to the Cosmic Jester material in the Disaster
Inc. faction record. The request works as one message or as several, and
permission lines such as “you may edit files” are understood without triggering
a clarification.

The archive's own generator tools are connected too: “generate a battle”,
“make some events”, or “run the generator for reputation” reads the live
inventory, runs one bounded generation with the chat's model endpoint, and
reports the result in the model's own words.

And the chat works the archive itself: “can you add a Noki race” goes to a
reasoning loop where the model searches for Noki (finding the Isle Delfino
nation without being told), reads `races.json`'s own format, writes the record
in that format, and reports back — deciding each step itself, with the runtime
bounding every tool call. Lookups, edits, and follow-ups (“really try again”)
run through the same loop.

**There are no canned responses.** Every user-facing reply — clarifying
questions, file-lookup answers, drafts, failures — is written by the local
model from grounded context the runtime provides; only the offline notice
(when LM Studio is unreachable) is fixed text. When the user repeats a request
or says “i just told you”, the model is told about the repeat and its own
previous reply, so it asks for only the missing piece instead of looping the
same question; sending just that piece starts the flow on the next turn.

## API

The fresh page uses only:

- `GET /api/health`
- `POST /api/chat`
- `GET /api/agent/status?job=...`
- `POST /api/agent/cancel`

The roleplay page adds:

- `GET /roleplay` — the page itself
- `GET /api/characters` — the archive cast, with portrait URLs
- `GET /api/scenes` — the newest filed events as scene starters
- `GET /api/wahwire` — every filed wire post, with author profiles
- `GET /api/collections` — the archive's character collections
- `GET /api/archive` — the trimmed records the What-If board is composed from
  (filed What-Ifs, events with timelines, factions, the Congress)
- `GET /rm/<path>` — static files under `Reputation-Matrix2/` (portraits,
  event plates; path traversal refused)
- `POST /api/roleplay` — one plain chat completion (system + messages +
  temperature + max_tokens); no tools, no writes
- `POST /api/suggest-cast` — the model picks a cast for a scene from a
  candidate list; it may only choose names from that list

JSON routes answer `OPTIONS` and send `Access-Control-Allow-Origin: *` so the
static `chatroom.html` (served from the repository root on another port) can
use the same model endpoint.

The model never receives shell access. Repository helpers remain bounded to the
checkout and are called only by the explicit read/write/image branches.

## Tests

Run the routing tests with:

```bash
python -m unittest discover -s Reputation-Matrix2/tools/local-agent -p 'test_*.py' -v
python -m py_compile Reputation-Matrix2/tools/local-agent/*.py workflow/server.py
```

The tests include normal conversation, drafting, ambiguous character-file
requests, explicit archive lookups, and creation-room greetings. They assert that
chat turns emit no repository action, that every user-facing reply comes from
the model, and that no canned reply text exists in the runtime source.

To exercise the full chat server without a real LM Studio, run the mock model
server in another terminal first:

```bash
python tools/mock_lm_studio.py   # serves a fake /v1/chat/completions on :1234
python tools/mock_lm_studio.py 8000   # any port; MOCK_DELAY_SECONDS=3 simulates a slow model
python workflow/server.py
```

The chatroom has its own checks — they boot the mock model themselves:

```bash
python3 tools/build-chatroom.py --check    # the pages match assets/chatroom/
node tools/tests/test-roleplay-page.mjs    # the pure logic contract
node tools/tests/test-chatroom-core.mjs    # memory, lore, replay, bundles
node tools/tests/test-roleplay-server.mjs  # the routes
npm i --no-save jsdom && node tools/tests/test-chatroom-page.mjs   # the real UI
```
