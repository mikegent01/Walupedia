

import { state, loadState, saveState } from '../../core/state.js';
import { NATIONS, RESEARCH_CATEGORIES, getTechTree, AGES, AGE_CHOICES, getActiveAge, calculateGlobalCycle, getAbsoluteDay, getGlobalAverageAge, CYCLE_PHASES, SLOT_MULTIPLIERS, RESEARCH_TO_ESTATE_MAPPING, calculateDemographicBonus, calculateGuildBonus } from '../../../data/support/research-data.js';
import { CALENDAR_DATA, CURRENT_GAME_DATE } from '../../../data/world/calendar.js';
import { LORE_DATA } from '../../core/lore.js';
import { playSound } from '../../core/common.js';
import { WAHWIRE_POSTS } from '../../../data/assembly/assembly-data.js';

// Constants
const NODE_WIDTH = 160;
const NODE_HEIGHT = 90;
const X_SPACING = 200;
const Y_SPACING = 180;

// State
let activeNation = Object.keys(NATIONS)[0];
let activeCategory = RESEARCH_CATEGORIES[0];
let currentView = 'tree';
let currentZoom = 1.0;
let visibleTierCount = 10;
let globalCycleState = null; // Holds the calculated dynamic cycle
let showAllFactors = false; // Toggle for showing all driving factors

// DOM Elements
const nationListEl = document.getElementById('nation-list');
const categoryTabsEl = document.getElementById('category-tabs');
const treeCanvasEl = document.getElementById('tech-tree-canvas');
const treeContainer = document.getElementById('tree-container');
const bannerEl = document.getElementById('active-project-banner');
const rumorBannerEl = document.getElementById('rumor-impact-banner');
const eraBarContainer = document.getElementById('era-progress-bar-container');
const detailPanel = document.getElementById('detail-panel');
const detailPanelContent = document.getElementById('detail-panel-content');
const detailPanelClose = document.getElementById('detail-panel-close');
const appContainer = document.getElementById('app');
const viewTreeBtn = document.querySelector('[data-view="tree"]');
const viewAgesBtn = document.querySelector('[data-view="ages"]');
const dynasticContainer = document.getElementById('dynastic-cycle-container');

// --- Calculations ---

function calculateResearchDate(daysToAdd) {
    const daysPerYear = 365;
    const startYear = 1035;

    // Calculate current absolute day
    let currentAbsoluteDay = 0;
    currentAbsoluteDay += (CURRENT_GAME_DATE.year - startYear) * daysPerYear;

    const months = CALENDAR_DATA.months.values;
    for(let i=0; i<CURRENT_GAME_DATE.monthIndex; i++) {
        currentAbsoluteDay += months[i].days;
    }
    currentAbsoluteDay += (CURRENT_GAME_DATE.day - 1); // Day is 1-indexed

    // Add research days
    let targetAbsoluteDay = currentAbsoluteDay + daysToAdd;

    // Convert back to Game Date
    const estYearsPassed = Math.floor(targetAbsoluteDay / daysPerYear);
    const estYear = startYear + estYearsPassed;

    let remainingDays = targetAbsoluteDay % daysPerYear;
    let estMonthIndex = 0;
    let estDay = 0;

    for (let i = 0; i < months.length; i++) {
        if (remainingDays < months[i].days) {
            estMonthIndex = i;
            estDay = remainingDays + 1; // Back to 1-indexed
            break;
        }
        remainingDays -= months[i].days;
    }

    // Safety fallback if loop finishes without assignment (e.g. last day of year)
    if (estDay === 0) {
         estDay = remainingDays + 1;
    }

    const monthName = months[estMonthIndex]?.name || "Unknown";

    return `${monthName} ${estDay}, ${estYear} BF`;
}

function autoSelectAgeChoice(nationKey, ageId) {
    const history = state.researchState[nationKey]?.ageHistory || [];
    if (history.some(h => h.ageId === ageId)) return;

    const preference = NATIONS[nationKey].preference || 'balanced';
    const choices = AGE_CHOICES[ageId];
    if(!choices) return;

    let bestChoice = choices.find(c => c.type === preference);
    if (!bestChoice) bestChoice = choices[0];

    if (!state.researchState[nationKey].ageHistory) state.researchState[nationKey].ageHistory = [];
    state.researchState[nationKey].ageHistory.push({
        ageId: ageId,
        choiceId: bestChoice.id,
        choiceName: bestChoice.name
    });
    saveState();
}

