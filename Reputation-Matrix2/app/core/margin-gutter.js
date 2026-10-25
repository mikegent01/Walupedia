/* Active side — event and battle pages read with a live right-hand panel.
 *
 * A wide record used to end in a long tail: From the margins, Link Graph,
 * Connected Systems, Reader Controls and "the file behind this record", all
 * below the last line of prose. This module runs after the article renders
 * and, on a viewport of MIN_W or more, turns that tail into a sticky side
 * panel that follows the reader:
 *
 *   In this passage   a short live scene-beat excerpt, record cards (the same
 *                     ones the hover preview draws) for people and things the
 *                     paragraph names, plus its margin comments. It changes
 *                     as the page scrolls, under the section's title. When a
 *                     crowded cast fills the panel, a non-character record
 *                     gets a slot so the place, event or object stays visible.
 *   The stack         Link Graph, the wire, the apparatus panes, Connected
 *                     Systems and Reader Controls. A box opens by itself and
 *                     rises to the top when the passage on screen names
 *                     something inside it, and closes again when the reader
 *                     moves on. A box the reader opens or closes by hand is
 *                     left alone after that.
 *   Colour            every record on screen gets one colour, shared by its
 *                     inline link, its card, its thread, its Link Graph chip
 *                     and its mentions inside the open boxes.
 *   Field plates      set inline through the sections instead of in a
 *                     gallery at the foot.
 *
 * It rearranges the existing article UI and renders transient card metadata
 * exposed by the page; it never mutates source records. Below MIN_W it does
 * nothing and the old band layout stands.
 */
