/* ==========================================================================
 * Waluipedia chatroom — 🏚 planned adventures ("mansion mode").
 *
 * The GM plans the house (rooms, keys, ghosts, clues, fixed beats, a sung
 * cutscene) in Reputation-Matrix2/data/mansions.json; the model only plays
 * reactions inside it. This file has two halves:
 *
 *   RP.mansion.*        pure logic on a chat room's `room.mansion` state
 *   RP.mansionBlock()   the prompt block — the CURRENT room only, so the
 *                       model cannot spoil rooms the party has not reached
 *   RP.mansionUI.*      the 🏚 Adventures dashboard and the 🏚 House dock
 *                       tab; the page hands in its helpers as `ctx`
 *
 * Loaded after chatroom-core.js and before chatroom-app.js.
 * Guide: docs/CHATROOM_GUIDE.md → "🏚 Adventures".
 * ======================================================================== */
(function (RP) {
  'use strict';
  if (!RP) return;
  var M = RP.mansion = {};
  M.plans = [];

  M.setPlans = function (data) {
    var list = Array.isArray(data) ? data : ((data && data.mansions) || []);
    M.plans = list.filter(function (p) { return p && p.id && Array.isArray(p.rooms); });
    return M.plans;
  };
  M.plan = function (id) { return M.plans.filter(function (p) { return p.id === id; })[0] || null; };
  M.planFor = function (chat) { return chat && chat.mansion ? M.plan(chat.mansion.plan) : null; };
  M.roomOf = function (plan, id) { return ((plan && plan.rooms) || []).filter(function (r) { return r.id === id; })[0] || null; };
  M.clueOf = function (plan, id) { return ((plan && plan.clues) || []).filter(function (c) { return c.id === id; })[0] || null; };
  M.beatOf = function (plan, id) { return ((plan && plan.beats) || []).filter(function (b) { return b.id === id; })[0] || null; };
  M.itemLabel = function (plan, id) { var it = ((plan && plan.items) || {})[id]; return (it && it.label) || id; };
  function has(list, x) { return (list || []).indexOf(x) >= 0; }
  function add(list, x) { if (!has(list, x)) list.push(x); return list; }

  /** A fresh run of a plan. */
  M.start = function (plan) {
    return {
      plan: plan.id, at: plan.start || plan.rooms[0].id,
      visited: [plan.start || plan.rooms[0].id], cleared: [],
      items: [], money: 0, clues: [], flags: [], fired: [],
      order: (plan.party || []).slice(), orderSet: false,
      split: null, offstage: [], captive: [], npcs: [],
    };
  };

  M.areaOpen = function (plan, st, n) {
    return Number(n) <= 1 || has(st.items, 'area_key_' + (Number(n) - 1));
  };

  /** '' when the party may walk in; otherwise what stops them. */
  M.lockFor = function (plan, st, room) {
    if (!room) return 'no such room';
    if (!M.areaOpen(plan, st, room.area)) return 'area ' + room.area + ' is locked';
    var why = [];
    (room.needs || []).forEach(function (k) { if (!has(st.items, k)) why.push(M.itemLabel(plan, k)); });
    (room.via || []).forEach(function (r) { if (!has(st.visited, r)) why.push('through ' + ((M.roomOf(plan, r) || {}).name || r)); });
    (room.clues || []).forEach(function (c) { if (!has(st.clues, c)) why.push('clue: ' + ((M.clueOf(plan, c) || {}).title || c)); });
    if (room.flag && !has(st.flags, room.flag)) why.push(room.flag === 'blackout' ? 'the blackout' : room.flag);
    return why.length ? 'needs ' + why.join(', ') : '';
  };

  /** Rooms the dock may show: every room of an open area. Rooms of a
   *  locked area stay off the list — the plan is a spoiler too. */
  M.knownRooms = function (plan, st) {
    return plan.rooms.filter(function (r) { return M.areaOpen(plan, st, r.area); });
  };

  /* ---------------- the cast: who is physically in this scene ---------------- */

  function pull(chat, id) {
    var c = (chat.cast || []).filter(function (x) { return x.id === id; })[0];
    if (!c) return null;
    chat.cast = chat.cast.filter(function (x) { return x.id !== id; });
    if (chat.states && chat.states[id]) chat.states[id].present = false;
    if (chat.next === id) chat.next = '';
    return c;
  }
  function put(chat, char) {
    if (!char || !char.id) return;
    if ((chat.cast || []).some(function (x) { return x.id === char.id; })) return;
    RP.addToRoom(chat, char);
    if (chat.states && chat.states[char.id]) chat.states[char.id].present = true;
  }
  M.pull = pull; M.put = put;
  function nameOf(chat, castById, id) {
    var c = (chat.cast || []).filter(function (x) { return x.id === id; })[0] ||
      ((chat.mansion && chat.mansion.offstage) || []).concat((chat.mansion && chat.mansion.captive) || [])
        .map(function (o) { return o.char; }).filter(function (x) { return x && x.id === id; })[0] ||
      (castById || {})[id];
    return (c && c.name) || id;
  }
  M.nameOf = nameOf;

  /** Walk into a room. Returns { ok, why, room }. NPCs the last room
   *  brought in leave; the new room's own NPCs arrive. */
  M.enter = function (chat, plan, id, castById) {
    var st = chat.mansion;
    var room = M.roomOf(plan, id);
    var why = M.lockFor(plan, st, room);
    if (why) return { ok: false, why: why, room: room };
    (st.npcs || []).forEach(function (npc) { pull(chat, npc); });
    st.npcs = [];
    (room.npcs || []).forEach(function (npc) {
      var c = (castById || {})[npc];
      if (c && !(chat.cast || []).some(function (x) { return x.id === npc; })) { put(chat, c); st.npcs.push(npc); }
    });
    st.at = id;
    add(st.visited, id);
    chat.updated = Date.now();
    return { ok: true, room: room };
  };

  /** The room is won or searched: hand over what it holds. */
  M.clear = function (chat, plan) {
    var st = chat.mansion;
    var room = M.roomOf(plan, st.at);
    if (!room || has(st.cleared, room.id)) return [];
    var got = [];
    (room.rewards || []).forEach(function (k) { add(st.items, k); got.push(M.itemLabel(plan, k)); });
    (room.flags || []).forEach(function (f) { add(st.flags, f); });
    if (room.money) { st.money += Number(room.money); got.push(room.money + ' coins'); }
    if (room.clue) { add(st.clues, room.clue); got.push('clue: ' + ((M.clueOf(plan, room.clue) || {}).title || room.clue)); }
    add(st.cleared, room.id);
    chat.updated = Date.now();
    return got;
  };

  M.buy = function (chat, plan, itemId) {
    var st = chat.mansion;
    var it = (((plan.shop || {}).stock) || []).filter(function (s) { return s.id === itemId; })[0];
    if (!it) return 'no such item';
    if (st.money < it.price) return 'not enough coins (' + st.money + '/' + it.price + ')';
    st.money -= it.price;
    st.items.push('shop:' + it.id);
    return '';
  };
  M.shopItem = function (plan, key) {
    var id = String(key).replace(/^shop:/, '');
    return (((plan.shop || {}).stock) || []).filter(function (s) { return s.id === id; })[0] || null;
  };

  /** Beats waiting in this room, then the ones that can fire anywhere. */
  M.pendingBeats = function (chat, plan) {
    var st = chat.mansion;
    return (plan.beats || []).filter(function (b) {
      return !has(st.fired, b.id) && (!b.room || b.room === st.at);
    });
  };

  /* ---------------- marching order, the split, the captured ---------------- */

  M.moveInOrder = function (chat, id, step) {
    var o = chat.mansion.order;
    var i = o.indexOf(id), j = i + step;
    if (i < 0 || j < 0 || j >= o.length) return;
    o[i] = o[j]; o[j] = id;
  };

  /** Cut the marching order in half: the front goes on in this scene, the
   *  back is offstage until the GM switches or regroups. */
  M.split = function (chat) {
    var st = chat.mansion;
    if (st.split) return st.split;
    var line = st.order.filter(function (id) { return !st.captive.some(function (c) { return c.id === id; }); });
    var cut = Math.ceil(line.length / 2);
    st.split = { a: line.slice(0, cut), b: line.slice(cut), active: 'a' };
    st.split.b.forEach(function (id) { var c = pull(chat, id); if (c) st.offstage.push({ id: id, char: c }); });
    return st.split;
  };

  M.switchGroup = function (chat) {
    var st = chat.mansion;
    if (!st.split) return;
    var leaving = st.split.active === 'a' ? st.split.a : st.split.b;
    var coming = st.split.active === 'a' ? st.split.b : st.split.a;
    leaving.forEach(function (id) { var c = pull(chat, id); if (c) st.offstage.push({ id: id, char: c }); });
    st.offstage = st.offstage.filter(function (o) {
      if (!has(coming, o.id)) return true;
      put(chat, o.char); return false;
    });
    st.split.active = st.split.active === 'a' ? 'b' : 'a';
  };

  M.regroup = function (chat) {
    var st = chat.mansion;
    st.offstage.forEach(function (o) { put(chat, o.char); });
    st.offstage = [];
    st.split = null;
  };

  M.capture = function (chat, id) {
    var st = chat.mansion;
    var c = pull(chat, id);
    st.offstage = st.offstage.filter(function (o) { if (o.id === id) { c = c || o.char; return false; } return true; });
    if (!c || st.captive.some(function (x) { return x.id === id; })) return null;
    st.captive.push({ id: id, char: c, slot: st.order.indexOf(id) });
    st.order = st.order.filter(function (x) { return x !== id; });
    if (st.split) { st.split.a = st.split.a.filter(function (x) { return x !== id; }); st.split.b = st.split.b.filter(function (x) { return x !== id; }); }
    return c;
  };

  M.free = function (chat) {
    var st = chat.mansion;
    var back = st.captive.slice();
    back.forEach(function (o) {
      put(chat, o.char);
      if (!has(st.order, o.id)) st.order.splice(o.slot >= 0 ? Math.min(o.slot, st.order.length) : st.order.length, 0, o.id);
    });
    st.captive = [];
    return back.map(function (o) { return o.char; });
  };

  /* ---------------- what the model is told ---------------- */

  /** The CURRENT room, the party, the key ring and the rules — and nothing
   *  about any room the party has not reached. */
  RP.mansionBlock = function (chat) {
    var plan = M.planFor(chat);
    if (!plan) return '';
    var st = chat.mansion;
    var room = M.roomOf(plan, st.at) || {};
    var area = (plan.areas || []).filter(function (a) { return a.n === room.area; })[0];
    var name = function (id) { return nameOf(chat, null, id); };
    var out = ['THE HOUSE — ' + plan.name + ' (a planned adventure: these facts outrank anything invented)'];
    out.push('WHERE: ' + room.name + ' — ' + (room.floor || '') + (area ? ', ' + area.name : ''));
    if (room.about) out.push('WHAT IS HERE: ' + room.about);
    if (room.ghosts) out.push('GHOSTS HERE (played by the narration): ' + room.ghosts);
    var cleared = has(st.cleared, room.id);
    var finds = [];
    if (!cleared) {
      (room.rewards || []).forEach(function (k) { finds.push(M.itemLabel(plan, k)); });
      if (room.money) finds.push('about ' + room.money + ' coins');
      var clue = room.clue && M.clueOf(plan, room.clue);
      if (clue) finds.push(clue.found);
      if (finds.length) out.push('CAN BE FOUND HERE — only once someone searches or the ghosts are beaten; describe it plainly, never explain what it means: ' + finds.join(' · '));
    } else {
      out.push('THIS ROOM IS CLEARED — its ghosts are caught and what it held has been taken.');
    }
    if (st.orderSet) {
      var line = st.order.filter(function (id) { return !st.split || has(st.split[st.split.active], id); });
      out.push('MARCHING ORDER, front to back: ' + line.map(function (id, i) { return (i + 1) + '. ' + name(id); }).join('  '));
    } else {
      out.push('MARCHING ORDER: not chosen yet. Before the party goes deeper they must decide who walks first and who watches the back.');
    }
    if (st.split) {
      var away = st.split.active === 'a' ? st.split.b : st.split.a;
      if (away.length) out.push('THE PARTY IS SPLIT: ' + away.map(name).join(', ') + ' are somewhere else in the house — NOT in this room, they do not speak or act here.');
    }
    if (st.captive.length) out.push('TAKEN BY THE BOOS: ' + st.captive.map(function (o) { return o.char.name; }).join(', ') + ' — gone, not here, does not speak.');
    var carrying = st.items.map(function (k) {
      var shop = M.shopItem(plan, k);
      if (shop && /^shop:/.test(k)) return shop.label + ' (' + shop.effect + ')';
      var it = (plan.items || {})[k] || {};
      return (it.label || k) + (it.effect ? ' (' + it.effect + ')' : '');
    });
    out.push('CARRYING: ' + (carrying.length ? carrying.join('; ') : 'nothing yet') + ' · ' + st.money + ' coins');
    if (st.clues.length) {
      out.push('CLUES ALREADY FOUND (the party may talk about these):\n' + st.clues.map(function (id) {
        var c = M.clueOf(plan, id) || {}; return '- ' + c.title + ': ' + c.found;
      }).join('\n'));
    }
    if (plan.shop && plan.shop.room === room.id) {
      out.push(plan.shop.name + ' is here: ' + plan.shop.stock.map(function (s) { return s.label + ' ' + s.price + 'c'; }).join(', ') + '. ' + (plan.shop.note || ''));
    }
    out.push('HOUSE RULES\n' + (plan.rules || []).map(function (r) { return '- ' + r; }).join('\n'));
    return out.join('\n');
  };

  /* ---------------- the page ---------------- */

  var UI = RP.mansionUI = {};
  var esc = function (v) { return RP.esc(v); };
  var playing = null;   // the running cutscene: { chat, timer, left }

  UI.dash = function () {
    var plans = M.plans;
    return '<h2 class="sec">🏚 Adventures</h2>' +
      '<p class="mh-lead">Houses the GM planned room by room. The model plays the people and the ghosts; ' +
      'the doors, keys, clues and big moments come from the plan.</p>' +
      (plans.length ? plans.map(function (p) {
        return '<div class="mh-card"><b>' + esc(p.name) + '</b>' +
          '<span class="mh-sub">' + esc(p.date || '') + ' · ' + p.rooms.length + ' rooms · ' + (p.party || []).length + ' in the party</span>' +
          '<p>' + esc(p.premise || '') + '</p>' +
          '<button class="pill primary" data-mansion-start="' + esc(p.id) + '">Enter the house</button></div>';
      }).join('') : '<p class="mh-lead">No adventures are filed. They live in Reputation-Matrix2/data/mansions.json.</p>');
  };

  UI.wireDash = function (box, ctx) {
    box.querySelectorAll('[data-mansion-start]').forEach(function (b) {
      b.onclick = function () { UI.begin(M.plan(b.dataset.mansionStart), ctx); };
    });
  };

  UI.begin = function (plan, ctx) {
    if (!plan) return;
    var ids = (plan.party || []).concat(plan.guide ? [plan.guide] : []);
    var picked = ids.map(function (id) { return ctx.castById[id]; }).filter(Boolean);
    if (!picked.length) { ctx.toast('None of the party is in the cast list.'); return; }
    var first = M.roomOf(plan, plan.start) || plan.rooms[0];
    // The first room's own beats open the scene (Egadd at the door), so
    // walking straight out of the Foyer cannot skip them.
    var opening = (first.beats || []).map(function (id) { return M.beatOf(plan, id); })
      .filter(function (b) { return b && !b.action; });
    ctx.startGroup(picked, {
      scene: plan.scene, sceneName: plan.name, date: plan.date, sourceId: plan.sourceId || '', sourceKind: 'event',
      opener: '🏚 ' + plan.name + ' — ' + first.name + '. ' + (first.about || '') +
        opening.map(function (b) { return '\n\n★ ' + b.text; }).join(''),
    });
    var chat = ctx.room();
    chat.mansion = M.start(plan);
    opening.forEach(function (b) { add(chat.mansion.fired, b.id); });
    ctx.setDock('mansion');
    ctx.save(); ctx.render();
    ctx.toast('🏚 Set the marching order in the House tab, then play.');
  };

  UI.dock = function (chat) {
    var plan = M.planFor(chat);
    if (!plan) return '<p class="mh-lead">This chat is not an adventure.</p>';
    var st = chat.mansion;
    var here = M.roomOf(plan, st.at) || {};
    var area = (plan.areas || []).filter(function (a) { return a.n === here.area; })[0];
    var name = function (id) { return esc(nameOf(chat, null, id)); };
    var html = '<h4>Where</h4><div class="cp-desc"><b>' + esc(here.name) + '</b> · ' + esc(here.floor || '') +
      (area ? '<br><small>' + esc(area.name) + '</small>' : '') +
      '<br><small>Ghosts: ' + esc(here.ghosts || '—') + '</small></div>';
    html += '<div class="btnrow">' + (has(st.cleared, here.id)
      ? '<span class="mh-sub">✓ Cleared</span>'
      : '<button class="mini primary" id="mhClear" title="The ghosts are beaten or the room is searched: hand over its keys, coins and clue">🔍 Clear the room</button>') + '</div>';

    var beats = M.pendingBeats(chat, plan);
    if (beats.length) {
      html += '<h4>Beats</h4>' + beats.map(function (b) {
        return '<div class="mh-beat' + (b.room ? ' here' : '') + '"><span>' + (b.room ? '★ ' : '') + esc(b.title) + '</span>' +
          '<button class="mini' + (b.room ? ' primary' : '') + '" data-mh-beat="' + esc(b.id) + '">▶ Fire</button></div>';
      }).join('');
    }
    if (playing && playing.chat === chat.id) html += '<div class="btnrow"><button class="mini" id="mhSkip">⏭ Finish the song now</button></div>';

    html += '<h4>Marching order' + (st.orderSet ? '' : ' — not set') + '</h4>';
    var groupOf = function (id) { return !st.split ? '' : has(st.split.a, id) ? 'A' : has(st.split.b, id) ? 'B' : ''; };
    html += st.order.map(function (id, i) {
      var g = groupOf(id);
      return '<div class="mh-order' + (st.split && g !== st.split.active.toUpperCase() ? ' off' : '') + '">' +
        '<span>' + (i + 1) + '. ' + name(id) + (g ? ' <small>(' + g + ')</small>' : '') + '</span>' +
        (st.orderSet ? '' : '<span><button class="mini" data-mh-up="' + esc(id) + '">↑</button><button class="mini" data-mh-down="' + esc(id) + '">↓</button></span>') +
        '</div>';
    }).join('');
    html += '<div class="btnrow">' + (st.orderSet
      ? '<button class="mini" id="mhOrderEdit">Change the order</button>'
      : '<button class="mini primary" id="mhOrderLock">Lock in this order</button>') +
      (st.split ? '<button class="mini" id="mhSwitch">⇄ Play group ' + (st.split.active === 'a' ? 'B' : 'A') + '</button>' +
        '<button class="mini" id="mhRegroup">Regroup</button>' : '') + '</div>';
    if (st.captive.length) html += '<p class="mh-sub">Taken: ' + st.captive.map(function (o) { return esc(o.char.name); }).join(', ') + '</p>';

    html += '<h4>Doors</h4>';
    var known = M.knownRooms(plan, st);
    (plan.areas || []).forEach(function (a) {
      var rooms = known.filter(function (r) { return r.area === a.n; });
      if (!rooms.length) return;
      html += '<div class="mh-area">' + esc(a.name) + '</div>' + rooms.map(function (r) {
        var why = M.lockFor(plan, st, r);
        var mark = r.id === st.at ? '● ' : has(st.cleared, r.id) ? '✓ ' : has(st.visited, r.id) ? '· ' : '';
        return '<button class="mh-door' + (why ? ' locked' : '') + (r.id === st.at ? ' here' : '') + '" data-mh-go="' + esc(r.id) + '"' +
          (why ? ' title="' + esc(why) + '"' : '') + '>' + mark + esc(r.name) + (why ? ' 🔒' : '') + '</button>';
      }).join('');
    });

    html += '<h4>Key ring · ' + st.money + ' coins</h4><div class="mh-items">' +
      (st.items.length ? st.items.map(function (k) {
        var shop = /^shop:/.test(k) ? M.shopItem(plan, k) : null;
        return '<span>' + esc(shop ? shop.label : M.itemLabel(plan, k)) + '</span>';
      }).join('') : '<span class="mh-sub">empty</span>') + '</div>';
    if (plan.shop && plan.shop.room === st.at) {
      html += '<h4>' + esc(plan.shop.name) + '</h4>' + plan.shop.stock.map(function (s) {
        return '<div class="mh-beat"><span>' + esc(s.label) + ' — ' + s.price + 'c</span><button class="mini" data-mh-buy="' + esc(s.id) + '">Buy</button></div>';
      }).join('');
    }
    if (st.clues.length) {
      html += '<h4>Clues</h4>' + st.clues.map(function (id) {
        var c = M.clueOf(plan, id) || {};
        return '<div class="cp-desc"><b>' + esc(c.title) + '</b><br>' + esc(c.found) + '</div>';
      }).join('');
    }
    return html;
  };

  function note(chat, text) {
    chat.messages.push({ id: RP.uid(), role: 'scene', at: Date.now(), text: text });
  }

  UI.fire = function (chat, plan, beat, ctx) {
    var st = chat.mansion;
    add(st.fired, beat.id);
    (beat.add || []).forEach(function (id) { if (ctx.castById[id]) put(chat, ctx.castById[id]); });
    if (beat.action === 'split') M.split(chat);
    if (beat.action === 'regroup') M.regroup(chat);
    if (beat.action === 'capture') M.capture(chat, beat.target);
    if (beat.action === 'free') M.free(chat);
    if (beat.action === 'cutscene') {
      note(chat, '★ ' + beat.title + ' — ' + beat.text);
      ctx.save(); ctx.render();
      UI.cutscene(chat, plan, ctx);
      return;
    }
    note(chat, '★ ' + beat.title);
    ctx.directRoom(chat, beat.text, 'world', '');
  };

  /** The song, word for word, one card a line. The lines are real turns in
   *  the history, so the cast remembers the reunion afterwards. */
  UI.cutscene = function (chat, plan, ctx) {
    var lines = ((plan.cutscene || {}).lines || []).slice();
    if (!lines.length) return;
    ['mario', 'beta_luigi'].forEach(function (id) { if (ctx.castById[id]) put(chat, ctx.castById[id]); });
    var post = function (line) {
      var at = Date.now();
      if (line.who) chat.messages.push({ id: RP.uid(), role: 'char', charId: line.who, text: line.text, at: at, alts: [line.text], alt: 0, cutscene: true });
      else chat.messages.push({ id: RP.uid(), role: 'world', charId: '', text: line.text, at: at, alts: [line.text], alt: 0, cutscene: true });
    };
    if (playing) window.clearInterval(playing.timer);
    playing = { chat: chat.id, left: lines };
    var finish = function () {
      if (!playing) return;
      window.clearInterval(playing.timer);
      playing.left.splice(0).forEach(post);
      playing = null;
      chat.updated = Date.now();
      ctx.save(); ctx.render();
    };
    playing.finish = finish;
    playing.timer = window.setInterval(function () {
      if (!playing || !playing.left.length) { finish(); return; }
      post(playing.left.shift());
      ctx.render();
      if (!playing.left.length) finish();
    }, Number(ctx.lineMs || 1800));
  };

  UI.wireDock = function (box, chat, ctx) {
    var plan = M.planFor(chat);
    if (!plan) return;
    var st = chat.mansion;
    var on = function (id, fn) { var n = box.querySelector('#' + id); if (n) n.onclick = fn; };
    var done = function () { chat.updated = Date.now(); ctx.save(); ctx.render(); };
    on('mhClear', function () {
      var got = M.clear(chat, plan);
      if (got.length) note(chat, '🔍 ' + (M.roomOf(plan, st.at) || {}).name + ' cleared — ' + got.join(', ') + '.');
      ctx.toast(got.length ? '🔑 ' + got.join(', ') : 'Nothing to take here.');
      done();
    });
    on('mhOrderLock', function () {
      st.orderSet = true;
      note(chat, '🚶 Marching order: ' + st.order.map(function (id, i) { return (i + 1) + '. ' + nameOf(chat, ctx.castById, id); }).join(', ') + '.');
      done();
    });
    on('mhOrderEdit', function () { st.orderSet = false; done(); });
    on('mhSwitch', function () { M.switchGroup(chat); note(chat, '⇄ Meanwhile, group ' + st.split.active.toUpperCase() + '…'); done(); });
    on('mhRegroup', function () { M.regroup(chat); note(chat, '👥 The party is together again.'); done(); });
    on('mhSkip', function () { if (playing && playing.finish) playing.finish(); });
    box.querySelectorAll('[data-mh-up]').forEach(function (b) { b.onclick = function () { M.moveInOrder(chat, b.dataset.mhUp, -1); done(); }; });
    box.querySelectorAll('[data-mh-down]').forEach(function (b) { b.onclick = function () { M.moveInOrder(chat, b.dataset.mhDown, 1); done(); }; });
    box.querySelectorAll('[data-mh-beat]').forEach(function (b) {
      b.onclick = function () { var beat = M.beatOf(plan, b.dataset.mhBeat); if (beat) UI.fire(chat, plan, beat, ctx); };
    });
    box.querySelectorAll('[data-mh-buy]').forEach(function (b) {
      b.onclick = function () {
        var err = M.buy(chat, plan, b.dataset.mhBuy);
        ctx.toast(err || '🛒 Bought.');
        if (!err) done();
      };
    });
    box.querySelectorAll('[data-mh-go]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.mhGo === st.at) return;
        if (!st.orderSet) { ctx.toast('🚶 Lock in a marching order first.'); return; }
        var res = M.enter(chat, plan, b.dataset.mhGo, ctx.castById);
        if (!res.ok) { ctx.toast('🔒 ' + res.room.name + ' — ' + res.why); return; }
        var r = res.room;
        ctx.directRoom(chat, 'The party, in marching order, goes into the ' + r.name + '. ' + (r.about || '') +
          ' Show what they see as they step in, and what the room’s ghosts do.', 'world', '');
      };
    });
  };
})(window.RP);