function updateGlobalCycle() {
    // Recalculate the global cycle state based on current rumors and posts
    globalCycleState = calculateGlobalCycle(WAHWIRE_POSTS);
}

// --- Rendering ---

function renderNationList() {
    nationListEl.innerHTML = Object.entries(NATIONS).map(([key, data]) => `
        <li class="${key === activeNation ? 'active' : ''}" data-nation="${key}">
            <span class="nation-icon">${data.icon}</span>
            <span>${data.name}</span>
        </li>
    `).join('');
}

function renderCategoryTabs() {
    const nationData = NATIONS[activeNation];
    // Get bonuses
    const demoBonuses = calculateDemographicBonus(activeNation);
    const guildBonuses = calculateGuildBonus(activeNation);

    categoryTabsEl.innerHTML = RESEARCH_CATEGORIES.map(cat => {
        let slotType = 'Minor';
        let slotClass = 'minor';

        if (nationData.slots.primary === cat) { slotType = 'Primary'; slotClass = 'primary'; }
        else if (nationData.slots.major.includes(cat)) { slotType = 'Major'; slotClass = 'major'; }

        const isActive = cat === activeCategory ? 'active' : '';

        let bonusHTML = '';

        // Demographic Bonus
        const dBonus = demoBonuses[cat] || 1.0;
        if (dBonus > 1.0) {
            const percent = Math.round((dBonus - 1) * 100);
            bonusHTML += `<div class="bonus-badge" title="Demographic Efficiency">+${percent}% SPD (Pop)</div>`;
        }

        // Guild Bonus
        const gBonus = guildBonuses[cat] || 1.0;
        if (gBonus > 1.0) {
            const percent = Math.round((gBonus - 1) * 100);
            bonusHTML += `<div class="bonus-badge" style="background-color:#e3b341; margin-top:2px;" title="Guild Contract Efficiency">+${percent}% SPD (Guild)</div>`;
        }

        return `
            <div class="category-btn ${isActive} slot-${slotClass}" data-category="${cat}">
                <div style="font-size:0.7em; opacity:0.8; text-transform:uppercase;">${slotType} Slot</div>
                ${cat}
                ${bonusHTML}
            </div>
        `;
    }).join('');
}

function renderCycleBanner() {
    if (!globalCycleState) return;

    const phase = globalCycleState.phase;
    const momentum = globalCycleState.momentum;

    // Determine if cycle is shifted
    const isShifted = phase.id !== globalCycleState.naturalPhase.id;

    if (isShifted) {
        const momentumType = momentum > 0 ? "Escalating" : "Stabilizing";
        rumorBannerEl.style.display = 'flex';
        rumorBannerEl.className = momentum > 0 ? 'negative' : 'positive'; // Add classes for CSS
        rumorBannerEl.innerHTML = `
            <span style="font-size:1.5em;">${momentum > 0 ? '🔥' : '🕊️'}</span>
            <div>
                <strong>Global Shift: ${momentumType}</strong><br>
                <span style="font-size:0.9em;">Events have shifted the world from ${globalCycleState.naturalPhase.name} to <strong>${phase.name}</strong>.</span>
            </div>
        `;
    } else {
        rumorBannerEl.style.display = 'none';
    }
}

function renderEraBar() {
    if (!eraBarContainer) return;
    const nationAge = getActiveAge(activeNation);
    autoSelectAgeChoice(activeNation, nationAge.id);

    const currentIndex = AGES.findIndex(a => a.id === nationAge.id);

    const stepsHtml = AGES.map((age, index) => {
        let statusClass = '';
        if (index < currentIndex) statusClass = 'completed';
        else if (index === currentIndex) statusClass = 'active';

        return `
            <div class="era-step ${statusClass}">
                <div class="era-label">${age.name}</div>
                <div class="era-dot"></div>
            </div>
        `;
    }).join('');

    const history = state.researchState[activeNation]?.ageHistory || [];
    const currentChoice = history.find(h => h.ageId === nationAge.id);
    const choiceText = currentChoice ? `Current Focus: ${currentChoice.choiceName}` : "Focus Pending Selection";

    eraBarContainer.innerHTML = `
        <div class="era-progress-bar">
            ${stepsHtml}
        </div>
        <div class="era-current-info">
            <span><strong>Era:</strong> <span style="color:var(--accent-color)">${nationAge.name}</span></span>
            <span style="margin-left:20px; color:var(--text-secondary); font-size:0.8em;">${choiceText}</span>
        </div>
    `;
}

