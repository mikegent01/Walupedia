// ghostlight-board.js
// The "Ghostlight" view of the guilds registry: every contract on it ends in
// Wickermoor Hollow, and a player picks exactly one. The pick is a per-browser
// note (localStorage) -- canon is whatever the GM later files as an event.

import { WICKERMOOR, GHOSTLIGHT_TICKET, GHOSTLIGHT_CONTRACTS } from '../../../data/factions/wickermoor-contracts.js';

// This page lives at Reputation-Matrix2/app/pages/guilds/; the encyclopedia is
// the repo-root index.html.
const WIKI = '../../../../index.html';
export const wikiHref = (id) => `${WIKI}#/article/${encodeURIComponent(id)}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function wikiLink(id, label) {
    return `<a class="gl-wiki" href="${wikiHref(id)}">${esc(label)}</a>`;
}

const STATUS_LABEL = {
    unconfirmed: 'Seat unconfirmed',
    rumored: 'Rumoured',
    canon: 'On file',
    seat: 'Home seat',
    mobile: 'Mobile'
};

/** HQ line with a status chip and, when the guild has an article, a wiki link. */
export function renderSeat(guild) {
    const st = guild.locationStatus;
    const chip = st ? `<span class="gl-seat gl-seat-${st}">${STATUS_LABEL[st] || st}</span>` : '';
    const art = guild.article ? ` ${wikiLink(guild.article, 'Waluipedia ↗')}` : '';
    return `${esc(guild.headquarters)} ${chip}${art}`;
}

function choiceKey(user) {
    return `guilds-ghostlight-choice:${user || 'guest'}`;
}

export function getChoice(user) {
    try { return localStorage.getItem(choiceKey(user)); } catch { return null; }
}

export function setChoice(user, id) {
    try {
        if (id) localStorage.setItem(choiceKey(user), id);
        else localStorage.removeItem(choiceKey(user));
    } catch { /* storage blocked: the pick just will not persist */ }
}

function sponsorOf(c, guilds) {
    if (c.guild === 'independent') return { name: c.sponsor, icon: c.icon, article: null };
    const g = guilds[c.guild];
    return g ? { name: g.name, icon: g.icon, article: g.article || null, id: g.id } : { name: c.guild, icon: '📜' };
}

function rewardLine(r = {}) {
    const bits = [];
    if (r.gold) bits.push(`<span>💰 ${r.gold}</span>`);
    if (r.reputation) bits.push(`<span>⭐ +${r.reputation}</span>`);
    if (r.extra) bits.push(`<span>🎁 ${esc(r.extra)}</span>`);
    return bits.join('');
}

function renderContract(c, guilds, chosenId) {
    const s = sponsorOf(c, guilds);
    const chosen = c.id === chosenId;
    const taken = c.status === 'taken';
    const links = (c.links || []).map(l => wikiLink(l.article, l.label)).join(' · ');
    let action;
    if (taken) {
        action = `<span class="gl-taken">Taken${c.takenBy ? ` by ${wikiLink(c.takenBy, c.takenBy.replace(/_/g, ' '))}` : ''}</span>`;
    } else if (chosen) {
        action = `<button class="gl-btn gl-btn-ghost" data-gl="clear">Give the ticket back</button>`;
    } else {
        action = `<button class="gl-btn" data-gl="choose" data-gl-id="${c.id}">${chosenId ? 'Take this one instead' : 'Choose this contract'}</button>`;
    }
    return `
        <article class="gl-card${chosen ? ' is-chosen' : ''}${taken ? ' is-taken' : ''}">
            <header class="gl-card-head">
                <span class="gl-card-icon">${c.icon}</span>
                <div>
                    <h4>${esc(c.title)}</h4>
                    <div class="gl-sponsor">${s.icon} ${s.id ? `<button class="gl-linkbtn" data-guild="${s.id}">${esc(s.name)}</button>` : esc(s.name)}</div>
                </div>
                <span class="difficulty-badge difficulty-${c.difficulty}">${c.difficulty}</span>
            </header>
            <p class="gl-pitch">${esc(c.pitch)}</p>
            <p class="gl-hook">${esc(c.hook)}</p>
            <div class="gl-meta">
                <span class="gl-kind">${esc(c.kind)}</span>
                <span class="gl-dest">🚂 ${GHOSTLIGHT_TICKET}</span>
            </div>
            <div class="gl-reward">${rewardLine(c.reward)}</div>
            ${links ? `<div class="gl-links">${links}</div>` : ''}
            ${c.source ? `<div class="gl-source">Filed in ${wikiLink(c.source, 'the session record')}</div>` : ''}
            <footer class="gl-card-foot">${action}</footer>
        </article>`;
}

export function renderGhostlightBoard({ guilds, user }) {
    const chosenId = getChoice(user);
    const chosen = GHOSTLIGHT_CONTRACTS.find(c => c.id === chosenId);
    const who = user && user !== 'generic' ? 'your' : 'this browser’s';
    return `
        <section class="gl-board">
            <div class="gl-hero">
                <div class="gl-hero-text">
                    <div class="gl-kicker">Next destination · ${esc(WICKERMOOR.status)}</div>
                    <h3>${esc(WICKERMOOR.name)}, ${esc(WICKERMOOR.realm)}</h3>
                    <p>${esc(WICKERMOOR.summary)}</p>
                    <p class="gl-route">🚂 ${esc(WICKERMOOR.route)}</p>
                </div>
                <div class="gl-hero-lists">
                    <div><h5>What the guilds report</h5><ul>${WICKERMOOR.known.map(k => `<li>${esc(k)}</li>`).join('')}</ul></div>
                    <div><h5>Not yet on file</h5><ul>${WICKERMOOR.unknown.map(k => `<li>${esc(k)}</li>`).join('')}</ul></div>
                </div>
            </div>

            <div class="gl-ticket${chosen ? ' has-pick' : ''}">
                ${chosen
                    ? `<span class="gl-ticket-stub">🎫</span><div><strong>${esc(chosen.title)}</strong> is ${who} contract. The ticket reads <em>${GHOSTLIGHT_TICKET}</em>.<div class="gl-note">This pick is saved in this browser only. It becomes canon when the session that uses it is filed.</div></div>`
                    : `<span class="gl-ticket-stub">🎫</span><div><strong>Choose one contract.</strong> The jobs differ, but every ticket on this board is for the same train and the same stop.<div class="gl-note">The pick is saved in this browser only. It becomes canon when the session is filed.</div></div>`}
            </div>

            <div class="gl-grid">
                ${GHOSTLIGHT_CONTRACTS.map(c => renderContract(c, guilds, chosenId)).join('')}
            </div>
        </section>`;
}

/** Returns true when the click was a board action (so the caller re-renders). */
export function handleGhostlightClick(e, user, notify) {
    const btn = e.target.closest('[data-gl]');
    if (!btn) return false;
    if (btn.dataset.gl === 'choose') {
        const c = GHOSTLIGHT_CONTRACTS.find(x => x.id === btn.dataset.glId);
        setChoice(user, btn.dataset.glId);
        notify?.(`Ticket issued: ${c ? c.title : 'contract'} → Wickermoor Hollow`, 'success');
    } else if (btn.dataset.gl === 'clear') {
        setChoice(user, null);
        notify?.('Ticket returned. The board is open again.', 'info');
    }
    return true;
}

export const GHOSTLIGHT_COUNT = GHOSTLIGHT_CONTRACTS.filter(c => c.status === 'open').length;
