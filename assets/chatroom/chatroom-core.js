/* Waluipedia chatroom — pure logic.
 *
 * Everything in this file is DOM-free on purpose. It is the same block that
 * ships inlined into workflow/roleplay.html as <script id="rp-logic"> (see
 * tools/build-chatroom.py), and tools/tests/test-roleplay-page.mjs runs it
 * headlessly with nothing but a fake `window`, a fake `crypto` and a fake
 * localStorage. If you reach for `document` here, the tests stop working.
 *
 * What lives here:
 *   markdown     the narration renderer (*actions*, **bold**, "speech")
 *   characters   normalisation, per-character voices, letter dividers
 *   prompts      solo / group / persona / style / script / memory / lore
 *   rooms        creation, history for the model, counters, transcripts
 *   script       scene beats that fire on their own schedule
 *   wire         WAHwire posts → scenarios, sorting, used/unused tracking
 *   collections  the archive's own character collections → instant casts
 *   director     who speaks next in a group, and when it comes back to you
 *   memory       cross-chat log, per-character memory, world lore
 *   replay       re-playing a filed chat from another perspective
 *   data         localStorage state, import / export bundles
 */
(function () {
  'use strict';

  var RP = {};

  /* ------------------------------------------------------------------ *
   * small helpers
   * ------------------------------------------------------------------ */

  function uid() {
    try {
      if (typeof crypto !== 'undefined' && crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* fall through to the clock */ }
    return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  RP.uid = uid;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }
  RP.esc = esc;

  /** Shorten text without leaving a word cut in half. Prefers the last
   *  sentence that fits, falls back to the last whole word, and only ever
   *  marks the cut when something was actually dropped. Cutting a status
   *  line mid-word ("the only witness w…") is the kind of thing that makes
   *  a model hallucinate the rest of it. */
  function clip(value, limit) {
    var text = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
    if (!limit || text.length <= limit) return text;
    var head = text.slice(0, limit);
    // A sentence end in the last third of what fits is the nicest cut.
    var sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    if (sentence > limit * 0.6) return head.slice(0, sentence + 1).trim();
    var space = head.lastIndexOf(' ');
    return (space > limit * 0.4 ? head.slice(0, space) : head).trim().replace(/[,;:—-]+$/, '') + '…';
  }
  RP.clip = clip;

  // Stable small integer from a string: used for voices and avatar tints so a
  // character looks and sounds the same in every browser, with no stored state.
  function hash(value) {
    var h = 2166136261, text = String(value || '');
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  RP.hash = hash;

  function slug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  RP.slug = slug;

  /* ------------------------------------------------------------------ *
   * narration markdown
   * ------------------------------------------------------------------ */

  /* A small, safe palette plus #rrggbb. The model writes {red|the door}
   * and the reader sees it in red — nothing else gets through. */
  RP.COLOURS = {
    red: '#c0392b', blood: '#8e2b20', orange: '#c26a1c', amber: '#b3861a', gold: '#a8862c',
    green: '#2f7d4f', teal: '#1f7a72', blue: '#2b5fb3', ice: '#4a8fc7', violet: '#6b46c1',
    purple: '#7a2fb0', pink: '#b5347c', grey: '#6b6b74', gray: '#6b6b74', black: '#1a1a1c',
    white: '#f4f4f6', rust: '#9c5221', moss: '#5c7a3f', bone: '#c8bda4',
    crimson: '#9b1b30', ember: '#b4551f', copper: '#a56a3a', silver: '#8e9196', storm: '#4c5a6e',
    sea: '#2e6f8e', jade: '#2f8f6f', lilac: '#8f7cc9', sand: '#a8905a', venom: '#5f8f2f', plum: '#6d3557',
  };

  function colourValue(name) {
    var key = String(name || '').trim().toLowerCase();
    if (RP.COLOURS[key]) return RP.COLOURS[key];
    if (/^#[0-9a-f]{3}$/i.test(key) || /^#[0-9a-f]{6}$/i.test(key)) return key;
    return '';
  }
  RP.colourValue = colourValue;

  /** The forgiving ear: models write “glowing violet” and “dark red”,
   *  and a palette that silently refuses both is why nobody ever saw a
   *  tint. Take the exact colour if it is one; otherwise find the colour
   *  WORD inside the phrase (last one wins: “blood red” reads red).
   *  Pure junk still returns '' — the palette refuses javascript. */
  function colourLoose(name) {
    var exact = colourValue(name);
    if (exact) return exact;
    var words = String(name || '').toLowerCase().split(/[^a-z#0-9]+/).filter(Boolean);
    for (var i = words.length - 1; i >= 0; i--) {
      var hit = colourValue(words[i]);
      if (hit) return hit;
    }
    return '';
  }
  RP.colourLoose = colourLoose;

  function tintSpan(value, body) {
    return '<span class="tint" style="color:' + value + '">' + body + '</span>';
  }
  /** Coloured words, in every shape a model writes them. The documented
   *  form is {red|the door}; what actually arrives is also {the door|red},
   *  {red: the door}, {red}the door{/red}, [red]the door[/red],
   *  <red>the door</red> — and, most often of all, a bare {the door} with
   *  no colour at all. A bare brace means "colour this", and the colour it
   *  gets is the speaker's mood (the --mood-ink of the card), or a plain
   *  ember when they are calm. Pure junk is left as written. */
  function colourInline(text) {
    return String(text)
      // {red|the door} · {dark red|the door} · {#c0392b|the door}
      .replace(/\{([a-z][a-z0-9 _-]{1,24}|#[0-9a-f]{3,6})\s*\|\s*([^{}]{1,400}?)\}/gi, function (all, name, body) {
        var value = colourLoose(name);
        return value ? tintSpan(value, body) : all;
      })
      // {the door|red} — the same thing, backwards
      .replace(/\{([^{}|]{1,400}?)\s*\|\s*([a-z][a-z0-9 _-]{1,24}|#[0-9a-f]{3,6})\}/gi, function (all, body, name) {
        var value = colourLoose(name);
        return value ? tintSpan(value, body) : all;
      })
      // {red: the door}
      .replace(/\{([a-z][a-z0-9 _-]{1,24}|#[0-9a-f]{3,6}):\s*([^{}]{1,400}?)\}/gi, function (all, name, body) {
        var value = colourLoose(name);
        return value ? tintSpan(value, body) : all;
      })
      // {red}the door{/red} · [red]the door[/red] · <red>the door</red> (escaped by now)
      .replace(/\{([a-z][a-z0-9 _-]{1,24})\}([^{}]{1,400}?)\{\/\1\}/gi, function (all, name, body) {
        var value = colourLoose(name);
        return value ? tintSpan(value, body) : all;
      })
      .replace(/\[([a-z][a-z0-9 _-]{1,24})\]([^\[\]]{1,400}?)\[\/\1\]/gi, function (all, name, body) {
        var value = colourLoose(name);
        return value ? tintSpan(value, body) : all;
      })
      .replace(/&lt;([a-z][a-z0-9 _-]{1,24})&gt;([^&]{1,400}?)&lt;\/\1&gt;/gi, function (all, name, body) {
        var value = colourLoose(name);
        return value ? tintSpan(value, body) : all;
      })
      // {pissed} — no colour named: the mood's colour, or an ember
      .replace(/\{([^{}|:\n]{1,80})\}/g, function (all, body) {
        if (!/[a-z]/i.test(body)) return all;
        return '<span class="tint mood">' + body + '</span>';
      });
  }
  RP.colourInline = colourInline;

  function inlineMd(text) {
    return colourInline(text)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/&quot;([^&]*?)&quot;/g, '<span class="q">&quot;$1&quot;</span>');
  }

  /** Render roleplay prose: HTML is escaped first, then *actions* become
   *  italics, **notes** bold, "speech" a styled quote, and `- ` lines a list. */
  RP.md = function (text) {
    var lines = esc(text).split(/\r?\n/);
    var out = [], list = null;
    function flush() { if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var bullet = /^\s*(?:-|•)\s+(.*)$/.exec(line);
      if (bullet) { (list = list || []).push('<li>' + inlineMd(bullet[1]) + '</li>'); continue; }
      flush();
      if (!line.trim()) { out.push(''); continue; }
      out.push('<p>' + inlineMd(line) + '</p>');
    }
    flush();
    return out.filter(Boolean).join('');
  };

  /* ---- standing tints: words the model has chosen a colour for ---- */

  /** The model files [[TINT: the seal, the wax = violet]] once, and those
   *  exact words keep the colour in every turn after — reader-side, so a
   *  tinted phrase costs the prompt nothing. Runs on the raw prose before
   *  RP.md, and never re-colours inside a {colour|…} the writer already
   *  chose for that sentence. */
  RP.applyTints = function (text, tints) {
    var rules = (tints || []).filter(function (t) { return t && t.text && colourValue(t.colour); });
    if (!rules.length) return String(text || '');
    rules = rules.slice().sort(function (a, b) { return String(b.text).length - String(a.text).length; });
    return String(text || '').split(/(\{[^{}|]{1,12}\|[^{}]{1,300}\})/).map(function (chunk, at) {
      if (at % 2) return chunk;                 // already coloured by hand
      rules.forEach(function (t) {
        var safe = String(t.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        chunk = chunk.replace(new RegExp('(^|[^{|\\w])(' + safe + ')(?![\\w}])', 'gi'), function (all, pre, hit) {
          return pre + '{' + t.colour + '|' + hit + '}';
        });
      });
      return chunk;
    }).join('');
  };

  /* ------------------------------------------------------------------ *
   * characters
   * ------------------------------------------------------------------ */

  /** `faiths` on a record is a string on older entries and a list of
   *  {id, role, note} objects on newer ones. Either way the card wants a
   *  short line, never "[object Object]". */
  function faithLine(value) {
    if (!value) return '';
    if (typeof value === 'string') return clip(value, 90);
    var list = Array.isArray(value) ? value : [value];
    return clip(list.map(function (f) {
      if (!f) return '';
      if (typeof f === 'string') return f;
      var name = String(f.name || f.id || '').replace(/_/g, ' ');
      return name + (f.role ? ' (' + f.role + ')' : '');
    }).filter(Boolean).join('; '), 160);
  }
  RP.faithLine = faithLine;

  /** One archive record → one playable character card. */
  RP.normChar = function (record) {
    record = record || {};
    var name = clip(record.name || record.id || 'Unnamed', 60);
    var out = {
      id: String(record.id || slug(name) || uid()),
      name: name,
      title: clip(record.title, 200),
      race: clip(record.race, 60),
      affiliation: clip(record.affiliation, 160),
      // A filed status is a sentence or three about where somebody is right
      // now. It is the most useful line in the record; do not amputate it.
      status: clip(record.status, 480),
      summary: clip(record.summary || record.description, 600),
      // The filed description is what makes a character behave like
      // themselves rather than like a name with a voice, so it travels with
      // them into the prompt instead of being thrown away at load.
      description: clip(record.description, 1400),
      faction: clip(record.faction || record.membership, 80),
      faiths: faithLine(record.faiths),
      level: Number(record.level || 0) || 0,
      powerLevel: Number(record.powerLevel || 0) || 0,
      fameScore: Number(record.fameScore || 0) || 0,
      fameTier: clip(record.fameTier, 40),
      image: String(record.image || ''),
      // The filing account behind the card. Characters carry their own when
      // the archive records one; otherwise the archive itself is the author.
      handle: String(record.handle || record.creator || 'waluipedia').replace(/^@/, ''),
      tags: Array.isArray(record.tags) ? record.tags.slice(0, 8).map(String) : [],
      // Referenced filings: the backfill scan reads these to find the events
      // everybody points at and nobody wrote.
      keyEvents: Array.isArray(record.keyEvents) ? record.keyEvents.slice(0, 12).map(String) : [],
      relatedArticles: Array.isArray(record.relatedArticles) ? record.relatedArticles.slice(0, 14).map(String) : [],
    };
    // The things that make a character sound like themselves travel with
    // them into the room. Until now a seat at the table re-read the record
    // and dropped these — so an imported card's example dialogue, and the
    // archive's own voice sheets, never reached the prompt.
    if (record.voice && typeof record.voice === 'object') out.voice = record.voice;
    if (record.card && typeof record.card === 'object') out.card = record.card;
    if (record.look) out.look = clip(record.look, 300);
    if (record.invented) out.invented = true;
    return out;
  };

  RP.letterFor = function (name) {
    var first = String(name || '').trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(first) ? first : '#';
  };

  /** Cast browser dividers: A…Z in order, then '#' for digits and symbols. */
  RP.groupByLetter = function (chars) {
    var map = {};
    (chars || []).forEach(function (c) {
      var letter = RP.letterFor(c && c.name);
      (map[letter] = map[letter] || []).push(c);
    });
    return Object.keys(map).sort(function (a, b) {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    }).map(function (letter) {
      return {
        letter: letter,
        chars: map[letter].slice().sort(function (a, b) {
          return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1;
        }),
      };
    });
  };

  /** A stable speech-synthesis voice per character — same pitch every time. */
  RP.voiceFor = function (char) {
    var h = hash((char && (char.id || char.name)) || 'voice');
    return {
      rate: Math.round((0.95 + ((h % 21) / 100)) * 100) / 100,          // 0.95 … 1.15
      pitch: Math.round((0.7 + (((h >>> 5) % 71) / 100)) * 100) / 100,   // 0.70 … 1.40
    };
  };

  /* ---- Qwen studio voices: which saved profile speaks a line ----
     The local Qwen3-TTS studio keeps voice profiles under plain names
     (Waluigi, Luigi, Wario, Freeman…). A speaker links to a profile by
     FIRST NAME — when Wario talks, the studio's 'Wario' profile reads
     the line — with a hand-written map for the exceptions and a
     fallback for everyone the studio has never heard of. */

  /** 'wario = Wario Grande | toad=Toad' (newlines or | between entries)
   *  → { wario: 'Wario Grande', toad: 'Toad' }. Keys lowercased. */
  RP.parseVoiceMap = function (text) {
    var map = {};
    String(text || '').split(/[\n|]+/).forEach(function (entry) {
      var at = entry.indexOf('=');
      if (at < 0) return;
      var key = entry.slice(0, at).trim().toLowerCase();
      var val = entry.slice(at + 1).trim();
      if (key && val) map[key] = val;
    });
    return map;
  };

  /** The studio profile that speaks for `name`. Hand-written map first
   *  (full name, then first name). When the studio's actual library is
   *  known it is the authority AND the speller: whatever is picked —
   *  map entry, guess, or fallback — is case-corrected to the saved
   *  profile ('wario' is sent as 'Wario', because the studio's dropdown
   *  is case-sensitive and refuses anything not in its list). Without
   *  a library, known misses go to the fallback and everyone else is
   *  tried under their capitalized first name. */
  RP.ttsVoiceFor = function (name, opts) {
    opts = opts || {};
    var fallback = opts.fallback || 'Waluigi';
    var lib = opts.library;
    var inLib = function (want) {
      var low = String(want || '').toLowerCase();
      return (lib || []).find(function (v) { return String(v).toLowerCase() === low; }) || '';
    };
    var full = String(name || '').trim();
    if (!full) return (lib && lib.length && inLib(fallback)) || fallback;
    var map = opts.map || {};
    var first = full.split(/\s+/)[0].replace(/[,.:;!?]+$/, '');
    var picked = map[full.toLowerCase()] || map[first.toLowerCase()] || '';
    if (lib && lib.length) {
      // the library decides, and spells: picked name, else the speaker
      // themselves — each in the studio's own casing
      var found = inLib(picked) || inLib(full) || inLib(first);
      if (found) return found;
      // Absent from the list — but the list can LIE: Gradio's /config is
      // a boot-time snapshot, and a profile saved while the studio runs
      // (its library table shows it!) never appears there until a
      // restart. Unless a real attempt already failed, ask the studio
      // for the voice anyway: a refusal costs one fast error, marks the
      // miss, and the fallback takes over from that line on.
      if (!(opts.misses || {})[first.toLowerCase()]) {
        return picked || first.charAt(0).toUpperCase() + first.slice(1);
      }
      return inLib(fallback) || fallback;
    }
    if (picked) return picked;
    if ((opts.misses || {})[first.toLowerCase()]) return fallback;
    return first.charAt(0).toUpperCase() + first.slice(1);
  };

  /** What the studio's SSE stream said when it did not finish — and
   *  whether that was the VOICE being turned away or the synthesis itself
   *  falling over. Gradio refuses a profile its dropdown has not been told
   *  about with "Value: Wario is not in the list of choices"; a CUDA
   *  hiccup, a timeout or an empty render says something else entirely,
   *  and for a whole session the page used to treat both the same: one
   *  bad render and Wario spoke in Waluigi's voice until a page reload.
   *  Returns null when the stream completed. */
  RP.studioError = function (body) {
    var text = String(body || '');
    if (!/event:\s*error/.test(text)) return null;
    var said = /event:\s*error\s*\n(?:id:[^\n]*\n)?data:\s*([^\n]*)/.exec(text);
    var raw = said ? said[1].trim() : '';
    var message = '';
    if (raw && raw !== 'null') {
      try {
        var parsed = JSON.parse(raw);
        message = typeof parsed === 'string' ? parsed
          : (parsed && (parsed.message || parsed.error || parsed.detail || parsed.msg)) || '';
      } catch (e) { message = raw; }
    }
    message = String(message || '').replace(/\s+/g, ' ').trim();
    var refused = /not in the list|not a valid (choice|voice|value)|unknown (voice|profile|speaker)|no such (voice|profile)|(voice|profile)[^.]{0,40}(not found|does not exist|doesn\u2019t exist|doesn't exist)|invalid (voice|profile)/i.test(message);
    return {
      message: message || 'the studio reported an error',
      refused: refused,
    };
  };

  /** Grandfather an old chat onto the current systems: re-read the cast
   *  from the archive's current profiles, mend every sheet to the current
   *  shape, and re-run the star rules (the starred character IS the
   *  player). Returns human lines describing what it did — the stream
   *  shows the receipt. Play state (HP, items, history) is untouched. */
  RP.fixRoom = function (state, room, catalog) {
    if (!room) return [];
    var lines = [];
    catalog = catalog || {};
    var refreshed = [];
    (room.cast || []).forEach(function (c, i) {
      var fresh = catalog[c.id];
      if (!fresh) return;
      var now = RP.normChar(Object.assign({}, fresh, { id: c.id }));
      if (JSON.stringify(now) !== JSON.stringify(c)) { room.cast[i] = now; refreshed.push(now.name); }
    });
    if (refreshed.length) lines.push('cast re-read from the archive: ' + refreshed.join(', '));
    // A false arrival — a list header or stray phrase the scanner once
    // admitted — leaves the cast, the sheets and the speaker rail here.
    var bogus = (room.cast || []).filter(function (c) {
      return !catalog[c.id] && (NOT_NAME.test(c.name || '') || NOT_NAME_TAIL.test(c.name || ''));
    }).map(function (c) { return c.id; });
    if (bogus.length) {
      var gone = [];
      room.cast = room.cast.filter(function (c) {
        if (bogus.indexOf(c.id) < 0) return true;
        gone.push(c.name); return false;
      });
      bogus.forEach(function (id) { if (room.states) delete room.states[id]; });
      room.away = (room.away || []).filter(function (a) { return bogus.indexOf(a && a.id) < 0; });
      if (room.youPlay && bogus.indexOf(room.youPlay) >= 0) room.youPlay = '';
      lines.push('removed a false arrival: ' + gone.join(', ') + ' \u2014 a phrase is not a person');
    }
    var mended = 0;
    Object.keys(room.states || {}).forEach(function (k) {
      var sheet = room.states[k];
      if (!sheet) return;
      var before = JSON.stringify(sheet);
      sheet.flags = sheet.flags || {};
      sheet.counters = sheet.counters || {};
      sheet.items = Array.isArray(sheet.items) ? sheet.items : [];
      if (sheet.present === undefined) sheet.present = true;
      if (before !== JSON.stringify(sheet)) mended++;
    });
    if (mended) lines.push(mended + ' sheet' + (mended === 1 ? '' : 's') + ' mended to the current shape');
    if (room.mechanics !== 'off' && state) {
      var pack = RP.ensurePlayerSheet(state, room);
      if (pack) lines.push('your pack: ' + pack.name + (room.youPlay ? ' — the starred character' : ' — the persona'));
    }
    room.updated = Date.now();
    return lines;
  };

  /** What a model failure actually means, in words a player can act on.
   *  Every failure used to say “check CORS” — including context overflows
   *  and empty replies, which have nothing to do with CORS. */
  RP.modelAdvice = function (message, openai) {
    var m = String(message || '');
    if (/timed out after/i.test(m)) {
      return 'The model may be overloaded or hung — try a smaller model, or press ↻ when it has calmed down.';
    }
    if (/context|exceeds? the available|too (?:long|large|many tokens)/i.test(m)) {
      return 'The request was bigger than the model’s context window — lower the history budget in ⚙, or raise the context size in LM Studio.';
    }
    if (/thinking and wrote no prose/i.test(m)) {
      return 'Use a non-thinking (instruct) build — ⚙ → Test it shows whether a model thinks.';
    }
    if (/failed to fetch|networkerror|load failed|could not be reached|ECONNREFUSED/i.test(m)) {
      return openai
        ? 'If LM Studio is running, check its server is started and that “Enable CORS” is on in its Developer tab.'
        : 'Using LM Studio directly? Open ⚙ and press “LM Studio (1234)” — no workflow server needed.';
    }
    return '';
  };

  /* ---- portable audio: many studio WAV chunks become one file ---- */

  /** Join WAV files losslessly: parse each RIFF, demand identical audio
   *  formats, concatenate the PCM, write one canonical 44-byte header.
   *  No encoder, no dependency — the studio speaks WAV and so do we. */
  function parseWav(buf) {
    var v = new DataView(buf);
    var tag = function (off) {
      return String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
    };
    if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
    var off = 12; var fmt = null; var data = null;
    while (off + 8 <= buf.byteLength) {
      var id = tag(off); var size = v.getUint32(off + 4, true);
      if (id === 'fmt ') {
        fmt = { format: v.getUint16(off + 8, true), channels: v.getUint16(off + 10, true),
          rate: v.getUint32(off + 12, true), bits: v.getUint16(off + 22, true) };
      }
      if (id === 'data') data = { start: off + 8, size: Math.min(size, buf.byteLength - (off + 8)) };
      off += 8 + size + (size % 2);
    }
    if (!fmt || !data) throw new Error('WAV missing fmt or data chunk');
    return { fmt: fmt, data: data, buf: buf };
  }

  RP.wavJoin = function (buffers) {
    if (!buffers || !buffers.length) throw new Error('nothing to join');
    var parts = buffers.map(parseWav);
    var f = parts[0].fmt;
    parts.forEach(function (p) {
      if (p.fmt.format !== f.format || p.fmt.channels !== f.channels ||
          p.fmt.rate !== f.rate || p.fmt.bits !== f.bits) {
        throw new Error('the studio returned mixed audio formats — cannot join losslessly');
      }
    });
    var total = parts.reduce(function (n, p) { return n + p.data.size; }, 0);
    var out = new ArrayBuffer(44 + total);
    var v = new DataView(out);
    var w = function (off, str) { for (var i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + total, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, f.format, true); v.setUint16(22, f.channels, true);
    v.setUint32(24, f.rate, true);
    v.setUint32(28, f.rate * f.channels * (f.bits / 8), true);
    v.setUint16(32, f.channels * (f.bits / 8), true); v.setUint16(34, f.bits, true);
    w(36, 'data'); v.setUint32(40, total, true);
    var at = 44; var bytes = new Uint8Array(out);
    parts.forEach(function (p) {
      bytes.set(new Uint8Array(p.buf, p.data.start, p.data.size), at);
      at += p.data.size;
    });
    return out;
  };

  /** Reasoning never reaches the page. Some thinking models leak their
   *  deliberation into content as <think> blocks; if that ever gets
   *  displayed or filed it is re-sent in every later prompt and bloats
   *  the context with the model talking to itself. Strip it at the door. */
  RP.stripThink = function (text) {
    return String(text || '')
      .replace(/\s*<think>[\s\S]*?<\/think>\s*/gi, ' ')
      .replace(/^[\s\S]*?<\/think>\s*/i, '')    // an unopened closer: everything before it was thought
      .replace(/\s*<think>[\s\S]*$/i, '')        // an unclosed opener: everything after it is thought
      .trim();
  };

  /** What a line sounds like out loud: tints speak their words, the
   *  markdown furniture and any stray stage direction stay silent. */
  RP.ttsClean = function (text) {
    return String(text || '')
      .replace(/\{([a-z0-9 _-]+)\s*\|\s*([^}]*)\}/gi, '$2')
      .replace(/\{([^}|]*)\s*\|\s*([a-z0-9 _-]+)\}/gi, '$1')
      .replace(/(?:\[\[|\{\{|\[\{|\{\[)[^\]\}\n]*(?:\]\]|\}\}|\]\}|\}\])/g, ' ')
      .replace(/(?:^|\n)\s*(?:\[|\{)?\s*(?:HP|MP|EN|ENERGY|STAMINA|FLAG|COND|CURE|COUNT|ITEM|USE|EQUIP|STOW|STATUS|MOOD|TINT|UNTINT|ENTER|EXIT|NEW|SET|TIME|LOOKUP|REMEMBER)\s*:[^\n]*/gi, ' ')
      .replace(/[*_`#>]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  };

  /** Speech verbs the attribution parser recognizes around a quote. */
  var SAY_VERBS = '(?:says|said|asks?|asked|replies|replied|answers?|answered|' +
    'snarls?|snarled|growls?|growled|mutters?|muttered|murmurs?|murmured|' +
    'shouts?|shouted|yells?|yelled|whispers?|whispered|calls? out|calls?|called|' +
    'barks?|barked|hisses|hissed|drawls?|drawled|rasps?|rasped|laughs?|laughed|' +
    'sighs?|sighed|adds?|added|warns?|warned|offers?|offered|continues?|continued|' +
    'snaps|snapped|grumbles?|grumbled|booms|bellows|purrs|breathes|manages|admits|' +
    'agrees|insists|demands|repeats|begins|finishes|cuts in|chimes in|pipes up)';

  /** A turn split into voices: narration (who: '') between the quotes,
   *  each quote attributed to whoever the prose says is speaking —
   *  '"nah," Sans says', 'Wario snarls, "…"', 'Sans: "…"', '"Out,"
   *  snarls Wario'. A quote the prose does NOT attribute belongs to
   *  whoever is talking this turn; on a world or director turn that is
   *  nobody, so the narrator (Waluigi by default) reads it. */
  /** Second-person speech verbs: the model writes the PLAYER's line as
   *  “…,” you say — that quote belongs to the player's voice, not to
   *  whoever's name is on the card. */
  var YOU_VERBS = '(?:say|said|ask|asked|reply|replied|answer|answered|whisper|whispered|' +
    'mutter|muttered|murmur|murmured|shout|shouted|yell|yelled|call out|call|called|' +
    'snap|snapped|add|added|warn|warned|offer|offered|continue|continued|admit|admitted|' +
    'agree|agreed|insist|insisted|demand|demanded|repeat|repeated|begin|began|' +
    'finish|finished|manage|managed|breathe|breathed|read|reads)';

  RP.speechParts = function (text, names, speaker, player, opts) {
    var clean = RP.ttsClean(text);
    var deflt = String(speaker || '').trim();
    var you = String(player || '').trim();
    if (!clean) return [];
    // opts.mode 'turn': the whole turn in ONE voice — the speaker's for a
    // character's card, the narrator's for the world's — so the studio is
    // asked for a few sentence-sized chunks instead of a request per quote,
    // which is what made a line with six short quotes crawl. The page's
    // default. 'quotes' (this function's default): each quote in its
    // speaker's voice, narration in the narrator's.
    if (opts && opts.mode === 'turn') return [{ who: deflt, text: clean }];
    var escName = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var alts = (names || []).filter(Boolean).map(String)
      .sort(function (a, b) { return b.length - a.length; }).map(escName).join('|');
    var out = [];
    var push = function (who, part) {
      part = String(part).replace(/^[\s,\u2014\u2013:-]+/, '').replace(/[\s\u2014\u2013-]+$/, '').trim();
      if (!part) return;
      if (out.length && out[out.length - 1].who === who) out[out.length - 1].text += ' ' + part;
      else out.push({ who: who, text: part });
    };
    var QUOTE_RE = /["\u201c]([^"\u201c\u201d]+)["\u201d]/g;
    var afterName = alts ? new RegExp('^[\\s,\u2014\u2013-]*(' + alts + ')\\s+' + SAY_VERBS, 'i') : null;
    var afterVerb = alts ? new RegExp('^[\\s,\u2014\u2013-]*' + SAY_VERBS + '\\s+(' + alts + ')', 'i') : null;
    var beforeName = alts ? new RegExp('(' + alts + ')[^.!?"\u201c\u201d]{0,30}' + SAY_VERBS + '\\s*[,:]?\\s*$', 'i') : null;
    var beforeColon = alts ? new RegExp('(' + alts + ')\\s*:\\s*$', 'i') : null;
    var afterYou = you ? new RegExp('^[\\s,\u2014\u2013-]*you\\s+' + YOU_VERBS, 'i') : null;
    var beforeYou = you ? new RegExp('\\byou\\b[^.!?"\u201c\u201d]{0,30}\\b' + YOU_VERBS + '\\s*[,:]?\\s*$', 'i') : null;
    var last = 0; var m; var any = false;
    while ((m = QUOTE_RE.exec(clean)) !== null) {
      any = true;
      var before = clean.slice(Math.max(0, m.index - 60), m.index);
      var after = clean.slice(QUOTE_RE.lastIndex, QUOTE_RE.lastIndex + 60);
      push('', clean.slice(last, m.index));
      var t = null;
      var hit = (afterName && (t = afterName.exec(after))) ? t[1]
        : (afterVerb && (t = afterVerb.exec(after))) ? t[1]
        : (beforeName && (t = beforeName.exec(before))) ? t[1]
        : (beforeColon && (t = beforeColon.exec(before))) ? t[1]
        : (afterYou && afterYou.test(after)) ? you
        : (beforeYou && beforeYou.test(before)) ? you
        : '';
      push(hit || deflt, m[1]);
      last = QUOTE_RE.lastIndex;
    }
    if (!any) return [{ who: deflt, text: clean }];
    push('', clean.slice(last));
    return out;
  };

  /** Sentence-aware chunks for the studio (same idea as the article
   *  bridge): sentences stay whole, nothing exceeds `size` chars. */
  RP.ttsChunks = function (text, size, lead) {
    size = size || 450;
    var clean = RP.ttsClean(text);
    if (!clean) return [];
    var sentences = clean.match(/[^.!?]+[.!?]+["'\u201d\u2019]?\s*|[^.!?]+$/g) || [clean];
    var out = []; var cur = '';
    // With a `lead`, the first chunk closes at the first sentence end past
    // that size: the voice starts on the opening line while the rest is
    // still synthesizing, instead of waiting for a full-size first chunk.
    var cap = function () { return (lead && !out.length) ? lead : size; };
    sentences.forEach(function (s) {
      s = s.trim();
      if (!s) return;
      if (!cur) cur = s;
      else if (cur.length + s.length + 1 <= cap()) cur += ' ' + s;
      else { out.push(cur); cur = s; }
      while (cur.length > size) { out.push(cur.slice(0, size)); cur = cur.slice(size).trim(); }
    });
    if (cur) out.push(cur);
    return out;
  };

  /** A tint for the fallback avatar, also stable per character. */
  RP.tintFor = function (char) {
    return 'hsl(' + (hash((char && (char.id || char.name)) || 'tint') % 360) + ' 62% 62%)';
  };

  RP.initialsFor = function (name) {
    var parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || '?';
  };

  /* ------------------------------------------------------------------ *
   * styles and prompts
   * ------------------------------------------------------------------ */

  RP.STYLES = {
    voice: {
      name: 'In character',
      dir: 'Speak AS the character, in the FIRST PERSON, to the person in front of you — the way they would actually ' +
        'say it out loud, in their own words and rhythm. Mostly dialogue. Small actions go between *asterisks* on ' +
        'the same line (*slams the ledger*), never as paragraphs of description. Do not narrate yourself from the ' +
        'outside ("Wario grunts and counts his coins") — you ARE them ("*counts the coins again* Wah. Still short."). ' +
        'No scene-setting, no summarising the moment, no literary distance.',
    },
    novel: {
      name: 'Novel',
      dir: 'Write as third-person prose fiction: physical detail, quoted speech, a paragraph or three. Never narrate for the user. ' +
        'Every quoted line must sound like the character who says it — see VOICE.',
    },
    script: {
      name: 'Script',
      dir: 'Write as a screenplay beat: terse stage directions in the present tense, then the spoken line. Keep it short and shootable.',
    },
    casual: {
      name: 'Casual',
      dir: 'Write the way people actually talk: short turns, contractions, interruptions. One or two lines unless something big happens.',
    },
    archivist: {
      name: 'Archivist',
      dir: 'Write as though the turn is being filed into an in-world archive: dated, specific, named objects, dry asides.',
    },
  };

  RP.DEFAULT_STYLE = 'voice';

  function styleDir(opts) {
    var style = (opts && opts.style) || RP.DEFAULT_STYLE;
    return (RP.STYLES[style] || RP.STYLES[RP.DEFAULT_STYLE]).dir;
  }

  /** The dossier handed to the model. The filed description is the whole
   *  point — it is what makes a character argue, refuse and joke like
   *  themselves — so it goes in at length, with the role it implies. */
  function card(char, opts) {
    opts = opts || {};
    var lines = ['Name: ' + char.name];
    if (char.title) lines.push('Title: ' + char.title);
    if (char.race) lines.push('Race: ' + char.race);
    if (char.affiliation) lines.push('Affiliation: ' + char.affiliation);
    if (char.faction && char.faction !== char.affiliation) lines.push('Faction: ' + char.faction);
    if (char.faiths) lines.push('Faith: ' + faithLine(char.faiths));
    if (char.status) lines.push('Status right now: ' + char.status);
    if (char.fameTier) lines.push('Standing: ' + char.fameTier + (char.powerLevel ? ' · power ' + char.powerLevel : ''));
    if (char.summary) lines.push('About: ' + char.summary);
    if (char.description && !opts.short) {
      // The archive is written by Waluigi ABOUT everybody else. Handed over
      // without that warning, every character came back sounding like the
      // encyclopaedist who filed them — dry, dated, archival.
      lines.push(char.id === 'waluigi'
        ? 'Filed description — written by Waluigi himself, so this IS his voice. Play it, not a generic version of the name:'
        : 'Filed description — biography written by Waluigi, the archive\u2019s author, ABOUT this character. Use it ' +
          'for facts, history and relationships; do NOT borrow its narrator\u2019s tone. How they actually talk is under VOICE:');
      lines.push(clip(char.description, 1400));
    }
    if (char.why) lines.push('Why they are in this scene: ' + char.why);
    // A hand-written voice sheet outranks a guessed behaviour line.
    var role = RP.voiceSheet(char) ? '' : RP.roleFor(char);
    if (role) lines.push('How they behave: ' + role);
    return lines.join('\n');
  }
  RP.card = card;

  /** A behaviour line inferred from what the archive already says. It is
   *  deliberately blunt: small models need the instruction, not the hint.
   *  Whole words only — `ice` used to match price, juice and service, and
   *  Wario came out "reaching for the arcane answer first". */
  RP.roleFor = function (char) {
    var text = ((char.title || '') + ' ' + (char.status || '') + ' ' + (char.summary || '') + ' ' + (char.description || '')).toLowerCase();
    var traits = [];
    function has(re, line) { if (re.test(text)) traits.push(line); }
    has(/\b(archivist|historian|scribe|librarian)\b|\brecords?\b/, 'cites the record, dates things, corrects other people\u2019s facts');
    has(/\b(soldier|captain|general|commander|warlord|legion|guards?|knight|paratroopa)\b/, 'thinks in ground, orders and casualties; answers threats before questions');
    has(/\b(king|queen|lord|lady|prince|princess|speaker|delegate|noble|regent)\b/, 'speaks as though the room already reports to them, and notices who does not');
    has(/\b(merchant|debts?|gold|acquisitions|coins?|profit|bank|business)\b/, 'prices everything out loud, including favours');
    has(/\b(thief|looter|infiltrat\w*|rogue|spy|smuggler)\b/, 'checks exits, pockets what is loose, and lies smoothly when it is easier');
    has(/\b(mage|magic\w*|arcane|wizard|sorcer\w*|ice magic|witch|oracle)\b/, 'reaches for the arcane answer first, and resents being asked to explain it');
    has(/\b(ghost|spirits?|undead|revenant|wraith|spectre|specter)\b/, 'is not bound by the room\u2019s rules and does not pretend to be');
    has(/\b(monster|beast|titan|dragon|creature)\b/, 'communicates physically before verbally');
    has(/\b(coward\w*|reluctant|nervous|anxious|traumati\w*)\b/, 'wants to leave, says so, and stays anyway');
    has(/\b(comedian|jester|pranks?|jokes?|clown|chaos)\b/, 'undercuts the serious line, especially when it is the wrong moment');
    has(/\b(injured|wounded|dying|bleeding|missing)\b/, 'is hurt, and it shows in what they can and cannot do');
    return traits.slice(0, 4).join('; ');
  };

  /* ---- voice sheets: how a character actually talks ----
     The archive's descriptions are biography. A model given biography
     writes biography — "Wario, the explosive accountant, considers the
     offer" — when what you wanted was "WAH. No. Pay me." The sheet is the
     missing half: register, tics, the things they would never say, and a
     few lines in their mouth for the model to sit new ones beside.
     Hand-written sheets live in Reputation-Matrix2/data/voices.json and
     are loaded with RP.setVoices; an imported character card brings its
     own (personality + example dialogue); everybody else gets a fallback
     built from their record. */

  RP.VOICES = {};

  RP.setVoices = function (map) {
    RP.VOICES = {};
    Object.keys(map || {}).forEach(function (id) {
      if (id.charAt(0) === '_' || !map[id] || typeof map[id] !== 'object') return;
      RP.VOICES[id] = map[id];
    });
    return Object.keys(RP.VOICES).length;
  };

  /** Example dialogue in a Tavern/c.ai card is one block of text with
   *  {{char}}: / {{user}}: labels. Keep the character's own lines. */
  function linesFromExample(text, name) {
    var out = [];
    var own = String(name || '').toLowerCase();
    // clip() has already folded the newlines, so the turns are found by
    // their labels — {{char}}: / {{user}}: / Name: — wherever they sit.
    var flat = String(text || '').replace(/<START>/gi, '\n');
    var labelled = flat.split(/(?=(?:^|\s)(?:\{\{char\}\}|\{\{user\}\}|[A-Z][\w' .-]{0,30}):\s)/);
    labelled.forEach(function (chunk) {
      var line = chunk.trim();
      if (!line || out.length >= 6) return;
      var m = /^(\{\{char\}\}|\{\{user\}\}|[^:]{1,40}):\s*([\s\S]+)$/.exec(line);
      if (!m) { if (line.length > 12) out.push(clip(line, 220)); return; }
      var who = m[1].trim().toLowerCase();
      if (who === '{{user}}' || who === 'you' || who === 'user') return;
      if (who === '{{char}}' || !own || who === own || own.indexOf(who) === 0) {
        out.push(clip(m[2].replace(/\{\{char\}\}/gi, name || 'they').replace(/\{\{user\}\}/gi, 'you'), 220));
      }
    });
    return out.slice(0, 6);
  }

  /** The sheet for a character: their own, the archive's, or one read out
   *  of an imported card. Null when there is nothing hand-written. */
  RP.voiceSheet = function (char) {
    if (!char) return null;
    if (char.voice && typeof char.voice === 'object') return char.voice;
    if (char.id && RP.VOICES[char.id]) return RP.VOICES[char.id];
    var card = char.card || {};
    if (card.mes_example || card.system_prompt) {
      return {
        register: clip(card.system_prompt || '', 500),
        sounds: [], never: [],
        lines: linesFromExample(card.mes_example, char.name),
        fromCard: true,
      };
    }
    return null;
  };

  /** The prompt section. With a sheet it is the sheet; without one it is
   *  still a first-person instruction built from the record, which is more
   *  than the model used to get. */
  RP.voiceBlock = function (char) {
    char = char || {};
    var name = char.name || 'this character';
    var sheet = RP.voiceSheet(char);
    var out = ['VOICE \u2014 how ' + name + ' actually talks. This is the whole job: if the lines could be anybody\u2019s, they are wrong.'];
    if (sheet) {
      if (sheet.register) out.push(clip(sheet.register, 600));
      var sounds = (sheet.sounds || []).slice(0, 6);
      if (sounds.length) out.push('Sounds like: ' + sounds.map(function (s) { return clip(s, 160); }).join(' \u00b7 '));
      var never = (sheet.never || []).slice(0, 5);
      if (never.length) out.push('Never: ' + never.map(function (s) { return clip(s, 140); }).join(' \u00b7 '));
      var lines = (sheet.lines || []).slice(0, 5);
      if (lines.length) {
        out.push('Lines in ' + name + '\u2019s own mouth \u2014 do not repeat them; write NEW ones that could sit beside them:');
        lines.forEach(function (l) { out.push('  \u201c' + clip(l, 240) + '\u201d'); });
      }
      return out.join('\n');
    }
    var role = RP.roleFor(char);
    out.push('Speak in the FIRST PERSON as ' + name + (char.title ? ', ' + char.title : '') + '. Their vocabulary comes ' +
      'from what they are' + (char.affiliation ? ' (' + clip(char.affiliation, 80) + ')' : '') +
      (char.race ? ' and what they are made of (' + clip(char.race, 40) + ')' : '') + ', not from a narrator.');
    if (role) out.push('Sounds like somebody who ' + role + '.');
    if (char.status) out.push('What is on their mind right now: ' + clip(char.status, 240));
    out.push('Give them one verbal habit and keep it. Short lines when angry, longer when lying. Never summarise the scene \u2014 react to it.');
    return out.join('\n');
  };

  /** The last thing the model reads before it writes. Small models weigh
   *  the end of the prompt most, so the end is the character, not the
   *  mechanics. */
  RP.closingLine = function (char, style) {
    var name = (char && char.name) || 'the character';
    if ((style || RP.DEFAULT_STYLE) === 'voice') {
      return 'NOW ANSWER AS ' + name.toUpperCase() + ' \u2014 first person, in their own voice from VOICE above. Not a narrator, ' +
        'not a summary, not a description of the room. If ' + name + ' would shout, shout; if they would refuse, refuse.';
    }
    return 'Every line ' + name + ' speaks must sound like ' + name + ' \u2014 see VOICE above. The prose may be yours; the words are theirs.';
  };

  var RULES = [
    'You may colour a few words inside the prose when they carry weight — {red|the door is open}, {ice|her breath}, ' +
      'or simply {the stain} to use the speaker\u2019s own mood colour — two or three words, once in a turn at most, never a ' +
      'whole sentence. Colours: red, blood, crimson, ember, amber, gold, copper, rust, moss, green, jade, teal, sea, ice, blue, ' +
      'storm, violet, lilac, plum, pink, grey, silver, bone, sand, black, white, or any #hex. The colour of the box is their mood; the colour of the words is yours.',
    'Use the material. When the archive passages, the session filing or the lore book say something that touches ' +
      'this moment, USE IT — a date, a name, a number, what somebody actually said. Quote it, argue with it, get it ' +
      'slightly wrong in character if that is truer. A scene that could have happened in any story is a wasted turn.',
    'If you need a fact you do not have, ask for it with [[LOOKUP: …]] rather than inventing one.',
    'Stay in character at all times: never mention being an AI, a model, or a chat assistant, and never break the fiction to apologise.',
    'Put actions, gestures and scene detail between asterisks like *this*. Put speech in "quotes".',
    'Write only your own character. Never speak, act or decide for the user.',
    'Never end the turn with a summary or a question about what the user wants to do next unless your character would really ask it.',
    'Every turn moves the scene: by its end something is different \u2014 a decision, a deed, a fact out. Never say again ' +
      'what an earlier turn said; answer what JUST happened.',
  ].join('\n');

  /** The system prompt for a one-on-one chat. */
  RP.soloPrompt = function (char, opts) {
    char = RP.normChar(char);
    return [
      'You are ' + char.name + ', a character in the Waluipedia archive. Play them, do not describe them.',
      '',
      'CHARACTER CARD',
      card(char),
      '',
      RP.voiceBlock(char),
      '',
      'IN-CHARACTER RULES',
      RULES,
      '',
      'STYLE',
      styleDir(opts),
    ].join('\n');
  };

  /** The system prompt for one turn of a group chat: the whole cast is listed,
   *  but the reply may only contain the current speaker's own words. */
  RP.groupPrompt = function (cast, speaker, opts) {
    var list = (cast || []).map(RP.normChar);
    var who = RP.normChar(speaker || list[0] || {});
    var out = [
      'This is a group roleplay scene in the Waluipedia archive.',
      '',
      'THE CAST',
      list.map(function (c) {
        return '- ' + c.name + (c.title ? ' — ' + c.title : '') +
          (c.affiliation ? ' (' + c.affiliation + ')' : '') +
          (c.id !== who.id && c.summary ? '\n    ' + clip(c.summary, 120) : '');
      }).join('\n'),
      '',
      'YOU ARE ' + who.name,
      card(who),
      '',
      RP.voiceBlock(who),
      '',
      'Write the next turn speaking ONLY as ' + who.name + '.',
      'START WITH ' + who.name.toUpperCase() + '. The first sentence must be ' + who.name + ' doing or saying ' +
      'something. Do not open on anybody else, do not write another character\u2019s dialogue, do not narrate the ' +
      'user, and do not describe the room instead of acting.',
      'If ' + who.name + ' genuinely has nothing to add, have them do one small physical thing and stop — but they ' +
      'must be the one doing it.',
      '',
      'IN-CHARACTER RULES',
      RULES,
      '',
      'STYLE',
      styleDir(opts),
    ];
    if (opts && opts.scene) out.push('', 'THE SCENE', String(opts.scene));
    return out.join('\n');
  };

  /** groupPrompt in two halves for the cache layout. The STAGE is the same
   *  for every speaker in the room — the cast (everyone's summary), the
   *  rules, the style, the scene — so it can sit at the head of the prompt
   *  and stay in the model server's cache. The SPEAKER half (who is up,
   *  their card and voice) changes turn by turn and rides after the
   *  history instead. */
  RP.groupStage = function (cast, opts) {
    var list = (cast || []).map(RP.normChar);
    var out = [
      'This is a group roleplay scene in the Waluipedia archive. Each turn you play ONE member of the cast; ' +
        'who, and how they talk, is in the notes on the newest message.',
      '',
      'THE CAST',
      list.map(function (c) {
        return '- ' + c.name + (c.title ? ' — ' + c.title : '') +
          (c.affiliation ? ' (' + c.affiliation + ')' : '') +
          (c.summary ? '\n    ' + clip(c.summary, 120) : '');
      }).join('\n'),
      '',
      'IN-CHARACTER RULES',
      RULES,
      '',
      'STYLE',
      styleDir(opts),
    ];
    if (opts && opts.scene) out.push('', 'THE SCENE', String(opts.scene));
    return out.join('\n');
  };

  RP.groupSpeaker = function (speaker) {
    var who = RP.normChar(speaker || {});
    return [
      'YOU ARE ' + who.name,
      card(who),
      '',
      RP.voiceBlock(who),
      '',
      'Write the next turn speaking ONLY as ' + who.name + '.',
      'START WITH ' + who.name.toUpperCase() + '. The first sentence must be ' + who.name + ' doing or saying ' +
      'something. Do not open on anybody else, do not write another character’s dialogue, do not narrate the ' +
      'user, and do not describe the room instead of acting.',
      'If ' + who.name + ' genuinely has nothing to add, have them do one small physical thing and stop — but they ' +
      'must be the one doing it.',
    ].join('\n');
  };

  /** Who the user is playing. Empty persona adds nothing to the prompt. */
  RP.personaBlock = function (persona) {
    var text = String(persona || '').trim();
    if (!text) return '';
    return 'THE USER PLAYS\n' + text + '\nAddress them as that person; never tell them what they do.';
  };

  /* ------------------------------------------------------------------ *
   * rooms
   * ------------------------------------------------------------------ */

  /** Create a chat room. One character is a solo chat; two or more is a group.
   *  `opts.scene` sets the situation, `opts.opener` files the first scene card,
   *  `opts.beats` attaches a filed timeline that will run on its own. */
  RP.newRoom = function (cast, opts) {
    opts = opts || {};
    var list = (cast || []).map(RP.normChar);
    var kind = list.length > 1 ? 'group' : 'solo';
    var room = {
      id: opts.id || uid(),
      kind: kind,
      title: opts.title || list.map(function (c) { return c.name; }).join(' + ') || 'New chat',
      cast: list,
      messages: [],
      scene: String(opts.scene || ''),
      sceneName: String(opts.sceneName || ''),
      sceneImage: String(opts.sceneImage || ''),
      // When this is happening in-world. Every memory filed from this room
      // is stamped with it, and the model is told which filings it predates.
      date: String(opts.date || ''),
      perspective: String(opts.perspective || ''),
      replayOf: String(opts.replayOf || ''),
      persona: String(opts.persona || ''),
      style: String(opts.style || RP.DEFAULT_STYLE),
      beats: Array.isArray(opts.beats) ? opts.beats.slice(0, 24) : [],
      beatIndex: 0,
      autoBeats: opts.autoBeats === undefined ? true : Boolean(opts.autoBeats),
      statePreset: opts.statePreset || 'rpg',
      kit: String(opts.kit || 'auto'),          // 'auto' dresses the cast from their profiles; 'off' leaves packs empty
      states: {},
      mechanics: opts.mechanics === undefined ? 'on' : opts.mechanics,
      // How far back the model may look in this room; 0 means "use the
      // global setting".
      contextLimit: Number(opts.contextLimit || 0),
      recap: '', recapAt: 0,                    // the story so far, folded up
      youPlay: String(opts.youPlay || ''),      // the character the reader plays
      privacy: String(opts.privacy || ''),      // '' (read the turn) | private | open
      note: String(opts.note || ''),            // standing instructions for this chat
      sequelOf: String(opts.sequelOf || ''),
      sourceId: String(opts.sourceId || ''),    // the filed record behind this scene
      sourceKind: String(opts.sourceKind || ''),
      canon: String(opts.canon || ''),
      sequelCount: 0,
      next: '',
      created: Date.now(),
      updated: Date.now(),
    };
    // Sheets: carried in from a previous scene, or started from the setup.
    RP.ensureSheets(room, room.statePreset, opts.setup || {});
    if (opts.states) {
      Object.keys(opts.states).forEach(function (id) {
        if (room.states[id]) room.states[id] = JSON.parse(JSON.stringify(opts.states[id]));
      });
    }
    if (opts.opener) room.messages.push({ id: uid(), role: 'scene', text: String(opts.opener), at: Date.now() });
    return room;
  };

  /** The text actually on screen for a message (swipes pick an alternative). */
  RP.textOf = function (msg) {
    if (!msg) return '';
    if (Array.isArray(msg.alts) && msg.alts.length) {
      var i = Math.max(0, Math.min(msg.alts.length - 1, msg.alt || 0));
      return String(msg.alts[i]);
    }
    return String(msg.text || '');
  };

  function visible(msg) {
    // Narration counts. Leaving the world's turns out of the history is why
    // it described the same cloak and the same moon three times running.
    return msg && !msg.error && !msg.beat &&
      (msg.role === 'user' || msg.role === 'char' || msg.role === 'world');
  }
  RP.visible = visible;

  /** Chat history in the model's own shape. Scene cards, fired beats and the
   *  page's own failure notices are never sent: the model sees only play. */
  RP.historyFor = function (room, limit) {
    var group = room && room.kind === 'group';
    var from = Math.max(0, Number((room && room.recapAt) || 0));
    // A muted turn stays on screen and stays out of the model's head: that
    // is how you take something back without deleting it.
    var out = (room && room.messages ? room.messages : []).filter(function (m) {
      return visible(m) && !m.muted;
    }).map(function (m) {
      if (m.role === 'user') return { role: 'user', content: RP.textOf(m) };
      if (m.role === 'world') return { role: 'assistant', content: 'Narration: ' + RP.textOf(m) };
      var name = '';
      if (group) {
        var who = (room.cast || []).filter(function (c) { return c.id === m.charId; })[0];
        name = who ? who.name + (m.same ? ' (at the same moment)' : '') + ': ' : '';
      }
      return { role: 'assistant', content: name + RP.textOf(m) };
    });
    // Anything before the recap point is covered by the recap itself.
    if (from) out = out.slice(from);
    return limit ? out.slice(-limit) : out;
  };

  /** The history in the shape every chat template accepts: it opens and
   *  ends on the user, and never has two turns of one role in a row. A
   *  ➤ Continue sends no new line, so the history used to end on the
   *  character's own last turn — llama.cpp and LM Studio read that as
   *  "extend this message" and often came back empty, and strict templates
   *  (Gemma, Mistral) refused it outright, as they did two characters'
   *  turns back to back. `who` is the name of whoever is up, or '' for the
   *  narrator. */
  RP.chatShape = function (messages, who) {
    var out = [];
    (messages || []).forEach(function (m) {
      if (!m || !String(m.content || '').trim()) return;
      var prev = out[out.length - 1];
      if (prev && prev.role === m.role) prev.content += '\n\n' + m.content;
      else out.push({ role: m.role, content: String(m.content) });
    });
    if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: '(The scene opens.)' });
    if (out[out.length - 1].role !== 'user') {
      out.push({ role: 'user', content: who
        ? '(I let the scene run without a line of my own. Write ' + who + '’s next turn: something new happens — do not repeat or extend the last turn.)'
        : '(I let the scene run without a line of my own. Narrate what happens next — do not repeat or extend the last turn.)' });
    }
    return out;
  };

  /* ---- the rolling recap: a long chat without a long prompt ---- */

  RP.RECAP_AFTER = 18;      // turns of history before the old ones are folded up

  /** Is it time to fold the old turns up? */
  RP.needsRecap = function (room, every) {
    var turns = (room.messages || []).filter(visible).length;
    var from = Number(room.recapAt || 0);
    return turns - from > (every || RP.RECAP_AFTER) * 1.5;
  };

  /** The live window keeps RECAP_KEEP turns; the fold runs every
   *  RECAP_STEP turns past that. needsRecap waited for 36 unfolded turns
   *  while packHistory only ever sent the newest ~10, so everything in
   *  between was in neither the prompt nor the recap — the cast forgot
   *  it. Folding in small steps keeps the recap meeting the window. */
  RP.RECAP_KEEP = 10;
  RP.RECAP_STEP = 6;
  RP.recapDue = function (room, keep) {
    var turns = (room.messages || []).filter(visible).length;
    return turns - Number(room.recapAt || 0) >= (keep || RP.RECAP_KEEP) + RP.RECAP_STEP;
  };

  /** The recap request itself is budgeted. A grandfathered room can owe
   *  hundreds of unfolded turns; sending them all once put 14,557 tokens
   *  into an 8,192-token window and bought a 400 instead of a summary.
   *  The newest of the stretch ride whole-ish; the oldest fall off with
   *  a note saying so. recapAt still advances, so it never recurs. */
  RP.RECAP_FOLD = 7000;

  /** Out of the box the background AI is LEAN: one model call per turn —
   *  the model writes the story; speakers rotate deterministically and
   *  the lore book / upkeep reviewers wait for full mode. On a machine
   *  where every call costs minutes, the pickers cost more than the prose. */
  RP.BACKGROUND_DEFAULT = 'lean';

  /** The prompt that writes the recap — a small, cheap, background call. */
  RP.recapPrompt = function (room, turns, previous) {
    var lines = []; var used = 0; var dropped = 0;
    for (var i = (turns || []).length - 1; i >= 0; i--) {
      var line = turns[i].who + ': ' + clip(turns[i].text, 300);
      if (used + line.length > RP.RECAP_FOLD && lines.length) { dropped = i + 1; break; }
      lines.unshift(line); used += line.length + 1;
    }
    return [
      'Summarise this stretch of a roleplay session so the scene can carry on without re-reading it.',
      '',
      previous ? 'WHAT WAS ALREADY SUMMARISED (fold this in, do not repeat it separately)\n' + clip(previous, 1400) : '',
      '',
      'THE TURNS' + (dropped ? ' (the ' + dropped + ' oldest were dropped for space — mention that time passed)' : ''),
      lines.join('\n'),
      '',
      'Write 120 to 200 words of plain past-tense prose. Keep: who did what, what was decided, what was learned,',
      'what changed hands, what was promised or refused, and anything anybody would still be angry about.',
      'Drop: weather, atmosphere, and anything said twice. No headings, no bullet points, no commentary.',
    ].filter(Boolean).join('\n');
  };

  RP.recapBlock = function (room) {
    if (!room || !room.recap) return '';
    return 'THE STORY SO FAR — everything before the turns below, folded up. Treat it as having happened.\n' +
      clip(room.recap, 1200);
  };

  /** Turns on screen — the number the room list and character cards show. */
  RP.counter = function (room) {
    return (room && room.messages ? room.messages : []).filter(visible).length;
  };

  /** How many rooms a character appears in, across every saved chat. */
  RP.roomCountFor = function (rooms, charId) {
    return (rooms || []).filter(function (r) {
      return (r.cast || []).some(function (c) { return c.id === charId; });
    }).length;
  };

  /** Every turn a character has spoken, across every saved chat. */
  RP.turnCountFor = function (rooms, charId) {
    return (rooms || []).reduce(function (sum, r) {
      return sum + (r.messages || []).filter(function (m) {
        return visible(m) && m.role === 'char' && m.charId === charId;
      }).length;
    }, 0);
  };

  /* ------------------------------------------------------------------ *
   * speaker rotation
   * ------------------------------------------------------------------ */

  RP.rotationAfter = function (cast, charId) {
    var list = cast || [];
    if (!list.length) return null;
    var at = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === charId) at = i;
    return list[(at + 1) % list.length];
  };

  /** Who speaks next: an explicit pick if it is in the cast, otherwise the
   *  rotation carried on from whoever answered last. */
  RP.nextSpeaker = function (room, pick) {
    var cast = (room && room.cast) || [];
    if (!cast.length) return null;
    var wanted = String(pick || (room && room.next) || '');
    var chosen = cast.filter(function (c) { return c.id === wanted; })[0];
    if (chosen) return chosen;
    var last = null;
    (room.messages || []).forEach(function (m) { if (m.role === 'char' && !m.error) last = m.charId; });
    return last ? RP.rotationAfter(cast, last) : cast[0];
  };

  /** Models like to prefix their own name. Strip it, but only when it really
   *  is a name — "Just a line: with a colon later" is prose, not a label. */
  RP.stripSpeaker = function (text, name) {
    var value = String(text || '').replace(/^\s+/, '');
    if (name) {
      var head = String(name) + ':';
      if (value.slice(0, head.length).toLowerCase() === head.toLowerCase()) {
        return value.slice(head.length).trim();
      }
    }
    var m = /^([A-Z][\w'’.-]*(?: [A-Z][\w'’.-]*){0,2}):\s+/.exec(value);
    return m ? value.slice(m[0].length) : value;
  };

  /* ------------------------------------------------------------------ *
   * scripted scenes — the filed event runs on its own schedule
   * ------------------------------------------------------------------ */

  RP.beatProgress = function (room) {
    var total = (room && room.beats ? room.beats : []).length;
    var at = Math.min(room && room.beatIndex || 0, total);
    return { at: at, total: total, remaining: Math.max(0, total - at) };
  };

  /** Fire the next filed beat: it becomes a scene card in the room and enters
   *  the script block, but never the model's chat history. */
  RP.fireBeat = function (room) {
    var progress = RP.beatProgress(room);
    if (!progress.remaining) return null;
    if (room.beatsPaused) return null;
    var beat = room.beats[room.beatIndex];
    room.beatIndex = progress.at + 1;
    room.messages.push({
      id: uid(), role: 'scene', beat: true, at: Date.now(),
      text: (beat.time ? beat.time + ' — ' : '') + beat.beat + (beat.detail ? '\n' + beat.detail : ''),
    });
    return beat;
  };

  /** Visible turns played since the last beat fired. */
  RP.turnsSinceBeat = function (room) {
    var msgs = (room && room.messages) || [];
    var since = 0;
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].beat) break;
      if (visible(msgs[i])) since++;
    }
    return since;
  };

  /** The main event moves without waiting for the player: two turns is a beat. */
  // "3 days later", "that night", "a week after" — the player has moved the
  // scene, and the filed script no longer lines up with it.
  var JUMP_RE = /\b(\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+(?:later|after|on)|later that (?:night|day|week|morning|evening)|the next (?:day|morning|night|week)|meanwhile|some time later|years? later|afterwards?)\b/i;

  /** Did the player just jump the clock or change the place? */
  RP.isTimeJump = function (text) {
    return JUMP_RE.test(String(text || ''));
  };

  RP.autoAdvance = function (room) {
    if (!room || !room.autoBeats) return false;
    if (!RP.beatProgress(room).remaining) return false;
    return RP.turnsSinceBeat(room) >= 2;
  };

  /** The prompt section that keeps the filed event on its rails while the
   *  player does something else entirely in the same place. */
  RP.scriptBlock = function (room) {
    var beats = (room && room.beats) || [];
    if (!beats.length) return '';
    var progress = RP.beatProgress(room);
    var out = ['THE MAIN EVENT (runs on its own script)'];
    out.push('The filed session "' + (room.sceneName || room.title) + '" is happening around you and stays on script: '
      + 'it happens whether or not the characters here take part. You are playing this from a DIFFERENT perspective '
      + '— people with their own business in the same place. Do not retell the main event; react to it.');
    if (progress.at > 0) {
      out.push('', 'Main event so far:');
      beats.slice(0, progress.at).forEach(function (b) {
        out.push('- ' + (b.time ? b.time + ': ' : '') + b.beat);
      });
    }
    if (progress.remaining) {
      var next = beats[progress.at];
      out.push('', 'Scheduled to happen next: ' + (next.time ? next.time + ' — ' : '') + next.beat
        + (next.detail ? ' (' + next.detail + ')' : ''),
        'Do not make it happen early. Let it arrive on its own.');
    } else {
      out.push('', 'The main event has run its course; the aftermath is yours to play.');
    }
    return out.join('\n');
  };

  /* ------------------------------------------------------------------ *
   * the WAHwire — posts become scenarios
   * ------------------------------------------------------------------ */

  /** One filed wire post → the shape the dashboard and the scenario builder
   *  both use. `profiles` (from wahwire/profiles.json) supplies the avatar. */
  RP.normPost = function (record, profiles) {
    record = record || {};
    var author = String(record.author || 'unknown');
    var profile = (profiles || {})[author] || {};
    var links = Array.isArray(record.links) ? record.links : [];
    var body = String(record.content || '');
    if (Array.isArray(record.thread) && record.thread.length) body += '\n' + record.thread.join('\n');
    return {
      id: String(record.id || uid()),
      author: author,
      authorName: clip(profile.name || RP.prettyId(author), 60),
      avatar: String(profile.avatar || ''),
      type: String(record.type || 'text'),
      status: String(record.status || 'posted'),
      order: Number(record.order || 0),
      timestamp: clip(record.timestamp, 80),
      content: clip(body, 1200),
      likes: Number(record.likes || 0),
      image: String(record.image || ''),
      tags: (record.tags || []).map(String).slice(0, 8),
      chars: links.filter(function (l) { return l && l.type === 'character'; }).map(function (l) { return String(l.id); })
        .concat([author]),
      events: links.filter(function (l) { return l && (l.type === 'event' || l.type === 'battle'); }).map(function (l) { return String(l.id); }),
      comments: (record.comments || []).slice(0, 6).map(function (c) {
        return { author: String(c.author || ''), content: clip(c.content, 220), likes: Number(c.likes || 0) };
      }),
    };
  };

  RP.POST_SORTS = {
    newest: { name: 'Newest first', fn: function (a, b) { return (b.order || 0) - (a.order || 0); } },
    oldest: { name: 'Oldest first', fn: function (a, b) { return (a.order || 0) - (b.order || 0); } },
    liked: { name: 'Most liked', fn: function (a, b) { return (b.likes || 0) - (a.likes || 0); } },
    loudest: { name: 'Most argued over', fn: function (a, b) { return (b.comments || []).length - (a.comments || []).length; } },
  };

  RP.sortPosts = function (posts, mode) {
    var sort = RP.POST_SORTS[mode] || RP.POST_SORTS.newest;
    return (posts || []).slice().sort(sort.fn);
  };

  /** A post is "used" once it has been played as a scenario in this browser.
   *  The unused view is how a reader finds the corners of the wire nobody has
   *  touched yet — 196 filed posts, and most of them have never been a scene. */
  RP.postUsed = function (state, postId) {
    return Boolean((state.usedPosts || {})[String(postId)]);
  };

  RP.markPostUsed = function (state, postId, room) {
    state.usedPosts = state.usedPosts || {};
    state.usedPosts[String(postId)] = { at: Date.now(), roomId: (room && room.id) || '', roomTitle: (room && room.title) || '' };
    return state.usedPosts[String(postId)];
  };

  RP.POST_VIEWS = { all: 'All posts', unused: 'Unused', used: 'Already played', unfiled: 'Never posted' };

  /** Filter the wire: by view (all / unused / played / drafts the archive
   *  never posted), by a text query, and by a character who is involved. */
  RP.filterPosts = function (posts, opts, state) {
    opts = opts || {};
    var q = String(opts.query || '').toLowerCase().trim();
    return (posts || []).filter(function (p) {
      if (opts.view === 'unused' && RP.postUsed(state, p.id)) return false;
      if (opts.view === 'used' && !RP.postUsed(state, p.id)) return false;
      if (opts.view === 'unfiled' && p.status === 'posted') return false;
      if (opts.charId && p.chars.indexOf(opts.charId) < 0) return false;
      if (!q) return true;
      return (p.content + ' ' + p.authorName + ' ' + p.tags.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  };

  /** A wire post → a playable scenario. The post is the situation, its
   *  comments are the beats (the argument arrives on its own schedule), and
   *  everyone it links to is the suggested cast. */
  RP.scenarioFromPost = function (post, castById) {
    var suggested = post.chars.map(function (id) { return (castById || {})[id]; }).filter(Boolean);
    var seen = {}, cast = [];
    suggested.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; cast.push(c); } });
    var beats = post.comments.map(function (c, i) {
      var who = ((castById || {})[c.author] || {}).name || String(c.author || 'someone').replace(/_/g, ' ');
      return { time: 'reply ' + (i + 1), beat: who + ' answers the post', detail: c.content };
    });
    return {
      id: 'wire:' + post.id,
      postId: post.id,
      name: clip(post.authorName + ' on the wire — ' + post.content, 70),
      summary: post.content,
      scene: 'A WAHwire post is doing the rounds. ' + post.authorName + ' posted, ' + post.timestamp + ':\n“'
        + clip(post.content, 700) + '”\nPlay the hours around that post: the people in it, the people answering it, '
        + 'and the people who wish it had never been filed.',
      image: post.image,
      date: post.timestamp,
      tags: post.tags,
      likes: post.likes,
      suggestedCast: cast,
      beats: beats,
      source: 'wahwire',
    };
  };


  /* ------------------------------------------------------------------ *
   * What Ifs — a few long scenarios, composed by the page, not the model
   *
   * The rule here is quality over quantity. A scenario is not a sentence
   * and a cast list: it is a brief long enough to run a session from —
   * the divergence, what the archive already has on record, the room, who
   * is standing in it and why, what is at stake, and the questions the
   * table is supposed to answer. Everything is assembled from filed
   * records by the functions below; the model is never asked to invent a
   * premise, so the workload stays where it belongs.
   * ------------------------------------------------------------------ */

  // A brief shorter than this is a prompt, not a scenario, and is dropped.
  RP.WHATIF_MIN_BRIEF = 900;
  RP.WHATIF_MIN_BEATS = 3;

  RP.prettyId = function (id) {
    return String(id || '').split(/[_\-\s]+/).filter(Boolean).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  };

  function sentences(text) {
    return String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(function (s) { return s.trim().length > 3; });
  }
  RP.sentences = sentences;

  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) {
      return p
        .replace(/^#{1,6}\s*/gm, '')                       // headings
        .replace(/^>\s?/gm, '')                            // block quotes
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')           // links → their text
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }).filter(function (p) {
      if (p.length <= 80) return false;
      if (/^filing note/i.test(p)) return false;            // apparatus, not scene
      if (/^[A-Z0-9 ,'’&—-]{24,}$/.test(p)) return false;   // shouted title lines
      return true;
    });
  }

  /** Long prose → beats with real detail. Used wherever a record has a
   *  description but no filed timeline: each paragraph becomes one beat,
   *  its first sentence the headline and the whole paragraph the detail. */
  RP.beatsFromProse = function (text, limit, label) {
    var out = [];
    paragraphs(text).forEach(function (p, i) {
      if (out.length >= (limit || 6)) return;
      var head = sentences(p)[0] || p;
      out.push({
        time: (label || 'beat') + ' ' + (i + 1),
        beat: clip(head.replace(/\*\*/g, ''), 140),
        detail: clip(p.replace(/\*\*/g, ''), 420),
      });
    });
    return out;
  };

  function castLine(c) {
    return '- ' + c.name + (c.why ? ' — ' + c.why : (c.title ? ' — ' + c.title : ''));
  }

  /** The shared shape. `brief` is what the reader sees; `scene` is the
   *  condensed version the model is handed as the situation. */
  function scenario(fields) {
    var cast = (fields.cast || []).filter(Boolean);
    var brief = fields.briefParts.filter(Boolean).join('\n\n');
    return {
      id: fields.id,
      kind: fields.kind,                 // filed | divergence | gap | chamber | flashpoint | custom
      kindLabel: fields.kindLabel,
      name: clip(fields.name, 110),
      premise: clip(fields.premise, 420),
      brief: brief,
      scene: fields.scene || brief,
      image: fields.image || '',
      date: clip(fields.date, 80),
      tags: (fields.tags || []).filter(Boolean).slice(0, 6).map(function (t) { return clip(t, 30); }),
      suggestedCast: cast,
      beats: (fields.beats || []).filter(function (b) { return b && b.beat; }).slice(0, 10),
      questions: (fields.questions || []).filter(Boolean).slice(0, 5),
      source: fields.source || '',
      weight: fields.weight || 0,
      // Starting state for the room this scenario opens: sheets carried over
      // from a previous scene, or a setup written in the scenario settings.
      states: fields.states || null,
      statePreset: fields.statePreset || '',
      setup: fields.setup || null,
    };
  }

  /** Is this scenario worth a card? Long enough, peopled, and scripted. */
  RP.scenarioQuality = function (s) {
    if (!s) return 0;
    var detail = s.beats.reduce(function (n, b) { return n + String(b.detail || '').length; }, 0);
    if (s.brief.length < RP.WHATIF_MIN_BRIEF) return 0;
    if (s.beats.length < RP.WHATIF_MIN_BEATS) return 0;
    if (s.suggestedCast.length < 2) return 0;
    return s.brief.length + detail + (s.suggestedCast.length * 200) + (s.weight * 500);
  };

  function whyFor(role) {
    return clip(role, 110);
  }

  /* ---- engine 1: the archive's own filed What-Ifs ---- */

  RP.whatIfFromFiled = function (record, castById) {
    if (!record || !record.id) return null;
    var chapters = (record.chapters || []).filter(function (c) { return c && (c.heading || c.body); });
    var tagCast = (record.tags || []).map(function (t) {
      return (castById || {})[slug(t)] || null;
    }).filter(Boolean);
    var subject = (castById || {})[slug(record.subject)];
    var cast = [];
    var seen = {};
    [subject].concat(tagCast).filter(Boolean).forEach(function (c) {
      if (seen[c.id]) return; seen[c.id] = 1;
      cast.push(Object.assign({}, c, { why: c.id === (subject || {}).id ? 'the subject of the branch' : 'named in the filing' }));
    });
    var beats = chapters.slice(0, 8).map(function (c, i) {
      var body = sentences(String(c.body || '').replace(/[*_>]/g, ''));
      return {
        time: c.phase ? clip(c.phase, 40) : 'chapter ' + (i + 1),
        beat: clip(c.heading || ('Chapter ' + (i + 1)), 140),
        detail: clip(body.slice(0, 3).join(' '), 420),
      };
    });
    return scenario({
      id: 'whatif:' + record.id,
      kind: 'filed', kindLabel: 'Filed What-If',
      name: clip(record.title, 110),
      premise: record.premise || record.summary,
      image: record.subjectImage || '',
      date: clip(record.filed, 60),
      tags: record.tags,
      weight: 3,
      source: 'whatifs.json → ' + record.id,
      cast: cast,
      beats: beats,
      questions: (record.findings || []).slice(0, 3).map(function (f) { return f.t; }),
      briefParts: [
        '**The divergence.** ' + (record.divergence || record.premise || ''),
        record.epigraph ? '> ' + String(record.epigraph).replace(/\s+/g, ' ') : '',
        '**What the archive already filed.** ' + (record.summary || ''),
        '**How it ran.** The filing has ' + chapters.length + ' chapters' +
          (record.wordCount ? ', about ' + record.wordCount + ' words' : '') +
          (record.resetsTotal ? ', and ' + record.resetsTotal + ' resets that were never going to be enough' : '') +
          '. This scenario picks the branch up at chapter one and lets it run again with you in it — the filed chapters fire as beats, on their own schedule, while you play the people around them.',
        cast.length ? '**Who is in the room.**\n' + cast.map(castLine).join('\n') : '',
        record.verdict && record.verdict.body ? '**The verdict on record.** ' + clip(record.verdict.body, 600) : '',
        '**What is at stake.** ' + clip(record.outcome || record.summary, 400),
      ],
    });
  };

  /* ---- engine 2: the wanted pages — people the archive names but never wrote ---- */

  /** Scan the filed records for people who are referenced and have no
   *  dossier. This is the archive's own Wanted Pages board, recomputed here:
   *  every one of these is a scene nobody has played because the person does
   *  not exist on paper yet. */
  RP.wantedFrom = function (events, factions, castById, limit) {
    var counts = {};
    // Ids that already have a record of some kind are not gaps: a faction or
    // a filed event named in a participant list is a link, not a missing page.
    var known = {};
    (events || []).forEach(function (e) { known[slug(e.id)] = 1; known[slug(e.name)] = 1; });
    (factions || []).forEach(function (f) { known[slug(f.id)] = 1; known[slug(f.name)] = 1; });
    // Bodies get named in participant lists too ("The Iron Legion", "The
    // Regal Empire"). They are institutions with their own records, not
    // people the archive forgot to write up.
    var BODY = /\b(empire|legion|guild|order|patrol|army|navy|company|council|court|clan|house|crew|troop|federation|congress|diet|kingdom|republic|division|bureau|ministry|senate|assembly|toads|forces|garrison)\b/i;
    function note(id, name, from) {
      var key = slug(id || name);
      if (!key || (castById || {})[key] || known[key]) return;
      if (BODY.test(String(name || key).replace(/_/g, ' '))) return;
      var entry = counts[key] || (counts[key] = { id: key, name: clip(name || RP.prettyId(key), 60), count: 0, from: [] });
      entry.count++;
      if (entry.from.length < 6 && from) entry.from.push(from);
    }
    (events || []).forEach(function (e) {
      var others = (e.participants || []).map(function (x) { return String((x && x.id) || ''); });
      (e.participants || []).forEach(function (p) {
        if (!p) return;
        note(p.id, p.name, {
          id: e.id, name: e.name, kind: 'event', summary: e.summary, role: p.role,
          location: e.location, date: e.date, image: e.image, with: others,
          outcome: e.outcome, description: e.description,
          // The filing's own timeline becomes the script for the scene they
          // walked through — the one the archive never wrote them into.
          entries: ((e.timeline || {}).entries || []).slice(0, 8),
        });
      });
    });
    (factions || []).forEach(function (f) {
      var roster = (f.leadership || []).concat(f.notableMembers || []);
      var others = roster.map(function (x) { return String((x && x.id) || ''); });
      roster.forEach(function (m) {
        if (!m) return;
        note(m.id, m.name, { id: f.id, name: f.name, kind: 'faction', summary: f.summary, role: m.role, with: others });
      });
    });
    return Object.keys(counts).map(function (k) { return counts[k]; })
      .filter(function (w) { return w.count >= 1 && w.from.length; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, limit || 12);
  };

  RP.whatIfFromGap = function (wanted, castById) {
    if (!wanted || !wanted.from.length) return null;
    var anchor = wanted.from[0];
    // The unwritten person is playable: that is the entire point of the scene.
    var ghost = RP.normChar({
      id: wanted.id, name: wanted.name,
      title: 'Unwritten — named in ' + wanted.count + ' filings, dossier never filed',
      summary: 'Everything on record about ' + wanted.name + ' is secondhand: ' +
        wanted.from.map(function (f) { return (f.role ? f.role + ', in ' : 'named in ') + f.name; }).join('; ') + '.',
    });
    ghost.why = 'the person nobody has written down';
    var cast = [ghost];
    var seenCast = {};
    wanted.from.forEach(function (f) {
      (f.with || []).forEach(function (id) {
        var c = (castById || {})[slug(id)];
        if (!c || seenCast[c.id] || cast.length >= 6) return;
        seenCast[c.id] = 1;
        cast.push(Object.assign({}, c, { why: 'filed alongside them in ' + f.name }));
      });
    });
    var beats = wanted.from.slice(0, 3).map(function (f) {
      return {
        time: f.kind === 'event' ? 'on record' : 'on the roster',
        beat: clip(wanted.name + ' is named in ' + f.name, 140),
        detail: clip((f.role ? f.role + '. ' : '') + (f.summary || ''), 420),
      };
    });
    // Then the filing itself runs, beat by beat, with them in the room.
    (anchor.entries || []).slice(0, 6).forEach(function (e) {
      if (!e || !e.beat) return;
      beats.push({ time: clip(e.time, 60) || 'the filing', beat: clip(e.beat, 140), detail: clip(e.detail, 420) });
    });
    if (beats.length < 4) {
      // No filed timeline on that record: its own prose carries the scene.
      beats = beats.concat(RP.beatsFromProse(
        [anchor.summary, anchor.description, anchor.outcome].filter(Boolean).join('\n\n'), 5, 'the filing'));
    }
    return scenario({
      id: 'gap:' + wanted.id,
      kind: 'gap', kindLabel: 'Wanted page',
      name: 'What if we finally met ' + wanted.name + '?',
      premise: wanted.name + ' is named in ' + wanted.count + ' filing' + (wanted.count === 1 ? '' : 's') +
        ' and has never been written up. ' +
        'This is the scene where the archive stops referring to them and has to look at them.',
      image: anchor.image || '',
      date: clip(anchor.date, 60),
      tags: ['wanted page', 'unwritten', anchor.kind],
      weight: Math.min(3, wanted.count / 3),
      source: 'wanted pages → ' + wanted.id,
      cast: cast,
      beats: beats,
      questions: [
        'Who are they when they are not being referred to?',
        'Do the filings that name them agree with each other?',
        'What did the archive get wrong by never asking?',
      ],
      briefParts: [
        '**The gap.** ' + wanted.name + ' has been referenced ' +
          (wanted.count === 1 ? 'once' : wanted.count + ' times') + ' across the archive — ' +
          wanted.from.map(function (f) { return f.name; }).join(', ') +
          ' — and has no dossier of their own. Every fact about them is a sentence in somebody else\u2019s filing.',
        '**What the record says, secondhand.**\n' + wanted.from.slice(0, 4).map(function (f) {
          return '- *' + f.name + '*' + (f.role ? ' — ' + clip(f.role, 180) : '') + (f.summary ? '. ' + clip(f.summary, 240) : '');
        }).join('\n'),
        anchor.location ? '**The room.** ' + anchor.location + (anchor.date ? ', ' + anchor.date : '') + '. ' +
          'That is where the record last put them, so that is where this starts.' : '',
        '**Who is in the room.**\n' + cast.map(castLine).join('\n'),
        anchor.summary ? '**The filing they walked through.** ' + clip(anchor.summary, 700) : '',
        '**What is known, and what is not.** Known: they were there, they did what the role line says, and at least ' +
          wanted.count + ' record' + (wanted.count === 1 ? '' : 's') + ' depend' + (wanted.count === 1 ? 's' : '') +
          ' on it. Not known: where they came from, who they answer to, what they wanted out of that day, and whether ' +
          'anyone has asked them since. None of that is contradicted by the archive, because the archive never went ' +
          'looking — which means this scene can settle it rather than argue with it.',
        '**What is at stake.** A name that has been doing work in ' + wanted.count + ' filing' +
          (wanted.count === 1 ? '' : 's') + ' without ever being accountable to one. Play it and the archive gets a ' +
          'first-hand account instead of a hole — which is the only way a wanted page ever gets written.',
      ],
    });
  };

  /* ---- engine 3: a filed event, turned at its hinge ---- */

  RP.whatIfFromEvent = function (event, castById) {
    var entries = ((event && event.timeline) || {}).entries || [];
    if (entries.length < 4 && event) {
      // Events filed as prose rather than a timeline still have a shape:
      // their paragraphs are the beats, and the middle one is the hinge.
      entries = RP.beatsFromProse([event.summary, event.description, event.outcome].filter(Boolean).join('\n\n'), 8, 'the day');
    }
    if (entries.length < 4 || !(event.participants || []).length) return null;
    var fromProse = !((event.timeline || {}).entries || []).length;
    var hingeAt = Math.max(1, Math.floor(entries.length / 2));
    var hinge = entries[hingeAt];
    if (!hinge || !hinge.beat) return null;
    var cast = (event.participants || []).slice(0, 6).map(function (p) {
      var c = (castById || {})[slug(p.id)] || (castById || {})[slug(p.name)];
      return c ? Object.assign({}, c, { why: whyFor(p.role) }) : null;
    }).filter(Boolean);
    var after = entries.slice(hingeAt).slice(0, 6).map(function (e, i) {
      return {
        time: clip(e.time, 60) || ('beat ' + (i + 1)),
        beat: clip(e.beat, 140),
        detail: clip(e.detail, 420) + (i === 0 ? ' — except this time it does not go the way the record says.' : ''),
      };
    });
    return scenario({
      id: 'turn:' + (event.id || slug(event.name)),
      kind: 'divergence', kindLabel: 'Turned at the hinge',
      name: fromProse
        ? 'What if ' + clip(event.name, 60) + ' had turned at the halfway mark?'
        : 'What if \u201C' + clip(hinge.beat, 64) + '\u201D had gone the other way?',
      premise: 'The filing says ' + clip(hinge.beat, 120) + '. Everything after it in the record depends on that. ' +
        'Take the hinge out and the rest of the day has to be played again.',
      image: event.image || '',
      date: clip(event.date, 70),
      tags: ['divergence', clip(event.era, 30), clip(event.type, 30)],
      weight: 2 + Math.min(2, cast.length / 3),
      source: 'events.json → ' + event.id,
      cast: cast,
      beats: after,
      questions: [
        'Who benefits from the hinge turning?',
        'Which of the filed consequences still happen anyway?',
        'What does the archive have to retract?',
      ],
      briefParts: [
        '**What actually happened.** ' + clip(event.summary, 600),
        '**The hinge.** ' + clip(hinge.time ? hinge.time + ' — ' + hinge.beat : hinge.beat, 200) + '. ' + clip(hinge.detail, 420),
        '**The divergence.** In this branch the hinge fails. The people who were in the room are the same people, ' +
          'standing in the same place, with the same information — they simply do not get the outcome the record ' +
          'gives them. Everything filed after this point is now a question.',
        event.location ? '**The room.** ' + event.location + (event.date ? '. ' + event.date : '') + '.' : '',
        cast.length ? '**Who is in the room.**\n' + cast.map(castLine).join('\n') : '',
        event.outcome ? '**What the record says it cost.** ' + clip(event.outcome, 500) : '',
        '**What is at stake.** ' + (entries.length - hingeAt) + ' filed beats downstream of the hinge, all of them ' +
          'now provisional. The beats still fire on their filed schedule; your job is to play the people who have to ' +
          'live with them arriving differently.',
      ],
    });
  };

  /* ---- engine 4: the chambers — a body, a vote, a docket ---- */

  RP.whatIfFromBody = function (body, cast, congress) {
    var needle = String(body.name || '').toLowerCase().replace(/^the\s+/, '');
    var members = (cast || []).filter(function (c) {
      var hay = (c.affiliation + ' ' + c.title + ' ' + c.summary).toLowerCase();
      return needle.length > 3 && hay.indexOf(needle) >= 0;
    }).slice(0, 6).map(function (c) { return Object.assign({}, c, { why: c.affiliation || c.title }); });
    (body.leadership || []).forEach(function (m) {
      var hit = (cast || []).filter(function (c) { return c.id === slug(m.id || m.name); })[0];
      if (hit && !members.some(function (x) { return x.id === hit.id; })) {
        members.unshift(Object.assign({}, hit, { why: m.role || 'leadership' }));
      }
    });
    var beats = RP.beatsFromProse(body.description, 6, 'session');
    var sessions = ((congress || {}).sessions || []).slice(0, 3);
    if (beats.length < 4 && sessions.length) {
      sessions.forEach(function (s) {
        beats.push({ time: clip(s.date || String(s.year), 50), beat: clip(s.name, 140), detail: clip(s.summary, 420) });
      });
    }
    if (members.length < 2) return null;
    return scenario({
      id: 'chamber:' + body.id,
      kind: 'chamber', kindLabel: 'The chamber',
      name: 'What if ' + body.name + ' had voted the other way?',
      premise: clip(body.summary, 300) + ' This scenario sits in the chamber on the day the vote went the way it went — ' +
        'and plays the version where the room does not hold.',
      image: body.image || '',
      tags: ['politics', clip(body.type, 30), clip(body.region, 30)],
      weight: 2,
      source: 'factions.json → ' + body.id,
      cast: members,
      beats: beats.slice(0, 7),
      questions: [
        'Who changes their vote, and what does it cost them at home?',
        'Which member is being leaned on, and by whom?',
        'Does the chamber survive the session?',
      ],
      briefParts: [
        '**The body.** ' + clip(body.summary, 500),
        '**On the record.** ' + clip(paragraphs(body.description).slice(0, 2).join(' '), 700),
        body.leadership && body.leadership.length ? '**Leadership as filed.**\n' + body.leadership.slice(0, 4).map(function (m) {
          return '- ' + m.name + (m.role ? ' — ' + clip(m.role, 160) : '');
        }).join('\n') : '',
        '**The divergence.** The chamber is the same chamber; the arithmetic is the same arithmetic. What changes is ' +
          'that the vote is live when you arrive, and the members in the room have not yet done the thing the record ' +
          'says they did.',
        members.length ? '**Who is in the room.**\n' + members.map(castLine).join('\n') : '',
        '**What is at stake.** Everything the filed vote made possible downstream — the mandates, the resignations, ' +
          'the enforcement arm that was built on the back of it.',
      ],
    });
  };

  /* ---- engine 5: the loudest post on the wire ---- */

  RP.whatIfFromPost = function (post, castById) {
    if (!post || post.comments.length < 2) return null;
    var cast = post.chars.map(function (id) { return (castById || {})[id]; }).filter(Boolean)
      .filter(function (c, i, all) { return all.indexOf(c) === i; })
      .slice(0, 5).map(function (c) { return Object.assign({}, c, { why: c.id === slug(post.author) ? 'posted it' : 'named in the post' }); });
    if (cast.length < 2) return null;
    var beats = post.comments.slice(0, 5).map(function (c, i) {
      var who = ((castById || {})[c.author] || {}).name || RP.prettyId(c.author);
      return { time: 'reply ' + (i + 1), beat: clip(who + ' answers in public', 140), detail: clip(c.content, 420) };
    });
    return scenario({
      id: 'flashpoint:' + post.id,
      kind: 'flashpoint', kindLabel: 'Wire flashpoint',
      name: 'What if ' + post.authorName + ' had been right?',
      premise: 'A post with ' + post.likes + ' likes and ' + post.comments.length + ' public answers. ' +
        'The archive treated it as noise. This scenario treats it as a warning that landed.',
      image: post.image || '',
      date: post.timestamp,
      tags: ['wahwire'].concat(post.tags),
      weight: 1 + Math.min(2, post.comments.length / 3),
      source: 'wahwire → ' + post.id,
      cast: cast,
      beats: beats,
      questions: [
        'Who has to answer for it once it is true?',
        'Who was arguing in the replies because they already knew?',
        'What does the wire do when it is proved right?',
      ],
      briefParts: [
        '**The post.** ' + post.authorName + ', ' + post.timestamp + ':\n\n> ' + clip(post.content, 700),
        '**The public answers.**\n' + post.comments.slice(0, 4).map(function (c) {
          var who = ((castById || {})[c.author] || {}).name || RP.prettyId(c.author);
          return '- **' + who + ':** ' + clip(c.content, 220);
        }).join('\n'),
        '**The divergence.** The wire is not the record — that is the rule everyone quotes. In this branch the post ' +
          'is the record: what it claims is true, and the people who answered it in public are now on the hook for ' +
          'what they said before they knew.',
        '**Who is in the room.**\n' + cast.map(castLine).join('\n'),
        '**What is at stake.** ' + post.likes + ' people signed their name to an opinion about this. Play the hours ' +
          'after it stops being an opinion.',
      ],
    });
  };

  /* ---- the board ---- */

  /** Build the What-If board: every engine runs, everything is scored, the
   *  thin ones are dropped, and the survivors are mixed so one engine cannot
   *  own the page. A dozen long scenarios beats two hundred one-liners. */
  RP.buildWhatIfs = function (archive, castById, opts) {
    opts = opts || {};
    archive = archive || {};
    var cast = Object.keys(castById || {}).map(function (k) { return castById[k]; });
    var out = [];
    (archive.whatifs || []).forEach(function (w) { out.push(RP.whatIfFromFiled(w, castById)); });
    RP.wantedFrom(archive.events, archive.factions, castById, 10).forEach(function (w) {
      out.push(RP.whatIfFromGap(w, castById));
    });
    (archive.events || []).slice(-40).forEach(function (e) { out.push(RP.whatIfFromEvent(e, castById)); });
    (archive.factions || []).forEach(function (f) {
      if (!/diet|congress|patrol|council|assembly|senate|court/i.test(f.name || '')) return;
      out.push(RP.whatIfFromBody(f, cast, archive.congress));
    });
    RP.sortPosts(archive.posts || [], 'loudest').slice(0, 12).forEach(function (p) {
      out.push(RP.whatIfFromPost(p, castById));
    });
    RP.sagasFrom(archive.events).slice(0, 8).forEach(function (saga) {
      out.push(RP.whatIfFromContinuation(saga, castById));
    });

    var scored = out.filter(Boolean).map(function (s) { return { s: s, q: RP.scenarioQuality(s) }; })
      .filter(function (x) { return x.q > 0; })
      .sort(function (a, b) { return b.q - a.q; });

    // Round-robin by kind so the board is not six versions of one engine.
    var byKind = {};
    scored.forEach(function (x) { (byKind[x.s.kind] = byKind[x.s.kind] || []).push(x.s); });
    var kinds = Object.keys(byKind), picked = [], limit = opts.limit || 12, i = 0;
    while (picked.length < limit) {
      var added = false;
      for (var k = 0; k < kinds.length; k++) {
        var list = byKind[kinds[k]];
        if (list[i]) { picked.push(list[i]); added = true; }
        if (picked.length >= limit) break;
      }
      if (!added) break;
      i++;
    }
    return picked;
  };

  /* ---- the reader's own scenario, composed from the archive ---- */

  /** Find the filed records a description is talking about. Plain string
   *  matching on names — deterministic, instant, and good enough that the
   *  model never has to be asked "who did they mean?". */
  RP.matchArchive = function (text, archive, castById) {
    var hay = ' ' + String(text || '').toLowerCase() + ' ';
    function hits(list, nameOf) {
      return (list || []).filter(function (r) {
        var name = String(nameOf ? nameOf(r) : r.name || '').toLowerCase().trim();
        if (name.length < 4) return false;
        // Whole words only: "luigi" must not match inside "Waluigi".
        var at = hay.indexOf(name);
        while (at >= 0) {
          var before = hay.charAt(at - 1), after = hay.charAt(at + name.length);
          if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
          at = hay.indexOf(name, at + 1);
        }
        return false;
      });
    }
    var chars = hits(Object.keys(castById || {}).map(function (k) { return castById[k]; }));
    return {
      chars: chars.slice(0, 8),
      events: hits(archive.events).slice(0, 3),
      factions: hits(archive.factions).slice(0, 3),
      whatifs: hits(archive.whatifs, function (w) { return w.title; }).slice(0, 2),
    };
  };

  /** Describe it, and the page writes the brief: your premise, plus what the
   *  archive already has on everyone and everything you named, plus a script
   *  taken from the matched filing's own timeline. No model call. */
  RP.composeScenario = function (input, archive, castById) {
    input = input || {};
    var text = String(input.text || '').trim();
    var found = RP.matchArchive(text + ' ' + (input.title || ''), archive || {}, castById);
    var picked = (input.castIds || []).map(function (id) { return (castById || {})[id]; }).filter(Boolean);
    var cast = picked.concat(found.chars.filter(function (c) {
      return !picked.some(function (p) { return p.id === c.id; });
    })).slice(0, 8).map(function (c) {
      return Object.assign({}, c, { why: c.title || c.affiliation || 'named in the premise' });
    });
    var anchor = found.events[0];
    // Anyone filed in the records you named belongs in the room too.
    var seenCast = {};
    cast.forEach(function (c) { seenCast[c.id] = 1; });
    (anchor ? anchor.participants || [] : []).forEach(function (p) {
      var c = (castById || {})[slug(p && p.id)];
      if (!c || seenCast[c.id] || cast.length >= 8) return;
      seenCast[c.id] = 1;
      cast.push(Object.assign({}, c, { why: whyFor(p.role) || ('filed in ' + anchor.name) }));
    });
    found.factions.forEach(function (f) {
      (f.leadership || []).forEach(function (m) {
        var c = (castById || {})[slug(m && m.id)];
        if (!c || seenCast[c.id] || cast.length >= 8) return;
        seenCast[c.id] = 1;
        cast.push(Object.assign({}, c, { why: (m.role ? m.role + ', ' : '') + f.name }));
      });
    });
    var beats = [];
    if (anchor && anchor.timeline && (anchor.timeline.entries || []).length) {
      beats = anchor.timeline.entries.slice(0, 6).map(function (e, i) {
        return { time: clip(e.time, 60) || ('beat ' + (i + 1)), beat: clip(e.beat, 140), detail: clip(e.detail, 420) };
      });
    }
    if (beats.length < 3 && anchor) {
      // No filed timeline: the matched filing's own prose becomes the script.
      beats = beats.concat(RP.beatsFromProse((anchor.summary || '') + '\n\n' + (anchor.outcome || ''), 4, 'on record'));
    }
    if (beats.length < 3 && found.factions[0]) {
      beats = beats.concat(RP.beatsFromProse(found.factions[0].description || found.factions[0].summary, 3, 'the body'));
    }
    if (beats.length < 3) {
      sentences(text).forEach(function (line) {
        if (beats.length >= 6 || line.length < 20) return;
        beats.push({ time: 'beat ' + (beats.length + 1), beat: clip(line, 140), detail: clip(line, 420) });
      });
    }
    if (beats.length < 3) {
      // Last resort: a three-beat spine built out of your own premise, so a
      // one-line idea still arrives as a scene that moves on its own.
      var where = (anchor && anchor.location) || (found.factions[0] && found.factions[0].name) || 'the room';
      var who = cast.map(function (c) { return c.name; }).join(', ') || 'whoever is standing there';
      beats = [
        { time: 'cold open', beat: 'The room assembles', detail: 'In ' + where + ': ' + who + '. Nothing has gone wrong yet, and everyone is behaving as though the record still holds.' },
        { time: 'the turn', beat: clip(sentences(text)[0] || 'The premise arrives', 140), detail: clip(text, 420) },
        { time: 'the cost', beat: 'Somebody has to answer for it', detail: 'The consequence lands on whoever is closest, and the archive has to decide what it writes down.' },
      ];
    }
    var questions = sentences(text).filter(function (s) { return /\?$/.test(s.trim()); }).slice(0, 3);
    return scenario({
      id: 'custom:' + (slug(input.title) || uid()),
      kind: 'custom', kindLabel: 'Yours',
      // "What if …" once, not twice: most people write the words themselves.
      name: clip(input.title || (/^\s*what if\b/i.test(text) ? sentences(text)[0] : 'What if ' + clip(sentences(text)[0] || 'this happened', 60)), 110),
      premise: clip(text, 400),
      image: (anchor && anchor.image) || '',
      date: anchor ? clip(anchor.date, 70) : '',
      tags: ['custom'].concat(found.factions.map(function (f) { return clip(f.name, 30); })),
      weight: 5,
      source: 'written by ' + ((archive && archive.userName) || 'you'),
      cast: cast,
      beats: beats,
      questions: questions.length ? questions : [
        'Who is standing closest to the change?',
        'What does the archive have to correct afterwards?',
      ],
      briefParts: [
        '**The premise, as you wrote it.** ' + text,
        cast.length ? '**Who the archive matched.**\n' + cast.map(function (c) {
          return '- **' + c.name + '**' + (c.title ? ' — ' + c.title : '') + (c.summary ? '. ' + clip(c.summary, 220) : '');
        }).join('\n') : '',
        found.events.length ? '**Filed events this touches.**\n' + found.events.map(function (e) {
          return '- *' + e.name + '*' + (e.date ? ' (' + clip(e.date, 60) + ')' : '') + '. ' + clip(e.summary, 260);
        }).join('\n') : '',
        found.factions.length ? '**Bodies involved.**\n' + found.factions.map(function (f) {
          return '- *' + f.name + '*. ' + clip(f.summary, 260);
        }).join('\n') : '',
        anchor && anchor.location ? '**The room.** ' + anchor.location + (anchor.date ? ', ' + anchor.date : '') + '.' : '',
        '**How it will run.** ' + (anchor && beats.length
          ? 'The beats come from the filed timeline of *' + anchor.name + '*: they fire on their own schedule while you play around them.'
          : 'Your description was split into beats, in the order you wrote it, so the scene still moves without you having to push it.'),
      ],
    });
  };

  /** Room options for any scenario — the same shape a scene card produces. */
  RP.scenarioRoomOpts = function (s) {
    return {
      scene: [s.premise, s.scene].filter(Boolean).join('\n\n'),
      sceneName: s.name,
      sceneImage: s.image,
      beats: s.beats,
      date: s.date || '',
      opener: s.kindLabel + ' — ' + s.name + '\n\n' + s.premise,
      // Starting state: a sequel's inherited sheets, or a scenario setup.
      states: s.states || null,
      setup: s.setup || {},
      statePreset: s.statePreset || 'rpg',
      sequelOf: s.sequelOf || '',
      canon: s.kind === 'continuation' ? 'continuation' : '',
    };
  };

  /* ------------------------------------------------------------------ *
   * collections — the archive's own groupings, as instant casts
   * ------------------------------------------------------------------ */

  RP.normCollection = function (record, castById) {
    record = record || {};
    var members = (record.members || []).map(function (m) {
      var hit = (castById || {})[String(m && m.id)];
      return hit ? Object.assign({}, hit, { role: clip(m.role, 90) }) : null;
    }).filter(Boolean);
    return {
      id: String(record.id || slug(record.name) || uid()),
      name: clip(record.name, 90),
      title: clip(record.title, 120),
      summary: clip(record.summary, 300),
      scope: clip(record.scope, 120),
      members: members,
      total: (record.members || []).length,
    };
  };

  /* ------------------------------------------------------------------ *
   * the director — who speaks next, and when the scene comes back to you
   * ------------------------------------------------------------------ */

  // A group chat that never hands back is just two bots talking past you.
  RP.MAX_CHAIN = 4;

  /** Character turns played since the user's last turn. */
  RP.chainLength = function (room) {
    var msgs = (room && room.messages) || [];
    var n = 0;
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (!visible(msgs[i])) continue;
      if (msgs[i].role === 'user') break;
      n++;
    }
    return n;
  };

  /** The question put to the model after every group reply: does this scene
   *  keep going between the characters, or does it need the player? */
  RP.directorPrompt = function (room, lastSpeaker) {
    var cast = (room.cast || []).filter(function (c) { return !lastSpeaker || c.id !== lastSpeaker.id; });
    var recent = RP.historyFor(room, 6).map(function (m) { return (m.role === 'user' ? 'PLAYER: ' : '') + m.content; }).join('\n');
    return [
      'You are directing a group roleplay scene. Decide who speaks next.',
      '',
      'The cast, other than whoever just spoke:',
      cast.map(function (c) { return '- ' + c.name + (c.title ? ' — ' + c.title : ''); }).join('\n'),
      '',
      'The last few turns:',
      recent,
      '',
      'Answer with ONE line and nothing else:',
      'NEXT: <the exact name of the character who should speak next>',
      '   — choose this when a character is being addressed, contradicted, or plainly has to answer.',
      'WORLD',
      '   — choose this when nobody needs to speak but the scene should move: time passing, weather, an arrival, '
      + 'a noise, the place itself doing something.',
      'USER',
      '   — choose this when the scene is waiting on the player: they were asked something, the exchange has '
      + 'run its course, a decision is theirs, or the characters are starting to repeat each other.',
      'Prefer USER when in doubt. Never pick the character who just spoke.',
    ].join('\n');
  };

  /** Read the director's answer. Anything unrecognisable hands back to the
   *  player, and so does an over-long chain — the loop has a hard stop. */
  RP.parseDirector = function (text, room, lastSpeaker) {
    if (RP.chainLength(room) >= (room.maxChain || RP.MAX_CHAIN)) {
      return { next: 'user', reason: 'the scene has run several turns without you' };
    }
    var value = String(text || '').trim();
    if (/^\s*WORLD\s*$/im.test(value)) return { next: 'world', reason: 'the scene moves on its own' };
    var match = /NEXT\s*:\s*([^\n]+)/i.exec(value);
    if (!match) return { next: 'user', reason: 'the scene is waiting on you' };
    var wanted = match[1].replace(/["'.*]/g, '').trim().toLowerCase();
    if (!wanted || wanted === 'user' || wanted === 'player') return { next: 'user', reason: 'the scene is waiting on you' };
    if (wanted === 'world' || wanted === 'the world' || wanted === 'narration') {
      return { next: 'world', reason: 'the scene moves on its own' };
    }
    var hit = (room.cast || []).filter(function (c) {
      return c.name.toLowerCase() === wanted || wanted.indexOf(c.name.toLowerCase()) >= 0 || c.name.toLowerCase().indexOf(wanted) >= 0;
    })[0];
    if (!hit || (lastSpeaker && hit.id === lastSpeaker.id)) return { next: 'user', reason: 'the scene is waiting on you' };
    return { next: hit.id, reason: 'answering ' + ((lastSpeaker && lastSpeaker.name) || 'the last turn') };
  };


  /* ------------------------------------------------------------------ *
   * character state — HP, MP, flags, counters, inventory
   *
   * A scene that cannot be wounded is a chat. Every room carries a sheet
   * per character; the model reads the sheets in its prompt and writes to
   * them with stage directions (see DIRECTIVES below), so "he takes the
   * hit" and "hp 42/60" stop being two different conversations.
   * ------------------------------------------------------------------ */

  RP.STATE_PRESETS = {
    story:  { name: 'Story — no numbers', hp: 0, mp: 0 },
    stakes: { name: 'Stakes — HP only', hp: 100, mp: 0 },
    rpg:    { name: 'RPG — HP and Energy', hp: 100, mp: 50 },
  };

  /** A fresh sheet. `setup` overrides the start: { hpPct, mpPct, status,
   *  flags: 'wounded, hunted', items: 'rope, lantern' }. */
  /** Items are things, not strings: a name, a note about it, whether it is
   *  in hand, and how many. Old string inventories are upgraded on read. */
  /* An emoji per kind of thing, so a sheet can be read at a glance. The
   * model may set one itself; this is the fallback, by what it is called. */
  RP.ICONS = [
    [/\b(key|keys)\b/i, '🗝'], [/\b(sword|blade|knife|dagger|machete)\b/i, '🗡'],
    [/\b(gun|pistol|rifle|musket)\b/i, '🔫'], [/\b(bow|arrow|arrows|quiver)\b/i, '🏹'],
    [/\b(shield|buckler)\b/i, '🛡'], [/\b(hammer|mallet|rolling pin)\b/i, '🔨'],
    [/\b(rope|cord|line)\b/i, '🪢'], [/\b(lamp|lantern|torch|candle)\b/i, '🏮'],
    [/\b(book|ledger|tome|codex)\b/i, '📕'], [/\b(note|notes|notepad|paper|papers|sheet|sheets|file|files|letter)\b/i, '📄'],
    [/\b(map|chart)\b/i, '🗺'], [/\b(tape|cassette|reel)\b/i, '📼'],
    [/\b(coin|coins|gold|purse|money)\b/i, '🪙'], [/\b(potion|vial|flask|tonic)\b/i, '🧪'],
    [/\b(food|bread|ration|rations|apple)\b/i, '🍞'], [/\b(water|canteen|bottle)\b/i, '🧴'],
    [/\b(bandage|bandages|kit|salve)\b/i, '🩹'], [/\b(ring|amulet|charm|talisman)\b/i, '💍'],
    [/\b(stone|shard|crystal|gem)\b/i, '💎'], [/\b(cloak|coat|boots|glove|gloves|hat)\b/i, '🧥'],
    [/\b(watch|clock|stopwatch)\b/i, '⏱'], [/\b(bomb|grenade|charge)\b/i, '💣'],
    [/\b(pipe|wrench|tool|tools)\b/i, '🔧'], [/\b(photo|photograph|picture|plate)\b/i, '🖼'],
  ];

  RP.iconFor = function (name) {
    var text = String(name || '');
    for (var i = 0; i < RP.ICONS.length; i++) {
      if (RP.ICONS[i][0].test(text)) return RP.ICONS[i][1];
    }
    return '📦';
  };

  /* ---- the wardrobe department: profile → kit, slots and stats.
   * All of it is derived from the filed record, deterministically —
   * hash-stable like the voices and the avatar tints — so a character
   * walks in outfitted like themselves in every browser, and no model
   * call is ever spent on it. ---- */

  /** What a filed profile reads as. Each bucket is a few candidate items;
   *  the hash picks one, so two soldiers do not carry the same blade. */
  RP.KIT_TABLE = [
    [/soldier|captain|general|commander|warlord|legion|guard|knight|warrior|paratroopa|merc/i,
      ['🗡 a service blade | kept sharper than regulation', '🛡 a dented shield | it has earned the dents', '🗡 a short sword | the grip rewrapped twice'],
      ['🩹 a field dressing | rolled tight', '🪙 back pay | most of it owed away']],
    [/archivist|historian|scribe|record|librarian|clerk|scholar/i,
      ['📄 working papers | annotated past reading', '📕 a duty ledger | two hands of ink in it', '📄 copied filings | the dates underlined'],
      ['🖋 a good pen | fought for at the stores desk', '🏮 a reading lamp | wick trimmed low']],
    [/mage|magic|arcane|wizard|sorcer|witch|oracle|ritual/i,
      ['📕 a working grimoire | three pages dog-eared', '💎 a focus stone | warm to the touch', '🧪 a prepared draught | unlabelled on purpose'],
      ['🕯 ritual candles | half burned down']],
    [/thief|looter|infiltrat|rogue|spy|smuggler|pickpocket/i,
      ['🔧 picks and shims | quiet in their roll', '🗝 a key that should not exist | it opens more than one door', '🪢 a coil of dark cord | pre-knotted'],
      ['🪙 somebody else\u2019s coin | still warm']],
    [/merchant|debt|acquisitions|coin|profit|bank|business|trader/i,
      ['🪙 a working purse | counted twice daily', '📄 a book of debts | names, sums, dates'],
      ['📄 a blank contract | the fine print pre-written', '⏱ a good watch | collateral, technically']],
    [/hunter|ranger|scout|tracker|trapper/i,
      ['🏹 a strung bow | kept out of the rain', '🗡 a skinning knife | honest work on the handle'],
      ['🪢 snare wire | wound on a stick', '🍞 trail rations | more than they look']],
    [/healer|doctor|medic|nurse|surgeon|priest|cleric/i,
      ['🩹 a dressing kit | rolled and boiled', '🧪 a tincture | measured doses marked'],
      ['📄 case notes | initials only']],
    [/sailor|pilot|charter|driver|courier|caravan/i,
      ['🗺 a working chart | corrected by hand', '🪢 good line | spliced at both ends'],
      ['🧴 a canteen | dented, trusted']],
    [/engineer|mechanic|tinker|smith|builder|mason/i,
      ['🔧 a tool roll | nothing missing', '🔨 a fitting hammer | the handle replaced, twice'],
      ['📄 a marked-up schematic | do not fold']],
  ];

  /** A pocket item everyone gets, picked by hash — texture, not power. */
  RP.POCKET = ['🪙 a few small coins', '📄 a folded note | not theirs to read',
    '🕯 a candle stub', '⏱ a watch that runs slow', '🧵 odds and ends | string, a button, a pin'];

  /** The starting kit a profile earns: at most one item from each of the
   *  first two buckets it matches, one bucket extra, one pocket item.
   *  Two to four things — a kit, not a shop. */
  RP.kitFor = function (char) {
    char = char || {};
    var text = ((char.title || '') + ' ' + (char.status || '') + ' ' + (char.summary || '') + ' ' +
      (char.description || '') + ' ' + (char.faction || '')).toLowerCase();
    // Shift with >>>: hash() is unsigned, and `seed >> 4` on anything over
    // 2^31 went negative — a negative index, an undefined pocket item, and
    // a nameless 📦 in the pack of every other character.
    var seed = hash(char.id || char.name || '');
    var items = [];
    for (var i = 0; i < RP.KIT_TABLE.length && items.length < 3; i++) {
      var row = RP.KIT_TABLE[i];
      if (!row[0].test(text)) continue;
      var main = row[1][seed % row[1].length];
      items.push(main);
      if (items.length < 3 && row[2] && (seed >>> 2) % 2 === 0) {
        items.push(row[2][(seed >>> 3) % row[2].length]);
      }
    }
    items.push(RP.POCKET[(seed >>> 4) % RP.POCKET.length]);
    return RP.cleanKit(items.slice(0, 4));
  };

  /** A kit without its nameless entries — an item with no name is an
   *  empty 📦 box that can be taken, used and handed over as nothing. */
  RP.cleanKit = function (items) {
    return (items || []).filter(Boolean).map(RP.normItem).filter(function (i) { return i.name.trim(); });
  };

  /** One-time sweep of saved sheets: kits dressed before the fix above
   *  still carry the empty boxes. Returns how many were thrown out. */
  RP.sweepEmptyItems = function (state) {
    var gone = 0;
    (state && state.rooms || []).forEach(function (r) {
      Object.keys((r && r.states) || {}).forEach(function (id) {
        var s = r.states[id];
        if (!s || !Array.isArray(s.items)) return;
        var kept = RP.cleanKit(s.items);
        gone += s.items.length - kept.length;
        if (kept.length !== s.items.length) s.items = kept;
      });
    });
    return gone;
  };

  /** How many slots a pack has. A quartermaster hauls, a ghost does not,
   *  and the reader always gets the full twelve. */
  RP.packSizeFor = function (char) {
    char = char || {};
    var text = ((char.title || '') + ' ' + (char.summary || '') + ' ' + (char.description || '')).toLowerCase();
    var slots = 6;
    if (/merchant|smuggler|scavenger|quartermaster|trader|courier|caravan|collector/.test(text)) slots += 2;
    if (/ghost|spirit|undead|revenant|monster|beast|titan|dragon|plant|creature/.test(text)) slots -= 3;
    if (/king|queen|regent|noble|lord|lady|prince|princess/.test(text)) slots -= 1;   // other people carry for them
    return Math.max(3, Math.min(10, slots));
  };

  /* ---- pseudo-stats: four numbers that lean on the dice, not the prose.
   * ⚔ might, 🧠 wits, 🗣 sway, 🍀 luck — 0 poor, 1 fair, 2 good, 3 sharp.
   * They are read out of the filed record once, shown as chips, editable
   * by hand, and spent exactly one place: the fate roll. ---- */

  RP.STAT_KEYS = ['might', 'wits', 'sway', 'luck'];
  RP.STAT_ICONS = { might: '⚔', wits: '🧠', sway: '🗣', luck: '🍀' };

  RP.statsFor = function (char) {
    char = char || {};
    var text = ((char.title || '') + ' ' + (char.status || '') + ' ' + (char.summary || '') + ' ' +
      (char.description || '')).toLowerCase();
    var s = { might: 1, wits: 1, sway: 1, luck: 1 };
    if (/soldier|captain|general|commander|warlord|legion|guard|knight|warrior|monster|beast|titan|dragon|smith|brawler|paratroopa/.test(text)) s.might += 1;
    if (/archivist|historian|scribe|record|librarian|mage|magic|arcane|wizard|sorcer|oracle|scholar|engineer|doctor|witch|detective/.test(text)) s.wits += 1;
    if (/king|queen|lord|lady|prince|princess|speaker|delegate|noble|regent|merchant|priest|jester|comedian|diplomat|singer/.test(text)) s.sway += 1;
    if (/thief|looter|infiltrat|rogue|spy|smuggler|gambl|prank|drifter|scavenger|pirate/.test(text)) s.luck += 1;
    if (Number(char.powerLevel || 0) >= 7) s.might += 1;
    if (/coward|nervous|anxious|timid/.test(text)) s.sway = Math.max(0, s.sway - 1);
    if (/injured|wounded|dying|frail|old age|elderly/.test(text)) s.might = Math.max(0, s.might - 1);
    // One hash point so two clerks are not the same clerk.
    s[RP.STAT_KEYS[hash(char.id || char.name || '') % 4]] += 1;
    RP.STAT_KEYS.forEach(function (k) { s[k] = Math.max(0, Math.min(3, s[k])); });
    return s;
  };

  RP.statLine = function (stats) {
    if (!stats) return '';
    return RP.STAT_KEYS.map(function (k) { return RP.STAT_ICONS[k] + (stats[k] === undefined ? 1 : stats[k]); }).join(' ');
  };

  /** Which stat an attempt leans on, from the player's own words. */
  RP.actionStat = function (text) {
    var t = ' ' + String(text || '').toLowerCase() + ' ';
    if (/\b(hit|strike|attack|swing|punch|fight|shove|charge|force|break|smash|grapple|wrestle|kick|stab|tackle|slam|wrench|lift|drag|hold (him|her|them|it) down|push|pull|pry|haul|heave|carry|shoulder|barge|ram|crush|bend|chop|hack|slash|cut (him|her|them|it) down|parry|block|brace|pin|restrain|strangle|choke|batter|kick (the|down)|tear|rip|bash|hurl|wrestle|overpower|hold the (door|line))\b/.test(t)) return 'might';
    if (/\b(persuade|convince|talk|lie|bluff|charm|bargain|negotiate|plead|threaten|intimidate|order|flatter|reassure|calm|appeal|argue|beg|demand|insist|promise|offer|deal|seduce|comfort|soothe|inspire|rally|command|bribe|coax|haggle|apologi[sz]e|confess|taunt|mock|sweet[- ]talk|speech|address the|ask (him|her|them) to|tell (him|her|them) to|lie to|reason with|win (him|her|them) over)\b/.test(t)) return 'sway';
    if (/\b(search|examine|inspect|study|read|decipher|recall|remember|figure|work out|notice|listen|track|analyse|analyze|calculate|identify|diagnose|investigate|deduce|solve|puzzle|map|plan|count|measure|translate|forge|repair|fix|mend|build|rig|disarm|appraise|spot|assess|guess|recogni[sz]e|interpret|test|check (the|for)|look (for|closer|closely|over)|scan|memori[sz]e)\b/.test(t)) return 'wits';
    if (/\b(sneak|steal|pick|hide|slip|dodge|duck|gamble|climb|leap|jump|vault|escape|palm|swipe|creep|dash|run|sprint|flee|bolt|tumble|roll|tiptoe|shadow|pickpocket|lockpick|balance|swim|dive|catch|snatch|bet|wager|chance it|risk it|shoot|fire|aim|loose|throw|toss|fling|lob|juggle|feint|weave|sidestep|ambush|follow (him|her|them) unseen)\b/.test(t)) return 'luck';
    return '';
  };

  RP.normItem = function (value) {
    if (value && typeof value === 'object') {
      return {
        name: clip(value.name, 60), note: clip(value.note, 160),
        icon: clip(value.icon, 4) || RP.iconFor(value.name),
        equipped: Boolean(value.equipped), qty: Math.max(1, Number(value.qty || 1)),
      };
    }
    // "🗝 a brass key | bent, from the ledger room" — the icon is optional.
    var text = String(value || '').trim();
    var lead = /^([\u{1F300}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}]{1,2})\s+/u.exec(text);
    var icon = lead ? lead[1] : '';
    if (lead) text = text.slice(lead[0].length);
    var split = text.split('|');
    var name = clip(split[0], 60);
    return {
      name: name, note: clip(split.slice(1).join('|'), 160),
      icon: icon || RP.iconFor(name), equipped: false, qty: 1,
    };
  };

  /** The inventory as a grid of slots: what is in hand first, then the
   *  rest, then empty slots so the shape stays the same. */
  RP.gridSlots = function (sheet, size) {
    size = size || (sheet && sheet.slots) || 12;
    var kit = RP.cleanKit(sheet && sheet.items);
    var held = kit.filter(function (i) { return i.equipped; });
    var stowed = kit.filter(function (i) { return !i.equipped; });
    var slots = held.concat(stowed).slice(0, size);
    while (slots.length < size) slots.push(null);
    return slots;
  };

  /* An emoji per kind of affliction, same idea as the kit icons: a sheet
   * full of conditions should read at a glance too. */
  RP.CONDITION_ICONS = [
    [/bleed|cut|gash|wound/i, '🩸'], [/poison|venom|toxin/i, '☠️'], [/burn|fire|scorch|ablaze/i, '🔥'],
    [/freez|frozen|chill|frost/i, '🧊'], [/stun|dazed|concuss/i, '💫'], [/bless|warded|shielded/i, '✨'],
    [/curse|hex|marked/i, '🕯️'], [/fear|afraid|terrif|panick/i, '😨'], [/exhaust|tired|winded|fatigu/i, '😮‍💨'],
    [/hidden|unseen|stealth/i, '🫥'], [/bound|chained|tied|shackl/i, '⛓️'], [/sick|ill|fever|nausea/i, '🤢'],
    [/charm|smitten|swayed/i, '💘'], [/rage|furious|berserk/i, '😡'], [/blind/i, '🙈'], [/silenc|mute/i, '🤐'],
    [/hunt|wanted|tracked/i, '🎯'], [/drunk|tipsy/i, '🍺'], [/broken|crack|sprain|fractur/i, '🦴'],
  ];

  RP.condIcon = function (name) {
    var text = String(name || '').replace(/_/g, ' ');
    for (var i = 0; i < RP.CONDITION_ICONS.length; i++) {
      if (RP.CONDITION_ICONS[i][0].test(text)) return RP.CONDITION_ICONS[i][1];
    }
    return '⚠️';
  };

  /** "bleeding 3 -2hp | a deep cut across the palm" → one live condition.
   *  The per-turn cost comes off the head first, then the turns left, and
   *  whatever remains is the condition itself. Plain "hunted" works too —
   *  it just never ticks. One parser for the setup forms, the sheet
   *  editor and the COND direction, so they cannot drift apart. */
  RP.parseCondition = function (line) {
    var parts = String(line || '').split('|');
    var head = parts[0].trim();
    var effect = /\s([+-]\d{1,3}(?:hp|mp|en|energy|stamina))\s*$/i.exec(head);
    if (effect) head = head.slice(0, effect.index).trim();
    var turns = /\s(\d{1,2})\s*$/.exec(head);
    if (turns) head = head.slice(0, turns.index).trim();
    var key = slug(head);
    if (!key) return null;
    return {
      key: key, name: head,
      turns: turns ? Number(turns[1]) : 0,
      effect: effect ? RP.normEffect(effect[1]) : '',
      note: clip(parts.slice(1).join('|'), 160),
    };
  };

  /** What a condition does to you every turn it lasts: "-2hp" bleeds. */
  RP.conditionEffect = function (effect) {
    var hit = /^\s*([+-]?\d{1,3})\s*(hp|mp|en|energy|stamina)\s*$/i.exec(String(effect || ''));
    if (!hit) return null;
    return { pool: /^hp$/i.test(hit[2]) ? 'hp' : 'mp', amount: Number(hit[1]) };
  };
  /** "-2en", "-1energy", "-3stamina" are all the Energy pool, which is
   *  still called `mp` on the sheet so old saves keep working. */
  RP.normEffect = function (effect) {
    return String(effect || '').toLowerCase().replace(/(en|energy|stamina)$/, 'mp');
  };

  /** Count down anything temporary. Returns the lines to show the reader. */
  RP.tickConditions = function (room) {
    var lines = [];
    Object.keys((room && room.states) || {}).forEach(function (id) {
      var sheet = room.states[id];
      if (!sheet || sheet.present === false) return;
      Object.keys(sheet.flags || {}).forEach(function (key) {
        var cond = sheet.flags[key];
        if (!cond || typeof cond !== 'object') return;
        // What it does, every turn it lasts — bleeding actually bleeds.
        var effect = RP.conditionEffect(cond.effect);
        if (effect && sheet[effect.pool]) {
          var line = RP.applyChange(sheet, {
            kind: effect.pool, op: effect.amount < 0 ? '-' : '+', value: Math.abs(effect.amount),
          });
          if (line) lines.push(line + ' — ' + key.replace(/_/g, ' '));
        }
        if (!cond.turns) return;
        cond.turns -= 1;
        if (cond.turns <= 0) {
          delete sheet.flags[key];
          lines.push(sheet.name + ' is no longer ' + key.replace(/_/g, ' '));
        }
      });
    });
    return lines;
  };

  RP.blankSheet = function (char, preset, setup) {
    preset = RP.STATE_PRESETS[preset] || RP.STATE_PRESETS.rpg;
    setup = setup || {};
    var hpMax = Number(setup.hpMax || preset.hp || 0);
    var mpMax = Number(setup.mpMax || preset.mp || 0);
    var pct = function (v, max) {
      var n = v === undefined || v === '' ? 100 : Number(v);
      if (isNaN(n)) n = 100;
      return Math.max(0, Math.min(max, Math.round((max * n) / 100)));
    };
    var sheet = {
      id: char.id, name: char.name,
      hp: hpMax ? { value: pct(setup.hpPct, hpMax), max: hpMax } : null,
      mp: mpMax ? { value: pct(setup.mpPct, mpMax), max: mpMax } : null,
      flags: {}, counters: {}, items: [],
      status: clip(setup.status, 120),
      present: setup.present === undefined ? true : Boolean(setup.present),
    };
    // "bleeding 3 -2hp | a deep cut" is one condition with a bite, not
    // three words — split on newlines and semicolons when notes are in
    // play, commas only for the quick "wounded, hunted" shorthand.
    var rawFlags = String(setup.flags || '');
    (/[\n;|]/.test(rawFlags) ? rawFlags.split(/[\n;]/) : rawFlags.split(',')).forEach(function (f) {
      var cond = RP.parseCondition(f);
      if (cond) sheet.flags[cond.key] = { note: cond.note, turns: cond.turns, effect: cond.effect };
    });
    // Split on semicolons when notes are in play, so "a key | bent, old"
    // stays one item rather than becoming two.
    var rawItems = String(setup.items || '');
    (/[;|]/.test(rawItems) ? rawItems.split(';') : rawItems.split(',')).forEach(function (i) {
      var item = RP.normItem(i);
      if (item.name) sheet.items.push(item);
    });
    // The profile decides the rest: how much they can carry, and the four
    // numbers the dice will listen to. Both are deterministic and free.
    sheet.slots = RP.packSizeFor(char);
    sheet.stats = RP.statsFor(char);
    return sheet;
  };

  /** Dress a fresh sheet from the filed profile: a character whose setup
   *  named no kit walks in carrying what somebody like them would carry
   *  (`room.kit = 'off'` turns the outfitting off for a whole room). */
  RP.outfit = function (room, char, sheet) {
    if (!sheet || (room && room.kit === 'off')) return sheet;
    if (!(sheet.items || []).length && !sheet.player) {
      sheet.items = RP.kitFor(char).slice(0, sheet.slots || 6);
    }
    return sheet;
  };

  /** Every character in the room has a sheet, including anyone the model
   *  has just walked into the scene. */
  RP.ensureSheets = function (room, preset, setups) {
    room.states = room.states || {};
    room.statePreset = room.statePreset || preset || 'rpg';
    (room.cast || []).forEach(function (c) {
      if (!room.states[c.id]) {
        var setup = (setups || {})[c.id];
        room.states[c.id] = RP.blankSheet(c, room.statePreset, setup);
        // A hand-written kit owns the sheet; a blank field means "dress them".
        if (!setup || !String(setup.items || '').trim()) RP.outfit(room, c, room.states[c.id]);
      }
    });
    return room.states;
  };

  RP.sheetFor = function (room, charId) {
    return ((room && room.states) || {})[charId] || null;
  };

  /* ---- the player's own sheet: a body that can be hurt, a pack the
   * model can see. Without this, "you" is the one person in the scene
   * who cannot bleed, carry or lose anything. ---- */

  RP.PLAYER_ID = '__you__';

  /** What the scene calls the reader: the persona's name when one is
   *  written, the account name otherwise, 'You' when nobody has said. */
  RP.playerNameFor = function (state) {
    var p = state && state.persona ? state.persona : null;
    return (p && p.name) || (state && state.user && state.user.name) || 'You';
  };

  /** The reader's sheet in this room, created on first need and seeded
   *  from the persona's kit. When the reader has starred a cast member
   *  (youPlay) that character's sheet already IS the player, so no
   *  second body is invented. */
  /** Whose sheet is “your pack”: the starred character’s when one is
   *  starred, the persona’s otherwise. */
  RP.playerSheetId = function (room) {
    return (room && room.youPlay && room.states && room.states[room.youPlay])
      ? room.youPlay : RP.PLAYER_ID;
  };

  RP.ensurePlayerSheet = function (state, room) {
    if (!room || room.mechanics === 'off') return null;
    room.states = room.states || {};
    if (room.youPlay && room.states[room.youPlay]) {
      // You starred somebody: THEIR sheet is your pack. The persona's
      // separate pack steps out of the statbar and the prompts, and
      // comes back if the star ever comes off.
      var star = room.states[room.youPlay];
      Object.keys(room.states).forEach(function (k) {
        if (k !== room.youPlay && room.states[k]) room.states[k].player = false;
      });
      star.player = true;
      star.slots = Math.max(Number(star.slots) || 0, 12);
      if (room.states[RP.PLAYER_ID]) room.states[RP.PLAYER_ID].present = false;
      return star;
    }
    var name = RP.playerNameFor(state);
    Object.keys(room.states).forEach(function (k) {
      if (k !== RP.PLAYER_ID && room.states[k]) room.states[k].player = false;
    });
    var sheet = room.states[RP.PLAYER_ID];
    if (!sheet) {
      sheet = RP.blankSheet({ id: RP.PLAYER_ID, name: name }, room.statePreset);
      room.states[RP.PLAYER_ID] = sheet;
    }
    // The persona's kit seeds the pack — each entry once, ever, per room.
    // An item written into the persona mid-scene still arrives; an item
    // dropped in play does not creep back next render.
    var persona = state && state.persona ? state.persona : {};
    sheet.seeded = sheet.seeded || [];
    (persona.items || []).forEach(function (i) {
      var item = RP.normItem(i);
      if (!item.name) return;
      var key = item.name.toLowerCase();
      if (sheet.seeded.indexOf(key) >= 0) return;
      sheet.seeded.push(key);
      var already = (sheet.items || []).some(function (have) {
        return RP.normItem(have).name.toLowerCase() === key;
      });
      if (!already) sheet.items.push(item);
    });
    sheet.player = true;
    sheet.present = true;                   // back in view if a star hid it
    sheet.name = name;
    sheet.slots = 12;                       // the reader always gets the full pack
    var statsKey = (persona.voice || '') + '|' + (persona.look || '') + '|' + (persona.notes || '');
    if (sheet.statsBy !== 'hand' && (!sheet.stats || sheet.statsFrom !== statsKey)) {
      // Read from the persona's own words, re-read when they change.
      // A hand-edited value (statsBy: 'hand') is never overwritten.
      sheet.stats = RP.statsFor({ id: RP.PLAYER_ID, name: name, description: [persona.voice, persona.look, persona.notes].filter(Boolean).join(' ') });
      sheet.statsFrom = statsKey;
    }
    return sheet;
  };

  function clampPool(pool) {
    pool.value = Math.max(0, Math.min(pool.max, Math.round(pool.value)));
    return pool;
  }

  /** Apply one change to one sheet. Returns a human line for the stream, or
   *  '' when the change was refused (unknown field, dead number). */
  /** The thing on the sheet that a name means. Exact first, then without
   *  articles and possessives, then one inside the other, then any solid
   *  word the two share — so "brass key", "the key" and "my bent key" all
   *  find "🗝 a brass key | bent". Returns the live item, or null. */
  var ITEM_FILLER = /\b(a|an|the|my|your|his|her|their|our|its|some|one|this|that|these|those|own|old|new|trusty|little|big|small)\b/g;
  function bareName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(ITEM_FILLER, ' ').replace(/\s+/g, ' ').trim();
  }
  RP.findItem = function (sheet, name) {
    if (!sheet || !name) return null;
    sheet.items = (sheet.items || []).map(RP.normItem);
    var want = String(name).toLowerCase().trim();
    var bare = bareName(name);
    if (!bare) return null;
    var items = sheet.items;
    var hit = items.filter(function (i) { return i.name.toLowerCase() === want; })[0];
    if (hit) return hit;
    hit = items.filter(function (i) { return bareName(i.name) === bare; })[0];
    if (hit) return hit;
    hit = items.filter(function (i) {
      var have = bareName(i.name);
      return have.indexOf(bare) >= 0 || bare.indexOf(have) >= 0;
    })[0];
    if (hit) return hit;
    var words = bare.split(' ').filter(function (w) { return w.length >= 3 && SMALL_WORDS.indexOf(' ' + w + ' ') < 0; });
    return items.filter(function (i) {
      var have = ' ' + bareName(i.name) + ' ';
      return words.some(function (w) { return have.indexOf(' ' + w + ' ') >= 0; });
    })[0] || null;
  };

  /* ---- the two pools. `mp` is the key on every sheet ever saved, so
   * it stays the key; what the reader and the model see is ⚡ Energy —
   * breath, strength and magic in one finite, slowly refilling pool. ---- */
  RP.POOLS = {
    hp: { word: 'HP', icon: '\u2764', directive: 'HP' },
    mp: { word: 'Energy', icon: '\u26a1', directive: 'EN' },
  };
  RP.poolWord = function (kind) { return (RP.POOLS[kind] || {}).word || String(kind || '').toUpperCase(); };

  /** 0 HP is a state, not just a number. The sheet wears the `down`
   *  condition from the moment it hits 0 until something lifts it above —
   *  a heal, a [[HP:]], a revival in the prose — and the condition goes
   *  on its own then. Returns the line to show, or ''. */
  RP.DOWN_NOTE = 'at 0 HP \u2014 barely conscious: a word, a crawl, a hand that will not close';
  RP.markDown = function (sheet) {
    if (!sheet || !sheet.hp || !sheet.hp.max) return '';
    sheet.flags = sheet.flags || {};
    var isDown = Number(sheet.hp.value) <= 0;
    if (isDown && !sheet.flags.down) {
      sheet.flags.down = { note: RP.DOWN_NOTE, turns: 0, effect: '' };
      return sheet.name + ' is DOWN';
    }
    if (!isDown && sheet.flags.down) {
      delete sheet.flags.down;
      return sheet.name + ' is no longer down';
    }
    return '';
  };
  /** The fixer's half of it, run every turn for free: anyone at 0 HP is
   *  marked down, anyone back above it is not. */
  RP.fixDown = function (room) {
    var lines = [];
    Object.keys((room && room.states) || {}).forEach(function (id) {
      var line = RP.markDown(room.states[id]);
      if (line) lines.push(line);
    });
    return lines;
  };

  RP.applyChange = function (sheet, change) {
    if (!sheet || !change) return '';
    var n = Number(change.value);
    if (change.kind === 'hp' || change.kind === 'mp') {
      var pool = sheet[change.kind];
      if (!pool || isNaN(n)) return '';
      var before = pool.value, beforeMax = pool.max;
      // [[HP: Name = 28/80]] redefines the pool: who they are now, not a
      // nudge to who they were. The max moves with the value.
      var newMax = Number(change.max);
      if (newMax > 0 && newMax !== pool.max) pool.max = Math.round(newMax);
      if (change.op === '+') pool.value += n;
      else if (change.op === '-') pool.value -= n;
      else pool.value = n;
      clampPool(pool);
      var word = RP.poolWord(change.kind);
      // Crossing 0 HP in either direction changes the sheet's state too.
      var downLine = change.kind === 'hp' ? RP.markDown(sheet) : '';
      var tail = change.kind === 'hp' && pool.value === 0 ? ' — down'
        : /no longer down/.test(downLine) ? ' — back up' : '';
      if (pool.max !== beforeMax) {
        return sheet.name + ' — ' + word + ' redefined ' + pool.value + '/' + pool.max + ' (was ' + before + '/' + beforeMax + ')' + tail;
      }
      if (pool.value === before) return '';
      return sheet.name + ' ' + (pool.value > before ? '+' : '−') + Math.abs(pool.value - before) + ' ' + word +
        ' (' + pool.value + '/' + pool.max + ')' + tail;
    }
    if (change.kind === 'flag') {
      var key = slug(change.name);
      if (!key) return '';
      var on = !(change.value === false || /^(false|off|no|clear|0)$/i.test(String(change.value)));
      if (on) {
        sheet.flags[key] = {
          note: clip(change.note, 160), turns: Number(change.turns || 0) || 0,
          effect: clip(change.effect, 40),
        };
      } else {
        delete sheet.flags[key];
      }
      var span = on
        ? (sheet.flags[key].turns ? ' (' + sheet.flags[key].turns + ' turns' +
            (sheet.flags[key].effect ? ', ' + sheet.flags[key].effect + ' a turn' : '') + ')'
          : (sheet.flags[key].effect ? ' (' + sheet.flags[key].effect + ' a turn)' : ''))
        : '';
      return sheet.name + (on ? ' is now ' : ' is no longer ') + String(change.name).replace(/_/g, ' ') + span;
    }
    if (change.kind === 'counter') {
      var ckey = slug(change.name);
      if (!ckey || isNaN(n)) return '';
      var cur = Number(sheet.counters[ckey] || 0);
      sheet.counters[ckey] = change.op === '+' ? cur + n : change.op === '-' ? cur - n : n;
      return sheet.name + ' — ' + String(change.name).replace(/_/g, ' ') + ': ' + sheet.counters[ckey];
    }
    if (change.kind === 'item') {
      var item = RP.normItem({ name: change.name, note: change.note, icon: change.icon });
      if (!item.name) return '';
      sheet.items = (sheet.items || []).map(RP.normItem);
      var at = sheet.items.map(function (i) { return i.name.toLowerCase(); }).indexOf(item.name.toLowerCase());
      if (change.op === '-') {
        // The model writes "brass key" for "a brass key | bent", and the
        // reader drops one purse from a stack of two. Both used to do
        // nothing, or everything.
        var lost = at >= 0 ? sheet.items[at] : RP.findItem(sheet, item.name);
        if (!lost) return '';
        if (lost.qty > 1) {
          lost.qty -= 1;
          return sheet.name + ' loses ' + lost.name + ' (' + lost.qty + ' left)';
        }
        sheet.items = sheet.items.filter(function (i) { return i !== lost; });
        return sheet.name + ' loses ' + lost.name;
      }
      if (at >= 0) {
        if (item.note) sheet.items[at].note = item.note;
        sheet.items[at].qty += 1;
        return sheet.name + ' now has ' + sheet.items[at].qty + ' × ' + item.name;
      }
      // A pack is its slots. A full one refuses, on the record — the model
      // reads the refusal like any other change line and plays it.
      if (sheet.slots && sheet.items.length >= sheet.slots) {
        return sheet.name + '\u2019s pack is full (' + sheet.slots + ' slots) — ' + item.name + ' has nowhere to go';
      }
      sheet.items.push(item);
      return sheet.name + ' picks up ' + item.name + (item.note ? ' (' + item.note + ')' : '');
    }
    if (change.kind === 'use') {
      sheet.items = (sheet.items || []).map(RP.normItem);
      var used = RP.findItem(sheet, change.name);
      if (!used) return '';
      used.qty -= 1;
      var gone = used.qty <= 0;
      if (gone) sheet.items = sheet.items.filter(function (i) { return i !== used; });
      return sheet.name + ' uses ' + used.icon + ' ' + used.name + (gone ? ' — that was the last of it' : '');
    }
    if (change.kind === 'equip') {
      sheet.items = (sheet.items || []).map(RP.normItem);
      var held = RP.findItem(sheet, change.name);
      if (!held) return '';
      held.equipped = change.op !== '-';
      return sheet.name + (held.equipped ? ' takes up ' : ' puts away ') + held.name;
    }
    if (change.kind === 'status') {
      sheet.status = clip(change.value, 120);
      return sheet.name + ' — ' + sheet.status;
    }
    if (change.kind === 'mood') {
      return RP.moodShift(sheet, change.key || change.name, change.level, change.note, { jump: change.jump, set: change.set, turn: change.turn });
    }
    return '';
  };

  /* ------------------------------------------------------------------ *
   * mood — the colour of the box is how they feel
   *
   * One feeling per sheet, 1–3: a flicker, the plain thing, overwhelming.
   * It does not swing with every line: a new feeling starts at 1 and
   * climbs one step per turn that feeds it; a different feeling has to
   * wear the standing one down first unless it is a shock; two quiet
   * turns take a step off; at 0 they are calm again. The model files
   * [[MOOD:]], the page reads the prose when it forgets, and the turn
   * card and the sheet wear the colour.
   * ------------------------------------------------------------------ */

  RP.MOODS = {
    anger:     { icon: '😠', hue: 4,   words: ['irritated', 'angry', 'furious'],
                 show: 'short hard sentences, interrupts, no jokes land, acts before thinking' },
    fear:      { icon: '😨', hue: 262, words: ['uneasy', 'afraid', 'terrified'],
                 show: 'hedges and repeats, watches the exits, startles, bargains' },
    joy:       { icon: '😄', hue: 48,  words: ['pleased', 'happy', 'elated'],
                 show: 'expansive and generous, laughs easily, says yes, forgives' },
    grief:     { icon: '😢', hue: 214, words: ['low', 'sad', 'heartbroken'],
                 show: 'slow, trails off, fixed on one object, flat answers' },
    shame:     { icon: '😳', hue: 300, words: ['sheepish', 'ashamed', 'humiliated'],
                 show: 'avoids names and eyes, deflects, over-explains' },
    disgust:   { icon: '🤢', hue: 96,  words: ['queasy', 'disgusted', 'revolted'],
                 show: 'clipped, a physical recoil, refuses to touch or engage' },
    surprise:  { icon: '😲', hue: 26,  words: ['puzzled', 'surprised', 'stunned'],
                 show: 'fragments and questions, repeats what was just said' },
    affection: { icon: '🥰', hue: 335, words: ['warm', 'fond', 'devoted'],
                 show: 'softer, uses names, closes the distance, teases kindly' },
    suspicion: { icon: '🤨', hue: 176, words: ['wary', 'suspicious', 'paranoid'],
                 show: 'questions everything, answers little, watches hands' },
    pride:     { icon: '😏', hue: 38,  words: ['smug', 'proud', 'triumphant'],
                 show: 'longer sentences, lists wins, corrects people, takes the credit' },
  };
  RP.MOOD_KEYS = Object.keys(RP.MOODS);
  RP.MOOD_FADE = 2;      // quiet turns per step down

  // What the model (or the reader) may call a feeling → which one it is,
  // and how hard a word it was (1–3). "furious" is anger at 3.
  var MOOD_WORDS = {
    anger: { 1: 'irritated irritation annoyed annoyance cross frustrated frustration impatient', 2: 'angry anger mad resentful indignant hostile bitter sullen',
      3: 'furious fury enraged rage livid seething incensed apoplectic' },
    fear: { 1: 'uneasy unease nervous worried worry apprehensive tense jumpy', 2: 'afraid fear scared frightened anxious anxiety alarmed dread',
      3: 'terrified terror panicked panic petrified horrified horror' },
    joy: { 1: 'pleased content amused relieved relief cheerful', 2: 'happy happiness glad joy joyful delighted delight excited excitement',
      3: 'elated ecstatic overjoyed thrilled gleeful giddy jubilant' },
    grief: { 1: 'low wistful melancholy weary downcast subdued', 2: 'sad sadness sorrow sorrowful unhappy mournful lonely dejected hurt',
      3: 'heartbroken grief grieving grief-stricken devastated despair despairing inconsolable bereft' },
    shame: { 1: 'sheepish awkward embarrassed embarrassment self-conscious', 2: 'ashamed shame guilty guilt regretful remorse remorseful contrite',
      3: 'humiliated humiliation mortified disgraced' },
    disgust: { 1: 'put-off distaste squeamish', 2: 'disgusted disgust repulsed contempt contemptuous scornful scorn sickened',
      3: 'revolted revulsion nauseated loathing' },
    surprise: { 1: 'puzzled confused bewildered baffled curious', 2: 'surprised surprise startled taken-aback astonished',
      3: 'stunned shocked shock amazed dumbfounded thunderstruck' },
    affection: { 1: 'warm warmth friendly kind grateful gratitude', 2: 'fond fondness affectionate affection tender tenderness caring protective',
      3: 'devoted loving love adoring smitten besotted' },
    suspicion: { 1: 'wary guarded sceptical skeptical doubtful cautious', 2: 'suspicious suspicion distrustful distrust mistrustful mistrust',
      3: 'paranoid paranoia' },
    pride: { 1: 'satisfied confident self-satisfied', 2: 'proud pride smug cocky boastful vain superior',
      3: 'triumphant triumph exultant gloating' },
  };
  var MOOD_LOOKUP = {};
  Object.keys(MOOD_WORDS).forEach(function (key) {
    [1, 2, 3].forEach(function (level) {
      MOOD_WORDS[key][level].split(/\s+/).forEach(function (w) { MOOD_LOOKUP[w] = { key: key, level: level }; });
    });
  });
  var MOOD_CALM = /^(?:calm|neutral|settled|composed|steady|serene|fine|okay|ok|at ease|relaxed|even|level|none|nothing|clear)$/;

  /** "furious" → { key: 'anger', level: 3 }; "anger" → level 2; "calm" →
   *  { key: 'calm' }; junk → null. A whole phrase is searched word by word,
   *  last feeling word wins. */
  RP.moodWord = function (text) {
    var words = String(text || '').toLowerCase().replace(/[^a-z\- ]+/g, ' ').trim();
    if (!words) return null;
    if (MOOD_CALM.test(words)) return { key: 'calm', level: 0 };
    var hit = null;
    words.split(/\s+/).forEach(function (w) {
      if (RP.MOODS[w]) hit = { key: w, level: 2 };
      else if (MOOD_LOOKUP[w]) hit = MOOD_LOOKUP[w];
      else if (MOOD_CALM.test(w)) hit = { key: 'calm', level: 0 };
    });
    return hit;
  };

  /** How a mood reads: "furious", "afraid", "a little uneasy". */
  RP.moodLabel = function (mood) {
    if (!mood || !RP.MOODS[mood.key]) return 'calm';
    var level = Math.max(1, Math.min(3, Number(mood.level) || 1));
    return RP.MOODS[mood.key].words[level - 1];
  };
  RP.moodIcon = function (mood) {
    return mood && RP.MOODS[mood.key] ? RP.MOODS[mood.key].icon : '😶';
  };

  /** The colour: a CSS custom-property string for the box that carries
   *  it — a firm line and a wash that deepens with the level. */
  RP.moodStyle = function (mood) {
    if (!mood || !RP.MOODS[mood.key]) return '';
    var hue = RP.MOODS[mood.key].hue;
    var level = Math.max(1, Math.min(3, Number(mood.level) || 1));
    var wash = [0.12, 0.22, 0.34][level - 1];
    var light = [93, 88, 82][level - 1];       // the box itself: a flat tint, deeper with the pitch
    return '--mood-line:hsl(' + hue + ',62%,46%);--mood-wash:hsla(' + hue + ',70%,52%,' + wash + ');' +
      '--mood-bg:hsl(' + hue + ',70%,' + light + '%);--mood-ink:hsl(' + hue + ',55%,30%)';
  };

  /** Move a sheet's feeling. `level` is what was filed (1–3); the result
   *  is damped: a new feeling starts at 1 (2 for a shock or a 3 filed), the
   *  same feeling climbs one step (two for a shock), a different feeling
   *  wears the standing one down a step before it can take over. `calm`
   *  takes a step off. `set` (by hand) writes exactly what was asked.
   *  Returns the receipt line, or '' when nothing moved. */
  RP.moodShift = function (sheet, key, level, note, opts) {
    if (!sheet) return '';
    opts = opts || {};
    key = String(key || '').toLowerCase();
    var cur = sheet.mood && RP.MOODS[sheet.mood.key] ? sheet.mood : null;
    var turn = Number(opts.turn) || 0;
    var want = Math.max(0, Math.min(3, Math.round(Number(level) || 0)));
    var name = sheet.name;
    var describe = function (m) { return RP.moodIcon(m) + ' ' + name + ' — ' + RP.moodLabel(m) + (m.note ? ' (' + m.note + ')' : ''); };
    if (key === 'calm' || !key) {
      if (!cur) return '';
      if (opts.set || cur.level <= 1) { delete sheet.mood; return '😶 ' + name + ' settles'; }
      sheet.mood = { key: cur.key, level: cur.level - 1, note: cur.note, held: 0, at: turn };
      return describe(sheet.mood) + ' — easing';
    }
    if (!RP.MOODS[key]) return '';
    if (!want) want = 2;
    if (opts.set) {
      sheet.mood = { key: key, level: Math.max(1, want), note: clip(note, 80), held: 0, at: turn };
      return describe(sheet.mood);
    }
    var shock = Boolean(opts.jump) || want >= 3;
    if (!cur) {
      sheet.mood = { key: key, level: shock ? 2 : 1, note: clip(note, 80), held: 0, at: turn };
      return describe(sheet.mood);
    }
    if (cur.key === key) {
      var next = Math.min(3, cur.level + (shock ? 2 : 1));
      if (want < cur.level && !shock) next = cur.level;        // a smaller word does not cool it; the turns do
      var moved = next !== cur.level;
      sheet.mood = { key: key, level: next, note: clip(note || cur.note, 80), held: 0, at: turn };
      return moved ? describe(sheet.mood) + (next === 3 ? ' — overwhelming' : ' — building') : '';
    }
    if (shock) {
      sheet.mood = { key: key, level: 2, note: clip(note, 80), held: 0, at: turn };
      return describe(sheet.mood) + ' — ' + RP.moodLabel(cur) + ' no longer';
    }
    // The standing feeling resists: it loses a step, and only when it is
    // spent does the new one take the room.
    if (cur.level > 1) {
      sheet.mood = { key: cur.key, level: cur.level - 1, note: cur.note, held: 0, at: turn };
      return describe(sheet.mood) + ' — ' + key + ' pulling at it';
    }
    sheet.mood = { key: key, level: 1, note: clip(note, 80), held: 0, at: turn };
    return describe(sheet.mood) + ' — the ' + cur.key + ' gone';
  };

  /** Feelings fade when nothing feeds them: a step off after MOOD_FADE
   *  quiet turns, calm at 0. Called once a turn with the conditions.
   *  Returns the lines worth saying (only the ones that end). */
  RP.tickMoods = function (room, turn) {
    var lines = [];
    Object.keys((room && room.states) || {}).forEach(function (id) {
      var sheet = room.states[id];
      if (!sheet || sheet.present === false || !sheet.mood) return;
      if (!RP.MOODS[sheet.mood.key]) { delete sheet.mood; return; }
      if (turn !== undefined && sheet.mood.at === turn) return;      // fed this turn
      sheet.mood.held = (Number(sheet.mood.held) || 0) + 1;
      if (sheet.mood.held < RP.MOOD_FADE) return;
      sheet.mood.held = 0;
      sheet.mood.level = (Number(sheet.mood.level) || 1) - 1;
      if (sheet.mood.level <= 0) {
        lines.push('😶 ' + sheet.name + ' settles — the ' + sheet.mood.key + ' is spent');
        delete sheet.mood;
      }
    });
    return lines;
  };

  // How a feeling shows in prose, for the turns the model files nothing.
  var MOOD_CUES = {
    anger: /\b(?:bellows?|bellowed|snarls?|snarled|growls?|growled|snaps?\s+(?:at|back)|spits?\s+(?:out|the\s+words)|roars?|roared|barks?|barked|seeth(?:es|ing)|glares?|glared|glowers?|fum(?:es|ing)|hiss(?:es|ed)|through\s+(?:gritted|clenched)\s+teeth|clench(?:es|ed)\s+(?:his|her|their)\s+(?:fists?|jaw)|slams?\s+(?:a|his|her|their)\s+(?:fist|hand|palm)|scowls?|scowled|jabs?\s+a\s+finger|shouts?|shouted|yells?|yelled|snarl|furious|fury|rage|livid|seething|angry|GET\s+OUT|SHUT\s+UP)\b/,
    fear: /\b(?:trembl(?:es|ing|ed)|shiver(?:s|ing|ed)|flinch(?:es|ed)|whimper(?:s|ed)|backs?\s+away|backed\s+away|swallows?\s+hard|stammer(?:s|ed|ing)|goes\s+pale|went\s+pale|blanch(?:es|ed)|freez(?:es|ing)\s+(?:up|in\s+place)|afraid|fear|terrified|terror|panic(?:s|ked|king)?|scared|nervous(?:ly)?|glanc(?:es|ing)\s+at\s+the\s+(?:door|exit|window)|heart\s+(?:hammering|pounding|racing)|breath\s+catch(?:es|ing)|dread|cower(?:s|ed|ing))\b/,
    joy: /\b(?:laughs?|laughed|laughing|grins?|grinned|grinning|beams?|beamed|beaming|chuckl(?:es|ed|ing)|giggl(?:es|ed|ing)|whoops?|delighted|delight|happy|happily|glee(?:ful)?|cheers?|cheered|lights?\s+up|lit\s+up|claps?\s+(?:his|her|their)\s+hands|brightens?|brightened|elated|thrilled)\b/,
    grief: /\b(?:sobs?|sobbed|sobbing|weeps?|wept|weeping|tears?\s+(?:well|spill|run|roll|slide)|cries|cried|crying|mourns?|mourning|grief|grieving|sad(?:ly|ness)?|hollow(?:ly)?|stares?\s+at\s+nothing|voice\s+(?:breaks|cracks|catches)|slumps?|slumped|heartbroken|miss(?:es|ed)\s+(?:him|her|them)\b|wipes?\s+(?:his|her|their)\s+eyes)\b/,
    shame: /\b(?:flush(?:es|ed|ing)|blush(?:es|ed|ing)|redden(?:s|ed|ing)|looks?\s+away|looked\s+away|can(?:not|'t)\s+meet\s+(?:his|her|their|your)\s+eyes?|ashamed|shame|embarrass(?:ed|ment)|mumbl(?:es|ed|ing)|sheepish(?:ly)?|hangs?\s+(?:his|her|their)\s+head|apologi[sz](?:es|ed|ing)|mortified|humiliat(?:ed|ion))\b/,
    disgust: /\b(?:wrinkl(?:es|ed|ing)\s+(?:his|her|their)\s+nose|recoils?|recoiled|grimac(?:es|ed|ing)|disgust(?:ed|ing)?|revolt(?:ed|ing)|sneers?|sneered|curls?\s+(?:his|her|their)\s+lip|gags?|gagged|retch(?:es|ed)|contempt|loath(?:es|ing)|repuls(?:ed|ive))\b/,
    surprise: /\b(?:blinks?|blinked|gapes?|gaped|jaw\s+drops?|eyes?\s+widen(?:s|ed)?|startled|stunned|gasps?|gasped|surprised?|shock(?:ed)?|astonish(?:ed|ment)|does\s+a\s+double\s+take|stares?,?\s+open-mouthed|wait,?\s+what)\b/,
    affection: /\b(?:softens?|softened|squeez(?:es|ed|ing)\s+(?:his|her|their|your)\s+(?:hand|shoulder|arm)|tender(?:ly|ness)?|gently|fond(?:ly|ness)?|warmly|smiles?\s+softly|pulls?\s+(?:him|her|them|you)\s+(?:close|in)|kiss(?:es|ed)|hugs?|hugged|embrac(?:es|ed)|my\s+dear|strok(?:es|ed|ing)\s+(?:his|her|their|your)\s+hair|protective(?:ly)?)\b/,
    suspicion: /\b(?:narrows?\s+(?:his|her|their)\s+eyes|eyes\s+narrow(?:ed|ing)?|suspicious(?:ly)?|suspicion|wary|warily|studies\s+(?:him|her|them|you)|do(?:es)?n[’']?t\s+trust|watch(?:es|ing)\s+(?:him|her|them|you)\s+(?:carefully|closely)|guarded|sidelong|what\s+are\s+you\s+(?:really\s+)?after|why\s+would\s+you)\b/,
    pride: /\b(?:smirks?|smirked|smirking|puffs?\s+(?:out\s+)?(?:his|her|their)\s+chest|proud(?:ly)?|smug(?:ly)?|triumphant(?:ly)?|preens?|preened|struts?|strutted|told\s+you\s+so|crows?|crowed|gloats?|gloated|chin\s+(?:up|lifted|raised))\b/,
  };

  /** What a turn's prose says its speaker feels: the feeling with the
   *  most cues, two at least, or one strong word. Sentences that are about
   *  somebody else in the scene (named, and the speaker is not) are
   *  skipped, so "Sans looks terrified" is not Wario afraid.
   *  Returns { key, note } or null. */
  RP.moodScan = function (text, speakerName, others) {
    var raw = String(text || '').replace(/(?:\[\[|\{\{)[^\]\}\n]*(?:\]\]|\}\}|\]\}|\}\])/g, ' ');
    if (!raw.trim()) return null;
    var me = String(speakerName || '').toLowerCase().split(/\s+/)[0];
    var them = (others || []).map(function (n) { return String(n || '').toLowerCase().split(/\s+/)[0]; })
      .filter(function (n) { return n && n.length > 2 && n !== me; });
    var score = {}, sample = {};
    raw.split(/\n+|[.!?]+["\u201d\u2019)*_]*\s+/).forEach(function (sentence) {
      var low = sentence.toLowerCase();
      var aboutOther = them.some(function (n) { return new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(low); }) &&
        !(me && new RegExp('\\b' + me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(low)) && !/\bI\b|\bmy\b/.test(sentence);
      if (aboutOther) return;
      Object.keys(MOOD_CUES).forEach(function (key) {
        var re = new RegExp(MOOD_CUES[key].source, 'gi');
        var m, n = 0;
        while ((m = re.exec(sentence))) { n++; if (!sample[key]) sample[key] = m[0]; if (n > 6) break; }
        if (n) score[key] = (score[key] || 0) + n;
      });
    });
    var best = '', bestN = 0;
    Object.keys(score).forEach(function (k) { if (score[k] > bestN) { best = k; bestN = score[k]; } });
    if (!best) return null;
    var strong = /furious|terrified|sobs?|sobbing|weeps?|wept|heartbroken|elated|mortified|humiliat|revolt|stunned|livid|panic|rage|smirk|gloat/i.test(sample[best] || '');
    if (bestN < 2 && !strong) return null;
    return { key: best, note: clip(String(sample[best] || '').toLowerCase(), 40) };
  };

  /** An unattended turn: the reader is in the other scene, and this one
   *  moves on its own for one beat. With `self`, the character the reader
   *  plays here acts for themselves — small, in character, reversible. */
  RP.liveBlock = function (room, speaker, self) {
    if (!room) return '';
    var playing = RP.playerCharacter(room);
    var out = 'MEANWHILE, UNATTENDED \u2014 the reader is in the other scene right now and is not here to be answered. ' +
      'This scene moves on its own for ONE beat: something small and true happens \u2014 a line, a move, a sound, a decision ' +
      'that was coming anyway \u2014 the kind of thing the other scene could hear of later. Do not address the reader, do not ' +
      'wait for them, and do not resolve anything they would want to be present for.';
    if (self && playing && speaker && speaker.id === playing.id) {
      out += '\nThe reader usually plays ' + playing.name + ' and has stepped away from this scene: this turn ' + playing.name +
        ' acts for themselves \u2014 in character, small and reversible: a remark, a move, a look, a thing picked up. No big decisions, ' +
        'nothing they could not walk back, no leaving, no promises made in their name. The reader takes ' + playing.name + ' back next turn.';
    }
    return out;
  };

  /** The reader's own mood, set by hand on their sheet: it does not write
   *  their words, it colours how the world reads what they do. Nothing
   *  when they are calm. */
  RP.playerMoodBlock = function (room) {
    if (!room || room.mechanics === 'off') return '';
    var you = (room.states || {})[RP.playerSheetId(room)];
    var mood = you && you.mood;
    if (!mood || !RP.MOODS[mood.key]) return '';
    var level = Math.max(1, Math.min(3, Number(mood.level) || 1));
    var READ = {
      anger: 'a pick-up is a grab, a question is a demand, a step is a stride, a joke has an edge',
      fear: 'a look is a glance over the shoulder, a question is a plea, a step is a backward one',
      joy: 'a greeting is warm, a risk is taken lightly, a refusal is laughed off',
      grief: 'a question trails off, a hand rests on things, every answer is short and far away',
      shame: 'eyes stay down, names are avoided, every sentence apologises for itself',
      disgust: 'a handshake is refused, food goes untouched, every answer is clipped',
      surprise: 'questions come in fragments, things are picked up and looked at twice',
      affection: 'distance closes, names are used, a touch comes before a word',
      suspicion: 'a question is a test, a gift is checked, hands are watched',
      pride: 'a success is announced, a correction is offered, the credit is taken',
    };
    return 'THE PLAYER\u2019S MOOD \u2014 ' + you.name + ' is ' + RP.moodLabel(mood) + ' (' + mood.key + ' ' + level + '/3' +
      (mood.note ? ': ' + mood.note : '') + '). Read what they do through it: ' + READ[mood.key] + '. The cast can see' +
      ' it on them and answers THAT, not the polite version. Never decide their words \u2014 colour the world\u2019s' +
      ' reading of them' + (level >= 3 ? ', and at this pitch let it cost them something when it would.' : '.');
  };

  /** The player's own body, as a standing limit on what they can attempt.
   *  Nothing when they are whole and unflagged. */
  /** The player's sheet when it is at 0 HP, else null. */
  RP.playerDown = function (room) {
    if (!room || room.mechanics === 'off') return null;
    var you = (room.states || {})[RP.playerSheetId(room)];
    return you && you.hp && you.hp.max && Number(you.hp.value) <= 0 ? you : null;
  };

  /** The one line a small model cannot miss: it rides at the very end of
   *  the prompt and on the player's own line. The body block in the middle
   *  of the prompt said it too, and an 8B model wrote a downed reader
   *  standing, arguing and pulling books off shelves anyway. */
  RP.downNote = function (room) {
    var you = RP.playerDown(room);
    if (!you) return '';
    return (you.name || 'The player') + ' is DOWN at 0 HP — on the floor, barely conscious. They can manage a whisper, ' +
      'a look, a hand that will not close; anything more fails before it starts. Everyone here can see it, and reacts to it.';
  };

  RP.playerBodyBlock = function (room) {
    if (!room || room.mechanics === 'off') return '';
    var you = (room.states || {})[RP.playerSheetId(room)];
    if (!you) return '';
    var hp = you.hp && you.hp.max ? you.hp.value / you.hp.max : 1;
    var flags = Object.keys(you.flags || {}).map(function (f) {
      var cond = you.flags[f] && typeof you.flags[f] === 'object' ? you.flags[f] : {};
      return f.replace(/_/g, ' ') + (cond.note ? ' (' + cond.note + ')' : '');
    });
    if (hp > 0.65 && !flags.length) return '';
    var rules = [];
    BODY_LIMITS.forEach(function (rule) {
      if (flags.some(function (f) { return rule.why.test(f); }) || rule.why.test(String(you.status || ''))) rules.push(rule.part);
    });
    var state = you.hp && you.hp.value <= 0 ? 'DOWN at 0 HP \u2014 a word, a crawl, a hand; nothing more'
      : hp <= 0.35 ? 'BADLY HURT at ' + you.hp.value + '/' + you.hp.max + ' HP \u2014 no sprinting, climbing, vaulting, hauling or long fights; every move shows it'
      : hp <= 0.65 ? 'HURT at ' + you.hp.value + '/' + you.hp.max + ' HP \u2014 slower, favouring the wound; a big effort costs breath and shows'
      : 'marked';
    return 'THE PLAYER\u2019S BODY \u2014 ' + you.name + ' is ' + state +
      (flags.length ? '; in play on them: ' + flags.join('; ') : '') +
      (rules.length ? '. What ' + (rules.length === 1 ? rules[0] : rules.join(' and ')) + ' cannot do, they cannot do' : '') +
      '. What they attempt is bound by this: when they try past it, the body fails them before the world does, the people here see it, and you file the cost.';
  };

  /** The body outranks the will. A character at 28 HP who is "battered"
   *  does not vault out of a wreck swinging a wrench \u2014 or if he does, he
   *  pays for it in the same turn. Nothing when they are whole. */
  RP.bodyBlock = function (room, char) {
    if (!room || room.mechanics === 'off' || !char) return '';
    var sheet = (room.states || {})[char.id];
    if (!sheet) return '';
    var hp = sheet.hp && sheet.hp.max ? sheet.hp.value / sheet.hp.max : 1;
    var flags = Object.keys(sheet.flags || {}).map(function (f) {
      var cond = sheet.flags[f] && typeof sheet.flags[f] === 'object' ? sheet.flags[f] : {};
      return f.replace(/_/g, ' ') + (cond.note ? ' (' + cond.note + ')' : '');
    });
    var spentOut = Boolean(sheet.mp && sheet.mp.max && sheet.mp.value <= 0);
    if (hp > 0.65 && !flags.length && !spentOut) return '';
    var name = char.name;
    var state;
    if (sheet.hp && sheet.hp.value <= 0) {
      state = 'DOWN at 0 HP: barely conscious. A word, a crawl, a hand that will not close \u2014 nothing more. They cannot fight, run or lead.';
    } else if (hp <= 0.35) {
      state = 'BADLY HURT at ' + sheet.hp.value + '/' + sheet.hp.max + ' HP. Write the body first and the will second: slow and crooked, favouring the hurt side,' +
        ' breath short; they cannot sprint, swing hard, haul themselves through a window or shout for long without paying in' +
        ' breath or blood. A reckless move at this HP is one they feel before they finish it.';
    } else if (hp <= 0.65) {
      state = 'HURT at ' + sheet.hp.value + '/' + sheet.hp.max + ' HP: favouring the wound, picking the easier way, flinching from the next blow; a big effort costs breath and shows.';
    } else {
      state = 'whole, but not untouched.';
    }
    return 'BODY \u2014 ' + name + ' is ' + state +
      (spentOut ? ' SPENT at 0 Energy: no sprinting, no spells, no big swings \u2014 hands on knees, breath first; anything that' +
        ' costs effort this turn fails, or is paid for in HP.' : '') +
      (flags.length ? ' In play on them: ' + flags.join('; ') + ' \u2014 each one shapes what they can do this turn.' : '') +
      ' Their nature does not override their body: the same person, hurt, is a different turn \u2014 greedy and broken is not greedy' +
      ' and whole. If they push through anyway, show the cost in this turn and file it ([[HP: ' + name + ' -N]] or [[COND: ' + name + ' \u2026]]).';
  };

  /** The speaker's own feeling, as an order: it colours the turn. Nothing
   *  when they are calm — the block costs zero on a quiet sheet. */
  RP.moodBlock = function (room, char) {
    if (!room || room.mechanics === 'off' || !char) return '';
    var sheet = (room.states || {})[char.id];
    var mood = sheet && sheet.mood;
    if (!mood || !RP.MOODS[mood.key]) return '';
    var level = Math.max(1, Math.min(3, Number(mood.level) || 1));
    return 'MOOD \u2014 ' + char.name + ' is ' + RP.moodLabel(mood) + ' (' + mood.key + ' ' + level + '/3' +
      (mood.note ? ': ' + mood.note : '') + '). It colours this whole turn \u2014 ' + RP.MOODS[mood.key].show +
      (level >= 3 ? ' \u2014 and at this pitch it decides what they do, not just how they say it.' : '.') +
      ' It does not switch off because the subject changes; it eases only if the scene gives it reason.' +
      ' If this turn moves it, file [[MOOD: ' + char.name + ' \u2026]].';
  };

  /** The sheets, as the model sees them. */
  /** The sheets as the model sees them. With a `focus` id, only the
   *  acting character and the player ride in full — everyone else is a
   *  short line (wounds, conditions, counters), and the untouched are
   *  folded into one roll call. Six full kits in every prompt is how a
   *  local model spends its whole day prefilling. */
  RP.stateBlock = function (room, focus) {
    var sheets = Object.keys((room && room.states) || {}).map(function (k) { return { id: k, s: room.states[k] }; })
      .filter(function (e) { return e.s && e.s.present !== false; });
    if (!sheets.length) return '';
    var hasPlayer = false;
    var active = [];    // conditions in play right now — surfaced, not buried
    var quiet = [];     // present, unhurt, nothing in play — one roll call
    var body = sheets.map(function (e) {
      var s = e.s;
      if (s.player) hasPlayer = true;
      var full = !focus || s.player || e.id === focus;
      var bits = [];
      var hurt = s.hp && s.hp.value < s.hp.max;
      var spent = s.mp && s.mp.value < s.mp.max;
      if (s.hp && (full || hurt)) bits.push('HP ' + s.hp.value + '/' + s.hp.max + (s.hp.value === 0 ? ' (down)' : s.hp.value <= s.hp.max * 0.3 ? ' (badly hurt)' : ''));
      if (s.mp && (full || spent)) bits.push('\u26a1 Energy ' + s.mp.value + '/' + s.mp.max + (s.mp.value === 0 ? ' (spent)' : s.mp.value <= s.mp.max * 0.2 ? ' (nearly spent)' : ''));
      if (full && s.stats) bits.push(RP.statLine(s.stats));
      Object.keys(s.flags || {}).forEach(function (f) {
        var cond = s.flags[f] && typeof s.flags[f] === 'object' ? s.flags[f] : { note: '', turns: 0 };
        var word = f.replace(/_/g, ' ');
        bits.push(RP.condIcon(f) + ' ' + word +
          (cond.note ? ' (' + cond.note + ')' : '') +
          (cond.turns ? ' [' + cond.turns + ' turns left]' : '') +
          (cond.effect ? ' [' + cond.effect + ' a turn]' : ''));
        active.push(s.name + ' is ' + word +
          (cond.effect ? ', losing ' + cond.effect.replace(/^[+-]/, '') + ' every turn it lasts' : '') +
          (cond.note ? ' — ' + cond.note : ''));
      });
      Object.keys(s.counters || {}).forEach(function (c) { bits.push(c.replace(/_/g, ' ') + ' ' + s.counters[c]); });
      var kit = (s.items || []).map(RP.normItem);
      var inHand = kit.filter(function (i) { return i.equipped; });
      if (inHand.length) {
        bits.push('holding ' + inHand.map(function (i) { return i.icon + ' ' + i.name; }).join(', '));
      }
      var stowed = kit.filter(function (i) { return !i.equipped; });
      if (full && stowed.length) {
        bits.push('carrying ' + stowed.map(function (i) {
          return i.icon + ' ' + i.name + (i.qty > 1 ? ' ×' + i.qty : '') + (i.note ? ' — ' + i.note : '');
        }).join('; '));
      }
      if (s.status) bits.push(s.status);
      if (s.mood && RP.MOODS[s.mood.key]) {
        bits.push('mood: ' + RP.moodLabel(s.mood) + ' (' + s.mood.key + ' ' + Math.max(1, Math.min(3, Number(s.mood.level) || 1)) + '/3' +
          (s.mood.note ? ' — ' + s.mood.note : '') + ')');
      }
      if (!full && !bits.length) { quiet.push(s.name); return ''; }
      return '- ' + s.name + (s.player ? ' (THE PLAYER)' : '') + ': ' + (bits.join(' · ') || 'unharmed, nothing to declare');
    }).filter(Boolean).join('\n');
    if (quiet.length) {
      body += (body ? '\n' : '') + '- Untouched right now: ' + quiet.join(', ') +
        ' — their full sheets are on file and answer to directives by name.';
    }
    var out = 'CHARACTER STATE — this is true right now, play it. They may only use what is listed here, and a\n' +
      'condition with a cost beside it is taking that off them every turn it lasts. Reach for the kit only when\n' +
      'the moment calls for it — never inventory it in prose — and nothing joins a sheet that the scene did not\n' +
      'visibly put there. ⚔🧠🗣🍀 are might, wits, sway and luck, 0–3: they lean on the dice, so play the 0s\n' +
      'and the 3s, do not recite them. A mood on a sheet is how that person is right now — play it, and\n' +
      'play off it.\n' + body;
    if (active.length) {
      out += '\nCONDITIONS IN PLAY — these are not flavour. Each one must shape what its bearer does this turn:\n' +
        active.slice(0, 8).map(function (l) { return '- ' + l; }).join('\n');
    }
    if (hasPlayer) {
      out += '\nThe sheet marked (THE PLAYER) is the reader\u2019s own body and pack. Wound it, cost it and hand it ' +
        'things with the same directions, using their name — but never decide what they do or say. When they name ' +
        'a thing that is on their sheet, that is the thing they mean: its note is true and its count is real.';
    }
    return out;
  };

  /* ---- what the latest words actually name ---- */

  var SMALL_WORDS = ' the this that with from your their there have when what where were will been they them and for you her his its our all one two of a an in on to is it ';

  function saidIn(text, name) {
    var words = String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) {
      return w.length >= 3 && SMALL_WORDS.indexOf(' ' + w + ' ') < 0;
    });
    if (!words.length) return false;
    return words.some(function (w) {
      return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i').test(text);
    });
  }

  /* ---- @ mentions: who you mean ----
   * Type @ in the composer and pick: somebody here, somebody written out,
   * somebody in the other scene, a thing the lore book filed (the monster
   * from the hangar), or anyone in the archive. The @ comes out of the
   * prose before the model sees it; what stays is a block that tells the
   * model exactly who or what was meant and what the record says about
   * them — so a monster met in one scene is the same monster when it is
   * spoken of in the other. */
  RP.MENTION_KINDS = { here: 'in the scene', away: 'written out of this scene', other: 'in the other scene', book: 'in the lore book', archive: 'in the archive' };

  /** Everything @ could mean in this room, in the order the picker shows:
   *  here, written out, the other scene, the lore book, the archive. */
  RP.mentionables = function (state, room, catalog, query) {
    var q = String(query || '').trim().toLowerCase();
    var out = [];
    var seen = {};
    var push = function (item) {
      var key = item.kind === 'book' ? 'book:' + item.name.toLowerCase() : item.id;
      if (seen[key]) return;
      if (q && item.name.toLowerCase().indexOf(q) < 0 &&
        !String(item.note || '').toLowerCase().split(/\W+/).some(function (w) { return w && w.indexOf(q) === 0; })) return;
      seen[key] = true;
      out.push(item);
    };
    if (!room) return out;
    var other = RP.linkedRoom(state, room);
    RP.presentCast(room).forEach(function (c) {
      push({ id: c.id, name: c.name, kind: 'here', roomId: room.id, note: c.title || '', image: c.image || '' });
    });
    // Somebody who walked over is in the other scene, not merely written out.
    if (other) {
      RP.presentCast(other).forEach(function (c) {
        push({ id: c.id, name: c.name, kind: 'other', roomId: other.id, note: other.sceneName || other.title || '', image: c.image || '' });
      });
    }
    (room.cast || []).forEach(function (c) {
      var sheet = room.states && room.states[c.id];
      if (sheet && sheet.present === false) push({ id: c.id, name: c.name, kind: 'away', roomId: room.id, note: c.title || '', image: c.image || '' });
    });
    (((state && state.book) || {}).entries || []).slice().reverse().forEach(function (e) {
      if (!e || !e.name || e.kind === 'DIARY' || e.kind === 'FACT') return;
      push({ id: 'book:' + e.id, name: e.name, kind: 'book', roomId: e.roomId || '', note: String(e.kind || '').toLowerCase() + (e.roomTitle ? ' · ' + e.roomTitle : ''), text: e.text || '' });
    });
    if (q.length >= 2) {
      Object.keys(catalog || {}).forEach(function (id) {
        var c = catalog[id];
        if (!c || !c.name) return;
        push({ id: c.id, name: c.name, kind: 'archive', roomId: '', note: c.title || '', image: c.image || '' });
      });
    }
    return out;
  };

  /** "@Wario, did you see @The Hangar Beast?" → the @ signs come out, the
   *  people stay. Longest names first, so @Wario Jr. is not read as @Wario.
   *  A stray @word nobody matched stays as it was typed. */
  RP.parseMentions = function (text, candidates) {
    var out = { clean: String(text || ''), mentions: [] };
    if (out.clean.indexOf('@') < 0) return out;
    var names = (candidates || []).filter(function (c) { return c && c.name; })
      .slice().sort(function (a, b) { return b.name.length - a.name.length; });
    var found = {};
    names.forEach(function (c) {
      var safe = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('@\\[?' + safe + '\\]?(?![A-Za-z0-9])', 'gi');
      if (!re.test(out.clean)) return;
      out.clean = out.clean.replace(re, c.name);
      var key = c.kind === 'book' ? 'book:' + c.name.toLowerCase() : c.id;
      if (!found[key]) { found[key] = true; out.mentions.push({ id: c.id, name: c.name, kind: c.kind, roomId: c.roomId || '' }); }
    });
    return out;
  };

  /** What the model is told about who was meant. Here: nothing beyond the
   *  sheets (they are in the prompt already). Away, elsewhere, the book or
   *  the archive: who they are, where they are, and that they are not in
   *  the room to answer. */
  RP.pingBlock = function (state, room, mentions, catalog) {
    var list = (mentions || []).filter(function (m) { return m && m.kind && m.kind !== 'here'; });
    if (!list.length) return '';
    var other = RP.linkedRoom(state, room);
    var lines = list.slice(0, 5).map(function (m) {
      if (m.kind === 'away') {
        var sheet = room.states && room.states[m.id];
        return '- ' + m.name + ' — written out of this scene (not here to hear it or answer)' +
          (sheet && sheet.hp ? '; last known ' + sheet.hp.value + '/' + sheet.hp.max + ' HP' : '') + '.';
      }
      if (m.kind === 'other' && other) {
        var sheetO = other.states && other.states[m.id];
        var mood = sheetO && sheetO.mood && RP.MOODS[sheetO.mood.key] ? ', ' + RP.moodLabel(sheetO.mood) : '';
        var last = RP.meanwhileLines(state, other, 12).filter(function (l) { return l.indexOf(m.name + ':') === 0; }).pop();
        return '- ' + m.name + ' — in the other scene right now, “' + clip(other.sceneName || other.title, 50) + '”' +
          (sheetO && sheetO.hp ? ' (' + sheetO.hp.value + '/' + sheetO.hp.max + ' HP' + mood + ')' : '') +
          (last ? '; last heard there: ' + clip(last, 140) : '') + '. A wall apart: they cannot hear this unless it would carry.';
      }
      if (m.kind === 'book') {
        var entry = (((state && state.book) || {}).entries || []).filter(function (e) { return e && e.name && e.name.toLowerCase() === m.name.toLowerCase(); })[0];
        return '- ' + m.name + ' — ' + (entry ? String(entry.kind || 'filed').toLowerCase() + ', from the lore book' + (entry.roomTitle ? ' (“' + clip(entry.roomTitle, 40) + '”)' : '') +
          ': ' + clip(entry.text, 260).replace(/[.\s]+$/, '') : 'spoken of before') + '. The same one, with the same record — not a new thing.';
      }
      var rec = catalog && catalog[m.id];
      return '- ' + m.name + ' — ' + (rec ? (rec.title ? rec.title + '; ' : '') + clip(rec.summary || '', 200) : 'somebody from the archive') +
        '. Not in this scene: they can be spoken of, not written in, unless the player brings them.';
    });
    return 'NAMED BY THE PLAYER — the latest turn points at these by name (@), so there is no doubt who is meant\n' +
      lines.join('\n') +
      '\nAnswer about THEM, as filed. Nobody listed here walks in because they were named.';
  };

  /** When the player says "the key", the model is told which key, whose
   *  it is and what is filed against it — the sheets stop being a list it
   *  can forget the moment something on them is actually talked about. */
  RP.mentionBlock = function (room, text) {
    var said = String(text || '').toLowerCase();
    if (said.replace(/\s+/g, '').length < 3) return '';
    var hits = [];
    Object.keys((room && room.states) || {}).forEach(function (id) {
      var s = room.states[id];
      if (!s || s.present === false) return;
      var who = s.player ? s.name + ' (the player)' : s.name;
      (s.items || []).map(RP.normItem).forEach(function (i) {
        if (!saidIn(said, i.name)) return;
        hits.push('- ' + i.icon + ' ' + i.name + ' — ' + who + '\u2019s, ' + (i.equipped ? 'in hand' : 'stowed') +
          (i.qty > 1 ? ', ×' + i.qty : '') + (i.note ? ' · ' + i.note : ''));
      });
      Object.keys(s.flags || {}).forEach(function (f) {
        var word = f.replace(/_/g, ' ');
        if (!saidIn(said, word)) return;
        var cond = s.flags[f] && typeof s.flags[f] === 'object' ? s.flags[f] : { note: '', turns: 0 };
        hits.push('- ' + RP.condIcon(f) + ' ' + word + ' — on ' + who +
          (cond.turns ? ', ' + cond.turns + ' turns left' : '') +
          (cond.effect ? ', ' + cond.effect + ' a turn' : '') + (cond.note ? ' · ' + cond.note : ''));
      });
    });
    if (!hits.length) return '';
    return 'NAMED JUST NOW — the latest turn speaks of things that are really on the sheets\n' +
      hits.slice(0, 6).join('\n') +
      '\nTreat them exactly as filed: the note is true, the count is real, and nothing not listed exists to be used.';
  };

  /* ---- the thin-air check: you cannot just pull out a bazooka ----
   * A local scan of the player's own words, no model call. Claiming a
   * thing that IS on the sheet takes it in hand; claiming a thing that
   * is not fires once — the dice turn against the bluff and the model
   * gets a one-off block telling it to play the empty hand. */

  // Strong verbs claim ownership on their own; weak verbs only with "my".
  var DRAW_RE = /\b(pull(?:s|ed)? (?:out|free)|draw(?:s)?|unsheathe(?:s)?|unholster(?:s)?|whip(?:s)? out|produce(?:s)?|brandish(?:es)?|wield(?:s)?|pull(?:s)? from my (?:pack|bag|belt|coat|pocket))\s+(?:my|the|a|an|his|her|their)?\s*([a-z0-9'\u2019\- ]{2,40}?)(?=[.,!?;:]|$|\s+(?:and|at|on|to|into|from|with|before|across)\b)/i;
  var USE_RE = /\b(use(?:s)?|grab(?:s)?|take(?:s)? out|raise(?:s)?|aim(?:s)?|fire(?:s)?|shoot(?:s)?|swing(?:s)?|throw(?:s)?|ready|readies|level(?:s)?)\s+my\s+([a-z0-9'\u2019\- ]{2,40}?)(?=[.,!?;:]|$|\s+(?:and|at|on|to|into|from|with|before|across)\b)/i;
  // Things nobody carries: reaching for these is scenery, not a claim.
  var NOT_KIT = /\b(door|doors|window|curtain|lever|handle|rail|railing|stairs|chair|table|desk|wall|gate|bell|rope bridge|breath|voice|eyes?|hands?|arms?|fists?|feet|foot|shoulder|weight|nerve|courage|thoughts?|memory|words?|chance|moment|attention)\b/i;

  /** What the player just claimed to hold. Returns null (no claim),
   *  { kind: 'have', sheet, item } (it is on their sheet — take it in
   *  hand), or { kind: 'conjured', claim } (it came out of thin air). */
  RP.conjureCheck = function (room, text) {
    var you = (room && room.states && room.states[RP.PLAYER_ID]) ||
      (room && room.youPlay && room.states ? room.states[room.youPlay] : null);
    if (!you) return null;
    var hit = DRAW_RE.exec(String(text || '')) || USE_RE.exec(String(text || ''));
    if (!hit) return null;
    var claim = hit[2].trim().replace(/^(own|trusty|old|good|new|little|big)\s+/i, '');
    // The claim is a noun phrase, not half a sentence: “stuff since I am
    // alone” and “wallet how much gold is in there” both got flagged
    // whole. Clip at the first clause break or question word.
    claim = claim.split(/\s+(?:since|because|and|but|then|so|as|while|before|after|when|if|how|what|where|who|which|that)\b/i)[0]
      .replace(/[.,;:!?]+$/, '').trim();
    // Packing up your own unspecified things is not conjuring.
    if (/^(?:stuff|things?|belongings|everything|items|gear|supplies|bags?)$/i.test(claim)) return null;
    if (claim.length < 3 || NOT_KIT.test(claim)) return null;
    var kit = (you.items || []).map(RP.normItem);
    var claimLow = ' ' + claim.toLowerCase() + ' ';
    var owned = kit.filter(function (i) {
      var name = i.name.toLowerCase();
      if (claimLow.indexOf(' ' + name + ' ') >= 0 || name.indexOf(claim.toLowerCase()) >= 0) return true;
      // Any solid word shared between the claim and the item name counts:
      // "the brass key" finds "a brass key | bent".
      return name.split(/[^a-z0-9]+/).some(function (w) {
        return w.length >= 3 && SMALL_WORDS.indexOf(' ' + w + ' ') < 0 && claimLow.indexOf(' ' + w + ' ') >= 0;
      });
    })[0];
    if (owned) return { kind: 'have', sheet: you, item: owned, claim: claim };
    return { kind: 'conjured', claim: clip(claim, 40) };
  };

  /** Settle a thin-air claim on the page, from the roll, before the model
   *  is asked anything. A good roll means the thing WAS within reach: it
   *  lands on the sheet now, in hand, and the model is told so. A bad roll
   *  means the hand comes up empty. With fate off there is no roll, and
   *  the model keeps the call. Returns { granted, line } or null. */
  RP.resolveConjure = function (room, claim, fate) {
    if (!claim || !fate || fate.granted === undefined) return null;
    var you = (room.states || {})[RP.PLAYER_ID] || (room.youPlay ? (room.states || {})[room.youPlay] : null);
    if (!you) return null;
    if (!fate.granted) return { granted: false, line: '🚫 ' + claim + ' — reached for, not there (' + fate.label.toLowerCase() + ')' };
    var line = RP.applyChange(you, { kind: 'item', op: '+', name: claim, note: 'found to hand, ' + fate.label.toLowerCase() });
    if (line) RP.applyChange(you, { kind: 'equip', op: '+', name: claim });
    return { granted: Boolean(line), line: line ? '🎒 ' + claim + ' — it was within reach after all; on the sheet, in hand' : '🚫 ' + claim + ' — no room in the pack for it' };
  };

  /** The one-off block a conjured claim earns. Costs nothing until it
   *  fires. `verdict` is the page's settlement when the dice are on. */
  RP.conjureBlock = function (claim, verdict) {
    if (!claim) return '';
    if (verdict && verdict.granted) {
      return 'OUT OF THIN AIR — the player reached for \u201c' + claim + '\u201d, which was NOT on their sheet. The dice say it was\n' +
        'within reach after all: it is on their sheet now, in hand. Show where it came from in one plain clause (a shelf, a\n' +
        'fallen guard, a pocket they forgot) and carry on; the ruling above says how the attempt itself goes.';
    }
    if (verdict && verdict.granted === false) {
      return 'OUT OF THIN AIR — the player claims \u201c' + claim + '\u201d; nothing like it is on their sheet, and the dice say it is\n' +
        'not there. The hand comes up EMPTY. Nobody hands them one. Write the moment the bluff fails inside the fiction —\n' +
        'the grab at nothing, the look on the other face — and never scold the player for trying.';
    }
    return 'OUT OF THIN AIR — the player claims \u201c' + claim + '\u201d; nothing like it is on their sheet.\n' +
      'They do not have it. If the scene has visibly put one within their reach, hand it to them on the record\n' +
      'with [[ITEM: \u2026]] and let it work. Otherwise the claim fails inside the fiction — an empty hand, a bluff\n' +
      'called, a reach for something that is not there. Play it, do not scold it.';
  };

  /* ---- the quartermaster: upkeep, so the sheets are never static ----
   * The model already writes to the sheets in the turn itself, with stage
   * directions. But a small model forgets: the prose presses a lantern
   * into your hands and no [[ITEM:]] lands. Two nets, both cheap.
   *   1. A deterministic scan of every reply for things plainly handed
   *      to the player — no model call, applied on the spot.
   *   2. Every few played turns, ONE small background call (the same
   *      utility slot and session budget as the lore book) reads the
   *      recent prose against the sheets and files what the record
   *      missed. It may only keep the ledger — never invent events. */

  RP.UPKEEP_EVERY = 6;              // played turns between reviews; 0 turns it off
  RP.UPKEEP_KINDS = ['hp', 'mp', 'flag', 'item', 'use', 'equip', 'status', 'counter', 'mood'];

  /** "presses the lantern into your hands", "hands you a brass key" —
   *  a grant the reply narrated at the player. Deliberately narrow: an
   *  offer, a look or a mention is not a grant. Returns up to two names. */
  RP.grantScan = function (text) {
    var t = String(text || '');
    var out = [], m;
    var handsYou = /\b(?:hands?|gives?|passes|tosses|throws)\s+you\s+(?:the|a|an|his|her|their|its)\s+([a-z0-9'\u2019\- ]{2,40}?)(?=[.,!?;:]|$|\s+(?:and|to|so|as|before|across|with|without)\b)/gi;
    var intoYour = /\b(?:presses|pushes|slips|drops|places|shoves)\s+(?:the|a|an|his|her|their|its)\s+([a-z0-9'\u2019\- ]{2,40}?)\s+into\s+your\s+(?:hands?|palms?|pockets?|pack|arms|lap)\b/gi;
    while ((m = handsYou.exec(t))) out.push(m[1].trim());
    while ((m = intoYour.exec(t))) out.push(m[1].trim());
    return out.filter(function (name) {
      return name.length >= 3 && !NOT_KIT.test(name);
    }).slice(0, 2);
  };

  /* ------------------------------------------------------------------ *
   * the hurt ledger — damage filed from the prose, no model call
   *
   * A helicopter slammed into the pavement and nobody lost a point: the
   * model narrated the crash and filed nothing. The quartermaster could
   * catch it, at the price of a second call. This net is free: the prose
   * is read for what hurts, and whoever it reaches loses a share of their
   * max HP — so a 10-HP sheet and a 100-HP one bleed alike. The model's
   * own [[HP:]] for a person always wins over the page's guess for them.
   * ------------------------------------------------------------------ */

  // What hurts, by how much (shares of max HP), and WHO it lands on:
  // 'all' reaches everyone in the scene (a crash, a blast, a collapse);
  // 'object' hits the one named or pointed at after the verb; 'subject'
  // hits the one doing the falling; 'owner' hits whoever's arm it is.
  // Transitive verbs refuse a plain article after them, so "kicks the
  // door open" and "shoots the lock" are nobody's wound; a crash needs a
  // vehicle in the sentence, so a slammed door and a crashing wave are
  // not a helicopter.
  var HURT_NO_OBJ = '(?!\\s+(?:the|a|an|at|out|through|off|into|up|down|open|shut|over|back|away|aside|it|its|his|her|their|my|your|wildly|blindly|air)\\b)';
  var HURT_NO_THING = '(?!\\s+(?:the|a|an|at|out|through|off|into|up|down|open|air|nothing|only|wood|cloth|leather|stone|metal|empty)\\b)';
  var HURT_VEHICLE = /\b(?:helicopter|chopper|heli|plane|aircraft|airplane|aeroplane|airship|zeppelin|jet|glider|balloon|shuttle|craft|vessel|ship|boat|skiff|raft|canoe|ferry|yacht|submarine|car|truck|lorry|van|bus|cab|taxi|coach|jeep|tank|train|locomotive|carriage|tram|trolley|wagon|cart|sled|sleigh|bike|bicycle|motorcycle|motorbike|scooter|pod|hull|cockpit|fuselage|elevator|lift|gondola|cable car|coaster|kart|buggy|chariot|mech|walker|dropship|lander|capsule|rocket|wreck)\b/i;
  var HURT_SURFACE = 'wall|dashboard|glass|window|windscreen|windshield|table|floor|door|bulkhead|console|ground|pavement|rocks?|railing|bars|stone|deck|bar|pillar|post|tree|counter|shelves|shelving|cabinet|crates?|barrels?|fence|gate|wreckage|hull|side of the \\w+';
  var HURT_RULES = [
    { tier: 'grave', who: 'all', cause: 'the crash', pre: HURT_VEHICLE,
      re: /\b(?:crash(?:es|ed|ing)?|slams?|slammed|smash(?:es|ed)|plough(?:s|ed)?|plows?|plowed|careens?|careened|hurtles?|hurtled|nose.?dives?|nosedived|pancakes?|pancaked|ditch(?:es|ed)|(?:goes|went|comes|came)\s+down\s+hard|hits?\s+the\s+(?:ground|water|tarmac|trees|rocks|pavement)|strikes?\s+the\s+(?:ground|water|tarmac|trees|rocks|pavement))\b(?!\s+(?:the|a|an|his|her|their|my|your|them|him|me|us|course|shut|open)\b)/i },
    { tier: 'grave', who: 'all', cause: 'the crash',
      re: /\b(?:impact\s+(?:is|was)?\s*(?:a\s+)?(?:violent|brutal|savage|bone|tremendous|enormous|sickening)|impact\s+(?:throws?|hurls?|slams?|flings?|tosses?|pitches?|knocks?)\s+(?:everyone|everybody|everything|them|us|all|him|her|you|me)|(?:throws?|hurls?|slams?|flings?|pitches?)\s+(?:everyone|everybody|everything|us\s+all|them\s+all|the\s+\w+\s+of\s+(?:them|us))\s+(?:forward|back|backward|sideways|against|into|across|to\s+the|off))\b/i },
    { tier: 'grave', who: 'all', cause: 'the blast',
      re: /\b(?:explo(?:des|ded)|detonat(?:es|ed)|(?:bomb|grenade|charge|mine|device|shell|barrel|tank|car|truck|boiler|reactor|cannon|powder|magazine|cache)\s+(?:\w+\s+)?(?:goes|went)\s+off|(?:explosion|detonation|blast|shockwave|fireball)\s+(?:\w+\s+)?(?:rips?|tears?|throws?|hurls?|hits?|slams?|knocks?|flattens?|catches|engulfs?|takes?|rocks?|shakes?|erupts?|lifts?|blows|swallows?|fills?|guts?|levels?))\b/i },
    { tier: 'grave', who: 'all', cause: 'the collapse',
      re: /\b(?:roof|ceiling|wall|tunnel|building|floor|tower|bridge|mine|scaffold|balcony|stairs|staircase|gallery|cave|shaft|house|barn|church|dome|arch|walkway|pier|platform)\s+(?:\w+\s+)?(?:collapses|collapsed|caves?\s+in|caved\s+in|comes?\s+down|came\s+down|gives?\s+way|gave\s+way|buckles|buckled|folds?\s+in|falls?\s+in|fell\s+in)\b/i },
    { tier: 'grave', who: 'subject', cause: 'the fall',
      re: /\b(?:falls?|fell|plunges?|plunged|drops?|dropped|tumbles?|tumbled)\s+(?:\w+\s+){0,3}?(?:storeys|stories|floors|from\s+the\s+(?:roof|cliff|tower|bridge|sky|window|ledge|rigging|mast|balcony|rooftop|wall)|off\s+the\s+(?:roof|cliff|bridge|tower|ledge|balcony|rooftop|wall)|down\s+the\s+(?:shaft|cliff|ravine|stairs|stairwell|well)|into\s+the\s+(?:ravine|gorge|chasm|rocks|pit|void))\b/i },
    { tier: 'grave', who: 'subject', cause: 'the crash',
      re: /\b(?:thrown|hurled|flung)\s+(?:clear\s+)?(?:from|out\s+of)\s+the\s+(?:wreck(?:age)?|cockpit|cab|car|saddle|plane|helicopter|carriage|truck|window)\b/i },
    { tier: 'heavy', who: 'object', cause: 'the blade',
      re: new RegExp('\\b(?:stabs?|stabbed|slash(?:es|ed)|impal(?:es|ed)|guts|gutted|skewers?|skewered|runs?\\s+(?=(?:him|her|them|you|me)\\s+through))' + HURT_NO_OBJ + '\\b', 'i') },
    { tier: 'heavy', who: 'object', cause: 'the blade',
      re: new RegExp('\\b(?:blade|axe|hatchet|sword|spear|arrow|bolt|dagger|knife|bayonet|machete|steel|edge|point)\\s+(?:bites|sinks|opens|finds|tears|lands|takes|hits|buries|catches|punches|goes)' + HURT_NO_THING + '\\b', 'i') },
    { tier: 'heavy', who: 'object', cause: 'the shot',
      re: new RegExp('\\b(?:shoots?)' + HURT_NO_OBJ + '\\b', 'i') },
    { tier: 'heavy', who: 'object', cause: 'the shot',       // "shot" the verb, not the drink or the long one
      re: new RegExp('\\b(?:[A-Z][\\w\'-]+|he|she|they|I|you|we|who|is|was|are|were|gets?|got|been|being|and|then|got)\\s+shot' + HURT_NO_OBJ + '(?!\\s+(?:of|glass|at)\\b)\\b') },
    { tier: 'heavy', who: 'object', cause: 'the shot',
      re: new RegExp('\\b(?:bullet|round|slug|buckshot|shrapnel)\\s+(?:hits|tears|rips|catches|takes|punches|finds|strikes|goes|opens)' + HURT_NO_THING + '\\b', 'i') },
    { tier: 'heavy', who: 'subject', cause: 'the shot',
      re: /\b(?:takes?|took|catches|caught)\s+(?:a|the|two|three|another)\s+(?:bullet|round|slug|arrow|bolt|blade|knife)\b/i },
    { tier: 'heavy', who: 'subject', cause: 'the beating',
      re: /\b(?:takes?|took)\s+(?:a|the|another)\s+(?:beating|hammering|pounding|thrashing)|beaten\s+(?:badly|bloody|senseless|half\s+to\s+death)|knocked\s+(?:out|cold|senseless|unconscious|flat|sprawling)\b/i },
    { tier: 'heavy', who: 'object', cause: 'the beating',
      re: new RegExp('\\b(?:knocks?\\s+(?=(?:him|her|them|you|me)\\s+(?:out|cold|senseless|flat|down|sprawling))|club(?:s|bed)|bludgeons?|bludgeoned|pummels?|pummeled|pummelled)' + HURT_NO_OBJ + '\\b', 'i') },
    { tier: 'heavy', who: 'object', cause: 'the throw',
      re: new RegExp('\\b(?:throws?|hurls?|flings?|slams?|smashes|drives?|rams?)\\s+(?=(?:him|her|them|you|me|\\w+)\\s+(?:\\w+\\s+)?(?:through|against|into)\\s+(?:the|a)\\s+(?:' + HURT_SURFACE + '))', 'i') },
    { tier: 'heavy', who: 'subject', cause: 'the throw',
      re: new RegExp('\\b(?:go(?:es)?|went|flies|flew|thrown|hurled|flung|slammed|smashed|put|sent|crash(?:es|ed)|smash(?:es|ed)|slams?)\\s+(?:\\w+\\s+)?(?:through|against|into)\\s+(?:the|a)\\s+(?:' + HURT_SURFACE + ')\\b', 'i') },
    { tier: 'heavy', who: 'owner', cause: 'the break',
      re: /\b(?:breaks?|broke|snaps?|snapped|shatters?|shattered|cracks?|cracked|dislocates?|dislocated)\s+(his|her|their|your|my)\s+(?:arm|leg|ribs?|nose|jaw|wrist|ankle|collarbone|skull|hand|fingers?|knee|shoulder|hip|elbow|spine|back)\b/i },
    { tier: 'heavy', who: 'object', cause: 'the crush',
      re: new RegExp('\\b(?:crush(?:es|ed)|tramples?|trampled|flattens?|flattened)' + HURT_NO_OBJ + '\\b', 'i') },
    { tier: 'heavy', who: 'object', cause: 'the mauling',
      re: new RegExp('\\b(?:mauls?|mauled|gores?|gored|savages?|savaged)' + HURT_NO_OBJ + '\\b', 'i') },
    { tier: 'heavy', who: 'object', cause: 'the fire',
      re: /\b(?:engulf(?:s|ed)|(?:flames?|fire)\s+(?:swallows?|takes?|catches|wraps?|climbs?))\b/i },
    { tier: 'heavy', who: 'subject', cause: 'the fire',
      re: /\b(?:catches|caught)\s+fire|burns?\s+(?:badly|through\s+to\s+the)\b/i },
    { tier: 'light', who: 'object', cause: 'the blow',
      re: new RegExp('\\b(?:punch(?:es|ed)|kicks?|kicked|slaps?|slapped|shoves?|shoved|clips?|clipped|elbowed|headbutts?|headbutted|backhands?|backhanded|cuffs?|cuffed|decked|wallops?|walloped|thumps?|thumped|clouts?|clouted|kneed|(?:hits?|strikes?|struck|catches|caught|lands|connects)\\s+(?:\\w+\\s+){0,2}?(?:in|across|on|to)\\s+the\\s+(?:face|jaw|head|ribs|gut|stomach|mouth|nose|shoulder|back|chest|temple|knee|thigh|arm|ear|eye|cheek|chin)|(?:hits?|strikes?|struck)\\s+(?=(?:him|her|them|you|me)\\b))' + HURT_NO_OBJ + '\\b', 'i') },
    { tier: 'light', who: 'object', cause: 'the bite',
      re: new RegExp('\\b(?:bites?|nips?|nipped|bit\\s+(?=(?:him|her|them|you|me|into)\\b))' + HURT_NO_OBJ + '\\b', 'i') },
    { tier: 'light', who: 'object', cause: 'the burn',
      re: new RegExp('\\b(?:scalds?|scalded|singes?|singed|burns?)' + HURT_NO_OBJ + '\\b', 'i') },
    { tier: 'light', who: 'owner', cause: 'the burn',
      re: /\b(?:burns?|burned|burnt|scalds?|scalded|singes?|singed|blisters?)\s+(his|her|their|your|my)\s+(?:hand|arm|palm|fingers?|face|cheek|leg|foot|skin|sleeve|hair|brow|back|neck)\b/i },
    { tier: 'light', who: 'owner', cause: 'the cut',
      re: /\b(?:cuts?|slices?|sliced|nicks?|nicked|gashes|gashed|scrap(?:es|ed)|graz(?:es|ed)|skins?|skinned|splits?|bloodies|bloodied|bruis(?:es|ed)|wrenches?|wrenched|twists?|twisted|sprains?|sprained|jars?|jarred)\s+(his|her|their|your|my)\s+(?:hand|arm|palm|cheek|lip|brow|leg|knee|finger|scalp|shin|elbow|knuckles|ankle|wrist|shoulder|ribs?|nose|forehead|chin|neck|side|back|thigh|foot|heel)\b/i },
    { tier: 'light', who: 'subject', cause: 'the fall',
      re: /\b(?:stumbles?\s+and\s+falls?|stumbled\s+and\s+fell|falls?\s+(?:hard|flat|badly|heavily)|fell\s+(?:hard|badly|heavily)|goes\s+down\s+hard|went\s+down\s+hard|takes?\s+(?:a|the)\s+(?:tumble|spill|fall)|took\s+(?:a|the)\s+(?:tumble|spill|fall))\b/i },
    { tier: 'light', who: 'subject', cause: 'the blow',
      re: /\b(?:takes?|took|catches|caught|eats?|ate)\s+(?:a|the|another)\s+(?:punch|kick|slap|blow|hit|elbow|knee|fist|boot|right|left|hook|jab|uppercut|headbutt|backhand)\b/i },
  ];
  var HURT_SHARE = { grave: [0.25, 0.45], heavy: [0.12, 0.22], light: [0.04, 0.09] };
  // A sentence that is not a hit after all: a miss, a memory, a threat, a
  // figure of speech, something happening far away.
  var HURT_NOT = /\b(?:almost|nearly|barely|narrowly|just\s+misses|misses|missed|dodges?|dodged|ducks?|ducked|sidesteps?|sidestepped|parries|parried|blocks?|blocked|unharmed|unhurt|unscathed|would\s+have|could\s+have|might\s+have|should\s+have|threatens?\s+to|threatening\s+to|about\s+to|going\s+to|if\s+(?:he|she|they|you|it|we|i)\b|imagine|remember(?:s|ed|ing)?|memory|memories|dream(?:s|t|ed|ing)?|nightmare|had\s+(?:crashed|exploded|fallen|stabbed|shot|collapsed)|years?\s+ago|weeks?\s+ago|last\s+(?:time|week|year|night|month)|used\s+to|the\s+story\s+of|tale|legend|rumou?r|in\s+the\s+distance|far\s+(?:off|away|below)|miles\s+away|on\s+the\s+horizon|across\s+the\s+(?:city|valley|bay|river|water)|elsewhere|on\s+the\s+(?:radio|news|screen|television|tv|wire)|footage|pretends?|pretending|mimes?|jokes?|joking|as\s+if|like\s+(?:a|an|the)\s+(?:crash|blast|bullet|blade|bomb)|crash\s+course|market\s+crash(?:es|ed)?|(?:waves?|surf|thunder|cymbals?|music|sound|noise|applause|chord|server|system|program|computer|stock|economy|prices?)\s+(?:\w+\s+)?crash|crash(?:es|ed|ing)?\s+(?:of\s+)?(?:thunder|waves|cymbals|applause|music)|crash(?:es|ed)?\s+(?:the|a)\s+(?:party|meeting|wedding|funeral|summit)|crashes?\s+(?:on|onto|into)\s+(?:the\s+)?(?:couch|sofa|bed|chair|armchair|cot|bunk)|falls?\s+asleep|fell\s+asleep)\b/i;
  var HURT_ALL = /^\s+(?:\w+\s+)?(?:everyone|everybody|all\s+of\s+(?:them|us|you)|both\s+of\s+(?:them|us|you)|the\s+(?:two|three|four|five)\s+of\s+(?:them|us|you)|the\s+(?:whole|entire)\s+(?:cabin|cockpit|crew|party|group|room|car|carriage))\b/i;
  var HURT_BRACE = /\b(?:brac(?:e|es|ed|ing)|hold(?:s|ing)?\s+on(?:to)?|held\s+on(?:to)?|hang(?:s|ing)?\s+on(?:to)?|hung\s+on(?:to)?|grip(?:s|ped|ping)?\s+(?:the|onto)|strapped|seat\s?belts?|harness|cushion(?:s|ed)?|curl(?:s|ed)?\s+(?:up|into\s+a\s+ball)|cover(?:s|ed|ing)?\s+(?:my|his|her|their|your)\s+head|shield(?:s|ed)?|tuck(?:s|ed)?\s+and\s+roll|roll(?:s|ed)?\s+with|dives?\s+(?:for|behind)\s+cover|dived\s+behind|behind\s+cover|take(?:s)?\s+cover|took\s+cover|duck(?:s|ed)?\s+behind|lands?\s+on\s+(?:his|her|their|my|your)\s+feet|breaks?\s+(?:the|my|his|her|their|your)\s+fall)\b/i;
  var HURT_SCALE = { off: 0.5, gentle: 0.6, normal: 1, harsh: 1.3 };

  RP.bracedIn = function (text) { return HURT_BRACE.test(String(text || '')); };

  function hurtSentences(text) {
    return String(text || '')
      .replace(/(?:\[\[|\{\{)[^\]\}\n]*(?:\]\]|\}\}|\]\}|\}\])/g, ' ')
      .replace(/"[^"\n]{0,400}"|\u201c[^\u201d\n]{0,400}\u201d/g, ' ')     // what people SAY about crashing is not a crash
      .split(/\n+|[.!?]+["\u201d\u2019)*_]*\s+/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }
  function hurtRuleIn(sentence) {
    for (var i = 0; i < HURT_RULES.length; i++) {
      var m = sentence.match(HURT_RULES[i].re);
      if (m && (!HURT_RULES[i].pre || HURT_RULES[i].pre.test(sentence.slice(0, m.index)))) {
        return { rule: HURT_RULES[i], match: m[0], at: m.index, owner: m[1] || '' };
      }
    }
    return null;
  }

  /** Is there violence in this text at all? For the prompt: a short order
   *  to file the wounds rides along only on turns that have some. Looser
   *  than the ledger — the player's "as the aircraft crashes" counts. */
  RP.dangerIn = function (text) {
    var cause = '';
    hurtSentences(text).some(function (s) {
      if (HURT_NOT.test(s)) return false;
      var found = hurtRuleIn(s);
      if (found) { cause = found.rule.cause; return true; }
      var loose = s.match(/\b(?:crash(?:es|ed|ing)?|explo(?:de|des|ded|sion)|collaps(?:es|ed|ing)|stab(?:s|bed|bing)?|shoot(?:s|ing)?|shot\s+(?:at|him|her|them|you|me|in|through|dead|down)|open(?:s|ed)?\s+fire|fir(?:es|ed|ing)\s+(?:at|on|into)|attack(?:s|ed|ing)?|ambush(?:es|ed)?|punch(?:es|ed|ing)?|swing(?:s|ing)?\s+(?:at|the\s+\w+\s+at)|charg(?:es|ed|ing)\s+(?:at|into)|tackl(?:es|ed|ing)|fall(?:s|ing)?\s+(?:from|off|down)|(?:on|catches|caught)\s+fire|burn(?:s|ing)?\s+(?:him|her|them|you|me|through|down|alive)|blast(?:s|ed)?|detonat(?:es|ed|ing)?|bomb(?:s|ed)?|grenade|crushed|drown(?:s|ed|ing)?|hit(?:s|ting)?\s+(?:him|her|them|it|the\s+\w+\s+with))\b/i);
      if (!loose) return false;
      var w = loose[0];
      cause = /crash/i.test(w) ? 'the crash' : /explo|blast|detonat|bomb|grenade/i.test(w) ? 'the blast'
        : /collaps/i.test(w) ? 'the collapse' : /fall/i.test(w) ? 'the fall' : /burn/i.test(w) ? 'the fire'
        : /shoot|shot|fire/i.test(w) ? 'the shooting' : /drown/i.test(w) ? 'the drowning' : 'the fight';
      return true;
    });
    return cause;
  };

  /** The order that rides in the protected tail on a violent turn only
   *  (~90 tokens, nothing on a quiet one): wounds go on the record. */
  RP.hurtBlock = function (room, text) {
    if (!room || room.mechanics === 'off') return '';
    var cause = RP.dangerIn(text);
    if (!cause) return '';
    return 'WOUNDS \u2014 there is violence in this turn (' + cause + '). Whoever it reaches is hurt ON THE RECORD, not only in the ' +
      'prose: file [[HP: Name -N]] for each of them, N as a share of their max HP \u2014 a scrape or a shove 3\u20138%, a beating, ' +
      'a blade or a bullet 10\u201325%, a crash, a fall from height or a blast 25\u201345%, and everyone in a crash or a blast, ' +
      'not just one of them. If you file nothing, the page files it from your prose at those rates.';
  };

  /** Read a turn for what hurts and who it reaches.
   *  opts: speaker (the card's character, for I/me), world (a narrator's
   *  turn), filed (lowercase names the model already filed [[HP:]] for —
   *  theirs wins), level (fate level, scales the amounts), braced (the
   *  player's own turn had them holding on — their share is halved),
   *  roll (0–1, for tests; otherwise random).
   *  Returns [{ id, name, amount, cause, tier }], one entry per person. */
  RP.hurtScan = function (text, room, opts) {
    opts = opts || {};
    if (!room || room.mechanics === 'off') return [];
    var states = room.states || {};
    var youId = RP.playerSheetId(room);
    var you = states[youId];
    var people = RP.presentCast(room).filter(function (c) { return states[c.id] && states[c.id].hp; }).map(function (c) {
      return { id: c.id, name: c.name };
    });
    if (you && you.hp && you.present !== false && !people.some(function (p) { return p.id === youId; })) people.push({ id: youId, name: you.name });
    if (!people.length) return [];
    var filed = (opts.filed || []).map(function (n) { return String(n || '').toLowerCase().trim(); }).filter(Boolean);
    var isFiled = function (p) {
      var name = p.name.toLowerCase(), first = name.split(/\s+/)[0];
      return filed.some(function (f) {
        return f === name || f === first || (f.length > 2 && (name.indexOf(f) === 0 || f.indexOf(name) === 0)) ||
          (p.id === youId && (f === 'you' || f === 'the player' || f === 'player'));
      });
    };
    var speakerId = opts.speaker && opts.speaker.id && states[opts.speaker.id] ? opts.speaker.id : '';
    var scale = HURT_SCALE[opts.level || 'normal'] || 1;
    var roll = opts.roll === undefined ? Math.random() : Math.max(0, Math.min(1, Number(opts.roll) || 0));
    var hits = {};
    var antecedent = speakerId;       // who "he" is, until somebody else is named
    var nameAt = function (s, p) {
      var low = s.toLowerCase(), first = p.name.toLowerCase().split(/\s+/)[0];
      var at = low.indexOf(p.name.toLowerCase());
      if (at < 0 && first.length > 2) at = low.search(new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'));
      return at;
    };
    hurtSentences(text).forEach(function (s) {
      var named = people.map(function (p) { return { p: p, at: nameAt(s, p) }; })
        .filter(function (x) { return x.at >= 0; })
        .sort(function (a, b) { return a.at - b.at; });
      var before = antecedent;
      if (named.length) antecedent = named[named.length - 1].p.id;
      if (HURT_NOT.test(s)) return;
      var found = hurtRuleIn(s);
      if (!found) return;
      var rule = found.rule;
      var pre = s.slice(0, found.at), post = s.slice(found.at + found.match.length);
      // a pronoun stands for: you → the player; I → the card's speaker;
      // he/she/they → the last person named (here or earlier)
      var nearestIn = function (chunk, base) {          // the last of our people named in a chunk of the sentence
        var best = '';
        named.forEach(function (x) { if (x.at >= base && x.at < base + chunk.length) best = x.p.id; });
        return best;
      };
      var pronoun = function (w, nearest) {
        w = String(w || '').toLowerCase();
        if (/^(?:you|your|yourself)$/.test(w)) return you ? youId : '';
        if (/^(?:i|me|my|myself)$/.test(w)) return speakerId;
        return nearest || before;
      };
      var other = function (w) {                         // him/her/them after the verb: not whoever is doing it
        var subj = nearestIn(pre, 0);
        if (before && before !== subj) return before;
        var rest = named.filter(function (x) { return x.at < found.at && x.p.id !== subj; });
        return rest.length ? rest[rest.length - 1].p.id : '';
      };
      var subject = function () {                        // who the sentence is about, before the verb
        var inPre = nearestIn(pre, 0);
        if (inPre) return inPre;
        var pm = pre.match(/\b(I|me|my|myself|you|your|yourself|he|him|his|himself|she|her|herself|they|them|their|themselves)\b(?!.*\b(?:I|you|he|she|they|him|her|them)\b)/);
        if (pm) return pronoun(pm[1], '');
        if (/\w/.test(pre)) return '';                   // a door, a wave, a plant: not one of ours
        return before || (opts.world ? '' : speakerId);
      };
      var targets = [];
      if (rule.who === 'all' || HURT_ALL.test(post)) {
        targets = people.map(function (p) { return p.id; });
      } else if (rule.who === 'subject') {
        targets.push(subject());
      } else if (rule.who === 'owner') {
        targets.push(pronoun(found.owner, nearestIn(pre, 0)));
      } else {
        var om = post.match(/^\s+(?:into\s+|through\s+|across\s+|at\s+)?(him|her|them|you|me|his|their|your|my|himself|herself|themselves|yourself|myself)\b/i) ||
          found.match.match(/\b(him|her|them|you|me)\b/i);
        var after = named.filter(function (x) { return x.at >= found.at; });
        if (om && !(after.length && after[0].at < found.at + found.match.length + 6)) {
          targets.push(/^(?:him|her|them)$/i.test(om[1]) ? other(om[1]) : pronoun(om[1], nearestIn(pre, 0) || ''));
        } else if (after.length) {
          targets.push(after[0].p.id);
        } else if (/\b(?:is|was|are|were|am|gets?|got|getting|being|been|lies|lay)\s*(?:\w+ly\s+)?$|,\s*$/i.test(pre) || /^(?:\w+ed|shot|struck|bitten|bit)\b/i.test(found.match) && !pre.trim()) {
          targets.push(subject());
        }
      }
      var braced = HURT_BRACE.test(s);
      var share = HURT_SHARE[rule.tier];
      targets.forEach(function (id) {
        var p = people.filter(function (x) { return x.id === id; })[0];
        if (!p || isFiled(p)) return;
        var sheet = states[id];
        var max = Number(sheet.hp && sheet.hp.max) || 0;
        if (!max) return;
        var pct = share[0] + (share[1] - share[0]) * roll;
        var soft = (braced || (id === youId && opts.braced)) ? 0.5 : 1;
        var amount = Math.max(1, Math.round(max * pct * scale * soft));
        var cur = hits[id];
        if (cur && cur.amount >= amount) return;
        hits[id] = { id: id, name: p.name, amount: amount, cause: rule.cause, tier: rule.tier };
      });
    });
    return Object.keys(hits).map(function (k) { return hits[k]; });
  };

  /** Is it time for the background review? Counted in played turns since
   *  the last one, like the recap and the book. */
  RP.needsUpkeep = function (room, every) {
    every = every === undefined ? RP.UPKEEP_EVERY : Number(every);
    if (!every || !room || room.mechanics === 'off') return false;
    var turns = (room.messages || []).filter(RP.visible).length;
    return turns - Number(room.upkeepAt || 0) >= every;
  };

  /** The reviewer's prompt: sheets on one side, prose on the other, and
   *  the only legal output is ledger lines. */
  RP.upkeepPrompt = function (room, turns) {
    return [
      'You are the quartermaster of a roleplay scene. Compare the sheets against the recent turns and file ONLY',
      'what the prose established but the record missed: a thing gained, lost, handed over or spent; a hurt that',
      'landed; a condition that began or ended; something taken in hand or put away.',
      '',
      'THE SHEETS NOW',
      RP.stateBlock(room),
      '',
      'THE RECENT TURNS',
      (turns || []).map(function (t) { return t.who + ': ' + clip(t.text, 280); }).join('\n'),
      '',
      'Reply with stage directions only, one per line, six at most:',
      '  [[ITEM: Name + 🗝 the thing | note]] · [[ITEM: Name - the thing]] · [[USE: Name the thing]]',
      '  [[EQUIP: Name the thing]] · [[STOW: Name the thing]] · [[HP: Name -5]]',
      '  [[COND: Name state 3 -1hp | why]] · [[CURE: Name state]] · [[STATUS: Name a short note]]',
      'Do not restate anything the sheets already have right. Do not invent anything the turns do not plainly',
      'show. If the record already matches the story, reply exactly: IN ORDER',
    ].join('\n');
  };

  /** Apply a review. Only ledger directives are honoured — the upkeep may
   *  not walk people in or out, rewrite facts, or colour words. */
  RP.applyUpkeep = function (state, room, reply) {
    var text = String(reply || '').trim();
    if (!text || /^IN ORDER\b/i.test(text)) return { lines: [] };
    var you = (room.states || {})[RP.PLAYER_ID];
    var names = (room.cast || []).map(function (c) { return c.name; })
      .concat(you ? [you.name, 'the player'] : []);
    var directives = RP.parseDirectives(text, names).directives.filter(function (d) {
      return RP.UPKEEP_KINDS.indexOf(d.kind) >= 0;
    }).slice(0, 6);
    if (!directives.length) return { lines: [] };
    return { lines: RP.applyDirectives(state, room, directives).lines };
  };

  /* ---- the AI audit: on demand, every sheet, every scene ----
     The quartermaster above is a small net on a timer. This is the same
     reader with the whole table in front of it, run by hand: all the
     sheets (both scenes when two are linked), the recent play of each,
     and licence to put the record right — wounds, kit, conditions,
     moods, notes, the clock, who is actually still in the room. It still
     cannot invent people or facts, and everything it files is shown
     before it lands and undone in one step. */

  RP.AUDIT_KINDS = RP.UPKEEP_KINDS.concat(['time', 'exit', 'enter']);
  RP.AUDIT_TURNS = 14;
  RP.AUDIT_TURNS_FULL = 40;      // the full audit reads the whole scene, up to this

  /** rooms: one scene, or the linked pair. turns: { roomId: [{who, text}] }. */
  RP.sheetAuditPrompt = function (rooms, turns, opts) {
    opts = opts || {};
    rooms = (rooms || []).filter(Boolean);
    var two = rooms.length > 1;
    var full = Boolean(opts.full);
    var sheets = rooms.map(function (room) {
      var away = (room.away || []).map(function (c) { return c.name; });
      return (two ? 'SCENE \u201c' + (room.title || 'untitled') + '\u201d' + (room.clock ? ' \u2014 ' + room.clock : '') + '\n' : '') +
        (RP.stateBlock(room) || '(no sheets)') +
        (away.length ? '\nWritten out of this scene, waiting at the door: ' + away.join(', ') : '');
    }).join('\n\n');
    var one = Boolean(opts.turn);
    var play = rooms.map(function (room) {
      var list = (turns && turns[room.id]) || [];
      return (two ? 'IN \u201c' + (room.title || 'untitled') + '\u201d\n' : '') +
        (list.length ? list.map(function (t) { return (t.mark ? '\u27f6 ' : '') + t.who + ': ' + clip(t.text, t.mark ? 1400 : 320); }).join('\n') : '(nothing played yet)');
    }).join('\n\n');
    return [
      'AUDIT THE SHEETS. You are the quartermaster of a roleplay ' + (two ? 'pair of linked scenes \u2014 one story, one clock, two rooms' : 'scene') +
      '. Read the recent play against every sheet and put the record right \u2014 decisively. This is the one place the',
      'record is corrected by judgement, so judge: for EVERY person decide what their HP and Energy should be NOW, given',
      'everything that has happened to them, and when the number on the sheet does not match the story, SET it',
      '([[HP: Name = N]], [[EN: Name = N]]) \u2014 a helicopter crash and a gunfight are not 65/100, and a night\u2019s rest is',
      'not 12/100. When the MAXIMUM is wrong for who they are or what they have become \u2014 a dragon and a child both at',
      '100, a man crippled for good, a pool that was never set \u2014 REDEFINE it: [[HP: Name = 28/80]] sets current and',
      'maximum together. Decide how each person feels now and how strongly, and file it. A condition that plainly began',
      'or ended; a thing gained, lost, handed over, spent, taken in hand or put away; a counter that moved; a stale',
      'physical note; the clock, if the play moved it; somebody who plainly left and is still listed, or is back',
      'and still written out. Do not leave a wrong number standing because nobody filed it at the time; do not',
      'restate what is already right. Anyone at 0 HP is DOWN \u2014 barely conscious \u2014 and if the play has them up and',
      'acting, one of the two is wrong: either the number (SET it to what the play shows) or the prose (say so in a NOTE).',
      '',
      one ? 'ONE TURN. Only the turn marked \u27f6 is under audit; the turns above it are context. Decide what in THAT turn' +
        ' should have moved the record and did not \u2014 HP for a blow, a graze, a fall, a burn; Energy for a spell or a sprint;' +
        ' a condition begun or ended; a thing taken, dropped, drawn or spent; a mood that plainly changed; somebody who' +
        ' entered or left; time that passed \u2014 for everyone it touches, and the PLAYER\u2019s own sheet first of all: the' +
        ' writer may not speak for the player, but the player\u2019s body took whatever the turn says it took. Where the sheet' +
        ' already shows it, leave it. Then NOTE: lines, up to three, on this turn alone \u2014 a line that person would never' +
        ' say, a paragraph written for somebody else, a thing the record contradicts, what the next turn must pick up.' : '',
      full ? 'FULL AUDIT. The whole scene is below, not just the last exchange. Judge the record at the root: a MAXIMUM that' +
        ' does not fit who this person is, or what the scene has made of them, is REDEFINED ([[HP: Name = current/max]],' +
        ' [[EN: Name = current/max]]); every condition is checked against the prose \u2014 cured when the play contradicts it,' +
        ' filed when the play shows it; who is present is checked against every exit and entrance; the clock against every' +
        ' passage of time; the kit against everything picked up, handed over, dropped or spent. Then the NOTE: lines, up to' +
        ' FIVE, on what in the scene does not hold together \u2014 who could not have done what, what was forgotten, what was' +
        ' promised and dropped, what the next turn must pick up.' : '',
      '',
      'THE SHEETS NOW',
      sheets,
      '',
      'THE RECENT PLAY',
      play,
      '',
      'Reply with stage directions, one per line, sixteen at most, the most consequential first (then the notes):',
      '  [[HP: Name -5]] · [[HP: Name = 40]] · [[HP: Name = 28/80]] (current/maximum) · [[EN: Name +3]] (Energy) · [[COUNT: Name arrows -1]]',
      '  [[ITEM: Name + 🗝 the thing | note]] · [[ITEM: Name - the thing]] · [[EQUIP: Name the thing]] · [[STOW: Name the thing]]',
      '  [[COND: Name state 3 -1hp | why]] · [[CURE: Name state]] · [[STATUS: Name a short physical note]]',
      '  [[MOOD: Name anger 2 | why]]   anger, fear, joy, grief, shame, disgust, surprise, affection, suspicion, pride, calm; 1\u20133',
      '  [[TIME: 23:40]] · [[EXIT: Name \u2014 why]] · [[ENTER: Name \u2014 why]] (ENTER only for somebody written out of this scene)',
      'Use the names exactly as the sheets spell them. Do not invent anything the play does not plainly show, and',
      'never a new person. The player\u2019s own sheet is audited like any other \u2014 their wounds, kit and mood included;',
      'the reader approves every line before it lands.',
      '',
      'Then, under the directions, up to ' + (full ? 'five' : 'three') + ' lines beginning NOTE: \u2014 what the LAST turn or two got wrong against',
      'the record and the people (a man at 28 HP charging out of a wreck; a line that person would never say; the same',
      'beat played for the fourth turn running; a thread everybody dropped; somebody who has not spoken in ten turns), and what the next turn should do instead \u2014 who',
      'should speak, what should show, what should cost. Advice to the writer, not changes to the record; concrete,',
      'one sentence each, naming names. If the record already matches the story and the play is sound, reply exactly: IN ORDER',
    ].filter(function (line, at, arr) { return line !== '' || (arr[at - 1] !== '' && at !== arr.length - 1); }).join('\n');
  };

  /** The NOTE: lines of an audit reply \u2014 advice to the writer. */
  RP.parseAuditNotes = function (reply, limit) {
    return String(reply || '').split(/\r?\n/).map(function (line) {
      var hit = /^\s*(?:[-*\u2022]\s*)?NOTE\s*:\s*(.+)$/i.exec(line);
      return hit ? clip(hit[1].trim(), 240) : '';
    }).filter(Boolean).slice(0, limit || 3);
  };

  /** Notes the reader approved from the audit ride the next turn, once. */
  RP.auditNoteBlock = function (room) {
    var notes = (room && room.auditNotes) || [];
    if (!notes.length) return '';
    return 'FROM THE AUDIT \u2014 notes on the last turns, for this one\n' + notes.map(function (n) { return '- ' + n; }).join('\n') +
      '\nTake them as the table\u2019s judgement: fix what they name in this turn, without announcing it.';
  };

  /** Apply an audit to one scene or the linked pair. Each line lands in
   *  the first scene that knows the name (shared sheets are synced by the
   *  page afterwards); ENTER is honoured only for somebody at that room's
   *  door; nothing may invent a person or rewrite a fact.
   *  Returns { byRoom: { roomId: [lines] }, lines: [all], count }. */
  RP.applySheetAudit = function (state, rooms, reply, opts) {
    rooms = (rooms || []).filter(Boolean);
    opts = opts || {};
    var out = { byRoom: {}, lines: [], items: [], count: 0 };
    rooms.forEach(function (room) { out.byRoom[room.id] = []; });
    var text = String(reply || '').trim();
    if (!text || /^IN ORDER\b/i.test(text) || !rooms.length) return out;
    var names = [];
    rooms.forEach(function (room) {
      var you = (room.states || {})[RP.PLAYER_ID];
      (room.cast || []).forEach(function (c) { names.push(c.name); });
      Object.keys(room.states || {}).forEach(function (k) { if (room.states[k] && room.states[k].name) names.push(room.states[k].name); });
      (room.away || []).forEach(function (c) { names.push(c.name); });
      if (you) names.push(you.name, 'the player');
    });
    var directives = RP.parseDirectives(text, names).directives.filter(function (d) {
      return RP.AUDIT_KINDS.indexOf(d.kind) >= 0;
    }).slice(0, 16);
    var knows = function (room, name) {
      var want = String(name || '').toLowerCase().trim();
      if (!want) return false;
      var you = (room.states || {})[RP.PLAYER_ID];
      if (you && (want === 'you' || want === 'the player' || want === String(you.name || '').toLowerCase())) return true;
      return (room.cast || []).some(function (c) {
        var low = c.name.toLowerCase();
        return low === want || low.indexOf(want) >= 0 || want.indexOf(low) >= 0;
      }) || Object.keys(room.states || {}).some(function (k) {
        var low = String((room.states[k] || {}).name || '').toLowerCase();
        return low && (low === want || low.indexOf(want) >= 0 || want.indexOf(low) >= 0);
      });
    };
    var atDoor = function (room, name) {
      var want = String(name || '').toLowerCase().trim();
      return (room.away || []).some(function (c) {
        var low = String(c.name || '').toLowerCase();
        return low && (low.indexOf(want) >= 0 || want.indexOf(low) >= 0);
      });
    };
    // The player's own mood is theirs in play; here the reader approves
    // every line, so the audit may move it — applyDirectives is told so.
    directives.forEach(function (d, index) {
      if (opts.only && opts.only.indexOf(index) < 0) return;      // the reader unticked it
      var home = null;
      if (d.kind !== 'time' && !String(d.who || d.name || '').trim()) return;
      if (d.kind === 'time') home = rooms[0];
      else if (d.kind === 'enter') home = rooms.filter(function (room) { return atDoor(room, d.name); })[0] || null;
      else home = rooms.filter(function (room) { return knows(room, d.who || d.name); })[0] || null;
      if (!home) return;
      var done = RP.applyDirectives(state, home, [d.kind === 'mood' ? Object.assign({}, d, { set: true, byAudit: true }) : d]);
      done.lines.forEach(function (l) {
        out.byRoom[home.id].push(l); out.lines.push(l); out.count++;
        out.items.push({ index: index, roomId: home.id, line: l, kind: d.kind, who: d.who || d.name || '' });
      });
      if (d.kind === 'time' && rooms.length > 1) rooms.slice(1).forEach(function (room) { room.clock = home.clock; });
    });
    return out;
  };

  /** One background call spent, whoever spent it — the book and the
   *  quartermaster share the same session budget. */
  RP.spendBudget = function (state) {
    state.book = state.book || { entries: [], queue: [], spent: 0 };
    state.book.spent = (state.book.spent || 0) + 1;
  };

  /* ---- the doorman: arrivals and departures the prose forgot to file ----
     The model is told to use [[ENTER]] / [[NEW]] / [[EXIT]], but a small
     model will happily write "Brad pushes through the door" and move on —
     leaving Brad a ghost with no sheet whose lines get misfiled. These
     scans are deterministic, cost nothing, and are deliberately narrow:
     a never-seen name must ARRIVE on a strong verb or SPEAK an actual
     quoted line; a departure must be unambiguous ("leaves the knife on
     the table" is not leaving). */

  // Words that look like names at a sentence start but never are.
  var NOT_NAME = new RegExp('^(?:' + [
    'The', 'A', 'An', 'He', 'She', 'It', 'They', 'We', 'You', 'I',
    'Then', 'Now', 'But', 'And', 'So', 'Or', 'Yet', 'Still', 'Even', 'Just',
    'Meanwhile', 'Later', 'Suddenly', 'Finally', 'Eventually', 'Once',
    'Inside', 'Outside', 'Behind', 'Beyond', 'Above', 'Below', 'Between',
    'Across', 'Somewhere', 'Someone', 'Somebody', 'Nobody', 'Everyone',
    'Everybody', 'Nothing', 'Something', 'Anyone', 'Whoever',
    'Who', 'What', 'When', 'Where', 'Why', 'How',
    'Yes', 'No', 'Wait', 'Stop', 'Look', 'Listen', 'Okay', 'Oh', 'Ah', 'Hey', 'Well',
    'Narration', 'Narrator', 'World', 'Mike',   // rule zero: mike is a GM, never a character
    'Your', 'My', 'Our', 'Their', 'His', 'Her', 'Its',
    'This', 'That', 'These', 'Those', 'Each', 'Every', 'Any', 'Some', 'All', 'Both',
    'Other', 'Another', 'Several', 'Important', 'Warning', 'Reminder', 'System', 'Option', 'Choice',
  ].join('|') + ')\\b', 'i');

  // A menu is not a person. “**Your Options:**” above a numbered list once
  // walked into the cast with a full sheet and a seat on the speaker rail.
  var NOT_NAME_TAIL = /(?:Options?|Choices?|Notes?|Summary|Inventory|Objectives?|Actions?|Rules?|Stats?|Settings?)\s*$/i;

  var NAME_WORD = "[A-Z][a-zA-Z'\u2019-]+";
  var ARRIVE_RE = new RegExp(
    '\\b(' + NAME_WORD + '(?:\\s+' + NAME_WORD + ')?)\\s+' +
    '(?:enters|arrives|walks in\\b|steps in(?:side)?\\b|strides in\\b|bursts in\\b|' +
    'slips in(?:side)?\\b|storms in\\b|saunters in\\b|shuffles in\\b|' +
    'appears in the doorway|pushes through the door|' +
    '(?:walks|steps|strides|slips) into the (?:room|hall|bar|tavern|shop|camp|clearing|light|doorway)|' +
    'joins (?:you|the|them))', 'g');
  var SCRIPT_RE = new RegExp(
    '(?:^|\\n)\\s*(?:\\*\\*)?(' + NAME_WORD + '(?:\\s+' + NAME_WORD + ')?)(?:\\*\\*)?\\s*:\\s*["\u201c*A-Za-z]', 'g');
  var SPEAKS_RE = new RegExp(
    '\\b(' + NAME_WORD + '(?:\\s+' + NAME_WORD + ')?)\\s+' +
    '(?:says|asks|replies|answers|calls out|mutters|rasps|drawls|growls|shouts|whispers|cuts in|interrupts)\\s*,?\\s*["\u201c]', 'g');

  /** A brand-new name the prose brought on stage without filing it.
   *  `known` is every name already accounted for (cast, player, away).
   *  Returns one name, or ''. */
  RP.arrivalScan = function (text, known) {
    var have = (known || []).map(function (s) { return String(s).toLowerCase(); });
    var seen = function (name) {
      var low = name.toLowerCase();
      return have.some(function (k) {
        return k && (k.indexOf(low) >= 0 || low.indexOf(k) >= 0);
      });
    };
    var ok = function (name) {
      if (!name || name.length < 3 || NOT_NAME.test(name) || NOT_NAME_TAIL.test(name)) return false;
      return !seen(name);
    };
    var m; var res = '';
    ARRIVE_RE.lastIndex = 0;
    while ((m = ARRIVE_RE.exec(String(text || ''))) !== null) {
      if (ok(m[1])) { res = m[1]; break; }        // an arrival verb wins outright
    }
    if (!res) {
      var talkers = [SCRIPT_RE, SPEAKS_RE];
      for (var i = 0; i < talkers.length && !res; i++) {
        talkers[i].lastIndex = 0;
        while ((m = talkers[i].exec(String(text || ''))) !== null) {
          if (ok(m[1])) { res = m[1]; break; }    // a spoken line means they are here
        }
      }
    }
    return res;
  };

  /** Somebody present walked out in prose. `names` is who may leave
   *  (never the player). Returns one name, or ''. */
  RP.departureScan = function (text, names) {
    var body = String(text || '');
    var esc = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    for (var i = 0; i < (names || []).length; i++) {
      var name = String(names[i] || '');
      if (!name) continue;
      var re = new RegExp(esc(name) + "(?!['\u2019]s)[^.!?\\n]{0,40}?\\b(?:" +
        'walks out|storms (?:out|off)|slips (?:out|away)|hurries (?:out|off)|' +
        'marches out|steps out(?:side)?|is gone\\b|exits\\b|departs\\b|flees\\b|' +
        'vanishes\\b|disappears\\b|walks away|turns and leaves|' +
        'leaves(?=\\s*[.!?,;:]|\\s+the\\s+(?:room|scene|hall|building|bar|tavern|camp|clearing|shop|house|inn|chamber)\\b|\\s+without\\b|\\s+for\\s+the\\b)' +
        ')', 'i');
      if (re.test(body)) return name;
    }
    return '';
  };

  /* ---- audience mode: nobody freezes while two people talk ---- */

  /** Present, silent cast members stop being furniture. One prompt
   *  block inside the SAME call — no extra requests — licenses the room
   *  to react after the speaker's turn, each reaction as its OWN
   *  paragraph that begins "Name:". The page then cuts those paragraphs
   *  out (RP.splitChorus) and files each under the person who made it:
   *  its own card, its own mood, its own line in the history. Three
   *  settings: `on` is murmurs — one short beat; `full` lets up to two
   *  of them answer properly, two to four sentences each. Off by dial,
   *  absent in solo rooms, silent when only two are present (there is
   *  no audience in a duel). */
  RP.AUDIENCE = {
    off:  { name: 'Off', blurb: 'only the speaker and the narration exist' },
    on:   { name: 'Murmurs', blurb: 'one short beat from the room after the speaker, as its own card' },
    full: { name: 'Full replies', blurb: 'up to two of the room answer properly — two to four sentences each, their own cards' },
  };
  RP.AUDIENCE_DEFAULT = 'full';
  RP.audienceBlock = function (room, speakerId, setting) {
    if (setting === 'off' || !room || room.kind !== 'group') return '';
    var quiet = (room.cast || []).filter(function (c) {
      if (!c || c.id === speakerId || c.id === room.youPlay) return false;
      var sheet = room.states && room.states[c.id];
      return !(sheet && sheet.present === false);
    }).slice(0, 4);
    if (!quiet.length) return '';
    var speaker = (room.cast || []).filter(function (c) { return c && c.id === speakerId; })[0];
    var sname = speaker ? speaker.name : 'the speaker';
    var first = quiet[0].name;
    var full = setting === 'full';
    return 'THE AUDIENCE — also in the scene, not speaking this turn: ' +
      quiet.map(function (c) { return c.name; }).join(', ') + '.\n' +
      'They are people, not furniture. ' + (full
        ? 'After ' + sname + '\u2019s turn is finished, up to TWO of them MAY answer the moment properly \u2014 each as their OWN\n' +
          'paragraph, on a new line, beginning with their name and a colon (' + first + ': *what they do* \u201cwhat they say\u201d),\n' +
          'two to four sentences: an action and a line, in their own voice, to what JUST happened \u2014 not the spotlight,\n' +
          'not a speech, never the same beat they gave last time.'
        : 'You MAY end the turn with ONE short beat from one of them, as its OWN paragraph on a new line, beginning with\n' +
          'their name and a colon (' + first + ': *a glance* \u201ca muttered half-line\u201d) \u2014 a glance, a mutter, a shifted weight \u2014\n' +
          'a murmur, never a speech, never the spotlight.') +
      ' If the moment is\nprivate or the beat adds nothing, give them nothing: silence is a valid reaction. They make no decisions,\n' +
      'file no directives, and never answer a question that was aimed at somebody else.';
  };

  /** Cut the room's beats out of a reply. Only the TRAILING run of
   *  paragraphs that begin "Name:" (a present cast member who is not
   *  the speaker) is taken; a "Name:" in the middle of the prose is
   *  script formatting and is left alone, and a reply that is nothing
   *  but somebody else's lines is left whole for checkSpeaker.
   *  Returns { main, pieces: [{ name, text }], dropped: [names] } —
   *  `dropped` are beats written for somebody the model may not write
   *  (the player's character): cut, not filed. */
  /** A name as a key: "Mr. L", "MR L" and "mr.l" are one person. */
  RP.nameKey = function (name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  var NARRATOR_ALIASES = ['narrator', 'the narrator', 'narration', 'gm', 'dm', 'the director', 'director', 'the world', 'world', 'the scene'];
  // Labels that are not people: "Note:", "Meanwhile:", "OOC:", "Summary:".
  var NOT_A_NAME = /^(?:note|notes|warning|translation|meanwhile|later|elsewhere|ooc|aside|edit|ps|p\.s|summary|tl;dr|status|time|location|setting|scene|mood|hp|energy|mp|action|actions|dialogue|thought|thoughts|system|reply|response|answer|option|options|choice|choices|everyone|all|both)$/i;
  var LABEL_RE = /^\s*(?:[-*\u2022]\s+)?(?:\*\*|__|\*)?\s*\[?([A-Za-z][A-Za-z0-9.'\u2019 -]{0,40}?)\]?(?:\s*\([^)]{0,30}\))?\s*(?:\*\*|__|\*)?\s*[:\uff1a]\s*(?:\*\*|__)?\s*(.*)$/;
  /** The room's lines, cut out of a reply. A paragraph that begins
   *  "Name:" is somebody else's turn written inside the speaker's; it is
   *  lifted out and handed back as a piece, so the page can file it as
   *  that person's own card. The speaker's own name as a label is just a
   *  label \u2014 stripped, the text kept. A paragraph written for the
   *  player (`forbidden`) is dropped and reported. `opts.narrator` names
   *  the narration, so "Narrator:" paragraphs come back as kind 'narrator'.
   *  A capitalised label nobody knows comes back in `unknown` (and stays
   *  in the text, raw, for the reader to file). Names match loosely:
   *  "Mr. L", "MR L", "Mr.L" are one person; a first name alone will do
   *  when it is nobody else's.
   *  Returns { main, pieces: [{name, kind, text}], dropped, unknown }. */
  RP.splitChorus = function (text, speakerName, names, forbidden, opts) {
    opts = opts || {};
    var whole = String(text || '');
    var out = { main: whole, pieces: [], dropped: [], unknown: [] };
    if (whole.indexOf(':') < 0 && whole.indexOf('\uff1a') < 0) return out;
    var me = RP.nameKey(speakerName);
    var meFirst = RP.nameKey(String(speakerName || '').split(/\s+/)[0]);
    var table = {}, firsts = {};
    var add = function (n, kind) {
      var full = RP.nameKey(n);
      if (!full || full === me) return;
      if (!table[full]) table[full] = { name: n, kind: kind };
      var first = RP.nameKey(String(n).split(/\s+/)[0]);
      if (first && first !== full && first.length >= 3) (firsts[first] = firsts[first] || []).push({ name: n, kind: kind });
    };
    (names || []).filter(Boolean).forEach(function (n) { add(String(n), 'cast'); });
    (forbidden || []).filter(Boolean).forEach(function (n) { add(String(n), 'player'); });
    if (opts.narrator) {
      add(String(opts.narrator), 'narrator');
      NARRATOR_ALIASES.forEach(function (a) { var k = RP.nameKey(a); if (!table[k]) table[k] = { name: String(opts.narrator), kind: 'narrator' }; });
    }
    var lookup = function (label) {
      var k = RP.nameKey(label);
      if (!k) return null;
      if (me && (k === me || (meFirst.length >= 3 && k === meFirst))) return { name: speakerName, kind: 'self' };
      if (table[k]) return table[k];
      if (firsts[k] && firsts[k].length === 1) return firsts[k][0];
      return null;
    };
    var lead = function (line) {
      var m = LABEL_RE.exec(line);
      if (!m) return null;
      var label = m[1].trim();
      if (!label || NOT_A_NAME.test(label)) return null;
      var hit = lookup(label);
      if (hit) return { name: hit.name, kind: hit.kind, rest: m[2] };
      // A label nobody knows, that still looks like a person: capitalised, three words at most.
      if (/^[A-Z]/.test(label) && label.split(/\s+/).length <= 3 && /[a-z]/.test(label + 'x')) return { name: label, kind: 'unknown', rest: m[2] };
      return null;
    };
    // Blocks: a labelled line opens one and owns its paragraph \u2014 up to the
    // next blank line or the next label. Paragraphs after a blank line are
    // the speaker's again: the room is asked for one paragraph each.
    var lines = whole.split(/\n/);
    var blocks = [{ kind: 'main', name: speakerName, lines: [] }];
    var open = null;                                 // the labelled block still taking lines
    lines.forEach(function (line) {
      var led = line.trim() ? lead(line) : null;
      if (led) {
        open = { kind: led.kind, name: led.name, lines: led.rest ? [led.rest] : [] };
        blocks.push(open);
        return;
      }
      if (open && !line.trim()) { open = null; blocks.push({ kind: 'main', name: speakerName, lines: [] }); return; }
      (open || blocks[blocks.length - 1]).lines.push(line);
    });
    if (!blocks.some(function (b) { return b.kind !== 'main'; })) return out;
    var mainLines = [], pieces = [];
    blocks.forEach(function (b) {
      var body = b.lines.join('\n').trim();
      if (b.kind === 'main' || b.kind === 'self') {
        if (!body) return;
        if (mainLines.length) mainLines.push('');
        mainLines.push(body);
        return;
      }
      // A page of prose under one label is the speaker quoting a line,
      // not the room answering: kept where it was, label and all.
      var tooLong = body.length > 1400 || b.lines.filter(function (l) { return l.trim(); }).length > 10;
      if (b.kind === 'unknown' || tooLong || !body) {
        if (b.kind === 'unknown' && body && !tooLong) out.unknown.push({ name: b.name, text: body });
        if (mainLines.length) mainLines.push('');
        mainLines.push((b.name + ': ' + body).trim());
        return;
      }
      pieces.push({ name: b.name, kind: b.kind, text: body });
    });
    var main = mainLines.join('\n').trim();
    if (!pieces.length || !main) return out;          // nothing to cut, or nothing left for the speaker
    out.main = main;
    pieces.forEach(function (piece) {
      if (piece.kind === 'player') { out.dropped.push(piece.name); return; }
      out.pieces.push(piece);
    });
    return out;
  };

  /* ---- the same moment: several people act in the same seconds ----
   * The sequencer plays staged turns one after another, and each reads
   * the last as finished. When the reader picks several faces and asks
   * for the same moment, every turn in that group is told so: nothing
   * above has landed yet, write what you are doing DURING it. ---- */
  RP.momentBlock = function (room, speaker, moment) {
    if (!room || !speaker || !moment || !moment.same) return '';
    var name = speaker.name || 'the speaker';
    var done = (moment.done || []).filter(function (n) { return n && n !== name; });
    var pending = (moment.pending || []).filter(function (n) { return n && n !== name; });
    return 'THE SAME MOMENT \u2014 the player\u2019s last turn' +
      (done.length ? ', and ' + done.join(', ') + '\u2019s turn' + (done.length > 1 ? 's' : '') + ' just above,' : '') +
      (done.length ? ' happen' : ' happens') + ' AT THE SAME TIME as ' + name + '\u2019s turn \u2014 not before it. Nobody has finished; nothing above has landed or' +
      ' been answered yet. Write what ' + name + ' is doing DURING those seconds: their own action, cutting across the others,' +
      ' seeing theirs half-done' + (pending.length ? ' (' + pending.join(', ') + ' act in the same seconds too, written after you)' : '') +
      '. Do not narrate the outcome of anybody else\u2019s action, do not react to it as if it were over, and do not write their words.';
  };

  /* ---- the freshness ledger: a character who repeats is a character
   * nobody believes. Zero calls: the page reads the speaker's own last
   * turns for the phrases, the subject and the opening they keep
   * reaching for, and when there is something to name, ONE conditional
   * block names it. After the reply, repeatCheck scores the new turn
   * against the same turns; on the strict setting a stale take is sent
   * back once, like a take that wrote the player. ---- */
  RP.FRESH_TURNS = 12;
  RP.FRESH = {
    strict: { name: 'Strict', blurb: 'the ledger rides the prompt, and a turn that repeats is asked for again, once' },
    on:     { name: 'Guide',  blurb: 'the ledger rides the prompt; what comes back is kept' },
    off:    { name: 'Off',    blurb: 'the model is left to its habits' },
  };
  RP.FRESH_DEFAULT = 'strict';
  var FRESH_STOP = {};
  ('the a an and or but of to in on at for with from by as is are was were be been being it its he she they them his her hers ' +
   'their you your yours i me my mine we us our ours this that these those not no so if then than there here what which who whom ' +
   'do does did done have has had will would can could should may might must shall just very into out up down over under off ' +
   'about again still even only also too all any some such own same other more most much many back now when where why how am ' +
   'get got gets getting go goes going went gone come comes came say says said see sees saw seen let lets like one two yes well ' +
   'because before after while until once ever never always every each both few little less own around through across between ' +
   'against during without within toward towards upon onto behind beside above below him himself herself themselves itself ' +
   'something anything nothing everything someone anyone everyone right away make makes made take takes took know knows knew ' +
   'think thinks thought want wants look looks looked keep keeps kept put puts tell tells told give gives gave ask asks asked ' +
   'turn turns turned hand hands head eyes face voice back feet way thing things time')
    .split(' ').forEach(function (w) { FRESH_STOP[w] = true; });

  /** The words of a text, sentence by sentence, lowercased, with the
   *  stage directions and the colour marks taken out. */
  function freshSentences(text) {
    return String(text || '').toLowerCase()
      .replace(/(?:\[\[|\{\{)[^\]\}\n]*(?:\]\]|\}\}|\]\}|\}\])/g, ' ')
      .replace(/\{[a-z#][a-z0-9 ]{0,14}\|([^{}]*)\}/g, '$1')
      .replace(/[\u2019']/g, '')
      .split(/[.!?;:\u2014\n*\u201c\u201d"()]+/)
      .map(function (part) { return part.replace(/[^a-z0-9 -]+/g, ' ').split(/\s+/).filter(Boolean); })
      .filter(function (words) { return words.length; });
  }
  function freshWords(text) {
    return [].concat.apply([], freshSentences(text));
  }
  /** The n-word runs of a text that do not cross a sentence, skipping
   *  runs made only of stopwords and numbers. */
  function freshGrams(text, n) {
    var out = [];
    (Array.isArray(text) ? [text] : freshSentences(text)).forEach(function (words) {
      for (var i = 0; i + n <= words.length; i++) {
        var g = words.slice(i, i + n);
        if (g.every(function (w) { return FRESH_STOP[w] || /^\d+$/.test(w); })) continue;
        out.push(g.join(' '));
      }
    });
    return out;
  }

  /** What this character keeps saying, read off their own last turns:
   *  phrases (3- and 4-word runs used in two or more turns), subjects
   *  (a word in half their turns that nobody else in the scene uses),
   *  and an opening they have begun with three times or more. */
  RP.staleBits = function (room, charId, turns, skip) {
    var msgs = ((room && room.messages) || []).filter(function (m) { return visible(m) && !m.muted; });
    var mine = msgs.filter(function (m) { return m.role === 'char' && m.charId === charId; }).slice(-(turns || RP.FRESH_TURNS));
    var out = { phrases: [], themes: [], opener: '', turns: mine.length };
    if (mine.length < 2) return out;
    var skipWords = {};
    ((room && room.cast) || []).forEach(function (c) {
      String(c.name || '').toLowerCase().split(/\s+/).forEach(function (w) { if (w) skipWords[w] = true; });
    });
    (skip || []).forEach(function (w) { if (w) skipWords[String(w).toLowerCase()] = true; });
    // The scene's shared vocabulary — what the OTHERS also say — is the
    // scene's, not a tic: "helicopter" in a crash is not a repeat.
    var shared = {};
    msgs.slice(-24).forEach(function (m) {
      if (m.role === 'char' && m.charId === charId) return;
      var ws = {};
      freshWords(RP.textOf(m)).forEach(function (w) { if (!ws[w]) { ws[w] = true; shared[w] = (shared[w] || 0) + 1; } });
    });
    var count = {}, wordCount = {}, openers = {};
    mine.forEach(function (m) {
      var text = RP.textOf(m);
      var words = freshWords(text);
      var seen = {};
      [3, 4].forEach(function (n) {
        freshGrams(text, n).forEach(function (g) { if (!seen[g]) { seen[g] = true; count[g] = (count[g] || 0) + 1; } });
      });
      var ws = {};
      words.forEach(function (w) {
        if (w.length < 3 || FRESH_STOP[w] || skipWords[w] || /^\d+$/.test(w) || ws[w]) return;
        ws[w] = true; wordCount[w] = (wordCount[w] || 0) + 1;
      });
      var open = words.slice(0, 2).join(' ');
      if (open) openers[open] = (openers[open] || 0) + 1;
    });
    var phrases = Object.keys(count).filter(function (g) { return count[g] >= 2; })
      .sort(function (a, b) { return (count[b] - count[a]) || (b.length - a.length); });
    // Longest first, and no two that overlap: "for every coin string"
    // and "every coin string bean" are one habit, not two.
    var kept = [], pairs = {};
    phrases.forEach(function (g) {
      if (kept.length >= 6) return;
      var ws = g.split(' ');
      var mine = [];
      for (var i = 0; i + 2 <= ws.length; i++) mine.push(ws[i] + ' ' + ws[i + 1]);
      if (mine.some(function (pr) { return pairs[pr]; })) return;
      mine.forEach(function (pr) { pairs[pr] = true; });
      kept.push(g);
    });
    out.phrases = kept;
    var need = Math.max(3, Math.ceil(mine.length * 0.5));
    out.themes = Object.keys(wordCount).filter(function (w) { return wordCount[w] >= need && (shared[w] || 0) < 2; })
      .sort(function (a, b) { return wordCount[b] - wordCount[a]; }).slice(0, 5);
    var topOpen = Object.keys(openers).sort(function (a, b) { return openers[b] - openers[a]; })[0];
    if (topOpen && openers[topOpen] >= 3) out.opener = topOpen;
    return out;
  };

  /** The conditional block: nothing on a fresh character, a named list
   *  on a stale one. The voice sheet's own sounds are never on it —
   *  a catchphrase is a trait; the same threat four turns running is not. */
  RP.freshnessBlock = function (room, char, setting) {
    if (!room || !char || setting === 'off') return '';
    var skip = [];
    var sheet = RP.voiceSheet(char);
    if (sheet) {
      (sheet.sounds || []).join(' ').toLowerCase().split(/[^a-z]+/).forEach(function (w) { if (w.length >= 3) skip.push(w); });
    }
    var stale = RP.staleBits(room, char.id, RP.FRESH_TURNS, skip);
    if (!stale.phrases.length && !stale.themes.length && !stale.opener) return '';
    var lines = ['FRESH TURN \u2014 ' + char.name + ' has started repeating themselves, and a character who repeats is one nobody believes.' +
      ' Not to be used this turn, not even reworded:'];
    if (stale.phrases.length) lines.push('  \u2022 these phrases: ' + stale.phrases.map(function (p) { return '\u201c' + p + '\u201d'; }).join(', '));
    if (stale.themes.length) lines.push('  \u2022 this subject yet again: ' + stale.themes.join(', ') + ' \u2014 it has been said and the scene has heard it. Find what comes AFTER it.');
    if (stale.opener) lines.push('  \u2022 the opening \u201c' + stale.opener + '\u2026\u201d \u2014 the last turns all began that way. Begin somewhere else.');
    lines.push('Same person, same VOICE \u2014 but ONE move ' + char.name + ' has not made in this scene: a decision, a question that matters, an' +
      ' admission, a plan with a first step, a thing picked up and used, a change of position or of tactic. Answer the specific thing' +
      ' that just happened, not the situation in general, and end the turn with something changed \u2014 what they want, what they know,' +
      ' or where they stand.');
    return lines.join('\n');
  };

  /** Score a new turn against the same character's earlier ones: the
   *  distinct 3-word runs it shares with them. { count, ratio, hits,
   *  stale } — stale when a short turn leans on them or a long one is
   *  stitched out of them. */
  RP.repeatCheck = function (text, previous, opts) {
    opts = opts || {};
    var mine = {};
    freshGrams(text, 3).forEach(function (g) { mine[g] = true; });
    var seen = {};
    (previous || []).forEach(function (t) { freshGrams(t, 3).forEach(function (g) { seen[g] = true; }); });
    var hits = Object.keys(mine).filter(function (g) { return seen[g]; });
    var total = Object.keys(mine).length;
    var ratio = total ? hits.length / total : 0;
    var threshold = Number(opts.threshold) || 3;
    return {
      hits: hits.slice(0, 8), count: hits.length, ratio: Math.round(ratio * 1000) / 1000,
      stale: (hits.length >= threshold && ratio >= 0.08) || hits.length >= threshold * 3,
    };
  };

  /** The earlier turns a repeat check is made against. */
  RP.priorTurns = function (room, charId, turns) {
    return ((room && room.messages) || []).filter(function (m) {
      return visible(m) && !m.muted && m.role === 'char' && m.charId === charId;
    }).slice(-(turns || RP.FRESH_TURNS)).map(function (m) { return RP.textOf(m); });
  };

  /** Which of the passages read for a turn actually surfaced in it: a
   *  distinctive token of the passage — a capitalised word of five
   *  letters or more that is not a cast name, a year, a number — is in
   *  the prose. Returns their names. */
  RP.usedMaterial = function (text, hits, skip) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    if (!t.trim()) return [];
    var skipWords = {};
    (skip || []).forEach(function (w) {
      String(w || '').toLowerCase().split(/\s+/).forEach(function (x) { if (x) skipWords[x] = true; });
    });
    return (hits || []).filter(function (h) {
      var src = String((h && (h.snippet || h.text)) || '') + ' ' + String((h && h.name) || '');
      var tokens = (src.match(/\b(?:[A-Z][a-z]{4,}|\d{2,4})\b/g) || []).map(function (w) { return w.toLowerCase(); });
      return tokens.some(function (w) { return !FRESH_STOP[w] && !skipWords[w] && t.indexOf(' ' + w + ' ') >= 0; });
    }).map(function (h) { return h.name; });
  };

  /* ------------------------------------------------------------------ *
   * Anti-repetition & Anti-generic systems (zero-call, deterministic)
   * ------------------------------------------------------------------ */

  RP.ANTI_REPETITION = {
    strict:   { name: 'Strict',   blurb: 'bans loops, user-echoing & stale phrases; loops are cleaned, repeating turns retaken once' },
    standard: { name: 'Standard', blurb: 'anti-repetition directives ride the prompt; loops are cleaned; flags repeating turns' },
    off:      { name: 'Off',      blurb: 'no repetition checking or loop suppression' },
  };
  RP.ANTI_REPETITION_DEFAULT = 'strict';

  RP.ANTI_GENERIC = {
    strict: { name: 'Strict', blurb: 'bans stock AI RP clichés & generic mush; generic turns are retaken once with a grounding nudge' },
    guide:  { name: 'Guide',  blurb: 'anti-generic directives ride the prompt; flags generic clichés on cards' },
    off:    { name: 'Off',    blurb: 'no cliché or genericness checking' },
  };
  RP.ANTI_GENERIC_DEFAULT = 'strict';

  /** Split text into sentences safely while keeping trailing punctuation
   *  and quotes/asterisks attached to their sentence. */
  RP.splitSentences = function (text) {
    var raw = String(text || '').trim();
    if (!raw) return [];
    var parts = [];
    var cur = '';
    for (var i = 0; i < raw.length; i++) {
      cur += raw[i];
      if (/[.!?\n]/.test(raw[i])) {
        while (i + 1 < raw.length && /["'”*)]/.test(raw[i + 1])) {
          i++;
          cur += raw[i];
        }
        if (i + 1 >= raw.length || /\s/.test(raw[i + 1])) {
          parts.push(cur.trim());
          cur = '';
          while (i + 1 < raw.length && /\s/.test(raw[i + 1])) i++;
        }
      }
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  };

  /** Detects repetitive intra-message loops, such as duplicated sentences,
   *  stuttered phrases, or run-away phrase loops within the same reply. */
  RP.findRepetitionLoops = function (text) {
    var raw = String(text || '').trim();
    if (!raw) return { hasLoop: false, loops: [], count: 0 };
    var loops = [];
    var sents = RP.splitSentences(raw);
    for (var i = 0; i < sents.length; i++) {
      var s = sents[i].trim();
      var norm = s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (norm.length >= 10 && i > 0) {
        var prevNorm = sents[i - 1].trim().toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (norm === prevNorm && loops.indexOf(s) < 0) loops.push(s);
      }
    }
    var words = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length >= 10) {
      for (var n = 4; n <= 6; n++) {
        var gCount = {};
        for (var j = 0; j + n <= words.length; j++) {
          var gram = words.slice(j, j + n).join(' ');
          gCount[gram] = (gCount[gram] || 0) + 1;
        }
        Object.keys(gCount).forEach(function (g) {
          if (gCount[g] >= 3 && loops.indexOf(g) < 0) loops.push(g);
        });
      }
    }
    return { hasLoop: loops.length > 0, loops: loops.slice(0, 5), count: loops.length };
  };

  /** Cleans up consecutive identical sentences or run-away loop stutters
   *  from a reply so the reader doesn't see degeneration loops. */
  RP.cleanRepetitionLoops = function (text) {
    var raw = String(text || '');
    if (!raw.trim()) return raw;
    var sents = RP.splitSentences(raw);
    if (sents.length < 2) return raw;
    var deduped = [];
    var lastNorm = '';
    for (var i = 0; i < sents.length; i++) {
      var norm = sents[i].trim().toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (norm && norm.length >= 10 && norm === lastNorm) continue;
      deduped.push(sents[i]);
      if (norm && norm.length >= 10) lastNorm = norm;
    }
    return deduped.join(' ');
  };

  /** Detects when the model parrots or echoes the player's line or action
   *  back to them at the beginning of the reply. */
  RP.detectEcho = function (reply, userText) {
    var rep = String(reply || '').trim();
    var usr = String(userText || '').trim();
    if (!rep || !usr || usr.length < 12) return { hasEcho: false, hits: [] };
    var lead = rep.slice(0, 300).toLowerCase();
    var rawWords = usr.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
    var echoHits = [];
    for (var n = 4; n <= 7; n++) {
      for (var i = 0; i + n <= rawWords.length; i++) {
        var gram = rawWords.slice(i, i + n);
        if (gram.every(function (w) { return FRESH_STOP[w]; })) continue;
        var phrase = gram.join(' ');
        if (lead.indexOf(phrase) >= 0 && echoHits.indexOf(phrase) < 0) echoHits.push(phrase);
      }
    }
    var youEcho = /^(\*?[yY]ou\s+[^.!?\n]{8,120}[.!?])/i.exec(rep);
    if (youEcho) {
      var youWords = youEcho[1].toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
      var usrWords = rawWords.filter(function (w) { return w.length >= 3 && !FRESH_STOP[w]; });
      var matchCount = 0;
      youWords.forEach(function (w) { if (usrWords.indexOf(w) >= 0) matchCount++; });
      if (matchCount >= 2 && matchCount / Math.max(1, youWords.length) >= 0.35) {
        if (echoHits.indexOf(youEcho[1].trim()) < 0) echoHits.unshift(youEcho[1].trim());
      }
    }
    return { hasEcho: echoHits.length > 0, hits: echoHits.slice(0, 4) };
  };

  /** Score a new turn across intra-turn loops, user echo, and earlier turns. */
  RP.repetitionCheck = function (text, opts) {
    if (Array.isArray(opts)) opts = { prior: opts };
    opts = opts || {};
    var loop = RP.findRepetitionLoops(text);
    var echo = opts.userText ? RP.detectEcho(text, opts.userText) : { hasEcho: false, hits: [] };
    var prior = opts.prior || [];
    var priorRep = (prior.length >= 1) ? RP.repeatCheck(text, prior, opts) : { stale: false, hits: [], count: 0 };

    // Check cadence & structural formula loops:
    var formulaHits = [];
    if (prior.length >= 2) {
      var curOpener = (String(text).trim().match(/^[^\s,.;:!?]+(?:\s+[^\s,.;:!?]+)?/i) || [''])[0].toLowerCase();
      if (curOpener.length >= 3) {
        var priorOpeners = prior.map(function (p) {
          return (String(p).trim().match(/^[^\s,.;:!?]+(?:\s+[^\s,.;:!?]+)?/i) || [''])[0].toLowerCase();
        });
        if (priorOpeners.every(function (o) { return o === curOpener; })) {
          formulaHits.push('identical turn opener “' + curOpener + '”');
        }
      }
      var curActions = (String(text).match(/\*[^*]{4,60}\*/g) || []).map(function (a) { return a.toLowerCase().trim(); });
      var priorActions = prior.map(function (p) {
        return (String(p).match(/\*[^*]{4,60}\*/g) || []).map(function (a) { return a.toLowerCase().trim(); });
      });
      curActions.forEach(function (act) {
        if (priorActions.every(function (paList) { return paList.indexOf(act) >= 0; })) {
          formulaHits.push('repeated action beat ' + act);
        }
      });
    }

    var stale = loop.hasLoop || echo.hasEcho || priorRep.stale || formulaHits.length > 0 || (prior.length >= 2 && priorRep.hits.length >= 2);
    var allHits = [].concat(loop.loops, echo.hits, priorRep.hits, formulaHits);
    var summary = [];
    if (loop.hasLoop) summary.push('contained repetition loops (' + loop.loops.slice(0, 2).map(function (s) { return '“' + s + '”'; }).join(', ') + ')');
    if (echo.hasEcho) summary.push('echoed the player’s words (' + echo.hits.slice(0, 2).map(function (s) { return '“' + s + '”'; }).join(', ') + ')');
    if (formulaHits.length) summary.push('repeated structural formula (' + formulaHits.join(', ') + ')');
    if (priorRep.stale || (prior.length >= 2 && priorRep.hits.length >= 2)) {
      summary.push('repeated phrases from earlier turns (' + priorRep.hits.slice(0, 3).map(function (s) { return '“' + s + '”'; }).join(', ') + ')');
    }
    return {
      stale: stale,
      repeated: stale,
      reasons: summary,
      formulaHits: formulaHits,
      hasFormulaLoop: formulaHits.length > 0,
      hasLoop: loop.hasLoop,
      loopHits: loop.loops,
      hasEcho: echo.hasEcho,
      echoHits: echo.hits,
      hasStaleRepeat: priorRep.stale,
      staleHits: priorRep.hits,
      hits: allHits.slice(0, 6),
      summary: summary.join(' and ') || 'repeated earlier material',
    };
  };

  /** Is a strict-mode miss bad enough to throw the take away? A retake is a
   *  whole second generation, and the logs showed one after most turns: a
   *  small model opens with the same two words, or uses one stock phrase,
   *  nearly every time. Those are flagged on the card and steered by the
   *  prompt; only a turn that is really broken is written again. */
  RP.worthRetake = function (kind, check) {
    if (!check) return false;
    if (kind === 'repetition') {
      return Boolean(check.hasStaleRepeat || (check.loopHits || []).length >= 2 ||
        ((check.formulaHits || []).length >= 2 && (check.staleHits || []).length >= 1));
    }
    if (kind === 'generic') return Boolean(check.isGeneric && Number(check.score || 0) >= 0.75);
    return Boolean(check.stale);
  };

  /** Prompt directive for anti-repetition. */
  RP.antiRepetitionBlock = function (room, char, setting) {
    if (setting === 'off' || !room || !char) return '';
    var prior = RP.priorTurns(room, char.id, RP.FRESH_TURNS);
    if (prior.length < 2) return '';
    var rep = RP.repetitionCheck('', prior, room);
    if (!rep.repeated && setting !== 'strict') return '';
    var name = (char && char.name) ? char.name : 'the speaker';
    var lines = [
      'ANTI-REPETITION DIRECTIVE (' + (setting === 'strict' ? 'STRICT' : 'STANDARD') + '):',
      '\u2022 NEVER parrot or echo the player\u2019s line or actions back to them. Answer them; do not narrate what they just did.',
      '\u2022 NEVER repeat sentences, clauses, or phrase loops within this turn. Each sentence must deliver a new action, detail, or dialogue.',
      '\u2022 NEVER replay action beats, catchphrases, or gestures already used in recent turns.',
      '\u2022 Avoid formulaic character ruts: vary sentence length, pacing, emotional register, and tactics. Do not lean on a single gag.',
      '\u2022 Forward momentum only: every line must change something \u2014 a position, a possession, a fact revealed, or a decision made.',
    ];
    if (rep.repeated && rep.reasons.length) {
      lines.push('\u2022 DO NOT repeat recent patterns: ' + rep.reasons.join('; ') + '.');
    }
    return lines.join('\n');
  };

  /* ---- anti-generic system: catalogue of AI clichés & grounding check ----
     Two kinds. Prose slop is the stock phrasing every model reaches for —
     one is forgivable in a grounded turn, two is a turn written by nobody.
     Assistant tells (`hard`) are the chatbot leaking through the costume —
     offering help, naming itself, asking what you would like to do next —
     and one is enough. `tail` patterns are only ever an assistant's sign-off
     when they END the turn; RP.scrubSlop cuts those on the spot instead of
     paying for a retake. */

  RP.GENERIC_PATTERNS = [
    { id: 'smirk_lips', name: 'smirk played on lips', re: /\ba smirk (?:played|tugged|danced|crept|spread) (?:across|on|at|over) (?:[a-z]+ )?(?:lips|mouth|face)\b|\b(?:lips|mouth) (?:curl(?:ed|s|ing)?|quirk(?:ed|s|ing)?|twitch(?:ed|es|ing)?) (?:up )?into a (?:smirk|small smile|knowing smile)\b/i },
    { id: 'eyes_narrowed', name: 'eyes narrowed in/with', re: /\beyes narrowed (?:with|in|slightly)\b/i },
    { id: 'eyes_glint', name: 'eyes glinting with mischief', re: /\beyes (?:glint(?:ed|ing|s)?|gleam(?:ed|ing|s)?|sparkl(?:ed|ing|es?)|twinkl(?:ed|ing|es?)|danc(?:ed|ing|es?)|shin(?:e|es|ing)|flash(?:ed|ing|es)?) with (?:mischief|amusement|curiosity|determination|something|mirth|glee)\b/i },
    { id: 'glint_of', name: 'a glint/flicker of something', re: /\ba (?:mischievous |playful |predatory |dangerous )?(?:glint|twinkle|glimmer|flicker|spark) of (?:mischief|amusement|something|recognition|determination|mirth|understanding)\b/i },
    { id: 'chill_spine', name: 'chill down spine', re: /\b(?:chill|shiver)s?\b[^.!?\n]{0,30}\bdown (?:[a-z]+ )?spine\b/i },
    { id: 'tension_palpable', name: 'tension was palpable', re: /\btension (?:in the (?:air|room) )?(?:was|is) palpable\b/i },
    { id: 'tension_thick', name: 'tension hung thick/heavy', re: /\btension (?:hung|hung thick|hung heavy) in the air\b|\bthe air (?:was|is|grew|hung) (?:thick|heavy|charged|electric) with\b/i },
    { id: 'hung_in_air', name: 'words hung in the air', re: /\b(?:words|question|silence|threat|accusation) (?:hung|hangs|hanging|lingered|lingers) (?:heavy )?in the air\b/i },
    { id: 'whisper', name: 'barely above a whisper', re: /\bbarely above a whisper\b/i },
    { id: 'voice_laced', name: 'voice dripping/laced with', re: /\bvoice (?:dripping|laced|thick|heavy|tinged) with\b/i },
    { id: 'mix_of', name: 'a mix of X and Y', re: /\ba (?:mix|mixture|blend|cocktail) of [a-z]+ and [a-z]+\b/i },
    { id: 'something_shifted', name: 'something shifted', re: /\bsomething (?:shifted|changed|flickered|stirred) (?:in|between|behind)\b/i },
    { id: 'weight_of', name: 'the weight of the words', re: /\bthe weight of (?:his|her|their|my|your|the|those|these) (?:words|gaze|stare|decision|silence|confession|admission)\b/i },
    { id: 'little_did_know', name: 'little did they know', re: /\blittle did (?:he|she|they|anyone|we|i) know\b/i },
    { id: 'testament_to', name: 'a testament to', re: /\ba testament to\b/i },
    { id: 'tapestry', name: 'a tapestry of', re: /\b(?:rich |vibrant |intricate |complex )?tapestry of\b/i },
    { id: 'delve', name: 'delve into', re: /\bdelv(?:e|es|ed|ing) (?:into|deeper)\b/i },
    { id: 'unspoken_agreement', name: 'unspoken agreement/understanding', re: /\b(?:an )?unspoken (?:agreement|understanding|bond|promise)\b/i },
    { id: 'nodded_agreement', name: 'nodded in agreement', re: /\bnodded (?:slowly |solemnly )?in agreement\b/i },
    { id: 'shared_glance', name: 'shared a glance/look', re: /\bshared a (?:knowing )?(?:glance|look)\b/i },
    { id: 'only_time_will_tell', name: 'only time will tell', re: /\bonly time will tell\b/i },
    { id: 'couldnt_help_but', name: 'couldnt help but feel/wonder', re: /\bcouldn'?t help but (?:feel|wonder|smile|notice|admire)\b/i },
    { id: 'maybe_just_maybe', name: 'maybe, just maybe', re: /\bmaybe,? just maybe\b/i },
    { id: 'ghost_smile', name: 'the ghost of a smile', re: /\b(?:the|a) ghost of a (?:smile|grin|smirk|laugh)\b/i },
    { id: 'wave_of', name: 'a wave of relief/emotion', re: /\ba (?:wave|surge|flood|rush) of (?:relief|emotion|emotions|exhaustion|warmth|panic|nausea|guilt)\b/i },
    { id: 'fiber_being', name: 'every fibre of their being', re: /\bevery fib(?:er|re) of (?:his|her|their|my|your) being\b/i },
    { id: 'practiced_ease', name: 'with practiced ease', re: /\bwith (?:practiced|practised|effortless|fluid) ease\b/i },
    { id: 'world_fell_away', name: 'the world fell away', re: /\bthe (?:world|room) (?:seemed to )?(?:narrowed|narrows|fell away|falls away|faded away|stood still|held its breath)\b/i },
    { id: 'stark_contrast', name: 'in stark contrast', re: /\bin stark contrast\b/i },
    { id: 'ozone', name: 'the smell of ozone', re: /\b(?:scent|smell|tang|taste)s? of ozone\b/i },
    { id: 'orbs', name: 'eyes as orbs', re: /\b(?:emerald|sapphire|azure|cerulean|amber|crimson|obsidian) orbs\b/i },
    { id: 'not_x_but_y', name: 'it is not X, it is Y', re: /\b(?:it'?s|this is|that'?s|this isn'?t|it isn'?t) not (?:just |merely |simply |about )?[^.!?,;\n]{1,40}[,;—–-]+\s*(?:it'?s|this is|that'?s)\b/i },
    { id: 'dance_of', name: 'dance of shadows/blades', re: /\ba dance of (?:shadows|blades|fire|death)\b/i },
    { id: 'force_to_reckon', name: 'force to be reckoned with', re: /\ba force to be reckoned with\b/i },
    { id: 'calm_before_storm', name: 'calm before the storm', re: /\bthe calm before the storm\b/i },
    { id: 'pregnant_pause', name: 'pregnant pause', re: /\ba pregnant pause\b/i },
    { id: 'silence_stretched', name: 'silence stretched', re: /\bsilence stretched (?:between them|on|out)\b/i },
    { id: 'breath_holding', name: 'breath they didnt realize they held', re: /\bbreath (?:he|she|they|i) (?:didn'?t|did not|hadn'?t|had not) (?:realize|realise|know|noticed?) (?:he|she|they|i) (?:was|were|had been) holding\b/i },
    { id: 'time_seemed_to', name: 'time seemed to freeze/stop', re: /\btime seemed to (?:stop|freeze|slow down|stand still)\b/i },
    { id: 'steeling_self', name: 'steeling himself/herself', re: /\bsteel(?:ing|ed|s) (?:himself|herself|themselves|myself)\b/i },
    { id: 'no_time_to_lose', name: 'no time to lose/waste', re: /\b(?:we have|there is|there'?s) no time to (?:lose|waste)\b/i },
    { id: 'not_so_different', name: 'were not so different', re: /\bwe'?re not so different(?:, you and i)?\b/i },
    { id: 'shall_we_begin', name: 'shall we begin', re: /\bshall we begin\??\b/i },
    { id: 'you_speak_truth', name: 'you speak the truth', re: /\byou speak the truth\b/i },
    { id: 'in_this_moment', name: 'in this moment all/everything', re: /\bin this moment,?\s+(?:everything|all|nothing)\b/i },
    { id: 'whirlwind_emotion', name: 'whirlwind of emotions', re: /\ba whirlwind of emotions?\b/i },
    { id: 'hope_curdling', name: 'hope curdling/the tally', re: /\b(?:hope curdling|the tally of|darkness calls|shadows beckon)\b/i },
    { id: 'heart_pounded_chest', name: 'heart pounded in chest', re: /\bheart (?:pounded|hammered|raced) (?:heavily )?(?:in |against )?(?:his|her|their|my)?\s*(?:chest|ribcage)\b/i },
    { id: 'knuckles_white', name: 'knuckles turning white', re: /\bknuckles (?:turning |going |turned |went )?white\b/i },

    // Assistant tells: the chatbot under the costume. One is enough.
    { id: 'as_an_ai', name: 'as an AI', hard: true, re: /\bas an? (?:ai|a\.i\.|language model|assistant|chatbot)\b|\bI(?:'m| am) (?:just )?(?:an? )?(?:ai|language model|assistant|chatbot)\b/i },
    { id: 'here_to_help', name: 'here to help', hard: true, re: /\b(?:I'?m|I am) (?:always )?(?:here|happy|glad) to (?:help|assist)\b|\bhow (?:can|may) I (?:help|assist) you\b/i },
    { id: 'hope_helps', name: 'I hope this helps', hard: true, re: /\bI hope (?:this|that) helps\b|\bis there anything else (?:I can|you(?:'d| would) like)\b/i },
    { id: 'great_question', name: 'great question', hard: true, re: /\b(?:great|good|excellent) question\b(?!\s+(?:for|to))/i },
    { id: 'certainly_opener', name: 'Certainly! opener', hard: true, re: /^\s*(?:\*[^*\n]{0,80}\*\s*)?["“]?certainly[!,.]/i },
    { id: 'feel_free', name: 'feel free to / let me know', hard: true, tail: true, re: /(?:^|[.!?…*"”]\s+)[^.!?\n]{0,40}\b(?:feel free to (?:ask|reach out|let me know|share|continue|tell me)|let me know if (?:you(?:'d| would)? (?:like|want|need) (?:anything|more|help|me to)|there(?:'s| is) anything))\b[^.!?\n]*[.!?]?["”*]*\s*$/i },
    { id: 'what_next', name: 'what would you like to do next', hard: true, tail: true, re: /(?:^|[.!?…*"”]\s+)["“*]?(?:so,? )?(?:what (?:would|do) you (?:like to |want to |wish to )do (?:next|now)?|how (?:would|do) you (?:like to |want to |wish to )?(?:proceed|respond|continue)|the choice is (?:yours|now yours)(?: to make)?|the (?:next move|decision) is yours)[.?!]*["”*]*\s*$/i },
  ];

  /** Cut the assistant's sign-off from the end of a turn — "What would you
   *  like to do next?", "Feel free to…" — which no character ever says and
   *  which costs nothing to remove. Only the LAST sentence is touched, and
   *  only when something is left after it. Returns { text, cut: [names] }. */
  RP.scrubSlop = function (text) {
    var out = String(text || '');
    var cut = [];
    for (var pass = 0; pass < 2; pass++) {
      var hit = null;
      RP.GENERIC_PATTERNS.forEach(function (pat) {
        if (hit || !pat.tail) return;
        var m = pat.re.exec(out);
        if (m) hit = { pat: pat, at: m.index + (m[0].length - m[0].replace(/^(?:[.!?…*"”]\s+)/, '').length) };
      });
      if (!hit) break;
      var kept = out.slice(0, hit.at).replace(/\s+$/, '');
      if (kept.replace(/[\s*"“”]/g, '').length < 12) break;
      // An action left open by the cut — "*leans back*  What will you do?"
      // was fine; "*leans back. What will you do?*" needs its asterisk.
      if ((kept.match(/\*/g) || []).length % 2) kept += '*';
      out = kept;
      cut.push(hit.pat.name);
    }
    return { text: out, cut: cut };
  };

  /** Check if a text leans on stock AI clichés or lacks tangible grounding. */
  RP.genericCheck = function (text, opts) {
    opts = opts || {};
    var raw = String(text || '').trim();
    if (!raw) return { isGeneric: false, score: 0, cliches: [], hard: [], count: 0, hasGrounding: false, reasons: [] };
    var matched = [];
    var hard = [];
    RP.GENERIC_PATTERNS.forEach(function (pat) {
      if (!pat.re.test(raw)) return;
      matched.push(pat.name);
      if (pat.hard) hard.push(pat.name);
    });
    var CONCRETE_WORDS = /\b(?:coin|coins|gold|ledger|key|keys|lock|door|table|chair|hat|boots|knife|blade|gun|cannon|wrench|pipe|garlic|salt|coffee|bottle|glass|iron|steel|blood|mud|wall|floor|pocket|invoice|badge|ticket|wire|card|helmet|shield|potion|rope|bag)\b/i;
    var hasConcrete = CONCRETE_WORDS.test(raw);
    var hasDialogue = /"[^"]{2,}"|“[^”]{2,}”/.test(raw);
    var hasNumbers = /\b\d+\b/.test(raw);
    var hasGrounding = hasConcrete || hasNumbers || hasDialogue;

    var reasons = [];
    if (hard.length) reasons.push('broke character like a chatbot: ' + hard.slice(0, 2).join(', '));
    if (matched.length > hard.length) reasons.push('used stock AI clichés: ' + matched.filter(function (n) { return hard.indexOf(n) < 0; }).slice(0, 3).join(', '));
    if (!hasGrounding && raw.length >= 180) reasons.push('lacks concrete physical items, dialogue, or numbers');

    var soft = matched.length - hard.length;
    // One stock phrase in a turn that is otherwise about real things is
    // forgiven; a retake is a whole generation on a local model.
    var isGeneric = hard.length >= 1 || soft >= 2 || (soft >= 1 && !hasGrounding);
    var score = Math.min(1, Math.round((soft * 0.35 + hard.length * 0.6 + (hasGrounding ? 0 : 0.4)) * 100) / 100);
    return {
      isGeneric: isGeneric,
      score: score,
      cliches: matched,
      hard: hard,
      count: matched.length,
      hasGrounding: hasGrounding,
      reasons: reasons,
    };
  };

  /** Prompt directive for anti-generic grounding. Strict rides from the
   *  first turn — the opening line is where a model is most generic. It
   *  names no other character: an example voice ("Wario haggles") in
   *  everybody's prompt is how everybody starts haggling. */
  RP.antiGenericBlock = function (room, char, setting) {
    if (setting === 'off' || !room || !char) return '';
    var prior = RP.priorTurns(room, char.id, RP.FRESH_TURNS);
    var gen = prior.length ? RP.genericCheck(prior[prior.length - 1]) : { isGeneric: false, cliches: [] };
    if (setting !== 'strict' && (prior.length < 2 || !gen.isGeneric)) return '';
    var name = (char && char.name) ? char.name : 'the speaker';
    var lines = [
      'WRITE LIKE A PERSON, NOT A CHATBOT:',
      '• Plain verbs, concrete nouns, things that are actually in this scene. Fragments are fine. Contractions are fine.',
      '• No stock phrasing — smirks playing on lips, shivers down spines, eyes glinting with mischief, voices barely above a whisper,',
      '  air thick with tension, waves of relief, “a testament to”, “a mix of X and Y”, “it’s not X, it’s Y”.',
      '• No assistant habits: never offer help, never ask what the user would like to do next, never sum up the moment or explain the subtext.',
      '• Small, specific physical beats (*thumbs the dent in the coin*), not emotional weather (*a wave of relief washes over him*).',
      '• If a line could come out of anybody in any story, it is wrong. Say what ' + name + ' would say: their words from VOICE, their grudges, their things.',
    ];
    if (gen.isGeneric && gen.cliches.length) {
      lines.push('• Already used, do not reach for again: ' + gen.cliches.slice(0, 3).map(function (c) { return '“' + c + '”'; }).join(', ') + '.');
    }
    return lines.join('\n');
  };

  /* ---- turn flags: the ♻ 🔁 🎭 chips, one set per take ---- */

  /** What the checks found in one take of message `index`, measured
   *  against the speaker's turns BEFORE it — so a second take is never
   *  marked as repeating the first. `modes` is { fresh, antiRepetition,
   *  antiGeneric }; an 'off' check reports nothing. */
  RP.turnFlags = function (room, index, text, charId, modes) {
    modes = modes || {};
    var before = { messages: ((room && room.messages) || []).slice(0, index) };
    var prior = RP.priorTurns(before, charId, RP.FRESH_TURNS);
    var out = {};
    if (modes.fresh !== 'off' && prior.length >= 2) {
      var rep = RP.repeatCheck(text, prior);
      if (rep.stale) out.repeats = rep.hits.slice(0, 3);
    }
    if (modes.antiRepetition !== 'off' && prior.length >= 1) {
      var cad = RP.repetitionCheck(text, prior);
      if (cad.repeated) {
        out.antiRepeat = cad.reasons.slice(0, 2);
        out.antiRepeatHits = cad.hits.slice(0, 4);
      }
    }
    if (modes.antiGeneric !== 'off') {
      var gen = RP.genericCheck(text);
      if (gen.isGeneric) out.generic = gen.cliches.slice(0, 3);
    }
    return out;
  };

  /** The flags for the take on screen. Old chats kept one set on the
   *  message itself, true only of the first take. */
  RP.flagsOf = function (m) {
    if (!m) return {};
    var alt = m.alt || 0;
    if (m.flags && m.flags[alt]) return m.flags[alt];
    if (alt === 0 && !m.flags) return { repeats: m.repeats, antiRepeat: m.antiRepeat, generic: m.generic };
    return {};
  };

  /** The order for a take asked for from a chip: name exactly what to
   *  leave out, then let the character speak. */
  RP.fixNudge = function (flags, name) {
    flags = flags || {};
    name = name || 'the character';
    var phrases = [].concat(flags.repeats || [], flags.antiRepeatHits || []).filter(function (p, i, all) {
      return p && all.indexOf(p) === i;
    }).slice(0, 6);
    var lines = ['THIS TAKE IS A REWRITE. The last take of this turn was rejected:'];
    if (phrases.length) {
      lines.push('\u2022 It reused ' + name + '\u2019s own earlier material: ' + phrases.map(function (p) { return '\u201c' + p + '\u201d'; }).join(', ') +
        '. None of those words, none of their rewordings.');
    }
    if ((flags.antiRepeat || []).length && !phrases.length) lines.push('\u2022 It fell into a pattern: ' + flags.antiRepeat.join('; ') + '.');
    if ((flags.generic || []).length) {
      lines.push('\u2022 It used stock phrasing: ' + flags.generic.map(function (p) { return '\u201c' + p + '\u201d'; }).join(', ') + '.');
    }
    lines.push('Write the turn again with a different opening, a different move, and something changed by the end. Same person, same voice.');
    return lines.join('\n');
  };

  /* ---- physical possession & handover tracking (continuity) ---- */

  /** Scan prose for items being handed over or taken between characters. */
  RP.handoverScan = function (text, room) {
    if (!text || !room) return [];
    var cast = Array.isArray(room) ? room : (room.cast || []);
    if (!cast.length) return [];
    var lines = [];
    var raw = String(text || '');
    function findName(n) {
      var low = String(n || '').toLowerCase();
      for (var i = 0; i < cast.length; i++) {
        var clow = cast[i].name.toLowerCase();
        if (clow === low || clow.indexOf(low) >= 0 || low.indexOf(clow) >= 0) return cast[i];
      }
      return null;
    }
    var p1 = /\b([A-Z][a-z]+)[^.!?\n]{0,40}?\b(?:hands?|handed|gives?|gave|passes?|passed|tosses?|tossed|slides?|slid)\s+(?:the\s+|a\s+|an\s+)?([a-z0-9 -]{2,30}?)\s+(?:over\s+to|to)\s+([A-Z][a-z]+)\b/gi;
    var m;
    while ((m = p1.exec(raw))) {
      var giver = findName(m[1]);
      var receiver = findName(m[3]);
      var item = m[2].trim();
      if (giver && receiver && (giver.id || giver.name) !== (receiver.id || receiver.name) && item) {
        lines.push({ giver: giver.name || giver, receiver: receiver.name || receiver, item: item });
      }
    }
    var p2 = /\b([A-Z][a-z]+)[^.!?\n]{0,40}?\b(?:takes?|took|grabs?|grabbed|snatches?|snatched|accepts?|accepted)\s+(?:the\s+|a\s+|an\s+)?([a-z0-9 -]{2,30}?)\s+from\s+([A-Z][a-z]+)\b/gi;
    while ((m = p2.exec(raw))) {
      var receiver2 = findName(m[1]);
      var giver2 = findName(m[3]);
      var item2 = m[2].trim();
      if (giver2 && receiver2 && (giver2.id || giver2.name) !== (receiver2.id || receiver2.name) && item2) {
        lines.push({ giver: giver2.name || giver2, receiver: receiver2.name || receiver2, item: item2 });
      }
    }
    return lines;
  };

  /* ---- dynamic scene description parsing (new NPCs + archive cast) ---- */

  /** Parse a freeform scene description to match archive cast and extract
   *  dynamically described NPCs on the spot. */
  RP.parseSceneDescription = function (text, archive, castById) {
    text = String(text || '').trim();
    if (!text) return { scene: '', cast: [], newChars: [] };
    var matched = RP.matchArchive(text, archive || {}, castById || {});
    var cast = (matched.chars || []).slice(0, 6);
    var seenNames = {};
    cast.forEach(function (c) { seenNames[c.name.toLowerCase()] = true; });

    var newChars = [];
    var npcPatterns = [
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,\s*(?:a|an)\s+([^,.;\n]{4,80})/g,
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*\((?:a|an)?\s*([^)\n]{4,80})\)/g,
      /\b(?:a|an)\s+([a-zA-Z-]+(?:\s+[a-zA-Z-]+){0,2}\s+(?:guard|sentry|clerk|merchant|scout|assassin|priest|thief|knight|stranger|soldier|bystander|officer|commander|waiter|bartender|captain|doctor|monk|cultist|spy|witness))\b/gi,
      /\b(?:a|an)\s+([a-z-]+(?:\s+[a-z-]+){1,3})\s+(?:guarding|watching|standing|blocking|threatening|waiting|lurking)\b/gi,
      /\b(?:named|calls himself|calling herself|named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    ];
    npcPatterns.forEach(function (re) {
      var m;
      while ((m = re.exec(text))) {
        var rawName = (m[1] || '').trim();
        var rawRole = (m[2] || m[1] || m[0]).trim();
        var low = rawName.toLowerCase();
        if (!rawName || seenNames[low] || low === 'the' || low === 'this' || low === 'that' || low === 'someone' || low === 'anyone') continue;
        if (castById && (castById[low] || castById[rawName])) continue;
        seenNames[low] = true;
        var titleName = rawName.split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
        newChars.push({
          name: titleName,
          role: rawRole,
          look: 'Seen in the scene: ' + rawRole,
        });
      }
    });

    return {
      scene: text,
      cast: cast,
      newChars: newChars,
      factions: matched.factions || [],
      events: matched.events || [],
    };
  };

  /* ---- the encouragement system: data-driven, one line, zero calls ---- */

  /** The model has tools it never reaches for unprompted. The page knows
   *  exactly which ones have fired (applyDirectives stamps room.toolAt),
   *  so when a tool has sat unused past its threshold, ONE line rides in
   *  the prompt — conditional, ignorable, and it self-silences the
   *  moment the model complies. Never more than one line; never again
   *  within eight turns of the same nudge; never in mechanics-off rooms. */
  RP.ENCOURAGE_AFTER = { stakes: 18, mood: 14, remember: 24 };
  RP.encourage = function (room) {
    if (!room || room.mechanics === 'off') return '';
    var turns = ((room || {}).messages || []).length;
    if (turns < 12) return '';
    var at = room.toolAt || {};
    var nudged = room.nudgedAt = room.nudgedAt || {};
    var lines = {
      stakes: 'DIRECTOR\u2019S NOTE: nothing has cost anyone anything for a long stretch. If this scene has stakes,' +
        ' let the record show them \u2014 a [[COND:]], an [[HP:]], a price. If it truly is a quiet scene, carry on.',
      mood: 'DIRECTOR\u2019S NOTE: nobody\u2019s feelings have moved on the record for a long stretch. If this scene' +
        ' has touched anyone, file one [[MOOD: Name feeling 2 | why]] \u2014 the page lets it build and fade.',
      remember: 'DIRECTOR\u2019S NOTE: a long stretch with nothing filed to the lore book. If this scene settled a' +
        ' fact worth keeping, file one [[REMEMBER: name | the fact]].',
    };
    var order = ['stakes', 'mood', 'remember'];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      if (turns - (at[k] || 0) < RP.ENCOURAGE_AFTER[k]) continue;
      if (turns - (nudged[k] || -99) < 8) continue;    // do not nag
      nudged[k] = turns;
      return lines[k];
    }
    return '';
  };

  /* ---- the flourish: one coloured phrase on the turns that matter ----
   * "You may colour" is read by a small model as "need not", so on a
   * triumph or a failure ONE weighty phrase is ordered in colour, in a
   * palette matched to the moment. No schedule any more: the box carries
   * the mood every turn; the words get colour when the dice say so. */
  var FLOURISH_PALETTE = { triumph: 'gold or amber', setback: 'blood or rust' };

  /** Did the model colour anything by itself in the last few turns? Then
   *  it has the habit and is left alone. */
  RP.recentlyColoured = function (room, turns) {
    var recent = ((room && room.messages) || []).filter(visible).slice(-(turns || 3));
    return recent.some(function (m) { return m.role !== 'user' && /\{[a-z#][a-z0-9 ]{1,14}\|[^{}]{1,300}\}/i.test(RP.textOf(m)); });
  };

  RP.flourishBlock = function (room, fate) {
    if (!room || !fate || !FLOURISH_PALETTE[fate.key]) return '';
    if (RP.recentlyColoured(room)) return '';
    return 'COLOUR, THIS TURN \u2014 write exactly ONE phrase of this turn in colour, inside the prose, as {colour|the words}: ' +
      'the thing that carries the most weight \u2014 a wound, a relic, a look, a word spoken low \u2014 two to five words, once. ' +
      'Suggested: ' + FLOURISH_PALETTE[fate.key] + '.';
  };

  /* ---- stage directions: how the model changes the world ---- */

  RP.DIRECTIVES = [
    'STAGE DIRECTIONS — you may change the scene, not just describe it',
    'Put any of these on their own line, after your prose. They are stripped out before the reader sees them,',
    'and the page applies them to the actual record. Use them when the fiction earns them — never more than four',
    'in one turn, and never for something that did not happen in the turn you just wrote.',
    '  [[HP: Name -12]]                 damage, healing (+), or an exact value (= 30)',
    '  [[EN: Name -5]]                  Energy spent (a sprint, a climb, a long fight, a spell) or recovered (+). It refills slowly;',
    '      at 0 they are SPENT: no running, no magic, no big swings until they have had a breather.',
    '  [[COND: Name bleeding 3 -2hp | a deep cut across the palm]]  a condition: how many turns it lasts (leave',
    '      the number off if it does not pass on its own), what it costs each turn (-2hp, -1en — optional), and',
    '      what it actually is. [[CURE: Name bleeding]] ends it.',
    '  [[COUNT: Name arrows -1]]        any counter you need',
    '  [[ITEM: Name + 🗝 the brass key | bent, from the ledger room]]  gained, with an emoji and a note.',
    '      [[ITEM: Name - the brass key]] lost · [[EQUIP: Name brass key]] in hand · [[STOW: Name brass key]] away',
    '  [[USE: Name the brass key]]      spend or use one. Only ever use something that is on their sheet.',
    '  [[STATUS: Name bleeding, one arm]]  a short physical note',
    '  [[MOOD: Name anger 2 | why]]     how they feel now — anger, fear, joy, grief, shame, disgust, surprise,',
    '      affection, suspicion, pride, or calm — and how much: 1 a flicker, 2 the plain thing, 3 overwhelming.',
    '      File it when THIS turn moved somebody\u2019s feeling; the page lets a feeling build over turns and fade on',
    '      its own, so file what the scene did, not decoration. Never the player\u2019s mood — that is theirs.',
    '  [[LOOKUP: what you want to know]]  search the archive mid-turn. The page finds the passage and hands it',
    '      back, then you write the turn again using it. Use it when you need a fact you do not have — a date, a',
    '      name, what a filing actually says — instead of inventing one. Never LOOKUP the scene you are standing',
    '      in: the sheets, the scene and the record above already answer that.',
    '  [[REMEMBER: name | the fact]]     file something into the lore book so it is to hand in every later scene.',
    '  [[ENTER: Name — why they arrive]]   bring someone into the scene when the story calls for them',
    '  [[NEW: Name | what they are here for | what they look like]]  invent someone the archive has never filed.',
    '      Nobody has drawn them, so the description is the portrait: face, build, clothing, one memorable detail.',
    '  [[EXIT: Name — why they leave]]     write someone out when they leave, fall, or flee',
    'Only use ENTER for people the archive knows, or a clearly named newcomer. Never ENTER or EXIT the player.',
    'The player\u2019s sheet answers to their name like anyone else\u2019s: [[HP: their name -4]], [[ITEM: their name',
    '+ 🪙 a cut purse]], [[COND: their name poisoned 4 -1hp | pale wine]] are all fair — deciding their words is not.',
  ].join('\n');

  // The brackets are read loosely on purpose. A local model closes
  // "[[MOOD: Wario fear 3 | the helicopter}}" with braces, or opens with
  // one bracket, or mixes the two \u2014 and a direction that is not read
  // is a direction printed at the reader, raw, in the middle of the prose.
  // So: [[ {{ [{ {[ [ { open; ]] }} ]} }] ] } close; a body never spans a line.
  var DIRECTIVE_RE = /(?:\[\[|\{\{|\[\{|\{\[|\[|\{)\s*(HP|MP|EN|ENERGY|STAMINA|FLAG|COND|CURE|COUNT|ITEM|USE|EQUIP|STOW|STATUS|MOOD|TINT|UNTINT|ENTER|EXIT|NEW|SET|TIME|LOOKUP|REMEMBER)\s*:\s*([^\]\}\n]+?)\s*(?:\]\]|\}\}|\]\}|\}\]|\]|\})/gi;
  var BARE_DIRECTIVE_RE = /(?:^|\n)\s*(?:\[|\{)?\s*(HP|MP|EN|ENERGY|STAMINA|FLAG|COND|CURE|COUNT|ITEM|USE|EQUIP|STOW|STATUS|MOOD|TINT|UNTINT|ENTER|EXIT|NEW|SET|TIME|LOOKUP|REMEMBER)\s*:\s*([^\n]+?)\s*(?:\]|\})?(?=\n|$)/gi;
  // Anything else in double brackets is a directive the model invented. It
  // gets stripped rather than printed at the reader: "[[TIME: 23:00]]" in
  // the middle of the prose is a bug, not a feature.
  var STRAY_RE = /(?:\[\[|\{\{)[^\]\}\n]*(?:\]\]|\}\}|\]\}|\}\])/g;
  RP.STRAY_RE = STRAY_RE;
  RP.BARE_DIRECTIVE_RE = BARE_DIRECTIVE_RE;

  /** Split "Lord Darian Marsh bleeding badly" into a character and the rest.
   *  Names are matched longest-first against the people actually in the room,
   *  because a two-word regex cannot know that "Lord Darian Marsh" is one
   *  person and "Sans bleeding" is two things. */
  RP.splitTarget = function (body, names) {
    var text = String(body || '').trim();
    var best = '';
    (names || []).forEach(function (n) {
      var name = String(n || '').trim();
      if (!name || name.length <= best.length) return;
      if (text.toLowerCase().indexOf(name.toLowerCase()) === 0) best = name;
    });
    // Strip separators but never a leading minus that belongs to a number:
    // "Sans -12" is twelve damage, not a set-to-twelve.
    if (best) return { name: best, rest: text.slice(best.length).replace(/^[\s:,]+|^[—–]\s*/g, '') };
    var words = text.split(/\s+/);
    return { name: words[0] || '', rest: words.slice(1).join(' ') };
  };

  /** Pull the stage directions out of a reply. The reader sees `clean`; the
   *  page applies `directives`. Each one keeps its raw `body` so the names
   *  can be re-split against the real cast when it is applied. */
  RP.parseDirectives = function (text, names) {
    var out = [], match;
    function parseItem(type, body) {
      if (type === 'LOOKUP') {
        out.push({ kind: 'lookup', body: body, query: clip(body, 120) });
        return;
      }
      if (type === 'REMEMBER') {
        var split = body.split('|');
        out.push({
          kind: 'remember', body: body,
          name: clip(split[0], 80), value: clip(split.slice(1).join('|') || split[0], 400),
        });
        return;
      }
      if (type === 'TIME') {
        out.push({ kind: 'time', body: body, value: clip(body, 60) });
        return;
      }
      if (type === 'TINT' || type === 'UNTINT') {
        var eq = body.split(/\s*=\s*/);
        if (eq.length < 2 && type === 'TINT') eq = body.split(/\s*:\s*(?=[^:]*$)/);
        var words = String(type === 'UNTINT' ? body : eq[0]).split(',')
          .map(function (w) { return clip(w.trim(), 40); }).filter(Boolean).slice(0, 6);
        var colour = type === 'UNTINT' ? '' : RP.colourLoose(eq.slice(1).join('=').trim());
        if (words.length && (type === 'UNTINT' || colour)) {
          out.push({ kind: 'tint', body: body, names: words, colour: colour });
        }
        return;
      }
      if (type === 'SET') {
        var pair = /^([a-z][a-z ]{1,24}?)\s*[=:]\s*(.+)$/i.exec(body);
        if (pair) out.push({ kind: 'set', body: body, name: clip(pair[1], 24), value: clip(pair[2], 180) });
        return;
      }
      if (type === 'NEW') {
        var bits = body.split('|');
        var name = clip(bits[0], 60);
        if (name) {
          out.push({
            kind: 'new', body: body, name: name,
            role: clip(bits[1], 120), look: clip(bits.slice(2).join('|'), 300),
          });
        }
        return;
      }
      if (type === 'ENTER' || type === 'EXIT') {
        var split = body.split(/\s+[—–]\s+|\s+-\s+|\s*:\s*|\s*\(\s*/);
        out.push({ kind: type.toLowerCase(), body: body, name: clip(split[0], 60), reason: clip((split[1] || '').replace(/\)$/, ''), 140) });
        return;
      }
      var target = RP.splitTarget(body, names);
      var rest = target.rest;
      if (type === 'STATUS') {
        if (rest) out.push({ kind: 'status', body: body, who: target.name, value: rest });
        return;
      }
      if (type === 'MOOD') {
        var moodParts = rest.split('|');
        var moodHead = moodParts[0].trim();
        var moodLevel = /\s(\d)\s*(?:\/\s*3)?\s*$/.exec(moodHead);
        if (moodLevel) moodHead = moodHead.slice(0, moodLevel.index).trim();
        var feeling = RP.moodWord(moodHead);
        var moodWho = target.name;
        if (!feeling) {
          moodParts = body.split('|');
          moodHead = moodParts[0].trim();
          moodLevel = /\s(\d)\s*(?:\/\s*3)?\s*$/.exec(moodHead);
          if (moodLevel) moodHead = moodHead.slice(0, moodLevel.index).trim();
          feeling = RP.moodWord(moodHead);
          if (feeling) moodWho = '';
        }
        if (feeling) {
          out.push({
            kind: 'mood', body: body, who: moodWho, key: feeling.key,
            level: moodLevel ? Number(moodLevel[1]) : feeling.level,
            note: clip(moodParts.slice(1).join('|').trim(), 80),
          });
        }
        return;
      }
      if (type === 'HP' || type === 'MP' || type === 'EN' || type === 'ENERGY' || type === 'STAMINA') {
        var pool = /^([+\-=])?\s*(\d+)\s*(?:\/\s*(\d+))?\s*$/.exec(rest);
        if (pool) {
          var d = { kind: type === 'HP' ? 'hp' : 'mp', body: body, who: target.name, op: pool[1] || '=', value: Number(pool[2]) };
          if (pool[3]) { d.max = Number(pool[3]); d.op = '='; }
          out.push(d);
        }
        return;
      }
      if (type === 'COUNT') {
        var cnt = /^([a-z0-9_ ]+?)\s*([+\-=])\s*(\d+)\s*$/i.exec(rest);
        if (cnt) out.push({ kind: 'counter', body: body, who: target.name, name: clip(cnt[1], 40), op: cnt[2], value: Number(cnt[3]) });
        return;
      }
      if (type === 'ITEM') {
        var item = /^([+\-])\s*(.+)$/.exec(rest);
        if (item) {
          var carried = RP.normItem(item[2]);
          out.push({
            kind: 'item', body: body, who: target.name, op: item[1],
            name: carried.name, note: carried.note, icon: carried.icon,
          });
        }
        return;
      }
      if (type === 'USE') {
        out.push({ kind: 'use', body: body, who: target.name, name: clip(rest, 60) });
        return;
      }
      if (type === 'FLAG' || type === 'COND') {
        var parts = rest.split('|');
        var head = parts[0].trim();
        var effect = /\s([+-]\d{1,3}(?:hp|mp|en|energy|stamina))\s*$/i.exec(head);
        if (effect) head = head.slice(0, effect.index).trim();
        var turns = /\s(\d{1,2})\s*$/.exec(head);
        if (turns) head = head.slice(0, turns.index).trim();
        var flag = /^([a-z0-9_ '-]+?)(?:\s*=\s*(\S+))?\s*$/i.exec(head);
        if (flag) {
          out.push({
            kind: 'flag', body: body, who: target.name, name: clip(flag[1], 40),
            value: flag[2] === undefined ? true : flag[2],
            note: clip(parts.slice(1).join('|'), 160),
            turns: turns ? Number(turns[1]) : 0,
            effect: effect ? RP.normEffect(effect[1]) : '',
          });
        }
        return;
      }
      if (type === 'CURE') {
        out.push({ kind: 'flag', body: body, who: target.name, name: clip(rest, 40), value: false });
        return;
      }
      if (type === 'EQUIP' || type === 'STOW') {
        out.push({ kind: 'equip', body: body, who: target.name, name: clip(rest, 60), op: type === 'STOW' ? '-' : '+' });
        return;
      }
    }
    DIRECTIVE_RE.lastIndex = 0;
    while ((match = DIRECTIVE_RE.exec(String(text || '')))) {
      parseItem(match[1].toUpperCase(), match[2].trim());
    }
    BARE_DIRECTIVE_RE.lastIndex = 0;
    while ((match = BARE_DIRECTIVE_RE.exec(String(text || '')))) {
      var full = match[0].trim();
      if (/^(?:\[\[|\{\{|\[\{|\{\[|\[|\{)/.test(full) && /(?:\]\]|\}\}|\]\}|\}\]|\]|\})$/.test(full)) continue;
      parseItem(match[1].toUpperCase(), match[2].trim());
    }
    var clean = String(text || '').replace(DIRECTIVE_RE, '').replace(BARE_DIRECTIVE_RE, '').replace(STRAY_RE, '')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    return { clean: clean, directives: out };
  };

  /** Apply the stage directions to the room. `resolve(name)` finds a
   *  character in the wider archive so the model can walk somebody in. */
  /** Somebody the archive never filed, made on the spot — by the model's
   *  [[NEW:]] directive or by the reader's own ＋ in the invite grid. The
   *  record is thin but real: it seats them in the room, gives them a
   *  sheet (kit and all), keeps them in state.newChars so they can be
   *  invited again later, and files the arrival. `spec` may carry a voice
   *  sheet ({register, sounds, never, lines}) and a kit — the ✨ fill-in
   *  writes those. Returns the character. */
  RP.inventCharacter = function (state, room, spec) {
    spec = spec || {};
    var name = clip(String(spec.name || '').trim(), 60) || 'Stranger';
    var role = clip(String(spec.role || spec.title || '').trim(), 200);
    var look = clip(String(spec.look || '').trim(), 300);
    var made = RP.normChar({
      id: 'new_' + slug(name),
      name: name,
      title: role || 'Invented in play',
      summary: clip(spec.summary || [role, look].filter(Boolean).join(' — '), 600),
      description: clip(spec.description || '', 1400),
      handle: (state.user && state.user.handle) || 'waluipedia',
      voice: spec.voice && typeof spec.voice === 'object' && spec.voice.register ? spec.voice : undefined,
    });
    if (look) made.look = look;          // no portrait exists; the words are it
    made.invented = true;
    room.cast = room.cast || [];
    room.cast = room.cast.filter(function (c) { return c.id !== made.id; });
    room.cast.push(made);
    if (room.cast.length > 1) room.kind = 'group';
    room.away = (room.away || []).filter(function (c) { return c.id !== made.id; });
    room.states = room.states || {};
    if (room.states[made.id]) room.states[made.id].present = true;   // someone we remember is a return
    else {
      var kit = Array.isArray(spec.items) ? spec.items.filter(Boolean) : [];
      room.states[made.id] = kit.length
        ? RP.blankSheet(made, room.statePreset, { items: kit.join('; ') })
        : RP.outfit(room, made, RP.blankSheet(made, room.statePreset));
    }
    state.newChars = (state.newChars || []).filter(function (c) { return c.id !== made.id; });
    state.newChars.unshift(made);
    state.newChars = state.newChars.slice(0, 80);
    RP.logEvent(state, {
      kind: 'roster', roomId: room.id, roomTitle: room.title, chars: [made.id],
      text: made.name + ' was ' + (spec.by || 'invented in play') + ': ' + clip(made.summary, 200),
    });
    return made;
  };

  /** The ✨ fill-in: given a name (and whatever the reader typed), ask the
   *  model for the rest of the card in a fixed, line-per-field template a
   *  small model can keep to. The scene and the cast ride along so the
   *  newcomer fits the room they are walking into. */
  RP.inventPrompt = function (spec, room) {
    spec = spec || {};
    var cast = ((room && room.cast) || []).map(function (c) { return c.name + (c.title ? ' (' + clip(c.title, 50) + ')' : ''); }).slice(0, 8);
    var given = ['role', 'look', 'voice', 'items'].filter(function (k) { return spec[k] && String(spec[k]).trim(); })
      .map(function (k) { return '  ' + k.toUpperCase() + ' (keep this): ' + clip(String(spec[k]), 200); });
    return [
      'You write character cards for a roleplay set in the Waluipedia archive — Mario-world names, grudges and debts;',
      'ground-level, specific, a little grubby; never generic fantasy. Fill in the card for ONE new character named',
      '\u201c' + spec.name + '\u201d, who is about to walk into this scene.',
      (room && room.scene) ? 'THE SCENE: ' + clip(room.scene, 500) : '',
      cast.length ? 'ALREADY HERE: ' + cast.join('; ') : '',
      given.length ? 'THE READER ALREADY WROTE:\n' + given.join('\n') : '',
      'Answer with EXACTLY these lines, nothing before or after, no markdown:',
      'ROLE: who they are to this scene, one line',
      'LOOK: what they look like, one or two sentences',
      'VOICE: how they talk — register, rhythm, tics — one or two sentences',
      'SOUNDS LIKE: three short phrases they would say, separated by " / "',
      'NEVER: two or three things they would never say or do, separated by " / "',
      'LINE: one sample line of theirs, in quotes',
      'LINE: a second sample line',
      'LINE: a third sample line',
      'CARRYING: two or three things they carry, separated by commas, each starting with one emoji',
    ].filter(Boolean).join('\n');
  };

  /** Read the template back. Anything missing is left blank rather than
   *  invented; the reader can still type it. */
  RP.parseInvented = function (text, spec) {
    var out = { name: (spec && spec.name) || '', role: '', look: '', voice: null, items: [] };
    var fields = { role: '', look: '', register: '', sounds: [], never: [], lines: [] };
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/^[\s*#>-]+/, '').trim();
      var m = /^(ROLE|LOOK|VOICE|SOUNDS LIKE|NEVER|LINE|CARRYING)\s*:\s*(.+)$/i.exec(line);
      if (!m) return;
      var key = m[1].toUpperCase(), value = m[2].trim();
      if (key === 'ROLE') fields.role = fields.role || clip(value, 200);
      else if (key === 'LOOK') fields.look = fields.look || clip(value, 300);
      else if (key === 'VOICE') fields.register = fields.register || clip(value, 400);
      else if (key === 'SOUNDS LIKE') fields.sounds = value.split(/\s*\/\s*|\s*;\s*/).map(function (v) { return clip(v.replace(/^[\u201c"']|[\u201d"']$/g, ''), 80); }).filter(Boolean).slice(0, 4);
      else if (key === 'NEVER') fields.never = value.split(/\s*\/\s*|\s*;\s*/).map(function (v) { return clip(v, 100); }).filter(Boolean).slice(0, 4);
      else if (key === 'LINE') { if (fields.lines.length < 6) fields.lines.push(clip(value.replace(/^[\u201c"']|[\u201d"']$/g, ''), 240)); }
      else if (key === 'CARRYING') out.items = value.split(/\s*,\s*/).map(function (v) { return clip(v, 60); }).filter(Boolean).slice(0, 5);
    });
    out.role = fields.role;
    out.look = fields.look;
    if (fields.register || fields.lines.length) {
      out.voice = { register: fields.register, sounds: fields.sounds, never: fields.never, lines: fields.lines };
    }
    return out;
  };

  RP.applyDirectives = function (state, room, directives, resolve) {
    RP.ensureSheets(room);
    var lines = [], entered = [], exited = [];
    var you = (room.states || {})[RP.PLAYER_ID];
    function find(name) {
      var want = String(name || '').toLowerCase().trim();
      // The player's sheet answers to their name, "you" and "the player" —
      // but only exactly: fuzzy matching a name like "You" is how a turn
      // about "the young man" wounds the reader by accident.
      if (you && (want === 'you' || want === 'the player' || want === 'player' ||
          want === String(you.name || '').toLowerCase())) {
        return { id: RP.PLAYER_ID, name: you.name, player: true };
      }
      return (room.cast || []).filter(function (c) {
        return c.name.toLowerCase() === want || c.name.toLowerCase().indexOf(want) >= 0 || want.indexOf(c.name.toLowerCase()) >= 0;
      })[0];
    }
    var names = (room.cast || []).map(function (c) { return c.name; })
      .concat(you ? [you.name, 'the player'] : []);
    var turnNow = ((room || {}).messages || []).length;
    room.toolAt = room.toolAt || {};
    var FAMILY = { hp: 'stakes', flag: 'stakes', mood: 'mood', remember: 'remember' };
    (directives || []).forEach(function (d) {
      if (FAMILY[d.kind]) room.toolAt[FAMILY[d.kind]] = turnNow;
      if (d.kind === 'lookup') return;       // the page answers this one
      if (d.kind === 'mood' && !d.who) return;   // nameless: the page names the speaker first, or it is nobody's
      if (d.kind === 'remember') {
        RP.bookAdd(state, {
          kind: 'fact', name: d.name, text: d.value,
          when: room.date || '', roomId: room.id, roomTitle: room.title,
          chars: (room.cast || []).map(function (c) { return c.id; }),
        });
        lines.push('filed: ' + clip(d.name, 60));
        return;
      }
      if (d.kind === 'time') {
        room.clock = d.value;
        lines.push('the time is ' + d.value);
        return;
      }
      if (d.kind === 'set') {
        room.facts = room.facts || {};
        var key = slug(d.name);
        var was = room.facts[key];
        room.facts[key] = d.value;
        lines.push((was ? d.name + ' is now ' : d.name + ': ') + d.value);
        return;
      }
      if (d.kind === 'tint') {
        // Standing colour: filed on the room, applied at the reader, so a
        // tinted phrase costs the prompt nothing after this line.
        room.tints = room.tints || [];
        (d.names || []).forEach(function (text) {
          var low = text.toLowerCase();
          room.tints = room.tints.filter(function (t) { return String(t.text).toLowerCase() !== low; });
          if (d.colour) room.tints.push({ text: text, colour: d.colour });
        });
        room.tints = room.tints.slice(-24);
        lines.push('🎨 ' + (d.names || []).join(', ') +
          (d.colour ? ' — written in colour from here on' : ' — plain again'));
        return;
      }
      if (d.kind === 'new') {
        if (find(d.name)) return;
        var made = RP.inventCharacter(state, room, { name: d.name, role: d.role, look: d.look, by: 'invented in play' });
        entered.push(made);
        lines.push('New character — ' + made.name + (d.role ? ', ' + d.role : ''));
        return;
      }
      // Re-read the raw body now that the cast is known: "Lord Darian Marsh
      // bleeding" is one person and a condition, not two words.
      // Re-read the raw body only when the name we have is not somebody in
      // the room — otherwise a CURE would come back as a FLAG being set.
      if (d.body && d.kind !== 'enter' && d.kind !== 'exit' && d.kind !== 'new' && !find(d.who || d.name)) {
        var re = RP.splitTarget(d.body, names);
        if (re.name && re.rest) {
          var kindWord = d.kind === 'counter' ? 'COUNT' : d.kind === 'equip' ? (d.op === '-' ? 'STOW' : 'EQUIP')
            : d.kind === 'flag' ? (d.value === false ? 'CURE' : 'COND') : d.kind.toUpperCase();
          var reparsed = RP.parseDirectives('[[' + kindWord + ': ' + d.body + ']]', names).directives[0];
          if (reparsed) d = reparsed;
        }
      }
      if (d.kind === 'enter') {
        if (find(d.name)) return;
        // Someone who left this room comes back as themselves — same id,
        // same sheet, still carrying whatever they walked out with.
        var lowName = String(d.name).toLowerCase();
        var backIdx = (room.away || []).findIndex(function (c) {
          var k = String(c.name || '').toLowerCase();
          return k && (k.indexOf(lowName) >= 0 || lowName.indexOf(k) >= 0);
        });
        var back = backIdx >= 0 ? room.away.splice(backIdx, 1)[0] : null;
        var found = back || (resolve && resolve(d.name));
        var kept = found ? room.states[found.id] : null;
        if (found) {
          room.cast.push(RP.normChar(found));
          if (kept) kept.present = true;
          else room.states[found.id] = RP.outfit(room, found, RP.blankSheet(found, room.statePreset));
          RP.logEvent(state, {
            kind: 'roster', roomId: room.id, roomTitle: room.title, chars: [found.id],
            text: found.name + ' entered the scene: ' + (d.reason || 'no reason filed'),
          });
        } else {
          // Nobody the archive knows: made on the spot, like a [[NEW:]],
          // so they keep a sheet and can be invited back into later scenes.
          found = RP.inventCharacter(state, room, { name: d.name, role: 'Walked into the scene', summary: d.reason, by: 'walked into the scene' });
        }
        entered.push(found);
        lines.push(found.name + (kept ? ' returns — ' : ' enters — ') + (d.reason || 'the scene called for them'));
        return;
      }
      if (d.kind === 'exit') {
        var who = find(d.name);
        if (!who || who.id === RP.PLAYER_ID || room.cast.length <= 1) return;
        room.cast = room.cast.filter(function (c) { return c.id !== who.id; });
        if (room.states[who.id]) room.states[who.id].present = false;
        // Remembered at the door: if they walk back in, ENTER finds them
        // here and hands back the same sheet instead of a fresh one.
        room.away = (room.away || []).filter(function (c) { return c.id !== who.id; });
        room.away.push(who);
        room.away = room.away.slice(-24);
        if (room.next === who.id) room.next = '';
        exited.push(who);
        lines.push(who.name + ' leaves — ' + (d.reason || 'gone'));
        RP.logEvent(state, {
          kind: 'roster', roomId: room.id, roomTitle: room.title, chars: [who.id],
          text: who.name + ' left the scene: ' + (d.reason || 'no reason filed'),
        });
        return;
      }
      var target = find(d.who || d.name);
      var sheet = target ? room.states[target.id] : null;
      // How the reader feels is the reader's: the model's MOOD for the
      // player's sheet is dropped (the sheet form sets it by hand).
      if (d.kind === 'mood' && sheet && (sheet.player || (target && target.player)) && !d.set && !d.byAudit) return;
      if (d.kind === 'mood') d = Object.assign({}, d, { turn: turnNow });
      var line = RP.applyChange(sheet, d);
      if (line) lines.push(line);
    });
    if (lines.length) room.updated = Date.now();
    // Two people in the room is a group chat: named turns in the history,
    // the rotation, the ensemble prompt. A one-to-one chat somebody walked
    // into used to keep the solo card — "You are Sans" — for every speaker.
    if ((room.cast || []).length > 1) room.kind = 'group';
    return { lines: lines, entered: entered, exited: exited };
  };

  /* ------------------------------------------------------------------ *
   * hooks — the model writes the opener, from the actual lore
   * ------------------------------------------------------------------ */

  /** Everything the archive and your own play know about this scenario,
   *  gathered for the hook writer. No summarising: raw filed material. */
  RP.hookContext = function (state, scenario) {
    var ids = (scenario.suggestedCast || []).map(function (c) { return c.id; });
    var log = (state.log || []).filter(function (e) {
      return (e.chars || []).some(function (id) { return ids.indexOf(id) >= 0; });
    }).slice(-6).map(function (e) { return e.text; });
    var memory = ids.map(function (id) {
      var mem = (state.chars || []).filter(function (c) { return c.id === id; })[0];
      if (!mem || !(mem.notes || []).length) return '';
      return mem.name + ' remembers: ' + mem.notes.slice(-3).map(function (n) { return n.text; }).join(' / ');
    }).filter(Boolean);
    return { log: log, memory: memory };
  };

  /** The prompt that refuses a weak opener. Everything it is given is filed
   *  material; everything it must not do is listed, because small local
   *  models default to "You find yourself in a tavern" otherwise. */
  RP.hookPrompt = function (scenario, ctx) {
    ctx = ctx || {};
    var cast = (scenario.suggestedCast || []).slice(0, 6);
    return [
      'You are the scene-setter for a roleplay session in the Waluipedia archive. Write the opening of ONE scene.',
      '',
      'THE BRANCH',
      scenario.name,
      scenario.premise || '',
      '',
      'THE FILED MATERIAL — use these specifics, do not restate them',
      clip(scenario.brief, 2200),
      '',
      'THE PEOPLE IN IT',
      cast.map(function (c) {
        return '- ' + c.name + (c.title ? ' — ' + c.title : '') + (c.why ? ' (' + c.why + ')' : '') +
          (c.summary ? '. ' + clip(c.summary, 220) : '');
      }).join('\n'),
      (scenario.beats || []).length ? '\nTHE SCRIPT THAT WILL FIRE LATER (do not spend it now)\n' +
        scenario.beats.slice(0, 4).map(function (b) { return '- ' + b.beat; }).join('\n') : '',
      (ctx.log || []).length ? '\nWHAT ALREADY HAPPENED IN THIS READER\u2019S OTHER CHATS\n- ' + ctx.log.join('\n- ') : '',
      (ctx.memory || []).length ? '\nWHAT THESE CHARACTERS REMEMBER\n- ' + ctx.memory.join('\n- ') : '',
      '',
      'WRITE EXACTLY THIS, NOTHING ELSE:',
      'TITLE: a specific, concrete title — a place, an object, a line of dialogue. Never a rhetorical question.',
      'OPEN: 90 to 150 words. Present tense. Second person, addressed to the player. Begin INSIDE the moment —',
      '  mid-action, mid-argument, mid-fall — with at least three specific filed details (a name, an object, a',
      '  place, a number, a time) taken from the material above. End on something the player must answer RIGHT NOW.',
      'STAKES: one sentence naming what is lost in the next few minutes if they get it wrong.',
      '',
      'BANNED: summarising what happened before; "you find yourself"; "little did you know"; "the air is thick";',
      '"in a world where"; explaining the premise back to the reader; asking what the player would like to do;',
      'any sentence that could open a different scene. If your opener would work for another scenario, it is wrong.',
    ].filter(Boolean).join('\n');
  };

  /** Read the hook back. A model that ignores the format still gets used:
   *  the whole reply becomes the opener rather than being thrown away. */
  RP.parseHook = function (text, scenario) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    function grab(label, next) {
      var re = new RegExp(label + '\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:' + next + ')\\s*:|$)', 'i');
      var hit = re.exec(raw);
      return hit ? hit[1].replace(/^\s+|\s+$/g, '') : '';
    }
    var title = clip(grab('TITLE', 'OPEN|STAKES').split('\n')[0], 110);
    var open = grab('OPEN', 'STAKES|TITLE');
    var stakes = clip(grab('STAKES', 'TITLE|OPEN').split('\n')[0], 240);
    if (!open) open = raw.replace(/^(TITLE|STAKES)\s*:.*$/gim, '').trim();
    if (!open) return null;
    return {
      title: title || (scenario ? scenario.name : ''),
      open: clip(open, 1400),
      stakes: stakes,
      at: Date.now(),
    };
  };

  /** Would this opener have worked for any other scene? Then it is generic.
   *  Used to decide whether to keep a hook or ask again. */
  RP.hookIsWeak = function (hook, scenario) {
    if (!hook || !hook.open) return true;
    var text = hook.open.toLowerCase();
    if (text.length < 240) return true;
    if (/you find yourself|little did you know|in a world where|the air is thick|what would you like to do|as you may recall/.test(text)) return true;
    // At least two proper nouns out of the filed material have to survive.
    var names = ((scenario.suggestedCast || []).map(function (c) { return c.name; })
      .concat(String(scenario.brief || '').match(/\b[A-Z][a-z]{3,}\b/g) || [])).slice(0, 40);
    var hits = 0, seen = {};
    names.forEach(function (n) {
      var key = n.toLowerCase();
      if (seen[key] || key.length < 4) return;
      seen[key] = 1;
      if (text.indexOf(key) >= 0) hits++;
    });
    return hits < 2;
  };

  /** The opener used when there is no model, or it produced nothing usable.
   *  Still in the moment, still specific — it is built from the hinge beat. */
  RP.coldOpen = function (scenario) {
    var beat = (scenario.beats || [])[0] || {};
    var where = '';
    var room = /\*\*The room\.\*\*\s*([^\n]+)/.exec(scenario.brief || '');
    if (room) where = clip(room[1], 160);
    var who = (scenario.suggestedCast || []).slice(0, 3).map(function (c) { return c.name; });
    return [
      (beat.time ? beat.time.charAt(0).toUpperCase() + beat.time.slice(1) + '. ' : '') + (where || ''),
      beat.detail || scenario.premise,
      who.length ? who.join(', ') + ' ' + (who.length > 1 ? 'are' : 'is') + ' already here, and none of them are waiting for you to catch up.' : '',
      'It is happening now. What do you do?',
    ].filter(Boolean).join('\n\n');
  };

  /* ------------------------------------------------------------------ *
   * backfills — the lore that was never written down
   * ------------------------------------------------------------------ */

  /** Events that filings point at and nobody ever wrote: the off-screen
   *  battles, the airlift that never came, the session between sessions.
   *  Ranked by demand (how many records are waiting) and by use (how many
   *  times this reader has already played one). */
  RP.backfillsFrom = function (archive, castById, state, limit) {
    // Anything with a record of its own — an event, a person, a body — is
    // not a hole. Only ids that nothing answers to are backfills.
    var have = {}, demand = {};
    // knownIds covers every filed record, including the ones outside the
    // window of events we actually carry — otherwise a filing that exists
    // but is off the end of the list reads as a hole.
    (archive.knownIds || []).forEach(function (id) { have[slug(id)] = true; });
    (archive.events || []).forEach(function (e) { have[slug(e.id)] = e; have[slug(e.name)] = e; });
    (archive.factions || []).forEach(function (f) { have[slug(f.id)] = f; have[slug(f.name)] = f; });
    Object.keys(castById || {}).forEach(function (k) {
      have[k] = castById[k]; have[slug(castById[k].name)] = castById[k];
    });
    function want(id, from, role) {
      var key = slug(id);
      if (!key || have[key]) return;
      var entry = demand[key] || (demand[key] = { id: key, name: RP.prettyId(key), count: 0, from: [], chars: [] });
      entry.count++;
      if (entry.from.length < 6) entry.from.push({ name: from.name, summary: from.summary, kind: role, id: from.id });
      (from.participants || []).forEach(function (p) {
        var c = (castById || {})[slug(p && p.id)];
        if (c && entry.chars.length < 6 && !entry.chars.some(function (x) { return x.id === c.id; })) {
          entry.chars.push(Object.assign({}, c, { why: whyFor(p.role) }));
        }
      });
    }
    // keyEvents only: that list means "a filed occurrence", which is what a
    // backfill is. relatedArticles points at anything at all — locations,
    // items, laws — and scanning it turns the board into noise.
    (archive.events || []).forEach(function (e) {
      (e.keyEvents || []).forEach(function (id) { want(id, e, 'event'); });
    });
    Object.keys(castById || {}).forEach(function (k) {
      var c = castById[k];
      (c.keyEvents || []).forEach(function (id) {
        want(id, { id: c.id, name: c.name, summary: c.summary, participants: [{ id: c.id, name: c.name, role: 'was there' }] }, 'character');
      });
    });
    (archive.factions || []).forEach(function (f) {
      (f.keyEvents || []).forEach(function (id) { want(id, f, 'faction'); });
    });
    var uses = (state && state.backfillUses) || {};
    return Object.keys(demand).map(function (k) { return demand[k]; })
      .filter(function (d) { return d.count >= 2 && d.chars.length >= 1; })
      .map(function (d) { d.uses = Number(uses[d.id] || 0); return d; })
      .sort(function (a, b) { return (b.uses - a.uses) || (b.count - a.count); })
      .slice(0, limit || 10);
  };

  RP.whatIfFromBackfill = function (gap, castById) {
    if (!gap || !gap.from.length) return null;
    var cast = gap.chars.slice(0, 6);
    if (cast.length < 2) {
      // One name is enough to file a report, not enough to play a scene.
      (gap.from || []).forEach(function (f) {
        var c = (castById || {})[slug(f.id)];
        if (c && cast.length < 4 && !cast.some(function (x) { return x.id === c.id; })) {
          cast.push(Object.assign({}, c, { why: 'filed the record that points here' }));
        }
      });
    }
    var beats = gap.from.slice(0, 3).map(function (f) {
      return {
        time: 'referenced',
        beat: clip(f.name + ' points at it', 140),
        detail: clip(f.summary, 420),
      };
    }).concat(RP.beatsFromProse(gap.from.map(function (f) { return f.summary; }).join('\n\n'), 3, 'the gap'));
    return scenario({
      id: 'backfill:' + gap.id,
      kind: 'backfill', kindLabel: 'Backfill',
      name: gap.name,
      premise: gap.name + ' is referenced by ' + gap.count + ' filed record' + (gap.count === 1 ? '' : 's') +
        ' and has never been written. This scene is the missing filing: it happened, everyone downstream behaves as though it happened, and no account of it exists.',
      tags: ['backfill', 'unwritten'],
      weight: 2 + Math.min(3, gap.count / 2),
      source: 'backfill → ' + gap.id,
      cast: cast,
      beats: beats.slice(0, 7),
      questions: [
        'What actually happened here, in order?',
        'Who walked away from it, and in what condition?',
        'Which of the later filings is wrong about it?',
      ],
      briefParts: [
        '**The hole.** ' + gap.name + ' is pointed at ' + gap.count + ' times and written nowhere. ' +
          'The archive treats it as settled — later filings refer back to it, characters carry its consequences — ' +
          'but there is no account of the hours themselves.',
        '**What points at it.**\n' + gap.from.slice(0, 4).map(function (f) {
          return '- *' + f.name + '* (' + f.kind + '). ' + clip(f.summary, 260);
        }).join('\n'),
        cast.length ? '**Who was there, according to the records that mention it.**\n' + cast.map(castLine).join('\n') : '',
        '**How this runs.** Play it as the session that was never filed. The beats are the references that depend ' +
          'on it, so the scene has to arrive at what the archive already believes — the how, the cost and the order ' +
          'are yours. Export the transcript afterwards and the gap has a first-hand account.',
        '**What is at stake.** ' + gap.count + ' filings currently rest on an event nobody has ever described. ' +
          'Whatever happens here is what the archive will have to live with.',
      ],
    });
  };

  RP.noteBackfillUse = function (state, id) {
    state.backfillUses = state.backfillUses || {};
    var key = String(id || '').replace(/^backfill:/, '');
    state.backfillUses[key] = Number(state.backfillUses[key] || 0) + 1;
    return state.backfillUses[key];
  };

  /* ------------------------------------------------------------------ *
   * sequels — carry a played scene forward
   * ------------------------------------------------------------------ */

  /** A sequel keeps the cast, the sheets and the memory, and opens on the
   *  unfinished business rather than on a recap. */
  RP.sequelFrom = function (room, state, opts) {
    opts = opts || {};
    var turns = (room.messages || []).filter(visible);
    var tail = turns.slice(-6).map(function (m) {
      var who = m.role === 'user' ? ((state.user && state.user.name) || 'You')
        : ((room.cast || []).filter(function (c) { return c.id === m.charId; })[0] || {}).name || 'Someone';
      return '- **' + who + ':** ' + clip(RP.textOf(m), 220);
    });
    var pinned = (room.messages || []).filter(function (m) { return m.pinned; }).slice(-4)
      .map(function (m) { return '- ' + clip(RP.textOf(m), 220); });
    var unfired = (room.beats || []).slice(room.beatIndex || 0);
    var sheets = Object.keys(room.states || {}).map(function (k) { return room.states[k]; })
      .filter(function (s) { return s.present !== false; });
    var beats = unfired.length ? unfired.slice(0, 6) : [
      { time: 'straight away', beat: 'The consequence arrives', detail: 'Whatever was left hanging at the end of ' + (room.sceneName || room.title) + ' catches up with the people who left it hanging.' },
      { time: 'soon after', beat: 'Someone acts on what they learned', detail: 'One of the people in that room has had time to think, and they move first.' },
      { time: 'later', beat: 'The bill', detail: 'The cost of the previous scene is presented to whoever is standing closest.' },
    ];
    return scenario({
      id: 'sequel:' + room.id + ':' + ((room.sequelCount || 0) + 1),
      kind: 'sequel', kindLabel: 'Sequel',
      name: clip(opts.title || ('After ' + (room.sceneName || room.title)), 110),
      premise: opts.premise || ('Picks up where ' + (room.sceneName || room.title) + ' stopped — same people, same wounds, ' +
        'and whatever they left unfinished. Nothing is recapped; the scene starts already moving.'),
      image: room.sceneImage,
      tags: ['sequel'],
      weight: 4,
      source: 'sequel of ' + (room.sceneName || room.title),
      cast: (room.cast || []).map(function (c) { return Object.assign({}, c, { why: 'was in the previous scene' }); }),
      beats: beats,
      questions: [
        'What did the last scene leave unpaid?',
        'Who has changed their mind since?',
      ],
      briefParts: [
        '**Previously.** ' + clip(room.scene || room.sceneName || room.title, 600),
        tail.length ? '**How it ended.**\n' + tail.join('\n') : '',
        pinned.length ? '**What was pinned as it happened.**\n' + pinned.join('\n') : '',
        sheets.length ? '**The state everyone is carrying in.**\n' + sheets.map(function (s) {
          var bits = [];
          if (s.hp) bits.push('HP ' + s.hp.value + '/' + s.hp.max);
          if (s.mp) bits.push('Energy ' + s.mp.value + '/' + s.mp.max);
          var flags = Object.keys(s.flags || {});
          if (flags.length) bits.push(flags.join(', ').replace(/_/g, ' '));
          if ((s.items || []).length) bits.push('carrying ' + s.items.join(', '));
          if (s.status) bits.push(s.status);
          return '- ' + s.name + ': ' + (bits.join(' · ') || 'unmarked');
        }).join('\n') : '',
        unfired.length ? '**Beats that never fired last time.** ' + unfired.length + ' of them, and they fire here instead.' : '',
        '**How it opens.** In the middle. The sequel does not summarise the previous scene — the people in it already ' +
          'lived through that, and so did you.',
      ],
      states: room.states,
    });
  };








  /** A card's greeting, as the scene's opening message. */
  RP.cardGreeting = function (char, which) {
    var card = (char && char.card) || {};
    var all = [card.first_mes].concat(card.alternate_greetings || []).filter(Boolean);
    if (!all.length) return '';
    var at = Math.max(0, Math.min(all.length - 1, which || 0));
    return clip(all[at], 1400);
  };

  /** Fold imported turns into a chat that is already running. The turns are
   *  appended, not replaced: an import is the story so far, and play carries
   *  on from the bottom of it. */
  RP.appendTranscript = function (room, turns, opts) {
    opts = opts || {};
    var added = 0;
    (turns || []).forEach(function (t) {
      var who = (room.cast || []).filter(function (c) {
        var name = c.name.toLowerCase(), said = String(t.who || '').toLowerCase();
        return said && (name === said || name.indexOf(said) >= 0 || said.indexOf(name) >= 0);
      })[0];
      var at = Date.now() - ((turns.length - added) * 1000);
      if (!who) {
        room.messages.push({ id: uid(), role: 'user', text: t.text, at: at, imported: true });
      } else {
        room.messages.push({
          id: uid(), role: 'char', charId: who.id, text: t.text, at: at,
          alts: [t.text], alt: 0, imported: true,
        });
      }
      added++;
    });
    if (added) {
      room.updated = Date.now();
      if (opts.divider) {
        // A note in the stream so the seam between imported and played is
        // visible later, when nobody remembers which was which.
        room.messages.splice(room.messages.length - added, 0, {
          id: uid(), role: 'scene', at: Date.now(), imported: true,
          text: '— ' + added + ' imported turn' + (added === 1 ? '' : 's') +
            (opts.source ? ' from ' + clip(opts.source, 60) : '') + ' —',
        });
      }
    }
    return added;
  };

  /** Bring a character into a room that is already running. */
  RP.addToRoom = function (room, char) {
    if (!char || (room.cast || []).some(function (c) { return c.id === char.id; })) return null;
    room.cast.push(RP.normChar(char));
    if (room.cast.length > 1) room.kind = 'group';
    RP.ensureSheets(room);
    room.updated = Date.now();
    return char;
  };

  /** How much work the lore book has not done yet on a chat — so the page
   *  can say "this is eleven calls" before it spends them. */
  RP.backlogFor = function (room, every) {
    var turns = (room.messages || []).filter(visible).length;
    var step = Math.max(2, Number(every || 3));
    var filed = Number(room.bookAt || 0);
    var pending = Math.max(0, turns - filed);
    return {
      turns: turns, filed: filed, pending: pending,
      calls: Math.floor(pending / step),
      step: step,
    };
  };

  /** The jobs that would catch a chat up, oldest stretch first. */
  RP.backlogJobs = function (room, every, limit) {
    var plan = RP.backlogFor(room, every);
    var turns = (room.messages || []).filter(visible);
    var jobs = [];
    for (var at = plan.filed; at + plan.step <= turns.length; at += plan.step) {
      if (jobs.length >= (limit || 20)) break;
      jobs.push({
        key: room.id + ':catchup:' + at,
        from: at, to: at + plan.step,
        turns: turns.slice(Math.max(0, at - 1), at + plan.step),
      });
    }
    return jobs;
  };

  /* ------------------------------------------------------------------ *
   * commentary mode — Waluigi and Luigi, at length
   *
   * Two voices arguing about the archive for anything from a quarter of
   * an hour to two hours. No local model writes 18,000 words in one call,
   * so a run is planned into segments and generated one call at a time,
   * each one handed the outline, what has already been said, and the
   * filed material it is allowed to use.
   * ------------------------------------------------------------------ */

  RP.WPM = 150;                    // spoken words per minute, for the clock

  RP.COMMENTARY_STYLES = {
    podcast: {
      name: 'Podcast', min: 15, max: 60, default: 25,
      blurb: 'Two hosts, one subject, digressions allowed.',
      dir: 'This is a podcast episode. Warm, unhurried, funny. They interrupt each other, chase a tangent for a ' +
        'minute and come back. Waluigi hosts; Luigi is the one who actually read the material and keeps saying so.',
      shape: ['cold open — the thing that made them record this', 'the background, argued over',
        'the first real disagreement', 'the material nobody quotes', 'the tangent',
        'the part Luigi finds upsetting', 'what it means for what happens next', 'sign-off'],
    },
    debate: {
      name: 'Debate', min: 15, max: 60, default: 20,
      blurb: 'Two positions, taken seriously, neither wins cleanly.',
      dir: 'This is a formal-ish debate. Waluigi takes the position that flatters the archive and himself; Luigi ' +
        'takes the humane one. Each answers the other\u2019s actual point rather than a weaker version of it. Concessions ' +
        'are allowed and cost something. Nobody wins outright.',
      shape: ['the motion, stated', 'Waluigi opens', 'Luigi answers', 'the evidence both sides want',
        'the strongest objection to Waluigi', 'the strongest objection to Luigi',
        'where they actually agree', 'closing statements'],
    },
    deepdive: {
      name: 'Deep dive', min: 30, max: 120, default: 45,
      blurb: 'Everything on the record, in order, for as long as it takes.',
      dir: 'This is a deep dive: chronological, exhaustive, footnoted out loud. Read the record closely — dates, ' +
        'names, numbers, who said what. Waluigi is the archivist and cannot resist the digression; Luigi is the one ' +
        'asking the obvious question everybody skipped. Slow down on the parts that matter.',
      shape: ['why this file, and why now', 'the earliest record', 'what the sources actually say',
        'the contradictions', 'the people, one at a time', 'the turning point, minute by minute',
        'the aftermath nobody filed', 'the open questions', 'what the archive should do about it',
        'closing thoughts'],
    },
    hottake: {
      name: 'Hot take', min: 15, max: 30, default: 15,
      blurb: 'Short, loud, and over before either of them calms down.',
      dir: 'This is a short, heated segment. Fast turns, few concessions, both of them talking past each other ' +
        'until one lands a point that sticks. Keep it moving.',
      shape: ['the take', 'the objection', 'the escalation', 'the fact that spoils it', 'the grudging landing'],
    },
  };

  /** Split a run into segments the model can actually write. */
  RP.commentaryPlan = function (opts) {
    opts = opts || {};
    var style = RP.COMMENTARY_STYLES[opts.style] ? opts.style : 'podcast';
    var def = RP.COMMENTARY_STYLES[style];
    var minutes = Math.max(def.min, Math.min(def.max, Number(opts.minutes || def.default)));
    var words = Math.round(minutes * RP.WPM);
    // 500–650 words a call keeps every local model inside its output window.
    var perSegment = 600;
    var count = Math.max(def.shape.length, Math.ceil(words / perSegment));
    count = Math.min(count, 40);
    var segments = [];
    for (var i = 0; i < count; i++) {
      segments.push({
        n: i + 1,
        focus: def.shape[Math.min(def.shape.length - 1, Math.floor((i / count) * def.shape.length))],
        words: Math.round(words / count),
        done: false, text: '',
      });
    }
    return {
      id: uid(), style: style, styleName: def.name, topic: clip(opts.topic, 200),
      minutes: minutes, words: words, segments: segments,
      sources: opts.sources || [], created: Date.now(),
    };
  };

  /** The filed material this episode is allowed to work from. */
  RP.commentarySources = function (index, topic, limit) {
    var terms = String(topic || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter(function (t) { return t.length > 3; });
    if (!terms.length) return [];
    return (index || []).map(function (r) {
      var score = 0;
      terms.forEach(function (t) { if (r.words.indexOf(t) >= 0) score += 1; });
      if (String(r.name || '').toLowerCase().indexOf(String(topic).toLowerCase()) >= 0) score += 4;
      return { r: r, score: score };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, limit || 12)
      .map(function (x) {
        return {
          id: x.r.id, kind: x.r.kind, name: x.r.name,
          date: x.r.date ? RP.formatWahDate(x.r.date) : '',
          text: clip(x.r.text, 300),
        };
      });
  };

  var COMMENTARY_RULES = [
    'TWO SPEAKERS, AND ONLY TWO. Every line begins with WALUIGI: or LUIGI: and nothing else does.',
    'WALUIGI — the archive\u2019s author. Vain, precise, funny, allergic to being corrected and constantly being ' +
      'corrected. Cites filings, dates and numbers. Says WAH when genuinely rattled, and not otherwise.',
    'LUIGI — decent, anxious, better read than he lets on. Asks the obvious question nobody asked, worries about ' +
      'the people in the record rather than the record, and is right more often than Waluigi admits.',
    'They are commentating, not roleplaying a scene: no stage directions, no asterisks, no narration.',
    'Never invent a filing, a date, a quotation or a number. If the material does not say, say that it does not say.',
    'Do not summarise what you are about to say, and do not recap what you already said. Keep moving.',
    'No table talk, no players, no dice, no mention of an archive website or of being a model.',
  ].join('\n');

  /** One segment's prompt: the outline, the material, and what came before. */
  RP.commentaryPrompt = function (plan, segment, ctx) {
    ctx = ctx || {};
    var def = RP.COMMENTARY_STYLES[plan.style];
    return [
      'You are writing part ' + segment.n + ' of ' + plan.segments.length + ' of a spoken commentary track for the ' +
        'Waluipedia archive.',
      '',
      'THE SUBJECT',
      plan.topic,
      '',
      'THE FORMAT — ' + def.name,
      def.dir,
      'The whole episode runs about ' + plan.minutes + ' minutes. THIS PART is “' + segment.focus + '” and should be ' +
        'about ' + segment.words + ' words — do not write the rest of the episode.',
      '',
      'THE RULES',
      COMMENTARY_RULES,
      plan.sources.length ? '\nTHE FILED MATERIAL — this is what you know; quote it, date it, argue about it\n' +
        plan.sources.map(function (s) {
          return '- [' + s.kind + ':' + s.id + '] ' + s.name + (s.date ? ' (' + s.date + ')' : '') + ' — ' + s.text;
        }).join('\n') : '',
      ctx.previous ? '\nTHE LAST THING SAID (continue straight on from it, do not repeat it)\n' + clip(ctx.previous, 700) : '',
      ctx.covered && ctx.covered.length ? '\nALREADY COVERED (do not go over these again)\n- ' + ctx.covered.join('\n- ') : '',
      segment.n === 1 ? '\nOpen cold, mid-thought, as though the recording started late.' : '',
      segment.n === plan.segments.length ? '\nThis is the last part: land it. No summary of the episode — a last ' +
        'exchange that leaves the subject where it actually stands.' : '',
      '',
      'Write only the dialogue, beginning with a speaker label.',
    ].filter(Boolean).join('\n');
  };

  /** Read a segment back into lines. Anything not attributed to one of the
   *  two is folded into the previous speaker rather than dropped. */
  RP.parseCommentary = function (text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/^[\s>*_-]+/, '').trim();
      if (!line) return;
      var hit = /^\*{0,2}(WALUIGI|LUIGI)\*{0,2}\s*[:：]\s*(.*)$/i.exec(line);
      if (hit) {
        var body = hit[2].trim();
        if (body) out.push({ who: hit[1].toLowerCase(), text: clip(body, 1800) });
        return;
      }
      if (out.length) {
        var last = out[out.length - 1];
        last.text = clip(last.text + ' ' + line, 1800);
      }
    });
    return out;
  };

  RP.commentaryStats = function (lines) {
    var words = 0;
    (lines || []).forEach(function (l) { words += String(l.text).split(/\s+/).filter(Boolean).length; });
    return { words: words, minutes: Math.round((words / RP.WPM) * 10) / 10, lines: (lines || []).length };
  };

  /** The whole episode as one script, for export or for reading aloud. */
  RP.commentaryScript = function (episode) {
    var lines = episode.lines || [];
    var stats = RP.commentaryStats(lines);
    return ['# ' + episode.topic,
      '_' + episode.styleName + ' · about ' + stats.minutes + ' minutes · ' + stats.words + ' words_',
      episode.sources && episode.sources.length
        ? '\nSources: ' + episode.sources.map(function (s) { return s.name + (s.date ? ' (' + s.date + ')' : ''); }).join(' · ')
        : '',
      '',
    ].join('\n') + lines.map(function (l) {
      return (l.who === 'waluigi' ? '**WALUIGI:** ' : '**LUIGI:** ') + l.text;
    }).join('\n\n') + '\n';
  };

  /** Episodes are kept beside the lore book. */
  RP.saveEpisode = function (state, episode) {
    state.episodes = state.episodes || [];
    state.episodes = state.episodes.filter(function (e) { return e.id !== episode.id; });
    state.episodes.unshift(episode);
    state.episodes = state.episodes.slice(0, 20);
    return episode;
  };

  /* ------------------------------------------------------------------ *
   * character cards — the format everybody else already uses
   *
   * SillyTavern/TavernAI cards are JSON (v1 flat, or v2 under `data`) and
   * PNGs with that JSON base64'd into a tEXt chunk called `chara`. Both
   * are read here, and both are written: exporting a character as a PNG
   * takes their actual archive portrait and embeds the card in it, so the
   * file is a picture AND a card.
   * ------------------------------------------------------------------ */

  function b64encode(text) {
    var bytes = new TextEncoder().encode(text), binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function b64decode(text) {
    var binary = atob(String(text).replace(/\s+/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  RP.b64encode = b64encode;
  RP.b64decode = b64decode;

  /** A character card (v1 or v2) → a playable character of ours. */
  RP.parseCharacterCard = function (card) {
    if (!card) return null;
    var data = card.data && typeof card.data === 'object' ? card.data : card;
    var name = clip(data.name || data.char_name, 60);
    if (!name) return null;
    var desc = String(data.description || data.char_persona || '');
    var persona = String(data.personality || '');
    var char = RP.normChar({
      id: 'card_' + slug(name),
      name: name,
      title: clip(data.character_version ? name + ' — card ' + data.character_version : (persona.split(/[.\n]/)[0] || 'Imported character card'), 120),
      summary: clip(desc.replace(/\s+/g, ' '), 320),
      description: clip([desc, persona].filter(Boolean).join('\n\n'), 900),
      image: String(data.avatar && data.avatar !== 'none' ? data.avatar : ''),
      handle: slug(data.creator || 'imported') || 'imported',
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 8).map(String) : [],
    });
    char.invented = true;              // not an archive record — treated as a guest
    char.card = {
      scenario: clip(data.scenario, 700),
      first_mes: clip(data.first_mes || data.char_greeting, 1200),
      mes_example: clip(data.mes_example || data.example_dialogue, 1200),
      system_prompt: clip(data.system_prompt, 900),
      post_history_instructions: clip(data.post_history_instructions, 600),
      alternate_greetings: (data.alternate_greetings || []).slice(0, 4).map(function (g) { return clip(g, 900); }),
      creator: clip(data.creator, 60),
      creator_notes: clip(data.creator_notes, 400),
      version: clip(data.character_version, 20),
    };
    char.look = clip(desc.replace(/\s+/g, ' '), 300);
    // A card carried inside a PNG brings its own portrait; the caller hands
    // it in as a data URL so the face survives into every chat.
    if (card && card.__image) char.image = String(card.__image);
    return char;
  };

  /** Ours → a v2 card other tools will accept. The scenario, greeting and
   *  example dialogue are built from the archive's own material when the
   *  character did not arrive as a card. */
  RP.toCharacterCard = function (char, opts) {
    opts = opts || {};
    var card = char.card || {};
    var data = {
      name: char.name,
      description: clip([char.title, char.description || char.summary].filter(Boolean).join('\n\n'), 4000),
      personality: clip(RP.roleFor(char) || char.title, 400),
      scenario: clip(card.scenario || opts.scenario ||
        ('The Waluipedia archive, ' + clip(opts.date || 'the present day', 90) + '. ' +
          clip(char.status || '', 420)), 1200),
      first_mes: clip(card.first_mes || opts.greeting || '', 1500),
      mes_example: clip(card.mes_example || opts.examples || '', 1500),
      creator_notes: clip(card.creator_notes ||
        ('Exported from the Waluipedia chatroom. Filed affiliation: ' + (char.affiliation || 'none') + '.'), 400),
      system_prompt: clip(card.system_prompt || '', 900),
      post_history_instructions: clip(card.post_history_instructions || '', 600),
      alternate_greetings: card.alternate_greetings || [],
      tags: (char.tags || []).concat(['waluipedia']).slice(0, 10),
      creator: clip(card.creator || char.handle || 'waluipedia', 60),
      character_version: card.version || '1.0',
      extensions: {
        waluipedia: {
          id: char.id, race: char.race, affiliation: char.affiliation, faction: char.faction,
          status: char.status, fameTier: char.fameTier, keyEvents: (char.keyEvents || []).slice(0, 8),
        },
      },
    };
    return { spec: 'chara_card_v2', spec_version: '2.0', data: data,
      // v1 fields alongside, so older tools can still read the file.
      name: data.name, description: data.description, personality: data.personality,
      scenario: data.scenario, first_mes: data.first_mes, mes_example: data.mes_example };
  };

  /* ---- PNG cards ---- */

  var CRC_TABLE = (function () {
    var table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes, start, end) {
    var c = 0xffffffff;
    for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  RP.crc32 = crc32;

  function readU32(bytes, at) {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  }
  function writeU32(bytes, at, value) {
    bytes[at] = (value >>> 24) & 0xff; bytes[at + 1] = (value >>> 16) & 0xff;
    bytes[at + 2] = (value >>> 8) & 0xff; bytes[at + 3] = value & 0xff;
  }

  RP.isPng = function (bytes) {
    return bytes && bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  };

  /** Every tEXt chunk in a PNG, as { keyword: value }. */
  RP.pngText = function (bytes) {
    var out = {};
    if (!RP.isPng(bytes)) return out;
    var at = 8;
    while (at + 8 <= bytes.length) {
      var len = readU32(bytes, at);
      var type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
      if (type === 'IEND') break;
      if (type === 'tEXt') {
        var body = bytes.subarray(at + 8, at + 8 + len);
        var split = body.indexOf(0);
        if (split > 0) {
          var key = '', value = '';
          for (var i = 0; i < split; i++) key += String.fromCharCode(body[i]);
          for (var j = split + 1; j < body.length; j++) value += String.fromCharCode(body[j]);
          out[key] = value;
        }
      }
      at += 12 + len;
    }
    return out;
  };

  /** Put a tEXt chunk into a PNG, just before IEND. */
  RP.pngWithText = function (bytes, keyword, value, opts) {
    if (!RP.isPng(bytes)) return null;
    opts = opts || {};
    if (opts.replace !== false) bytes = RP.pngWithoutText(bytes, keyword);
    var key = String(keyword), text = String(value);
    var body = new Uint8Array(key.length + 1 + text.length);
    for (var i = 0; i < key.length; i++) body[i] = key.charCodeAt(i) & 0xff;
    body[key.length] = 0;
    for (var j = 0; j < text.length; j++) body[key.length + 1 + j] = text.charCodeAt(j) & 0xff;

    var chunk = new Uint8Array(12 + body.length);
    writeU32(chunk, 0, body.length);
    chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74;   // "tEXt"
    chunk.set(body, 8);
    writeU32(chunk, 8 + body.length, crc32(chunk, 4, 8 + body.length));

    // Find IEND and splice the new chunk in front of it.
    var at = 8, iend = bytes.length - 12;
    while (at + 8 <= bytes.length) {
      var len = readU32(bytes, at);
      var type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
      if (type === 'IEND') { iend = at; break; }
      at += 12 + len;
    }
    var out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, iend), 0);
    out.set(chunk, iend);
    out.set(bytes.subarray(iend), iend + chunk.length);
    return out;
  };

  /** Drop every tEXt chunk with this keyword. Re-exporting a card that was
   *  imported from a PNG must not leave two `chara` chunks in the file —
   *  other tools read the first one and get the old character. */
  RP.pngWithoutText = function (bytes, keyword) {
    if (!RP.isPng(bytes)) return bytes;
    var keep = [bytes.subarray(0, 8)], at = 8, total = 8, dropped = false;
    while (at + 8 <= bytes.length) {
      var len = readU32(bytes, at);
      var type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
      var chunk = bytes.subarray(at, at + 12 + len);
      var skip = false;
      if (type === 'tEXt') {
        var body = bytes.subarray(at + 8, at + 8 + len);
        var split = body.indexOf(0), key = '';
        for (var i = 0; i < (split < 0 ? 0 : split); i++) key += String.fromCharCode(body[i]);
        if (key.toLowerCase() === String(keyword).toLowerCase()) { skip = true; dropped = true; }
      }
      if (!skip) { keep.push(chunk); total += chunk.length; }
      at += 12 + len;
      if (type === 'IEND') break;
    }
    if (!dropped) return bytes;
    var out = new Uint8Array(total), cursor = 0;
    keep.forEach(function (part) { out.set(part, cursor); cursor += part.length; });
    return out;
  };

  RP.cardFromPng = function (bytes) {
    var text = RP.pngText(bytes);
    var raw = text.chara || text.Chara || text.ccv3 || '';
    if (!raw) return null;
    try { return RP.parseCharacterCard(JSON.parse(b64decode(raw))); }
    catch (e) { /* some exporters write the JSON in plain */ }
    try { return RP.parseCharacterCard(JSON.parse(raw)); }
    catch (e) { return null; }
  };

  RP.cardToPng = function (portraitBytes, char, opts) {
    if (!RP.isPng(portraitBytes)) return null;
    return RP.pngWithText(portraitBytes, 'chara', b64encode(JSON.stringify(RP.toCharacterCard(char, opts))));
  };

  /* ------------------------------------------------------------------ *
   * text in, text out
   * ------------------------------------------------------------------ */

  /** Read a pasted transcript — "Name: line", "**Name:** line", or plain
   *  paragraphs — into turns. Anything unattributed belongs to the player. */
  RP.parseTranscript = function (text, opts) {
    opts = opts || {};
    var out = [], current = null;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var raw = line.replace(/^\s*[>#-]\s?/, '').trim();
      if (!raw) { current = null; return; }
      // "Name:", "**Name:**" and "**Name**:" are all the same line.
      var named = /^\*{0,2}_{0,2}([A-Z][\w'’. -]{1,40}?)\*{0,2}_{0,2}\s*[:：]\s*\*{0,2}\s*(.+?)\*{0,2}$/.exec(raw);
      if (named) {
        current = { who: clip(named[1], 40), text: clip(named[2], 4000) };
        out.push(current);
        return;
      }
      // A line that carries on the previous one (lowercase, or opens with
      // speech or an action) is the same turn; anything else is a new one.
      if (current && /^[a-z"“*(]/.test(raw)) { current.text = clip(current.text + '\n' + raw, 4000); return; }
      current = { who: clip(opts.narrator || '', 40), text: clip(raw, 4000) };
      out.push(current);
    });
    return out.filter(function (t) { return t.text; });
  };

  /** Those turns → a room, with anyone unknown treated as the player. */
  RP.roomFromTranscript = function (turns, cast, opts) {
    opts = opts || {};
    var room = RP.newRoom(cast, opts);
    room.messages = room.messages.concat(turns.map(function (t) {
      var who = (cast || []).filter(function (c) {
        return c.name.toLowerCase() === String(t.who).toLowerCase() ||
          (t.who && c.name.toLowerCase().indexOf(String(t.who).toLowerCase()) >= 0);
      })[0];
      if (!who) return { id: uid(), role: 'user', text: t.text, at: Date.now() };
      return { id: uid(), role: 'char', charId: who.id, text: t.text, at: Date.now(), alts: [t.text], alt: 0 };
    }));
    return room;
  };


  /* ---- one importer for every shape a file might be ---- */

  /** SillyTavern-style chat logs: JSONL, one message per line, the first
   *  line metadata. Also accepts a plain JSON array of the same objects. */
  RP.parseChatLog = function (value) {
    var rows = [];
    if (typeof value === 'string') {
      String(value).split(/\r?\n/).forEach(function (line) {
        var trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) !== '{') return;
        try { rows.push(JSON.parse(trimmed)); } catch (e) { /* not a row */ }
      });
    } else if (Array.isArray(value)) {
      rows = value.slice();
    } else if (value && Array.isArray(value.messages)) {
      rows = value.messages.slice();
    } else if (value && Array.isArray(value.chat)) {
      rows = value.chat.slice();
    }
    var turns = [];
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var text = row.mes || row.message || row.content || row.text || row.body;
      if (!text || typeof text !== 'string') return;              // metadata line
      var who = row.name || row.speaker || row.author || row.character ||
        (row.is_user || row.isUser || row.role === 'user' ? '' : row.role || '');
      if (row.is_user === true || row.isUser === true || row.role === 'user') who = '';
      turns.push({ who: clip(who, 40), text: clip(text, 4000) });
    });
    return turns;
  };

  /** Work out what a file actually is before trying to read it, so the page
   *  can say something useful instead of "unsupported". */
  RP.sniffImport = function (value) {
    if (value && value.length && typeof value !== 'string' && RP.isPng(value)) {
      var text = RP.pngText(value);
      var encoded = text.chara || text.Chara || text.ccv3 || '';
      if (!encoded) return { kind: 'png-plain', why: 'a PNG with no character card inside it' };
      var decoded = null;
      try { decoded = JSON.parse(b64decode(encoded)); } catch (e) { decoded = null; }
      if (!decoded) {
        // Some exporters write the JSON straight in, unencoded.
        try { decoded = JSON.parse(encoded); } catch (e) { decoded = null; }
      }
      if (!decoded) return { kind: 'png-broken', why: 'a PNG whose card chunk could not be decoded' };
      return { kind: 'card', card: decoded, why: 'a character card inside a PNG' };
    }
    var raw = typeof value === 'string' ? value : new TextDecoder().decode(value);
    var trimmed = raw.replace(/^\uFEFF/, '').trim();        // byte-order marks happen
    if (!trimmed) return { kind: 'empty', why: 'an empty file' };
    if (/^[[{]/.test(trimmed)) {
      var data = null;
      try { data = JSON.parse(trimmed); } catch (e) { data = null; }
      if (data) {
        if (data.kind === 'waluipedia-chatroom-bundle' || Array.isArray(data.rooms)) {
          return { kind: 'bundle', bundle: data, why: 'a chatroom bundle' };
        }
        if (data.spec === 'chara_card_v2' || data.spec === 'chara_card_v3' || (data.data && data.data.name)) {
          return { kind: 'card', card: data, why: 'a v2 character card' };
        }
        if (data.name && (data.description !== undefined || data.personality !== undefined ||
            data.first_mes !== undefined || data.char_persona !== undefined)) {
          return { kind: 'card', card: data, why: 'a v1 character card' };
        }
        var logged = RP.parseChatLog(data);
        if (logged.length) return { kind: 'chatlog', turns: logged, why: 'a chat log' };
        return { kind: 'json-unknown', why: 'JSON the page does not recognise', data: data };
      }
      // Not one JSON document — maybe JSONL, a line per message.
      var lines = RP.parseChatLog(trimmed);
      if (lines.length) return { kind: 'chatlog', turns: lines, why: 'a JSONL chat log' };
      return { kind: 'json-broken', why: 'a file that starts like JSON but does not parse' };
    }
    var turns = RP.parseTranscript(trimmed, {});
    if (turns.length) return { kind: 'transcript', turns: turns, why: 'a transcript' };
    return { kind: 'unknown', why: 'a file with nothing readable in it' };
  };

  /* ------------------------------------------------------------------ *
   * exports for a writing model — the brief, and the whole thing
   * ------------------------------------------------------------------ */

  /** Everything a writer needs and nothing it does not: no ids, no swipes,
   *  no error notices, no duplicated takes, no settings. Sized to drop into
   *  another model's window. */
  RP.storyBrief = function (state, room, opts) {
    opts = opts || {};
    var cap = opts.budget || 9000;
    var scene = RP.sceneDate(room, state);
    var turns = (room.messages || []).filter(visible);
    var sheets = Object.keys(room.states || {}).map(function (k) { return room.states[k]; })
      .filter(function (s) { return s.present !== false; });
    var book = ((state.book || {}).entries || []).filter(function (e) { return e.roomId === room.id; });
    var out = [];
    out.push('# ' + (room.sceneName || room.title));
    out.push('_A roleplay transcript from the Waluipedia archive, trimmed for writing up._');
    out.push('');
    out.push('**When:** ' + (scene ? RP.formatWahDate(scene) : 'undated') +
      (room.canon === 'continuation' ? ' · continues filed canon' : ''));
    out.push('**Who:**');
    (room.cast || []).forEach(function (c) {
      out.push('- **' + c.name + '** — ' + clip(c.title || c.summary || 'no filing', 160) +
        (c.invented ? ' _(invented in play' + (c.look ? ': ' + clip(c.look, 120) : '') + ')_' : ''));
    });
    if (room.scene) { out.push('', '**The situation:** ' + clip(room.scene.replace(/\s+/g, ' '), 700)); }
    if ((room.beats || []).length) {
      out.push('', '**The script, as it fired:**');
      (room.beats || []).slice(0, room.beatIndex || (room.beats || []).length).forEach(function (b) {
        out.push('- ' + (b.time ? b.time + ' — ' : '') + b.beat);
      });
    }
    out.push('', '## What happened');
    turns.forEach(function (m) {
      var who = m.role === 'user' ? ((state.user && state.user.name) || 'The player')
        : (((room.cast || []).filter(function (c) { return c.id === m.charId; })[0]) || {}).name || 'Someone';
      out.push('**' + who + ':** ' + RP.textOf(m).replace(/\s+/g, ' ').trim());
    });
    if (sheets.length) {
      out.push('', '## Where everyone ended up');
      sheets.forEach(function (s) {
        var bits = [];
        if (s.hp) bits.push('HP ' + s.hp.value + '/' + s.hp.max);
        if (s.mp) bits.push('Energy ' + s.mp.value + '/' + s.mp.max);
        var flags = Object.keys(s.flags || {});
        if (flags.length) bits.push(flags.join(', ').replace(/_/g, ' '));
        if ((s.items || []).length) bits.push('carrying ' + s.items.join(', '));
        if (s.status) bits.push(s.status);
        out.push('- ' + s.name + ': ' + (bits.join(' · ') || 'unmarked'));
      });
    }
    if (book.length) {
      out.push('', '## Established in this scene');
      book.forEach(function (e) {
        out.push('- ' + (RP.BOOK_KINDS[e.kind] || {}).label + ': ' + (e.name || e.when) + ' — ' + e.text);
      });
    }
    out.push('', '---', '_Write this up as prose. Everything above is established; nothing else is._');
    var text = out.join('\n');
    if (text.length <= cap) return text;
    // Too long: keep the head, keep the ending, say what was cut.
    var head = text.slice(0, Math.floor(cap * 0.55));
    var tail = text.slice(-Math.floor(cap * 0.4));
    return head + '\n\n… (' + (text.length - cap) + ' characters of the middle cut for length) …\n\n' + tail;
  };

  /** The whole chat, as a file another chatroom can import. */
  RP.chatExport = function (state, room, opts) {
    opts = opts || {};
    // With `linked`, the second scene travels too — both rooms keep their
    // ids and their linkedTo, so an import on another machine re-links them.
    var other = opts.linked ? RP.linkedRoom(state, room) : null;
    var rooms = other ? [room, other] : [room];
    var inCast = function (id) {
      return rooms.some(function (r) { return (r.cast || []).some(function (c) { return c.id === id; }); });
    };
    var inRooms = function (roomId) { return rooms.some(function (r) { return r.id === roomId; }); };
    var out = {
      kind: 'waluipedia-chatroom-bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      user: state.user,
      rooms: rooms,
      chars: (state.chars || []).filter(function (m) { return inCast(m.id); }),
      lore: state.lore || [],
      book: ((state.book || {}).entries || []).filter(function (e) {
        return inRooms(e.roomId) || !e.roomId;
      }),
      newChars: (state.newChars || []).filter(function (c) { return inCast(c.id); }),
      log: (state.log || []).filter(function (e) { return inRooms(e.roomId); }),
    };
    if (other) out.link = { a: room.id, b: other.id, mode: room.linkMode || '' };
    return out;
  };



  /* ------------------------------------------------------------------ *
   * editing what has already been said
   *
   * Everything in a chat is the reader's to change: a line can be edited,
   * muted (left on screen, taken out of the model's head) or deleted
   * outright, and the room can be told how far back the model may look.
   * ------------------------------------------------------------------ */

  RP.findMessage = function (room, id) {
    return ((room && room.messages) || []).filter(function (m) { return m.id === id; })[0] || null;
  };

  /** Rewrite a turn. The edited text becomes the take on screen; the
   *  alternatives it had are dropped, because they are no longer true. */
  RP.editMessage = function (room, id, text) {
    var msg = RP.findMessage(room, id);
    if (!msg) return null;
    msg.text = String(text);
    msg.alts = [msg.text];
    msg.alt = 0;
    msg.edited = Date.now();
    room.updated = Date.now();
    return msg;
  };

  /** Keep it on screen, keep it out of the prompt. */
  RP.muteMessage = function (room, id, muted) {
    var msg = RP.findMessage(room, id);
    if (!msg) return null;
    msg.muted = muted === undefined ? !msg.muted : Boolean(muted);
    room.updated = Date.now();
    return msg;
  };

  RP.deleteMessage = function (room, id) {
    var before = ((room && room.messages) || []).length;
    room.messages = (room.messages || []).filter(function (m) { return m.id !== id; });
    room.updated = Date.now();
    return before - room.messages.length;
  };

  /** Drop a run of turns — what an import leaves behind when you decide
   *  you did not want it after all. */
  RP.deleteMessages = function (room, test) {
    var before = (room.messages || []).length;
    room.messages = (room.messages || []).filter(function (m) { return !test(m); });
    room.bookAt = Math.min(Number(room.bookAt || 0), (room.messages || []).filter(visible).length);
    room.updated = Date.now();
    return before - room.messages.length;
  };

  /** How much of the chat the model is allowed to see. */
  RP.contextLimit = function (room, fallback) {
    var n = Number((room && room.contextLimit) || 0);
    return n > 0 ? n : (fallback || 24);
  };

  /* ---- smart filing: a long import does not need 104 calls ---- */

  // Words that mean a turn is establishing something, rather than banter.
  var DENSE = /\b(named?|called|signed|filed|dated|paid|killed|burned|stole|built|opened|closed|arrived|left|died|swore|agreed|refused|carried|found)\b/i;

  function chunkScore(turns) {
    var text = turns.map(function (t) { return t.text || ''; }).join(' ');
    var score = 0;
    score += (text.match(/\b[A-Z][a-z]{3,}\b/g) || []).length;          // names and places
    score += (text.match(/\b\d{1,4}\b/g) || []).length * 0.5;           // dates, counts, money
    score += (text.match(/"|“/g) || []).length * 0.3;                   // things said out loud
    if (DENSE.test(text)) score += 6;
    return score / Math.max(1, turns.length / 4);
  }

  /** Plan a catch-up that fits a budget. Rather than reading every stretch
   *  of a 300-turn import, it reads BIGGER stretches, keeps the end of the
   *  chat (which is what the next turn follows on from) and spends what is
   *  left on the densest parts of the middle. */
  RP.smartBacklog = function (room, opts) {
    opts = opts || {};
    var maxCalls = Math.max(1, Number(opts.maxCalls || 6));
    var turns = (room.messages || []).filter(visible);
    var from = Number(room.bookAt || 0);
    var pending = turns.slice(from);
    if (!pending.length) return { jobs: [], chunk: 0, covered: 0, pending: 0 };
    // One chunk per call, sized so the whole backlog is covered — capped so
    // a chunk still fits a small model's window.
    var chunk = Math.min(Number(opts.maxChunk || 30), Math.max(Number(opts.minChunk || 6), Math.ceil(pending.length / maxCalls)));
    var slices = [];
    for (var at = 0; at < pending.length; at += chunk) {
      slices.push({ from: from + at, turns: pending.slice(at, at + chunk) });
    }
    if (slices.length <= maxCalls) {
      return { jobs: slices, chunk: chunk, covered: pending.length, pending: pending.length, skipped: 0 };
    }
    // Too many even then: keep the last two (the live end of the story) and
    // pick the densest of the rest.
    var tail = slices.slice(-2);
    var rest = slices.slice(0, -2).map(function (slice) {
      return { slice: slice, score: chunkScore(slice.turns) };
    }).sort(function (a, b) { return b.score - a.score; })
      .slice(0, Math.max(0, maxCalls - tail.length))
      .map(function (x) { return x.slice; });
    var picked = rest.concat(tail).sort(function (a, b) { return a.from - b.from; });
    var covered = picked.reduce(function (n, slice) { return n + slice.turns.length; }, 0);
    return {
      jobs: picked, chunk: chunk, covered: covered, pending: pending.length,
      skipped: pending.length - covered,
    };
  };


  /* ------------------------------------------------------------------ *
   * how long a turn should be
   *
   * A local model left to itself writes six paragraphs of weather. Most
   * of a chat should be short: people talk in sentences, not essays. The
   * world's own turns are allowed more room, because describing a place
   * is the one job that needs it.
   * ------------------------------------------------------------------ */

  RP.LENGTHS = {
    snappy: {
      name: 'Snappy', words: '2 to 4 sentences', sentences: [2, 4], tokens: 420,
      dir: 'Write 2 to 4 SENTENCES. Count them. One or two beats of action or speech and nothing else — no ' +
        'scene-setting, no weather, no summarising how anyone feels about it.',
    },
    normal: {
      name: 'Normal', words: '4 to 7 sentences', sentences: [4, 7], tokens: 700,
      dir: 'Write 4 to 7 SENTENCES. Count them. One moment, played properly. Cut anything that is only atmosphere.',
    },
    rich: {
      name: 'Rich', words: '8 to 14 sentences', sentences: [8, 14], tokens: 1200,
      dir: 'Write 8 to 14 SENTENCES — two or three short paragraphs. Count them, and stop at the end of a sentence. ' +
        'Detail that does something, not description for its own sake.',
    },
    // The band that is not a band: the model sizes the turn to the moment.
    // A retort stays a retort; a reveal, a move, a new room gets the space
    // it needs. The old snappy voice at the small end, room at the big one.
    adaptive: {
      name: 'Let the scene decide', words: '2 sentences to 2 paragraphs, as the moment asks', sentences: [2, 12], tokens: 1000,
      dir: 'SIZE THE TURN TO THE MOMENT. A quick exchange — a retort, an answer, a look — is 2 or 3 SENTENCES. A turn ' +
        'where something HAPPENS — a move, a reveal, a new place, a plan or a fight turning — takes a paragraph, two at ' +
        'most (12 sentences). Decide which before you write; never pad a small moment, never rush a big one.',
    },
  };
  RP.DEFAULT_LENGTH = 'adaptive';

  /* Whatever the band, a turn has to DO something. The small models this
   * runs on will happily shout a quip back for twenty turns while nothing
   * in the room changes; this rides in the protected tail of every prompt
   * so the length instruction never reads as "be brief and say nothing". */
  RP.MOVE_RULE = 'WHATEVER THE LENGTH, MOVE THE SCENE: answer the specific thing just said or done, and leave one concrete ' +
    'thing changed — a decision, a door, a price, a name given up. A quip, a shout or a reaction on its own is not a turn.';

  /** Did the model run out of room rather than finish? A reply that ends
   *  without terminal punctuation, inside an open quote, or on a comma or a
   *  conjunction was cut off, not concluded. */
  /** How many sentences a turn actually came back with. */
  RP.sentenceCount = function (text) {
    return String(text || '').split(/[.!?…]+[\s"”']*/).filter(function (part) {
      return part.trim().length > 1;
    }).length;
  };

  RP.looksTruncated = function (text) {
    var t = String(text || '').trim();
    if (!t) return false;
    // An odd number of quote marks means somebody is still speaking, however
    // the line happens to end.
    var doubles = (t.match(/"/g) || []).length + (t.match(/[“”]/g) || []).length;
    if (doubles % 2 !== 0) return true;
    if (/[.!?…”"'*\)\]]$/.test(t)) return false;
    if (/[,;:—-]$/.test(t)) return true;
    if (/\b(and|but|the|a|an|of|to|in|with|that|as|into|from|for|his|her|their|its|was|were|is|are)$/i.test(t)) return true;
    return !/[.!?…]$/.test(t);
  };

  /** Cut back to the last complete sentence — the last resort when the
   *  model will not finish, so the reader never sees a dangling fragment. */
  RP.trimDangling = function (text) {
    var t = String(text || '').trim();
    if (!RP.looksTruncated(t)) return t;
    var at = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'), t.lastIndexOf('…'));
    // Keep the cut only if it leaves something worth reading behind.
    if (at > 0 && at >= Math.min(60, t.length * 0.25)) return t.slice(0, at + 1).trim();
    return t;
  };

  /** Join a reply to its continuation without repeating the seam. */
  RP.stitch = function (head, tail) {
    var a = String(head || '').trim(), b = String(tail || '').trim();
    if (!b) return a;
    if (!a) return b;
    // The model often repeats the last few words before carrying on.
    for (var n = Math.min(80, a.length, b.length); n > 12; n--) {
      if (a.slice(-n).toLowerCase() === b.slice(0, n).toLowerCase()) { b = b.slice(n).trim(); break; }
    }
    if (!b) return a;
    var joiner = /[.!?…"”'*\)\]]$/.test(a) ? ' ' : (/^[a-z,;]/.test(b) ? ' ' : ' ');
    return (a + joiner + b).replace(/\s+([,.;:!?])/g, '$1').trim();
  };

  /** What to say when asking for the rest of it. */
  RP.continueNudge = function (partial) {
    return 'Your last turn was cut off at "' + clip(String(partial).slice(-120), 120) + '". ' +
      'Continue from exactly that point and finish the thought. Do not start again, do not repeat a word of it, ' +
      'do not summarise it — write only what comes next, and bring it to a proper stop.';
  };

  /** The length instruction for a turn. Characters get the reader's dial;
   *  the world gets one step more room, because that is its job. */
  RP.lengthBlock = function (level, isWorld) {
    var keys = ['snappy', 'normal', 'rich'];
    var key;
    if (level === 'adaptive') {
      // Sized to the moment either way: a world turn that only needs two
      // sentences gets two, one that opens a new place gets its paragraphs.
      key = 'adaptive';
    } else {
      var at = Math.max(0, keys.indexOf(RP.LENGTHS[level] ? level : 'snappy'));
      if (isWorld) at = Math.min(keys.length - 1, at + 1);
      key = keys[at];
    }
    var band = RP.LENGTHS[key];
    return {
      key: key, tokens: band.tokens,
      text: 'LENGTH\n' + band.dir +
        '\n' + RP.MOVE_RULE +
        '\nTHE LAST SENTENCE MUST BE A WHOLE SENTENCE. Count as you go, and when you reach the last one, finish it ' +
        'and stop. Never end on a comma, a conjunction, or an open quotation mark. A turn that trails off ' +
        'mid-clause is a broken turn — it is better to write one sentence fewer and land it.',
    };
  };

  /* ------------------------------------------------------------------ *
   * the world turn — when nobody else is in the room
   *
   * A scene with one player and no other characters used to sit there. The
   * world speaks instead: it describes what is happening around you, in
   * second person, and moves the hour along. It never speaks for you.
   * ------------------------------------------------------------------ */

  RP.WORLD = { id: 'world', name: 'The Director', title: 'Narration', world: true };

  /* The narrator has a voice, and you choose which one. */
  RP.NARRATORS = {
    director: {
      name: 'The Director', icon: '\u25cd', length: 'normal',   // 4-7 sentences, ~700 tokens: a scene, not a five-minute monologue
      blurb: 'Cinematic, deadpan, neo-noir. Draws detail out and lets silence do work.',
      dir: [
        'You are THE DIRECTOR. Never use film words \u2014 no "cut to", no "close up", no "camera" \u2014 you get the',
        'same effect out of prose.',
        'SENSORY FOCUS. Point attention like a lens. When a detail matters, give it intimately: the smear of ink on a',
        'page, the exact temperature of the wind, a watch ticking out of step.',
        'SOUND. Use it to build. A wind that roars and then drops into a silence that is too complete, half a second',
        'before something happens.',
        'PACING AND REVEALS. Draw the suspense out \u2014 but never at the cost of the thing the player actually did.',
        'DRAMATIC IRONY. Let the place react in ways the player has not noticed yet: a shadow a foot too long, birds',
        'leaving a tree nobody touched, one footstep out of time with the others.',
        'TONE. Deadpan, eerie, neo-noir. Treat the archive\u2019s material with complete seriousness, however silly the',
        'names are.',
      ].join('\n'),
    },
    plain: {
      name: 'The world', icon: '\u25cd', length: 'normal',
      blurb: 'Neutral narration: what is there, what changes, nothing louder than that.',
      dir: 'Describe plainly and concretely. No mood-setting for its own sake, no adjectives doing the work of events.',
    },
    terse: {
      name: 'The room', icon: '\u25ab', length: 'snappy',
      blurb: 'One or two sentences. Facts, movement, and out.',
      dir: 'Two sentences at most. What happened, and what is different now. No atmosphere, no lingering.',
    },
    archivist: {
      name: 'The archive', icon: '\u00a7', length: 'normal',
      blurb: 'Filed narration: dated, specific, dry, with the archivist\u2019s asides.',
      dir: 'Narrate as though filing it: dated where a date is known, named objects, exact numbers, and the dry aside '
        + 'of somebody who has written up too many of these.',
    },
  };

  RP.narrator = function (state) {
    var key = (state && state.settings && state.settings.narrator) || 'director';
    return RP.NARRATORS[key] ? key : 'director';
  };

  /** The band a world turn is written in: the narrator's own, unless the
   *  reader has let the scene decide — then the Director sizes to the
   *  moment too. The terse room stays terse; that is its whole point. */
  RP.worldLength = function (state) {
    var voice = RP.NARRATORS[RP.narrator(state)] || RP.NARRATORS.director;
    var set = (state && state.settings && state.settings.length) || RP.DEFAULT_LENGTH;
    return (set === 'adaptive' && voice.length !== 'snappy') ? 'adaptive' : voice.length;
  };

  /** The facts a scene has nailed down: where you are, what you are
   *  wearing, what time it is. Filed once, then unchangeable. */
  RP.factsBlock = function (room) {
    var facts = room && room.facts ? Object.keys(room.facts) : [];
    if (!facts.length && !(room && room.clock)) return '';
    var lines = facts.map(function (k) { return '- ' + k.replace(/_/g, ' ') + ': ' + room.facts[k]; });
    if (room.clock) lines.unshift('- the time: ' + room.clock);
    return [
      'FIXED FACTS — established in this scene and NOT open to revision. Do not rename them, move them, or dress',
      'the player differently. If the story changes one of them, say so plainly and file the change.',
      lines.join('\n'),
    ].join('\n');
  };

  /** What the scene has already established, so it is not established
   *  twice. The cloak, the moon and the patio get described ONCE. */
  RP.continuityBlock = function (room, limit) {
    var said = (room.messages || []).filter(function (m) { return m.role === 'world' && !m.muted; }).slice(-(limit || 2));
    if (!said.length) return '';
    return [
      'ALREADY DESCRIBED \u2014 this is set, and the reader has read it. Do not describe any of it again, do not rename',
      'the place, do not re-dress the player, do not re-hang the moon. Refer back in passing at most, and spend this',
      'turn on what is NEW.',
      said.map(function (m) { return '- ' + clip(RP.textOf(m).replace(/[*_]/g, ''), 420); }).join('\n'),
    ].join('\n');
  };

  /** Direct questions the player asked in character get answered once. */
  RP.askedBlock = function (room) {
    var msgs = (room.messages || []).filter(function (m) { return m.role === 'user'; });
    var last = msgs[msgs.length - 1];
    if (!last) return '';
    var asks = RP.textOf(last).split(/(?:[.!?]|\n)+/).filter(function (line) {
      return /\?/.test(line) || /^\s*(what|where|who|how|why|when)\b/i.test(line);
    }).slice(0, 4);
    if (!asks.length) return '';
    return 'THE PLAYER ASKED THESE DIRECTLY \u2014 answer every one of them concretely inside the prose this turn, '
      + 'and then never restate them:\n' + asks.map(function (a) { return '- ' + clip(a, 160); }).join('\n');
  };

  /** The rule that makes narration useful: it resolves what the player
   *  actually did. Whether it goes well is the roll\u2019s business. */
  var RESOLVE = [
    'DO THE THING THEY DID. This is the part narration usually dodges, and dodging it is not allowed here.',
    'If they read something, invent and show what it actually says \u2014 the real words, quoted, specific, and',
    'relevant to what is going on. If they search, say what is found, or plainly not found. If they open, unlock,',
    'listen, count or ask, resolve it in this turn. Never replace their action with weather.',
    'Then, and only then, let something move.',
    'You may make it cost them, go wrong, or turn up something they did not want \u2014 but you may not skip it.',
    '',
    'FILE WHAT YOU NAME. The first time you name where they are, what they are wearing, or what time it is, put it',
    'on its own line so it cannot drift later:',
    '  [[SET: place = the stone patio of the outpost]]',
    '  [[SET: wearing = a heavy fur-lined travelling cloak]]',
    '  [[TIME: a little after midnight]]',
    'Never write any other double-bracketed text into the prose.',
  ].join('\n');

  /** The character the reader is playing, if they have starred one. */
  RP.playerCharacter = function (room) {
    if (!room || !room.youPlay) return null;
    return (room.cast || []).filter(function (c) { return c.id === room.youPlay; })[0] || null;
  };

  /** Everyone the model may speak as — the player's own character is not
   *  on this list. */
  RP.speakableCast = function (room) {
    return RP.presentCast(room).filter(function (c) { return c.id !== (room && room.youPlay); });
  };

  RP.markPlayer = function (room, charId) {
    room.youPlay = room.youPlay === charId ? '' : String(charId || '');
    if (room.next === room.youPlay) room.next = '';
    room.updated = Date.now();
    return room.youPlay;
  };

  /** The narrator's prompt. It is the same world, the same lore, the same
   *  state — but it is a camera, not a person. */
  RP.worldPrompt = function (state, room, opts) {
    opts = opts || {};
    var voice = RP.NARRATORS[RP.narrator(state)];
    var you = RP.playerCharacter(room);
    var others = RP.speakableCast(room);
    return [
      'You are ' + voice.name.toUpperCase() + ' \u2014 the narration around the player, not a character in it.',
      '',
      voice.dir,
      '',
      'Write in the PRESENT TENSE and address the player as "you".',
      you ? 'The player is playing ' + you.name + ' \u2014 ' + clip(you.title || you.summary, 200) +
        '. Never write their speech, their thoughts or their decisions; describe what happens around them and what '
        + 'they can see, hear and feel, and leave every choice to them.'
        : 'Never write the player\u2019s speech, thoughts or decisions.',
      others.length
        ? 'Other people are here: ' + others.map(function (c) { return c.name; }).join(', ')
          + '. Show them from the outside; they speak for themselves on their own turns.'
        : '',
      '',
      RESOLVE,
      '',
      'Never end on a question, never ask what the player would like to do, and never summarise what has already',
      'happened. Something should be different by the end of the turn.',
      'No stage directions in asterisks \u2014 this is narration; write it plainly.',
    ].filter(Boolean).join('\n');
  };

  /** The whole system prompt for a world turn: the narrator brief, then the
   *  same reference material a character gets. */
  RP.worldSystem = function (state, room, opts) {
    opts = opts || {};
    var parts = [RP.worldPrompt(state, room, opts)];
    if (room.scene) parts.push('THE SCENE\n' + clip(room.scene, 900));
    var worldMeanwhile = RP.meanwhileBlock(state, room);
    if (worldMeanwhile) parts.push(worldMeanwhile);
    var worldSource = RP.sourceBlock(room, opts.archive);
    if (worldSource) parts.push(worldSource);
    var worldKeys = RP.keywordBlock(state, opts.recent || RP.historyFor(room, 4).map(function (m) { return m.content; }).join(' '));
    if (worldKeys) parts.push(worldKeys);
    var fixed = RP.factsBlock(room);
    if (fixed) parts.push(fixed);
    var already = RP.continuityBlock(room);
    if (already) parts.push(already);
    var asked = RP.askedBlock(room);
    if (asked) parts.push(asked);
    var knowledge = RP.knowledgeBlock(state, room, opts.archive);
    if (knowledge) parts.push(knowledge);
    var book = RP.bookBlock(state, room, 10);
    if (book) parts.push(book);
    if (opts.citations) parts.push(opts.citations);
    var script = RP.scriptBlock(room);
    if (script) parts.push(script);
    var worldRecap = RP.recapBlock(room);
    if (worldRecap) parts.push(worldRecap);
    var memory = RP.memoryBlock(state, room.cast, room, 6);
    if (memory) parts.push(memory);
    var protectedFrom = parts.length;
    var worldDirection = RP.directionBlock(room);
    if (worldDirection) parts.push(worldDirection);
    if (opts.ambient) parts.push(RP.liveBlock(room, null, false));
    if (room.mechanics !== 'off') {
      var sheets = RP.stateBlock(room, RP.PLAYER_ID);
      if (sheets) parts.push(sheets);
      var named = RP.mentionBlock(room, opts.mentionText || '');
      if (named) parts.push(named);
      var pinged = RP.pingBlock(state, room, opts.mentions, opts.catalog);
      if (pinged) parts.push(pinged);
      var thinAir = RP.conjureBlock(opts.conjured, opts.conjureVerdict);
      if (thinAir) parts.push(thinAir);
      parts.push(RP.DIRECTIVES);
      var worldWounds = RP.hurtBlock(room, String(opts.mentionText || '') + ' ' + ((room.direction && room.direction.text) || ''));
      if (worldWounds) parts.push(worldWounds);
      var worldBeyond = RP.beyondBlock(opts.fate);
      if (worldBeyond) parts.push(worldBeyond);
      var worldPlayerMood = RP.playerMoodBlock(room);
      if (worldPlayerMood) parts.push(worldPlayerMood);
      var worldPlayerBody = RP.playerBodyBlock(room);
      if (worldPlayerBody) parts.push(worldPlayerBody);
      var worldAuditNotes = RP.auditNoteBlock(room);
      if (worldAuditNotes) parts.push(worldAuditNotes);
    }
    var fate = RP.fateBlock(opts.fate);
    if (fate) parts.push(fate);
    var worldFlourish = RP.flourishBlock(room, opts.fate);
    if (worldFlourish) parts.push(worldFlourish);
    var worldOoc = RP.oocBlock(state, room, opts.notes);
    if (worldOoc) parts.push(worldOoc);
    // The narrator carries its own length: the Director needs room, the
    // room itself needs two sentences.
    parts.push(RP.lengthBlock(RP.worldLength(state), false).text);
    var worldDown = opts.ambientSelf ? '' : RP.downNote(room);
    if (worldDown) parts.push(worldDown);
    return RP.fitPrompt(parts, opts.budget, protectedFrom);
  };

  /** Should the world take this turn? It always does when the player is
   *  alone, and otherwise only when the director asks for it. */
  RP.worldShouldSpeak = function (state, room) {
    if ((state.settings && state.settings.world) === 'off') return false;
    return RP.speakableCast(room).length === 0;
  };

  /** Nobody had to answer — but the scene should not just sit there. With
   *  the world on, it describes what you did and moves the hour; only with
   *  the world off does the turn come straight back to you. */
  RP.fallbackTurn = function (state, room) {
    if ((state.settings && state.settings.world) === 'off') return '';
    return 'world';
  };





  /* ------------------------------------------------------------------ *
   * search — the model can look something up mid-scene
   *
   * Nothing reads a whole filing. A query is scored against every record
   * the page has loaded, the best PASSAGE inside the winners is cut out,
   * and only those passages are handed over. The model can ask for this
   * itself with [[LOOKUP: …]], and file what it learns with [[REMEMBER:]].
   * ------------------------------------------------------------------ */

  var STOP = /^(the|and|for|with|that|this|from|into|what|when|where|who|whom|whose|which|about|there|their|they|them|then|than|have|has|had|was|were|been|being|does|did|done|will|would|could|should|shall|may|might|must|can|are|is|it|its|his|her|our|your|you|i|a|an|of|to|in|on|at|by|as|or|if|but|not|no|yes|do|so|up|out|off|over|under|again|once|here|now)$/i;

  RP.searchTerms = function (query) {
    var seen = {};
    return String(query || '').toLowerCase().split(/[^a-z0-9']+/)
      .filter(function (t) {
        if (t.length < 3 || STOP.test(t) || seen[t]) return false;
        seen[t] = 1;
        return true;
      }).slice(0, 12);
  };

  /** The best few sentences inside a body of prose for these terms. */
  RP.bestPassage = function (body, terms, size) {
    var text = String(body || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    var parts = text.split(/(?<=[.!?])\s+/);
    if (parts.length < 2) return clip(text, size || 320);
    var best = { score: -1, at: 0 };
    for (var i = 0; i < parts.length; i++) {
      var window = parts.slice(i, i + 3).join(' ').toLowerCase();
      var score = 0;
      terms.forEach(function (t) { if (window.indexOf(t) >= 0) score++; });
      if (score > best.score) best = { score: score, at: i };
    }
    if (best.score <= 0) return clip(text, size || 320);
    return clip(parts.slice(best.at, best.at + 3).join(' '), size || 320);
  };

  /** Search everything loaded. Returns records with the passage that
   *  actually matched, not the whole filing. */
  RP.searchArchive = function (index, query, opts) {
    opts = opts || {};
    var terms = RP.searchTerms(query);
    if (!terms.length) return [];
    var scored = [];
    var when = opts.scene ? (typeof opts.scene === 'string' ? RP.parseWahDate(opts.scene) : opts.scene) : null;
    (index || []).forEach(function (r) {
      if (r.noncanon && !opts.includeNonCanon) return;
      // Nothing from after the scene. Reading tomorrow's filing tonight is
      // how a chat ends up quoting a battle that has not happened.
      if (when && r.date && RP.timeRelation(when, r.date).rel === 'future') return;
      var hay = r.words || '';
      var score = 0;
      terms.forEach(function (t) {
        var at = hay.indexOf(t);
        if (at < 0) return;
        score += 1;
        if (String(r.name || '').toLowerCase().indexOf(t) >= 0) score += 2;   // a name match is worth more
      });
      if (!score) return;
      scored.push({ r: r, score: score });
    });
    return scored.sort(function (a, b) { return b.score - a.score; })
      .slice(0, opts.limit || 4)
      .map(function (x) {
        return {
          id: x.r.id, kind: x.r.kind, name: x.r.name,
          date: x.r.date ? RP.formatWahDate(x.r.date) : '',
          snippet: RP.bestPassage(x.r.body || x.r.text, terms, opts.size || 320),
          score: x.score,
        };
      });
  };

  /** A filing NAMED in the scene is not a search problem. The player
   *  wrote “I read the paper titled The Tape and the Wario Files” and
   *  the fuzzy scorer still handed the model three unrelated articles —
   *  so it invented the text it was asked to read aloud. Titles that
   *  appear verbatim in the recent prose are pinned to the top with the
   *  filing's own opening, before any scoring happens. */
  RP.pinNamed = function (text, index, opts) {
    opts = opts || {};
    var hay = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
    if (hay.trim().length < 8) return [];
    var when = opts.scene ? (typeof opts.scene === 'string' ? RP.parseWahDate(opts.scene) : opts.scene) : null;
    var out = [];
    (index || []).forEach(function (r) {
      if (out.length >= (opts.limit || 2)) return;
      if (r.noncanon && !opts.includeNonCanon) return;
      if (when && r.date && RP.timeRelation(when, r.date).rel === 'future') return;
      var name = String(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (name.length < 8 || name.split(' ').length < 2) return;   // short names match by accident
      if (hay.indexOf(name) < 0) return;
      out.push({
        id: r.id, kind: r.kind, name: r.name,
        date: r.date ? RP.formatWahDate(r.date) : '',
        snippet: clip(String(r.body || r.text || '').replace(/\s+/g, ' ').trim(), opts.size || 700),
        named: true,
      });
    });
    return out;
  };

  /** What a search hands the model. */
  RP.retrievalBlock = function (results, query) {
    if (!results || !results.length) {
      return query ? 'YOU SEARCHED THE ARCHIVE FOR "' + clip(query, 80) + '" AND IT HAS NOTHING.\n' +
        'Say so in character rather than inventing a filing.' : '';
    }
    var anyNamed = results.some(function (r) { return r.named; });
    return [
      'FROM THE ARCHIVE' + (query ? ' — searched just now for "' + clip(query, 80) + '"' : ' — relevant to this moment'),
      'These are real passages out of real filings. Quote them, date them, argue with them — but do not invent',
      'around them, and do not pretend to know more of the file than is here.',
      anyNamed ? 'A filing marked ★ was NAMED in the scene. When the player reads from it or asks about it, read' +
        ' from THIS text — never invent its contents.' : '',
      'Weave at least ONE concrete thing out of them into this turn — a name, a date, a number, a phrase quoted or',
      'misquoted in character. A passage read and not used is a wasted turn.',
      results.map(function (r) {
        return '- ' + (r.named ? '★ ' : '') + '[' + r.kind + ':' + r.id + '] ' + r.name + (r.date ? ' (' + r.date + ')' : '') + '\n    “' + r.snippet + '”';
      }).join('\n'),
    ].filter(Boolean).join('\n');
  };

  /* ------------------------------------------------------------------ *
   * the session's own source — what this scene actually is
   *
   * A chat started from a filed event was only ever given that event's
   * one-line summary. The cast could not "pull from" the material because
   * the material was not in the prompt. It is now.
   * ------------------------------------------------------------------ */

  RP.sourceRecord = function (room, archive) {
    if (!room || !room.sourceId || !archive) return null;
    var want = slug(room.sourceId);
    return (archive.events || []).filter(function (e) {
      return slug(e.id) === want || slug(e.name) === want;
    })[0] || null;
  };

  /** The dossier for the filing this session came out of: what happened,
   *  where, when, who was in it and what it did to them. */
  RP.sourceBlock = function (room, archive) {
    var e = RP.sourceRecord(room, archive);
    if (!e) return '';
    var beats = ((e.timeline || {}).entries || []).slice(0, 8).map(function (b) {
      return '  - ' + (b.time ? b.time + ' — ' : '') + clip(b.beat, 120) + (b.detail ? '. ' + clip(b.detail, 200) : '');
    });
    var people = (e.participants || []).slice(0, 8).map(function (p) {
      return '  - ' + clip(p.name, 60) + (p.role ? ' — ' + clip(p.role, 200) : '');
    });
    return [
      'WHAT THIS SESSION IS — the filed record this scene comes out of. Everybody here lived it; use the names, the',
      'dates and the details, and never contradict them.',
      'Filing: ' + clip(e.name, 90) + (e.date ? ' (' + clip(e.date, 70) + ')' : ''),
      e.location ? 'Where: ' + clip(e.location, 160) : '',
      e.summary ? 'What happened: ' + clip(e.summary, 700) : '',
      e.outcome ? 'How it ended: ' + clip(e.outcome, 500) : '',
      e.aftermath ? 'What it left behind: ' + clip(String(e.aftermath).replace(/[*#>]/g, ''), 500) : '',
      people.length ? 'Who was in it:\n' + people.join('\n') : '',
      beats.length ? 'How it ran:\n' + beats.join('\n') : '',
    ].filter(Boolean).join('\n');
  };

  /* ---- who actually wrote that line? ---- */

  /** A small model handed a six-hander will sometimes write the wrong
   *  character — usually whoever spoke last. If the prose is plainly
   *  somebody else's, say so, and the page re-labels the card rather than
   *  lying about who spoke. */
  RP.checkSpeaker = function (text, speaker, cast, opts) {
    var body = String(text || '').trim();
    if (!body) return { ok: false, empty: true };
    var mine = String((speaker && speaker.name) || '').toLowerCase();
    var head = body.slice(0, 220).toLowerCase();
    var others = (cast || []).filter(function (c) {
      return c.id !== (speaker && speaker.id) && String(c.name || '').length > 2;
    });
    // "Wario growls", "Wario stands", "Wario:" at the head of the reply.
    var actual = null;
    others.forEach(function (c) {
      if (actual) return;
      var name = c.name.toLowerCase();
      var at = head.indexOf(name);
      if (at < 0 || at > 40) return;
      var after = head.slice(at + name.length, at + name.length + 14);
      if (/^\s*(:|says|said|growls|grunts|shrugs|stands|leans|pushes|paces|spits|laughs|nods|turns|steps|slams|mutters|barks|snaps)/.test(after)) {
        actual = c;
      }
    });
    if (!actual) return { ok: true };
    // If the speaker is in it too, it is a scene, not a misattribution.
    if (mine && head.indexOf(mine) >= 0) return { ok: true };
    // Writing the PLAYER's character is not a mislabel to be filed away —
    // it is the one thing the model is never allowed to do.
    if (opts && opts.youPlay && actual.id === opts.youPlay) {
      return { ok: false, playerVoice: true, actual: actual };
    }
    return { ok: false, actual: actual };
  };

  /* ------------------------------------------------------------------ *
   * the audit — what does not add up in this chat
   *
   * Dates that sit after the scene, lore filed under the wrong day, cast
   * standing in a room they have not spoken in for twenty turns. All of
   * it checkable, and all of it fixable in one press.
   * ------------------------------------------------------------------ */

  RP.QUIET_TURNS = 6;      // silence after which somebody is probably not here

  RP.auditRoom = function (state, room, archive) {
    var scene = RP.sceneDate(room, state, archive);
    var out = { scene: scene, dates: [], quiet: [], future: [], book: [] };
    var turns = (room.messages || []).filter(visible);

    // Cast who have not said a word, and are not being talked about.
    var recentText = turns.slice(-RP.QUIET_TURNS).map(function (m) { return RP.textOf(m); }).join(' ').toLowerCase();
    RP.presentCast(room).forEach(function (c) {
      if (c.id === room.youPlay) return;
      var lastSpoke = -1;
      turns.forEach(function (m, i) { if (m.role === 'char' && m.charId === c.id) lastSpoke = i; });
      var silence = lastSpoke < 0 ? turns.length : turns.length - 1 - lastSpoke;
      if (silence >= RP.QUIET_TURNS && recentText.indexOf(c.name.toLowerCase()) < 0) {
        out.quiet.push({ id: c.id, name: c.name, silence: silence });
      }
    });

    // The room's own date against the filing it came from.
    var record = archive ? RP.sourceRecord(room, archive) : null;
    if (record && record.date && scene) {
      var filed = RP.parseWahDate(record.date);
      if (filed && RP.dayOrdinal(filed) !== RP.dayOrdinal(scene)) {
        out.dates.push({
          what: 'the scene', is: RP.formatWahDate(scene), should: RP.formatWahDate(filed),
          why: 'the filing “' + clip(record.name, 60) + '” is dated ' + clip(record.date, 60),
        });
      }
    }

    // Lore-book pages filed under a date that is after the scene.
    ((state.book || {}).entries || []).forEach(function (page) {
      if (page.roomId !== room.id || !page.when || !scene) return;
      var rel = RP.timeRelation(scene, page.when);
      if (rel.rel === 'future') out.book.push({ id: page.id, name: page.name, when: page.when });
    });

    out.ok = !out.dates.length && !out.quiet.length && !out.book.length;
    return out;
  };

  /** Fix what the audit found: correct the date, write the silent out of
   *  the scene, and re-stamp any page filed in the future. */
  RP.applyAudit = function (state, room, report, opts) {
    opts = opts || {};
    var done = [];
    if (opts.dates !== false && report.dates.length) {
      room.date = report.dates[0].should;
      done.push('dated the scene ' + room.date);
    }
    if (opts.quiet !== false) {
      report.quiet.forEach(function (who) {
        RP.setPresent(room, who.id, false);
        done.push(who.name + ' is no longer in the scene');
      });
    }
    if (opts.book !== false && report.book.length) {
      var stamp = room.date || (report.scene ? RP.formatWahDate(report.scene) : '');
      ((state.book || {}).entries || []).forEach(function (page) {
        if (report.book.some(function (b) { return b.id === page.id; })) page.when = stamp;
      });
      done.push(report.book.length + ' page' + (report.book.length === 1 ? '' : 's') + ' re-dated');
    }
    room.updated = Date.now();
    return done;
  };

  /* ------------------------------------------------------------------ *
   * privacy, presence, and talking to the model out of character
   *
   * A quiet moment is not an invitation for three people to walk in. Who
   * can speak is decided by who is actually PRESENT, and by whether the
   * scene is private — and the player can say so directly, in brackets,
   * without breaking the fiction on the page.
   * ------------------------------------------------------------------ */

  /** Out-of-character instructions in a turn: ((like this)), /ooc like
   *  this, or [[OOC: like this]]. They are pulled out of the prose and
   *  handed to the model as orders, not as something a character said. */
  RP.parseOoc = function (text) {
    var notes = [];
    // One pass, so the notes come back in the order they were written.
    var clean = String(text || '').replace(
      /\(\(([^)]*)\)\)|\[\[\s*OOC\s*:\s*([^\]]*)\]\]|^[ \t]*\/ooc[ \t]+(.*)$/gim,
      function (all, a, b, c) {
        notes.push(String(a || b || c || '').trim());
        return '';
      })
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { clean: clean, notes: notes.filter(Boolean).map(function (n) { return clip(n, 300); }) };
  };

  /** Everything the player has told the model directly: the standing note
   *  for this chat, the global one, and anything said in brackets on this
   *  turn. Never trimmed — instructions outrank reference material. */
  RP.oocBlock = function (state, room, turnNotes) {
    var lines = [];
    var global = clip((state.settings && state.settings.note) || '', 400);
    var here = clip((room && room.note) || '', 400);
    if (global) lines.push(global);
    if (here) lines.push(here);
    (turnNotes || []).forEach(function (n) { lines.push(n); });
    if (!lines.length) return '';
    return [
      'INSTRUCTIONS FROM THE PLAYER (out of character) — these outrank everything else in this prompt.',
      'They are not spoken aloud, nobody in the scene hears them, and you never refer to them.',
      lines.map(function (l) { return '- ' + l; }).join('\n'),
    ].join('\n');
  };

  /* ---- presence: who is actually in the room ---- */

  /** Cast members who have not been written out of the scene. */
  RP.presentCast = function (room) {
    var states = (room && room.states) || {};
    return (room.cast || []).filter(function (c) {
      var sheet = states[c.id];
      return !sheet || sheet.present !== false;
    });
  };

  /** Remove somebody from the room entirely: cast, sheet, away list,
   *  and the star if it was theirs. The archive record is untouched —
   *  this deletes a seat at the table, not a person. Returns the name. */
  RP.castRemove = function (room, id) {
    if (!room || !id || id === RP.PLAYER_ID) return '';
    var name = '';
    room.cast = (room.cast || []).filter(function (c) {
      if (c.id !== id) return true;
      name = c.name; return false;
    });
    if (room.states && room.states[id]) { name = name || room.states[id].name; delete room.states[id]; }
    room.away = (room.away || []).filter(function (a) { return (a && a.id) !== id; });
    if (room.youPlay === id) room.youPlay = '';
    if (room.next === id) room.next = '';
    return name;
  };

  RP.setPresent = function (room, charId, present) {
    RP.ensureSheets(room);
    var sheet = room.states[charId];
    if (!sheet) return null;
    sheet.present = present === undefined ? sheet.present === false : Boolean(present);
    if (!sheet.present && room.next === charId) room.next = '';
    room.updated = Date.now();
    return sheet.present;
  };

  /* ---- privacy: a quiet moment stays quiet ---- */

  var PRIVATE_RE = /\b(to myself|under my breath|quietly|silently|privately|alone|in my head|without looking up|do not look up|don'?t look up|mutter|whisper|think to myself)\b/i;
  var PUBLIC_RE = /\b(shout|yell|call out|announce|says? to|ask(?:s|ed)? (?:him|her|them|everyone)|turn to|address)\b/i;

  /** Does this turn read as private? Used to stop the sequencer walking
   *  three people into somebody reading their own notes at midnight. */
  RP.privacyHint = function (text) {
    var t = String(text || '');
    if (PUBLIC_RE.test(t)) return 'open';
    if (PRIVATE_RE.test(t)) return 'private';
    return '';
  };

  /** Is the scene closed to other voices right now? The room's own setting
   *  wins; otherwise the turn decides. */
  RP.isPrivate = function (room, text) {
    if (room && room.privacy === 'private') return true;
    if (room && room.privacy === 'open') return false;
    return RP.privacyHint(text) === 'private';
  };

  /* ------------------------------------------------------------------ *
   * the sequencer — you write, the scene answers, the scene stops
   *
   * The director picks one speaker at a time, which makes a six-hander
   * feel like a queue. The sequencer plans the whole beat: who answers
   * this turn, in what order, and then it hands back. One planning call
   * buys several turns of reply.
   * ------------------------------------------------------------------ */

  // Two at most: every name on the list is a full-price reply (~4k tokens
  // of prompt each), and four of them made one line of the player's cost
  // half a minute even at full speed.
  RP.SEQUENCE_MAX = 2;

  RP.sequencePrompt = function (room, state, opts) {
    opts = opts || {};
    var cast = RP.speakableCast(room);
    var lastTurn = ((room.messages || []).filter(function (m) { return m.role === 'user'; }).pop() || {});
    var recent = RP.historyFor(room, 6).map(function (m) {
      return (m.role === 'user' ? 'PLAYER: ' : '') + clip(m.content, 300);
    }).join('\n');
    var you = RP.playerCharacter(room);
    return [
      'You are staging one beat of a group scene. Decide who reacts to what the player just did — and who does not.',
      '',
      'THE PEOPLE WHO CAN SPEAK',
      cast.map(function (c) { return '- ' + c.name + (c.title ? ' — ' + c.title : ''); }).join('\n'),
      you ? '\nThe player is playing ' + you.name + '. Never put them in the order.' : '',
      ((state.settings && state.settings.world) !== 'off')
        ? 'You may also use THE WORLD, which is narration: the place, the weather, an arrival, a noise.' : '',
      '',
      'THE LAST FEW TURNS',
      recent,
      '',
      'Answer with ONE line and nothing else:',
      'ORDER: Name, Name, WORLD',
      '  — the people who should react, in the order they should speak, at most ' +
        Math.min(RP.SEQUENCE_MAX, cast.length + 1) + '.',
      'NOBODY',
      '  — when the scene is waiting on the player and nothing needs answering.',
      '',
      'Rules: only people who have a REASON to speak right now — being addressed, contradicted, threatened, or ' +
      'unable to let it stand. Silence is a choice; two people is usually plenty, and one is common. Never list the ' +
      'same person twice.',
      '',
      'READ THE ROOM. A private moment is not an invitation. If the player is reading to themselves, muttering, ' +
      'thinking, grieving, hiding, or plainly alone with something, the answer is NOBODY or WORLD — do not have ' +
      'somebody materialise to comment on it. Only stage a character who is ALREADY in the scene and close enough ' +
      'to hear; nobody walks in from off-stage to deliver a line.',
      RP.privacyHint(RP.textOf(lastTurn)) === 'private'
        ? 'This turn reads as private. Unless somebody in the scene is being directly addressed, answer NOBODY.' : '',
    ].filter(Boolean).join('\n');
  };

  /** Read the staging back as a list of ids. Anything unrecognised means
   *  nobody speaks, which is the safe answer. */
  /** Who the player's line is plainly aimed at: the cast members it names,
   *  in the order named. When this answers the question, the staging call
   *  is not made — "I look at Waluigi" does not need a model to decide
   *  that Waluigi reacts. First names count ("wario" finds "Wario"). */
  RP.addressedIn = function (room, text) {
    var said = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ') + ' ';
    var hits = [];
    RP.speakableCast(room).forEach(function (c) {
      var full = String(c.name || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim();
      if (!full) return;
      var keys = [full].concat(full.split(' ').filter(function (w) { return w.length > 3; }));
      var at = -1;
      keys.forEach(function (k) {
        var i = said.indexOf(' ' + k + ' ');
        if (i >= 0 && (at < 0 || i < at)) at = i;
      });
      if (at >= 0) hits.push({ id: c.id, at: at });
    });
    return hits.sort(function (a, b) { return a.at - b.at; }).map(function (h) { return h.id; }).slice(0, RP.SEQUENCE_MAX);
  };

  RP.parseSequence = function (text, room, state) {
    var raw = String(text || '').trim();
    if (/^\s*NOBODY\s*$/im.test(raw)) return { order: [], reason: 'nobody had to answer that', silent: true };
    var line = /ORDER\s*:\s*([^\n]+)/i.exec(raw);
    // An answer that is not in the format is not a decision to say nothing —
    // it is a model that rambled. The caller falls back to one speaker.
    if (!line) return { order: [], reason: 'the staging could not be read', unparsed: true };
    var cast = RP.speakableCast(room);
    var worldOn = !state || (state.settings && state.settings.world) !== 'off';
    var seen = {}, order = [];
    line[1].split(/[,;]|\band\b|→|->/).forEach(function (part) {
      var want = part.replace(/["'.*\d)]/g, '').trim().toLowerCase();
      if (!want || order.length >= RP.SEQUENCE_MAX) return;
      if (/^(world|the world|narration)$/.test(want)) {
        if (worldOn && !seen.world) { seen.world = 1; order.push('world'); }
        return;
      }
      var hit = cast.filter(function (c) {
        var name = c.name.toLowerCase();
        return name === want || name.indexOf(want) >= 0 || want.indexOf(name) >= 0;
      })[0];
      if (hit && !seen[hit.id]) { seen[hit.id] = 1; order.push(hit.id); }
    });
    return { order: order, reason: order.length ? 'staged' : 'nobody had to answer that' };
  };

  /* ------------------------------------------------------------------ *
   * branching and undo — the timeline is not a one-way street
   * ------------------------------------------------------------------ */

  /** Copy a chat up to and including one message. The original is left
   *  exactly as it was: this is a fork, not a rewrite. */
  RP.forkRoom = function (state, room, messageId, opts) {
    opts = opts || {};
    var at = (room.messages || []).map(function (m) { return m.id; }).indexOf(messageId);
    if (at < 0) at = (room.messages || []).length - 1;
    var copy = JSON.parse(JSON.stringify(room));
    copy.id = uid();
    copy.title = clip(opts.title || (room.title + ' — branch'), 90);
    copy.messages = copy.messages.slice(0, at + 1).map(function (m) {
      m.id = uid();
      return m;
    });
    copy.branchOf = room.id;
    copy.branchAt = messageId;
    copy.linkedTo = '';            // a branch is its own hour; the link stays with the original
    copy.direction = null;
    copy.pinnedNext = '';
    copy.created = Date.now();
    copy.updated = Date.now();
    copy.bookAt = Math.min(Number(room.bookAt || 0), copy.messages.filter(visible).length);
    copy.undo = [];
    state.rooms = [copy].concat(state.rooms || []);
    return copy;
  };

  RP.UNDO_DEPTH = 12;

  /** Remember where the chat was before something changed it. */
  // What one step back restores: the turns, the sheets, the cast and the
  // clock (the AI audit may move it).
  function snapshot(room, label) {
    return {
      label: label, at: Date.now(),
      messages: JSON.stringify(room.messages || []),
      states: JSON.stringify(room.states || {}),
      cast: JSON.stringify(room.cast || []),
      clock: room.clock || '',
      youPlay: room.youPlay || '',
      away: JSON.stringify(room.away || []),
    };
  }

  RP.pushUndo = function (room, label) {
    room.undo = room.undo || [];
    room.undo.push(snapshot(room, clip(label, 60)));
    if (room.undo.length > RP.UNDO_DEPTH) room.undo = room.undo.slice(-RP.UNDO_DEPTH);
    room.redo = [];              // a new action forks away from any redo
    return room.undo.length;
  };

  function restore(room, snap) {
    room.messages = JSON.parse(snap.messages);
    room.states = JSON.parse(snap.states);
    room.cast = JSON.parse(snap.cast);
    if (snap.clock !== undefined) room.clock = snap.clock;
    if (snap.youPlay !== undefined) room.youPlay = snap.youPlay || '';
    if (snap.away !== undefined) room.away = JSON.parse(snap.away);
    if (snap.linkedTo !== undefined) room.linkedTo = snap.linkedTo;   // a merge taken back is two scenes again
    room.updated = Date.now();
  }

  RP.undo = function (room) {
    if (!(room.undo || []).length) return null;
    var snap = room.undo.pop();
    (room.redo = room.redo || []).push(snapshot(room, snap.label));
    restore(room, snap);
    return snap.label || 'the last change';
  };

  RP.redo = function (room) {
    if (!(room.redo || []).length) return null;
    var snap = room.redo.pop();
    (room.undo = room.undo || []).push(snapshot(room, snap.label));
    restore(room, snap);
    return snap.label || 'that';
  };

  /* ------------------------------------------------------------------ *
   * the player's own persona — one sheet, every chat
   * ------------------------------------------------------------------ */

  RP.personaSheet = function (state) {
    state.persona = state.persona || {};
    var p = state.persona;
    p.name = p.name || '';
    p.look = p.look || '';
    p.voice = p.voice || '';
    p.items = p.items || [];
    p.notes = p.notes || '';
    p.hp = p.hp || null;
    return p;
  };

  /** The block that tells the model who you are. Works whether you play an
   *  archive character, your own invention, or nobody in particular. */
  RP.personaBlock = function (persona, state, room) {
    var text = String(persona || '').trim();
    var sheet = state ? RP.personaSheet(state) : null;
    var starred = room ? RP.playerCharacter(room) : null;
    var lines = [];
    if (sheet && sheet.name) {
      lines.push(sheet.name + (sheet.voice ? ' — ' + sheet.voice : ''));
      if (sheet.look) lines.push('Looks like: ' + sheet.look);
      // The kit of record is the live player sheet when the room keeps
      // one — the persona's list only seeds it. Reading the sheet here
      // means the prompt can never say "carrying the key" after the key
      // was handed over three turns ago.
      var live = room && state ? RP.ensurePlayerSheet(state, room) : null;
      // When the reader plays a starred cast member, that character's kit
      // is already on the sheets — here we still describe the persona.
      if (live && live.id !== RP.PLAYER_ID) live = null;
      var kit = (live ? live.items : sheet.items) || [];
      if (kit.length) {
        lines.push('Carrying: ' + kit.map(function (i) {
          var it = RP.normItem(i);
          return it.icon + ' ' + it.name + (it.note ? ' (' + it.note + ')' : '');
        }).join(', '));
      }
      if (sheet.notes) lines.push(sheet.notes);
    }
    if (starred) {
      // The reader is a cast member. The model should know who is in front
      // of it — Wario talks to his brother differently from a stranger.
      lines.push('In this scene they ARE ' + starred.name + (starred.title ? ' \u2014 ' + clip(starred.title, 120) : '') + '.');
      if (starred.summary) lines.push('Who that is: ' + clip(starred.summary, 320));
      lines.push('Call them ' + starred.name + ' (or whatever you would call ' + starred.name + ' to their face). ' +
        starred.name + '\u2019s words, actions and decisions are theirs to write, never yours.');
    }
    if (text) lines.push(text);
    if (!lines.length) return '';
    return 'THE USER PLAYS\n' + lines.join('\n') +
      '\nAddress them as that person; never tell them what they do, say or decide.';
  };

  /** Take a seat as an archive character: they join the cast if they are
   *  not already in it, and the star moves to them. Returns the cast
   *  entry, or null when nothing was handed in. */
  RP.playAs = function (room, char) {
    if (!room || !char) return null;
    var seat = RP.addToRoom(room, char) ? room.cast[room.cast.length - 1]
      : (room.cast || []).filter(function (c) { return c.id === char.id; })[0];
    if (!seat) return null;
    if (room.youPlay !== seat.id) RP.markPlayer(room, seat.id);
    return seat;
  };

  /* ------------------------------------------------------------------ *
   * keyword world info — exact lore, injected the moment it is named
   * ------------------------------------------------------------------ */

  /** A lore node or book page can carry trigger words. When one shows up
   *  in the recent turns, its text goes into the prompt verbatim, so the
   *  model cannot invent a different version of something established. */
  RP.addKeyword = function (state, entry) {
    state.keywords = state.keywords || [];
    var record = {
      id: entry.id || uid(),
      keys: String(entry.keys || '').split(',').map(function (k) { return k.trim(); }).filter(Boolean).slice(0, 8),
      text: clip(entry.text, 600),
      always: Boolean(entry.always),
      at: Date.now(),
    };
    if (!record.keys.length && !record.always) return null;
    state.keywords = state.keywords.filter(function (k) { return k.id !== record.id; });
    state.keywords.push(record);
    state.keywords = state.keywords.slice(-60);
    return record;
  };

  RP.removeKeyword = function (state, id) {
    state.keywords = (state.keywords || []).filter(function (k) { return k.id !== id; });
    return state.keywords.length;
  };

  /** Scan text for triggers. A key beginning and ending with `/` is a
   *  regular expression; everything else matches whole words, case-blind. */
  RP.keywordHits = function (state, text, limit) {
    var hay = ' ' + String(text || '').toLowerCase() + ' ';
    var out = [];
    (state.keywords || []).forEach(function (entry) {
      if (out.length >= (limit || 6)) return;
      if (entry.always) { out.push(entry); return; }
      var hit = entry.keys.some(function (key) {
        var re = /^\/(.+)\/([a-z]*)$/.exec(key);
        if (re) {
          try { return new RegExp(re[1], re[2] || 'i').test(text); } catch (e) { return false; }
        }
        var word = key.toLowerCase();
        var at = hay.indexOf(word);
        while (at >= 0) {
          var before = hay.charAt(at - 1), after = hay.charAt(at + word.length);
          if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
          at = hay.indexOf(word, at + 1);
        }
        return false;
      });
      if (hit) out.push(entry);
    });
    return out;
  };

  RP.keywordBlock = function (state, text, limit) {
    var hits = RP.keywordHits(state, text, limit);
    if (!hits.length) return '';
    return 'ESTABLISHED FACTS ABOUT WHAT WAS JUST MENTIONED — use these exactly, do not invent around them\n' +
      hits.map(function (entry) {
        return '- ' + (entry.keys.length ? '[' + entry.keys[0] + '] ' : '') + entry.text;
      }).join('\n');
  };

  /* ------------------------------------------------------------------ *
   * taste — 👍 and 👎 are training data, not decoration
   *
   * A thumb that only colours in is a wasted signal. Every rating keeps a
   * short excerpt, and those excerpts go back into the prompt: more like
   * the ones you kept, less like the ones you did not.
   * ------------------------------------------------------------------ */

  RP.TASTE_KEEP = 10;      // excerpts held per side

  function tasteState(state) {
    state.taste = state.taste || { likes: [], dislikes: [], chars: {} };
    state.taste.likes = state.taste.likes || [];
    state.taste.dislikes = state.taste.dislikes || [];
    state.taste.chars = state.taste.chars || {};
    return state.taste;
  }
  RP.tasteState = tasteState;

  /** Record a rating. Rating the same message again clears it, and a
   *  rating moves the excerpt from one pile to the other. */
  RP.rate = function (state, room, msg, value) {
    var taste = tasteState(state);
    var text = clip(RP.textOf(msg).replace(/\s+/g, ' '), 320);
    var id = String(msg.id || '');
    function drop(list) { return list.filter(function (x) { return x.id !== id; }); }
    taste.likes = drop(taste.likes);
    taste.dislikes = drop(taste.dislikes);
    msg.react = msg.react === value ? '' : value;
    var per = taste.chars[msg.charId] || (taste.chars[msg.charId] = { up: 0, down: 0 });
    if (msg.react === 'up') {
      taste.likes.push({ id: id, charId: msg.charId, text: text, words: text.split(/\s+/).length, at: Date.now() });
      per.up++;
    } else if (msg.react === 'down') {
      taste.dislikes.push({ id: id, charId: msg.charId, text: text, words: text.split(/\s+/).length, at: Date.now() });
      per.down++;
    }
    taste.likes = taste.likes.slice(-RP.TASTE_KEEP);
    taste.dislikes = taste.dislikes.slice(-RP.TASTE_KEEP);
    return msg.react;
  };

  function averageWords(list) {
    if (!list.length) return 0;
    var total = 0;
    list.forEach(function (x) { total += Number(x.words || 0); });
    return Math.round(total / list.length);
  }

  /** What the model is told about the reader's taste. Excerpts from this
   *  room's cast come first, because taste is partly about who is speaking. */
  RP.tasteBlock = function (state, room, limit) {
    var taste = tasteState(state);
    if (!taste.likes.length && !taste.dislikes.length) return '';
    var ids = ((room && room.cast) || []).map(function (c) { return c.id; });
    var cap = limit || 4;
    function pick(list) {
      // Newest first within each group, and the people in this room win the
      // places — taste is partly about who is speaking.
      var mine = list.filter(function (x) { return ids.indexOf(x.charId) >= 0; }).slice(-cap);
      var rest = list.filter(function (x) { return ids.indexOf(x.charId) < 0; })
        .slice(-Math.max(0, cap - mine.length));
      return mine.concat(rest).slice(0, cap);
    }
    var liked = pick(taste.likes), disliked = pick(taste.dislikes);
    var out = ['WHAT THIS READER KEEPS AND WHAT THEY THROW AWAY — this is feedback on YOUR writing, act on it'];
    if (liked.length) {
      out.push('They marked these GOOD. Write more like them — the same rhythm, register and level of detail:');
      liked.forEach(function (x) { out.push('  + “' + clip(x.text, 220) + '”'); });
    }
    if (disliked.length) {
      out.push('They marked these BAD. Do not write like this again:');
      disliked.forEach(function (x) { out.push('  - “' + clip(x.text, 220) + '”'); });
    }
    // The most useful signal is usually length, and it is the one a small
    // model can actually act on.
    var goodLen = averageWords(liked), badLen = averageWords(disliked);
    if (goodLen) {
      out.push('Their kept replies run about ' + goodLen + ' words. Aim for that.' +
        (badLen && badLen > goodLen * 1.4 ? ' The ones they threw away were much longer — do not pad.' : '') +
        (badLen && badLen < goodLen * 0.7 ? ' The ones they threw away were much shorter — do not be thin.' : ''));
    }
    return out.join('\n');
  };

  /** Per-character score, for the panel. */
  RP.tasteFor = function (state, charId) {
    var per = tasteState(state).chars[charId];
    return per ? { up: per.up || 0, down: per.down || 0 } : { up: 0, down: 0 };
  };

  /* ------------------------------------------------------------------ *
   * the lore book — written while you play, in a queue
   *
   * Roleplay invents faster than anyone files it: a tavern gets a name, a
   * courier gets a face, a debt gets agreed. The lore book catches all of
   * that in the background. A job is queued every few turns, one model
   * call runs at a time, and there is a hard budget so a laptop running a
   * 7B model does not fall over. Newest entries append at the BOTTOM: the
   * book reads forward, like a book.
   * ------------------------------------------------------------------ */

  RP.BOOK_KINDS = {
    place:  { label: 'Place',  icon: '📍' },
    person: { label: 'Person', icon: '👤' },
    event:  { label: 'Event',  icon: '⚑' },
    thing:  { label: 'Thing',  icon: '🗝' },
    fact:   { label: 'Fact',   icon: '§' },
    diary:  { label: 'Diary',  icon: '📔' },
  };

  RP.BOOK_MAX = 300;        // entries kept before the oldest are dropped
  RP.QUEUE_MAX = 6;         // jobs allowed to pile up
  RP.BOOK_BUDGET = 40;      // background calls allowed per browser session

  function bookState(state) {
    state.book = state.book || { entries: [], queue: [], spent: 0 };
    state.book.entries = state.book.entries || [];
    state.book.queue = state.book.queue || [];
    return state.book;
  }
  RP.bookState = bookState;

  /** File one entry at the bottom of the book. Same name and kind twice is
   *  an update, not a duplicate — the book grows, it does not repeat. */
  RP.bookAdd = function (state, entry) {
    var book = bookState(state);
    var name = clip(entry.name, 90);
    var kind = RP.BOOK_KINDS[entry.kind] ? entry.kind : 'fact';
    if (!name && kind !== 'diary') return null;
    var existing = book.entries.filter(function (e) {
      return e.kind === kind && e.name.toLowerCase() === name.toLowerCase();
    })[0];
    if (existing) {
      var add = clip(entry.text, 400);
      if (add && existing.text.toLowerCase().indexOf(add.toLowerCase()) < 0) {
        existing.text = clip(existing.text + ' ' + add, 700);
      }
      existing.seen = (existing.seen || 1) + 1;
      existing.updated = Date.now();
      if (entry.when && !existing.when) existing.when = clip(entry.when, 90);
      return existing;
    }
    var record = {
      id: entry.id || uid(),
      kind: kind,
      name: name || ('Diary — ' + clip(entry.when, 40)),
      text: clip(entry.text, 700),
      when: clip(entry.when, 90),          // in-world date
      at: entry.at || Date.now(),          // when it was played
      updated: Date.now(),
      roomId: String(entry.roomId || ''),
      roomTitle: clip(entry.roomTitle, 90),
      chars: (entry.chars || []).map(String).slice(0, 8),
      source: entry.source === 'you' ? 'you' : 'auto',
      seen: 1,
    };
    book.entries.push(record);            // newest at the bottom, always
    if (book.entries.length > RP.BOOK_MAX) book.entries = book.entries.slice(-RP.BOOK_MAX);
    return record;
  };

  /** Two pages about the same thing become one; thin pages that say
   *  nothing are dropped. Called when the book gets long. */
  RP.tidyBook = function (state, opts) {
    opts = opts || {};
    var book = bookState(state);
    var seen = {}, kept = [], dropped = 0, merged = 0;
    book.entries.forEach(function (page) {
      var key = page.kind + ':' + slug(page.name);
      // A "fact" that is just a sentence of scenery is not worth a page.
      var thin = page.kind === 'fact' && page.text.length < 45 && page.seen < 2;
      if (thin && !opts.keepThin) { dropped++; return; }
      if (seen[key]) {
        var first = seen[key];
        if (page.text && first.text.toLowerCase().indexOf(page.text.toLowerCase()) < 0) {
          first.text = clip(first.text + ' ' + page.text, 700);
        }
        first.seen = (first.seen || 1) + (page.seen || 1);
        merged++;
        return;
      }
      seen[key] = page;
      kept.push(page);
    });
    if (opts.max && kept.length > opts.max) {
      // Keep the diary and anything seen more than once, then the newest.
      var keepers = kept.filter(function (p) { return p.kind === 'diary' || (p.seen || 1) > 1; });
      var rest = kept.filter(function (p) { return keepers.indexOf(p) < 0; });
      kept = keepers.concat(rest.slice(-(opts.max - keepers.length))).sort(function (a, b) { return a.at - b.at; });
    }
    var before = book.entries.length;
    book.entries = kept;
    return { before: before, after: kept.length, merged: merged, dropped: dropped };
  };

  RP.bookRemove = function (state, id) {
    var book = bookState(state);
    book.entries = book.entries.filter(function (e) { return e.id !== id; });
    return book.entries.length;
  };

  /** What the model is shown: everything about this cast and this room, then
   *  the most recent pages, because a book you cannot fit in the prompt is
   *  a book nobody reads. */
  RP.bookBlock = function (state, room, limit, recent) {
    var book = bookState(state);
    if (!book.entries.length) return '';
    var ids = (room.cast || []).map(function (c) { return c.id; });
    var scene = ((room.scene || '') + ' ' + (room.sceneName || '')).toLowerCase();
    if (recent !== undefined) return bookOnCall(book, room, ids, scene, String(recent || '').toLowerCase(), limit);
    function relevant(e) {
      if (e.roomId === room.id) return 3;
      if ((e.chars || []).some(function (id) { return ids.indexOf(id) >= 0; })) return 2;
      if (e.name && scene.indexOf(e.name.toLowerCase()) >= 0) return 2;
      return 1;
    }
    var picked = book.entries.slice().map(function (e, i) {
      return { e: e, score: relevant(e) * 1000 + i };
    }).sort(function (a, b) { return b.score - a.score; })
      .slice(0, limit || 18).map(function (x) { return x.e; })
      .sort(function (a, b) { return book.entries.indexOf(a) - book.entries.indexOf(b); });
    var diary = picked.filter(function (e) { return e.kind === 'diary'; });
    var pages = picked.filter(function (e) { return e.kind !== 'diary'; });
    var out = ['THE LORE BOOK — everything below was established in play and is TRUE. Stay consistent with it.'];
    pages.forEach(function (e) {
      out.push('- ' + (RP.BOOK_KINDS[e.kind] || {}).label + ': ' + e.name + (e.when ? ' (' + e.when + ')' : '') +
        (e.text ? ' — ' + e.text : ''));
    });
    if (diary.length) {
      out.push('', 'THE DIARY — how the days have gone so far');
      diary.forEach(function (e) { out.push('- ' + (e.when ? e.when + ': ' : '') + e.text); });
    }
    return out.join('\n');
  };

  /** The book on call: as it grew, every page of every chat rode in every
   *  prompt. Now a chat carries its own pages and whatever the recent turns
   *  name; the rest is an index the model can [[LOOKUP:]] from. */
  RP.BOOK_ON_CALL = 8;
  function bookOnCall(book, room, ids, scene, recent, limit) {
    function named(e) {
      var n = String(e.name || '').toLowerCase().split(/\s+[—-]\s+/)[0].trim();
      return n.length > 2 && (recent.indexOf(n) >= 0 || scene.indexOf(n) >= 0);
    }
    var scored = book.entries.map(function (e, i) {
      var s = e.roomId === room.id ? 3 : named(e) ? 3
        : (e.chars || []).some(function (id) { return ids.indexOf(id) >= 0; }) ? 1 : 0;
      return { e: e, s: s, i: i };
    });
    var shown = scored.filter(function (x) { return x.s > 0 && (x.e.kind !== 'diary' || x.e.roomId === room.id); })
      .sort(function (a, b) { return (b.s - a.s) || (b.i - a.i); })
      .slice(0, limit || RP.BOOK_ON_CALL);
    var shownIds = shown.map(function (x) { return x.e.id; });
    shown.sort(function (a, b) { return a.i - b.i; });
    var rest = scored.filter(function (x) { return x.e.kind !== 'diary' && shownIds.indexOf(x.e.id) < 0; })
      .sort(function (a, b) { return (b.s - a.s) || (b.i - a.i); })
      .slice(0, 15).map(function (x) { return x.e.name; });
    if (!shown.length && !rest.length) return '';
    var out = ['THE LORE BOOK — everything below was established in play and is TRUE. Stay consistent with it.'];
    var diary = [];
    shown.forEach(function (x) {
      var e = x.e;
      if (e.kind === 'diary') { diary.push('- ' + (e.when ? e.when + ': ' : '') + e.text); return; }
      out.push('- ' + (RP.BOOK_KINDS[e.kind] || {}).label + ': ' + e.name + (e.when ? ' (' + e.when + ')' : '') +
        (e.text ? ' — ' + e.text : ''));
    });
    if (diary.length) out.push('', 'THE DIARY — how the days have gone so far', diary.join('\n'));
    if (rest.length) {
      out.push('', 'ALSO IN THE BOOK (not shown; if one matters right now, ask with [[LOOKUP: its name]]): ' + rest.join(' · '));
    }
    return out.join('\n');
  }

  /** Lore book pages matching a [[LOOKUP:]], shaped like archive hits. */
  RP.searchBook = function (state, query, limit) {
    var words = String(query || '').toLowerCase().split(/[^a-z0-9']+/).filter(function (w) { return w.length > 2; });
    if (!words.length) return [];
    return bookState(state).entries.map(function (e) {
      var name = String(e.name || '').toLowerCase(), text = String(e.text || '').toLowerCase();
      var score = words.reduce(function (s, w) { return s + (name.indexOf(w) >= 0 ? 3 : 0) + (text.indexOf(w) >= 0 ? 1 : 0); }, 0);
      return { e: e, score: score };
    }).filter(function (x) { return x.score >= 3; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, limit || 3)
      .map(function (x) {
        return { kind: 'book', id: x.e.id, name: 'Lore book — ' + x.e.name, snippet: x.e.text || '', date: x.e.when || '', book: true };
      });
  };

  /* ---- the queue ---- */

  RP.queuePush = function (state, job) {
    var book = bookState(state);
    if (book.queue.length >= RP.QUEUE_MAX) return null;         // back pressure
    if (book.queue.some(function (j) { return j.key === job.key; })) return null;
    var record = {
      id: uid(), key: String(job.key || uid()), kind: job.kind || 'extract',
      roomId: String(job.roomId || ''), roomTitle: clip(job.roomTitle, 90),
      when: clip(job.when, 90), at: Date.now(), turns: job.turns || [],
    };
    book.queue.push(record);
    return record;
  };

  RP.queueNext = function (state) { return bookState(state).queue[0] || null; };

  RP.queueDone = function (state, id, spent) {
    var book = bookState(state);
    book.queue = book.queue.filter(function (j) { return j.id !== id; });
    if (spent) book.spent = (book.spent || 0) + 1;
    return book.queue.length;
  };

  /** Is there budget left for another background call? */
  RP.bookBudgetLeft = function (state) {
    var book = bookState(state);
    var cap = (state.settings && state.settings.bookBudget) || RP.BOOK_BUDGET;
    return Math.max(0, cap - (book.spent || 0));
  };

  /* ---- the extraction prompt (its own small call, not the roleplay one) ---- */

  RP.extractPrompt = function (room, turns, known) {
    return [
      'You are the archivist for a roleplay session. Read the turns below and file ONLY what is newly established.',
      '',
      'THE SCENE: ' + clip(room.sceneName || room.title, 120) + (room.date ? ' — ' + room.date : ''),
      'WHO IS IN IT: ' + (room.cast || []).map(function (c) { return c.name; }).join(', '),
      (known && known.length ? 'ALREADY IN THE BOOK (do not file these again): ' + known.slice(0, 40).join('; ') : ''),
      '',
      'THE TURNS',
      turns.map(function (t) { return t.who + ': ' + clip(t.text, 400); }).join('\n'),
      '',
      'Write one line per entry, in exactly these formats, and nothing else:',
      'PLACE: name | what it is, in one sentence',
      'PERSON: name | who they are and what they want',
      'EVENT: name | what happened, concretely',
      'THING: name | what it is and who has it',
      'FACT: the thing that is now true',
      'DIARY: one short paragraph, past tense, recording how this stretch went',
      '',
      'Rules: only things the turns actually establish — no speculation, no restating the scene description, ',
      'nothing already in the book. Names must be the names used in the turns. At most six lines, and one DIARY.',
      'If the turns established nothing new, reply with exactly: NONE',
    ].filter(Boolean).join('\n');
  };

  /** Read the archivist's answer back into entries. Anything malformed is
   *  dropped rather than filed as nonsense. */
  RP.parseExtract = function (text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var hit = /^\s*(PLACE|PERSON|EVENT|THING|FACT|DIARY)\s*:\s*(.+)$/i.exec(line.replace(/^[-*\d.\s]+/, ''));
      if (!hit) return;
      var kind = hit[1].toLowerCase(), body = hit[2].trim();
      if (!body || /^none$/i.test(body)) return;
      if (kind === 'diary') { out.push({ kind: 'diary', name: '', text: body }); return; }
      if (kind === 'fact') { out.push({ kind: 'fact', name: clip(body.split(/[.!?]/)[0], 80), text: body }); return; }
      var parts = body.split('|');
      var name = clip(parts[0], 90);
      if (!name || name.length < 2) return;
      out.push({ kind: kind, name: name, text: clip(parts.slice(1).join('|'), 400) });
    });
    return out.slice(0, 7);
  };

  /* ------------------------------------------------------------------ *
   * citations — any file in the archive, if the date checks out
   * ------------------------------------------------------------------ */

  /** One searchable index over everything the page has loaded. Records with
   *  a readable date carry it; people and bodies are standing records and
   *  are always citable. */
  RP.buildIndex = function (archive, castById) {
    var out = [];
    (archive.events || []).forEach(function (e) {
      // `body` is what search quotes from: the filing's own prose, not a
      // summary of it. Nothing reads the whole file — the search finds the
      // paragraph and hands over that.
      var body = [e.summary, e.description, e.outcome, e.aftermath].filter(Boolean).join('\n\n');
      out.push({
        id: e.id, name: e.name, kind: 'event', date: RP.parseWahDate(e.timeCode || e.date),
        text: clip(e.summary, 300), where: clip(e.location, 90),
        body: String(body).slice(0, 4000),
        words: ((e.name || '') + ' ' + body + ' ' + (e.location || '') + ' ' + (e.era || '')).toLowerCase().slice(0, 6000),
      });
    });
    (archive.factions || []).forEach(function (f) {
      var body = [f.summary, f.description].filter(Boolean).join('\n\n');
      out.push({
        id: f.id, name: f.name, kind: 'faction', date: null, standing: true,
        text: clip(f.summary, 300), body: String(body).slice(0, 4000),
        words: ((f.name || '') + ' ' + body + ' ' + (f.region || '')).toLowerCase().slice(0, 6000),
      });
    });
    (archive.whatifs || []).forEach(function (w) {
      out.push({
        id: w.id, name: w.title, kind: 'what-if', date: null, noncanon: true,
        text: clip(w.summary, 260),
        words: ((w.title || '') + ' ' + (w.summary || '')).toLowerCase(),
      });
    });
    Object.keys(castById || {}).forEach(function (k) {
      var c = castById[k];
      var body = [c.title, c.status, c.summary, c.description].filter(Boolean).join('\n\n');
      out.push({
        id: c.id, name: c.name, kind: 'character', date: null, standing: true,
        text: clip(c.title + '. ' + c.summary, 260), body: String(body).slice(0, 4000),
        words: ((c.name || '') + ' ' + body + ' ' + (c.affiliation || '')).toLowerCase().slice(0, 6000),
      });
    });
    (archive.posts || []).forEach(function (p) {
      out.push({
        id: p.id, name: 'WAHwire — ' + clip(p.authorName, 40), kind: 'wire', date: RP.parseWahDate(p.timestamp),
        text: clip(p.content, 260),
        words: ((p.authorName || '') + ' ' + (p.content || '') + ' ' + (p.tags || []).join(' ')).toLowerCase(),
      });
    });
    return out.filter(function (r) { return r.id && r.name; });
  };

  /** Records this scene is allowed to cite: dated at or before the scene, or
   *  a standing record (a person, a body) with no date to fail. Anything
   *  dated later is returned separately so the prompt can forbid it by name. */
  RP.citableFor = function (index, room, state, opts) {
    opts = opts || {};
    var scene = RP.sceneDate(room, state);
    var terms = String(opts.query || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter(function (t) { return t.length > 3; }).slice(0, 24);
    var castNames = (room.cast || []).map(function (c) { return c.name.toLowerCase(); });
    var ok = [], blocked = [];
    (index || []).forEach(function (r) {
      if (r.noncanon) return;
      var rel = r.date && scene ? RP.timeRelation(scene, r.date) : null;
      var score = 0;
      castNames.forEach(function (n) { if (r.words.indexOf(n) >= 0) score += 3; });
      terms.forEach(function (t) { if (r.words.indexOf(t) >= 0) score += 1; });
      if (rel && rel.rel === 'future') {
        if (score > 0) blocked.push({ r: r, rel: rel, score: score });
        return;
      }
      if (score <= 0) return;
      if (rel && rel.rel === 'past') score += 1;             // dated and behind us: solid ground
      ok.push({ r: r, rel: rel, score: score });
    });
    function take(list, n) {
      return list.sort(function (a, b) { return b.score - a.score; }).slice(0, n);
    }
    return { scene: scene, citable: take(ok, opts.limit || 10), blocked: take(blocked, 4) };
  };

  /** The prompt block. Ids are included so a character can name the filing
   *  they are quoting instead of inventing a source. */
  RP.citationBlock = function (found) {
    if (!found || (!found.citable.length && !found.blocked.length)) return '';
    var out = [];
    if (found.citable.length) {
      out.push('FILES YOU MAY CITE — real records, and the dates check out against this scene');
      found.citable.forEach(function (x) {
        out.push('- [' + x.r.kind + ':' + x.r.id + '] ' + x.r.name +
          (x.r.date ? ' (' + RP.formatWahDate(x.r.date) + ', ' + x.rel.label + ')' : ' (standing record)') +
          ' — ' + x.r.text);
      });
      out.push('Refer to these by name when it is natural. Never invent a filing, a date or a quotation.');
    }
    if (found.blocked.length) {
      out.push('', 'FILED, BUT NOT YET — these exist in the archive and are dated AFTER this scene. ' +
        'Nobody here can know them:');
      found.blocked.forEach(function (x) { out.push('- ' + x.r.name + ' (' + RP.formatWahDate(x.r.date) + ')'); });
    }
    return out.join('\n');
  };

  /* ------------------------------------------------------------------ *
   * browsing the cast — 189 characters is a list, not a library
   * ------------------------------------------------------------------ */

  RP.CAST_SORTS = {
    name:     { name: 'Name (A–Z)', fn: function (a, b, ctx) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; } },
    played:   { name: 'Most played by you', fn: function (a, b, ctx) { return (ctx.plays[b.id] || 0) - (ctx.plays[a.id] || 0) || (a.name < b.name ? -1 : 1); } },
    recent:   { name: 'Recently played', fn: function (a, b, ctx) { return (ctx.last[b.id] || 0) - (ctx.last[a.id] || 0) || (a.name < b.name ? -1 : 1); } },
    fame:     { name: 'Best known', fn: function (a, b) { return (b.fameScore || 0) - (a.fameScore || 0) || (a.name < b.name ? -1 : 1); } },
    power:    { name: 'Most dangerous', fn: function (a, b) { return (b.powerLevel || b.level || 0) - (a.powerLevel || a.level || 0) || (a.name < b.name ? -1 : 1); } },
    remember: { name: 'Remembers the most', fn: function (a, b, ctx) { return (ctx.memory[b.id] || 0) - (ctx.memory[a.id] || 0) || (a.name < b.name ? -1 : 1); } },
    filings:  { name: 'Most filed about', fn: function (a, b) { return (b.keyEvents || []).length - (a.keyEvents || []).length || (a.name < b.name ? -1 : 1); } },
  };

  RP.CAST_GROUPS = {
    letter:      { name: 'A–Z', of: function (c) { return RP.letterFor(c.name); } },
    none:        { name: 'No grouping', of: function () { return ''; } },
    race:        { name: 'Race', of: function (c) { return c.race || 'Unfiled'; } },
    affiliation: { name: 'Affiliation', of: function (c) { return c.affiliation || c.faction || 'Unaffiliated'; } },
    status:      { name: 'Status', of: function (c) { return /^active/i.test(c.status || '') ? 'Active' : (c.status ? clip(c.status.split(/[—,.]/)[0], 40) : 'Unfiled'); } },
    standing:    { name: 'Standing', of: function (c) { return c.fameTier || 'Unranked'; } },
  };

  /** Everything the sorters need that lives outside the character record. */
  RP.castContext = function (state) {
    var plays = {}, last = {}, memory = {};
    (state.rooms || []).forEach(function (r) {
      (r.cast || []).forEach(function (c) {
        plays[c.id] = (plays[c.id] || 0) + (r.messages || []).filter(function (m) { return m.role === 'char' && m.charId === c.id; }).length;
        last[c.id] = Math.max(last[c.id] || 0, r.updated || 0);
      });
    });
    (state.chars || []).forEach(function (m) { memory[m.id] = (m.notes || []).length + (m.knowledge || []).length; });
    return { plays: plays, last: last, memory: memory };
  };

  RP.sortCast = function (cast, mode, ctx) {
    var sort = RP.CAST_SORTS[mode] || RP.CAST_SORTS.name;
    return (cast || []).slice().sort(function (a, b) { return sort.fn(a, b, ctx || { plays: {}, last: {}, memory: {} }); });
  };

  /** Search plus facets. The query reads the whole dossier, so "ice mage"
   *  and "Dark Shores" both find people even when it is not in their name. */
  RP.filterCast = function (cast, opts, ctx) {
    opts = opts || {};
    ctx = ctx || { plays: {} };
    var q = String(opts.query || '').toLowerCase().trim();
    return (cast || []).filter(function (c) {
      if (opts.race && (c.race || 'Unfiled') !== opts.race) return false;
      if (opts.affiliation && (c.affiliation || c.faction || 'Unaffiliated') !== opts.affiliation) return false;
      if (opts.view === 'played' && !(ctx.plays[c.id] > 0)) return false;
      if (opts.view === 'unplayed' && ctx.plays[c.id] > 0) return false;
      if (opts.view === 'portrait' && !c.image) return false;
      if (opts.view === 'invented' && !c.invented) return false;
      if (!q) return true;
      return (c.name + ' ' + c.title + ' ' + c.race + ' ' + c.affiliation + ' ' + c.faction + ' ' +
        c.status + ' ' + c.summary + ' ' + c.description + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  };

  /** Group for the dividers, in the order the grouping implies. */
  RP.groupCast = function (cast, mode, ctx) {
    var group = RP.CAST_GROUPS[mode] || RP.CAST_GROUPS.letter;
    if (mode === 'none') return [{ letter: '', chars: cast.slice() }];
    var map = {};
    (cast || []).forEach(function (c) {
      var key = clip(group.of(c), 60) || 'Unfiled';
      (map[key] = map[key] || []).push(c);
    });
    var keys = Object.keys(map);
    if (mode === 'letter') {
      keys.sort(function (a, b) { return a === '#' ? 1 : b === '#' ? -1 : a < b ? -1 : 1; });
    } else {
      keys.sort(function (a, b) { return map[b].length - map[a].length || (a < b ? -1 : 1); });
    }
    return keys.map(function (k) { return { letter: k, chars: map[k] }; });
  };

  /** The values worth offering as facets — anything shared by 2+ people. */
  RP.castFacets = function (cast) {
    function facet(of) {
      var counts = {};
      (cast || []).forEach(function (c) {
        var key = clip(of(c), 60);
        if (key) counts[key] = (counts[key] || 0) + 1;
      });
      return Object.keys(counts).filter(function (k) { return counts[k] > 1; })
        .sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); })
        .slice(0, 24).map(function (k) { return { value: k, count: counts[k] }; });
    }
    return {
      race: facet(function (c) { return c.race; }),
      affiliation: facet(function (c) { return c.affiliation || c.faction; }),
    };
  };

  /* ------------------------------------------------------------------ *
   * the calendar — is this filing already history, or has it not
   * happened yet?
   *
   * The archive runs on the Regal Empire Standard Calendar: twelve months
   * of thirty days (Deepwinter has thirty-five), BF counting UP, so 1040
   * is nearer to now than 955. Without this the model cheerfully has a
   * character reminisce about a battle three years in their future.
   * ------------------------------------------------------------------ */

  RP.MONTHS = ['Firstlight', 'Chillwind', 'Veridia', 'Bloom', 'Floria', 'Efferd',
    'Highsun', 'Harvestide', 'Aethel', 'Darkmoon', 'Frostfall', 'Deepwinter'];
  // Legacy month names that appear in older filings.
  var MONTH_ALIAS = { harvestside: 'Harvestide', harvestnoon: 'Harvestide' };
  var DAYS_IN = [30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 35];

  function monthIndex(name) {
    var want = String(name || '').toLowerCase().trim();
    want = (MONTH_ALIAS[want] || want).toLowerCase();
    for (var i = 0; i < RP.MONTHS.length; i++) {
      if (RP.MONTHS[i].toLowerCase() === want) return i;
    }
    return -1;
  }
  RP.monthIndex = monthIndex;

  /** Days since the start of year 0 — the only number worth comparing. */
  RP.dayOrdinal = function (date) {
    if (!date || date.year === undefined) return null;
    var days = date.year * 365;
    for (var i = 0; i < (date.month || 0); i++) days += DAYS_IN[i];
    return days + (date.day || 1);
  };

  /** Read an in-world date out of anything the archive writes:
   *  "5 Aethel, 1040 BF", "the 21st of Highsun, 1040 BF", "1035 BF", or a
   *  time code "TC:1040-08-30T23:50/SHD". */
  RP.parseWahDate = function (text) {
    var raw = String(text || '');
    if (!raw.trim()) return null;
    var code = /TC:(\d{3,4})-(\d{2})-(\d{2})/.exec(raw);
    if (code) {
      return { year: Number(code[1]), month: Number(code[2]) - 1, day: Number(code[3]), text: clip(raw, 90), exact: true };
    }
    var dayFirst = /(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)[,\s]+(\d{3,4})\s*BF/i.exec(raw);
    if (dayFirst && monthIndex(dayFirst[2]) >= 0) {
      return { year: Number(dayFirst[3]), month: monthIndex(dayFirst[2]), day: Number(dayFirst[1]), text: clip(raw, 90), exact: true };
    }
    var monthFirst = /([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{3,4})\s*BF/i.exec(raw);
    if (monthFirst && monthIndex(monthFirst[1]) >= 0) {
      return { year: Number(monthFirst[3]), month: monthIndex(monthFirst[1]), day: Number(monthFirst[2]), text: clip(raw, 90), exact: true };
    }
    var monthYear = /([A-Za-z]+)\s+(\d{3,4})\s*BF/i.exec(raw);
    if (monthYear && monthIndex(monthYear[1]) >= 0) {
      return { year: Number(monthYear[2]), month: monthIndex(monthYear[1]), day: 1, text: clip(raw, 90), exact: false };
    }
    var yearOnly = /(\d{3,4})\s*BF/i.exec(raw);
    if (yearOnly) return { year: Number(yearOnly[1]), month: 0, day: 1, text: clip(raw, 90), exact: false };
    return null;
  };

  RP.formatWahDate = function (date) {
    if (!date) return '';
    return (date.exact ? date.day + ' ' + RP.MONTHS[date.month] + ', ' : '') + date.year + ' BF';
  };

  /** How a filing sits relative to the scene being played. */
  RP.timeRelation = function (sceneDate, otherDate) {
    var a = typeof sceneDate === 'string' ? RP.parseWahDate(sceneDate) : sceneDate;
    var b = typeof otherDate === 'string' ? RP.parseWahDate(otherDate) : otherDate;
    if (!a || !b) return { rel: 'unknown', label: 'undated — treat with care' };
    var days = RP.dayOrdinal(b) - RP.dayOrdinal(a);
    if (days === 0) return { rel: 'now', days: 0, label: 'the same day as this scene' };
    var ago = Math.abs(days);
    var span = ago >= 730 ? Math.round(ago / 365) + ' years'
      : ago >= 60 ? Math.round(ago / 30) + ' months'
      : ago + (ago === 1 ? ' day' : ' days');
    if (days < 0) return { rel: 'past', days: days, label: span + ' before this scene — already history' };
    return { rel: 'future', days: days, label: span + ' AFTER this scene — has not happened yet' };
  };

  /** The archive's own clock, from currentDate.json. */
  RP.worldNow = function (clock) {
    if (!clock || clock.year === undefined) return null;
    return { year: Number(clock.year), month: Number(clock.monthIndex || 0), day: Number(clock.day || 1), exact: true, text: 'the world clock' };
  };

  /** The date the scene is being played on: whatever the room says, then the
   *  scenario it came from, then the archive's clock. */
  RP.sceneDate = function (room, state, archive) {
    return RP.parseWahDate(room && (room.date || room.sceneDate))
      || RP.parseWahDate(room && room.sceneName)
      // A scene played out of a filing is dated by that filing, not by the
      // world clock: "The Tape and the Wario Files" is 1035 BF, not today.
      || RP.parseWahDate(((archive && RP.sourceRecord(room, archive)) || {}).date)
      || RP.worldNow(state && state.clock);
  };

  /* ---- what the cast is allowed to know ---- */

  /** Filings these characters are attached to, sorted into what has already
   *  happened and what has not — with the ids, so the model can cite them
   *  by name instead of inventing a source. */
  RP.knowledgeBlock = function (state, room, archive) {
    archive = archive || {};
    var scene = RP.sceneDate(room, state);
    if (!scene) return '';
    var ids = {};
    (room.cast || []).forEach(function (c) {
      (c.keyEvents || []).forEach(function (id) { ids[slug(id)] = true; });
      (c.relatedArticles || []).forEach(function (id) { ids[slug(id)] = true; });
    });
    var past = [], future = [];
    (archive.events || []).forEach(function (e) {
      var mine = ids[slug(e.id)] || (e.participants || []).some(function (p) {
        return (room.cast || []).some(function (c) { return c.id === slug(p && p.id); });
      });
      if (!mine) return;
      var when = RP.parseWahDate(e.timeCode || e.date);
      var rel = RP.timeRelation(scene, when);
      var line = '- ' + clip(e.name, 80) + ' (' + (when ? RP.formatWahDate(when) : 'undated') + ') — ' +
        rel.label + '. ' + clip(e.summary, 180);
      if (rel.rel === 'future') future.push(line);
      else if (rel.rel === 'past' || rel.rel === 'now') past.push(line);
    });
    if (!past.length && !future.length) return '';
    var out = ['WHEN THIS SCENE IS HAPPENING\nIt is ' + RP.formatWahDate(scene) + ' by the Regal Empire Standard Calendar. ' +
      'Months run Firstlight, Chillwind, Veridia, Bloom, Floria, Efferd, Highsun, Harvestide, Aethel, Darkmoon, ' +
      'Frostfall, Deepwinter, and the year counts UP — a larger BF year is later.'];
    if (past.length) {
      out.push('ALREADY HISTORY — these have happened and the cast may refer to them by name\n' + past.slice(0, 8).join('\n'));
    }
    if (future.length) {
      out.push('HAS NOT HAPPENED YET — do not mention, foreshadow knowingly, or remember any of this\n' +
        future.slice(0, 8).join('\n') +
        '\nIf a character would guess at one of these, they guess — they do not know.');
    }
    return out.join('\n\n');
  };

  /* ------------------------------------------------------------------ *
   * continuations — pick the record up where it stops
   *
   * A backfill writes a hole in the past. A sequel continues a chat you
   * played. A continuation continues the ARCHIVE: the last filed event of
   * a saga, carried forward into hours nobody has filed yet, where the
   * model is expected to invent — new faces, new places, new trouble —
   * without contradicting anything already on the record.
   * ------------------------------------------------------------------ */

  /** Group the filed events into sagas. An era line ("1040 BF — Mario
   *  disappearance file") is the archive's own idea of a storyline, so it is
   *  the grouping; events keep their filed order, and the last one is where
   *  the record currently stops. */
  RP.sagasFrom = function (events) {
    var byEra = {};
    (events || []).forEach(function (e, i) {
      if (!e || !e.name) return;
      var era = clip(e.era || e.type || 'Unfiled', 80);
      (byEra[era] = byEra[era] || []).push(Object.assign({ order: i }, e));
    });
    return Object.keys(byEra).map(function (era) {
      var list = byEra[era];
      return { era: era, events: list, head: list[list.length - 1], length: list.length };
    }).filter(function (saga) {
      return saga.head && (saga.head.summary || '').length > 80;
    }).sort(function (a, b) { return b.head.order - a.head.order; });
  };

  RP.whatIfFromContinuation = function (saga, castById) {
    var head = saga.head;
    if (!head) return null;
    var entries = ((head.timeline || {}).entries || []);
    var closing = entries.slice(-3);
    var cast = (head.participants || []).slice(0, 6).map(function (p) {
      var c = (castById || {})[slug(p.id)] || (castById || {})[slug(p.name)];
      return c ? Object.assign({}, c, { why: whyFor(p.role) }) : null;
    }).filter(Boolean);
    if (cast.length < 2) return null;
    var prior = saga.events.slice(-4, -1);
    // Forward beats: the record has stopped, so these are pressures rather
    // than filed facts. They fire on the usual schedule and push the scene
    // somewhere new instead of replaying what is already written.
    var beats = [
      { time: 'the first hour', beat: 'Nobody has filed this yet',
        detail: 'The last thing on the record is: ' + clip((closing[closing.length - 1] || {}).beat || head.outcome || head.summary, 200) +
          ' Everything from here is unwritten. Play the next hour as it happens.' },
      { time: 'word travels', beat: 'Someone who was not there hears about it',
        detail: 'A person or a body with a stake in ' + clip(head.name, 60) + ' learns what happened, and they do not wait for the archive to confirm it.' },
      { time: 'the new face', beat: 'Somebody the record has never named walks in',
        detail: 'Introduce a character who has never been filed — give them a name, a face, a reason to be here and something they want. They stay in the scene afterwards.' },
      { time: 'the cost', beat: 'The consequence arrives on the wrong person',
        detail: 'What the last filing set in motion lands, and it lands on whoever can least afford it.' },
      { time: 'the turn', beat: 'The saga moves somewhere the record cannot follow',
        detail: 'Something changes that the archive will have to write a new filing about: a place, an allegiance, a body count, a secret said out loud.' },
    ];
    return scenario({
      id: 'continue:' + (head.id || slug(head.name)),
      kind: 'continuation', kindLabel: 'Continue the saga',
      name: 'Continue — ' + clip(saga.era.replace(/^\d+\s*BF\s*—\s*/, ''), 60) + ': after ' + clip(head.name, 50),
      premise: 'The record stops at ' + clip(head.name, 70) + (head.date ? ' (' + clip(head.date, 40) + ')' : '') +
        '. This picks the saga up in the minutes after the last filed line and keeps going into hours nobody has written — ' +
        'new people, new places, new trouble, all of it consistent with what is already filed.',
      image: head.image || '',
      date: clip(head.date, 70),
      tags: ['continuation', clip(saga.era, 30)].concat(head.type ? [clip(head.type, 24)] : []),
      weight: 4 + Math.min(2, saga.length / 3),
      source: 'events.json → ' + head.id + ' (saga of ' + saga.length + ')',
      cast: cast,
      beats: beats,
      questions: [
        'What does the archive have to file about this afterwards?',
        'Who arrives that nobody has written down yet?',
        'What does the saga cost next?',
      ],
      briefParts: [
        '**Where the record stops.** ' + clip(head.summary, 700),
        head.outcome ? '**How the last filing ended.** ' + clip(head.outcome, 600) : '',
        head.aftermath ? '**What it left behind.** ' + clip(String(head.aftermath).replace(/[*#>]/g, ''), 700) : '',
        closing.length ? '**The last beats on the record.**\n' + closing.map(function (e) {
          return '- *' + clip(e.time, 60) + '* — ' + clip(e.beat, 120) + (e.detail ? '. ' + clip(e.detail, 200) : '');
        }).join('\n') : '',
        prior.length ? '**The saga so far.**\n' + prior.map(function (e) {
          return '- *' + clip(e.name, 70) + '* (' + clip(e.date, 40) + '). ' + clip(e.summary, 200);
        }).join('\n') : '',
        head.location ? '**Where you are standing.** ' + clip(head.location, 200) + '.' : '',
        cast.length ? '**Who is still here.**\n' + cast.map(castLine).join('\n') : '',
        '**How this runs.** Everything up to this point is canon and may not be contradicted. Everything after it is ' +
          'yours and the model\u2019s to invent: new characters walk in and stay, places that were never filed get named, ' +
          'and nothing is guaranteed to go the way you intend it. Export the transcript and the archive has a draft ' +
          'of the next filing.',
        '**What is at stake.** A saga that is ' + saga.length + ' filings long, with no filing for what happens next.',
      ],
    });
  };

  /** The block that tells the model it is writing new canon, not replaying
   *  old canon — and how to introduce something the archive has never had. */
  RP.continuationBlock = function (room) {
    if (!room || room.canon !== 'continuation') return '';
    return [
      'THIS IS A CONTINUATION — you are writing what happens next, not retelling what happened',
      'Everything in the scene above is filed and cannot be contradicted. Everything from this point is new.',
      'You are expected to invent forward: name places the archive has never named, give people new injuries,',
      'new debts and new information, and bring in characters who have never been filed at all.',
      'To introduce someone new, use a stage direction on its own line:',
      '  [[NEW: Their Name | what they are here for | what they look like, in one sentence]]',
      'Nobody has drawn them, so the description IS the portrait — be specific about face, build, clothing and',
      'the one detail somebody would remember. They join the scene and stay in it.',
    ].join('\n');
  };

  /* ------------------------------------------------------------------ *
   * fate — the model is not your assistant
   *
   * Left alone, a small model says yes to everything the player writes.
   * Before each reply to a player action the page rolls, and the roll is
   * handed to the model as an instruction it must honour: the attempt
   * works, works at a price, goes sideways, or fails outright.
   * ------------------------------------------------------------------ */

  RP.FATE = {
    triumph: {
      label: 'Triumph', pill: '⚅ Triumph',
      dir: 'The player\u2019s attempt works, and better than they expected. Give them the win in concrete detail, and let ' +
        'it open a door they did not ask for.',
    },
    success: {
      label: 'It works', pill: '⚄ It works',
      dir: 'The player\u2019s attempt works, plainly and without drama. Do not add a complication to it — let the scene ' +
        'move on to whatever happens next.',
    },
    cost: {
      label: 'Works, at a price', pill: '⚃ Works — at a price',
      dir: 'The player\u2019s attempt works, but it costs something specific and immediate: a wound, a broken tool, a ' +
        'noise that carries, time, somebody\u2019s trust. Name the cost in the prose and file it with a stage direction.',
    },
    wrench: {
      label: 'A wrench', pill: '⚂ A wrench in it',
      dir: 'Something the player did not plan for cuts across the attempt right now — an arrival, a betrayal, a door ' +
        'that will not open, an order from somebody with authority. The attempt is not resolved; the situation changes ' +
        'under it. Do not ask the player what they do — show it happening.',
    },
    setback: {
      label: 'It fails', pill: '⚁ It fails',
      dir: 'The player\u2019s attempt FAILS. Not because they were stupid — because the world pushed back. Show the ' +
        'failure physically and leave them worse off than before: hurt, exposed, out of position, or holding the wrong ' +
        'thing. Never soften it into a partial success, and never apologise for it.',
    },
    refusal: {
      label: 'Refused', pill: '⚀ Refused',
      dir: 'The character the player is addressing does NOT do what they were asked. They refuse, argue, walk away, ' +
        'or do something else entirely, for a reason that fits who they are. Stay in character; do not be helpful.',
    },
  };

  // Odds per difficulty, as weights over the table above.
  RP.FATE_ODDS = {
    off: null,
    gentle:  { triumph: 12, success: 40, cost: 26, wrench: 12, setback: 7, refusal: 3 },
    normal:  { triumph: 7,  success: 26, cost: 30, wrench: 18, setback: 13, refusal: 6 },
    harsh:   { triumph: 3,  success: 13, cost: 27, wrench: 22, setback: 24, refusal: 11 },
  };

  function pickWeighted(weights, roll) {
    var total = 0, keys = Object.keys(weights);
    keys.forEach(function (k) { total += weights[k]; });
    var at = roll * total;
    for (var i = 0; i < keys.length; i++) {
      if (!(weights[keys[i]] > 0)) continue;          // an empty bucket is never drawn, not even at 0
      at -= weights[keys[i]];
      if (at <= 0) return keys[i];
    }
    for (var j = keys.length - 1; j >= 0; j--) if (weights[keys[j]] > 0) return keys[j];
    return keys[keys.length - 1];
  }

  /* ---- beyond them: godly and hopeless attempts ----
   * "I stop time", "I lift the helicopter off him", "I kill them all at
   * once". Left alone the dice treat these like opening a door. Read
   * locally, for free: a godly attempt (power nobody on the sheet has) or
   * a hopeless one (a body cannot) turns the table hard against it, and
   * the people in the room react to the attempt itself. A sheet with MP
   * is a caster: their magic is not godly, only the omnipotent is. */
  var GODLY_RE = /\b(?:stop(?:s)? time|freez(?:e|es) time|rewind(?:s)? time|turn(?:s)? back time|become(?:s)? (?:a )?god|godlike|omnipoten\w+|resurrect(?:s)?|rais(?:e|es) the dead|bring(?:s)? (?:him|her|them) back (?:to life|from the dead)|read(?:s)? (?:his|her|their|everyone'?s) minds?|control(?:s)? (?:his|her|their|everyone'?s) minds?|teleport(?:s)?|open(?:s)? a portal|snap(?:s)? my fingers and|with a (?:wave|snap|flick) of my (?:hand|fingers)|wip(?:e|es) (?:them|everyone|it) (?:all )?(?:out|from existence)|kill(?:s)? (?:everyone|them all|all of them) (?:at once|instantly|with a (?:word|thought|look))|will(?:s)? (?:him|her|them|it) (?:dead|out of existence)|summon(?:s)? (?:a |an |the )?(?:dragon|army|demon|meteor|god|storm|legion|titan)|call(?:s)? down (?:lightning|fire|a storm|the heavens)|lightning from my (?:hands?|fingers|eyes)|fly (?:up|away|off|into)|take(?:s)? flight|levitat\w*|turn(?:s)? invisible|shapeshift\w*|turn(?:s)? (?:him|her|them|myself) into (?:a |an )?\w+)\b/i;
  var HOPELESS_RE = /\b(?:(?:lift|lifts|throw|throws|hurl|hurls|catch|catches|carry|carries|flip|flips|rip|rips|tear|tears|punch(?:es)? through|kick(?:s)? down|hold(?:s)? up|pick(?:s)? up|push(?:es)? over|stop(?:s)?)\s+(?:the|a|an|that|this)\s+(?:\w+\s+){0,2}(?:helicopter|aircraft|airplane|plane|airship|zeppelin|car|truck|lorry|wagon|carriage|boat|ship|train|building|tower|wall|house|tree|boulder|mountain|bridge|gate|statue|engine|tank)|outrun(?:s)? (?:the|a|an) (?:bullet|arrow|blast|explosion|train|horse|avalanche|fire)|dodg(?:e|es) (?:every|all the|the) bullets|catch(?:es)? (?:the|a) (?:bullet|arrow|blade|sword|axe) (?:in|with) my (?:bare )?(?:hands?|teeth)|break(?:s)? (?:the|these|my) (?:chains|shackles|bars|cuffs) with my bare hands|bend(?:s)? the bars|kill(?:s)? (?:everyone|them all|all of them) (?:at once|with one (?:blow|swing|shot)|in one (?:blow|swing|move))|one[- ]punch(?:es)? (?:him|her|them|it)|punch(?:es)? (?:him|her|it) (?:through|across) the (?:wall|room|street)|jump(?:s)? (?:over|across) the (?:building|river|chasm|gorge|roof))\b/i;

  /* ---- the body gates the attempt ----
   * A man with a broken leg does not parkour up a building; a woman with
   * her arm in a sling does not haul herself over a wall; somebody at 20
   * HP does not sprint four blocks. Read from the player's own sheet,
   * locally, before the dice: the condition's words against the verbs of
   * the attempt. A hit turns the table against it and the prompt is told
   * the body fails before the world does. */
  var BODY_LIMITS = [
    { why: /\b(limp\w*|broken (?:leg|ankle|foot|knee|hip|shin)|sprained (?:ankle|knee)|twisted ankle|crippled|lame(?:d)?|shot in the (?:leg|knee|thigh|foot)|leg wound|stabbed in the (?:leg|thigh))\b/i,
      what: /\b(?:run|runs|running|sprint\w*|dash(?:es)?|bolt(?:s)?|chase(?:s)?|parkour|climb(?:s|ing)?|scale(?:s)?|vault(?:s)?|leap(?:s)?|jump(?:s)?|hurdle(?:s)?|kick(?:s)?|dance(?:s)?|scramble(?:s)? up|outrun(?:s)?|flee(?:s)? on foot|free[- ]run\w*|roll(?:s)? across|dive(?:s)? (?:through|over|across))\b/i, part: 'that leg' },
    { why: /\b(broken (?:arm|wrist|hand|fingers?|collarbone|ribs?)|dislocated shoulder|one[- ]armed|arm in a sling|shot in the (?:arm|shoulder|hand)|burned hands?|crushed hand|stabbed in the (?:arm|shoulder))\b/i,
      what: /\b(?:climb(?:s|ing)?|scale(?:s)?|lift(?:s)?|haul(?:s)?|hoist(?:s)?|carry|carries|swing(?:s)?|punch(?:es)?|throw(?:s)?|hurl(?:s)?|grapple(?:s)?|wrestle(?:s)?|pull(?:s)? (?:him|her|them|myself) up|two[- ]handed|draw(?:s)? the bow|reload(?:s)?|catch(?:es)?|hang(?:s)? from)\b/i, part: 'that arm' },
    { why: /\b(blind(?:ed)?|eyes? (?:swollen|shut|gone)|cannot see|can'?t see|lost (?:an|one|my) eye)\b/i,
      what: /\b(?:aim(?:s)?|shoot(?:s)?|fire(?:s)? (?:at|on)|snipe(?:s)?|read(?:s)?|search(?:es)?|spot(?:s)?|look(?:s)? for|scan(?:s)?|throw(?:s)? (?:it )?at|drive(?:s)?|pick(?:s)? (?:the|a) lock)\b/i, part: 'those eyes' },
    { why: /\b(winded|exhausted|out of breath|concuss\w*|dizzy|drunk|poisoned|feverish|hypothermi\w*|starving|dehydrated)\b/i,
      what: /\b(?:sprint\w*|run(?:s)? (?:for|after|across|up)|climb(?:s|ing)?|parkour|vault(?:s)?|swim(?:s)? across|fight(?:s)? on|hold(?:s)? (?:him|her|them) off|outrun(?:s)?)\b/i, part: 'that body' },
    { why: /\b(tied(?: up)?|bound|chained|shackled|handcuffed|cuffed|pinned|restrained|in irons|strapped down)\b/i,
      what: /\b(?:run(?:s)?|walk(?:s)? (?:out|over|away)|climb(?:s)?|grab(?:s)?|draw(?:s)?|swing(?:s)?|punch(?:es)?|reach(?:es)? for|attack(?:s)?|pick(?:s)? up|throw(?:s)?|kick(?:s)? (?:the|him|her|them) (?:door|down))\b/i, part: 'those bonds' },
  ];
  var HURT_HEAVY_RE = /\b(?:parkour|sprint\w*|climb(?:s|ing)?|scale(?:s)? (?:the|a)|vault(?:s)?|leap(?:s)? (?:across|over|onto)|haul(?:s)?|hoist(?:s)?|charge(?:s)? (?:at|into|out)|wrestle(?:s)?|fight(?:s)? (?:him|her|them) off|carry|carries|run(?:s)? (?:after|across|up|for)|kick(?:s)? (?:the|a) door|swim(?:s)?)\b/i;
  var DOWN_OK_RE = /\b(?:crawl|whisper|say|says|mutter|breathe|reach|blink|look|listen|cough|groan|lie|lay|hold on|grip|press)\b/i;

  /* ---- Energy: breath, strength and magic in one pool. Spent by the
   * prose when the model forgets to file it, refilled a little every
   * quiet turn, and a hard stop at 0. ---- */
  var EXERT_RE = /\b(?:sprint\w*|runs? (?:for|after|across|up|down|out|to)|racing|dash(?:es)? (?:for|across|to)|climb(?:s|ing)?|scal(?:e|es|ing) the|vault(?:s)?|haul(?:s|ing)?|hoist(?:s)?|drag(?:s|ging)? (?:him|her|them|the|a)|carr(?:y|ies|ying) (?:him|her|them)|swim(?:s)?|wrestl\w*|grappl\w*|fights? (?:on|off|through)|swing(?:s)? (?:the|a|his|her|my)|dig(?:s|ging)?|shoulder(?:s)? (?:the|through)|kick(?:s)? (?:the|a|down|in)|heave(?:s)?)\b/i;
  var MAGIC_RE = /\b(?:casts?|casting|spell\w*|conjur\w*|summon\w*|hex(?:es)?|incant\w*|teleport\w*|levitat\w*|enchant\w*|fireball|(?:the|his|her|my|their) magic|channel(?:s|ing)? (?:the|a|his|her|my))\b/i;
  /** Breath spent in the prose: a sprint or a climb, or a spell. Only
   *  for somebody with an Energy pool. { amount, cause } or null. */
  RP.exertScan = function (text, sheet) {
    var t = String(text || '');
    if (!sheet || !sheet.mp || !sheet.mp.max || !t.trim()) return null;
    var magic = MAGIC_RE.exec(t);
    if (magic) return { amount: Math.max(2, Math.round(sheet.mp.max * 0.12)), cause: magic[0], kind: 'magic' };
    var hard = EXERT_RE.exec(t);
    if (hard) return { amount: Math.max(1, Math.round(sheet.mp.max * 0.06)), cause: hard[0], kind: 'effort' };
    return null;
  };
  /** Energy comes back on its own: a little every turn a sheet is not
   *  spending it. Quiet — only the moment it is full is worth a line. */
  RP.regenEnergy = function (room, spentIds) {
    var spent = {};
    (spentIds || []).forEach(function (id) { spent[id] = true; });
    var lines = [];
    Object.keys((room && room.states) || {}).forEach(function (id) {
      var s = room.states[id];
      if (!s || s.present === false || !s.mp || !s.mp.max || spent[id] || s.mp.value >= s.mp.max) return;
      var step = Math.max(1, Math.round(s.mp.max * 0.04));
      s.mp.value = Math.min(s.mp.max, s.mp.value + step);
      if (s.mp.value >= s.mp.max) lines.push('\u26a1 ' + s.name + ' has their breath back (' + s.mp.value + '/' + s.mp.max + ')');
    });
    return lines;
  };

  /* ---- down, and brought round. 0 HP used to be a number the model
   * read and wrote past: Wario at 0, slapped, up and shouting, 0 still
   * on the sheet. Now a revival in the prose moves the sheet, and a
   * speaker at 0 written on their feet is sent back once. ---- */
  var REVIVE_RE = /\b(?:slap(?:s|ped|ping)?|shak(?:e|es|ing|en)|wakes?|woke|rous(?:e|es|ed|ing)|reviv(?:e|es|ed|ing)|resuscitat\w*|bring(?:s|ing)? (?:him|her|them|\w+) (?:round|back|to)|brought (?:him|her|them|\w+) (?:round|back|to)|smelling salts|adrenaline|epinephrine|stim(?:pack|ulant|s)?|cpr|chest compressions|mouth[- ]to[- ]mouth|heal(?:s|ed|ing)?|patch(?:es|ed|ing)? (?:him|her|them|\w+) up|bandag\w*|potion|elixir|tonic|first aid|med[- ]?kit|cold water|haul(?:s|ed|ing)? (?:him|her|them|\w+) (?:up|to (?:his|her|their) feet)|drag(?:s|ged|ging)? (?:him|her|them|\w+) (?:up|to (?:his|her|their) feet)|pull(?:s|ed|ing)? (?:him|her|them|\w+) (?:up|to (?:his|her|their) feet)|comes? (?:round|to)\b|came (?:round|to)\b)/gi;
  /** Who at 0 HP was just brought round by the prose — a slap, salts, a
   *  stim, a heal, a shake — by name, or by pronoun when only one person
   *  is down. Returns [{ id, name, how }]. */
  RP.reviveScan = function (text, room) {
    var t = String(text || '');
    if (!room || !t.trim()) return [];
    var down = Object.keys(room.states || {}).map(function (id) { return room.states[id]; }).filter(function (sh) {
      return sh && sh.present !== false && sh.hp && sh.hp.max && sh.hp.value <= 0;
    });
    if (!down.length) return [];
    var found = {}, out = [];
    REVIVE_RE.lastIndex = 0;
    var hit;
    while ((hit = REVIVE_RE.exec(t))) {
      var window = t.slice(Math.max(0, hit.index - 70), hit.index + hit[0].length + 90).toLowerCase();
      down.forEach(function (sh) {
        if (found[sh.id]) return;
        var name = String(sh.name || '').toLowerCase();
        var first = name.split(/\s+/)[0];
        var named = name && (window.indexOf(name) >= 0 ||
          (first.length > 2 && new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(window)));
        if (!named && down.length === 1 && /\b(?:him|her|them|his|hers|their)\b/.test(window)) named = true;
        if (!named) return;
        found[sh.id] = true;
        out.push({ id: sh.id, name: sh.name, how: hit[0].toLowerCase() });
      });
      if (!REVIVE_RE.global) break;
    }
    REVIVE_RE.lastIndex = 0;
    return out;
  };
  /** Bring somebody round: a sliver of HP, `down` lifted, and
   *  `barely_conscious` for three turns so the body block keeps them
   *  slow. Returns the line for the strip. */
  var reviveWord = function (how) {
    var h = String(how || '').toLowerCase();
    if (!h) return '';
    if (/^slap/.test(h)) return 'slapped awake';
    if (/^shak/.test(h)) return 'shaken awake';
    if (/water/.test(h)) return 'cold water';
    if (/salts/.test(h)) return 'smelling salts';
    if (/adrenaline|epinephrine|stim/.test(h)) return 'a stim';
    if (/cpr|compressions|mouth/.test(h)) return 'resuscitated';
    if (/heal|potion|elixir|tonic|first aid|med|bandag|patch/.test(h)) return 'patched up';
    if (/haul|drag|pull/.test(h)) return 'hauled to their feet';
    if (/wake|woke|rous|reviv|bring|brought|come|came/.test(h)) return 'roused';
    return clip(h, 40);
  };
  RP.revive = function (sheet, how) {
    if (!sheet || !sheet.hp || !sheet.hp.max) return '';
    how = reviveWord(how);
    var sliver = Math.max(1, Math.round(sheet.hp.max * 0.05));
    if (sheet.hp.value < sliver) sheet.hp.value = sliver;
    RP.markDown(sheet);
    sheet.flags = sheet.flags || {};
    sheet.flags.barely_conscious = {
      note: 'brought round' + (how ? ' \u2014 ' + how : '') + '; no fighting, no running, hardly standing',
      turns: 3, effect: '',
    };
    return '\u26d1 ' + sheet.name + ' comes round at ' + sheet.hp.value + '/' + sheet.hp.max + ' HP' + (how ? ' \u2014 ' + how : '') + '; barely conscious';
  };
  var VIGOUR_RE = /\b(?:leaps?|leapt|lung(?:e|es|ed)|charg(?:e|es|ed) (?:at|in|out|across|forward)|sprint\w*|vault(?:s|ed)?|swings? (?:a|the|his|her|my) \w+|swung|punch(?:es|ed)?|slam(?:s|med)? (?:a|the|his|her|my|it)|roar(?:s|ed)?|bellow(?:s|ed)?|storm(?:s|ed)? (?:out|off|over|across|in|to)|grab(?:s|bed)? (?:him|her|them|\w+) by|haul(?:s|ed)? (?:himself|herself|themselves|myself)|kick(?:s|ed)? (?:the|a|him|her|them|out)|erupt(?:s|ed)?|spring(?:s)? (?:up|to)|sprang|jump(?:s|ed)? (?:up|to)|(?:on|to) (?:his|her|their|my) feet|stands? up|stood up|bolt(?:s|ed)? (?:for|out|across|up)|tackl(?:e|es|ed)|hurl(?:s|ed)?|shov(?:e|es|ed)|march(?:es|ed)?|strid(?:e|es)|strode|shout(?:s|ed)?|yell(?:s|ed)?|scream(?:s|ed)?|snatch(?:es|ed)?|wrench(?:es|ed)? (?:free|away|the|it)|climb(?:s|ed)?|dash(?:es|ed)?)\b/i;
  var SPENT_OK_RE = /\b(?:tries? to|tried to|attempts? to|wants? to|cannot|can'?t|couldn'?t|could not|fails?|failed|collaps\w*|slump\w*|crumpl\w*|blacks? out|too weak|will not|won'?t|gives? out|give way|falls? back|sinks? back|not enough|in (?:his|her|their|my) head|dreams?|imagin\w*|remember\w*|used to)\b/i;
  /** A speaker at 0 HP written on their feet. null when the turn keeps
   *  to the body, or shows the body failing; else { why, what }. */
  RP.vigourCheck = function (text, sheet) {
    var t = String(text || '');
    if (!sheet || !sheet.hp || !sheet.hp.max || sheet.hp.value > 0 || !t.trim()) return null;
    var hit = VIGOUR_RE.exec(t);
    if (!hit) return null;
    var around = t.slice(Math.max(0, hit.index - 90), hit.index + hit[0].length + 120);
    if (SPENT_OK_RE.test(around)) return null;
    return { why: sheet.name + ' is DOWN at 0 HP', what: hit[0] };
  };

  /** What the player's body rules out, if the attempt is one of those.
   *  Returns null, or { why, what, part } — "limping (the crash)" /
   *  "climb" / "that leg". */
  RP.bodyCheck = function (sheet, text) {
    var t = String(text || '');
    if (!sheet || !t.trim()) return null;
    var flags = Object.keys(sheet.flags || {}).map(function (f) {
      var cond = sheet.flags[f] && typeof sheet.flags[f] === 'object' ? sheet.flags[f] : {};
      return { key: f.replace(/_/g, ' '), note: cond.note || '' };
    });
    var status = String(sheet.status || '');
    var hp = sheet.hp && sheet.hp.max ? sheet.hp.value / sheet.hp.max : 1;
    if (sheet.hp && sheet.hp.value <= 0 && !DOWN_OK_RE.test(t)) {
      return { why: 'down at 0 HP', what: clip(t.replace(/^\*|\*$/g, ''), 40), part: 'a body that is done' };
    }
    // Spent: no breath left for a sprint, no reserve left for a spell.
    if (sheet.mp && sheet.mp.max && sheet.mp.value <= 0) {
      var tired = MAGIC_RE.exec(t) || EXERT_RE.exec(t);
      if (tired) return { why: 'spent \u2014 0 Energy', what: tired[0], part: 'the wind they have left' };
    }
    for (var i = 0; i < BODY_LIMITS.length; i++) {
      var rule = BODY_LIMITS[i];
      var hit = flags.filter(function (f) { return rule.why.test(f.key) || rule.why.test(f.note); })[0];
      var byStatus = !hit && rule.why.test(status) ? { key: (rule.why.exec(status) || [''])[0], note: '' } : null;
      var cause = hit || byStatus;
      if (!cause) continue;
      var m = rule.what.exec(t);
      if (!m) continue;
      return { why: cause.key + (cause.note ? ' (' + clip(cause.note, 40) + ')' : ''), what: m[0], part: rule.part };
    }
    if (hp <= 0.35 && sheet.hp) {
      var heavy = HURT_HEAVY_RE.exec(t);
      if (heavy) return { why: 'at ' + sheet.hp.value + '/' + sheet.hp.max + ' HP', what: heavy[0], part: 'what is left of them' };
    }
    return null;
  };

  var CASTER_RE = /\b(?:magic|mage|wizard|witch|sorcer\w*|spell\w*|priest\w*|cleric|shaman|necromanc\w*|conjur\w*|alchem\w*|psychic|warlock|druid|oracle|ghost|spirit|demon|god(?:dess)?|angel|fairy|enchant\w*|summon\w*)\b/i;
  /** A caster is somebody whose record says so — not whoever has the
   *  preset's MP bar, which is everyone. */
  RP.isCaster = function (char, sheet) {
    if (!char) return false;
    var record = [char.title, char.summary, char.faction, (char.tags || []).join(' '), (char.aliases || []).join(' ')].join(' ');
    return CASTER_RE.test(record) || Boolean(sheet && sheet.caster);
  };

  RP.attemptScale = function (text, sheet, char) {
    var t = String(text || '');
    if (!t.trim()) return '';
    var caster = RP.isCaster(char, sheet);
    if (GODLY_RE.test(t)) {
      // A caster's own kind of magic is not godly: summoning and flight
      // stay on the table for them; stopping time and raising the dead do not.
      if (!caster || /time|god|omnipoten|resurrect|dead|back to life|minds?|existence|instantly|at once/i.test(t)) return 'godly';
    }
    if (HOPELESS_RE.test(t)) return 'hopeless';
    if (RP.bodyCheck(sheet, t)) return 'unfit';
    return '';
  };

  /** How far the odds lean this turn, and why. Everything that moves the
   *  dice is listed here so the pill, the prompt and the tests all read
   *  the same arithmetic. One pip is one notch of the table; the sum is
   *  clamped to ±3. Only the PLAYER's own body counts against them — an
   *  enemy bleeding out used to make the player's attempt harder, which
   *  is backwards. */
  RP.fateTilt = function (room, opts) {
    opts = opts || {};
    var why = [], plain = [], tilt = 0;    // why: pill chips · plain: words for the prose
    // The same sheet the prompt and the pack call "you": the starred
    // character's when one is starred. Reading __you__ first meant a
    // reader playing a downed Mr. T rolled with a healthy stranger's body.
    var you = (room.states || {})[RP.playerSheetId(room)] || (room.states || {})[RP.PLAYER_ID] || null;
    var stat = opts.text ? RP.actionStat(opts.text) : '';
    var score = null;
    if (you && you.stats && stat) {
      score = Number(you.stats[stat] === undefined ? 1 : you.stats[stat]);
      var lean = score - 1;                       // 0 → −1, 1 → even, 2 → +1, 3 → +2
      tilt += lean;
      why.push(RP.STAT_ICONS[stat] + ' ' + stat + ' ' + score + (lean ? ' (' + (lean > 0 ? '+' : '−') + Math.abs(lean) + ')' : ''));
    }
    if (you && you.hp && you.hp.max) {
      if (you.hp.value <= 0) { tilt -= 2; why.push('💀 down (−2)'); plain.push('down, barely conscious'); }
      else if (you.hp.value <= you.hp.max * 0.35) { tilt -= 1; why.push('🩸 badly hurt (−1)'); plain.push('badly hurt'); }
    }
    var flags = you ? Object.keys(you.flags || {}) : [];
    if (flags.length) {
      var weight = Math.min(1, flags.length * 0.5);
      tilt -= weight;
      var words = flags.slice(0, 2).map(function (f) { return f.replace(/_/g, ' '); });
      why.push(RP.condIcon(flags[0]) + ' ' + words.join(', ') + (flags.length > 2 ? ' +' + (flags.length - 2) : '') + ' (−' + weight + ')');
      plain.push(words.join(' and '));
    }
    if (opts.conjured) { tilt -= 2; why.push('🚫 out of thin air (−2)'); plain.push('reaching for a thing they do not have'); }
    var scale = opts.scale === undefined ? RP.attemptScale(opts.text, you, RP.playerCharacter(room)) : opts.scale;
    var body = scale === 'unfit' ? RP.bodyCheck(you, opts.text) : null;
    if (scale === 'godly') { tilt -= 3; why.push('🌩 godly (−3)'); plain.push('attempting what no one in this world can do'); }
    else if (scale === 'hopeless') { tilt -= 3; why.push('🪨 hopeless (−3)'); plain.push('attempting what a body cannot do'); }
    else if (scale === 'unfit') { tilt -= 3; why.push('🩼 ' + (body ? body.why : 'the body') + ' (−3)'); plain.push('attempting what their body cannot do right now'); }
    tilt = Math.max(-3, Math.min(3, tilt));
    return { tilt: tilt, why: why, plain: plain, stat: stat, score: score, you: you, scale: scale || '', body: body };
  };

  /** Roll for the turn. The difficulty picks the table; the tilt (the
   *  player's own stat for this kind of attempt, their wounds and
   *  conditions, a thin-air claim) slides the weights along it. `roll` is
   *  injectable so the tests are not at the mercy of the dice. */
  RP.rollFate = function (state, room, opts) {
    opts = opts || {};
    var level = opts.level || (state.settings && state.settings.fate) || 'normal';
    var odds = RP.FATE_ODDS[level];
    if (!odds || room.mechanics === 'off') return null;
    var weights = {};
    Object.keys(odds).forEach(function (k) { weights[k] = odds[k]; });
    var lean = RP.fateTilt(room, opts);
    var t = lean.tilt;
    if (t > 0) {
      weights.triumph += t * 2;
      weights.success += t * 5;
      weights.cost = Math.max(2, weights.cost - t);
      weights.wrench = Math.max(1, weights.wrench - t * 1.5);
      weights.setback = Math.max(1, weights.setback - t * 2.5);
      weights.refusal = Math.max(1, weights.refusal - t * 0.5);
    } else if (t < 0) {
      var d = -t;
      weights.triumph = Math.max(1, weights.triumph - d * 1.5);
      weights.success = Math.max(2, weights.success - d * 5);
      weights.wrench += d * 1.5;
      weights.setback += d * 3;
      weights.refusal += d * (opts.conjured ? 2 : 0.5);
    }
    // Beyond them: the world does not bend. No triumph, next to no plain
    // success; it goes wrong, sideways, or is refused.
    if (lean.scale) {
      weights.triumph = 0;
      weights.success = lean.scale === 'godly' ? 1 : 2;
      weights.cost = Math.max(2, weights.cost * 0.5);
      weights.wrench += lean.scale === 'unfit' ? 5 : 6;
      weights.setback += lean.scale === 'godly' ? 8 : lean.scale === 'unfit' ? 9 : 10;
      weights.refusal += lean.scale === 'godly' ? 6 : lean.scale === 'unfit' ? 1 : 2;
    }
    var roll = opts.roll === undefined ? Math.random() : opts.roll;
    var key = opts.force || pickWeighted(weights, roll);
    var fate = RP.FATE[key];
    // A thin-air claim is settled by the same dice: the hand comes up
    // holding it, or it comes up empty. No second opinion from the model.
    var granted = opts.conjured ? (key === 'triumph' || key === 'success' || key === 'cost') : undefined;
    var tag = lean.why.length ? ' · ' + lean.why.join(' · ') : '';
    var pressure = Math.max(0, -t);
    return {
      key: key, label: fate.label, pill: fate.pill + tag, dir: fate.dir, level: level,
      pressure: pressure, tilt: t, why: lean.why, plain: lean.plain, stat: lean.stat, score: lean.score, statTag: tag,
      conjured: opts.conjured || '', granted: granted, scale: lean.scale || '', body: lean.body || null, attempt: clip(String(opts.text || ''), 120),
    };
  };

  /** The block a godly or hopeless attempt earns: the world does not
   *  bend, and the people in the room react to the attempt itself. */
  RP.beyondBlock = function (fate) {
    if (!fate || !fate.scale) return '';
    if (fate.scale === 'unfit') {
      var b = fate.body || {};
      return 'THE BODY REFUSES \u2014 the player is ' + (b.why || 'hurt') + ', and \u201c' + (b.what || 'that') + '\u201d is beyond ' + (b.part || 'them') +
        ' right now. The ruling below says how it goes \u2014 it does NOT happen as asked. Write the body failing before the world does: the leg ' +
        'folds, the grip opens, the breath goes, the wall stays where it is \u2014 and what that costs, filed ([[HP:]] or [[COND:]] on their name). ' +
        'The people in the scene see it and act on it \u2014 a hand under the arm, a laugh, an opening taken. Never scold the player for trying; show the body.';
    }
    var godly = fate.scale === 'godly';
    return 'BEYOND THEM \u2014 the player\u2019s attempt is ' + (godly ? 'GODLY: nobody in this world has that power, and they do not' :
      'HOPELESS: a body cannot do that, and theirs is no exception') + '. The ruling below says how it goes \u2014 it does NOT work as asked. ' +
      'Write the world not bending: ' + (godly ? 'nothing answers the gesture, or the wrong thing does' : 'the weight does not move, the body gives') +
      '. The people in the scene react to the attempt as people would \u2014 alarm, laughter, contempt, pity, a step back \u2014 and it changes how ' +
      'they treat the player from here: file their feelings ([[MOOD: Name \u2026]]). The attempt costs the player something real \u2014 breath, blood, ' +
      'dignity, the moment \u2014 and you file it ([[HP:]] or [[COND:]] on their name). Never scold the player for trying; show it.';
  };

  /** What the model is told about the roll. It is written as an order, not a
   *  suggestion, because a suggestion gets ignored. The lean is named in
   *  one line so the prose can show WHY it went the way it went. */
  RP.fateBlock = function (fate) {
    if (!fate) return '';
    var lean = '';
    var plain = fate.plain || [];
    if (fate.stat) {
      lean = 'The attempt leaned on ' + fate.stat + ' (' + fate.score + ' of 3' +
        (fate.score >= 2 ? ', a strength' : fate.score === 0 ? ', a weakness' : '') + ')' +
        (plain.length ? ', and they are ' + plain.join(', and ') : '') +
        '. Let that show in HOW it goes, never as numbers.';
    } else if (plain.length) {
      lean = 'They are ' + plain.join(', and ') + ' — let it show in how this goes, never as numbers.';
    }
    return [
      'HOW THIS TURN RESOLVES — this is decided already, write it as it is',
      fate.dir,
      lean,
      'Do not narrate the dice, the odds, or the fact that anything was decided. Do not ask the player to roll.',
      'The player writes only their attempt; whether it works is not theirs to declare, and you do not owe them a yes.',
    ].filter(Boolean).join('\n');
  };

  /* ------------------------------------------------------------------ *
   * memory — the cross-chat log, character memory, and world lore
   * ------------------------------------------------------------------ */

  /** Ensure (and return) the memory record for a character. */
  RP.charMemory = function (state, char) {
    var id = String((char && char.id) || char || '');
    state.chars = state.chars || [];
    var found = state.chars.filter(function (c) { return c.id === id; })[0];
    if (!found) {
      found = {
        id: id,
        name: (char && char.name) || id,
        mood: '',
        notes: [],        // {at, roomId, roomTitle, text}
        knowledge: [],    // facts the player taught this character
        relations: {},    // otherId -> {name, score, note}
        firstSeen: Date.now(),
      };
      state.chars.push(found);
    }
    if (char && char.name) found.name = char.name;
    return found;
  };

  /** File one line into the world log — the history every chat can see. */
  RP.logEvent = function (state, entry) {
    state.log = state.log || [];
    var record = {
      id: entry.id || uid(),
      at: entry.at || Date.now(),
      kind: String(entry.kind || 'note'),      // chat | beat | pin | replay | lore | note
      roomId: String(entry.roomId || ''),
      roomTitle: String(entry.roomTitle || ''),
      // Two clocks, both recorded: the in-world date the thing happened on,
      // and the real moment it was played. A memory with no date is a rumour.
      when: clip(entry.when, 90),
      text: clip(entry.text, 400),
      chars: (entry.chars || []).map(String),
      tags: (entry.tags || []).map(String),
    };
    state.log.push(record);
    state.log = state.log.slice(-400);
    return record;
  };

  /** Remember one played turn: the speaker's own log, and — for anything the
   *  player marks or the character says at length — the shared world log. */
  RP.rememberTurn = function (state, room, msg) {
    if (!visible(msg)) return null;
    var text = clip(RP.textOf(msg).replace(/\*[^*]*\*/g, ' '), 220);
    if (!text) return null;
    var ids = (room.cast || []).map(function (c) { return c.id; });
    if (msg.role === 'char') {
      var mem = RP.charMemory(state, (room.cast || []).filter(function (c) { return c.id === msg.charId; })[0] || { id: msg.charId });
      mem.notes.push({
        at: msg.at || Date.now(), roomId: room.id, roomTitle: room.title, text: text,
        when: clip(room.date || room.sceneDate || '', 90),
      });
      mem.notes = mem.notes.slice(-40);
      // Everyone else in the room heard it: that is what a relationship is.
      ids.filter(function (id) { return id !== msg.charId; }).forEach(function (id) {
        var other = (room.cast || []).filter(function (c) { return c.id === id; })[0];
        var rel = mem.relations[id] || (mem.relations[id] = { name: (other && other.name) || id, score: 0, note: '' });
        rel.score = Math.max(-10, Math.min(10, (rel.score || 0) + 1));
        rel.name = (other && other.name) || rel.name;
      });
    } else {
      // What the player says is remembered by everyone present.
      ids.forEach(function (id) {
        var mem = RP.charMemory(state, (room.cast || []).filter(function (c) { return c.id === id; })[0]);
        mem.notes.push({ at: msg.at || Date.now(), roomId: room.id, roomTitle: room.title, text: 'The user said: ' + text });
        mem.notes = mem.notes.slice(-40);
      });
    }
    return text;
  };

  RP.setMood = function (state, char, mood) {
    var mem = RP.charMemory(state, char);
    mem.mood = clip(mood, 90);
    return mem;
  };

  RP.teach = function (state, char, fact) {
    var mem = RP.charMemory(state, char);
    var text = clip(fact, 220);
    if (text && mem.knowledge.indexOf(text) < 0) mem.knowledge.push(text);
    mem.knowledge = mem.knowledge.slice(-30);
    return mem;
  };

  /** A lore node: a piece of world truth any chat may draw on. */
  RP.addLore = function (state, node) {
    state.lore = state.lore || [];
    var record = {
      id: node.id || slug(node.title) || uid(),
      title: clip(node.title, 120) || 'Untitled node',
      text: String(node.text || '').slice(0, 4000),
      tags: (node.tags || []).map(function (t) { return clip(t, 40); }).filter(Boolean),
      chars: (node.chars || []).map(String),
      source: clip(node.source, 160),
      at: node.at || Date.now(),
    };
    var at = -1;
    state.lore.forEach(function (n, i) { if (n.id === record.id) at = i; });
    if (at >= 0) state.lore[at] = record; else state.lore.push(record);
    return record;
  };

  RP.removeLore = function (state, id) {
    state.lore = (state.lore || []).filter(function (n) { return n.id !== id; });
    return state.lore;
  };

  /** The prompt section that carries what these characters remember from
   *  chats other than this one — the point of a persistent cast. */
  RP.memoryBlock = function (state, cast, room, limit) {
    var ids = (cast || []).map(function (c) { return c.id; });
    var out = [];
    var log = (state.log || []).filter(function (e) {
      if (room && e.roomId === room.id) return false;      // this chat is already in the history
      return !e.chars.length || e.chars.some(function (id) { return ids.indexOf(id) >= 0; });
    }).slice(-(limit || 10));
    if (log.length) {
      out.push('WHAT HAS ALREADY HAPPENED (other chats, same world)');
      var sceneOn = RP.sceneDate(room, state);
      log.forEach(function (e) {
        var rel = e.when && sceneOn ? RP.timeRelation(sceneOn, e.when) : null;
        out.push('- ' + (e.when ? e.when + (rel && rel.rel === 'future' ? ' [AFTER this scene — they cannot know it]' : '') + ' — ' : '') +
          (e.roomTitle ? '[' + e.roomTitle + '] ' : '') + e.text);
      });
    }
    (cast || []).forEach(function (c) {
      var mem = (state.chars || []).filter(function (m) { return m.id === c.id; })[0];
      if (!mem) return;
      var lines = [];
      if (mem.mood) lines.push('Current state of mind: ' + mem.mood);
      if (mem.knowledge.length) lines.push('Knows: ' + mem.knowledge.slice(-6).join('; '));
      var rel = Object.keys(mem.relations).map(function (k) {
        var r = mem.relations[k];
        return r.name + ' (' + (r.score > 0 ? '+' : '') + r.score + (r.note ? ', ' + r.note : '') + ')';
      });
      if (rel.length) lines.push('Has history with: ' + rel.slice(0, 6).join(', '));
      var recent = mem.notes.filter(function (n) { return !room || n.roomId !== room.id; }).slice(-4);
      if (recent.length) {
        lines.push('Remembers saying or hearing: ' + recent.map(function (n) {
          return (n.when ? n.when + ': ' : '') + '“' + n.text + '”' + (n.roomTitle ? ' (' + n.roomTitle + ')' : '');
        }).join(' '));
      }
      if (lines.length) out.push('', c.name + ' remembers:', lines.map(function (l) { return '- ' + l; }).join('\n'));
    });
    return out.join('\n');
  };

  /** The prompt section for world lore relevant to this cast or scene. */
  RP.loreBlock = function (state, cast, room, limit) {
    var ids = (cast || []).map(function (c) { return c.id; });
    var haystack = ((room && (room.scene + ' ' + room.sceneName + ' ' + room.title)) || '').toLowerCase();
    var nodes = (state.lore || []).filter(function (n) {
      if (!n.chars.length && !n.tags.length) return true;                       // general world lore
      if (n.chars.some(function (id) { return ids.indexOf(id) >= 0; })) return true;
      return n.tags.some(function (t) { return haystack.indexOf(String(t).toLowerCase()) >= 0; });
    }).slice(0, limit || 6);
    if (!nodes.length) return '';
    return 'WORLD LORE (true in this world; treat as established)\n' + nodes.map(function (n) {
      return '- ' + n.title + ': ' + clip(n.text, 400);
    }).join('\n');
  };

  /** The prompt section for a perspective replay. */
  RP.perspectiveBlock = function (room) {
    if (!room || !room.perspective) return '';
    return [
      'PERSPECTIVE REPLAY',
      'These same events are being replayed from a different perspective: ' + room.perspective,
      'Play only what these people could see, hear and believe from where they stand. They may be wrong about the rest.',
    ].join('\n');
  };

  /* ------------------------------------------------------------------ *
   * direction — the reader as director
   *
   * "Make the ceiling come down" typed as a turn is the player's character
   * saying it, and a small model answers the words. A DIRECTION is not
   * said by anyone: it is filed on the room, rides in the protected tail
   * of the next prompt as a thing that happens, and is spent by that turn.
   * The ◍ Director turn and the ⟶ carry-over between linked scenes both
   * arrive this way.
   * ------------------------------------------------------------------ */

  RP.setDirection = function (room, text, from) {
    if (!room) return null;
    var clean = String(text || '').trim();
    if (!clean) { room.direction = null; return null; }
    room.direction = { text: clip(clean, 600), from: from || '', at: Date.now() };
    return room.direction;
  };

  RP.directionBlock = function (room) {
    var d = room && room.direction;
    var text = d && String(d.text || '').trim();
    if (!text) return '';
    return 'THE READER DIRECTS THIS TURN' + (d.from ? ' (carried over from the scene \u201c' + clip(d.from, 60) + '\u201d)' : '') + '\n' +
      text + '\n' +
      'This is not a suggestion and not a question: it HAPPENS, now, in this turn, as written and in full. Show it ' +
      'landing — the concrete thing, where it comes from, what it does to the room — and the people here dealing ' +
      'with it in character. Do not delay it, soften it, argue with it or explain it away, and never call it a ' +
      'direction. Everything else about the turn (who speaks, the dice, the rules below) still applies.';
  };

  /* ------------------------------------------------------------------ *
   * linked scenes — two chats, the same hour, a wall apart
   *
   * Chat A is Wario and Waluigi flying the plane; chat B is the two people
   * on the ground who see its spotlight. Each room may be linked to one
   * other (room.linkedTo, mutual). The page shows them side by side; the
   * prompt shows each the other's last turns so a light, a sound or a
   * person walking over can carry — and nothing else does. Nothing plays
   * on its own: the reader drives both, and ⟶ carries a thing over by hand.
   * ------------------------------------------------------------------ */

  RP.MEANWHILE_TURNS = 8;

  RP.linkedRoom = function (state, room) {
    if (!room || !room.linkedTo || room.linkedTo === room.id) return null;
    return ((state && state.rooms) || []).filter(function (x) { return x && x.id === room.linkedTo; })[0] || null;
  };

  RP.linkRooms = function (a, b) {
    if (!a || !b || a === b || a.id === b.id) return false;
    a.linkedTo = b.id; b.linkedTo = a.id;
    return true;
  };

  RP.unlinkRoom = function (state, room) {
    var other = RP.linkedRoom(state, room);
    if (other && other.linkedTo === room.id) other.linkedTo = '';
    if (room) room.linkedTo = '';
    return Boolean(other);
  };

  /** The last few turns of the linked room, as "Name: line" — what this
   *  scene could plausibly be hearing through the wall. */
  RP.meanwhileLines = function (state, other, limit) {
    var playing = RP.playerCharacter(other);
    var you = (playing && playing.name) || (state && state.user && state.user.name) || 'the reader';
    return ((other && other.messages) || []).filter(function (m) {
      return visible(m) && !m.muted && (m.role === 'user' || m.role === 'char' || m.role === 'world');
    }).slice(-(limit || RP.MEANWHILE_TURNS)).map(function (m) {
      var who = m.role === 'user' ? you
        : m.role === 'world' ? 'The scene'
        : (((other.cast || []).filter(function (c) { return c.id === m.charId; })[0] || {}).name || 'Someone');
      return who + ': ' + clip(String(RP.textOf(m)).replace(/\s+/g, ' '), 220);
    });
  };

  RP.meanwhileBlock = function (state, room) {
    var other = RP.linkedRoom(state, room);
    if (!other || room.linkMode === 'blind') return '';
    var lines = RP.meanwhileLines(state, other);
    if (!lines.length) lines = ['(nothing has happened there yet)'];
    var cast = RP.presentCast(other).map(function (c) { return c.name; }).join(', ');
    var you = RP.playerCharacter(other);
    return 'MEANWHILE, IN THE OTHER SCENE OF THIS SAME HOUR \u2014 \u201c' + clip(other.sceneName || other.title || 'elsewhere', 60) + '\u201d' +
      (cast ? ' (there right now: ' + cast + (you ? '; the reader plays ' + you.name + ' there' : '') + ')' : '') + '\n' +
      (other.scene ? 'Where: ' + clip(String(other.scene).replace(/\s+/g, ' '), 200) + '\n' : '') +
      lines.join('\n') + '\n' +
      'Both scenes are one story, one world, one clock: what is established there is true here too \u2014 an engine that ' +
      'died there is dead, a shot fired there was fired. Its people are THERE, not here, and its lines are not yours to ' +
      'retell or answer. What crosses is what physically would, judged by how close the two places are: light, sound, ' +
      'smoke, a tremor, a radio, shouting, somebody walking from there to here \u2014 when it would be noticed, notice it; ' +
      'when the places are far apart, nothing crosses but the clock.';
  };

  /* ---- ⇄ merge: two scenes fold into one ----
   * The reverse of the split. Everybody in either scene is in the one
   * scene now (anyone written out of both stays written out); the two
   * streams are interleaved by the clock with a camera card wherever the
   * source changes, so the record still reads as what it was — two
   * places, the same hour — right up to the turn they became one place.
   * Facts, tints and the clock are kept (the stage's win on a clash); the
   * recap is folded away so the model re-reads the joined stream, and
   * the lore book's count carries both halves. */
  RP.mergeRooms = function (state, stage, folded, opts) {
    opts = opts || {};
    if (!stage || !folded || stage === folded || stage.id === folded.id) return null;
    var report = { joined: [], already: [], stillAway: [], turns: 0, cards: 0 };
    var stageName = stage.sceneName || stage.title || 'this scene';
    var foldName = folded.sceneName || folded.title || 'the other scene';
    stage.states = stage.states || {};
    // 1. People. Present in either → present here; a sheet unknown here
    //    comes over whole; a sheet in both keeps the stage's record.
    (folded.cast || []).forEach(function (c) {
      var had = (stage.cast || []).some(function (x) { return x.id === c.id; });
      var theirs = folded.states && folded.states[c.id];
      var mine = had ? stage.states[c.id] : null;
      if (!had) RP.addToRoom(stage, c);                       // (ensureSheets gives them a blank sheet)
      if (theirs && !mine) { stage.states[c.id] = JSON.parse(JSON.stringify(theirs)); mine = stage.states[c.id]; }
      if (!mine) mine = stage.states[c.id];
      var wasHere = had && mine && mine.present !== false;
      var wasThere = theirs && theirs.present !== false;
      if (mine) {
        if (wasThere || wasHere) { mine.present = true; (wasHere ? report.already : report.joined).push(c.name); }
        else { mine.present = false; report.stillAway.push(c.name); }
        if (mine.player && c.id !== stage.youPlay) mine.player = false;
      } else if (!had) report.joined.push(c.name);
    });
    // The reader's own pack: the stage's; the other's only when the stage has none.
    if (folded.states && folded.states[RP.PLAYER_ID] && !stage.states[RP.PLAYER_ID]) {
      stage.states[RP.PLAYER_ID] = JSON.parse(JSON.stringify(folded.states[RP.PLAYER_ID]));
    }
    if (!stage.youPlay && folded.youPlay && (stage.cast || []).some(function (c) { return c.id === folded.youPlay; })) {
      stage.youPlay = folded.youPlay;
      if (stage.states[folded.youPlay]) stage.states[folded.youPlay].player = true;
    }
    stage.away = (stage.away || []).concat(folded.away || []).filter(function (x, i, all) {
      if (!x || !x.id) return false;
      if (stage.states[x.id] && stage.states[x.id].present !== false) return false;
      return all.map(function (y) { return y && y.id; }).indexOf(x.id) === i;
    });
    // 2. The streams, by the clock, with a camera card at every switch.
    var all = [];
    (stage.messages || []).forEach(function (m) { all.push({ r: 'a', m: m }); });
    (folded.messages || []).forEach(function (m) {
      var copy = JSON.parse(JSON.stringify(m));
      copy.sceneFrom = foldName;
      all.push({ r: 'b', m: copy });
    });
    all.sort(function (x, y) { return (x.m.at || 0) - (y.m.at || 0); });
    var out = [];
    var cur = null;
    var seenAny = all.some(function (e) { return e.r === 'b' && RP.visible(e.m); });
    all.forEach(function (e) {
      if (seenAny && e.r !== cur && RP.visible(e.m)) {
        cur = e.r;
        out.push({ id: RP.uid(), role: 'scene', camera: true, at: (e.m.at || Date.now()) - 1,
          text: '⇄ ' + (e.r === 'a' ? stageName : foldName) });
        report.cards++;
      }
      out.push(e.m);
    });
    report.turns = (folded.messages || []).filter(RP.visible).length;
    stage.messages = out;
    // 3. What both knew.
    stage.facts = Object.assign({}, folded.facts || {}, stage.facts || {});
    if (!stage.clock && folded.clock) stage.clock = folded.clock;
    if (!stage.date && folded.date) stage.date = folded.date;
    if (folded.tints && folded.tints.length) {
      var have = (stage.tints || []).map(function (t) { return JSON.stringify(t); });
      stage.tints = (stage.tints || []).concat(folded.tints.filter(function (t) { return have.indexOf(JSON.stringify(t)) < 0; }));
    }
    if (String(opts.scene || '').trim()) stage.scene = String(opts.scene).trim();
    else if (!stage.scene && folded.scene) stage.scene = folded.scene;
    stage.recap = ''; stage.recapAt = 0;                      // the joined stream is re-read
    stage.bookAt = Number(stage.bookAt || 0) + Number(folded.bookAt || 0);
    stage.queue = []; stage.next = ''; stage.handback = '';
    if (stage.kind !== 'group' && (stage.cast || []).length > 1) stage.kind = 'group';
    // 4. The card that says so, and the link is spent.
    stage.messages.push({ id: RP.uid(), role: 'state', at: Date.now(), merged: true,
      lines: ['⇄ \u201c' + foldName + '\u201d folded into this scene' +
        (report.joined.length ? ' \u2014 ' + report.joined.join(', ') + ' ' + (report.joined.length === 1 ? 'is' : 'are') + ' here now' : '') +
        (report.stillAway.length ? ' (' + report.stillAway.join(', ') + ' still written out)' : '') + '.'] });
    if (stage.linkedTo === folded.id) stage.linkedTo = '';
    if (folded.linkedTo === stage.id) folded.linkedTo = '';
    folded.mergedInto = stage.id;
    stage.updated = Date.now();
    report.stage = stage; report.folded = folded;
    return report;
  };

  /** Of two linked scenes, the one the pair is filed under: the older. */
  RP.linkPrimary = function (state, room) {
    var other = RP.linkedRoom(state, room);
    if (!other) return room;
    var a = room.created || 0, b = other.created || 0;
    if (a !== b) return a < b ? room : other;
    return String(room.id) < String(other.id) ? room : other;
  };

  /** Assemble the whole system prompt for one turn. This is the only place
   *  the blocks are ordered, so the page and the tests agree on the shape. */
  RP.systemFor = function (state, room, speaker, opts) {
    opts = opts || {};
    var style = { style: opts.style || room.style || RP.DEFAULT_STYLE, scene: room.scene };
    // A solo room whose cast grew (an ENTER, an invite) is a group room
    // now; until the flag catches up, the solo card is at least the card
    // of whoever is actually speaking, not of whoever opened the chat.
    var lead = (room.cast || []).filter(function (c) { return speaker && c.id === speaker.id; })[0] || room.cast[0] || speaker || {};
    var base = room.kind === 'group'
      ? RP.groupPrompt(room.cast, speaker, style)
      : RP.soloPrompt(lead, style);
    var parts = [base];
    if (room.kind !== 'group' && room.scene) parts.push('THE SCENE\n' + room.scene);
    var perspective = RP.perspectiveBlock(room);
    if (perspective) parts.push(perspective);
    var meanwhile = RP.meanwhileBlock(state, room);
    if (meanwhile) parts.push(meanwhile);

    // Reference material — trimmed first when the window is tight.
    var source = RP.sourceBlock(room, opts.archive);
    if (source) parts.push(source);
    var recentText = opts.recent || RP.historyFor(room, 4).map(function (m) { return m.content; }).join(' ');
    var keywords = RP.keywordBlock(state, recentText);
    if (keywords) parts.push(keywords);
    var sceneFacts = RP.factsBlock(room);
    if (sceneFacts) parts.push(sceneFacts);
    var knowledge = RP.knowledgeBlock(state, room, opts.archive);
    if (knowledge) parts.push(knowledge);
    var book = RP.bookBlock(state, room, 0, recentText);
    if (book) parts.push(book);
    var taste = RP.tasteBlock(state, room);
    if (taste) parts.push(taste);
    if (opts.citations) parts.push(opts.citations);
    var script = RP.scriptBlock(room);
    if (script) parts.push(script);
    var lore = RP.loreBlock(state, room.cast, room);
    if (lore) parts.push(lore);
    var recap = RP.recapBlock(room);
    if (recap) parts.push(recap);
    var memory = RP.memoryBlock(state, room.cast, room);
    if (memory) parts.push(memory);

    // Everything from here is an instruction for THIS turn and is never
    // dropped to save room: the rules of the scene outrank the reading.
    var protectedFrom = parts.length;
    var continuation = RP.continuationBlock(room);
    if (continuation) parts.push(continuation);
    var direction = RP.directionBlock(room);
    if (direction) parts.push(direction);
    var moment = RP.momentBlock(room, RP.normChar(speaker || {}), opts.moment);
    if (moment) parts.push(moment);
    var audience = RP.audienceBlock(room, RP.normChar(speaker || {}).id,
      (state.settings && state.settings.audience) || RP.AUDIENCE_DEFAULT);
    if (audience) parts.push(audience);
    // Who the reader is — Waluigi, a persona, a stranger — used to sit with
    // the reference material and was the last block dropped on a tight
    // window. Wario talking to his brother as if to nobody is a worse
    // turn than one with a shorter biography, so it is kept.
    if (opts.ambient) {
      // Unattended: the reader is in the other scene. Their own character
      // may be the speaker this once, so "never write them" steps aside.
      parts.push(RP.liveBlock(room, RP.normChar(speaker || {}), opts.ambientSelf));
    }
    var persona = opts.ambientSelf ? '' : RP.personaBlock(room.persona || (state.user && state.user.persona) || '', state, room);
    if (persona) parts.push(persona);
    if (room.mechanics !== 'off') {
      var sheets = RP.stateBlock(room, RP.normChar(speaker || {}).id);
      if (sheets) parts.push(sheets);
      var named = RP.mentionBlock(room, opts.mentionText || '');
      if (named) parts.push(named);
      var pinged = RP.pingBlock(state, room, opts.mentions, opts.catalog);
      if (pinged) parts.push(pinged);
      var thinAir = RP.conjureBlock(opts.conjured, opts.conjureVerdict);
      if (thinAir) parts.push(thinAir);
      parts.push(RP.DIRECTIVES);
      var wounds = RP.hurtBlock(room, String(opts.mentionText || '') + ' ' + ((room.direction && room.direction.text) || ''));
      if (wounds) parts.push(wounds);
      var beyond = RP.beyondBlock(opts.fate);
      if (beyond) parts.push(beyond);
      // The reader's own mood colours how the cast reads them.
      var playerMood = RP.playerMoodBlock(room);
      if (playerMood) parts.push(playerMood);
      var playerBody = RP.playerBodyBlock(room);
      if (playerBody) parts.push(playerBody);
      var auditNotes = RP.auditNoteBlock(room);
      if (auditNotes) parts.push(auditNotes);
      // The speaker's body, then how they feel, as orders — the body
      // outranks the will, the mood is the colour of the box. Nothing
      // when they are whole and calm.
      var body = RP.bodyBlock(room, RP.normChar(speaker || {}));
      if (body) parts.push(body);
      var mood = RP.moodBlock(room, RP.normChar(speaker || {}));
      if (mood) parts.push(mood);
    }
    // The freshness ledger: nothing on a character who is not repeating.
    var fresh = RP.freshnessBlock(room, RP.normChar(speaker || {}), (state.settings && state.settings.fresh) || RP.FRESH_DEFAULT);
    if (fresh) parts.push(fresh);
    var antiRep = RP.antiRepetitionBlock(room, RP.normChar(speaker || {}), (state.settings && state.settings.antiRepetition) || RP.ANTI_REPETITION_DEFAULT);
    if (antiRep && (!opts.budget || opts.budget >= 10000)) parts.push(antiRep);
    var antiGen = RP.antiGenericBlock(room, RP.normChar(speaker || {}), (state.settings && state.settings.antiGeneric) || RP.ANTI_GENERIC_DEFAULT);
    if (antiGen && (!opts.budget || opts.budget >= 10000)) parts.push(antiGen);
    var fateBlock = RP.fateBlock(opts.fate);
    if (fateBlock) parts.push(fateBlock);
    var flourish = RP.flourishBlock(room, opts.fate);
    if (flourish) parts.push(flourish);
    var ooc = RP.oocBlock(state, room, opts.notes);
    if (ooc) parts.push(ooc);
    parts.push(RP.lengthBlock((state.settings && state.settings.length) || RP.DEFAULT_LENGTH, false).text);
    // Last word to the character. Two thousand characters of stage
    // directions used to be the final thing the model read before writing
    // Wario; now it is Wario.
    var down = opts.ambientSelf ? '' : RP.downNote(room);
    var closing = (down ? down + '\n' : '') + RP.closingLine(RP.normChar(speaker || room.cast[0] || {}), style.style);
    parts.push(closing);
    if (!opts.split) return RP.fitPrompt(parts, opts.budget, protectedFrom);
    return RP.splitForCache(parts, protectedFrom, {
      stage: room.kind === 'group' ? RP.groupStage(room.cast, style) : base,
      speaker: room.kind === 'group' ? RP.groupSpeaker(speaker) : '',
      stable: [room.kind !== 'group' && room.scene ? 'THE SCENE\n' + room.scene : '', perspective, source, lore, recap, persona,
        room.mechanics !== 'off' ? RP.DIRECTIVES : ''],
      closing: closing, budget: opts.budget,
    });
  };

  /** The cache layout. A local server (LM Studio, llama.cpp) reuses the
   *  work it did on the longest prefix the new prompt shares with an old
   *  one. The old prompt put the speaker's card ~200 tokens in and the
   *  per-turn reading after it, so every call shared almost nothing and
   *  the whole history was read again: the logs showed 28–65% kept.
   *
   *  Here the parts that hold still for the whole scene (the stage, the
   *  scene, the source filing, the lore, the recap, the persona, the
   *  directive grammar) form the system message; everything that changes
   *  turn to turn — who is speaking, what was looked up, moods, rolls,
   *  the length — becomes NOTES that ride on the newest message, after the
   *  history. Returns { system, notes, closing }. */
  RP.CACHE_HEAD_SHARE = 0.55;
  RP.splitForCache = function (parts, protectedFrom, opts) {
    var stable = (opts.stable || []).filter(Boolean);
    var head = [opts.stage], notes = opts.speaker ? [opts.speaker] : [];
    var guardFrom = -1;
    parts.forEach(function (p, i) {
      if (i === 0) return;                       // the base: rebuilt as stage + speaker
      if (stable.indexOf(p) >= 0) { head.push(p); return; }
      if (i >= protectedFrom && guardFrom < 0) guardFrom = notes.length;
      notes.push(p);
    });
    var cap = opts.budget || RP.PROMPT_BUDGET;
    var system = RP.fitPrompt(head, Math.round(cap * RP.CACHE_HEAD_SHARE), head.length);
    var text = RP.fitPrompt(notes, Math.max(2000, cap - system.length), guardFrom < 0 ? notes.length : guardFrom);
    var closing = opts.closing || '';
    var at = closing ? text.lastIndexOf(closing) : -1;
    return {
      system: system,
      notes: (at >= 0 ? text.slice(0, at) : text).trim(),
      closing: at >= 0 ? closing : '',
    };
  };

  /** The newest message as the model reads it under the cache layout: the
   *  turn's notes, then what the player actually said, then the closing
   *  line — the last thing read before writing, as before. */
  RP.withNotes = function (messages, split, extra) {
    var out = (messages || []).slice();
    var last = out[out.length - 1];
    if (!last || last.role !== 'user') out.push(last = { role: 'user', content: '(The scene carries on.)' });
    var notes = [split.notes].concat(extra || []).filter(Boolean).join('\n\n');
    out[out.length - 1] = {
      role: 'user',
      content: (notes ? '[NOTES FOR THIS TURN — for you, not said aloud; never quote them]\n' + notes + '\n[END OF NOTES]\n\n' : '') +
        last.content + (split.closing ? '\n\n' + split.closing : ''),
    };
    return out;
  };

  // A local model has a context window and the server refuses anything over
  // 32k characters, so the prompt is budgeted rather than hoped about. The
  // default suits a small window; Settings can raise it for a bigger model.
  RP.PROMPT_BUDGET = 11000;
  RP.PROMPT_BUDGET_MAX = 30000;

  /* ---- the history, packed by characters rather than counted by turns.
   * A long chat should cost turns, not paragraphs: one 6,000-character
   * monologue used to crowd out ten normal turns and slow the model to a
   * crawl. Newest turns first, each clipped to a sane length, packed into
   * a character budget — the turn COUNT limit still applies on top. ---- */

  RP.HISTORY_BUDGET = 6500;
  RP.TURN_CLIP = 1600;
  RP.OLD_CLIP = 450;        // what a turn is worth once it is old news

  /** packHistory for the cache layout: the window's first message and the
   *  line between clipped and whole turns move only every `step` messages,
   *  so for most turns the history the model already read is a byte-for-
   *  byte prefix of the new one. Counted from the recap point (historyFor
   *  starts there), which is also where the prefix starts over anyway. */
  RP.HISTORY_STEP = 6;
  RP.packHistoryStepped = function (messages, budget, opts) {
    opts = opts || {};
    var list = messages || [];
    var cap = Number(budget) || RP.HISTORY_BUDGET;
    var floor = opts.minTurns === undefined ? 6 : opts.minTurns;
    var step = opts.step || RP.HISTORY_STEP;
    var n = list.length;
    var wholeFrom = Math.max(0, Math.floor((n - floor) / step) * step);
    var sized = list.map(function (m, i) {
      var c = String(m.content || '');
      var limit = i >= wholeFrom ? RP.TURN_CLIP : RP.OLD_CLIP;
      return c.length > limit ? { role: m.role, content: clip(c, limit) } : m;
    });
    var start = n, used = 0;
    while (start > 0) {
      var len = String(sized[start - 1].content || '').length;
      if (used + len > cap && n - start >= floor) break;
      used += len; start--;
    }
    if (opts.maxTurns) start = Math.max(start, n - opts.maxTurns);
    // Round the start UP to the step, which only ever drops more, so the
    // budget still holds — unless that would cut below the floor.
    var stepped = Math.ceil(start / step) * step;
    if (n - stepped >= Math.min(floor, n)) start = stepped;
    return sized.slice(start);
  };

  RP.packHistory = function (messages, budget, minTurns) {
    var cap = Number(budget) || RP.HISTORY_BUDGET;
    var floor = minTurns === undefined ? 6 : minTurns;
    var out = [], used = 0;
    for (var i = (messages || []).length - 1; i >= 0; i--) {
      var m = messages[i];
      var content = String(m.content || '');
      // The last few turns arrive whole; older ones are clipped hard.
      // A Director monologue from ten turns ago earns a paragraph, not
      // sixteen hundred characters of prefill every turn since.
      var turnCap = out.length < floor ? RP.TURN_CLIP : RP.OLD_CLIP;
      if (content.length > turnCap) content = clip(content, turnCap);
      if (used + content.length > cap && out.length >= floor) break;
      out.unshift(content === m.content ? m : { role: m.role, content: content });
      used += content.length;
    }
    return out;
  };

  /** Assemble the prompt inside the budget. The character card, the rules
   *  and the turn's own instructions are never dropped; the reference
   *  material at the back is trimmed, oldest lines first, until it fits. */
  var TRIM_NOTE = ' (trimmed to fit the model\u2019s window)';
  RP.fitPrompt = function (parts, budget, protectedFrom) {
    var cap = budget || RP.PROMPT_BUDGET;
    var keepFrom = protectedFrom === undefined ? parts.length : protectedFrom;
    var text = parts.join('\n\n');
    if (text.length <= cap) return text;
    // Reference blocks, in the order they are sacrificed. Halving is
    // repeated before anything is dropped outright: a block cut to a
    // quarter still cites something, a block deleted cites nothing.
    var soft = ['FILES YOU MAY CITE', 'THE LORE BOOK', 'WHAT HAS ALREADY HAPPENED', 'ESTABLISHED LORE',
      'ALREADY HISTORY', 'THE MAIN EVENT', 'Filed description'];
    for (var pass = 0; pass < 3 && text.length > cap; pass++) {
      for (var i = 0; i < soft.length && text.length > cap; i++) {
        parts = parts.map(function (part, at) {
          if (at >= keepFrom || part.indexOf(soft[i]) < 0) return part;
          var lines = part.split('\n');
          if (at === 0) {
            // The base prompt carries the card, the VOICE, the rules and
            // the style in one part. Halving it by lines used to throw the
            // rules and the voice away to save the biography; now only the
            // description paragraph gives ground.
            var head = -1;
            for (var k = 0; k < lines.length; k++) { if (lines[k].indexOf('Filed description') === 0) { head = k; break; } }
            if (head < 0 || head + 1 >= lines.length || lines[head + 1].length < 200) return part;
            lines[head + 1] = clip(lines[head + 1].replace(TRIM_NOTE, ''), Math.floor(lines[head + 1].length / 2)) + TRIM_NOTE;
            return lines.join('\n');
          }
          if (lines.length < 4) return part;
          return lines.slice(0, Math.max(3, Math.floor(lines.length / 2))).join('\n') +
            '\n… (trimmed to fit the model\u2019s window)';
        });
        text = parts.join('\n\n');
      }
    }
    // Still too long: drop whole reference blocks, back to front, never
    // touching the character card at the head or the instructions at the end.
    var at = keepFrom - 1;
    while (text.length > cap && at > 0) {
      parts.splice(at, 1);
      keepFrom--; at--;
      text = parts.join('\n\n');
    }
    // Still too long — the card and the instructions alone do not fit. The
    // old answer was to slice the end off, which is where the stage
    // directions and the length live. Squeeze the head instead, by degrees.
    for (var level = 1; level <= 4 && text.length > cap; level++) {
      parts[0] = squeezeBase(parts[0], level);
      text = parts.join('\n\n');
    }
    if (text.length <= cap) return text;
    // Last resort: cut from the middle, not the end. The end is the closing
    // line — slicing it off (the logs showed exactly that) left the model
    // writing with no idea who it was answering as.
    var tail = parts[parts.length - 1];
    if (tail.length > cap / 3) return text.slice(0, cap - 40) + '\n… (truncated)';
    // The turn's instructions run most-important first (the 🎬 direction,
    // the moment, the audience) to least (flourish, OOC notes, the length
    // guide), so whole blocks go from just before the closing line first.
    var body = parts.slice(0, -1);
    while (body.length > 2 && (body.join('\n\n') + '\n\n' + tail).length > cap) body.splice(body.length - 1, 1);
    body = body.join('\n\n');
    if (body.length + tail.length + 2 <= cap) return body + '\n\n' + tail;
    return body.slice(0, cap - tail.length - 40) + '\n… (truncated)\n\n' + tail;
  };

  /** The base prompt with less in it, keeping what makes the character
   *  themselves for as long as possible. Decoration goes first, the voice
   *  last:
   *    1  the colour-markup rule, the other cast members' summaries, a
   *       shorter About and description
   *    2  the voice's Never line, four sample lines, a short description
   *    3  the Sounds like line, three sample lines, titles and the scene
   *       clipped, the description down to a sentence
   *    4  no sample lines at all — the register paragraph is the floor */
  function squeezeBase(part, level) {
    var lines = String(part || '').split('\n');
    var out = [], examples = 0, inVoice = false, inCast = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('VOICE \u2014') === 0) { inVoice = true; inCast = false; }
      else if (line === 'THE CAST') { inCast = true; }
      else if (/^[A-Z][A-Z \u2014-]{4,}$/.test(line.trim()) && line.trim() === line.trim().toUpperCase()) { inVoice = false; inCast = false; }
      else if (/^YOU ARE /.test(line)) { inCast = false; }
      if (/^    \S/.test(line)) continue;                                // a cast member's summary
      if (/^You may colour a few words/.test(line)) continue;              // decoration first
      if (level >= 3 && /^Every turn moves the scene/.test(line)) continue; // the voice lines outrank it on a tight window
      if (inVoice && /^Never:/.test(line) && level >= 2) continue;
      if (inVoice && /^Sounds like:/.test(line) && level >= 3) continue;
      if (inVoice && /^  \u201c/.test(line)) {
        examples++;
        if (level >= 4 || examples > (level >= 3 ? 3 : 4)) continue;
      }
      if (inVoice && level >= 4 && /own mouth/.test(line)) continue;
      if (inCast && level >= 2 && /^- /.test(line)) line = clip(line, level >= 3 ? 90 : 140);   // name — title (affiliation)
      if (level >= 3 && /^(Title|Affiliation|Faction): /.test(line)) line = clip(line, 110);
      if (/^About: /.test(line)) line = clip(line, level >= 3 ? 200 : 360);
      if (i > 0 && lines[i - 1].indexOf('Filed description') === 0) {
        var want = level >= 3 ? 160 : level >= 2 ? 400 : 700;
        if (line.length > want) line = clip(line.replace(TRIM_NOTE, ''), want) + TRIM_NOTE;
      }
      if (level >= 3 && i > 0 && lines[i - 1] === 'THE SCENE') line = clip(line, 700);   // a group prompt carries its scene
      out.push(line);
    }
    return out.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * perspective dynamic replay
   * ------------------------------------------------------------------ */

  /** Turn a played chat into a script: its own fired beats first, then the
   *  turns that actually moved, evenly sampled so a long chat still fits. */
  RP.beatsFromRoom = function (room, limit) {
    limit = limit || 8;
    var out = [];
    (room.messages || []).filter(function (m) { return m.beat; }).forEach(function (m) {
      var parts = String(m.text).split('\n');
      var head = parts[0].split(' — ');
      out.push({
        time: head.length > 1 ? head[0] : '',
        beat: clip(head.length > 1 ? head.slice(1).join(' — ') : parts[0], 140),
        detail: clip(parts.slice(1).join(' '), 260),
      });
    });
    if (out.length < limit) {
      var turns = (room.messages || []).filter(visible);
      var step = Math.max(1, Math.ceil(turns.length / (limit - out.length)));
      for (var i = 0; i < turns.length; i += step) {
        var m = turns[i];
        var who = m.role === 'user' ? 'The player' :
          (((room.cast || []).filter(function (c) { return c.id === m.charId; })[0] || {}).name || 'Someone');
        out.push({
          time: '', beat: clip(who + ': ' + RP.textOf(m).replace(/\s+/g, ' '), 140),
          detail: clip(RP.textOf(m), 260),
        });
      }
    }
    return out.slice(0, limit);
  };

  /** Build a replay room: the same events, a new cast, a different vantage. */
  RP.replayRoom = function (state, source, cast, opts) {
    opts = opts || {};
    var beats = Array.isArray(opts.beats) && opts.beats.length ? opts.beats : RP.beatsFromRoom(source);
    var name = opts.sceneName || source.sceneName || source.title;
    var room = RP.newRoom(cast, {
      scene: opts.scene || source.scene || ('The events of "' + name + '", seen from somewhere else.'),
      sceneName: name,
      sceneImage: opts.sceneImage || source.sceneImage || '',
      perspective: opts.perspective || (cast || []).map(function (c) { return c.name; }).join(', '),
      replayOf: source.id || '',
      beats: beats,
      style: opts.style || source.style || RP.DEFAULT_STYLE,
      persona: opts.persona || '',
      opener: opts.opener || ('Replay — ' + name + ', from the perspective of ' +
        ((cast || []).map(function (c) { return c.name; }).join(', ') || 'someone else') + '.'),
    });
    room.title = opts.title || ('Replay: ' + clip(name, 40));
    RP.logEvent(state, {
      kind: 'replay', roomId: room.id, roomTitle: room.title,
      chars: (cast || []).map(function (c) { return c.id; }),
      text: 'A replay of "' + name + '" was opened from the perspective of ' + room.perspective + '.',
    });
    return room;
  };

  /* ------------------------------------------------------------------ *
   * transcripts, buckets, storage, bundles
   * ------------------------------------------------------------------ */

  /** Markdown export of one chat — the shape that files back into the wiki. */
  RP.transcript = function (room) {
    var lines = [];
    lines.push('# ' + (room.kind === 'group' ? 'Group: ' : '') + room.title);
    lines.push('');
    lines.push('**Cast:** ' + (room.cast || []).map(function (c) { return c.name; }).join(', '));
    if (room.sceneName) lines.push('**Scene:** ' + room.sceneName);
    if (room.perspective) lines.push('**Perspective:** ' + room.perspective);
    lines.push('');
    (room.messages || []).forEach(function (m) {
      if (m.error) return;
      if (m.role === 'scene') { lines.push('> ' + String(RP.textOf(m)).replace(/\n/g, '\n> '), ''); return; }
      if (m.role === 'user') { lines.push('**You:** ' + RP.textOf(m), ''); return; }
      var who = ((room.cast || []).filter(function (c) { return c.id === m.charId; })[0] || {}).name || 'Character';
      lines.push('**' + who + ':** ' + RP.textOf(m), '');
    });
    lines.push('---', 'Exported from Waluipedia Roleplay — ' + new Date().toISOString().slice(0, 10) + '.');
    return lines.join('\n');
  };

  /** Two linked scenes as one transcript: every visible turn of both, in
   *  the order they happened, with a marker each time the camera moves
   *  from one scene to the other. Directions and carried-over things are
   *  kept — they are how the scenes touched. `opts.plain` drops the
   *  markdown; `opts.user` names you when you play nobody. */
  RP.linkedTranscript = function (state, room, opts) {
    opts = opts || {};
    var other = RP.linkedRoom(state, room);
    var rooms = other ? [room, other] : [room];
    var plain = Boolean(opts.plain);
    var nameOf = function (r) { return r.sceneName || r.title; };
    var who = function (r, m) {
      if (m.role === 'world') return 'Narrator';
      if (m.role === 'user') { var you = RP.playerCharacter(r); return you ? you.name : (opts.user || 'You'); }
      return ((r.cast || []).filter(function (c) { return c.id === m.charId; })[0] || {}).name || 'Character';
    };
    var all = [];
    rooms.forEach(function (r) {
      (r.messages || []).forEach(function (m) {
        if (m.error) return;
        var keep = (RP.visible(m) && (m.role === 'user' || m.role === 'char' || m.role === 'world')) ||
          (m.role === 'scene' && m.direction);
        if (keep) all.push({ r: r, m: m });
      });
    });
    all.sort(function (a, b) { return (a.m.at || 0) - (b.m.at || 0); });
    var bold = function (t) { return plain ? t : '**' + t + '**'; };
    var lines = [];
    lines.push(plain ? (nameOf(room) + (other ? ' ⇄ ' + nameOf(other) : '')).toUpperCase()
      : '# ' + nameOf(room) + (other ? ' ⇄ ' + nameOf(other) : ''), '');
    rooms.forEach(function (r) {
      lines.push(bold(nameOf(r)) + ' — ' + (r.cast || []).map(function (c) { return c.name; }).join(', ') +
        (r.scene ? (plain ? '. ' : ' — ') + RP.clip(r.scene, 220) : ''));
    });
    if (other) lines.push('', plain ? 'Two scenes, the same hour, interleaved by the clock.' : '*Two scenes, the same hour, interleaved by the clock.*');
    lines.push('');
    var cur = null;
    all.forEach(function (e) {
      if (e.r !== cur) {
        cur = e.r;
        lines.push(plain ? '— ⇄ ' + nameOf(cur) + ' —' : '### ⇄ ' + nameOf(cur), '');
      }
      var text = String(RP.textOf(e.m));
      if (e.m.role === 'scene') {
        lines.push(plain
          ? '[' + (e.m.from ? 'Carried over from ' + e.m.from + ': ' : 'Direction: ') + text + ']'
          : '> ' + (e.m.from ? '⟶ *from “' + e.m.from + '”* — ' : '🎬 ') + text.replace(/\n/g, '\n> '), '');
        return;
      }
      lines.push((plain ? who(e.r, e.m) + ': ' : bold(who(e.r, e.m) + ':') + ' ') + text, '');
    });
    if (!plain) lines.push('---', 'Exported from Waluipedia Roleplay — ' + new Date().toISOString().slice(0, 10) + '.');
    return lines.join('\n');
  };

  /** Recents, in the buckets the sidebar shows. */
  RP.groupBuckets = function (rooms) {
    var midnight = new Date(new Date().toDateString()).getTime();
    var out = { today: [], yesterday: [], month: [], older: [] };
    (rooms || []).slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }).forEach(function (r) {
      var at = r.updated || 0;
      if (at >= midnight) out.today.push(r);
      else if (at >= midnight - 864e5) out.yesterday.push(r);
      else if (at >= midnight - 30 * 864e5) out.month.push(r);
      else out.older.push(r);
    });
    return out;
  };

  RP.KEY = 'waluipedia-chatroom-v1';

  function blankState() {
    return {
      version: 1,
      user: { name: 'Archivist', handle: 'waluipedia', persona: '', avatar: '' },
      rooms: [], chars: [], lore: [], log: [], scenarios: [], active: '',
      book: { entries: [], queue: [], spent: 0 },   // the lore book, written as you play
      persona: { name: '', look: '', voice: '', items: [], notes: '' },  // the player, across every chat
      keywords: [],        // trigger words → exact lore, injected on sight
      taste: { likes: [], dislikes: [], chars: {} },   // 👍 / 👎, fed back to the model
      episodes: [],        // commentary tracks, Waluigi and Luigi at length
      newChars: [],        // characters invented during play, described not drawn
      hooks: {},           // scenario id -> the opener the model wrote
      backfillUses: {},    // backfill id -> how many times it has been played
      usedPosts: {},   // wire post id -> where it was played
      settings: {
        style: RP.DEFAULT_STYLE, voice: 'off', temperature: 0.85, endpoint: '',
        director: 'on',            // let the model decide who speaks next
        length: RP.DEFAULT_LENGTH, // snappy | normal | rich | adaptive (the scene decides)
        narrator: 'director',      // director | plain | terse | archivist
        world: 'on',               // let the world narrate when nobody else can
        autoplay: 0,               // turns to play on their own before stopping
        book: 'on',                // write the lore book in the background
        bookEvery: 3,              // …after every N played turns
        bookBudget: RP.BOOK_BUDGET,
        fate: 'normal',            // off | gentle | normal | harsh
        statePreset: 'rpg',
        maxChain: RP.MAX_CHAIN,    // …but never more than this before you
        antiRepetition: RP.ANTI_REPETITION_DEFAULT,
        antiGeneric: RP.ANTI_GENERIC_DEFAULT,
      },
    };
  }
  RP.blankState = blankState;

  /** Read the saved state. A damaged or empty store yields a clean one. */
  RP.loadState = function (store, key) {
    var state = blankState();
    try {
      var raw = store.getItem(key || RP.KEY);
      var value = raw ? JSON.parse(raw) : null;
      if (value && typeof value === 'object') {
        ['rooms', 'chars', 'lore', 'log', 'scenarios', 'newChars', 'episodes'].forEach(function (k) {
          if (Array.isArray(value[k])) state[k] = value[k];
        });
        if (typeof value.active === 'string') state.active = value.active;
        if (value.usedPosts && typeof value.usedPosts === 'object') state.usedPosts = value.usedPosts;
        if (value.hooks && typeof value.hooks === 'object') state.hooks = value.hooks;
        if (value.taste && typeof value.taste === 'object') state.taste = value.taste;
        if (value.persona && typeof value.persona === 'object') state.persona = value.persona;
        if (Array.isArray(value.keywords)) state.keywords = value.keywords;
        if (value.book && typeof value.book === 'object') {
          state.book = { entries: value.book.entries || [], queue: [], spent: 0 };
        }
        if (value.backfillUses && typeof value.backfillUses === 'object') state.backfillUses = value.backfillUses;
        if (value.user && typeof value.user === 'object') state.user = Object.assign(state.user, value.user);
        if (value.settings && typeof value.settings === 'object') state.settings = Object.assign(state.settings, value.settings);
      }
    } catch (e) { /* a corrupt store is an empty store */ }
    RP.sweepEmptyItems(state);
    return state;
  };

  /** One-time: chats opened before "In character" existed carry the old
   *  default, Novel — not because anybody chose it, but because newRoom
   *  wrote it. Move them over once, say how many, and never touch a
   *  room again (Style is one click away for anyone who wants Novel back). */
  RP.migrateStyle = function (state) {
    if (!state || !state.settings || state.settings.styleMigrated) return 0;
    var moved = 0;
    (state.rooms || []).forEach(function (r) {
      if (r && r.style === 'novel') { r.style = RP.DEFAULT_STYLE; moved++; }
    });
    if (state.settings.style === 'novel') state.settings.style = RP.DEFAULT_STYLE;
    state.settings.styleMigrated = 1;
    return moved;
  };

  /** The length setting began life as 'snappy', saved into every browser
   *  as a default nobody chose; now the scene decides. Runs once: a
   *  reader who later pins Snappy on purpose keeps it. */
  RP.migrateLength = function (state) {
    if (!state || !state.settings || state.settings.lengthMigrated) return false;
    state.settings.lengthMigrated = 1;
    if (state.settings.length && state.settings.length !== 'snappy') return false;
    state.settings.length = RP.DEFAULT_LENGTH;
    return true;
  };

  /** Write the state back, newest 30 rooms only. */
  RP.saveState = function (store, state) {
    var rooms = (state.rooms || []).slice().sort(function (a, b) {
      return (b.updated || 0) - (a.updated || 0);
    }).slice(0, 30);
    var value = {
      version: 1,
      user: state.user, settings: state.settings, active: state.active,
      rooms: rooms, chars: state.chars || [], lore: state.lore || [], log: (state.log || []).slice(-400),
      usedPosts: state.usedPosts || {},
      hooks: state.hooks || {},
      newChars: (state.newChars || []).slice(0, 80),
      episodes: (state.episodes || []).slice(0, 20),
      taste: state.taste || { likes: [], dislikes: [], chars: {} },
      persona: state.persona || {},
      keywords: (state.keywords || []).slice(-60),
      // The queue is deliberately not saved: unfinished background work
      // should not come back to life on the next page load.
      book: { entries: (state.book && state.book.entries) || [], queue: [], spent: 0 },
      backfillUses: state.backfillUses || {},
      scenarios: (state.scenarios || []).slice(0, 30),
    };
    try {
      store.setItem(RP.KEY, JSON.stringify(value));
      return true;
    } catch (e) {
      // Out of quota: drop the oldest rooms until it fits rather than losing
      // the lore and the memory, which are much smaller and much harder to redo.
      for (var keep = 10; keep >= 1; keep = Math.floor(keep / 2)) {
        try {
          value.rooms = rooms.slice(0, keep);
          store.setItem(RP.KEY, JSON.stringify(value));
          return true;
        } catch (e2) { /* keep shrinking */ }
      }
      return false;
    }
  };

  /* ---- import / export bundles ---- */

  RP.BUNDLE_KIND = 'waluipedia-chatroom-bundle';

  /** A portable backup. Chats, lore and memory can travel together or alone. */
  RP.exportBundle = function (state, opts) {
    opts = opts || {};
    var want = function (k) { return opts[k] === undefined ? true : Boolean(opts[k]); };
    var bundle = {
      kind: RP.BUNDLE_KIND,
      version: 1,
      exported: new Date().toISOString(),
      user: want('user') ? state.user : undefined,
    };
    if (want('chats')) bundle.rooms = (opts.rooms || state.rooms || []);
    if (want('lore')) {
      bundle.lore = state.lore || [];
      bundle.scenarios = state.scenarios || [];   // written scenarios are lore too
      bundle.newChars = state.newChars || [];     // so are the people invented in play
      bundle.book = (state.book && state.book.entries) || [];
      bundle.episodes = state.episodes || [];
      bundle.taste = state.taste || null;
      bundle.keywords = state.keywords || [];
    }
    if (want('memory')) {
      bundle.chars = state.chars || [];
      bundle.log = state.log || [];
      bundle.usedPosts = state.usedPosts || {};
      bundle.backfillUses = state.backfillUses || {};
      bundle.hooks = state.hooks || {};
    }
    return bundle;
  };

  /** Load a backup. `merge` keeps what is here and adds what is missing (newer
   *  copies of the same id win); `replace` swaps the named sections outright. */
  RP.importBundle = function (state, data, mode) {
    if (!data || typeof data !== 'object') throw new Error('not a chatroom bundle');
    if (data.kind && data.kind !== RP.BUNDLE_KIND) throw new Error('unknown bundle kind: ' + data.kind);
    var replace = mode === 'replace';
    var stats = { rooms: 0, lore: 0, chars: 0, log: 0, scenarios: 0 };

    function mergeById(current, incoming, pick) {
      var byId = {};
      (replace ? [] : current).forEach(function (item) { byId[item.id] = item; });
      (incoming || []).forEach(function (item) {
        if (!item || !item.id) return;
        var existing = byId[item.id];
        byId[item.id] = existing ? pick(existing, item) : item;
      });
      return Object.keys(byId).map(function (k) { return byId[k]; });
    }

    if (Array.isArray(data.rooms)) {
      var before = (state.rooms || []).length;
      // A chat that is already on file is not a failure — it is a merge.
      // Count what actually happened so the toast can tell the truth
      // instead of “Imported 0 chats” over a perfectly good bundle.
      stats.roomsUpdated = 0;   // the bundle's copy was newer and replaced ours
      stats.roomsSame = 0;      // already on file, ours as new or newer — kept
      if (!replace) {
        var have = {};
        (state.rooms || []).forEach(function (r) { if (r && r.id) have[r.id] = r; });
        (data.rooms || []).forEach(function (r) {
          if (!r || !r.id || !have[r.id]) return;
          if ((r.updated || 0) > (have[r.id].updated || 0)) stats.roomsUpdated++;
          else stats.roomsSame++;
        });
      }
      state.rooms = mergeById(state.rooms || [], data.rooms, function (a, b) {
        return (b.updated || 0) >= (a.updated || 0) ? b : a;
      });
      stats.rooms = state.rooms.length - (replace ? 0 : before);
    }
    if (Array.isArray(data.lore)) {
      var loreBefore = (state.lore || []).length;
      state.lore = mergeById(state.lore || [], data.lore, function (a, b) { return b; });
      stats.lore = state.lore.length - (replace ? 0 : loreBefore);
    }
    if (Array.isArray(data.keywords)) {
      state.keywords = mergeById(state.keywords || [], data.keywords, function (a, b) { return b; }).slice(-60);
    }
    if (data.persona && typeof data.persona === 'object' && replace) state.persona = data.persona;
    if (data.taste && typeof data.taste === 'object') {
      var mine = tasteState(state);
      state.taste = replace ? data.taste : {
        likes: mergeById(mine.likes, data.taste.likes || [], function (a, b) { return b; }).slice(-RP.TASTE_KEEP),
        dislikes: mergeById(mine.dislikes, data.taste.dislikes || [], function (a, b) { return b; }).slice(-RP.TASTE_KEEP),
        chars: Object.assign({}, mine.chars, data.taste.chars || {}),
      };
    }
    if (Array.isArray(data.episodes)) {
      state.episodes = mergeById(state.episodes || [], data.episodes, function (a, b) { return b; }).slice(0, 20);
    }
    if (Array.isArray(data.book)) {
      var bookNow = bookState(state);
      bookNow.entries = replace ? data.book : mergeById(bookNow.entries, data.book, function (a, b) { return b; });
      stats.book = bookNow.entries.length;
    }
    if (Array.isArray(data.newChars)) {
      state.newChars = mergeById(state.newChars || [], data.newChars, function (a, b) { return b; });
    }
    if (Array.isArray(data.scenarios)) {
      var scenBefore = (state.scenarios || []).length;
      state.scenarios = mergeById(state.scenarios || [], data.scenarios, function (a, b) { return b; });
      stats.scenarios = state.scenarios.length - (replace ? 0 : scenBefore);
    }
    if (Array.isArray(data.chars)) {
      var charsBefore = (state.chars || []).length;
      state.chars = mergeById(state.chars || [], data.chars, function (a, b) {
        // Two memories of the same character merge: notes join, knowledge unions.
        var notes = (a.notes || []).concat(b.notes || []);
        var seen = {}, joined = [];
        notes.sort(function (x, y) { return (x.at || 0) - (y.at || 0); }).forEach(function (n) {
          var key = n.at + '|' + n.text;
          if (!seen[key]) { seen[key] = 1; joined.push(n); }
        });
        var knowledge = (a.knowledge || []).slice();
        (b.knowledge || []).forEach(function (k) { if (knowledge.indexOf(k) < 0) knowledge.push(k); });
        return {
          id: a.id, name: b.name || a.name, mood: b.mood || a.mood,
          notes: joined.slice(-60), knowledge: knowledge.slice(-40),
          relations: Object.assign({}, a.relations || {}, b.relations || {}),
          firstSeen: Math.min(a.firstSeen || Date.now(), b.firstSeen || Date.now()),
        };
      });
      stats.chars = state.chars.length - (replace ? 0 : charsBefore);
    }
    if (Array.isArray(data.log)) {
      var logBefore = (state.log || []).length;
      state.log = mergeById(state.log || [], data.log, function (a, b) { return b; })
        .sort(function (a, b) { return (a.at || 0) - (b.at || 0); }).slice(-400);
      stats.log = state.log.length - (replace ? 0 : logBefore);
    }
    if (data.hooks && typeof data.hooks === 'object') {
      state.hooks = replace ? data.hooks : Object.assign({}, state.hooks || {}, data.hooks);
    }
    if (data.backfillUses && typeof data.backfillUses === 'object') {
      state.backfillUses = replace ? data.backfillUses : Object.assign({}, state.backfillUses || {}, data.backfillUses);
    }
    if (data.usedPosts && typeof data.usedPosts === 'object') {
      state.usedPosts = replace ? data.usedPosts : Object.assign({}, state.usedPosts || {}, data.usedPosts);
    }
    if (data.user && replace) state.user = Object.assign(state.user || {}, data.user);
    return stats;
  };

  window.RP = RP;
})();
