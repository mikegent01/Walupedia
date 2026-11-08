// Headless test of the chatroom's 🏚 planned adventures: the key layout,
// the marching order, the split, the captured, the prompt block and the
// shipped plan itself. Same trick as test-chatroom-core.mjs: the sources
// run with a fake window, no DOM, no network.
//
//   node tools/tests/test-chatroom-mansion.mjs
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, repoRoot), 'utf8');
const window = {};
let n = 0;
const crypto = { randomUUID: () => 'id-' + (++n) };
const RP = new Function('window', 'crypto',
  read('assets/chatroom/chatroom-core.js') + '\n' + read('assets/chatroom/chatroom-mansion.js') + '\nreturn window.RP;')(window, crypto);

let ok = true;
const check = (name, cond) => { console.log((cond ? 'OK  ' : 'FAIL'), name); if (!cond) ok = false; };

const data = JSON.parse(read('Reputation-Matrix2/data/mansions.json'));
RP.mansion.setPlans(data);
const plan = RP.mansion.plan('feywild_house');
check('the Feywild House plan loads', Boolean(plan));

// ---------- the plan is internally consistent ----------
const roomIds = new Set(plan.rooms.map(r => r.id));
const clueIds = new Set(plan.clues.map(c => c.id));
const bad = [];
plan.rooms.forEach(r => {
  (r.needs || []).concat(r.rewards || []).forEach(k => { if (!plan.items[k]) bad.push(r.id + ' → item ' + k); });
  (r.via || []).forEach(v => { if (!roomIds.has(v)) bad.push(r.id + ' → via ' + v); });
  (r.clues || []).concat(r.clue ? [r.clue] : []).forEach(c => { if (!clueIds.has(c)) bad.push(r.id + ' → clue ' + c); });
  (r.beats || []).forEach(b => { if (!RP.mansion.beatOf(plan, b)) bad.push(r.id + ' → beat ' + b); });
});
plan.beats.forEach(b => { if (b.room && !roomIds.has(b.room)) bad.push('beat ' + b.id + ' → room ' + b.room); });
check('every key, clue, beat and room the plan names exists' + (bad.length ? ': ' + bad.join('; ') : ''), !bad.length);
const lines = plan.cutscene.lines;
check('the song is loaded, sung by Mario and Beta Luigi (' + lines.length + ' lines)',
  lines.length > 50 && lines.every(l => ['mario', 'beta_luigi', ''].includes(l.who)));

// ---------- the whole house can be finished ----------
const cast = {};
['wario', 'waluigi', 'mr_t', 'beta_luigi', 'jory_dobbs', 'professor_e_gadd', 'mario', 'king_boo']
  .forEach(id => { cast[id] = RP.normChar({ id, name: id.replace(/_/g, ' ') }); });
const chat = RP.newRoom(plan.party.map(id => cast[id]).concat([cast.professor_e_gadd]), {});
chat.mansion = RP.mansion.start(plan);
check('starts in the Foyer', chat.mansion.at === 'foyer');
check('a locked door stays locked', !RP.mansion.enter(chat, plan, 'study', cast).ok);
check('rooms of a locked area are not even listed',
  !RP.mansion.knownRooms(plan, chat.mansion).some(r => r.area > 1));

// Greedy walk: enter any room that opens, clear it, repeat.
let moved = true, steps = 0;
while (moved && steps < 500) {
  moved = false;
  for (const r of plan.rooms) {
    if (chat.mansion.cleared.includes(r.id)) continue;
    if (RP.mansion.enter(chat, plan, r.id, cast).ok) { RP.mansion.clear(chat, plan); moved = true; steps++; }
  }
}
const stuck = plan.rooms.filter(r => !chat.mansion.cleared.includes(r.id)).map(r => r.id + ' (' + RP.mansion.lockFor(plan, chat.mansion, r) + ')');
check('every room can be reached and cleared' + (stuck.length ? ' — stuck: ' + stuck.join(', ') : ''), !stuck.length);
check('all seven clues are found on the way', chat.mansion.clues.length === plan.clues.length);
check('coins were collected', chat.mansion.money > 0);