function renderActiveBanner(nodes) {
    const activeNode = nodes.find(n => n.status === 'researching');

    if (activeNode) {
        bannerEl.style.display = 'flex';
        const daysLeft = Math.ceil((activeNode.cost * (100 - activeNode.progress)) / 100);
        const finishDate = calculateResearchDate(daysLeft);

        // Add visual indicator for speed based on slot
        let speedLabel = "Normal Speed";
        if (activeNode.slotType === 'Primary') speedLabel = "200% Speed (Primary)";
        if (activeNode.slotType === 'Minor') speedLabel = "50% Speed (Minor)";

        bannerEl.innerHTML = `
            <div style="display:flex; flex-direction:column; width:100%;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <span class="banner-label">Current Project: ${activeNode.name}</span>
                    <span class="banner-info">${Math.round(activeNode.progress)}%</span>
                </div>
                <div class="banner-progress-container" style="background:#000; height:10px; border-radius:5px;">
                    <div style="width:${activeNode.progress}%; background:var(--accent-color); height:100%; border-radius:5px;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-top:4px; color:var(--text-secondary);">
                    <span>${speedLabel}</span>
                    <span>Est. Completion: ${finishDate}</span>
                </div>
            </div>
        `;
    } else {
         bannerEl.style.display = 'none';
    }
}

function updateZoom() {
    if(treeCanvasEl) {
        treeCanvasEl.style.transform = `scale(${currentZoom})`;
        treeCanvasEl.style.transformOrigin = 'top left';
        const contentWidth = ((visibleTierCount - 1) * X_SPACING) + NODE_WIDTH + 100;
        const contentHeight = (5 * Y_SPACING) + 100;
        treeCanvasEl.style.width = `${contentWidth}px`;
        treeCanvasEl.style.height = `${contentHeight}px`;
    }
}

function renderTree() {
    treeCanvasEl.innerHTML = '';
    // Pass the global cycle state to get modified costs. Locked projects are
    // beyond the nation's current research progress, so keep them out of the
    // default view until their prerequisites/era make them researchable.
    const treeData = getTechTree(activeNation, activeCategory, state.researchState, globalCycleState);
    const nodes = Object.values(treeData).filter(node => node.status !== 'locked');
    visibleTierCount = Math.max(1, ...nodes.map(node => node.tier));

    renderActiveBanner(nodes);
    renderCycleBanner();

    nodes.forEach(node => {
        const left = (node.tier - 1) * X_SPACING;
        const top = (node.nodeIndex - 1) * Y_SPACING;

        const el = document.createElement('div');
        el.className = `tech-node ${node.status}`;
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.width = `${NODE_WIDTH}px`;
        el.style.height = `${NODE_HEIGHT}px`;

        let progressBarHtml = '';
        if (node.status === 'researching') {
            progressBarHtml = `<div class="node-progress-bar"><div class="node-progress-fill" style="width:${node.progress}%"></div></div>`;
        } else if (node.status === 'completed') {
             progressBarHtml = `<div class="node-progress-bar"><div class="node-progress-fill" style="width:100%; background-color:var(--positive-color)"></div></div>`;
        } else {
             progressBarHtml = `<div class="node-progress-bar"></div>`;
        }

        el.innerHTML = `
            <div class="node-title" title="${node.name}">${node.name}</div>
            <div class="node-meta">
                <span>Tier ${node.tier}</span>
                <span>${node.status === 'completed' ? 'Done' : (node.status === 'researching' ? Math.round(node.progress)+'%' : 'Locked')}</span>
            </div>
            ${progressBarHtml}
        `;

        el.addEventListener('click', () => openNodeDetails(node));
        treeCanvasEl.appendChild(el);
    });

    updateZoom();
}

