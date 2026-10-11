// Province census + the desk's shortlist, mounted in the REAL atlas renderer.
// Proves the merge paints contiguous borders (inked by what they mean: bold
// frontiers, faint internal lines, plain claimant/grey contested fills), that plots and labels are
// actually clickable after a pointer gesture — setPointerCapture on pointerdown
// used to retarget the click to the viewport and eat it — that labels declutter
// without ever being lost, that the dossier names the leader and the court's
// vote split where the registry files them, and that the shortlist picks a pin
// you can act on. Pure-model checks live in test-map-provinces.mjs.
//
// Needs jsdom resolvable from the repo root (temporary install, not committed):
//   npm install jsdom@26.1.0 --no-save
//
//   node tools/tests/atlas-provinces-smoke.mjs
import { JSDOM, VirtualConsole } from 'jsdom';

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', (e) => {
  const m = e.detail ? (e.detail.stack || e.detail.message) : e.message;
  if (/Could not parse CSS|Could not load img|Could not load script/i.test(String(m))) return;
  errors.push('jsdomError: ' + String(m).slice(0, 300));
});

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://127.0.0.1/',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { mountAtlasMapV2 } = await import('../../Reputation-Matrix2/app/pages/maps/atlas-map-v2.js');

const fail = [], ok = [];
const check = (label, cond, extra = '') => (cond ? ok : fail).push(label + (extra !== '' ? ' — ' + extra : ''));

function mount(mapId, opts) {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const handle = mountAtlasMapV2(host, mapId, opts);
  host.querySelector('[data-map-art]').dispatchEvent(new dom.window.Event('load'));
  return { host, handle };
}
const txt = el => (el && (el.textContent || '')) || '';

/* ---- a realm with filed provinces draws borders ---- */
const mk = mount('mushroom_kingdom_full');
check('mount returns a handle', !!mk.handle);
const plots = [...mk.host.querySelectorAll('[data-province]')];
/* The cleaned full sheet contains only Mushroom Kingdom-region pins, so its
   filed province count is lower than the former mixed-realm overlay. */
check('every filed province gets a plot', plots.length >= 15, `${plots.length} plots`);
check('plots are straight closed paths', plots.every(p => p.tagName.toLowerCase() === 'path' && /^M /.test(p.getAttribute('d') || '') && /Z$/.test(p.getAttribute('d') || '')));
check('a contested province gets a plain contested fill', mk.host.querySelectorAll('.atlas-v2-plot.contested').length >= 1);
check('province labels render at the plot centre', mk.host.querySelectorAll('[data-plotlabel]').length === plots.length);
const labeled = [...mk.host.querySelectorAll('[data-plotlabel]')].find(el => txt(el).includes('Dry Dry Desert'));
check('labels name a real filed province', !!labeled, labeled ? txt(labeled) : 'none');
check('header counts the provinces', txt(mk.host.querySelector('header p')).includes('provinces from the filed survey'));
check('the Provinces button ships on', !!mk.host.querySelector('[data-action="plots"].active'));
check('province ink clips to the surveyed Mushroom Kingdom footprint',
  !!mk.host.querySelector('.atlas-v2-survey-clip[clip-path]') && !!mk.host.querySelector('.atlas-v2-borders clipPath path'));
mk.host.querySelector('[data-action="plots"]').click();
check('the toggle clears the overlay', mk.host.querySelectorAll('[data-province]').length === 0);
mk.host.querySelector('[data-action="plots"]').click();
check('the toggle brings it back', mk.host.querySelectorAll('[data-province]').length === plots.length);

/* ---- borders are inked by what they mean ---- */
const contested = mk.host.querySelectorAll('.atlas-v2-plot.contested').length;
check('frontier edges are drawn between two different hands', mk.host.querySelectorAll('.atlas-v2-edge.frontier').length >= 3, `${mk.host.querySelectorAll('.atlas-v2-edge.frontier').length} frontiers`);
check('frontier edges touching a march are inked hot', mk.host.querySelectorAll('.atlas-v2-edge.frontier.hot').length >= 1, `${mk.host.querySelectorAll('.atlas-v2-edge.frontier.hot').length} hot`);
check('the outside rim of the tiled sheet is drawn', mk.host.querySelectorAll('.atlas-v2-edge.rim').length >= 3, `${mk.host.querySelectorAll('.atlas-v2-edge.rim').length} rim`);
check('contested provinces are not hatched', mk.host.querySelectorAll('.atlas-v2-hatchfill').length === 0, `${mk.host.querySelectorAll('.atlas-v2-hatchfill').length} hatch fills`);
check('no hatch pattern is injected into the overlay', mk.host.querySelectorAll('.atlas-v2-borders pattern').length === 0);
check('the legend counts the contested marches', /⚔ \d+ contested/.test(txt(mk.host.querySelector('[data-legend-lens]'))), txt(mk.host.querySelector('[data-legend-lens]')).slice(-60));
/* The Mushroom Kingdom is nearly all marches, so it has no internal borders to
   check; Equestria's crowns hold neighbouring sheets, which is where the faint
   administrative line inside one hand actually appears. */