// ---------- marching order, split, capture, free ----------
const st = chat.mansion;
RP.mansion.moveInOrder(chat, 'jory_dobbs', -1);
check('the order can be rearranged', st.order.indexOf('jory_dobbs') === 3);
st.orderSet = true;
RP.mansion.split(chat);
const inCast = id => chat.cast.some(c => c.id === id);
check('the split sends the back half offstage', st.split.b.every(id => !inCast(id)) && st.split.a.every(inCast));
RP.mansion.switchGroup(chat);
check('switching plays the other half', st.split.b.every(inCast) && st.split.a.every(id => !inCast(id)));
RP.mansion.capture(chat, 'jory_dobbs');
check('Jory is taken out of the scene and the order', !inCast('jory_dobbs') && !st.order.includes('jory_dobbs') && st.captive.length === 1);
RP.mansion.regroup(chat);
check('regrouping brings everyone else back', plan.party.filter(id => id !== 'jory_dobbs').every(inCast));
RP.mansion.free(chat);
check('freeing returns Jory to his place', inCast('jory_dobbs') && st.order.indexOf('jory_dobbs') === 3);

// ---------- what the model is told ----------
const fresh = RP.newRoom(plan.party.map(id => cast[id]), {});
fresh.mansion = RP.mansion.start(plan);
let block = RP.mansionBlock(fresh);
check('the block names the current room', /WHERE: Foyer/.test(block));
check('the block asks for a marching order until one is set', /not chosen yet/.test(block));
check('the block never names a room not yet entered', !/Nursery|Graveyard|Secret Altar|Sealed Room/.test(block));
check('the block carries the house rules', /A locked door stays locked/.test(block));
fresh.mansion.orderSet = true;
RP.mansion.split(fresh);
RP.mansion.capture(fresh, 'jory_dobbs');
block = RP.mansionBlock(fresh);
check('the block says who is elsewhere and who was taken', /THE PARTY IS SPLIT/.test(block) && /TAKEN BY THE BOOS/.test(block));
const appState = RP.normalizeState ? RP.normalizeState({}) : { settings: {}, rooms: [], chars: [], lore: [] };
const say = (() => { try { return String(RP.systemFor(appState, fresh, fresh.cast[0], {})); } catch (e) { return 'ERR ' + e.message; } })();
const tell = (() => { try { return String(RP.worldSystem(appState, fresh, {})); } catch (e) { return 'ERR ' + e.message; } })();
check('a character turn carries the house block' + (/^ERR/.test(say) ? ' — ' + say : ''), /THE HOUSE — The Feywild House/.test(say));
check('the narrator turn carries the house block' + (/^ERR/.test(tell) ? ' — ' + tell : ''), /THE HOUSE — The Feywild House/.test(tell));

// ---------- the song plays word for word, as real turns ----------
const ticks = [];
window.setInterval = fn => { ticks.push(fn); return ticks.length; };
window.clearInterval = () => {};
const altar = RP.newRoom(['beta_luigi', 'professor_e_gadd'].map(id => cast[id]), {});
altar.mansion = RP.mansion.start(plan);
const ctx = { castById: cast, save() {}, render() {}, toast() {}, directRoom() {}, lineMs: 1 };
RP.mansionUI.fire(altar, plan, RP.mansion.beatOf(plan, 'reunion'), ctx);
for (let i = 0; i < 400 && ticks.length; i++) ticks[ticks.length - 1]();
const sung = altar.messages.filter(m => m.cutscene);
check('Mario walks in for the reunion', altar.cast.some(c => c.id === 'mario'));
check('every line of the song is posted in order', sung.length === lines.length && sung.every((m, i) => m.text === lines[i].text));
check('sung lines are turns the model will see', sung.every(m => RP.visible(m)));

console.log(ok ? '\nall mansion checks passed' : '\nSOME MANSION CHECKS FAILED');
process.exit(ok ? 0 : 1);
