/* Margin gutter — event and battle pages as an active page.
 *
 * A wide record used to read as: prose, then a band of boxes, then "the file
 * behind this record" at the very bottom. Everything that explains the story
 * sat a long scroll away from the passage it explains. This module runs after
 * the article renders and, on a wide enough viewport, moves those boxes into a
 * right-hand gutter, each one parked beside the section where it matters:
 *
 *   rail boxes + apparatus panes  -> a gutter card, anchored by text affinity
 *   .annot comment marks          -> a sidenote joined to the passage by a line
 *   field plates                  -> inline, spread through the sections
 *
 * It only rearranges DOM that already exists — no data is read or written —
 * and it undoes itself on resize below the breakpoint (the page falls back to
 * the old band, which is also the portrait-tablet layout). Everything keeps
 * working without it.
 */
(function(){
  'use strict';
  var MIN_W = 1100, GAP = 12;
  var state = null;

  function qs(r, s){ return r.querySelector(s); }
  function qsa(r, s){ return Array.prototype.slice.call(r.querySelectorAll(s)); }
  function text(n){ return (n.textContent || '').replace(/\s+/g, ' ').toLowerCase(); }

  /* Sections of the card: every h2 that is a direct child, with the text of
     what follows it up to the next h2. */
  function sectionsOf(card){
    var out = [], cur = null;
    Array.prototype.forEach.call(card.children, function(ch){
      if(ch.tagName === 'H2' && ch.id){
        cur = { head: ch, nodes: [], text: '' };
        out.push(cur);
      } else if(cur){
        cur.nodes.push(ch);
        cur.text += ' ' + text(ch);
      }
    });
    return out;
  }

  /* Names an item talks about: link texts and bold labels inside it. */
  function namesIn(node){
    var seen = {}, out = [];
    qsa(node, 'a, b, strong, .xlink').forEach(function(a){
      var t = (a.textContent || '').trim().toLowerCase();
      if(t.length < 4 || t.length > 40 || seen[t]) return;
      seen[t] = 1; out.push(t);
    });
    return out;
  }

  /* Which section does this item belong beside? Highest count of its own
     names inside a section's prose; ties and zeros fall to a keyword rule,
     then to the order the items arrive in, spread over the sections. */
  function pickSection(node, label, sections, ordinal, total){
    if(!sections.length) return null;
    var names = namesIn(node), best = -1, bestScore = 0;
    sections.forEach(function(s, i){
      var score = 0;
      names.forEach(function(n){ if(s.text.indexOf(n) >= 0) score++; });
      if(score > bestScore){ bestScore = score; best = i; }
    });
    if(best >= 0) return sections[best];
    var l = (label || '').toLowerCase();
    if(/file|case|analysis|cut|aftermath|xp|ledger/.test(l)) return sections[sections.length - 1];
    if(/graph|connected|reader|control/.test(l)) return sections[0];
    var i = Math.min(sections.length - 1, Math.floor(ordinal * sections.length / Math.max(1, total)));
    return sections[i];
  }

  function cardFromPane(pane, label, icon){
    var d = document.createElement('details');
    d.className = 'railbox mg-card'; d.open = true;
    var s = document.createElement('summary');
    s.textContent = (icon ? icon + ' ' : '') + label;
    var b = document.createElement('div'); b.className = 'railbody';
    while(pane.firstChild) b.appendChild(pane.firstChild);
    d.appendChild(s); d.appendChild(b);
    return d;
  }

  function collectItems(A, rail){
    var items = [];
    if(rail){
      Array.prototype.slice.call(rail.children).forEach(function(ch){
        var sm = qs(ch, 'summary'), head = qs(ch, '.ww-rail-head');
        var label = sm ? sm.textContent : (head ? head.textContent : (ch.id || ''));
        items.push({ node: ch, label: label });
      });
    }
    var band = qs(A, '.apparatus-band');
    if(band){
      var panes = qsa(band, '.app-pane');
      if(panes.length){
        panes.forEach(function(p){
          var key = p.id.replace(/^app-pane-/, '');
          var tab = qs(band, '.app-tab[aria-controls="' + p.id + '"]');
          var label = tab ? tab.textContent.trim() : key;
          items.push({ node: cardFromPane(p, label, ''), label: label + ' ' + key, fromBand: true });
        });
        band.hidden = true; band.setAttribute('data-mg-moved', '1');
      } else if(band.classList.contains('apparatus-band--single')){
        var c = cardFromPane(band, 'The file behind this record', '🗄️');
        items.push({ node: c, label: 'file case', fromBand: true });
      }
    }
    return items;
  }

  function plates(card, sections){
    var grid = qs(card, '.field-gal-grid');
    if(!grid || !sections.length) return;
    var tiles = qsa(grid, '.field-gal-item');
    if(!tiles.length) return;
    var head = qs(card, '#h-fieldgallery');
    tiles.forEach(function(t, i){
      var s = sections[Math.min(sections.length - 1, Math.floor(i * sections.length / tiles.length))];
      var anchor = s.nodes.filter(function(n){ return n.classList && n.classList.contains('prose'); })[0] || s.head;
      var fig = document.createElement('figure');
      fig.className = 'mg-plate';
      t.classList.add('mg-plate-link');
      fig.appendChild(t);
      anchor.parentNode.insertBefore(fig, anchor.nextSibling);
    });
    if(head) head.parentNode.removeChild(head);
    if(!grid.children.length) grid.parentNode.removeChild(grid);
  }

  function sidenotes(card){
    var out = [];
    qsa(card, '.annot[data-ai]').forEach(function(mk){
      var ai = Number(mk.getAttribute('data-ai'));
      var ann = (window.ANNOT_ACTIVE || [])[ai];
      if(!ann) return;
      var cs = ann.comments || [], first = cs[0] || {};
      var n = document.createElement('div');
      n.className = 'mg-note';
      n.setAttribute('data-ai', ai);
      n.innerHTML = '<b></b><p></p><i></i>';
      n.firstChild.textContent = first.author || 'Margin note';
      n.children[1].textContent = String(first.text || '').slice(0, 220) + ((first.text || '').length > 220 ? '…' : '');
      n.children[2].textContent = cs.length > 1 ? '+' + (cs.length - 1) + ' more' : '';
      n.addEventListener('click', function(){ if(typeof window.openAnnotation === 'function') window.openAnnotation(ai); });
      n.addEventListener('mouseenter', function(){ mk.classList.add('mg-hot'); });
      n.addEventListener('mouseleave', function(){ mk.classList.remove('mg-hot'); });
      out.push({ node: n, mark: mk, note: true });
    });
    return out;
  }

  function place(){
    if(!state) return;
    var g = state.gutter, gTop = g.getBoundingClientRect().top + window.pageYOffset;
    var cursor = 0;
    state.entries.forEach(function(e){
      var ref = e.mark || e.anchor;
      var want = ref ? (ref.getBoundingClientRect().top + window.pageYOffset - gTop) : 0;
      var top = Math.max(want, cursor);
      e.node.style.top = top + 'px';
      cursor = top + e.node.offsetHeight + GAP;
      e.top = top;
    });
    g.style.minHeight = cursor + 'px';
    links();
  }

  /* One elbow line per sidenote, from the end of its passage to the card. */
  function links(){
    var svg = state.svg;
    var box = state.A.getBoundingClientRect();
    svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
    var d = '';
    state.entries.forEach(function(e){
      if(!e.mark) return;
      var m = e.mark.getBoundingClientRect(), n = e.node.getBoundingClientRect();
      var x1 = m.right - box.left, y1 = m.top + m.height / 2 - box.top;
      var x2 = n.left - box.left, y2 = n.top + 14 - box.top;
      var mid = x2 - 14;
      d += 'M' + x1 + ' ' + y1 + 'H' + mid + 'V' + y2 + 'H' + x2;
    });
    svg.firstChild.setAttribute('d', d);
  }

  var raf = 0;
  function relayout(){
    if(raf) return;
    raf = requestAnimationFrame(function(){ raf = 0; if(state) place(); });
  }

  function unmount(){
    if(!state) return;
    window.removeEventListener('resize', onResize);
    if(state.ro) state.ro.disconnect();
    state = null;
  }
  function onResize(){
    if(window.innerWidth < MIN_W){ var r = document.querySelector('.mg-on'); if(r) Router.render(); }
    else relayout();
  }

  function mount(){
    unmount();
    var lay = document.querySelector('.article-layout.record-wide-layout');
    if(!lay || window.innerWidth < MIN_W) return;
    var A = lay.firstElementChild;
    if(!A) return;
    var card = qs(A, ':scope > .card');
    if(!card) return;
    var rail = qs(A, ':scope > .rail-band');
    var sections = sectionsOf(card);
    plates(card, sections);

    var raw = collectItems(A, rail);
    var notes = sidenotes(card);
    if(!raw.length && !notes.length) return;

    var gutter = document.createElement('aside');
    gutter.className = 'mg-gutter';
    gutter.setAttribute('aria-label', 'Margin: notes and records for this passage');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'mg-links');
    svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));

    var entries = [];
    raw.forEach(function(it, i){
      var s = pickSection(it.node, it.label, sections, i, raw.length);
      entries.push({ node: it.node, anchor: s ? s.head : null });
    });
    notes.forEach(function(n){ entries.push({ node: n.node, mark: n.mark }); });
    /* Document order by where each one wants to sit; cards before notes on a tie. */
    entries.forEach(function(e){
      var ref = e.mark || e.anchor;
      e.y = ref ? ref.getBoundingClientRect().top + window.pageYOffset : 0;
    });
    entries.sort(function(a, b){ return a.y - b.y || (a.mark ? 1 : 0) - (b.mark ? 1 : 0); });
    entries.forEach(function(e){ e.node.classList.add('mg-item'); gutter.appendChild(e.node); });

    lay.classList.add('mg-on');
    A.classList.add('mg-grid');
    A.appendChild(gutter);
    A.appendChild(svg);
    if(rail && !rail.children.length) rail.parentNode.removeChild(rail);

    state = { A: A, gutter: gutter, svg: svg, entries: entries };
    window.addEventListener('resize', onResize);
    if(window.ResizeObserver){
      state.ro = new ResizeObserver(relayout);
      state.ro.observe(card);
      entries.forEach(function(e){ state.ro.observe(e.node); });
    }
    qsa(card, 'img').forEach(function(im){ if(!im.complete) im.addEventListener('load', relayout, { once: true }); });
    place();
  }

  window.MarginGutter = { mount: mount, unmount: unmount, relayout: relayout, MIN_W: MIN_W };
})();