function drawDynasticWheel(momentum) {
    const canvas = document.getElementById('dynastic-wheel');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = 200;

    const phases = CYCLE_PHASES;
    const numPhases = phases.length;
    const arcSize = (2 * Math.PI) / numPhases;

    ctx.clearRect(0,0,width,height);

    // Draw the wheel static - Tension (index 3) at top
    const rotationOffset = -Math.PI / 2 - (3.5 * arcSize);

    phases.forEach((phase, i) => {
        const startAngle = (i * arcSize) + rotationOffset;
        const endAngle = ((i + 1) * arcSize) + rotationOffset;

        // Slice
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();

        ctx.fillStyle = `${phase.color}44`;
        ctx.fill();
        ctx.strokeStyle = '#21262d';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Slice Label (Rotated)
        const textAngle = startAngle + (arcSize / 2);
        const textDist = radius * 0.7;
        const textX = cx + Math.cos(textAngle) * textDist;
        const textY = cy + Math.sin(textAngle) * textDist;

        ctx.save();
        ctx.translate(textX, textY);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px "Roboto Mono"';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 4;

        const nameParts = phase.name.replace('Cycle of ', '').split(' ');
        nameParts.forEach((part, idx) => {
            ctx.fillText(part, 0, (idx - (nameParts.length-1)/2) * 12);
        });

        ctx.restore();
    });

    // Draw Needle dynamically pointing to the ACTIVE PHASE
    const activePhaseId = globalCycleState.phase.id;
    const activeIndex = phases.findIndex(p => p.id === activePhaseId);

    const needleAngle = (activeIndex * arcSize) + rotationOffset + (arcSize / 2);

    // Needle
    const needleLen = radius - 20;
    const nx = cx + Math.cos(needleAngle) * needleLen;
    const ny = cy + Math.sin(needleAngle) * needleLen;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = '#ff4757';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Center Hub
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, 2 * Math.PI);
    ctx.fillStyle = '#161b22';
    ctx.fill();
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Score in center
    ctx.fillStyle = '#ff4757';
    ctx.font = 'bold 24px Orbitron';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(momentum.toFixed(2), cx, cy);
}

