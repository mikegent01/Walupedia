// Headless test of the chatroom's new systems — the ones the roleplay page
// did not have: cross-chat memory, character memory, world lore, perspective
// dynamic replay, and import/export bundles. Same trick as
// test-roleplay-page.mjs: the pure-logic source is run with a fake window,
// a fake crypto and a fake localStorage. No DOM, no network.
//
// The source of truth is assets/chatroom/chatroom-core.js; both generated
// pages inline or link that exact file, and this test also checks that the
// generated pages are not stale.
//
//   node tools/tests/test-chatroom-core.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const repoRoot = new URL('../../', import.meta.url);
const source = readFileSync(new URL('assets/chatroom/chatroom-core.js', repoRoot), 'utf8');

const window = {};
let n = 0;
const crypto = { randomUUID: () => 'id-' + (++n) };
const RP = new Function('window', 'crypto', source + '\nreturn window.RP;')(window, crypto);

let ok = true;
const check = (name, cond) => { console.log((cond ? 'OK  ' : 'FAIL'), name); if (!cond) ok = false; };

const cutters = RP.normChar({ id: 'timber_gang', name: 'The Timber Gang', title: 'Cutters on the ridge' });
const rebel = RP.normChar({ id: 'rebel_scout', name: 'Rebel Scout', title: 'First through the treeline' });
const sans = RP.normChar({ id: 'sans', name: 'Sans', summary: 'A skeleton.' });

// ---------- state shape ----------
const store = { map: {}, getItem(k) { return this.map[k] ?? null; }, setItem(k, v) { this.map[k] = String(v); }, removeItem(k) { delete this.map[k]; } };
const state = RP.loadState(store);
check('state: a clean state carries user, lore, log and settings', !!state.user && Array.isArray(state.lore) && Array.isArray(state.log) && !!state.settings);

// ---------- character memory ----------
const room = RP.newRoom([sans, cutters], { scene: 'The ridge, before dawn.' });
state.rooms.push(room);
const userMsg = { id: 'u1', role: 'user', text: 'The rebels are coming up the logging road.', at: 1 };
const charMsg = { id: 'c1', role: 'char', charId: 'sans', text: '*shrugs* "we could move the saws."', at: 2 };
room.messages.push(userMsg, charMsg);
RP.rememberTurn(state, room, userMsg);
RP.rememberTurn(state, room, charMsg);
const sansMem = RP.charMemory(state, sans);
check('memory: what the player says is remembered by everyone present', state.chars.length === 2 && sansMem.notes.some(nn => nn.text.includes('logging road')));
check('memory: a character remembers their own line, actions stripped', sansMem.notes.some(nn => nn.text.includes('we could move the saws') && !nn.text.includes('shrugs')));
check('memory: being in the room builds a relationship', (sansMem.relations.timber_gang || {}).score === 1);
RP.setMood(state, sans, 'tired of the noise');
RP.teach(state, sans, 'The ridge road floods after rain.');
check('memory: mood and taught facts stick', RP.charMemory(state, sans).mood === 'tired of the noise' && RP.charMemory(state, sans).knowledge.length === 1);

// ---------- the cross-chat log ----------
RP.logEvent(state, { kind: 'note', roomId: 'other-room', roomTitle: 'The first cut', chars: ['sans'], text: 'A saw was left running all night.' });
RP.logEvent(state, { kind: 'note', roomId: 'other-room', roomTitle: 'Elsewhere', chars: ['nobody_here'], text: 'Unrelated business in another province.' });
const mem = RP.memoryBlock(state, room.cast, room);
check('cross-chat: another chat’s events reach this one', mem.includes('A saw was left running all night'));
check('cross-chat: events about nobody in this cast are left out', !mem.includes('Unrelated business'));
check('cross-chat: this chat’s own log lines are not repeated back', (() => {
  RP.logEvent(state, { kind: 'note', roomId: room.id, roomTitle: room.title, chars: ['sans'], text: 'Said inside this very room.' });
  return !RP.memoryBlock(state, room.cast, room).includes('Said inside this very room');
})());
check('cross-chat: the block carries mood, knowledge and relationships', mem.includes('tired of the noise') && mem.includes('floods after rain') && mem.includes('The Timber Gang'));

// ---------- world lore ----------
RP.addLore(state, { title: 'The Ridge Concession', text: 'Every tree on the ridge belongs to the Concession, on paper.', tags: ['ridge'] });
RP.addLore(state, { title: 'Sans-only node', text: 'Only relevant with the skeleton.', chars: ['sans'] });
RP.addLore(state, { title: 'Far away', text: 'Nothing to do with any of this.', tags: ['seafloor'] });
const lore = RP.loreBlock(state, room.cast, room);
check('lore: character-matched nodes are handed over', lore.includes('Sans-only node'));
check('lore: unmatched tagged nodes stay out', !lore.includes('Far away'));
RP.addLore(state, { id: 'the_ridge_concession', title: 'The Ridge Concession', text: 'Rewritten.', tags: ['ridge'] });
check('lore: re-filing the same id updates in place', state.lore.filter(x => x.id === 'the_ridge_concession').length === 1 && state.lore.find(x => x.id === 'the_ridge_concession').text === 'Rewritten.');
RP.removeLore(state, 'far_away');
check('lore: nodes can be removed', !state.lore.some(x => x.id === 'far_away'));

// ---------- the assembled prompt ----------
const system = RP.systemFor(state, room, sans);
check('prompt: one turn carries character, lore and memory together', system.includes('You are Sans') === false ? system.includes('YOU ARE Sans') : true);
check('prompt: group turn speaks only as the picked character', system.includes('ONLY as Sans'));
check('prompt: lore and memory blocks are both in the system prompt', system.includes('WORLD LORE') && system.includes('WHAT HAS ALREADY HAPPENED'));

// ---------- perspective dynamic replay ----------
const battle = RP.newRoom([rebel], { scene: 'The rebels break the treeline.', sceneName: 'The Logging Road Ambush' });
battle.messages.push({ id: 'b1', role: 'user', text: 'We rush the road.', at: 1 });
battle.messages.push({ id: 'b2', role: 'char', charId: 'rebel_scout', text: 'The saws stop. Someone shouts.', at: 2 });
battle.messages.push({ id: 'b3', role: 'char', charId: 'rebel_scout', text: 'A tree comes down across the track.', at: 3 });
battle.messages.forEach(m => RP.rememberTurn(state, battle, m));
const beats = RP.beatsFromRoom(battle);
check('replay: a played chat becomes a beat script', beats.length >= 2 && beats.some(b => b.beat.includes('saws stop')));
const replay = RP.replayRoom(state, battle, [cutters], { perspective: 'the timber-cutters on the ridge' });
check('replay: a new room, same beats, new cast', replay.cast[0].id === 'timber_gang' && replay.beats.length === beats.length && replay.replayOf === battle.id);
check('replay: the perspective is stated in the prompt', RP.perspectiveBlock(replay).includes('timber-cutters on the ridge'));
check('replay: the script block keeps the main event on its rails', RP.scriptBlock(replay).includes('The Logging Road Ambush') && RP.scriptBlock(replay).includes('Scheduled to happen next'));
check('replay: opening one is itself filed in the world log', state.log.some(e => e.kind === 'replay' && e.text.includes('timber-cutters')));
check('replay: the opener is a scene card, not a played turn', replay.messages[0].role === 'scene' && RP.counter(replay) === 0);

// ---------- export / import ----------
state.rooms.push(battle, replay);
const everything = RP.exportBundle(state, {});
check('export: a full bundle carries chats, lore, memory and the log', everything.kind === 'waluipedia-chatroom-bundle' && everything.rooms.length === 3 && everything.lore.length >= 2 && everything.chars.length === 3 && everything.log.length > 0);
const loreOnly = RP.exportBundle(state, { chats: false, memory: false, user: false });
check('export: lore can travel on its own', !loreOnly.rooms && !loreOnly.chars && loreOnly.lore.length >= 2);
const memoryOnly = RP.exportBundle(state, { chats: false, lore: false, user: false });
check('export: memory can travel on its own', !memoryOnly.rooms && !memoryOnly.lore && memoryOnly.chars.length === 3 && Array.isArray(memoryOnly.log));

const fresh = RP.loadState({ getItem: () => null, setItem() {} });
const stats = RP.importBundle(fresh, everything, 'merge');
check('import: a bundle restores chats, lore, memory and the log', fresh.rooms.length === 3 && fresh.lore.length >= 2 && fresh.chars.length === 3 && stats.rooms === 3);
const again = RP.importBundle(fresh, everything, 'merge');
check('import: importing twice does not duplicate anything', fresh.rooms.length === 3 && again.rooms === 0);
check('import: a re-import says the chats are already on file, not that nothing imported',
  again.roomsSame === 3 && again.roomsUpdated === 0);

const older = JSON.parse(JSON.stringify(everything));
older.rooms[0].title = 'Stale copy';
older.rooms[0].updated = 1;
const staleStats = RP.importBundle(fresh, older, 'merge');
check('import: the newer copy of a chat wins a merge', fresh.rooms.find(r => r.id === everything.rooms[0].id).title !== 'Stale copy');
check('import: a stale copy counts as already-on-file, a fresher one as updated', (() => {
  if (staleStats.roomsSame !== 3 || staleStats.roomsUpdated !== 0) return false;
  const fresher = JSON.parse(JSON.stringify(everything));
  fresher.rooms[0].title = 'Fresher copy';
  fresher.rooms[0].updated = Date.now() + 86400000;
  const st2 = RP.importBundle(fresh, fresher, 'merge');
  return st2.roomsUpdated === 1 && st2.rooms === 0 &&
    fresh.rooms.find(r => r.id === everything.rooms[0].id).title === 'Fresher copy';
})());

const otherHalf = { kind: 'waluipedia-chatroom-bundle', chars: [{ id: 'sans', name: 'Sans', notes: [{ at: 9, text: 'Remembered on another machine.' }], knowledge: ['A second fact.'], relations: {} }] };
RP.importBundle(fresh, otherHalf, 'merge');
const merged = fresh.chars.find(c => c.id === 'sans');
check('import: two memories of one character merge instead of overwriting', merged.notes.some(x => x.text.includes('another machine')) && merged.notes.some(x => x.text.includes('saws')) && merged.knowledge.length === 2);

const replaced = RP.loadState({ getItem: () => null, setItem() {} });
replaced.lore = [{ id: 'keep_me', title: 'Keep me', text: '', tags: [], chars: [] }];
RP.importBundle(replaced, loreOnly, 'replace');
check('import: replace swaps the named section outright', !replaced.lore.some(x => x.id === 'keep_me') && replaced.lore.length >= 2);

let refused = false;
try { RP.importBundle(fresh, { kind: 'something-else' }, 'merge'); } catch (e) { refused = true; }
check('import: a foreign bundle is refused', refused);

// ---------- storage survives the new sections ----------
RP.saveState(store, state);
const back = RP.loadState(store);
check('storage: lore, memory, the log and the account round-trip', back.lore.length === state.lore.length && back.chars.length === 3 && back.log.length === state.log.length && back.user.handle === 'waluipedia');

// ---------- the WAHwire becomes scenarios ----------
const profiles = { waluigi: { avatar: 'portraits/waluigi.jpg' } };
const wire = [
  { id: 'ww_a', author: 'waluigi', order: 3, likes: 500, status: 'posted', timestamp: '5 Aethel', content: 'The ridge road floods every autumn, the concession knows it floods, and the filing that would say so out loud has been sitting unwritten for two seasons while the crews keep being sent up it in the dark.', tags: ['ridge'], links: [{ id: 'sans', type: 'character' }, { id: 'timber_gang', type: 'character' }, { id: 'the_ambush', type: 'event' }], comments: [{ author: 'sans', content: 'so move the road, or move the season, or admit the concession would rather replace a crew than a culvert' }, { author: 'timber_gang', content: 'move the rain while you are at it. we have asked four times and been told it is a drainage question for next year, every year' }, { author: 'rebel_scout', content: 'the road floods because of what was cut above it, which is a sentence nobody in that office will write down' }] },
  { id: 'ww_b', author: 'timber_gang', order: 9, likes: 12, status: 'posted', timestamp: '9 Aethel', content: 'Second saw lost this month.', tags: ['timber'], links: [] },
  { id: 'ww_c', author: 'rebel_scout', order: 1, likes: 40, status: 'generated', timestamp: '1 Aethel', content: 'A draft the archive never posted.', tags: [], links: [] },
].map(p => RP.normPost(p, profiles));
check('wire: posts normalise with author, avatar, tags and linked characters',
  wire[0].authorName.toLowerCase().includes('waluigi') && wire[0].avatar.includes('portraits/') && wire[0].chars.includes('sans'));
check('wire: newest first is the default sort, and it is by filing order',
  RP.sortPosts(wire, 'newest')[0].id === 'ww_b' && RP.sortPosts(wire, 'oldest')[0].id === 'ww_c' && RP.sortPosts(wire, 'liked')[0].id === 'ww_a');

const castIndex = { sans, timber_gang: cutters, rebel_scout: rebel };
check('wire: every post starts unused', RP.filterPosts(wire, { view: 'unused' }, state).length === 3);
const scenario = RP.scenarioFromPost(wire[0], castIndex);
check('scenario: the post is the scene and the people it names are the cast',
  scenario.scene.includes('ridge road floods') && scenario.suggestedCast.some(c => c.id === 'sans'));
check('scenario: the replies underneath become beats',
  scenario.beats.length === 3 && scenario.beats[0].detail.includes('move the road'));
const wireRoom = RP.newRoom(scenario.suggestedCast, { scene: scenario.scene, sceneName: scenario.name, beats: scenario.beats });
RP.markPostUsed(state, wire[0].id, wireRoom);
check('wire: playing a post marks it used, and the unused view shrinks',
  RP.postUsed(state, 'ww_a') && RP.filterPosts(wire, { view: 'unused' }, state).length === 2 && RP.filterPosts(wire, { view: 'used' }, state).length === 1);
check('wire: the "never posted" view finds the archive\u2019s own drafts',
  RP.filterPosts(wire, { view: 'unfiled' }, state).map(p => p.id).join() === 'ww_c');
check('wire: search matches content, author and tags',
  RP.filterPosts(wire, { query: 'saw' }, state).length === 1 && RP.filterPosts(wire, { query: 'ridge' }, state).length === 1);
check('wire: used posts survive a save/load and an export', (() => {
  RP.saveState(store, state);
  const round = RP.loadState(store);
  const bundle = RP.exportBundle(state, { chats: false, lore: false, user: false });
  return RP.postUsed(round, 'ww_a') && Boolean(bundle.usedPosts.ww_a);
})());

// ---------- collections ----------
const collection = RP.normCollection({
  id: 'ridge_crew', name: 'The Ridge Crew', title: 'Everyone on that hill',
  summary: 'The people the ridge belongs to, on paper and otherwise.',
  members: [{ id: 'sans', name: 'Sans', role: 'watchman' }, { id: 'timber_gang', name: 'The Timber Gang', role: 'cutters' }, { id: 'ghost_id', name: 'Not in the cast' }],
}, castIndex);
check('collections: members resolve to playable characters, strangers drop out',
  collection.members.length === 2 && collection.total === 3 && collection.members[0].role === 'watchman');

// ---------- the director ----------
const group = RP.newRoom([sans, cutters, rebel], {});
group.messages.push({ id: 'd1', role: 'user', text: 'Who is cutting tonight?', at: 1 });
group.messages.push({ id: 'd2', role: 'char', charId: 'sans', text: 'nobody. the saws are off.', at: 2 });
check('director: the prompt lists everyone except the character who just spoke',
  (() => { const p = RP.directorPrompt(group, sans); return !p.includes('- Sans') && p.includes('- The Timber Gang') && p.includes('NEXT:'); })());
check('director: NEXT picks the named character', RP.parseDirector('NEXT: The Timber Gang', group, sans).next === 'timber_gang');
check('director: USER hands the scene back', RP.parseDirector('USER', group, sans).next === 'user');
check('director: an unreadable answer hands back rather than guessing', RP.parseDirector('uhh maybe someone?', group, sans).next === 'user');
check('director: it may never re-pick the character who just spoke', RP.parseDirector('NEXT: Sans', group, sans).next === 'user');
check('director: chain length counts character turns since the player', RP.chainLength(group) === 1);
group.messages.push({ id: 'd3', role: 'char', charId: 'timber_gang', text: '*spits*', at: 3 });
group.messages.push({ id: 'd4', role: 'char', charId: 'rebel_scout', text: 'we heard them stop.', at: 4 });
group.messages.push({ id: 'd5', role: 'char', charId: 'sans', text: 'everyone hears everything here.', at: 5 });
check('director: the ceiling always returns the scene to the player',
  RP.chainLength(group) === 4 && RP.parseDirector('NEXT: The Timber Gang', group, sans).next === 'user');
group.maxChain = 6;
check('director: the ceiling is configurable per room', RP.parseDirector('NEXT: The Timber Gang', group, sans).next === 'timber_gang');
group.messages.push({ id: 'd6', role: 'user', text: 'I step out of the trees.', at: 6 });
check('director: a player turn resets the chain', RP.chainLength(group) === 0);

// ---------- What Ifs: long scenarios composed from filed records ----------
const archive = {
  whatifs: [{
    id: 'wf_bank', title: 'What If Wario Owned the Abstract Bank?',
    premise: 'A metaphysical bank lets you withdraw abstract concepts and sell them for gold. Once sold, the concept stops existing — everywhere, for everyone, permanently. The account belongs to one man, he is given three resets, and the filing exists because he needed four.',
    summary: 'An eyewitness audit of the afternoon the account was opened: gravity goes first, then the law of equivalent exchange, then time, then the idea of a limit. Each withdrawal is cleverer than the one before it and each one fails worse, which is the whole argument of the filing rather than an accident of the telling.',
    divergence: 'The banker assigns full, unsupervised ownership of a metaphysical concept account to a sole proprietor with no oversight, no ceiling and no reading habit.',
    epigraph: 'It is not a scam. A scam has a ceiling.',
    outcome: 'Four withdrawals, three resets, one afternoon, and a reserve that left through the roof it had been standing under.',
    subject: 'Sans', tags: ['Sans', 'Promo Mario', 'Economics'], wordCount: 9000, resetsTotal: 3,
    verdict: { body: 'He was never buying money; he already had money, obscenely, before the courier arrived. What he bought, four times, was the removal of a limit — and limits are the only thing holding the ceiling up. The finding is not that he was greedy. The finding is that he was consistent.' },
    findings: [{ t: 'The concept he resents is never the concept he is selling.' }],
    chapters: Array.from({ length: 6 }, (_, i) => ({
      heading: 'Chapter ' + (i + 1), phase: 'phase ' + (i + 1),
      body: 'A long paragraph of filed prose for chapter ' + (i + 1) + '. It runs for several sentences so the beat carries real detail rather than a label. Somebody signs a document they have not read, out loud, in front of a witness who says nothing. The floor of the room disagrees with the signature about four seconds later, and the disagreement is filed as an accident.',
    })),
  }],
  events: [{
    id: 'the_ridge_ambush', name: 'The Logging Road Ambush',
    summary: 'Rebels came out of the treeline at the logging road and the saws stopped. Nobody filed what the cutters did next, which is the part that mattered.',
    outcome: 'The road held, the concession lost a season, and two names went into the record without dossiers.',
    date: '9 Aethel, 1040 BF', location: 'The ridge road above the concession', era: '1040 BF', type: 'Skirmish',
    image: 'assets/images/events/ridge.jpg',
    participants: [
      { id: 'sans', name: 'Sans', role: 'watched the road' },
      { id: 'timber_gang', name: 'The Timber Gang', role: 'cutting when it started' },
      { id: 'gregir_fendelsohn', name: 'Gregir Fendelsohn', role: 'called the retreat and was never written up' },
    ],
    timeline: { entries: [
      { time: 'before dawn', beat: 'The saws start', detail: 'Two crews on the ridge, working the top of the road in the dark because the concession pays by the trunk.' },
      { time: 'first light', beat: 'The treeline moves', detail: 'Something crosses the gap between the stumps, twice, and nobody agrees afterwards how many there were.' },
      { time: 'mid-morning', beat: 'The saws stop', detail: 'One crew downs tools and the silence carries further than the noise ever did.' },
      { time: 'noon', beat: 'The road holds', detail: 'A tree comes down across the track and the rebels take the long way round, which costs them the day.' },
      { time: 'dusk', beat: 'The count', detail: 'Two names are written into the filing and neither of them is ever given a page.' },
    ] },
  }],
  factions: [{
    id: 'midlands_diet', name: 'The Midlands Diet', type: 'Legislature', region: 'The Midlands',
    summary: 'A 39-seat chamber that passed two emergency measures inside three days.',
    description: 'Waluigi files the Midlands Diet under institutions that did their job exactly as designed, which is the worst thing that can be said about a parliament.\n\nThirty-nine seats, twenty-eight of them aligned before the session opened, and a public gallery that was cleared at nine in the morning for reasons the minutes do not record.\n\nThe vote itself took four minutes. The argument about whether it had been a vote at all has taken considerably longer and is still going.',
    leadership: [{ id: 'sans', name: 'Sans', role: 'Sitting member, resigned in protest' }],
  }],
  congress: { sessions: [{ name: 'The First Glazed Congress', date: '14th Bloomtide, 1026', year: 1026, summary: 'The founding session, convened in the shadow of a crisis nobody wanted named.' }] },
  posts: wire,
};
const seatCast = { sans: sans, timber_gang: cutters, rebel_scout: rebel };

const filed = RP.whatIfFromFiled(archive.whatifs[0], seatCast);
check('what-if (filed): the archive’s own branch becomes a playable scenario',
  filed.kind === 'filed' && filed.beats.length === 6 && filed.brief.includes('The divergence') && filed.brief.includes('The verdict on record'));
check('what-if (filed): the brief is long enough to run a session from', filed.brief.length > RP.WHATIF_MIN_BRIEF);

const turned = RP.whatIfFromEvent(archive.events[0], seatCast);
check('what-if (divergence): a filed session is turned at its own hinge',
  turned.kind === 'divergence' && /had gone the other way/.test(turned.name) && turned.brief.includes('What actually happened'));
check('what-if (divergence): the beats after the hinge are the script',
  turned.beats.length >= 3 && turned.beats[0].detail.includes('does not go the way the record says'));

const gaps = RP.wantedFrom(archive.events, archive.factions, seatCast, 5);
check('wanted pages: people named in filings with no record of their own',
  gaps.length === 1 && gaps[0].id === 'gregir_fendelsohn');
check('wanted pages: bodies and filed records are not counted as missing people',
  !gaps.some(g => /timber|diet|ambush/i.test(g.id)));
const gap = RP.whatIfFromGap(gaps[0], seatCast);
check('what-if (gap): the unwritten person is playable, with witnesses beside them',
  gap.suggestedCast[0].id === 'gregir_fendelsohn' && gap.suggestedCast.length >= 3 &&
  gap.suggestedCast[0].title.includes('Unwritten'));
check('what-if (gap): the filing they walked through becomes the script',
  gap.beats.length >= 4 && gap.beats.some(b => b.beat.includes('The saws stop')));
check('what-if (gap): singular grammar when a name is referenced once', gap.brief.includes('referenced once'));

const chamber = RP.whatIfFromBody(archive.factions[0], [sans, cutters, RP.normChar({ id: 'x', name: 'X', affiliation: 'The Midlands Diet' })], archive.congress);
check('what-if (chamber): a body seats itself from the cast’s affiliations',
  chamber && chamber.kind === 'chamber' && chamber.suggestedCast.length >= 2 && chamber.brief.includes('On the record'));

const flash = RP.whatIfFromPost(wire[0], seatCast);
check('what-if (flashpoint): a loud wire post becomes a branch where it was right',
  flash && flash.kind === 'flashpoint' && flash.brief.includes('The post') && flash.beats.length === 3);

const board = RP.buildWhatIfs(archive, seatCast, { limit: 8 });
check('board: every scenario on it clears the quality floor',
  board.length > 0 && board.every(s => RP.scenarioQuality(s) > 0 && s.brief.length >= RP.WHATIF_MIN_BRIEF && s.beats.length >= RP.WHATIF_MIN_BEATS && s.suggestedCast.length >= 2));
check('board: the engines are mixed rather than one owning the page',
  new Set(board.map(s => s.kind)).size >= 3);
check('board: a thin scenario is dropped, not padded',
  RP.scenarioQuality(RP.whatIfFromPost({ id: 'x', authorName: 'A', content: 'short', comments: [{ author: 'sans', content: 'ok' }], chars: ['sans'], tags: [], likes: 1, timestamp: 'now' }, seatCast) || null) === 0);

// ---- written by the reader, composed by the page ----
const mine = RP.composeScenario({
  text: 'What if The Logging Road Ambush had been reported honestly and The Midlands Diet had to read it out loud? Who resigns?',
}, archive, seatCast);
check('create: the page matches the records you named',
  mine.brief.includes('The Logging Road Ambush') && mine.brief.includes('Midlands Diet'));
check('create: the matched filing’s own timeline becomes the script',
  mine.beats.length >= 3 && mine.beats.some(b => b.beat.includes('saws')));
check('create: the cast comes from the records, not from thin air',
  mine.suggestedCast.length >= 2 && mine.suggestedCast.some(c => c.id === 'sans'));
check('create: your question is kept as the question the table answers',
  mine.questions.some(q => /resigns/.test(q)));
check('create: "What if" is not doubled up in the title', !/what if what if/i.test(mine.name));
check('create: a bare one-liner still gets a three-beat spine',
  RP.composeScenario({ text: 'The concession burns.' }, archive, seatCast).beats.length >= 3);
check('create: written scenarios round-trip through storage and bundles', (() => {
  state.scenarios = [mine];
  RP.saveState(store, state);
  const round = RP.loadState(store);
  const bundle = RP.exportBundle(state, { chats: false, memory: false, user: false });
  const target = RP.loadState({ getItem: () => null, setItem() {} });
  const st = RP.importBundle(target, bundle, 'merge');
  return round.scenarios.length === 1 && bundle.scenarios.length === 1 && st.scenarios === 1;
})());
check('play: a scenario hands the room a scene, a name and its beats', (() => {
  const opts = RP.scenarioRoomOpts(turned);
  const built = RP.newRoom(turned.suggestedCast, opts);
  return built.beats.length === turned.beats.length && built.sceneName === turned.name &&
    built.messages[0].role === 'scene' && built.scene.includes('What actually happened');
})());

// ---------- character state: sheets, directives, roster ----------
const fight = RP.newRoom([sans, cutters], {
  kit: 'off',              // these checks assert slot positions — no auto-outfitting
  statePreset: 'rpg',
  setup: { sans: { hpPct: 50, flags: 'wounded, hunted', items: 'brass key', status: 'one arm useless' } },
});
check('state: a scenario can start someone at half health, wounded and carrying',
  fight.states.sans.hp.value === 50 && fight.states.sans.hp.max === 100 &&
  fight.states.sans.flags.wounded && fight.states.sans.flags.hunted &&
  fight.states.sans.items[0].name === 'brass key' && fight.states.sans.status === 'one arm useless');
check('state: everyone else starts whole', fight.states.timber_gang.hp.value === 100 && fight.states.timber_gang.mp.value === 50);
check('state: the story preset carries no numbers at all', (() => {
  const quiet = RP.newRoom([sans, cutters], { statePreset: 'story' });
  return !quiet.states.sans.hp && !quiet.states.sans.mp;
})());

const names = fight.cast.map(c => c.name);
const staged = RP.parseDirectives(
  'The saw comes down and he does not get his arm clear in time.\n' +
  '[[HP: Sans -35]]\n[[MP: Sans -10]]\n[[FLAG: Sans bleeding]]\n[[FLAG: Sans hunted = false]]\n' +
  '[[COUNT: The Timber Gang saws -1]]\n[[ITEM: The Timber Gang + the broken blade]]\n' +
  '[[STATUS: The Timber Gang blood to the elbow]]\n[[ENTER: The Rebel Scout — comes out of the treeline]]', names);
check('directives: the stage directions are stripped from what the reader sees',
  staged.clean === 'The saw comes down and he does not get his arm clear in time.' && staged.directives.length === 8);
check('directives: a multi-word name is one character, not two words',
  staged.directives.some(d => d.kind === 'counter' && d.who === 'The Timber Gang' && d.name === 'saws'));
const applied = RP.applyDirectives(state, fight, staged.directives, () => rebel);
check('state: damage subtracts rather than sets', fight.states.sans.hp.value === 15);
check('state: spending power is tracked too', fight.states.sans.mp.value === 40);
check('state: a flag can be set and another cleared in the same turn',
  Boolean(fight.states.sans.flags.bleeding) && fight.states.sans.flags.hunted === undefined);
check('state: counters, inventory and physical notes all land',
  fight.states.timber_gang.counters.saws === -1 &&
  fight.states.timber_gang.items[0].name === 'the broken blade' &&
  fight.states.timber_gang.status === 'blood to the elbow');
check('roster: the model can walk a character into the scene',
  fight.cast.some(c => c.id === 'rebel_scout') && fight.states.rebel_scout &&
  applied.entered.length === 1 && state.log.some(e => e.kind === 'roster'));
check('state: every change is reported to the reader as a line',
  applied.lines.length >= 6 && applied.lines[0].includes('Sans') && applied.lines[0].includes('15/100'));
const out = RP.applyDirectives(state, fight, RP.parseDirectives('[[EXIT: The Timber Gang — carried off the ridge]]', fight.cast.map(c => c.name)).directives, () => null);
check('roster: the model can write a character out again',
  out.exited.length === 1 && !fight.cast.some(c => c.id === 'timber_gang') && fight.states.timber_gang.present === false);
check('state: the prompt tells the model exactly what is true right now', (() => {
  const block = RP.stateBlock(fight);
  return block.includes('HP 15/100 (badly hurt)') && block.includes('bleeding') && !block.includes('The Timber Gang');
})());
check('state: the rules for changing it are in the system prompt', (() => {
  const system = RP.systemFor(state, fight, sans);
  return system.includes('CHARACTER STATE') && system.includes('[[HP: Name -12]]') && system.includes('[[ENTER:');
})());
check('state: mechanics can be switched off entirely', (() => {
  const quiet = RP.newRoom([sans, cutters], { mechanics: 'off' });
  return !RP.systemFor(state, quiet, sans).includes('STAGE DIRECTIONS');
})());
check('state: a hit that would kill floors at zero, not below',
  RP.applyChange(fight.states.sans, { kind: 'hp', op: '-', value: 500 }).includes('down') && fight.states.sans.hp.value === 0);
check('state: sheets survive a save and load', (() => {
  state.rooms = [fight];
  RP.saveState(store, state);
  const round = RP.loadState(store);
  return round.rooms[0].states.sans.hp.value === 0 && Boolean(round.rooms[0].states.sans.flags.bleeding);
})());

// ---- the sheets have more to say now ----
const kitRoom = RP.newRoom([sans], { setup: { sans: { items: 'a brass key | bent, from the ledger room' } } });
check('kit: an item carries a note about itself', (() => {
  const item = kitRoom.states.sans.items[0];
  return item.name === 'a brass key' && item.note.includes('ledger room') && item.qty === 1 && !item.equipped;
})());
check('kit: picking the same thing up twice counts it', (() => {
  const names = kitRoom.cast.map(c => c.name);
  RP.applyDirectives(RP.blankState(), kitRoom,
    RP.parseDirectives('[[ITEM: Sans + a brass key]]', names).directives, () => null);
  return kitRoom.states.sans.items[0].qty === 2;
})());
check('kit: something can be in hand or put away', (() => {
  const names = kitRoom.cast.map(c => c.name);
  RP.applyDirectives(RP.blankState(), kitRoom, RP.parseDirectives('[[EQUIP: Sans brass key]]', names).directives, () => null);
  const held = kitRoom.states.sans.items[0].equipped;
  RP.applyDirectives(RP.blankState(), kitRoom, RP.parseDirectives('[[STOW: Sans brass key]]', names).directives, () => null);
  return held && !kitRoom.states.sans.items[0].equipped;
})());
check('conditions: one can be given a note and a count of turns', (() => {
  const names = kitRoom.cast.map(c => c.name);
  const lines = RP.applyDirectives(RP.blankState(), kitRoom,
    RP.parseDirectives('[[COND: Sans bleeding 2 | a deep cut across the palm]]', names).directives, () => null).lines;
  const cond = kitRoom.states.sans.flags.bleeding;
  return cond.turns === 2 && cond.note.includes('deep cut') && /2 turns/.test(lines[0]);
})());
check('conditions: they count down and then pass', (() => {
  const first = RP.tickConditions(kitRoom);
  const stillThere = Boolean(kitRoom.states.sans.flags.bleeding);
  const second = RP.tickConditions(kitRoom);
  return first.length === 0 && stillThere && second.length === 1 &&
    /no longer bleeding/.test(second[0]) && !kitRoom.states.sans.flags.bleeding;
})());
check('conditions: a lasting one is never ticked away', (() => {
  const names = kitRoom.cast.map(c => c.name);
  RP.applyDirectives(RP.blankState(), kitRoom, RP.parseDirectives('[[COND: Sans hunted | the Legion has his name]]', names).directives, () => null);
  RP.tickConditions(kitRoom); RP.tickConditions(kitRoom); RP.tickConditions(kitRoom);
  return Boolean(kitRoom.states.sans.flags.hunted);
})());
check('conditions: CURE ends one on the spot', (() => {
  const names = kitRoom.cast.map(c => c.name);
  RP.applyDirectives(RP.blankState(), kitRoom, RP.parseDirectives('[[CURE: Sans hunted]]', names).directives, () => null);
  return !kitRoom.states.sans.flags.hunted;
})());
check('kit: the model is shown what is in hand, what is stowed, and for how long', (() => {
  const names = kitRoom.cast.map(c => c.name);
  RP.applyDirectives(RP.blankState(), kitRoom, RP.parseDirectives(
    '[[EQUIP: Sans brass key]]\n[[COND: Sans winded 3 | ran the ridge road]]', names).directives, () => null);
  const block = RP.stateBlock(kitRoom);
  return /holding 🗝 a brass key/.test(block) && /winded \(ran the ridge road\) \[3 turns left\]/.test(block);
})());

// ---------- hooks: strong openers, weak ones rejected ----------
const hookScenario = board.find(s => s.kind === 'divergence') || board[0];
const hookSystem = RP.hookPrompt(hookScenario, RP.hookContext(state, hookScenario));
check('hook: the prompt hands over the filed material and the cast',
  hookSystem.includes(hookScenario.name) && hookSystem.includes('THE FILED MATERIAL') && hookSystem.includes('THE PEOPLE IN IT'));
check('hook: the prompt bans the generic openers by name',
  /you find yourself/i.test(hookSystem) && /BANNED/.test(hookSystem) && /second person/i.test(hookSystem));
check('hook: it demands a title, an opener and the stakes',
  /TITLE:/.test(hookSystem) && /OPEN:/.test(hookSystem) && /STAKES:/.test(hookSystem));