(function(){
  'use strict';
  var MIN_W = 900, MAX_CARDS = 5, MAX_LINES = 10, READ_LINE = 0.38, NEAR_BLOCKS = 3;
  var PALETTE = ['#ffb84d', '#5ad1ff', '#ff7ab8', '#7ee08a', '#c79bff', '#ff8a5c', '#4fe0c8', '#f5e663'];
  var SVG = 'http://www.w3.org/2000/svg';
  var state = null, raf = 0;

  function qs(r, s){ return r.querySelector(s); }
  function qsa(r, s){ return Array.prototype.slice.call(r.querySelectorAll(s)); }
  function el(tag, cls, txt){ var n = document.createElement(tag); if(cls) n.className = cls; if(txt != null) n.textContent = txt; return n; }
  function norm(s){ return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function excerpt(s, max){
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if(s.length <= max) return s;
    return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  }

  /* One colour per record, dealt in order of first appearance so records that
     share a passage differ, and kept for the life of the page. */
  var colours = {}, dealt = 0;
  function colourOf(id){
    if(!colours[id]) colours[id] = PALETTE[dealt++ % PALETTE.length];
    return colours[id];
  }

  function sectionsOf(card){
    var out = [], cur = null;
    Array.prototype.forEach.call(card.children, function(ch){
      if(ch.tagName === 'H2' && ch.id){ cur = { head: ch, nodes: [] }; out.push(cur); }
      else if(cur) cur.nodes.push(ch);
    });
    return out;
  }

  /* Field plates leave the gallery at the foot and sit inline, spread evenly
     over the sections in the order they were filed. */
  function plates(card){
    var grid = qs(card, '.field-gal-grid');
    if(!grid) return;
    var sections = sectionsOf(card).filter(function(s){ return s.head.id !== 'h-fieldgallery'; });
    var tiles = qsa(grid, '.field-gal-item');
    if(!tiles.length || !sections.length) return;
    tiles.forEach(function(t, i){
      var s = sections[Math.min(sections.length - 1, Math.floor(i * sections.length / tiles.length))];
      var anchor = s.nodes.filter(function(n){ return n.classList && n.classList.contains('prose'); })[0] || s.head;
      var fig = el('figure', 'mg-plate');
      fig.appendChild(t);
      anchor.parentNode.insertBefore(fig, anchor.nextSibling);
    });
    var head = qs(card, '#h-fieldgallery');
    if(head) head.parentNode.removeChild(head);
    if(!grid.children.length) grid.parentNode.removeChild(grid);
  }

  function boxFromPane(pane, label){
    var d = el('details', 'railbox mg-card');
    d.appendChild(el('summary', '', label));
    var b = el('div', 'railbody');
    while(pane.firstChild) b.appendChild(pane.firstChild);
    d.appendChild(b);
    return d;
  }

  /* The names a box talks about: its links, chips and bold labels. These are
     what the passage is matched against to decide whether the box is live. */
  function namesOf(box){
    var out = [], seen = {};
    qsa(box, 'a, b, strong, .lg-chip').forEach(function(n){
      if(n.closest('summary')) return;
      var t = norm(n.textContent).replace(/^[^a-z0-9]+/, '');
      if(t.length < 4 || t.length > 48 || seen[t]) return;
      seen[t] = 1;
      out.push({ text: t, node: n, id: n.getAttribute('data-id') || '' });
    });
    return out.slice(0, 80);
  }

  /* Everything that used to sit under the article. Boxes start closed; the
     passage opens them. */
  function buildStack(A, rail){
    var stack = el('div', 'mg-stack'), boxes = [];
    if(rail) Array.prototype.slice.call(rail.children).forEach(function(ch){ boxes.push(ch); });
    var band = qs(A, '.apparatus-band');
    if(band){
      var panes = qsa(band, '.app-pane');
      if(panes.length){
        panes.forEach(function(p){
          var tab = qs(band, '.app-tab[aria-controls="' + p.id + '"]');
          boxes.push(boxFromPane(p, tab ? tab.textContent.trim() : p.id.replace(/^app-pane-/, '')));
        });
      } else {
        boxes.push(boxFromPane(band, '🗄️ The file behind this record'));
      }
      band.hidden = true;
    }
    boxes.sort(function(a, b){ return (qs(b, '.lg-chip') ? 1 : 0) - (qs(a, '.lg-chip') ? 1 : 0); });
    boxes.forEach(function(b){
      if(b.tagName === 'DETAILS') b.open = false;
      stack.appendChild(b);
    });
    return { node: stack, boxes: boxes };
  }

  function inView(r){ return r.bottom > 70 && r.top < window.innerHeight - 30 && (r.width || r.height); }

  /* The blocks on screen, nearest the reading line first. */
  function visibleBlocks(){
    var line = window.innerHeight * READ_LINE, out = [];
    state.blocks.forEach(function(b){
      var r = b.node.getBoundingClientRect();
      if(!inView(r)) return;
      var dist = (line >= r.top && line <= r.bottom) ? 0 : Math.min(Math.abs(r.top - line), Math.abs(r.bottom - line));
      out.push({ b: b, dist: dist });
    });
    out.sort(function(a, b){ return a.dist - b.dist; });
    return out.map(function(x){ return x.b; });
  }

  function currentSection(){
    var line = window.innerHeight * READ_LINE, cur = null;
    state.heads.forEach(function(h){ if(h.getBoundingClientRect().top <= line) cur = h; });
    return cur;
  }

  function cardHtml(id){
    try{ return typeof window.linkCardHtml === 'function' ? (window.linkCardHtml(id, { side: true }) || '') : ''; }
    catch(e){ return ''; }
  }
  function cardMeta(id){
    try{ return typeof window.linkCardMeta === 'function' ? (window.linkCardMeta(id) || null) : null; }
    catch(e){ return null; }
  }
  function isPerson(item){
    var m = item.meta || {};
    return m.typeKey === 'characters' || m.kind === 'member' || m.kind === 'bearer';
  }
  /* Keep the first thing the reader meets, but reserve a slot for a place,
     event, faction, object, or other non-character record when one is present.
     A crowded cast can otherwise push every part of the scene off the panel. */
  function selectFocus(items){
    if(items.length <= MAX_CARDS) return items;
    var out = [], used = {};
    function take(item){
      if(item && !used[item.id] && out.length < MAX_CARDS){ used[item.id] = 1; out.push(item); }
    }
    take(items[0]);
    take(items.filter(function(item){ return !isPerson(item); })[0]);
    items.forEach(take);
    return out;
  }

  function noteNode(mark){
    var ai = Number(mark.getAttribute('data-ai'));
    var ann = (window.ANNOT_ACTIVE || [])[ai];
    if(!ann) return null;
    var cs = ann.comments || [], first = cs[0] || {};
    var n = el('div', 'mg-note');
    n.appendChild(el('b', '', '💬 ' + (first.author || 'Margin note')));
    n.appendChild(el('p', '', String(first.text || '').slice(0, 260) + ((first.text || '').length > 260 ? '…' : '')));
    if(cs.length > 1) n.appendChild(el('i', '', '+' + (cs.length - 1) + ' more — tap to open'));
    n.addEventListener('click', function(){ if(typeof window.openAnnotation === 'function') window.openAnnotation(ai); });
    return n;
  }

  /* Re-read the screen: which links, comment marks and names are in the
     passage, then bring the panel into line with it. */
  function update(){
    if(!state) return;
    if(!document.body.contains(state.A)){ unmount(); return; }
    var blocks = visibleBlocks();
    var focus = [], candidates = [], seen = {}, onScreen = [], marks = [], nearText = '';
    blocks.forEach(function(b, bi){
      if(bi < NEAR_BLOCKS) nearText += ' ' + b.text;
      qsa(b.node, 'a.xlink[data-id]').forEach(function(a){
        var id = a.getAttribute('data-id');
        if(!inView(a.getBoundingClientRect())) return;
        onScreen.push({ id: id, a: a });
        if(seen[id]) return;
        seen[id] = 1;
        candidates.push({ id: id, a: a, meta: cardMeta(id) });
      });
      if(bi < 2) qsa(b.node, '.annot[data-ai]').forEach(function(m){ if(marks.length < 3) marks.push(m); });
    });
    focus = selectFocus(candidates);
    if(state.pin && !seen[state.pin.id]) state.pin = null;
    if(state.pin){
      focus = [state.pin].concat(focus.filter(function(f){ return f.id !== state.pin.id; })).slice(0, MAX_CARDS);
    }
    var beat = blocks.length ? excerpt(blocks[0].displayText, 210) : '';
    if(beat !== state.beatText.textContent) state.beatText.textContent = beat;
    state.beat.hidden = !beat;
    var sec = currentSection();
    var key = focus.map(function(f){ return f.id; }).join('|') + '#' + marks.map(function(m){ return m.getAttribute('data-ai'); }).join('|');
    if(key !== state.key){ state.key = key; renderLive(focus, marks); }
    if(sec !== state.sec){
      state.sec = sec;
      state.where.textContent = sec ? sec.textContent.trim() : '';
      state.where.hidden = !sec;
    }
    state.focus = focus; state.onScreen = onScreen;
    paint(onScreen, seen);
    openBoxes(nearText, seen);
    drawLines();
  }

  function renderLive(focus, marks){
    var box = state.cards;
    box.textContent = '';
    state.cardById = {}; state.noteByMark = [];
    focus.forEach(function(f, i){
      var html = cardHtml(f.id);
      if(!html) return;
      var c = el('div', 'mg-pcard mg-in' + (i >= 2 ? ' mg-pcard--mini' : ''));
      c.setAttribute('data-id', f.id);
      if(f.meta){
        if(f.meta.kind) c.setAttribute('data-kind', f.meta.kind);
        if(f.meta.typeKey) c.setAttribute('data-type-key', f.meta.typeKey);
      }
      c.style.setProperty('--mg-c', colourOf(f.id));
      c.innerHTML = html;
      c.addEventListener('click', function(){ f.a.click(); });
      box.appendChild(c);
      state.cardById[f.id] = c;
    });
    marks.forEach(function(m){
      var n = noteNode(m);
      if(!n) return;
      n.classList.add('mg-in');
      box.appendChild(n);
      state.noteByMark.push({ mark: m, node: n });
    });
    state.empty.hidden = !!box.children.length;
  }

  /* Colour the inline links on screen and their chips. */
  function paint(onScreen, seen){
    qsa(state.A, 'a.xlink.mg-hot').forEach(function(a){ a.classList.remove('mg-hot'); a.style.removeProperty('--mg-c'); });
    onScreen.forEach(function(o){ o.a.classList.add('mg-hot'); o.a.style.setProperty('--mg-c', colourOf(o.id)); });
    state.chips.forEach(function(ch){
      var id = ch.getAttribute('data-id'), on = !!seen[id];
      ch.classList.toggle('mg-chip-on', on);
      if(on) ch.style.setProperty('--mg-c', colourOf(id)); else ch.style.removeProperty('--mg-c');
    });
  }

  function setOpen(box, open){
    if(box.node.tagName !== 'DETAILS' || box.node.open === open) return;
    box.node.open = open;
  }

  /* A box is live when the passage names something in it — by record id for
     links and chips, by the words themselves for everything else. Live boxes
     open and rise to the top; the rest close and drop back. */
  function openBoxes(nearText, seen){
    state.boxes.forEach(function(box){
      var hits = 0;
      box.names.forEach(function(n){
        var on = n.id ? !!seen[n.id] : nearText.indexOf(n.text) >= 0;
        n.node.classList.toggle('mg-match', on);
        if(on){
          hits++;
          n.node.style.setProperty('--mg-c', colourOf(n.id || n.text));
        } else n.node.style.removeProperty('--mg-c');
      });
      box.node.classList.toggle('mg-live-box', hits > 0);
      if(box.count) box.count.textContent = hits ? String(hits) : '';
      if(!box.user) setOpen(box, hits > 0);
    });
  }

  /* A thread from each inline link on screen to its card, or to its Link Graph
     chip when the chip is in view inside the panel — in the record's colour. */
  function drawLines(){
    var side = state.side.getBoundingClientRect(), svg = state.svg, n = 0, done = {};
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    function thread(fromRect, toRect, colour){
      if(n >= MAX_LINES) return;
      var ty = toRect.top + Math.min(18, toRect.height / 2);
      if(ty < side.top || ty > side.bottom || !toRect.width) return;
      var x1 = fromRect.right + 1, y1 = fromRect.bottom + 1;   /* leave from the underline, not across the words */
      var x2 = toRect.left - 3, mid = Math.max(x1 + 12, x2 - 30);
      var p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'C' + mid.toFixed(1) + ' ' + y1.toFixed(1) + ' ' +
        mid.toFixed(1) + ' ' + ty.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + ty.toFixed(1));
      p.setAttribute('stroke', colour);
      svg.appendChild(p);
      n++;
    }
    (state.focus || []).forEach(function(f){
      var c = state.cardById[f.id];
      if(c){ thread(f.a.getBoundingClientRect(), c.getBoundingClientRect(), colourOf(f.id)); done[f.id] = 1; }
    });
    state.noteByMark.forEach(function(x){ thread(x.mark.getBoundingClientRect(), x.node.getBoundingClientRect(), '#e0b400'); });
    (state.onScreen || []).forEach(function(o){
      if(done[o.id]) return;
      var chip = state.chipById[o.id];
      if(!chip) return;
      done[o.id] = 1;
      thread(o.a.getBoundingClientRect(), chip.getBoundingClientRect(), colourOf(o.id));
    });
  }

  function schedule(){
    if(raf || !state) return;
    raf = requestAnimationFrame(function(){ raf = 0; update(); });
  }
  function onResize(){
    if(window.innerWidth < MIN_W){
      if(state && window.Router && typeof window.Router.render === 'function'){ unmount(); window.Router.render(); }
    } else schedule();
  }
  function onHash(){ setTimeout(function(){ if(state && !document.body.contains(state.A)) unmount(); }, 80); }
  function onOver(e){
    if(!state) return;
    var a = e.target.closest && e.target.closest('a.xlink[data-id]');
    if(!a || !state.card.contains(a)) return;
    var id = a.getAttribute('data-id');
    state.pin = { id: id, a: a, meta: cardMeta(id) };
    schedule();
  }
  /* A box the reader opens or closes by hand is theirs: stop managing it. */
  function onSummary(e){
    if(!state) return;
    var sm = e.target.closest && e.target.closest('summary');
    if(!sm) return;
    state.boxes.forEach(function(b){ if(b.node === sm.parentNode){ b.user = true; b.node.classList.add('mg-user'); } });
  }

  function unmount(){
    if(!state) return;
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('hashchange', onHash);
    document.removeEventListener('mouseover', onOver);
    if(state.svg.parentNode) state.svg.parentNode.removeChild(state.svg);
    state = null;
  }

  function mount(){
    unmount();
    colours = {}; dealt = 0;
    var lay = document.querySelector('.article-layout.record-wide-layout');
    if(!lay || window.innerWidth < MIN_W) return;
    var A = lay.firstElementChild;
    var card = A && qs(A, ':scope > .card');
    if(!card) return;
    var rail = qs(A, ':scope > .rail-band');
    plates(card);

    var gutter = el('aside', 'mg-gutter');
    gutter.setAttribute('aria-label', 'Active side: the passage being read, and the file behind this record');
    var side = el('div', 'mg-side');
    var live = el('section', 'mg-live');
    live.appendChild(el('div', 'mg-live-h', '👁 In this passage'));
    var where = el('div', 'mg-live-where'); where.hidden = true;
    var beat = el('div', 'mg-live-beat'); beat.hidden = true;
    beat.appendChild(el('b', 'mg-live-beat-label', '⚡ Scene beat'));
    var beatText = el('span', 'mg-live-beat-text'); beat.appendChild(beatText);
    var empty = el('p', 'mg-live-empty', 'Linked people, places, events, factions and objects appear here as you read.');
    var cards = el('div', 'mg-live-cards');
    live.appendChild(where); live.appendChild(beat); live.appendChild(empty); live.appendChild(cards);
    side.appendChild(live);
    var built = buildStack(A, rail);
    side.appendChild(built.node);
    gutter.appendChild(side);
    if(rail && rail.parentNode) rail.parentNode.removeChild(rail);

    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'mg-links'); svg.setAttribute('aria-hidden', 'true');

    lay.classList.add('mg-on');
    A.classList.add('mg-grid');
    A.appendChild(gutter);
    document.body.appendChild(svg);

    var chips = qsa(side, '.lg-chip[data-id]'), chipById = {};
    chips.forEach(function(c){ var id = c.getAttribute('data-id'); if(!chipById[id]) chipById[id] = c; });
    var boxes = built.boxes.map(function(node){
      var sm = node.tagName === 'DETAILS' ? qs(node, ':scope > summary') : null, count = null;
      if(sm){ count = el('span', 'mg-hits'); sm.appendChild(count); }
      return { node: node, names: namesOf(node), user: false, count: count };
    });
    state = {
      A: A, card: card, side: side, cards: cards, empty: empty, where: where, beat: beat, beatText: beatText, svg: svg,
      chips: chips, chipById: chipById, cardById: {}, noteByMark: [], key: null, pin: null, sec: undefined,
      boxes: boxes,
      heads: qsa(card, ':scope > h2[id]'),
      blocks: qsa(card, '.prose p, .prose li, .prose blockquote, .wnote, .wiki-lead').map(function(n){
        return { node: n, text: norm(n.textContent), displayText: String(n.textContent || '').replace(/\s+/g, ' ').trim() };
      })
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('hashchange', onHash);
    document.addEventListener('mouseover', onOver);
    side.addEventListener('scroll', schedule, { passive: true });
    side.addEventListener('click', onSummary);
    side.addEventListener('toggle', schedule, true);
    update();
  }

  window.MarginGutter = { mount: mount, unmount: unmount, update: update, MIN_W: MIN_W };
})();