function renderDynasticCycleView() {
    if (!globalCycleState) updateGlobalCycle();
    const nationAge = getActiveAge(activeNation);
    const currentPhase = globalCycleState.phase;
    const momentum = globalCycleState.momentum;
    const factors = globalCycleState.factors;
    const pendingFactors = globalCycleState.pendingFactors || [];

    // Check debug mode
    const isDebugMode = window.debugMode === true || state?.debugMode === true;

    document.getElementById('cycle-current-age').textContent = nationAge.name;
    document.getElementById('cycle-age-desc').textContent = `Tech Level: ${nationAge.description}`;

    const history = state.researchState[activeNation]?.ageHistory || [];
    const currentChoiceEntry = history.find(h => h.ageId === nationAge.id);

    let effectHTML = '';
    if (currentChoiceEntry) {
        const choicesForAge = AGE_CHOICES[nationAge.id];
        const fullChoiceData = choicesForAge?.find(c => c.id === currentChoiceEntry.choiceId);
        if (fullChoiceData) {
            effectHTML = `
                <div class="active-age-effect-card">
                    <h4>Current Doctrine: ${fullChoiceData.name}</h4>
                    <p class="age-flavor">"${fullChoiceData.flavor}"</p>
                    <div class="age-effect-stat">
                        <strong>ACTIVE EFFECT:</strong> ${fullChoiceData.effect}
                    </div>
                    <div class="age-type-tag type-${fullChoiceData.type}">${fullChoiceData.type}</div>
                </div>
            `;
        }
    } else {
        effectHTML = `<div class="active-age-effect-card" style="border-style:dashed; text-align:center; color:var(--text-secondary);">No specialized doctrine selected for this era.</div>`;
    }

    // Render Driving Factors
    let factorsHTML = '';
    if (factors.length > 0) {
        factorsHTML += `<div class="driving-factors-list"><h6>Active Driving Factors:</h6>`;

        const topFactors = factors.slice(0, 5);
        factorsHTML += topFactors.map(f => `
            <div class="factor-item type-${f.type}">
                <div style="flex-grow:1;">
                    <span class="factor-name">${f.name}</span>
                    <span class="factor-push">→ Pushes to ${f.pushTarget}</span>
                </div>
                <span class="factor-label">${f.label} (${f.impact > 0 ? '+' : ''}${f.impact.toFixed(1)})</span>
            </div>`).join('');

        if (factors.length > 5) {
            const hiddenFactors = factors.slice(5);
            factorsHTML += `<div id="hidden-factors" class="${showAllFactors ? '' : 'hidden'}">
                ${hiddenFactors.map(f => `
                    <div class="factor-item type-${f.type}">
                        <div style="flex-grow:1;">
                            <span class="factor-name">${f.name}</span>
                            <span class="factor-push">→ Pushes to ${f.pushTarget}</span>
                        </div>
                        <span class="factor-label">${f.label} (${f.impact > 0 ? '+' : ''}${f.impact.toFixed(1)})</span>
                    </div>`).join('')}
            </div>
            <button id="toggle-factors-btn" class="control-btn small" style="width:100%; margin-top:5px;">${showAllFactors ? 'Show Less' : `Show ${hiddenFactors.length} More`}</button>`;
        }

        factorsHTML += `</div>`;
    } else {
        factorsHTML = `<p class="small">No major rumors influencing the cycle.</p>`;
    }

    // Render Pending (Future) Factors - Debug Mode Only
    let pendingHTML = '';
    if (isDebugMode && pendingFactors.length > 0) {
        pendingHTML = `
            <div class="pending-factors-section" style="
                margin-top: 16px;
                padding: 12px;
                background: repeating-linear-gradient(45deg, rgba(255, 68, 68, 0.05), rgba(255, 68, 68, 0.05) 10px, transparent 10px, transparent 20px);
                border: 2px dashed #ff4444;
                border-radius: 8px;
            ">
                <h6 style="color: #ff6b35; margin-bottom: 8px;">
                    🔮 Pending Future Events (Debug Mode)
                    <span style="font-size: 0.8em; opacity: 0.7;">(${pendingFactors.length})</span>
                </h6>
                <p style="font-size: 0.8em; color: var(--text-secondary); margin-bottom: 8px;">
                    These events haven't occurred yet. Their effects are NOT included in current calculations.
                </p>
                ${pendingFactors.slice(0, 5).map(f => `
                    <div class="factor-item" style="opacity: 0.7; border-left: 3px solid #ff4444; padding-left: 8px; margin-bottom: 6px;">
                        <div style="flex-grow:1;">
                            <span class="factor-name">${f.name}</span>
                            <span style="font-size: 0.75em; color: #ff6b35;">(Pending)</span>
                        </div>
                        <span class="factor-label" style="color: #ff6b35;">
                            ${f.label} (${f.impact > 0 ? '+' : ''}${f.impact.toFixed(1)})
                        </span>
                    </div>`).join('')}
                ${pendingFactors.length > 5 ? `<p style="font-size: 0.8em; color: var(--text-secondary);">...and ${pendingFactors.length - 5} more pending events</p>` : ''}
            </div>
        `;
    }

    const statsDiv = document.getElementById('cycle-stats');
    const scoreColor = momentum > 0 ? '#f85149' : '#3fb950';

    statsDiv.innerHTML = `
        <hr style="border-color:var(--border-color); margin:16px 0;">

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
             <div style="flex-grow:1; padding-right:10px;">
                <p style="color:${currentPhase.color}; font-size:1.3rem; font-family:var(--font-display); text-transform:uppercase; letter-spacing:1px; margin:0; line-height:1.2;">
                    <strong>${currentPhase.name}</strong>
                </p>
                <p class="cycle-desc" style="margin-top:4px; font-size:0.9rem;">${currentPhase.description}</p>
             </div>
            <div style="text-align:center; background:var(--main-bg); padding:10px; border-radius:8px; border:2px solid ${scoreColor}; min-width: 90px; box-shadow: 0 0 10px ${scoreColor}40;">
                <span style="font-size:1.6rem; font-weight:bold; color:${scoreColor}; display:block;">${momentum.toFixed(2)}</span>
                <span style="display:block; font-size:0.65rem; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Net Momentum</span>
            </div>
        </div>

        <div style="margin-top:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:4px;">
            ${factorsHTML}
        </div>

        ${pendingHTML}

        ${effectHTML}
    `;

    // Event listener for toggle button
    const toggleBtn = document.getElementById('toggle-factors-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            showAllFactors = !showAllFactors;
            renderDynasticCycleView();
            playSound('../../../assets/audio/ui/click.mp3');
        });
    }

    drawDynasticWheel(momentum);

    const historyContainer = document.getElementById('age-history-log');
    if (history.length > 0) {
        historyContainer.innerHTML = `<h4>Doctrine History (${NATIONS[activeNation].name})</h4>` + history.map(h => `
            <div class="history-item">
                <strong>${AGES.find(a=>a.id===h.ageId)?.name || 'Unknown Era'}:</strong> Selected <em>${h.choiceName}</em>
            </div>
        `).join('');
    } else {
        historyContainer.innerHTML = '<p class="small" style="text-align:center; font-style:italic;">No historic shifts recorded for this nation.</p>';
    }
}

