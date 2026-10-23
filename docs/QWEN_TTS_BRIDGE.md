# The Local Qwen-TTS Bridge — Read Aloud

**The site can read any article aloud through your local
[Qwen3-TTS Enhanced Studio](http://127.0.0.1:7860/), in Waluigi's voice.**

The 🔊 **Read aloud** chip on article, commentary-track, and day-log pages
feeds the page to the studio one chunk at a time — and the chunk after the
one you are hearing is already synthesizing while the current one plays. The
result sounds like one continuous take instead of synth… pause… synth…
pause.

---

## Picking what gets read

You do not have to take the whole page:

* **🎯 Pick text** (a chip beside 🔊 Read aloud, and the 🎯 button on the
  player bar) arms **pick mode**. Click any paragraph, heading, list item, or
  quote, and the reading **starts there** and runs to the end of the page.
  Hovering outlines the block you are about to pick; `Esc` cancels.
* **Drag a selection first** and the reading covers **only the selected
  text** — even a few words from the middle of a paragraph. This also works
  straight from the 🔊 Read aloud chip: a live selection always wins over
  the full page.
* Mid-reading, 🎯 re-picks: choose a new starting block without stopping the
  bar.

The highlight follows the pick exactly — selected edge paragraphs are
clipped to the selection, and each harvested part carries its offset into
the paragraph's full text so the reading highlight lands on the right
characters (`ttsSelectionParts` / `startFrom` in the bridge). Clicks on the
bar and chips are controls, not picks.

---

## Setup

1. Run the Qwen3-TTS Enhanced Studio (Gradio) locally — default
   `http://127.0.0.1:7860/`. On the archivist's machine, **`python3 start.py`
   does this for you**: if `Downloads/qw/Run Qwen3 TTS.bat` exists it is
   launched in its own window alongside the webserver (both run — the site and
   the voice). `--no-tts` opts out, and if the studio's port already answers,
   nothing is launched twice.
2. In its **Voice Studio**, save a voice profile named **`Waluigi`** (the
   bridge's default; it uses whatever profiles the studio has saved).
3. Open the site (locally, or the deployed page — see
   [Security notes](#security-notes--localhost)), open any readable page, and
   click **🔊 Read aloud**.
4. ⚙️ in the player bar configures: studio URL, voice profile, model
   (`/generate_base_17` = the bigger saved-voice model, `/generate_base_06`
   = the faster one), and chunk size (chars, default 450). **Test voice**
   synthesizes a one-liner to confirm the wiring.

Settings persist in `localStorage` under `waluipedia-tts`.

## Sharing an 8 GB GPU with LM Studio (VRAM swap)

An 8B chat model and the voice model don't fit on an 8 GB card together.
When the card runs out, the driver spills into system RAM and both slow to a
crawl. With **Swap VRAM with LM Studio** ticked in ⚙️ (on by default), the
GPU goes to whichever one is needed right now:

* **Read aloud** asks `start.py` (`POST /panel/api/vram {"want":"tts"}`) to
  run `lms unload --all` before the first chunk.
* The **chatroom** asks for `lm` before each model call, which unloads the
  studio through its `/unload_models` endpoint. Before speaking it asks for
  `tts`, after waiting for any model call still running. Who holds the GPU is
  kept in `localStorage['waluipedia-vram']`, so a swap only happens when the
  holder changes.
* Each side reloads on its next request. The studio loads lazily. LM Studio
  needs **just-in-time model loading** turned on (Developer → Server
  settings), and it reloads with the model's *saved default* load settings
  (GPU offload, context length), so save your settings as the default.

Expect a few seconds per swap. That's nothing for an article, but you'll
notice it on every chat turn that is also spoken. Pages not served by
`start.py` skip the swap. `/unload_models` lives in the studio's
`qwen_app/ui.py`, so restart the studio once to pick it up.

## Where the voice reaches

The 🔊 chip is on every page with prose worth hearing: **articles, commentary
tracks, day logs, article analyses, investigation case files, what-if
readers, chronicle entries, and the calendar** (whose day panel is harvested
via its `.cal-voice` hooks). The **songbook** gets a per-song **🔊 Read song**
button that starts at the song's title and reads straight through the
critique. Everywhere, 🎯 Pick text narrows the reading to a block or an
exact selection (see above).

## The player bar

* **🔊 volume slider** — persisted with the rest of the config, applies to
  the chunk playing right now and every chunk after.
* **⏮ previous chunk** — the "wait, what did he just say" button.
* ⏸ pause/resume · ⏭ next chunk · ⏹ stop · 🎯 pick mode · ⚙️ settings.
* The bar shows the page title, the chunk counter, and the speaking voice.

## How the pipeline works

```
chunk 1 synth ──▶ play chunk 1 ──────────────▶ (ends)
                    │
                    └── chunk 2 synth (in flight) ──▶ play chunk 2 ──▶ …
                                                  └── chunk 3 synth (in flight)
```

* The page's readable text is harvested from the rendered article (title,
  lead summary, prose blocks, Waluigi's notes — not the TOC, rail, or
  infoboxes).
* Text is split into **sentence-aware chunks** (~450 chars): sentences stay
  whole, paragraphs are chunk boundaries, and monster sentences with no
  punctuation are hard-split. Nothing is sent in one giant request, because
  the model has a context limit and long single takes degrade.
* While chunk *N* plays, chunk *N+1* synthesizes — **one request in flight
  at a time**, so a modest local GPU is never asked to run two pieces of
  speech at once. If a prefetch is still running when playback ends, the
  player *joins* it rather than re-synthesizing (one synthesis per chunk,
  ever).
* Pause/resume, skip chunk, and stop are in the player bar. Navigating to
  another page stops the reading.

## The Gradio API it speaks

Only saved-voice endpoints are used (the studio's dropdown voices —
`Freeman`, `Luigi`, `Waluigi`, …):

| Call | Purpose |
|---|---|
| `POST /gradio_api/call/generate_base_17` | enqueue `{data:[voice, text, lang, xvector_only=false, seed=0, temp=0.8, top_p=0.95, rep=1.15, max_new_tokens=2048]}` |
| `GET /gradio_api/call/generate_base_17/<event_id>` | SSE stream; `event: complete` carries `[progress, FileData, status]` |
| `GET /gradio_api/file=<path>` (or the `url` in FileData) | fetch the rendered wav/mp3 |

Fallbacks, in order: `/gradio_api/call` (Gradio 5.x) → `/call` (4.x); audio
via FileData `url` → constructed `/gradio_api/file=` URL. `/generate_base_06`
is identical in shape and is the config's "faster" model option.

## Testing

```
node tools/tests/test-qwen-tts-bridge.mjs
```

Runs the bridge core (extracted straight from `index.html`) against
`tools/mock_gradio_tts.py`, a fake studio that logs every request. Asserts
the whole contract: chunker behavior, client payload (`voice=Waluigi`, exact
text), the pipeline (chunk 2's synthesis is on the mock's log *while chunk 1
is still playing*; each chunk synthesized exactly once, in order), and the
error path (dead endpoint → `Bridge error: the studio is unreachable…`, and
the player stops cleanly). No jsdom required.

## Security notes & localhost

* The bridge is **browser-side only** — no repo server component, nothing
  leaves the reader's machine except requests to their own studio.
* Browsers treat `http://127.0.0.1` / `http://localhost` as trustworthy
  origins, so this works even from the HTTPS-deployed page; Chrome may show
  a one-time **local network access** prompt — allow it. (If the site itself
  is served over HTTPS and the browser blocks the call, open the site
  locally instead.)
* If the studio is not running, the bridge says so and stops:
  *"Bridge error: the studio is unreachable at http://127.0.0.1:7860."*

## From your phone over Tailscale

Yes — the bridge speaks to whatever studio URL it is given, so a phone on
your tailnet can use the same local Qwen studio. Two routes:

**Route A — plain Tailscale IP (simplest).**

1. Tailscale on the PC and the phone, same tailnet.
2. Make the studio reachable on the tailnet. Gradio binds to `127.0.0.1` by
   default, so either set `GRADIO_SERVER_NAME=0.0.0.0` in the environment
   before the `Run Qwen3 TTS.bat` launches it, or edit the studio script to
   `demo.launch(server_name="0.0.0.0")`.
3. Serve the archive to the tailnet: `python3 start.py --host 0.0.0.0`.
   It prints your Tailscale address when it finds one (`tailscale ip -4`).
4. On the phone: open `http://100.x.y.z:8765`, tap **🔊 Read aloud → ⚙️**,
   and set the studio URL to `http://100.x.y.z:7860`. Save once — the config
   is per-device.

**Route B — `tailscale serve` (HTTPS, no rebind).**

`tailscale serve --bg 7860` proxies the studio at
`https://<machine>.<tailnet>.ts.net` with a real certificate, leaving the
studio bound to localhost. Point the phone's ⚙️ at that URL. This is the
route that works from the **HTTPS-deployed site** too, because the endpoint
is HTTPS — a plain-http endpoint would be blocked as mixed content from an
HTTPS page. Needs MagicDNS + HTTPS certificates enabled on the tailnet.

**Notes.**

* CORS: Gradio's API endpoints allow cross-origin calls by default (that is
  how `<gradio-app>` embeds work); if a proxy in front of the studio strips
  those headers, serve the site from the same machine (Route A).
* The first synthesis from a phone may take a moment — the studio queues
  jobs exactly as it does locally, one at a time.
* Everything else (voice profile, chunk size, volume) is per-device
  `localStorage`; the phone only needs its endpoint set once.

## Where the code lives

* `index.html` — the block between `READ-ALOUD-BRIDGE-START` and
  `READ-ALOUD-BRIDGE-END` markers: config, harvester, chunker, Gradio
  client, the `ReadAloud` controller, and the player bar. The 🔊 chip is
  wired into `view_article`, `view_commentary`, and `view_daylog`.
* `app/styles/waluipedia.css` — `.readaloud-*` / `.ra-*` player bar styles.
* `tools/mock_gradio_tts.py` + `tools/tests/test-qwen-tts-bridge.mjs` — the
  headless contract test.
