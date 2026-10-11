// DOM contract of margin-gutter.js: on a wide viewport the rail boxes and the
// apparatus panes leave the bottom band for a gutter, comment marks gain a
// sidenote, field plates move inline; below the breakpoint nothing changes.
//   npm install jsdom@26.1.0 --no-save && node tools/tests/test-margin-gutter.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const src = readFileSync(new URL('../../Reputation-Matrix2/app/core/margin-gutter.js', import.meta.url), 'utf8');
const page = `<div class="article-layout record-wide-layout"><div>
  <div class="card">
    <h2 id="s0">The Door</h2><div class="prose"><p>Hjumpik met <span class="annot" data-ai="0">the waiter Brad</span> at the door.</p></div>
    <h2 id="s1">The Card Room</h2><div class="prose"><p>Brad dealt cards. Cornburary watched.</p></div>
    <h2 id="h-aftermath">Aftermath</h2><div class="prose"><p>It ended.</p></div>
    <h2 id="h-fieldgallery">Field Plates</h2>
    <div class="field-gal-grid"><a class="field-gal-item"><img alt=""><span>one</span></a><a class="field-gal-item"><img alt=""><span>two</span></a></div>
    <div class="apparatus-band">
      <div class="app-tabs"><button class="app-tab" aria-controls="app-pane-session">Session</button><button class="app-tab" aria-controls="app-pane-file">Case file</button></div>
      <div class="app-panes"><div class="app-pane is-on" id="app-pane-session"><a>Brad</a> was there</div><div class="app-pane" id="app-pane-file"><b id="xp-session">XP</b> ledger</div></div>
    </div>
  </div>
  <div class="rail rail-band"><details class="railbox"><summary>Link Graph</summary><div class="railbody"><a>Cornburary</a></div></details></div>
</div></div>`;

function run(width){
  const dom = new JSDOM('<body>' + page + '</body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
  w.ANNOT_ACTIVE = [{ quote: 'the waiter Brad', comments: [{ author: 'Archie', text: 'He tips badly.' }, { author: 'Eager', text: 'Agreed.' }] }];
  w.eval(src);
  w.MarginGutter.mount();
  return w.document;
}

let d = run(1280);
const lay = d.querySelector('.article-layout');
assert(lay.classList.contains('mg-on'), 'layout flagged');
const g = d.querySelector('.mg-gutter');
assert(g, 'gutter exists');
const cards = [...g.querySelectorAll('.mg-card')].map(c => c.querySelector('summary').textContent.trim());
assert.deepStrictEqual(cards, ['Session', 'Case file'], 'apparatus panes became gutter cards');
assert(g.querySelector('.railbox summary').textContent.includes('Link Graph') || cards.length, 'rail box moved');
assert(g.querySelector('#xp-session'), 'anchored ids survive the move (XP lede deep link)');
assert(d.querySelector('.apparatus-band').hidden, 'old band hidden');
const note = g.querySelector('.mg-note');
assert(note && /Archie/.test(note.textContent) && /\+1 more/.test(note.textContent), 'sidenote carries first comment');
assert.strictEqual(d.querySelectorAll('.mg-plate').length, 2, 'plates placed inline');
assert(!d.querySelector('#h-fieldgallery'), 'plate heading removed');
assert(d.querySelector('.mg-links path'), 'connector layer present');
console.log('OK   wide: gutter, cards, sidenote, plates, links');

d = run(800);
assert(!d.querySelector('.mg-gutter'), 'narrow viewport untouched');
assert(!d.querySelector('.apparatus-band').hidden, 'band kept below breakpoint');
console.log('OK   narrow: layout unchanged');
console.log('ALL MARGIN GUTTER TESTS PASS');
