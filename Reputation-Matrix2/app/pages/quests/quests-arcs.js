// quests-arcs.js - Arc Selection + Interactive Quest Modal

import { 
    QUEST_DATA, 
    QUEST_STATUS, 
    QUEST_PRIORITY, 
    QUEST_TYPES,
    getQuestProgress,
    getDaysUntilDeadline,
    isQuestUpdatedRecently,
    getUrgentQuests,
    getQuestsByArc
} from '../../../data/quest-system/index.js';
import { playSound } from '../../core/common.js';
import { LORE_DATA, STORY_ARCS } from '../../core/lore.js';
import { CALENDAR_DATA, CURRENT_GAME_DATE } from '../../../data/world/calendar.js';

// ============================================
// CONFIGURATION - CUSTOMIZE YOUR IMAGE PATHS
// ============================================
const ARC_IMAGES = {
    shadowfell_estate: { 
        panel: 'assets/images/arcs/shadowfell-estate.png',
        header: 'assets/images/arcs/shadowfell-header.png',
        fallback: 'assets/images/arcs/default-dark.png'
    }, 
    feywild_attic: {
        panel: 'assets/images/arcs/feywild-attic.png',
        header: 'assets/images/arcs/feywild-header.png',
        fallback: 'assets/images/arcs/default-nature.png'
    },
    raventree_manor: { 
        panel: 'assets/images/arcs/raventree-manor.png',
        header: 'assets/images/arcs/raventree-header.png',
        fallback: 'assets/images/arcs/default-ruins.png'
    },
    toadalnaec_claim: {
        panel: 'assets/images/events/toadalnaec-breakfast/breakfast-under-the-legionlance.jpg',
        header: 'assets/images/events/toadalnaec-breakfast/breakfast-under-the-legionlance.jpg',
        fallback: 'assets/images/arcs/default-nature.png'
    }
};

const QUEST_TYPE_IMAGES = {
    main: 'assets/images/quests/main-quest-bg.png',
    side: 'assets/images/quests/side-quest-bg.png',
    personal: 'assets/images/quests/personal-quest-bg.png',
    faction: 'assets/images/quests/faction-quest-bg.png',
    rescue: 'assets/images/quests/bounty-quest-bg.png',
    mystery: 'assets/images/quests/wallys_toad.png',
    request: 'assets/images/quests/big_t.png',
    default: 'assets/images/quests/default-quest-bg.png'
};

// ============================================
// STATE
// ============================================
let currentView = 'selection';
let selectedArc = null;
let arcQuestFilter = 'active';
let arcSearchQuery = '';
let allQuestsTab = 'active';
let allQuestsSortMode = 'priority';
let allQuestsArcFilter = 'all';
let allQuestsSearchQuery = '';
let currentModalTab = 'overview';
let currentQuestId = null;
let expandedMilestones = new Set();

// ============================================
// DOM ELEMENTS - Will be initialized after DOM load
// ============================================
let arcSelectionScreen, arcDetailView, allQuestsView, arcPanelsContainer, questModal;

// ============================================
// UTILITIES
// ============================================
function formatDate(date) {
    if (!date) return '';
    if (typeof date === 'string') return date;
    const month = CALENDAR_DATA?.months?.values?.[date.monthIndex];
    return `${month?.name || 'Month'} ${date.day}, ${date.year}`;
}

function formatRelativeDate(date) {
    if (!date) return '';
    const current = CURRENT_GAME_DATE;
    const dateTotal = date.year * 365 + date.monthIndex * 30 + date.day;
    const currentTotal = current.year * 365 + current.monthIndex * 30 + current.day;
    const diff = currentTotal - dateTotal;
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 0) return `In ${Math.abs(diff)} days`;
    if (diff < 7) return `${diff} days ago`;
    return formatDate(date);
}

