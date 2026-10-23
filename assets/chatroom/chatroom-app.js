/* Waluipedia chatroom — the page wiring.
 *
 * All of the logic this file leans on lives in chatroom-core.js (window.RP);
 * this file only turns that logic into a screen. It ships as
 * <script id="rp-app"> inside workflow/roleplay.html and as an external file
 * next to chatroom.html — the build (tools/build-chatroom.py) makes both.
 *
 * Two runtimes, one page:
 *   server mode  served by workflow/server.py — /api/characters, /api/scenes,
 *                /api/roleplay, portraits under /rm/
 *   static mode  served by start.py from the repository root — the archive
 *                JSON is read directly and the model is reached at whatever
 *                endpoint the reader configures (⚙ in the dashboard header).
 */
(function () {
  'use strict';

  var CFG = window.CHATROOM_CONFIG || {};
  var RP = window.RP;
  var $ = function (id) { return document.getElementById(id); };

  var state = RP.loadState(window.localStorage);
  var styleWasMigrated = Boolean(state.settings && state.settings.styleMigrated);
  var migratedRooms = RP.migrateStyle(state);   // Novel → In character, once
  var lengthWasMigrated = Boolean(state.settings && state.settings.lengthMigrated);
  var migratedLength = RP.migrateLength(state); // Snappy-by-default → the scene decides, once
  var cast = [];          // every playable character
  var castById = {};
  var scenes = [];        // filed sessions offered as scene starters
  var posts = [];         // WAHwire posts, normalised
  var collections = [];   // the archive's own character collections
  var archive = { whatifs: [], events: [], factions: [], congress: {} };
  var archiveIndex = [];  // every loaded record, searchable, with its date
  var whatifs = [];       // the composed What-If board
  var backfills = [];     // the unwritten events everything points at
  var comTopic = '';
  var comStyle = 'podcast';
  var comMins = 25;
  var speaking = false;
  var busyRoom = '';      // which room the turn in flight belongs to (the front one, or the linked scene)
  var bookKind = 'all';
  var logKind = 'all';
  var castSort = 'name';
  var castGroup = 'letter';
  var castRace = '';
  var castAffil = '';
  var castView = 'all';   // all | played | unplayed | portrait | invented
  var autoLeft = 0;       // turns still to play on their own
  var showStates = true;  // the sheets are visible in the chat by default
  var wireSort = 'newest';
  var wireView = 'all';   // all | unused | used | unfiled
  var tab = 'discover';
  var query = '';
  var busy = false;
  var online = false;

  /* ---------------------------------------------------------------- *
   * storage and small helpers
   * ---------------------------------------------------------------- */

  function save() {
    syncLinked();
    RP.saveState(window.localStorage, state);
    window.setTimeout(autosave, 0);      // never in the way of a render
  }

  /** Two linked scenes are one world. Anyone with a sheet in both — HP,
   *  kit, conditions, counters; not where they are or who plays them — has
   *  the same sheet in each, and the clock and the date are one. The side
   *  that changed since the last save wins, so a wound taken in the hangar
   *  is on the sheet in the cockpit before the next line is written. */
  var sheetSigs = {};
  var LOCAL_KEYS = { present: 1, player: 1 };
  function sheetSig(sheet) {
    var copy = {};
    Object.keys(sheet || {}).forEach(function (k) { if (!LOCAL_KEYS[k]) copy[k] = sheet[k]; });
    return JSON.stringify(copy);
  }
  function syncLinked() {
    var seen = {};
    (state.rooms || []).forEach(function (a) {
      var b = RP.linkedRoom(state, a);
      if (!b || seen[a.id] || seen[b.id]) return;
      seen[a.id] = seen[b.id] = true;
      var sa = sheetSigs[a.id] || (sheetSigs[a.id] = {});
      var sb = sheetSigs[b.id] || (sheetSigs[b.id] = {});
      // Which side moved since the last look; a tie goes to the busier scene.
      var pickA = function (key, ja, jb) {
        var changedA = sa[key] !== undefined && sa[key] !== ja;
        var changedB = sb[key] !== undefined && sb[key] !== jb;
        if (changedA !== changedB) return changedA;
        return (a.updated || 0) >= (b.updated || 0);
      };
      Object.keys(a.states || {}).forEach(function (id) {
        if (!b.states || !b.states[id]) return;
        var ja = sheetSig(a.states[id]), jb = sheetSig(b.states[id]);
        if (ja === jb) { sa[id] = sb[id] = ja; return; }
        var fromA = pickA(id, ja, jb);
        var src = fromA ? a.states[id] : b.states[id];
        var dst = fromA ? b.states[id] : a.states[id];
        Object.keys(dst).forEach(function (k) { if (!LOCAL_KEYS[k]) delete dst[k]; });
        Object.keys(src).forEach(function (k) { if (!LOCAL_KEYS[k]) dst[k] = JSON.parse(JSON.stringify(src[k])); });
        sa[id] = sb[id] = sheetSig(src);
      });
      var ca = JSON.stringify([a.clock || '', a.date || '']), cb = JSON.stringify([b.clock || '', b.date || '']);
      if (ca !== cb) {
        var clockFromA = pickA('__clock__', ca, cb);
        var from = clockFromA ? a : b, to = clockFromA ? b : a;
        if (from.clock) to.clock = from.clock; else delete to.clock;
        if (from.date) to.date = from.date; else delete to.date;
        ca = cb = JSON.stringify([from.clock || '', from.date || '']);
      }
      sa.__clock__ = sb.__clock__ = ca;
    });
  }
  function room() { return (state.rooms || []).filter(function (r) { return r.id === state.active; })[0] || null; }
  function esc(v) { return RP.esc(v); }

  function toast(text) {
    var node = document.createElement('div');
    node.className = 'toast';
    node.textContent = text;
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 2600);
  }

  function imageUrl(path) {
    if (!path) return '';
    if (/^(https?:|data:|\/)/.test(path)) return path;
    return (CFG.staticRoot || '') + path;
  }

  /** An avatar at any size. The size is written inline as well as into a
   *  class: a size with no matching class used to leave the frame unsized,
   *  and a portrait would then render at its natural size — a full-page
   *  ellipse in the middle of the chat. Inline wins, always. */
  function avatarBox(size) {
    var px = Math.max(16, Number(size) || 40);
    return {
      cls: 'av av-' + px,
      style: 'width:' + px + 'px;height:' + px + 'px;min-width:' + px + 'px;font-size:' + Math.round(px * 0.4) + 'px;',
    };
  }

  function avatar(char, size) {
    var box = avatarBox(size);
    var url = imageUrl(char && char.image);
    if (url) {
      // data-nm / data-tint: when the file is missing the page swaps the
      // broken image for initials (see the error listener at the foot).
      return '<span class="' + box.cls + '" style="' + box.style + '" data-nm="' + esc(RP.initialsFor(char && char.name)) +
        '" data-tint="' + esc(RP.tintFor(char)) + '">' +
        '<img src="' + esc(url) + '" alt="" loading="lazy"></span>';
    }
    return '<span class="' + box.cls + '" style="' + box.style + 'background:' + RP.tintFor(char) + '">' +
      esc(RP.initialsFor(char && char.name)) + '</span>';
  }

  function userAvatar(size) {
    var u = state.user || {};
    var box = avatarBox(size || 32);
    if (u.avatar) {
      return '<span class="' + box.cls + '" style="' + box.style + '"><img src="' + esc(u.avatar) + '" alt=""></span>';
    }
    // No avatar of your own but a standing seat in the archive: wear it.
    if (u.playAs && castById[u.playAs] && castById[u.playAs].image) return avatar(castById[u.playAs], size || 32);
    return '<span class="' + box.cls + '" style="' + box.style + 'background:#5b5b66">' +
      esc(RP.initialsFor(u.name || 'You')) + '</span>';
  }

  /** Real numbers, not decoration: how much this reader has actually played
   *  with a character. Character cards show these instead of invented counts. */
  function interactions(charId) {
    return RP.turnCountFor(state.rooms || [], charId);
  }

  /* ---------------------------------------------------------------- *
   * data loading — API first, archive JSON as the fallback
   * ---------------------------------------------------------------- */

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → ' + r.status);
      return r.json();
    });
  }

  function loadCast() {
    return getJSON(CFG.castUrl).then(function (data) {
      var list = Array.isArray(data) ? data : (data.characters || []);
      cast = list.map(RP.normChar).filter(function (c) { return c.name; });
      cast.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
      castById = {};
      cast.forEach(function (c) { castById[c.id] = c; });
    }).catch(function (error) {
      cast = []; console.warn('cast unavailable', error);
    }).then(loadVoices);
  }

  /** The voice sheets — how each character actually talks. Optional: a
   *  missing file means every character gets the first-person fallback. */
  function loadVoices() {
    if (!CFG.voicesUrl) return Promise.resolve();
    return getJSON(CFG.voicesUrl).then(function (data) {
      RP.setVoices(data);
    }).catch(function (error) {
      console.warn('voice sheets unavailable', error);
    });
  }

  /** Static mode has no /api/scenes, so the same shape is built here from
   *  events.json: newest filings first, their filed timeline as the script. */
  function scenesFromEvents(data) {
    var records = Array.isArray(data) ? data : (data.events || []);
    var byName = {};
    cast.forEach(function (c) { byName[c.name.toLowerCase()] = c; });
    return records.filter(function (r) { return r && r.name && r.image; }).slice(-12).reverse().map(function (r) {
      var entries = (r.timeline && r.timeline.entries) || [];
      var beats = [];
      if (entries.length) {
        var step = Math.max(1, Math.floor(entries.length / 12));
        for (var i = 0; i < entries.length && beats.length < 12; i += step) {
          var e = entries[i] || {};
          var beat = RP.clip(e.beat || e.detail, 140);
          if (beat) beats.push({ time: RP.clip(e.time, 60), beat: beat, detail: RP.clip(e.detail, 260) });
        }
      }
      if (!beats.length) {
        RP.clip(r.summary, 500).split('.').forEach(function (part, i) {
          if (part.trim().length > 24 && beats.length < 5) beats.push({ time: 'beat ' + (i + 1), beat: RP.clip(part, 140), detail: '' });
        });
      }
      var suggested = (r.participants || []).map(function (p) {
        return castById[String(p && p.id)] || byName[String((p && p.name) || '').toLowerCase()];
      }).filter(Boolean).slice(0, 5);
      return {
        id: String(r.id || r.name), name: RP.clip(r.name, 70), summary: RP.clip(r.summary, 220),
        era: RP.clip(r.era, 60), date: RP.clip(r.date, 40), location: RP.clip(r.location, 60),
        image: String(r.image || ''),   // imageUrl() adds the archive prefix
        suggestedCast: suggested, beats: beats,
      };
    });
  }

  /** The WAHwire: 196 filed posts, each one a scenario waiting to be played. */
  function loadWire() {
    return Promise.all([
      getJSON(CFG.wireUrl).catch(function () { return {}; }),
      CFG.wireProfilesUrl ? getJSON(CFG.wireProfilesUrl).catch(function () { return {}; }) : Promise.resolve({}),
    ]).then(function (both) {
      var data = both[0] || {};
      var profiles = (both[1] && (both[1].profiles || both[1])) || (data.profiles || {});
      var list = Array.isArray(data) ? data : (data.posts || []);
      posts = list.map(function (p) { return RP.normPost(p, profiles); });
    }).catch(function (error) { posts = []; console.warn('wire unavailable', error); });
  }

  /** The records the What-If board is composed from. */
  function loadArchive() {
    if (CFG.clockUrl) {
      getJSON(CFG.clockUrl).then(function (clock) { state.clock = clock; }).catch(function () { /* the scene date still works */ });
    }
    if (CFG.mode === 'static') {
      return Promise.all([
        getJSON(CFG.whatifsUrl).catch(function () { return []; }),
        getJSON(CFG.factionsUrl).catch(function () { return []; }),
        getJSON(CFG.congressUrl).catch(function () { return {}; }),
      ]).then(function (all) {
        archive.whatifs = Array.isArray(all[0]) ? all[0] : (all[0].whatifs || []);
        archive.factions = Array.isArray(all[1]) ? all[1] : (all[1].factions || []);
        archive.congress = all[2] || {};
      });
    }
    return getJSON(CFG.archiveUrl).then(function (data) {
      archive.whatifs = data.whatifs || [];
      archive.events = data.events || [];
      archive.knownIds = data.knownIds || [];
      if (data.clock) state.clock = data.clock;
      archive.factions = data.factions || [];
      archive.congress = data.congress || {};
    }).catch(function (error) { console.warn('archive bundle unavailable', error); });
  }

  /** Compose the board once everything has landed. */
  /** One searchable index over everything loaded, rebuilt when data lands. */
  function buildIndex() {
    archiveIndex = RP.buildIndex(archive, castById);
  }

  function buildBoard() {
    archive.posts = posts;
    archive.userName = (state.user || {}).name;
    // Written and inherited scenarios come first: they are this reader's own.
    buildIndex();
    whatifs = (state.scenarios || []).concat(RP.buildWhatIfs(archive, castById, { limit: 12 }));
    backfills = RP.backfillsFrom(archive, castById, state, 10)
      .map(function (gap) { return RP.whatIfFromBackfill(gap, castById); })
      .filter(function (s) { return s && RP.scenarioQuality(s) > 0; });
  }

  function loadCollections() {
    return getJSON(CFG.collectionsUrl).then(function (data) {
      var list = Array.isArray(data) ? data : (data.collections || []);
      collections = list.map(function (c) { return RP.normCollection(c, castById); })
        .filter(function (c) { return c.members.length; });
    }).catch(function (error) { collections = []; console.warn('collections unavailable', error); });
  }

  function loadScenes() {
    return getJSON(CFG.scenesUrl).then(function (data) {
      if (CFG.mode === 'static') {
        // The static build reads events.json anyway; the What-If board takes
        // its divergences and its wanted-pages scan from the same copy.
        var all = Array.isArray(data) ? data : (data.events || []);
        // Every filed id, so the backfill scan knows what already exists,
        // even for events outside the window it keeps in memory.
        archive.knownIds = all.map(function (e) { return e.id; }).concat(all.map(function (e) { return e.name; }));
        archive.events = all.slice(-60);
        scenes = scenesFromEvents(data);
        return;
      }
      scenes = (data.scenes || []).map(function (s) {
        s.suggestedCast = (s.suggestedCast || []).map(function (c) { return castById[c.id] || RP.normChar(c); });
        return s;
      });
    }).catch(function (error) { scenes = []; console.warn('scenes unavailable', error); });
  }

  /* ---------------------------------------------------------------- *
   * the model
   * ---------------------------------------------------------------- */

  function replyUrl() {
    return (state.settings && state.settings.endpoint) || CFG.replyUrl;
  }

  /* ---------------------------------------------------------------- *
   * talking to a model — LM Studio directly, or the workflow server
   *
   * Two shapes of endpoint exist and the page works with both. Anything
   * that looks like an OpenAI API (`…/v1`, `…/chat/completions`) is
   * called the OpenAI way; our own server takes {system, messages}.
   * ---------------------------------------------------------------- */

  var LM_STUDIO = 'http://127.0.0.1:1234/v1';

  function isOpenAI(url) {
    return /\/v1(\/|$)|\/chat\/completions$|\/completions$/.test(String(url || ''));
  }

  /** `…/v1` → `…/v1/chat/completions`; anything already pointing at the
   *  route is left alone. */
  function chatRoute(url) {
    var base = String(url || '').replace(/\/+$/, '');
    return /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
  }

  function modelsRoute(url) {
    return String(url || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/models';
  }

  /** What to read before writing a turn: what was just said, what this
   *  scene is, and the filings this speaker is attached to. The passages
   *  come back, not the files. */
  function searchForTurn(r, speaker, recent) {
    var scene = RP.sceneDate(r, state, archive);
    // A filing NAMED in the recent prose outranks every score: the player
    // who says “I read The Tape and the Wario Files” gets THAT filing,
    // opening text and all — not three lookalikes.
    var named = RP.pinNamed(recent, archiveIndex, { scene: scene });
    var hits = RP.searchArchive(archiveIndex, [
      recent,
      r.sceneName || '',
      (RP.sourceRecord(r, archive) || {}).name || '',
      ((speaker && speaker.keyEvents) || []).join(' '),
    ].join(' '), {
      limit: 3,
      // Nothing dated after the scene: the cast cannot read tomorrow.
      scene: scene,
    });
    var seen = {}; var out = [];
    named.concat(hits).forEach(function (h) { if (!seen[h.id]) { seen[h.id] = 1; out.push(h); } });
    return out.slice(0, 4);
  }

  /** The token budget for a turn, from the length dial (the narrator gets
   *  its own band). Continuations get the same again, so a long turn can
   *  actually land. */
  function tokensFor(isWorld) {
    var level = isWorld
      ? RP.worldLength(state)
      : (state.settings && state.settings.length) || RP.DEFAULT_LENGTH;
    return RP.lengthBlock(level, false).tokens;
  }

  /** Lean background AI: the model writes the story and NOTHING else.
   *  Speakers rotate deterministically, the lore book and the upkeep
   *  reviewer wait for full mode — on a machine where every call costs
   *  minutes, the pickers were costing more than the prose. */
  function leanAI() { return (state.settings.background || RP.BACKGROUND_DEFAULT) === 'lean'; }

  /** Which endpoint and model a call should use. Background work — the
   *  sequencer, the lore book, hooks — can be sent to a small fast model
   *  while the roleplay itself goes to the big one. */
  function routeFor(opts) {
    var useUtility = opts && opts.utility && state.settings && state.settings.utilityModel;
    return {
      url: (useUtility && state.settings.utilityEndpoint) || replyUrl(),
      model: useUtility ? state.settings.utilityModel : ((state.settings && state.settings.model) || 'local-model'),
    };
  }

  /** Which turn checks are on, for the chips. */
  function flagModes() {
    var s = state.settings || {};
    return {
      fresh: s.fresh || RP.FRESH_DEFAULT,
      antiRepetition: s.antiRepetition || RP.ANTI_REPETITION_DEFAULT,
      antiGeneric: s.antiGeneric || RP.ANTI_GENERIC_DEFAULT,
    };
  }

  function samplers() {
    var s = (state.settings && state.settings.sampler) || {};
    var out = {};
    if (s.top_p !== undefined && s.top_p !== '') out.top_p = Number(s.top_p);
    if (s.top_k !== undefined && s.top_k !== '') out.top_k = Number(s.top_k);
    if (s.repeat_penalty !== undefined && s.repeat_penalty !== '') {
      out.repeat_penalty = Number(s.repeat_penalty);
      out.frequency_penalty = Math.max(0, Math.min(2, (Number(s.repeat_penalty) - 1) * 2));
    }
    if (s.min_p !== undefined && s.min_p !== '') out.min_p = Number(s.min_p);
    // XTC and DRY are the anti-slop samplers: XTC sometimes throws away the
    // most predictable next word (the cliché), DRY punishes repeating runs.
    // llama.cpp's server and KoboldCpp honour them; servers that do not
    // know them ignore the fields.
    if (s.xtc_probability !== undefined && s.xtc_probability !== '') {
      out.xtc_probability = Number(s.xtc_probability);
      out.xtc_threshold = 0.1;
    }
    if (s.dry_multiplier !== undefined && s.dry_multiplier !== '') {
      out.dry_multiplier = Number(s.dry_multiplier);
      out.dry_base = 1.75;
      out.dry_allowed_length = 2;
    }
    return out;
  }

  /** A fetch that gives up: local models hang, and an unanswered request
   *  used to block every background call behind it forever. Utility work
   *  gets 4 minutes; a main turn gets 10 (a 31B on CPU is slow, not dead). */
  // Every request in flight, so ■ Stop can cut them all at once: the
  // model's reply, the chores queued behind it, the studio rendering a line.
  var inflight = [];
  var stopEpoch = 0;       // bumped by ■ — anything staged before it does not go on
  function timedFetch(url, opts, ms) {
    var ctl = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    if (ctl) inflight.push(ctl);
    var timer = ctl ? window.setTimeout(function () { ctl.abort(); }, ms) : 0;
    var done = function (pass, value) {
      if (timer) window.clearTimeout(timer);
      if (ctl) inflight = inflight.filter(function (c) { return c !== ctl; });
      if (pass) return value;
      if (value && (value.name === 'AbortError' || /abort/i.test(String(value && value.message)))) {
        if (ctl && ctl.stopped) { var halt = new Error('stopped'); halt.stopped = true; throw halt; }
        throw new Error('timed out after ' + Math.round(ms / 1000) + 's');
      }
      throw value;
    };
    return fetch(url, ctl ? Object.assign({}, opts, { signal: ctl.signal }) : opts)
      .then(function (r) { return done(true, r); }, function (e) { return done(false, e); });
  }

  function callModel(system, messages, opts) {
    var route = routeFor(opts);
    var url = route.url;
    var patience = (opts && opts.utility) ? 240000 : 600000;
    var temperature = (state.settings && state.settings.temperature) || 0.85;
    // Background chores answer in a format (ORDER:, PLACE:, a summary). At
    // the roleplay's 0.85 the staging call kept writing the scene instead
    // of naming who speaks — a wasted call and a guessed order.
    if (opts && opts.utility) temperature = Math.min(temperature, 0.3);
    // Qwen3-family models think out loud by default and will happily spend
    // the ENTIRE token budget on reasoning_content, returning empty prose
    // after five minutes. Their documented soft switch turns it off.
    if (/qwen3/i.test(String(route.model || ''))) system += '\n/no_think';
    if (isOpenAI(url)) {
      // LM Studio, llama.cpp, Ollama's OpenAI shim, anything else that
      // speaks the same API. The system prompt is just the first message.
      return timedFetch(chatRoute(url), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({
          model: route.model,
          messages: [{ role: 'system', content: system }].concat(messages),
          temperature: temperature,
          max_tokens: (opts && opts.tokens) || RP.lengthBlock((state.settings && state.settings.length) || RP.DEFAULT_LENGTH).tokens,
          stream: false,
          // Replies, staging, filing, summaries: simple text tasks. Thinking
          // is off per-request; servers that do not know the parameter
          // ignore it, and the /no_think soft switch rides as the backstop.
          chat_template_kwargs: { enable_thinking: false },
        }, samplers())),
      }, patience).then(function (r) {
        return r.json().then(function (value) {
          if (!r.ok || value.error) {
            throw new Error((value.error && (value.error.message || value.error)) || ('the model answered ' + r.status));
          }
          var choice = (value.choices || [])[0] || {};
          var said = RP.stripThink(String((choice.message && choice.message.content) || choice.text || ''));
          if (!said.trim() && choice.message && String(choice.message.reasoning_content || '').trim()) {
            // It burned the whole budget thinking and wrote nothing.
            // Say so — a silent empty turn reads like a page bug.
            throw new Error('the model spent its whole reply thinking and wrote no prose — ' +
              'use a non-thinking (instruct) build, or a model where thinking can be turned off');
          }
          return said;
        });
      });
    }
    return timedFetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({
        system: system, messages: messages,
        temperature: temperature,
        max_tokens: (opts && opts.tokens) || RP.lengthBlock((state.settings && state.settings.length) || RP.DEFAULT_LENGTH).tokens,
      }, samplers())),
    }, patience).then(function (r) {
      return r.json().then(function (value) {
        if (!r.ok || value.error) throw new Error(value.error || ('the model server answered ' + r.status));
        return RP.stripThink(String(value.text || ''));
      });
    });
  }

  /** Is anything answering? Checks whatever endpoint is configured, in its
   *  own dialect, and — when nothing is set — looks for LM Studio on its
   *  usual port before giving up, because that is what most people run. */
  function checkHealth() {
    var url = replyUrl();
    var probe = isOpenAI(url)
      ? fetch(modelsRoute(url)).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
          if (!data) return false;
          var list = data.data || data.models || [];
          if (list.length && !(state.settings && state.settings.model)) {
            // Use whatever the studio has loaded, so nobody has to type it.
            state.settings.model = String(list[0].id || list[0].name || 'local-model');
          }
          return true;
        })
      : (CFG.healthUrl
          ? getJSON(CFG.healthUrl).then(function (data) { return Boolean(data && data.lm_studio && data.lm_studio.online); })
          : Promise.resolve(false));

    probe.catch(function () { return false; }).then(function (up) {
      online = Boolean(up);
      if (online || (state.settings && state.settings.endpoint)) { renderStatus(); return; }
      // Nothing there and nothing chosen: try LM Studio before complaining.
      return fetch(modelsRoute(LM_STUDIO)).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          var list = data.data || data.models || [];
          state.settings.endpoint = LM_STUDIO;
          state.settings.model = String((list[0] && (list[0].id || list[0].name)) || 'local-model');
          online = true;
          save();
          toast('Found LM Studio on 127.0.0.1:1234 — using it.' +
            (state.settings.model !== 'local-model' ? ' Model: ' + state.settings.model : ''));
        }).catch(function () { /* still nothing; the status line says so */ })
        .then(renderStatus);
    });
  }

  function renderStatus() {
    var node = $('status');
    if (!node) return;
    node.innerHTML = '<i class="dot' + (online ? ' online' : '') + '"></i><span>' +
      (online ? 'Local model online' : 'Model endpoint: ' + esc(RP.clip(replyUrl(), 42))) + '</span>';
  }

  /* ---------------------------------------------------------------- *
   * rail
   * ---------------------------------------------------------------- */

  var NAV = [
    { id: 'discover', ico: '◉', label: 'Discover' },
    { id: 'commentary', ico: '🎙', label: 'Commentary' },
    { id: 'book', ico: '📓', label: 'Lore book' },
    { id: 'continue', ico: '⏭', label: 'Continue' },
    { id: 'whatif', ico: '❓', label: 'What If' },
    { id: 'backfills', ico: '🧱', label: 'Backfills' },
    { id: 'wire', ico: '📡', label: 'Wire' },
    { id: 'collections', ico: '🗂', label: 'Collections' },
    { id: 'feed', ico: '▤', label: 'Feed' },
    { id: 'charms', ico: '✧', label: 'Charms' },
    { id: 'labs', ico: '⚗', label: 'Labs' },
  ];

  function renderRail() {
    $('nav').innerHTML = NAV.map(function (n) {
      return '<button data-tab="' + n.id + '" class="' + (tab === n.id && !room() ? 'on' : '') + '">' +
        '<span class="ico">' + n.ico + '</span>' + n.label + '</button>';
    }).join('');
    $('nav').querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () { tab = b.dataset.tab; state.active = ''; save(); render(); };
    });

    var buckets = RP.groupBuckets(state.rooms || []);
    var labels = { today: 'Today', yesterday: 'Yesterday', month: 'This Month', older: 'Older' };
    var html = '';
    var shown = {};
    ['today', 'yesterday', 'month', 'older'].forEach(function (key) {
      if (!buckets[key].length) return;
      var rows = buckets[key].map(function (r) {
        // Two linked scenes are one chat here: one row, "A ⇄ B", filed
        // under the older of the two; opening it brings that one up front
        // with the other at its side.
        if (shown[r.id]) return '';
        var other = RP.linkedRoom(state, r);
        var first = other ? RP.linkPrimary(state, r) : r;
        var second = other ? (first === r ? other : r) : null;
        shown[r.id] = true; if (other) shown[other.id] = true;
        var face = first.cast && first.cast[0] ? first.cast[0] : { name: first.title };
        var on = r.id === state.active || (other && other.id === state.active);
        return '<div class="recent' + (on ? ' on' : '') + (other ? ' pair' : '') + '" data-room="' + esc(first.id) + '"' +
          (other ? ' title="Two scenes, one chat: “' + esc(first.sceneName || first.title) + '” and “' + esc(second.sceneName || second.title) + '”"' : '') + '>' +
          avatar(face, 32) + '<span class="name">' + esc(other ? (first.sceneName || first.title) + ' ⇄ ' + (second.sceneName || second.title) : r.title) + '</span>' +
          '<button class="kill" data-kill="' + esc(first.id) + '" title="' + (other ? 'Delete both scenes' : 'Delete chat') + '">✕</button></div>';
      }).join('');
      if (!rows) return;
      html += '<h4>' + labels[key] + '</h4>' + rows;
    });
    $('recents').innerHTML = html || '<div class="emptynote">No chats yet. Pick a character to start one.</div>';
    $('recents').querySelectorAll('[data-room]').forEach(function (node) {
      node.onclick = function (e) {
        if (e.target.dataset.kill) return;
        openRoom(node.dataset.room);
      };
    });
    $('recents').querySelectorAll('[data-kill]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var id = b.dataset.kill;
        var target = (state.rooms || []).filter(function (r) { return r.id === id; })[0];
        if (!target) return;
        var other = RP.linkedRoom(state, target);
        if (!window.confirm(other
          ? 'Delete both scenes — "' + target.title + '" and "' + other.title + '"? The chat goes; its memory and lore stay.'
          : 'Delete "' + target.title + '"? The chat goes; its memory and lore stay.')) return;
        var gone = other ? [id, other.id] : [id];
        state.rooms = state.rooms.filter(function (r) { return gone.indexOf(r.id) < 0; });
        if (gone.indexOf(state.active) >= 0) state.active = '';
        save(); render();
      };
    });

    var u = state.user || {};
    $('account').innerHTML = userAvatar(32) + '<span class="who"><b>' + esc(u.name || 'Archivist') + '</b>' +
      '<span>@' + esc(u.handle || 'waluipedia') + '</span></span><span>⌄</span>';
  }

  /* ---------------------------------------------------------------- *
   * dashboard
   * ---------------------------------------------------------------- */

  /** A card. `extra` is either a caption, or the cast context — in which
   *  case the card shows what the current sort is actually sorting on. */
  /** Real-world time, plainly. Used beside the in-world date everywhere. */
  function ago(at) {
    var secs = Math.max(1, Math.round((Date.now() - (at || 0)) / 1000));
    if (secs < 90) return 'just now';
    var mins = Math.round(secs / 60);
    if (mins < 60) return mins + ' min ago';
    var hours = Math.round(mins / 60);
    if (hours < 36) return hours + 'h ago';
    var days = Math.round(hours / 24);
    if (days < 14) return days + ' days ago';
    return new Date(at).toLocaleDateString();
  }

  function charCard(c, extra) {
    var plays = interactions(c.id);
    var note = typeof extra === 'string' ? extra : '';
    if (extra && typeof extra === 'object') {
      var mem = extra.memory[c.id] || 0;
      note = castSort === 'fame' && c.fameTier ? '★ ' + c.fameTier
        : castSort === 'power' && (c.powerLevel || c.level) ? '⚔ power ' + (c.powerLevel || c.level)
        : castSort === 'remember' ? '🧠 ' + mem + ' remembered'
        : castSort === 'filings' ? '📜 ' + (c.keyEvents || []).length + ' filings'
        : castSort === 'recent' && extra.last[c.id] ? '🕘 ' + ago(extra.last[c.id])
        : c.affiliation || c.race || '';
    }
    return '<button class="ccard" data-char="' + esc(c.id) + '">' + avatar(c, 56) +
      '<span class="body"><b>' + esc(c.name) + (c.invented ? ' <span class="tag">invented</span>' : '') + '</b>' +
      '<span class="by">By @' + esc(c.handle) + '</span>' +
      '<span class="sum">' + esc(c.summary || c.title || 'No filed summary yet.') + '</span>' +
      '<span class="meta"><span>💬 ' + plays + (plays === 1 ? ' interaction' : ' interactions') + '</span>' +
      (note ? '<span>' + esc(RP.clip(note, 40)) + '</span>' : '') +
      '</span></span></button>';
  }

  function sceneCard(s) {
    var names = (s.suggestedCast || []).map(function (c) { return c.name; }).slice(0, 2).join(', ');
    return '<button class="scard" data-scene="' + esc(s.id) + '" style="background-image:url(' + esc(imageUrl(s.image)) + ')">' +
      '<span class="shade"></span><span class="flag">' + (s.beats || []).length + ' beats</span>' +
      '<span class="label"><b>' + esc(s.name) + '</b><span class="cast">' +
      (s.suggestedCast && s.suggestedCast[0] ? avatar(s.suggestedCast[0], 24) : '') +
      esc(names || 'Select cast') + '</span></span></button>';
  }

  function renderDiscover() {
    var filtered = cast;
    if (query) {
      var q = query.toLowerCase();
      filtered = cast.filter(function (c) {
        return (c.name + ' ' + c.title + ' ' + c.summary).toLowerCase().indexOf(q) >= 0;
      });
    }
    // "For you" leads with whoever this reader actually plays, then the rest
    // of the archive — no invented popularity.
    var played = cast.filter(function (c) { return interactions(c.id) > 0; })
      .sort(function (a, b) { return interactions(b.id) - interactions(a.id); });
    var fresh = cast.filter(function (c) { return interactions(c.id) === 0; });
    var forYou = played.concat(fresh).slice(0, 14);

    var html = '';
    html += '<div class="sec-head"><h2>For you</h2><span class="more">›</span><span class="grow"></span>' +
      '<button class="pill" id="groupBtn">👥 Group chat</button>' +
      '<button class="pill" id="randomBtn">🎲 Surprise me</button></div>';
    html += '<div class="row">' + forYou.map(function (c) { return charCard(c); }).join('') + '</div>';
    // Where the advertisement used to be: a few long What-Ifs, not a wall
    // of one-liners. (No ad slot: the archive sells nothing.)
    html += continuationSection({ limit: 4 });
    html += whatIfSection({ limit: 6 });
    html += backfillSection({ limit: 4 });
    html += collectionsSection();
    html += '<div class="sec-head"><h2>Scenes</h2><span class="more">›</span><span class="grow"></span>' +
      '<span class="more">Filed sessions, played from another perspective</span></div>';
    html += scenes.length ? '<div class="row">' + scenes.map(sceneCard).join('') + '</div>'
      : '<div class="emptynote">No filed sessions loaded.</div>';
    html += castBrowser();
    return html;
  }

  /** The cast, browsable: sort it, group it, filter it by race or
   *  affiliation, or narrow it to the people you have actually played.
   *  189 names in one alphabetical list is a phone book. */
  function castBrowser() {
    var ctx = RP.castContext(state);
    var pool = RP.filterCast(cast.concat(state.newChars || []), {
      query: query, race: castRace, affiliation: castAffil, view: castView,
    }, ctx);
    var sorted = RP.sortCast(pool, castSort, ctx);
    var facets = RP.castFacets(cast);
    var VIEWS = { all: 'Everyone', played: 'Played', unplayed: 'Never played', portrait: 'Has a portrait', invented: 'Invented in play' };

    var html = '<div class="sec-head"><h2>The whole cast</h2><span class="grow"></span>' +
      '<span class="more">' + sorted.length + ' of ' + cast.length + '</span></div>' +
      '<div class="castbar">' +
      '<select id="castSort" title="Sort">' + Object.keys(RP.CAST_SORTS).map(function (k) {
        return '<option value="' + k + '"' + (castSort === k ? ' selected' : '') + '>' + esc(RP.CAST_SORTS[k].name) + '</option>';
      }).join('') + '</select>' +
      '<select id="castGroup" title="Group by">' + Object.keys(RP.CAST_GROUPS).map(function (k) {
        return '<option value="' + k + '"' + (castGroup === k ? ' selected' : '') + '>Group: ' + esc(RP.CAST_GROUPS[k].name) + '</option>';
      }).join('') + '</select>' +
      '<select id="castRace" title="Race"><option value="">Any race</option>' + facets.race.map(function (f) {
        return '<option value="' + esc(f.value) + '"' + (castRace === f.value ? ' selected' : '') + '>' + esc(f.value) + ' (' + f.count + ')</option>';
      }).join('') + '</select>' +
      '<select id="castAffil" title="Affiliation"><option value="">Any affiliation</option>' + facets.affiliation.map(function (f) {
        return '<option value="' + esc(f.value) + '"' + (castAffil === f.value ? ' selected' : '') + '>' + esc(RP.clip(f.value, 40)) + ' (' + f.count + ')</option>';
      }).join('') + '</select>' +
      Object.keys(VIEWS).map(function (k) {
        return '<button class="chip ' + (castView === k ? 'on' : '') + '" data-castview="' + k + '">' + esc(VIEWS[k]) + '</button>';
      }).join('') +
      (castRace || castAffil || castView !== 'all' || castSort !== 'name' || castGroup !== 'letter'
        ? '<button class="chip clear" id="castReset">✕ Reset</button>' : '') +
      '</div>';

    if (!sorted.length) return html + '<div class="emptynote">Nothing matches that. Try ✕ Reset.</div>';
    RP.groupCast(sorted, castGroup, ctx).forEach(function (group) {
      if (group.letter) html += '<div class="ltr-head">' + esc(group.letter) + ' <span>' + group.chars.length + '</span></div>';
      html += '<div class="grid">' + group.chars.map(function (c) { return charCard(c, ctx); }).join('') + '</div>';
    });
    return html;
  }

  var KIND_ICON = { filed: '📕', gap: '🚧', divergence: '🔀', chamber: '🏛', flashpoint: '📡', custom: '✍️' };

  /** One What-If, as a card big enough to read: the premise in full, the
   *  cast, the beat count, and the first lines of the brief. */
  function whatIfCard(s) {
    var played = RP.postUsed(state, s.id);
    return '<article class="ifcard' + (s.image ? ' has-plate' : '') + '" data-if="' + esc(s.id) + '">' +
      (s.image ? '<div class="plate" style="background-image:url(' + esc(imageUrl(s.image)) + ')"></div>' : '') +
      '<div class="body">' +
      '<div class="kind">' + (KIND_ICON[s.kind] || '❓') + ' ' + esc(s.kindLabel) +
      (played ? '<span class="done">played</span>' : '<span class="new">unplayed</span>') +
      '<span class="grow"></span><span class="len">' + s.beats.length + ' beats · ' + Math.round(s.brief.length / 6) + ' words of brief</span></div>' +
      '<h3>' + esc((hookFor(s.id) || {}).title || s.name) + '</h3>' +
      (forging[s.id]
        ? '<p class="premise forging">…the model is writing the opener from the filed material…</p>'
        : hookFor(s.id)
          ? '<p class="premise hooked">' + esc(RP.clip(hookFor(s.id).open, 420)) + '</p>' +
            (hookFor(s.id).stakes ? '<p class="stakes">⚠ ' + esc(hookFor(s.id).stakes) + '</p>' : '')
          : '<p class="premise">' + esc(s.premise) + '</p>') +
      '<div class="faces">' + s.suggestedCast.slice(0, 6).map(function (c) { return avatar(c, 32); }).join('') +
      '<span class="who">' + esc(s.suggestedCast.slice(0, 3).map(function (c) { return c.name; }).join(', ')) +
      (s.suggestedCast.length > 3 ? ' +' + (s.suggestedCast.length - 3) : '') + '</span></div>' +
      '<div class="tags">' + s.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' +
      '<div class="acts"><button class="pill primary" data-ifplay="' + esc(s.id) + '">Play this</button>' +
      '<button class="mini" data-ifhook="' + esc(s.id) + '">' + (hookFor(s.id) ? '↻ Another opener' : '⚡ Forge the opener') + '</button>' +
      '<button class="mini" data-ifread="' + esc(s.id) + '">Read the brief</button>' +
      '<span class="src">' + esc(s.source) + '</span></div>' +
      '</div></article>';
  }

  function whatIfSection(opts) {
    opts = opts || {};
    var pool = whatifs.filter(function (s) { return s.kind !== 'continuation'; });
    var shown = pool.slice(0, opts.limit || pool.length);
    var html = '<div class="sec-head"><h2>What If</h2><span class="grow"></span>' +
      '<button class="pill primary" id="makeIf">✍️ Create a scenario</button>' +
      (opts.limit ? '<button class="pill" id="allIfs">See all ' + whatifs.length + '</button>' : '') + '</div>' +
      '<p class="emptynote">A few long branches rather than a wall of prompts. Each one is assembled by this page out of ' +
      'filed records — the archive’s own What-Ifs, its <b>🚧 wanted pages</b> (people named in filings nobody has written up), ' +
      'filed sessions turned at their hinge, the chambers (the Midlands Diet, the Congress, the Pond Patrol), and the ' +
      'loudest posts on the wire. The brief, the cast and the beats are all real; the model only ever plays the people.</p>';
    if (!shown.length) return html + '<div class="emptynote">Still composing the board from the archive…</div>';
    return html + '<div class="ifgrid">' + shown.map(whatIfCard).join('') + '</div>';
  }

  function renderWhatIfs() { return whatIfSection({}); }

  /** Most Used Backfills — the unwritten events everything points at,
   *  ranked by how often this reader has played one and by how many filings
   *  are waiting on it. */
  function backfillSection(opts) {
    opts = opts || {};
    if (!backfills.length) return '';
    var shown = backfills.slice(0, opts.limit || backfills.length);
    var played = backfills.reduce(function (n, b) { return n + (b.uses || 0); }, 0);
    return '<div class="sec-head"><h2>Most Used Backfills</h2><span class="grow"></span>' +
      (opts.limit ? '<button class="pill" id="allBackfills">See all ' + backfills.length + '</button>' : '') + '</div>' +
      '<p class="emptynote">Events the archive keeps referring to and nobody ever wrote: the off-screen battle, ' +
      'the airlift that never came, the session between two sessions. Playing one produces the missing account — ' +
      'export the transcript and the hole is filled. ' + played + ' played here so far.</p>' +
      '<div class="ifgrid">' + shown.map(whatIfCard).join('') + '</div>';
  }

  /** Continue the saga — where the filed record actually stops. */
  function continuationSection(opts) {
    opts = opts || {};
    var list = whatifs.filter(function (s) { return s.kind === 'continuation'; });
    if (!list.length) return '';
    var shown = list.slice(0, opts.limit || list.length);
    return '<div class="sec-head"><h2>Continue the story</h2><span class="grow"></span>' +
      (opts.limit && list.length > shown.length ? '<button class="pill" id="allContinue">See all ' + list.length + '</button>' : '') + '</div>' +
      '<p class="emptynote">The archive stops mid-saga. These pick it up in the minutes after the last filed line and ' +
      'keep going into hours nobody has written: new faces, new places, new trouble. Everything already filed is canon ' +
      'and cannot be contradicted; everything after it is invented in play — including characters, who are described ' +
      'rather than drawn, because nobody has painted them yet.</p>' +
      '<div class="ifgrid">' + shown.map(whatIfCard).join('') + '</div>';
  }

  function renderContinuations() {
    return continuationSection({}) ||
      '<div class="sec-head"><h2>Continue the story</h2></div><div class="emptynote">No sagas loaded yet.</div>';
  }

  function renderBackfills() {
    return backfillSection({}) ||
      '<div class="sec-head"><h2>Most Used Backfills</h2></div>' +
      '<div class="emptynote">No unwritten events found in the records that are loaded. The scan looks for ids that ' +
      'filed records point at — keyEvents and relatedArticles — with no filing of their own.</div>';
  }

  /** A wire post as a scenario card. */
  function wireCard(p) {
    var used = RP.postUsed(state, p.id);
    return '<button class="wcard" data-post="' + esc(p.id) + '">' +
      '<span class="head">' + avatar({ id: p.author, name: p.authorName, image: p.avatar }, 24) +
      '<b>' + esc(p.authorName) + '</b><span class="when">' + esc(p.timestamp || ('#' + p.order)) + '</span></span>' +
      '<span class="post">' + esc(p.content) + '</span>' +
      '<span class="foot">' + (used ? '<span class="done">played</span>' : '<span class="new">unused</span>') +
      '<span>♥ ' + p.likes + '</span>' + (p.comments.length ? '<span>💬 ' + p.comments.length + '</span>' : '') +
      (p.status !== 'posted' ? '<span class="tag">never posted</span>' : '') +
      p.tags.slice(0, 2).map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join('') +
      '</span></button>';
  }

  /** The wire section: sort, the used/unused views, and the cards. `limit`
   *  makes it a row on the dashboard; without one it is the whole Wire tab. */
  function wireSection(opts) {
    opts = opts || {};
    var shown = RP.sortPosts(RP.filterPosts(posts, { view: wireView, query: opts.query || '' }, state), wireSort);
    var unused = RP.filterPosts(posts, { view: 'unused' }, state).length;
    var html = '<div class="sec-head"><h2>' + esc(opts.heading || 'The WAHwire') + '</h2>' +
      '<span class="grow"></span><div class="controls">' +
      '<select id="wireSort">' + Object.keys(RP.POST_SORTS).map(function (k) {
        return '<option value="' + k + '"' + (wireSort === k ? ' selected' : '') + '>' + esc(RP.POST_SORTS[k].name) + '</option>';
      }).join('') + '</select>' +
      Object.keys(RP.POST_VIEWS).map(function (k) {
        return '<button class="chip ' + (wireView === k ? 'on' : '') + '" data-wireview="' + k + '">' +
          esc(RP.POST_VIEWS[k]) + (k === 'unused' ? ' (' + unused + ')' : '') + '</button>';
      }).join('') + '</div></div>' +
      '<p class="emptynote">Every post on the wire can be played as a scenario: the post is the situation, the people it names are the cast, and the replies underneath arrive as beats. ' +
      unused + ' of ' + posts.length + ' have never been played here.</p>';
    if (!shown.length) return html + '<div class="emptynote">No posts match this view.</div>';
    if (opts.limit) return html + '<div class="row">' + shown.slice(0, opts.limit).map(wireCard).join('') + '</div>';
    return html + '<div class="grid">' + shown.slice(0, 120).map(wireCard).join('') + '</div>';
  }

  function collectionsSection() {
    if (!collections.length) return '';
    return '<div class="sec-head"><h2>Collections</h2><span class="more">›</span><span class="grow"></span>' +
      '<span class="more">The archive\u2019s own groupings — one click, the whole table</span></div>' +
      '<div class="row">' + collections.map(function (c) {
        return '<button class="kcard" data-collection="' + esc(c.id) + '"><b>' + esc(c.name) + '</b>' +
          '<span class="sub">' + esc(c.title || c.scope) + '</span>' +
          '<span class="faces">' + c.members.slice(0, 6).map(function (m) { return avatar(m, 32); }).join('') + '</span>' +
          '<span class="count">' + c.members.length + ' of ' + c.total + ' playable</span></button>';
      }).join('') + '</div>';
  }

  function renderWire() {
    return wireSection({ heading: 'The WAHwire — every filed post' });
  }

  function renderCollections() {
    if (!collections.length) return '<div class="emptynote">No collections loaded.</div>';
    return '<div class="sec-head"><h2>Collections</h2><span class="grow"></span><span class="more">' + collections.length + ' groupings</span></div>' +
      '<div class="stack">' + collections.map(function (c) {
        return '<div class="item"><b>' + esc(c.name) + '</b><div class="when">' + esc(c.title || '') + '</div>' +
          '<p>' + esc(c.summary) + '</p><div class="tags">' + c.members.slice(0, 12).map(function (m) {
            return '<span class="tag">' + esc(m.name) + (m.role ? ' — ' + esc(RP.clip(m.role, 40)) : '') + '</span>';
          }).join('') + '</div>' +
          '<div class="acts"><button class="mini" data-collection="' + esc(c.id) + '">Open as a group chat</button></div></div>';
      }).join('') + '</div>';
  }

  /** The lore book: what play has established, oldest page first. */
  function renderBook() {
    var book = RP.bookState(state);
    var entries = book.entries.filter(function (e) {
      if (bookKind !== 'all' && e.kind !== bookKind) return false;
      if (!query) return true;
      return (e.name + ' ' + e.text + ' ' + (e.when || '')).toLowerCase().indexOf(query.toLowerCase()) >= 0;
    });
    var counts = {};
    book.entries.forEach(function (e) { counts[e.kind] = (counts[e.kind] || 0) + 1; });
    var budget = RP.bookBudgetLeft(state);
    var html = '<div class="sec-head"><h2>📓 The lore book</h2><span class="grow"></span>' +
      '<button class="pill" id="bookNew">＋ Write a page</button>' +
      '<button class="pill" id="bookSettings">⚙ Filing</button>' +
      '<button class="pill" id="bookExport">⬇ Export</button></div>' +
      '<p class="emptynote">Written while you play. Every few turns the last stretch of the scene is queued and a ' +
      'small separate call files what is new — places, people, events, things, facts, and a diary entry for the day. ' +
      'The newest page is always at the bottom, and the whole book is handed back to the model so the world stays ' +
      'consistent with itself. One call at a time, ' + budget + ' left in this session\u2019s budget' +
      (book.queue.length ? ' · <b>' + book.queue.length + ' queued</b>' : '') +
      (booking ? ' · <b>writing now…</b>' : '') + '.</p>' +
      '<div class="castbar">' +
      ['all'].concat(Object.keys(RP.BOOK_KINDS)).map(function (k) {
        var label = k === 'all' ? 'All' : (RP.BOOK_KINDS[k].icon + ' ' + RP.BOOK_KINDS[k].label);
        var n = k === 'all' ? book.entries.length : (counts[k] || 0);
        return '<button class="chip ' + (bookKind === k ? 'on' : '') + '" data-bookkind="' + k + '">' + esc(label) + ' ' + n + '</button>';
      }).join('') + '</div>';
    if (!entries.length) {
      return html + '<div class="emptynote">Nothing filed yet. Play a few turns with filing on, or write a page by hand.</div>';
    }
    html += '<div class="bookpages">' + entries.map(function (e, i) {
      var kind = RP.BOOK_KINDS[e.kind] || RP.BOOK_KINDS.fact;
      return '<article class="page ' + esc(e.kind) + '">' +
        '<div class="ph"><span class="ico">' + kind.icon + '</span>' +
        '<b>' + esc(e.kind === 'diary' ? (e.when || 'Diary') : e.name) + '</b>' +
        '<span class="grow"></span>' +
        (e.source === 'you' ? '<span class="tag">yours</span>' : '') +
        (e.seen > 1 ? '<span class="tag">seen ' + e.seen + '×</span>' : '') +
        '<span class="num">' + (book.entries.indexOf(e) + 1) + '</span></div>' +
        '<p>' + esc(e.text) + '</p>' +
        '<div class="pf">' + (e.when ? '<span class="inworld">🕯 ' + esc(e.when) + '</span>' : '') +
        '<span>' + esc(ago(e.at)) + '</span>' + (e.roomTitle ? '<span>' + esc(e.roomTitle) + '</span>' : '') +
        '<span class="grow"></span>' +
        '<button class="mini" data-bookedit="' + esc(e.id) + '">Edit</button>' +
        '<button class="mini danger" data-bookkill="' + esc(e.id) + '">Delete</button></div>' +
        '</article>';
    }).join('') + '</div>';
    return html;
  }

  /* ---------------------------------------------------------------- *
   * saving to disk — localStorage is one cleared cache from gone
   * ---------------------------------------------------------------- */

  var lastSaveAt = 0;

  function everything() {
    return RP.exportBundle(state, { chats: true, lore: true, memory: true, user: true });
  }

  /** Write the whole state to a file beside the server, with backups. */
  function saveToDisk(name, quiet) {
    if (!CFG.saveUrl) { toast('No server to save to — use ⬇ Download a backup.'); return Promise.resolve(null); }
    return window.fetch(CFG.saveUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || 'chatroom', state: everything() }),
    }).then(function (res) { return res.json(); }).then(function (out) {
      if (out.error) throw new Error(out.error);
      lastSaveAt = Date.now();
      if (!quiet) toast('💾 Saved to ' + out.saved + ' — ' + Math.round(out.bytes / 1024) + ' KB, ' + out.rooms + ' chats.');
      renderSaveBadge();
      return out;
    }).catch(function (error) {
      if (!quiet) toast('Could not save to disk: ' + error.message + '. The workflow server has to be running.');
      return null;
    });
  }

  function restoreFromDisk() {
    if (!CFG.savesUrl) { toast('No server to read from — use ⬆ Restore from a file.'); return; }
    getJSON(CFG.savesUrl).then(function (data) {
      var saves = (data && data.saves) || [];
      if (!saves.length) { toast('Nothing saved to disk yet.'); return; }
      list('Restore from disk', saves.map(function (row) {
        return {
          label: '💾 ' + row.name + ' — ' + row.at + ' · ' + row.rooms + ' chats · ' +
            row.book + ' book pages · ' + Math.round(row.bytes / 1024) + ' KB',
          value: row.name,
        };
      }), function (name) {
        getJSON(CFG.saveUrl + '?name=' + encodeURIComponent(name)).then(function (out) {
          if (!out || !out.state) { toast('That save could not be read.'); return; }
          openModal('<h3>Restore “' + esc(name) + '”?</h3>' +
            '<p class="sub">Merging keeps what is in this browser and adds whatever the save has that is missing. ' +
            'Replacing throws away what is here and takes the file as the truth.</p>' +
            '<div class="actions"><button class="pill" id="mCancel">Cancel</button>' +
            '<button class="pill" id="mMerge">Merge</button>' +
            '<button class="pill danger" id="mOk">Replace</button></div>');
          $('mCancel').onclick = closeModal;
          $('mMerge').onclick = function () { closeModal(); applyRestore(out.state, 'merge'); };
          $('mOk').onclick = function () { closeModal(); applyRestore(out.state, 'replace'); };
        });
      });
    }).catch(function () { toast('The workflow server is not answering.'); });
  }

  function applyRestore(bundle, mode) {
    var stats = RP.importBundle(state, bundle, mode);
    save(); buildBoard(); render();
    toast('Restored ' + (stats.rooms || 0) + ' chats, ' + (stats.book || 0) + ' book pages.');
  }

  function renderSaveBadge() {
    var badge = $('saveBadge');
    if (!badge) return;
    badge.textContent = lastSaveAt ? '💾 saved ' + ago(lastSaveAt) : '';
    badge.hidden = !lastSaveAt;
  }

  /** Autosave: quiet, throttled, and off unless asked for. */
  function autosave() {
    if ((state.settings.autosave || 'off') === 'off' || !CFG.saveUrl) return;
    if (Date.now() - lastSaveAt < 60000) return;
    saveToDisk('chatroom', true);
  }

  /** What the model is actually being sent — size, blocks, and the text. */
  function promptInspector() {
    // Works from Labs as well as from inside a chat: the most recent scene
    // is the one whose prompt anybody wants to see.
    var r = room() || (state.rooms || []).slice().sort(function (a, b) { return b.updated - a.updated; })[0];
    if (!r) { toast('Play something first — the prompt is built per scene.'); return; }
    var speaker = RP.nextSpeaker(r);
    var recent = RP.historyFor(r, 4).map(function (m) { return m.content; }).join(' ');
    var found = RP.citableFor(archiveIndex, r, state, { query: recent + ' ' + (r.scene || ''), limit: 6 });
    var read = searchForTurn(r, speaker, recent);
    var system = RP.systemFor(state, r, speaker, {
      archive: archive,
      citations: [RP.citationBlock(found), read.length ? RP.retrievalBlock(read) : ''].filter(Boolean).join('\n\n'),
    });
    var blocks = system.split('\n\n').map(function (b) {
      return { head: RP.clip(b.split('\n')[0], 60), size: b.length };
    }).sort(function (a, b) { return b.size - a.size; }).slice(0, 10);
    openModal('<h3>What the model is sent</h3>' +
      '<p class="sub">' + system.length + ' characters of system prompt, budget ' + RP.PROMPT_BUDGET +
      '. Reference material is trimmed before the scene’s own instructions ever are.</p>' +
      '<div class="castbar">' + blocks.map(function (b) {
        return '<span class="chip">' + esc(b.head) + ' · ' + b.size + '</span>';
      }).join('') + '</div>' +
      '<textarea readonly rows="14" style="width:100%">' + esc(system) + '</textarea>' +
      '<div class="actions"><button class="pill" id="mCancel">Close</button>' +
      '<button class="pill" id="mCopy">⬇ Save it</button></div>');
    $('mCancel').onclick = closeModal;
    $('mCopy').onclick = function () { download('prompt.txt', system); };
  }

  /* ---------------------------------------------------------------- *
   * commentary mode — Waluigi and Luigi, generated a segment at a time
   * ---------------------------------------------------------------- */

  var episode = null;      // the run in progress
  var running = false;     // a segment call is in flight
  var stopRun = false;

  function renderCommentary() {
    var saved = state.episodes || [];
    var styles = RP.COMMENTARY_STYLES;
    var html = '<div class="sec-head"><h2>🎙 Commentary</h2><span class="grow"></span>' +
      (episode && !running && !episode.done ? '<button class="pill primary" id="comResume">▶ Carry on</button>' : '') +
      (running ? '<button class="pill danger" id="comStop">■ Stop</button>' : '') + '</div>' +
      '<p class="emptynote">Waluigi and Luigi, on whatever you point them at. The subject is pulled from the filed ' +
      'record — events, factions, the wire, your own chats and lore book — and written a segment at a time so a ' +
      'local model can actually finish it: one call in flight, the outline and the last thing said handed forward ' +
      'each time. A podcast runs 15–60 minutes; a deep dive runs 30 minutes to two hours.</p>';

    html += '<div class="castbar">' +
      '<input type="text" id="comTopic" placeholder="A subject — “The Iron Mandate”, “Wario’s accounting”, a character, a chat" value="' + esc(comTopic) + '">' +
      '<select id="comStyle">' + Object.keys(styles).map(function (k) {
        return '<option value="' + k + '"' + (comStyle === k ? ' selected' : '') + '>' + esc(styles[k].name) + ' — ' + esc(styles[k].blurb) + '</option>';
      }).join('') + '</select>' +
      '<label class="mins">minutes <input type="number" id="comMins" min="' + styles[comStyle].min + '" max="' + styles[comStyle].max +
        '" value="' + comMins + '"></label>' +
      '<button class="pill primary" id="comGo">🎬 Generate</button>' +
      '<button class="pill" id="comPick">📚 Use a filed subject</button>' +
      '</div>';

    if (episode) {
      var stats = RP.commentaryStats(episode.lines || []);
      var done = (episode.segments || []).filter(function (x) { return x.done; }).length;
      html += '<div class="epi-head"><b>' + esc(episode.topic) + '</b>' +
        '<span>' + esc(episode.styleName) + ' · target ' + episode.minutes + ' min</span>' +
        '<span class="meter"><span style="width:' + Math.round((done / episode.segments.length) * 100) + '%"></span></span>' +
        '<span>' + done + '/' + episode.segments.length + ' segments · ' + stats.words + ' words · ~' + stats.minutes + ' min' +
        (running ? ' · writing…' : '') + '</span>' +
        (episode.lines && episode.lines.length ? '<span class="grow"></span>' +
          '<button class="mini" id="comPlay">' + (speaking ? '⏸ Stop reading' : '🔊 Read it aloud') + '</button>' +
          '<button class="mini" id="comMd">⬇ Script</button>' +
          '<button class="mini" id="comTxt">⬇ Plain text</button>' : '') +
        '</div>';
      if (episode.sources && episode.sources.length) {
        html += '<div class="castbar">' + episode.sources.map(function (src) {
          return '<span class="chip">' + esc(src.kind) + ' · ' + esc(RP.clip(src.name, 40)) + (src.date ? ' · ' + esc(src.date) : '') + '</span>';
        }).join('') + '</div>';
      }
      html += '<div class="episode">' + (episode.lines || []).map(function (line, i) {
        return '<div class="say ' + esc(line.who) + '" data-say="' + i + '">' +
          '<b>' + (line.who === 'waluigi' ? 'Waluigi' : 'Luigi') + '</b><p>' + esc(line.text) + '</p></div>';
      }).join('') + (running ? '<div class="say pending"><em>…writing the next segment…</em></div>' : '') + '</div>';
    }

    if (saved.length) {
      html += '<div class="sec-head"><h2>Recorded</h2></div><div class="stack">' + saved.map(function (e) {
        var st = RP.commentaryStats(e.lines || []);
        return '<div class="item"><b>' + esc(e.topic) + '</b><div class="when">' + esc(e.styleName) + ' · ' +
          st.minutes + ' min · ' + st.words + ' words · ' + esc(ago(e.at || e.created)) + '</div>' +
          '<div class="acts"><button class="mini" data-epiopen="' + esc(e.id) + '">Open</button>' +
          '<button class="mini danger" data-epikill="' + esc(e.id) + '">Delete</button></div></div>';
      }).join('') + '</div>';
    }
    return html;
  }

  /** Generate the next unwritten segment, then the next, until the plan is
   *  finished or you stop it. One call at a time, always. */
  function runCommentary() {
    if (running || !episode) return;
    var next = (episode.segments || []).filter(function (x) { return !x.done; })[0];
    if (!next) {
      episode.done = true; RP.saveEpisode(state, episode); save(); render();
      toast('🎙 Finished — ' + RP.commentaryStats(episode.lines).minutes + ' minutes of it.');
      return;
    }
    running = true; stopRun = false; render();
    var previous = (episode.lines || []).slice(-3).map(function (l) {
      return (l.who === 'waluigi' ? 'WALUIGI: ' : 'LUIGI: ') + l.text;
    }).join('\n');
    var covered = (episode.segments || []).filter(function (x) { return x.done; }).map(function (x) { return x.focus; });
    callModel(RP.commentaryPrompt(episode, next, { previous: previous, covered: covered }),
      [{ role: 'user', content: 'Write part ' + next.n + '.' }], { tokens: 900 })
      .then(function (text) {
        var lines = RP.parseCommentary(text);
        if (!lines.length) throw new Error('the model wrote nothing usable');
        next.done = true; next.text = text;
        episode.lines = (episode.lines || []).concat(lines);
        episode.at = Date.now();
        RP.saveEpisode(state, episode);
        save();
      })
      .catch(function (error) {
        toast('The model stopped: ' + error.message + ' — press ▶ Carry on to try again.');
        stopRun = true;
        RP.saveEpisode(state, episode);
        save();
      })
      .then(function () {
        running = false;
        render();
        if (!stopRun && (episode.segments || []).some(function (x) { return !x.done; })) {
          window.setTimeout(runCommentary, 900);     // a breath between calls
        } else if (!stopRun) {
          episode.done = true; RP.saveEpisode(state, episode); save(); render();
          toast('🎙 Finished — ' + RP.commentaryStats(episode.lines).minutes + ' minutes of it.');
        }
      });
  }

  function renderFeed() {
    var KINDS = ['all', 'chat', 'beat', 'pin', 'note', 'whatif', 'backfill', 'roster', 'lore', 'replay', 'wire'];
    var log = (state.log || []).filter(function (e) {
      if (logKind !== 'all' && e.kind !== logKind) return false;
      if (!query) return true;
      return (e.text + ' ' + e.roomTitle + ' ' + (e.when || '')).toLowerCase().indexOf(query.toLowerCase()) >= 0;
    }).slice().reverse();
    var html = '<div class="sec-head"><h2>Feed — the world log</h2><span class="grow"></span>' +
      '<button class="pill" id="logAdd">＋ File a note</button>' +
      '<button class="pill" id="logExport">⬇ Export log</button></div>' +
      '<p class="emptynote">Every memory is filed twice: the in-world date it happened on, and the moment it was played. ' +
      'Characters are told what has already happened — and, when a filing sits after the scene they are in, that they ' +
      'cannot know it yet.</p>' +
      '<div class="castbar">' + KINDS.map(function (k) {
        return '<button class="chip ' + (logKind === k ? 'on' : '') + '" data-logkind="' + k + '">' + esc(k) + '</button>';
      }).join('') + '</div>';
    if (!log.length) return html + '<div class="emptynote">Nothing filed yet. Play a turn, or pin a line with “Remember”.</div>';
    html += '<div class="stack">' + log.map(function (e) {
      var who = (e.chars || []).map(function (id) { return (castById[id] || { name: id }).name; }).join(', ');
      return '<div class="item"><div class="when">' +
        (e.when ? '<b class="inworld">🕯 ' + esc(e.when) + '</b> · ' : '') +
        ago(e.at) + ' · ' + esc(e.kind) +
        (e.roomTitle ? ' · ' + esc(e.roomTitle) : '') + '</div><b>' + esc(e.text) + '</b>' +
        (who ? '<div class="tags"><span class="tag">' + esc(who) + '</span></div>' : '') +
        '<div class="acts"><button class="mini danger" data-logkill="' + esc(e.id) + '">Delete</button>' +
        '<button class="mini" data-logtolore="' + esc(e.id) + '">Promote to lore</button></div></div>';
    }).join('') + '</div>';
    return html;
  }

  function renderCharms() {
    var html = '<div class="sec-head"><h2>Charms — world lore</h2><span class="grow"></span>' +
      '<button class="pill" id="loreAdd">＋ New lore node</button>' +
      '<button class="pill" id="loreExport">⬇ Export lore</button>' +
      '<button class="pill" id="loreImport">⬆ Import lore</button></div>' +
      '<p class="emptynote">Lore nodes are treated as established truth. A node with no tags and no characters is world-wide; tags match the scene, characters match the cast.</p>';
    var nodes = state.lore || [];
    if (!nodes.length) return html + '<div class="emptynote">No lore filed yet.</div>';
    html += '<div class="stack">' + nodes.map(function (n) {
      return '<div class="item"><b>' + esc(n.title) + '</b><div class="when">' + esc(n.source || 'filed by hand') + '</div>' +
        '<p>' + esc(RP.clip(n.text, 400)) + '</p><div class="tags">' +
        (n.tags || []).map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join('') +
        (n.chars || []).map(function (id) { return '<span class="tag">' + esc((castById[id] || { name: id }).name) + '</span>'; }).join('') +
        '</div><div class="acts"><button class="mini" data-loreedit="' + esc(n.id) + '">Edit</button>' +
        '<button class="mini danger" data-lorekill="' + esc(n.id) + '">Delete</button></div></div>';
    }).join('') + '</div>';
    return html;
  }

  function renderLabs() {
    var html = '<div class="sec-head"><h2>Labs</h2><span class="grow"></span>' +
      '<button class="pill" id="promptPeek">🔍 What the model is sent</button></div>';
    html += '<p class="emptynote">Character cards, stories in and out, perspective replay, memory inspection, and backups.</p>';

    // Cards and plain text: the formats everything else in this hobby uses.
    // Who you are, in every chat.
    var persona = RP.personaSheet(state);
    html += '<div class="sec-head"><h2>Your persona</h2><span class="grow"></span>' +
      '<button class="pill" id="personaEdit">✏️ Edit</button></div>' +
      '<p class="emptynote">One sheet, carried into every chat: who you are, what you look like, what you are ' +
      'carrying. Separate from the archive characters — ★ star one of those in a scene and you play them, but this ' +
      'is still you underneath.</p>' +
      '<div class="stack"><div class="item"><b>' + esc(persona.name || 'Not written yet') + '</b>' +
      (persona.voice ? '<div class="when">' + esc(persona.voice) + '</div>' : '') +
      (persona.look ? '<p>' + esc(persona.look) + '</p>' : '') +
      ((persona.items || []).length ? '<div class="tags">' + persona.items.map(function (i) {
        var it = RP.normItem(i);
        return '<span class="tag">' + esc(it.icon + ' ' + it.name) + '</span>';
      }).join('') + '</div>' : '') +
      (persona.notes ? '<p>' + esc(persona.notes) + '</p>' : '') + '</div></div>';

    // Keyword lore: exact facts, injected the moment they are named.
    var keys = state.keywords || [];
    html += '<div class="sec-head"><h2>Keyword lore</h2><span class="grow"></span>' +
      '<button class="pill" id="keyAdd">＋ New trigger</button></div>' +
      '<p class="emptynote">When one of these words turns up in the last few turns, its text goes into the prompt ' +
      'word for word, so the model cannot invent a different version of something you have already settled. ' +
      'A trigger wrapped in slashes is a regular expression — <code>/dark shores?/i</code>. ' +
      keys.length + ' filed.</p>' +
      (keys.length ? '<div class="stack">' + keys.slice().reverse().map(function (k) {
        return '<div class="item"><b>' + esc(k.always ? 'Always on' : k.keys.join(' · ')) + '</b><p>' + esc(k.text) + '</p>' +
          '<div class="acts"><button class="mini danger" data-keykill="' + esc(k.id) + '">Delete</button></div></div>';
      }).join('') + '</div>' : '');

    // Somewhere to put the state that is not the browser's cache.
    html += '<div class="sec-head"><h2>Keeping it</h2></div>' +
      '<p class="emptynote">Everything lives in this browser’s storage, and a cleared cache takes it with it. ' +
      '<b>Save to disk</b> writes the whole state — chats, memory, lore book, cards, episodes — as a real file ' +
      'beside the workflow server (<code>workflow/saves/</code>), keeping the last ten versions behind it. ' +
      'Autosave does the same quietly, at most once a minute. The download is the same bundle if you would rather ' +
      'keep it yourself.</p>' +
      '<div class="castbar">' +
      '<button class="pill primary" id="diskSave">💾 Save to disk</button>' +
      '<button class="pill" id="diskRestore">📂 Restore from disk</button>' +
      '<button class="pill' + ((state.settings.autosave || 'off') === 'on' ? ' primary' : '') + '" id="diskAuto">' +
        ((state.settings.autosave || 'off') === 'on' ? '⏱ Autosave is on' : '⏱ Autosave is off') + '</button>' +
      '<span class="chip" id="saveBadge" hidden></span>' +
      '</div>';

    html += '<div class="sec-head"><h2>Character cards &amp; stories</h2></div>' +
      '<p class="emptynote">Character cards are read and written in the usual format: <b>PNG</b> with the card in its ' +
      '<code>chara</code> chunk (SillyTavern, Chub, Agnai) and <b>JSON</b> v2 with the v1 fields alongside. Exporting an ' +
      'archive character writes the card into their own filed portrait, so the file is a picture and a card at once. ' +
      'Stories go in and out as plain text too.</p>' +
      '<div class="castbar">' +
      '<button class="pill" id="cardImport">📇 Import a card (.png / .json)</button>' +
      '<button class="pill" id="cardExport">📤 Export a character as a card</button>' +
      '<button class="pill" id="textImport">📥 Import a story (into a chat, or a new one)</button>' +
      '<button class="pill" id="briefExport">✍️ Story brief for a writing model</button>' +
      '</div>';

    html += '<div class="sec-head"><h2>Perspective dynamic replay</h2></div>' +
      '<p class="emptynote">Re-run a chat or a filed session from another vantage point: the beats stay on their script while a new cast plays the same hours from where <em>they</em> stood — the timber-cutters watching the rebels come out of the treeline, not the rebels.</p>';
    var replayable = (state.rooms || []).filter(function (r) { return RP.counter(r) > 1; })
      .concat(scenes.map(function (s) { return { id: 'scene:' + s.id, title: s.name, scene: true, beats: s.beats || [] }; }));
    html += replayable.length ? '<div class="stack">' + replayable.map(function (r) {
      return '<div class="item"><b>' + esc(r.title) + '</b><div class="when">' +
        (r.scene ? 'filed session' : RP.counter(r) + ' turns played') + ' · ' + ((r.beats || []).length || RP.beatsFromRoom(r).length) + ' beats' +
        '</div><div class="acts"><button class="mini" data-replay="' + esc(r.id) + '">Replay from another perspective</button></div></div>';
    }).join('') + '</div>' : '<div class="emptynote">Play a chat first, or load the filed sessions.</div>';

    html += '<div class="sec-head"><h2>Character memory</h2><span class="grow"></span>' +
      '<button class="pill" id="memExport">⬇ Export memory</button></div>';
    var mems = (state.chars || []).filter(function (m) { return m.notes.length || m.mood || m.knowledge.length; });
    html += mems.length ? '<div class="stack">' + mems.map(function (m) {
      var rel = Object.keys(m.relations || {}).map(function (k) { return m.relations[k].name + ' ' + (m.relations[k].score > 0 ? '+' : '') + m.relations[k].score; });
      return '<div class="item"><b>' + esc(m.name) + '</b><div class="when">' + m.notes.length + ' remembered lines' +
        (m.mood ? ' · mood: ' + esc(m.mood) : '') + '</div>' +
        (m.knowledge.length ? '<p>Knows: ' + esc(m.knowledge.slice(-4).join('; ')) + '</p>' : '') +
        (rel.length ? '<div class="tags">' + rel.map(function (r) { return '<span class="tag">' + esc(r) + '</span>'; }).join('') + '</div>' : '') +
        '<div class="acts"><button class="mini" data-memmood="' + esc(m.id) + '">Set mood</button>' +
        '<button class="mini" data-memteach="' + esc(m.id) + '">Teach a fact</button>' +
        '<button class="mini danger" data-memclear="' + esc(m.id) + '">Forget</button></div></div>';
    }).join('') + '</div>' : '<div class="emptynote">No character memory yet.</div>';

    html += '<div class="sec-head"><h2>Backups</h2></div><div class="stack"><div class="item">' +
      '<b>Export</b><p class="emptynote">Chats, lore and memory travel together or on their own, as JSON.</p>' +
      '<div class="acts"><button class="mini" id="exportAll">Everything</button>' +
      '<button class="mini" id="exportChats">Chats only</button>' +
      '<button class="mini" id="exportLore">Lore only</button>' +
      '<button class="mini" id="exportMem">Memory only</button></div></div>' +
      '<div class="item"><b>Import</b><p class="emptynote">Merging keeps what is here and adds what is missing; replacing swaps the sections in the file.</p>' +
      '<div class="acts"><button class="mini" id="importMerge">Import &amp; merge</button>' +
      '<button class="mini danger" id="importReplace">Import &amp; replace</button></div></div>' +
      '<div class="item"><b>Settings</b><p class="emptynote">Model endpoint, default style, and who you play.</p>' +
      '<div class="acts"><button class="mini" id="setEndpoint">Model endpoint</button>' +
      '<button class="mini" id="setPersona">Your persona</button>' +
      '<button class="mini" id="setAccount">Your account</button></div></div></div>';
    return html;
  }

  function renderDash() {
    $('dash').hidden = false;
    $('chatview').hidden = true;
    var body = tab === 'feed' ? renderFeed()
      : tab === 'commentary' ? renderCommentary()
      : tab === 'book' ? renderBook()
      : tab === 'continue' ? renderContinuations()
      : tab === 'whatif' ? renderWhatIfs()
      : tab === 'backfills' ? renderBackfills()
      : tab === 'wire' ? renderWire()
      : tab === 'collections' ? renderCollections()
      : tab === 'charms' ? renderCharms()
      : tab === 'labs' ? renderLabs()
      : renderDiscover();
    $('dashBody').innerHTML = body;
    wireDash();
  }

  function wireDash() {
    var box = $('dashBody');
    box.querySelectorAll('[data-char]').forEach(function (b) {
      b.onclick = function () { startSolo(castById[b.dataset.char]); };
    });
    box.querySelectorAll('[data-scene]').forEach(function (b) {
      b.onclick = function () { openScene(scenes.filter(function (s) { return s.id === b.dataset.scene; })[0]); };
    });
    var on = function (id, fn) { var node = $(id); if (node) node.onclick = fn; };
    on('groupBtn', function () { castPicker({ title: 'Group chat', note: 'Pick everyone who is in the room.' }, function (picked) { startGroup(picked); }); });
    on('randomBtn', function () { if (cast.length) startSolo(cast[Math.floor(Math.random() * cast.length)]); });
    box.querySelectorAll('[data-ifplay]').forEach(function (b) {
      b.onclick = function () { playWhatIf(b.dataset.ifplay); };
    });
    box.querySelectorAll('[data-ifhook]').forEach(function (b) {
      b.onclick = function () { forgeHook(whatIfById(b.dataset.ifhook)); };
    });
    box.querySelectorAll('[data-ifread]').forEach(function (b) {
      b.onclick = function () { readWhatIf(b.dataset.ifread); };
    });
    box.querySelectorAll('.ifcard').forEach(function (card) {
      card.onclick = function (e) {
        var d = e.target.dataset || {};
        if (!d.ifplay && !d.ifread && !d.ifhook) readWhatIf(card.dataset.if);
      };
    });
    ['castSort', 'castGroup', 'castRace', 'castAffil'].forEach(function (id) {
      if ($(id)) $(id).onchange = function () {
        if (id === 'castSort') castSort = $(id).value;
        if (id === 'castGroup') castGroup = $(id).value;
        if (id === 'castRace') castRace = $(id).value;
        if (id === 'castAffil') castAffil = $(id).value;
        renderDash();
      };
    });
    box.querySelectorAll('[data-castview]').forEach(function (b) {
      b.onclick = function () { castView = b.dataset.castview; renderDash(); };
    });
    on('castReset', function () {
      castSort = 'name'; castGroup = 'letter'; castRace = ''; castAffil = ''; castView = 'all';
      renderDash();
    });
    box.querySelectorAll('[data-bookkind]').forEach(function (b) {
      b.onclick = function () { bookKind = b.dataset.bookkind; renderDash(); };
    });
    box.querySelectorAll('[data-bookkill]').forEach(function (b) {
      b.onclick = function () { RP.bookRemove(state, b.dataset.bookkill); save(); renderDash(); };
    });
    box.querySelectorAll('[data-bookedit]').forEach(function (b) {
      b.onclick = function () {
        var entry = RP.bookState(state).entries.filter(function (e) { return e.id === b.dataset.bookedit; })[0];
        if (!entry) return;
        form('Edit page', [
          { k: 'name', label: 'Name', value: entry.name },
          { k: 'text', label: 'What it is', type: 'area', value: entry.text },
          { k: 'when', label: 'In-world date', value: entry.when || '' },
        ], {}, function (v) {
          entry.name = v.name.trim() || entry.name;
          entry.text = v.text.trim();
          entry.when = v.when.trim();
          entry.updated = Date.now();
          save(); renderDash();
        });
      };
    });
    on('bookNew', function () {
      form('Write a page', [
        { k: 'kind', label: 'What kind of page?', type: 'select', value: 'place',
          options: Object.keys(RP.BOOK_KINDS).map(function (k) {
            return { value: k, label: RP.BOOK_KINDS[k].icon + ' ' + RP.BOOK_KINDS[k].label };
          }) },
        { k: 'name', label: 'Name', value: '' },
        { k: 'text', label: 'What it is', type: 'area', value: '' },
        { k: 'when', label: 'In-world date (optional)', value: roomDate(room() || {}) || '' },
      ], { note: 'Handed to the model in every chat from now on, as established fact.' }, function (v) {
        if (!v.name.trim() && v.kind !== 'diary') { toast('Give the page a name.'); return; }
        RP.bookAdd(state, { kind: v.kind, name: v.name.trim(), text: v.text.trim(), when: v.when.trim(), source: 'you' });
        save(); renderDash(); toast('Filed.');
      });
    });
    on('bookSettings', function () {
      form('Filing', [
        { k: 'book', label: 'Write the book while I play', type: 'select', value: state.settings.book || 'on',
          options: [{ value: 'on', label: 'Yes — file in the background' }, { value: 'off', label: 'No — I will write it myself' }] },
        { k: 'bookEvery', label: 'File after every N played turns', value: String(state.settings.bookEvery || 3) },
        { k: 'bookBudget', label: 'Most background calls per session', value: String(state.settings.bookBudget || RP.BOOK_BUDGET) },
      ], { note: 'Filing is a separate, small model call that never runs at the same time as a roleplay turn, never more than one at once, and stops when the budget runs out — so a local model on a laptop is not asked to do two things at once.' }, function (v) {
        state.settings.book = v.book;
        state.settings.bookEvery = Math.max(2, Math.min(12, parseInt(v.bookEvery, 10) || 3));
        state.settings.bookBudget = Math.max(0, Math.min(400, parseInt(v.bookBudget, 10) || RP.BOOK_BUDGET));
        save(); renderDash();
      });
    });
    on('bookExport', function () {
      download('waluipedia-lorebook.json', JSON.stringify(RP.exportBundle(state, { chats: false, memory: false, user: false }), null, 2));
    });
    box.querySelectorAll('[data-logkind]').forEach(function (b) {
      b.onclick = function () { logKind = b.dataset.logkind; renderDash(); };
    });
    on('makeIf', createScenarioForm);
    on('allIfs', function () { tab = 'whatif'; render(); });
    on('allBackfills', function () { tab = 'backfills'; render(); });
    on('allContinue', function () { tab = 'continue'; render(); });
    box.querySelectorAll('[data-post]').forEach(function (b) {
      b.onclick = function () { openScenario(posts.filter(function (p) { return p.id === b.dataset.post; })[0]); };
    });
    box.querySelectorAll('[data-collection]').forEach(function (b) {
      b.onclick = function () { openCollection(collections.filter(function (c) { return c.id === b.dataset.collection; })[0]); };
    });
    box.querySelectorAll('[data-wireview]').forEach(function (b) {
      b.onclick = function () { wireView = b.dataset.wireview; renderDash(); };
    });
    if ($('wireSort')) $('wireSort').onchange = function () { wireSort = $('wireSort').value; renderDash(); };
    on('logAdd', function () {
      form('File a note into the world log', [{ k: 'text', label: 'What happened', type: 'area' }], {}, function (v) {
        if (!v.text.trim()) return;
        RP.logEvent(state, { kind: 'note', text: v.text, chars: [] });
        save(); render(); toast('Filed into the log.');
      });
    });
    on('logExport', function () { download('waluipedia-log.json', JSON.stringify({ kind: RP.BUNDLE_KIND, version: 1, log: state.log || [] }, null, 2)); });
    on('loreAdd', function () { loreForm(null); });
    on('loreExport', function () { download('waluipedia-lore.json', JSON.stringify(RP.exportBundle(state, { chats: false, memory: false, user: false }), null, 2)); });
    on('loreImport', function () { importFile('merge'); });
    // ---- commentary ----
    if ($('comTopic')) $('comTopic').oninput = function () { comTopic = $('comTopic').value; };
    if ($('comStyle')) $('comStyle').onchange = function () {
      comStyle = $('comStyle').value;
      var def = RP.COMMENTARY_STYLES[comStyle];
      comMins = Math.max(def.min, Math.min(def.max, comMins || def.default));
      renderDash();
    };
    if ($('comMins')) $('comMins').onchange = function () { comMins = parseInt($('comMins').value, 10) || comMins; };
    on('comGo', function () {
      var topic = ($('comTopic') && $('comTopic').value || '').trim();
      if (!topic) { toast('Give them something to argue about.'); return; }
      comTopic = topic;
      episode = RP.commentaryPlan({
        style: comStyle, topic: topic, minutes: comMins,
        sources: RP.commentarySources(archiveIndex, topic, 12),
      });
      episode.at = Date.now();
      // Save the plan straight away: a run that fails halfway should still
      // leave the reader whatever was written.
      RP.saveEpisode(state, episode);
      save();
      if (!episode.sources.length) toast('Nothing filed matches that — they will argue from first principles.');
      render();
      runCommentary();
    });
    on('comResume', runCommentary);
    on('comStop', function () { stopRun = true; toast('Stopping after this segment.'); });
    on('comPick', function () {
      // The subject can be anything the archive already has, or a chat.
      var choices = (archive.events || []).slice(-24).reverse().map(function (e) {
        return { label: '📜 ' + e.name + (e.date ? ' — ' + RP.clip(e.date, 40) : ''), value: e.name };
      }).concat((state.rooms || []).slice(0, 8).map(function (r) {
        return { label: '💬 ' + r.title + ' (your chat)', value: r.sceneName || r.title };
      })).concat(((state.book || {}).entries || []).slice(-8).reverse().map(function (b) {
        return { label: '📓 ' + b.name, value: b.name };
      }));
      list('Pick a subject', choices, function (value) {
        comTopic = value;
        renderDash();
        if ($('comTopic')) $('comTopic').value = value;
      });
    });
    on('comMd', function () { download(RP.slug(episode.topic) + '.commentary.md', RP.commentaryScript(episode)); });
    on('comTxt', function () {
      download(RP.slug(episode.topic) + '.commentary.txt', (episode.lines || []).map(function (l) {
        return (l.who === 'waluigi' ? 'WALUIGI: ' : 'LUIGI: ') + l.text;
      }).join('\n\n'));
    });
    on('comPlay', function () { speaking ? stopReading() : readEpisode(episode); });
    box.querySelectorAll('[data-epiopen]').forEach(function (b) {
      b.onclick = function () {
        episode = (state.episodes || []).filter(function (e) { return e.id === b.dataset.epiopen; })[0];
        comTopic = episode.topic; comStyle = episode.style; comMins = episode.minutes;
        renderDash();
      };
    });
    box.querySelectorAll('[data-epikill]').forEach(function (b) {
      b.onclick = function () {
        state.episodes = (state.episodes || []).filter(function (e) { return e.id !== b.dataset.epikill; });
        if (episode && episode.id === b.dataset.epikill) episode = null;
        save(); renderDash();
      };
    });
    on('personaEdit', function () {
      var p = RP.personaSheet(state);
      form('Your persona', [
        { k: 'name', label: 'Name', value: p.name },
        { k: 'voice', label: 'In one line — who are you?', value: p.voice },
        { k: 'look', label: 'What do you look like?', type: 'area', value: p.look },
        { k: 'items', label: 'Carrying — "🗝 a brass key | bent", one per line. This seeds your pack in every new chat.',
          type: 'area',
          value: (p.items || []).map(RP.normItem).map(function (i) {
            return (i.icon ? i.icon + ' ' : '') + i.name + (i.note ? ' | ' + i.note : '');
          }).join('\n') },
        { k: 'notes', label: 'Anything else the cast should know', type: 'area', value: p.notes },
      ], { note: 'Handed to the model in every chat, under “THE USER PLAYS”. The kit becomes your pack — the grid on your own sheet — the first time a scene needs it.' }, function (v) {
        p.name = v.name.trim(); p.voice = v.voice.trim(); p.look = v.look.trim();
        p.items = v.items.split(/\n/).map(function (line) {
          var item = RP.normItem(line);
          return item.name ? item : null;
        }).filter(Boolean);
        p.notes = v.notes.trim();
        if (p.name && !(state.user.name || '').trim()) state.user.name = p.name;
        save(); render();
        toast('That is you now, in every chat.');
      });
    });
    on('keyAdd', function () {
      form('A trigger and its fact', [
        { k: 'keys', label: 'Trigger words, comma separated (or /a regex/i)', value: '' },
        { k: 'text', label: 'What is true about it — this goes in word for word', type: 'area', value: '' },
      ], { note: 'Keep it short and exact. Fifty words of fact beats five hundred of atmosphere.' }, function (v) {
        if (!RP.addKeyword(state, v)) { toast('It needs at least one trigger word.'); return; }
        save(); renderDash();
        toast('Filed — it will appear whenever that word does.');
      });
    });
    box.querySelectorAll('[data-keykill]').forEach(function (b) {
      b.onclick = function () { RP.removeKeyword(state, b.dataset.keykill); save(); renderDash(); };
    });
    on('diskSave', function () { saveToDisk('chatroom'); });
    on('diskRestore', restoreFromDisk);
    on('diskAuto', function () {
      state.settings.autosave = (state.settings.autosave || 'off') === 'off' ? 'on' : 'off';
      save(); renderDash();
      toast(state.settings.autosave === 'on'
        ? 'Autosave on — the whole state is written to disk at most once a minute.'
        : 'Autosave off.');
    });
    on('promptPeek', promptInspector);
    on('cardImport', importCard);
    on('cardExport', function () {
      castPicker({ title: 'Export as a character card', note: 'Pick one — the export writes their card into their own portrait.', suggest: false },
        function (chosen) { exportCard(chosen[0], true); });
    });
    on('textImport', importTranscript);
    on('briefExport', function () {
      var rooms = (state.rooms || []).slice(0, 20);
      if (!rooms.length) { toast('Play something first.'); return; }
      list('Which chat?', rooms.map(function (r) {
        return { label: r.title + ' — ' + RP.counter(r) + ' turns', value: r.id };
      }), function (id) {
        var r = rooms.filter(function (x) { return x.id === id; })[0];
        var brief = RP.storyBrief(state, r, {});
        download(RP.slug(r.title) + '.brief.md', brief);
        toast('Brief written — ' + brief.length + ' characters, fluff removed.');
      });
    });
    on('memExport', function () { download('waluipedia-memory.json', JSON.stringify(RP.exportBundle(state, { chats: false, lore: false, user: false }), null, 2)); });
    on('exportAll', function () { download('waluipedia-chatroom.json', JSON.stringify(RP.exportBundle(state, {}), null, 2)); });
    on('exportChats', function () { download('waluipedia-chats.json', JSON.stringify(RP.exportBundle(state, { lore: false, memory: false }), null, 2)); });
    on('exportLore', function () { download('waluipedia-lore.json', JSON.stringify(RP.exportBundle(state, { chats: false, memory: false, user: false }), null, 2)); });
    on('exportMem', function () { download('waluipedia-memory.json', JSON.stringify(RP.exportBundle(state, { chats: false, lore: false, user: false }), null, 2)); });
    on('importMerge', function () { importFile('merge'); });
    on('importReplace', function () { importFile('replace'); });
    on('setEndpoint', settingsForm);
    on('setPersona', personaForm);
    on('setAccount', accountForm);
    box.querySelectorAll('[data-replay]').forEach(function (b) { b.onclick = function () { replayPicker(b.dataset.replay); }; });
    box.querySelectorAll('[data-loreedit]').forEach(function (b) {
      b.onclick = function () { loreForm((state.lore || []).filter(function (n) { return n.id === b.dataset.loreedit; })[0]); };
    });
    box.querySelectorAll('[data-lorekill]').forEach(function (b) {
      b.onclick = function () { RP.removeLore(state, b.dataset.lorekill); save(); render(); };
    });
    box.querySelectorAll('[data-logkill]').forEach(function (b) {
      b.onclick = function () { state.log = (state.log || []).filter(function (e) { return e.id !== b.dataset.logkill; }); save(); render(); };
    });
    box.querySelectorAll('[data-logtolore]').forEach(function (b) {
      b.onclick = function () {
        var entry = (state.log || []).filter(function (e) { return e.id === b.dataset.logtolore; })[0];
        if (!entry) return;
        RP.addLore(state, { title: RP.clip(entry.text, 60), text: entry.text, chars: entry.chars, source: 'promoted from the world log' });
        save(); tab = 'charms'; render(); toast('Filed as lore.');
      };
    });
    box.querySelectorAll('[data-memmood]').forEach(function (b) {
      b.onclick = function () {
        var mem = RP.charMemory(state, { id: b.dataset.memmood });
        form('Set ' + mem.name + '’s state of mind', [{ k: 'mood', label: 'Mood', value: mem.mood }], {}, function (v) {
          RP.setMood(state, { id: mem.id, name: mem.name }, v.mood); save(); render();
        });
      };
    });
    box.querySelectorAll('[data-memteach]').forEach(function (b) {
      b.onclick = function () {
        var mem = RP.charMemory(state, { id: b.dataset.memteach });
        form('Teach ' + mem.name + ' a fact', [{ k: 'fact', label: 'They now know that…', type: 'area' }], {}, function (v) {
          if (v.fact.trim()) { RP.teach(state, { id: mem.id, name: mem.name }, v.fact); save(); render(); }
        });
      };
    });
    box.querySelectorAll('[data-memclear]').forEach(function (b) {
      b.onclick = function () {
        if (!window.confirm('Forget everything this character remembers?')) return;
        state.chars = (state.chars || []).filter(function (m) { return m.id !== b.dataset.memclear; });
        save(); render();
      };
    });
  }

  /* ---------------------------------------------------------------- *
   * starting chats
   * ---------------------------------------------------------------- */

  function pushRoom(r) {
    applyDefaultPlayer(r);
    state.rooms.unshift(r);
    state.active = r.id;
    RP.logEvent(state, {
      kind: 'chat', roomId: r.id, roomTitle: r.title, when: roomDate(r),
      chars: r.cast.map(function (c) { return c.id; }),
      text: (r.kind === 'group' ? 'A group chat opened: ' : 'A chat opened with ') + r.cast.map(function (c) { return c.name; }).join(', ') + '.',
    });
    save(); render();
  }

  function startSolo(char) {
    if (!char) return;
    pushRoom(RP.newRoom([char], {
      style: (state.settings && state.settings.style) || RP.DEFAULT_STYLE,
      persona: (state.user && state.user.persona) || '',
    }));
  }

  function startGroup(picked, opts) {
    if (!picked || picked.length < 1) return;
    opts = opts || {};
    pushRoom(RP.newRoom(picked, {
      scene: opts.scene || '', sceneName: opts.sceneName || '', sceneImage: opts.sceneImage || '',
      beats: opts.beats || [], opener: opts.opener || '', date: opts.date || '',
      style: (state.settings && state.settings.style) || RP.DEFAULT_STYLE,
      persona: (state.user && state.user.persona) || '',
      // Scenario settings: the sheets everyone walks in carrying.
      statePreset: opts.statePreset || (state.settings && state.settings.statePreset) || 'rpg',
      setup: opts.setup || {},
      states: opts.states || null,
      mechanics: opts.mechanics || (state.settings && state.settings.mechanics) || 'on',
      sequelOf: opts.sequelOf || '',
      canon: opts.canon || '',
      // Which filing this scene came out of, so the cast can quote it.
      sourceId: opts.sourceId || '',
      sourceKind: opts.sourceKind || '',
    }));
    // Date it from the filing it came out of, not from today's clock.
    var opened = room();
    if (opened && !opened.date && opened.sourceId) {
      var filed = RP.sourceRecord(opened, archive);
      if (filed && filed.date) opened.date = RP.clip(filed.date, 90);
    }
  }

  function openScene(scene) {
    if (!scene) return;
    castPicker({
      title: scene.name,
      note: 'The filed session runs on its own script. Pick the people you play around it — the suggested cast is the event’s own participants.',
      preselect: (scene.suggestedCast || []).map(function (c) { return c.id; }),
    }, function (picked) {
      startGroup(picked, {
        scene: scene.summary || scene.name, sceneName: scene.name, sceneImage: scene.image,
        beats: scene.beats || [], date: scene.date || '',
        // The filing this scene came out of, so the cast can quote it.
        sourceId: scene.id || scene.name, sourceKind: 'scene',
        opener: 'Scene — ' + scene.name + (scene.location ? ' · ' + scene.location : '') + (scene.date ? ' · ' + scene.date : ''),
      });
    });
  }

  /** A wire post, played. The post is the scene, its replies are the beats,
   *  and playing it marks the post used so the "unused" view keeps shrinking. */
  function openScenario(post) {
    if (!post) return;
    var scenario = RP.scenarioFromPost(post, castById);
    castPicker({
      title: RP.clip(scenario.name, 60),
      note: 'From the WAHwire, ' + post.timestamp + '. The suggested cast is everyone the post names — add whoever else was in the room.',
      preselect: scenario.suggestedCast.map(function (c) { return c.id; }),
    }, function (picked) {
      startGroup(picked, {
        scene: scenario.scene, sceneName: scenario.name, sceneImage: scenario.image,
        beats: scenario.beats,
        opener: 'WAHwire — ' + post.authorName + ', ' + post.timestamp + ':\n“' + RP.clip(post.content, 400) + '”',
      });
      var opened = room();
      RP.markPostUsed(state, post.id, opened);
      RP.logEvent(state, {
        kind: 'wire', roomId: opened.id, roomTitle: opened.title, when: roomDate(opened),
        chars: picked.map(function (c) { return c.id; }),
        text: 'Played the wire post by ' + post.authorName + ': ' + RP.clip(post.content, 180),
        tags: post.tags,
      });
      save(); render();
    });
  }

  /** A collection, played: the archive already decided who belongs together. */
  function openCollection(collection) {
    if (!collection) return;
    castPicker({
      title: collection.name,
      note: collection.summary || collection.title,
      preselect: collection.members.slice(0, 6).map(function (c) { return c.id; }),
    }, function (picked) {
      startGroup(picked, {
        scene: collection.summary || collection.title,
        sceneName: collection.name,
        opener: 'Collection — ' + collection.name + '. ' + RP.clip(collection.title || '', 160),
      });
    });
  }

  /* ---------------------------------------------------------------- *
   * hooks — the opener is written by the model, from the real lore
   * ---------------------------------------------------------------- */

  var forging = {};   // scenario id -> true while the model is writing

  function hookFor(id) { return (state.hooks || {})[id] || null; }

  /** Ask the model for a strong, specific opener. It is given the brief, the
   *  character cards, the script and whatever these characters already did in
   *  this reader's other chats — and a list of the ways it is not allowed to
   *  start. A weak answer is rejected once and asked again. */
  function forgeHook(scenario, opts) {
    opts = opts || {};
    if (!scenario || forging[scenario.id]) return Promise.resolve(hookFor(scenario.id));
    forging[scenario.id] = true;
    render();
    var ctx = RP.hookContext(state, scenario);
    var system = RP.hookPrompt(scenario, ctx);
    function ask(nudge) {
      return callModel(system + (nudge || ''), [{ role: 'user', content: 'Write the opening of this scene.' }], { tokens: 420 });
    }
    return ask('').then(function (text) {
      var hook = RP.parseHook(text, scenario);
      if (hook && !RP.hookIsWeak(hook, scenario)) return hook;
      // One retry, told exactly what was wrong with the first answer.
      return ask('\n\nYOUR LAST ATTEMPT WAS REJECTED for being generic. Name the people, the place and the objects ' +
        'from the filed material above, in the first two sentences. Start in the middle of an action.')
        .then(function (second) { return RP.parseHook(second, scenario) || hook; });
    }).then(function (hook) {
      if (!hook) throw new Error('no hook');
      state.hooks = state.hooks || {};
      state.hooks[scenario.id] = hook;
      save();
      return hook;
    }).catch(function (error) {
      console.warn('hook forge failed', error);
      if (!opts.quiet) toast('The model did not answer — using the archive’s own cold open.');
      return null;
    }).then(function (hook) {
      forging[scenario.id] = false;
      render();
      return hook;
    });
  }

  function whatIfById(id) {
    return whatifs.concat(backfills).filter(function (s) { return s.id === id; })[0];
  }

  /** The brief, in full, before anyone commits to playing it. */
  function readWhatIf(id) {
    var s = whatIfById(id);
    if (!s) return;
    openModal('<h3>' + esc(s.name) + '</h3>' +
      '<p class="sub">' + (KIND_ICON[s.kind] || '') + ' ' + esc(s.kindLabel) + ' · ' + s.beats.length + ' beats · ' +
      esc(s.source) + (s.date ? ' · ' + esc(s.date) : '') + '</p>' +
      '<div class="brief">' + RP.md(s.brief) + '</div>' +
      (s.beats.length ? '<h4>The script</h4><div class="stack">' + s.beats.map(function (b) {
        return '<div class="item"><div class="when">' + esc(b.time) + '</div><b>' + esc(b.beat) + '</b>' +
          (b.detail ? '<p>' + esc(b.detail) + '</p>' : '') + '</div>';
      }).join('') + '</div>' : '') +
      (s.questions.length ? '<h4>Questions the table has to answer</h4><ul>' +
        s.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="actions"><button class="pill" id="mCancel">Close</button>' +
      '<button class="pill" id="mExport">⬇ Export brief</button>' +
      '<button class="pill primary" id="mOk">Play this</button></div>');
    $('mCancel').onclick = closeModal;
    $('mExport').onclick = function () {
      download(RP.slug(s.name) + '.md', '# ' + s.name + '\n\n' + s.premise + '\n\n' + s.brief +
        '\n\n## The script\n\n' + s.beats.map(function (b) { return '- **' + b.time + ' — ' + b.beat + '** ' + b.detail; }).join('\n') +
        '\n\n_Composed by the Waluipedia chatroom from ' + s.source + '._\n');
    };
    $('mOk').onclick = function () { closeModal(); playWhatIf(id); };
  }

  /** Play one: pick the cast, set the starting state, then open on an
   *  opener the model wrote from the filed material (or the cold open). */
  function playWhatIf(id) {
    var s = whatIfById(id);
    if (!s) return;
    castPicker({
      title: (hookFor(s.id) || {}).title || s.name,
      note: RP.clip(s.premise, 220),
      preselect: s.suggestedCast.map(function (c) { return c.id; }),
      extra: s.suggestedCast.filter(function (c) { return !castById[c.id]; }),
      setup: true,
    }, function (picked, setup) {
      var start = function (hook) {
        var opts = RP.scenarioRoomOpts(s);
        opts.opener = (hook && hook.open) || RP.coldOpen(s);
        opts.sceneName = (hook && hook.title) || s.name;
        opts.setup = (setup && setup.states) || s.setup || {};
        opts.statePreset = (setup && setup.preset) || s.statePreset || 'rpg';
        opts.states = s.states || null;                 // sequels carry sheets in
        if (hook && hook.stakes) opts.scene = opts.scene + '\n\nWHAT IS AT STAKE RIGHT NOW\n' + hook.stakes;
        startGroup(picked, opts);
        var opened = room();
        RP.markPostUsed(state, s.id, opened);
        if (s.kind === 'backfill') RP.noteBackfillUse(state, s.id);
        if (s.kind === 'sequel' && s.sequelOf) {
          opened.sequelOf = s.sequelOf;
          var parent = (state.rooms || []).filter(function (x) { return x.id === s.sequelOf; })[0];
          if (parent) parent.sequelCount = (parent.sequelCount || 0) + 1;
        }
        RP.logEvent(state, {
          kind: s.kind === 'backfill' ? 'backfill' : 'whatif', roomId: opened.id, roomTitle: opened.title, when: roomDate(opened),
          chars: picked.map(function (c) { return c.id; }),
          text: 'Opened “' + opened.sceneName + '” (' + s.kindLabel + ').',
          tags: s.tags,
        });
        save(); render();
      };
      var hook = hookFor(s.id);
      if (hook) { start(hook); return; }
      toast('Writing the opener from the filed material…');
      forgeHook(s, { quiet: true }).then(start);
    });
  }

  /* ---------------------------------------------------------------- *
   * character cards — the PNG/JSON format the rest of the world uses
   * ---------------------------------------------------------------- */

  /** A PNG card is also a portrait. Shrink it so a 200 KB face does not eat
   *  the browser's storage, and hand back a data URL. */
  function shrinkImage(bytes, size) {
    return new Promise(function (done) {
      var url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      var img = new window.Image();
      img.onload = function () {
        try {
          var side = Math.min(size || 256, Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = side; canvas.height = side;
          var ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no canvas');
          // Square crop from the middle: portraits are shown in circles.
          var cut = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - cut) / 2, (img.height - cut) / 2, cut, cut, 0, 0, side, side);
          done(canvas.toDataURL('image/png'));
        } catch (e) { done(''); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); done(''); };
      img.src = url;
    });
  }

  /** What went wrong, in words, when a file is not what it looked like. */
  var IMPORT_TROUBLE = {
    'png-plain': 'That PNG is just a picture — there is no character card stored inside it. Export it from your ' +
      'card editor with “PNG card”, or import the .json instead.',
    'png-broken': 'That PNG has a card chunk, but it could not be decoded. The .json version of the same card will work.',
    'json-broken': 'That file starts like JSON but does not parse — something truncated it. Try re-exporting it.',
    'json-unknown': 'That is JSON, but not a character card, a chat log or a chatroom bundle.',
    empty: 'That file is empty.',
    unknown: 'There was nothing readable in that file.',
  };

  /** Every import goes through here: v1 and v2 cards, PNG cards, JSONL and
   *  JSON chat logs, chatroom bundles, and plain transcripts. The file is
   *  sniffed first so a refusal can say what the file actually looked like. */
  /** What an import actually did, in words. “Imported 0 chats” over a
   *  bundle whose chats were already on file read like a failure — it was
   *  a merge, and the toast should say so. */
  function bundleReport(stats) {
    var bits = [];
    if (stats.rooms) bits.push(stats.rooms + ' new chat' + (stats.rooms === 1 ? '' : 's'));
    if (stats.roomsUpdated) bits.push(stats.roomsUpdated + ' chat' + (stats.roomsUpdated === 1 ? '' : 's') + ' updated to the bundle\u2019s newer copy');
    if (bits.length) return 'Imported ' + bits.join(' and ') + '.';
    if (stats.roomsSame) {
      return 'Nothing new to import \u2014 ' + (stats.roomsSame === 1 ? 'that chat is' : 'those ' + stats.roomsSame + ' chats are') +
        ' already on file (your copy is as new or newer).';
    }
    return 'Imported the bundle \u2014 no chats inside it.';
  }

  function importAny(bytes, fileName, intoRoom) {
    var found = RP.sniffImport(bytes);
    if (found.kind === 'bundle') {
      var stats = RP.importBundle(state, found.bundle, 'merge');
      save(); buildBoard(); render();
      toast(bundleReport(stats));
      return;
    }
    if (found.kind === 'chatlog' || found.kind === 'transcript') {
      readTurnsInto(found.turns, fileName, intoRoom, found.why);
      return;
    }
    if (found.kind !== 'card') {
      toast(IMPORT_TROUBLE[found.kind] || ('That file looked like ' + found.why + '.'));
      return;
    }
    var art = RP.isPng(bytes) ? shrinkImage(bytes, 256) : Promise.resolve('');
    art.then(function (dataUrl) {
      var raw = found.card;
      if (dataUrl) raw.__image = dataUrl;
      var char = RP.parseCharacterCard(raw);
      if (!char) { toast('That card has no name in it, so there is nobody to import.'); return; }
      state.newChars = (state.newChars || []).filter(function (c) { return c.id !== char.id; });
      state.newChars.unshift(char);
      castById[char.id] = char;
      cast = cast.filter(function (c) { return c.id !== char.id; }).concat([char]);
      RP.logEvent(state, {
        kind: 'roster', chars: [char.id],
        text: 'Imported the character card “' + char.name + '” from ' + (fileName || 'a file') + '.',
      });
      if (char.card && char.card.scenario) {
        RP.bookAdd(state, { kind: 'fact', name: char.name + ' — card scenario', text: char.card.scenario, source: 'you' });
      }
      var open = intoRoom || room();
      if (open) {
        RP.addToRoom(open, char);
        var greeting = RP.cardGreeting(char);
        if (greeting) {
          open.messages.push({ id: RP.uid(), role: 'char', charId: char.id, text: greeting, at: Date.now(), alts: [greeting], alt: 0, imported: true });
        }
        save(); render();
        toast('📇 ' + char.name + ' walked into this chat' + (char.image ? ', portrait and all.' : '.'));
        return;
      }
      save(); render();
      toast('📇 ' + char.name + ' imported — they are in the cast now.');
    });
  }

  /** Turns from a transcript or a chat log, into a chat or a new one. */
  function readTurnsInto(turns, label, target, why) {
    if (!turns.length) { toast('Nothing readable in that.'); return; }
    if (target) {
      var added = RP.appendTranscript(target, turns, { divider: true, source: label });
      state.active = target.id;
      RP.logEvent(state, {
        kind: 'chat', roomId: target.id, roomTitle: target.title, when: roomDate(target),
        chars: (target.cast || []).map(function (c) { return c.id; }),
        text: 'Read ' + added + ' turns into this chat' + (label ? ' from ' + label : '') + '.',
      });
      save(); render();
      offerCatchUp(target);
      toast('Read in ' + added + ' turns from ' + (why || 'that file') + ' — carry on from the bottom.');
      return;
    }
    buildFromTurns(turns, label);
  }

  /** Any image → PNG bytes, through a canvas. */
  function toPngBytes(bytes, side) {
    return new Promise(function (done) {
      var url = URL.createObjectURL(new Blob([bytes]));
      var img = new window.Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.min(side || 512, img.width || side);
          canvas.height = Math.round(canvas.width * ((img.height || 1) / (img.width || 1)));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          var base64 = canvas.toDataURL('image/png').split(',')[1];
          var binary = atob(base64), out = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
          done(out);
        } catch (e) { done(null); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); done(null); };
      img.src = url;
    });
  }

  /** Import a card or a story from a file. */
  function importCard(intoRoom) {
    pickFile('.png,.json,.jsonl,.txt,.md,application/json,image/png,text/plain', 'bytes', function (bytes, file) {
      importAny(bytes, file && file.name, intoRoom || room());
    });
  }

  /** Export as JSON, or as their own portrait with the card inside it. */
  function exportCard(char, asPng) {
    var opts = {
      date: roomDate(room() || {}),
      greeting: (char.card && char.card.first_mes) || '',
    };
    if (!asPng) {
      download(RP.slug(char.name) + '.card.json', JSON.stringify(RP.toCharacterCard(char, opts), null, 2));
      return;
    }
    var url = imageUrl(char.image);
    if (!char.image) { toast('No portrait on file — exporting the JSON card instead.'); exportCard(char, false); return; }
    window.fetch(url).then(function (res) { return res.arrayBuffer(); }).then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      // Most archive portraits are JPEGs and a character card has to be a
      // PNG, so anything that is not already one is redrawn as one.
      if (RP.isPng(bytes)) return bytes;
      return toPngBytes(bytes, 512);
    }).then(function (bytes) {
      var out = bytes && RP.cardToPng(bytes, char, opts);
      if (!out) { toast('That portrait could not be turned into a PNG. Exporting JSON instead.'); exportCard(char, false); return; }
      downloadBytes(RP.slug(char.name) + '.card.png', out, 'image/png');
      toast('📇 Card written into ' + char.name + '’s portrait — ' + Math.round(out.length / 1024) + ' KB.');
    }).catch(function () { toast('Could not read the portrait. Exporting JSON instead.'); exportCard(char, false); });
  }

  /** Paste or open a transcript. It can start a new chat, or be read into
   *  the one already open so play carries on from the bottom of it. */
  function importTranscript(opts) {
    opts = opts || {};
    var here = opts.into || null;
    form('Import a story' + (here ? ' into “' + RP.clip(here.sceneName || here.title, 30) + '”' : ''), [
      { k: 'text', label: 'Paste it here — “Name: line” per turn, or plain prose', type: 'area', value: '' },
      { k: 'title', label: here ? 'Where it came from (optional)' : 'Title (optional)', value: '' },
      { k: 'where', label: 'Where does it go?', type: 'select', value: here ? 'here' : 'new',
        options: [
          { value: 'here', label: here ? 'Into this chat — appended, and we carry on from the end' : 'Into the most recent chat' },
          { value: 'new', label: 'Into a new chat of its own' },
        ] },
    ], {
      note: 'Named speakers are matched to the cast; anything unattributed becomes your own turns. Leave the box ' +
        'empty and you will be asked for a .txt, .md or .json file instead.',
      ok: 'Read it in',
    }, function (v) {
      var target = v.where === 'here'
        ? (here || room() || (state.rooms || []).slice().sort(function (a, b) { return b.updated - a.updated; })[0])
        : null;
      if (!v.text.trim()) {
        pickFile('.txt,.md,.json,.jsonl,.png,text/plain,application/json,image/png', 'bytes', function (bytes, file) {
          importAny(bytes, v.title || (file && file.name), target);
        });
        return;
      }
      readStory(v.text, v.title, target);
    });
  }

  /** Pasted text goes through the same sniffing as a file. */
  function readStory(text, label, target) {
    importAny(String(text || ''), label, target);
  }

  function buildFromTurns(turns, title) {
    if (!turns.length) { toast('Nothing readable in that.'); return; }
    var names = {};
    turns.forEach(function (t) { if (t.who) names[t.who.toLowerCase()] = true; });
    var picked = cast.filter(function (c) {
      return names[c.name.toLowerCase()] || Object.keys(names).some(function (n) { return c.name.toLowerCase().indexOf(n) >= 0; });
    }).slice(0, 6);
    castPicker({
      title: 'Who is in this story?',
      note: turns.length + ' turns read. The cast below was matched by name — add anyone the text calls by another name.',
      preselect: picked.map(function (c) { return c.id; }),
    }, function (chosen) {
      var built = RP.roomFromTranscript(turns, chosen, {
        title: title || RP.clip(turns[0].text, 40),
        sceneName: title || 'Imported story',
        date: roomDate({}),
      });
      pushRoom(built);
      RP.logEvent(state, { kind: 'chat', roomId: built.id, roomTitle: built.title, when: roomDate(built), chars: chosen.map(function (c) { return c.id; }), text: 'Imported a story of ' + turns.length + ' turns.' });
      save(); render();
      toast('Read in ' + turns.length + ' turns. Carry on from the bottom.');
    });
  }

  /** After an import there is a backlog. Reading every stretch of a
   *  300-turn story is a hundred calls nobody wants to spend, so the
   *  default is the smart plan: bigger stretches, the live end of the chat
   *  always read, and the rest of the budget spent on the densest parts. */
  function offerCatchUp(r) {
    var plan = RP.backlogFor(r, state.settings.bookEvery);
    if ((state.settings.book || 'on') === 'off' || plan.calls < 2) return;
    catchUpDialog(r);
  }

  function catchUpDialog(r) {
    var plan = RP.backlogFor(r, state.settings.bookEvery);
    var budget = RP.bookBudgetLeft(state);
    var smartCalls = Math.max(1, Math.min(Number(state.settings.smartCalls || 6), budget || 6));
    var smart = RP.smartBacklog(r, { maxCalls: smartCalls });
    openModal('<h3>File this into the lore book?</h3>' +
      '<p class="sub">There are <b>' + plan.pending + ' unfiled turns</b> here. Reading every short stretch would be ' +
      '<b>' + plan.calls + ' calls</b> — which is silly for an import.</p>' +
      '<p class="sub"><b>The smart read</b> does it in <b>' + smart.jobs.length + '</b>: bigger stretches of ' +
      smart.chunk + ' turns, the end of the chat always read (that is what the next turn follows on from), and the ' +
      'rest of the budget spent on the parts that actually establish something — names, places, numbers, things ' +
      'said out loud. It covers <b>' + smart.covered + '</b> of ' + smart.pending + ' turns' +
      (smart.skipped ? ', skipping ' + smart.skipped + ' of small talk' : '') + '.</p>' +
      '<label for="f_calls">Calls to spend</label>' +
      '<input type="number" id="f_calls" min="1" max="60" value="' + smart.jobs.length + '">' +
      '<label for="f_budget">Session budget (' + budget + ' left of ' + (state.settings.bookBudget || RP.BOOK_BUDGET) + ')</label>' +
      '<input type="number" id="f_budget" min="0" max="400" value="' + (state.settings.bookBudget || RP.BOOK_BUDGET) + '">' +
      '<div class="actions"><button class="pill" id="mCancel">Not now</button>' +
      '<button class="pill" id="mAll">Read everything (' + plan.calls + ')</button>' +
      '<button class="pill primary" id="mOk">Smart read</button></div>');
    $('mCancel').onclick = closeModal;
    function budgetFromForm() {
      var b = parseInt($('f_budget').value, 10);
      if (!isNaN(b)) state.settings.bookBudget = Math.max(0, Math.min(400, b));
    }
    $('mOk').onclick = function () {
      budgetFromForm();
      var calls = Math.max(1, parseInt($('f_calls').value, 10) || smart.jobs.length);
      state.settings.smartCalls = calls;
      closeModal();
      catchUp(r, RP.smartBacklog(r, { maxCalls: calls }).jobs, 'smart');
    };
    $('mAll').onclick = function () {
      budgetFromForm();
      closeModal();
      catchUp(r, RP.backlogJobs(r, state.settings.bookEvery, 200), 'every stretch');
    };
  }

  /** Queue whichever plan was chosen. The worker still runs one at a time
   *  and still stops at the budget. */
  function catchUp(r, jobs, how) {
    if (!jobs || !jobs.length) { toast('Nothing to file.'); return; }
    var budget = RP.bookBudgetLeft(state);
    if (jobs.length > budget) {
      jobs = jobs.slice(0, Math.max(1, budget));
      toast('Budget allows ' + jobs.length + ' — raise it in ⚙ Filing if you want the rest.');
    }
    jobs.forEach(function (job) {
      RP.queuePush(state, {
        key: job.key || (r.id + ':catchup:' + job.from), kind: 'extract',
        roomId: r.id, roomTitle: r.title, when: roomDate(r),
        turns: job.turns.map(function (m) {
          return {
            who: m.who || (m.role === 'user' ? (state.user.name || 'You') : charOf(r, m.charId).name),
            text: m.text !== undefined && m.role === undefined ? m.text : RP.textOf(m),
          };
        }),
      });
    });
    // Everything queued counts as filed, so the live worker does not do it
    // again as the chat carries on.
    r.bookAt = (r.messages || []).filter(RP.visible).length;
    save(); render();
    toast('📓 Filing ' + jobs.length + ' stretch' + (jobs.length === 1 ? '' : 'es') + ' (' + how + ') in the background.');
    pumpBook();
  }

  /** Continue a played scene: same people, same wounds, no recap. */
  function openSequel(r) {
    if (!r) return;
    form('Sequel — after ' + RP.clip(r.sceneName || r.title, 40), [
      { k: 'title', label: 'Title (optional)', value: '' },
      { k: 'premise', label: 'What has changed since? (optional)', type: 'area', value: '' },
      { k: 'carry', label: 'Carry the state over', type: 'select', value: 'yes',
        options: [{ value: 'yes', label: 'Yes — same HP, MP, conditions and inventory' },
                  { value: 'no', label: 'No — everyone starts fresh' }] },
    ], { note: 'The sequel keeps the cast and everything they are carrying, opens in the middle rather than on a recap, and inherits any beats that never fired.', ok: 'Compose the sequel' }, function (v) {
      var sequel = RP.sequelFrom(r, state, { title: v.title, premise: v.premise });
      sequel.sequelOf = r.id;
      if (v.carry === 'no') sequel.states = null;
      state.scenarios = (state.scenarios || []);
      state.scenarios.unshift(sequel);
      state.scenarios = state.scenarios.slice(0, 30);
      save(); buildBoard();
      toast('Writing the opener…');
      forgeHook(sequel, { quiet: true }).then(function () { readWhatIf(sequel.id); });
    });
  }

  /** Describe a scenario; the page writes the brief from the archive. The
   *  model is not involved — matching names against filed records is cheap,
   *  instant, and gives a better brief than a paragraph of invention. */
  function createScenarioForm() {
    form('Create a scenario', [
      { k: 'title', label: 'Title (optional)', value: '' },
      { k: 'text', label: 'Describe it — who, where, and what changes', type: 'area', value: '' },
    ], {
      note: 'Name real people, places, bodies or filed sessions and the page will pull what the archive already has on ' +
        'them into the brief, and take the beats from the matching filing’s own timeline. Nothing is sent to the model.',
      ok: 'Compose it',
    }, function (v) {
      if (!v.text.trim()) { toast('Describe it first — a sentence or a page, either works.'); return; }
      var composed = RP.composeScenario(v, archive, castById);
      state.scenarios = (state.scenarios || []).filter(function (x) { return x.id !== composed.id; });
      state.scenarios.unshift(composed);
      state.scenarios = state.scenarios.slice(0, 30);
      RP.logEvent(state, { kind: 'whatif', text: 'Wrote a scenario: ' + composed.name, chars: composed.suggestedCast.map(function (c) { return c.id; }) });
      save(); buildBoard(); tab = 'whatif'; render();
      readWhatIf(composed.id);
    });
  }

  /** Find whoever the model just walked into the scene. Exact id, then exact
   *  name, then a contains match — and if the archive has never heard of
   *  them, the caller invents a card rather than refusing the entrance. */
  /** The archive record a name in a stage direction means. Exact first
   *  (id, then name, punctuation and articles aside), then the LONGEST
   *  filed name that appears whole inside what was written — so "Lord
   *  Verity of Trinity" finds Lord Verity and "Anastasia" no longer finds
   *  Ana, which the old substring test did. People invented in play are
   *  found too, with their voice and kit, so a return visit is a return. */
  function resolveChar(name) {
    var tidy = function (v) {
      return String(v || '').toLowerCase().replace(/[.\u2019'"]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    };
    var raw = tidy(name);
    var want = raw.replace(/^(the|a|an|lord|lady|dr|doctor|mr|mrs|ms|sir|old|young)\s+/, '');
    if (!want) return null;
    var pool = cast.concat(state.newChars || []);
    var exact = pool.filter(function (c) { return tidy(c.name) === raw; })[0];
    if (exact) return exact;
    if (castById[RP.slug(raw)]) return castById[RP.slug(raw)];
    if (castById[RP.slug(want)]) return castById[RP.slug(want)];
    // A species or a job is not a person: "a Toad" must not become Dr. Toad.
    if (/^(toad|toads|goomba|koopa|boo|guard|guards|soldier|clerk|man|woman|stranger|figure|voice|someone|somebody)$/.test(want)) return null;
    var forms = raw === want ? [' ' + raw + ' '] : [' ' + raw + ' ', ' ' + want + ' '];
    var whole = pool.filter(function (c) {
      var n = ' ' + tidy(c.name) + ' ';
      return n.length >= 5 && forms.some(function (f) { return f.indexOf(n) >= 0 || n.indexOf(f) >= 0; });
    }).sort(function (a, b) { return tidy(b.name).length - tidy(a.name).length; });
    return whole[0] || null;
  }

  function openRoom(id) { state.active = id; save(); render(); }

  /* ---------------------------------------------------------------- *
   * the chat view
   * ---------------------------------------------------------------- */

  function charOf(r, id) { return (r.cast || []).filter(function (c) { return c.id === id; })[0] || castById[id] || { id: id, name: 'Character' }; }

  /* ---------------------------------------------------------------- *
   * macros — one click instead of typing "I swing at him"
   * ---------------------------------------------------------------- */

  var MACROS = [
    { id: 'attack', icon: '🗡', label: 'Attack', mp: 0, text: 'I attack {target} with what I am holding.' },
    { id: 'cast', icon: '✦', label: 'Cast', mp: 5, text: 'I work the magic I know at {target}, and it costs me.' },
    { id: 'guard', icon: '🛡', label: 'Guard', mp: 0, text: 'I put myself between {target} and whatever is coming.' },
    { id: 'talk', icon: '💬', label: 'Talk down', mp: 0, text: 'I try to talk {target} out of it, fast and plainly.' },
    { id: 'sneak', icon: '🌑', label: 'Slip away', mp: 0, text: 'I take the chance to get out of sight.' },
    { id: 'look', icon: '🔍', label: 'Look closer', mp: 0, text: 'I stop and look at this properly — what have I missed?' },
  ];

  function userMacros() {
    return MACROS.concat(state.settings.macros || []);
  }
  /** The buttons that show: the built-ins you have not hidden, then your own. */
  function shownMacros() {
    var hidden = state.settings.hiddenMacros || [];
    return userMacros().filter(function (m) { return hidden.indexOf(m.id) < 0; });
  }

  /** What you are holding or carrying, for the 🎒 Use… button. */
  function playerKit(r) {
    var sheet = RP.sheetFor(r, RP.playerSheetId(r));
    return ((sheet && sheet.items) || []).map(RP.normItem).filter(function (it) { return it.name; });
  }

  function macroButtons(r) {
    var you = RP.sheetFor(r, RP.playerSheetId(r));
    var mood = you && you.mood && RP.MOODS[you.mood.key] ? you.mood : null;
    var other = RP.linkedRoom(state, r);
    var kit = playerKit(r);
    return '<span class="macros">' +
      '<button class="qa mac mood' + (mood ? ' on' : '') + '" id="qaMood"' + (mood ? ' style="' + RP.moodStyle(mood) + '"' : '') +
        ' title="' + esc(mood ? 'You are ' + RP.moodLabel(mood) + ' — the cast reads what you do through it. Click to change or calm down.'
          : 'How you feel going into this turn: the cast reads what you do through it (angry: a pick-up is a grab).') + '">' +
        (mood ? esc(RP.MOODS[mood.key].icon + ' ' + RP.moodLabel(mood)) : '🎭 Mood') + '</button>' +
      '<button class="qa mac" id="qaAt" title="@ — point at exactly who you mean: someone here, written out, in the other scene, in the lore book or in the archive. Type @ in the box for the same list.">@</button>' +
      (kit.length ? '<button class="qa mac" id="qaUse" title="Use, show or hand over something you carry">🎒 Use…</button>' : '') +
      shownMacros().slice(0, 8).map(function (m) {
        return '<button class="qa mac" data-macro="' + esc(m.id) + '" title="' + esc(m.text) + '">' +
          esc(m.icon) + ' ' + esc(m.label) + '</button>';
      }).join('') +
      (other ? '<button class="qa mac live' + (other.live && other.live !== 'off' ? ' on' : '') + '" id="qaMeanwhile" title="' +
        esc('One unattended beat in \u201c' + (other.title || 'the other scene') + '\u201d now' +
          (other.live && other.live !== 'off' ? ' — it also moves by itself ' + (other.live === 'every' ? 'after each of your turns here.' : 'every other turn you take here.')
            : '. (Scene tab: let it move on its own.)')) + '">🌗 Meanwhile</button>' +
        '<button class="qa mac merge" id="qaMerge" title="' + esc('Merge the two scenes into one — everybody in one place, both chats as one stream (the opposite of ✂ Split). ↩ undoes it.') + '">⊕ Merge scenes</button>' : '') +
      '<button class="qa mac add" id="macroAdd" title="Your buttons — add, edit, hide">＋</button></span>';
  }

  /** 🎭 Your own mood: the world reads what you do through it. "calm" clears. */
  function pickMood(r) {
    var you = RP.sheetFor(r, RP.playerSheetId(r));
    if (!you) { toast('The sheets are off in this scene.'); return; }
    var cur = you.mood && RP.MOODS[you.mood.key] ? you.mood : null;
    form('🎭 How you feel', [
      { k: 'key', label: 'Feeling', type: 'select', value: cur ? cur.key : 'calm', options: [{ label: '— calm', value: 'calm' }].concat(RP.MOOD_KEYS.map(function (k) {
        return { label: RP.MOODS[k].icon + ' ' + RP.MOODS[k].words[1], value: k };
      })) },
      { k: 'level', label: 'How strongly', type: 'select', value: String(cur ? cur.level : 2), options: [
        { label: '1 — a flicker', value: '1' }, { label: '2 — plainly', value: '2' }, { label: '3 — overwhelming', value: '3' }] },
      { k: 'note', label: 'Why (optional, the cast can read it on you)', value: cur ? cur.note || '' : '' },
    ], { note: 'It does not write your words. It colours how the world reads what you do: angry, "I pick up the wrench" is read as a grab; afraid, a question is a plea. At 3 it costs you.', ok: 'Set' }, function (v) {
      var line;
      if (v.key === 'calm') {
        if (!you.mood) { toast('You were calm already.'); return; }
        delete you.mood; line = you.name + ' — calm again';
      } else {
        line = RP.moodShift(you, v.key, Number(v.level) || 2, v.note.trim(), { set: true, turn: r.messages.length });
      }
      if (line) r.messages.push({ id: RP.uid(), role: 'state', at: Date.now(), lines: ['🎭 ' + line] });
      save(); render();
    });
  }

  /** 🎒 Use…: something you carry, into the composer as an attempt. */
  function useItem(r, sfx) {
    var kit = playerKit(r);
    var input = $('input' + (sfx || '')) || $('input');
    if (!kit.length) { toast('You are not carrying anything.'); return; }
    list('🎒 What do you reach for?', kit.map(function (it) {
      return { label: it.icon + ' ' + it.name + (it.note ? ' — ' + it.note : ''), value: it.name };
    }), function (name) {
      var it = kit.filter(function (x) { return x.name === name; })[0];
      if (!it) return;
      list(it.icon + ' ' + it.name + ' — and?', [
        { label: 'Use it', value: 'I use the ' + it.name + '.' },
        { label: 'Show it', value: 'I hold up the ' + it.name + ' so they can see it.' },
        { label: 'Hand it over', value: 'I hold out the ' + it.name + ' to {target}.' },
        { label: 'Throw it', value: 'I throw the ' + it.name + ' at {target}.' },
      ], function (text) {
        var targets = RP.speakableCast(r);
        var fire = function (target) {
          input.value = text.replace('{target}', target ? target.name : 'them');
          input.focus();
        };
        if (!/\{target\}/.test(text) || targets.length < 2) { fire(targets[0]); return; }
        list('To whom?', targets.map(function (c) { return { label: c.name, value: c.id }; }), function (id) {
          fire(targets.filter(function (c) { return c.id === id; })[0]);
        });
      });
    });
  }

  /** ＋ Your buttons: add one, edit or delete your own, hide a built-in. */
  function manageMacros(r) {
    var hidden = state.settings.hiddenMacros || [];
    var own = state.settings.macros || [];
    openModal('<h3>Your buttons</h3>' +
      '<p class="sub">The bar above the composer. A button writes the attempt for you — the roll still decides whether it works. ' +
      'Hide the built-ins you never use; write up to six of your own.</p>' +
      '<div class="stack">' + MACROS.map(function (m) {
        var off = hidden.indexOf(m.id) >= 0;
        return '<div class="item' + (off ? ' off' : '') + '"><b>' + esc(m.icon + ' ' + m.label) + '</b><p>' + esc(m.text) + '</p>' +
          '<div class="acts"><button class="mini" data-machide="' + esc(m.id) + '">' + (off ? 'Show' : 'Hide') + '</button></div></div>';
      }).join('') + own.map(function (m) {
        return '<div class="item"><b>' + esc(m.icon + ' ' + m.label) + '</b>' + (m.mp ? ' <span class="sub">\u26a1 ' + m.mp + '</span>' : '') + '<p>' + esc(m.text) + '</p>' +
          '<div class="acts"><button class="mini" data-macedit="' + esc(m.id) + '">Edit</button>' +
          '<button class="mini danger" data-mackill="' + esc(m.id) + '">Delete</button></div></div>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="pill" id="mCancel">Done</button>' +
      (own.length < 6 ? '<button class="pill primary" id="mOk">＋ New button</button>' : '') + '</div>');
    $('mCancel').onclick = closeModal;
    if ($('mOk')) $('mOk').onclick = function () { closeModal(); macroForm(r, null); };
    $('modal').querySelectorAll('[data-machide]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-machide');
        var list2 = (state.settings.hiddenMacros || []).slice();
        if (list2.indexOf(id) >= 0) list2.splice(list2.indexOf(id), 1); else list2.push(id);
        state.settings.hiddenMacros = list2;
        save(); render(); manageMacros(r);
      };
    });
    $('modal').querySelectorAll('[data-macedit]').forEach(function (b) {
      b.onclick = function () {
        var m = own.filter(function (x) { return x.id === b.getAttribute('data-macedit'); })[0];
        closeModal(); macroForm(r, m);
      };
    });
    $('modal').querySelectorAll('[data-mackill]').forEach(function (b) {
      b.onclick = function () {
        state.settings.macros = own.filter(function (x) { return x.id !== b.getAttribute('data-mackill'); });
        save(); render(); manageMacros(r);
      };
    });
  }

  function macroForm(r, existing) {
    form(existing ? 'Edit your button' : 'A button of your own', [
      { k: 'icon', label: 'Icon', value: existing ? existing.icon : '⚑' },
      { k: 'label', label: 'Label', value: existing ? existing.label : '' },
      { k: 'text', label: 'What it writes — use {target} for whoever you pick', type: 'area', value: existing ? existing.text : '' },
      { k: 'mp', label: '\u26a1 Energy it costs (0 for none)', value: String(existing ? existing.mp || 0 : 0) },
    ], { note: 'It writes the attempt for you; the roll still decides whether it works.', ok: existing ? 'Save' : 'Add' }, function (v) {
      if (!v.label.trim() || !v.text.trim()) { toast('It needs a label and something to say.'); return; }
      var next = { id: existing ? existing.id : 'mac_' + RP.slug(v.label) + '_' + Date.now().toString(36), icon: v.icon.trim() || '⚑',
        label: v.label.trim(), text: v.text.trim(), mp: parseInt(v.mp, 10) || 0 };
      var own = (state.settings.macros || []).slice();
      var at = own.map(function (m) { return m.id; }).indexOf(next.id);
      if (at >= 0) own[at] = next; else own.push(next);
      state.settings.macros = own.slice(0, 6);
      save(); render();
    });
  }

  /** Play a macro: pick a target if the scene has one, spend what it costs,
   *  and write the attempt — the roll then decides whether it lands. */
  function runMacro(r, macro) {
    var targets = RP.speakableCast(r);
    function fire(target) {
      var sheet = RP.playerCharacter(r) ? RP.sheetFor(r, RP.playerCharacter(r).id) : null;
      if (macro.mp && sheet && sheet.mp) {
        if (sheet.mp.value < macro.mp) { toast('Not enough Energy \u2014 ' + sheet.mp.value + ' left, that costs ' + macro.mp + '.'); return; }
        var line = RP.applyChange(sheet, { kind: 'mp', op: '-', value: macro.mp });
        if (line) {
          r.messages.push({ id: RP.uid(), role: 'state', at: Date.now(), lines: [line] });
        }
      }
      $('input').value = macro.text.replace('{target}', target ? target.name : 'them');
      $('composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    if (!/\{target\}/.test(macro.text) || targets.length < 2) { fire(targets[0]); return; }
    list(macro.icon + ' ' + macro.label + ' — who?', targets.map(function (c) {
      return { label: c.name, value: c.id };
    }), function (id) { fire(targets.filter(function (c) { return c.id === id; })[0]); });
  }

  /** The roll, the state changes and any beat that fired, as one quiet
   *  strip along the bottom of the turn they belong to. */
  /** The mood on a sheet right now, as the snapshot a turn card keeps. */
  function moodOn(r, id) {
    var sheet = id ? RP.sheetFor(r, id) : null;
    if (!sheet || !sheet.mood || !RP.MOODS[sheet.mood.key]) return undefined;
    return { key: sheet.mood.key, level: Math.max(1, Math.min(3, Number(sheet.mood.level) || 1)) };
  }

  /** The attributes that colour a turn card by the feeling it was written
   *  in: a class and the CSS variables. Empty when nobody felt anything. */
  function moodAttrs(m) {
    var style = m && m.mood ? RP.moodStyle(m.mood) : '';
    return style ? ' mooded" style="' + style + '" data-mood="' + esc(m.mood.key) + '" title="' +
      esc(RP.moodLabel(m.mood)) + ' (' + esc(m.mood.key) + ' ' + m.mood.level + '/3)' : '';
  }

  function metaStrip(m, i) {
    var bits = [];
    var flags = RP.flagsOf(m);
    // A chip is an offer, not a verdict: click it and the turn is taken
    // again with exactly those phrases named.
    var fix = i === undefined ? '' : ' data-fixturn="' + i + '" role="button" tabindex="0"';
    var fixHint = i === undefined ? '' : ' \u2014 click for a take without it';
    if (m.fate) bits.push('<span class="roll">' + esc(m.fate) + '</span>');
    (m.changes || []).forEach(function (line) { bits.push('<span>' + esc(line) + '</span>'); });
    if (m.beatFired) bits.push('<span class="beat">⏩ ' + esc(RP.clip(m.beatFired, 90)) + '</span>');
    (m.consulted || []).forEach(function (name) {
      var used = (m.used || []).indexOf(name) >= 0;
      bits.push('<span class="read' + (used ? ' used' : '') + '" title="' + (used ? 'Read out of the archive for this turn, and something of it is in the prose'
        : 'Read out of the archive for this turn') + '">' + (used ? '📚 ' : '🔎 ') + esc(RP.clip(name, 40)) + '</span>');
    });
    (flags.repeats || []).forEach(function (phrase) {
      bits.push('<span class="stale"' + fix + ' title="Repeats “' + esc(phrase) + '” from this character’s earlier turns' + fixHint + '">♻ ' + esc(RP.clip(phrase, 40)) + '</span>');
    });
    (flags.antiRepeat || []).forEach(function (reason) {
      bits.push('<span class="formula"' + fix + ' title="' + esc(reason) + fixHint + '">🔁 ' + esc(RP.clip(reason, 40)) + '</span>');
    });
    (flags.generic || []).forEach(function (cliche) {
      bits.push('<span class="generic"' + fix + ' title="Stock phrasing: ' + esc(cliche) + fixHint + '">🎭 ' + esc(RP.clip(cliche, 40)) + '</span>');
    });
    if (m.edited) bits.push('<span class="quiet">edited</span>');
    return bits.length ? '<div class="metastrip">' + bits.join('') + '</div>' : '';
  }

  /** One HP / Energy bar. */
  function bar(kind, pool) {
    var pct = pool.max ? Math.round((pool.value / pool.max) * 100) : 0;
    var word = kind === 'mp' ? '\u26a1' : RP.poolWord(kind);
    return '<span class="pool ' + kind + (pct <= 30 ? ' low' : '') + '" title="' + esc(RP.poolWord(kind)) + '">' +
      '<span class="fill" style="width:' + pct + '%"></span>' +
      '<span class="num">' + word + ' ' + pool.value + '/' + pool.max + '</span></span>';
  }

  /** How many slots a sheet's grid shows: the profile decided it when the
   *  sheet was written (RP.packSizeFor), and the reader always gets 12. */
  function kitSize(r, id) {
    var sheet = RP.sheetFor(r, id);
    return (sheet && sheet.slots) || (id === RP.PLAYER_ID ? 12 : 8);
  }

  /** The kit, as a grid you can read at a glance: what is in hand is lit,
   *  everything else is stowed, and the empty slots keep the shape. On
   *  your own pack an empty slot is a button — click it to put something
   *  in rather than opening the whole sheet editor. */
  function kitGrid(r, id) {
    var sheet = RP.sheetFor(r, id);
    if (!sheet) return '';
    var isYou = id === RP.PLAYER_ID;
    return '<span class="kit' + (isYou ? ' big' : '') + '">' + RP.gridSlots(sheet, kitSize(r, id)).map(function (item, at) {
      if (!item) {
        return isYou
          ? '<button class="slot empty add" data-additem="' + esc(id) + '" title="Put something in your pack">+</button>'
          : '<span class="slot empty"></span>';
      }
      return '<button class="slot' + (item.equipped ? ' held' : '') + '" data-item="' + esc(id) + '|' + at + '" ' +
        'title="' + esc(item.name + (item.note ? ' — ' + item.note : '')) + '">' +
        '<span class="ico">' + esc(item.icon) + '</span>' +
        (item.qty > 1 ? '<span class="qty">' + item.qty + '</span>' : '') + '</button>';
    }).join('') + '</span>';
  }

  /** Edit a sheet by hand — the model is not the only one allowed to. */
  function editSheet(id, r) {
    r = r || room();
    var sheet = RP.sheetFor(r, id);
    if (!sheet) return;
    form('State — ' + sheet.name, [
      { k: 'hp', label: 'HP (value / max, blank for none)', value: sheet.hp ? sheet.hp.value + '/' + sheet.hp.max : '' },
      { k: 'mp', label: '\u26a1 Energy (value / max, blank for none) \u2014 breath, strength and magic in one pool; it refills slowly', value: sheet.mp ? sheet.mp.value + '/' + sheet.mp.max : '' },
      { k: 'flags', label: 'Conditions — "bleeding 3 -2hp | a deep cut", one per line (turns, cost a turn, note)', type: 'area',
        value: Object.keys(sheet.flags || {}).map(function (f) {
          var c = sheet.flags[f] && typeof sheet.flags[f] === 'object' ? sheet.flags[f] : { note: '', turns: 0 };
          return f.replace(/_/g, ' ') + (c.turns ? ' ' + c.turns : '') + (c.effect ? ' ' + c.effect : '') + (c.note ? ' | ' + c.note : '');
        }).join('\n') },
      { k: 'items', label: 'Carrying — "a brass key | bent, from the ledger room", one per line, ✊ for in hand',
        type: 'area',
        value: (sheet.items || []).map(RP.normItem).map(function (i) {
          return (i.equipped ? '✊ ' : '') + i.name + (i.qty > 1 ? ' x' + i.qty : '') + (i.note ? ' | ' + i.note : '');
        }).join('\n') },
      { k: 'stats', label: '⚔ might · 🧠 wits · 🗣 sway · 🍀 luck — four numbers 0–3, they lean on the dice',
        value: sheet.stats ? RP.STAT_KEYS.map(function (k) { return sheet.stats[k]; }).join(' ') : '' },
      { k: 'slots', label: 'Pack slots (3–12)', value: String(sheet.slots || '') },
      { k: 'status', label: 'Physical note', value: sheet.status || '' },
      { k: 'mood', label: 'Mood — "anger 2 | the bill" (' + RP.MOOD_KEYS.join(', ') + '; 1 a flicker, 3 overwhelming), or calm',
        value: sheet.mood && RP.MOODS[sheet.mood.key]
          ? sheet.mood.key + ' ' + sheet.mood.level + (sheet.mood.note ? ' | ' + sheet.mood.note : '') : '' },
    ], { note: 'The model reads this before every turn and writes to it with stage directions. Changing it here changes what the scene believes.' }, function (v) {
      function pool(text, old) {
        var hit = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
        if (!hit) return /^\s*$/.test(text) ? null : old;
        return { value: Number(hit[1]), max: Number(hit[2]) };
      }
      sheet.hp = pool(v.hp, sheet.hp);
      sheet.mp = pool(v.mp, sheet.mp);
      sheet.flags = {};
      v.flags.split(/\n/).forEach(function (line) {
        var cond = RP.parseCondition(line);
        if (cond) sheet.flags[cond.key] = { note: cond.note, turns: cond.turns, effect: cond.effect };
      });
      sheet.items = v.items.split(/\n/).map(function (line) {
        var held = /^\s*✊\s*/.test(line);
        var parts = line.replace(/^\s*✊\s*/, '').split('|');
        var head = parts[0].trim();
        var qty = /\sx(\d{1,3})$/i.exec(head);
        if (qty) head = head.slice(0, qty.index).trim();
        if (!head) return null;
        return { name: head, note: (parts[1] || '').trim(), equipped: held, qty: qty ? Number(qty[1]) : 1 };
      }).filter(Boolean);
      var nums = v.stats.trim().split(/[\s,\/]+/).map(Number);
      if (nums.length === 4 && nums.every(function (n) { return !isNaN(n); })) {
        sheet.stats = {};
        RP.STAT_KEYS.forEach(function (k, i) { sheet.stats[k] = Math.max(0, Math.min(3, Math.round(nums[i]))); });
        sheet.statsBy = 'hand';           // a hand-set value is never re-derived
      }
      var slots = parseInt(v.slots, 10);
      if (!isNaN(slots)) sheet.slots = Math.max(3, Math.min(12, slots));
      sheet.status = v.status.trim();
      var moodText = v.mood.split('|');
      var moodHead = moodText[0].trim();
      var moodLevel = /\s(\d)\s*$/.exec(moodHead);
      var feeling = RP.moodWord(moodLevel ? moodHead.slice(0, moodLevel.index) : moodHead);
      if (!moodHead || (feeling && feeling.key === 'calm')) delete sheet.mood;
      else if (feeling) {
        RP.applyChange(sheet, { kind: 'mood', key: feeling.key, level: moodLevel ? Number(moodLevel[1]) : feeling.level,
          note: (moodText[1] || '').trim(), set: true, turn: r.messages.length });
      }
      r.updated = Date.now();
      save(); render();
    });
  }

  var auditFlags = {};

  /** The chat: one scene, or — linked — two full scenes side by side, one
   *  chat. Each column is the whole experience (header, sheets, stream,
   *  turn bar, its own prompt); the dock serves whichever you point it at. */
  function renderChat() {
    var r = room();
    $('dash').hidden = true;
    $('chatview').hidden = false;
    var other = RP.linkedRoom(state, r);
    $('chatview').classList.toggle('linked', Boolean(other));
    ensureSideShell(other);
    renderScene(r, '');
    if (other) renderScene(other, 'b');
    renderPanel();
    wireChat(r, '');
    if (other) wireChat(other, 'b');
    wireDrag(r);
  }

  /** The second column is built once and kept — its textarea has to
   *  survive renders, like the front one's — and taken down with the link. */
  function ensureSideShell(other) {
    var side = $('sidescene');
    if (!side) return;
    side.hidden = !other;
    if (!other) { side.innerHTML = ''; side.dataset.room = ''; return; }
    if (side.dataset.room === other.id && $('composer_b')) return;
    side.dataset.room = other.id;
    side.innerHTML =
      '<div class="chat-top" id="chatTop_b"></div>' +
      '<div class="statebar" id="statebar_b" hidden></div>' +
      '<div class="stream" id="stream_b"></div>' +
      '<div class="composer-wrap">' +
        '<div class="speakers" id="speakers_b"></div>' +
        '<form class="composer" id="composer_b">' +
          '<textarea id="input_b" rows="1" placeholder="Your turn in this scene" aria-label="Your turn in the second scene"></textarea>' +
          '<button class="send" id="send_b" type="submit" disabled>↑</button>' +
        '</form>' +
      '</div>';
  }

  /** Every id a column renders gets the column's suffix, so two scenes can
   *  share one page and one set of handlers. */
  function suffixIds(node, sfx) {
    node.querySelectorAll('[id]').forEach(function (n) {
      if (n.id.slice(-sfx.length) !== sfx) n.id += sfx;
    });
  }

  /** One scene column. `col` is '' for the front scene and 'b' for the
   *  linked one; the two differ only in the ‹ back / ☰ dock buttons (front)
   *  and the ⇄ Front swap (side). */
  function renderScene(r, col) {
    var sfx = col ? '_' + col : '';
    var $c = function (id) { return $(id + sfx); };
    var put = function (id, html) {
      var node = $c(id);
      if (!node) return null;
      node.innerHTML = html;
      if (sfx) suffixIds(node, sfx);
      return node;
    };
    var face = r.cast[0] || {};
    var progress = RP.beatProgress(r);
    var turnCount = (r.messages || []).filter(RP.visible).length;
    // A quiet count of what does not add up, refreshed as the scene plays.
    var scan = RP.auditRoom(state, r, archive);
    var auditFlag = scan.dates.length + scan.quiet.length + scan.book.length;
    auditFlags[r.id] = auditFlag;
    var fateLevel = state.settings.fate || 'normal';
    // A heads-up display rather than a title bar: where you are, when you
    // are, how far the script has run, how dangerous the world is set to be.
    put('chatTop',
      (col ? '<span class="roundbtn col-b" title="The second scene — happening at the same time as the first">⇄</span>'
        : '<button class="roundbtn" id="backBtn" title="Back to Discover (Esc)">‹</button>') +
      avatar(face, 34) +
      '<span class="title"><b>' + esc(r.sceneName || r.title) + '</b>' +
      '<span>' + esc(r.kind === 'group' ? r.cast.map(function (c) { return c.name; }).join(' · ') : (face.title || '')) + '</span></span>' +
      '<span class="hud">' +
        '<button class="stat" id="dateBtn" title="When is this happening, in-world?"><i>🕯</i>' + esc(RP.clip(roomDate(r) || 'undated', 24)) + '</button>' +
        (r.clock ? '<span class="stat quiet" title="The time in the scene"><i>🕰</i>' + esc(RP.clip(r.clock, 22)) + '</span>' : '') +
        (progress.total ? '<button class="stat' + (r.beatsPaused ? ' off' : '') + '" id="nextBeat" ' +
          'title="' + (r.beatsPaused ? 'The script is paused — click to fire the next beat' : 'Fire the next filed beat') + '">' +
          '<i>⏩</i>' + (r.beatsPaused ? 'paused ' : 'beat ') + progress.at + '/' + progress.total +
          '<span class="meter"><span style="width:' + Math.round((progress.at / progress.total) * 100) + '%"></span></span></button>' : '') +
        '<button class="stat fate-' + esc(fateLevel) + '" id="fateBtn" title="How hard the world pushes back"><i>🎲</i>' + esc(fateLevel) + '</button>' +
        '<span class="stat quiet" title="Turns played"><i>💬</i>' + turnCount + '</span>' +
        '<span class="stat quiet" id="bookBadge" hidden></span>' +
      '</span>' +
      '<span class="grow"></span>' +
      // ■ — the one control that must always be reachable: it cuts the
      // reply being written, the autopilot, a line being read, a chat
      // being rendered to audio. Hidden until something is running.
      '<button class="pill stop" id="stopBtn" title="Stop — the reply being written, the autopilot, a line being read, the audio render (Esc)"' +
        (anythingRunning() ? '' : ' hidden') + '>■ Stop</button>' +
      // The second scene is a first-class control, not a line in a menu:
      // "⇄ Second scene" when there is none, the other scene's name when
      // there is. Either way it opens the same door.
      (col ? '' : (function () {
        var other = RP.linkedRoom(state, r);
        return '<button class="pill link' + (other ? ' on' : '') + '" id="linkBtn" ' +
          'title="' + (other ? 'Linked to “' + esc(other.sceneName || other.title) + '” — merge the two into one, send somebody over, carry something, unlink'
            : 'Start a second scene happening right now — split this cast, invite others, or link a chat you already have') + '">⇄ ' +
          (other ? esc(RP.clip(other.sceneName || other.title, 18)) : 'Second scene') + '</button>';
      })()) +
      (r.mechanics === 'off' ? '' : '<button class="pill' + (showStates ? ' primary' : '') + '" id="statesBtn">🩺 Party</button>') +
      '<button class="pill' + (r.privacy === 'private' ? ' primary' : '') + '" id="privacyBtn" ' +
        'title="' + (r.privacy === 'private' ? 'Private: nobody else speaks until you open it again'
          : r.privacy === 'open' ? 'Open: the scene may answer even in a quiet moment'
          : 'Reading the room: quiet turns are left alone, loud ones are answered') + '">' +
        (r.privacy === 'private' ? '🔒 Alone' : r.privacy === 'open' ? '🔓 Open' : '👂 Reads the room') + '</button>' +
      '<button class="pill" id="undoBtn" title="Undo the last turn (Ctrl+Z)"' +
        ((r.undo || []).length ? '' : ' disabled') + '>↩</button>' +
      '<button class="pill" id="redoBtn" title="Redo"' + ((r.redo || []).length ? '' : ' disabled') + '>↪</button>' +
      '<button class="pill' + (auditFlag ? ' warn' : '') + '" id="sceneBtn" ' +
        'title="The scene: its date, its fixed facts, the audit, the book, the link, a sequel">⋯' +
        (auditFlag ? ' ' + auditFlag : '') + '</button>' +
      (col ? '<button class="pill" id="swapBtn" title="Bring this scene to the front — the other goes to the side; nothing else changes">⇄ Front</button>' +
          '<button class="pill merge" id="mergeBtn" title="Merge the two scenes into one — everybody in one place, both chats as one stream. ↩ undoes it.">⊕ Merge</button>'
        : '<button class="pill" id="panelBtn" title="The dock — cast, scene, memory, voice, share">☰</button>'));

    // The sheets, visible in the chat rather than buried in a menu. The
    // reader's own pack renders first: it is the one they can actually use.
    if (r.mechanics !== 'off') RP.ensurePlayerSheet(state, r);
    var sheetBar = $c('statebar');
    if (sheetBar) {
      sheetBar.hidden = !showStates || r.mechanics === 'off';
      var playerId = RP.playerSheetId(r);
      var away = Object.keys(r.states || {}).filter(function (id) {
        return id !== RP.PLAYER_ID && r.states[id] && r.states[id].present === false;
      });
      var sheetIds = (r.states && r.states[playerId] ? [playerId] : [])
        .concat(Object.keys(r.states || {}).filter(function (id) { return id !== playerId; }));
      sheetBar.innerHTML = (!showStates ? '' : sheetIds.map(function (id) {
        var sheet = r.states[id];
        if (!sheet || sheet.present === false) return '';
        var isYou = id === playerId;
        var who = charOf(r, id);
        // NOT a <button>: the slots inside are buttons, and HTML closes a
        // button the moment another one opens — the whole grid would be
        // reparented out of the card. A span with the same handler is safe.
        var moodStyle = sheet.mood ? RP.moodStyle(sheet.mood) : '';
        return '<span class="sheet' + (isYou ? ' you' : '') + (moodStyle ? ' mooded' : '') + '" role="button" tabindex="0" data-sheet="' + esc(id) + '"' +
          (moodStyle ? ' style="' + moodStyle + '"' : '') +
          (isYou ? '' : ' draggable="true" data-drag="' + esc(id) + '"') + ' title="Edit state' + (isYou ? '' : ' · drag to the bench to write them out') + '">' +
          (isYou ? '<span class="here" title="You — always in the scene">🧍</span>'
            : '<span class="here" data-here="' + esc(id) + '" title="' +
          (sheet.present === false ? 'Not in the scene — click to bring them back' : 'In the scene — click to write them out') +
          '">' + (sheet.present === false ? '◌' : '◉') + '</span>') +
          '<span class="nm">' + (isYou && !who ? userAvatar(22) : avatar(who, 22)) + esc(sheet.name) + '</span>' +
          (sheet.hp ? bar('hp', sheet.hp) : '') + (sheet.mp ? bar('mp', sheet.mp) : '') +
          kitGrid(r, id) +
          '<span class="chips">' +
          (moodStyle ? '<span class="flag mood" title="' + esc('How they feel — ' + sheet.mood.key + ' ' + sheet.mood.level + '/3' +
              (sheet.mood.note ? ' · ' + sheet.mood.note : '') + '. Builds while the scene feeds it, fades when it stops.') + '">' +
            RP.moodIcon(sheet.mood) + ' ' + esc(RP.moodLabel(sheet.mood)) + '</span>' : '') +
          (sheet.stats ? '<span class="flag stat" title="might · wits · sway · luck (0–3) — they lean on the dice when your attempt uses them">' +
            esc(RP.statLine(sheet.stats)) + '</span>' : '') +
          Object.keys(sheet.flags || {}).map(function (f) {
            var cond = sheet.flags[f] && typeof sheet.flags[f] === 'object' ? sheet.flags[f] : { note: '', turns: 0 };
            return '<span class="flag' + (cond.effect ? ' biting' : '') + '" ' +
              'title="' + esc((cond.note || f.replace(/_/g, ' ')) + (cond.effect ? ' · ' + cond.effect + ' a turn' : '')) + '">' +
              RP.condIcon(f) + ' ' + esc(f.replace(/_/g, ' ')) + (cond.turns ? ' ' + cond.turns : '') +
              (cond.effect ? ' ' + esc(cond.effect) : '') + '</span>';
          }).join('') + Object.keys(sheet.counters || {}).map(function (c) {
            return '<span class="flag num">' + esc(c.replace(/_/g, ' ')) + ' ' + sheet.counters[c] + '</span>';
          }).join('') + (sheet.status ? '<span class="flag note">' + esc(sheet.status) + '</span>' : '') + '</span>' +
          '</span>';
      }).join('')) + (!showStates ? '' :
        '<button class="sheet add" id="castAdd" title="Invite a character from the archive into this scene">＋ invite</button>' +
        '<span class="sheet bench" id="awayBench" title="Not in the scene — drop a card here to write somebody out">◌' +
          away.map(function (id) {
            return '<span class="benched"><b>' + esc(r.states[id].name) + '</b>' +
              '<button data-back="' + esc(id) + '" title="Back into the scene">↩</button>' +
              '<button data-dropcast="' + esc(id) + '" title="Remove from this chat entirely (the archive keeps them)">✖</button></span>';
          }).join('') + '</span>');
      if (sfx) suffixIds(sheetBar, sfx);
    }

    var hideSys = state.settings.sysNotes === 'hide';
    var html = r.messages.map(function (m, i) {
      // Legacy rows from before the meta was folded into the turn card.
      if (hideSys && (m.role === 'fate' || m.role === 'state' || m.error)) return '';
      if (m.role === 'fate') return '<div class="metaline"><span class="roll">' + esc(m.pill || '') + '</span></div>';
      if (m.role === 'state') {
        return '<div class="metaline">' + (m.lines || []).map(function (l) {
          return '<span>' + esc(l) + '</span>';
        }).join('') + '</div>';
      }
      if (m.role === 'scene') {
        if (m.camera) return '<div class="scene-card camera" title="Merged: this stretch happened in the scene named here">' + esc(RP.textOf(m)) + '</div>';
        return '<div class="scene-card' + (m.beat ? ' beat' : m.direction ? ' direction' : '') + '"><span class="kicker">' +
          (m.beat ? '⏩ Beat' : m.direction ? (m.from ? '⟶ Carried over from “' + esc(m.from) + '”' : '🎬 Direction') : 'Scene') +
          '</span>' + esc(RP.textOf(m)) + '</div>';
      }
      if (m.role === 'world') {
        return '<article class="turn world' + (m.muted ? ' muted' : '') + (m.ambient ? ' ambient' : '') + '">' +
          '<div class="who"><span class="globe">' + esc(RP.NARRATORS[RP.narrator(state)].icon) + '</span>' +
          '<b>' + esc(RP.NARRATORS[RP.narrator(state)].name) + '</b>' + stamp(m) +
          (m.ambient ? '<span class="meanwhile" title="This happened while you were in the other scene">🌗 meanwhile</span>' : '') +
          '<button class="speak" data-speak="' + i + '" title="Read aloud">▶</button></div>' +
          '<div class="bubble">' + RP.md(RP.applyTints(RP.textOf(m), r.tints)) + '</div>' +
          metaStrip(m, i) +
          '<div class="acts">' +
          '<button data-retry="' + i + '" title="Another take">↻</button>' +
          (r.mechanics === 'off' ? '' : '<button data-auditturn="' + esc(m.id) + '" title="Audit this turn against the sheets">🩺</button>') +
          '<button class="' + (m.pinned ? 'on' : '') + '" data-pin="' + i + '" title="Pin">📌</button>' +
          '<button data-edit="' + esc(m.id) + '" title="Edit">✏️</button>' +
          '<button class="' + (m.muted ? 'on' : '') + '" data-mute="' + esc(m.id) + '" title="Mute">' + (m.muted ? '🙈' : '👁') + '</button>' +
          '<button data-drop="' + esc(m.id) + '" title="Delete">🗑</button>' +
          '</div></article>';
      }
      var mine = m.role === 'user';
      // If you have ★ starred somebody, your turns are theirs: the label and
      // the face should say so rather than showing your account name.
      var playing = RP.playerCharacter(r);
      var who = mine ? ((playing && playing.name) || state.user.name || 'You') : charOf(r, m.charId).name;
      var swipes = (m.alts && m.alts.length > 1)
        ? '<span class="swipe"><button data-swipe="-1" data-i="' + i + '">‹</button>' + ((m.alt || 0) + 1) + ' / ' + m.alts.length + '<button data-swipe="1" data-i="' + i + '">›</button></span>' : '';
      return '<article class="turn ' + (mine ? 'user' : 'char') + (m.error ? ' err' : '') +
        (m.muted ? ' muted' : '') + (m.imported ? ' imported' : '') + (m.ambient ? ' ambient' : '') +
        (m.chorus ? ' chorus' : '') + (m.same ? ' same' : '') + moodAttrs(m) + '">' +
        '<div class="who">' + (mine ? (playing ? avatar(playing, 24) : userAvatar(24)) : avatar(charOf(r, m.charId), 24)) +
        '<b>' + esc(who) + '</b>' + stamp(m) + (mine ? '' : '<span class="badge">archive</span>') +
        (m.ambient ? '<span class="meanwhile" title="' + (playing && m.charId === playing.id ? 'Your character acted alone while you were in the other scene'
          : 'This happened while you were in the other scene') + '">🌗 meanwhile</span>' : '') +
        (m.chorus ? '<span class="chorus" title="The room answering — written in the same call as the turn above, filed under the person who said it">👥 the room</span>' : '') +
        (m.same ? '<span class="same" title="Written as happening in the same seconds as the turn above, not after it">\u23f1 same moment</span>' : '') +
        (m.mood && RP.MOODS[m.mood.key] ? '<span class="moodtag" title="How they felt as this turn ended — the box wears the colour">' +
          RP.moodIcon(m.mood) + ' ' + esc(RP.moodLabel(m.mood)) + '</span>' : '') +
        (mine ? '' : '<button class="speak" data-speak="' + i + '" title="Read aloud">▶</button>') +
        (m.error ? '' : '<span class="grip" draggable="true" data-dragturn="' + esc(m.id) + '" ' +
          'title="Drag this turn onto the other scene to carry it over — or to the edge of the stage to start one">⠿</span>') +
        '</div>' +
        '<div class="bubble">' + (m.mentions ? linkMentions(RP.md(RP.applyTints(RP.textOf(m), r.tints)), m.mentions) : RP.md(RP.applyTints(RP.textOf(m), r.tints))) + '</div>' +
        ((m.ooc || []).length
          ? '<div class="metastrip">' + m.ooc.map(function (n) {
              return '<span class="ooc" title="Sent to the model, not spoken aloud">(( ' + esc(n) + ' ))</span>';
            }).join('') + '</div>'
          : '') +
        metaStrip(m, m.error ? undefined : i) +
        (m.error ? '<div class="acts"><span>This notice stays out of the model’s context.</span></div>' :
          '<div class="acts">' + swipes +
          (mine ? '' : '<button data-retry="' + i + '" title="Another take">↻</button>') +
          (mine || r.mechanics === 'off' ? '' : '<button data-auditturn="' + esc(m.id) + '" title="Audit this turn against the sheets">🩺</button>') +
          '<button class="' + (m.react === 'up' ? 'on' : '') + '" data-react="up" data-i="' + i + '">👍</button>' +
          '<button class="' + (m.react === 'down' ? 'on' : '') + '" data-react="down" data-i="' + i + '">👎</button>' +
          '<button class="' + (m.pinned ? 'on' : '') + '" data-pin="' + i + '" title="Pin">📌</button>' +
          '<button data-remember="' + i + '" title="File into the world log">🧠</button>' +
          '<button data-edit="' + esc(m.id) + '" title="Edit this line">✏️</button>' +
          '<button class="' + (m.muted ? 'on' : '') + '" data-mute="' + esc(m.id) + '" ' +
            'title="' + (m.muted ? 'Muted — the model cannot see this' : 'Mute: keep it on screen, hide it from the model') + '">' +
            (m.muted ? '🙈' : '👁') + '</button>' +
          '<button data-drop="' + esc(m.id) + '" title="Delete this line">🗑</button>' +
          '<button data-fork="' + esc(m.id) + '" title="Branch a new chat from here">🌿</button>' +
          '</div>') +
        '</article>';
    }).join('');
    if (!r.messages.length) {
      html = '<div class="emptynote">Say something, or press ➤ Continue to let ' +
        esc((r.cast[0] || {}).name || 'them') + ' open the scene.</div>';
    }
    var writingHere = busy && (!busyRoom || busyRoom === r.id);
    var handback = (!writingHere && r.handback)
      ? '<div class="handback"><b>Your turn.</b> ' + esc(r.handback) + '</div>' : '';
    put('stream', '<div class="stream-inner">' + html + handback +
      (writingHere ? '<div class="turn typing"><em>…writing…</em></div>' : '') + '</div>');
    $c('stream').scrollTop = $c('stream').scrollHeight;
    var playingNow = RP.playerCharacter(r);
    if ($c('input')) {
      $c('input').placeholder = (playingNow
        ? 'Write as ' + playingNow.name + ' — *actions in asterisks*, "speech in quotes"'
        : 'Write your turn — *actions in asterisks*, "speech in quotes"') +
        (col ? ' — in “' + RP.clip(r.sceneName || r.title, 30) + '”' : '');
    }

    // Who answers next, and the two things you always want to press.
    // Row one: who is up — you, then the faces that can speak next (drag
    // one to the edge of the stage to start a second scene with them).
    // Row two: the big moves, labelled, in the order a turn usually goes.
    put('speakers',
      '<div class="row who">' +
      (playingNow
        ? '<button class="sp playas on" id="qaPlayAs" title="You play ' + esc(playingNow.name) + ' — the model never speaks for them. Click to switch or hand them back.">' +
          avatar(playingNow, 24) + '★ You: ' + esc(playingNow.name) + '</button>'
        : '<button class="sp playas" id="qaPlayAs" title="Take a seat as somebody from the archive — Waluigi, Wario, anyone. Your turns wear their face and name.">🎭 Play as…</button>') +
      '<span class="emptynote">Next:</span>' +
      ((state.settings.world || 'on') === 'off' ? '' :
        '<button class="sp world ' + (r.next === 'world' ? 'on' : '') + '" data-speaker="world" ' +
        'title="' + esc(RP.NARRATORS[RP.narrator(state)].blurb) + '">' +
        esc(RP.NARRATORS[RP.narrator(state)].icon) + ' ' + esc(RP.NARRATORS[RP.narrator(state)].name) + '</button>') +
      RP.presentCast(r).map(function (c) {
        var mine = r.youPlay === c.id;
        var on = !mine && (r.next === c.id || (Array.isArray(r.pinnedNext) && r.pinnedNext.indexOf(c.id) >= 0));
        return '<button class="sp ' + (on ? 'on' : '') + (mine ? ' mine' : '') + '" data-speaker="' + esc(c.id) + '" ' +
          'draggable="true" data-dragcast="' + esc(c.id) + '" ' +
          'title="' + (mine ? 'You play them. ' : 'Click: they speak next. ') + 'Drag to the edge of the stage to start a second scene with them, or onto the other scene to send them there.">' +
          avatar(c, 24) + esc(c.name) +
          '<span class="star' + (mine ? ' on' : '') + '" data-star="' + esc(c.id) + '" ' +
          'title="' + (mine ? 'You play them — the model never speaks for them' : 'Mark as the character you play') + '">' +
          (mine ? '★' : '☆') + '</span></button>';
      }).join('') +
      (RP.speakableCast(r).length > 1 || (RP.speakableCast(r).length && (state.settings.world || 'on') !== 'off')
        ? '<button class="sp together' + (Array.isArray(r.pinnedNext) ? ' on' : '') + '" id="qaTogether" ' +
          'title="Pick several of them to act on your next turn \u2014 one after another, or all in the same moment (one runs while another shoots)">' +
          (Array.isArray(r.pinnedNext)
            ? (r.pinnedSame ? '\u23f1 ' : '\u2193 ') + r.pinnedNext.length + ' together'
            : '👥 Several…') + '</button>'
        : '') +
      '</div>' +
      '<div class="row do">' +
      '<span class="acts">' +
        '<button class="qa" id="qaDirect" title="Say what happens next — not as your character, as the director. It happens this turn, and the cast deals with it.">🎬 Direct…</button>' +
        (r.mechanics === 'off' ? '' : '<button class="qa" id="qaRisk" title="Attempt something the world can refuse">🎲 Attempt…</button>') +
        '<button class="qa" id="qaContinue" title="Let the scene move without you (n)">➤ Continue</button>' +
        '<button class="qa' + (autoLeft ? ' on' : '') + '" id="qaAuto" title="Let the scene play itself for a few turns">' +
          (autoLeft ? '■ Stop (' + autoLeft + ')' : '▶ Auto') + '</button>' +
        (progress.total && progress.at < progress.total ? '<button class="qa" id="qaBeat">⏩ Next beat</button>' : '') +
        '<button class="qa" id="qaAdd" title="Bring somebody into this scene">＋ Bring in…</button>' +
      '</span>' +
      '<span class="grow"></span>' +
      '<span class="acts quiet">' +
        (r.mechanics === 'off' ? '' : macroButtons(r)) +
        '<button class="qa" id="qaLength" title="How long a reply is — click to change">✂ ' + esc((RP.LENGTHS[state.settings.length] || RP.LENGTHS[RP.DEFAULT_LENGTH]).name) + '</button>' +
        '<button class="qa' + (state.settings.sysNotes === 'hide' ? ' on' : '') + '" id="qaSys" ' +
          'title="Show or hide the system rows — receipts, rolls, error notices. They stay out of the model\u2019s context either way.">' +
          (state.settings.sysNotes === 'hide' ? '🧹 Notes hidden' : '🧹 Hide notes') + '</button>' +
      '</span>' +
      '</div>');
  }

  /* ---------------------------------------------------------------- *
   * the linked scene — two scenes of one chat, the same hour, side by side
   * ---------------------------------------------------------------- */

  /** ⇄ in the header and the scene menu: swap, send somebody over, carry
   *  something, what the scenes know of each other, unlink. */
  function linkMenu(r) {
    var other = RP.linkedRoom(state, r);
    if (!other) { linkPicker(r); return; }
    var name = other.sceneName || other.title;
    var sees = r.linkMode !== 'blind';
    var front = room();
    var forward = front && front.id === r.id ? other : r;   // whichever is at the side comes forward
    var walkers = function (from, to, label) {
      var cast = RP.presentCast(from);
      if (!cast.length) { toast('Nobody is there to send.'); return; }
      list(label, cast.map(function (c) {
        return { label: c.name + (from.youPlay === c.id ? ' — you play them, so you go too' : ''), value: c.id };
      }), function (id) { walkOver(from, to, id); });
    };
    list('⇄ Linked: “' + name + '”', [
      { label: '⊕ Merge the two scenes into one — everybody in one place, both chats as one stream…', value: 'merge' },
      { label: '⇄ Bring “' + (forward.sceneName || forward.title) + '” to the front — the other goes to the side', value: 'swap' },
      { label: '🚶 Send somebody from here over to “' + name + '”… (or drag their face across)', value: 'send' },
      { label: '🚶 Bring somebody over from “' + name + '” into here…', value: 'fetch' },
      { label: '⟶ Carry something over from here into “' + name + '”…', value: 'carry' },
      { label: '⟵ Carry something over from “' + name + '” into here…', value: 'carryBack' },
      { label: sees ? '👁 Each scene knows the other — its people, its last ' + RP.MEANWHILE_TURNS + ' turns, the shared clock — so what would carry, carries on its own. Click to make them blind until you carry something over'
                    : '🙈 The scenes are blind to each other; only ⟶ carries anything — click to let each know the other', value: 'mode' },
      { label: '⨯ Unlink — both scenes stay, as two separate chats', value: 'unlink' },
    ], function (pick) {
      if (pick === 'swap') { state.active = forward.id; save(); render(); return; }
      if (pick === 'merge') { mergeDialog(r); return; }
      if (pick === 'send') { walkers(r, other, '🚶 Who goes over to “' + name + '”?'); return; }
      if (pick === 'fetch') { walkers(other, r, '🚶 Who comes over from “' + name + '”?'); return; }
      if (pick === 'carry') { carryForm(r, other); return; }
      if (pick === 'carryBack') { carryForm(other, r); return; }
      if (pick === 'mode') {
        var mode = sees ? 'blind' : '';
        r.linkMode = mode; other.linkMode = mode;
        save(); render();
        toast(mode ? '🙈 Blind — nothing crosses until you carry it over.' : '👁 Each scene now sees the other’s last turns.');
        return;
      }
      RP.unlinkRoom(state, r);
      dockSide = '';
      save(); buildBoard(); render();
      toast('⨯ Unlinked. Both scenes are in your recents, as two chats.');
    });
  }

  /** Every chat you have, newest first, with a filter box — not a dozen of
   *  them. A chat already linked elsewhere can be taken: it leaves that
   *  pair (you are asked). */
  function linkPicker(r) {
    var others = (state.rooms || []).filter(function (x) {
      return x && x.id !== r.id && (x.cast || []).length;
    }).sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    var rowOf = function (x) {
      var elsewhere = RP.linkedRoom(state, x);
      return '<button class="item" style="text-align:left;cursor:pointer" data-link="' + esc(x.id) + '">' +
        esc(x.sceneName || x.title) + ' · ' + esc(x.cast.map(function (c) { return c.name; }).join(', ')) +
        ' · ' + RP.counter(x) + ' turns' + (elsewhere ? ' · ⇄ already linked to “' + esc(elsewhere.sceneName || elsewhere.title) + '”' : '') + '</button>';
    };
    openModal('<h3>⇄ Link a second scene — side by side, the same hour</h3>' +
      '<p class="sub">Two scenes of one story: they share the clock, the sheets of anyone in both, and each knows what the other is doing.</p>' +
      '<div class="stack">' +
      '<button class="item primary" style="text-align:left;cursor:pointer" data-link="__new">＋ A new scene — pick who is there</button>' +
      (others.length > 6 ? '<input type="search" id="linkFind" placeholder="Find a chat — by name or who is in it" aria-label="Find a chat">' : '') +
      '<div id="linkRows">' + others.map(rowOf).join('') + '</div>' +
      (others.length ? '' : '<p class="sub">No other chats yet — start a new scene.</p>') +
      '</div><div class="actions"><button class="pill" id="mCancel">Close</button></div>');
    $('mCancel').onclick = closeModal;
    var find = $('linkFind');
    var wire = function () {
      $('modal').querySelectorAll('[data-link]').forEach(function (b) {
        b.onclick = function () { closeModal(); pick(b.dataset.link); };
      });
    };
    if (find) {
      find.oninput = function () {
        var q = find.value.trim().toLowerCase();
        $('linkRows').innerHTML = others.filter(function (x) {
          return !q || ((x.sceneName || '') + ' ' + x.title + ' ' + x.cast.map(function (c) { return c.name; }).join(' ')).toLowerCase().indexOf(q) >= 0;
        }).map(rowOf).join('');
        wire();
      };
      find.focus();
    }
    wire();
    function pick(id) {
      var linked = function (b) {
        var elsewhere = RP.linkedRoom(state, b);
        if (elsewhere) RP.unlinkRoom(state, b);
        RP.linkRooms(r, b);
        state.active = r.id;
        syncLinked(true);
        save(); buildBoard(); render();
        toast('⇄ “' + (b.sceneName || b.title) + '” runs beside this one — same hour, same world. Each scene knows the other; ⟶ carries a thing over by hand.');
      };
      if (id === '__new') {
        castPicker({
          title: 'Who is in the second scene?', portraits: true, suggest: false, ok: 'Open it at the side',
          note: 'Two or more people and it can play without you (➤ Continue); one and you play opposite them. ' +
            'To play somebody there yourself, bring it to the front (⇄) and use 🎭 Play as.',
        }, function (chosen) {
          if (!chosen.length) return;
          startGroup(chosen, {});
          var b = room();
          if (!b || b === r) return;
          linked(b);
        });
        return;
      }
      var b = (state.rooms || []).filter(function (x) { return x.id === id; })[0];
      if (!b) return;
      var elsewhere = RP.linkedRoom(state, b);
      if (elsewhere) {
        confirmThen('Take “' + (b.sceneName || b.title) + '” from its pair?',
          'It is linked to “' + (elsewhere.sceneName || elsewhere.title) + '” now. Linking it here leaves that one on its own.',
          function () { linked(b); }, { ok: 'Link it here', no: 'Leave it' });
        return;
      }
      linked(b);
    }
  }

  /** ⟶ — what crosses from one scene into the other. Nothing does on its
   *  own: you name the thing as it is noticed THERE, and that scene plays
   *  it as a direction, this turn. */
  function carryForm(from, to, preset) {
    var toName = to.sceneName || to.title;
    var fromName = from.sceneName || from.title;
    var last = RP.meanwhileLines(state, from, 1)[0] || '';
    var narrator = RP.NARRATORS[RP.narrator(state)];
    var who = [{ value: 'world', label: narrator.icon + ' ' + narrator.name + ' — narrates it arriving' }]
      .concat(RP.speakableCast(to).map(function (c) { return { value: c.id, label: c.name + ' — notices it, in character' }; }));
    form('⟶ Carry over into “' + toName + '”', [
      { k: 'text', label: 'What reaches “' + toName + '” from “' + fromName + '”? Write it as it is noticed THERE — a plane’s spotlight sweeping the yard, a crash from the next room, Wario walking in from the hangar', type: 'area', value: preset ? RP.clip(String(preset), 600) : '' },
      { k: 'who', label: 'Who plays it there', type: 'select', value: 'world', options: who },
    ], {
      note: (last ? 'Last thing here — ' + RP.clip(last, 160) + '. ' : '') +
        'The other scene plays it as a thing that happens, this turn, and its people deal with it. Nothing crosses on its own.',
      ok: '⟶ Carry it over',
    }, function (v) {
      if (!v.text.trim()) return;
      directRoom(to, v.text.trim(), v.who, fromName);
    });
  }

  /** ⇄ — the one door to a second scene. With none yet: split this cast
   *  (the usual case mid-scene — "Wario goes to the plane, now"), or reach
   *  the picker for other people and existing chats. With one already:
   *  the link menu (swap, carry, blind, unlink). `preset.ids` pre-ticks
   *  faces, `preset.text` pre-fills where it is — that is what a drag onto
   *  the drop zone hands over. */
  function secondSceneDialog(r, preset) {
    preset = preset || {};
    if (RP.linkedRoom(state, r)) { linkMenu(r); return; }
    var here = RP.presentCast(r);
    var you = RP.playerCharacter(r);
    var pre = preset.ids || [];
    openModal('<h3>⇄ A second scene, happening now</h3>' +
      '<p class="sub">Something is going on somewhere else at the same hour. Pick who goes there and say where it is: ' +
      'this scene keeps playing in front, the new one opens at the side, and each hears what the other just did.</p>' +
      '<label>Who goes</label>' +
      '<div class="picker portraits splitpick">' + here.map(function (c) {
        var on = pre.indexOf(c.id) >= 0;
        return '<button type="button" class="pick' + (on ? ' on' : '') + '" data-split="' + esc(c.id) + '">' + avatar(c, 44) +
          '<span>' + esc(c.name) + (you && you.id === c.id ? ' ★' : '') + '</span>' +
          (you && you.id === c.id ? '<small>you play them — you go too</small>' : '') + '</button>';
      }).join('') + '</div>' +
      (you ? '' : '<div class="checks"><label><input type="checkbox" id="f_yougo"> I go with them — this scene plays on without me (➤ Continue)</label></div>') +
      '<label for="f_where">Where they are, and what is happening</label>' +
      '<textarea id="f_where" placeholder="The hangar roof, the same minute. Wario has the plane’s engine open and the spotlight is sweeping the yard below.">' +
      esc(preset.text || '') + '</textarea>' +
      '<p class="sub">Whoever you pick is written out of this scene (↩ brings them back) and walks into the new one with their ' +
      'sheet and their kit. Nobody picked? Then it is a scene with other people, or a chat you already have.</p>' +
      '<div class="actions">' +
        '<button class="pill" id="mLinkOther" title="A new scene with people who are not here, or a chat you already have">Other people, or an existing chat…</button>' +
        '<span class="grow"></span>' +
        '<button class="pill" id="mCancel">Cancel</button>' +
        '<button class="pill primary" id="mOk">✂ Split the scene</button>' +
      '</div>');
    $('modal').querySelectorAll('[data-split]').forEach(function (b) {
      b.onclick = function () { b.classList.toggle('on'); };
    });
    $('mCancel').onclick = closeModal;
    $('mLinkOther').onclick = function () { closeModal(); linkPicker(r); };
    $('mOk').onclick = function () {
      var ids = [].map.call($('modal').querySelectorAll('[data-split].on'), function (b) { return b.dataset.split; });
      var where = ($('f_where').value || '').trim();
      var youGo = Boolean(you && ids.indexOf(you.id) >= 0) || Boolean($('f_yougo') && $('f_yougo').checked);
      if (!ids.length && !youGo) { closeModal(); linkPicker(r); return; }
      closeModal();
      splitScene(r, ids, where || 'Somewhere else, the same hour.', youGo);
    };
    if ($('f_where') && !preset.text) $('f_where').focus();
  }

  /** ✂ Split: some of the people here go somewhere else, now. They are
   *  written out of this scene, a second scene opens with them in it —
   *  sheets, kit, the date and the clock carried — the two are linked, and
   *  the camera stays here unless you went with them. */
  function splitScene(r, ids, where, youGo) {
    var moving = (r.cast || []).filter(function (c) { return ids.indexOf(c.id) >= 0; });
    if (!moving.length && !youGo) return null;
    RP.pushUndo(r, 'splitting the scene');
    var fromName = r.sceneName || r.title;
    var names = moving.map(function (c) { return c.name; });
    var states = {};
    moving.forEach(function (c) {
      if (r.states && r.states[c.id]) states[c.id] = JSON.parse(JSON.stringify(r.states[c.id]));
    });
    if (youGo && r.states && r.states[RP.PLAYER_ID]) states[RP.PLAYER_ID] = JSON.parse(JSON.stringify(r.states[RP.PLAYER_ID]));
    var title = RP.clip(String(where).split(/[.\n!?]/)[0].trim(), 48) || 'Meanwhile';
    // A split with nobody from here: you alone, opposite whoever turns up.
    var seats = moving.length ? moving : [r.cast[0]].filter(Boolean);
    startGroup(seats, {
      scene: where, sceneName: title, date: r.date || '',
      statePreset: r.statePreset, mechanics: r.mechanics, states: Object.keys(states).length ? states : null,
      opener: '⇄ Split from “' + fromName + '” — ' + (names.join(', ') || 'you') + (youGo && names.length ? ' and you' : '') + ' went here, the same hour.',
    });
    var b = room();
    if (!b || b === r) return null;
    b.clock = r.clock || '';
    b.persona = r.persona || b.persona;
    // The default "play as" seat may have sat somebody down who stayed behind.
    if (b.youPlay && ids.indexOf(b.youPlay) < 0) RP.castRemove(b, b.youPlay);
    if (!moving.length) {
      // Nobody from here came along: the one seat was a stand-in. The scene is yours alone until somebody arrives.
      b.cast.forEach(function (c) { if (b.states && b.states[c.id]) b.states[c.id].present = false; });
    }
    if (youGo) {
      if (r.youPlay && ids.indexOf(r.youPlay) >= 0) { b.youPlay = r.youPlay; }
      if (states[RP.PLAYER_ID]) { b.states = b.states || {}; b.states[RP.PLAYER_ID] = states[RP.PLAYER_ID]; b.states[RP.PLAYER_ID].present = true; }
      RP.ensurePlayerSheet(state, b);
    } else if (b.youPlay) {
      // You stayed: nobody in the new scene is yours.
      RP.markPlayer(b, b.youPlay);
    }
    moving.forEach(function (c) { if (r.states && r.states[c.id]) RP.setPresent(r, c.id, false); });
    if (youGo) {
      r.youPlay = '';
      if (r.states && r.states[RP.PLAYER_ID]) r.states[RP.PLAYER_ID].present = false;
    }
    r.messages.push({ id: RP.uid(), role: 'state', at: Date.now(),
      lines: ['⇄ ' + (names.join(', ') || 'You') + (youGo && names.length ? ' and you' : '') + ' left for “' + title + '” — it runs at the side, the same hour. ↩ on a seat brings them back.'] });
    RP.linkRooms(r, b);
    state.active = youGo ? b.id : r.id;
    r.updated = Date.now(); b.updated = Date.now();
    save(); buildBoard(); render();
    toast('⇄ “' + title + '” opened at the side with ' + (names.join(', ') || 'you') + '. Drop a face across to send somebody over; ⟶ carries anything else.');
    return b;
  }

  /* ---------------------------------------------------------------- *
   * @ — who you mean
   * ---------------------------------------------------------------- */
  /** Everything @ could point at from this room, plus archive matches
   *  for each @word actually typed (the archive is only searched by name). */
  function mentionCandidates(r, text) {
    var all = RP.mentionables(state, r, castById, '');
    var words = String(text || '').match(/@\[?([A-Za-z][\w'’.\- ]{1,40})/g) || [];
    words.forEach(function (w) {
      var q = w.replace(/^@\[?/, '').split(/\s+/)[0];
      RP.mentionables(state, r, castById, q).forEach(function (c) {
        if (!all.some(function (x) { return x.id === c.id; })) all.push(c);
      });
    });
    return all;
  }

  /** A name spoken here that belongs to the other scene is heard of there:
   *  a quiet card, so the record on both sides knows who was talked about. */
  function pingElsewhere(r, mentions, text) {
    var other = RP.linkedRoom(state, r);
    if (!other) return;
    var named = (mentions || []).filter(function (m) { return m.kind === 'other' && m.roomId === other.id; });
    if (!named.length) return;
    other.messages.push({ id: RP.uid(), role: 'state', at: Date.now(), ping: true,
      lines: ['📣 ' + named.map(function (m) { return m.name; }).join(', ') + ' — named in “' + (r.sceneName || r.title) + '”: “' + RP.clip(text, 90) + '”'] });
    other.updated = Date.now();
  }

  /** The @ picker under a composer: opens on @, filters as you type,
   *  arrows and Enter pick, Escape closes; the @ button opens it whole. */
  function wireMentions(input, r) {
    if (!input) return;
    input.mentionRoom = r;                       // the front box outlives the room it is wired for
    if (input.dataset.mentionsWired) return;
    input.dataset.mentionsWired = '1';
    var pop = document.createElement('div');
    pop.className = 'mention-pop';
    pop.hidden = true;
    input.parentNode.insertBefore(pop, input);
    var items = [], at = 0, from = -1;
    var close = function () { pop.hidden = true; items = []; from = -1; };
    var insert = function (c) {
      var v = input.value;
      var head = from >= 0 ? v.slice(0, from) : v.slice(0, input.selectionStart || v.length);
      var tail = from >= 0 ? v.slice(input.selectionStart || v.length) : v.slice(input.selectionStart || v.length);
      var name = /\s/.test(c.name) ? '@[' + c.name + ']' : '@' + c.name;
      input.value = head + name + ' ' + tail;
      var caret = (head + name + ' ').length;
      input.focus();
      try { input.setSelectionRange(caret, caret); } catch (e) { /* older engines */ }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      close();
    };
    var draw = function () {
      if (!items.length) { close(); return; }
      pop.innerHTML = items.map(function (c, i) {
        return '<button type="button" class="mention-row' + (i === at ? ' on' : '') + '" data-pick-mention="' + i + '">' +
          (c.kind === 'book' ? '<span class="av av-24" style="width:24px;height:24px;min-width:24px;font-size:12px;background:#5b5b66">📓</span>' : avatar(c, 24)) +
          '<b>' + esc(c.name) + '</b><span class="kind">' + esc(RP.MENTION_KINDS[c.kind] || c.kind) + (c.note ? ' · ' + esc(RP.clip(c.note, 36)) : '') + '</span></button>';
      }).join('');
      pop.hidden = false;
      pop.querySelectorAll('[data-pick-mention]').forEach(function (b) {
        b.onmousedown = function (e) { e.preventDefault(); insert(items[Number(b.getAttribute('data-pick-mention'))]); };
      });
    };
    var open = function (query, start) {
      from = start;
      items = RP.mentionables(state, input.mentionRoom || r, castById, query).slice(0, 8);
      at = 0;
      draw();
    };
    input.addEventListener('input', function () {
      var head = input.value.slice(0, input.selectionStart || input.value.length);
      var hit = /(^|\s)@\[?([^\s@\]]{0,30})$/.exec(head);
      if (!hit) { close(); return; }
      open(hit[2], head.length - hit[0].length + hit[1].length);
    });
    input.addEventListener('keydown', function (e) {
      if (pop.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % items.length; draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + items.length) % items.length; draw(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); insert(items[at]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    }, true);
    input.addEventListener('blur', function () { window.setTimeout(close, 150); });
    input.mentionOpen = function () {
      var v = input.value, caret = input.selectionStart || v.length;
      var pre = v.slice(0, caret);
      var needsSpace = pre && !/\s$/.test(pre);
      input.value = pre + (needsSpace ? ' ' : '') + '@' + v.slice(caret);
      var c2 = (pre + (needsSpace ? ' ' : '') + '@').length;
      input.focus();
      try { input.setSelectionRange(c2, c2); } catch (e) { /* older engines */ }
      open('', c2 - 1);
    };
  }

  /** A mentioned name in a turn card: who they are, where, and what you
   *  can do about it from here. */
  function mentionCard(r, m) {
    var other = RP.linkedRoom(state, r);
    var here = (r.cast || []).filter(function (c) { return c.id === m.id; })[0];
    var sheet = r.states && r.states[m.id];
    var kind = m.kind;
    var overThere = other && RP.presentCast(other).some(function (c) { return c.id === m.id; });
    if (here && sheet && sheet.present !== false) kind = 'here';
    else if (overThere) kind = 'other';
    else if (here && sheet && sheet.present === false) kind = 'away';
    var sheetLine = function (sh) {
      if (!sh) return '';
      return (sh.hp ? '❤ ' + sh.hp.value + '/' + sh.hp.max + ' ' : '') + (sh.mp ? '\u26a1 ' + sh.mp.value + '/' + sh.mp.max + ' ' : '') +
        (sh.mood && RP.MOODS[sh.mood.key] ? RP.MOODS[sh.mood.key].icon + ' ' + RP.moodLabel(sh.mood) + ' ' : '') +
        Object.keys(sh.flags || {}).map(function (f) { return '· ' + f.replace(/_/g, ' '); }).join(' ');
    };
    var entry = kind === 'book' ? (((state.book || {}).entries || []).filter(function (e) { return e && e.name && e.name.toLowerCase() === m.name.toLowerCase(); })[0]) : null;
    var rec = castById[m.id];
    var body = kind === 'here' ? 'In this scene. ' + sheetLine(sheet)
      : kind === 'away' ? 'Written out of this scene. ' + sheetLine(sheet)
      : kind === 'other' && other ? 'In “' + esc(other.sceneName || other.title) + '” right now. ' + sheetLine(other.states && other.states[m.id])
      : kind === 'book' ? (entry ? esc(String(entry.kind || '').toLowerCase()) + (entry.roomTitle ? ' · filed from “' + esc(entry.roomTitle) + '”' : '') + '<br>' + esc(entry.text || '') : 'In the lore book.')
      : rec ? esc(rec.title || '') + (rec.summary ? '<br>' + esc(RP.clip(rec.summary, 240)) : '') : 'From the archive.';
    openModal('<h3>' + (kind === 'book' ? '📓 ' : '') + esc(m.name) + '</h3>' +
      '<p class="sub">' + esc(RP.MENTION_KINDS[kind] || kind) + '</p><p>' + body + '</p>' +
      '<div class="actions">' +
      (kind === 'here' ? '<button class="pill" id="mSheet">Open their sheet</button>' : '') +
      (kind === 'away' ? '<button class="pill" id="mBack">↩ Bring them back into the scene</button>' : '') +
      (kind === 'other' && other ? '<button class="pill" id="mWalk">🚶 Bring them over here</button><button class="pill" id="mGo">Open their scene</button>' : '') +
      (kind === 'archive' && rec ? '<button class="pill" id="mInvite">＋ Bring them into this scene</button>' : '') +
      '<span class="grow"></span><button class="pill primary" id="mCancel">Close</button></div>');
    $('mCancel').onclick = closeModal;
    if ($('mSheet')) $('mSheet').onclick = function () { closeModal(); editSheet(m.id, r); };
    if ($('mBack')) $('mBack').onclick = function () { RP.setPresent(r, m.id, true); closeModal(); save(); render(); toast(m.name + ' is back in the scene.'); };
    if ($('mWalk')) $('mWalk').onclick = function () { closeModal(); walkOver(other, r, m.id); };
    if ($('mGo')) $('mGo').onclick = function () { closeModal(); openRoom(other.id); };
    if ($('mInvite')) $('mInvite').onclick = function () {
      RP.pushUndo(r, 'inviting ' + rec.name);
      RP.addToRoom(r, rec);
      closeModal(); save(); render();
      toast(rec.name + ' joins the scene.');
    };
  }

  /** The @names of a turn become links in its bubble. */
  function linkMentions(html, mentions) {
    (mentions || []).forEach(function (m) {
      var safe = esc(m.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp('(?![^<]*>)' + safe), '<a class="mention" href="#" data-mention="' + esc(m.id) + '" data-mkind="' + esc(m.kind) + '" data-mname="' + esc(m.name) + '" data-mroom="' + esc(m.roomId || '') + '" title="' + esc(RP.MENTION_KINDS[m.kind] || m.kind) + ' — click for who this is">' + esc(m.name) + '</a>');
    });
    return html;
  }

  /** ⇄ Merge: the two scenes become one place. You say which scene is the
   *  stage (the other folds into it), word how they come together, and
   *  the Director plays the joining as the next turn. The reverse of ✂. */
  function mergeDialog(r) {
    var other = RP.linkedRoom(state, r);
    if (!other) { toast('There is no second scene to merge.'); return; }
    var nameOf = function (x) { return x.sceneName || x.title || 'untitled'; };
    var joiners = function (stage, folded) {
      return RP.presentCast(folded).filter(function (c) {
        var mine = stage.states && stage.states[c.id];
        return !mine || mine.present === false;
      }).map(function (c) { return c.name; });
    };
    var suggest = function (stage, folded) {
      var who = joiners(stage, folded);
      var you = RP.playerCharacter(folded);
      var from = nameOf(folded);
      if (!who.length) return 'The two scenes become one: everyone is in the same place now, ' + RP.clip(stage.scene || nameOf(stage), 80) + '.';
      return who.join(', ') + (you && who.indexOf(you.name) >= 0 ? '' : '') + ' ' + (who.length === 1 ? 'comes' : 'come') + ' in from ' + from + ' — ' +
        'the two groups are in one place now, and everyone can see what state the others are in.';
    };
    openModal('<h3>⊕ Merge the two scenes into one</h3>' +
      '<p class="sub">Everybody who is in either scene is in the one scene afterwards; both chats become one stream, in the order ' +
      'they happened, with a ⇄ card wherever the camera used to cut. Sheets, kit, facts and the clock are kept. ↩ takes it back.</p>' +
      '<label>Which scene is the stage — the place they are all in now?</label>' +
      '<div class="checks">' +
      '<label><input type="radio" name="mergeStage" value="' + esc(r.id) + '" checked> “' + esc(nameOf(r)) + '” — “' + esc(nameOf(other)) + '” folds into it</label>' +
      '<label><input type="radio" name="mergeStage" value="' + esc(other.id) + '"> “' + esc(nameOf(other)) + '” — “' + esc(nameOf(r)) + '” folds into it</label>' +
      '</div>' +
      '<label for="f_join">How do they come together? (played as a 🎬 direction, so the cast deals with it)</label>' +
      '<textarea id="f_join">' + esc(suggest(r, other)) + '</textarea>' +
      '<div class="checks">' +
      '<label><input type="checkbox" id="f_play" checked> Play the joining now — the Director narrates it as the next turn</label>' +
      '<label><input type="checkbox" id="f_keep" checked> Keep the folded scene in Recents as a record (unlinked, nothing lost)</label>' +
      '</div>' +
      '<div class="actions"><button class="pill" id="mCancel">Cancel</button><button class="pill primary" id="mOk">⊕ Merge</button></div>');
    var radios = $('modal').querySelectorAll('[name=mergeStage]');
    radios.forEach(function (b) {
      b.onchange = function () {
        var stage = b.value === r.id ? r : other, folded = stage === r ? other : r;
        $('f_join').value = suggest(stage, folded);
      };
    });
    $('mCancel').onclick = closeModal;
    $('mOk').onclick = function () {
      var pick = [].filter.call(radios, function (b) { return b.checked; })[0];
      var stage = pick && pick.value === other.id ? other : r;
      var folded = stage === r ? other : r;
      var text = ($('f_join').value || '').trim();
      var play = $('f_play').checked, keep = $('f_keep').checked;
      closeModal();
      mergeScenes(stage, folded, { text: text, play: play, keep: keep });
    };
  }

  function mergeScenes(stage, folded, opts) {
    opts = opts || {};
    if (busy) { toast('The model is writing — wait for it, or press ■.'); return null; }
    var foldName = folded.sceneName || folded.title;
    RP.pushUndo(stage, 'merging “' + foldName + '” into this scene');
    stage.undo[stage.undo.length - 1].linkedTo = folded.id;      // ↩ links them again
    RP.pushUndo(folded, 'being merged into “' + (stage.sceneName || stage.title) + '”');
    folded.undo[folded.undo.length - 1].linkedTo = stage.id;
    var report = RP.mergeRooms(state, stage, folded, {});
    if (!report) return null;
    if (opts.keep) {
      // The record keeps its place in Recents; it is not the live scene.
      if (!/\(merged into /.test(folded.title || '')) folded.title = (folded.title || 'untitled') + ' (merged into “' + RP.clip(stage.title, 30) + '”)';
    } else {
      state.rooms = state.rooms.filter(function (x) { return x.id !== folded.id; });
    }
    dockSide = '';
    state.active = stage.id;
    save(); buildBoard(); render();
    toast('⊕ One scene now: ' + (report.joined.length ? report.joined.join(', ') + ' joined; ' : '') + report.turns + ' turns folded in. ↩ takes it back.');
    if (opts.play && opts.text) directRoom(stage, opts.text, 'world', foldName);
    return report;
  }

  /** Somebody walks from one scene into the other. Written out here, seated
   *  there with their sheet and kit, and the other scene is asked to play
   *  their arrival this turn — the line is yours to word before it goes. */
  function walkOver(from, to, id) {
    var c = charOf(from, id);
    if (!c || !c.id) return;
    var fromName = from.sceneName || from.title;
    var toName = to.sceneName || to.title;
    RP.pushUndo(from, c.name + ' leaving for “' + toName + '”');
    RP.pushUndo(to, c.name + ' arriving from “' + fromName + '”');
    var sheet = from.states && from.states[id] ? JSON.parse(JSON.stringify(from.states[id])) : null;
    var wasYou = from.youPlay === id;
    if (from.states && from.states[id]) RP.setPresent(from, id, false);
    if (!(to.cast || []).some(function (x) { return x.id === id; })) RP.addToRoom(to, c);
    if (sheet) { to.states = to.states || {}; sheet.present = true; sheet.player = false; to.states[id] = sheet; }
    else if (to.states && to.states[id]) to.states[id].present = true;
    if (wasYou) {
      from.youPlay = '';
      if (to.youPlay !== id) { if (to.youPlay) RP.markPlayer(to, to.youPlay); RP.markPlayer(to, id); }
      RP.ensurePlayerSheet(state, from); RP.ensurePlayerSheet(state, to);
    }
    from.messages.push({ id: RP.uid(), role: 'state', at: Date.now(), lines: ['🚪 ' + c.name + ' left for “' + toName + '”.'] });
    from.updated = Date.now(); to.updated = Date.now();
    save(); render();
    directForm(to, c.name + ' walks in from ' + fromName + (wasYou ? '' : '') + '.', fromName);
  }

  // What is being dragged right now: a face or a turn, and which scene it
  // came from. Kept here rather than in dataTransfer so the targets can
  // light up while the drag is in flight.
  var dragging = null;

  /** Drag and drop across the stage. Faces (the rail, the dock, the side
   *  column, the sheet cards) and turns (the ⠿ grip) can be picked up. With
   *  no second scene, the drop zone at the edge of the stage appears: drop
   *  there to start one. With a second scene, the other column lights up:
   *  a face dropped there walks over, a turn dropped there is carried. */
  function wireDrag(r) {
    var view = $('chatview');
    if (!view) return;
    var other = RP.linkedRoom(state, r);
    var end = function () {
      dragging = null;
      document.body.classList.remove('dragging-cast', 'dragging-turn');
      view.querySelectorAll('.dragging, .over, .target').forEach(function (n) { n.classList.remove('dragging'); n.classList.remove('over'); n.classList.remove('target'); });
    };
    var start = function (node, d) {
      return function (ev) {
        dragging = d;
        if (ev && ev.dataTransfer) { try { ev.dataTransfer.setData('text/plain', d.id); ev.dataTransfer.effectAllowed = 'move'; } catch (e) { /* older engines */ } }
        node.classList.add('dragging');
        document.body.classList.add(d.kind === 'cast' ? 'dragging-cast' : 'dragging-turn');
        if (other) view.querySelectorAll('.scene-col').forEach(function (col) { if (!col.contains(node)) col.classList.add('target'); });
      };
    };
    // Which scene a face or a turn belongs to is where it was drawn: the
    // side column is the linked scene's, the dock is whichever it serves.
    var srcOf = function (node) {
      if (node.dataset.dragroom && other && node.dataset.dragroom === other.id) return other;
      if (other && node.closest && node.closest('#sidescene')) return other;
      if (node.closest && node.closest('#charpanel')) return dockRoom();
      return r;
    };
    view.querySelectorAll('[data-dragcast]').forEach(function (node) {
      node.ondragstart = start(node, { kind: 'cast', id: node.dataset.dragcast, roomId: srcOf(node).id });
      node.ondragend = end;
    });
    // The sheet cards keep their own bench drop; they also count as faces.
    view.querySelectorAll('.statebar [data-drag]').forEach(function (node) {
      var go = start(node, { kind: 'cast', id: node.dataset.drag, roomId: srcOf(node).id });
      node.ondragstart = function (ev) { go(ev); };
      node.ondragend = end;
    });
    view.querySelectorAll('[data-dragturn]').forEach(function (node) {
      var src = srcOf(node);
      var m = (src.messages || []).filter(function (x) { return x.id === node.dataset.dragturn; })[0];
      var text = m ? RP.textOf(m) : '';
      node.ondragstart = start(node, { kind: 'turn', id: node.dataset.dragturn, roomId: src.id, text: text });
      node.ondragend = end;
    });
    var zone = $('linkDrop');
    if (zone) {
      zone.hidden = Boolean(other);
      zone.ondragover = function (ev) { if (!dragging) return; ev.preventDefault(); zone.classList.add('over'); };
      zone.ondragleave = function () { zone.classList.remove('over'); };
      zone.ondrop = function (ev) {
        ev.preventDefault();
        var d = dragging; end();
        if (!d) return;
        secondSceneDialog(r, d.kind === 'cast' ? { ids: [d.id] } : { text: d.text });
      };
    }
    [['frontScene', r], ['sidescene', other]].forEach(function (pair) {
      var col = $(pair[0]);
      if (!col) return;
      var target = pair[1];
      if (!other || !target) { col.ondragover = null; col.ondrop = null; col.ondragleave = null; return; }
      col.ondragover = function (ev) {
        if (!dragging || dragging.roomId === target.id) return;
        ev.preventDefault(); col.classList.add('over');
      };
      col.ondragleave = function (ev) { if (!ev.relatedTarget || !col.contains(ev.relatedTarget)) col.classList.remove('over'); };
      col.ondrop = function (ev) {
        var d = dragging;
        if (!d || d.roomId === target.id) return;
        ev.preventDefault(); if (ev.stopPropagation) ev.stopPropagation();
        end();
        var source = d.roomId === r.id ? r : other;
        if (d.kind === 'cast') walkOver(source, target, d.id);
        else carryForm(source, target, d.text);
      };
    });
  }

  /** Ways out of a chat, for different readers — and, with a second scene
   *  linked, the two together: interleaved by the clock, or one bundle. */
  function exportMenu(r, c) {
    var brief = RP.storyBrief(state, r, {});
    var other = RP.linkedRoom(state, r);
    var otherName = other ? (other.sceneName || other.title) : '';
    var both = other ? RP.slug(r.title) + '+' + RP.slug(other.title) : '';
    list('Export “' + RP.clip(r.title, 40) + '”' + (other ? ' — and “' + RP.clip(otherName, 30) + '”' : ''), [
      { label: '✍️ Story brief — trimmed for a writing model (' + Math.round(brief.length / 1000) + 'k chars, no ids, no swipes, no noise)', value: 'brief' },
      { label: '📦 Full chat — JSON another chatroom can import, with memory and lore', value: 'full' },
      { label: '📄 Transcript — markdown, for filing into the wiki', value: 'md' },
      { label: '📝 Plain text — just the turns', value: 'txt' },
      { label: '📇 ' + c.name + ' as a character card', value: 'card' },
    ].concat(other ? [
      { label: '⇄ Both scenes — one transcript, interleaved by the clock, a marker each time the camera moves (markdown)', value: 'bothMd' },
      { label: '⇄ Both scenes — plain text, interleaved', value: 'bothTxt' },
      { label: '⇄ Both scenes — story brief for a writing model', value: 'bothBrief' },
      { label: '⇄ Both scenes — JSON bundle, both chats and the link between them', value: 'bothJson' },
    ] : []), function (pick) {
      if (pick === 'brief') { download(RP.slug(r.title) + '.brief.md', brief); toast('Trimmed to ' + brief.length + ' characters.'); return; }
      if (pick === 'full') { download(RP.slug(r.title) + '.chat.json', JSON.stringify(RP.chatExport(state, r), null, 2)); return; }
      if (pick === 'md') { download(RP.slug(r.title) + '.md', RP.transcript(r)); return; }
      if (pick === 'txt') {
        download(RP.slug(r.title) + '.txt', (r.messages || []).filter(RP.visible).map(function (m) {
          var who = m.role === 'user' ? (state.user.name || 'You') : charOf(r, m.charId).name;
          return who + ': ' + RP.textOf(m);
        }).join('\n\n'));
        return;
      }
      if (pick === 'card') { exportCard(c, true); return; }
      if (pick === 'bothMd') { download(both + '.md', RP.linkedTranscript(state, r, { user: state.user.name })); return; }
      if (pick === 'bothTxt') { download(both + '.txt', RP.linkedTranscript(state, r, { plain: true, user: state.user.name })); return; }
      if (pick === 'bothBrief') {
        var text = '# ' + (r.sceneName || r.title) + ' ⇄ ' + otherName + '\n\nTwo scenes, the same hour. The first:\n\n' + brief +
          '\n\n---\n\nThe second, happening at the same time:\n\n' + RP.storyBrief(state, other, {});
        download(both + '.brief.md', text); return;
      }
      if (pick === 'bothJson') { download(both + '.chat.json', JSON.stringify(RP.chatExport(state, r, { linked: true }), null, 2)); }
    });
  }

  function openPanelFate() {
    form('Fate', [
      { k: 'fate', label: 'How often does the world push back?', type: 'select', value: state.settings.fate || 'normal',
        options: [
          { value: 'off', label: 'Off — whatever you write, works' },
          { value: 'gentle', label: 'Gentle — mostly you, occasionally a price' },
          { value: 'normal', label: 'Normal — costs and wrenches are common, failure happens' },
          { value: 'harsh', label: 'Harsh — the world is against you and the cast argues back' },
        ] },
    ], { note: 'Before each reply to something you attempted, the page rolls and tells the model how it resolves: it works, it works at a price, something cuts across it, it fails, or the character simply refuses you. The model is told not to narrate the dice — and being wounded shifts the odds against you.' },
    function (v) { state.settings.fate = v.fate; save(); render(); });
  }

  // The dock: every system this chat runs on, one tab each. Cast first —
  // it is the one you reach for mid-scene: who is here, who you play, who
  // walks out, who goes off to a second scene.
  var dockTab = 'cast';
  var DOCK_TABS = [['cast', '👥 Cast'], ['scene', '🎬 Scene'], ['memory', '🧠 Memory'], ['voice', '🔊 Voice'], ['share', '⬇ Share']];
  // With two scenes up, the dock serves one of them at a time: '' is the
  // front scene, 'b' the one at the side.
  var dockSide = '';
  function dockRoom() {
    var r = room();
    if (!r) return r;
    var other = RP.linkedRoom(state, r);
    return dockSide === 'b' && other ? other : r;
  }

  function renderPanel() {
    var r = dockRoom();
    var c = r.cast[0] || {};
    var plays = interactions(c.id);
    var style = RP.STYLES[r.style] || RP.STYLES.novel;
    var pinned = r.messages.filter(function (m) { return m.pinned; }).length;
    var mem = (state.chars || []).filter(function (m) { return m.id === c.id; })[0];
    var other = RP.linkedRoom(state, r);
    var front = room();
    $('charpanel').innerHTML =
      (other ? '<div class="dock-side" role="tablist" title="Two scenes are up — which one the dock is about">' +
        [[front, ''], [RP.linkedRoom(state, front), 'b']].map(function (pair) {
          return '<button data-dockside="' + pair[1] + '" role="tab" class="' + ((dockSide === 'b') === (pair[1] === 'b') ? 'on' : '') + '">' +
            (pair[1] ? '⇄ ' : '') + esc(RP.clip(pair[0].sceneName || pair[0].title, 22)) + '</button>';
        }).join('') + '</div>' : '') +
      '<div class="cp-head">' + avatar(c, 72) + '<div class="body"><h3 title="' + esc(r.title) + '">' +
      esc(r.kind === 'group' ? RP.clip(r.sceneName || r.title, 60) : c.name) + '</h3>' +
      '<div class="by">By @' + esc(c.handle || 'waluipedia') + '</div>' +
      '<div class="by">' + plays + (plays === 1 ? ' interaction' : ' interactions') + ' · ' +
      r.cast.length + (r.cast.length === 1 ? ' in the cast' : ' in the cast') + '</div></div></div>' +
      '<div class="dock-tabs" role="tablist">' + DOCK_TABS.map(function (t) {
        return '<button data-dock="' + t[0] + '" class="' + (dockTab === t[0] ? 'on' : '') + '" role="tab" ' +
          'aria-selected="' + (dockTab === t[0] ? 'true' : 'false') + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      (dockTab === 'scene' ? dockScene(r, other, style)
        : dockTab === 'memory' ? dockMemory(r, c, mem, pinned)
        : dockTab === 'voice' ? dockVoice(r)
        : dockTab === 'share' ? dockShare(r, other)
        : dockCast(r, c, other));
    wirePanel();
  }

  /** One seat in the Cast tab. Present seats can be dragged — to the edge
   *  of the stage to start a second scene with them, or onto the other
   *  scene to send them there. Clicking a seat with a sheet edits it. */
  function seatRow(r, x, opts) {
    opts = opts || {};
    var sheet = (r.states || {})[x.id];
    var sub = x.title || (x.invented ? 'invented in play' : '');
    return '<div class="seat' + (opts.away ? ' away' : '') + (opts.you ? ' you' : '') + '"' +
      (opts.away ? '' : ' draggable="true" data-dragcast="' + esc(x.id) + '"') +
      (sheet ? ' data-sheet="' + esc(x.id) + '"' : '') +
      ' title="' + (opts.away ? 'Written out of the scene — ↩ brings them back'
        : 'Drag to the edge of the stage to start a second scene with them, or onto the other scene to send them there' +
          (sheet ? '. Click to edit their sheet.' : '.')) + '">' +
      avatar(x, 28) + '<span class="nm">' + esc(x.name) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
      (opts.you ? '<span class="tag">★ you</span>'
        : '<button data-star="' + esc(x.id) + '" title="Play as ' + esc(x.name) + ' — the model never speaks for them">☆</button>') +
      (opts.other && !opts.away ? '<button data-walk="' + esc(x.id) + '" title="Send them over to “' + esc(opts.other.sceneName || opts.other.title) + '” — they leave here and arrive there this turn">⇄</button>' : '') +
      (sheet && !opts.away ? '<button data-here="' + esc(x.id) + '" title="Write them out — they stay in the chat but leave the scene">🚪</button>' : '') +
      (sheet && opts.away ? '<button data-back="' + esc(x.id) + '" title="Bring them back into the scene">↩</button>' : '') +
      (opts.away ? '<button data-dropcast="' + esc(x.id) + '" title="Remove their seat from this chat">✖</button>' : '') +
      '</div>';
  }

  function dockCast(r, c, other) {
    var you = RP.playerCharacter(r);
    var away = Object.keys(r.states || {}).filter(function (id) {
      return id !== RP.PLAYER_ID && r.states[id] && r.states[id].present === false;
    });
    var here = RP.presentCast(r);
    var invented = r.cast.filter(function (x) { return x.invented; });
    return '<h4>You</h4>' +
      '<button class="seat you" id="dkPlayAs" title="' + (you ? 'Switch who you play, or hand them back' : 'Take a seat as somebody from the archive') + '">' +
      (you ? avatar(you, 28) + '<span class="nm">You play ' + esc(you.name) + '<small>the model never speaks for them</small></span>'
        : '<span class="nm">🎭 Play as somebody…<small>yourself for now — the cast talks to you</small></span>') +
      '<span class="chev">›</span></button>' +
      '<h4>In the scene (' + here.length + ')</h4>' +
      (here.length ? here.map(function (x) { return seatRow(r, x, { you: you && you.id === x.id, other: other }); }).join('')
        : '<p class="hint">Nobody is here — bring somebody in.</p>') +
      (away.length ? '<h4>Written out (' + away.length + ')</h4>' + away.map(function (id) {
        return seatRow(r, charOf(r, id), { away: true });
      }).join('') : '') +
      '<div class="btnrow">' +
      '<button class="mini primary" id="dkInvite">＋ Invite from the archive</button>' +
      '<button class="mini" id="dkInvent">✨ Invent someone</button>' +
      (r.mechanics === 'off' ? '' : '<button class="mini" id="dkSheets">' + (showStates ? '🩺 Hide the sheets' : '🩺 Party sheets') + '</button>') +
      (r.mechanics === 'off' ? '' : '<button class="mini" id="dkReview" title="One model call: it reads the recent play against every sheet' +
        (other ? ' in both scenes' : '') + ' and proposes corrections — wounds, kit, conditions, moods, the clock, who is still here. You see them before they land.">🧾 AI audit</button>') +
      '</div>' +
      '<p class="hint">' + (other
        ? 'Drag a face onto the other scene to send them there; drag a turn across to carry it over as a direction.'
        : 'Drag a face to the edge of the stage to start a second scene with them — the same hour, side by side.') + '</p>' +
      (invented.length
        ? '<div class="cp-desc invented"><b>Described, not drawn</b>' + invented.map(function (x) {
            return '<p><b>' + esc(x.name) + '</b>' + (x.title ? ' — ' + esc(x.title) : '') +
              (x.look ? '<br>' + esc(x.look) : '') + '</p>';
          }).join('') + '</div>'
        : '') +
      '<h4>About ' + esc(c.name || 'this chat') + '</h4>' +
      '<div class="cp-desc">' +
      (c.title ? '<b>' + esc(c.title) + '</b><br>' : '') +
      esc(c.status || c.summary || r.scene || 'A chat in the Waluipedia archive.') + '</div>';
  }

  function dockScene(r, other, style) {
    var progress = RP.beatProgress(r);
    var facts = Object.keys(r.facts || {}).length;
    var lengthName = (RP.LENGTHS[state.settings.length] || RP.LENGTHS[RP.DEFAULT_LENGTH]).name;
    return '<h4>Where and when</h4>' +
      '<div class="cp-desc" id="dkScene" title="Click to rewrite the scene">' + esc(RP.clip(r.scene || 'No scene text yet — click to write where this is happening.', 420)) + '</div>' +
      '<div class="cp-menu">' +
      menuItem('dkDate', '🕯', 'When', roomDate(r) || 'undated') +
      (r.clock ? menuItem('dkClock', '🕰', 'Clock', r.clock) : '') +
      menuItem('dkFacts', '📍', 'Fixed facts', facts ? String(facts) : 'none yet') +
      menuItem('cpScript', '⏱', 'Script', r.beats && r.beats.length
        ? (r.autoBeats ? 'Auto' : 'Manual') + ' · beat ' + progress.at + '/' + progress.total : 'None') +
      (progress.total && progress.at < progress.total ? menuItem('dkBeat', '⏩', 'Fire the next beat', '') : '') +
      '</div>' +
      '<h4>Second scene</h4>' +
      '<div class="link-card' + (other ? ' on' : '') + '">' +
      (other ? '<b>⇄ Linked to “' + esc(other.sceneName || other.title) + '”</b>' +
          (r.linkMode === 'blind' ? 'Blind — the scenes do not hear each other. ' : 'Each hears what the other just did. ') +
          'Drop a face across to send them over; drop a turn across to carry it.'
        : '<b>No second scene yet</b>Something happening elsewhere at the same time? Split this cast, invite others, or link a chat you already have.') +
      '<div class="btnrow"><button class="mini' + (other ? '' : ' primary') + '" id="dkLink">' +
      (other ? '⇄ Swap · carry over · unlink' : '⇄ Start a second scene') + '</button>' +
      (other ? '<button class="mini" id="dkOpenOther">Open it in front</button>' : '') + '</div>' +
      (other ? '<div class="merge-row">' +
        '<button class="mini primary wide" id="dkMerge" title="The opposite of ✂ Split: everybody in one place, both chats as one stream. ↩ undoes it.">⊕ Merge the two scenes into one</button>' +
        '<small>When everyone ends up in the same place. The 🎬 Director plays the joining; ↩ takes it back.</small></div>' : '') +
      (other ? '<div class="cp-menu">' +
        menuItem('dkLive', '🌗', 'The scene you are not in', !r.live || r.live === 'off' ? 'Stands still until you cross over'
          : r.live === 'every' ? 'Moves after every turn you take' : 'Moves every other turn you take') +
        (r.live && r.live !== 'off' ? menuItem('dkLiveSelf', '🧍', 'Your character over there', r.liveSelf ? 'May act alone while you are away' : 'Waits for you') : '') +
        '</div>' : '') + '</div>' +
      '<h4>How the scene runs</h4>' +
      '<div class="cp-menu">' +
      menuItem('cpFate', '🎲', 'Fate', (state.settings.fate || 'normal') === 'off' ? 'Off — you always succeed' : (state.settings.fate || 'normal')) +
      menuItem('dkHurt', '💥', 'Wounds', r.mechanics === 'off' ? 'No sheets' : (state.settings.hurt || 'on') === 'off' ? 'Only what the model files' : 'Filed from the prose too') +
      menuItem('dkLength', '✂', 'Reply length', lengthName) +
      menuItem('cpDirector', '🎬', 'Director', state.settings.director === 'off' ? 'Off' : 'On · max ' + (state.settings.maxChain || RP.MAX_CHAIN)) +
      menuItem('dkNarrator', RP.NARRATORS[RP.narrator(state)].icon, 'Narrator', (state.settings.world || 'on') === 'off' ? 'Off' : RP.NARRATORS[RP.narrator(state)].name) +
      menuItem('dkPrivacy', r.privacy === 'private' ? '🔒' : r.privacy === 'open' ? '🔓' : '👂', 'Who answers you',
        r.privacy === 'private' ? 'Nobody — alone' : r.privacy === 'open' ? 'Always' : 'Reads the room') +
      menuItem('dkAudience', '👥', 'The room answers', (RP.AUDIENCE[state.settings.audience || RP.AUDIENCE_DEFAULT] || RP.AUDIENCE.on).name) +
      menuItem('dkFresh', '\u267b', 'Fresh turns', (RP.FRESH[state.settings.fresh || RP.FRESH_DEFAULT] || RP.FRESH.strict).name) +
      menuItem('cpStyle', '✨', 'Style', style.name) +
      menuItem('cpCustomize', '🖌', 'Customize', style.name) +
      menuItem('cpNote', '📝', 'Special instructions', (r.note || state.settings.note) ? 'set' : 'none') +
      '</div>' +
      '<h4>Housekeeping</h4>' +
      '<div class="cp-menu">' +
      menuItem('dkAudit', '🧾', 'Audit', (auditFlags[r.id] || 0) ? auditFlags[r.id] + ' to look at' : 'all clear') +
      (r.mechanics === 'off' ? '' : menuItem('dkReview', '🩺', 'Quick audit', RP.linkedRoom(state, r) ? 'both scenes · last ' + RP.AUDIT_TURNS + ' turns' : 'last ' + RP.AUDIT_TURNS + ' turns')) +
      (r.mechanics === 'off' ? '' : menuItem('dkReviewFull', '🩻', 'Full audit', 'whole scene · maxima · what does not add up')) +
      menuItem('cpReplay', '🎭', 'Replay', 'Perspective') +
      menuItem('dkSequel', '📖', 'Write the sequel', '') +
      menuItem('cpNew', '✎', 'New chat', 'same cast') +
      menuItem('cpRename', '✏️', 'Rename chat', r.title) +
      menuItem('cpDelete', '🗑', 'Delete chat', '') +
      '</div>';
  }

  function dockMemory(r, c, mem, pinned) {
    var pages = ((state.book || {}).entries || []).filter(function (e) { return e.roomId === r.id; }).length;
    return '<h4>What the cast remembers</h4>' +
      '<div class="cp-menu">' +
      menuItem('cpMemory', '🧠', 'Memory', mem ? String(mem.notes.length) : '0') +
      menuItem('cpPinned', '📌', 'Pinned', String(pinned)) +
      menuItem('cpPersona', '🧑', 'Persona', r.persona || state.user.persona || (RP.personaSheet(state).name || 'Not set')) +
      menuItem('dkBook', '📓', 'Lore book', pages ? pages + ' from this chat' : 'open') +
      menuItem('cpHistory', '🕘', 'History', RP.roomCountFor(state.rooms, c.id) + '') +
      '</div>' +
      '<h4>Taste</h4>' +
      '<div class="cp-row"><div class="votes" title="Ratings steer later turns"><button id="cpUp">👍</button><span>' +
      RP.tasteFor(state, c.id).up + '</span><button id="cpDown">👎</button><span>' +
      RP.tasteFor(state, c.id).down + '</span></div><span class="hint">rate the last reply</span></div>' +
      '<div class="cp-menu">' +
      menuItem('cpTaste', '👍', 'What I like', RP.tasteState(state).likes.length + ' / ' + RP.tasteState(state).dislikes.length) +
      '</div>' +
      '<div class="cp-note">Memory is shared across chats: what is said here is remembered in the next room. Export from Labs.</div>';
  }

  function dockVoice(r) {
    return '<h4>Voices</h4>' +
      '<div class="cp-menu">' +
      menuItem('cpVoice', '🔊', 'Voice', (state.settings.voice === 'on' ? 'Auto · Qwen' : 'Qwen · on tap')) +
      menuItem('dkReadLast', '▶', 'Read the last reply', '') +
      menuItem('cpAudio', '💾', 'Chat as audio', 'one portable file') +
      (RP.linkedRoom(state, r) ? menuItem('dkAudioBoth', '⇄', 'Both scenes as audio', 'interleaved by the clock') : '') +
      menuItem('cpFix', '🛠', 'Fix chat', 'voices · cast · sheets') +
      '</div>' +
      '<p class="hint">Each line asks the studio for the speaker\u2019s own voice by name; a refused voice falls back to the default. ' +
      '🛠 drops the voice caches so a profile saved since the studio started is asked for again.</p>';
  }

  function dockShare(r, other) {
    return '<h4>Out of this page</h4>' +
      '<div class="cp-menu">' +
      menuItem('cpExport', '⬇', 'Export', other ? 'this scene · both scenes' : 'brief · transcript · bundle') +
      menuItem('cpCard', '📇', 'Character card', 'PNG · JSON') +
      menuItem('cpImport', '📥', 'Import into this chat', 'story · card') +
      '</div>' +
      '<h4>Settings</h4>' +
      '<div class="cp-menu">' +
      menuItem('cpSettings', '⚙', 'All settings', 'model · narrator · voice') +
      '</div>' +
      (other ? '<p class="hint">An export of both scenes interleaves the two chats by the clock, with a marker each time the camera moves.</p>' : '');
  }

  /** A row in the character panel. The value is shortened by CSS, not by
   *  cutting the string, so hovering still shows the whole thing and no
   *  word is ever left half-written. */
  function menuItem(id, ico, label, value) {
    return '<button id="' + id + '"><span class="ico">' + ico + '</span><span class="label">' + label + '</span>' +
      (value ? '<span class="value" title="' + esc(value) + '">' + esc(value) + '</span>' : '') +
      '<span class="chev">›</span></button>';
  }

  /** ＋ invite: the archive's own roster, minus whoever is already here —
   *  reached from the sheet bar and from the dock's Cast tab. */
  function invitePicker(r) {
    var have = {};
    (r.cast || []).forEach(function (c) { have[c.id] = 1; });
    // Everyone with a portrait, plus anyone invented in play before, and
    // a ＋ for somebody the archive has never filed.
    var invented = (state.newChars || []).filter(function (c) { return !have[c.id] && !castById[c.id]; });
    castPicker({
      title: 'Who joins the scene?', portraits: true, suggest: false, ok: 'Invite', exclude: have, extra: invented,
      note: 'Pick one or more. ＋ writes somebody new — give a name and ✨ fills in the rest.',
      create: function (seed) { inventForm(r, seed); },
    }, function (chosen) {
      RP.pushUndo(r, 'inviting ' + chosen.map(function (c) { return c.name; }).join(', '));
      chosen.forEach(function (picked) {
        var c = RP.normChar(picked);
        if (have[c.id]) return;
        r.cast.push(c);
        if (r.mechanics !== 'off' && !r.states[c.id]) {
          r.states[c.id] = RP.outfit(r, c, RP.blankSheet(c, r.statePreset));
        } else if (r.states[c.id]) r.states[c.id].present = true;
        r.away = (r.away || []).filter(function (a) { return a.id !== c.id; });
        r.messages.push({ id: RP.uid(), role: 'state', at: Date.now(),
          lines: ['🚪 ' + c.name + ' joins the scene — invited' + (c.invented ? '' : ' from the archive')] });
      });
      if (r.cast.length > 1) r.kind = 'group';
      RP.ensurePlayerSheet(state, r);
      r.updated = Date.now();
      save(); buildBoard(); render();
      toast(chosen.map(function (c) { return c.name; }).join(', ') + (chosen.length > 1 ? ' are' : ' is') + ' in the scene.');
    });
  }

  /* The scene tools: the audit, the fixed facts, the in-world date. They
   * are reached from the header, the Scene tab of the dock and the ⋯ menu,
   * so they live here rather than inside one wiring function. */
  function runAudit(r) {
    var report = RP.auditRoom(state, r, archive);
    openModal('<h3>🧾 Audit</h3>' +
      '<p class="sub">The scene is dated <b>' + esc(roomDate(r) || 'nothing yet') + '</b>. ' +
      'Everything below is something that does not add up.</p>' +
      (report.ok ? '<p class="sub">Nothing to report — the date matches the filing, everybody here has spoken ' +
        'recently, and no page is filed after this scene.</p>' : '') +
      (report.dates.length ? '<h4>The date</h4><div class="stack">' + report.dates.map(function (d) {
        return '<div class="item"><b>' + esc(d.what) + ' is ' + esc(d.is) + ', should be ' + esc(d.should) + '</b>' +
          '<p>' + esc(d.why) + '</p></div>';
      }).join('') + '</div>' : '') +
      (report.quiet.length ? '<h4>Not really here</h4><div class="stack">' + report.quiet.map(function (q) {
        return '<div class="item"><b>' + esc(q.name) + '</b><p>Has not spoken or been mentioned for ' +
          q.silence + ' turns. Writing them out stops them being staged.</p></div>';
      }).join('') + '</div>' : '') +
      (report.book.length ? '<h4>Filed in the future</h4><div class="stack">' + report.book.map(function (b) {
        return '<div class="item"><b>' + esc(b.name) + '</b><p>Dated ' + esc(b.when) + ', after this scene.</p></div>';
      }).join('') + '</div>' : '') +
      '<div class="actions"><button class="pill" id="mCancel">Close</button>' +
      (report.ok ? '' : '<button class="pill primary" id="mOk">Fix all of it</button>') + '</div>');
    $('mCancel').onclick = closeModal;
    if ($('mOk')) {
      $('mOk').onclick = function () {
        RP.pushUndo(r, 'the audit');
        var done = RP.applyAudit(state, r, report, {});
        closeModal(); save(); render();
        toast('🧾 ' + (done.join('; ') || 'nothing to do') + '.');
      };
    }
  }
  /** The AI audit, by hand: one model call reads the recent play of this
   *  scene (both scenes, when linked) against every sheet and proposes
   *  corrections — wounds, kit, conditions, moods, notes, the clock, who
   *  is really still in the room. Nothing lands until you say so, and ↩
   *  takes it all back. Never runs on its own. */
  var auditing = false;
  /** Do the portraits load? Each present character's image is tried
   *  once, quietly; a file that is gone is reported, a character who was
   *  invented in play but has a namesake in the archive is offered that
   *  portrait. Never blocks the audit for more than a moment. */
  function probePortraits(rooms) {
    var jobs = [];
    var seen = {};
    rooms.forEach(function (room) {
      RP.presentCast(room).forEach(function (c) {
        if (seen[c.id]) return;
        seen[c.id] = true;
        var url = imageUrl(c.image);
        if (!url) {
          // No portrait at all: a namesake in the archive may lend one.
          var twin = Object.keys(castById).map(function (id) { return castById[id]; }).filter(function (k) {
            return k && k.id !== c.id && k.image && String(k.name || '').toLowerCase() === String(c.name || '').toLowerCase();
          })[0];
          if (twin) jobs.push(Promise.resolve({ kind: 'adopt', roomId: room.id, charId: c.id, name: c.name, fromId: twin.id, path: twin.image }));
          return;
        }
        jobs.push(new Promise(function (resolve) {
          var done = false;
          var img = new Image();
          var finish = function (ok) {
            if (done) return;
            done = true;
            resolve(ok ? null : { kind: 'missing', roomId: room.id, charId: c.id, name: c.name, path: c.image });
          };
          img.onload = function () { finish(true); };
          img.onerror = function () { finish(false); };
          window.setTimeout(function () { finish(true); }, 2500);   // slow is not broken
          img.src = url;
        }));
      });
    });
    return Promise.all(jobs).then(function (found) { return found.filter(Boolean); });
  }

  function runSheetAudit(r, auditOpts) {
    auditOpts = auditOpts || {};
    var full = Boolean(auditOpts.full);
    var one = auditOpts.turn ? String(auditOpts.turn) : '';
    if (!r || r.mechanics === 'off') { toast('The sheets are off in this scene.'); return; }
    if (auditing) { toast('🩺 The audit is still reading.'); return; }
    var other = RP.linkedRoom(state, r);
    var rooms = other ? [r, other] : [r];
    var turns = {};
    rooms.forEach(function (room) {
      RP.ensurePlayerSheet(state, room);
      var playing = RP.playerCharacter(room);
      var seen = (room.messages || []).filter(RP.visible);
      if (one) {
        // One card under audit: it is marked, and the three turns before
        // it ride along as context. The other scene is not read.
        var at = seen.map(function (m) { return m.id; }).indexOf(one);
        seen = room.id === r.id && at >= 0 ? seen.slice(Math.max(0, at - 3), at + 1) : [];
      } else {
        seen = seen.slice(-(full ? RP.AUDIT_TURNS_FULL : RP.AUDIT_TURNS));
      }
      turns[room.id] = seen.map(function (m) {
        return {
          who: m.role === 'user' ? ((playing && playing.name) || RP.sheetFor(room, RP.playerSheetId(room)).name || 'The player')
            : m.role === 'world' ? RP.NARRATORS[RP.narrator(state)].name : charOf(room, m.charId).name,
          text: RP.textOf(m),
          mark: one && m.id === one ? true : undefined,
        };
      });
    });
    if (one && !turns[r.id].some(function (t) { return t.mark; })) { toast('That turn is not on the record any more.'); return; }
    auditing = true;
    toast(one ? '🩺 Reading that turn against the sheets…'
      : (full ? '🩻 Full audit \u2014 reading the whole of ' : '🩺 Reading ') + (other ? 'both scenes' : 'the scene') + ' against the sheets…');
    Promise.all([
      callModel(RP.sheetAuditPrompt(rooms, turns, { full: full, turn: Boolean(one) }), [{ role: 'user', content: one ? 'Audit this one turn.' : full ? 'Audit the whole scene.' : 'Audit the sheets.' }],
        { tokens: full ? 900 : 480, utility: true }),
      probePortraits(rooms).catch(function () { return []; }),
    ])
      .then(function (both) {
        auditing = false;
        var reply = String(both[0] || '').trim();
        var portraits = both[1] || [];
        // A dry run on copies: what WOULD change, shown before it does.
        var copies = rooms.map(function (room) { return JSON.parse(JSON.stringify(room)); });
        var stub = { log: [], book: { entries: [], queue: [] }, newChars: [], rooms: copies };
        var preview = RP.applySheetAudit(stub, copies, reply);
        var notes = RP.parseAuditNotes(reply, full ? 5 : 3);
        if (!preview.count && !portraits.length && !notes.length) {
          toast(/^IN ORDER/i.test(reply) ? '🧾 In order — the record matches the play.' : '🧾 The audit found nothing it could file.');
          return;
        }
        var KIND_ICON = { hp: '❤', mp: '\u26a1', item: '🎒', take: '🎒', drop: '🎒', give: '🎒', hold: '✋', stow: '🎒', spend: '\u26a1',
          cond: '🩹', status: '📝', counter: '🔢', mood: '🎭', time: '🕰', enter: '🚪', exit: '🚪' };
        var row = function (it, n) {
          return '<label class="item pick"><input type="checkbox" checked data-pick="' + n + '"> ' +
            '<span>' + (KIND_ICON[it.kind] || '•') + ' ' + esc(it.line) + '</span></label>';
        };
        var portraitRow = function (pr, n) {
          if (pr.kind === 'adopt') return '<label class="item pick"><input type="checkbox" checked data-portrait="' + n + '"> ' +
            '<span>🖼 ' + esc(pr.name) + ' has no portrait — use the archive\u2019s ' + esc(pr.name) + ' portrait</span></label>';
          return '<div class="item info"><span>🖼 ' + esc(pr.name) + '\u2019s portrait does not load (' + esc(RP.clip(pr.path, 60)) +
            ') — initials are shown in its place. Fix the file in the archive.</span></div>';
        };
        var itemsOf = function (roomId) { return preview.items.filter(function (it) { return it.roomId === roomId; }); };
        openModal('<h3>🩺 AI audit' + (one ? ' \u2014 one turn' : full ? ' \u2014 the whole scene' : '') + '</h3>' +
          '<p class="sub">The model read ' + (one ? 'that turn, with the three before it for context,' : full ? 'the whole scene' : 'the last ' + RP.AUDIT_TURNS + ' turns' + (other ? ' of both scenes' : '')) +
          ' against every sheet and decided what should stand. Untick anything you disagree with; nothing has changed yet.</p>' +
          rooms.map(function (room) {
            var items = itemsOf(room.id);
            if (!items.length) return '';
            return (other ? '<h4>' + esc(room.title || 'untitled') + '</h4>' : '') +
              '<div class="stack">' + items.map(function (it) { return row(it, preview.items.indexOf(it)); }).join('') + '</div>';
          }).join('') +
          (portraits.length ? '<h4>Portraits</h4><div class="stack">' + portraits.map(portraitRow).join('') + '</div>' : '') +
          (notes.length ? '<h4>Notes on the play</h4><p class="sub">What the audit thinks the last turns got wrong or could do better. ' +
            'Ticked notes are handed to the model once, for the next turn in “' + esc(r.sceneName || r.title) + '” — then they are dropped.</p><div class="stack">' +
            notes.map(function (note, n) {
              return '<label class="item pick"><input type="checkbox" checked data-note="' + n + '"> <span>📝 ' + esc(note) + '</span></label>';
            }).join('') + '</div>' : '') +
          '<div class="actions"><button class="pill" id="mCancel">Leave it</button>' +
          '<button class="pill primary" id="mOk"></button></div>');
        var countTicked = function () {
          var picks = Array.prototype.slice.call($('modal').querySelectorAll('[data-pick]:checked, [data-portrait]:checked'));
          var noted = $('modal').querySelectorAll('[data-note]:checked').length;
          var words = [];
          if (picks.length) words.push(picks.length + (picks.length === 1 ? ' change' : ' changes'));
          if (noted) words.push(noted + (noted === 1 ? ' note' : ' notes'));
          $('mOk').textContent = words.length ? 'Apply ' + words.join(' · ') : 'Apply nothing';
          $('mOk').disabled = !words.length;
          return picks;
        };
        countTicked();
        $('modal').querySelectorAll('[data-pick], [data-portrait], [data-note]').forEach(function (box) { box.onchange = countTicked; });
        $('mCancel').onclick = closeModal;
        $('mOk').onclick = function () {
          var picks = Array.prototype.slice.call($('modal').querySelectorAll('[data-pick]:checked')).map(function (box) {
            return preview.items[Number(box.getAttribute('data-pick'))].index;
          });
          var portraitPicks = Array.prototype.slice.call($('modal').querySelectorAll('[data-portrait]:checked')).map(function (box) {
            return portraits[Number(box.getAttribute('data-portrait'))];
          });
          var noted = Array.prototype.slice.call($('modal').querySelectorAll('[data-note]:checked')).map(function (box) {
            return notes[Number(box.getAttribute('data-note'))];
          });
          rooms.forEach(function (room) { RP.pushUndo(room, 'the AI audit'); });
          var done = picks.length ? RP.applySheetAudit(state, rooms, reply, { only: picks }) : { byRoom: {}, lines: [], items: [], count: 0 };
          // The notes ride along on the next turn of the scene that asked.
          r.auditNotes = noted;
          if (noted.length) {
            (done.byRoom[r.id] = done.byRoom[r.id] || []).push(noted.length + (noted.length === 1 ? ' note' : ' notes') + ' on the play, for the next turn');
          }
          portraitPicks.forEach(function (pr) {
            var room = rooms.filter(function (x) { return x.id === pr.roomId; })[0];
            var twin = castById[pr.fromId];
            if (!room || !twin) return;
            room.cast.forEach(function (c) { if (c.id === pr.charId) c.image = twin.image; });
            (done.byRoom[room.id] = done.byRoom[room.id] || []).push(pr.name + ' — wears the archive portrait');
            done.count++;
          });
          rooms.forEach(function (room) {
            var lines = done.byRoom[room.id] || [];
            if (!lines.length) return;
            room.messages.push({
              id: RP.uid(), role: 'state', at: Date.now(),
              lines: lines.map(function (l) { return '🩺 ' + l; }),
            });
            room.updated = Date.now();
          });
          closeModal(); save(); render();
          toast('🩺 ' + done.count + (done.count === 1 ? ' correction' : ' corrections') + ' filed' + (noted.length ? ', ' + noted.length + ' notes held for the next turn' : '') + ' — ↩ takes them back.');
        };
      })
      .catch(function (error) {
        auditing = false;
        if (error && error.stopped) return;
        toast('🩺 The audit could not reach the model: ' + RP.clip(String((error && error.message) || error), 120));
      });
  }

  function openFacts(r) {
    var facts = r.facts || {};
    var keys = Object.keys(facts);
    openModal('<h3>What is fixed in this scene</h3>' +
      '<p class="sub">Where you are, what you are wearing, what time it is. Once these are filed the narrator may ' +
      'not quietly change them — no renaming the outpost into a clinic halfway through.</p>' +
      (r.clock ? '<p class="sub">🕰 <b>' + esc(r.clock) + '</b></p>' : '') +
      (keys.length ? '<div class="stack">' + keys.map(function (k) {
        return '<div class="item"><b>' + esc(k.replace(/_/g, ' ')) + '</b><p>' + esc(facts[k]) + '</p>' +
          '<div class="acts"><button class="mini danger" data-factkill="' + esc(k) + '">Forget</button></div></div>';
      }).join('') + '</div>' : '<p class="sub">Nothing filed yet — the narrator files these as it names them.</p>') +
      '<div class="actions"><button class="pill" id="mCancel">Close</button>' +
      '<button class="pill primary" id="mOk">＋ Add one</button></div>');
    $('mCancel').onclick = closeModal;
    $('mOk').onclick = function () {
      closeModal();
      form('A fixed fact', [
        { k: 'name', label: 'What kind of fact (place, wearing, weather…)', value: 'place' },
        { k: 'value', label: 'What it is', value: '' },
      ], {}, function (v) {
        if (!v.value.trim()) return;
        r.facts = r.facts || {};
        r.facts[RP.slug(v.name) || 'fact'] = v.value.trim();
        r.updated = Date.now(); save(); render();
      });
    };
    $('modal').querySelectorAll('[data-factkill]').forEach(function (b) {
      b.onclick = function () { delete r.facts[b.dataset.factkill]; closeModal(); save(); render(); };
    });
  }
  function openDate(r) {
    form('When is this happening?', [
      { k: 'date', label: 'In-world date', value: roomDate(r) },
    ], {
      note: 'Regal Empire Standard Calendar — "5 Aethel, 1040 BF". Months run Firstlight, Chillwind, Veridia, Bloom, ' +
        'Floria, Efferd, Highsun, Harvestide, Aethel, Darkmoon, Frostfall, Deepwinter, and BF counts up. ' +
        'The model is told which filings are already history and which have not happened yet, measured from this date.',
    }, function (v) { r.date = v.date.trim(); r.updated = Date.now(); save(); render(); });
  }

  /** The controls one scene column answers to. `col` is '' for the front
   *  scene, 'b' for the linked one: the same handlers, bound to that
   *  column's ids and that column's room. */
  function wireChat(r, col) {
    var sfx = col ? '_' + col : '';
    var $c = function (id) { return $(id + sfx); };
    var box = col ? $('sidescene') : $('frontScene');
    var on = function (id, fn) { var node = $c(id); if (node) node.onclick = fn; };
    var auditFlag = auditFlags[r.id] || 0;
    on('stopBtn', function () { stopAll(); });
    on('swapBtn', function () { state.active = r.id; save(); render(); });
    on('privacyBtn', function () { togglePrivacy(r); });
    on('dateBtn', function () { openDate(r); });
    on('linkBtn', function () { secondSceneDialog(r); });
    on('sceneBtn', function () {
      list('This scene', [
        { label: '🧾 Audit — the date, the cast, the book' + (auditFlag ? ' (' + auditFlag + ' to look at)' : ' (all clear)'), value: 'audit' },
        { label: '📍 Fixed facts — place, clothing, time' + (Object.keys(r.facts || {}).length ? ' (' + Object.keys(r.facts).length + ')' : ''), value: 'facts' },
        { label: '🕯 When is this happening — ' + (roomDate(r) || 'undated'), value: 'date' },
        { label: '📓 The lore book', value: 'book' },
        { label: (RP.linkedRoom(state, r)
            ? '⇄ Linked to “' + (RP.linkedRoom(state, r).sceneName || RP.linkedRoom(state, r).title) + '” — carry over, swap, unlink'
            : '⇄ Link a second scene — two chats side by side, the same hour'), value: 'link' },
        { label: '📖 Write the sequel', value: 'sequel' },
      ], function (pick) {
        if (pick === 'link') { secondSceneDialog(r); return; }
        if (pick === 'audit') { runAudit(r); return; }
        if (pick === 'facts') { openFacts(r); return; }
        if (pick === 'date') { openDate(r); return; }
        if (pick === 'book') { tab = 'book'; state.active = ''; save(); render(); return; }
        openSequel(r);
      });
    });
    on('backBtn', function () { state.active = ''; save(); render(); });
    on('fateBtn', function () { openPanelFate(); });
    on('undoBtn', function () {
      var what = RP.undo(r);
      var back = RP.linkedRoom(state, r);
      if (back && back.mergedInto === r.id) {          // a merge taken back: the record is a scene again
        delete back.mergedInto;
        back.title = String(back.title || '').replace(/ \(merged into “[^”]*”\)$/, '');
        back.linkedTo = r.id;
        if (back.undo && back.undo.length && /being merged into/.test(back.undo[back.undo.length - 1].label || '')) RP.undo(back);
      }
      save(); render();
      toast(what ? 'Undid ' + what + '.' : 'Nothing to undo.');
    });
    on('redoBtn', function () {
      var what = RP.redo(r);
      save(); render();
      toast(what ? 'Redid ' + what + '.' : 'Nothing to redo.');
    });
    on('bookBtn', function () { tab = 'book'; state.active = ''; save(); render(); });
    on('qaContinue', function () {
      // ➤ with a 👥 Several pick: the whole group plays, no line needed.
      if (Array.isArray(r.pinnedNext)) {
        var order = pinnedOrder(r, r.pinnedNext);
        if (order.length) {
          r.pinnedNext = '';
          r.queue = order.slice(1); r.next = order[0];
          r.moment = order.length > 1 && r.pinnedSame ? { id: RP.uid(), ids: order.slice(), same: true, done: [] } : null;
          r.pinnedSame = false;
          save();
        }
      }
      generate({ room: r });
    });
    on('qaTogether', function () { togetherPicker(r); });
    on('qaBeat', function () { fireNextBeat(r); });
    $c('speakers').querySelectorAll('[data-macro]').forEach(function (b) {
      b.onclick = function () {
        var macro = userMacros().filter(function (m) { return m.id === b.dataset.macro; })[0];
        if (macro) runMacro(r, macro);
      };
    });
    on('qaMood', function () { pickMood(r); });
    on('qaAt', function () { var box = $c('input'); if (box) { wireMentions(box, r); box.mentionOpen(); } });
    on('qaUse', function () { useItem(r, sfx); });
    on('qaMeanwhile', function () { liveNow(r); });
    on('qaMerge', function () { mergeDialog(r); });
    on('mergeBtn', function () { mergeDialog(r); });
    on('macroAdd', function () {
      manageMacros(r);
    });
    on('qaSys', function () {
      state.settings.sysNotes = state.settings.sysNotes === 'hide' ? 'show' : 'hide';
      save(); render();
    });
    on('qaAuto', function () {
      if (autoLeft) { autoLeft = 0; render(); toast('Stopped.'); return; }
      autoLeft = Math.max(2, Number(state.settings.autoplay || 6));
      render();
      toast('Playing ' + autoLeft + ' turns on their own — press ■ to stop, or just type.');
      generate({ room: r });
    });
    on('qaAdd', function () {
      list('Bring somebody in', [
        { label: '🎭 From the archive — pick who walks in', value: 'cast' },
        { label: '✨ Invent one — a name, and the model fills in the rest', value: 'new' },
        { label: '📇 From a character card (.png / .json)', value: 'card' },
        { label: '🤖 Let the model choose and write them in', value: 'ai' },
      ], function (pick) {
        if (pick === 'card') { importCard(r); return; }
        if (pick === 'cast') {
          var here = {};
          (r.cast || []).forEach(function (c) { here[c.id] = 1; });
          castPicker({
            title: 'Who walks in?', portraits: true, suggest: false, ok: 'Bring them in', exclude: here,
            extra: (state.newChars || []).filter(function (c) { return !here[c.id] && !castById[c.id]; }),
            note: 'They join this scene now, with a state sheet of their own. ＋ writes somebody new.',
            create: function (seed) { inventForm(r, seed); },
          }, function (chosen) {
            chosen.forEach(function (c) { RP.addToRoom(r, c); });
            RP.logEvent(state, {
              kind: 'roster', roomId: r.id, roomTitle: r.title, when: roomDate(r),
              chars: chosen.map(function (c) { return c.id; }),
              text: chosen.map(function (c) { return c.name; }).join(', ') + ' joined the scene.',
            });
            save(); render();
            toast(chosen.map(function (c) { return c.name; }).join(', ') + ' is in the scene.');
          });
          return;
        }
        if (pick === 'new') { inventForm(r, ''); return; }
        // Let the model do it — as a direction, so it actually reaches the
        // prompt: a scene card on its own is for the reader, not the model.
        directRoom(r, 'Somebody new arrives. Bring them in on this turn — name them, describe them in a sentence, ' +
          'and give them a reason to be here — with the [[NEW: Name | why | look]] direction.', '', '');
      });
    });
    on('qaDirect', function () { directForm(r, '', ''); });
    on('qaLength', pickLength);
    on('qaRisk', function () {
      form('Attempt something', [{ k: 'text', label: 'What do you try?', type: 'area', value: '' }], {
        note: 'Written as an attempt, not an outcome — the page rolls, and the scene decides whether it works. ' +
          'Fate is set to ' + (state.settings.fate || 'normal') + '.',
        ok: 'Try it',
      }, function (v) {
        if (!v.text.trim()) return;
        $c('input').value = v.text.trim();
        $c('composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    });
    on('statesBtn', function () { showStates = !showStates; render(); });
    on('seqBtn', function () { openSequel(r); });
    var bar1 = $c('statebar');
    // Seats are drawn twice — the sheet cards in the statebar and the rows in
    // the dock's Cast tab — and both answer to the same attributes.
    wireSeats(box, r);
    on('castAdd', function () { invitePicker(r); });
    // Drag a card to the bench to write them out; drag a benched name
    // is not needed — the ↩ does it — but a card dropped back on the
    // main bar re-enters the scene.
    if (bar1) {
      bar1.querySelectorAll('[data-drag]').forEach(function (card) {
        card.ondragstart = function (ev) {
          ev.dataTransfer.setData('text/plain', card.dataset.drag);
          ev.dataTransfer.effectAllowed = 'move';
        };
      });
      var bench = $c('awayBench');
      if (bench) {
        bench.ondragover = function (ev) { ev.preventDefault(); bench.classList.add('over'); };
        bench.ondragleave = function () { bench.classList.remove('over'); };
        bench.ondrop = function (ev) {
          bench.classList.remove('over');
          if (dragging && dragging.roomId && dragging.roomId !== r.id) return;   // from the other scene: the column takes it (walk over)
          ev.preventDefault();
          var id = ev.dataTransfer.getData('text/plain');
          if (!id || !r.states[id] || r.states[id].present === false) return;
          RP.pushUndo(r, 'writing ' + r.states[id].name + ' out');
          RP.setPresent(r, id, false);
          save(); render();
          toast(charOf(r, id).name + ' is not here — they will not speak until they are.');
        };
      }
      bar1.ondragover = function (ev) { ev.preventDefault(); };
      bar1.ondrop = function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('.bench')) return;
        if (dragging && dragging.roomId && dragging.roomId !== r.id) return;
        var id = ev.dataTransfer && ev.dataTransfer.getData('text/plain');
        if (!id || !r.states[id] || r.states[id].present !== false) return;
        ev.preventDefault();
        RP.pushUndo(r, 'bringing ' + r.states[id].name + ' back');
        RP.setPresent(r, id, true);
        save(); render();
        toast(charOf(r, id).name + ' is in the scene again.');
      };
    }
    if (bar1) bar1.querySelectorAll('[data-item]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var parts = b.dataset.item.split('|');
        var sheet = RP.sheetFor(r, parts[0]);
        var item = RP.gridSlots(sheet, kitSize(r, parts[0]))[Number(parts[1])];
        if (!item) return;
        // Somebody to hand it to: anyone else with a sheet who is here.
        var others = Object.keys(r.states || {}).filter(function (id) {
          return id !== parts[0] && r.states[id] && r.states[id].present !== false;
        });
        list(item.icon + ' ' + item.name + (item.note ? ' — ' + item.note : ''), [
          { label: item.equipped ? '🫳 Put it away' : '✊ Take it in hand', value: 'hand' },
          { label: '🎲 Use it — writes the attempt and lets the roll decide', value: 'use' },
        ].concat(others.length ? [{ label: '🎁 Hand it to somebody', value: 'give' }] : [])
          .concat([{ label: '🗑 Drop it', value: 'drop' }]), function (pick) {
          RP.pushUndo(r, 'that change to the kit');
          if (pick === 'hand') {
            RP.applyChange(sheet, { kind: 'equip', name: item.name, op: item.equipped ? '-' : '+' });
            save(); render();
            return;
          }
          if (pick === 'drop') {
            RP.applyChange(sheet, { kind: 'item', op: '-', name: item.name });
            save(); render();
            return;
          }
          if (pick === 'give') {
            list('Who takes ' + item.name + '?', others.map(function (id) {
              return { label: r.states[id].name, value: id };
            }), function (to) {
              RP.applyChange(sheet, { kind: 'item', op: '-', name: item.name });
              RP.applyChange(r.states[to], { kind: 'item', op: '+', name: item.name, note: item.note, icon: item.icon });
              r.updated = Date.now();
              save(); render();
              toast(item.icon + ' ' + item.name + ' → ' + r.states[to].name + '. The model sees it on their sheet now.');
            });
            return;
          }
          $c('input').value = 'I use ' + item.name + (item.note ? ' — ' + item.note : '') + '.';
          $c('composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
      };
    });
    if (bar1) bar1.querySelectorAll('[data-additem]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var sheet = RP.sheetFor(r, b.dataset.additem);
        if (!sheet) return;
        form('Into the pack', [
          { k: 'name', label: 'What is it? An emoji up front picks its icon — "🗝 a brass key"', value: '' },
          { k: 'note', label: 'A note about it (optional)', value: '' },
        ], { note: 'It lands on the sheet, so the model knows it is there from the next turn on.' }, function (v) {
          var item = RP.normItem(v.name + (v.note.trim() ? ' | ' + v.note.trim() : ''));
          if (!item.name) { toast('It needs a name.'); return; }
          RP.pushUndo(r, 'that change to the kit');
          RP.applyChange(sheet, { kind: 'item', op: '+', name: item.name, note: item.note, icon: item.icon });
          r.updated = Date.now();
          save(); render();
          toast(item.icon + ' ' + item.name + ' — in the pack.');
        });
      };
    });
    on('panelBtn', function () { $('charpanel').classList.toggle('open'); });
    on('continueBtn', function () { generate({ room: r }); });
    on('nextBeat', function () { fireNextBeat(r); });

    $c('speakers').querySelectorAll('[data-speaker]').forEach(function (b) {
      b.onclick = function (e) {
        if (e.target && e.target.dataset && e.target.dataset.star) return;   // the star is its own control
        if (b.dataset.speaker === r.youPlay) { toast('You play them — ☆ to hand them back to the model.'); return; }
        // A pick on the rail is an order, not a hint. It used to be a hint:
        // the staging call after your next line chose again, and "Next: ◍
        // The Director" quietly became Wario answering for the fifth time.
        r.next = b.dataset.speaker; r.pinnedNext = b.dataset.speaker; r.pinnedSame = false; save(); render();
        toast(b.dataset.speaker === 'world'
          ? RP.NARRATORS[RP.narrator(state)].icon + ' ' + RP.NARRATORS[RP.narrator(state)].name + ' takes the next turn — write what you do, or ➤ Continue, and the scene itself answers.'
          : charOf(r, b.dataset.speaker).name + ' answers next — whatever you write, it is theirs to take.');
      };
    });
    on('qaPlayAs', function () {
      var playing = RP.playerCharacter(r);
      if (!playing) { playAsPicker(r); return; }
      var isDefault = (state.user && state.user.playAs) === playing.id;
      list('You play ' + playing.name, [
        { label: '🎭 Switch — play somebody else', value: 'switch' },
        { label: isDefault ? '☆ Stop being ' + playing.name + ' in new chats' : '★ Be ' + playing.name + ' in every new chat', value: 'default' },
        { label: '↩ Hand ' + playing.name + ' back to the model', value: 'back' },
      ], function (pick) {
        if (pick === 'switch') { playAsPicker(r); return; }
        if (pick === 'default') {
          state.user.playAs = isDefault ? '' : playing.id;
          save(); render();
          toast(isDefault ? 'New chats open as you again.' : 'Every new chat opens with you as ' + playing.name + '.');
          return;
        }
        RP.markPlayer(r, playing.id);
        save(); render();
        toast(playing.name + ' handed back to the model.');
      });
    });
    var stream = $c('stream');
    stream.querySelectorAll('[data-react]').forEach(function (b) {
      b.onclick = function () {
        var m = r.messages[+b.dataset.i];
        // A thumb is feedback the model gets to read, not a colour change.
        var now = RP.rate(state, r, m, b.dataset.react);
        save(); render();
        if (now === 'up') toast('👍 Noted — later turns will lean this way.');
        if (now === 'down') toast('👎 Noted — later turns will avoid that. ↻ for another take.');
      };
    });
    stream.querySelectorAll('[data-auditturn]').forEach(function (b) {
      b.onclick = function () { runSheetAudit(r, { turn: b.getAttribute('data-auditturn') }); };
    });
    stream.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var msg = RP.findMessage(r, b.dataset.edit);
        if (!msg) return;
        form('Edit this line', [{ k: 'text', label: 'What it should say', type: 'area', value: RP.textOf(msg) }], {
          note: 'Your edit replaces the line everywhere — on screen, in the model’s history, and in anything exported.',
        }, function (v) {
          if (!v.text.trim()) { toast('Empty — delete it instead if you want it gone.'); return; }
          RP.pushUndo(r, 'the edit');
          RP.editMessage(r, msg.id, v.text.trim());
          save(); render();
        });
      };
    });
    stream.querySelectorAll('[data-mute]').forEach(function (b) {
      b.onclick = function () {
        var msg = RP.muteMessage(r, b.dataset.mute);
        save(); render();
        toast(msg && msg.muted ? 'Muted — it stays on screen, out of the model’s head.' : 'Unmuted.');
      };
    });
    stream.querySelectorAll('[data-drop]').forEach(function (b) {
      b.onclick = function () {
        var msg = RP.findMessage(r, b.dataset.drop);
        if (!msg) return;
        confirmThen('Delete this line?', RP.clip(RP.textOf(msg), 160), function () {
          RP.pushUndo(r, 'that deletion');
          RP.deleteMessage(r, msg.id);
          save(); render();
        });
      };
    });
    stream.querySelectorAll('[data-fork]').forEach(function (b) {
      b.onclick = function () {
        var copy = RP.forkRoom(state, r, b.dataset.fork, {});
        state.active = copy.id;
        RP.logEvent(state, {
          kind: 'chat', roomId: copy.id, roomTitle: copy.title, when: roomDate(copy),
          chars: copy.cast.map(function (c) { return c.id; }),
          text: 'Branched from “' + RP.clip(r.title, 50) + '” at that line. The original is untouched.',
        });
        save(); render();
        toast('🌿 Branched — the original chat is still there, whole.');
      };
    });
    stream.querySelectorAll('[data-pin]').forEach(function (b) {
      b.onclick = function () {
        var m = r.messages[+b.dataset.pin];
        m.pinned = !m.pinned;
        if (m.pinned) RP.logEvent(state, { kind: 'pin', roomId: r.id, roomTitle: r.title, when: roomDate(r), chars: r.cast.map(function (c) { return c.id; }), text: RP.clip(RP.textOf(m), 200) });
        save(); render();
      };
    });
    stream.querySelectorAll('[data-remember]').forEach(function (b) {
      b.onclick = function () {
        var m = r.messages[+b.dataset.remember];
        RP.logEvent(state, { kind: 'note', roomId: r.id, roomTitle: r.title, when: roomDate(r), chars: r.cast.map(function (c) { return c.id; }), text: RP.clip(RP.textOf(m), 300) });
        save(); toast('Filed into the world log — every chat can see it now.');
      };
    });
    stream.querySelectorAll('[data-swipe]').forEach(function (b) {
      b.onclick = function () {
        var m = r.messages[+b.dataset.i];
        var next = (m.alt || 0) + (+b.dataset.swipe);
        m.alt = Math.max(0, Math.min(m.alts.length - 1, next));
        save(); render();
      };
    });
    stream.querySelectorAll('[data-fixturn]').forEach(function (b) {
      b.onclick = function () {
        var idx = +b.dataset.fixturn;
        var m = r.messages[idx];
        if (!m) return;
        var who = m.role === 'world' ? RP.NARRATORS[RP.narrator(state)].name : (charOf(r, m.charId) || {}).name;
        toast('↻ Asking ' + (who || 'them') + ' for a take without it.');
        generate({ room: r, retryIndex: idx, reheard: true, nudge: RP.fixNudge(RP.flagsOf(m), who) });
      };
      b.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.onclick(); }
      };
    });
    stream.querySelectorAll('[data-retry]').forEach(function (b) {
      b.onclick = function () { generate({ room: r, retryIndex: +b.dataset.retry }); };
    });
    stream.querySelectorAll('[data-speak]').forEach(function (b) {
      b.onclick = function () { speak(r.messages[+b.dataset.speak], r, { fresh: true }); };
    });
    stream.querySelectorAll('[data-mention]').forEach(function (link) {
      link.onclick = function (e) {
        e.preventDefault();
        mentionCard(r, { id: link.dataset.mention, kind: link.dataset.mkind, name: link.dataset.mname, roomId: link.dataset.mroom });
      };
    });
    if ($c('input')) wireMentions($c('input'), r);
    // The second scene's prompt. The front one's is wired once, in
    // wireShell; this column's shell is built when the link is, so its
    // handlers are bound here — same keys, same rules.
    if (col) {
      var input = $c('input');
      var go = function () {
        var text = input.value.trim();
        if (!text || busy) return;
        input.value = ''; input.style.height = 'auto';
        $c('send').disabled = true;
        sendText(r, text);
      };
      $c('composer').onsubmit = function (e) { e.preventDefault(); go(); };
      input.oninput = function () {
        $c('send').disabled = !input.value.trim();
        input.style.height = 'auto';
        input.style.height = Math.min(150, input.scrollHeight) + 'px';
      };
      input.onkeydown = function (e) {
        if (e.key !== 'Enter') return;
        var ctrl = e.ctrlKey || e.metaKey;
        if (enterSends() ? (!e.shiftKey || ctrl) : ctrl) { e.preventDefault(); go(); }
      };
    }
  }

  /** The seats — sheet cards in a column's statebar, rows in the dock's
   *  Cast tab — answer to the same attributes wherever they are drawn. */
  function wireSeats(container, r) {
    if (!container) return;
    container.querySelectorAll('[data-sheet]').forEach(function (b) {
      b.onclick = function (e) {
        if (e.target && e.target.dataset && e.target.dataset.here) return;
        editSheet(b.dataset.sheet, r);
      };
    });
    // The bench: bring somebody back, or remove their seat entirely.
    container.querySelectorAll('[data-back]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        RP.pushUndo(r, 'bringing ' + r.states[b.dataset.back].name + ' back');
        RP.setPresent(r, b.dataset.back, true);
        save(); render();
        toast(charOf(r, b.dataset.back).name + ' is in the scene again.');
      };
    });
    container.querySelectorAll('[data-dropcast]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var name = (r.states[b.dataset.dropcast] || {}).name || 'them';
        if (!window.confirm('Remove ' + name + ' from this chat? The archive keeps their record; only their seat here goes.')) return;
        RP.pushUndo(r, 'removing ' + name);
        RP.castRemove(r, b.dataset.dropcast);
        save(); buildBoard(); render();
        toast(name + ' removed from this chat.');
      };
    });
    container.querySelectorAll('[data-here]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        RP.pushUndo(r, 'that change to the cast');
        var here = RP.setPresent(r, b.dataset.here, undefined);
        save(); render();
        toast(here ? charOf(r, b.dataset.here).name + ' is in the scene.'
          : charOf(r, b.dataset.here).name + ' is not here — they will not speak until they are.');
      };
    });
    container.querySelectorAll('[data-star]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var now = RP.markPlayer(r, b.dataset.star);
        save(); render();
        toast(now ? 'You play ' + charOf(r, now).name + ' — the model will not speak for them, and the world narrates around you.'
          : 'Handed back to the model.');
      };
    });
  }

  /** Header and dock share these; both scenes do too. */
  function togglePrivacy(r) {
    r.privacy = r.privacy === 'private' ? 'open' : r.privacy === 'open' ? '' : 'private';
    save(); render();
    toast(r.privacy === 'private' ? '🔒 Private — nobody else will speak until you open it.'
      : r.privacy === 'open' ? '🔓 Open — the scene answers even when you are muttering.'
      : '👂 Reading the room — quiet turns are left alone.');
  }
  function pickLength() {
    var keys = Object.keys(RP.LENGTHS);
    list('How long should a reply be?', keys.map(function (k) {
      var cur = (state.settings.length || RP.DEFAULT_LENGTH) === k;
      return { label: (cur ? '● ' : '○ ') + RP.LENGTHS[k].name + ' — ' + RP.LENGTHS[k].words, value: k };
    }), function (pick) {
      state.settings.length = pick; save(); render();
      toast('✂ ' + RP.LENGTHS[pick].name + (pick === 'adaptive' ? ' — a retort stays short, a reveal gets its paragraphs.' : ' — ' + RP.LENGTHS[pick].words + '.'));
    });
  }
  function fireNextBeat(r) {
    r.beatsPaused = false;
    if (RP.fireBeat(r)) { logBeat(r); save(); render(); }
  }

  function wirePanel() {
    var r = dockRoom();
    var c = r.cast[0] || {};
    var on = function (id, fn) { var node = $(id); if (node) node.onclick = fn; };
    // The dock's tabs, and the rows that are the dock's own.
    $('charpanel').querySelectorAll('[data-dock]').forEach(function (b) {
      b.onclick = function () { dockTab = b.dataset.dock; render(); };
    });
    $('charpanel').querySelectorAll('[data-dockside]').forEach(function (b) {
      b.onclick = function () { dockSide = b.dataset.dockside; render(); };
    });
    wireSeats($('charpanel'), r);
    on('dkInvite', function () { invitePicker(r); });
    on('dkPlayAs', function () { playAsPicker(r); });
    $('charpanel').querySelectorAll('[data-walk]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var other = RP.linkedRoom(state, r);
        if (other) walkOver(r, other, b.dataset.walk);
      };
    });
    on('dkInvent', function () { inventForm(r, ''); });
    on('dkSheets', function () { showStates = !showStates; render(); });
    on('dkScene', function () {
      form('Where is this happening?', [{ k: 'scene', label: 'The scene, as the cast would see it', type: 'area', value: r.scene || '' }], {
        note: 'This is the opening of every prompt. Change it when the camera moves for good; for something happening elsewhere at the same time, start a second scene instead.',
      }, function (v) {
        RP.pushUndo(r, 'rewriting the scene');
        r.scene = v.scene.trim(); r.updated = Date.now(); save(); render();
      });
    });
    on('dkDate', function () { openDate(r); });
    on('dkClock', function () { openFacts(r); });
    on('dkFacts', function () { openFacts(r); });
    on('dkBeat', function () { fireNextBeat(r); });
    on('dkLink', function () { secondSceneDialog(r); });
    on('dkOpenOther', function () { var other = RP.linkedRoom(state, r); if (other) openRoom(other.id); });
    on('dkMerge', function () { mergeDialog(r); });
    on('dkLive', function () {
      var other = RP.linkedRoom(state, r);
      list('🌗 The scene you are not in', [
        { label: ((r.live || 'off') === 'off' ? '● ' : '○ ') + 'Stands still until you cross over — no extra calls', value: 'off' },
        { label: (r.live === 'other' ? '● ' : '○ ') + 'Moves every other turn you take — one unattended beat, queued after your turn', value: 'other' },
        { label: (r.live === 'every' ? '● ' : '○ ') + 'Moves after every turn you take — one unattended beat each time', value: 'every' },
      ], function (pick) {
        r.live = pick; if (other) other.live = pick;
        save(); render();
        toast(pick === 'off' ? '🌗 The other scene stands still while you are away.'
          : '🌗 The other scene moves on its own — ' + (pick === 'every' ? 'after each' : 'every other') + ' turn, one beat, never two prompts at once. Your turn always cuts it.');
      });
    });
    on('dkLiveSelf', function () {
      var other = RP.linkedRoom(state, r);
      r.liveSelf = !r.liveSelf; if (other) other.liveSelf = r.liveSelf;
      save(); render();
      toast(r.liveSelf ? '🧍 While you are away, the character you play in the other scene may act for themselves — small and reversible.'
        : '🧍 Your character in the other scene waits for you.');
    });
    on('dkLength', pickLength);
    on('dkNarrator', function () {
      var keys = Object.keys(RP.NARRATORS);
      list('Who narrates?', keys.map(function (k) {
        var cur = (state.settings.world || 'on') !== 'off' && RP.narrator(state) === k;
        return { label: (cur ? '● ' : '○ ') + RP.NARRATORS[k].icon + ' ' + RP.NARRATORS[k].name + ' — ' + RP.NARRATORS[k].blurb, value: k };
      }).concat([{ label: ((state.settings.world || 'on') === 'off' ? '● ' : '○ ') + '✕ No narrator — only the cast speaks', value: 'off' }]), function (pick) {
        if (pick === 'off') { state.settings.world = 'off'; }
        else { state.settings.world = 'on'; state.settings.narrator = pick; }
        save(); render();
        toast(pick === 'off' ? 'The narrator is off.' : RP.NARRATORS[pick].icon + ' ' + RP.NARRATORS[pick].name + ' narrates.');
      });
    });
    on('dkPrivacy', function () { togglePrivacy(r); });
    on('dkAudience', function () {
      var keys = Object.keys(RP.AUDIENCE);
      list('The room answers \u2014 what the people who are not speaking do', keys.map(function (k) {
        var cur = (state.settings.audience || RP.AUDIENCE_DEFAULT) === k;
        return { label: (cur ? '\u25cf ' : '\u25cb ') + RP.AUDIENCE[k].name + ' \u2014 ' + RP.AUDIENCE[k].blurb, value: k };
      }), function (pick) {
        state.settings.audience = pick; save(); render();
        toast(pick === 'off' ? 'The room is quiet \u2014 only the speaker answers.'
          : pick === 'full' ? 'Full replies \u2014 up to two of the room answer after the speaker, each on their own card.'
          : 'Murmurs \u2014 one short beat from the room after the speaker, on its own card.');
      });
    });
    on('dkFresh', function () {
      var keys = Object.keys(RP.FRESH);
      list('Fresh turns \u2014 what happens when a character repeats themselves', keys.map(function (k) {
        var cur = (state.settings.fresh || RP.FRESH_DEFAULT) === k;
        return { label: (cur ? '\u25cf ' : '\u25cb ') + RP.FRESH[k].name + ' \u2014 ' + RP.FRESH[k].blurb, value: k };
      }), function (pick) {
        state.settings.fresh = pick; save(); render();
        toast(pick === 'off' ? 'Fresh turns off.' : pick === 'strict' ? 'Strict \u2014 a turn that leans on old phrases is asked for again, once.'
          : 'Guide \u2014 the ledger of used phrases rides the prompt; the reply is kept as it comes.');
      });
    });
    on('dkHurt', function () {
      state.settings.hurt = (state.settings.hurt || 'on') === 'off' ? 'on' : 'off';
      save(); render();
      toast(state.settings.hurt === 'off' ? 'Wounds: only what the model files as [[HP:]] lands on the sheets.'
        : 'Wounds: a crash, a blade or a blast in the prose costs HP even when the model files nothing — no extra call.');
    });
    on('dkAudit', function () { runAudit(r); });
    on('dkReview', function () { runSheetAudit(r); });
    on('dkReviewFull', function () { runSheetAudit(r, { full: true }); });
    on('dkSequel', function () { openSequel(r); });
    on('dkBook', function () { tab = 'book'; state.active = ''; save(); render(); });
    on('dkReadLast', function () {
      var last = r.messages.slice().reverse().filter(function (m) { return (m.role === 'char' || m.role === 'world') && !m.error; })[0];
      if (!last) { toast('Nothing to read yet.'); return; }
      speak(last, r, { fresh: true });
    });
    on('cpNew', function () { r.kind === 'group' ? startGroup(r.cast, { scene: r.scene, sceneName: r.sceneName, beats: r.beats }) : startSolo(c); });
    on('cpAudio', function () { downloadChatAudio(r); });
    on('dkAudioBoth', function () { downloadChatAudio(r, { both: true }); });
    on('cpFix', function () {
      // The grandfather clause: an old chat gets today's rules. Cast
      // re-read from the archive, sheets mended, star rules re-run — and
      // the voice caches dropped so the studio is asked again RIGHT NOW
      // instead of whenever the last answer expires.
      var lines = RP.fixRoom(state, r, castById);
      voiceMisses = {}; voiceRetried = {};
      libCache = { at: 0, list: null };
      var cfg = ttsConfig();
      voiceLibrary(cfg).then(function (lib) {
        if (lib && lib.length) {
          lines.push('the studio offers: ' + lib.join(', '));
          var covered = function (nm) {
            var low = String(nm || '').toLowerCase(); var first = low.split(/\s+/)[0];
            return lib.some(function (v) { var vl = String(v).toLowerCase(); return vl === low || vl === first; });
          };
          var missing = r.cast.map(function (c) { return c.name; }).filter(function (nm) { return !covered(nm); });
          if (missing.length) {
            lines.push('the studio\u2019s boot list is missing ' + missing.join(', ') + ' \u2014 a profile saved while ' +
              'the studio runs will not show here until it restarts, so their lines will ask the studio by name ' +
              'anyway; only a refused voice falls back to ' + cfg.voice);
          }
        } else {
          lines.push('the voice studio could not be reached — voices will be asked again on the next ▶');
        }
      }).catch(function () {
        lines.push('the voice studio could not be reached — voices will be asked again on the next ▶');
      }).then(function () {
        if (!lines.length) lines.push('nothing needed fixing — this chat already matches the current systems');
        r.messages.push({ id: RP.uid(), role: 'state', at: Date.now(),
          lines: lines.map(function (l) { return '🛠 ' + l; }) });
        save(); render();
        toast('Chat brought up to date.');
      });
    });
    on('cpVoice', function () {
      var cfg = ttsConfig();
      form('Voice — the Qwen studio', [
        { k: 'mode', label: 'Read replies aloud on their own?', type: 'select',
          value: state.settings.voice === 'on' ? 'on' : 'off',
          options: [{ value: 'off', label: 'Only when I press ▶ on a message' },
                    { value: 'on', label: 'Every reply, as it lands' }] },
        { k: 'parts', label: 'How a turn is cut for the studio', type: 'select',
          value: state.settings.voiceParts || 'turn',
          options: [{ value: 'turn', label: 'By turn — the whole reply in the speaker’s voice, a few sentence-sized requests (fast)' },
                    { value: 'quotes', label: 'By quote — every quote in its speaker’s voice, narration in the narrator’s (one request per quote; slow on chatty lines)' }] },
        { k: 'fallback', label: 'Fallback voice — a saved profile in the studio; also reads narration', value: cfg.voice },
        { k: 'map', label: 'Voice map, for the exceptions — one per line: character = profile (e.g. sans = Freeman)', type: 'area', value: state.settings.ttsVoices || '' },
      ], { note: 'Every ▶ speaks through your local Qwen3-TTS studio — the same bridge as the site’s 🔊 Read aloud, using the endpoint and model from its ⚙️. A speaker is linked to a saved voice profile by first name on its own: when Wario talks, the studio’s “Wario” profile reads the line. No profile under that name? The fallback voice covers them until you save one in the Voice Studio. ■ Stop in the header (or Esc) cuts a reading or a render at any point.' }, function (v) {
        state.settings.voice = v.mode;
        state.settings.voiceParts = v.parts;
        state.settings.voiceDefault = v.fallback.trim();
        state.settings.ttsVoices = v.map;
        voiceMisses = {}; voiceRetried = {};
        libCache = { at: 0, list: null };
        save(); render();
        toast(v.mode === 'on' ? '🔊 Replies read themselves — each in their own voice.' : '🔊 Voices on tap — ▶ on any message.');
      });
    });
    on('cpHistory', function () {
      var mine = (state.rooms || []).filter(function (x) { return (x.cast || []).some(function (m) { return m.id === c.id; }); });
      list('History with ' + c.name, mine.map(function (x) {
        return { label: x.title + ' · ' + RP.counter(x) + ' turns · ' + new Date(x.updated).toLocaleDateString(), value: x.id };
      }), function (id) { openRoom(id); });
    });
    on('cpCustomize', function () {
      form('Customize this chat', [
        { k: 'title', label: 'Chat title', value: r.title },
        { k: 'sceneName', label: 'Scene name (the short name used in the ⇄ cards and the recents)', value: r.sceneName || '' },
        { k: 'scene', label: 'The scene', type: 'area', value: r.scene },
        { k: 'sceneImage', label: 'Scene picture (a path under the site, e.g. Reputation-Matrix2/images/…; blank for none)', value: r.sceneImage || '' },
        { k: 'style', label: 'Narration style', type: 'select', value: r.style, options: Object.keys(RP.STYLES).map(function (k) { return { value: k, label: RP.STYLES[k].name }; }) },
        { k: 'temperature', label: 'Temperature (0–1.5)', value: String(state.settings.temperature) },
      ], { note: 'How the page itself looks — theme, text, widths — is under ⚙ Settings → 🎨 Appearance.' }, function (v) {
        r.title = v.title || r.title; r.scene = v.scene; r.style = v.style;
        r.sceneName = (v.sceneName || '').trim(); r.sceneImage = (v.sceneImage || '').trim();
        var t = parseFloat(v.temperature); if (!isNaN(t)) state.settings.temperature = Math.max(0, Math.min(1.5, t));
        save(); render();
      });
    });
    on('cpPinned', function () {
      var pins = r.messages.filter(function (m) { return m.pinned; });
      list('Pinned in this chat', pins.map(function (m) { return { label: RP.clip(RP.textOf(m), 90), value: m.id }; }), function () {});
    });
    on('cpPersona', personaForm);
    on('cpStyle', function () {
      list('Narration style', Object.keys(RP.STYLES).map(function (k) { return { label: RP.STYLES[k].name + ' — ' + RP.clip(RP.STYLES[k].dir, 70), value: k }; }), function (k) {
        r.style = k; state.settings.style = k; save(); render();
      });
    });
    on('cpMemory', function () {
      var mem = RP.charMemory(state, c);
      var scene = RP.sceneDate(r, state);
      var rel = Object.keys(mem.relations || {}).map(function (k) {
        var x = mem.relations[k];
        return '<span class="tag">' + esc(x.name) + ' ' + (x.score > 0 ? '+' : '') + x.score + '</span>';
      }).join('');
      openModal('<h3>' + esc(c.name) + '’s memory</h3>' +
        '<p class="sub">Two clocks on every line: the in-world date it happened, and when you played it.' +
        (scene ? ' This scene is ' + esc(RP.formatWahDate(scene)) + '.' : '') + '</p>' +
        (mem.mood ? '<p class="sub">Mood: <b>' + esc(mem.mood) + '</b></p>' : '') +
        (rel ? '<div class="tags">' + rel + '</div>' : '') +
        (mem.knowledge && mem.knowledge.length
          ? '<h4>Taught facts</h4><div class="stack">' + mem.knowledge.map(function (k) {
              return '<div class="item"><b>' + esc(k) + '</b></div>';
            }).join('') + '</div>' : '') +
        '<h4>Said and heard</h4>' +
        (mem.notes.length ? '<div class="stack">' + mem.notes.slice().reverse().slice(0, 40).map(function (n) {
          var when = n.when && scene ? RP.timeRelation(scene, n.when) : null;
          return '<div class="item"><div class="when">' +
            (n.when ? '<b class="inworld">🕯 ' + esc(n.when) + '</b>' +
              (when && when.rel === 'future' ? ' <span class="tag">after this scene</span>' : '') + ' · ' : '') +
            esc(ago(n.at)) + (n.roomTitle ? ' · ' + esc(n.roomTitle) : '') + '</div>' +
            '<b>' + esc(n.text) + '</b>' +
            (n.roomId ? '<div class="acts"><button class="mini" data-gochat="' + esc(n.roomId) + '">Open that chat</button></div>' : '') +
            '</div>';
        }).join('') + '</div>' : '<p class="sub">Nothing remembered yet.</p>') +
        '<div class="actions"><button class="pill" id="mCancel">Close</button>' +
        '<button class="pill" id="mTeach">＋ Teach them something</button></div>');
      $('mCancel').onclick = closeModal;
      $('mTeach').onclick = function () {
        closeModal();
        form('Teach ' + c.name, [{ k: 'fact', label: 'They now know…', type: 'area', value: '' }], {
          note: 'Handed to them in every chat from now on, as established fact.',
        }, function (v) { if (v.fact.trim()) { RP.teach(state, c, v.fact.trim()); save(); render(); toast(c.name + ' knows that now.'); } });
      };
      $('modal').querySelectorAll('[data-gochat]').forEach(function (b) {
        b.onclick = function () {
          closeModal();
          if ((state.rooms || []).some(function (x) { return x.id === b.dataset.gochat; })) openRoom(b.dataset.gochat);
        };
      });
    });
    on('cpReplay', function () { replayPicker(r.id); });
    on('cpScript', function () {
      if (!r.beats || !r.beats.length) { toast('This chat has no filed script. Start one from a Scene card.'); return; }
      r.autoBeats = !r.autoBeats; save(); render();
      toast('Beats ' + (r.autoBeats ? 'advance on their own every two turns.' : 'only advance when you press ⏩.'));
    });
    on('cpDirector', function () {
      form('Director', [
        { k: 'director', label: 'After a reply, who speaks next?', type: 'select', value: state.settings.director,
          options: [{ value: 'on', label: 'The model decides — characters answer each other, then hand back to me' },
                    { value: 'off', label: 'Always me — one reply per turn' }] },
        { k: 'maxChain', label: 'Never more than this many character turns before it comes back to me', value: String(state.settings.maxChain || RP.MAX_CHAIN) },
      ], { note: 'In a group chat the model is asked one question after every reply: does a character have to answer, or is the scene waiting on you? It hands back on its own, and always at the ceiling.' }, function (v) {
        state.settings.director = v.director;
        var n = parseInt(v.maxChain, 10);
        state.settings.maxChain = isNaN(n) ? RP.MAX_CHAIN : Math.max(1, Math.min(12, n));
        save(); render();
      });
    });
    on('cpRename', function () {
      form('Rename chat', [{ k: 'title', label: 'Title', value: r.title }], {}, function (v) {
        if (v.title.trim()) { r.title = v.title.trim(); r.updated = Date.now(); save(); render(); }
      });
    });
    on('cpDelete', function () {
      var pair = RP.linkedRoom(state, r);
      confirmThen(pair ? 'Delete both scenes — “' + RP.clip(r.title, 30) + '” and “' + RP.clip(pair.title, 30) + '”?' : 'Delete “' + RP.clip(r.title, 40) + '”?',
        'The transcript goes; the memories and world-log lines it filed stay, because other chats depend on them.' +
        (pair ? ' To keep one of the two, ⨯ Unlink first (⇄ in the header).' : ''),
        function () {
          var gone = pair ? [r.id, pair.id] : [r.id];
          state.rooms = (state.rooms || []).filter(function (x) { return gone.indexOf(x.id) < 0; });
          state.active = '';
          dockSide = '';
          save(); buildBoard(); render();
          toast(pair ? 'Both scenes deleted. Their memories are still in the log.' : 'Chat deleted. Its memories are still in the log.');
        });
    });
    on('cpFate', openPanelFate);
    on('cpExport', function () { exportMenu(r, c); });
    on('cpImport', function () {
      list('Import into “' + RP.clip(r.sceneName || r.title, 36) + '”', [
        { label: '📥 A story — paste it, or open a .txt / .md / .json file', value: 'story' },
        { label: '📇 A character card — .png or .json, they walk in and say their greeting', value: 'card' },
        { label: '📓 File this chat into the lore book — smart read, about ' +
          RP.smartBacklog(r, { maxCalls: state.settings.smartCalls || 6 }).jobs.length + ' calls', value: 'catchup' },
      ], function (pick) {
        if (pick === 'story') { importTranscript({ into: r }); return; }
        if (pick === 'card') { importCard(r); return; }
        catchUpDialog(r);
      });
    });
    on('cpCard', function () {
      list('Export ' + c.name + ' as a character card', [
        { label: '📇 PNG card — the portrait with the card inside it (SillyTavern, Chub, Agnai)', value: 'png' },
        { label: '📄 JSON card — v2, with v1 fields alongside', value: 'json' },
      ], function (pick) { exportCard(c, pick === 'png'); });
    });
    on('cpSettings', settingsForm);
    // The panel's thumbs rate the last thing that was said, so you can steer
    // without scrolling back to the message.
    function rateLast(value) {
      var last = null;
      (r.messages || []).forEach(function (m) { if (m.role === 'char' && !m.error) last = m; });
      if (!last) { toast('Nothing said yet to rate.'); return; }
      var now = RP.rate(state, r, last, value);
      save(); render();
      toast(now === 'up' ? '👍 Noted — later turns will lean that way.'
        : now === 'down' ? '👎 Noted — later turns will avoid that.'
        : 'Rating cleared.');
    }
    on('cpUp', function () { rateLast('up'); });
    on('cpDown', function () { rateLast('down'); });
    on('cpNote', function () {
      form('Special instructions', [
        { k: 'note', label: 'For this chat', type: 'area', value: r.note || '' },
        { k: 'global', label: 'For every chat', type: 'area', value: state.settings.note || '' },
      ], {
        note: 'Sent with every turn, above everything else, and never spoken aloud: “keep this private”, “no new ' +
          'characters”, “short replies tonight”, “Luigi is lying about the tape”. You can also put instructions ' +
          'inline in a turn with ((double brackets)) or /ooc — they are stripped out of what your character says.',
      }, function (v) {
        r.note = v.note.trim();
        state.settings.note = v.global.trim();
        r.updated = Date.now(); save(); render();
        toast('Noted — the model gets that with every turn.');
      });
    });
    on('cpTaste', function () {
      var taste = RP.tasteState(state);
      openModal('<h3>What the model has been told you like</h3>' +
        '<p class="sub">Every 👍 and 👎 keeps an excerpt, and the excerpts go into the prompt: more like the ones ' +
        'you kept, less like the ones you threw away. Length is taken from them too.</p>' +
        (taste.likes.length ? '<h4>Kept</h4><div class="stack">' + taste.likes.slice().reverse().map(function (x) {
          return '<div class="item"><b>' + esc((castById[x.charId] || { name: 'Someone' }).name) + '</b><p>' + esc(x.text) + '</p>' +
            '<div class="acts"><button class="mini" data-tasteoff="' + esc(x.id) + '">Forget this</button></div></div>';
        }).join('') + '</div>' : '') +
        (taste.dislikes.length ? '<h4>Thrown away</h4><div class="stack">' + taste.dislikes.slice().reverse().map(function (x) {
          return '<div class="item"><b>' + esc((castById[x.charId] || { name: 'Someone' }).name) + '</b><p>' + esc(x.text) + '</p>' +
            '<div class="acts"><button class="mini" data-tasteoff="' + esc(x.id) + '">Forget this</button></div></div>';
        }).join('') + '</div>' : '') +
        (!taste.likes.length && !taste.dislikes.length ? '<p class="sub">Nothing rated yet.</p>' : '') +
        '<div class="actions"><button class="pill" id="mCancel">Close</button>' +
        '<button class="pill danger" id="mClear">Forget all of it</button></div>');
      $('mCancel').onclick = closeModal;
      $('mClear').onclick = function () {
        state.taste = { likes: [], dislikes: [], chars: {} };
        closeModal(); save(); render(); toast('Forgotten.');
      };
      $('modal').querySelectorAll('[data-tasteoff]').forEach(function (b) {
        b.onclick = function () {
          var id = b.dataset.tasteoff;
          taste.likes = taste.likes.filter(function (x) { return x.id !== id; });
          taste.dislikes = taste.dislikes.filter(function (x) { return x.id !== id; });
          closeModal(); save(); render();
        };
      });
    });
  }

  /* ---------------------------------------------------------------- *
   * playing a turn
   * ---------------------------------------------------------------- */

  function logBeat(r) {
    var beat = r.beats[r.beatIndex - 1];
    if (!beat) return;
    RP.logEvent(state, {
      kind: 'beat', roomId: r.id, roomTitle: r.title, when: roomDate(r), chars: r.cast.map(function (c) { return c.id; }),
      text: (r.sceneName ? r.sceneName + ' — ' : '') + (beat.time ? beat.time + ': ' : '') + beat.beat,
    });
  }

  /** 🎬 — the reader as director. What you type is not said by anyone: it
   *  is filed on the room, rides in the protected tail of the next prompt
   *  as a thing that happens, and is spent by that turn. `who` is who
   *  plays it landing: 'world' for the narration, or a cast id. */
  function directRoom(r, text, who, from) {
    var d = RP.setDirection(r, text, from);
    if (!d) return;
    r.messages.push({ id: RP.uid(), role: 'scene', direction: true, from: from || '', at: Date.now(), text: d.text });
    r.queue = []; r.moment = null; r.handback = ''; r.pinnedNext = ''; r.pinnedSame = false;
    var speakable = RP.speakableCast(r);
    var cast = speakable.some(function (c) { return c.id === who; });
    var worldOk = (state.settings.world || 'on') !== 'off';
    r.next = cast ? who : (worldOk ? 'world' : (speakable[0] || {}).id || '');
    r.updated = Date.now();
    autoLeft = 0;
    save(); render();
    generate({ room: r, world: r.next === 'world' });
  }

  function directForm(r, preset, from) {
    var narrator = RP.NARRATORS[RP.narrator(state)];
    var who = [{ value: 'world', label: narrator.icon + ' ' + narrator.name + ' — narrates it landing' }]
      .concat(RP.speakableCast(r).map(function (c) { return { value: c.id, label: c.name + ' — reacts to it, in character' }; }));
    form('🎬 Direct the scene', [
      { k: 'text', label: 'What happens next? Write it as a fact, not a request — “the ceiling gives way”, “a siren starts up across the street”, “Wario finds the ledger is blank”', type: 'area', value: preset || '' },
      { k: 'who', label: 'Who plays it', type: 'select', value: 'world', options: who },
    ], {
      note: 'Nobody says this — it goes to the model as a thing that happens, this turn, and the cast deals with it in ' +
        'character. For a nudge rather than an event, ((double brackets)) inside your own turn do the quieter version.' +
        (from ? ' Carried over from “' + from + '”.' : ''),
      ok: '🎬 Action',
    }, function (v) {
      if (!v.text.trim()) return;
      directRoom(r, v.text.trim(), v.who, from || '');
    });
  }

  function send() {
    var input = $('input');
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    input.style.height = 'auto';
    sendText(room(), text);
  }

  /** One turn of yours into a room — the front one, or the linked scene at
   *  the side. Everything that used to live in send(): the ((notes)), the
   *  thin-air check, the time-jump pause, the staging, the reply. */
  function sendText(r, text) {
    if (!r || !text) return;
    if (busy && ambientNow) {
      // An unattended beat is in flight: your turn wins. Cut it, and send
      // when the cut has landed.
      stopAll(true);
      var tries = 0;
      (function again() {
        if (!busy) { sendText(r, text); return; }
        if (++tries < 40) window.setTimeout(again, 50);
      })();
      return;
    }
    if (busy) return;
    // ((Anything in double brackets)) is spoken to the model, not by you.
    var spoken = RP.parseOoc(text);
    // @Name points at exactly who you mean — here, written out, in the
    // other scene, in the lore book or in the archive. The @ comes out;
    // the pointer stays on the turn and briefs the model.
    var pinged = RP.parseMentions(spoken.clean || text, mentionCandidates(r, spoken.clean || text));
    var msg = {
      id: RP.uid(), role: 'user', text: pinged.clean || spoken.clean || text, at: Date.now(),
      ooc: spoken.notes.length ? spoken.notes : undefined,
      mentions: pinged.mentions.length ? pinged.mentions : undefined,
    };
    pingElsewhere(r, pinged.mentions, msg.text);
    r.lastNotes = spoken.notes;
    autoLeft = 0;                       // your turn beats the autopilot
    RP.pushUndo(r, 'your turn');
    // The thin-air check, before anything is sent: pulling out a thing you
    // HAVE takes it in hand; pulling out a bazooka you do not have turns
    // the dice against the bluff and briefs the model, once.
    if (r.mechanics !== 'off') {
      RP.ensurePlayerSheet(state, r);
      var claimed = RP.conjureCheck(r, msg.text);
      if (claimed && claimed.kind === 'have') {
        if (!claimed.item.equipped) RP.applyChange(claimed.sheet, { kind: 'equip', name: claimed.item.name, op: '+' });
        msg.changes = [claimed.item.icon + ' ' + claimed.item.name + ' — on your sheet, in hand'];
      }
      if (claimed && claimed.kind === 'conjured') {
        r.conjured = claimed.claim;
        msg.changes = ['🚫 “' + claimed.claim + '” is not on your sheet — the world will answer'];
      }
      // Brought round: a slap, salts, a stim, a heal on somebody at 0 HP
      // moves their sheet NOW, so the reply is written to a man at 5/100
      // and not to a number nobody updated. And your own sprint costs
      // breath.
      RP.reviveScan(msg.text, r).forEach(function (hit) {
        var line = RP.revive(RP.sheetFor(r, hit.id), hit.how);
        if (line) msg.changes = (msg.changes || []).concat([line]);
      });
      var mine = RP.sheetFor(r, RP.playerSheetId(r));
      var effort = mine ? RP.exertScan(msg.text, mine) : null;
      if (effort && mine.mp.value > 0) {
        var spentLine = RP.applyChange(mine, { kind: 'mp', op: '-', value: effort.amount });
        if (spentLine) msg.changes = (msg.changes || []).concat(['\u26a1 ' + spentLine + ' \u2014 ' + effort.cause]);
      }
    }
    // A jump in time means the filed script no longer lines up with the
    // scene. Pause it rather than firing "beat 3" into a different night.
    if (!r.beatsPaused && RP.isTimeJump(text) && (r.beats || []).length && RP.beatProgress(r).remaining) {
      r.beatsPaused = true;
      toast('⏩ The script is paused — you moved the scene on. Press ⏩ in the header to fire the next beat by hand.');
    }
    r.queue = [];
    r.moment = null;
    r.handback = '';
    if (r.mechanics !== 'off') msg.mood = moodOn(r, RP.playerSheetId(r));
    r.messages.push(msg);
    RP.rememberTurn(state, r, msg);
    r.updated = Date.now();
    save(); render();
    // An explicit pick on the rail — "◍ The Director", "Wario" — beats the
    // staging call, once: you asked for them, you get them.
    var pinned = r.pinnedNext || '';
    r.pinnedNext = '';
    // 👥 Several: a list of faces is the order itself — and, when asked
    // for, the same moment: every turn in it is written as happening in
    // the same seconds as yours.
    var several = Array.isArray(pinned) ? pinnedOrder(r, pinned) : [];
    var sameMoment = several.length > 1 && r.pinnedSame;
    r.pinnedSame = false;
    var pinnedOk = several.length ? true : pinned === 'world'
      ? (state.settings.world || 'on') !== 'off'
      : RP.speakableCast(r).some(function (c) { return c.id === pinned; });
    // Otherwise stage the beat first: who answers, in what order. Then play them.
    busy = true; busyRoom = r.id; render();
    var epoch = stopEpoch;
    (pinnedOk ? Promise.resolve(several.length ? several : [pinned]) : stageBeat(r)).then(function (order) {
      busy = false; busyRoom = null;
      if (epoch !== stopEpoch) { save(); render(); return; }   // ■ while the beat was being staged
      if (!order.length) {
        // Nobody had to answer — so the world picks it up and describes
        // what you just did. A scene should never simply stop.
        var fallback = RP.fallbackTurn(state, r);
        if (!fallback) {
          r.handback = 'nobody had to answer that.';
          save(); render();
          return;
        }
        order = [fallback];
      }
      r.queue = order.slice(1);
      r.next = order[0];
      if (sameMoment) r.moment = { id: RP.uid(), ids: order.slice(), same: true, done: [] };
      save();
      generate({ room: r });
    });
  }

  /** The faces a 👥 Several pick still allows: present, speakable, not
   *  the character you play; the narrator when narration is on. */
  function pinnedOrder(r, ids) {
    var ok = {};
    RP.speakableCast(r).forEach(function (c) { ok[c.id] = true; });
    if ((state.settings.world || 'on') !== 'off') ok.world = true;
    var seen = {};
    return (ids || []).filter(function (id) {
      if (!ok[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  /** 👥 Several… — tick the people who act on your next turn, and say
   *  whether they take it in turn or in the same moment. */
  function togetherPicker(r) {
    var faces = RP.speakableCast(r);
    if (!faces.length) { toast('Nobody here can take the turn.'); return; }
    var picked = Array.isArray(r.pinnedNext) ? r.pinnedNext : (r.pinnedNext ? [r.pinnedNext] : []);
    var worldOk = (state.settings.world || 'on') !== 'off';
    var mode = r.togetherMode || 'same';          // the last way you asked for it; the same moment by default
    var rowFor = function (id, name, face) {
      return '<label class="item pick"><input type="checkbox" data-together="' + esc(id) + '"' + (picked.indexOf(id) >= 0 ? ' checked' : '') + '> ' +
        face + '<span>' + esc(name) + '</span></label>';
    };
    openModal('<h3>👥 Several people, one turn</h3>' +
      '<p class="sub">Tick who acts when you next write (or press ➤ Continue). Each gets their own card, in this order.</p>' +
      '<div class="setup">' +
      faces.map(function (c) { return rowFor(c.id, c.name, avatar(c, 24)); }).join('') +
      (worldOk ? rowFor('world', RP.NARRATORS[RP.narrator(state)].icon + ' ' + RP.NARRATORS[RP.narrator(state)].name + ' \u2014 the narration', '') : '') +
      '</div>' +
      '<label class="radio"><input type="radio" name="tgMode" value="same"' + (mode !== 'turns' ? ' checked' : '') + '> ' +
      '\u23f1 <b>The same moment</b> \u2014 all of it happens in the same seconds as your line: one runs while another shoots. ' +
      'Each is told the others have not finished, and writes what they are doing DURING it.</label>' +
      '<label class="radio"><input type="radio" name="tgMode" value="turns"' + (mode === 'turns' ? ' checked' : '') + '> ' +
      '\u2193 <b>One after another</b> \u2014 each answers what came before, in the order ticked.</label>' +
      '<div class="actions"><button class="pill" id="mCancel">Cancel</button>' +
      '<button class="pill" id="mClear">Nobody \u2014 let the Director stage it</button>' +
      '<button class="pill primary" id="mOk">Set</button></div>');
    $('mCancel').onclick = closeModal;
    $('mClear').onclick = function () { r.pinnedNext = ''; r.pinnedSame = false; closeModal(); save(); render(); toast('The Director stages the next beat.'); };
    $('mOk').onclick = function () {
      var ids = [];
      $('modal').querySelectorAll('[data-together]').forEach(function (box) { if (box.checked) ids.push(box.dataset.together); });
      var same = ($('modal').querySelector('input[name="tgMode"]:checked') || {}).value !== 'turns';
      closeModal();
      if (!ids.length) { r.pinnedNext = ''; r.pinnedSame = false; save(); render(); return; }
      r.pinnedNext = ids.length === 1 ? ids[0] : ids;
      r.pinnedSame = ids.length > 1 && same;
      r.togetherMode = same ? 'same' : 'turns';
      r.next = ids[0];
      save(); render();
      var names = ids.map(function (id) { return id === 'world' ? RP.NARRATORS[RP.narrator(state)].name : charOf(r, id).name; });
      toast(ids.length === 1 ? names[0] + ' answers next.'
        : (same ? '\u23f1 ' : '') + names.join(', ') + (same ? ' act in the same moment' : ' answer in that order') + ' \u2014 write your line, or ➤ Continue.');
    };
  }

  /** After a group reply, the model decides what happens next: another
   *  character answers, or the scene comes back to the player. Without this a
   *  multi-bot room is just a loop of bots talking to each other; with it the
   *  chain also has a hard ceiling (settings.maxChain) so it always returns. */
  /** After the player writes, the scene is staged: the model says who
   *  reacts and in what order, the page plays them, and then it stops.
   *  One planning call buys several turns of reply. */
  function stageBeat(r) {
    if (state.settings.director === 'off') return Promise.resolve([]);
    // A private moment gets narration at most — nobody walks in on it.
    var lastText = RP.textOf((r.messages || []).filter(function (m) { return m.role === 'user'; }).pop() || {});
    if (RP.isPrivate(r, lastText)) {
      return Promise.resolve((state.settings.world || 'on') === 'off' ? [] : ['world']);
    }
    if (RP.chainLength(r) >= (state.settings.maxChain || RP.MAX_CHAIN)) return Promise.resolve([]);
    if (RP.worldShouldSpeak(state, r)) return Promise.resolve(['world']);
    if (!RP.speakableCast(r).length) return Promise.resolve([]);
    function rotation() {
      var next = RP.nextSpeaker({ kind: 'group', cast: RP.speakableCast(r), messages: r.messages, next: r.next });
      return next ? [next.id] : [];
    }
    if (leanAI()) return Promise.resolve(rotation());
    // No decision to make, no call to make: one person who can answer, or
    // a line that names who it is for.
    var speakable = RP.speakableCast(r);
    if (speakable.length === 1) return Promise.resolve([speakable[0].id]);
    var named = RP.addressedIn(r, lastText);
    if (named.length) return Promise.resolve(named);
    return callModel(RP.sequencePrompt(r, state, {}), [{ role: 'user', content: 'Who answers this?' }], { tokens: 60, utility: true })
      .then(function (text) {
        var staged = RP.parseSequence(text, r, state);
        // A model that rambled instead of answering has not decided that
        // nobody speaks — somebody still answers.
        if (!staged.order.length && !staged.silent) return rotation();
        return staged.order;
      })
      .catch(rotation);
  }

  /** The one-at-a-time question, still used when a chain is already running
   *  and we only need to know whether it keeps going. */
  function direct(r, speaker) {
    if (RP.worldShouldSpeak(state, r) && RP.chainLength(r) < (state.settings.maxChain || RP.MAX_CHAIN)) {
      r.next = 'world';
      return Promise.resolve(Boolean(autoLeft));
    }
    if (r.kind !== 'group' || RP.speakableCast(r).length < 2 || state.settings.director === 'off') return Promise.resolve(false);
    r.maxChain = state.settings.maxChain || RP.MAX_CHAIN;
    if (RP.chainLength(r) >= r.maxChain) {
      r.handback = 'the scene has run ' + RP.chainLength(r) + ' turns without you.';
      r.next = '';
      return Promise.resolve(false);
    }
    // One candidate is not a decision — skip the model call entirely.
    var others = RP.speakableCast(r).filter(function (c) { return c.id !== speaker.id; });
    if (others.length === 1) {
      r.handback = ''; r.next = others[0].id;
      return Promise.resolve(Boolean(autoLeft));
    }
    if (leanAI()) {
      var turn = RP.rotationAfter(others.length ? others : RP.speakableCast(r), speaker.id);
      r.handback = ''; r.next = turn ? turn.id : '';
      return Promise.resolve(Boolean(autoLeft) && Boolean(turn));
    }
    var lastMsg = (r.messages || []).slice().reverse().filter(function (m) {
      return m.role === 'char' || m.role === 'world' || m.role === 'user';
    })[0];
    var lastWasWorld = lastMsg && lastMsg.role === 'world';
    return callModel(RP.directorPrompt(r, speaker), [{ role: 'user', content: 'Who speaks next?' }], { tokens: 40, utility: true })
      .then(function (text) { return RP.parseDirector(text, r, speaker); })
      .catch(function () { return { next: 'user', reason: 'the director could not be reached' }; })
      .then(function (decision) {
        // The world never follows the world: two Director turns in a row
        // is a hundred seconds of prefill for a scene that was already
        // set. The turn comes back to the player instead.
        if (decision.next === 'world' && lastWasWorld) {
          decision = { next: 'user', reason: 'the scene is set' };
        }
        if (decision.next === 'world' && (state.settings.world || 'on') !== 'off') {
          r.handback = ''; r.next = 'world';
          return true;
        }
        if (decision.next === 'user') {
          r.handback = decision.reason + '.';
          r.next = '';
          return false;
        }
        r.handback = '';
        r.next = decision.next;
        return true;
      });
  }

  /** One reply. `retryIndex` regenerates an existing turn as a new swipe. */
  function generate(opts) {
    opts = opts || {};
    var r = opts.room || room();
    if (!r || busy || !r.cast.length) return;
    busy = true; busyRoom = r.id;
    // 🌗 An unattended turn in the other scene: one call, no chain, no
    // fate roll (nobody attempted anything), and your own turn cuts it.
    var ambient = Boolean(opts.ambient);
    ambientNow = ambient;
    r.handback = '';
    r.pinnedNext = '';                  // a rail pick is spent by the turn it chose
    render();

    // A snapshot before the turn, so ↩ takes back the reply *and* whatever
    // it did to the sheets.
    if (opts.retryIndex === undefined && !opts.searched && !opts.reheard) RP.pushUndo(r, 'that turn');
    var epoch = stopEpoch;
    var retry = opts.retryIndex !== undefined ? r.messages[opts.retryIndex] : null;
    // Who is up: a character, or the world itself when there is nobody else
    // in the room (or the director asked for it).
    var worldTurn = retry ? retry.role === 'world'
      : (opts.world || r.next === 'world' || RP.worldShouldSpeak(state, r));
    // Unattended, with "my character there acts alone" on: the character
    // the reader plays joins the rotation for this one beat.
    var playing = RP.playerCharacter(r);
    var livePool = ambient && r.liveSelf && playing ? RP.speakableCast(r).concat([playing]) : null;
    var speaker = retry ? (retry.role === 'world' ? RP.WORLD : charOf(r, retry.charId))
      : worldTurn ? RP.WORLD
      : livePool ? RP.nextSpeaker({ kind: 'group', cast: livePool, messages: r.messages, next: '' })
      : (RP.speakableCast(r).filter(function (c) { return c.id === r.next; })[0] || RP.nextSpeaker({
          kind: r.kind, cast: RP.speakableCast(r).length ? RP.speakableCast(r) : r.cast,
          messages: r.messages, next: r.next,
        }));
    var ambientSelf = Boolean(ambient && playing && speaker && speaker.id === playing.id);
    // Did the player just try something? Then it is not up to them whether it
    // worked. The roll happens here and is handed to the model as an order.
    var answering = !retry && !ambient && RP.visible(lastVisible(r)) && lastVisible(r).role === 'user';
    // The reader's own sheet, before the roll and the prompt: the attempt's
    // wording picks the stat that leans on the dice, and a thin-air claim
    // (r.conjured, set on send) turns them against the bluff.
    if (r.mechanics !== 'off') RP.ensurePlayerSheet(state, r);
    var lastUser = (r.messages || []).filter(function (m) {
      return m.role === 'user' && !m.muted;
    }).pop() || {};
    var lastSaid = RP.textOf(lastUser);
    var fate = answering ? RP.rollFate(state, r, { text: lastSaid, conjured: r.conjured || '' }) : null;
    // A thin-air claim is settled HERE, by that roll: the thing lands on
    // the sheet (in hand) or the hand comes up empty, and the model is
    // told which. It used to be left to the model, which said "you pull
    // out the bazooka" and filed nothing.
    var verdict = r.conjured ? RP.resolveConjure(r, r.conjured, fate) : null;
    // What the cast may cite: whatever the recent turns are actually about,
    // filtered to filings whose dates have already passed in this scene.
    var recent = RP.historyFor(r, 4).map(function (m) { return m.content; }).join(' ');
    var found = RP.citableFor(archiveIndex, r, state, { query: recent + ' ' + (r.scene || ''), limit: 6 });
    var dug = searchForTurn(r, speaker, recent);
    if (opts.searched) recent = recent + ' ' + opts.searched;
    var opts2 = {
      fate: fate, archive: archive, recent: recent, notes: r.lastNotes || [],
      mentionText: lastSaid,
      mentions: (lastUser && lastUser.mentions) || [],
      catalog: castById,
      conjured: r.conjured || '',
      conjureVerdict: verdict,
      ambient: ambient, ambientSelf: ambientSelf,
      budget: Number(state.settings.promptBudget) || 0,
      citations: [opts.searched || '', RP.citationBlock(found), dug.length ? RP.retrievalBlock(dug) : '']
        .filter(Boolean).join('\n\n'),
    };
    // ⏱ The same moment: this turn is one of a group written as
    // simultaneous. Who is already on the page, who is still to come.
    var moment = (!retry && !ambient && r.moment && r.moment.same && speaker && r.moment.ids.indexOf(speaker.id) >= 0) ? r.moment : null;
    if (moment) {
      var nameOf = function (id) { return id === 'world' ? RP.NARRATORS[RP.narrator(state)].name : (charOf(r, id) || {}).name || ''; };
      opts2.moment = {
        same: true,
        done: moment.done.map(nameOf).filter(Boolean),
        pending: (r.queue || []).filter(function (id) { return moment.ids.indexOf(id) >= 0; }).map(nameOf).filter(Boolean),
      };
    }
    var pep = RP.encourage(r);
    // A 🎬 direction rides in this prompt and is spent by the turn that
    // lands; a turn that fails or is asked again still has it.
    var directed = r.direction || null;
    // ⚡ The cache layout (Settings → cacheLayout, on unless turned off):
    // the system message holds still for the scene and the turn's own
    // notes ride after the history, so the model server keeps the work it
    // already did. The narrator keeps the classic single-prompt shape.
    var cacheSplit = !worldTurn && (state.settings.cacheLayout || 'on') !== 'off'
      ? RP.systemFor(state, r, speaker, Object.assign({}, opts2, { split: true })) : null;
    var system = cacheSplit ? cacheSplit.system
      : (worldTurn ? RP.worldSystem(state, r, opts2) : RP.systemFor(state, r, speaker, opts2)) +
        (opts.nudge ? '\n\n' + opts.nudge : '') + (pep ? '\n\n' + pep : '');
    // The thin-air brief fires once: the turn that answers the claim has
    // seen it, and the scene moves on.
    r.conjured = '';
    // NOT `window`: a local of that name shadows the global one for the
    // whole function, and every window.setTimeout in here stops working.
    var lookBack = RP.contextLimit(r, (state.settings && state.settings.context) || 24);
    // Turn count first, then the character budget: a long chat should cost
    // turns, not paragraphs, and one monologue must not evict ten turns.
    var historySource = retry ? { kind: r.kind, cast: r.cast, recapAt: r.recapAt, messages: r.messages.slice(0, opts.retryIndex) } : r;
    var history = cacheSplit
      ? RP.packHistoryStepped(RP.historyFor(historySource), Number(state.settings.historyChars) || RP.HISTORY_BUDGET, { maxTurns: lookBack })
      : RP.packHistory(RP.historyFor(historySource, lookBack), Number(state.settings.historyChars) || RP.HISTORY_BUDGET);
    if (!history.length) history = [{ role: 'user', content: '(The scene opens. Begin in character.)' }];
    // ➤ Continue sends no line of the reader's: without this the history
    // ends on a character's turn and the model is asked to extend it.
    history = RP.chatShape(history, worldTurn ? '' : speaker.name);
    // A downed reader's line goes out marked as what it is. Only the copy
    // sent to the model changes; the chat on screen keeps what was typed.
    var downed = ambientSelf ? null : RP.playerDown(r);
    if (downed && history.length && history[history.length - 1].role === 'user') {
      var tail = history[history.length - 1];
      history[history.length - 1] = { role: 'user', content: '(' + (downed.name || 'I') + ', DOWN at 0 HP, barely conscious:) ' + tail.content };
    }
    if (cacheSplit) history = RP.withNotes(history, cacheSplit, [opts.nudge || '', pep || '']);

    /** Ask for a reply, and if the model runs out of room mid-sentence,
     *  ask it to carry on from exactly where it stopped. Two goes at most,
     *  and whatever is left is trimmed back to a full stop rather than
     *  shown as a dangling fragment. */
    function complete(sys, msgs, tries) {
      return callModel(sys, msgs, { tokens: tokensFor(worldTurn) }).then(function (text) {
        var cleaned = RP.stripSpeaker(text, speaker.name).trim();
        if (!RP.looksTruncated(cleaned) || (tries || 0) >= 3) return cleaned;
        return callModel(sys, msgs.concat([
          { role: 'assistant', content: cleaned },
          { role: 'user', content: RP.continueNudge(cleaned) },
        ]), { tokens: tokensFor(worldTurn) })
          .then(function (rest) {
            return RP.stitch(cleaned, RP.stripSpeaker(rest, speaker.name).trim());
          })
          .catch(function () { return cleaned; })
          .then(function (joined) {
            if (!RP.looksTruncated(joined) || (tries || 0) >= 2) return joined;
            // Still hanging: ask once more, for the ending only.
            return callModel(sys, msgs.concat([
              { role: 'assistant', content: joined },
              { role: 'user', content: RP.continueNudge(joined) + ' One or two sentences at most.' },
            ]), { tokens: 200 })
              .then(function (rest) { return RP.stitch(joined, RP.stripSpeaker(rest, speaker.name).trim()); })
              .catch(function () { return joined; });
          });
      });
    }

    var spoken = null;                  // the card that is read aloud
    complete(system, history, 0).then(function (text) {
      // Stage directions first: the model may have wounded somebody, spent
      // power, walked a character in, or written one out. They are stripped
      // from the prose and applied to the record before anything renders.
      var dnames = r.cast.map(function (c) { return c.name; });
      var youSheet = RP.sheetFor(r, RP.playerSheetId(r));
      if (youSheet) dnames.push(youSheet.name, 'the player');
      var staged = RP.parseDirectives(text, dnames);
      r.next = '';

      // [[LOOKUP: …]] — it asked the archive a question rather than making
      // something up. Answer it, file the answer, and let it write the turn
      // again with the passage in hand. One extra call, once per turn.
      var asked = staged.directives.filter(function (d) { return d.kind === 'lookup'; })[0];
      // A model asking the archive about ITS OWN SCENE - "current location
      // and attire" - would buy a full-price second call for facts already
      // in its prompt. That lookup is dropped on the floor.
      if (asked && /\b(current|right now|this scene|attire|wearing|location|where am|the sheets?|my (own )?(pack|items|sheet))\b/i.test(asked.query)) asked = null;
      if (asked && !retry && !opts.searched) {
        // The lore book answers first — it is what this campaign has
        // established in play; the archive fills whatever is left.
        var fromBook = RP.searchBook(state, asked.query, 2);
        var results = fromBook.concat(RP.searchArchive(archiveIndex, asked.query, { limit: 3 })).slice(0, 4);
        results.filter(function (hit) { return !hit.book; }).forEach(function (hit) {
          RP.bookAdd(state, {
            kind: 'fact', name: hit.name + ' — ' + RP.clip(asked.query, 40), text: hit.snippet,
            when: roomDate(r), roomId: r.id, roomTitle: r.title,
          });
        });
        r.messages.push({
          id: RP.uid(), role: 'state', at: Date.now(),
          lines: ['🔎 looked up “' + RP.clip(asked.query, 60) + '” — ' +
            (results.length ? results.length + ' passage' + (results.length === 1 ? '' : 's') + ' filed'
              : 'nothing on file')],
        });
        busy = false; save(); render();
        window.setTimeout(function () {
          generate({ room: r, searched: RP.retrievalBlock(results, asked.query) });
        }, 200);
        return false;
      }
      // Last resort: if it still trails off, cut back to a full stop rather
      // than showing the reader half a sentence.
      var clean = RP.trimDangling(staged.clean.trim());
      // The room's own beats — "Mona: *a glance* …" at the end of the
      // reply — are cut out here and filed under Mona below, as her own
      // card. A beat written for the character the reader plays is cut
      // and dropped: the model may not write them.
      var playerNames = [(RP.playerCharacter(r) || {}).name || '', state.user.name || '', RP.personaSheet(state).name || ''];
      // Who a “Name:” paragraph may belong to: the people in the scene,
      // the people who left it, the people made this session, and the
      // archive — somebody who is not in the room and speaks up has
      // walked in, and is filed as such below. The narration is named
      // too, so “Narrator:” comes back as a world card, not as a
      // character called Narrator.
      var narratorName = (RP.NARRATORS[RP.narrator(state)] || RP.WORLD).name;
      var chorusNames = (r.cast || []).concat(r.away || []).concat(state.newChars || []).concat(cast || [])
        .map(function (c) { return c && c.name; })
        .filter(function (n) { return n && (!speaker || n !== speaker.name) && playerNames.indexOf(n) < 0; });
      var chorus = (!retry && r.kind === 'group')
        ? RP.splitChorus(clean, worldTurn ? narratorName : speaker.name, chorusNames, playerNames, { narrator: narratorName })
        : { main: clean, pieces: [], dropped: [], unknown: [] };
      clean = chorus.main;
      // A take that gets sent back (it wrote the player) must not leave its
      // wounds and filings behind — the sheets are put back as they were.
      var sheetsBefore = JSON.stringify(r.states || {}), castBefore = JSON.stringify(r.cast || []);
      var turnNow = r.messages.length;     // the turn the moods are fed on
      // A [[MOOD:]] with no name is the speaker's own.
      staged.directives.forEach(function (d) {
        if (d.kind === 'mood' && !d.who && speaker && !worldTurn) d.who = speaker.name;
      });
      var changes = r.mechanics === 'off' ? { lines: [] }
        : RP.applyDirectives(state, r, staged.directives, resolveChar);
      var moodFiled = function (id) {
        var sheet = RP.sheetFor(r, id);
        return Boolean(sheet && sheet.mood && sheet.mood.at === turnNow);
      };
      if (verdict && verdict.line) changes.lines.unshift(verdict.line);
      // The prose handed the player something and no [[ITEM:]] landed?
      // Filed on the spot, no model call — the first upkeep net.
      if (r.mechanics !== 'off') {
        var pack = RP.sheetFor(r, RP.playerSheetId(r));
        if (pack) {
          RP.grantScan(clean).forEach(function (name) {
            var have = (pack.items || []).some(function (i) {
              var it = RP.normItem(i).name.toLowerCase();
              return it.indexOf(name.toLowerCase()) >= 0 || name.toLowerCase().indexOf(it) >= 0;
            });
            if (have) return;
            var line = RP.applyChange(pack, { kind: 'item', op: '+', name: name });
            if (line) changes.lines.push('🎒 ' + line + ' — filed from the prose');
          });
        }
      }
      // The hurt ledger: a crash, a blade, a blast in the prose lands on
      // the sheets whether or not the model filed it — another free net,
      // no model call. The model's own [[HP:]] for a person wins.
      if (r.mechanics !== 'off' && state.settings.hurt !== 'off') {
        RP.hurtScan(clean, r, {
          speaker: worldTurn ? null : speaker,
          world: worldTurn,
          filed: staged.directives.filter(function (d) { return d.kind === 'hp'; }).map(function (d) { return d.who; }),
          level: state.settings.fate || 'normal',
          braced: RP.bracedIn(lastSaid),
        }).forEach(function (h) {
          var sheet = RP.sheetFor(r, h.id);
          var line = sheet && RP.applyChange(sheet, { kind: 'hp', op: '-', value: h.amount });
          if (!line) return;
          changes.lines.push('💥 ' + line + ' — ' + h.cause + ', filed from the prose');
          if (h.tier === 'grave' && !(sheet.flags || {}).battered) {
            RP.applyChange(sheet, { kind: 'flag', name: 'battered', turns: 2, note: 'from ' + h.cause });
          }
          // A grave hurt shakes anyone it lands on — a flicker of fear,
          // unless the model said how they took it. The reader's own
          // feeling stays theirs.
          if (h.tier === 'grave' && !sheet.player && !moodFiled(h.id)) {
            var shaken = RP.applyChange(sheet, { kind: 'mood', key: 'fear', level: 1, note: h.cause, turn: turnNow });
            if (shaken) changes.lines.push(shaken);
          }
        });
      }
      // ⚡ Energy: a sprint or a spell the model did not file costs breath
      // anyway; everyone who did not spend gets a little back. ⛑ A slap,
      // salts or a stim in the prose brings somebody at 0 HP round to a
      // sliver — the number moves, so the next turn is written to it.
      var spentIds = [];
      if (r.mechanics !== 'off') {
        staged.directives.forEach(function (d) {
          if (d.kind !== 'mp' || d.op !== '-') return;
          r.cast.forEach(function (c) { if (c.name === d.who) spentIds.push(c.id); });
        });
        if (!worldTurn && speaker && speaker.id !== RP.PLAYER_ID && spentIds.indexOf(speaker.id) < 0) {
          var enSheet = RP.sheetFor(r, speaker.id);
          var effort = enSheet ? RP.exertScan(clean, enSheet) : null;
          if (effort && enSheet.mp.value > 0) {
            var enLine = RP.applyChange(enSheet, { kind: 'mp', op: '-', value: effort.amount });
            if (enLine) { changes.lines.push('\u26a1 ' + enLine + ' \u2014 ' + effort.cause + ', filed from the prose'); spentIds.push(speaker.id); }
          }
        }
        RP.reviveScan(clean + '\n' + chorus.pieces.map(function (pc) { return pc.text; }).join('\n'), r).forEach(function (hit) {
          var line = RP.revive(RP.sheetFor(r, hit.id), hit.how);
          if (line) changes.lines.push(line + ', filed from the prose');
        });
        RP.fixDown(r).forEach(function (line) { changes.lines.push('\u26d1 ' + line); });
      }
      // Beyond them: a godly or hopeless attempt moves the people who saw
      // it — a flicker of surprise on every witness the model did not
      // file, and a flicker of shame on the one who tried, when it went
      // the way the dice said. The prompt orders the reaction; this makes
      // sure the record keeps it.
      if (r.mechanics !== 'off' && fate && fate.scale && !retry) {
        var tried = RP.sheetFor(r, RP.playerSheetId(r));
        RP.presentCast(r).forEach(function (c) {
          if (c.id === r.youPlay || moodFiled(c.id)) return;
          var seen = RP.applyChange(RP.sheetFor(r, c.id), { kind: 'mood', key: 'surprise', level: 1, note: 'the ' + fate.scale + ' attempt', turn: turnNow });
          if (seen) changes.lines.push(seen + ' — saw it');
        });
        if (tried && !moodFiled(tried.id) && (fate.key === 'setback' || fate.key === 'refusal' || fate.key === 'wrench')) {
          var felt = RP.applyChange(tried, { kind: 'mood', key: 'shame', level: 1, note: 'the ' + fate.scale + ' attempt', turn: turnNow });
          if (felt) changes.lines.push(felt + ' — it did not work');
        }
      }
      // The mood: the colour of the box is how the speaker feels. When
      // the model filed no [[MOOD:]] for them, the prose is read for it —
      // free, local, one step at a time, so a feeling builds instead of
      // swinging — and the feeling then rides on the card.
      if (r.mechanics !== 'off' && !worldTurn && speaker && speaker.id !== RP.PLAYER_ID && speaker.id !== r.youPlay) {
        var moodSheet = RP.sheetFor(r, speaker.id);
        if (moodSheet && !moodFiled(speaker.id)) {
          var felt = RP.moodScan(clean, speaker.name, r.cast.map(function (c) { return c.name; }));
          if (felt) {
            var moodLine = RP.applyChange(moodSheet, { kind: 'mood', key: felt.key, level: 1, note: felt.note, turn: turnNow });
            if (moodLine) changes.lines.push(moodLine + ' — read from the prose');
          }
        }
      }
      // The doorman: a never-seen name who arrives or speaks in the prose
      // gets filed as an ENTER (a full sheet, kit and all) even when the
      // model forgot the directive; an unambiguous walk-out is an EXIT.
      if (r.mechanics !== 'off') {
        var doorNames = r.cast.map(function (c) { return c.name; })
          .concat((r.away || []).map(function (c) { return c.name; }))
          .concat([(RP.playerCharacter(r) || {}).name || '', state.user.name || '', RP.personaSheet(state).name || '']);
        var came = r.cast.length < 12 ? RP.arrivalScan(clean, doorNames) : '';
        if (came) {
          var din = RP.parseDirectives('[[ENTER: ' + came + ' — walked in from the prose]]',
            r.cast.map(function (c) { return c.name; }));
          RP.applyDirectives(state, r, din.directives, resolveChar).lines.forEach(function (l) {
            changes.lines.push('🚪 ' + l);
          });
        }
        var mayLeave = r.cast.filter(function (c) {
          return c.id !== RP.PLAYER_ID && c.id !== r.youPlay && c.name !== came;
        }).map(function (c) { return c.name; });
        var went = RP.departureScan(clean, mayLeave);
        if (went) {
          var dout = RP.parseDirectives('[[EXIT: ' + went + ' — walked out in the prose]]',
            r.cast.map(function (c) { return c.name; }));
          RP.applyDirectives(state, r, dout.directives, resolveChar).lines.forEach(function (l) {
            changes.lines.push('🚪 ' + l);
          });
        }
      }
      if (retry) {
        retry.alts = (retry.alts && retry.alts.length ? retry.alts : [retry.text]).concat([clean]);
        retry.alt = retry.alts.length - 1;
        // The chips belong to the take, not the card: take 2 used to wear
        // take 1's warnings, and nothing checked take 2 at all.
        if (!retry.flags) retry.flags = [{ repeats: retry.repeats, antiRepeat: retry.antiRepeat, generic: retry.generic }];
        retry.flags[retry.alt] = worldTurn ? {} : RP.turnFlags(r, opts.retryIndex, clean, retry.charId, flagModes());
      } else {
        // Whose line is this, really? A small model handed six people will
        // write whoever spoke last — and sometimes the player themselves.
        var check = worldTurn || ambientSelf ? { ok: true }
          : RP.checkSpeaker(clean, speaker, RP.presentCast(r), { youPlay: r.youPlay });
        if (check.playerVoice && !opts.reheard) {
          // Writing the player's character is not a mislabel to file away;
          // it is taken back and asked for again, once.
          r.states = JSON.parse(sheetsBefore); r.cast = JSON.parse(castBefore);
          r.next = speaker.id;
          busy = false; save(); render();
          toast('It wrote your character — asking again.');
          window.setTimeout(function () {
            generate({ room: r, reheard: true, nudge: 'Your last attempt wrote ' + check.actual.name +
              ', who is the PLAYER\u2019s character. Never write their words, thoughts or actions. Write ' +
              speaker.name + '\u2019s turn instead, and begin with ' + speaker.name + '.' });
          }, 150);
          return false;
        }
        // ⛑ A speaker at 0 HP written leaping and roaring: the body
        // outranks the prose. Sent back once, with the body spelled out.
        var downSheet = r.mechanics !== 'off' && !worldTurn && !ambientSelf && speaker.id !== RP.PLAYER_ID ? RP.sheetFor(r, speaker.id) : null;
        var vigour = downSheet ? RP.vigourCheck(clean, downSheet) : null;
        if (vigour && !opts.reheard) {
          r.states = JSON.parse(sheetsBefore); r.cast = JSON.parse(castBefore);
          r.next = speaker.id;
          busy = false; save(); render();
          toast('⛑ ' + speaker.name + ' is down at 0 HP — asking again, inside that body.');
          window.setTimeout(function () {
            generate({ room: r, reheard: true, nudge: speaker.name + ' is DOWN at 0 HP \u2014 barely conscious. Your last attempt had them \u201c' +
              vigour.what + '\u201d, which that body cannot do. Write the turn again inside it: a word, a crawl, a hand that will not close,' +
              ' an effort that fails before it is finished \u2014 nothing more. If somebody brings them round, say how, and still they are' +
              ' barely there.' });
          }, 150);
          return false;
        }
        // ✂ The assistant's sign-off ("What would you like to do next?")
        // is cut on the spot: no character says it, and a retake is a
        // whole generation on a local model.
        if ((state.settings.antiGeneric || RP.ANTI_GENERIC_DEFAULT) !== 'off' && !worldTurn && speaker.id !== RP.PLAYER_ID) {
          var scrubbed = RP.scrubSlop(clean);
          if (scrubbed.cut.length) clean = scrubbed.text;
        }

        // Clean intra-message sentence loops / stutters
        var loops = RP.findRepetitionLoops(clean);
        if (loops.hasLoop) {
          clean = RP.cleanRepetitionLoops(clean);
        }

        // ♻ A take stitched out of the character's own earlier turns is
        // sent back once (strict), with the phrases named.
        var freshMode = state.settings.fresh || RP.FRESH_DEFAULT;
        var repeats = null;
        if (freshMode !== 'off' && !worldTurn && !ambient && speaker.id !== RP.PLAYER_ID) {
          var prior = RP.priorTurns(r, speaker.id, RP.FRESH_TURNS);
          if (prior.length >= 2) repeats = RP.repeatCheck(clean, prior);
        }
        if (repeats && repeats.stale && freshMode === 'strict' && !opts.reheard) {
          r.states = JSON.parse(sheetsBefore); r.cast = JSON.parse(castBefore);
          r.next = speaker.id;
          busy = false; save(); render();
          toast('♻ ' + speaker.name + ' repeated themselves — asking for a fresh turn.');
          window.setTimeout(function () {
            generate({ room: r, reheard: true, nudge: 'Your last attempt repeated what ' + speaker.name + ' has already said in this scene \u2014 ' +
              repeats.hits.slice(0, 4).map(function (h) { return '\u201c' + h + '\u201d'; }).join(', ') + '. Write the turn again: none of those' +
              ' phrases or their rewordings, a different move, and something changed by the end of it. Same person, same voice, new turn.' });
          }, 150);
          return false;
        }

        // 🔁 Anti-repetition: check cadence formulas, echoing & structural loops
        var antiRepMode = (state.settings && state.settings.antiRepetition) || RP.ANTI_REPETITION_DEFAULT;
        var repCheck = null;
        if (antiRepMode !== 'off' && !worldTurn && !ambient && speaker.id !== RP.PLAYER_ID) {
          var priorTurns = RP.priorTurns(r, speaker.id, RP.FRESH_TURNS);
          if (priorTurns.length >= 1) repCheck = RP.repetitionCheck(clean, priorTurns, r);
        }
        if (repCheck && repCheck.repeated && antiRepMode === 'strict' && !opts.reheard && RP.worthRetake('repetition', repCheck)) {
          r.states = JSON.parse(sheetsBefore); r.cast = JSON.parse(castBefore);
          r.next = speaker.id;
          busy = false; save(); render();
          toast('🔁 ' + speaker.name + ' hit a repetitive formula — retaking turn.');
          window.setTimeout(function () {
            generate({ room: r, reheard: true, nudge: 'REPETITION LOOP DETECTED (' + repCheck.reasons.join('; ') + '). ' +
              'Break this formula loop immediately. Do not reuse that cadence, capitalization pattern, or argument. Address what was JUST said and change the physical situation.' });
          }, 150);
          return false;
        }

        // 🎭 Anti-generic: check stock AI roleplay clichés & prose mush
        var antiGenMode = (state.settings && state.settings.antiGeneric) || RP.ANTI_GENERIC_DEFAULT;
        var genCheck = null;
        if (antiGenMode !== 'off' && !worldTurn) {
          genCheck = RP.genericCheck(clean);
        }
        if (genCheck && genCheck.isGeneric && antiGenMode === 'strict' && !opts.reheard && RP.worthRetake('generic', genCheck)) {
          r.states = JSON.parse(sheetsBefore); r.cast = JSON.parse(castBefore);
          r.next = speaker.id;
          busy = false; save(); render();
          toast('🎭 AI clichés detected — asking for grounded, specific prose.');
          window.setTimeout(function () {
            generate({ room: r, reheard: true, nudge: (genCheck.hard.length
              ? 'Your last attempt slipped out of character and talked like a chatbot (' + genCheck.hard.slice(0, 2).map(function (c) { return '“' + c + '”'; }).join(', ') + '). ' +
                speaker.name + ' is a person in this scene, not an assistant: no offers of help, no asking what the user wants next. '
              : 'Your last attempt leaned on stock phrasing: ' + genCheck.cliches.slice(0, 3).map(function (c) { return '“' + c + '”'; }).join(', ') + '. ') +
              'Write it again the way ' + speaker.name + ' would actually say it — plain words, their own habits from VOICE, and one real object or fact from this scene.' });
          }, 150);
          return false;
        }

        // 🤝 Item handover & continuity tracking across characters
        var transfers = RP.handoverScan(clean, r.cast);
        if (transfers && transfers.length && r.mechanics !== 'off' && r.states) {
          transfers.forEach(function (tr) {
            var giver = (r.cast || []).filter(function (c) { return RP.nameKey(c.name) === RP.nameKey(tr.giver); })[0];
            var recv = (r.cast || []).filter(function (c) { return RP.nameKey(c.name) === RP.nameKey(tr.receiver); })[0];
            if (giver && recv && r.states[giver.id] && r.states[recv.id]) {
              var item = RP.findItem(r.states[giver.id], tr.item);
              if (item) {
                RP.applyChange(r.states[giver.id], { kind: 'item', op: '-', name: item.name });
                RP.applyChange(r.states[recv.id], { kind: 'item', op: '+', name: item.name, note: item.note, icon: item.icon });
                changes.lines.push('🤝 ' + giver.name + ' passes ' + item.name + ' to ' + recv.name);
              }
            }
          });
        }

        var saidBy = (!check.ok && check.actual && !check.playerVoice) ? check.actual : speaker;
        if (saidBy !== speaker) toast('That line was ' + saidBy.name + '’s — filed under them.');
        var msg = {
          id: RP.uid(), role: worldTurn ? 'world' : 'char',
          charId: worldTurn ? '' : saidBy.id,
          misattributed: saidBy !== speaker ? speaker.name : undefined,
          text: clean, at: Date.now(), alts: [clean], alt: 0,
          // The roll and the state changes belong to the turn they happened
          // in, not to three separate cards in the stream.
          fate: fate ? fate.pill : '',
          // What the turn was written with, so you can see it working —
          // and which of it actually surfaced in the prose.
          consulted: dug.slice(0, 3).map(function (hit) { return hit.name; }),
          used: RP.usedMaterial(clean, dug.slice(0, 3), r.cast.map(function (c) { return c.name; }).concat(playerNames)),
          changes: changes.lines.slice(0, 6),
          // The colour of the box: how the speaker feels as this turn ends.
          mood: moodOn(r, worldTurn ? '' : saidBy.id),
          ambient: ambient || undefined,
          // Still leaning on old phrases after being asked again: shown, not hidden.
          repeats: repeats && repeats.stale ? repeats.hits.slice(0, 3) : undefined,
          antiRepeat: repCheck && repCheck.repeated ? repCheck.reasons.slice(0, 2) : undefined,
          generic: genCheck && genCheck.isGeneric ? genCheck.cliches.slice(0, 2) : undefined,
          flags: worldTurn || ambient ? undefined : [RP.turnFlags(r, r.messages.length, clean, saidBy.id, flagModes())],
          // One of several turns written as the same seconds.
          moment: moment ? moment.id : undefined,
          same: moment && moment.done.length ? true : undefined,
        };
        if (moment) moment.done.push(saidBy.id);
        if (chorus.dropped.length) msg.changes = (msg.changes || []).concat(['✂ cut a line written for ' + chorus.dropped.join(', ') + ' — your character']);
        if (!String(clean || '').trim()) {
          // Nothing came back twice over. Say so quietly instead of filing
          // an empty card under somebody's name.
          toast(speaker.name + ' had nothing to say — press ↻, or write your turn.');
          return false;
        }
        spoken = msg;
        r.messages.push(msg);
        // The room's beats, each under the person who made it: its own
        // card, its own mood read from its own words, its own line in
        // the history. Not a footnote on the speaker's bubble.
        chorus.pieces.forEach(function (piece, pn) {
          if (!piece.text) return;
          // “Narrator:” inside a character’s turn is the world speaking: a world card.
          if (piece.kind === 'narrator') {
            var told = { id: RP.uid(), role: 'world', charId: '', text: piece.text, at: Date.now() + 1 + pn, alts: [piece.text], alt: 0, chorus: true, moment: moment ? moment.id : undefined };
            r.messages.push(told); RP.rememberTurn(state, r, told);
            return;
          }
          var who = RP.presentCast(r).filter(function (c) { return RP.nameKey(c.name) === RP.nameKey(piece.name); })[0];
          if (!who) {
            // Somebody who is not in the scene spoke up: they have walked
            // in. Filed like an [[ENTER]] — the same sheet if they left
            // earlier, the archive’s sheet if it knows them, a new one if not.
            var reason = 'spoke up in ' + (worldTurn ? 'the narration' : speaker.name + '\u2019s turn');
            if (r.mechanics === 'off') {
              who = RP.addToRoom(r, resolveChar(piece.name) || RP.normChar({ id: RP.slug(piece.name), name: piece.name })) || null;
              if (who) msg.changes = (msg.changes || []).concat(['\ud83d\udeaa ' + who.name + ' enters \u2014 ' + reason]);
            } else {
              var came = RP.applyDirectives(state, r, [{ kind: 'enter', name: piece.name, reason: reason }], resolveChar);
              who = (came.entered || [])[0] || null;
              if (who) msg.changes = (msg.changes || []).concat(came.lines.map(function (l) { return '\ud83d\udeaa ' + l; }));
            }
            who = who && (r.cast || []).filter(function (c) { return c.id === who.id; })[0];
            if (!who) return;
          }
          var card = {
            id: RP.uid(), role: 'char', charId: who.id, text: piece.text, at: Date.now() + 1 + pn, alts: [piece.text], alt: 0,
            chorus: true, ambient: ambient || undefined, moment: moment ? moment.id : undefined,
          };
          if (moment && moment.done.indexOf(who.id) < 0) moment.done.push(who.id);
          if (r.mechanics !== 'off') {
            var chorusSheet = RP.sheetFor(r, who.id);
            if (chorusSheet && !moodFiled(who.id)) {
              var feltToo = RP.moodScan(piece.text, who.name, r.cast.map(function (c) { return c.name; }));
              if (feltToo) RP.applyChange(chorusSheet, { kind: 'mood', key: feltToo.key, level: 1, note: feltToo.note, turn: turnNow });
            }
            card.mood = moodOn(r, who.id);
          }
          r.messages.push(card);
          RP.rememberTurn(state, r, card);
        });
        if (directed && r.direction === directed) r.direction = null;
        // The audit's notes briefed this turn; they are not repeated.
        if (r.auditNotes && r.auditNotes.length && !ambient) r.auditNotes = [];
        // Narration is remembered too: it is where places get named.
        RP.rememberTurn(state, r, msg);
        if (r.kind === 'group' && !worldTurn) {
          var after = RP.rotationAfter(RP.speakableCast(r).length ? RP.speakableCast(r) : r.cast, speaker.id);
          r.next = after ? after.id : '';
        }
        // Anything temporary counts down on the turn it survives.
        var passed = r.mechanics === 'off' ? [] : RP.tickConditions(r).concat(RP.tickMoods(r, turnNow)).concat(RP.regenEnergy(r, spentIds));
        if (passed.length) msg.changes = (msg.changes || []).concat(passed);
        // A fired beat rides on the same card as the turn it interrupted.
        if (RP.autoAdvance(r)) {
          var beat = RP.fireBeat(r);
          if (beat) {
            msg.beatFired = (beat.time ? beat.time + ' — ' : '') + beat.beat;
            r.messages = r.messages.filter(function (m) { return !(m.beat && m.at >= msg.at); });
            logBeat(r);
          }
        }
      }
      r.updated = Date.now();
      // ■ landed while the tail of this reply was still being asked for:
      // what was written stays, nothing is read aloud, nobody follows.
      if (epoch !== stopEpoch) { autoLeft = 0; r.queue = []; r.moment = null; return false; }
      if (state.settings.voice === 'on' && !retry) speak(spoken, r);
      if (ambient) return false;            // one beat, no chain
      if (!retry) return direct(r, speaker);
      return false;
    }).catch(function (error) {
      if (error && error.stopped) {
        // ■ Stop: the request was cut on purpose. Nothing is filed, the
        // snapshot taken for this turn is dropped, and the chain ends.
        if (!retry && !opts.searched && (r.undo || []).length && r.undo[r.undo.length - 1].label === 'that turn') r.undo.pop();
        autoLeft = 0; r.queue = []; r.moment = null;
        return 'FAILED';
      }
      var advice = RP.modelAdvice(error.message, isOpenAI(replyUrl()));
      r.messages.push({
        id: RP.uid(), role: 'char', charId: speaker.id, error: true, at: Date.now(),
        text: 'The model did not answer: ' + error.message + '\nEndpoint: ' + replyUrl() +
          (advice ? '\n' + advice : ''),
      });
      // A failed turn ends the autopilot AND the background chores: the
      // model is struggling, and the summary + archivist landing on it
      // one second later is how one crash became three.
      autoLeft = 0;
      return 'FAILED';
    }).then(function (chain) {
      var turnFailed = chain === 'FAILED';
      if (turnFailed) chain = false;
      busy = false; ambientNow = false;
      if (!retry && autoLeft) autoLeft--;
      // A staged beat plays itself out before anything else is decided.
      var staged = !retry && !turnFailed && (r.queue || []).length;
      if (staged) { r.next = r.queue.shift(); }
      if (!staged) r.moment = null;
      save(); render();
      if (epoch !== stopEpoch) { autoLeft = 0; return; }   // ■ — no chores, no chain, no handback nag
      if (!retry && !turnFailed) {
        // The fix button, run for free every turn: nothing to fix costs
        // nothing; something to fix never waits for a button again. The
        // studio probe stays manual (🛠) — this is the deterministic half.
        var mended = RP.fixRoom(state, r, castById);
        if (mended.length) toast('🛠 ' + mended.join(' · '));
        // Lean: the recap still runs (it is what keeps prompts small);
        // the archivist and the quartermaster wait for full mode. The
        // local nets — grant scan, conjure check, conditions — are free.
        // ONE background call at a time: runChores plays them in
        // priority order, each starting only when the last finished.
        if (!leanAI()) queueBook(r);
        runChores(r);
      }
      // The scene at the side keeps its chain; a chat you walked away from
      // does not.
      if (room() !== r && !(room() && room().linkedTo === r.id)) { autoLeft = 0; return; }
      if (ambient) { save(); render(); return; }        // one beat; it never chains and never nags
      if (staged || chain || autoLeft) {
        window.setTimeout(function () { if (staged || autoLeft || chain) generate({ room: r }); }, 450);
      } else {
        if (!r.handback) { r.handback = 'your turn.'; save(); render(); }
        // Your turn here is done: the other scene may move once, unattended.
        if (!turnFailed) maybeLive(r);
      }
    });
  }

  /* ---------------------------------------------------------------- *
   * 🌗 the other scene lives — one unattended beat, queued, never two at once
   *
   * Two scenes, one chat: while you play in one, the other used to stand
   * still until you crossed over. With `live` on a scene, each of your
   * turns in the OTHER scene queues one beat here, after your turn's own
   * chain has finished — a full prompt, so it is off by default and
   * "every other turn" when on. With `liveSelf`, the character you play
   * here may act for themselves while you are away. Your next turn cuts
   * an unattended beat that is still in flight: you always win the queue.
   * ---------------------------------------------------------------- */
  var ambientNow = false;        // an unattended beat is in flight
  function maybeLive(r) {
    var other = RP.linkedRoom(state, r);
    if (!other || !other.live || other.live === 'off' || !(other.cast || []).length) return;
    if (busy) return;
    other.liveTick = (other.liveTick || 0) + 1;
    if (other.live === 'other' && other.liveTick % 2) return;
    var epoch = stopEpoch;
    var tries = 0;
    (function later() {
      window.setTimeout(function () {
        if (busy || epoch !== stopEpoch) return;                      // you took your turn, or pressed ■
        if (!RP.linkedRoom(state, r) || RP.linkedRoom(state, r).id !== other.id) return;   // unlinked meanwhile
        // The lore book or the quartermaster may still be reading: the
        // beat waits its turn in the queue rather than doubling a call.
        if (!bgQuiet()) { if (++tries < 12) later(); return; }
        generate({ room: other, ambient: true });
      }, 900);
    })();
  }
  /** 🌗 by hand: one unattended beat in the other scene, now. */
  function liveNow(r) {
    var other = RP.linkedRoom(state, r);
    if (!other) { toast('No second scene to move.'); return; }
    if (busy) { toast('The model is already writing — wait for it, or press ■.'); return; }
    if (!(other.cast || []).length) { toast('Nobody is in the other scene.'); return; }
    generate({ room: other, ambient: true });
  }

  /** The in-world date a room is being played on: whatever the scenario
   *  filed, else the archive's own clock. Every memory is stamped with it. */
  function roomDate(r) {
    if (r && r.date) return r.date;
    var parsed = RP.sceneDate(r, state, archive);
    return parsed ? RP.formatWahDate(parsed) : '';
  }

  function lastVisible(r) {
    var msgs = (r && r.messages) || [];
    for (var i = msgs.length - 1; i >= 0; i--) { if (RP.visible(msgs[i])) return msgs[i]; }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * the lore book worker — one small call at a time, on a budget
   * ---------------------------------------------------------------- */

  var booking = false;     // a background call is in flight
  var recapping = false;   // the story-so-far is being written

  /** One background call at a time, full stop. The recap, the
   *  quartermaster and the archivist used to each check only their own
   *  flag, so all three could hit a struggling local model at the same
   *  instant — the logs showed exactly that. Now a single roll call
   *  gates them, they run in priority order (recap first: it is what
   *  keeps prompts small), and each one hands the baton on as it ends. */
  function bgQuiet() { return !busy && !booking && !recapping && !upkeeping; }
  var choreRoom = null;
  function runChores(r) {
    if (r) choreRoom = r;
    var cur = choreRoom;
    if (!cur || !bgQuiet()) return;
    if (maybeRecap(cur)) return;
    if (!leanAI()) {
      if (maybeUpkeep(cur)) return;
      pumpBook();
    }
  }

  /** Fold the older turns into a recap so a long chat stays cheap. Runs
   *  on the background model, once, when the history outgrows the window. */
  function maybeRecap(r) {
    var keep = Math.max(6, Math.min(RP.RECAP_KEEP, Math.round((state.settings.context || 24) / 2)));
    if (!bgQuiet() || !RP.recapDue(r, keep)) return false;
    var turns = (r.messages || []).filter(RP.visible);
    var upTo = turns.length - keep;
    var fold = turns.slice(Number(r.recapAt || 0), upTo).map(function (m) {
      return {
        who: m.role === 'user' ? (RP.playerCharacter(r) || {}).name || state.user.name || 'You'
          : m.role === 'world' ? 'Narration' : charOf(r, m.charId).name,
        text: RP.textOf(m),
      };
    });
    if (fold.length < 4) return false;
    recapping = true;
    callModel(RP.recapPrompt(r, fold, r.recap), [{ role: 'user', content: 'Summarise it.' }],
      { tokens: 420, utility: true })
      .then(function (text) {
        var summary = String(text || '').trim();
        if (!summary) return;
        r.recap = RP.clip(summary, 1400);
        r.recapAt = upTo;
        save(); render();
        toast('📜 Folded ' + fold.length + ' older turns into the story so far.');
      })
      .catch(function () { /* the window is a little long today; no harm */ })
      .then(function () { recapping = false; runChores(); });
    return true;
  }

  var upkeeping = false;   // the quartermaster is reading

  /** The second upkeep net: every few played turns, one small background
   *  call reads the recent prose against the sheets and files what the
   *  record missed. Same utility slot and session budget as the book;
   *  it may only keep the ledger, never invent events. */
  function maybeUpkeep(r) {
    var every = state.settings.upkeep === undefined ? RP.UPKEEP_EVERY : Number(state.settings.upkeep);
    if (!bgQuiet() || !every || r.mechanics === 'off') return false;
    if (!RP.needsUpkeep(r, every) || !RP.bookBudgetLeft(state)) return false;
    var turns = (r.messages || []).filter(RP.visible);
    var upTo = turns.length;
    var recent = turns.slice(Number(r.upkeepAt || 0)).slice(-10).map(function (m) {
      return {
        who: m.role === 'user' ? ((RP.playerCharacter(r) || {}).name || state.user.name || 'You')
          : m.role === 'world' ? 'Narration' : charOf(r, m.charId).name,
        text: RP.textOf(m),
      };
    });
    if (recent.length < 2) { r.upkeepAt = upTo; return false; }
    upkeeping = true;
    RP.ensurePlayerSheet(state, r);
    callModel(RP.upkeepPrompt(r, recent), [{ role: 'user', content: 'File what the record missed.' }],
      { tokens: 220, utility: true })
      .then(function (reply) {
        r.upkeepAt = upTo;
        RP.spendBudget(state);
        var done = RP.applyUpkeep(state, r, reply);
        if (done.lines.length) {
          r.messages.push({
            id: RP.uid(), role: 'state', at: Date.now(),
            lines: done.lines.map(function (l) { return '🧾 ' + l; }),
          });
          r.updated = Date.now();
          toast('🧾 The quartermaster caught the sheets up to the story.');
        }
        save(); render();
      })
      .catch(function () {
        // Advance anyway: a failed review that stays due would retry on
        // EVERY turn — a doomed call per turn against a struggling model.
        // The next window reviews fresh prose instead.
        r.upkeepAt = upTo;
      })
      .then(function () { upkeeping = false; runChores(); });
    return true;
  }

  /** Queue the last stretch of play for filing. Called every few turns. */
  function queueBook(r) {
    if ((state.settings.book || 'on') === 'off') return;
    var turns = (r.messages || []).filter(RP.visible);
    if (turns.length < 2) return;
    var every = Math.max(2, Number(state.settings.bookEvery || 3));
    // Count from the last time this room was filed, not from a modulo —
    // a chat that skips a number should still get filed.
    if (turns.length - (r.bookAt || 0) < every) return;
    r.bookAt = turns.length;
    var slice = turns.slice(-every * 2).map(function (m) {
      return {
        who: m.role === 'user' ? (state.user.name || 'You') : charOf(r, m.charId).name,
        text: RP.textOf(m),
      };
    });
    RP.queuePush(state, {
      key: r.id + ':' + turns.length, kind: 'extract',
      // The stretch of play being filed, for the badge and the book page.
      roomId: r.id, roomTitle: r.title, when: roomDate(r), turns: slice,
    });
    pumpBook();
  }

  /** Run one queued job if the page is otherwise idle and there is budget
   *  left. Never runs beside a roleplay turn — the model is one machine. */
  function pumpBook() {
    if (!bgQuiet()) return;
    var job = RP.queueNext(state);
    if (!job) return;
    if (!RP.bookBudgetLeft(state)) { RP.queueDone(state, job.id); render(); return; }
    var r = (state.rooms || []).filter(function (x) { return x.id === job.roomId; })[0];
    if (!r) { RP.queueDone(state, job.id); return; }
    booking = true;
    renderBookBadge();
    var known = RP.bookState(state).entries.slice(-40).map(function (e) { return e.name; });
    callModel(RP.extractPrompt(r, job.turns, known), [{ role: 'user', content: 'File what is new.' }], { tokens: 420, utility: true })
      .then(function (text) {
        var filed = 0;
        RP.parseExtract(text).forEach(function (entry) {
          var saved = RP.bookAdd(state, {
            kind: entry.kind, name: entry.name, text: entry.text,
            when: job.when, roomId: r.id, roomTitle: r.title,
            chars: (r.cast || []).map(function (c) { return c.id; }),
          });
          if (saved) filed++;
        });
        if (filed) toast('📓 The lore book grew by ' + filed + '.');
        RP.queueDone(state, job.id, true);
      })
      .catch(function () { RP.queueDone(state, job.id, true); })
      .then(function () {
        booking = false;
        save(); render();
        // Breathe between calls so a local model is never asked to do two
        // things at once on somebody's laptop — then hand the baton back
        // to the chore chain, not just to the next book job.
        window.setTimeout(runChores, 1500);
      });
  }

  function renderBookBadge() {
    var badge = $('bookBadge');
    if (!badge) return;
    var q = RP.bookState(state).queue.length;
    badge.textContent = booking ? '📓 writing…' : q ? '📓 ' + q + ' queued' : '';
    badge.hidden = !booking && !q;
  }

  /* ---------------------------------------------------------------- *
   * reading a commentary aloud — the local Qwen3-TTS studio if it is
   * running (one voice profile per speaker), the browser otherwise
   * ---------------------------------------------------------------- */

  var reader = { stop: false, audio: null };
  var reading = false;     // a turn is being read aloud (speak), as opposed to an episode (speaking)

  function ttsConfig() {
    var saved = {};
    try { saved = JSON.parse(window.localStorage.getItem('waluipedia-tts') || '{}'); } catch (e) { saved = {}; }
    return {
      endpoint: (saved.endpoint || 'http://127.0.0.1:7860').replace(/\/+$/, ''),
      api: saved.api || '/generate_base_17',
      lang: saved.lang || 'Auto',
      waluigi: (state.settings && state.settings.voiceWaluigi) || saved.voice || 'Waluigi',
      luigi: (state.settings && state.settings.voiceLuigi) || 'Luigi',
      // The chat's own voices: a fallback profile, and a hand-written
      // name → profile map for the exceptions. First names match on
      // their own — Wario's lines ask the studio for 'Wario'.
      voice: (state.settings && state.settings.voiceDefault) || saved.voice || 'Waluigi',
      map: RP.parseVoiceMap((state.settings && state.settings.ttsVoices) || ''),
    };
  }

  // Profiles the studio turned out not to have, this session — those
  // speakers go straight to the fallback instead of failing twice.
  var voiceMisses = {};
  // Voices the studio has already been asked about twice (one failure, one
  // library refresh, one retry) — the retry is not repeated every line.
  var voiceRetried = {};

  /** One line through the studio — the same Gradio surface the main site's
   *  read-aloud bridge uses (docs/QWEN_TTS_BRIDGE.md). */
  function qwenSay(text, voice, cfg) {
    var payload = { data: [voice, text, cfg.lang, false, 0, 0.8, 0.95, 1.15, 2048] };
    function attempt(prefix) {
      return timedFetch(cfg.endpoint + prefix + cfg.api, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }, 30000).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (job) {
        if (!job || !job.event_id) throw new Error('no job id');
        // Synthesis itself gets three minutes; a studio that hangs no
        // longer freezes the whole read behind one silent chunk.
        return timedFetch(cfg.endpoint + prefix + cfg.api + '/' + job.event_id, {}, 180000);
      }).then(function (stream) { return stream.text(); }).then(function (body) {
        // An error the STUDIO reports (bad voice, failed synthesis) is not
        // the same story as a studio that cannot be reached — the caller
        // needs to know which one it is before blaming a voice profile.
        var studioSaid = function (message, refused) {
          var e = new Error(message); e.studio = true; e.refused = Boolean(refused); return e;
        };
        // …and a voice the studio TURNED AWAY ("not in the list of
        // choices") is not the same story as a render that fell over.
        var failed = RP.studioError(body);
        if (failed) throw studioSaid(failed.message, failed.refused);
        var done = /event:\s*complete\s*\ndata:\s*(.+)/.exec(body);
        if (!done) throw studioSaid('the studio closed the stream without finishing');
        var payloadOut = JSON.parse(done[1]);
        var audio = Array.isArray(payloadOut) ? payloadOut[1] : null;
        var path = audio && (audio.url || audio.path || audio);
        if (!path) throw studioSaid('no audio came back');
        return /^https?:/.test(path) ? path : cfg.endpoint + '/gradio_api/file=' + encodeURI(path);
      });
    }
    return attempt('/gradio_api/call').catch(function (e) {
      if (e && e.studio) throw e;
      return attempt('/call');
    });
  }

  function playUrl(url) {
    return new Promise(function (resolve) {
      var audio = new window.Audio(url);
      reader.audio = audio;
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
  }

  /** Read the whole episode, alternating voices. The next line is being
   *  synthesized while the current one plays, exactly like the main site. */
  function readEpisode(epi) {
    if (!epi || !(epi.lines || []).length) return;
    var cfg = ttsConfig();
    speaking = true; reader.stop = false; render();
    var lines = epi.lines.slice();
    var ahead = null;
    function voiceFor(line) { return line.who === 'waluigi' ? cfg.waluigi : cfg.luigi; }
    function synth(i) {
      return i < lines.length ? qwenSay(lines[i].text, voiceFor(lines[i]), cfg) : Promise.resolve(null);
    }
    function step(i) {
      if (reader.stop || i >= lines.length) { stopReading(); return; }
      var current = ahead || synth(i);
      ahead = null;
      current.then(function (url) {
        if (reader.stop) return null;
        ahead = synth(i + 1);                      // synthesize ahead of the ear
        return playUrl(url);
      }).then(function () { step(i + 1); })
        .catch(function () {
          // No studio: fall back to the browser's own voices so the button
          // still does something useful.
          browserRead(lines.slice(i));
        });
    }
    toast('🔊 Reading through the Qwen studio (' + cfg.waluigi + ' / ' + cfg.luigi + ')…');
    step(0);
  }

  function browserRead(lines) {
    if (!window.speechSynthesis) { toast('No voice available — the Qwen studio is not running.'); stopReading(); return; }
    toast('The Qwen studio is not answering — using the browser’s voices.');
    window.speechSynthesis.cancel();
    lines.forEach(function (line) {
      var u = new window.SpeechSynthesisUtterance(line.text);
      var voice = RP.voiceFor({ id: line.who, name: line.who });
      u.rate = voice.rate; u.pitch = line.who === 'waluigi' ? 0.8 : 1.25;
      window.speechSynthesis.speak(u);
    });
    speaking = true; render();
  }

  function stopReading() {
    reader.stop = true;
    if (reader.audio) { try { reader.audio.pause(); } catch (e) { /* already gone */ } }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    speaking = false; reading = false;
    render();
  }

  /** Is anything running that a ■ should be able to stop? */
  function anythingRunning() {
    return Boolean(busy || autoLeft || speaking || reading || downloadChatAudio.busy);
  }
  /** The ■ buttons follow the flags without a full render — the audio
   *  renderer and the reader flip them between turns. */
  function refreshStop() {
    ['stopBtn', 'stopBtn_b'].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      b.hidden = !anythingRunning();
      b.textContent = '■ Stop' + (downloadChatAudio.busy && downloadChatAudio.at ? ' (' + downloadChatAudio.at + ')'
        : speak.progress ? ' \u00b7 \ud83d\udd0a ' + speak.progress : '');
    });
  }

  /** ■ — everything, now: the reply being written, the chain behind it,
   *  the autopilot, a line being read, a chat being rendered to audio.
   *  Nothing half-done is filed. */
  function stopAll(quiet) {
    stopEpoch += 1;
    var cut = inflight.length;
    inflight.slice().forEach(function (c) { c.stopped = true; try { c.abort(); } catch (e) { /* already done */ } });
    inflight = [];
    autoLeft = 0;
    (state.rooms || []).forEach(function (r) { if (r && r.queue && r.queue.length) r.queue = []; if (r && r.moment) r.moment = null; });
    var wasRendering = downloadChatAudio.busy;
    downloadChatAudio.cancel = true;
    reader.stop = true;
    if (reader.audio) { try { reader.audio.pause(); } catch (e) { /* already gone */ } }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    speaking = false; reading = false;
    refreshStop();
    if (!quiet) toast('■ Stopped' + (wasRendering ? ' — the audio file was not written' : cut ? ' — the model was cut off mid-reply' : '') + '.');
  }

  /** What voices does the studio ACTUALLY have? Ask its own library —
   *  the same list behind the studio's Refresh Library button — so
   *  character names match saved profiles exactly instead of by guess.
   *  Best effort: any failure returns null and the guess path takes
   *  over. Cached for a minute so a chatty scene asks once. */
  var libCache = { at: 0, list: null };
  function keepLibrary(list) {
    list = (list || []).filter(function (s, i) { return s && s !== 'None' && list.indexOf(s) === i; });
    libCache = { at: Date.now(), list: list.length ? list : null };
    // A fresh library is new evidence. A speaker who missed before the
    // studio had their profile would stay on the fallback voice all
    // session — the misses expire with the list they were judged by.
    if (libCache.list) voiceMisses = {};
    return libCache.list;
  }
  function voiceLibrary(cfg) {
    if (libCache.at && Date.now() - libCache.at < 60000) return Promise.resolve(libCache.list);
    var keep = keepLibrary;
    // First stop: the app config. The voice dropdown's `choices` there are
    // EXACTLY what the API will accept — case-sensitive, 'None' included —
    // as its refusal errors prove. One GET, no job.
    return timedFetch(cfg.endpoint + '/config', {}, 10000)
      .then(function (res) { return res.json(); })
      .then(function (conf) {
        var comps = (conf && conf.components) || [];
        var pick = function (want) {
          var names = [];
          comps.forEach(function (c) {
            var p = c && c.props;
            if (!p || !Array.isArray(p.choices) || (c.type && c.type !== 'dropdown')) return;
            if (want && !/voice|profile|speaker|character/i.test(String(p.label || ''))) return;
            p.choices.forEach(function (ch) {
              var s = Array.isArray(ch) ? ch[0] : ch;
              if (typeof s === 'string' && s.trim()) names.push(s.trim());
            });
          });
          return names;
        };
        var found = pick(true);                    // dropdowns labelled like a voice…
        if (!found.length) found = pick(false);    // …or every dropdown, if none are
        if (found.length) return keep(found);
        throw new Error('no choices in config');
      })
      .catch(function () { return libraryFromEndpoint(cfg, keep); });
  }

  /** Second stop: call the studio's own refresh-library endpoint and read
   *  the names out of whatever it returns. */
  function libraryFromEndpoint(cfg, keep) {
    return window.fetch(cfg.endpoint + '/gradio_api/info')
      .then(function (res) { return res.json(); })
      .then(function (info) {
        var eps = Object.keys((info && info.named_endpoints) || {});
        var ep = eps.filter(function (n) { return /library|voice/i.test(n) && /refresh|list|get|load/i.test(n); })[0] ||
                 eps.filter(function (n) { return /refresh_library|list_voices/i.test(n); })[0];
        if (!ep) return keep(null);
        return window.fetch(cfg.endpoint + '/gradio_api/call' + ep, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [] }),
        }).then(function (res) { return res.json(); })
          .then(function (job) {
            if (!job || !job.event_id) return keep(null);
            return window.fetch(cfg.endpoint + '/gradio_api/call' + ep + '/' + job.event_id)
              .then(function (s) { return s.text(); })
              .then(function (body) {
                var done = /event:\s*complete\s*\ndata:\s*(.+)/.exec(body);
                if (!done) return keep(null);
                var names = [];
                (function dig(v) {
                  if (Array.isArray(v)) { v.forEach(dig); return; }
                  if (!v || typeof v !== 'object') return;
                  // a dropdown update carries choices; a dataframe carries
                  // rows whose first cell is the profile name
                  if (Array.isArray(v.choices)) v.choices.forEach(function (c) {
                    var s = Array.isArray(c) ? c[0] : c;
                    if (typeof s === 'string' && s.trim()) names.push(s.trim());
                  });
                  if (Array.isArray(v.data)) v.data.forEach(function (row) {
                    if (Array.isArray(row) && typeof row[0] === 'string' && row[0].trim()) names.push(row[0].trim());
                  });
                  Object.keys(v).forEach(function (k) { if (k !== 'choices' && k !== 'data') dig(v[k]); });
                })(JSON.parse(done[1]));
                return keep(names.filter(function (s, i) { return names.indexOf(s) === i; }));
              });
          });
      })
      .catch(function () { return keep(null); });
  }

  /** The whole chat as ONE portable audio file: every turn rendered
   *  through the studio in its own voice — the same attribution rules
   *  as ▶ — then the WAV chunks stitched losslessly (RP.wavJoin) and
   *  handed to the browser as a download. No encoder, no dependency;
   *  a .wav plays on anything with a speaker. */
  function downloadChatAudio(r, opts) {
    if (downloadChatAudio.busy) { toast('💾 Already rendering — one audio file at a time.'); return; }
    // With `both`, the linked scene's turns are read too, in the order they
    // happened — the camera moves with the clock, as in the transcript.
    var other = opts && opts.both ? RP.linkedRoom(state, r) : null;
    var msgs = [];
    (other ? [r, other] : [r]).forEach(function (src) {
      (src.messages || []).filter(RP.visible).forEach(function (m) {
        if (m.role === 'char' || m.role === 'world' || m.role === 'user') msgs.push({ m: m, r: src });
      });
    });
    if (other) msgs.sort(function (a, b) { return (a.m.at || 0) - (b.m.at || 0); });
    if (!msgs.length) { toast('Nothing to read in this chat yet.'); return; }
    var cfg = ttsConfig();
    downloadChatAudio.busy = true; downloadChatAudio.cancel = false; downloadChatAudio.at = '';
    refreshStop();
    var finish = function () { downloadChatAudio.busy = false; downloadChatAudio.at = ''; refreshStop(); };
    toast('💾 Rendering the whole chat through the studio — long chats take a while. ■ Stop cuts it at any point.');
    voiceLibrary(cfg).then(function (lib) {
      var narrator = cfg.map.narrator || cfg.map.world || cfg.voice;
      var playingIn = function (src) { return (RP.playerCharacter(src) || {}).name || state.user.name || ''; };
      var castNames = (other ? r.cast.concat(other.cast) : r.cast).map(function (c) { return c.name; })
        .concat([playingIn(r), other ? playingIn(other) : '', state.user.name || '']);
      var jobs = [];
      msgs.forEach(function (entry) {
        var m = entry.m;
        var playing = playingIn(entry.r);
        var speaker = m.role === 'world' ? ''
          : m.role === 'user' ? playing
          : ((charOf(entry.r, m.charId) || {}).name || '');
        RP.speechParts(RP.textOf(m), castNames, speaker, playing, { mode: state.settings.voiceParts || 'turn' }).forEach(function (p) {
          var v = p.who
            ? RP.ttsVoiceFor(p.who, { map: cfg.map, fallback: cfg.voice, misses: voiceMisses, library: lib })
            : narrator;
          RP.ttsChunks(p.text, 450).forEach(function (c) { jobs.push({ voice: v, text: c }); });
        });
      });
      if (!jobs.length) throw new Error('nothing readable in these turns');
      var bufs = [];
      var step = function (i) {
        if (downloadChatAudio.cancel) {
          finish();
          toast('■ Stopped — ' + i + '/' + jobs.length + ' chunks rendered, no file written.');
          return;
        }
        downloadChatAudio.at = i + '/' + jobs.length; refreshStop();
        if (i >= jobs.length) {
          var blob = new Blob([RP.wavJoin(bufs)], { type: 'audio/wav' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (String((other ? r.title + ' and ' + other.title : r.title) || 'chat').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'chat') + '.wav';
          a.click();
          window.setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) { /* gone */ } }, 30000);
          toast('💾 Saved — ' + jobs.length + ' chunks stitched into one file.');
          finish();
          return;
        }
        if (i && i % 4 === 0) toast('💾 ' + i + '/' + jobs.length + ' rendered…');
        qwenSay(jobs[i].text, jobs[i].voice, cfg)
          .then(function (url) { return window.fetch(url); })
          .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.arrayBuffer(); })
          .then(function (buf) { bufs.push(buf); step(i + 1); })
          .catch(function (e) {
            finish();
            if (e && e.stopped) { toast('■ Stopped — ' + i + '/' + jobs.length + ' chunks rendered, no file written.'); return; }
            toast('💾 Save failed at chunk ' + (i + 1) + '/' + jobs.length + ': ' + e.message);
          });
      };
      step(0);
    }).catch(function (e) {
      finish();
      if (e && e.stopped) { toast('■ Stopped — no file written.'); return; }
      toast('💾 Save failed: ' + ((e && e.message) || e));
    });
  }

  /** A message out loud, through the local Qwen studio — every voice in
   *  it: narration in the narrator's voice, each quote in the voice of
   *  whoever the prose says is speaking. Voices come from the studio's
   *  own library when it answers; a profile it lacks goes to the
   *  fallback; no studio at all → the browser voice. A manual ▶ starts
   *  fresh — earlier misses are forgiven and retried. */
  function speak(msg, r, opts) {
    if (!msg) return;
    if (opts && opts.fresh) { voiceMisses = {}; voiceRetried = {}; libCache = { at: 0, list: null }; }
    var cfg = ttsConfig();
    var speaker = msg.role === 'world' ? ''
      : msg.role === 'user' ? ((RP.playerCharacter(r) || {}).name || state.user.name || '')
      : ((charOf(r, msg.charId) || {}).name || '');
    var playing = (RP.playerCharacter(r) || {}).name || state.user.name || '';
    var castNames = r.cast.map(function (c) { return c.name; }).concat([playing, state.user.name || '']);
    // The fourth argument owns “…,” you say — YOUR line, YOUR voice,
    // even when it appears inside another character's card. The fifth is
    // how the turn is cut for the studio: one voice for the whole turn
    // (the default — a handful of sentence-sized requests), or a voice
    // per quote (one request per quote, which crawls on chatty lines).
    var parts = RP.speechParts(RP.textOf(msg), castNames, speaker, playing, { mode: state.settings.voiceParts || 'turn' });
    if (!parts.length) return;
    if (reader.audio) { try { reader.audio.pause(); } catch (e) { /* already gone */ } }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    reader.stop = false;
    var mine = ++speak.turn;
    reading = true; refreshStop();
    var over = function () { if (speak.turn === mine) { reading = false; speak.progress = ''; refreshStop(); } };
    speak.progress = 'asking the studio\u2026'; refreshStop();
    voiceLibrary(cfg).then(function (lib) {
      if (reader.stop || speak.turn !== mine) { over(); return; }
      var narrator = cfg.map.narrator || cfg.map.world || cfg.voice;
      var jobs = [];
      parts.forEach(function (p) {
        var v = p.who
          ? RP.ttsVoiceFor(p.who, { map: cfg.map, fallback: cfg.voice, misses: voiceMisses, library: lib })
          : narrator;
        // A short lead chunk: the voice starts on the opening line while
        // the rest of a long turn is still synthesizing behind it.
        RP.ttsChunks(p.text, 450, jobs.length ? 0 : 170).forEach(function (c) { jobs.push({ voice: v, text: c, who: p.who }); });
      });
      if (!jobs.length) { over(); return; }
      var ahead = null; var aheadAt = -1;
      var synth = function (i) {
        return i < jobs.length ? qwenSay(jobs[i].text, jobs[i].voice, cfg) : Promise.resolve(null);
      };
      var step = function (i) {
        if (reader.stop || speak.turn !== mine || i >= jobs.length) { over(); return; }
        // The button says where the reader is — a long turn is several
        // requests, and the first one is the wait.
        speak.progress = (jobs[i].who ? jobs[i].who + ' ' : '') + (i + 1) + '/' + jobs.length + (aheadAt === i && ahead ? '' : ' \u2026'); refreshStop();
        var cur = (aheadAt === i && ahead) ? ahead : synth(i);
        ahead = null; aheadAt = -1;
        cur.then(function (url) {
          if (reader.stop || speak.turn !== mine) return null;
          ahead = synth(i + 1); aheadAt = i + 1;   // synthesize ahead of the ear
          ahead.catch(function () { /* judged when its turn comes */ });
          return playUrl(url);
        }).then(function () { step(i + 1); })
          .catch(function (e) {
            if (reader.stop || speak.turn !== mine || (e && e.stopped)) { over(); return; }
            ahead = null; aheadAt = -1;
            if (e && e.studio && jobs[i].voice !== cfg.voice) {
              var missed = jobs[i].voice;
              var key = String(jobs[i].who || '').split(/\s+/)[0].toLowerCase();
              if (!voiceRetried[missed]) {
                // First failure for this voice this session. Whatever it
                // was — a profile saved after the studio booted (the API
                // turns it away until the library is refreshed) or a render
                // that simply fell over — the answer is the same: refresh
                // the studio's library, the way its own button does, and
                // ask once more. It used to give up here, and one bad
                // render put Wario in Waluigi's voice until a page reload.
                voiceRetried[missed] = true;
                toast('The studio stumbled on the “' + missed + '” voice (' + e.message + ') — refreshing its library and trying once more.');
                libCache = { at: 0, list: null };
                libraryFromEndpoint(cfg, keepLibrary).catch(function () { return null; }).then(function () {
                  if (reader.stop || speak.turn !== mine) return;
                  step(i);
                });
                return;
              }
              if (e.refused) {
                // Turned away twice: the studio has no such profile. The
                // miss is remembered and the fallback reads this speaker.
                voiceMisses[key] = true;
                toast('The studio has no “' + missed + '” voice — ' + cfg.voice + ' reads for ' + (jobs[i].who || 'them') +
                  ' for now. Save a profile under that name in the Voice Studio, press its Refresh Library (or restart it), then ▶ again.');
                jobs.forEach(function (j) { if (j.voice === missed) j.voice = cfg.voice; });
                step(i);
                return;
              }
              // The voice is real; the render failed. This one line goes to
              // the fallback, and the speaker is asked for again next time —
              // a hiccup is not a missing profile.
              toast('The studio failed on ' + (jobs[i].who || 'this') + '’s line (' + e.message + ') — ' + cfg.voice +
                ' reads this one; “' + missed + '” is asked for again next line.');
              jobs[i].voice = cfg.voice;
              step(i);
              return;
            }
            if (e && e.studio) { over(); toast('The Qwen studio errored: ' + e.message + ' — press ▶ to try the line again.'); return; }
            over();
            speakBrowser(msg, r);
          });
      };
      step(0);
    }).catch(function () { over(); });
  }
  speak.turn = 0;
  speak.progress = '';

  function speakBrowser(msg, r) {
    if (!window.speechSynthesis) { toast('The Qwen studio is not answering at ' + ttsConfig().endpoint + ' and this browser has no voice of its own.'); return; }
    toast('The Qwen studio is not answering at ' + ttsConfig().endpoint + ' — using the browser voice.');
    var u = new window.SpeechSynthesisUtterance(RP.ttsClean(RP.textOf(msg)));
    var voice = RP.voiceFor(charOf(r, msg.charId));
    u.rate = voice.rate; u.pitch = voice.pitch;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  /* ---------------------------------------------------------------- *
   * modals
   * ---------------------------------------------------------------- */

  function closeModal() { $('modalBack').hidden = true; $('modal').innerHTML = ''; }

  function openModal(html) {
    $('modal').innerHTML = html;
    $('modalBack').hidden = false;
  }
  $('modalBack') && ($('modalBack').onclick = function (e) { if (e.target.id === 'modalBack') closeModal(); });

  /** A tiny declarative form. fields: {k, label, type: text|area|select, value} */
  function form(title, fields, opts, done) {
    openModal('<h3>' + esc(title) + '</h3>' + (opts.note ? '<p class="sub">' + esc(opts.note) + '</p>' : '') +
      fields.map(function (f) {
        var id = 'f_' + f.k;
        if (f.type === 'area') return '<label for="' + id + '">' + esc(f.label) + '</label><textarea id="' + id + '">' + esc(f.value || '') + '</textarea>';
        if (f.type === 'select') return '<label for="' + id + '">' + esc(f.label) + '</label><select id="' + id + '">' +
          f.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === f.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
        return '<label for="' + id + '">' + esc(f.label) + '</label><input type="text" id="' + id + '" value="' + esc(f.value || '') + '">';
      }).join('') +
      '<div class="actions"><button class="pill" id="mCancel">Cancel</button><button class="pill primary" id="mOk">' + esc(opts.ok || 'Save') + '</button></div>');
    $('mCancel').onclick = closeModal;
    $('mOk').onclick = function () {
      var values = {};
      fields.forEach(function (f) { values[f.k] = $('f_' + f.k).value; });
      closeModal();
      done(values);
    };
  }

  function confirmThen(title, note, done, labels) {
    labels = labels || {};
    openModal('<h3>' + esc(title) + '</h3><p class="sub">' + esc(note) + '</p>' +
      '<div class="actions"><button class="pill" id="mCancel">' + esc(labels.no || 'Keep it') + '</button>' +
      '<button class="pill ' + (labels.ok ? 'primary' : 'danger') + '" id="mOk">' + esc(labels.ok || 'Delete') + '</button></div>');
    $('mCancel').onclick = closeModal;
    $('mOk').onclick = function () { closeModal(); done(); };
  }

  function list(title, items, done) {
    openModal('<h3>' + esc(title) + '</h3>' + (items.length ? '<div class="stack">' + items.map(function (it, i) {
      return '<button class="item" style="text-align:left;cursor:pointer" data-pick="' + i + '">' + esc(it.label) + '</button>';
    }).join('') + '</div>' : '<p class="sub">Nothing here yet.</p>') +
      '<div class="actions"><button class="pill" id="mCancel">Close</button></div>');
    $('mCancel').onclick = closeModal;
    $('modal').querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () { closeModal(); done(items[+b.dataset.pick].value); };
    });
  }

  /** Scenario settings: what everyone walks in carrying. A battle can start
   *  at half health with a wounded flag already set, and the model reads
   *  exactly that before it writes the first line. */
  function stateSetup(chosen, current, done) {
    current = current || {};
    var rows = chosen.map(function (c) {
      var cur = (current.states || {})[c.id] || {};
      return '<div class="setuprow" data-setup="' + esc(c.id) + '">' + avatar(c, 28) +
        '<b>' + esc(c.name) + '</b>' +
        '<label>HP %<input type="number" min="0" max="100" value="' + (cur.hpPct === undefined ? 100 : cur.hpPct) + '" data-k="hpPct"></label>' +
        '<label>MP %<input type="number" min="0" max="100" value="' + (cur.mpPct === undefined ? 100 : cur.mpPct) + '" data-k="mpPct"></label>' +
        '<label>Conditions<input type="text" placeholder="wounded, hunted — or with a bite: bleeding 3 -2hp | a deep cut" value="' + esc(cur.flags || '') + '" data-k="flags"></label>' +
        '<label>Carrying<input type="text" placeholder="rope, lantern" value="' + esc(cur.items || '') + '" data-k="items"></label>' +
        '<label>Note<input type="text" placeholder="one arm useless" value="' + esc(cur.status || '') + '" data-k="status"></label>' +
        '</div>';
    }).join('');
    openModal('<h3>Starting state</h3><p class="sub">What everyone walks in carrying. The model reads these sheets ' +
      'before its first line and updates them as the scene goes.</p>' +
      '<label for="setupPreset">Mechanics</label><select id="setupPreset">' +
      Object.keys(RP.STATE_PRESETS).map(function (k) {
        return '<option value="' + k + '"' + ((current.preset || 'rpg') === k ? ' selected' : '') + '>' + esc(RP.STATE_PRESETS[k].name) + '</option>';
      }).join('') + '</select>' +
      '<div class="setup">' + rows + '</div>' +
      '<div class="actions"><button class="pill" id="mCancel">Back</button>' +
      '<button class="pill primary" id="mOk">Start with these</button></div>');
    $('mCancel').onclick = closeModal;
    $('mOk').onclick = function () {
      var setup = { preset: $('setupPreset').value, states: {} };
      $('modal').querySelectorAll('[data-setup]').forEach(function (rowEl) {
        var row = {};
        rowEl.querySelectorAll('[data-k]').forEach(function (input) { row[input.dataset.k] = input.value; });
        setup.states[rowEl.dataset.setup] = row;
      });
      done(setup);
    };
  }

  /* ---- playing as somebody from the archive ----
     The reader is usually Waluigi. Until now that took four steps: ＋ New,
     From the archive, pick him, then find the ☆. One picker now does it,
     and can remember the choice for every chat that follows. */

  /** Seat the reader as `c` in room `r`: into the cast if need be, star
   *  on, receipt in the stream. `remember` makes it the default. */
  function seatPlayer(r, c, remember) {
    var wasIn = (r.cast || []).some(function (x) { return x.id === c.id; });
    RP.pushUndo(r, 'playing as ' + c.name);
    var seat = RP.playAs(r, c);
    if (!seat) return;
    RP.ensurePlayerSheet(state, r);
    r.messages.push({ id: RP.uid(), role: 'state', at: Date.now(),
      lines: ['🎭 You play ' + seat.name + (wasIn ? '' : ' — they join the scene') + '. The model will not speak for them.'] });
    RP.logEvent(state, {
      kind: 'roster', roomId: r.id, roomTitle: r.title, when: roomDate(r), chars: [seat.id],
      text: 'The reader took the seat of ' + seat.name + '.',
    });
    if (remember !== undefined) state.user.playAs = remember ? seat.id : (state.user.playAs === seat.id ? '' : state.user.playAs);
    save(); buildBoard(); render();
    toast('You play ' + seat.name + ' — your turns wear their face, and the model writes everybody else.' +
      (remember ? ' Every new chat will open this way.' : ''));
  }

  function playAsPicker(r) {
    var current = RP.playerCharacter(r);
    var def = (state.user && state.user.playAs) || '';
    castPicker({
      title: 'Who do you play?',
      note: 'Take a seat as somebody from the archive. Your turns show their name and portrait, the other characters ' +
        'talk to you as them, and the model never writes their lines.',
      preselect: current ? [current.id] : (def && castById[def] ? [def] : []),
      first: ['waluigi', 'wario', 'bowser', 'luigi'].concat(def ? [def] : []),
      single: true, suggest: false, ok: 'Take the seat',
      check: { label: 'Open every new chat as them', checked: Boolean(def) },
    }, function (chosen, _setup, flags) {
      seatPlayer(r, chosen[0], Boolean(flags && flags.check));
    });
  }

  /** A new room opens with the reader already seated, when they asked
   *  for that. Quiet: no receipt in the stream, the rail says it. */
  function applyDefaultPlayer(r) {
    var id = (state.user && state.user.playAs) || '';
    if (!id || !castById[id] || !r || r.youPlay) return;
    RP.playAs(r, castById[id]);
    RP.ensurePlayerSheet(state, r);
  }

  /** The cast picker used by group chats, scenes and replays. */
  function castPicker(opts, done) {
    var picked = (opts.preselect || []).slice();
    var pendingSetup = null;
    function draw() {
      var q = ($('pickSearch') && $('pickSearch').value || '').toLowerCase();
      var pool = (opts.extra || []).concat(cast);
      // Whoever is named first in the picker's own note or title comes to
      // the top — "Play as" wants Waluigi on screen, not under W.
      var first = (opts.first || []).slice();
      if (first.length) {
        pool = first.map(function (id) { return pool.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean)
          .concat(pool.filter(function (c) { return first.indexOf(c.id) < 0; }));
      }
      if (opts.exclude) pool = pool.filter(function (c) { return !opts.exclude[c.id]; });
      var shown = pool.filter(function (c) {
        return !q || c.name.toLowerCase().indexOf(q) >= 0 || String(c.title || '').toLowerCase().indexOf(q) >= 0;
      }).slice(0, 300);
      var seed = q && !shown.some(function (c) { return c.name.toLowerCase() === q; }) ? $('pickSearch').value.trim() : '';
      // The ＋ tile: a new character, seeded with whatever was typed into
      // the search when it matched nobody.
      var plus = !opts.create ? '' : '<button class="pick new" data-new="1" title="Somebody the archive has never filed">' +
        '<span class="av" style="width:' + (opts.portraits ? 56 : 24) + 'px;height:' + (opts.portraits ? 56 : 24) + 'px;background:transparent;font-size:' +
        (opts.portraits ? 30 : 16) + 'px">＋</span><span>' + (seed ? 'New: ' + esc(RP.clip(seed, 24)) : 'New character…') + '</span></button>';
      $('pickGrid').innerHTML = plus + shown.map(function (c) {
        return '<button class="pick ' + (picked.indexOf(c.id) >= 0 ? 'on' : '') + '" data-pick="' + esc(c.id) + '" title="' + esc(c.title || '') + '">' +
          avatar(c, opts.portraits ? 56 : 24) + '<span>' + esc(c.name) + '</span>' +
          (opts.portraits && c.title ? '<small>' + esc(RP.clip(c.title, 40)) + '</small>' : '') + '</button>';
      }).join('');
      var plusBtn = $('pickGrid').querySelector('[data-new]');
      if (plusBtn) plusBtn.onclick = function () { closeModal(); opts.create(seed); };
      $('pickGrid').querySelectorAll('[data-pick]').forEach(function (b) {
        b.onclick = function () {
          var id = b.dataset.pick;
          var at = picked.indexOf(id);
          if (opts.single) picked = at >= 0 ? [] : [id];
          else if (at >= 0) picked.splice(at, 1); else picked.push(id);
          draw();
        };
      });
      $('pickCount').textContent = opts.single
        ? (picked.length ? (castById[picked[0]] || {}).name || '1 selected' : 'Pick one')
        : picked.length + ' selected';
    }
    openModal('<h3>' + esc(opts.title || 'Pick a cast') + '</h3>' +
      (opts.note ? '<p class="sub">' + esc(opts.note) + '</p>' : '') +
      '<input type="text" id="pickSearch" placeholder="' + (opts.create ? 'Search the cast — or type a new name' : 'Search the cast') + '">' +
      '<div class="picker' + (opts.portraits ? ' portraits' : '') + '" id="pickGrid"></div>' +
      (opts.check ? '<label class="pickcheck"><input type="checkbox" id="pickCheck"' + (opts.check.checked ? ' checked' : '') + '> ' +
        esc(opts.check.label) + '</label>' : '') +
      '<div class="actions"><span class="sub" id="pickCount" style="margin-right:auto"></span>' +
      (opts.setup ? '<button class="pill" id="pickSetup">⚔ Starting state</button>' : '') +
      (opts.suggest === false ? '' : '<button class="pill" id="pickSuggest">✨ Suggest a cast</button>') +
      '<button class="pill" id="mCancel">Cancel</button>' +
      '<button class="pill primary" id="mOk">' + esc(opts.ok || 'Start') + '</button></div>');
    $('pickSearch').oninput = draw;
    $('mCancel').onclick = closeModal;
    $('mOk').onclick = function () {
      var extra = {};
      (opts.extra || []).forEach(function (c) { extra[c.id] = c; });
      var chosen = picked.map(function (id) { return castById[id] || extra[id]; }).filter(Boolean);
      if (!chosen.length) { toast('Pick at least one character.'); return; }
      var flags = { check: Boolean($('pickCheck') && $('pickCheck').checked) };
      closeModal(); done(chosen, pendingSetup, flags);
    };
    if ($('pickSetup')) {
      $('pickSetup').onclick = function () {
        var extra = {};
        (opts.extra || []).forEach(function (c) { extra[c.id] = c; });
        var chosen = picked.map(function (id) { return castById[id] || extra[id]; }).filter(Boolean);
        if (!chosen.length) { toast('Pick the cast first.'); return; }
        stateSetup(chosen, pendingSetup, function (setup) {
          pendingSetup = setup;
          closeModal();
          done(chosen, setup);
        });
      };
    }
    if ($('pickSuggest')) {
      $('pickSuggest').onclick = function () {
        if (!CFG.suggestUrl) { toast('Cast suggestions need the workflow server.'); return; }
        $('pickSuggest').textContent = '…thinking';
        fetch(CFG.suggestUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scene: opts.title || 'a scene', count: 4, candidates: cast.map(function (c) { return { id: c.id, name: c.name }; }) }),
        }).then(function (r) { return r.json(); }).then(function (data) {
          picked = (data.ids || []).slice();
          $('pickSuggest').textContent = '✨ Suggest a cast';
          draw();
        }).catch(function () { $('pickSuggest').textContent = '✨ Suggest a cast'; toast('The model could not suggest a cast.'); });
      };
    }
    draw();
  }

  /** Somebody the archive never filed. A name is enough: ✨ asks the model
   *  for the rest of the card — role, look, voice, sample lines, kit — in
   *  a fixed template, and anything the reader already typed is kept.
   *  Saving seats them in the room with a real sheet and a voice sheet,
   *  and they stay in the invite grid for later scenes. */
  function inventForm(r, seedName) {
    var aiVoice = null;      // sounds / never / lines from the fill-in ride along with the register
    openModal('<h3>A new character</h3>' +
      '<p class="sub">Give a name and press ✨ — the model fills in the rest in the archive\u2019s own register. Whatever you type yourself is kept.</p>' +
      '<label for="nc_name">Name</label><input type="text" id="nc_name" value="' + esc(seedName || '') + '" placeholder="Old Pell">' +
      '<label for="nc_role">Who they are to this scene</label><input type="text" id="nc_role" placeholder="the pawnbroker who holds the marker">' +
      '<label for="nc_look">What they look like</label><textarea id="nc_look" rows="2"></textarea>' +
      '<label for="nc_voice">How they talk</label><textarea id="nc_voice" rows="2" placeholder="dry, slow, every sentence a price"></textarea>' +
      '<p class="sub" id="nc_lines" hidden></p>' +
      '<label for="nc_items">Carrying — commas between, an emoji first picks the icon</label><input type="text" id="nc_items" placeholder="📒 a black ledger, 🗝 a ring of small keys">' +
      '<div class="actions"><button class="pill" id="ncFill" style="margin-right:auto">✨ Fill it in</button>' +
      '<button class="pill" id="mCancel">Cancel</button><button class="pill primary" id="mOk">Into the scene</button></div>');
    $('mCancel').onclick = closeModal;
    function spec() {
      return {
        name: $('nc_name').value.trim(), role: $('nc_role').value.trim(), look: $('nc_look').value.trim(),
        voice: $('nc_voice').value.trim(), items: $('nc_items').value.trim(),
      };
    }
    $('ncFill').onclick = function () {
      var want = spec();
      if (!want.name) { toast('A name first — the rest follows from it.'); $('nc_name').focus(); return; }
      $('ncFill').disabled = true; $('ncFill').textContent = '…writing';
      callModel(RP.inventPrompt(want, r), [{ role: 'user', content: 'Write the card for ' + want.name + '.' }], { utility: true, tokens: 520 })
        .then(function (text) {
          var got = RP.parseInvented(text, want);
          if (!$('nc_role').value.trim() && got.role) $('nc_role').value = got.role;
          if (!$('nc_look').value.trim() && got.look) $('nc_look').value = got.look;
          if (got.voice) {
            if (!$('nc_voice').value.trim() && got.voice.register) $('nc_voice').value = got.voice.register;
            aiVoice = got.voice;
            if (got.voice.lines.length) {
              $('nc_lines').hidden = false;
              $('nc_lines').textContent = 'Sounds like: ' + got.voice.lines.map(function (l) { return '\u201c' + l + '\u201d'; }).join(' ');
            }
          }
          if (!$('nc_items').value.trim() && got.items.length) $('nc_items').value = got.items.join(', ');
          if (!got.role && !got.look && !got.voice && !got.items.length) toast('The model did not keep to the card — try once more, or type it in.');
        })
        .catch(function (err) { toast('The model could not fill it in — ' + (err && err.message ? err.message : 'no answer') + '.'); })
        .then(function () { $('ncFill').disabled = false; $('ncFill').textContent = '✨ Fill it in'; });
    };
    $('mOk').onclick = function () {
      var want = spec();
      if (!want.name) { toast('They need a name.'); $('nc_name').focus(); return; }
      var voice = want.voice || (aiVoice && aiVoice.register) ? {
        register: want.voice || aiVoice.register,
        sounds: aiVoice ? aiVoice.sounds : [], never: aiVoice ? aiVoice.never : [], lines: aiVoice ? aiVoice.lines : [],
      } : null;
      var items = want.items ? want.items.split(/\s*,\s*/).filter(Boolean) : [];
      RP.pushUndo(r, 'writing in ' + want.name);
      var made = RP.inventCharacter(state, r, {
        name: want.name, role: want.role, look: want.look, voice: voice, items: items,
        by: aiVoice ? 'written in by the reader, filled in by the model' : 'written in by the reader',
      });
      r.messages.push({ id: RP.uid(), role: 'state', at: Date.now(),
        lines: ['🚪 ' + made.name + ' joins the scene — new' + (want.role ? ', ' + RP.clip(want.role, 60) : '')] });
      r.updated = Date.now();
      // On the dashboard too, like an imported card: described, not drawn.
      castById[made.id] = made;
      cast = cast.filter(function (c) { return c.id !== made.id; }).concat([made]);
      closeModal();
      save(); buildBoard(); render();
      toast(made.name + ' is in the scene' + (voice ? ', with a voice of their own' : '') + '.');
    };
    $('nc_name').focus();
  }

  function loreForm(node) {
    form(node ? 'Edit lore node' : 'New lore node', [
      { k: 'title', label: 'Title', value: node ? node.title : '' },
      { k: 'text', label: 'What is true', type: 'area', value: node ? node.text : '' },
      { k: 'tags', label: 'Tags (comma separated — matched against the scene)', value: node ? (node.tags || []).join(', ') : '' },
      { k: 'source', label: 'Source (where this came from)', value: node ? node.source : '' },
    ], { note: 'Lore is handed to every chat whose cast or scene matches.' }, function (v) {
      if (!v.title.trim()) return;
      RP.addLore(state, {
        id: node ? node.id : '', title: v.title, text: v.text, source: v.source,
        tags: v.tags.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
        chars: node ? node.chars : [],
      });
      save(); render(); toast('Lore filed.');
    });
  }

  function personaForm() {
    var r = room();
    form('Who do you play?', [
      { k: 'persona', label: 'Your persona in this world', type: 'area', value: (r && r.persona) || state.user.persona || '' },
      { k: 'all', label: 'Apply to (this chat / everywhere)', type: 'select', value: r ? 'chat' : 'all', options: [{ value: 'chat', label: 'This chat' }, { value: 'all', label: 'Every chat' }] },
    ], { note: 'The characters address this person and never speak for them.' }, function (v) {
      if (v.all === 'all' || !r) state.user.persona = v.persona;
      if (r) r.persona = v.persona;
      save(); render();
    });
  }

  function accountForm() {
    form('Your account', [
      { k: 'name', label: 'Display name', value: state.user.name || '' },
      { k: 'handle', label: 'Handle (without @)', value: state.user.handle || '' },
      { k: 'avatar', label: 'Avatar URL (optional)', value: state.user.avatar || '' },
    ], {}, function (v) {
      state.user.name = v.name || 'Archivist';
      state.user.handle = (v.handle || 'waluipedia').replace(/^@/, '');
      state.user.avatar = v.avatar;
      save(); render();
    });
  }

  /** Where the model lives. Two presets, because two things are what
   *  people actually run: LM Studio on its own, or the workflow server. */
  var settingsTab = 'model';
  function settingsForm(openTab) {
    var current = replyUrl();
    var sampler = (state.settings && state.settings.sampler) || {};
    var sel = function (id, label, value, options, help) {
      return '<label for="' + id + '">' + label + (help ? '<small>' + help + '</small>' : '') + '</label><select id="' + id + '">' +
        options.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select>';
    };
    var num = function (id, label, value, min, max, step, help) {
      return '<label for="' + id + '">' + label + (help ? '<small>' + help + '</small>' : '') + '</label>' +
        '<input type="number" id="' + id + '" min="' + min + '" max="' + max + '"' + (step ? ' step="' + step + '"' : '') + ' value="' + esc(String(value)) + '">';
    };
    var TABS = [['model', '🖥 Model'], ['scene', '🎬 The scene'], ['people', '👥 The people'], ['memory', '🧠 Memory & budget'], ['look', '🎨 Appearance']];
    var tabNow = openTab || settingsTab || 'model';
    openModal('<h3>Settings</h3>' +
      '<p class="sub">Everything the page runs on, in one place. The same dials sit on the 🎬 Scene tab of the dock as shortcuts.</p>' +
      '<div class="stabs">' + TABS.map(function (t) {
        return '<button class="stab' + (tabNow === t[0] ? ' on' : '') + '" data-stab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +

      // ---- the model ----
      '<section class="spane" data-spane="model"' + (tabNow === 'model' ? '' : ' hidden') + '>' +
      '<p class="sub">Point the page at whatever is running. <b>LM Studio</b> is called directly with the OpenAI API ' +
      '(make sure its server is started, and that “Enable CORS” is on in its Developer tab). The <b>workflow ' +
      'server</b> adds the archive routes and the disk saves, and forwards to LM Studio itself.</p>' +
      '<div class="castbar">' +
      '<button class="pill' + (isOpenAI(current) ? ' primary' : '') + '" id="setLm">🖥 LM Studio (127.0.0.1:1234)</button>' +
      '<button class="pill' + (!isOpenAI(current) ? ' primary' : '') + '" id="setWf">🗄 Workflow server (127.0.0.1:8787)</button>' +
      '<button class="pill" id="setTest">🔌 Test it</button>' +
      '<span class="chip" id="setState">' + (online ? 'answering' : 'no answer yet') + '</span>' +
      '</div>' +
      '<label for="f_endpoint">Endpoint</label><input type="text" id="f_endpoint" value="' + esc(state.settings.endpoint || '') + '" placeholder="' + esc(CFG.replyUrl) + '">' +
      '<label for="f_model">Model</label>' +
      '<div class="castbar"><select id="f_modelPick"><option value="">— the models the endpoint reports —</option></select>' +
      '<button class="pill" id="setModels">↻ List models</button></div>' +
      '<input type="text" id="f_model" value="' + esc(state.settings.model || '') + '" placeholder="local-model">' +
      '<label for="f_temperature">Temperature — higher is wilder (0–1.5)</label>' +
      '<input type="text" id="f_temperature" value="' + esc(String(state.settings.temperature)) + '">' +
      '<label>Sampling — leave blank to let the model decide</label>' +
      '<div class="castbar">' +
      '<label class="mins">top_p <input type="text" id="f_top_p" value="' + esc(String(sampler.top_p === undefined ? '' : sampler.top_p)) + '" placeholder="0.9"></label>' +
      '<label class="mins">top_k <input type="text" id="f_top_k" value="' + esc(String(sampler.top_k === undefined ? '' : sampler.top_k)) + '" placeholder="40"></label>' +
      '<label class="mins">rep. penalty <input type="text" id="f_repeat_penalty" value="' + esc(String(sampler.repeat_penalty === undefined ? '' : sampler.repeat_penalty)) + '" placeholder="1.1"></label>' +
      '<label class="mins">min_p <input type="text" id="f_min_p" value="' + esc(String(sampler.min_p === undefined ? '' : sampler.min_p)) + '" placeholder="0.05"></label>' +
      '<label class="mins" title="Anti-cliché: chance to skip the most predictable word. llama.cpp / KoboldCpp only.">XTC <input type="text" id="f_xtc_probability" value="' + esc(String(sampler.xtc_probability === undefined ? '' : sampler.xtc_probability)) + '" placeholder="0.5"></label>' +
      '<label class="mins" title="Anti-repetition: penalises repeated runs of words. llama.cpp / KoboldCpp only.">DRY <input type="text" id="f_dry_multiplier" value="' + esc(String(sampler.dry_multiplier === undefined ? '' : sampler.dry_multiplier)) + '" placeholder="0.8"></label>' +
      '</div>' +
      '<h4>Background AI</h4>' +
      '<label for="f_background">Background AI — lean is ONE model call per turn: speakers rotate, the lore book and upkeep wait</label>' +
      '<select id="f_background">' +
      '<option value="lean"' + ((state.settings.background || RP.BACKGROUND_DEFAULT) === 'lean' ? ' selected' : '') + '>Lean — the model only writes the story (best on slow machines)</option>' +
      '<option value="full"' + (state.settings.background === 'full' ? ' selected' : '') + '>Full — model-picked speakers, auto lore book, upkeep reviews</option>' +
      '</select>' +
      '<label for="f_utilityModel">Background model — the sequencer, the lore book, hooks, the audit (blank = the same one)</label>' +
      '<input type="text" id="f_utilityModel" value="' + esc(state.settings.utilityModel || '') + '" placeholder="a small, fast model">' +
      '<input type="text" id="f_utilityEndpoint" value="' + esc(state.settings.utilityEndpoint || '') + '" placeholder="its endpoint, if it is somewhere else">' +
      '</section>' +

      // ---- the scene ----
      '<section class="spane" data-spane="scene"' + (tabNow === 'scene' ? '' : ' hidden') + '>' +
      sel('f_length', 'How long a reply is', state.settings.length || RP.DEFAULT_LENGTH, Object.keys(RP.LENGTHS).map(function (k) {
        return [k, RP.LENGTHS[k].name + ' — ' + RP.LENGTHS[k].words];
      }), '“Let the scene decide” keeps a retort short and gives a reveal its paragraphs; the others pin a band. Also on the ✂ button under the chat.') +
      sel('f_style', 'Narration style', state.settings.style || '', Object.keys(RP.STYLES).map(function (k) { return [k, RP.STYLES[k].name]; })) +
      sel('f_narrator', 'Who narrates', RP.narrator(state), Object.keys(RP.NARRATORS).map(function (k) {
        return [k, RP.NARRATORS[k].icon + ' ' + RP.NARRATORS[k].name + ' — ' + RP.NARRATORS[k].blurb];
      })) +
      sel('f_world', 'Narration turns', state.settings.world || 'on', [
        ['on', 'On — when nobody else is here, the world describes the scene and moves the hour'],
        ['off', 'Off — only characters speak']]) +
      sel('f_director', 'Director — after a reply, who speaks next?', state.settings.director || 'on', [
        ['on', 'The model decides — characters answer each other, then hand back to me'],
        ['off', 'Always me — one reply per turn']],
        'In a group chat the model stages who reacts to your line and in what order; it hands back on its own, and always at the ceiling below. You can always pick faces yourself on the Next: row — several at once with 👥 Several.') +
      num('f_maxChain', 'Never more than this many character turns before it comes back to me', state.settings.maxChain || RP.MAX_CHAIN, 1, 12) +
      num('f_autoplay', '▶ Auto plays this many turns before stopping', state.settings.autoplay || 6, 2, 20) +
      sel('f_fate', '🎲 Fate — how often the world pushes back', state.settings.fate || 'normal', [
        ['off', 'Off — whatever you write, works'],
        ['gentle', 'Gentle — mostly you, occasionally a price'],
        ['normal', 'Normal — costs and wrenches are common, failure happens'],
        ['harsh', 'Harsh — the world is against you and the cast argues back']],
        'Before each reply to something you attempted, the page rolls and tells the model how it resolves. Being wounded or spent shifts the odds against you.') +
      sel('f_hurt', '💥 Wounds', state.settings.hurt || 'on', [
        ['on', 'Filed from the prose too — a crash, a blade or a blast costs HP even when the model files nothing'],
        ['off', 'Only what the model files as [[HP:]] lands on the sheets']]) +
      '<p class="sub">⚡ <b>Energy</b> is one pool for breath, strength and magic: a sprint, a climb, a long fight or a spell costs some (filed by the model, or read from the prose), it refills a little every quiet turn, and at 0 the body refuses. ' +
      '0 HP is <b>down</b>: barely conscious until something brings them round — a slap, salts, a stim, a heal — which the page files on its own.</p>' +
      '</section>' +

      // ---- the people ----
      '<section class="spane" data-spane="people"' + (tabNow === 'people' ? '' : ' hidden') + '>' +
      sel('f_fresh', '♻ Fresh turns — when a character starts repeating themselves', state.settings.fresh || RP.FRESH_DEFAULT, Object.keys(RP.FRESH).map(function (k) {
        return [k, RP.FRESH[k].name + ' — ' + RP.FRESH[k].blurb];
      }), 'The page keeps a ledger of the phrases, the subject and the opening each character has leaned on over their last ' + RP.FRESH_TURNS +
        ' turns. When there is something on it, the prompt names it and asks for one new move; on Strict, a reply that still leans on the old phrases is sent back once. No extra calls.') +
      sel('f_antiRepetition', '🔁 Anti-repetition — suppress repetitive loops, echoes & formulas', state.settings.antiRepetition || RP.ANTI_REPETITION_DEFAULT, Object.keys(RP.ANTI_REPETITION).map(function (k) {
        return [k, RP.ANTI_REPETITION[k].name + ' — ' + RP.ANTI_REPETITION[k].blurb];
      }), 'Bans structural cadence formulas, sentence repetition loops, user echoing, and voice slide. Strict automatically retakes repeating turns once and cleans intra-turn stutter loops.') +
      sel('f_antiGeneric', '🎭 Anti-generic — suppress AI roleplay clichés & prose mush', state.settings.antiGeneric || RP.ANTI_GENERIC_DEFAULT, Object.keys(RP.ANTI_GENERIC).map(function (k) {
        return [k, RP.ANTI_GENERIC[k].name + ' — ' + RP.ANTI_GENERIC[k].blurb];
      }), 'Detects and bans stock AI roleplay clichés (e.g. “shiver down spine”, “testament to”, “smirk played across”). Strict retakes once with a concrete grounding nudge.') +
      sel('f_audience', '👥 The room answers — the people who are NOT speaking this turn', state.settings.audience || RP.AUDIENCE_DEFAULT, Object.keys(RP.AUDIENCE).map(function (k) {
        return [k, RP.AUDIENCE[k].name + ' — ' + RP.AUDIENCE[k].blurb];
      }), 'Same call, no extra cost. Each reaction is cut out of the speaker\u2019s reply and filed under the person who made it — its own card, its own mood, its own voice in the history. Nothing shows in a two-hander, because nobody is watching.') +
      '<p class="sub">To have several people act on the same beat — one running while another shoots — press <b>👥 Several…</b> on the Next: row, tick them, and choose <b>the same moment</b>. Each is written as happening in the same seconds, not one after the other.</p>' +
      sel('f_voice', '🔊 Voice', state.settings.voice === 'on' ? 'on' : 'off', [
        ['off', 'On tap — ▶ on a card reads it'],
        ['on', 'Auto — every reply is read aloud as it lands']]) +
      sel('f_cacheLayout', '⚡ Prompt layout — how a turn is laid out for the model server', state.settings.cacheLayout === 'off' ? 'off' : 'on', [
        ['on', 'Cache-friendly — the scene stays put, the turn’s notes ride on the newest line (faster replies)'],
        ['off', 'Classic — everything in one system prompt, rebuilt every turn']]) +
      '</section>' +

      // ---- memory & budget ----
      '<section class="spane" data-spane="memory"' + (tabNow === 'memory' ? '' : ' hidden') + '>' +
      num('f_context', 'How many recent turns the model sees (default 24)', state.settings.context || 24, 4, 240) +
      num('f_historyChars', 'History budget, in characters — long monologues are clipped so they cannot crowd out whole turns (default ' + RP.HISTORY_BUDGET + ')', state.settings.historyChars || RP.HISTORY_BUDGET, 3000, 60000, 1000) +
      num('f_promptBudget', 'System prompt budget, in characters — raise it for a model with a big context window (default ' + RP.PROMPT_BUDGET + ')', state.settings.promptBudget || RP.PROMPT_BUDGET, 6000, RP.PROMPT_BUDGET_MAX, 1000) +
      num('f_upkeep', '🧾 Sheet upkeep — the quartermaster reviews the record every N played turns (0 = off, default ' + RP.UPKEEP_EVERY + ')', state.settings.upkeep === undefined ? RP.UPKEEP_EVERY : state.settings.upkeep, 0, 24, 0,
        'One small background call; shares the book\u2019s session budget. The deterministic half — down at 0 HP, revivals, Energy from the prose, wounds from the prose — runs every turn for free.') +
      '<p class="sub">The archive is read for every turn (🔎 on the card) and the model is asked to weave one concrete thing out of it; a card shows 📚 when it did.</p>' +
      '</section>' +

      // ---- appearance ----
      '<section class="spane" data-spane="look"' + (tabNow === 'look' ? '' : ' hidden') + '>' +
      '<p class="sub">Theme, text size, prose face, column width, mood wash, coloured words, badges, times, Enter vs Ctrl+Enter.</p>' +
      '<button class="pill" id="setLook">🎨 Open Appearance…</button>' +
      '</section>' +

      '<div class="actions"><button class="pill" id="mCancel">Cancel</button>' +
      '<button class="pill primary" id="mOk">Save</button></div>');
    $('modal').querySelectorAll('[data-stab]').forEach(function (b) {
      b.onclick = function () {
        settingsTab = b.dataset.stab;
        $('modal').querySelectorAll('[data-stab]').forEach(function (x) { x.classList.toggle('on', x === b); });
        $('modal').querySelectorAll('[data-spane]').forEach(function (p) { p.hidden = p.dataset.spane !== b.dataset.stab; });
      };
    });
    $('mCancel').onclick = closeModal;
    // The dialog can be closed while a request is in flight, and two probes
    // can be in flight at once (the automatic one on open, and Test it).
    // The latest one wins; a stale answer never overwrites a newer one.
    var probeSeq = 0;
    function probe() { return ++probeSeq; }
    function say(text, mine) {
      if (mine !== undefined && mine !== probeSeq) return;
      if ($('setState')) $('setState').textContent = text;
    }
    function listModels() {
      var mine = probe();
      if (!$('f_endpoint')) return;
      var url = $('f_endpoint').value.trim() || CFG.replyUrl;
      if (!isOpenAI(url)) { say('the workflow server picks the model itself', mine); return; }
      say('asking…', mine);
      fetch(modelsRoute(url)).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        var list = (data && (data.data || data.models)) || [];
        var pick = $('f_modelPick');
        if (!pick || mine !== probeSeq) return;
        if (!list.length) { say('no models loaded', mine); return; }
        pick.innerHTML = list.map(function (m) {
          var id = String(m.id || m.name || '');
          return '<option value="' + esc(id) + '"' + (state.settings.model === id ? ' selected' : '') + '>' + esc(id) + '</option>';
        }).join('');
        pick.onchange = function () { if ($('f_model')) $('f_model').value = pick.value; };
        if ($('f_model') && !$('f_model').value) $('f_model').value = pick.value;
        say(list.length + ' model' + (list.length === 1 ? '' : 's') + ' loaded', mine);
      }).catch(function () { say('no answer — is it running?', mine); });
    }
    $('setModels').onclick = listModels;
    listModels();
    $('setLm').onclick = function () { $('f_endpoint').value = LM_STUDIO; listModels(); };
    $('setWf').onclick = function () { $('f_endpoint').value = 'http://127.0.0.1:8787/api/roleplay'; };
    $('setLook').onclick = function () { closeModal(); lookForm(); };
    $('setTest').onclick = function () {
      var mine = probe();
      var url = $('f_endpoint').value.trim() || CFG.replyUrl;
      say('testing…', mine);
      // (Named `request`, not `probe`: a local `var probe` would shadow the
      //  probe() counter above and break the whole handler.)
      var request = isOpenAI(url)
        ? fetch(modelsRoute(url)).then(function (r) { return r.ok ? r.json() : null; })
        : fetch(url.replace(/\/api\/roleplay$/, '/api/health')).then(function (r) { return r.ok ? r.json() : null; });
      request.then(function (data) {
        if (!data) throw new Error('no answer');
        var list = (data.data || data.models || []);
        if (list.length) {
          if ($('f_model')) $('f_model').value = $('f_model').value || String(list[0].id || list[0].name || '');
          say('answering · ' + list.length + ' model' + (list.length === 1 ? '' : 's') +
            ' · ' + RP.clip(String(list[0].id || list[0].name || ''), 28), mine);
        } else {
          say(data.lm_studio && data.lm_studio.online ? 'answering · model online' : 'answering', mine);
        }
        // The thinking check: one tiny completion with thinking disabled.
        // If reasoning tokens still come back, the flag did not take and
        // every reply will burn its budget deliberating — say so NOW,
        // in the settings panel, not five minutes into a scene.
        if (!isOpenAI(url) || !list.length) return;
        var m = $('f_model') ? $('f_model').value.trim() : '';
        if (!m) return;
        fetch(chatRoute(url), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: m, stream: false, max_tokens: 40, temperature: 0,
            chat_template_kwargs: { enable_thinking: false },
            messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          }),
        }).then(function (r) { return r.json(); }).then(function (v) {
          var usage = (v && v.usage) || {};
          var thought = Number((usage.completion_tokens_details || {}).reasoning_tokens || 0);
          var choice = ((v || {}).choices || [])[0] || {};
          if (!thought && choice.message && String(choice.message.reasoning_content || '').trim()) thought = 1;
          say($('setState').textContent + (thought
            ? ' · ⚠ this model still THINKS (' + thought + ' reasoning tokens) — the off switch did not take; use an instruct build (e.g. qwen2.5-7b-instruct-1m)'
            : ' · thinking off ✓'), mine);
        }).catch(function () { /* the list already proved the endpoint */ });
      }).catch(function () { say('no answer — is it running?', mine); });
    };
    $('mOk').onclick = function () {
      state.settings.endpoint = $('f_endpoint').value.trim();
      state.settings.model = $('f_model').value.trim();
      var ctx = parseInt($('f_context').value, 10);
      if (!isNaN(ctx)) state.settings.context = Math.max(4, Math.min(240, ctx));
      var upk = parseInt($('f_upkeep').value, 10);
      if (!isNaN(upk)) state.settings.upkeep = Math.max(0, Math.min(24, upk));
      var hist = parseInt($('f_historyChars').value, 10);
      if (!isNaN(hist)) state.settings.historyChars = Math.max(3000, Math.min(60000, hist));
      var pbud = parseInt($('f_promptBudget').value, 10);
      if (!isNaN(pbud)) state.settings.promptBudget = Math.max(6000, Math.min(RP.PROMPT_BUDGET_MAX, pbud));
      state.settings.length = $('f_length').value;
      state.settings.world = $('f_world').value;
      state.settings.audience = $('f_audience') ? $('f_audience').value : (state.settings.audience || RP.AUDIENCE_DEFAULT);
      state.settings.fresh = $('f_fresh') ? $('f_fresh').value : (state.settings.fresh || RP.FRESH_DEFAULT);
      state.settings.antiRepetition = $('f_antiRepetition') ? $('f_antiRepetition').value : (state.settings.antiRepetition || RP.ANTI_REPETITION_DEFAULT);
      state.settings.antiGeneric = $('f_antiGeneric') ? $('f_antiGeneric').value : (state.settings.antiGeneric || RP.ANTI_GENERIC_DEFAULT);
      state.settings.fate = $('f_fate') ? $('f_fate').value : (state.settings.fate || 'normal');
      state.settings.hurt = $('f_hurt') ? $('f_hurt').value : (state.settings.hurt || 'on');
      state.settings.director = $('f_director') ? $('f_director').value : (state.settings.director || 'on');
      state.settings.voice = $('f_voice') ? $('f_voice').value : state.settings.voice;
      var chain = $('f_maxChain') ? parseInt($('f_maxChain').value, 10) : NaN;
      if (!isNaN(chain)) state.settings.maxChain = Math.max(1, Math.min(12, chain));
      state.settings.narrator = $('f_narrator').value;
      var auto = parseInt($('f_autoplay').value, 10);
      if (!isNaN(auto)) state.settings.autoplay = Math.max(2, Math.min(20, auto));
      var next = {};
      ['top_p', 'top_k', 'repeat_penalty', 'min_p', 'xtc_probability', 'dry_multiplier'].forEach(function (k) {
        var raw = ($('f_' + k).value || '').trim();
        if (raw !== '' && !isNaN(parseFloat(raw))) next[k] = parseFloat(raw);
      });
      state.settings.sampler = next;
      state.settings.utilityModel = $('f_utilityModel').value.trim();
      state.settings.background = $('f_background') ? $('f_background').value : (state.settings.background || RP.BACKGROUND_DEFAULT);
      if ($('f_cacheLayout')) state.settings.cacheLayout = $('f_cacheLayout').value;
      state.settings.utilityEndpoint = $('f_utilityEndpoint').value.trim();
      state.settings.style = $('f_style').value;
      var t = parseFloat($('f_temperature').value);
      if (!isNaN(t)) state.settings.temperature = Math.max(0, Math.min(1.5, t));
      closeModal();
      save(); render(); checkHealth();
    };
  }

  /** Perspective replay: pick the new vantage, then the people who hold it. */
  function replayPicker(id) {
    var source = (state.rooms || []).filter(function (r) { return r.id === id; })[0];
    if (!source && id.indexOf('scene:') === 0) {
      var scene = scenes.filter(function (s) { return 'scene:' + s.id === id; })[0];
      if (!scene) return;
      source = { id: '', title: scene.name, sceneName: scene.name, scene: scene.summary, sceneImage: scene.image, beats: scene.beats, messages: [], cast: [] };
    }
    if (!source) return;
    form('Replay “' + RP.clip(source.title, 40) + '”', [
      { k: 'perspective', label: 'Whose perspective?', type: 'area', value: '', },
    ], { note: 'The same hours, the same beats, seen from somewhere else. Then pick who is standing there.', ok: 'Pick the cast' }, function (v) {
      castPicker({ title: 'Who plays this perspective?', note: v.perspective || 'The new vantage point.', suggest: true }, function (picked) {
        var replay = RP.replayRoom(state, source, picked, {
          perspective: v.perspective || picked.map(function (c) { return c.name; }).join(', '),
        });
        applyDefaultPlayer(replay);
        state.rooms.unshift(replay);
        state.active = replay.id;
        save(); render();
        toast('Replay opened — the beats will fire on their own.');
      });
    });
  }

  /* ---------------------------------------------------------------- *
   * files
   * ---------------------------------------------------------------- */

  /** Read a file the reader picked, as text or as bytes. */
  function pickFile(accept, as, done) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        done(as === 'bytes' ? new Uint8Array(reader.result) : String(reader.result), file);
      };
      if (as === 'bytes') reader.readAsArrayBuffer(file); else reader.readAsText(file);
    };
    input.click();
  }

  function downloadBytes(name, bytes, type) {
    var url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function download(name, text) {
    var blob = new Blob([text], { type: /\.json$/.test(name) ? 'application/json' : 'text/markdown' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importFile(mode) {
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      file.text().then(function (text) {
        var stats = RP.importBundle(state, JSON.parse(text), mode);
        save(); render();
        toast(bundleReport(stats) + (stats.lore || stats.chars || stats.log
          ? ' Plus ' + (stats.lore || 0) + ' lore, ' + (stats.chars || 0) + ' memories, ' + (stats.log || 0) + ' log lines.' : ''));
      }).catch(function (error) { toast('Import failed: ' + error.message); });
    };
    input.click();
  }

  /* ---------------------------------------------------------------- *
   * boot
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   * 🎨 Appearance — how the page looks, kept in state.settings.look
   * ---------------------------------------------------------------- */
  var LOOK = {
    theme: { label: 'Theme', options: [['light', 'Light'], ['sepia', 'Sepia — paper'], ['dusk', 'Dusk — dark']] },
    size: { label: 'Text size', options: [['s', 'Small'], ['m', 'Normal'], ['l', 'Large'], ['xl', 'Larger']] },
    font: { label: 'Prose face', options: [['sans', 'Sans'], ['serif', 'Serif — book'], ['mono', 'Mono — typewriter']] },
    width: { label: 'Column width', options: [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']] },
    density: { label: 'Spacing', options: [['cosy', 'Cosy'], ['compact', 'Compact']] },
    mood: { label: 'Mood colour on the boxes', options: [['full', 'Full wash'], ['soft', 'Just the edge'], ['off', 'Off']] },
    words: { label: 'Coloured words ({like this})', options: [['on', 'Coloured'], ['off', 'Plain']] },
    badges: { label: 'Badges on turns (archive, meanwhile, consulted)', options: [['on', 'Shown'], ['off', 'Hidden']] },
    stamps: { label: 'Time on each turn', options: [['off', 'Hidden'], ['on', 'Shown']] },
    portraits: { label: 'Portraits beside turns', options: [['on', 'Shown'], ['off', 'Hidden']] },
    enter: { label: 'Send with', options: [['enter', 'Enter (Shift+Enter for a new line)'], ['ctrl', 'Ctrl+Enter (Enter for a new line)']] },
  };
  var LOOK_DEFAULTS = {};
  Object.keys(LOOK).forEach(function (k) { LOOK_DEFAULTS[k] = LOOK[k].options[0][0]; });
  LOOK_DEFAULTS.size = 'm'; LOOK_DEFAULTS.width = 'normal';

  function look() {
    var l = Object.assign({}, LOOK_DEFAULTS, state.settings.look || {});
    Object.keys(LOOK).forEach(function (k) {
      if (!LOOK[k].options.some(function (o) { return o[0] === l[k]; })) l[k] = LOOK_DEFAULTS[k];
    });
    return l;
  }

  /** The look lives on <html> as data- attributes; the stylesheet reads them. */
  function applyLook() {
    var l = look(), root = document.documentElement;
    Object.keys(LOOK).forEach(function (k) {
      if (l[k] === LOOK_DEFAULTS[k]) root.removeAttribute('data-' + k); else root.setAttribute('data-' + k, l[k]);
    });
  }

  function stamp(m) {
    if (look().stamps !== 'on' || !m || !m.at) return '';
    var d = new Date(m.at);
    var hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    return '<span class="stamp" title="' + esc(d.toLocaleString()) + '">' + hh + ':' + mm + '</span>';
  }

  function lookForm() {
    var l = look();
    openModal('<h3>🎨 Appearance</h3>' +
      '<p class="sub">How the page reads. Everything here changes as you pick it, and is kept with your settings. The mood wash and ' +
      'the coloured words are only the look — the sheets and moods underneath are unchanged.</p>' +
      '<div class="grid2">' + Object.keys(LOOK).map(function (k) {
        return '<label for="lk_' + k + '">' + esc(LOOK[k].label) + '</label><select id="lk_' + k + '" data-look="' + k + '">' +
          LOOK[k].options.map(function (o) { return '<option value="' + o[0] + '"' + (l[k] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
          '</select>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="pill" id="mReset">Back to the defaults</button><span class="grow"></span><button class="pill primary" id="mOk">Done</button></div>');
    $('modal').querySelectorAll('[data-look]').forEach(function (sel) {
      sel.onchange = function () {
        state.settings.look = state.settings.look || {};
        state.settings.look[sel.getAttribute('data-look')] = sel.value;
        applyLook(); save(); render();
      };
    });
    $('mReset').onclick = function () { state.settings.look = {}; applyLook(); save(); render(); lookForm(); };
    $('mOk').onclick = closeModal;
  }

  function openCreateDialog() {
    openModal(
      '<h3>✨ Create Chat or Scene</h3>' +
      '<p class="sub">Describe the scene you want to play. Existing characters from the archive will be matched automatically, and new NPCs created on the fly — or pick the cast manually.</p>' +
      '<div class="field" style="margin-bottom:12px;">' +
      '<label for="sceneDescInput"><b>Scene Description</b></label>' +
      '<textarea id="sceneDescInput" rows="4" style="width:100%;box-sizing:border-box;margin-top:6px;padding:8px;font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:6px;resize:vertical;" placeholder="e.g. Waluigi and Wario cornering a nervous clerk in the counting house over an unpaid invoice, while an armored guard watches from the stone archway..."></textarea>' +
      '</div>' +
      '<div class="actions">' +
      '<button class="pill" id="mManualCast">👥 Pick Cast Manually</button>' +
      '<span class="grow"></span>' +
      '<button class="pill" id="mCancelCreate">Cancel</button>' +
      '<button class="pill primary" id="mGenerateScene">🎬 Start Scene</button>' +
      '</div>'
    );
    $('mCancelCreate').onclick = closeModal;
    $('mManualCast').onclick = function () {
      closeModal();
      castPicker({ title: 'Create a chat', note: 'One character is a one-to-one chat; two or more opens a group.', suggest: false }, function (picked) {
        picked.length > 1 ? startGroup(picked) : startSolo(picked[0]);
      });
    };
    $('mGenerateScene').onclick = function () {
      var desc = ($('sceneDescInput') && $('sceneDescInput').value || '').trim();
      closeModal();
      if (!desc) {
        castPicker({ title: 'Create a chat', note: 'One character is a one-to-one chat; two or more opens a group.', suggest: false }, function (picked) {
          picked.length > 1 ? startGroup(picked) : startSolo(picked[0]);
        });
        return;
      }
      var parsed = RP.parseSceneDescription(desc, archive, castById);
      var roomCast = (parsed.cast || []).slice();
      if (roomCast.length === 0) {
        var fallbackId = (state.user && state.user.playAs) || 'waluigi';
        if (castById[fallbackId]) roomCast.push(castById[fallbackId]);
        else if (cast.length > 0) roomCast.push(cast[0]);
      }
      var r = RP.newRoom(roomCast, {
        scene: desc,
        sceneName: 'Scene — ' + RP.clip(desc, 40),
        style: (state.settings && state.settings.style) || RP.DEFAULT_STYLE,
        persona: (state.user && state.user.persona) || '',
        statePreset: (state.settings && state.settings.statePreset) || 'rpg',
        mechanics: (state.settings && state.settings.mechanics) || 'on',
        opener: 'Scene — ' + RP.clip(desc, 120),
      });
      (parsed.newChars || []).forEach(function (npc) {
        RP.inventCharacter(state, r, npc);
      });
      pushRoom(r);
      toast('🎬 Scene opened with ' + r.cast.map(function (c) { return c.name; }).join(', ') + '.');
    };
    setTimeout(function () {
      if ($('sceneDescInput')) $('sceneDescInput').focus();
    }, 50);
  }

  function render() {
    applyLook();
    renderRail();
    if (room()) renderChat(); else renderDash();
    renderStatus();
  }

  function wireShell() {
    $('createBtn').onclick = openCreateDialog;
    $('search').oninput = function () { query = $('search').value.trim(); tab = 'discover'; state.active = ''; renderDash(); renderRail(); };
    $('account').onclick = accountForm;
    $('settingsBtn').onclick = settingsForm;
    $('homeBtn').onclick = function () { state.active = ''; tab = 'discover'; save(); render(); };
    var input = $('input');
    $('composer').onsubmit = function (e) { e.preventDefault(); send(); };
    input.oninput = function () {
      $('send').disabled = !input.value.trim();
      input.style.height = 'auto';
      input.style.height = Math.min(150, input.scrollHeight) + 'px';
    };
    input.onkeydown = function (e) {
      if (e.key !== 'Enter') return;
      var ctrl = e.ctrlKey || e.metaKey;
      if (enterSends() ? (!e.shiftKey || ctrl) : ctrl) { e.preventDefault(); send(); }
    };
    $('menuBtn').onclick = function () { document.querySelector('.rail').classList.toggle('open'); };
  }

  /** Enter sends by default; the Appearance settings can make it Ctrl+Enter. */
  function enterSends() { return ((state.settings.look || {}).enter || 'enter') !== 'ctrl'; }

  wireShell();
  render();
  checkHealth();
  // A portrait whose file is gone shows initials, not a broken image.
  // Image errors do not bubble; they are caught on the way down.
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    var box = img.parentNode;
    if (!box || !box.classList || !box.classList.contains('av') || !box.getAttribute('data-nm')) return;
    box.style.background = box.getAttribute('data-tint') || '#5b5b66';
    box.textContent = box.getAttribute('data-nm');
    box.setAttribute('data-broken', '1');
  }, true);
  /* ---------------------------------------------------------------- *
   * quality of life: the keys you already expect to work
   * ---------------------------------------------------------------- */
  window.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '');
    if (e.key === 'Escape') {
      if (!$('modalBack').hidden) { closeModal(); return; }
      if (anythingRunning()) { stopAll(); return; }
      if (!$('chatview').hidden) { $('homeBtn').click(); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && $('input') === document.activeElement) {
      e.preventDefault(); $('composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && $('input_b') && $('input_b') === document.activeElement) {
      e.preventDefault(); $('composer_b').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return;
    }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && room()) {
      e.preventDefault();
      var what = e.shiftKey ? RP.redo(room()) : RP.undo(room());
      save(); render();
      toast(what ? (e.shiftKey ? 'Redid ' : 'Undid ') + what + '.' : 'Nothing to ' + (e.shiftKey ? 'redo' : 'undo') + '.');
      return;
    }
    if (e.key === '/') { e.preventDefault(); if ($('search')) $('search').focus(); return; }
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !$('chatview').hidden) { e.preventDefault(); generate(); return; }
    if (e.key === '?' ) { e.preventDefault(); shortcutsHelp(); }
  });

  function shortcutsHelp() {
    openModal('<h3>Keyboard</h3><div class="stack">' + [
      ['Esc', 'close a dialog, or leave the chat'],
      ['Ctrl / ⌘ + Enter', 'send your turn'],
      ['/', 'jump to search'],
      ['n', 'let the next character speak'],
      ['?', 'this list'],
    ].map(function (row) {
      return '<div class="item"><b>' + row[0] + '</b><p>' + row[1] + '</p></div>';
    }).join('') + '</div><div class="actions"><button class="pill primary" id="mCancel">Close</button></div>');
    $('mCancel').onclick = closeModal;
  }

  loadCast()
    .then(function () { return Promise.all([loadScenes(), loadWire(), loadCollections()]); })
    .then(loadArchive)
    .then(function () {
      buildBoard(); render();
      if (!styleWasMigrated || !lengthWasMigrated) save();   // the flags, so this happens once
      if (migratedRooms) {
        toast('✨ ' + migratedRooms + (migratedRooms === 1 ? ' chat now plays' : ' chats now play') +
          ' “In character” — first person, in their own voice. Style in the character panel brings Novel back.');
      }
      if (migratedLength) {
        window.setTimeout(function () {
          toast('✂ Replies now size themselves to the moment — a retort stays short, a reveal gets its paragraph. ' +
            '⚙ Settings → “How long should a reply be?” pins a length again.');
        }, migratedRooms ? 4000 : 600);
      }
    });
})();