const goodHook = RP.parseHook([
  'TITLE: The Saws Stop On The Ridge Road',
  'OPEN: ' + 'Sans has the road in his sights and The Timber Gang are still cutting, forty feet up the ridge, ' +
    'because nobody told them the treeline moved. The rain is doing what it does every autumn to the logging road. ' +
    'You are close enough to hear the second saw bite and close enough to be blamed for what happens next. ' +
    'Somebody has to shout, and there are about four seconds left in which shouting still helps anyone.',
  'STAKES: If the crews keep cutting, the concession loses the season and somebody loses an arm.',
].join('\n'), hookScenario);
check('hook: a well-formed answer parses into title, opener and stakes',
  goodHook.title.includes('Saws Stop') && goodHook.open.includes('treeline') && goodHook.stakes.includes('concession'));
check('hook: a strong, specific opener is accepted', !RP.hookIsWeak(goodHook, { suggestedCast: [sans, cutters], brief: 'ridge road' }));
check('hook: "you find yourself" is rejected on sight',
  RP.hookIsWeak(RP.parseHook('OPEN: You find yourself in a place where things are happening and the air is thick with tension and possibility, and you wonder what you should do about any of it, as one does in these moments of quiet before something begins.', hookScenario), hookScenario));
check('hook: an opener with none of the filed names in it is rejected',
  RP.hookIsWeak(RP.parseHook('OPEN: ' + 'The door opens. Somebody walks through it carrying something heavy, and the room goes quiet in the way rooms do. '.repeat(4), hookScenario), hookScenario));
check('hook: an unformatted reply is used rather than thrown away',
  RP.parseHook('Just prose, no labels at all, but usable prose.', hookScenario).open.startsWith('Just prose'));
check('hook: with no model at all the cold open is still in the moment', (() => {
  const cold = RP.coldOpen(hookScenario);
  return cold.length > 120 && /What do you do\?$/.test(cold.trim());
})());

// ---------- backfills ----------
const backfillArchive = {
  events: [
    { id: 'the_ridge_ambush', name: 'The Logging Road Ambush', summary: archive.events[0].summary, keyEvents: ['the_vigilance_crisis', 'the_second_summit'], participants: archive.events[0].participants },
    { id: 'the_audit', name: 'The Midnight Audit', summary: 'The audit that everyone dates from, which refers back to the Vigilance Crisis twice on its first page.', keyEvents: ['the_vigilance_crisis'], participants: [{ id: 'sans', name: 'Sans', role: 'signed it' }] },
  ],
  factions: [{ id: 'crew', name: 'The Crew', summary: 'A body that lists the crisis among its key events.', keyEvents: ['the_vigilance_crisis'] }],
  knownIds: ['the_ridge_ambush', 'the_audit'],
};
const gapsFound = RP.backfillsFrom(backfillArchive, seatCast, state, 5);
check('backfill: events everything points at and nobody wrote are found',
  gapsFound.length === 1 && gapsFound[0].id === 'the_vigilance_crisis' && gapsFound[0].count === 3);
check('backfill: filed records are never mistaken for holes',
  !gapsFound.some(g => g.id === 'the_ridge_ambush' || g.id === 'the_audit'));
const backfill = RP.whatIfFromBackfill(gapsFound[0], seatCast);
check('backfill: the hole becomes a full scenario with a brief and a script',
  backfill.kind === 'backfill' && backfill.brief.includes('The hole') && backfill.beats.length >= 3 &&
  RP.scenarioQuality(backfill) > 0);
check('backfill: "most used" counts the times this reader has played one', (() => {
  RP.noteBackfillUse(state, 'backfill:the_vigilance_crisis');
  RP.noteBackfillUse(state, 'backfill:the_vigilance_crisis');
  const ranked = RP.backfillsFrom(backfillArchive, seatCast, state, 5);
  return state.backfillUses.the_vigilance_crisis === 2 && ranked[0].uses === 2;
})());

// ---------- sequels ----------
const played = RP.newRoom([sans, cutters], { sceneName: 'The Saws Stop', scene: 'The ridge road, at first light.', beats: turned.beats });
RP.ensureSheets(played);
played.states.sans.hp.value = 40;
played.states.sans.flags.bleeding = true;
played.messages.push({ id: 'p1', role: 'user', text: 'I take the long way round the stumps.', at: 1 });
played.messages.push({ id: 'p2', role: 'char', charId: 'sans', text: 'nobody uses that path twice.', at: 2, pinned: true });
const sequel = RP.sequelFrom(played, state, {});
check('sequel: it opens on the unfinished business, not on a recap',
  sequel.kind === 'sequel' && sequel.brief.includes('How it ended') && sequel.brief.includes('long way round'));
check('sequel: the wounds come with you', sequel.brief.includes('HP 40/100') && sequel.brief.includes('bleeding') && sequel.states.sans.hp.value === 40);
check('sequel: pinned lines are carried in as what mattered', sequel.brief.includes('nobody uses that path twice'));
check('sequel: beats that never fired fire here instead', sequel.beats.length >= 3);
check('sequel: opening it starts a room already in that state', (() => {
  const next = RP.newRoom(sequel.suggestedCast, RP.scenarioRoomOpts(sequel));
  return next.states.sans.hp.value === 40 && next.states.sans.flags.bleeding === true;
})());

// ---------- continuations: carry the filed record forward ----------
const sagaEvents = [
  { id: 'saga_one', name: 'The Promo Account', era: '1040 BF — the studio file', date: '4 Aethel, 1040 BF',
    summary: 'The first filing of the studio: a tour, a product demonstration and a tape that should not exist.',
    participants: [{ id: 'sans', name: 'Sans', role: 'was filming' }] },
  { id: 'saga_two', name: 'The Cut', era: '1040 BF — the studio file', date: '5 Aethel, 1040 BF',
    summary: 'The second filing: the exits lie, the applause is recorded, and one word stops the whole production. The record of the studio ends here, mid-raid, with the director walking out of the building carrying a folder and a small wired remote.',
    outcome: 'The escape became a raid on the show itself. Nobody has filed what happened after the director left the corridor.',
    aftermath: '**The show has a director.** He outranks everyone in the building, and the seats were empty the entire time.',
    location: 'The Nintendo Mania studio', image: 'plate.jpg',
    participants: [{ id: 'sans', name: 'Sans', role: 'said the word' }, { id: 'timber_gang', name: 'The Timber Gang', role: 'crewed the set' }],
    timeline: { entries: [
      { time: 'late morning', beat: 'Fire, and the alarm', detail: 'The actor erupts and the alarm is on the far wall.' },
      { time: 'noon', beat: 'CUT', detail: 'One production command stops everything in the building.' },
      { time: 'after', beat: 'The director leaves', detail: 'A folder, a cigar snapped in half, and a small wired remote carried like a habit.' },
    ] } },
  { id: 'other_saga', name: 'A Different File', era: '1035 BF — the coup chain', date: '1035 BF',
    summary: 'An unrelated filing from another era entirely, long enough to count as a saga head of its own.',
    participants: [{ id: 'rebel_scout', name: 'The Rebel Scout', role: 'was there' }] },
];
const sagas = RP.sagasFrom(sagaEvents);
const studio = sagas.find(x => x.era.includes('studio file'));
check('continuation: the archive’s own era lines are the sagas, newest first',
  sagas.length === 2 && studio.length === 2 && studio.head.id === 'saga_two' && sagas[0].head.id === 'other_saga');
const carry = RP.whatIfFromContinuation(studio, seatCast);
check('continuation: it picks up after the last filed line, not before it',
  carry.kind === 'continuation' && carry.brief.includes('Where the record stops') &&
  carry.brief.includes('The director leaves') && carry.premise.includes('minutes after'));
check('continuation: what the filing left behind comes with it',
  carry.brief.includes('How the last filing ended') && carry.brief.includes('What it left behind') &&
  carry.brief.includes('The saga so far'));
check('continuation: the beats push forward instead of replaying the record',
  carry.beats.length >= 4 && carry.beats.some(b => /never been filed|never named/i.test(b.detail)) &&
  !carry.beats.some(b => b.beat === 'CUT'));
check('continuation: it clears the quality floor like any other scenario', RP.scenarioQuality(carry) > 0);
check('continuation: the room is marked as writing new canon', (() => {
  const roomOpts = RP.scenarioRoomOpts(carry);
  const built = RP.newRoom(carry.suggestedCast, roomOpts);
  const system = RP.systemFor(state, built, carry.suggestedCast[0]);
  return built.canon === 'continuation' && system.includes('THIS IS A CONTINUATION') &&
    system.includes('[[NEW:') && system.includes('the description IS the portrait');
})());
check('continuation: a chat room is not told it is writing canon',
  !RP.systemFor(state, RP.newRoom([sans, cutters], {}), sans).includes('THIS IS A CONTINUATION'));

// ---------- invented characters ----------
const inventRoom = RP.newRoom(carry.suggestedCast, RP.scenarioRoomOpts(carry));
const invented = RP.parseDirectives(
  'The door opens before anyone reaches it.\n' +
  '[[NEW: Marguerite Oyle | the studio’s night archivist | wiry, sixty, ink to the elbows, a stopwatch on a bootlace round her neck]]',
  inventRoom.cast.map(c => c.name));
check('directives: a brand-new character parses into name, role and look',
  invented.directives[0].kind === 'new' && invented.directives[0].name === 'Marguerite Oyle' &&
  invented.directives[0].look.includes('stopwatch'));
const madeResult = RP.applyDirectives(state, inventRoom, invented.directives, () => null);
const made = inventRoom.cast.filter(c => c.invented)[0];
check('invented: they join the cast with a sheet of their own',
  made && made.name === 'Marguerite Oyle' && inventRoom.states[made.id] && inventRoom.states[made.id].hp);
check('invented: with no portrait anywhere, the description stands in for one',
  made.look.includes('ink to the elbows') && !made.image && made.summary.includes('night archivist'));
check('invented: they are kept, so they can be played again later',
  (state.newChars || []).some(c => c.id === made.id) && madeResult.lines[0].includes('New character'));
check('invented: they survive a save, a load and an export', (() => {
  RP.saveState(store, state);
  const bundle = RP.exportBundle(state, { chats: false, memory: false, user: false });
  return RP.loadState(store).newChars.some(c => c.look) && bundle.newChars.length >= 1;
})());
check('invented: the model reads them like anybody else', RP.stateBlock(inventRoom).includes('Marguerite Oyle'));

// ---------- fate: the world pushes back ----------
const fateRoom = RP.newRoom([sans, cutters], {});
check('fate: the table covers success, cost, a wrench, failure and refusal',
  ['triumph', 'success', 'cost', 'wrench', 'setback', 'refusal'].every(k => RP.FATE[k] && RP.FATE[k].dir.length > 60));
check('fate: a failure is told to stay failed', /FAILS/.test(RP.FATE.setback.dir) && /Never soften it/.test(RP.FATE.setback.dir));
check('fate: a refusal keeps the character in character', /does NOT do what they were asked/.test(RP.FATE.refusal.dir));
check('fate: off means the page never rolls at all',
  RP.rollFate({ settings: { fate: 'off' } }, fateRoom, {}) === null);
check('fate: rooms with mechanics off are never rolled for either',
  RP.rollFate({ settings: { fate: 'harsh' } }, RP.newRoom([sans], { mechanics: 'off' }), {}) === null);
check('fate: the roll lands somewhere in the table',
  ['triumph', 'success', 'cost', 'wrench', 'setback', 'refusal'].indexOf(RP.rollFate(state, fateRoom, { roll: 0.5 }).key) >= 0);
check('fate: harsh fails far more often than gentle', (() => {
  let gentleBad = 0, harshBad = 0;
  for (let i = 0; i < 200; i++) {
    const roll = i / 200;
    if (['setback', 'refusal', 'wrench'].includes(RP.rollFate({ settings: { fate: 'gentle' } }, fateRoom, { roll }).key)) gentleBad++;
    if (['setback', 'refusal', 'wrench'].includes(RP.rollFate({ settings: { fate: 'harsh' } }, fateRoom, { roll }).key)) harshBad++;
  }
  return harshBad > gentleBad * 1.5;
})());
check('fate: being hurt shifts the odds against you', (() => {
  const hurt = RP.newRoom([sans, cutters], {});
  RP.ensurePlayerSheet(RP.blankState(), hurt);
  const me = hurt.states[RP.PLAYER_ID];
  me.hp.value = Math.floor(me.hp.max * 0.1);
  me.flags = { wounded: { note: '', turns: 0 }, hunted: { note: '', turns: 0 } };
  const whole = RP.newRoom([sans, cutters], {});
  RP.ensurePlayerSheet(RP.blankState(), whole);
  let hurtBad = 0, wholeBad = 0;
  for (let i = 0; i < 200; i++) {
    const roll = i / 200;
    if (['setback', 'wrench'].includes(RP.rollFate({ settings: { fate: 'normal' } }, hurt, { roll }).key)) hurtBad++;
    if (['setback', 'wrench'].includes(RP.rollFate({ settings: { fate: 'normal' } }, whole, { roll }).key)) wholeBad++;
  }
  const rolled = RP.rollFate({ settings: { fate: 'normal' } }, hurt, { roll: 0.5 });
  return hurtBad > wholeBad && rolled.tilt < 0 && /badly hurt/.test(rolled.pill) && /wounded/.test(rolled.pill) &&
    /badly hurt/.test(RP.fateBlock(rolled));
})());
check('fate: an ENEMY bleeding out does not count against the player', (() => {
  const foeHurt = RP.newRoom([sans, cutters], { setup: { sans: { hpPct: 10, flags: 'wounded, hunted' } } });
  const whole = RP.newRoom([sans, cutters], {});
  [foeHurt, whole].forEach(rm => RP.ensurePlayerSheet(RP.blankState(), rm));
  let a = 0, b = 0;
  for (let i = 0; i < 200; i++) {
    const roll = i / 200;
    if (['setback', 'wrench'].includes(RP.rollFate({ settings: { fate: 'normal' } }, foeHurt, { roll }).key)) a++;
    if (['setback', 'wrench'].includes(RP.rollFate({ settings: { fate: 'normal' } }, whole, { roll }).key)) b++;
  }
  return a === b;
})());
check('fate: the model is ordered, not asked, and told not to narrate the dice', (() => {
  const block = RP.fateBlock(RP.rollFate(state, fateRoom, { force: 'setback' }));
  return block.includes('this is decided already') && block.includes('Do not narrate the dice') &&
    block.includes('you do not owe them a yes');
})());
check('fate: the instruction reaches the system prompt for that turn only', (() => {
  const withFate = RP.systemFor(state, fateRoom, sans, { fate: RP.rollFate(state, fateRoom, { force: 'refusal' }) });
  return withFate.includes('HOW THIS TURN RESOLVES') && !RP.systemFor(state, fateRoom, sans).includes('HOW THIS TURN RESOLVES');
})());

// ---------- the calendar: is this already history, or not yet? ----------
check('calendar: the archive’s own month order is the one used',
  RP.MONTHS[7] === 'Harvestide' && RP.MONTHS[8] === 'Aethel' && RP.MONTHS.length === 12);
check('calendar: a filed date parses', (() => {
  const d = RP.parseWahDate('5 Aethel, 1040 BF — continuing the studio encounter');
  return d.year === 1040 && d.month === 8 && d.day === 5 && d.exact;
})());
check('calendar: "the 21st of Highsun" parses too', (() => {
  const d = RP.parseWahDate('the 21st of Highsun, 1040 BF');
  return d.year === 1040 && d.month === 6 && d.day === 21;
})());
check('calendar: a time code is read in preference to prose', (() => {
  const d = RP.parseWahDate('TC:1040-08-30T23:50/SHD');
  return d.year === 1040 && d.month === 7 && d.day === 30;
})());
check('calendar: a bare year still gives something to compare',
  RP.parseWahDate('955 BF').year === 955 && !RP.parseWahDate('955 BF').exact);
check('calendar: legacy month spellings are not thrown away', RP.parseWahDate('4 Harvestside, 1040 BF').month === 7);
check('calendar: BF counts up, so a bigger year is later',
  RP.timeRelation('5 Aethel, 1040 BF', '1035 BF').rel === 'past' &&
  RP.timeRelation('1035 BF', '5 Aethel, 1040 BF').rel === 'future');
check('calendar: days between two dates in the same year are counted properly',
  RP.timeRelation('5 Aethel, 1040 BF', '21 Highsun, 1040 BF').days === -44);
check('calendar: an unknown date is flagged rather than guessed',
  RP.timeRelation('5 Aethel, 1040 BF', 'some time ago').rel === 'unknown');
check('calendar: the world clock is the fallback for "now"',
  RP.formatWahDate(RP.worldNow({ year: 1040, monthIndex: 8, day: 5 })) === '5 Aethel, 1040 BF');

const timedRoom = RP.newRoom([sans, cutters], { date: '5 Aethel, 1040 BF' });
const timedArchive = {
  events: [
    { id: 'past_one', name: 'The Highsun Vote', date: '21 Highsun, 1040 BF', summary: 'The vote that everybody dates from.',
      participants: [{ id: 'sans', name: 'Sans' }] },
    { id: 'future_one', name: 'The Darkmoon Reckoning', date: '30 Darkmoon, 1040 BF', summary: 'What the ridge road costs, eventually.',
      participants: [{ id: 'sans', name: 'Sans' }] },
  ],
};
const known = RP.knowledgeBlock(state, timedRoom, timedArchive);
check('knowledge: filings before the scene are offered as history',
  known.includes('ALREADY HISTORY') && known.includes('The Highsun Vote') && known.includes('before this scene'));
check('knowledge: filings after the scene are forbidden, by name',
  known.includes('HAS NOT HAPPENED YET') && known.includes('The Darkmoon Reckoning') &&
  known.includes('do not mention'));
check('knowledge: the scene is told what date it is and how the calendar runs',
  known.includes('5 Aethel, 1040 BF') && known.includes('the year counts UP'));
check('knowledge: it reaches the system prompt',
  RP.systemFor(state, timedRoom, sans, { archive: timedArchive }).includes('HAS NOT HAPPENED YET'));

// ---------- the filed description drives the performance ----------
const described = RP.normChar({
  id: 'archivist_x', name: 'Scribe Dewdrop', title: 'The Ledger of the Grove',
  race: 'Toad', affiliation: 'The Mages Guild', faction: 'Autumnwood Accords Desk',
  status: 'Active — injured, still filing', fameTier: 'Regionally known', powerLevel: 12,
  summary: 'The scribe who dates everything and forgives nothing.',
  description: 'A guild archivist who will not let a wrong date stand, cites the record mid-argument, and is quietly terrified of the arcane work going on two floors down.',
  keyEvents: ['a', 'b'], relatedArticles: ['c'],
});
check('cast: the filed description survives loading', described.description.includes('will not let a wrong date stand'));
check('cast: the affiliation, faction and standing survive too',
  described.affiliation === 'The Mages Guild' && described.faction === 'Autumnwood Accords Desk' &&
  described.fameTier === 'Regionally known' && described.powerLevel === 12);
const dossier = RP.card(described);
check('prompt: the card hands the model the description, not just a summary',
  dossier.includes('Filed description') && dossier.includes('cites the record mid-argument') &&
  dossier.includes('Affiliation: The Mages Guild'));
check('prompt: a behaviour line is inferred from what the archive already says',
  /cites the record/.test(RP.roleFor(described)) && /arcane/.test(RP.roleFor(described)));
check('prompt: the behaviour line follows the character, not a template',
  RP.roleFor(RP.normChar({ name: 'A Captain', description: 'A soldier and commander of the legion.' }))
    !== RP.roleFor(described));
check('prompt: a group turn shows the rest of the cast with their own summaries',
  RP.groupPrompt([described, sans], sans, {}).includes('The Mages Guild'));

// ---------- voice: the character's mouth, not just their biography ----------
check('cast: faiths filed as objects become a line, never [object Object]', (() => {
  const devout = RP.normChar({ id: 'devout', name: 'Devout', faiths: [{ id: 'great_maw', role: 'Refuses the title', note: 'long note' }, 'the Old Light'] });
  return devout.faiths === 'great maw (Refuses the title); the Old Light' && !RP.card(devout).includes('[object Object]') &&
    RP.card(devout).includes('Faith: great maw (Refuses the title)');
})());
check('prompt: the behaviour heuristic matches whole words — price and juice are not ice magic', (() => {
  const grocer = RP.normChar({ id: 'grocer', name: 'Grocer', description: 'Sells juice at a fair price with good service. Makes his own choices.' });
  const frost = RP.normChar({ id: 'frost', name: 'Frost', description: 'A master of ice magic and arcane rays.' });
  return !/arcane/.test(RP.roleFor(grocer)) && /arcane/.test(RP.roleFor(frost));
})());
const voiceSheets = JSON.parse(readFileSync(new URL('Reputation-Matrix2/data/voices.json', repoRoot), 'utf8'));
const voiceCount = RP.setVoices(voiceSheets);
check('voices: the archive ships hand-written sheets and the loader skips the _about note',
  voiceCount >= 10 && !RP.VOICES._about && !!RP.VOICES.wario && !!RP.VOICES.waluigi);
check('voices: every sheet names a character that exists and carries register, sounds, never and lines', (() => {
  const castFile = JSON.parse(readFileSync(new URL('Reputation-Matrix2/data/characters.json', repoRoot), 'utf8'));
  const list = Array.isArray(castFile) ? castFile : castFile.characters;
  const ids = new Set(list.map(c => c.id));
  return Object.keys(RP.VOICES).every(id => ids.has(id) &&
    typeof RP.VOICES[id].register === 'string' && RP.VOICES[id].register.length > 80 &&
    Array.isArray(RP.VOICES[id].sounds) && Array.isArray(RP.VOICES[id].never) &&
    Array.isArray(RP.VOICES[id].lines) && RP.VOICES[id].lines.length >= 4);
})());
const warioRecord = RP.normChar({ id: 'wario', name: 'Wario', title: 'The Explosive Accountant',
  description: 'Waluigi has known Wario for longer than Waluigi cares to calculate. He prices everything.' });
const warioSolo = RP.soloPrompt(warioRecord, {});
check('voices: the solo prompt carries the sheet — register, tics, the never list and sample lines',
  warioSolo.includes('VOICE \u2014 how Wario actually talks') && warioSolo.includes('string bean') &&
  warioSolo.includes('Never:') && warioSolo.includes('I own the meter') &&
  warioSolo.indexOf('VOICE \u2014') < warioSolo.indexOf('IN-CHARACTER RULES'));
check('voices: a hand-written sheet replaces the guessed behaviour line', !warioSolo.includes('How they behave:'));
check('voices: the filed description is flagged as Waluigi\u2019s biography, not the character\u2019s own tone',
  warioSolo.includes('biography written by Waluigi') && warioSolo.includes('do NOT borrow its narrator'));
check('voices: Waluigi\u2019s own description is his own voice and says so',
  RP.card(RP.normChar({ id: 'waluigi', name: 'Waluigi', description: 'This is not bitterness. This is FACT.' })).includes('written by Waluigi himself'));
check('voices: the group prompt carries the speaker\u2019s sheet too',
  RP.groupPrompt([warioRecord, sans], warioRecord, {}).includes('I own the meter'));
check('voices: a character with no sheet still gets a first-person instruction built from the record', (() => {
  const block = RP.voiceBlock(described);
  return block.includes('FIRST PERSON as Scribe Dewdrop') && block.includes('cites the record') && block.includes('The Mages Guild');
})());
check('voices: an imported card\u2019s example dialogue becomes the sheet, keeping only the character\u2019s lines', (() => {
  const imported = RP.parseCharacterCard({ name: 'Promo Mario', description: 'A host.', personality: 'loud',
    mes_example: '<START>\n{{user}}: hi\n{{char}}: Welcome-a to Nintendo Mania, paisanos!\n{{user}}: who are you\n{{char}}: The main host, that\u2019s who!' });
  const room = RP.newRoom([imported], {});
  const seated = room.cast[0];
  const sheet = RP.voiceSheet(seated);
  return !!seated.card && sheet && sheet.fromCard && sheet.lines.length === 2 &&
    sheet.lines[0].includes('paisanos') && !sheet.lines.some(l => /who are you/.test(l)) &&
    RP.soloPrompt(seated, {}).includes('paisanos');
})());
check('style: new rooms open in character — first person — and Novel is still there to pick', (() => {
  const fresh = RP.newRoom([warioRecord], {});
  return RP.DEFAULT_STYLE === 'voice' && fresh.style === 'voice' && RP.STYLES.voice.dir.includes('FIRST PERSON') &&
    RP.STYLES.novel.dir.includes('third-person') && RP.blankState().settings.style === 'voice';
})());
check('prompt: the character has the last word, and it matches the style', (() => {
  const st = RP.blankState();
  const inVoice = RP.systemFor(st, RP.newRoom([warioRecord], {}), warioRecord, {});
  const asNovel = RP.systemFor(st, RP.newRoom([warioRecord], { style: 'novel' }), warioRecord, {});
  return inVoice.trim().endsWith('if they would refuse, refuse.') && inVoice.includes('NOW ANSWER AS WARIO') &&
    asNovel.trim().endsWith('the words are theirs.') && inVoice.indexOf('NOW ANSWER AS WARIO') > inVoice.indexOf('LENGTH');
})());
check('play as: taking a seat adds you to the cast and stars you in one move', (() => {
  const room = RP.newRoom([warioRecord], {});
  const waluigi = RP.normChar({ id: 'waluigi', name: 'Waluigi', title: 'The Great and Underappreciated' });
  const seat = RP.playAs(room, waluigi);
  const again = RP.playAs(room, waluigi);
  return seat && seat.id === 'waluigi' && room.youPlay === 'waluigi' && room.kind === 'group' &&
    room.cast.length === 2 && again.id === 'waluigi' && room.youPlay === 'waluigi' &&
    RP.speakableCast(room).map(c => c.id).join() === 'wario' &&
    RP.personaBlock('', RP.blankState(), room).includes('they ARE Waluigi \u2014 The Great and Underappreciated');
})());

// ---------- memory is dated, twice ----------
const datedRoom = RP.newRoom([sans], { date: '5 Aethel, 1040 BF', title: 'The ridge road' });
RP.rememberTurn(state, datedRoom, { id: 'm1', role: 'char', charId: 'sans', text: 'the saws stopped at noon.', at: Date.now() });
const datedMem = RP.charMemory(state, sans);
check('memory: a remembered line carries the in-world date and the chat it came from', (() => {
  const note = datedMem.notes[datedMem.notes.length - 1];
  return note.when === '5 Aethel, 1040 BF' && note.roomTitle === 'The ridge road' && note.at > 0;
})());
RP.logEvent(state, { kind: 'chat', roomId: 'other', roomTitle: 'Another room', when: '30 Darkmoon, 1040 BF', chars: ['sans'], text: 'Sans is told how it ends.' });
const recall = RP.memoryBlock(state, [sans], timedRoom);
check('memory: the world log prints the in-world date of every line', recall.includes('30 Darkmoon, 1040 BF'));
check('memory: a log line from after this scene is marked unknowable',
  recall.includes('AFTER this scene — they cannot know it'));
check('memory: what a character remembers says when and where they said it',
  recall.includes('5 Aethel, 1040 BF') && recall.includes('The ridge road'));

// ---------- browsing 189 characters ----------
const browse = [
  RP.normChar({ id: 'p1', name: 'Alpha', race: 'Toad', affiliation: 'The Guild', fameScore: 10, powerLevel: 2, keyEvents: ['a'] }),
  RP.normChar({ id: 'p2', name: 'Beta', race: 'Toad', affiliation: 'The Guild', fameScore: 90, powerLevel: 40, keyEvents: ['a', 'b', 'c'] }),
  RP.normChar({ id: 'p3', name: 'Gamma', race: 'Koopa', affiliation: 'The Legion', fameScore: 50, powerLevel: 9, summary: 'An ice mage of the Dark Shores.' }),
];
const browseState = { rooms: [{ id: 'r', updated: 200, cast: [browse[1]], messages: [{ role: 'char', charId: 'p2' }, { role: 'char', charId: 'p2' }] }], chars: [{ id: 'p3', notes: [1, 2, 3], knowledge: [] }] };
const ctx = RP.castContext(browseState);
check('cast browser: sort by name, fame, power, filings and play count all differ',
  RP.sortCast(browse, 'name', ctx)[0].id === 'p1' &&
  RP.sortCast(browse, 'fame', ctx)[0].id === 'p2' &&
  RP.sortCast(browse, 'power', ctx)[0].id === 'p2' &&
  RP.sortCast(browse, 'filings', ctx)[0].id === 'p2' &&
  RP.sortCast(browse, 'played', ctx)[0].id === 'p2' &&
  RP.sortCast(browse, 'remember', ctx)[0].id === 'p3');
check('cast browser: search reads the whole dossier, not just the name',
  RP.filterCast(browse, { query: 'ice mage' }, ctx).length === 1 &&
  RP.filterCast(browse, { query: 'dark shores' }, ctx)[0].id === 'p3');
check('cast browser: facets filter by race and affiliation',
  RP.filterCast(browse, { race: 'Toad' }, ctx).length === 2 &&
  RP.filterCast(browse, { affiliation: 'The Legion' }, ctx).length === 1);
check('cast browser: played / never-played views work off your own chats',
  RP.filterCast(browse, { view: 'played' }, ctx).length === 1 &&
  RP.filterCast(browse, { view: 'unplayed' }, ctx).length === 2);
check('cast browser: grouping by race, affiliation or nothing at all',
  RP.groupCast(browse, 'race', ctx).length === 2 &&
  RP.groupCast(browse, 'affiliation', ctx)[0].chars.length === 2 &&
  RP.groupCast(browse, 'none', ctx).length === 1 &&
  RP.groupCast(browse, 'letter', ctx).length === 3);
check('cast browser: facets only offer values shared by more than one person',
  RP.castFacets(browse).race.length === 1 && RP.castFacets(browse).race[0].value === 'Toad');

// ---------- the lore book ----------
const bookState = RP.blankState();
bookState.settings.bookBudget = 3;
const bookRoom = RP.newRoom([sans, cutters], { title: 'The ledger room', date: '5 Aethel, 1040 BF' });
check('book: a page files at the bottom, with both clocks', (() => {
  const page = RP.bookAdd(bookState, { kind: 'place', name: 'The Ledger Room', text: 'A back office off the corridor.', when: '5 Aethel, 1040 BF', roomId: bookRoom.id, roomTitle: bookRoom.title });
  const b = RP.bookState(bookState);
  return b.entries.length === 1 && b.entries[b.entries.length - 1].id === page.id && page.when === '5 Aethel, 1040 BF' && page.at > 0;
})());
check('book: the newest page is always last', (() => {
  RP.bookAdd(bookState, { kind: 'person', name: 'Marguerite Oyle', text: 'The night archivist.' });
  const b = RP.bookState(bookState);
  return b.entries[b.entries.length - 1].name === 'Marguerite Oyle';
})());
check('book: filing the same thing twice updates the page instead of duplicating it', (() => {
  RP.bookAdd(bookState, { kind: 'place', name: 'the ledger room', text: 'The door does not lock from inside.' });
  const b = RP.bookState(bookState);
  const page = b.entries.filter(e => e.kind === 'place')[0];
  return b.entries.length === 2 && page.seen === 2 && page.text.includes('does not lock');
})());
check('book: a diary page needs no name', Boolean(RP.bookAdd(bookState, { kind: 'diary', text: 'They went looking for a ledger and somebody had been there first.', when: '5 Aethel, 1040 BF' })));
check('book: the model is handed the book as established truth', (() => {
  const block = RP.bookBlock(bookState, bookRoom);
  return block.includes('THE LORE BOOK') && block.includes('established in play and is TRUE') &&
    block.includes('The Ledger Room') && block.includes('THE DIARY');
})());
check('book: it reaches the system prompt', RP.systemFor(bookState, bookRoom, sans).includes('THE LORE BOOK'));
check('book: a page can be torn out', (() => {
  const id = RP.bookState(bookState).entries[1].id;
  RP.bookRemove(bookState, id);
  return !RP.bookState(bookState).entries.some(e => e.id === id);
})());
check('book: it survives a save, and rides along with the lore export', (() => {
  RP.saveState(store, bookState);
  const round = RP.loadState(store);
  const bundle = RP.exportBundle(bookState, { chats: false, memory: false, user: false });
  return RP.bookState(round).entries.length === 2 && bundle.book.length === 2;
})());
check('book: importing a book merges rather than replaces by default', (() => {
  const target = RP.blankState();
  RP.bookAdd(target, { kind: 'fact', name: 'Something else', text: 'Already known here.' });
  RP.importBundle(target, RP.exportBundle(bookState, { chats: false, memory: false, user: false }), 'merge');
  return RP.bookState(target).entries.length === 3;
})());

// ---- the queue ----
check('queue: work is queued, one key only once', (() => {
  RP.queuePush(bookState, { key: 'r:3', roomId: bookRoom.id, turns: [] });
  const dup = RP.queuePush(bookState, { key: 'r:3', roomId: bookRoom.id, turns: [] });
  return RP.bookState(bookState).queue.length === 1 && dup === null;
})());
check('queue: it refuses to grow without limit', (() => {
  for (let i = 0; i < 20; i++) RP.queuePush(bookState, { key: 'k' + i, roomId: bookRoom.id, turns: [] });
  return RP.bookState(bookState).queue.length === RP.QUEUE_MAX;
})());
check('queue: jobs come out oldest first and count against the budget', (() => {
  const first = RP.queueNext(bookState);
  RP.queueDone(bookState, first.id, true);
  return first.key === 'r:3' && RP.bookState(bookState).spent === 1 && RP.bookBudgetLeft(bookState) === 2;
})());
check('queue: when the budget runs out, filing stops', (() => {
  RP.queueDone(bookState, RP.queueNext(bookState).id, true);
  RP.queueDone(bookState, RP.queueNext(bookState).id, true);
  return RP.bookBudgetLeft(bookState) === 0;
})());
check('queue: the queue is never saved — unfinished work does not come back', (() => {
  RP.saveState(store, bookState);
  return RP.bookState(RP.loadState(store)).queue.length === 0;
})());

// ---- the extraction call is its own small prompt ----
const exPrompt = RP.extractPrompt(bookRoom, [{ who: 'You', text: 'I push the door.' }], ['The Ledger Room']);
check('extract: the archivist prompt is separate, formatted and bounded',
  exPrompt.includes('You are the archivist') && exPrompt.includes('PLACE: name |') &&
  exPrompt.includes('do not file these again') && exPrompt.includes('At most six lines'));
check('extract: a well-formed answer parses into pages', (() => {
  const got = RP.parseExtract([
    'PLACE: The Ledger Room | a back office lined with unfiled boxes',
    'PERSON: Marguerite Oyle | the night archivist, wants the ledger back',
    'FACT: the ledger room door does not lock from the inside',
    'DIARY: They went looking for a ledger and somebody had been there first.',
  ].join('\n'));
  return got.length === 4 && got[0].kind === 'place' && got[1].name === 'Marguerite Oyle' &&
    got[2].kind === 'fact' && got[3].kind === 'diary';
})());
check('extract: NONE and malformed lines file nothing',
  RP.parseExtract('NONE').length === 0 && RP.parseExtract('I think maybe a place happened?').length === 0);