function formatKey(key) {
    if (!key) return '';
    if (key === 'full_party' || key === 'party') return 'The Party';
    const char = LORE_DATA?.characters?.[key] || LORE_DATA?.auxiliary_party?.[key];
    if (char) return char.name;
    const faction = LORE_DATA?.factions?.[key];
    if (faction) return faction.name;
    const location = LORE_DATA?.locations?.[key];
    if (location) return location.name;
    return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatReward(val) {
    if (typeof val === 'object' && val.min !== undefined) {
        if (val.note) return `${val.min}-${val.max} (${val.note})`;
        return `${val.min}-${val.max}`;
    }
    return val;
}

function normalizeQuestData(quest) {
    let milestones = quest.milestones || [];
    if (!milestones.length && quest.steps) {
        milestones = quest.steps.map(s => ({
            id: s.id,
            title: s.title,
            description: s.description,
            status: s.status,
            goals: s.options ? s.options.map(opt => ({
                // Options are frequently structured records, not display strings.
                text: typeof opt === 'string' ? opt : (opt.name || opt.title || opt.text || opt.description || 'Unnamed option'),
                status: opt.status || 'active',
                note: typeof opt === 'object' ? opt.description : ''
            })) : []
        }));
    }

    let priority = quest.priority;
    if (typeof priority === 'string') {
        priority = Object.values(QUEST_PRIORITY).find(p => 
            p.label.toLowerCase() === priority.toLowerCase()
        ) || QUEST_PRIORITY.MEDIUM;
    }
    if (!priority) priority = QUEST_PRIORITY.MEDIUM;

    let type = quest.type;
    if (typeof type === 'string') {
        type = Object.values(QUEST_TYPES).find(t => 
            t.id === type.toLowerCase()
        ) || QUEST_TYPES.REQUEST;
    }
    if (!type) type = QUEST_TYPES.REQUEST;

    let assignees = [...(quest.assignees || [])];
    if (quest.assignee) assignees.push(quest.assignee);
    if (quest.primaryAssignee) assignees.push(quest.primaryAssignee);
    
    const uniqueNames = [...new Set(assignees.map(formatKey).filter(Boolean))];
    const assigneeNames = uniqueNames.length > 0 ? uniqueNames.join(', ') : 'Unassigned';

    const completedMilestones = milestones.filter(m => m.status === 'completed').length;
    const totalMilestones = milestones.length;
    const progress = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;

    return {
        ...quest,
        milestones,
        priority,
        type,
        assigneeNames,
        assigneeKeys: assignees,
        progress,
        completedMilestones,
        totalMilestones
    };
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// ARC SELECTION SCREEN
// ============================================
function renderArcSelection() {
    currentView = 'selection';
    arcSelectionScreen.hidden = false;
    arcDetailView.hidden = true;
    allQuestsView.hidden = true;

    // Update stats for each arc
    ['shadowfell_estate', 'feywild_attic', 'raventree_manor'].forEach(arcId => {
        const quests = getQuestsByArc(arcId);
        const prefix = arcId.split('_')[0];
        
        // Update panel background image
        const panel = document.querySelector(`.arc-panel[data-arc="${arcId}"]`);
        if (panel && ARC_IMAGES[arcId]) {
            const bgEl = panel.querySelector('.arc-panel-bg');
            if (bgEl) {
                bgEl.style.backgroundImage = `url('${ARC_IMAGES[arcId].panel}')`;
            }
        }
        
        const countEl = document.getElementById(`${prefix}-quest-count`);
        if (countEl) countEl.textContent = quests.length;

        const arc = STORY_ARCS?.[arcId];
        if (arc) {
            const phaseEl = document.getElementById(`${prefix}-phase`);
            if (phaseEl) {
                phaseEl.textContent = `${(arc.currentPhase || 0) + 1}/${arc.phases?.length || 0}`;
            }
        }
    });
}

// ============================================
// ARC DETAIL VIEW
// ============================================
function renderArcDetail(arcId) {
    const arc = STORY_ARCS?.[arcId];
    if (!arc) return;

    currentView = 'arc-detail';
    selectedArc = arcId;
    arcQuestFilter = 'active';
    
    arcSelectionScreen.hidden = true;
    arcDetailView.hidden = false;
    allQuestsView.hidden = true;

    // Update header background image
    const headerBg = document.getElementById('arc-detail-header');
    if (headerBg && ARC_IMAGES[arcId]) {
        headerBg.style.backgroundImage = `linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.8)), url('${ARC_IMAGES[arcId].header}')`;
    }

    // Update header content
    document.getElementById('arc-detail-icon').textContent = arc.icon || '📋';
    document.getElementById('arc-detail-name').textContent = arc.name || 'Unknown Arc';
    document.getElementById('arc-detail-tagline').textContent = getArcTagline(arcId);

    // Update stats
    const quests = getQuestsByArc(arcId);
    const completedQuests = quests.filter(q => q.status === QUEST_STATUS.COMPLETED);
    const progress = quests.length > 0 ? Math.round((completedQuests.length / quests.length) * 100) : 0;

    document.getElementById('detail-quest-count').textContent = quests.length;
    document.getElementById('detail-progress').textContent = `${progress}%`;

    // Render components
    renderArcDescription(arc);
    renderPhaseTimeline(arc);
    renderConsequencesPreview(arc);
    renderCompanionSelector(arcId);
    renderArcQuests(arcId);
    
    // Reset filter tabs
    document.querySelectorAll('#arc-quest-filters .filter-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('#arc-quest-filters .filter-tab[data-filter="active"]')?.classList.add('active');
}

function getArcTagline(arcId) {
    const taglines = {
        'shadowfell_estate': 'The Vampire\'s Banquet',
        'feywild_attic': 'The Chaos Garden',
        'raventree_manor': 'The Nexus of Ruin',
        'toadalnaec_claim': 'A ship without a settled claim'
    };
    return taglines[arcId] || '';
}

function renderArcDescription(arc) {
    const descEl = document.getElementById('arc-description-full');
    if (descEl) {
        descEl.innerHTML = `
            <p>${arc.description || 'No description available.'}</p>
            ${arc.themes?.length ? `
                <div class="arc-themes-inline">
                    ${arc.themes.map(t => `<span class="theme-chip">${t}</span>`).join('')}
                </div>
            ` : ''}
        `;
    }
}

function renderPhaseTimeline(arc) {
    const timelineEl = document.getElementById('phase-timeline');
    if (!timelineEl) return;
    
    if (!arc.phases?.length) {
        timelineEl.innerHTML = '<p class="no-data">No phases defined.</p>';
        return;
    }

    timelineEl.innerHTML = `
        <div class="timeline-track">
            ${arc.phases.map((phase, index) => {
                let status = 'pending';
                if (index < arc.currentPhase) status = 'completed';
                if (index === arc.currentPhase) status = 'active';

                return `
                    <div class="phase-node ${status}" data-phase="${index}">
                        <div class="phase-marker">
                            <span class="phase-number">${index + 1}</span>
                            ${status === 'completed' ? '<span class="phase-check">✓</span>' : ''}
                        </div>
                        <div class="phase-connector"></div>
                        <div class="phase-info">
                            <span class="phase-name">${phase.name}</span>
                            <span class="phase-desc">${phase.description}</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderConsequencesPreview(arc) {
    const positiveEl = document.getElementById('positive-consequences');
    const negativeEl = document.getElementById('negative-consequences');
    
    if (positiveEl && arc.consequences?.positive) {
        positiveEl.innerHTML = arc.consequences.positive.map(c => 
            `<li><span class="consequence-icon">✓</span>${c}</li>`
        ).join('');
    }
    if (negativeEl && arc.consequences?.negative) {
        negativeEl.innerHTML = arc.consequences.negative.map(c => 
            `<li><span class="consequence-icon">✗</span>${c}</li>`
        ).join('');
    }
}

function renderArcQuests(arcId) {
    const questListEl = document.getElementById('arc-quest-list');
    if (!questListEl) return;
    
    let quests = getQuestsByArc(arcId);

    // Apply filter
    quests = quests.filter(q => {
        switch (arcQuestFilter) {
            case 'active':
                return [QUEST_STATUS.ACTIVE, QUEST_STATUS.ONGOING].includes(q.status);
            case 'available':
                return [QUEST_STATUS.PENDING, QUEST_STATUS.AVAILABLE].includes(q.status);
            case 'completed':
                return q.status === QUEST_STATUS.COMPLETED;
            default:
                return true;
        }
    });

    // Apply search
    if (arcSearchQuery) {
        const query = arcSearchQuery.toLowerCase();
        quests = quests.filter(q => {
            const searchable = `${q.title} ${q.objective || ''} ${q.description || ''}`.toLowerCase();
            return searchable.includes(query);
        });
    }

    // Sort by priority
    quests.sort((a, b) => {
        const nA = normalizeQuestData(a);
        const nB = normalizeQuestData(b);
        return (nB.priority.level || 0) - (nA.priority.level || 0);
    });

    if (quests.length === 0) {
        questListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <h3>No Missions Found</h3>
                <p>No missions match your current filters.</p>
            </div>
        `;
        return;
    }

    questListEl.innerHTML = quests.map(rawQuest => {
        const quest = normalizeQuestData(rawQuest);
        const deadline = getDaysUntilDeadline(rawQuest);
        const isUrgent = deadline !== null && deadline <= 3;
        const questImage = QUEST_TYPE_IMAGES[quest.type?.id] || QUEST_TYPE_IMAGES.default;

        return `
            <article class="arc-quest-card priority-${quest.priority.label.toLowerCase()}" 
                     data-quest-id="${quest.id}"
                     style="--quest-bg: url('${questImage}')">
                <div class="quest-card-image" style="background-image: url('${questImage}')"></div>
                <div class="quest-card-overlay"></div>
                <div class="quest-card-content">
                    <div class="quest-card-header">
                        <div class="quest-type-badge" style="color: ${quest.type.color}">
                            ${quest.type.icon} ${quest.type.label}
                        </div>
                        <span class="quest-status-badge ${quest.status}">${quest.status}</span>
                    </div>
                    <h3 class="quest-card-title">${quest.title}</h3>
                    <p class="quest-card-objective">${quest.objective || quest.description || ''}</p>
                    <div class="quest-card-footer">
                        <div class="quest-card-meta">
                            <span class="meta-item">👤 ${quest.assigneeNames.split(',')[0]}</span>
                            ${isUrgent ? `<span class="meta-item urgent">⏰ ${deadline === 0 ? 'Today!' : deadline + 'd'}</span>` : ''}
                        </div>
                        <div class="quest-card-progress">
                            <div class="progress-bar-mini">
                                <div class="progress-fill-mini" style="width: ${quest.progress}%"></div>
                            </div>
                            <span class="progress-text-mini">${quest.progress}%</span>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

// ============================================
// ALL QUESTS VIEW
// ============================================
function renderAllQuests() {
    currentView = 'all-quests';
    arcSelectionScreen.hidden = true;
    arcDetailView.hidden = true;
    allQuestsView.hidden = false;

    renderAllQuestsDashboard();
    renderAllQuestsList();
}

function renderAllQuestsDashboard() {
    const rawQuests = Object.values(QUEST_DATA).filter(q => q && q.status);
    const quests = rawQuests.map(q => normalizeQuestData(q));

    const urgent = getUrgentQuests();
    const active = quests.filter(q => [QUEST_STATUS.ACTIVE, QUEST_STATUS.ONGOING].includes(q.status));
    const completed = quests.filter(q => q.status === QUEST_STATUS.COMPLETED);

    // Update stats
    const urgentEl = document.querySelector('#all-stat-urgent .mini-stat-value');
    const activeEl = document.querySelector('#all-stat-active .mini-stat-value');
    if (urgentEl) urgentEl.textContent = urgent.length;
    if (activeEl) activeEl.textContent = active.length;

    // Overall progress
    const overallProgress = quests.length > 0 ? Math.round((completed.length / quests.length) * 100) : 0;
    const progressRing = document.getElementById('overall-progress-ring');
    const progressValue = document.getElementById('overall-progress-value');
    
    if (progressRing) {
        const circumference = 326.73;
        progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
        const offset = circumference - (overallProgress / 100) * circumference;
        progressRing.style.strokeDashoffset = offset;
    }
    if (progressValue) progressValue.textContent = `${overallProgress}%`;

    // Party workload
    const partyWorkloadEl = document.getElementById('party-workload');
    if (partyWorkloadEl) {
        const partyLoad = {};
        active.forEach(q => {
            (q.assigneeKeys || []).forEach(name => {
                partyLoad[name] = (partyLoad[name] || 0) + 1;
            });
        });

        partyWorkloadEl.innerHTML = Object.entries(partyLoad)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([key, count]) => {
                const char = LORE_DATA?.characters?.[key] || LORE_DATA?.auxiliary_party?.[key];
                return `
                    <div class="party-member ${count > 3 ? 'overloaded' : ''}">
                        <div class="member-avatar">${char?.icon || '👤'}</div>
                        <div class="member-info">
                            <span class="member-name">${char?.name?.split(' ')[0] || formatKey(key)}</span>
                            <span class="member-quest-count">${count} Quest${count !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                `;
            }).join('');
    }

    updateAllQuestsTabCounts(rawQuests);
}

function updateAllQuestsTabCounts(quests) {
    const counts = {
        active: quests.filter(q => [QUEST_STATUS.ACTIVE, QUEST_STATUS.ONGOING].includes(q.status)).length,
        available: quests.filter(q => [QUEST_STATUS.PENDING, QUEST_STATUS.AVAILABLE].includes(q.status)).length,
        completed: quests.filter(q => q.status === QUEST_STATUS.COMPLETED).length,
        all: quests.length
    };

    document.querySelectorAll('#all-quest-tabs .quest-tab').forEach(tab => {
        const tabKey = tab.dataset.tab;
        const countEl = tab.querySelector('.tab-count');
        if (countEl && counts[tabKey] !== undefined) {
            countEl.textContent = counts[tabKey];
        }
    });
}

function renderAllQuestsList() {
    const container = document.getElementById('all-quest-container');
    const emptyState = document.getElementById('all-empty-state');
    if (!container) return;
    
    let quests = Object.values(QUEST_DATA).filter(q => q && q.status);

    // Tab filter
    quests = quests.filter(q => {
        switch (allQuestsTab) {
            case 'active':
                return [QUEST_STATUS.ACTIVE, QUEST_STATUS.ONGOING].includes(q.status);
            case 'available':
                return [QUEST_STATUS.PENDING, QUEST_STATUS.AVAILABLE].includes(q.status);
            case 'completed':
                return q.status === QUEST_STATUS.COMPLETED;
            default:
                return true;
        }
    });

    // Arc filter
    if (allQuestsArcFilter !== 'all') {
        quests = quests.filter(q => q.arcId === allQuestsArcFilter);
    }

    // Search filter
    if (allQuestsSearchQuery) {
        const query = allQuestsSearchQuery.toLowerCase();
        quests = quests.filter(q => {
            const searchable = `${q.title} ${q.objective || ''} ${q.description || ''}`.toLowerCase();
            return searchable.includes(query);
        });
    }

    // Sort
    quests.sort((a, b) => {
        const nA = normalizeQuestData(a);
        const nB = normalizeQuestData(b);

        switch (allQuestsSortMode) {
            case 'priority':
                return (nB.priority.level || 0) - (nA.priority.level || 0);
            case 'progress':
                return nB.progress - nA.progress;
            case 'deadline':
                const deadlineA = getDaysUntilDeadline(a) ?? 999;
                const deadlineB = getDaysUntilDeadline(b) ?? 999;
                return deadlineA - deadlineB;
            default:
                return 0;
        }
    });

    if (quests.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.hidden = false;
        return;
    }

    if (emptyState) emptyState.hidden = true;
    container.innerHTML = quests.map(rawQuest => renderQuestCard(rawQuest)).join('');
}

function renderQuestCard(rawQuest) {
    const quest = normalizeQuestData(rawQuest);
    const deadline = getDaysUntilDeadline(rawQuest);
    const isUrgent = deadline !== null && deadline <= 3;
    const questImage = QUEST_TYPE_IMAGES[quest.type?.id] || QUEST_TYPE_IMAGES.default;

    return `
        <article class="quest-card priority-${quest.priority.label.toLowerCase()}" 
                 data-quest-id="${quest.id}">
            <div class="card-bg" style="background-image: url('${questImage}')"></div>
            <div class="card-overlay"></div>
            <div class="card-content">
                <div class="card-header">
                    <div class="card-type" style="color: ${quest.type.color}">
                        ${quest.type.icon} ${quest.type.label}
                    </div>
                    <span class="card-status status-${quest.status}">${quest.status}</span>
                </div>
                <h3 class="card-title">${quest.title}</h3>
                <p class="card-objective">${quest.objective || quest.description || ''}</p>
                <div class="card-progress">
                    <div class="card-progress-bar">
                        <div class="card-progress-fill" style="width: ${quest.progress}%"></div>
                    </div>
                    <span class="card-progress-text">${quest.progress}%</span>
                </div>
                <div class="card-footer">
                    <div class="card-meta">
                        <span>👤 ${quest.assigneeNames.split(',')[0]}</span>
                        ${isUrgent ? `<span class="urgent">⏰ ${deadline === 0 ? 'Today!' : deadline + 'd'}</span>` : ''}
                    </div>
                    <div class="card-rewards">
                        ${quest.rewards?.gold ? `<span class="reward gold">💰${formatReward(quest.rewards.gold)}</span>` : ''}
                        ${quest.rewards?.xp ? `<span class="reward xp">⭐${formatReward(quest.rewards.xp)}</span>` : ''}
                    </div>
                </div>
            </div>
        </article>
    `;
}

// ============================================
// INTERACTIVE QUEST MODAL
// ============================================
function openQuestModal(questId) {
    const rawQuest = QUEST_DATA[questId];
    if (!rawQuest) {
        showToast('Quest not found!', 'error');
        return;
    }

    currentQuestId = questId;
    currentModalTab = 'overview';
    expandedMilestones.clear();

    const quest = normalizeQuestData(rawQuest);
    
    // Get modal elements
    const modalContainer = document.querySelector('#quest-modal .modal-container');
    if (!modalContainer) {
        console.error('Modal container not found');
        return;
    }

    // Build complete modal HTML
    modalContainer.innerHTML = buildModalHTML(quest, rawQuest);

    // Show modal
    questModal.classList.add('active');
    questModal.hidden = false;
    document.body.style.overflow = 'hidden';

    // Setup modal interactivity after render
    setupModalInteractivity(quest);
}

function buildModalHTML(quest, rawQuest) {
    const deadline = getDaysUntilDeadline(rawQuest);
    const isUrgent = deadline !== null && deadline <= 3;
    const arc = quest.arcId && STORY_ARCS ? STORY_ARCS[quest.arcId] : null;
    const questImage = QUEST_TYPE_IMAGES[quest.type?.id] || QUEST_TYPE_IMAGES.default;

    return `
        <!-- Modal Header with Image -->
        <div class="modal-hero" style="background-image: linear-gradient(to bottom, transparent, var(--bg-surface)), url('${questImage}')">
            <button class="modal-close" id="modal-close" aria-label="Close">
                <span>✕</span>
            </button>
            <div class="modal-hero-content">
                <div class="modal-badges">
                    <span class="type-badge" style="background: ${quest.type.color}20; color: ${quest.type.color}">
                        ${quest.type.icon} ${quest.type.label}
                    </span>
                    <span class="priority-badge priority-${quest.priority.label.toLowerCase()}">
                        ${quest.priority.icon || '⚡'} ${quest.priority.label}
                    </span>
                    <span class="status-badge status-${quest.status}">${quest.status}</span>
                </div>
                <h2 class="modal-title">${quest.title}</h2>
                ${quest.subtitle ? `<p class="modal-subtitle">${quest.subtitle}</p>` : ''}
            </div>
        </div>

        <!-- Interactive Navigation Tabs -->
        <nav class="modal-nav" id="modal-nav">
            <button class="modal-nav-tab active" data-tab="overview">
                <span class="tab-icon">📋</span>
                <span class="tab-label">Overview</span>
            </button>
            <button class="modal-nav-tab" data-tab="objectives">
                <span class="tab-icon">🎯</span>
                <span class="tab-label">Objectives</span>
                <span class="tab-badge">${quest.milestones.length}</span>
            </button>
            <button class="modal-nav-tab" data-tab="intel">
                <span class="tab-icon">🔍</span>
                <span class="tab-label">Intel</span>
            </button>
            <button class="modal-nav-tab" data-tab="rewards">
                <span class="tab-icon">🎁</span>
                <span class="tab-label">Rewards</span>
            </button>
        </nav>

        <!-- Modal Content Panels -->
        <div class="modal-body" id="modal-body">
            ${buildOverviewPanel(quest, arc, isUrgent, deadline)}
            ${buildObjectivesPanel(quest)}
            ${buildIntelPanel(quest, rawQuest)}
            ${buildRewardsPanel(quest)}
        </div>

        <!-- Modal Footer Actions -->
        <div class="modal-footer">
            <div class="footer-info">
                <span class="footer-date">📅 Added: ${formatDate(quest.dates?.added)}</span>
                ${quest.dates?.updated ? `<span class="footer-date">🔄 Updated: ${formatRelativeDate(quest.dates.updated)}</span>` : ''}
            </div>
            <div class="footer-actions">
                ${arc ? `
                    <button class="action-btn secondary" id="view-arc-btn" data-arc="${quest.arcId}">
                        <span>${arc.icon}</span> View Arc
                    </button>
                ` : ''}
                <button class="action-btn primary" id="track-quest-btn">
                    <span>📌</span> Track Quest
                </button>
            </div>
        </div>
    `;
}

function buildOverviewPanel(quest, arc, isUrgent, deadline) {
    return `
        <div class="modal-panel active" data-panel="overview">
            <!-- Quick Stats -->
            <div class="overview-stats">
                <div class="stat-card">
                    <div class="stat-icon">📊</div>
                    <div class="stat-info">
                        <span class="stat-value">${quest.progress}%</span>
                        <span class="stat-label">Progress</span>
                    </div>
                    <div class="stat-bar">
                        <div class="stat-bar-fill" style="width: ${quest.progress}%"></div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">🎯</div>
                    <div class="stat-info">
                        <span class="stat-value">${quest.completedMilestones}/${quest.totalMilestones}</span>
                        <span class="stat-label">Milestones</span>
                    </div>
                </div>
                <div class="stat-card ${isUrgent ? 'urgent' : ''}">
                    <div class="stat-icon">⏰</div>
                    <div class="stat-info">
                        <span class="stat-value">${deadline !== null ? (deadline === 0 ? 'Today!' : deadline + ' days') : '—'}</span>
                        <span class="stat-label">Deadline</span>
                    </div>
                </div>
            </div>

            <!-- Objective -->
            <section class="content-section">
                <h3 class="section-title"><span class="title-icon">📋</span> Mission Objective</h3>
                <div class="objective-card">
                    <p>${quest.objective || 'No objective specified.'}</p>
                </div>
            </section>

            ${quest.urgencyNote ? `
                <div class="alert-banner urgent">
                    <span class="alert-icon">⚠️</span>
                    <span class="alert-text">${quest.urgencyNote}</span>
                </div>
            ` : ''}

            <!-- Description -->
            ${quest.description ? `
                <section class="content-section">
                    <h3 class="section-title"><span class="title-icon">📖</span> Details</h3>
                    <div class="description-card">
                        ${quest.description.replace(/\n/g, '<br>')}
                    </div>
                </section>
            ` : ''}

            <!-- Assignees -->
            <section class="content-section">
                <h3 class="section-title"><span class="title-icon">👥</span> Assigned To</h3>
                <div class="assignee-grid">
                    ${(quest.assigneeKeys || []).map(key => {
                        const char = LORE_DATA?.characters?.[key] || LORE_DATA?.auxiliary_party?.[key];
                        return `
                            <div class="assignee-card" data-character="${key}">
                                <div class="assignee-avatar">${char?.icon || '👤'}</div>
                                <div class="assignee-info">
                                    <span class="assignee-name">${char?.name || formatKey(key)}</span>
                                    <span class="assignee-role">${char?.role || 'Party Member'}</span>
                                </div>
                            </div>
                        `;
                    }).join('') || '<p class="no-data">No one assigned</p>'}
                </div>
            </section>

            <!-- Story Arc Link -->
            ${arc ? `
                <section class="content-section">
                    <h3 class="section-title"><span class="title-icon">🎭</span> Story Arc</h3>
                    <div class="arc-link-card" data-arc="${quest.arcId}">
                        <div class="arc-link-icon">${arc.icon}</div>
                        <div class="arc-link-info">
                            <span class="arc-link-name">${arc.name}</span>
                            <span class="arc-link-phase">Phase ${(arc.currentPhase || 0) + 1} of ${arc.phases?.length || 0}</span>
                        </div>
                        <span class="arc-link-arrow">→</span>
                    </div>
                </section>
            ` : ''}
        </div>
    `;
}

function buildObjectivesPanel(quest) {
    const getMilestoneIcon = (status) => {
        switch(status) {
            case 'completed': return '✅';
            case 'failed': return '❌';
            case 'active': return '🔵';
            case 'locked': return '🔒';
            default: return '⏳';
        }
    };

    return `
        <div class="modal-panel" data-panel="objectives">
            <section class="content-section">
                <h3 class="section-title">
                    <span class="title-icon">🎯</span> 
                    Mission Objectives
                    <span class="title-badge">${quest.completedMilestones}/${quest.totalMilestones} Complete</span>
                </h3>
                
                ${quest.milestones.length > 0 ? `
                    <div class="milestones-list">
                        ${quest.milestones.map((m, index) => `
                            <div class="milestone-item ${m.status || 'pending'}" data-milestone="${index}">
                                <div class="milestone-header">
                                    <div class="milestone-status">
                                        <span class="milestone-icon">${getMilestoneIcon(m.status)}</span>
                                        <span class="milestone-number">#${index + 1}</span>
                                    </div>
                                    <div class="milestone-title-group">
                                        <h4 class="milestone-title">${m.title || 'Objective'}</h4>
                                        ${m.completedDate ? `<span class="milestone-date">${formatDate(m.completedDate)}</span>` : ''}
                                    </div>
                                    <button class="milestone-expand" aria-label="Expand milestone">
                                        <span class="expand-icon">▼</span>
                                    </button>
                                </div>
                                <div class="milestone-body">
                                    <p class="milestone-desc">${(m.description || 'No description').replace(/\n/g, '<br>')}</p>
                                    
                                    ${m.goals?.length ? `
                                        <div class="milestone-goals">
                                            <h5>Sub-goals:</h5>
                                            <ul class="goals-list">
                                                ${m.goals.map(g => `
                                                    <li class="goal-item ${g.status || 'pending'}">
                                                        <span class="goal-checkbox">${g.status === 'completed' ? '☑' : '☐'}</span>
                                                        <span class="goal-text">${g.text}</span>
                                                        ${g.priority ? `<span class="goal-priority ${g.priority}">${g.priority}</span>` : ''}
                                                    </li>
                                                `).join('')}
                                            </ul>
                                        </div>
                                    ` : ''}
                                    
                                    ${m.outcomes?.length ? `
                                        <div class="milestone-outcomes">
                                            <h5>Outcomes:</h5>
                                            <ul>
                                                ${m.outcomes.map(o => `<li>${o}</li>`).join('')}
                                            </ul>
                                        </div>
                                    ` : ''}
                                    
                                    ${m.notes ? `
                                        <div class="milestone-notes">
                                            <strong>Notes:</strong> ${m.notes}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div class="empty-state-mini">
                        <span class="empty-icon">📝</span>
                        <p>No objectives defined for this quest.</p>
                    </div>
                `}
            </section>
        </div>
    `;
}
/**
 * Dynamically builds the Intel panel for a quest modal.
 * This version is adapted to handle categorized NPC and Location data.
 *
 * @param {object} quest - The processed quest data object.
 * @param {object} rawQuest - The original raw quest data.
 * @returns {string} The HTML string for the intel panel.
 */
function buildIntelPanel(quest, rawQuest) {
    // Consequence and outcome records are objects; always format them before HTML interpolation.
    const displayValue = (value) => {
        if (value == null) return '';
        if (typeof value !== 'object') return String(value);
        return Object.entries(value).map(([key, text]) => `<div><strong>${formatKey(key)}:</strong> ${displayValue(text)}</div>`).join('');
    };
    // Helper function to format keys into readable titles (e.g., 'side_with_perrius' -> 'Side With Perrius')
    // This function is assumed to exist from your previous code.
    const formatKey = (key) => {
        if (!key) return '';
        return key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    };

    return `
        <div class="modal-panel" data-panel="intel">
            <!-- NPCs Section (Dynamic Groups) -->
            ${quest.npcs && Object.keys(quest.npcs).length > 0 ? `
                <section class="content-section">
                    <h3 class="section-title"><span class="title-icon">👥</span> Key NPCs</h3>
                    <div class="npc-groups">
                        ${Object.entries(quest.npcs).map(([groupKey, npcList]) => {
                            if (!npcList?.length) return '';
                            return `
                                <div class="npc-group">
                                    <h4 class="npc-group-title">
                                        <span class="group-dot"></span> ${formatKey(groupKey)}
                                    </h4>
                                    <div class="npc-chips">
                                        ${npcList.map(npc => {
                                            const npcData = LORE_DATA?.characters?.[npc] || {};
                                            return `
                                                <button class="npc-chip" data-npc="${npc}">
                                                    <span class="npc-avatar">${npcData.icon || '👤'}</span>
                                                    <span class="npc-name">${formatKey(npc)}</span>
                                                </button>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </section>
            ` : ''}


            
            <!-- Hints Section -->
            ${quest.hints?.length ? `
                <section class="content-section">
                    <h3 class="section-title"><span class="title-icon">💡</span> Intel & Hints</h3>
                    <div class="hints-list">
                        ${quest.hints.map((hint, i) => `
                            <div class="hint-card" data-hint="${i}">
                                <span class="hint-icon">💡</span>
                                <p class="hint-text">${displayValue(hint)}</p>
                            </div>
                        `).join('')}
                    </div>
                </section>
            ` : ''}

            <!-- Consequences / Possible Outcomes Section (NEW DYNAMIC LOGIC) -->
            ${quest.consequences ? `
                <section class="content-section">
                    <h3 class="section-title"><span class="title-icon">⚡</span> Possible Outcomes</h3>
                    <div class="outcomes-list">
                        ${Object.entries(quest.consequences).map(([outcomeKey, details]) => `
                            <div class="outcome-card">
                                <h4 class="outcome-title">${formatKey(outcomeKey)}</h4>
                                <div class="outcome-details">
                                    ${details.action ? `
                                        <div class="outcome-detail action">
                                            <span class="detail-icon">🎯</span>
                                            <div class="detail-content">
                                                <span class="detail-label">Action Required</span>
                                                <p>${details.action}</p>
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${details.result ? `
                                        <div class="outcome-detail result">
                                            <span class="detail-icon">➡️</span>
                                            <div class="detail-content">
                                                <span class="detail-label">Probable Result</span>
                                                <p>${details.result}</p>
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${details.cost ? `
                                        <div class="outcome-detail cost">
                                            <span class="detail-icon">⚖️</span>
                                            <div class="detail-content">
                                                <span class="detail-label">The Cost</span>
                                                <p>${details.cost}</p>
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </section>
            ` : ''}

            <!-- Related Quests Section -->
            ${quest.relatedQuests?.length ? `
                <section class="content-section">
                    <h3 class="section-title"><span class="title-icon">🔗</span> Related Quests</h3>
                    <div class="related-quests-list">
                        ${quest.relatedQuests.map(qId => {
                            const rq = QUEST_DATA[qId];
                            if (!rq) return '';
                            const normalized = normalizeQuestData(rq); // Assumes this function exists
                            return `
                                <button class="related-quest-card" data-quest-id="${qId}">
                                    <span class="related-type" style="color: ${normalized.type.color}">${normalized.type.icon}</span>
                                    <span class="related-title">${normalized.title}</span>
                                    <span class="related-status status-${normalized.status}">${normalized.status}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </section>
            ` : ''}

            <!-- Empty State Check -->
            ${!quest.npcs && !quest.locations && !quest.hints?.length && !quest.consequences && !quest.relatedQuests?.length ? `
                <div class="empty-state-mini">
                    <span class="empty-icon">🔍</span>
                    <p>No additional intel available for this quest.</p>
                </div>
            ` : ''}
        </div>
    `;
}

function buildRewardsPanel(quest) {
    const hasRewards = quest.rewards && (quest.rewards.gold || quest.rewards.xp || quest.rewards.guaranteed?.length || quest.rewards.conditional?.length);

    // Expanded icon map to handle all reward types, including from conditional rewards
    const typeIcons = {
        item: '📦', 
        reputation: '📈', 
        ally: '🤝', 
        intel: '🔍', 
        unlock: '🔓', 
        trait: '⚡',
        boon: '✨', 
        knowledge: '📚',
        tactical: '🗺️',
        variable: '🎲',
        legendary: '🏆'
    };

    return `
        <div class="modal-panel" data-panel="rewards">
            ${hasRewards ? `
                <!-- Base Rewards -->
                ${quest.rewards.gold || quest.rewards.xp ? `
                    <section class="content-section">
                        <h3 class="section-title"><span class="title-icon">💎</span> Base Rewards</h3>
                        <div class="base-rewards">
                            ${quest.rewards.gold ? `
                                <div class="reward-card gold">
                                    <div class="reward-icon">💰</div>
                                    <div class="reward-info">
                                        <span class="reward-value">${formatReward(quest.rewards.gold)}</span>
                                        <span class="reward-label">Gold</span>
                                    </div>
                                </div>
                            ` : ''}
                            ${quest.rewards.xp ? `
                                <div class="reward-card xp">
                                    <div class="reward-icon">⭐</div>
                                    <div class="reward-info">
                                        <span class="reward-value">${formatReward(quest.rewards.xp)}</span>
                                        <span class="reward-label">Experience</span>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </section>
                ` : ''}

                <!-- Guaranteed Rewards -->
                ${quest.rewards.guaranteed?.length ? `
                    <section class="content-section">
                        <h3 class="section-title"><span class="title-icon">🎁</span> Guaranteed Rewards</h3>
                        <div class="rewards-grid">
                            ${quest.rewards.guaranteed.map(r => {
                                if (!r) return '';
                                return `
                                    <div class="reward-item-card ${r.type || ''}">
                                        <span class="reward-item-icon">${typeIcons[r.type] || '🎁'}</span>
                                        <div class="reward-item-info">
                                            <span class="reward-item-name">${r.name || r.type || 'Reward'}</span>
                                            ${r.description ? `<span class="reward-item-desc">${r.description}</span>` : ''}
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </section>
                ` : ''}

                <!-- Conditional Rewards -->
                ${quest.rewards.conditional?.length ? `
                    <section class="content-section">
                        <h3 class="section-title"><span class="title-icon">🔮</span> Conditional Rewards</h3>
                        <div class="conditional-rewards">
                            ${quest.rewards.conditional.map(cr => {
                                if (!cr?.reward) return '';
                                const reward = cr.reward;
                                const rewardIcon = typeIcons[reward.type] || '🎯'; // Default icon
                                return `
                                    <div class="conditional-card ${cr.status || ''}">
                                        <div class="condition-header">
                                            <span class="condition-if">IF:</span>
                                            <span class="condition-text">${cr.condition}</span>
                                            ${cr.status ? `<span class="condition-status status-${cr.status}">${cr.status}</span>` : ''}
                                        </div>
                                        <div class="condition-then">
                                            <span class="then-arrow">→</span>
                                            <span class="then-reward-icon">${rewardIcon}</span>
                                            <div class="then-reward-info">
                                                <span class="then-reward">${reward.name || 'Reward'}</span>
                                                ${reward.description ? `<span class="then-desc">${reward.description}</span>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </section>
                ` : ''}
            ` : `
                <div class="empty-state-mini">
                    <span class="empty-icon">🎁</span>
                    <p>No rewards specified for this quest.</p>
                </div>
            `}
        </div>
    `;
}
function setupModalInteractivity(quest) {
    const modal = document.getElementById('quest-modal');
    if (!modal) return;

    // Tab Navigation
    const navTabs = modal.querySelectorAll('.modal-nav-tab');
    const panels = modal.querySelectorAll('.modal-panel');

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetPanel = tab.dataset.tab;
            
            navTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            panels.forEach(p => {
                p.classList.toggle('active', p.dataset.panel === targetPanel);
            });
            
            currentModalTab = targetPanel;
            playSound?.('../../../assets/audio/ui/click.mp3');
        });
    });

    // Milestone Expansion
    modal.querySelectorAll('.milestone-item').forEach(item => {
        const header = item.querySelector('.milestone-header');
        const body = item.querySelector('.milestone-body');
        const expandBtn = item.querySelector('.milestone-expand');
        
        if (header && body) {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.milestone-expand')) return;
                toggleMilestone(item);
            });
            
            if (expandBtn) {
                expandBtn.addEventListener('click', () => toggleMilestone(item));
            }
        }
    });

    // Related Quest Navigation
    modal.querySelectorAll('.related-quest-card').forEach(card => {
        card.addEventListener('click', () => {
            const questId = card.dataset.questId;
            if (questId && QUEST_DATA[questId]) {
                playSound?.('../../../assets/audio/ui/click.mp3');
                openQuestModal(questId);
            }
        });
    });

    // Arc Link Navigation
    modal.querySelectorAll('.arc-link-card, #view-arc-btn').forEach(el => {
        el.addEventListener('click', () => {
            const arcId = el.dataset.arc;
            if (arcId) {
                closeModal();
                setTimeout(() => renderArcDetail(arcId), 300);
            }
        });
    });

    // Close Button
    modal.querySelector('#modal-close')?.addEventListener('click', closeModal);

    // Track Quest Button
    modal.querySelector('#track-quest-btn')?.addEventListener('click', () => {
        showToast(`Now tracking: ${quest.title}`, 'success');
        playSound?.('success.mp3');
    });

    // NPC Chips (could open character modal)
    modal.querySelectorAll('.npc-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const npcKey = chip.dataset.npc;
            showToast(`Viewing: ${formatKey(npcKey)}`, 'info');
            // Could open a character modal here
        });
    });

    // Assignee Cards
    modal.querySelectorAll('.assignee-card').forEach(card => {
        card.addEventListener('click', () => {
            const charKey = card.dataset.character;
            showToast(`Character: ${formatKey(charKey)}`, 'info');
        });
    });
}

function toggleMilestone(item) {
    const index = item.dataset.milestone;
    const isExpanded = item.classList.contains('expanded');
    
    if (isExpanded) {
        item.classList.remove('expanded');
        expandedMilestones.delete(index);
    } else {
        item.classList.add('expanded');
        expandedMilestones.add(index);
    }
    
    playSound?.('../../../assets/audio/ui/click.mp3');
}

function closeModal() {
    if (!questModal) return;
    questModal.classList.remove('active');
    setTimeout(() => {
        questModal.hidden = true;
        document.body.style.overflow = '';
    }, 300);
}

// ============================================
// EVENT HANDLERS
// ============================================
function setupEventListeners() {
    // Arc Panel Clicks
    arcPanelsContainer?.addEventListener('click', (e) => {
        const panel = e.target.closest('.arc-panel');
        if (panel) {
            playSound?.('../../../assets/audio/ui/click.mp3');
            const arcId = panel.dataset.arc;
            renderArcDetail(arcId);
        }
    });

    // Arc Panel Keyboard
    arcPanelsContainer?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const panel = e.target.closest('.arc-panel');
            if (panel) {
                e.preventDefault();
                playSound?.('../../../assets/audio/ui/click.mp3');
                renderArcDetail(panel.dataset.arc);
            }
        }
    });

    // View All Quests
    document.getElementById('view-all-quests')?.addEventListener('click', () => {
        playSound?.('../../../assets/audio/ui/click.mp3');
        renderAllQuests();
    });

    // Back Buttons
    document.getElementById('back-to-selection')?.addEventListener('click', () => {
        playSound?.('../../../assets/audio/ui/click.mp3');
        renderArcSelection();
    });

    document.getElementById('back-to-selection-from-all')?.addEventListener('click', () => {
        playSound?.('../../../assets/audio/ui/click.mp3');
        renderArcSelection();
    });

    // Arc Quest Filter Tabs
    document.getElementById('arc-quest-filters')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.filter-tab');
        if (tab) {
            playSound?.('../../../assets/audio/ui/click.mp3');
            document.querySelectorAll('#arc-quest-filters .filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            arcQuestFilter = tab.dataset.filter;
            renderArcQuests(selectedArc);
        }
    });

    // Arc Quest Search
    document.getElementById('arc-quest-search')?.addEventListener('input', (e) => {
        arcSearchQuery = e.target.value;
        renderArcQuests(selectedArc);
    });

    // Arc Quest Card Clicks
    document.getElementById('arc-quest-list')?.addEventListener('click', (e) => {
        const card = e.target.closest('.arc-quest-card');
        if (card) {
            playSound?.('../../../assets/audio/ui/click.mp3');
            openQuestModal(card.dataset.questId);
        }
    });

    // All Quests Tab Clicks
    document.getElementById('all-quest-tabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.quest-tab');
        if (tab) {
            playSound?.('../../../assets/audio/ui/click.mp3');
            document.querySelectorAll('#all-quest-tabs .quest-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            allQuestsTab = tab.dataset.tab;
            renderAllQuestsList();
        }
    });

    // All Quests Filters
    document.getElementById('all-sort-select')?.addEventListener('change', (e) => {
        allQuestsSortMode = e.target.value;
        renderAllQuestsList();
    });

    document.getElementById('all-arc-filter')?.addEventListener('change', (e) => {
        allQuestsArcFilter = e.target.value;
        renderAllQuestsList();
    });

    document.getElementById('all-quest-search')?.addEventListener('input', (e) => {
        allQuestsSearchQuery = e.target.value;
        renderAllQuestsList();
    });

    // All Quests Card Clicks
    document.getElementById('all-quest-container')?.addEventListener('click', (e) => {
        const card = e.target.closest('.quest-card');
        if (card) {
            playSound?.('../../../assets/audio/ui/click.mp3');
            openQuestModal(card.dataset.questId);
        }
    });

    // Modal Overlay Click to Close
    questModal?.addEventListener('click', (e) => {
        if (e.target === questModal) closeModal();
    });

    // Keyboard Navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (questModal?.classList.contains('active')) {
                closeModal();
            } else if (currentView === 'arc-detail') {
                renderArcSelection();
            } else if (currentView === 'all-quests') {
                renderArcSelection();
            }
        }
    });
}

// ============================================
// COMPANION SELECTOR & FATIGUE SYSTEM
// ============================================
const COMPANIONS = [
  { id: 'salam', name: 'Salam', role: 'Ranger With Damaged Trust', icon: '🍄', class: 'Ranger' },
  { id: 'eager', name: 'Eager', role: 'Swift Scout', icon: '🍄', class: 'Fighter' },
  { id: 'dan', name: 'Dan', role: 'The Wounded Hero', icon: '🍄', class: 'Mage' },
  { id: 'toad_lee', name: 'Toad Lee', role: 'Warden of the Toads', icon: '🍄', class: 'Fighter' },
  { id: 'ryan', name: 'Ryan', role: 'Arcane Student', icon: '🍄', class: 'Mage' },
  { id: 'roger', name: 'Roger', role: 'Pragmatist Gunner', icon: '🍄', class: 'Fighter' },
  { id: 'bones', name: 'Bones', role: 'Hardened Survivor', icon: '🍄', class: 'Rogue' },
  { id: 'rattles', name: 'Rattles', role: 'Faithful Companion', icon: '🍄', class: 'Survivor' }
];

function getFatigueStates() {
    try {
        const stored = localStorage.getItem('waluipedia-companion-fatigue');
        if (stored) return JSON.parse(stored);
    } catch (e) {}
    
    // Default: everyone is Ready (0)
    const defaults = {};
    COMPANIONS.forEach(c => { defaults[c.id] = 0; });
    return defaults;
}

function saveFatigueStates(states) {
    try {
        localStorage.setItem('waluipedia-companion-fatigue', JSON.stringify(states));
    } catch (e) {}
}

let selectedCompanionId = null;

function renderCompanionSelector(arcId) {
    const container = document.getElementById('arc-companion-panel');
    if (!container) return;

    selectedCompanionId = null; // Reset selection

    const states = getFatigueStates();
    const arc = STORY_ARCS?.[arcId];
    if (!arc || arc.status !== 'active') {
        container.innerHTML = ''; // Only show for active arcs!
        return;
    }

    const cardsHtml = COMPANIONS.map(c => {
        const fatigue = states[c.id] || 0;
        const isReady = fatigue === 0;
        const statusClass = isReady ? 'status-ready' : 'status-resting';
        const statusLabel = isReady ? 'READY' : `RESTING (${fatigue}m left)`;
        const badgeColor = isReady ? 'var(--green)' : 'var(--danger)';
        const opacity = isReady ? '1' : '0.45';
        const cursor = isReady ? 'pointer' : 'not-allowed';
        const clickAttr = isReady ? `onclick="selectCompanion('${c.id}')"` : '';

        return `
            <div class="companion-card" id="comp-card-${c.id}" ${clickAttr} style="opacity: ${opacity}; cursor: ${cursor}; display: flex; gap: 10px; padding: 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; transition: 0.15s; position: relative;">
                <div class="comp-avatar" style="font-size: 24px; line-height: 1; align-self: center;">${c.icon}</div>
                <div class="comp-details" style="flex: 1; min-width: 0;">
                    <div class="comp-name" style="font-weight: 700; font-size: 13.5px; color: var(--text);">${esc(c.name)}</div>
                    <div class="comp-role" style="font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(c.role)}</div>
                </div>
                <div class="comp-status-badge" style="font-size: 9px; font-weight: 900; background: ${badgeColor}22; border: 1px solid ${badgeColor}; color: ${badgeColor}; padding: 1px 6px; border-radius: 999px; position: absolute; top: 8px; right: 8px;">${statusLabel}</div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="companion-selector-wrapper" style="margin-top: 20px; padding: 16px; background: var(--panel2); border: 1px solid var(--border); border-radius: 12px;">
            <div class="flex-between-center" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
                <div>
                    <h3 style="margin: 0; font-size: 16px; color: var(--accent2);">👥 Assign Companion &amp; Launch Arc Mission</h3>
                    <p style="color: var(--muted); font-size: 12px; margin: 2px 0 0;">Select a Ready companion from the roster to deploy on this major story arc. Deployed companions will enter a rest cycle for the next 2 missions while others recover.</p>
                </div>
                <button id="launch-mission-btn" class="chip active" style="margin: 0; padding: 6px 16px; background: var(--border-dim); border-color: var(--border); cursor: not-allowed;" disabled onclick="launchArcMission('${arcId}')">🚀 Launch Arc Mission</button>
            </div>
            <div class="companions-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; max-height: 180px; overflow-y: auto; padding-right: 4px;">
                ${cardsHtml}
            </div>
        </div>
    `;
}

window.selectCompanion = function(compId) {
    COMPANIONS.forEach(c => {
        const el = document.getElementById(`comp-card-${c.id}`);
        if (el) {
            el.style.borderColor = (c.id === compId) ? 'var(--accent)' : 'var(--border)';
            el.style.boxShadow = (c.id === compId) ? '0 0 10px rgba(138,75,255,0.2)' : 'none';
        }
    });

    selectedCompanionId = compId;
    const btn = document.getElementById('launch-mission-btn');
    if (btn) {
        btn.disabled = false;
        btn.style.cursor = 'pointer';
        btn.style.background = 'var(--accent)';
        btn.style.borderColor = 'var(--accent)';
        btn.style.color = '#fff';
        btn.style.boxShadow = '0 4px 12px rgba(138,75,255,0.3)';
    }
    playSound?.('../../../assets/audio/ui/click_subtle.mp3');
};

function getMissionDeploymentNarrative(arcId, compId) {
    const comp = COMPANIONS.find(c => c.id === compId) || { name: 'The Companion' };
    
    const narrativeMap = {
        'shadowfell_estate': {
            'salam': `<h3>🍷 Shadowfell Intrigue: Salam Deployed!</h3><p>Salam was chosen as rear support for the high-stakes dinner at the Onyx Hand's vampire court. Operating under the cover of the gloomy estate gardens, <strong>Salam used his acute senses</strong> to track hidden undead guards patrolling the perimeter. He successfully woodcarved a set of stealth barricade pegs to block a security door, and his vigilant cover allowed Archie and Green T to shatter the Shadowfell anchor crystal and escape without drawing the vampire lords' direct focus!</p>`,
            'eager': `<h3>🍷 Shadowfell Intrigue: Eager Deployed!</h3><p>Eager was deployed as a distraction and scout. Predictably, <strong>Eager triggered a catastrophe magnet moment</strong> by wandering into the Shadow Estate's kitchen, crashing a tray of crystal glasses. However, while panicking, <strong>Eager deployed his pepper spray</strong>, permanently blinding three gargoyle hounds who were blocking the hallway! His chaotic flailing became the perfect cover for the party to make their rooftop Feather Fall escape!</p>`,
            'bones': `<h3>🍷 Shadowfell Intrigue: Bones Deployed!</h3><p>Bones was sent into the estate’s ventilation ducts. Using his <strong>Stealth and Infiltration expertise</strong>, Bones eavesdropped directly over the Vampire Lords' table, mapping their entire security rotation and pocketing several Onyx Hand sigils. His intel let the party dodge every sentinel on the way out!</p>`,
            'dan': `<h3>🍷 Shadowfell Intrigue: Dan Deployed!</h3><p>Dan served as the party’s shield. Utilizing his <strong>Divine Smite and Aura of Life</strong>, Dan kept the planar corruption from sapping the group’s morale during the social intrigue. When X.O.'s shadows loomed, Dan held the doorway single-handedly!</p>`
        },
        'feywild_attic': {
            'salam': `<h3>🌿 Feywild Fracture: Salam Deployed!</h3><p>Salam was assigned to evict Lady Aurelian's rowdy Satyr guests. Using his <strong>woodcarving knives</strong>, Salam spent hours carving incredibly lifelike and mocking wooden puppets of the Satyr leaders, leaving them around the banquet hall. The Satyrs were so fascinated and insulted by the craftsmanship that they followed the trail of puppets directly out of the greenhouse and into the rosebeds, clearing the area in record time!</p>`,
            'eager': `<h3>🌿 Feywild Fracture: Eager Deployed!</h3><p>Eager was deployed to help clear the overgrown Satyr gardens. While attempting to pick a glowing wild-magic orchid, <strong>Eager fell headfirst into an alchemical vine vat</strong>, triggering a massive, colorful spore-burst! The Satyrs were so thoroughly bewildered (and covered in sticky yellow pollen) by the massive, flailing Toad that they abandoned their bender and fled the manor entirely!</p>`,
            'bones': `<h3>🌿 Feywild Fracture: Bones Deployed!</h3><p>Bones blended into the Feywild foliage using a custom satyr disguise. He slipped behind the banquet table, <strong>quietly purloining several vintage satyr wines</strong> and some valuable feywood carvings. His stealth kept Lady Aurelian’s guards from blaming the party for the chaos.</p>`,
            'dan': `<h3>🌿 Feywild Fracture: Dan Deployed!</h3><p>Dan used his <strong>Feyward Sensory Eye</strong> to navigate the time-dilated corridors, preventing the party from losing several decades. His holy aura neutralised a hostile Satyr charm spell, keeping Waluigi and Hjumpik focused on the mission.</p>`
        },
        'raventree_manor': {
            'salam': `<h3>🏚️ Nexus of Ruin: Salam Deployed!</h3><p>Salam was stationed as a sniper during the reconvergence ritual. From an elevated tree branch at the Silent Grove’s edge, <strong>Salam landed an exceptional eye-shot</strong> with his light crossbow, piercing the primary eye of a feral spectral hound that was charging Markop. His vigilance secured the ritual circle's rear sector!</p>`,
            'eager': `<h3>🏚️ Nexus of Ruin: Eager Deployed!</h3><p>Eager stood watch at the front gates of Raventree. In classic fashion, <strong>Eager got his foot tangled in a rotted portcullis chain</strong>. While flailing, he accidentally pulled down a secret lever, revealing a hidden supply cellar filled with healing potions before a rust monster could chew through his pants! The party dragged him to safety just in time.</p>`,
            'bones': `<h3>🏚️ Nexus of Ruin: Bones Deployed!</h3><p>Bones acted as the vanguard scout. Moving like a shadow, Bones navigated the haunted corridors, <strong>disarming three pressure traps and a magical glyph</strong> before the main party could trigger them. His lockpicking saved critical seconds while escaping the collapsing halls.</p>`,
            'dan': `<h3>🏚️ Nexus of Ruin: Dan Deployed!</h3><p>Dan stood beside Markop at the center of the planar rift. Channeling his <strong>Feyward Aura and Divine Sense</strong>, Dan anchored the team’s physical reality while the timeline fractured around them, keeping the party’s minds from splintering across the planes.</p>`
        }
    };

    const genericNarrative = `<h3>⚡ Arc Mission Launched: ${comp.name} Deployed!</h3><p>${comp.name} (${comp.role}) was successfully assigned as the companion for <strong>${STORY_ARCS?.[arcId]?.name || 'the active arc'}</strong>! They provide excellent perimeter support, scouting, and tactical cover, ensuring the party can navigate the massive planar splits of Raventree Manor safely. They have now entered their rest and recovery cycle.</p>`;

    return narrativeMap[arcId]?.[compId] || genericNarrative;
}

window.launchArcMission = function(arcId) {
    if (!selectedCompanionId) return;

    playSound?.('../../../assets/audio/ui/confirm.mp3');

    // Update fatigue states
    const states = getFatigueStates();
    
    // Set selected to 2 (Resting - 2 missions left)
    states[selectedCompanionId] = 2;

    // Decrement others
    COMPANIONS.forEach(c => {
        if (c.id !== selectedCompanionId) {
            const fatigue = states[c.id] || 0;
            if (fatigue > 0) {
                states[c.id] = fatigue - 1;
            }
        }
    });

    saveFatigueStates(states);

    // Build results overlay modal
    const comp = COMPANIONS.find(c => c.id === selectedCompanionId);
    const narrative = getMissionDeploymentNarrative(arcId, selectedCompanionId);

    const overlay = document.createElement('div');
    overlay.id = 'mission-results-modal';
    overlay.className = 'rep-modal-overlay';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '1000';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.8)';
    overlay.onclick = (e) => { if (e.target === overlay) closeMissionResults(); };

    overlay.innerHTML = `
        <style>
          .mission-results-box {
              background: linear-gradient(135deg, rgba(20,10,35,0.95), rgba(10,5,20,0.98)), var(--panel);
              border: 2px solid var(--accent);
              box-shadow: 0 0 30px rgba(138,75,255,0.4);
              max-width: 600px;
              width: 90%;
              padding: 24px;
              border-radius: 16px;
              position: relative;
              color: var(--text);
              animation: modalScaleUp 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          }
          @keyframes modalScaleUp {
              from { transform: scale(0.85); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
          }
          .results-header {
              display: flex;
              align-items: center;
              gap: 12px;
              border-bottom: 1px solid var(--border);
              padding-bottom: 12px;
              margin-bottom: 16px;
          }
          .results-header h2 {
              margin: 0;
              font-family: 'Orbitron', 'Cinzel', sans-serif;
              font-size: 20px;
              letter-spacing: 1px;
              color: var(--accent2);
          }
          .results-body {
              font-size: 14px;
              line-height: 1.65;
              margin-bottom: 20px;
          }
          .results-body p {
              margin-top: 0;
          }
          .results-body strong {
              color: var(--accent2);
          }
          .results-footer {
              display: flex;
              justify-content: flex-end;
          }
        </style>
        <div class="mission-results-box">
            <div class="results-header">
                <span style="font-size: 32px;">⚡</span>
                <h2>MISSION SUCCESSFUL!</h2>
            </div>
            <div class="results-body">
                ${narrative}
                <div style="background: rgba(138,75,255,0.08); border-left: 3px solid var(--accent); padding: 10px 14px; border-radius: 6px; font-size: 12.5px; color: var(--muted); margin-top: 14px;">
                    ℹ️ <strong>Roster fatigue updated:</strong> <strong>${esc(comp.name)}</strong> is now <strong>RESTING</strong> and will be unavailable for the next 2 missions while other resting companions have progressed 1 mission closer to recovery.
                </div>
            </div>
            <div class="results-footer">
                <button class="chip active" onclick="closeMissionResults()" style="margin: 0; background: var(--accent); border-color: var(--accent); color: #fff; padding: 6px 20px; font-weight: 700; cursor: pointer; border-radius: 8px;">Confirm &amp; Complete</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
};

window.closeMissionResults = function() {
    const modal = document.getElementById('mission-results-modal');
    if (modal) modal.remove();
    playSound?.('../../../assets/audio/ui/click_subtle.mp3');
    
    // Refresh detail view to update roster states
    if (selectedArc) {
        renderArcDetail(selectedArc);
    }
};

// ============================================
// INITIALIZATION
// ============================================
function init() {
    // Get DOM elements after load
    arcSelectionScreen = document.getElementById('arc-selection-screen');
    arcDetailView = document.getElementById('arc-detail-view');
    allQuestsView = document.getElementById('all-quests-view');
    arcPanelsContainer = document.getElementById('arc-panels-container');
    questModal = document.getElementById('quest-modal');

    if (!arcSelectionScreen) {
        console.error('Arc selection screen not found');
        return;
    }

    renderArcSelection();
    setupEventListeners();
    
    console.log('Quest Arc System initialized');
}

// Wait for DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}