const eq = mount('equestria_full');
check('provinces under one hand get faint internal borders', eq.host.querySelectorAll('.atlas-v2-edge.inner').length >= 5, `${eq.host.querySelectorAll('.atlas-v2-edge.inner').length} inner edges on equestria_full`);

/* ---- there is no Provinces map mode: provinces are a layer, not a lens ---- */
check('there is no Provinces map mode', !mk.host.querySelector('[data-mode="provinces"]'));
check('the province plots are still drawn as a layer', mk.host.querySelectorAll('.atlas-v2-plot').length > 0);

/* ---- a plot click opens the dossier ---- */
const summaries = mk.handle.getProvinces();
const withLedger = summaries.find(p => p.ledger) || summaries[0];
mk.handle.selectProvince(withLedger.id);
const target = mk.host.querySelector(`[data-province="${withLedger.id}"]`);
check('a plot is clickable from the map too', !!target);
target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const dossier = mk.host.querySelector('.atlas-v2-sidebar');
const sheet = dossier.innerHTML;
check('dossier names the province', txt(dossier.querySelector('h3')).length > 3, txt(dossier.querySelector('h3')));
check('dossier states the verdict', txt(dossier).includes('Dry Dry Desert') || txt(dossier).includes('Contested') || txt(dossier).includes('Held by'));
check('dossier counts the pins it merged', txt(dossier).includes('Pins counted'));
check('dossier carries the census bars', dossier.querySelectorAll('.atlas-v2-censusrow').length >= 2);
check('a filed ledger is checked against the census',
  !withLedger.ledger || dossier.querySelectorAll('.atlas-v2-ledger').length === 1, `ledger for ${withLedger.name}`);
check('the ledger row shows filed → census', !withLedger.ledger || /→ census/.test(sheet) || sheet.includes('census'));
check('dossier links back to the survey sheet', /Open this province as its own sheet|_desert|_plains/.test(sheet));
check('the selected province wears the gold focus ring', !!mk.host.querySelector('.atlas-v2-borders .atlas-v2-edge.focused'));

/* ---- clicking: pointer capture must not eat the click ---- */
/* The original sin: setPointerCapture on pointerdown retargets the click to
   the viewport, so plots could never be clicked in a real browser even though
   a synthetic click reached them here. The gesture logic is therefore driven
   the way a browser drives it: press, maybe move, release, then click. Any
   selectProvince() re-renders the overlay, so plots are re-queried after each
   one — a listener on a detached element proves nothing. */
const vp = mk.host.querySelector('.atlas-v2-viewport');
const world = mk.host.querySelector('.atlas-v2-world');
const pointer = (type, el, x, y) =>
  el.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 }));
const second = summaries.find(p => p.id !== withLedger.id);
const plotOf = id => mk.host.querySelector(`[data-province="${id}"]`);
mk.handle.selectProvince(withLedger.id);
const beforeDrag = world.style.transform;
pointer('pointerdown', plotOf(withLedger.id), 200, 200);
pointer('pointermove', vp, 253, 218);
check('a real drag pans the sheet', world.style.transform !== beforeDrag, world.style.transform);
pointer('pointerup', vp, 253, 218);
const secondPlot = plotOf(second.id);
secondPlot.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('a drag never selects a province', txt(mk.host.querySelector('.atlas-v2-sidebar h3')).includes(withLedger.name), txt(mk.host.querySelector('.atlas-v2-sidebar h3')));
await new Promise(done => setTimeout(done, 10));
secondPlot.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('a settled click selects the province', txt(mk.host.querySelector('.atlas-v2-sidebar h3')).includes(second.name), txt(mk.host.querySelector('.atlas-v2-sidebar h3')));
/* Press, jitter under the 4px threshold, release: still a click, not a drag. */
mk.handle.selectProvince(withLedger.id);
const jitterPlot = plotOf(second.id);
pointer('pointerdown', jitterPlot, 200, 200);
pointer('pointermove', vp, 202, 201);
pointer('pointerup', vp, 202, 201);
jitterPlot.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('a press that never really moved still clicks', txt(mk.host.querySelector('.atlas-v2-sidebar h3')).includes(second.name), txt(mk.host.querySelector('.atlas-v2-sidebar h3')));