function openNodeDetails(node) {
    playSound('../../../assets/audio/ui/click.mp3');
    let statusColor = 'var(--text-secondary)';
    if (node.status === 'completed') statusColor = 'var(--positive-color)';
    if (node.status === 'researching') statusColor = 'var(--accent-color)';

    const daysRemaining = Math.ceil(node.cost * (100 - node.progress) / 100);
    const finishDate = calculateResearchDate(daysRemaining);

    const timeString = node.status === 'researching'
        ? `${daysRemaining} days remaining<br><span class="calendar-estimate">(Exp: ${finishDate})</span>`
        : `${node.cost} days (Base)`;

    // Distribution Logic
    let distributionHTML = "";
    // Only show distribution if the node is known (researching or completed)
    if (node.status === 'completed' || node.status === 'researching') {
        const estateKeys = ['nobility', 'clergy', 'burghers', 'commoners', 'indentured', 'slaves'];
        const mapping = RESEARCH_TO_ESTATE_MAPPING[node.category] || RESEARCH_TO_ESTATE_MAPPING['TECH'];

        const distItems = estateKeys.map(estate => {
            // Base Affinity (0.0 - 1.0)
            const affinity = mapping[estate] || 0.1;

            let percentage = 0;
            if (node.tier <= 2) {
                percentage = 100; // Ancient tech is universal
            } else {
                // New Decay Formula:
                // Decay Rate = 12 - (Affinity * 10)
                // Range: 2% decay per tier (High affinity) to 12% decay (Low affinity)
                const decayRate = 12 - (affinity * 10);
                percentage = 100 - ((node.tier - 1) * decayRate);
            }

            // Apply scaling for researching nodes (super low access until finished)
            if (node.status === 'researching') {
                percentage = percentage * (node.progress / 100);
            }

            // Clamp percentage
            percentage = Math.max(0, Math.min(100, percentage));

            // Formatting Colors
            let color = '#7d8590'; // Grey (Low)
            if (percentage >= 80) color = '#3fb950'; // Green (Universal/High)
            else if (percentage >= 50) color = '#e3b341'; // Yellow (Common)
            else if (percentage >= 20) color = '#d29922'; // Orange (Restricted)
            else if (percentage > 0) color = '#f85149'; // Red (Rare)

            if (percentage > 0) {
                return `<div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:2px;">
                            <span style="text-transform:capitalize;">${estate}</span>
                            <span style="color:${color}; font-weight:bold;">${Math.round(percentage)}%</span>
                        </div>`;
            }
            return null;
        }).filter(item => item !== null).join('');

        if (distItems) {
            distributionHTML = `
                <div class="tech-distribution" style="margin-top:16px; border-top:1px solid var(--border-color); padding-top:12px;">
                    <h4 style="font-size:0.9rem; color:var(--text-secondary); margin-bottom:8px;">Projected Social Distribution</h4>
                    ${distItems}
                </div>
            `;
        }
    }


    const html = `
        <div class="tech-detail-header">
            <h3>${node.name}</h3>
            <div class="tech-detail-status">Status: <span style="color:${statusColor}">${node.status.toUpperCase()}</span></div>
        </div>
        <div class="tech-description">
            <p>${node.flavor}</p>
            <hr style="border-color:var(--border-color); opacity:0.5; margin:10px 0;">
            <p style="color:var(--accent-color)">${node.effect}</p>
        </div>
        <div class="tech-detail-cost">
            <span><strong>Priority Level:</strong> <span style="color:${node.slotType === 'Primary' ? 'var(--positive-color)' : 'var(--text-color)'}">${node.slotType} Slot</span></span>
            <span><strong>Estimate:</strong> ${timeString}</span>
            <span style="font-size:0.8em; color:var(--text-secondary); margin-top:4px;">Tier: ${node.tier}</span>
        </div>
        ${distributionHTML}
    `;
    detailPanelContent.innerHTML = html;
    detailPanel.classList.add('visible');
    appContainer.classList.add('panel-visible');
}