// ---------- citing the archive, only when the date allows ----------
const citeIndex = RP.buildIndex({
  events: [
    { id: 'past_vote', name: 'The Highsun Vote', date: '21 Highsun, 1040 BF', summary: 'The ledger vote that everyone dates from.' },
    { id: 'later', name: 'The Darkmoon Reckoning', date: '30 Darkmoon, 1040 BF', summary: 'What the ledger costs, eventually.' },
    { id: 'undated', name: 'An Undated Filing', summary: 'A ledger filing with no date at all.' },
  ],
  factions: [{ id: 'guild', name: 'The Mages Guild', summary: 'Keeps the ledger of canal decrees.' }],
  whatifs: [{ id: 'wf', title: 'What If The Ledger Burned?', summary: 'A non-canon branch about the ledger.' }],
  posts: [],
}, { sans: sans });
check('index: events, bodies, people and what-ifs are all indexed',
  citeIndex.length === 6 && citeIndex.some(r => r.kind === 'faction') &&
  citeIndex.some(r => r.kind === 'character') && citeIndex.some(r => r.kind === 'event' && !r.date));
const cited = RP.citableFor(citeIndex, bookRoom, bookState, { query: 'the ledger and the vote' });
check('cite: filings dated before the scene are offered, with their ids',
  cited.citable.some(x => x.r.id === 'past_vote') &&
  RP.citationBlock(cited).includes('[event:past_vote]'));
check('cite: a filing dated after the scene is blocked and named as unknowable',
  cited.blocked.some(x => x.r.id === 'later') &&
  RP.citationBlock(cited).includes('FILED, BUT NOT YET') &&
  !cited.citable.some(x => x.r.id === 'later'));
check('cite: standing records — people and bodies — are always citable',
  cited.citable.some(x => x.r.kind === 'faction'));
check('cite: a non-canon What-If is never offered as a source',
  !cited.citable.some(x => x.r.kind === 'what-if') && !cited.blocked.some(x => x.r.kind === 'what-if'));
check('cite: the model is told not to invent filings',
  RP.citationBlock(cited).includes('Never invent a filing, a date or a quotation'));
check('cite: irrelevant records are left out — only the people in the room survive a blank query', (() => {
  const none = RP.citableFor(citeIndex, bookRoom, bookState, { query: 'zzzz qqqq wwww' });
  return none.citable.every(x => x.r.kind === 'character');
})());
check('cite: it reaches the system prompt when supplied',
  RP.systemFor(bookState, bookRoom, sans, { citations: RP.citationBlock(cited) }).includes('FILES YOU MAY CITE'));

// ---------- character cards: PNG and JSON, in and out ----------
const cardChar = RP.normChar({
  id: 'sans', name: 'Sans', title: 'The watchman on the ridge', race: 'Skeleton',
  affiliation: 'The concession', status: 'Active — tired',
  description: 'Watches the logging road, says little, and is never quite where you left him.',
  summary: 'The watchman on the ridge road.', image: 'portraits/sans.png', keyEvents: ['the_ridge_ambush'],
});
const v2 = RP.toCharacterCard(cardChar, { date: '5 Aethel, 1040 BF' });
check('card: exports as chara_card_v2 with the v1 fields alongside',
  v2.spec === 'chara_card_v2' && v2.spec_version === '2.0' && v2.data.name === 'Sans' && v2.name === 'Sans' &&
  v2.description === v2.data.description);
check('card: the filed dossier becomes the description and the personality',
  v2.data.description.includes('never quite where you left him') && v2.data.personality.length > 0 &&
  v2.data.scenario.includes('5 Aethel, 1040 BF'));
check('card: the archive’s own fields ride along in extensions',
  v2.data.extensions.waluipedia.id === 'sans' && v2.data.extensions.waluipedia.race === 'Skeleton' &&
  v2.data.extensions.waluipedia.keyEvents[0] === 'the_ridge_ambush');
const v1Read = RP.parseCharacterCard({ name: 'Seraphina', description: 'A tall knight in dented plate.', personality: 'stoic', first_mes: 'You are late.' });
check('card: a v1 card reads back as a playable guest',
  v1Read.name === 'Seraphina' && v1Read.invented === true && v1Read.card.first_mes === 'You are late.' &&
  v1Read.description.includes('dented plate'));
const v2Read = RP.parseCharacterCard(v2);
check('card: our own v2 export reads back as the same character',
  v2Read.name === 'Sans' && v2Read.description.includes('never quite where you left him'));
check('card: a card with no name is refused', RP.parseCharacterCard({ description: 'nobody' }) === null);

// A 1×1 PNG, as bytes.
const PNG_1PX = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
check('png: a PNG is recognised, and other bytes are not',
  RP.isPng(PNG_1PX) && !RP.isPng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])));
const carded = RP.cardToPng(PNG_1PX, cardChar, { date: '5 Aethel, 1040 BF' });
check('png: the card is written into the portrait, and the PNG still starts as a PNG',
  carded.length > PNG_1PX.length && RP.isPng(carded));
check('png: the chunk is a valid tEXt chunk called chara', (() => {
  const text = RP.pngText(carded);
  return Boolean(text.chara) && JSON.parse(RP.b64decode(text.chara)).data.name === 'Sans';
})());
check('png: the IEND chunk is still last, so viewers can still open it', (() => {
  const tail = Array.from(carded.slice(-8, -4)).map(b => String.fromCharCode(b)).join('');
  return tail === 'IEND';
})());
check('png: reading the card back gives the character', (() => {
  const back = RP.cardFromPng(carded);
  return back && back.name === 'Sans' && back.description.includes('logging road');
})());
check('png: a PNG with no card in it yields nothing rather than guessing', RP.cardFromPng(PNG_1PX) === null);

// ---------- text in, text out ----------
const readIn = RP.parseTranscript([
  'Sans: the saws stopped at noon.',
  '**The Timber Gang:** we heard it from the ridge.',
  'it came from the treeline.',
  'I step out of the trees with my hands up.',
].join('\n'));
check('text: "Name:" and "**Name:**" both parse, and continuation lines join the turn',
  readIn.length === 3 && readIn[0].who === 'Sans' && readIn[1].who === 'The Timber Gang' &&
  readIn[1].text.includes('treeline'));
check('text: an unattributed line is the player', readIn[2].who === '' && readIn[2].text.includes('hands up'));
const imported = RP.roomFromTranscript(readIn, [sans, cutters], { title: 'Read in' });
check('text: the turns become a room, matched to the cast',
  imported.messages.filter(m => m.role === 'char').length === 2 &&
  imported.messages.filter(m => m.role === 'user').length === 1 &&
  imported.messages[0].charId === 'sans');

// ---------- exports for a writing model ----------
const briefRoom = RP.newRoom([sans, cutters], {
  title: 'The saws stop', sceneName: 'The saws stop', date: '5 Aethel, 1040 BF',
  scene: 'The ridge road above the concession, first light.',
  beats: [{ time: 'dawn', beat: 'The saws start' }, { time: 'noon', beat: 'The saws stop' }],
});
briefRoom.beatIndex = 1;
briefRoom.states.sans.hp.value = 40;
briefRoom.states.sans.flags.bleeding = true;
briefRoom.messages.push({ id: 'b1', role: 'user', text: 'I take the long way round the stumps.', at: 1 });
briefRoom.messages.push({ id: 'b2', role: 'char', charId: 'sans', text: 'nobody uses that path twice.', at: 2, alts: ['nobody uses that path twice.', 'a discarded alternative take'], alt: 0 });
briefRoom.messages.push({ id: 'b3', role: 'char', charId: 'sans', error: true, text: 'The model did not answer', at: 3 });
briefRoom.messages.push({ id: 'b4', role: 'state', lines: ['Sans −10 HP'], at: 4 });
state.book = { entries: [{ id: 'p', kind: 'place', name: 'The Stump Path', text: 'A cut-through nobody admits to using.', roomId: briefRoom.id, at: 1 }], queue: [], spent: 0 };
const brief = RP.storyBrief(state, briefRoom, {});
check('brief: it opens with who, when and the situation',
  brief.includes('# The saws stop') && brief.includes('5 Aethel, 1040 BF') && brief.includes('**Sans**') &&
  brief.includes('The ridge road above the concession'));
check('brief: the fluff is cut — no ids, no swipes, no error notices, no state pills',
  !brief.includes('b1') && !brief.includes('discarded alternative take') &&
  !brief.includes('The model did not answer') && !brief.includes('−10 HP'));
check('brief: it keeps the played turns, the fired beats, the end state and what was established',
  brief.includes('nobody uses that path twice') && brief.includes('The saws start') &&
  brief.includes('HP 40/100') && brief.includes('The Stump Path'));
check('brief: it ends by telling the writer what the material is for',
  /Write this up as prose/.test(brief));
check('brief: a long chat is cut in the middle, not truncated at the end', (() => {
  const big = RP.newRoom([sans], { title: 'Long' });
  for (let i = 0; i < 300; i++) big.messages.push({ id: 'x' + i, role: 'user', text: 'A turn of text number ' + i + '. '.repeat(10), at: i });
  const cut = RP.storyBrief(state, big, { budget: 4000 });
  return cut.length <= 4200 && cut.includes('cut for length') && cut.includes('Write this up as prose');
})());
const full = RP.chatExport(state, briefRoom);
check('full export: it is an importable bundle carrying the room, its memory, lore and book',
  full.kind === 'waluipedia-chatroom-bundle' && full.rooms[0].id === briefRoom.id &&
  Array.isArray(full.book) && Array.isArray(full.newChars));
check('full export: importing it elsewhere restores the chat', (() => {
  const target = RP.blankState();
  const stats = RP.importBundle(target, full, 'merge');
  return stats.rooms === 1 && target.rooms[0].title === 'The saws stop';
})());

// ---------- the prompt stays inside the window ----------
check('prompt: a heavy scene still fits the budget, keeping the instructions', (() => {
  const heavy = RP.newRoom([sans, cutters, rebel], { date: '5 Aethel, 1040 BF', scene: 'z'.repeat(2000) });
  const fat = RP.blankState();
  for (let i = 0; i < 60; i++) RP.bookAdd(fat, { kind: 'place', name: 'Place ' + i, text: 'x'.repeat(400) });
  const system = RP.systemFor(fat, heavy, sans, {
    citations: 'FILES YOU MAY CITE\n' + Array.from({ length: 40 }, (_, i) => '- [event:e' + i + '] ' + 'q'.repeat(200)).join('\n'),
    fate: RP.rollFate(fat, heavy, { force: 'setback' }),
  });
  // The reference material gives way — trimmed first, dropped if it must
  // be — and the instructions, the card and the VOICE never do.
  return system.length <= RP.PROMPT_BUDGET && system.includes('STAGE DIRECTIONS') &&
    system.includes('CHARACTER STATE') && system.includes('HOW THIS TURN RESOLVES') &&
    system.includes('VOICE \u2014 how Sans actually talks') && system.includes('NOW ANSWER AS SANS') &&
    (system.includes('trimmed to fit') || !system.includes('Place 59'));
})());
check('prompt: a tight window trims the filed description, not the voice or the rules', (() => {
  const wordy = RP.normChar({ id: 'wordy', name: 'Wordy', description: ('A long filed biography. ').repeat(80) });
  const parts = [RP.soloPrompt(wordy, {}), 'THE LORE BOOK\n' + Array.from({ length: 30 }, (_, i) => '- fact ' + i + ' ' + 'y'.repeat(60)).join('\n')];
  const fitted = RP.fitPrompt(parts, 3200, 2);   // parts[2..] would be protected; the lore is soft
  return fitted.length <= 3200 && fitted.includes('IN-CHARACTER RULES') && fitted.includes('STYLE') &&
    fitted.includes('VOICE \u2014 how Wordy actually talks') && fitted.includes('trimmed to fit') &&
    !fitted.includes('(truncated)');
})());
check('prompt: when the card and the instructions alone overflow, the head is squeezed and the tail survives', (() => {
  const roster = Array.from({ length: 6 }, (_, i) => RP.normChar({ id: 'r' + i, name: 'Roster ' + i,
    title: 'A long title that goes on for a while ' + i, affiliation: 'A long affiliation, several bodies, ' + i,
    summary: 'A summary of some length for roster member number ' + i + '. '.repeat(3) }));
  const warioish = RP.normChar({ id: 'wario', name: 'Wario', title: 'The Explosive Accountant', description: 'Biography. '.repeat(120) });
  const room = RP.newRoom([warioish].concat(roster), { scene: 'The vault. '.repeat(40) });
  const st = RP.blankState();
  const sys = RP.systemFor(st, room, warioish, {});   // the default window, mechanics on, seven sheets
  return sys.length <= RP.PROMPT_BUDGET && sys.includes('STAGE DIRECTIONS') && sys.includes('LENGTH') &&
    sys.includes('NOW ANSWER AS WARIO') && sys.includes('VOICE \u2014 how Wario actually talks') &&
    sys.includes('never once sorry') && !sys.includes('(truncated)');
})());
check('prompt: who the reader plays survives a tight window, and the colour rules go before the voice does', (() => {
  const wario = RP.normChar({ id: 'wario', name: 'Wario', description: 'Biography. '.repeat(120) });
  const waluigi = RP.normChar({ id: 'waluigi', name: 'Waluigi', title: 'The Author', summary: 'The archive\u2019s author, ROBBED.' });
  const room = RP.newRoom([wario], {});
  const st = RP.blankState();
  RP.playAs(room, waluigi);
  RP.ensurePlayerSheet(st, room);
  st.rooms.push(room); st.active = room.id;
  const sys = RP.systemFor(st, room, wario, { budget: 9000 });   // mechanics on: the fixed tail alone is ~6k
  const who = sys.indexOf('THE USER PLAYS'), stage = sys.indexOf('STAGE DIRECTIONS'), close = sys.indexOf('NOW ANSWER AS WARIO');
  return sys.length <= 9000 && who > 0 && sys.includes('they ARE Waluigi') &&
    sys.includes('never once sorry') && (sys.match(/^  \u201c/gm) || []).length >= 3 &&
    stage > who && close > stage && !sys.includes('You may colour') && !sys.includes('(truncated)');
})());
check('style: Novel chats move to In character once, and the Style picker still offers Novel', (() => {
  const st = RP.blankState();
  const a = RP.newRoom([RP.normChar({ id: 'wario', name: 'Wario' })], {}); a.style = 'novel';
  const b = RP.newRoom([RP.normChar({ id: 'luigi', name: 'Luigi' })], {}); b.style = 'terse';
  st.rooms.push(a, b); st.settings.style = 'novel';
  const moved = RP.migrateStyle(st);
  a.style = 'novel';                                   // the reader chose Novel again, on purpose
  const again = RP.migrateStyle(st);
  return moved === 1 && again === 0 && a.style === 'novel' && b.style === 'terse' &&
    st.settings.style === RP.DEFAULT_STYLE && st.settings.styleMigrated === 1 && Boolean(RP.STYLES.novel);
})());

// ---------- commentary mode ----------
check('commentary: four formats, each with its own clock',
  ['podcast', 'debate', 'deepdive', 'hottake'].every(k => RP.COMMENTARY_STYLES[k].dir.length > 80) &&
  RP.COMMENTARY_STYLES.podcast.min === 15 && RP.COMMENTARY_STYLES.podcast.max === 60 &&
  RP.COMMENTARY_STYLES.deepdive.min === 30 && RP.COMMENTARY_STYLES.deepdive.max === 120);
const podPlan = RP.commentaryPlan({ style: 'podcast', topic: 'The Iron Mandate', minutes: 30 });
check('commentary: a run is planned into segments a local model can finish',
  podPlan.words === 30 * RP.WPM && podPlan.segments.length >= 8 &&
  podPlan.segments.every(seg => seg.words <= 650 && seg.focus));
check('commentary: the requested length is honoured, and clamped to the format',
  RP.commentaryPlan({ style: 'hottake', minutes: 90 }).minutes === 30 &&
  RP.commentaryPlan({ style: 'deepdive', minutes: 10 }).minutes === 30 &&
  RP.commentaryPlan({ style: 'deepdive', minutes: 120 }).words === 120 * RP.WPM);
check('commentary: a two-hour deep dive is dozens of calls, not one impossible one', (() => {
  const deep = RP.commentaryPlan({ style: 'deepdive', minutes: 120 });
  return deep.segments.length >= 25 && deep.segments.length <= 40;
})());
const comSources = RP.commentarySources(citeIndex, 'the ledger vote', 5);
check('commentary: the subject pulls its material out of the filed record',
  comSources.length > 0 && comSources.every(src => src.id && src.name) &&
  comSources.some(src => src.date));
const podEpisode = Object.assign({}, podPlan, { sources: comSources });
const seg1 = RP.commentaryPrompt(podEpisode, podEpisode.segments[0], {});
check('commentary: the prompt names both speakers and forbids the usual failures',
  seg1.includes('WALUIGI:') && seg1.includes('LUIGI:') &&
  seg1.includes('Never invent a filing') && /no stage directions/i.test(seg1));
check('commentary: each call is told its own slice, not the whole episode',
  seg1.includes('part 1 of ' + podEpisode.segments.length) && seg1.includes('do not write the rest of the episode') &&
  seg1.includes(podEpisode.segments[0].focus));
check('commentary: the material is handed over with its ids and dates',
  seg1.includes('THE FILED MATERIAL') && seg1.includes('[' + comSources[0].kind + ':' + comSources[0].id + ']'));
const seg3 = RP.commentaryPrompt(podEpisode, podEpisode.segments[2], {
  previous: 'LUIGI: who were the three abstentions?', covered: ['cold open', 'the background'],
});
check('commentary: later segments are handed what came before and what is spent',
  seg3.includes('who were the three abstentions?') && seg3.includes('ALREADY COVERED') &&
  seg3.includes('do not go over these again'));
check('commentary: the last segment is told to land it, not to summarise',
  RP.commentaryPrompt(podEpisode, podEpisode.segments[podEpisode.segments.length - 1], {})
    .includes('No summary of the episode'));
const spoken = RP.parseCommentary([
  'WALUIGI: Twenty-eight for, eight against, three abstaining.',
  '**LUIGI:** And nobody has ever printed the three.',
  'Which is its own answer.',
  'Some stray narration with no speaker at all.',
].join('\n'));
check('commentary: labelled lines parse, and stray lines join the speaker above',
  spoken.length === 2 && spoken[0].who === 'waluigi' && spoken[1].who === 'luigi' &&
  spoken[1].text.includes('its own answer') && spoken[1].text.includes('stray narration'));
check('commentary: the clock is words at a speaking pace', (() => {
  const stats = RP.commentaryStats([{ who: 'waluigi', text: 'word '.repeat(RP.WPM * 3) }]);
  return stats.minutes === 3 && stats.words === RP.WPM * 3;
})());
const finished = Object.assign({}, podEpisode, { lines: spoken, at: Date.now() });
const script = RP.commentaryScript(finished);
check('commentary: the script exports with its runtime and its sources',
  script.includes('# The Iron Mandate') && script.includes('**WALUIGI:**') && script.includes('**LUIGI:**') &&
  script.includes('minutes') && script.includes('Sources:'));
check('commentary: episodes are kept, newest first, and survive a save', (() => {
  const keep = RP.blankState();
  RP.saveEpisode(keep, finished);
  RP.saveEpisode(keep, Object.assign({}, finished, { id: 'second', topic: 'Something else' }));
  RP.saveState(store, keep);
  const round = RP.loadState(store);
  return round.episodes.length === 2 && round.episodes[0].topic === 'Something else';
})());
check('commentary: episodes ride along in the lore export', (() => {
  const keep = RP.blankState();
  RP.saveEpisode(keep, finished);
  const bundle = RP.exportBundle(keep, { chats: false, memory: false, user: false });
  const target = RP.blankState();
  RP.importBundle(target, bundle, 'merge');
  return bundle.episodes.length === 1 && target.episodes.length === 1;
})());

// ---------- importing into a chat that is already running ----------
const v1Card = {
  name: 'Promo Mario',
  description: 'The main host of Nintendo Mania!',
  personality: 'Cancelled pilot for a gaming news show. The pilot was cancelled after test audiences reacted negatively.',
  scenario: '',
  mes_example: '',
  first_mes: '*Mario would be reading a book, before noticing you watching him.*\n"Oh!- Uh- Hey paisanos!"',
};
const promo = RP.parseCharacterCard(Object.assign({ __image: 'data:image/png;base64,AAAA' }, v1Card));
check('import: a flat v1 card (the format the examples use) reads in whole',
  promo.name === 'Promo Mario' && promo.description.includes('Nintendo Mania') &&
  promo.description.includes('test audiences'));
check('import: the card’s own picture becomes the portrait',
  promo.image === 'data:image/png;base64,AAAA');
check('import: the greeting is kept and offered as the opening line',
  RP.cardGreeting(promo).includes('paisanos') && RP.cardGreeting(promo) === promo.card.first_mes);

const running = RP.newRoom([sans], { title: 'Already going', date: '5 Aethel, 1040 BF' });
running.messages.push({ id: 'r1', role: 'user', text: 'I was here first.', at: 1 });
check('import: a character can walk into a chat that is already running', (() => {
  RP.addToRoom(running, promo);
  return running.cast.length === 2 && running.kind === 'group' && Boolean(running.states[promo.id]);
})());
check('import: adding the same person twice does nothing', RP.addToRoom(running, promo) === null && running.cast.length === 2);
const appended = RP.appendTranscript(running, RP.parseTranscript([
  'Promo Mario: The tape is still rolling.',
  'I look at the camera.',
  'Promo Mario: Do not look at the camera.',
].join('\n')), { divider: true, source: 'an old episode' });
check('import: the story is appended to the chat, not made into a new one',
  appended === 3 && running.messages.filter(m => RP.visible(m)).length === 4 &&
  running.messages[running.messages.length - 1].text.includes('Do not look'));
check('import: imported turns are matched to the cast and marked as imported',
  running.messages.filter(m => m.imported && m.role === 'char').every(m => m.charId === promo.id) &&
  running.messages.filter(m => m.imported && m.role === 'user').length === 1);
check('import: a divider says where the seam is',
  running.messages.some(m => m.role === 'scene' && /3 imported turns from an old episode/.test(m.text)));
check('import: the original turn is still first, so play reads in order',
  RP.historyFor(running, 10)[0].content.includes('I was here first'));

// ---------- the backlog the lore book has not read yet ----------
const backlog = RP.backlogFor(running, 3);
check('backlog: it counts what has not been filed, and what that costs',
  backlog.turns === 4 && backlog.filed === 0 && backlog.pending === 4 && backlog.calls === 1 && backlog.step === 3);
check('backlog: the jobs cover the chat in order, with one turn of overlap', (() => {
  const long = RP.newRoom([sans], {});
  for (let i = 0; i < 12; i++) long.messages.push({ id: 'm' + i, role: i % 2 ? 'char' : 'user', charId: 'sans', text: 'turn ' + i, at: i });
  const jobs = RP.backlogJobs(long, 3, 20);
  return jobs.length === 4 && jobs[0].from === 0 && jobs[1].from === 3 &&
    jobs[1].turns.length === 4 && jobs[3].to === 12;
})());
check('backlog: an already-filed chat asks for nothing', (() => {
  const filed = RP.newRoom([sans], {});
  for (let i = 0; i < 6; i++) filed.messages.push({ id: 'f' + i, role: 'user', text: 'x', at: i });
  filed.bookAt = 6;
  return RP.backlogFor(filed, 3).calls === 0 && RP.backlogJobs(filed, 3, 10).length === 0;
})());
check('backlog: the queue cap still applies to a huge import', (() => {
  const st = RP.blankState();
  const huge = RP.newRoom([sans], {});
  for (let i = 0; i < 90; i++) huge.messages.push({ id: 'h' + i, role: 'user', text: 'x', at: i });
  RP.backlogJobs(huge, 3, 40).forEach(job => RP.queuePush(st, { key: job.key, roomId: huge.id, turns: job.turns }));
  return RP.bookState(st).queue.length === RP.QUEUE_MAX;
})());

// ---------- one importer, every shape a file arrives in ----------
const v1Text = JSON.stringify(v1Card);
check('sniff: a flat v1 card is recognised', (() => {
  const found = RP.sniffImport(v1Text);
  return found.kind === 'card' && found.why.includes('v1') && found.card.name === 'Promo Mario';
})());
check('sniff: a v2 card is recognised', (() => {
  const found = RP.sniffImport(JSON.stringify(RP.toCharacterCard(promo, {})));
  return found.kind === 'card' && found.why.includes('v2');
})());
check('sniff: a byte-order mark does not make a card "invalid"',
  RP.sniffImport('\uFEFF' + v1Text).kind === 'card');
check('sniff: bytes work as well as text', (() => {
  const bytes = new TextEncoder().encode(v1Text);
  return RP.sniffImport(bytes).kind === 'card';
})());
check('sniff: a PNG card is read out of its chunk', (() => {
  const carded = RP.cardToPng(PNG_1PX, promo, {});
  const found = RP.sniffImport(carded);
  return found.kind === 'card' && found.why.includes('PNG');
})());
check('sniff: a plain PNG says so instead of failing vaguely', (() => {
  const found = RP.sniffImport(PNG_1PX);
  return found.kind === 'png-plain' && /no character card/.test(found.why);
})());
check('sniff: a JSONL chat log becomes turns', (() => {
  const found = RP.sniffImport([
    '{"user_name":"You","character_name":"Promo Mario","create_date":"2026-01-01"}',
    '{"name":"Promo Mario","is_user":false,"mes":"Hey paisanos!"}',
    '{"name":"You","is_user":true,"mes":"I stare at the screen."}',
  ].join('\n'));
  return found.kind === 'chatlog' && found.turns.length === 2 &&
    found.turns[0].who === 'Promo Mario' && found.turns[1].who === '';
})());
check('sniff: a JSON chat log in one document works too', (() => {
  const found = RP.sniffImport(JSON.stringify({
    messages: [{ name: 'Promo Mario', mes: 'Rolling.' }, { name: 'You', is_user: true, mes: 'I nod.' }],
  }));
  return found.kind === 'chatlog' && found.turns.length === 2;
})());
check('sniff: a chatroom bundle is recognised', (() => {
  const bundle = RP.chatExport(state, briefRoom);
  return RP.sniffImport(JSON.stringify(bundle)).kind === 'bundle';
})());
check('sniff: a transcript is recognised', RP.sniffImport('Sans: the saws stopped.\nI wait.').kind === 'transcript');
check('sniff: a truncated file is named as truncated, not "unsupported"', (() => {
  const found = RP.sniffImport('{"name":"Half a car');
  return found.kind === 'json-broken' && /does not parse/.test(found.why);
})());
check('sniff: JSON that is nothing we know says that plainly',
  RP.sniffImport('{"totally":"different"}').kind === 'json-unknown');
check('sniff: an empty file is not a mystery', RP.sniffImport('   ').kind === 'empty');

// ---- exporting a card that other tools will actually take ----
check('png card: re-exporting an imported card leaves exactly one chara chunk', (() => {
  const first = RP.cardToPng(PNG_1PX, promo, {});
  const again = RP.cardToPng(first, cardChar, {});
  const chunks = RP.pngText(again);
  return Object.keys(chunks).length === 1 && RP.cardFromPng(again).name === 'Sans';
})());
check('png card: the old card is gone, not buried behind the new one',
  RP.cardFromPng(RP.cardToPng(RP.cardToPng(PNG_1PX, promo, {}), cardChar, {})).name !== 'Promo Mario');
check('json card: every v2 field is present and typed, so a strict reader takes it', (() => {
  const data = RP.toCharacterCard(promo, {}).data;
  const strings = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
    'creator_notes', 'system_prompt', 'post_history_instructions', 'creator', 'character_version'];
  return strings.every(k => typeof data[k] === 'string') &&
    Array.isArray(data.alternate_greetings) && Array.isArray(data.tags) &&
    data.extensions && typeof data.extensions === 'object';
})());
check('json card: nothing is undefined, so JSON.stringify cannot drop a required field', (() => {
  const round = JSON.parse(JSON.stringify(RP.toCharacterCard(promo, {})));
  return Object.keys(round.data).length === Object.keys(RP.toCharacterCard(promo, {}).data).length;
})());

// ---------- 👍 / 👎 steer what comes next ----------
const tasteState = RP.blankState();
const tasteRoom = RP.newRoom([sans, cutters], {});
const kept = { id: 'k1', role: 'char', charId: 'sans', text: 'He says it in four words and leaves.', at: 1 };
const binned = { id: 'b1', role: 'char', charId: 'sans', text: 'A long, flowery paragraph that says the same thing five times over, with adjectives stacked upon adjectives, and no actual event in it anywhere at all.', at: 2 };
tasteRoom.messages.push(kept, binned);
check('taste: a rating is recorded on the message and kept as an excerpt', (() => {
  RP.rate(tasteState, tasteRoom, kept, 'up');
  RP.rate(tasteState, tasteRoom, binned, 'down');
  const t = RP.tasteState(tasteState);
  return kept.react === 'up' && binned.react === 'down' && t.likes.length === 1 && t.dislikes.length === 1 &&
    t.likes[0].text.includes('four words');
})());
check('taste: rating the same message again clears it',
  RP.rate(tasteState, tasteRoom, kept, 'up') === '' && RP.tasteState(tasteState).likes.length === 0);
check('taste: a thumb can be moved from one side to the other', (() => {
  RP.rate(tasteState, tasteRoom, kept, 'up');
  RP.rate(tasteState, tasteRoom, kept, 'down');
  const t = RP.tasteState(tasteState);
  return t.likes.length === 0 && t.dislikes.some(x => x.id === 'k1');
})());
check('taste: per-character counts are kept for the panel', (() => {
  const score = RP.tasteFor(tasteState, 'sans');
  return score.up >= 1 && score.down >= 1;
})());
RP.rate(tasteState, tasteRoom, kept, 'up');
const tasteText = RP.tasteBlock(tasteState, tasteRoom);
check('taste: the model is shown both piles, as instructions about its own writing',
  tasteText.includes('WHAT THIS READER KEEPS') && tasteText.includes('Write more like them') &&
  tasteText.includes('Do not write like this again') && tasteText.includes('four words'));
check('taste: the length signal is derived from what was kept',
  /run about \d+ words/.test(tasteText) && /do not pad/i.test(tasteText));
check('taste: it reaches the system prompt', RP.systemFor(tasteState, tasteRoom, sans).includes('WHAT THIS READER KEEPS'));
check('taste: an unrated reader gets no block at all', RP.tasteBlock(RP.blankState(), tasteRoom) === '');
check('taste: only the last ten of each side are kept', (() => {
  for (let i = 0; i < 20; i++) {
    RP.rate(tasteState, tasteRoom, { id: 'x' + i, role: 'char', charId: 'sans', text: 'turn ' + i }, 'up');
  }
  return RP.tasteState(tasteState).likes.length === RP.TASTE_KEEP;
})());
check('taste: it survives a save and travels in the bundle', (() => {
  RP.saveState(store, tasteState);
  const round = RP.loadState(store);
  const bundle = RP.exportBundle(tasteState, { chats: false, memory: false, user: false });
  const target = RP.blankState();
  RP.importBundle(target, bundle, 'merge');
  return RP.tasteState(round).likes.length > 0 && bundle.taste && RP.tasteState(target).likes.length > 0;
})());
check('taste: excerpts from the people in this room come first', (() => {
  const other = RP.newRoom([rebel], {});
  RP.rate(tasteState, other, { id: 'r1', role: 'char', charId: 'rebel_scout', text: 'A line from somebody else entirely.' }, 'up');
  const block = RP.tasteBlock(tasteState, other, 2);
  return block.includes('somebody else entirely');
})());

// ---------- editing what has already been said ----------
const editRoom = RP.newRoom([sans, cutters], {});
editRoom.messages.push(
  { id: 'e1', role: 'user', text: 'I say the first thing.', at: 1 },
  { id: 'e2', role: 'char', charId: 'sans', text: 'A reply I will regret.', at: 2, alts: ['A reply I will regret.', 'another take'], alt: 0 },
  { id: 'e3', role: 'char', charId: 'timber_gang', text: 'And a third.', at: 3 });
check('edit: a line can be rewritten, and the old takes go with it', (() => {
  RP.editMessage(editRoom, 'e2', 'A reply I stand behind.');
  const msg = RP.findMessage(editRoom, 'e2');
  return msg.text === 'A reply I stand behind.' && msg.alts.length === 1 && msg.edited > 0 &&
    RP.textOf(msg) === 'A reply I stand behind.';
})());
check('mute: a muted line stays on screen and leaves the model’s history', (() => {
  RP.muteMessage(editRoom, 'e2', true);
  const history = RP.historyFor(editRoom, 20);
  return RP.findMessage(editRoom, 'e2').muted === true &&
    editRoom.messages.length === 3 &&
    !history.some(m => /stand behind/.test(m.content)) &&
    history.some(m => /first thing/.test(m.content));
})());
check('mute: unmuting puts it back', (() => {
  RP.muteMessage(editRoom, 'e2', false);
  return RP.historyFor(editRoom, 20).some(m => /stand behind/.test(m.content));
})());
check('delete: one line at a time', RP.deleteMessage(editRoom, 'e3') === 1 && editRoom.messages.length === 2);
check('delete: a whole import can be taken back out', (() => {
  const undo = RP.newRoom([sans], {});
  undo.messages.push({ id: 'k', role: 'user', text: 'mine', at: 1 });
  RP.appendTranscript(undo, [{ who: 'Sans', text: 'imported one' }, { who: '', text: 'imported two' }], { divider: true });
  undo.bookAt = 3;
  const dropped = RP.deleteMessages(undo, m => m.imported);
  return dropped === 3 && undo.messages.length === 1 && undo.bookAt <= 1;
})());
check('context: a room can be told how far back the model may look', (() => {
  const long = RP.newRoom([sans], { contextLimit: 6 });
  for (let i = 0; i < 30; i++) long.messages.push({ id: 'c' + i, role: i % 2 ? 'char' : 'user', charId: 'sans', text: 'turn ' + i, at: i });
  return RP.contextLimit(long) === 6 && RP.contextLimit(RP.newRoom([sans], {}), 24) === 24 &&
    RP.historyFor(long, RP.contextLimit(long)).length === 6;
})());

// ---------- the smart budget ----------
const bigRoom = RP.newRoom([sans], {});
const bigTurns = [];
for (let i = 0; i < 300; i++) {
  bigTurns.push(i % 40 === 0
    ? { who: 'Sans', text: 'They named the place Ledger Row, signed the paper at 28 past, and burned the copy.' }
    : { who: i % 2 ? 'Sans' : '', text: 'A line of ordinary back and forth, number ' + i + '.' });
}
RP.appendTranscript(bigRoom, bigTurns, {});
check('smart: a 300-turn import is not 100 calls', (() => {
  const plan = RP.smartBacklog(bigRoom, { maxCalls: 6 });
  return plan.jobs.length === 6 && plan.chunk >= 20 && plan.covered > 100;
})());
check('smart: it always reads the end of the chat, because that is what play follows', (() => {
  const plan = RP.smartBacklog(bigRoom, { maxCalls: 4 });
  const last = plan.jobs[plan.jobs.length - 1];
  return last.from + last.turns.length >= 299;
})());
check('smart: the stretches it keeps are the ones that establish things', (() => {
  const plan = RP.smartBacklog(bigRoom, { maxCalls: 4 });
  const dense = plan.jobs.filter(job => job.turns.some(t => /Ledger Row/.test(t.text)));
  return dense.length >= 1;
})());
check('smart: the jobs come back in order, so the diary reads forwards', (() => {
  const plan = RP.smartBacklog(bigRoom, { maxCalls: 6 });
  return plan.jobs.every((job, i) => i === 0 || job.from > plan.jobs[i - 1].from);
})());
check('smart: a bigger budget covers everything', (() => {
  const plan = RP.smartBacklog(bigRoom, { maxCalls: 20 });
  return plan.skipped === 0 && plan.covered === plan.pending;
})());
check('smart: an already-filed chat plans nothing', (() => {
  bigRoom.bookAt = bigRoom.messages.filter(RP.visible).length;
  return RP.smartBacklog(bigRoom, { maxCalls: 6 }).jobs.length === 0;
})());