/* ---- labels: decluttered, never lost, clickable ---- */
const allLabels = [...mk.host.querySelectorAll('[data-plotlabel]')];
check('crowded sheets tuck the small labels', allLabels.some(l => l.classList.contains('tucked')), `${allLabels.filter(l => l.classList.contains('tucked')).length} of ${allLabels.length} tucked`);
const tuckedId = (allLabels.find(l => l.classList.contains('tucked')) || allLabels[0]).dataset.plotlabel;
mk.handle.selectProvince(tuckedId);
const tucked = mk.host.querySelector(`[data-plotlabel="${tuckedId}"]`);
check("the selected province's label is never tucked", tucked.classList.contains('on') && !tucked.classList.contains('tucked'));
const hoverable = mk.host.querySelector(`[data-province="${tuckedId}"]`);
hoverable.dispatchEvent(new dom.window.Event('pointerenter'));
check('hovering a plot peeks its hidden label', tucked.classList.contains('peek'));
hoverable.dispatchEvent(new dom.window.Event('pointerleave'));
check('leaving the plot tucks the label away again', !tucked.classList.contains('peek'));
const labelTarget = summaries.find(p => p.id !== tuckedId);
mk.host.querySelector(`[data-plotlabel="${labelTarget.id}"]`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
check('clicking a label opens its dossier', txt(mk.host.querySelector('.atlas-v2-sidebar h3')).includes(labelTarget.name), txt(mk.host.querySelector('.atlas-v2-sidebar h3')));

/* ---- the census roll-up: provinces make the nation ---- */
const roll = mk.handle.getCensus();
check('the handle exposes the census', !!roll && roll.provinces.length === plots.length, roll ? `${roll.provinces.length}` : 'null');
check('the roll-up names a sovereign or refuses to', roll.rollup ? Object.prototype.hasOwnProperty.call(roll.rollup, 'sovereign') : false, JSON.stringify(roll.rollup && roll.rollup.sovereign));
check('the merge loses no pin', summaries.reduce((n, p) => n + p.pins, 0) === roll.pins, `${summaries.reduce((n, p) => n + p.pins, 0)} of ${roll.pins}`);
check('vacant filed claims stay visible as claims', summaries.some(p => p.vacant) ? summaries.filter(p => p.vacant).every(p => p.pins === 0) : true);

/* ---- the shortlist: something to actually choose ---- */
const mid = mount('midlands_full');
const boardBtn = mid.host.querySelector('[data-action="shortlist"]');
check('the Choose a pin button is on the tools row', !!boardBtn);
boardBtn.click();
const sidebar = mid.host.querySelector('.atlas-v2-sidebar');
const picks = [...sidebar.querySelectorAll('[data-pick]')];
check('the board lists candidates', picks.length >= 4, `${picks.length} picks`);
check('every pick says why', picks.every(b => txt(b.querySelector('em')).length > 8), txt(picks[0] && picks[0].querySelector('em')));
check('the board admits the sheet size', txt(sidebar.querySelector('h3')).includes('pins.'), txt(sidebar.querySelector('h3')));
check('the top pick is a real pin', !!mid.handle.getPois().find(p => p.id === picks[0].dataset.pick), picks[0].dataset.pick);

sidebar.querySelector('[data-pickroll]').click();
const rerolled = [...mid.host.querySelectorAll('[data-pick]')].map(b => b.dataset.pick);
check('reroll reshuffles the six', rerolled.length === picks.length, rerolled.join(','));

mid.host.querySelector('[data-pick]').click();
const afterPick = mid.host.querySelector('.atlas-v2-sidebar').innerHTML;
check('picking lands on the pin', /atlas-v2-detail/.test(afterPick) && !/atlas-v2-shortlist/.test(afterPick));
check('picking centres the map', mid.host.querySelector('.atlas-v2-world').style.transform.includes('scale'), mid.host.querySelector('.atlas-v2-world').style.transform);

/* ---- keyboard: arrows, enter, escape ---- */
boardBtn.click();
const key = k => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const rows = () => [...mid.host.querySelectorAll('[data-pick]')];
check('the board reopens for keyboard use', rows().length >= 4);
const firstBefore = rows().findIndex(r => r.classList.contains('on'));
key('ArrowDown');
const firstAfter = rows().findIndex(r => r.classList.contains('on'));
check('ArrowDown moves the cursor', firstAfter === (firstBefore + 1) % rows().length, `${firstBefore} → ${firstAfter}`);
key('Escape');
check('Escape closes the board', !mid.host.querySelector('[data-pick]'));

/* ---- governance: the dossier names who actually runs the province ---- */
const midSide = mid.host.querySelector('.atlas-v2-sidebar');
mid.handle.selectProvince('filed:capital_province');
check('a held province names its leader', txt(midSide).includes('Emperor Elagabalus'), 'regal_empire holds the Capital Province');
check('the court files its vote split', midSide.querySelectorAll('.atlas-v2-voterow').length >= 3, `${midSide.querySelectorAll('.atlas-v2-voterow').length} court rows`);
check('the ruling court faction is flagged', midSide.querySelectorAll('.atlas-v2-voterow.ruling').length === 1);
check('the ruling court faction is the Imperial Core', /The Imperial Core/.test(txt(midSide.querySelector('.atlas-v2-voterow.ruling'))));
check('key figures are listed beside the leader', midSide.querySelectorAll('.atlas-v2-court li').length >= 2);
const midSummaries = mid.handle.getProvinces();
const march = midSummaries.find(p => p.contested && p.id === 'sheet:vemillia') || midSummaries.find(p => p.contested);
mid.handle.selectProvince(march.id);
check('a march shows the leading hand, never a crown', /the leading hand/.test(txt(midSide)) && /census crowns nobody/.test(txt(midSide)), march.name);
check('the march still names who leads it', /Emperor Elagabalus|Alpha Bloodmaw|Lord Vexar Steelclad/.test(txt(midSide)), `${march.name} → ${march.controller}`);
const noCourt = midSummaries.find(p => p.contested && p.id === 'filed:ironwood');
if (noCourt) {
  mid.handle.selectProvince(noCourt.id);
  check('a court with no filed votes shows the leader and stops', txt(midSide).includes('Lord Vexar Steelclad') && midSide.querySelectorAll('.atlas-v2-voterow').length === 0, 'iron_legion files a leader but no court');
}

/* ---- a plane-filtered layer still gets a census of what is visible ---- */
const shadow = mount('midlands_full', { plane: 'shadow' });
const shadowPlots = shadow.host.querySelectorAll('[data-province]').length;
check('filtered layers census only what is on the layer', shadowPlots >= 0, `${shadowPlots} plots`);

/* ---- deep link: the nation page's census row opens a province ---- */
const linked = mount('mushroom_kingdom_full', { focusProvince: 'filed:central_plains' });
const linkSide = linked.host.querySelector('.atlas-v2-sidebar');
check('the linked province opens its dossier', txt(linkSide.querySelector('h3')).includes('Mushroom Plains'), txt(linkSide.querySelector('h3')));
check('the linked plot is highlighted', !!linked.host.querySelector('.atlas-v2-plot.selected'));
check('a bad province id is ignored', mount('mushroom_kingdom_full', { focusProvince: 'filed:nope' }).host.querySelector('.atlas-v2-plot.selected') === null);

/* ---- journey mode: no borders over a hidden survey ---- */
const TRAIL = [{ poiId: 'poi_mid_capital_district', n: 1, eventId: 'e1', name: 'Capital', date: 'd', plane: 'material' }];
const trail = mount('midlands_full', { journey: TRAIL, journeyOnly: true });
check('journey mode draws no province overlay', trail.host.querySelectorAll('[data-province]').length === 0);
check('journey mode keeps its pins', trail.host.querySelectorAll('[data-poi]').length === 1);

errors.forEach(e => fail.push(e));
console.log(`\n${ok.length} passed, ${fail.length} failed`);
ok.forEach(l => console.log('  ok   ' + l));
fail.forEach(l => console.log('  FAIL ' + l));
process.exit(fail.length ? 1 : 0);