function toggleView(view) {
    currentView = view;
    document.getElementById('view-tree').style.display = view === 'tree' ? 'block' : 'none';
    document.getElementById('view-ages').style.display = view === 'ages' ? 'block' : 'none';

    viewTreeBtn.classList.toggle('active', view === 'tree');
    viewAgesBtn.classList.toggle('active', view === 'ages');

    if (view === 'tree') renderTree();
    if (view === 'ages') renderDynasticCycleView();
}

function renderAll() {
    updateGlobalCycle();
    renderNationList();
    renderCategoryTabs();
    renderEraBar();
    if (currentView === 'tree') renderTree();
    else renderDynasticCycleView();
}

function setupEventListeners() {
    nationListEl.addEventListener('click', e => {
        const li = e.target.closest('li');
        if (li) { playSound('../../../assets/audio/ui/click.mp3'); activeNation = li.dataset.nation; renderAll(); }
    });
    categoryTabsEl.addEventListener('click', e => {
        const btn = e.target.closest('.category-btn');
        if (btn) { playSound('../../../assets/audio/ui/click.mp3'); activeCategory = btn.dataset.category; renderAll(); }
    });
    viewTreeBtn.addEventListener('click', () => toggleView('tree'));
    viewAgesBtn.addEventListener('click', () => toggleView('ages'));
    if (detailPanelClose) {
        detailPanelClose.addEventListener('click', () => { detailPanel.classList.remove('visible'); appContainer.classList.remove('panel-visible'); });
    }

    if(treeContainer) {
        treeContainer.addEventListener('wheel', (e) => {
            if(e.ctrlKey) {
                e.preventDefault();
                if(e.deltaY < 0) currentZoom = Math.min(currentZoom + 0.1, 1.5);
                else currentZoom = Math.max(currentZoom - 0.1, 0.3);
                updateZoom();
            }
        });
        let isDown = false;
        let startX, scrollLeft, startY, scrollTop;
        treeContainer.addEventListener('mousedown', (e) => { isDown = true; treeContainer.classList.add('active'); startX = e.pageX - treeContainer.offsetLeft; scrollTop = treeContainer.scrollTop; startY = e.pageY - treeContainer.offsetTop; scrollLeft = treeContainer.scrollLeft; });
        treeContainer.addEventListener('mouseleave', () => { isDown = false; treeContainer.classList.remove('active'); });
        treeContainer.addEventListener('mouseup', () => { isDown = false; treeContainer.classList.remove('active'); });
        treeContainer.addEventListener('mousemove', (e) => { if (!isDown) return; e.preventDefault(); const x = e.pageX - treeContainer.offsetLeft; const walkX = (x - startX) * 1; treeContainer.scrollLeft = scrollLeft - walkX; const y = e.pageY - treeContainer.offsetTop; const walkY = (y - startY) * 1; treeContainer.scrollTop = scrollTop - walkY; });
    }
}

function init() {
    if (!document.getElementById('research-layout')) return;
    loadState();
    Object.keys(NATIONS).forEach(key => {
        const age = getActiveAge(key);
        autoSelectAgeChoice(key, age.id);
    });
    renderAll();
    setupEventListeners();
}

init();