// ---------- how long a turn should be ----------
check('length: three bands, counted in sentences, and snappy is genuinely short',
  RP.LENGTHS.snappy.tokens < RP.LENGTHS.normal.tokens && RP.LENGTHS.normal.tokens < RP.LENGTHS.rich.tokens &&
  /2 to 4 SENTENCES/.test(RP.LENGTHS.snappy.dir) && /no scene-setting/i.test(RP.LENGTHS.snappy.dir) &&
  RP.LENGTHS.snappy.sentences[1] === 4 && RP.LENGTHS.rich.sentences[0] === 8);
check('length: the world gets one band more room than the characters', (() => {
  const forChar = RP.lengthBlock('snappy', false);
  const forWorld = RP.lengthBlock('snappy', true);
  return forChar.key === 'snappy' && forWorld.key === 'normal' && forWorld.tokens > forChar.tokens;
})());
check('length: rich does not overflow past the top band', RP.lengthBlock('rich', true).key === 'rich');
check('length: the instruction is in every character prompt — the scene decides by default, a pinned band is obeyed', (() => {
  const short = RP.blankState();
  const room = RP.newRoom([sans, cutters], {});
  const prompt = RP.systemFor(short, room, sans);
  short.settings.length = 'snappy';
  const pinned = RP.systemFor(short, room, sans);
  return prompt.includes('LENGTH') && prompt.includes('SIZE THE TURN TO THE MOMENT') && !prompt.includes('2 to 4 SENTENCES') &&
    pinned.includes('2 to 4 SENTENCES') && !pinned.includes('SIZE THE TURN');
})());
check('length: "let the scene decide" is a real band, the default, and the migration moves only the old default', (() => {
  const a = RP.LENGTHS.adaptive;
  const fresh = RP.blankState();
  const oldDefault = { settings: { length: 'snappy' } };
  const chosen = { settings: { length: 'rich' } };
  const unset = { settings: {} };
  return RP.DEFAULT_LENGTH === 'adaptive' && fresh.settings.length === 'adaptive' &&
    a.tokens >= RP.LENGTHS.normal.tokens && a.tokens <= RP.LENGTHS.rich.tokens && a.sentences[0] === 2 &&
    /2 or 3 SENTENCES/.test(a.dir) && /12 sentences/.test(a.dir) &&
    RP.lengthBlock('adaptive', false).key === 'adaptive' && RP.lengthBlock('adaptive', true).key === 'adaptive' &&
    RP.migrateLength(oldDefault) === true && oldDefault.settings.length === 'adaptive' &&
    RP.migrateLength(oldDefault) === false &&                      // once
    RP.migrateLength(chosen) === false && chosen.settings.length === 'rich' &&
    RP.migrateLength(unset) === true && unset.settings.length === 'adaptive';
})());
check('length: every band carries the move-the-scene rule, so short never means empty', (() => {
  return ['snappy', 'normal', 'rich', 'adaptive'].every(k => {
    const t = RP.lengthBlock(k, false).text;
    return /MOVE THE SCENE/.test(t) && /A quip, a shout or a reaction on its own is not a turn/.test(t);
  }) && RP.MOVE_RULE.length < 300;
})());
check('length: sentences are counted, so the page can tell when it overran',
  RP.sentenceCount('One. Two! Three? Four') === 4 && RP.sentenceCount('') === 0);
check('length: the cap is a safety net, not the thing that ends a turn', (() => {
  // Room for the whole band plus a wrap-up: ~14 sentences fits inside 1200.
  return RP.LENGTHS.rich.tokens >= 1000 && RP.LENGTHS.snappy.tokens >= 400;
})());

// ---------- the world takes a turn when nobody else can ----------
const soloState = RP.blankState();
const soloRoom = RP.newRoom([sans], { youPlay: 'sans', scene: 'The ridge road, after midnight.' });
check('player: starring a character takes them off the model’s list',
  RP.playerCharacter(soloRoom).id === 'sans' && RP.speakableCast(soloRoom).length === 0);
check('player: the star toggles back off', (() => {
  RP.markPlayer(soloRoom, 'sans');
  const off = RP.speakableCast(soloRoom).length === 1;
  RP.markPlayer(soloRoom, 'sans');
  return off && RP.speakableCast(soloRoom).length === 0;
})());
check('world: with nobody else in the room, the world speaks', RP.worldShouldSpeak(soloState, soloRoom) === true);
check('world: switching it off leaves the scene to the player',
  RP.worldShouldSpeak({ settings: { world: 'off' } }, soloRoom) === false);
check('world: a room with somebody else in it does not need narration', (() => {
  const two = RP.newRoom([sans, cutters], { youPlay: 'sans' });
  return RP.worldShouldSpeak(soloState, two) === false && RP.speakableCast(two).length === 1;
})());
const worldSystem = RP.worldSystem(soloState, soloRoom, {});
check('world: it is a camera, in the present tense, addressing you as you',
  /THE DIRECTOR|THE WORLD/.test(worldSystem) && /PRESENT TENSE/i.test(worldSystem) &&
  worldSystem.includes('address the player as "you"'));
check('world: it is forbidden from speaking for the player, by name',
  worldSystem.includes('Sans') && /Never write their speech, their thoughts or their decisions/.test(worldSystem));
check('world: it is told to leave something changed and not to ask what you do',
  /Something should be different by the end of the turn/.test(worldSystem) && /never ask/i.test(worldSystem));
check('world: it still gets the scene, the state sheets and the stage directions',
  worldSystem.includes('THE SCENE') && worldSystem.includes('CHARACTER STATE') && worldSystem.includes('STAGE DIRECTIONS'));
// The Director's band came down a notch on purpose: 1200-token world turns
// were five-minute generations on a local model (round 9).
check('world: and its own length band — the Director sizes to the moment too, unless a band is pinned', (() => {
  const pinned = RP.worldSystem(Object.assign({}, soloState, { settings: Object.assign({}, soloState.settings, { length: 'snappy' }) }), soloRoom, {});
  const terse = { settings: { length: 'adaptive', narrator: 'terse' } };
  return worldSystem.includes('LENGTH') && worldSystem.includes('SIZE THE TURN TO THE MOMENT') &&
    pinned.includes('4 to 7 SENTENCES') && RP.worldLength(terse) === 'snappy' &&
    RP.worldLength({ settings: { length: 'adaptive' } }) === 'adaptive' && RP.worldLength({ settings: { length: 'rich' } }) === 'normal';
})());
check('director: WORLD is an answer it may give', (() => {
  const group = RP.newRoom([sans, cutters, rebel], {});
  group.messages.push({ id: 'w1', role: 'user', text: 'I wait.', at: 1 });
  const prompt = RP.directorPrompt(group, sans);
  return prompt.includes('WORLD') && /the place itself doing something/.test(prompt) &&
    RP.parseDirector('WORLD', group, sans).next === 'world' &&
    RP.parseDirector('NEXT: WORLD', group, sans).next === 'world';
})());

// ---------- the sequencer ----------
const seqState = RP.blankState();
const seqRoom = RP.newRoom([sans, cutters, rebel], { youPlay: 'sans' });
seqRoom.messages.push({ id: 's1', role: 'user', text: 'I put the ledger on the table.', at: 1 });
const seqPrompt = RP.sequencePrompt(seqRoom, seqState, {});
check('sequencer: it asks for an order, not a single name',
  /ORDER: Name, Name/.test(seqPrompt) && /NOBODY/.test(seqPrompt) && /at most \d/.test(seqPrompt));
check('sequencer: the character you play is never staged',
  seqPrompt.includes('Never put them in the order') && !/- Sans/.test(seqPrompt));
check('sequencer: silence is offered as a real answer',
  /Silence is a choice/.test(seqPrompt) && /only people who have a REASON/.test(seqPrompt));
check('sequencer: an order parses into ids, in order, without repeats', (() => {
  const got = RP.parseSequence('ORDER: The Timber Gang, The Rebel Scout, The Timber Gang', seqRoom, seqState);
  return got.order.join(',') === 'timber_gang,rebel_scout';
})());
check('sequencer: the world can be staged too',
  RP.parseSequence('ORDER: The Timber Gang, WORLD', seqRoom, seqState).order.join(',') === 'timber_gang,world');
check('sequencer: with the world off it is dropped from the order',
  RP.parseSequence('ORDER: WORLD, The Timber Gang', seqRoom, { settings: { world: 'off' } }).order.join(',') === 'timber_gang');
check('sequencer: NOBODY means nobody, and says so', (() => {
  const got = RP.parseSequence('NOBODY', seqRoom, seqState);
  return got.order.length === 0 && got.silent === true;
})());
check('sequencer: a rambling answer is not mistaken for silence', (() => {
  const got = RP.parseSequence('Well, I think perhaps the timber gang might want to respond here.', seqRoom, seqState);
  return got.order.length === 0 && got.unparsed === true;
})());
check('sequencer: it never stages more than the cap',
  RP.parseSequence('ORDER: The Timber Gang, The Rebel Scout, WORLD, The Timber Gang, The Rebel Scout', seqRoom, seqState)
    .order.length <= RP.SEQUENCE_MAX);

// ---------- branching and undo ----------
const forkState = RP.blankState();
const original = RP.newRoom([sans], { title: 'The original' });
original.messages.push(
  { id: 'f1', role: 'user', text: 'one', at: 1 },
  { id: 'f2', role: 'char', charId: 'sans', text: 'two', at: 2 },
  { id: 'f3', role: 'user', text: 'three', at: 3 });
forkState.rooms = [original];
const branch = RP.forkRoom(forkState, original, 'f2', {});
check('branch: a fork keeps everything up to that line and nothing after',
  branch.messages.length === 2 && branch.messages.map(m => m.text).join(',') === 'one,two');
check('branch: the original is untouched, and the fork is a separate chat',
  original.messages.length === 3 && branch.id !== original.id && branch.branchOf === original.id &&
  forkState.rooms.length === 2 && forkState.rooms[0].id === branch.id);
check('branch: the copy is deep — editing it does not touch the original', (() => {
  RP.editMessage(branch, branch.messages[1].id, 'changed in the branch');
  return original.messages[1].text === 'two';
})());
check('undo: a snapshot rolls the chat back, and redo puts it forward again', (() => {
  const room = RP.newRoom([sans], {});
  room.messages.push({ id: 'u1', role: 'user', text: 'first', at: 1 });
  RP.pushUndo(room, 'the second line');
  room.messages.push({ id: 'u2', role: 'char', charId: 'sans', text: 'second', at: 2 });
  const undone = RP.undo(room);
  const rolledBack = room.messages.length === 1;
  const redone = RP.redo(room);
  return undone === 'the second line' && rolledBack && redone && room.messages.length === 2;
})());
check('undo: it restores the state sheets too, not just the words', (() => {
  const room = RP.newRoom([sans], {});
  room.states.sans.hp.value = 100;
  RP.pushUndo(room, 'the wound');
  room.states.sans.hp.value = 20;
  RP.undo(room);
  return room.states.sans.hp.value === 100;
})());
check('undo: the stack has a floor and a ceiling', (() => {
  const room = RP.newRoom([sans], {});
  for (let i = 0; i < 40; i++) RP.pushUndo(room, 'x' + i);
  return room.undo.length === RP.UNDO_DEPTH && RP.undo(RP.newRoom([sans], {})) === null;
})());

// ---------- the player's own persona ----------
const meState = RP.blankState();
const me = RP.personaSheet(meState);
me.name = 'Mikha the Unfiled';
me.voice = 'a courier who reads the post';
me.look = 'tall, sunburnt, one boot newer than the other';
me.items = ['a satchel', 'somebody else’s key'];
check('persona: one sheet, and it reaches the prompt', (() => {
  const block = RP.personaBlock('', meState, RP.newRoom([sans], {}));
  return block.includes('THE USER PLAYS') && block.includes('Mikha the Unfiled') &&
    block.includes('one boot newer') && block.includes('somebody else’s key');
})());
check('persona: starring an archive character says so, without losing you', (() => {
  const room = RP.newRoom([sans], { youPlay: 'sans' });
  const block = RP.personaBlock('', meState, room);
  return block.includes('Mikha the Unfiled') && block.includes('they ARE Sans') && block.includes('Call them Sans');
})());
check('persona: it survives a save and comes back', (() => {
  RP.saveState(store, meState);
  return RP.personaSheet(RP.loadState(store)).name === 'Mikha the Unfiled';
})());

// ---------- keyword-triggered lore ----------
const keyState = RP.blankState();
RP.addKeyword(keyState, { keys: 'Master Sword, blade of evil', text: 'Filed as lost in 1012 BF, never as broken.' });
RP.addKeyword(keyState, { keys: '/dark shores?/i', text: 'A province, not a beach: Darian rules it and calls himself king.' });
RP.addKeyword(keyState, { always: true, text: 'The archive never uses real-world dates.' });
check('keyword: a plain word triggers on a whole-word match',
  RP.keywordBlock(keyState, 'he asked about the Master Sword again').includes('never as broken'));
check('keyword: it does not fire on a fragment',
  !RP.keywordBlock(keyState, 'he mastered swordsmanship').includes('never as broken'));
check('keyword: a regular expression trigger works',
  RP.keywordBlock(keyState, 'we sailed for the Dark Shore').includes('A province, not a beach'));
check('keyword: an always-on entry is always there',
  RP.keywordBlock(keyState, 'nothing in particular').includes('never uses real-world dates'));
check('keyword: the block tells the model to use it exactly',
  /use these exactly, do not invent around them/.test(RP.keywordBlock(keyState, 'Master Sword')));
check('keyword: it reaches the system prompt', (() => {
  const room = RP.newRoom([sans], {});
  return RP.systemFor(keyState, room, sans, { recent: 'about the Master Sword' }).includes('never as broken');
})());
check('keyword: entries can be removed, and survive a save', (() => {
  RP.saveState(store, keyState);
  const round = RP.loadState(store);
  const first = round.keywords[0].id;
  RP.removeKeyword(round, first);
  return round.keywords.length === 2 && !round.keywords.some(k => k.id === first);
})());

// ---------- nothing is cut off mid-word, and nothing stalls ----------
check('clip: a word is never left half-written', (() => {
  // The kept text must end exactly where a word ends in the original.
  const source = 'supercalifragilistic expialidocious antidisestablishmentarianism';
  const cut = RP.clip(source, 30).replace(/…$/, '');
  const after = source.charAt(cut.length);
  return cut.length > 0 && source.indexOf(cut) === 0 && (after === '' || after === ' ');
})());
check('clip: it prefers the last sentence that fits',
  RP.clip('One sentence here. A second that would overflow the limit and then some.', 60) ===
  'One sentence here. A second that would overflow the limit…');
check('clip: short text is returned untouched, with no mark',
  RP.clip('short enough', 50) === 'short enough' && !/…/.test(RP.clip('short enough', 50)));
check('clip: a trailing comma or dash is not left dangling before the mark',
  !/[,;:—-]…$/.test(RP.clip('a long clause, and then another clause that runs past the limit', 30)));
check('fields: a filed status is not amputated at 120 characters', (() => {
  const long = 'Active — escaped the break room through the ceiling, said the word that stopped the show, and is now the only witness who has seen the Director’s remote';
  const char = RP.normChar({ id: 'd', name: 'Darian', status: long });
  return char.status === long && char.status.includes('Director’s remote');
})());
check('fields: descriptions and summaries have room too', (() => {
  const body = 'A sentence about somebody. '.repeat(40);
  const char = RP.normChar({ id: 'x', name: 'X', description: body, summary: body });
  return char.description.length > 900 && char.summary.length > 320;
})());
check('fallback: when nobody has to answer, the world picks it up', (() => {
  const room = RP.newRoom([sans, cutters], {});
  return RP.fallbackTurn(RP.blankState(), room) === 'world';
})());
check('fallback: with the world switched off, the turn comes back to you',
  RP.fallbackTurn({ settings: { world: 'off' } }, RP.newRoom([sans], {})) === '');
check('world: it is told to play the player’s line out, not dodge it', (() => {
  const prompt = RP.worldPrompt(RP.blankState(), RP.newRoom([sans], { youPlay: 'sans' }), {});
  return /DO THE THING THEY DID/.test(prompt) && /Never replace their action with weather/.test(prompt) &&
    /invent and show what it actually says/.test(prompt);
})());

// ---------- the narrator: the Director, and no repeating itself ----------
const dirState = RP.blankState();
const dirRoom = RP.newRoom([sans], { youPlay: 'sans', scene: 'The patio, after midnight.' });
dirRoom.messages.push(
  { id: 'n1', role: 'user', text: 'I look down at my sheets and read them aloud. What am I wearing, and where am I?', at: 1 },
  { id: 'n2', role: 'world', text: 'The air is thin and biting. You stand on the stone patio of an isolated outpost, wrapped in a fur-lined cloak.', at: 2 });
check('narrator: the Director is the default voice',
  RP.narrator(dirState) === 'director' && RP.NARRATORS.director.name === 'The Director');
check('narrator: four voices, each with its own length band',
  Object.keys(RP.NARRATORS).length === 4 && RP.NARRATORS.director.length === 'normal' &&
  RP.NARRATORS.terse.length === 'snappy');
const dirPrompt = RP.worldSystem(dirState, dirRoom, {});
check('director: the cinematic brief is in the prompt, without film words',
  dirPrompt.includes('THE DIRECTOR') && /no "cut to"/.test(dirPrompt) &&
  /SENSORY FOCUS/.test(dirPrompt) && /DRAMATIC IRONY/.test(dirPrompt));
check('director: it must resolve what the player actually did',
  /DO THE THING THEY DID/.test(dirPrompt) &&
  /invent and show what it actually says/.test(dirPrompt) &&
  /Never replace their action with weather/.test(dirPrompt));
check('director: it may make it go wrong, but not skip it',
  /may make it cost them, go wrong/.test(dirPrompt) && /may not skip it/.test(dirPrompt));
check('continuity: what was already described is named and forbidden',
  /ALREADY DESCRIBED/.test(dirPrompt) && dirPrompt.includes('isolated outpost') &&
  /do not re-dress the player/.test(dirPrompt));
check('continuity: the questions the player asked are answered once',
  /THE PLAYER ASKED THESE DIRECTLY/.test(dirPrompt) && /What am I wearing/i.test(dirPrompt));
check('narration: it is in the history now, labelled, so it cannot repeat itself', (() => {
  const history = RP.historyFor(dirRoom, 10);
  return history.length === 2 && /^Narration: /.test(history[1].content);
})());
check('narration: it counts as a played turn', RP.counter(dirRoom) === 2);
check('narrator: the terse voice is two sentences, the Director gets room', (() => {
  const terse = { settings: { narrator: 'terse' } };
  const pinnedDir = RP.worldSystem({ settings: { length: 'snappy' } }, dirRoom, {});
  return /Two sentences at most/.test(RP.worldPrompt(terse, dirRoom, {})) &&
    /SIZE THE TURN TO THE MOMENT/.test(dirPrompt) && /4 to 7 SENTENCES/.test(pinnedDir);
})());
check('narrator: an unknown voice falls back to the Director',
  RP.narrator({ settings: { narrator: 'nonsense' } }) === 'director');

// ---------- fixed facts, stray directives, and a script that knows to stop ----
const factRoom = RP.newRoom([sans], { youPlay: 'sans' });
const strayed = RP.parseDirectives(
  'The wind drops out of the courtyard.\n' +
  '[[TIME: a little after midnight]]\n' +
  '[[SET: place = the stone patio of the outpost]]\n' +
  '[[SET: wearing = a heavy fur-lined travelling cloak]]\n' +
  '[[MOOD: ominous]]\n' +
  '[[whatever this is]]', []);
