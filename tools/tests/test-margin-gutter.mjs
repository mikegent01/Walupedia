// DOM contract of margin-gutter.js (the active side): on a wide viewport the
// rail boxes and the apparatus panes leave the foot of the page for a sticky
// side panel, the passage on screen puts its record cards and comments in the
// panel, Link Graph chips light up, field plates move inline; below the
// breakpoint nothing changes.
//   npm install jsdom@26.1.0 --no-save && node tools/tests/test-margin-gutter.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const src = readFileSync(new URL('../../Reputation-Matrix2/app/core/margin-gutter.js', import.meta.url), 'utf8');
const page = `<div class="article-layout record-wide-layout"><div>
  <div class="card">
    <h2 id="s0">The Door</h2><div class="prose"><p>Hjumpik met <span class="annot" data-ai="0">the waiter</span> <a class="xlink" data-id="brad">Brad</a> and <a class="xlink" data-id="corn">Cornburary</a>.</p></div>
    <h2 id="s1">The Card Room</h2><div class="prose"><p>Nobody is named here.</p></div>
    <h2 id="h-fieldgallery">Field Plates</h2>
    <div class="field-gal-grid"><a class="field-gal-item"><img alt=""><span>one</span></a><a class="field-gal-item"><img alt=""><span>two</span></a></div>
    <div class="apparatus-band">
      <div class="app-tabs"><button class="app-tab" aria-controls="app-pane-session">Session</button><button class="app-tab" aria-controls="app-pane-file">Case file</button></div>
      <div class="app-panes"><div class="app-pane is-on" id="app-pane-session">who was there</div><div class="app-pane" id="app-pane-file"><b id="xp-session">XP</b> ledger</div></div>
    </div>
  </div>
  <div class="rail rail-band">
    <details class="railbox"><summary>Connected Systems</summary><div class="railbody">x</div></details>
    <details class="railbox" open><summary>Link Graph</summary><div class="railbody"><a class="lg-chip" data-id="brad">Brad</a><a class="lg-chip" data-id="zed">Zed</a></div></details>
  </div>
</div></div>`;

function run(width){
  const dom = new JSDOM('<body>' + page + '</body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true });
  // jsdom has no layout: put everything on screen.
  w.Element.prototype.getBoundingClientRect = () => ({ top: 200, bottom: 240, left: 100, right: 300, width: 200, height: 40 });
  w.ANNOT_ACTIVE = [{ quote: 'the waiter', comments: [{ author: 'Archie', text: 'He tips badly.' }, { author: 'Eager', text: 'Agreed.' }] }];
  w.linkCardHtml = (id, o) => (id === 'brad' || id === 'corn') ? `<div class="lp-head">card:${id}:${o && o.side}</div>` : '';
  w.eval(src);
  w.MarginGutter.mount();
  return w.document;
}

let d = run(1280);
assert(d.querySelector('.article-layout').classList.contains('mg-on'), 'layout flagged');
const side = d.querySelector('.mg-gutter .mg-side');
assert(side, 'sticky side exists');
const boxes = [...side.querySelectorAll('.mg-stack > details > summary')].map(s => s.firstChild.textContent.trim());
assert.deepStrictEqual(boxes, ['Link Graph', 'Connected Systems', 'Session', 'Case file'], 'stack: Link Graph first, then rail, then apparatus panes');
assert(!d.querySelector('.rail-band'), 'nothing left in the bottom band');
assert(d.querySelector('.apparatus-band').hidden, 'old apparatus band hidden');
assert(side.querySelector('#xp-session'), 'anchored ids survive the move (XP lede deep link)');
const cards = [...side.querySelectorAll('.mg-pcard')];
assert.deepStrictEqual(cards.map(c => c.getAttribute('data-id')), ['brad', 'corn'], 'cards for the links in the passage');
assert(/card:brad:true/.test(cards[0].textContent), 'card drawn by the shared hover-card builder');
assert(cards[1].classList.contains('mg-pcard--mini'), 'second card is compact');
const note = side.querySelector('.mg-note');
assert(note && /Archie/.test(note.textContent) && /\+1 more/.test(note.textContent), 'comment on the passage shown beside it');
assert(side.querySelector('.lg-chip[data-id="brad"]').classList.contains('mg-chip-on'), 'chip for an on-screen link lights up');
assert(!side.querySelector('.lg-chip[data-id="zed"]').classList.contains('mg-chip-on'), 'other chips stay dim');
assert(d.querySelector('a.xlink[data-id="brad"]').classList.contains('mg-hot'), 'inline link marked');
// the stack is live: a box opens when the passage names something in it
const det = name => [...side.querySelectorAll('.mg-stack > details')].find(x => x.querySelector('summary').firstChild.textContent.trim() === name);
assert(det('Link Graph').open && det('Link Graph').classList.contains('mg-live-box'), 'Link Graph opened by an on-screen link');
assert.strictEqual(det('Link Graph').querySelector('.mg-hits').textContent, '1', 'hit count shown');
assert(!det('Connected Systems').open && !det('Session').open, 'boxes the passage does not touch stay closed');
// one colour per record, shared by link, card and chip
const col = n => n.style.getPropertyValue('--mg-c');
assert(col(cards[0]) && col(cards[0]) === col(d.querySelector('a.xlink[data-id="brad"]')) && col(cards[0]) === col(side.querySelector('.lg-chip[data-id="brad"]')), 'link, card and chip share a colour');
assert.strictEqual(side.querySelector('.mg-live-where').textContent, 'The Card Room', 'current section named');
assert(d.querySelector('svg.mg-links path').getAttribute('stroke'), 'thread carries the record colour');
assert(d.querySelector('svg.mg-links path').getAttribute('d').startsWith('M'), 'threads drawn');
assert.strictEqual(d.querySelectorAll('.mg-plate').length, 2, 'plates placed inline');
assert(!d.querySelector('#h-fieldgallery'), 'plate heading removed');
console.log('OK   wide: side panel, live cards, comment, chips, threads, plates');

d = run(800);
assert(!d.querySelector('.mg-gutter'), 'narrow viewport untouched');
assert(d.querySelector('.rail-band') && !d.querySelector('.apparatus-band').hidden, 'band kept below breakpoint');
console.log('OK   narrow: layout unchanged');
console.log('ALL MARGIN GUTTER TESTS PASS');