check('directives: a model’s invented brackets never reach the reader',
  strayed.clean === 'The wind drops out of the courtyard.' &&
  !/\[\[/.test(strayed.clean));
check('directives: TIME and SET are real, MOOD is discarded',
  strayed.directives.map(d => d.kind).join(',') === 'time,set,set');
const factLines = RP.applyDirectives(RP.blankState(), factRoom, strayed.directives, () => null).lines;
check('facts: the place, the clothes and the clock are filed on the room',
  factRoom.clock === 'a little after midnight' &&
  factRoom.facts.place === 'the stone patio of the outpost' &&
  factRoom.facts.wearing.includes('fur-lined') && factLines.length === 3);
const fixed = RP.factsBlock(factRoom);
check('facts: they go back to the model as unrevisable',
  /FIXED FACTS/.test(fixed) && /NOT open to revision/.test(fixed) &&
  fixed.includes('stone patio') && fixed.includes('fur-lined') && fixed.includes('after midnight'));
check('facts: the narrator is told to file what it names', (() => {
  const prompt = RP.worldPrompt(RP.blankState(), factRoom, {});
  return /FILE WHAT YOU NAME/.test(prompt) && /\[\[SET: place =/.test(prompt) &&
    /Never write any other double-bracketed text/.test(prompt);
})());
check('facts: a character turn sees them too',
  RP.systemFor(RP.blankState(), factRoom, sans).includes('FIXED FACTS'));
check('facts: changing one is reported as a change, not a silent rename', (() => {
  const again = RP.parseDirectives('[[SET: place = the balcony of the Star Hill clinic]]', []);
  const lines = RP.applyDirectives(RP.blankState(), factRoom, again.directives, () => null).lines;
  return /place is now/.test(lines[0]) && factRoom.facts.place.includes('Star Hill');
})());

check('script: a jump in time is recognised', (() => {
  return RP.isTimeJump('3 days later I stand outside looking at the stars') &&
    RP.isTimeJump('Later that night, I go back down') &&
    RP.isTimeJump('The next morning I check the table') &&
    !RP.isTimeJump('I look down at my sheets and read them aloud');
})());
check('script: a paused script fires nothing', (() => {
  const scripted = RP.newRoom([sans], { beats: [
    { time: 'one', beat: 'The first beat' }, { time: 'two', beat: 'The second beat' },
  ] });
  scripted.beatsPaused = true;
  return RP.fireBeat(scripted) === null && scripted.beatIndex === 0;
})());
check('script: un-pausing lets it carry on where it was', (() => {
  const scripted = RP.newRoom([sans], { beats: [{ time: 'one', beat: 'The first beat' }] });
  scripted.beatsPaused = true;
  RP.fireBeat(scripted);
  scripted.beatsPaused = false;
  return Boolean(RP.fireBeat(scripted)) && scripted.beatIndex === 1;
})());

// ---------- a turn finishes its sentence ----------
check('truncation: a reply that stops mid-sentence is spotted',
  RP.looksTruncated('your voice a low rasp that barely carries: "The patterns are') &&
  RP.looksTruncated('He turns, and then,') &&
  RP.looksTruncated('the shape of it was the'));
check('truncation: a finished reply is left alone',
  !RP.looksTruncated('He stops. The wind drops.') &&
  !RP.looksTruncated('She said, "stop."') &&
  !RP.looksTruncated('*He shrugs.*'));
check('truncation: an open quote counts as unfinished even with punctuation at the end',
  RP.looksTruncated('He read it out: "The patterns are wrong.'));
check('stitch: the continuation is joined without repeating the seam', (() => {
  const head = 'your voice a low rasp: "The patterns are';
  const joined = RP.stitch(head, '"The patterns are wrong," you say.');
  return joined.endsWith('wrong," you say.') && (joined.match(/The patterns are/g) || []).length === 1;
})());
check('stitch: an empty continuation changes nothing',
  RP.stitch('A finished line.', '') === 'A finished line.');
check('nudge: the model is told where it stopped and not to start again', (() => {
  const nudge = RP.continueNudge('…and the door is');
  return /cut off at/.test(nudge) && /do not repeat a word of it/.test(nudge) && /bring it to a proper stop/.test(nudge);
})());
check('trim: as a last resort it cuts back to the last full stop',
  RP.trimDangling('He crossed the yard. He put his hand on the latch and then the') === 'He crossed the yard.');
check('length: every band demands a whole last sentence, and has room for one', (() => {
  const band = RP.lengthBlock('rich', false);
  return /THE LAST SENTENCE MUST BE A WHOLE SENTENCE/.test(band.text) &&
    /better to write one sentence fewer and land it/.test(band.text) &&
    band.tokens >= 1000 && RP.lengthBlock('snappy').tokens >= 400;
})());

// ---------- privacy, presence, and talking to the model directly ----------
const quietRoom = RP.newRoom([sans, cutters, rebel], { youPlay: 'sans' });
check('privacy: a quiet turn reads as private, a loud one does not',
  RP.privacyHint('I do not look up, I just read to myself') === 'private' &&
  RP.privacyHint('I mutter it under my breath') === 'private' &&
  RP.privacyHint('I turn to Wario and shout') === 'open' &&
  RP.privacyHint('I walk over to the table') === '');
check('privacy: the room can be pinned either way, and the pin wins',
  RP.isPrivate({ privacy: 'private' }, 'I shout across the yard') === true &&
  RP.isPrivate({ privacy: 'open' }, 'I whisper to myself') === false &&
  RP.isPrivate({}, 'I whisper to myself') === true);
check('sequencer: it is told to read the room and not to import a crowd', (() => {
  quietRoom.messages.push({ id: 'q1', role: 'user', text: 'I read the page to myself.', at: 1 });
  const prompt = RP.sequencePrompt(quietRoom, RP.blankState(), {});
  return /READ THE ROOM/.test(prompt) && /A private moment is not an invitation/.test(prompt) &&
    /nobody walks in from off-stage/.test(prompt) &&
    /This turn reads as private/.test(prompt);
})());

check('presence: somebody written out of the scene cannot be staged', (() => {
  RP.ensureSheets(quietRoom);
  RP.setPresent(quietRoom, 'timber_gang', false);
  return RP.presentCast(quietRoom).length === 2 &&
    !RP.speakableCast(quietRoom).some(c => c.id === 'timber_gang') &&
    RP.speakableCast(quietRoom).length === 1;
})());
check('presence: and can be brought back', (() => {
  RP.setPresent(quietRoom, 'timber_gang', true);
  return RP.speakableCast(quietRoom).length === 2;
})());
check('presence: the character you play is never staged either',
  !RP.speakableCast(quietRoom).some(c => c.id === 'sans'));

check('ooc: ((brackets)), /ooc and [[OOC:]] are pulled out of the prose', (() => {
  const got = RP.parseOoc('I keep reading. ((no new characters)) \n/ooc keep it short\n[[OOC: Luigi is lying]]');
  return got.clean === 'I keep reading.' && got.notes.length === 3 &&
    got.notes[0] === 'no new characters' && got.notes[2] === 'Luigi is lying';
})());
check('ooc: a turn with no brackets is left exactly as written',
  RP.parseOoc('I read the page aloud.').clean === 'I read the page aloud.' &&
  RP.parseOoc('I read the page aloud.').notes.length === 0);
check('ooc: instructions outrank the prompt and are never spoken', (() => {
  const block = RP.oocBlock({ settings: { note: 'never kill anybody off-screen' } },
    { note: 'this scene is a funeral' }, ['no new characters']);
  return /these outrank everything else/.test(block) && /nobody in the scene hears them/.test(block) &&
    block.includes('never kill anybody off-screen') && block.includes('funeral') &&
    block.includes('no new characters');
})());
check('ooc: with nothing said, nothing is added', RP.oocBlock(RP.blankState(), {}, []) === '');
check('ooc: it reaches both the character prompt and the narrator', (() => {
  const st = RP.blankState();
  const room = RP.newRoom([sans], { note: 'keep this private' });
  return RP.systemFor(st, room, sans, { notes: ['short please'] }).includes('keep this private') &&
    RP.worldSystem(st, room, { notes: ['short please'] }).includes('short please');
})());

// ---------- the session knows what it is ----------
const filedArchive = { events: [{
  id: 'the_cut', name: 'The Cut and the Puppet Master',
  date: '5 Aethel, 1040 BF', location: 'The Nintendo Mania studio',
  summary: 'The exits lie, the applause is recorded, and one word stops the whole production.',
  outcome: 'The escape became a raid on the show itself.',
  aftermath: '**The show has a director.** He outranks everyone in the building.',
  participants: [{ id: 'sans', name: 'Sans', role: 'said the word that stopped it' },
                 { id: 'timber_gang', name: 'The Timber Gang', role: 'crewed the set' }],
  timeline: { entries: [
    { time: 'late morning', beat: 'Fire, and the alarm', detail: 'The actor erupts and the alarm is on the far wall.' },
    { time: 'noon', beat: 'CUT', detail: 'One production command stops everything.' }] },
}] };
const filedRoom = RP.newRoom([sans, cutters], { sourceId: 'the_cut', sourceKind: 'scene', scene: 'The studio.' });
const sessionDossier = RP.sourceBlock(filedRoom, filedArchive);
check('session: the filing behind the scene is handed over whole',
  /WHAT THIS SESSION IS/.test(sessionDossier) && sessionDossier.includes('The Cut and the Puppet Master') &&
  sessionDossier.includes('5 Aethel, 1040 BF') && sessionDossier.includes('Nintendo Mania studio'));
check('session: what happened, how it ended and what it left behind',
  /What happened:/.test(sessionDossier) && /How it ended:/.test(sessionDossier) &&
  /What it left behind:/.test(sessionDossier) && sessionDossier.includes('outranks everyone'));
check('session: who was in it, with their filed roles, and how it ran',
  /Who was in it:/.test(sessionDossier) && sessionDossier.includes('said the word that stopped it') &&
  /How it ran:/.test(sessionDossier) && sessionDossier.includes('Fire, and the alarm'));
check('session: the cast is told to use it and not contradict it',
  /use the names, the/.test(sessionDossier) && /never contradict them/.test(sessionDossier));
check('session: it reaches both the character prompt and the narrator',
  RP.systemFor(RP.blankState(), filedRoom, sans, { archive: filedArchive }).includes('WHAT THIS SESSION IS') &&
  RP.worldSystem(RP.blankState(), filedRoom, { archive: filedArchive }).includes('WHAT THIS SESSION IS'));
check('session: a chat with no filing behind it adds nothing',
  RP.sourceBlock(RP.newRoom([sans], {}), filedArchive) === '');
check('session: the record is found by name as well as by id',
  RP.sourceBlock(RP.newRoom([sans], { sourceId: 'The Cut and the Puppet Master' }), filedArchive).length > 100);

// ---------- the right mouth, and never an empty card ----------
check('attribution: a reply that is plainly somebody else’s is caught', (() => {
  const check1 = RP.checkSpeaker('Wario growls, "Stop reading that out loud."', { id: 'mona', name: 'Mona' },
    [{ id: 'mona', name: 'Mona' }, { id: 'wario', name: 'Wario' }]);
  return !check1.ok && check1.actual.id === 'wario';
})());
check('attribution: the speaker’s own line passes',
  RP.checkSpeaker('Mona sets the equipment down and does not look up.', { id: 'mona', name: 'Mona' },
    [{ id: 'mona', name: 'Mona' }, { id: 'wario', name: 'Wario' }]).ok === true);
check('attribution: a scene with both of them in it is not a misattribution',
  RP.checkSpeaker('Mona watches as Wario slams the table.', { id: 'mona', name: 'Mona' },
    [{ id: 'mona', name: 'Mona' }, { id: 'wario', name: 'Wario' }]).ok === true);
check('attribution: an empty reply is flagged rather than filed',
  RP.checkSpeaker('   ', { id: 'mona', name: 'Mona' }, []).empty === true);
check('attribution: the group prompt insists the turn opens on the speaker', (() => {
  const prompt = RP.groupPrompt([sans, cutters], sans, {});
  return prompt.includes('START WITH ' + sans.name.toUpperCase()) &&
    /must be Sans doing or saying something/.test(prompt) &&
    /do not write another character/.test(prompt);
})());

// ---------- search: the model can look things up ----------
const searchIndex = RP.buildIndex({
  events: [{
    id: 'the_iron_mandate', name: 'The Iron Mandate', date: '21 Highsun, 1040 BF',
    summary: 'Emergency legislation passed by the Midlands Diet.',
    description: 'The chamber sat at nine in the morning. The gallery had been cleared an hour before, ' +
      'which the minutes do not explain. The division was recorded as twenty-eight for, eight against and three ' +
      'abstaining, and the three abstentions have never been printed. Speaker Rivers resigned on the spot. ' +
      'Afterwards the Legion moved on the northern parishes without waiting for the ink to dry.',
    outcome: 'The Legion got its powers.',
  }, {
    id: 'the_ridge', name: 'The Logging Road Ambush', date: '9 Aethel, 1040 BF',
    summary: 'Rebels came out of the treeline and the saws stopped.',
    description: 'Two crews were working the top of the road in the dark because the concession pays by the trunk.',
  }],
  factions: [], whatifs: [], posts: [],
}, {});
check('search: terms are picked out and the noise is dropped', (() => {
  const terms = RP.searchTerms('What does the record say about the Iron Mandate vote?');
  return terms.includes('record') && terms.includes('iron') && terms.includes('mandate') &&
    !terms.includes('what') && !terms.includes('the');
})());
check('search: the index carries enough prose to quote from',
  searchIndex[0].body.includes('twenty-eight for') && searchIndex[0].words.length > 200);
const searched = RP.searchArchive(searchIndex, 'how did the Iron Mandate vote go', { limit: 3 });
check('search: the right filing comes first', searched.length && searched[0].id === 'the_iron_mandate');
check('search: it returns the passage that matched, not the whole filing', (() => {
  const hit = searched[0];
  return hit.snippet.includes('twenty-eight for') && hit.snippet.length < 400 &&
    !hit.snippet.includes('pays by the trunk');
})());
check('search: a query with nothing behind it finds nothing',
  RP.searchArchive(searchIndex, 'zzzz qqqq', { limit: 3 }).length === 0);
check('search: the block quotes with ids, and forbids inventing around it', (() => {
  const block = RP.retrievalBlock(searched, 'the Iron Mandate vote');
  return /FROM THE ARCHIVE/.test(block) && block.includes('[event:the_iron_mandate]') &&
    /do not invent/.test(block) && block.includes('twenty-eight for');
})());
check('search: an empty result says so rather than leaving a gap',
  /has nothing/i.test(RP.retrievalBlock([], 'a thing that is not filed')) &&
  /rather than inventing a filing/.test(RP.retrievalBlock([], 'x')));

check('lookup: the model can ask, and file what it learns', (() => {
  const parsed = RP.parseDirectives('He checks the ledger.\n[[LOOKUP: the Iron Mandate vote]]\n' +
    '[[REMEMBER: The three abstentions | Never printed, in any edition.]]', []);
  return parsed.clean === 'He checks the ledger.' &&
    parsed.directives[0].kind === 'lookup' && parsed.directives[0].query === 'the Iron Mandate vote' &&
    parsed.directives[1].kind === 'remember' && parsed.directives[1].name === 'The three abstentions';
})());
check('lookup: REMEMBER writes straight into the lore book', (() => {
  const st = RP.blankState();
  const room = RP.newRoom([sans], {});
  RP.applyDirectives(st, room, RP.parseDirectives('[[REMEMBER: The gallery | Cleared an hour before the vote.]]', []).directives, () => null);
  const pages = RP.bookState(st).entries;
  return pages.length === 1 && pages[0].name === 'The gallery' && pages[0].text.includes('Cleared an hour');
})());
check('lookup: the stage directions tell the model the tool exists',
  /\[\[LOOKUP: what you want to know\]\]/.test(RP.DIRECTIVES) &&
  /instead of inventing one/.test(RP.DIRECTIVES) &&
  /\[\[REMEMBER: name \| the fact\]\]/.test(RP.DIRECTIVES));

// ---------- the audit, and not reading tomorrow's filing ----------
const auditArchive = { events: [
  { id: 'the_tape', name: 'The Tape and the Wario Files', date: '20 Harvestide, 1035 BF',
    summary: 'The tape, the files, and the argument in the kitchen.',
    description: 'Wario keeps the files in a crate under the sink and calls them a ledger.' },
  { id: 'later_on', name: 'The Darkmoon Reckoning', date: '30 Darkmoon, 1040 BF',
    summary: 'What the files cost, five years on.',
    description: 'The ledger is read out in public and three people leave the room.' },
] };
const auditIndex = RP.buildIndex(auditArchive, {});
check('search: a filing dated after the scene is never returned', (() => {
  const scene = RP.parseWahDate('20 Harvestide, 1035 BF');
  const hits = RP.searchArchive(auditIndex, 'the ledger and the files', { limit: 5, scene: scene });
  return hits.length > 0 && hits.every(h => h.id !== 'later_on') && hits.some(h => h.id === 'the_tape');
})());
check('search: without a scene date, everything is fair game',
  RP.searchArchive(auditIndex, 'the ledger', { limit: 5 }).length === 2);
check('date: a scene played out of a filing takes that filing’s date', (() => {
  const room = RP.newRoom([sans], { sourceId: 'the_tape' });
  return RP.formatWahDate(RP.sceneDate(room, RP.blankState(), auditArchive)) === '20 Harvestide, 1035 BF';
})());
check('audit: it catches a scene dated wrong against its filing', (() => {
  const room = RP.newRoom([sans], { sourceId: 'the_tape', date: '5 Aethel, 1040 BF' });
  const report = RP.auditRoom(RP.blankState(), room, auditArchive);
  return !report.ok && report.dates.length === 1 && report.dates[0].should === '20 Harvestide, 1035 BF';
})());
check('audit: it catches somebody who has not spoken in a long while', (() => {
  const room = RP.newRoom([sans, cutters, rebel], { youPlay: 'sans' });
  for (let i = 0; i < 10; i++) {
    room.messages.push({ id: 'a' + i, role: i % 2 ? 'char' : 'user', charId: 'timber_gang', text: 'turn ' + i, at: i });
  }
  const report = RP.auditRoom(RP.blankState(), room, {});
  return report.quiet.length === 1 && report.quiet[0].id === 'rebel_scout';
})());
check('audit: somebody being talked about is not written out', (() => {
  const room = RP.newRoom([sans, cutters, rebel], { youPlay: 'sans' });
  for (let i = 0; i < 10; i++) {
    room.messages.push({ id: 'b' + i, role: 'user', text: 'I ask about The Rebel Scout again.', at: i });
  }
  return RP.auditRoom(RP.blankState(), room, {}).quiet.length === 1;   // only the timber gang
})());
check('audit: it catches a page filed after the scene', (() => {
  const st = RP.blankState();
  const room = RP.newRoom([sans], { sourceId: 'the_tape', date: '20 Harvestide, 1035 BF' });
  RP.bookAdd(st, { kind: 'fact', name: 'A later note', text: 'x', when: '30 Darkmoon, 1040 BF', roomId: room.id });
  const report = RP.auditRoom(st, room, auditArchive);
  return report.book.length === 1 && report.book[0].name === 'A later note';
})());
check('audit: fixing it dates the scene, writes the silent out and re-stamps the page', (() => {
  const st = RP.blankState();
  const room = RP.newRoom([sans, rebel], { sourceId: 'the_tape', date: '5 Aethel, 1040 BF', youPlay: 'sans' });
  for (let i = 0; i < 10; i++) room.messages.push({ id: 'c' + i, role: 'user', text: 'turn', at: i });
  RP.bookAdd(st, { kind: 'fact', name: 'A later note', text: 'x', when: '30 Darkmoon, 1040 BF', roomId: room.id });
  const report = RP.auditRoom(st, room, auditArchive);
  const done = RP.applyAudit(st, room, report, {});
  return room.date === '20 Harvestide, 1035 BF' &&
    room.states.rebel_scout.present === false &&
    RP.bookState(st).entries[0].when === '20 Harvestide, 1035 BF' && done.length === 3;
})());
check('attribution: writing the player’s own character is refused, not re-filed', (() => {
  const room = RP.newRoom([sans, cutters], { youPlay: 'sans' });
  const got = RP.checkSpeaker('Sans leans back and says nothing.', cutters, room.cast, { youPlay: 'sans' });
  return !got.ok && got.playerVoice === true && got.actual.id === 'sans';
})());
check('attribution: another character’s line is still just re-filed', (() => {
  const room = RP.newRoom([sans, cutters, rebel], { youPlay: 'sans' });
  const got = RP.checkSpeaker('The Timber Gang spits and turns away.', rebel, room.cast, { youPlay: 'sans' });
  return !got.ok && !got.playerVoice && got.actual.id === 'timber_gang';
})());

// ---------- the lore book keeps itself trim ----------
check('book: duplicate pages merge and thin ones are dropped', (() => {
  const st = RP.blankState();
  RP.bookAdd(st, { kind: 'place', name: 'The porch', text: 'Crumbling pillars, facing the timber.' });
  RP.bookAdd(st, { kind: 'fact', name: 'It is cold', text: 'It is cold.' });
  RP.bookAdd(st, { kind: 'diary', name: '', text: 'A day of reading and arguing.', when: '5 Aethel, 1040 BF' });
  const b = RP.bookState(st);
  b.entries.push({ id: 'dup', kind: 'place', name: 'The porch', text: 'Where Wario leans.', at: Date.now(), seen: 1, chars: [] });
  const tidied = RP.tidyBook(st, {});
  return tidied.merged === 1 && tidied.dropped === 1 &&
    RP.bookState(st).entries.length === 2 &&
    RP.bookState(st).entries[0].text.includes('Where Wario leans');
})());
check('book: a cap keeps the diary and the pages that came up more than once', (() => {
  const st = RP.blankState();
  for (let i = 0; i < 40; i++) RP.bookAdd(st, { kind: 'place', name: 'Place ' + i, text: 'A place worth the page, number ' + i + '.' });
  RP.bookAdd(st, { kind: 'diary', name: '', text: 'The day itself.', when: '5 Aethel' });
  RP.bookAdd(st, { kind: 'place', name: 'Place 0', text: 'Seen again.' });
  const out = RP.tidyBook(st, { max: 10 });
  const kept = RP.bookState(st).entries;
  return out.after === 10 && kept.some(p => p.kind === 'diary') && kept.some(p => (p.seen || 1) > 1);
})());

// ---------- the kit is a grid, and conditions bite ----------
const gridRoom = RP.newRoom([sans], { kit: 'off' });   // slot positions are asserted below
RP.applyDirectives(RP.blankState(), gridRoom, RP.parseDirectives([
  '[[ITEM: Sans + 🗝 a brass key | bent, from the ledger room]]',
  '[[ITEM: Sans + a worn notepad]]',
  '[[ITEM: Sans + a lantern]]',
  '[[EQUIP: Sans brass key]]',
].join('\n'), ['Sans']).directives, () => null);
check('kit: an emoji comes with the thing, chosen or guessed', (() => {
  const kit = gridRoom.states.sans.items.map(RP.normItem);
  return kit[0].icon === '🗝' && kit[1].icon === '📄' && kit[2].icon === '🏮' &&
    RP.iconFor('a strange object') === '📦';
})());
check('kit: the grid keeps its shape, with what is in hand first', (() => {
  const slots = RP.gridSlots(gridRoom.states.sans, 8);
  return slots.length === 8 && slots[0].equipped && slots[0].name.includes('brass key') &&
    slots.filter(Boolean).length === 3;
})());
check('kit: using something spends it, and the last one goes', (() => {
  const sheet = gridRoom.states.sans;
  RP.applyChange(sheet, { kind: 'item', op: '+', name: 'a lantern' });     // now ×2
  const first = RP.applyChange(sheet, { kind: 'use', name: 'lantern' });
  const second = RP.applyChange(sheet, { kind: 'use', name: 'lantern' });
  return /uses 🏮 a lantern/.test(first) && /last of it/.test(second) &&
    !sheet.items.some(i => /lantern/.test(i.name));
})());
check('kit: the model may only use what is on the sheet',
  /may only use what is listed here/.test(RP.stateBlock(gridRoom)) &&
  /\[\[USE: Name the brass key\]\]/.test(RP.DIRECTIVES));

const biteRoom = RP.newRoom([sans], {});
RP.applyDirectives(RP.blankState(), biteRoom,
  RP.parseDirectives('[[COND: Sans bleeding 3 -2hp | a deep cut across the palm]]', ['Sans']).directives, () => null);
check('conditions: a cost and a count are read separately', (() => {
  const cond = biteRoom.states.sans.flags.bleeding;
  return cond && cond.turns === 3 && cond.effect === '-2hp' && cond.note.includes('deep cut');
})());
check('conditions: it takes the cost every turn it lasts, then stops', (() => {
  const before = biteRoom.states.sans.hp.value;
  const first = RP.tickConditions(biteRoom);
  RP.tickConditions(biteRoom);
  RP.tickConditions(biteRoom);
  const after = biteRoom.states.sans.hp.value;
  return /−2 HP/.test(first[0]) && before - after === 6 && !biteRoom.states.sans.flags.bleeding;
})());
check('conditions: a lasting one with no cost does nothing but sit there', (() => {
  const quiet = RP.newRoom([sans], {});
  RP.applyDirectives(RP.blankState(), quiet, RP.parseDirectives('[[COND: Sans hunted | the Legion has his name]]', ['Sans']).directives, () => null);
  const hp = quiet.states.sans.hp.value;
  RP.tickConditions(quiet); RP.tickConditions(quiet);
  return quiet.states.sans.hp.value === hp && Boolean(quiet.states.sans.flags.hunted);
})());
check('conditions: the model is told the cost is real',
  /a\s+condition with a cost beside it is taking that off them/.test(RP.stateBlock(biteRoom).replace(/\n/g, ' ')));

// ---------- colour ----------
check('colour: a named colour and a hex both render', (() => {
  const html = RP.md('The {red|door} is {#2f7d4f|open}.');
  return html.includes('color:#c0392b') && html.includes('color:#2f7d4f') &&
    html.includes('>door<') && html.includes('>open<');
})());
check('colour: anything that is not a colour is left as written',
  RP.md('Plain {notacolour|text} stays.').includes('{notacolour|text}'));
check('colour: nothing but a colour gets through', (() => {
  const html = RP.md('{red|<script>alert(1)</script>}');
  return !/<script/.test(html) && html.includes('&lt;script');
})());
check('colour: the words may be coloured (a short rule, dropped first under pressure); the box carries the mood',
  /You may colour a few words/.test(RP.soloPrompt(sans, {})) && /colour of the box is their mood; the colour of the words is yours/.test(RP.soloPrompt(sans, {})) &&
  !/Colours available/.test(RP.groupPrompt([sans, cutters], sans, {})) && !/\[\[TINT:/.test(RP.DIRECTIVES) && /\[\[MOOD:/.test(RP.DIRECTIVES));

// ---------- a long chat stays cheap ----------
const longRoom = RP.newRoom([sans], {});
for (let i = 0; i < 60; i++) {
  longRoom.messages.push({ id: 'L' + i, role: i % 2 ? 'char' : 'user', charId: 'sans', text: 'turn number ' + i, at: i });
}
check('recap: a long chat asks to be folded up', RP.needsRecap(longRoom, 24) === true);
check('recap: a short one does not', RP.needsRecap(RP.newRoom([sans], {}), 24) === false);
check('recap: the prompt keeps what matters and drops the weather', (() => {
  const prompt = RP.recapPrompt(longRoom, [{ who: 'Sans', text: 'He signed it.' }], 'Earlier, they argued.');
  return /120 to 200 words/.test(prompt) && /what was decided/.test(prompt) &&
    /Drop: weather/.test(prompt) && prompt.includes('Earlier, they argued.');
})());
check('recap: folding shortens the history but not the story', (() => {
  const before = RP.historyFor(longRoom).length;
  longRoom.recap = 'They argued about the ledger for an hour and nobody signed anything.';
  longRoom.recapAt = 40;
  const after = RP.historyFor(longRoom).length;
  const block = RP.recapBlock(longRoom);
  return before === 60 && after === 20 && /THE STORY SO FAR/.test(block) && block.includes('nobody signed');
})());
check('recap: it reaches both prompts',
  RP.systemFor(RP.blankState(), longRoom, sans).includes('THE STORY SO FAR') &&
  RP.worldSystem(RP.blankState(), longRoom, {}).includes('THE STORY SO FAR'));
check('recap: the turns themselves are never thrown away', longRoom.messages.length === 60);

// ---------- the player's own sheet: a grid pack, a body, conditions ----------
{
  const st = RP.blankState();
  st.persona.name = 'Marlow';
  st.persona.items = ['🗝 a brass key | bent, from the ledger room', 'rope'];
  const rm = RP.newRoom([sans], { scene: 'The vault.' });
  const you = RP.ensurePlayerSheet(st, rm);
  check('player: the sheet exists, named for the persona, seeded from its kit',
    you && rm.states[RP.PLAYER_ID] === you && you.player === true && you.name === 'Marlow' &&
    you.items.length === 2 && you.items[0].icon === '🗝' && you.items[0].note === 'bent, from the ledger room');
  check('player: creating it twice does not double the kit',
    RP.ensurePlayerSheet(st, rm).items.length === 2);
  const block = RP.stateBlock(rm);
  check('player: the model is told whose sheet it is, and what that means',
    block.includes('Marlow (THE PLAYER)') && block.includes('🗝 a brass key') &&
    /reader\u2019s own body and pack/.test(block));
  // The model wounds, poisons and robs the player by name — same directions.
  const turn = 'The wine was wrong. [[HP: Marlow -12]] [[COND: Marlow poisoned 3 -2hp | pale wine]] [[ITEM: Marlow - a brass key]]';
  const staged = RP.parseDirectives(turn, [sans.name, you.name, 'the player']);
  const applied = RP.applyDirectives(st, rm, staged.directives);
  check('player: directions land on the player sheet',
    you.hp.value === 88 && you.flags.poisoned && you.flags.poisoned.effect === '-2hp' && you.items.length === 1);
  check('player: the poison actually bites on the tick', (() => {
    const lines = RP.tickConditions(rm);
    return you.hp.value === 86 && lines.some(l => l.includes('Marlow') && l.includes('poisoned'));
  })());
  check('player: EXIT cannot write the reader out', (() => {
    const gone = RP.parseDirectives('[[EXIT: Marlow — enough]]', [sans.name, you.name]);
    RP.applyDirectives(st, rm, gone.directives);
    return rm.states[RP.PLAYER_ID].present !== false;
  })());
  check('player: a starred cast member IS the player — no second body',
    (() => { const r2 = RP.newRoom([sans], {}); r2.youPlay = 'sans'; return RP.ensurePlayerSheet(st, r2) === r2.states.sans && !r2.states[RP.PLAYER_ID]; })());
}

// ---------- conditions parse with their bite, and read at a glance ----------
check('conditions: "bleeding 3 -2hp | a deep cut" is turns, cost and note', (() => {
  const c = RP.parseCondition('bleeding 3 -2hp | a deep cut');
  return c.key === 'bleeding' && c.turns === 3 && c.effect === '-2hp' && c.note === 'a deep cut';
})());
check('conditions: a setup string carries the effect into the sheet', (() => {
  const sheet = RP.blankSheet(sans, 'rpg', { flags: 'bleeding 3 -2hp | a deep cut; hunted' });
  return sheet.flags.bleeding && sheet.flags.bleeding.effect === '-2hp' &&
    sheet.flags.bleeding.turns === 3 && sheet.flags.hunted && !sheet.flags.hunted.effect;
})());
check('conditions: icons read at a glance, with a fallback',
  RP.condIcon('bleeding') === '🩸' && RP.condIcon('poisoned') === '☠️' && RP.condIcon('odd_thing') === '⚠️');
check('conditions: the prompt surfaces them as orders, not flavour', (() => {
  const rm = RP.newRoom([sans], {});
  rm.states.sans.flags.bleeding = { note: 'a deep cut', turns: 2, effect: '-2hp' };
  const block = RP.stateBlock(rm);
  return block.includes('CONDITIONS IN PLAY') && block.includes('must shape what its bearer does') &&
    block.includes('🩸 bleeding') && block.includes('[-2hp a turn]');
})());

// ---------- the sheets answer when their things are named ----------
check('mentions: "the key" resolves to the 🗝 on a sheet', (() => {
  const rm = RP.newRoom([sans], {});
  rm.states.sans.items = [RP.normItem('🗝 a brass key | bent, from the ledger room')];
  rm.states.sans.flags.bleeding = { note: '', turns: 2, effect: '-2hp' };
  const block = RP.mentionBlock(rm, 'I hand him the brass key and look at the bleeding.');
  return block.includes('NAMED JUST NOW') && block.includes('🗝 a brass key') &&
    block.includes('bent, from the ledger room') && block.includes('🩸 bleeding') &&
    RP.mentionBlock(rm, 'Nothing of yours.') === '';
})());
check('mentions: they reach the turn prompt', (() => {
  const rm = RP.newRoom([sans], {});
  rm.states.sans.items = [RP.normItem('🗝 a brass key')];
  return RP.systemFor(RP.blankState(), rm, sans, { mentionText: 'give me the key' }).includes('NAMED JUST NOW');
})());

// ---------- the kit answers to the names the model actually writes ----------
check('kit: "brass key", "the scroll" and "my blue potion" all find the thing on the sheet', (() => {
  const sheet = { name: 'Archivist', items: ['🗝 a brass key | bent', '📜 a scroll', '🧪 blue potion', 'the iron lantern'] };
  return RP.findItem(sheet, 'brass key').name === 'a brass key' && RP.findItem(sheet, 'the scroll').name === 'a scroll' &&
    RP.findItem(sheet, 'my blue potion').name === 'blue potion' && RP.findItem(sheet, 'iron lantern').name === 'the iron lantern' &&
    RP.findItem(sheet, 'lantern').name === 'the iron lantern' && RP.findItem(sheet, 'sword') === null && RP.findItem(sheet, 'the') === null;
})());
check('kit: losing one of a stack leaves the rest; the model\u2019s loose names remove and use the right thing', (() => {
  const sheet = { name: 'Archivist', items: ['🪙 a purse', '🗝 a brass key | bent', '📜 a scroll'] };
  RP.applyChange(sheet, { kind: 'item', op: '+', name: 'a purse' });
  const one = RP.applyChange(sheet, { kind: 'item', op: '-', name: 'purse' });
  const key = RP.applyChange(sheet, { kind: 'item', op: '-', name: 'brass key' });
  const used = RP.applyChange(sheet, { kind: 'use', name: 'the scroll' });
  const names = sheet.items.map(i => i.name + '×' + i.qty);
  return /1 left/.test(one) && /loses a brass key/.test(key) && /uses 📜 a scroll/.test(used) &&
    names.length === 1 && names[0] === 'a purse×1';
})());

// ---------- somebody new: the ＋ in the invite grid, and ENTER for a stranger ----------
check('invent: the fill-in template parses into a card with a voice and a kit', (() => {
  const text = 'ROLE: the pawnbroker\nLOOK: A stooped Toad in a green eyeshade.\nVOICE: Dry, slow, every sentence a price.\n' +
    'SOUNDS LIKE: "That will cost you" / Interest is interest\nNEVER: forgive a debt / hurry\n' +
    'LINE: "I do not lend. I remember."\nLINE: "Sign here."\nCARRYING: 📒 a black ledger, 🗝 a ring of small keys';
  const got = RP.parseInvented(text, { name: 'Old Pell' });
  return got.role === 'the pawnbroker' && /eyeshade/.test(got.look) && got.voice && /every sentence a price/.test(got.voice.register) &&
    got.voice.sounds.length === 2 && got.voice.sounds[0] === 'That will cost you' && got.voice.never.length === 2 &&
    got.voice.lines.length === 2 && got.items.length === 2 && got.items[0] === '📒 a black ledger' &&
    /EXACTLY these lines/.test(RP.inventPrompt({ name: 'Old Pell' }, RP.newRoom([sans], {})));
})());
check('invent: the new character is seated with a sheet, a voice and a kit, and kept for later invites', (() => {
  const st = RP.blankState();
  const rm = RP.newRoom([sans], {});
  const made = RP.inventCharacter(st, rm, {
    name: 'Old Pell', role: 'the pawnbroker', look: 'stooped, green eyeshade',
    voice: { register: 'Dry, slow, every sentence a price.', sounds: [], never: [], lines: ['I do not lend. I remember.'] },
    items: ['📒 a black ledger', '🗝 a ring of small keys | bent'], by: 'written in by the reader',
  });
  const sheet = rm.states[made.id];
  return made.id === 'new_old_pell' && made.invented && rm.cast.some(c => c.id === made.id) && sheet && sheet.items.length === 2 &&
    RP.normItem(sheet.items[1]).note === 'bent' && RP.voiceBlock(made).includes('every sentence a price') &&
    st.newChars[0].id === made.id && RP.stateBlock(rm).includes('Old Pell') &&
    RP.systemFor(st, rm, made, {}).includes('every sentence a price');
})());
check('enter: a stranger who walks in is made like a NEW — sheet, seat, remembered for later', (() => {
  const st = RP.blankState();
  const rm = RP.newRoom([sans], {});
  const parsed = RP.parseDirectives('*The door opens.* [[ENTER: Marguerite Oyle — the night archivist, come about the ledger]]', ['Sans']);
  const out = RP.applyDirectives(st, rm, parsed.directives, () => null);
  const who = rm.cast.find(c => c.name === 'Marguerite Oyle');
  return out.entered.length === 1 && who && who.invented && rm.states[who.id] && rm.states[who.id].present !== false &&
    st.newChars.some(c => c.id === who.id) && /enters —/.test(out.lines[0]);
})());
check('enter: a one-to-one chat somebody walks into becomes a group chat, and the newcomer gets their own card', (() => {
  const st = RP.blankState();
  const rm = RP.newRoom([sans], {});
  const parsed = RP.parseDirectives('[[ENTER: Marguerite Oyle — about the ledger]]', ['Sans']);
  RP.applyDirectives(st, rm, parsed.directives, () => null);
  const who = rm.cast.find(c => c.name === 'Marguerite Oyle');
  const sys = RP.systemFor(st, rm, who, {});
  return rm.kind === 'group' && /NOW ANSWER AS MARGUERITE OYLE|Marguerite Oyle/.test(sys) && !/^You are Sans,/.test(sys) &&
    RP.historyFor({ kind: rm.kind, cast: rm.cast, messages: [{ role: 'char', charId: who.id, text: 'Evening.' }] })[0].content.startsWith('Marguerite Oyle: ');
})());

// ---------- mood: the colour of the box is how they feel ----------
{
  const wario = RP.normChar({ id: 'wario', name: 'Wario' });
  const waluigi = RP.normChar({ id: 'waluigi', name: 'Waluigi' });
  const st = RP.blankState();
  const rm = RP.newRoom([wario, waluigi, sans], {});
  st.rooms.push(rm); st.active = rm.id;
  RP.markPlayer(rm, 'waluigi'); RP.ensurePlayerSheet(st, rm);
  const W = rm.states.wario;
  check('mood: a feeling word is read with its strength — furious is anger at 3, calm is calm, junk is nothing', (() => {
    const a = RP.moodWord('furious'), b = RP.moodWord('a little uneasy'), c = RP.moodWord('calm'), d = RP.moodWord('blorp');
    return a.key === 'anger' && a.level === 3 && b.key === 'fear' && b.level === 1 && c.key === 'calm' && d === null;
  })());
  check('mood: a new feeling starts as a flicker and builds one step a turn, never swinging', (() => {
    const l1 = RP.moodShift(W, 'anger', 2, 'the bill', { turn: 1 });
    const l2 = RP.moodShift(W, 'anger', 2, '', { turn: 2 });
    const l3 = RP.moodShift(W, 'anger', 1, '', { turn: 3 });
    return /irritated/.test(l1) && W.mood.level === 2 && /angry.*building/.test(l2) && l3 === '' && W.mood.level === 2 && W.mood.note === 'the bill';
  })());
  check('mood: a different feeling wears the standing one down before it takes over', (() => {
    const l1 = RP.moodShift(W, 'fear', 2, 'the drop', { turn: 4 });
    const worn = W.mood.key + ' ' + W.mood.level;
    const l2 = RP.moodShift(W, 'fear', 2, 'the drop', { turn: 5 });
    return /irritated.*fear pulling at it/.test(l1) && worn === 'anger 1' &&
      /uneasy.*the anger gone/.test(l2) && W.mood.key === 'fear' && W.mood.level === 1;
  })());
  check('mood: a shock — a 3 filed — replaces the feeling at once, at 2, never straight to 3', (() => {
    const line = RP.moodShift(W, 'joy', 3, 'the money', { turn: 6 });
    return /happy.*uneasy no longer/.test(line) && W.mood.key === 'joy' && W.mood.level === 2;
  })());
  check('mood: calm takes a step off; set by hand writes exactly what was asked', (() => {
    const eased = RP.moodShift(W, 'calm', 0, '', { turn: 7 });
    RP.moodShift(W, 'pride', 3, 'the deal', { set: true, turn: 7 });
    return /pleased.*easing/.test(eased) && W.mood.key === 'pride' && W.mood.level === 3 && RP.moodLabel(W.mood) === 'triumphant';
  })());
  check('mood: it fades on its own — a step off every two quiet turns, calm at zero, and a fed turn resets the count', (() => {
    W.mood = { key: 'anger', level: 2, note: '', held: 0, at: 10 };
    const t1 = RP.tickMoods(rm, 11), t2 = RP.tickMoods(rm, 12);
    const afterTwo = W.mood.level;
    RP.tickMoods(rm, 13);
    RP.moodShift(W, 'anger', 2, '', { turn: 14 });        // fed: the count restarts
    RP.tickMoods(rm, 14);                                  // the turn it was fed on does not count
    const fed = W.mood.level + '/' + W.mood.held;
    RP.tickMoods(rm, 15); RP.tickMoods(rm, 16); RP.tickMoods(rm, 17);
    const gone = RP.tickMoods(rm, 18);
    return t1.length === 0 && t2.length === 0 && afterTwo === 1 && fed === '2/0' && !W.mood && /Wario settles/.test(gone[0]);
  })());
  check('mood: [[MOOD: Name feeling 2 | why]] parses with its level and note; the player\u2019s mood is theirs and dropped', (() => {
    const staged = RP.parseDirectives('*He slams the door.* [[MOOD: Wario anger 2 | the bill]] [[MOOD: Waluigi afraid 2]] [[MOOD: Sans suspicious | the ledger]] [[MOOD: Sans blorp]]',
      ['Wario', 'Waluigi', 'Sans']);
    const d = staged.directives;
    delete W.mood;
    const done = RP.applyDirectives(st, rm, d);
    return staged.clean === '*He slams the door.*' && d.length === 3 && d[0].kind === 'mood' && d[0].key === 'anger' && d[0].level === 2 && d[0].note === 'the bill' &&
      W.mood.key === 'anger' && W.mood.level === 1 && !rm.states.waluigi.mood && rm.states.sans.mood.key === 'suspicion' &&
      done.lines.some((l) => /Wario — irritated \(the bill\)/.test(l)) && rm.toolAt.mood === rm.messages.length;
  })());
  check('mood: a nameless [[MOOD: furious | why]] parses for the page to hand to the speaker, and lands on nobody by itself', (() => {
    const d = RP.parseDirectives('[[MOOD: furious | the bill]] [[MOOD: fear 3/3 | the drop]] [[MOOD: ominous]]', ['Wario']).directives;
    const before = JSON.stringify(rm.states);
    RP.applyDirectives(st, rm, d);
    return d.length === 2 && d[0].who === '' && d[0].key === 'anger' && d[0].level === 3 && d[0].note === 'the bill' &&
      d[1].key === 'fear' && d[1].level === 3 && JSON.stringify(rm.states) === before;
  })());
  check('mood: the prose is read when the model files nothing — two cues or one strong word, speaker only', (() => {
    const angry = RP.moodScan('*Wario slams his fist on the dashboard.* "GET OUT OF MY HELICOPTER!" he bellows, glaring at the pilot.', 'Wario', ['Sans', 'Waluigi']);
    const other = RP.moodScan('Sans looks terrified. Sans trembles and backs away from the wreck.', 'Wario', ['Sans', 'Waluigi']);
    const plain = RP.moodScan('He turns the page and says nothing for a moment.', 'Wario', ['Sans']);
    const strong = RP.moodScan('Wario sobs once, into his sleeve.', 'Wario', ['Sans']);
    const mock = RP.moodScan('MOCK-MODEL REPLY #3: the blade goes in.', 'Wario', ['Sans']);
    return angry && angry.key === 'anger' && other === null && plain === null && strong && strong.key === 'grief' && mock === null;
  })());
  check('mood: the sheets show it, the speaker gets it as an order, a calm speaker costs nothing', (() => {
    const sys = RP.systemFor(st, rm, sans, {});
    const calm = RP.systemFor(st, rm, waluigi, {});
    return /mood: wary \(suspicion 1\/3 — the ledger\)/.test(sys) && /MOOD — Sans is wary \(suspicion 1\/3: the ledger\)/.test(sys) &&
      /questions everything, answers little/.test(sys) && /file \[\[MOOD: Sans/.test(sys) && !/MOOD — Waluigi/.test(calm) &&
      !/COLOUR, THIS TURN/.test(sys);
  })());
  check('mood: the box wears the colour — a line, a flat tint that deepens with the level, and an icon; the chip words stay short', (() => {
    const one = RP.moodStyle({ key: 'anger', level: 1 }), three = RP.moodStyle({ key: 'anger', level: 3 });
    return /--mood-line:hsl\(4,/.test(one) && /--mood-bg:hsl\(4,70%,93%\)/.test(one) && /--mood-bg:hsl\(4,70%,82%\)/.test(three) &&
      RP.moodStyle({ key: 'blorp' }) === '' && RP.moodIcon({ key: 'fear' }) === '😨' && RP.MOOD_KEYS.length === 10 &&
      new Set(RP.MOOD_KEYS.map((k) => RP.MOODS[k].hue)).size === 10 &&
      RP.MOOD_KEYS.every((k) => RP.MOODS[k].words.every((w) => w.split(' ').length === 1));
  })());
  check('flourish: a triumph or a setback orders ONE coloured phrase; a plain turn, or a model that already colours, gets nothing', (() => {
    const quiet = RP.newRoom([sans], {});
    const win = RP.flourishBlock(quiet, { key: 'triumph' }), loss = RP.flourishBlock(quiet, { key: 'setback' });
    quiet.messages.push({ id: 'c1', role: 'char', charId: sans.id, text: 'the {ice|key} turns.', at: 1 });
    return /exactly ONE phrase/.test(win) && /gold or amber/.test(win) && /blood or rust/.test(loss) &&
      RP.flourishBlock(quiet, { key: 'success' }) === '' && RP.flourishBlock(quiet, null) === '' &&
      RP.flourishBlock(quiet, { key: 'triumph' }) === '' && RP.recentlyColoured(quiet);
  })());
  check('player mood: your own feeling colours how the cast reads you — a pick-up is a grab; calm costs nothing', (() => {
    const you = RP.ensurePlayerSheet(st, rm);
    const calm = RP.playerMoodBlock(rm);
    RP.moodShift(you, 'anger', 2, 'the bill', { set: true, turn: 3 });
    const sys = RP.systemFor(st, rm, sans, {});
    const world = RP.worldSystem(st, rm, {});
    const out = calm === '' && /THE PLAYER\u2019S MOOD — .* is angry \(anger 2\/3: the bill\)/.test(sys) && /a pick-up is a grab/.test(sys) &&
      /Never decide their words/.test(sys) && /THE PLAYER\u2019S MOOD/.test(world) && !/let it cost them/.test(sys);
    RP.moodShift(you, 'anger', 3, 'the bill', { set: true, turn: 4 });
    const hot = /let it cost them something/.test(RP.playerMoodBlock(rm));
    delete you.mood;
    return out && hot && RP.playerMoodBlock(rm) === '';
  })());
  check('body: a battered character at 28 HP is written body first — no wrench-swinging exits; whole costs nothing', (() => {
    const ws = RP.sheetFor(rm, sans.id);
    const whole = RP.bodyBlock(rm, sans);
    ws.hp = { value: 28, max: 100 }; ws.flags = { battered: { note: 'the crash' } };
    const hurt = RP.bodyBlock(rm, sans);
    const sys = RP.systemFor(st, rm, sans, {});
    ws.hp = { value: 0, max: 100 };
    const down = RP.bodyBlock(rm, sans);
    ws.hp = { value: 100, max: 100 }; ws.flags = {};
    return whole === '' && /BODY — Sans is BADLY HURT at 28\/100 HP/.test(hurt) && /cannot sprint, swing hard/.test(hurt) &&
      /battered \(the crash\)/.test(hurt) && /greedy and broken is not greedy and whole/.test(hurt) && /\[\[HP: Sans -N\]\]/.test(hurt) &&
      /BODY — Sans is BADLY HURT/.test(sys) && sys.indexOf('BODY — Sans') > sys.indexOf('THE USER PLAYS') &&
      /DOWN at 0 HP/.test(down) && RP.bodyBlock(rm, sans) === '';
  })());
  check('mood: the director\u2019s note nudges for feelings now, not for tints', (() => {
    const quiet = RP.newRoom([sans], {});
    for (let i = 0; i < 20; i++) quiet.messages.push({ id: 'q' + i, role: i % 2 ? 'char' : 'user', charId: sans.id, text: 'plain words ' + i, at: 1 });
    quiet.toolAt = { stakes: 19, remember: 19 };
    const note = RP.encourage(quiet);
    return /\[\[MOOD: Name feeling 2/.test(note) && !/TINT/.test(note) && RP.ENCOURAGE_AFTER.tint === undefined;
  })());
  check('mood: the quartermaster may file a feeling it saw the record miss', RP.UPKEEP_KINDS.includes('mood'));
}

// ---------- the AI audit: every sheet, every scene, one call, by hand ----------
{
  const wario = RP.normChar({ id: 'wario', name: 'Wario' });
  const bowser = RP.normChar({ id: 'bowser', name: 'Bowser' });
  const st = RP.blankState();
  const a = RP.newRoom([wario, sans], { title: 'The pavement' });
  const b = RP.newRoom([wario, bowser], { title: 'The hangar' });
  st.rooms.push(a, b); st.active = a.id;
  RP.ensurePlayerSheet(st, a); RP.ensurePlayerSheet(st, b);
  b.away = [{ id: 'sans', name: 'Sans' }];
  const prompt = RP.sheetAuditPrompt([a, b], { [a.id]: [{ who: 'Wario', text: 'The helicopter is on its side.' }], [b.id]: [] });
  check('audit: the prompt carries every sheet of both scenes, who is at the door, the recent play, and the allowed tools',
    /AUDIT THE SHEETS/.test(prompt) && /SCENE \u201cThe pavement\u201d/.test(prompt) && /SCENE \u201cThe hangar\u201d/.test(prompt) &&
    /waiting at the door: Sans/.test(prompt) && /Wario: The helicopter is on its side\./.test(prompt) && /\(nothing played yet\)/.test(prompt) &&
    /\[\[MOOD: Name anger 2 \| why\]\]/.test(prompt) && /\[\[TIME: 23:40\]\]/.test(prompt) && /reply exactly: IN ORDER/.test(prompt) &&
    /never a new person/.test(prompt) && /decide what their HP and Energy should be NOW/.test(prompt) && /SET it/.test(prompt) &&
    /\[\[HP: Name = N\]\]/.test(prompt) && /sixteen at most/.test(prompt) && /reader approves every line/.test(prompt));
  check('audit: IN ORDER changes nothing', RP.applySheetAudit(st, [a, b], 'IN ORDER').count === 0 && a.states.wario.hp.value === 100);
  const reply = '[[HP: Bowser -7]]\n[[MOOD: Wario anger 3 | the bill]]\n[[TIME: 23:40]]\n[[ENTER: Sans — back from the pavement]]\n' +
    '[[NEW: Bob | a stranger | invented]]\n[[SET: place = the moon]]\n[[REMEMBER: x | y]]\n[[STATUS: Sans soot on the face]]\n[[EXIT: Bowser — gone]]';
  const done = RP.applySheetAudit(st, [a, b], reply);
  check('audit: each line lands in the scene that knows the name — wounds, moods (at the pitch it decided), notes, the clock in both',
    b.states.bowser.hp.value === 93 && a.states.wario.mood.key === 'anger' && a.states.wario.mood.level === 3 &&
    a.clock === '23:40' && b.clock === '23:40' && /soot/.test(a.states.sans.status) &&
    done.byRoom[a.id].length === 3 && done.byRoom[b.id].length === 3 && done.count === 6 &&
    done.items.length === 6 && done.items.every((it) => typeof it.index === 'number' && it.roomId && it.line && it.kind));
  check('audit: the reader unticks lines — only the picked indices land, and it may SET a number outright', (() => {
    const c = RP.newRoom([wario, bowser], {});
    RP.ensurePlayerSheet(st, c);
    const text = '[[HP: Wario = 40]]\n[[MOOD: Bowser anger 3 | the bill]]\n[[MP: Bowser = 5]]\n[[TIME: dawn]]';
    const copy = JSON.parse(JSON.stringify(c));
    const preview = RP.applySheetAudit({ log: [], book: { entries: [], queue: [] }, newChars: [], rooms: [copy] }, [copy], text);
    const picked = RP.applySheetAudit(st, [c], text, { only: [preview.items[0].index, preview.items[3].index] });
    return preview.items.length === 4 && c.states.wario.hp.value === 40 && !c.states.bowser.mood && c.states.bowser.mp.value !== 5 &&
      c.clock === 'dawn' && picked.count === 2 && RP.applySheetAudit(st, [c], text, { only: [] }).count === 0;
  })());
  check('audit: the player\u2019s own mood may be set by the audit (the reader approves it), never by a turn\u2019s [[MOOD:]]', (() => {
    const c = RP.newRoom([wario], {});
    const you = RP.ensurePlayerSheet(st, c);
    const inPlay = RP.applyDirectives(st, c, RP.parseDirectives('[[MOOD: ' + you.name + ' fear 2 | the gun]]', [you.name, 'Wario']).directives);
    const byAudit = RP.applySheetAudit(st, [c], '[[MOOD: ' + you.name + ' fear 2 | the gun]]');
    return !inPlay.lines.length && byAudit.count === 1 && you.mood && you.mood.key === 'fear' && you.mood.level === 2;
  })());
  check('audit: ENTER only brings back somebody at that scene\u2019s door; EXIT writes out; nothing invents a person or a fact',
    b.cast.some((c) => c.id === 'sans') && !b.cast.some((c) => c.id === 'bowser') && b.states.bowser.present === false &&
    !a.cast.some((c) => /Bob/.test(c.name)) && !b.cast.some((c) => /Bob/.test(c.name)) && !(a.facts || {}).place && !(b.facts || {}).place &&
    !(st.book.entries || []).length);
  check('audit: the kinds it may file are the quartermaster\u2019s plus the clock and the door',
    RP.AUDIT_KINDS.includes('mood') && RP.AUDIT_KINDS.includes('time') && RP.AUDIT_KINDS.includes('exit') && !RP.AUDIT_KINDS.includes('new') &&
    !RP.AUDIT_KINDS.includes('set') && RP.AUDIT_TURNS >= 10);
  check('audit: one step back restores the sheets AND the clock', (() => {
    const c = RP.newRoom([wario], {});
    c.clock = 'noon';
    RP.pushUndo(c, 'the AI audit');
    RP.applySheetAudit(st, [c], '[[HP: Wario -40]]\n[[TIME: midnight]]');
    const moved = c.states.wario.hp.value === 60 && c.clock === 'midnight';
    RP.undo(c);
    return moved && c.states.wario.hp.value === 100 && c.clock === 'noon';
  })());
}

// ---------- standing tints: the model picks the words and the colour ----------
check('tints: [[TINT: words = colour]] files a standing rule', (() => {
  const st = RP.blankState();
  const rm = RP.newRoom([sans], {});
  const staged = RP.parseDirectives('The wax gave. [[TINT: the seal, the wax = violet]]', [sans.name]);
  RP.applyDirectives(st, rm, staged.directives);
  return staged.clean === 'The wax gave.' && rm.tints.length === 2 &&
    rm.tints[0].colour === RP.COLOURS.violet;
})());
check('tints: every later mention renders in that colour, hands off the hand-coloured', (() => {
  const out = RP.applyTints('The seal broke. {red|the seal} held.', [{ text: 'the seal', colour: '#6b46c1' }]);
  return out === '{#6b46c1|The seal} broke. {red|the seal} held.';
})());
check('tints: UNTINT releases the words', (() => {
  const st = RP.blankState();
  const rm = RP.newRoom([sans], {});
  RP.applyDirectives(st, rm, RP.parseDirectives('[[TINT: the seal = violet]]', []).directives);
  RP.applyDirectives(st, rm, RP.parseDirectives('[[UNTINT: the seal]]', []).directives);
  return rm.tints.length === 0;
})());
check('tints: a colour the palette refuses files nothing',
  RP.parseDirectives('[[TINT: the seal = javascript]]', []).directives.length === 0);
check('tints: the model is no longer told to tint — old filings still render, new ones are still honoured if a model writes one',
  !RP.DIRECTIVES.includes('[[TINT:') && !RP.soloPrompt(sans, {}).includes('[[TINT:') &&
  RP.parseDirectives('[[TINT: the seal = violet]]', []).directives.length === 1);

// ---------- history packed by characters, not just counted by turns ----------
check('history: one monologue cannot evict ten turns', (() => {
  const msgs = [];
  for (let i = 0; i < 30; i++) msgs.push({ role: i % 2 ? 'assistant' : 'user', content: 'turn ' + i + ' ' + 'w'.repeat(150) });
  msgs[29] = { role: 'assistant', content: 'm'.repeat(9000) };
  const packed = RP.packHistory(msgs, 4000);
  const last = packed[packed.length - 1];
  return last.content.length <= RP.TURN_CLIP + 1 && packed.length >= 6 &&
    packed[packed.length - 2].content.startsWith('turn 28');
})());
check('history: a normal chat passes through untouched', (() => {
  const msgs = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'well?' }];
  const packed = RP.packHistory(msgs, 9000);
  return packed.length === 2 && packed[0] === msgs[0];
})());
check('history: newest turns win the budget', (() => {
  const msgs = [];
  for (let i = 0; i < 40; i++) msgs.push({ role: 'user', content: 'turn ' + i + ' ' + 'w'.repeat(400) });
  const packed = RP.packHistory(msgs, 3000);
  return packed.length < 40 && packed[packed.length - 1].content.startsWith('turn 39');
})());

// ---------- the wardrobe: profile → kit, slots, stats — no model call ----------
{
  const soldier = RP.normChar({ id: 'grix', name: 'Grix', title: 'Captain of the outpost guard', description: 'a scarred soldier' });
  const clerk = RP.normChar({ id: 'pell', name: 'Pell', title: 'Junior archivist', description: 'a nervous scribe of the records office' });
  check('wardrobe: a profile earns a kit, deterministically', (() => {
    const kit = RP.kitFor(soldier);
    return kit.length >= 2 && kit.length <= 4 && kit.every(i => i.icon && i.name) &&
      JSON.stringify(kit) === JSON.stringify(RP.kitFor(soldier)) &&
      JSON.stringify(RP.kitFor(soldier).map(i => i.name)) !== JSON.stringify(RP.kitFor(clerk).map(i => i.name));
  })());
  check('wardrobe: a fresh room dresses its cast; kit: "off" leaves packs empty', (() => {
    const dressed = RP.newRoom([soldier, clerk], {});
    const bare = RP.newRoom([soldier], { kit: 'off' });
    return dressed.states.grix.items.length > 0 && dressed.states.pell.items.length > 0 &&
      bare.states.grix.items.length === 0;
  })());
  check('wardrobe: a hand-written kit is never overridden', (() => {
    const rm = RP.newRoom([soldier], { setup: { grix: { items: 'a single feather' } } });
    return rm.states.grix.items.length === 1 && rm.states.grix.items[0].name === 'a single feather';
  })());
  check('wardrobe: the profile sizes the pack, and a full pack refuses', (() => {
    const rm = RP.newRoom([soldier], { kit: 'off' });
    const sheet = rm.states.grix;
    if (RP.packSizeFor(soldier) !== sheet.slots || RP.packSizeFor({ description: 'an ancient ghost' }) >= sheet.slots) return false;
    for (let i = 0; i < sheet.slots; i++) RP.applyChange(sheet, { kind: 'item', op: '+', name: 'thing ' + i });
    const refused = RP.applyChange(sheet, { kind: 'item', op: '+', name: 'one more' });
    return sheet.items.length === sheet.slots && /pack is full/.test(refused) && !sheet.items.some(i => i.name === 'one more');
  })());
  check('stats: four numbers out of the filed record, 0–3, stable', (() => {
    const s = RP.statsFor(soldier);
    return s.might >= 2 && ['might', 'wits', 'sway', 'luck'].every(k => s[k] >= 0 && s[k] <= 3) &&
      JSON.stringify(s) === JSON.stringify(RP.statsFor(soldier)) &&
      RP.statsFor(clerk).wits >= 2 && RP.statsFor(clerk).sway === 0;   // "nervous" costs sway
  })());
  check('stats: the sheet line carries them at a glance',
    /⚔\d 🧠\d 🗣\d 🍀\d/.test(RP.statLine(RP.statsFor(soldier))) &&
    RP.stateBlock(RP.newRoom([soldier], {})).includes(RP.statLine(RP.statsFor(soldier))));
  check('stats: the attempt\u2019s wording picks the stat',
    RP.actionStat('I try to persuade the guard') === 'sway' && RP.actionStat('I smash the crate') === 'might' &&
    RP.actionStat('I study the ledger') === 'wits' && RP.actionStat('I sneak past the dogs') === 'luck' &&
    RP.actionStat('I wait.') === '');
  check('stats: the wider vocabulary — heave, bribe, disarm, shoot — lands on a stat too',
    RP.actionStat('I heave the portcullis up') === 'might' && RP.actionStat('I bribe the clerk') === 'sway' &&
    RP.actionStat('I disarm the trap') === 'wits' && RP.actionStat('I shoot the rope') === 'luck' &&
    RP.actionStat('I look closer at the seal') === 'wits');
  check('stats: they lean on the dice, and only there', (() => {
    const st = RP.blankState();
    st.persona.name = 'Bruiser';
    st.persona.look = 'a scarred soldier of the old legion';    // might 3
    const rm = RP.newRoom([soldier], {});
    RP.ensurePlayerSheet(st, rm);
    let strongBad = 0, weakBad = 0;
    const weak = RP.newRoom([soldier], {});
    RP.ensurePlayerSheet(RP.blankState(), weak);
    weak.states[RP.PLAYER_ID].stats = { might: 0, wits: 1, sway: 1, luck: 1 };
    for (let roll = 0.05; roll < 1; roll += 0.05) {
      if (['setback', 'wrench', 'refusal'].includes(RP.rollFate({ settings: { fate: 'normal' } }, rm, { text: 'I smash the crate', roll }).key)) strongBad++;
      if (['setback', 'wrench', 'refusal'].includes(RP.rollFate({ settings: { fate: 'normal' } }, weak, { text: 'I smash the crate', roll }).key)) weakBad++;
    }
    const tagged = RP.rollFate({ settings: { fate: 'normal' } }, rm, { text: 'I smash the crate', roll: 0.5 });
    return strongBad < weakBad && tagged.stat === 'might' && /⚔ might \d/.test(tagged.pill);
  })());
}

// ---------- the thin-air check: no bazookas out of nowhere ----------
{
  const st = RP.blankState();
  st.persona.name = 'Marlow';
  st.persona.items = ['🗝 a brass key | bent'];
  const rm = RP.newRoom([sans], {});
  RP.ensurePlayerSheet(st, rm);
  check('thin air: pulling out a thing you HAVE finds it on the sheet', (() => {
    const c = RP.conjureCheck(rm, 'I draw the brass key and step in.');
    return c && c.kind === 'have' && c.item.name.includes('brass key');
  })());
  check('thin air: the bazooka is caught', (() => {
    const c = RP.conjureCheck(rm, 'I pull out a bazooka and fire.');
    return c && c.kind === 'conjured' && c.claim === 'bazooka';
  })());
  check('thin air: scenery and weak claims are not policed',
    RP.conjureCheck(rm, 'I grab the railing.') === null &&
    RP.conjureCheck(rm, 'I use the door.') === null &&
    RP.conjureCheck(rm, 'What do you make of it?') === null);
  check('thin air: a "my" claim is a claim — "I fire my bazooka" is caught',
    (RP.conjureCheck(rm, 'I fire my bazooka!') || {}).kind === 'conjured');
  check('thin air: the dice turn against the bluff', (() => {
    let plainBad = 0, bluffBad = 0;
    for (let roll = 0.05; roll < 1; roll += 0.05) {
      if (['setback', 'refusal'].includes(RP.rollFate({ settings: { fate: 'normal' } }, rm, { roll }).key)) plainBad++;
      if (['setback', 'refusal'].includes(RP.rollFate({ settings: { fate: 'normal' } }, rm, { roll, conjured: 'a bazooka' }).key)) bluffBad++;
    }
    return bluffBad > plainBad;
  })());
  check('thin air: the dice settle the claim on the page — a good roll puts it on the sheet, in hand', (() => {
    const st2 = RP.blankState(); st2.persona.name = 'Marlow';
    const rm2 = RP.newRoom([sans], {});
    RP.ensurePlayerSheet(st2, rm2);
    const good = RP.rollFate({ settings: { fate: 'normal' } }, rm2, { conjured: 'a bazooka', force: 'success' });
    const got = RP.resolveConjure(rm2, 'a bazooka', good);
    const kit = rm2.states[RP.PLAYER_ID].items.map(RP.normItem);
    const bad = RP.rollFate({ settings: { fate: 'normal' } }, rm2, { conjured: 'a cannon', force: 'setback' });
    const lost = RP.resolveConjure(rm2, 'a cannon', bad);
    const still = rm2.states[RP.PLAYER_ID].items.map(RP.normItem);
    return good.granted === true && got.granted && kit.some(i => i.name === 'a bazooka' && i.equipped) &&
      bad.granted === false && lost.granted === false && !still.some(i => /cannon/.test(i.name)) &&
      /on their sheet now/.test(RP.conjureBlock('a bazooka', got)) && /EMPTY/.test(RP.conjureBlock('a cannon', lost)) &&
      RP.resolveConjure(rm2, 'a thing', null) === null;
  })());
  check('thin air: the brief reaches the prompt only when it fires', (() => {
    const armed = RP.systemFor(st, rm, sans, { conjured: 'a bazooka' });
    const calm = RP.systemFor(st, rm, sans, {});
    return armed.includes('OUT OF THIN AIR') && armed.includes('bazooka') && !calm.includes('OUT OF THIN AIR');
  })());
}

// ---------- the quartermaster: the sheets keep themselves ----------
{
  const st = RP.blankState();
  st.persona.name = 'Marlow';
  const rm = RP.newRoom([sans], {});
  RP.ensurePlayerSheet(st, rm);
  check('upkeep: a plain handover in the prose is caught with no model call',
    RP.grantScan('She hands you the lantern and turns away.')[0] === 'lantern' &&
    RP.grantScan('He presses a brass key into your palm.')[0] === 'brass key');
  check('upkeep: an offer is not a grant, and scenery is not a thing',
    RP.grantScan('She offers you the crown.').length === 0 &&
    RP.grantScan('He hands you the door.').length === 0 &&
    RP.grantScan('They talk for a while.').length === 0);
  check('upkeep: the review comes due in played turns, and can be turned off', (() => {
    for (let i = 0; i < 6; i++) rm.messages.push({ id: 'u' + i, role: i % 2 ? 'char' : 'user', charId: 'sans', text: 'turn ' + i, at: i });
    return RP.needsUpkeep(rm) === true && RP.needsUpkeep(rm, 0) === false &&
      RP.needsUpkeep(RP.newRoom([sans], { mechanics: 'off' })) === false;
  })());
  check('upkeep: the reviewer sees the sheets, the prose, and the way out',
    RP.upkeepPrompt(rm, [{ who: 'Sans', text: 'the wax gave' }]).includes('CHARACTER STATE') &&
    RP.upkeepPrompt(rm, []).includes('IN ORDER') &&
    RP.upkeepPrompt(rm, []).includes('Do not invent'));
  check('upkeep: only ledger lines are honoured — it cannot rewrite the world', (() => {
    const done = RP.applyUpkeep(st, rm,
      '[[ITEM: Marlow + 🏮 a lantern | still warm]]\n[[EXIT: Sans — nope]]\n[[TINT: doom = red]]\n[[COND: Sans winded 2]]');
    return done.lines.length === 2 && rm.cast.length === 1 && !(rm.tints || []).length &&
      rm.states[RP.PLAYER_ID].items.some(i => i.name.includes('lantern')) &&
      rm.states.sans.flags.winded && rm.states.sans.flags.winded.turns === 2;
  })());
}

// ---------- the hurt ledger: wounds filed from the prose, no model call ----------
{
  const wario = { id: 'wario', name: 'Wario' }, waluigi = { id: 'waluigi', name: 'Waluigi' };
  const st = RP.blankState();
  const rm = RP.newRoom([wario, waluigi, sans], {});
  st.rooms.push(rm);
  RP.markPlayer(rm, 'waluigi');
  RP.ensurePlayerSheet(st, rm);
  const crash = '*"HOLD ON TO YOUR WALLET!"* Wario bellows. *"CRASHING IS JUST AN UNEXPECTED DOWNWARD INVESTMENT!"*\n\n' +
    'The helicopter clips the edge of an awning with a deafening crunch as it slams into the pavement below. ' +
    'The impact is violent, a jarring jolt that throws everything—including Wario—forward against the dashboard.\n\n' +
    'He coughs through the smoke and kicks the shattered door open.';
  const by = hits => Object.fromEntries(hits.map(h => [h.id, h]));
  check('wounds: a crash the model never filed costs everyone in the scene a share of their max HP', (() => {
    const h = by(RP.hurtScan(crash, rm, { speaker: wario, roll: 0.5 }));
    return Object.keys(h).length === 3 && h.wario.amount === 35 && h.waluigi.amount === 35 && h.sans.amount === 35 &&
      h.wario.tier === 'grave' && h.wario.cause === 'the crash';
  })());
  check('wounds: the amounts are shares, so a ten-point sheet bleeds in proportion', (() => {
    const small = RP.newRoom([wario], {});
    small.states.wario.hp = { value: 10, max: 10 };
    const h = RP.hurtScan('The floor gives way and they fall two storeys.', small, { world: true, roll: 1 });
    return h.length === 1 && h[0].amount === 5 && h[0].cause === 'the collapse';
  })());
  check('wounds: holding on halves the player’s share; fate scales the whole thing', (() => {
    const soft = by(RP.hurtScan(crash, rm, { speaker: wario, roll: 0.5, braced: RP.bracedIn('I hold onto the seat as the aircraft crashes') }));
    const harsh = by(RP.hurtScan(crash, rm, { speaker: wario, roll: 0.5, level: 'harsh' }));
    const gentle = by(RP.hurtScan(crash, rm, { speaker: wario, roll: 0.5, level: 'gentle' }));
    return soft.waluigi.amount === 18 && soft.wario.amount === 35 && harsh.wario.amount === 46 && gentle.wario.amount === 21 &&
      RP.bracedIn('I brace against the bulkhead') && !RP.bracedIn('I scream');
  })());
  check('wounds: whoever the model already filed [[HP:]] for is left to the model', (() => {
    const h = by(RP.hurtScan(crash, rm, { speaker: wario, roll: 0.5, filed: ['Wario'] }));
    return !h.wario && Boolean(h.sans) && Boolean(h.waluigi);
  })());
  check('wounds: talk of crashing, a near miss, a memory, a far-off bang and a sofa are not hits', (() => {
    const none = [
      '"We nearly crashed into the sea!" Wario laughs. "Crashing is an investment."',
      'He nearly falls from the roof, but Sans grabs his wrist.',
      'Years ago the mine collapsed on his father.',
      'Somewhere in the distance a building explodes.',
      'Wario crashes onto the couch and falls asleep.',
      'Wario punches the wall and swears.',
      'MOCK-MODEL REPLY #3: the blade goes in.',
    ];
    return none.every(t => RP.hurtScan(t, rm, { speaker: wario, roll: 0.5 }).length === 0);
  })());
  check('wounds: a blow lands on the one named or pointed at after the verb, never on the one swinging', (() => {
    const named = by(RP.hurtScan('Wario punches Sans in the face. Sans staggers.', rm, { speaker: wario, roll: 0.5 }));
    const him = by(RP.hurtScan('Sans grins. Wario punches him.', rm, { speaker: wario, roll: 0.5 }));
    const shot = by(RP.hurtScan('The bullet catches Wario in the shoulder and spins him round.', rm, { world: true, roll: 0.5 }));
    const you = by(RP.hurtScan('He slashes at you; the blade opens your sleeve and the skin under it.', rm, { speaker: wario, roll: 0.5 }));
    const me = by(RP.hurtScan('I go through the windscreen.', rm, { speaker: wario, roll: 0.5 }));
    return Object.keys(named).join() === 'sans' && named.sans.amount === 7 && named.sans.tier === 'light' &&
      Object.keys(him).join() === 'sans' &&
      Object.keys(shot).join() === 'wario' && shot.wario.amount === 17 && shot.wario.cause === 'the shot' &&
      Object.keys(you).join() === 'waluigi' && you.waluigi.cause === 'the blade' &&
      Object.keys(me).join() === 'wario' && me.wario.tier === 'heavy';
  })());
  check('wounds: a slammed door, a crashing wave and a punched wall are nobody’s; a person through a window is only theirs', (() => {
    const door = RP.hurtScan('The door slams into the wall behind him.', rm, { speaker: wario, roll: 0.5 });
    const wave = RP.hurtScan('Waves crash against the rocks below the pier.', rm, { speaker: wario, roll: 0.5 });
    const summit = RP.hurtScan('Wario crashes the summit through the front door.', rm, { speaker: wario, roll: 0.5 });
    const shotOf = RP.hurtScan('Sans pours Wario a shot of whisky. A long shot, he says.', rm, { speaker: sans, roll: 0.5 });
    const window = by(RP.hurtScan('Sans crashes through the window into the courtyard.', rm, { speaker: wario, roll: 0.5 }));
    return door.length === 0 && wave.length === 0 && summit.length === 0 && shotOf.length === 0 &&
      Object.keys(window).join() === 'sans' && window.sans.tier === 'heavy';
  })());
  check('wounds: one hit per person per turn — the worst of them', (() => {
    const h = by(RP.hurtScan('Sans kicks Wario. Then the grenade explodes under the table.', rm, { world: true, roll: 0 }));
    return h.wario.amount === 25 && h.wario.cause === 'the blast' && h.sans.amount === 25;
  })());
  check('wounds: a story room has no HP to lose, and a room without sheets files nothing', (() => {
    const story = RP.newRoom([wario], { statePreset: 'story' });
    const off = RP.newRoom([wario], { mechanics: 'off' });
    return RP.hurtScan(crash, story, { speaker: wario }).length === 0 && RP.hurtScan(crash, off, { speaker: wario }).length === 0;
  })());
  check('wounds: the order to file them rides in the prompt only when the turn has violence in it', (() => {
    const hot = RP.systemFor(st, rm, wario, { mentionText: 'I hold onto the seat as the aircraft crashes' });
    const calm = RP.systemFor(st, rm, wario, { mentionText: 'I pour the tea and sit down.' });
    const talk = RP.systemFor(st, rm, wario, { mentionText: '"I will crash this plane," I say, calmly.' });
    const world = RP.worldSystem(st, rm, { mentionText: 'I hold onto the seat as the aircraft crashes' });
    return /WOUNDS/.test(hot) && /\(the crash\)/.test(hot) && /25–45%/.test(hot) && !/WOUNDS/.test(calm) && !/WOUNDS/.test(talk) &&
      /WOUNDS/.test(world) && RP.dangerIn('He opens fire on the car.') === 'the shooting' && RP.dangerIn('We argue about rent.') === '';
  })());
  check('upkeep: "IN ORDER" files nothing', RP.applyUpkeep(st, rm, 'IN ORDER').lines.length === 0);
  check('upkeep: it spends from the same session budget as the book', (() => {
    const before = RP.bookBudgetLeft(st);
    RP.spendBudget(st);
    return RP.bookBudgetLeft(st) === before - 1;
  })());
}

// ---------- the doorman: arrivals and departures the prose forgot ----------
{
  check('doorman: a never-seen name who enters or speaks is caught',
    RP.arrivalScan('The door bangs open. Brad enters, shaking rain off his coat.', ['Sans']) === 'Brad' &&
    RP.arrivalScan('Brad says, "Anyone order a parcel?"', ['Sans']) === 'Brad' &&
    RP.arrivalScan('Brad: "Anyone here?"', ['Sans']) === 'Brad');
  check('doorman: known names, mere mentions, sentence-starters and mike are not arrivals',
    RP.arrivalScan('Sans enters the room again.', ['Sans']) === '' &&
    RP.arrivalScan('They talk about Brad for a while.', ['Sans']) === '' &&
    RP.arrivalScan('Suddenly the lights die.', ['Sans']) === '' &&
    RP.arrivalScan('Mike enters and waves.', ['Sans']) === '');
  check('doorman: an unambiguous walk-out is a departure — leaving a knife is not',
    RP.departureScan('Brad nods once. Brad leaves.', ['Brad', 'Sans']) === 'Brad' &&
    RP.departureScan('With a curse, Brad storms out into the rain.', ['Brad']) === 'Brad' &&
    RP.departureScan('Brad leaves the knife on the table.', ['Brad']) === '' &&
    RP.departureScan("Brad's patience is gone.", ['Brad']) === '');
  check('doorman: who leaves is remembered, and returns with the same sheet', (() => {
    const st = RP.blankState();
    const rm = RP.newRoom([sans], {});
    const names = () => rm.cast.map((c) => c.name);
    RP.applyDirectives(st, rm, RP.parseDirectives('[[ENTER: Brad — a courier]]', names()).directives, null);
    const brad = rm.cast.find((c) => c.name === 'Brad');
    RP.applyChange(rm.states[brad.id], { kind: 'item', op: '+', name: 'sealed letter' });
    RP.applyDirectives(st, rm, RP.parseDirectives('[[EXIT: Brad — done here]]', names()).directives, null);
    const held = rm.away.some((c) => c.id === brad.id) && !rm.cast.some((c) => c.id === brad.id);
    const out = RP.applyDirectives(st, rm, RP.parseDirectives('[[ENTER: Brad — back]]', names()).directives, null);
    const b2 = rm.cast.find((c) => c.name === 'Brad');
    return held && b2.id === brad.id &&
      rm.states[b2.id].items.some((i) => i.name.includes('letter')) &&
      /returns/.test(out.lines[0]);
  })());
  check('doorman: a fresh arrival is still dressed for the part', (() => {
    const st = RP.blankState();
    const rm = RP.newRoom([sans], {});
    RP.applyDirectives(st, rm,
      RP.parseDirectives('[[NEW: Vex | a wandering surgeon | grey gloves]]', rm.cast.map((c) => c.name)).directives, null);
    const vex = rm.cast.find((c) => c.name === 'Vex');
    const sheet = rm.states[vex.id];
    return sheet && sheet.items.length >= 2 && sheet.slots >= 3 &&
      typeof sheet.stats.might === 'number';
  })());
}

// ---------- Qwen voices: every mouth linked to a studio profile ----------
{
  check('tts: a speaker links to a studio profile by first name',
    RP.ttsVoiceFor('Wario Bigmouth', {}) === 'Wario' &&
    RP.ttsVoiceFor('sans', {}) === 'Sans');
  check('tts: the hand-written map wins, full name before first name',
    RP.ttsVoiceFor('Wario Bigmouth', { map: { wario: 'Wario Grande' } }) === 'Wario Grande' &&
    RP.ttsVoiceFor('Lady Aurelian', { map: { 'lady aurelian': 'Aurelian', lady: 'Wrong' } }) === 'Aurelian');
  check('tts: a known miss and a nameless narrator both take the fallback',
    RP.ttsVoiceFor('Brad', { misses: { brad: true }, fallback: 'Waluigi' }) === 'Waluigi' &&
    RP.ttsVoiceFor('', { fallback: 'Waluigi' }) === 'Waluigi');
  check('tts: the voice map parses lines and pipes, keys lowercased', (() => {
    const m = RP.parseVoiceMap('wario = Wario Grande | toad=Toad\nNarrator = Freeman');
    return m.wario === 'Wario Grande' && m.toad === 'Toad' && m.narrator === 'Freeman';
  })());
  check('tts: what is spoken is the words — tints speak, markdown stays silent',
    RP.ttsClean('**Sans** shrugs. {red|A drop falls.} [[HP: Sans -5]] *quietly*') ===
    'Sans shrugs. A drop falls. quietly');
  check('tts: chunks keep sentences whole and never exceed the size', (() => {
    const chunks = RP.ttsChunks('One. Two. ' + 'Word '.repeat(200) + '. End.', 100);
    return chunks[0] === 'One. Two.' && chunks.every((c) => c.length <= 100) &&
      RP.ttsChunks('Hello there.', 450).length === 1 && RP.ttsChunks('  ').length === 0;
  })());
  check('tts: when the studio library answers, it spells the voice — but a stale list does not mute anyone',
    RP.ttsVoiceFor('Wario Bigmouth', { library: ['Wario', 'Luigi'] }) === 'Wario' &&
    RP.ttsVoiceFor('wario', { library: ['Wario'] }) === 'Wario' &&
    // absent from the list, never tried: ask the studio anyway — /config is
    // a boot-time snapshot and can lag the real library (round 14)
    RP.ttsVoiceFor('Brad', { library: ['Wario'], fallback: 'Waluigi' }) === 'Brad' &&
    RP.ttsVoiceFor('Brad', { map: { brad: 'Freeman' }, library: ['Wario'], fallback: 'Waluigi' }) === 'Freeman' &&
    // absent AND already refused once: the fallback reads from here on
    RP.ttsVoiceFor('Brad', { library: ['Wario'], fallback: 'Waluigi', misses: { brad: true } }) === 'Waluigi' &&
    RP.ttsVoiceFor('Brad', { map: { brad: 'Freeman' }, library: ['Wario', 'Freeman'] }) === 'Freeman');
  check('tts: quotes are attributed to their speakers, narration to the narrator', (() => {
    const names = ['Wario', 'Sans'];
    const parts = RP.speechParts('Wario slams the table. "Pay up." Sans shrugs. "nah," Sans says.', names, 'Wario');
    return parts.length === 5 &&
      parts[0].who === '' && parts[1].who === 'Wario' && parts[1].text === 'Pay up.' &&
      parts[2].who === '' && parts[3].who === 'Sans' && parts[3].text === 'nah,';
  })());
  check('tts: every attribution shape lands — says-before, colon, verb-name, smart quotes', (() => {
    const names = ['Wario', 'Sans', 'Panicy Woman'];
    return RP.speechParts('Sans says, "took a shortcut."', names, '')[1].who === 'Sans' &&
      RP.speechParts('Wario: "MINE."', names, '')[1].who === 'Wario' &&
      RP.speechParts('"Out," snarls Wario.', names, '')[0].who === 'Wario' &&
      RP.speechParts('\u201csmart quotes,\u201d Panicy Woman whispers.', names, '')[0].who === 'Panicy Woman';
  })());
  check('tts: an unattributed quote is whoever is talking; world turns default to the narrator', (() => {
    const names = ['Wario', 'Sans'];
    const theirs = RP.speechParts('He grins. "Pay up." A pause. "Now."', names, 'Wario');
    const world = RP.speechParts('"hi," Sans says. The lights flicker. "still here?"', names, '');
    const plain = RP.speechParts('No quotes at all, just prose.', names, 'Wario');
    return theirs[1].who === 'Wario' && theirs[3].who === 'Wario' &&
      world[0].who === 'Sans' && world[world.length - 1].who === '' &&
      plain.length === 1 && plain[0].who === 'Wario';
  })());
  check('tts: the library spells every voice — lowercase in, studio casing out', (() => {
    const lib = ['Freeman', 'Luigi', 'Panicy Woman', 'Waluigi', 'Wario'];
    return RP.ttsVoiceFor('wario', { library: lib }) === 'Wario' &&
      RP.ttsVoiceFor('WARIO BIGMOUTH', { library: lib }) === 'Wario' &&
      RP.ttsVoiceFor('panicy woman', { library: lib }) === 'Panicy Woman' &&
      RP.ttsVoiceFor('Sans', { map: { sans: 'freeman' }, library: lib }) === 'Freeman' &&
      RP.ttsVoiceFor('Brad', { library: lib, fallback: 'waluigi', misses: { brad: true } }) === 'Waluigi' &&
      RP.ttsVoiceFor('', { library: lib, fallback: 'waluigi' }) === 'Waluigi';
  })());
}

// ---------- the prompt diet: sheets and history sized for a local model ----------
{
  const castDiet = ['Ana', 'Bo', 'Cyd', 'Dee'].map((nm) => RP.normChar({ id: nm.toLowerCase(), name: nm, title: 'A ' + nm }));
  const stDiet = RP.blankState();
  stDiet.persona = { name: 'Reader', voice: '', look: '', items: ['a ledger'], notes: '' };
  const rmDiet = RP.newRoom(castDiet, { kind: 'group' });
  RP.ensurePlayerSheet(stDiet, rmDiet);
  RP.applyChange(rmDiet.states.bo, { kind: 'hp', op: '-', value: 40 });
  check('diet: with a focus, only the actor and the player ride in full', (() => {
    const block = RP.stateBlock(rmDiet, 'ana');
    const lines = block.split('\n').filter((l) => l.startsWith('- '));
    return /- Ana:.*carrying/.test(block) && /THE PLAYER.*carrying/.test(block) &&
      /- Bo: HP 60\/100$/m.test(block) &&                       // wounded: one short line
      /- Untouched right now: Cyd, Dee/.test(block) &&          // quiet: one roll call
      !/- Cyd:/.test(block) && lines.length === 4;
  })());
  check('diet: without a focus the full sheets still ride (the reviewer needs them)', (() => {
    const block = RP.stateBlock(rmDiet);
    return /- Cyd:.*carrying/.test(block) && /- Dee:.*carrying/.test(block) && !/Untouched right now/.test(block);
  })());
  check('diet: old turns are clipped hard, the newest arrive whole', (() => {
    const msgs = [];
    for (let i = 0; i < 12; i++) msgs.push({ role: 'assistant', content: 'turn ' + i + ' ' + 'w'.repeat(1200) });
    const packed = RP.packHistory(msgs, 30000);
    const oldest = packed[0], newest = packed[packed.length - 1];
    return newest.content.length > 1000 && oldest.content.length <= RP.OLD_CLIP + 1 &&
      RP.OLD_CLIP < RP.TURN_CLIP;
  })());
  check('diet: the story folds into the recap sooner than it used to',
    RP.RECAP_AFTER <= 18 && RP.HISTORY_BUDGET <= 6500);
}

// ---------- the star is you: the pack follows the starred character ----------
{
  const castStar = ['Waluigi', 'Wario'].map((nm) => RP.normChar({ id: nm.toLowerCase(), name: nm, title: 'A ' + nm }));
  const stStar = RP.blankState();
  stStar.persona = { name: 'Archivist', voice: '', look: '', items: ['a ledger'], notes: '' };
  const rmStar = RP.newRoom(castStar, { kind: 'group' });
  RP.ensurePlayerSheet(stStar, rmStar);
  check('star: with nobody starred, the persona pack is yours',
    rmStar.states[RP.PLAYER_ID].player === true && RP.playerSheetId(rmStar) === RP.PLAYER_ID);
  check('star: starring a character makes THEIR sheet your pack', (() => {
    rmStar.youPlay = 'waluigi';
    const sheet = RP.ensurePlayerSheet(stStar, rmStar);
    return sheet === rmStar.states.waluigi && sheet.player === true && sheet.slots >= 12 &&
      rmStar.states[RP.PLAYER_ID].present === false &&        // the persona pack steps aside
      RP.playerSheetId(rmStar) === 'waluigi' &&
      /Waluigi \(THE PLAYER\)/.test(RP.stateBlock(rmStar, 'wario')) &&
      !/Archivist/.test(RP.stateBlock(rmStar, 'wario'));
  })());
  check('star: unstarring brings the persona pack back', (() => {
    rmStar.youPlay = '';
    RP.ensurePlayerSheet(stStar, rmStar);
    return rmStar.states[RP.PLAYER_ID].present === true && rmStar.states[RP.PLAYER_ID].player === true &&
      rmStar.states.waluigi.player === false;
  })());
}

// ---------- the fast lane: the voice starts now, the Director lands sooner ----------
{
  check('fast: a short lead chunk gets the voice talking before the long tail', (() => {
    const long = 'First line lands fast. ' + 'More of the story keeps going here with detail. '.repeat(20);
    const chunks = RP.ttsChunks(long, 450, 170);
    return chunks[0].length <= 170 && chunks.slice(1).every((c) => c.length <= 450) &&
      RP.ttsChunks(long, 450)[0].length > 170 &&               // no lead: unchanged
      RP.ttsChunks('Short.', 450, 170).length === 1;
  })());
  check('fast: the Director asks for a scene, not a monologue',
    RP.lengthBlock(RP.NARRATORS.director.length, false).tokens <= 700);
  check('fast: LOOKUP is told the scene it stands in is not a lookup',
    RP.DIRECTIVES.includes('Never LOOKUP the scene'));
}

// ---------- the grandfather clause: 🛠 Fix chat brings old rooms up to date ----------
{
  const stFix = RP.blankState();
  stFix.persona = { name: 'Archivist', voice: '', look: '', items: [], notes: '' };
  const rmFix = RP.newRoom([RP.normChar({ id: 'waluigi', name: 'Waluigi' }),
    RP.normChar({ id: 'wario', name: 'Wario', title: 'Old title', summary: 'Old summary' })], { kind: 'group' });
  rmFix.youPlay = 'waluigi';
  // an old room: sheets missing fields, cast copy frozen at creation
  rmFix.states = {
    waluigi: { id: 'waluigi', name: 'Waluigi', hp: { value: 100, max: 100 }, items: ['worn notepad'], present: true, player: true },
    wario: { id: 'wario', name: 'Wario', hp: { value: 100, max: 100 }, player: false },
  };
  const linesFix = RP.fixRoom(stFix, rmFix, { wario: { id: 'wario', name: 'Wario', title: 'The Explosive Accountant', summary: 'New summary' } });
  check('fix: the cast is re-read from the archive\u2019s current profiles',
    rmFix.cast[1].title === 'The Explosive Accountant' && linesFix.some((l) => /cast re-read/.test(l)));
  check('fix: old sheets are mended to the current shape without touching play state',
    typeof rmFix.states.wario.flags === 'object' && rmFix.states.wario.present === true &&
    rmFix.states.waluigi.items[0] === 'worn notepad' && linesFix.some((l) => /mended/.test(l)));
  check('fix: the star rules are re-run — the starred character is the pack',
    RP.playerSheetId(rmFix) === 'waluigi' && rmFix.states.waluigi.slots >= 12 &&
    linesFix.some((l) => /your pack: Waluigi/.test(l)));
  check('fix: a room with nothing to fix reports nothing',
    RP.fixRoom(stFix, RP.newRoom([RP.normChar({ id: 'x', name: 'X' })], { mechanics: 'off' }), {}).length === 0);
}

// ---------- the recap request itself fits the window ----------
{
  // A grandfathered room can owe hundreds of unfolded turns; sending them
  // all at once put 14,557 tokens into an 8,192-token window → HTTP 400.
  const owed = [];
  for (let i = 0; i < 300; i++) owed.push({ who: 'Wario', text: ('turn ' + i + ' ').repeat(40) });
  const big = RP.recapPrompt({}, owed, 'the story so far');
  check('recap: three hundred owed turns still fit the context window',
    big.length <= RP.RECAP_FOLD + 900 && /oldest were dropped for space/.test(big) &&
    big.includes('turn 299'));
  check('recap: a normal stretch is untouched',
    !/dropped for space/.test(RP.recapPrompt({}, owed.slice(0, 10), '')));
  check('lean: one model call per turn is the out-of-the-box setting',
    RP.BACKGROUND_DEFAULT === 'lean');
}

// ---------- the TTS audit: every stage of the pipeline, under pressure ----------
{
  const vNames = ['Waluigi', 'Wario', 'Mona', 'Ashley', 'Luigi'];
  // The reported card, verbatim shape: a Wario turn whose ONLY spoken line
  // is the PLAYER's — “…,” you say. That quote is YOUR voice, not Wario's.
  const reported = '*"The Tape and the Wario Files... it\'s my latest revision,"* you say, your voice steady ' +
    'despite the chill of the night.\n\nWario stands beside you, his arms crossed, listening intently. ' +
    'He remains silent as he processes the new details of the aftermath.';
  const rparts = RP.speechParts(reported, vNames, 'Wario', 'Waluigi');
  check('tts audit: “you say” inside another character\u2019s card is the player\u2019s line',
    rparts[0].who === 'Waluigi' && /latest revision/.test(rparts[0].text));
  check('tts audit: a character who only listens gets no voice at all',
    !rparts.some((p) => p.who === 'Wario') && rparts.some((p) => p.who === '' && /remains silent/.test(p.text)));
  check('tts audit: mixed dialogue splits speaker by speaker', (() => {
    const t = RP.speechParts('"Give it back," Wario snarled. "Fine," you reply.', vNames, 'Wario', 'Waluigi');
    return t.map((p) => p.who).join('|') === 'Wario||Waluigi|' &&
      t[0].text === 'Give it back,' && t[2].text === 'Fine,';
  })());
  check('tts audit: a leading “You mutter,” works as well as a trailing one',
    RP.speechParts('You mutter, "this cannot be right."', vNames, '', 'Waluigi')
      .some((p) => p.who === 'Waluigi' && /cannot be right/.test(p.text)));
  check('tts audit: unattributed speech still falls to the card\u2019s speaker',
    RP.speechParts('He grins. "Mine now."', vNames, 'Wario', 'Waluigi')
      .some((p) => p.who === 'Wario' && /Mine now/.test(p.text)));
  check('tts audit: smart quotes and named attribution survive together',
    RP.speechParts('\u201cWe trusted you,\u201d Ashley said coldly.', vNames, 'Wario', 'Waluigi')
      .some((p) => /ashley/i.test(p.who)));
  check('tts audit: without a player name the old contract holds (quote → card speaker)',
    RP.speechParts('"Hm," you say.', vNames, 'Wario')[0].who === 'Wario');
  check('tts audit: tints speak, directives and markdown stay silent', (() => {
    const c = RP.ttsClean('**He** lifts {crimson|the seal} high. [[HP: Wario -5]] *Done.*');
    return /the seal/.test(c) && !/\[\[/.test(c) && !/\*/.test(c) && !/crimson\|/.test(c);
  })());
  check('tts audit: a 12k-char storm chunks clean — nothing lost, caps held', (() => {
    const storm = ('The lantern gutters. "Keep moving," Wario growls. The tunnel narrows ahead of them. ').repeat(140);
    const chunks = RP.ttsChunks(storm, 450, 170);
    const squash = (s) => s.replace(/\s+/g, '');
    return chunks[0].length <= 170 && chunks.every((c) => c.length <= 450) &&
      squash(chunks.join(' ')) === squash(RP.ttsClean(storm));
  })());
  check('tts audit: empty and whitespace-only text produce no parts and no chunks',
    RP.speechParts('   ', vNames, 'Wario', 'Waluigi').length === 0 && RP.ttsChunks('  \n ', 450, 170).length === 0);
  check('tts audit: the library spells voices, a stale list gets one honest try, a miss ends it', (() => {
    const lib = ['Freeman', 'Luigi', 'Panicy Woman', 'Waluigi'];
    return RP.ttsVoiceFor('Wario', { map: {}, fallback: 'waluigi', library: lib }) === 'Wario' &&   // absent from the BOOT list → ask anyway
      RP.ttsVoiceFor('Wario', { map: {}, fallback: 'waluigi', library: lib, misses: { wario: true } }) === 'Waluigi' && // refused once → fallback, studio casing
      RP.ttsVoiceFor('luigi', { map: {}, fallback: 'Waluigi', library: lib }) === 'Luigi' &&        // present → case-corrected
      RP.ttsVoiceFor('Wario', { map: {}, fallback: 'Waluigi', library: lib.concat('Wario') }) === 'Wario'; // in the list → his own voice
  })());
}

// ---------- reasoning never reaches the page, the display, or history ----------
{
  check('think: a leaked <think> block is stripped before anything files it',
    RP.stripThink('<think>Let me consider who speaks…</think>Wario grins. "Mine."') === 'Wario grins. "Mine."');
  check('think: an unopened closer drops everything before it',
    RP.stripThink('I should reply in character.</think>"Wah," Waluigi says.') === '"Wah," Waluigi says.');
  check('think: an unclosed opener drops everything after it',
    RP.stripThink('"Done," he says. <think>Now, about the next turn') === '"Done," he says.');
  check('think: several blocks, case-insensitive, all go',
    RP.stripThink('<THINK>a</THINK>One. <think>b</think>Two.') === 'One. Two.');
  check('think: clean prose passes through untouched',
    RP.stripThink('Wario counts the coins twice.') === 'Wario counts the coins twice.');
}

// ---------- failures explain themselves — CORS is not the answer to everything ----------
{
  check('advice: a timeout blames the load, not CORS',
    /overloaded or hung/.test(RP.modelAdvice('timed out after 240s', true)) &&
    !/CORS/.test(RP.modelAdvice('timed out after 240s', true)));
  check('advice: a context overflow points at the window, not CORS',
    /context window/.test(RP.modelAdvice('request (14557 tokens) exceeds the available context size (8192 tokens)', true)) &&
    !/CORS/.test(RP.modelAdvice('request exceeds the available context size', true)));
  check('advice: an all-thinking reply points at instruct builds',
    /instruct/.test(RP.modelAdvice('the model spent its whole reply thinking and wrote no prose — use a non-thinking (instruct) build', true)));
  check('advice: only a network-level failure mentions CORS',
    /CORS/.test(RP.modelAdvice('Failed to fetch', true)) &&
    /LM Studio \(1234\)/.test(RP.modelAdvice('Failed to fetch', false)));
  check('advice: an unknown error gets no speculation',
    RP.modelAdvice('the model answered 500', true) === '');
}

// ---------- the toolbox audit: every stage direction, one reply, all land ----------
{
  const tbCast = [RP.normChar({ id: 'ana', name: 'Ana' }), RP.normChar({ id: 'bo', name: 'Bo' })];
  const tbState = RP.blankState();
  const tbRoom = RP.newRoom(tbCast, { kind: 'group', kit: 'off' });
  const everyTool = [
    '[[HP: Ana -12]]', '[[MP: Ana -5]]', '[[HP: Bo +0]]',
    '[[COND: Ana bleeding 3 -2hp | a deep cut]]',
    '[[COUNT: Bo arrows -2]]',
    '[[ITEM: Bo + 🗝 the brass key | bent]]',
    '[[EQUIP: Bo brass key]]',
    '[[STATUS: Ana winded, favouring one leg]]',
    '[[TINT: the brass key: dull gold]]',                 // the model's dialect, on purpose
    '[[SET: place = the ledger room]]',
    '[[TIME: a little after midnight]]',
    '[[REMEMBER: the vault | it opens with the brass key]]',
    'Ana staggers as Bo turns {dark red|the key} in the lock.',
  ].join('\n');
  const tbStaged = RP.parseDirectives(everyTool, tbCast.map((c) => c.name));
  RP.applyDirectives(tbState, tbRoom, tbStaged.directives, () => null);
  check('toolbox: HP, MP, COND, COUNT all land from one reply',
    tbRoom.states.ana.hp.value === 88 && tbRoom.states.ana.mp.value === 45 &&
    Boolean(tbRoom.states.ana.flags.bleeding) && tbRoom.states.bo.counters.arrows === -2);
  check('toolbox: ITEM arrives with its icon and note, and EQUIP puts it in hand', (() => {
    const key = (tbRoom.states.bo.items || []).map(RP.normItem).find((i) => /brass key/.test(i.name));
    return key && key.icon === '🗝' && /bent/.test(key.note) && key.equipped === true;
  })());
  check('toolbox: STATUS, SET, TIME and REMEMBER file where they belong',
    /winded/.test(tbRoom.states.ana.status) && tbRoom.facts.place === 'the ledger room' &&
    tbRoom.clock === 'a little after midnight' &&
    RP.bookState(tbState).entries.some((e) => /vault/.test(e.name) && /brass key/.test(e.text)));
  check('toolbox: the colon-form TINT files and colours the NEXT mention too', (() => {
    const html = RP.md(RP.applyTints('She pockets the brass key.', tbRoom.tints));
    return (tbRoom.tints || []).some((t) => t.text === 'the brass key') && /class="tint"/.test(html);
  })());
  check('toolbox: directives are stripped from the prose, the inline tint colours it',
    !/\[\[/.test(tbStaged.clean) && /dark red|tint/.test(RP.md(tbStaged.clean)));
  check('toolbox: CURE and UNTINT undo what COND and TINT did', (() => {
    RP.applyDirectives(tbState, tbRoom,
      RP.parseDirectives('[[CURE: Ana bleeding]]\n[[UNTINT: the brass key]]', ['Ana', 'Bo']).directives, () => null);
    return tbRoom.states.ana.flags.bleeding === undefined &&
      !(tbRoom.tints || []).some((t) => t.text === 'the brass key');
  })());
  check('toolbox: forgiving colours — descriptive phrasing lands, junk is still refused',
    RP.colourLoose('glowing violet') === RP.COLOURS.violet &&
    RP.colourLoose('blood red') === RP.COLOURS.red &&
    RP.colourLoose('javascript') === '' &&
    RP.parseDirectives('[[TINT: the seal = javascript]]', []).directives.length === 0);
}

// ---------- name a filing, get THAT filing — and the encouragement system ----------
{
  const pinIndex = [
    { id: 'tape_files', kind: 'event', name: 'The Tape and the Wario Files', body: 'Two days after Luigi was carried into the clinic, Waluigi sat in front of a VHS tape of the brothers\u2019 hallway argument and played it on loop.', words: 'tape wario files luigi clinic' },
    { id: 'shadow_pass', kind: 'event', name: 'The Siege of Shadow Pass', body: 'unrelated', words: 'siege shadow pass wario' },
    { id: 'wario', kind: 'person', name: 'Wario', body: 'bio', words: 'wario' },
  ];
  const pinned = RP.pinNamed('I look down at the paper titled The Tape and the Wario Files - The aftermath', pinIndex, {});
  check('pin: a filing named in the prose is pinned with its REAL opening text',
    pinned.length === 1 && pinned[0].id === 'tape_files' && pinned[0].named === true &&
    /VHS tape of the brothers/.test(pinned[0].snippet));
  check('pin: short or one-word names never pin by accident',
    RP.pinNamed('wario walks in grumbling', pinIndex, {}).length === 0);
  check('pin: the retrieval block stars it and forbids inventing its contents', (() => {
    const block = RP.retrievalBlock(pinned.concat([{ id: 'x', kind: 'event', name: 'Other', snippet: 's' }]));
    return /\u2605 \[event:tape_files\]/.test(block) && /NAMED in the scene/.test(block) &&
      /never invent its contents/.test(block) && !/\u2605 \[event:x\]/.test(block);
  })());
  check('pin: an unnamed scene adds no warning line',
    !/NAMED in the scene/.test(RP.retrievalBlock([{ id: 'x', kind: 'event', name: 'Other', snippet: 's' }])));

  const encState = RP.blankState();
  const encRoom = RP.newRoom([RP.normChar({ id: 'ana', name: 'Ana Bright' })], { kind: 'group' });
  for (let i = 0; i < 20; i++) encRoom.messages.push({ id: 'e' + i, role: i % 2 ? 'char' : 'user', charId: 'ana', text: 'talk ' + i, at: i });
  const firstNudge = RP.encourage(encRoom);
  check('encourage: a quiet room gets ONE conditional line — stakes first',
    /\[\[COND:/.test(firstNudge) && /quiet scene, carry on/.test(firstNudge));
  check('encourage: it does not nag — eight turns of silence between repeats',
    RP.encourage(encRoom) === '' || !/COND/.test(RP.encourage(encRoom)));
  check('encourage: compliance silences the nudge and the next tool takes its turn', (() => {
    RP.applyDirectives(encState, encRoom,
      RP.parseDirectives('[[HP: Ana Bright -5]]', ['Ana Bright']).directives, () => null);
    encRoom.nudgedAt = {};
    return (encRoom.toolAt || {}).stakes === encRoom.messages.length && /\[\[MOOD:/.test(RP.encourage(encRoom));
  })());
  check('encourage: young rooms and mechanics-off rooms are never nudged', (() => {
    const young = RP.newRoom([RP.normChar({ id: 'b', name: 'Bo' })], {});
    const off = RP.newRoom([RP.normChar({ id: 'c', name: 'Cy' })], { mechanics: 'off' });
    for (let i = 0; i < 20; i++) off.messages.push({ id: 'o' + i, role: 'user', text: 't', at: i });
    return RP.encourage(young) === '' && RP.encourage(off) === '';
  })());
}

// ---------- a phrase is not a person, a clause is not a claim ----------
{
  const known = ['Waluigi', 'Wario', 'Mona', 'Ashley', 'Luigi'];
  check('scan: a bullet-list header never walks into the cast',
    RP.arrivalScan('You are cornered.\n\n**Your Options:**\n\n1. **Search for a weapon:** look around.', known) === '' &&
    RP.arrivalScan('**Combat Options:** pick one', known) === '' &&
    RP.arrivalScan('Important: do not forget the key', known) === '');
  check('scan: real arrivals and real script lines still land',
    RP.arrivalScan('Kat bursts in through the window.', known) === 'Kat' &&
    RP.arrivalScan('Toadsworth: "The prince is missing."', known) === 'Toadsworth');
  const claimState = RP.blankState();
  const claimRoom = RP.newRoom([RP.normChar({ id: 'waluigi', name: 'Waluigi' })], { kind: 'group', kit: 'off' });
  claimRoom.youPlay = 'waluigi';
  RP.ensurePlayerSheet(claimState, claimRoom);
  check('claim: packing up your own unspecified stuff is not conjuring',
    RP.conjureCheck(claimRoom, 'I quickly grab my stuff since I am alone and head inside') === null);
  check('claim: the flagged phrase is the noun, not half the sentence', (() => {
    const w = RP.conjureCheck(claimRoom, 'I go into my pocket and grab my wallet how much gold is in there');
    return w && w.kind === 'conjured' && w.claim === 'wallet';
  })());
  check('claim: a real bluff is still caught', (() => {
    const b = RP.conjureCheck(claimRoom, 'I pull out my bazooka and aim it');
    return b && b.kind === 'conjured' && /bazooka/.test(b.claim);
  })());
  check('fix: 🛠 purges a false arrival from cast, sheets and rail', (() => {
    claimRoom.cast.push(RP.normChar({ id: 'your_options', name: 'Your Options' }));
    claimRoom.states.your_options = { id: 'your_options', name: 'Your Options', hp: { value: 100, max: 100 }, present: true };
    const lines = RP.fixRoom(claimState, claimRoom, {});
    return !claimRoom.cast.some((c) => c.id === 'your_options') && !claimRoom.states.your_options &&
      lines.some((l) => /false arrival: Your Options/.test(l));
  })());
}

// ---------- portable audio: studio WAV chunks become one downloadable file ----------
{
  const mkWav = (rate, samples) => {
    const buf = new ArrayBuffer(44 + samples.length * 2); const v = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    samples.forEach((x, i) => v.setInt16(44 + i * 2, x, true));
    return buf;
  };
  check('audio: WAV chunks join losslessly, in order, header rewritten', (() => {
    const j = RP.wavJoin([mkWav(24000, [1, 2, 3]), mkWav(24000, [7, 8])]);
    const v = new DataView(j);
    return j.byteLength === 54 && v.getInt16(44, true) === 1 && v.getInt16(50, true) === 7 &&
      v.getInt16(52, true) === 8 && v.getUint32(24, true) === 24000 && v.getUint32(40, true) === 10;
  })());
  check('audio: mixed sample rates are refused rather than chipmunked', (() => {
    try { RP.wavJoin([mkWav(24000, [1]), mkWav(48000, [1])]); return false; }
    catch (e) { return /mixed audio/.test(e.message); }
  })());
  check('audio: junk that is not a WAV is refused with plain words', (() => {
    try { RP.wavJoin([new ArrayBuffer(10)]); return false; }
    catch (e) { return /not a WAV/.test(e.message); }
  })());
}

// ---------- user control: a seat at the table can be removed ----------
{
  const rmState = RP.blankState();
  const rmRoom = RP.newRoom([RP.normChar({ id: 'ana', name: 'Ana' }), RP.normChar({ id: 'bo', name: 'Bo' })], { kind: 'group' });
  RP.ensurePlayerSheet(rmState, rmRoom);
  rmRoom.youPlay = 'bo'; rmRoom.next = 'bo';
  check('control: castRemove clears cast, sheet, star and the next-up slot', (() => {
    const name = RP.castRemove(rmRoom, 'bo');
    return name === 'Bo' && !rmRoom.cast.some((c) => c.id === 'bo') && !rmRoom.states.bo &&
      rmRoom.youPlay === '' && rmRoom.next === '';
  })());
  check('control: the player seat can never be removed',
    RP.castRemove(rmRoom, RP.PLAYER_ID) === '' && Boolean(rmRoom.states[RP.PLAYER_ID]));
  check('control: removing a stranger is a quiet no-op',
    RP.castRemove(rmRoom, 'nobody_here') === '' && rmRoom.cast.length === 1);
}

// ---------- audience mode: the room keeps breathing, inside the same call ----------
{
  const audCast = ['Waluigi', 'Wario', 'Mona', 'Ashley'].map((nm) => RP.normChar({ id: nm.toLowerCase(), name: nm }));
  const audState = RP.blankState();
  const audRoom = RP.newRoom(audCast, { kind: 'group' });
  audRoom.youPlay = 'waluigi';
  check('audience: silent present cast ride as a one-beat licence — speaker and player excluded', (() => {
    const b = RP.audienceBlock(audRoom, 'wario', 'on');
    return /THE AUDIENCE/.test(b) && /Mona, Ashley/.test(b) &&
      /murmur, never a speech/.test(b) && /silence is a valid reaction/.test(b) &&
      /never answer a question that was aimed at somebody else/.test(b);
  })());
  check('audience: a duel has no audience, the dial turns it off, solo rooms never see it', (() => {
    RP.setPresent(audRoom, 'mona', false); RP.setPresent(audRoom, 'ashley', false);
    return RP.audienceBlock(audRoom, 'wario', 'on') === '' &&
      RP.audienceBlock(audRoom, 'wario', 'off') === '' &&
      RP.audienceBlock(RP.newRoom([audCast[0]], { kind: 'solo' }), 'x', 'on') === '';
  })());
  check('audience: the block rides the character system prompt and costs one block, not one call', (() => {
    const fresh = RP.newRoom(audCast, { kind: 'group' });
    fresh.youPlay = 'waluigi';
    const sys = RP.systemFor(audState, fresh, audCast[1], {});
    return /THE AUDIENCE/.test(sys) && (sys.match(/THE AUDIENCE/g) || []).length === 1;
  })());
}

// ---------- generated pages are in sync with these sources ----------
let built = true;
try {
  execFileSync('python3', ['tools/build-chatroom.py', '--check'], { cwd: repoRoot, stdio: 'pipe' });
} catch (e) { built = false; console.log(String(e.stdout || '')); }
// ---------- round 4: direction, linked scenes, the studio's refusals ----------
check('direction: 🎬 files on the room, rides the protected tail of both prompts, and is clipped', (() => {
  const st = RP.blankState();
  const r = RP.newRoom([sans, cutters], { scene: 'The hangar.' });
  st.rooms.push(r); st.active = r.id;
  const d = RP.setDirection(r, '  The ceiling gives way. ' + 'x'.repeat(900));
  const charSys = RP.systemFor(st, r, sans, { budget: 4000 });
  const worldSys = RP.worldSystem(st, r, { budget: 4000 });
  const i = charSys.indexOf('THE READER DIRECTS THIS TURN');
  return d && d.text.length <= 601 && i > 0 && i > charSys.indexOf('IN-CHARACTER RULES') &&
    /it HAPPENS, now, in this turn/.test(charSys) && /never call it a direction/.test(charSys) &&
    worldSys.includes('THE READER DIRECTS THIS TURN') && worldSys.includes('The ceiling gives way') &&
    RP.setDirection(r, '   ') === null && r.direction === null && !RP.directionBlock(r);
})());
check('direction: a carried-over one names the scene it came from', (() => {
  const r = RP.newRoom([sans], {});
  RP.setDirection(r, 'A spotlight sweeps the yard from above.', 'Wario & Waluigi — the plane');
  return /carried over from the scene “Wario & Waluigi — the plane”/.test(RP.directionBlock(r));
})());
check('link: two rooms link both ways, see each other’s last turns, and only what would carry may cross', (() => {
  const st = RP.blankState();
  const a = RP.newRoom([sans, cutters], { scene: 'The cockpit.' });
  const b = RP.newRoom([rebel], { scene: 'The yard below.' });
  st.rooms.push(a, b);
  a.messages.push({ id: 'a1', role: 'user', text: 'I bank hard left and hit the spotlight.', at: 1 },
    { id: 'a2', role: 'char', charId: 'sans', text: 'heh. nice.', at: 2 },
    { id: 'a3', role: 'scene', text: 'a card for the reader', at: 3 },
    { id: 'a4', role: 'world', text: 'The beam swings down over the yard.', at: 4 });
  const ok = RP.linkRooms(a, b);
  const block = RP.meanwhileBlock(st, b);
  const sysB = RP.systemFor(st, b, rebel, {});
  const worldB = RP.worldSystem(st, b, {});
  const linesA = RP.meanwhileLines(st, a);
  return ok && a.linkedTo === b.id && b.linkedTo === a.id && RP.linkedRoom(st, a) === b &&
    /MEANWHILE, IN THE OTHER SCENE/.test(block) && block.includes('The cockpit') && block.includes('Sans: heh. nice.') &&
    block.includes('The scene: The beam swings') && !block.includes('a card for the reader') &&
    /What crosses is what physically would/.test(block) && /not yours to retell or answer/.test(block) &&
    sysB.includes('MEANWHILE, IN THE OTHER SCENE') && worldB.includes('MEANWHILE, IN THE OTHER SCENE') &&
    linesA.length === 3 && !RP.linkRooms(a, a) &&
    // b has no turns yet: a still knows it is there, who is in it, and that nothing has happened
    /nothing has happened there yet/.test(RP.meanwhileBlock(st, a)) && /there right now: Rebel Scout/.test(RP.meanwhileBlock(st, a)) &&
    /one clock/.test(block);
})());
check('link: blind scenes share nothing, unlink clears both sides, and a branch is its own hour', (() => {
  const st = RP.blankState();
  const a = RP.newRoom([sans], {});
  const b = RP.newRoom([rebel], {});
  st.rooms.push(a, b);
  b.messages.push({ id: 'b1', role: 'char', charId: 'rebel_scout', text: 'Down!', at: 1 });
  RP.linkRooms(a, b);
  a.linkMode = 'blind';
  const quiet = RP.meanwhileBlock(st, a);
  a.linkMode = '';
  const loud = RP.meanwhileBlock(st, a);
  const fork = RP.forkRoom(st, a, 'nope', {});
  const unlinked = RP.unlinkRoom(st, a);
  return quiet === '' && /Rebel Scout: Down!/.test(loud) && fork.linkedTo === '' &&
    unlinked && a.linkedTo === '' && b.linkedTo === '' && RP.linkedRoom(st, b) === null;
})());
check('export: two linked scenes come out as one transcript, by the clock, with a marker each time the camera moves', (() => {
  const st = RP.blankState();
  const a = RP.newRoom([sans, cutters], { scene: 'The cockpit.', sceneName: 'The plane' });
  const b = RP.newRoom([rebel], { scene: 'The yard below.', sceneName: 'The yard' });
  st.rooms.push(a, b);
  RP.linkRooms(a, b);
  a.messages.push({ id: 'a1', role: 'user', text: 'I bank hard left.', at: 10 },
    { id: 'a2', role: 'char', charId: 'sans', text: 'heh.', at: 20 },
    { id: 'a3', role: 'state', lines: ['a receipt'], at: 25 },
    { id: 'a4', role: 'char', charId: 'sans', text: 'a bad take', at: 26, error: true });
  b.messages.push({ id: 'b1', role: 'char', charId: 'rebel_scout', text: 'Down!', at: 15 },
    { id: 'b2', role: 'scene', direction: true, from: 'The plane', text: 'A spotlight sweeps the yard.', at: 30 },
    { id: 'b3', role: 'world', text: 'The beam finds them.', at: 40 },
    { id: 'b4', role: 'scene', text: 'a card for the reader', at: 41 });
  const md = RP.linkedTranscript(st, a, { user: 'Reader' });
  const txt = RP.linkedTranscript(st, a, { plain: true, user: 'Reader' });
  let at = 0;
  const sorted = ['### ⇄ The plane', 'Reader:** I bank', '### ⇄ The yard', 'Rebel Scout:** Down!', '### ⇄ The plane', 'Sans:** heh.',
    '### ⇄ The yard', '⟶ *from “The plane”* — A spotlight', 'Narrator:** The beam'].every(t => {
    const n = md.indexOf(t, at);
    if (n < 0) return false;
    at = n + t.length;
    return true;
  });
  const alone = RP.linkedTranscript(st, RP.newRoom([sans], { sceneName: 'Solo' }), {});
  return md.startsWith('# The plane ⇄ The yard') && sorted && !md.includes('a receipt') && !md.includes('a bad take') &&
    !md.includes('a card for the reader') &&
    txt.includes('— ⇄ The yard —') && txt.includes('[Carried over from The plane: A spotlight sweeps the yard.]') &&
    txt.includes('Reader: I bank hard left.') && !txt.includes('**') &&
    alone.startsWith('# Solo') && !alone.includes('⇄ ');
})());
check('export: a linked bundle carries both chats and the link, and re-imports linked', (() => {
  const st = RP.blankState();
  const a = RP.newRoom([sans], {});
  const b = RP.newRoom([rebel], {});
  st.rooms.push(a, b);
  RP.linkRooms(a, b);
  a.linkMode = 'blind'; b.linkMode = 'blind';
  st.log = [{ id: 'l1', roomId: a.id }, { id: 'l2', roomId: b.id }, { id: 'l3', roomId: 'elsewhere' }];
  const one = RP.chatExport(st, a);
  const both = RP.chatExport(st, a, { linked: true });
  const fresh = RP.blankState();
  RP.importBundle(fresh, JSON.parse(JSON.stringify(both)), 'merge');
  const back = fresh.rooms.find(r => r.id === a.id);
  return one.rooms.length === 1 && !one.link && one.log.length === 1 &&
    both.rooms.length === 2 && both.rooms[1].id === b.id && both.link.a === a.id && both.link.b === b.id &&
    both.link.mode === 'blind' && both.log.length === 2 &&
    back && RP.linkedRoom(fresh, back) && RP.linkedRoom(fresh, back).id === b.id;
})());
check('voice: a studio stream that errors is read for WHY — turned-away profile vs. a render that fell over', (() => {
  const refused = RP.studioError('event: error\ndata: {"message": "Value: Wario is not in the list of choices: [\'Freeman\', \'Luigi\']"}');
  const oom = RP.studioError('event: error\ndata: {"message": "CUDA out of memory"}');
  const mute = RP.studioError('event: error\ndata: null');
  const bare = RP.studioError('event: error\ndata: "voice profile not found"');
  const fine = RP.studioError('event: complete\ndata: [1, {"url": "http://x/a.wav"}, "ok"]');
  return refused && refused.refused && /Wario is not in the list/.test(refused.message) &&
    oom && !oom.refused && oom.message === 'CUDA out of memory' &&
    mute && !mute.refused && /reported an error/.test(mute.message) &&
    bare && bare.refused && fine === null;
})());

// ---------- round 10: colour shorthand, HP redefined, the body's limits, audit notes ----------
{
  check('colour: a bare {word} is coloured in the speaker\u2019s mood ink; every colour shorthand the model reaches for lands', (() => {
    const html = RP.md('I am still {pissed} enough. {red|blood} {the door|ice} {gold: the coin} {red}x{/red} [moss]y[/moss] <storm>z</storm> {a|b}');
    return /<span class="tint mood">pissed<\/span>/.test(html) && /style="color:#c0392b">blood</.test(html) && /#4a8fc7">the door</.test(html) &&
      /#a8862c">the coin</.test(html) && /#c0392b">x</.test(html) && /#5c7a3f">y</.test(html) && /#4c5a6e">z</.test(html) &&
      /\{a\|b\}/.test(html) && !/\{pissed\}/.test(html) && /simply \{the stain\}/.test(RP.RULES || RP.systemFor(RP.blankState(), RP.newRoom([sans], {}), sans, {}));
  })());
  const st = RP.blankState();
  const rm = RP.newRoom([sans], { title: 'The yard' });
  st.rooms.push(rm); st.active = rm.id;
  const you = RP.ensurePlayerSheet(st, rm);
  check('hp: [[HP: Name = 28/80]] redefines the sheet — the maximum moves too, and the line says so', (() => {
    const d = RP.parseDirectives('[[HP: Sans = 28/80]] [[MP: Sans 3/120]]', ['Sans']).directives;
    const sheet = RP.sheetFor(rm, sans.id);
    const line = RP.applyChange(sheet, d[0]);
    const mp = RP.applyChange(sheet, d[1]);
    const out = d[0].max === 80 && d[0].op === '=' && /Sans — HP redefined 28\/80 \(was 100\/100\)/.test(line) && sheet.hp.value === 28 && sheet.hp.max === 80 &&
      d[1].max === 120 && sheet.mp.max === 120 && sheet.mp.value === 3 && /redefined/.test(mp) &&
      /\[\[HP: Name = 28\/80\]\]/.test(RP.sheetAuditPrompt([rm], {})) && /NOTE:/.test(RP.sheetAuditPrompt([rm], {}));
    sheet.hp = { value: 100, max: 100 }; sheet.mp = { value: 50, max: 50 };
    return out;
  })());
  check('body: a limping player cannot parkour — the roll is tilted to the floor, the chip says why, and the prompt refuses the body before the world', (() => {
    you.flags = { limping: { note: 'the crash', turns: 0 } };
    const stop = RP.bodyCheck(you, 'I parkour up the side of the building.');
    const walk = RP.bodyCheck(you, 'I walk over and talk to him.');
    const scale = RP.attemptScale('I parkour up the side of the building.', you, null);
    const fate = RP.rollFate(st, rm, { text: 'I parkour up the side of the building.', roll: 0.5 });
    const beyond = RP.beyondBlock(fate);
    const sys = RP.systemFor(st, rm, sans, {});
    const refusals = [0, 0.3, 0.6, 0.9].map(roll => RP.rollFate(st, rm, { text: 'I parkour up the side of the building.', roll }).key);
    const out = stop && /limping \(the crash\)/.test(stop.why) && stop.what === 'parkour' && walk === null && scale === 'unfit' &&
      fate.scale === 'unfit' && /🩼 limping \(the crash\) \(−3\)/.test(fate.pill) && /THE BODY REFUSES — /.test(beyond) && /“parkour” is beyond/.test(beyond) &&
      /THE PLAYER\u2019S BODY — /.test(sys) && /limping/.test(sys) && !refusals.includes('triumph') && refusals.includes('refusal') &&
      sys.indexOf('THE PLAYER\u2019S BODY') > sys.indexOf('DIRECTIVES');
    you.flags = {};
    you.hp = { value: 20, max: 100 };
    const hurt = RP.bodyCheck(you, 'I sprint after the truck.');
    const still = RP.bodyCheck(you, 'I lie still and listen.');
    you.hp = { value: 0, max: 100 };
    const down = RP.bodyCheck(you, 'I stand up and shout.');
    const crawl = RP.bodyCheck(you, 'I crawl towards the door.');
    you.hp = { value: 100, max: 100 };
    return out && hurt && /at 20\/100 HP/.test(hurt.why) && still === null && down && /0\/100|down/i.test(down.why) && crawl === null &&
      RP.bodyCheck(you, 'I sprint after the truck.') === null && RP.playerBodyBlock(rm) === '';
  })());
  check('audit notes: NOTE lines are read (three at most), ride on the next turn as FROM THE AUDIT, and nothing is sent when there are none', (() => {
    const notes = RP.parseAuditNotes('[[HP: Sans = 40]]\nNOTE: Sans at 28 HP should not be charging; next turn show the limp.\n- NOTE: Bowser has not spoken in ten turns.\nnote: lowercase too\nNOTE: a fourth that is dropped');
    rm.auditNotes = notes.slice(0, 2);
    const block = RP.auditNoteBlock(rm);
    const sys = RP.systemFor(st, rm, sans, {});
    const world = RP.worldSystem(st, rm, {});
    rm.auditNotes = [];
    return notes.length === 3 && /show the limp/.test(notes[0]) && notes[2] === 'lowercase too' && /FROM THE AUDIT/.test(block) && /show the limp/.test(block) &&
      /FROM THE AUDIT/.test(sys) && /FROM THE AUDIT/.test(world) && RP.auditNoteBlock(rm) === '' && !/FROM THE AUDIT/.test(RP.systemFor(st, rm, sans, {})) &&
      RP.parseAuditNotes('IN ORDER').length === 0;
  })());
}

// ---------- round 10: ⇄ merge and @ ----------
{
  const wario = RP.normChar({ id: 'wario', name: 'Wario', title: 'Debt-maker' });
  const bowser = RP.normChar({ id: 'bowser', name: 'Bowser', title: 'King' });
  const st = RP.blankState();
  const a = RP.newRoom([wario, sans], { kind: 'group', title: 'The pavement' });
  const b = RP.newRoom([wario, bowser], { kind: 'group', title: 'The hangar roof' });
  st.rooms.push(a, b); st.active = a.id; RP.linkRooms(a, b);
  RP.ensurePlayerSheet(st, a); RP.ensurePlayerSheet(st, b);
  st.book.entries.push({ id: 'e1', kind: 'THING', name: 'The Hangar Beast', text: 'A grey thing with too many claws, seen on the roof.', roomId: b.id, roomTitle: 'The hangar roof' });
  check('@: what can be pointed at — here, the other scene, the lore book; the archive only once two letters are typed; a walker is “in the other scene”, not merely written out', (() => {
    const all = RP.mentionables(st, a, { peach: { id: 'peach', name: 'Peach', title: 'Princess' } }, '');
    const pe = RP.mentionables(st, a, { peach: { id: 'peach', name: 'Peach', title: 'Princess' } }, 'pe');
    RP.setPresent(a, sans.id, false); RP.addToRoom(b, sans);
    const walked = RP.mentionables(st, a, {}, 'sans')[0];
    RP.castRemove(b, sans.id); RP.setPresent(a, sans.id, true);
    return all.map(c => c.kind + ':' + c.name).join() === 'here:Wario,here:Sans,other:Bowser,book:The Hangar Beast' &&
      pe.length === 1 && pe[0].kind === 'archive' && walked && walked.kind === 'other' && walked.roomId === b.id &&
      RP.MENTION_KINDS.other === 'in the other scene';
  })());
  check('@: the @ signs come out, the pointers stay, a stray @nobody is left alone, and the model is told who was meant — a wall apart', (() => {
    const cands = RP.mentionables(st, a, {}, '');
    const parsed = RP.parseMentions('@Bowser, did you see @[The Hangar Beast]? @Sans stay. @nobody', cands);
    const block = RP.pingBlock(st, a, parsed.mentions, {});
    const sys = RP.systemFor(st, a, wario, { mentions: parsed.mentions, catalog: {} });
    return parsed.clean === 'Bowser, did you see The Hangar Beast? Sans stay. @nobody' && parsed.mentions.length === 3 &&
      parsed.mentions.map(m => m.kind).sort().join() === 'book,here,other' && /NAMED BY THE PLAYER/.test(block) &&
      /Bowser — in the other scene right now, “The hangar roof” \(100\/100 HP\)\. A wall apart/.test(block) && /The Hangar Beast — thing, from the lore book/.test(block) &&
      /too many claws, seen on the roof\. The same one/.test(block) && !/- Sans/.test(block) && /Nobody listed here walks in/.test(block) &&
      /NAMED BY THE PLAYER/.test(sys) && RP.pingBlock(st, a, [], {}) === '' && RP.pingBlock(st, a, [{ id: sans.id, name: 'Sans', kind: 'here' }], {}) === '';
  })());
  check('⇄ merge: everybody in one place, both streams by the clock with a camera card at each cut, sheets and facts kept, the link gone, undo whole', (() => {
    b.messages.push({ id: 'm1', role: 'user', text: 'I open the engine.', at: 1000 });
    b.messages.push({ id: 'm2', role: 'char', charId: 'bowser', text: 'Bowser growls.', at: 2000 });
    a.messages.push({ id: 'm3', role: 'user', text: 'I wait on the pavement.', at: 1500 });
    a.messages.push({ id: 'm4', role: 'char', charId: 'sans', text: 'heh.', at: 2500 });
    b.states.bowser.hp.value = 50; a.facts = { place: 'the pavement' }; b.facts = { place: 'the roof', weather: 'rain' }; b.clock = '23:40';
    RP.pushUndo(a, 'merging');
    a.undo[a.undo.length - 1].linkedTo = b.id;
    const rep = RP.mergeRooms(st, a, b, {});
    const order = a.messages.map(m => m.role === 'scene' ? '[' + m.text + ']' : m.role + ':' + RP.textOf(m)).join(' | ');
    const merged = rep && rep.joined.join() === 'Bowser' && rep.already.join() === 'Wario' && rep.turns === 2 && rep.cards === 4 &&
      order === '[⇄ The hangar roof] | user:I open the engine. | [⇄ The pavement] | user:I wait on the pavement. | [⇄ The hangar roof] | char:Bowser growls. | [⇄ The pavement] | char:heh. | state:' &&
      a.cast.map(c => c.name).join() === 'Wario,Sans,Bowser' && a.states.bowser.hp.value === 50 && a.facts.place === 'the pavement' && a.facts.weather === 'rain' &&
      a.clock === '23:40' && !a.linkedTo && !b.linkedTo && b.mergedInto === a.id && !RP.linkedRoom(st, a) &&
      a.messages[a.messages.length - 1].role === 'state' && a.messages[a.messages.length - 1].merged && !a.recapAt && !a.recap &&
      a.messages.filter(m => m.camera).every(m => m.role === 'scene') && !RP.historyFor(st, a).some(x => /⇄/.test(x.content || ''));
    RP.undo(a);
    const back = a.cast.length === 2 && !a.messages.some(m => m.camera) && a.linkedTo === b.id && RP.linkedRoom(st, a) === b && a.clock !== '23:40';
    return merged && back;
  })());
}

// ---- round 12: the room on its own cards, the same moment, fresh turns, down and brought round, Energy, the full audit ----
{
  const st = RP.blankState();
  const four = ['Waluigi', 'Wario', 'Mona', 'Ashley'].map(nm => RP.normChar({ id: nm.toLowerCase(), name: nm }));
  const rm = RP.newRoom(four, { kind: 'group', title: 'The ledger room' });
  rm.youPlay = 'waluigi';
  const wario = four[1], mona = four[2];
  check('the room: three settings, full by default — off says nothing, on asks for a murmur, full asks for proper replies on their own “Name:” paragraphs', (() => {
    const off = RP.audienceBlock(rm, 'wario', 'off'), on = RP.audienceBlock(rm, 'wario', 'on'), full = RP.audienceBlock(rm, 'wario', 'full');
    return RP.AUDIENCE_DEFAULT === 'full' && Object.keys(RP.AUDIENCE).join() === 'off,on,full' && off === '' &&
      /not speaking this turn: Mona, Ashley\./.test(on) && /ONE short beat/.test(on) && /a murmur, never a speech/.test(on) &&
      /not speaking this turn: Mona, Ashley\./.test(full) && /up to TWO of them MAY answer the moment properly/.test(full) && /two to four sentences/.test(full) &&
      /never the same beat they gave last time/.test(full) && !/Waluigi/.test(full) && RP.audienceBlock(rm, 'mona', 'full').indexOf('Wario, Ashley') > 0;
  })());
  check('the room: trailing “Name:” paragraphs are cut out of the reply and handed to that person; the player’s are dropped; mid-line names are left alone; the speaker’s own label is only a label', (() => {
    const reply = '*Wario slams the desk.* "Pay up, string bean."\n*He waits, breathing through his nose.*\n\nMona: *She does not look up from the register.* "He means it this time."\n"Don\'t make him count to three."\nAshley: *rolls her eyes* "Boring."';
    const cut = RP.splitChorus(reply, 'Wario', ['Mona', 'Ashley'], ['Waluigi']);
    const player = RP.splitChorus('*He shrugs.*\nWaluigi: "I pay."', 'Wario', ['Mona'], ['Waluigi']);
    const allNames = RP.splitChorus('Mona: "hi"\nWario: "no"', 'Wario', ['Mona'], []);
    const mid = RP.splitChorus('*He says it plainly.* Mona: "what"\nand then some more prose.', 'Wario', ['Mona'], []);
    const own = RP.splitChorus('*He waits.*\nWario: "And another thing."', 'Wario', ['Mona'], []);
    return cut.main === '*Wario slams the desk.* "Pay up, string bean."\n*He waits, breathing through his nose.*' && cut.pieces.length === 2 &&
      cut.pieces[0].name === 'Mona' && /^\*She does not look up/.test(cut.pieces[0].text) && /count to three\."$/.test(cut.pieces[0].text) &&
      cut.pieces[1].name === 'Ashley' && cut.pieces[1].text === '*rolls her eyes* "Boring."' && cut.dropped.length === 0 &&
      player.main === '*He shrugs.*' && player.pieces.length === 0 && player.dropped.length === 1 && /Waluigi/.test(player.dropped[0]) &&
      allNames.pieces.length === 1 && allNames.pieces[0].name === 'Mona' && allNames.main === '"no"' && mid.pieces.length === 0 && mid.main === '*He says it plainly.* Mona: "what"\nand then some more prose.' &&
      own.pieces.length === 0 && own.main === '*He waits.*\nWario: "And another thing."';
  })());
  check('the room: names match loosely (MR L, Mr.L, a first name alone); “Narrator:” is the world’s; a label nobody knows stays in the text; a reply that is only somebody else’s lines is left whole', (() => {
    const loose = RP.splitChorus('*He counts.*\n\nMR L: *from the stairs* "Brother."\nmona: "Not now."', 'Wario', ['Mr. L', 'Mona Pizza'], ['Waluigi']);
    const told = RP.splitChorus('*He counts.*\n\nNarrator: The lights go out.\n**Mona:** "Who did that?"', 'Wario', ['Mona'], [], { narrator: 'The Director' });
    const stranger = RP.splitChorus('*He counts.*\n\nGarlic Vendor: "Fresh bulbs!"', 'Wario', ['Mona'], []);
    const theirs = RP.splitChorus('Mona: "hi"\nAshley: "no"', 'Wario', ['Mona', 'Ashley'], []);
    const dash = RP.splitChorus('*He counts.*\n- Mona: "one"', 'Wario', ['Mona'], []);
    return loose.pieces.length === 2 && loose.pieces[0].name === 'Mr. L' && loose.pieces[0].kind === 'cast' && /^\*from the stairs\*/.test(loose.pieces[0].text) &&
      loose.pieces[1].name === 'Mona Pizza' && loose.main === '*He counts.*' &&
      told.pieces.length === 2 && told.pieces[0].kind === 'narrator' && told.pieces[0].name === 'The Director' && told.pieces[0].text === 'The lights go out.' &&
      told.pieces[1].name === 'Mona' && told.pieces[1].text === '"Who did that?"' &&
      stranger.pieces.length === 0 && stranger.unknown.length === 1 && stranger.unknown[0].name === 'Garlic Vendor' && /Garlic Vendor: "Fresh bulbs!"/.test(stranger.main) &&
      theirs.pieces.length === 0 && theirs.main.indexOf('Mona:') === 0 &&
      dash.pieces.length === 1 && dash.pieces[0].text === '"one"' && RP.nameKey('Mr. L') === RP.nameKey('MR L') && RP.nameKey('mr.l') === 'mrl';
  })());
  check('the same moment: the block names who has acted and who is still to, insists nothing has landed, and rides the prompt only when asked; the history labels the turn', (() => {
    const block = RP.momentBlock(rm, wario, { same: true, done: ['Mona'], pending: ['Ashley'] });
    const alone = RP.momentBlock(rm, wario, { same: true, done: [], pending: [] });
    const turns = RP.momentBlock(rm, wario, { same: false, done: ['Mona'], pending: [] });
    const sys = RP.systemFor(st, rm, wario, { moment: { same: true, done: ['Mona'], pending: ['Ashley'] } });
    const calm = RP.systemFor(st, rm, wario, {});
    rm.messages.push({ id: 'x1', role: 'char', charId: 'mona', text: 'She runs for the door.', at: 1, moment: 'g1' });
    rm.messages.push({ id: 'x2', role: 'char', charId: 'wario', text: 'He fires twice.', at: 2, moment: 'g1', same: true });
    const hist = RP.historyFor(rm);
    rm.messages = [];
    return /THE SAME MOMENT/.test(block) && /Mona’s turn just above, happen AT THE SAME TIME as Wario’s turn/.test(block) &&
      /Nobody has finished; nothing above has landed/.test(block) && /Ashley act in the same seconds too, written after you/.test(block) &&
      /do not write their words/.test(block) && /last turn happens AT THE SAME TIME/.test(alone) && !/just above/.test(alone) && turns === '' &&
      /THE SAME MOMENT/.test(sys) && sys.indexOf('THE SAME MOMENT') < sys.indexOf('STAGE DIRECTIONS') && !/THE SAME MOMENT/.test(calm) &&
      hist.some(h => h.content === 'Wario (at the same moment): He fires twice.') && hist.some(h => h.content === 'Mona: She runs for the door.');
  })());
  // fresh turns
  const say = (id, text, i) => rm.messages.push({ id: 'f' + id + i, role: 'char', charId: id, text, at: 1000 + i });
  for (let i = 0; i < 6; i++) {
    say('wario', 'WAH! I will sue you for every coin, string bean! The invoice says you owe me a premium asset fee. *He waves the invoice.* Sign the invoice or I sue.', i * 3);
    rm.messages.push({ id: 'u' + i, role: 'user', text: 'I shrug and look at the helicopter.', at: 1001 + i * 3 });
    say('mona', ['The helicopter is still burning.', '"Nobody is signing anything."', 'She counts the till again, slowly.', '"Where did the pilot go?"', 'A siren, far off, getting no closer.', 'She slides the register shut.'][i], i * 3 + 2);
  }
  check('fresh turns: a character who has worn the same phrases, subject and opener for turns is told exactly what not to use; one who has not gets nothing; off says nothing', (() => {
    const bits = RP.staleBits(rm, 'wario');
    const block = RP.freshnessBlock(rm, wario, 'strict');
    const soft = RP.freshnessBlock(rm, wario, 'on');
    return RP.FRESH_DEFAULT === 'strict' && Object.keys(RP.FRESH).join() === 'strict,on,off' && bits.turns === 6 &&
      bits.phrases.includes('a premium asset fee') && bits.themes.includes('sue') && bits.themes.includes('invoice') === false && bits.opener === 'wah i' &&
      /FRESH TURN — Wario has started repeating themselves/.test(block) && /“a premium asset fee”/.test(block) && /this subject yet again: sue, coin, invoice/.test(block) &&
      /the opening “wah i…”/.test(block) && /ONE move Wario has not made in this scene/.test(block) && /end the turn with something changed/.test(block) &&
      soft.length > 0 && soft.length <= block.length && RP.freshnessBlock(rm, wario, 'off') === '' && RP.freshnessBlock(rm, mona, 'strict') === '';
  })());
  check('fresh turns: the block rides the prompt in the protected tail, and a reply that is the old beats again is caught while a new move is not', (() => {
    const sys = RP.systemFor(st, rm, wario, {});
    const prior = RP.priorTurns(rm, 'wario');
    const stale = RP.repeatCheck('I will sue you for every coin, you owe me a premium asset fee.', prior);
    const fresh = RP.repeatCheck('*He sits down on the kerb and takes his hat off.* "Fine. Keep the chopper. I want the ledger, and your brother\'s name on it."', prior);
    const nothing = RP.repeatCheck('Anything at all.', []);
    return /FRESH TURN/.test(sys) && sys.indexOf('FRESH TURN') > sys.indexOf('STAGE DIRECTIONS') && prior.length === 6 &&
      stale.stale === true && stale.ratio > 0.5 && stale.hits.includes('a premium asset') && fresh.stale === false && fresh.hits.length === 0 && nothing.stale === false &&
      RP.FRESH_TURNS === 12;
  })());
  rm.messages = [];
  check('used material: a filing whose words come back in the reply is named; one that does not is not', (() => {
    const hits = [{ name: 'Ridge filing', snippet: 'The ridge road floods every autumn, the concession knows it.' }, { name: 'Other', snippet: 'Nothing about Marguerite here.' }];
    const used = RP.usedMaterial('"The Ridge Road floods every autumn," he says.', hits, ['Wario']);
    return used.length === 1 && used[0] === 'Ridge filing' && RP.usedMaterial('He says nothing.', hits, []).length === 0;
  })());
  // down, and brought round
  const w = rm.states.wario;
  check('down: HP reaching 0 marks the sheet down, with the note the prompt reads; back above 0 clears it', (() => {
    const line = RP.applyChange(w, { kind: 'hp', op: '-', value: 500 });
    const flagged = Boolean(w.flags.down) && /barely conscious/.test(w.flags.down.note) && w.flags.down.turns === 0;
    const body = RP.bodyBlock(rm, wario);
    const sys = RP.systemFor(st, rm, wario, {});
    const up = RP.applyChange(w, { kind: 'hp', op: '=', value: 30 });
    const cleared = !w.flags.down;
    return /Wario −100 HP \(0\/100\) — down/.test(line) && flagged && /DOWN at 0 HP: barely conscious/.test(body) && /cannot fight, run or lead/.test(body) &&
      /DOWN at 0 HP/.test(sys) && /Wario \+30 HP \(30\/100\) — back up/.test(up) && cleared && RP.fixDown(rm).length === 0;
  })());
  check('down: a sheet put at 0 by hand is picked up by the sweep; the prompt says DOWN; the dock blurb exists', (() => {
    w.hp.value = 0; delete w.flags.down;
    const lines = RP.fixDown(rm);
    return lines.length === 1 && lines[0] === 'Wario is DOWN' && Boolean(w.flags.down) && /DOWN at 0 HP/.test(RP.systemFor(st, rm, wario, {})) && typeof RP.DOWN_NOTE === 'string';
  })());
  check('revived: a slap, water or smelling salts in the player’s own line brings a downed person round — a sliver of HP, barely conscious for three turns, down lifted — and nobody who is up', (() => {
    const found = RP.reviveScan('I crouch and slap Wario across the face. "Wake up, fatso."', rm);
    const nobody = RP.reviveScan('I wake up and stretch.', rm);
    const mine = RP.reviveScan('I slap Mona awake.', rm);          // Mona is at full HP
    const line = RP.revive(w, found[0].how);
    const after = w.hp.value === 5 && !w.flags.down && Boolean(w.flags.barely_conscious) && w.flags.barely_conscious.turns === 3;
    const water = RP.reviveScan('I throw a bucket of water over Wario.', rm);     // he is up now — nothing to revive
    return found.length === 1 && found[0].id === 'wario' && found[0].how === 'slap' && nobody.length === 0 && mine.length === 0 &&
      line === '⛑ Wario comes round at 5/100 HP — slapped awake; barely conscious' && /slapped awake/.test(w.flags.barely_conscious.note) && after && water.length === 0;
  })());
  check('vigour: a downed speaker written leaping and roaring is caught; a crawl, a cough or a word is not; nobody who is up is checked', (() => {
    RP.applyChange(w, { kind: 'hp', op: '-', value: 50 });
    const roar = RP.vigourCheck('*Wario erupts off the floor, roaring.* "WAH!"', w);
    const crawl = RP.vigourCheck('*Wario tries to stand up and cannot; his hand will not close.* "...wah."', w);
    const cough = RP.vigourCheck('*He coughs, and reaches for the coin.*', w);
    RP.applyChange(w, { kind: 'hp', op: '=', value: 40 });
    const up = RP.vigourCheck('*Wario erupts off the floor, roaring.*', w);
    return roar && /DOWN at 0 HP/.test(roar.why) && roar.what === 'erupts' && crawl === null && cough === null && up === null;
  })());
  // ⚡ Energy
  check('energy: one pool, named Energy — [[EN:]], [[STAMINA:]] and the old [[MP:]] all move it, a condition can drain it, and the directive line says so', (() => {
    const d = RP.parseDirectives('text [[EN: Wario -5]] [[STAMINA: Mona +2]] [[MP: Ashley -1]] [[COND: Mona winded 2 -1en | ran]]', four.map(c => c.name)).directives;
    const line = RP.applyChange(w, { kind: 'mp', op: '-', value: 5 });
    const sys = RP.systemFor(st, rm, wario, {});
    return d.length === 4 && d.slice(0, 3).every(x => x.kind === 'mp') && d[3].effect === '-1mp' && /Wario −5 Energy \(45\/50\)/.test(line) &&
      /\[\[EN: Name -5\]\]/.test(sys) && /Energy \d+\/\d+/.test(sys) && !/\bMP\b/.test(sys) && /Energy/.test(RP.stateBlock(rm, 'wario'));
  })());
  check('energy: effort and magic in the prose cost it, talk does not, and the pool climbs back for everyone who did not spend it this turn', (() => {
    const run = RP.exertScan('*He sprints for the door.*', w), hex = RP.exertScan('*She casts a hex at the lock.*', w), talk = RP.exertScan('"Hello."', w);
    w.mp.value = 20; rm.states.mona.mp.value = 20;
    const lines = RP.regenEnergy(rm, ['wario']);
    const monaUp = rm.states.mona.mp.value, warioHeld = w.mp.value;
    rm.states.mona.mp.value = rm.states.mona.mp.max - 1;
    const back = RP.regenEnergy(rm, []);
    return run && run.kind === 'effort' && run.amount === 3 && run.cause === 'sprints' && hex && hex.kind === 'magic' && hex.amount > run.amount && talk === null &&
      lines.length === 0 && monaUp === 22 && warioHeld === 20 && back.some(l => /⚡ Mona has their breath back \(50\/50\)/.test(l)) && w.mp.value === 22;
  })());
  check('full audit: the prompt reads more turns, judges the record at the root, and asks for up to five notes; the quick one does not', (() => {
    const quick = RP.sheetAuditPrompt([rm], { [rm.id]: [] }, {});
    const full = RP.sheetAuditPrompt([rm], { [rm.id]: [] }, { full: true });
    const notes = RP.parseAuditNotes('NOTE: one\nNOTE: two\nNOTE: three\nNOTE: four\nNOTE: five\nNOTE: six', 5);
    return /HP and Energy/.test(full) && /FULL AUDIT/.test(full) && /up to FIVE/.test(full) && /\[\[EN: Name = current\/max\]\]/.test(full) &&
      !/FULL AUDIT/.test(quick) && /Anyone at 0 HP is DOWN/.test(quick) && RP.AUDIT_TURNS_FULL === 40 && notes.length === 5;
  })());
}

// ---------- round 16: anti-repetition, anti-generic, scene creation & handovers ----------
{
  check('anti-repetition: intra-turn loops and sentence stutters are detected and cleaned', (() => {
    const loopText = 'He pointed at the safe. He pointed at the safe. Waluigi stared back.';
    const found = RP.findRepetitionLoops(loopText);
    const cleaned = RP.cleanRepetitionLoops(loopText);
    return found.hasLoop && found.loops.length >= 1 && cleaned === 'He pointed at the safe. Waluigi stared back.';
  })());

  check('anti-repetition: player turn echoing is detected at the start of a reply', (() => {
    const userText = 'I drop the ledger on the table and ask about the missing gold.';
    const botEcho = '*You drop the ledger on the table.* Wario glares at you.';
    const nonEcho = '*Wario slams his fist on the mahogany.* "Where is the rest?"';
    return RP.detectEcho(botEcho, userText).hasEcho === true &&
      RP.detectEcho(nonEcho, userText).hasEcho === false;
  })());

  check('anti-repetition: structural and cadence formula loops are identified', (() => {
    const prior = [
      'WAH! THE LEDGER IS MINE! I will sue you for every coin! *Wario shakes his fist.*',
      'WAH! YOU CHEATED ME! The contract is void! *Wario shakes his fist.*'
    ];
    const rep = RP.repetitionCheck('WAH! GIVE ME THE CASH! Every coin is mine! *Wario shakes his fist.*', prior);
    return rep.repeated === true && rep.hits.length > 0;
  })());

  check('anti-generic: stock AI clichés are caught and concrete grounding checked', (() => {
    const cliché = 'A smirk played across his lips as a chill went down his spine. The tension was palpable in the room.';
    const grounded = 'Wario counted the thirty brass coins, slammed the iron safe shut, and pocketed the bent key.';
    const cRes = RP.genericCheck(cliché);
    const gRes = RP.genericCheck(grounded);
    return cRes.isGeneric === true && cRes.cliches.length >= 2 &&
      gRes.isGeneric === false && gRes.hasGrounding === true;
  })());

  check('anti-generic: assistant tells are caught on their own; one stray cliché in a grounded turn is forgiven', (() => {
    const bot = RP.genericCheck('As an AI, I cannot really hold the ledger, but I hope this helps.');
    const one = RP.genericCheck('*a wave of relief* "Fourteen coins. Fourteen! Somebody counted short."');
    const wide = RP.genericCheck('His eyes glinted with mischief. A shiver ran down her spine.');
    return bot.isGeneric === true && bot.hard.length >= 1 &&
      one.isGeneric === false && one.cliches.length === 1 &&
      wide.isGeneric === true && wide.cliches.length === 2;
  })());

  check('anti-generic: the assistant sign-off is cut, an in-character question is not', (() => {
    const cut = RP.scrubSlop('*slams the ledger* "Pay me, or the door stays shut." What would you like to do next?');
    const keep = RP.scrubSlop('*leans over the counter* "Fourteen coins short. What will you do, plumber?"');
    const ask = RP.scrubSlop('"Let me know when the gold arrives." *pockets the key*');
    const only = RP.scrubSlop('What would you like to do next?');
    return cut.cut.length === 1 && cut.text === '*slams the ledger* "Pay me, or the door stays shut."' &&
      keep.cut.length === 0 && ask.cut.length === 0 && only.cut.length === 0;
  })());

  check('anti-generic: the directive rides from the first turn and names no other character', (() => {
    const peach = RP.normChar({ id: 'peach', name: 'Peach' });
    const room = { kind: 'solo', cast: [peach], messages: [] };
    const block = RP.antiGenericBlock(room, peach, 'strict');
    return /WRITE LIKE A PERSON/.test(block) && /Peach/.test(block) &&
      !/Wario|Mr\. L|Paulo/.test(block) && RP.antiGenericBlock(room, peach, 'guide') === '';
  })());

  check('continue: a history ending on a character turn is closed with a user turn, roles never repeat', (() => {
    const shaped = RP.chatShape([
      { role: 'user', content: 'Hand it over.' },
      { role: 'assistant', content: 'Wario: WAH. No.' },
      { role: 'assistant', content: 'Waluigi: For the record, he means no.' },
    ], 'Wario');
    const alternates = shaped.every((m, i) => i === 0 || m.role !== shaped[i - 1].role);
    const opensOnUser = RP.chatShape([{ role: 'assistant', content: 'Narration: Rain.' }], '')[0].role === 'user';
    return shaped.length === 3 && alternates && shaped[2].role === 'user' && /Wario/.test(shaped[2].content) &&
      /For the record/.test(shaped[1].content) && opensOnUser &&
      RP.chatShape([{ role: 'user', content: 'Hi.' }], 'Wario').length === 1;
  })());

  check('turn flags: each take is checked against the turns before it, and the chip fix names the phrases', (() => {
    const said = (text) => ({ role: 'char', charId: 'wario', text });
    const room = { messages: [
      said('WAH. Your face is inches from yours truly, and the ledger stays shut.'),
      said('Back off. Your nose is inches from yours truly, plumber.'),
      said('*taps the ledger* Fourteen coins short.'),
    ] };
    const modes = { fresh: 'strict', antiRepetition: 'strict', antiGeneric: 'strict' };
    const stale = RP.turnFlags(room, 2, 'Close enough. Inches from yours truly, and nobody touches the ledger.', 'wario', modes);
    const freshTake = RP.turnFlags(room, 2, '*taps the ledger* Fourteen coins short.', 'wario', modes);
    const off = RP.turnFlags(room, 2, 'Inches from yours truly.', 'wario', { fresh: 'off', antiRepetition: 'off', antiGeneric: 'off' });
    const nudge = RP.fixNudge(stale, 'Wario');
    const m = { alt: 1, alts: ['a', 'b'], repeats: ['old'], flags: [{ repeats: ['old'] }, {}] };
    return (stale.repeats || stale.antiRepeat) && !freshTake.repeats && Object.keys(off).length === 0 &&
      /REWRITE/.test(nudge) && /Wario/.test(nudge) &&
      RP.flagsOf(m).repeats === undefined && RP.flagsOf({ alt: 0, repeats: ['old'] }).repeats[0] === 'old' &&
      RP.flagsOf({ alt: 1, alts: ['a', 'b'], repeats: ['old'] }).repeats === undefined;
  })());

  check('continuity: item transfers between characters in prose are accurately detected', (() => {
    const cast = [RP.normChar({ id: 'wario', name: 'Wario' }), RP.normChar({ id: 'waluigi', name: 'Waluigi' })];
    const hand = RP.handoverScan('Wario handed the brass key to Waluigi with a grunt.', cast);
    const take = RP.handoverScan('Waluigi took the ledger from Wario and held it tight.', cast);
    return hand.length === 1 && hand[0].giver === 'Wario' && hand[0].receiver === 'Waluigi' && hand[0].item === 'brass key' &&
      take.length === 1 && take[0].giver === 'Wario' && take[0].receiver === 'Waluigi' && take[0].item === 'ledger';
  })());

  check('scene creation: dynamic scene parsing matches archive cast and extracts new NPCs', (() => {
    const desc = 'Wario and Waluigi cornering a nervous clerk in the counting house, while an armored guard watches.';
    const archive = {};
    const castById = {
      wario: RP.normChar({ id: 'wario', name: 'Wario' }),
      waluigi: RP.normChar({ id: 'waluigi', name: 'Waluigi' }),
    };
    const res = RP.parseSceneDescription(desc, archive, castById);
    return res.cast.length === 2 && res.cast.some(c => c.name === 'Wario') && res.cast.some(c => c.name === 'Waluigi') &&
      res.newChars.length >= 1 && res.newChars.some(n => /clerk|guard/i.test(n.name));
  })());

  check('directives: bare directive lines are stripped cleanly without leaking into prose', (() => {
    const text = 'Here is the real treasure.\nMOOD: Wario furious 2\nTake it before anyone notices.';
    const parsed = RP.parseDirectives(text, ['Wario']);
    return parsed.directives.length === 1 && parsed.directives[0].kind === 'mood' &&
      parsed.clean === 'Here is the real treasure.\nTake it before anyone notices.';
  })());
}

check('build: chatroom.html and workflow/roleplay.html match their sources', built);

console.log(ok ? 'ALL CHATROOM CORE TESTS PASS' : 'CHATROOM CORE TESTS FAILED');
process.exit(ok ? 0 : 1);
