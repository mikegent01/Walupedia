// guilds.js
// Comprehensive Guilds & Charters Controller

import { 
    GUILD_DATA, 
    CHARTER_DATA, 
    GUILD_CATEGORIES,
    REPUTATION_TIERS,
    PLAYER_GUILD_DATA,
    getReputationTier,
    getPlayerGuildData,
    getAllPlayerGuilds
} from '../../../data/factions/guilds-data.js';
import { state, loadState } from '../../core/state.js';
import { playSound } from '../../core/common.js';
// Add to guilds.js - at the top with other imports

import { getReputation, getGenericFactionAssessment } from '../../systems/reputation.js';
import { getIntelForFaction } from '../../../systems/common.js';
import { LORE_DATA } from '../../core/lore.js';
import { renderGhostlightBoard, handleGhostlightClick, renderSeat, GHOSTLIGHT_COUNT } from './ghostlight-board.js';

// ============================================
// REPUTATION BRIDGE FUNCTIONS
// ============================================

/**
 * Convert guild reputation (0-10000 scale) to directory reputation (-100 to 100 scale)
 */
function guildRepToDirectoryRep(guildRep) {
    // Guild scale: -6000 to 10000
    // Directory scale: -100 to 100
    const normalized = (guildRep + 6000) / 16000; // 0 to 1
    return Math.round((normalized * 200) - 100); // -100 to 100
}

/**
 * Convert directory reputation (-100 to 100) to guild reputation scale
 */
function directoryRepToGuildRep(directoryRep) {
    // Directory scale: -100 to 100
    // Guild scale: -6000 to 10000
    const normalized = (directoryRep + 100) / 200; // 0 to 1
    return Math.round((normalized * 16000) - 6000); // -6000 to 10000
}
function renderServicesTab(guild, playerData, repTier) {
    const services = guild.services || [];
    const user = state.loggedInUser;
    const isMember = playerData?.rank != null;
    
    return `
        <div class="tab-content services-tab">
            <div class="services-header">
                <h3>Guild Services</h3>
                ${!isMember ? `
                    <div class="non-member-notice">
                        <span class="notice-icon">ℹ️</span>
                        <span>Some services are only available to guild members</span>
                    </div>
                ` : ''}
            </div>
            
            ${services.length > 0 ? `
                <div class="services-grid">
                    ${services.map(service => {
                        const isAvailable = !service.memberOnly || isMember;
                        const meetsRepReq = !service.repRequired || (playerData?.reputation >= service.repRequired);
                        const canUse = isAvailable && meetsRepReq;
                        
                        return `
                            <div class="service-card ${canUse ? 'available' : 'locked'}">
                                <div class="service-header">
                                    <span class="service-icon">${service.icon || '🔧'}</span>
                                    <h4 class="service-name">${service.name}</h4>
                                    ${service.memberOnly ? '<span class="member-badge">Members Only</span>' : ''}
                                </div>
                                <p class="service-description">${service.description}</p>
                                
                                ${service.cost ? `
                                    <div class="service-cost">
                                        <span class="cost-label">Cost:</span>
                                        <span class="cost-value">${service.cost}</span>
                                    </div>
                                ` : ''}
                                
                                ${service.repRequired ? `
                                    <div class="service-rep-req ${meetsRepReq ? 'met' : 'unmet'}">
                                        <span class="rep-icon">${meetsRepReq ? '✓' : '○'}</span>
                                        Requires ${service.repRequired} reputation
                                    </div>
                                ` : ''}
                                
                                ${service.benefits ? `
                                    <div class="service-benefits">
                                        <strong>Benefits:</strong>
                                        <ul>
                                            ${service.benefits.map(b => `<li>${b}</li>`).join('')}
                                        </ul>
                                    </div>
                                ` : ''}
                                
                                ${canUse ? `
                                    <button class="use-service-btn" data-service="${service.id || service.name}">
                                        Use Service
                                    </button>
                                ` : `
                                    <div class="locked-reason">
                                        ${!isAvailable ? 'Join guild to access' : `Need ${service.repRequired - (playerData?.reputation || 0)} more rep`}
                                    </div>
                                `}
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : `
                <div class="no-services">
                    <div class="empty-icon">🔧</div>
                    <p>No services information available for this guild.</p>
                </div>
            `}
            
            ${guild.facilities && guild.facilities.length > 0 ? `
                <div class="facilities-section" style="margin-top: 32px;">
                    <h3>Facilities & Amenities</h3>
                    <div class="facilities-grid">
                        ${guild.facilities.map(facility => `
                            <div class="facility-card">
                                <h5>${facility.name}</h5>
                                <span class="facility-type">${facility.type}</span>
                                <p>${facility.description}</p>
                                <div class="facility-access">
                                    <span class="access-label">Access:</span>
                                    <span class="access-value ${facility.access === 'Public' ? 'public' : 'restricted'}">
                                        ${facility.access}
                                    </span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${guild.training ? `
                <div class="training-section" style="margin-top: 32px;">
                    <h3>Training Programs</h3>
                    <div class="training-grid">
                        ${(Array.isArray(guild.training) ? guild.training : [guild.training]).map(program => `
                            <div class="training-card">
                                <h5>${program.name || 'Training Program'}</h5>
                                <p>${program.description || program}</p>
                                ${program.duration ? `<span class="training-duration">Duration: ${program.duration}</span>` : ''}
                                ${program.cost ? `<span class="training-cost">Cost: ${program.cost}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}
/**
 * Get player's reputation with a guild, checking both systems
 */
function getPlayerGuildReputation(playerKey, guildId) {
    // First check PLAYER_GUILD_DATA (guild-specific data)
    if (PLAYER_GUILD_DATA[playerKey] && PLAYER_GUILD_DATA[playerKey][guildId]) {
        return PLAYER_GUILD_DATA[playerKey][guildId].reputation;
    }
    
    // Fall back to directory reputation system and convert
    const directoryRep = getReputation(playerKey, guildId);
    if (directoryRep !== 0) {
        return directoryRepToGuildRep(directoryRep);
    }
    
    // Check state.finalReputations as last resort
    if (state.finalReputations && state.finalReputations[playerKey]) {
        const rep = state.finalReputations[playerKey].reputation[guildId];
        if (rep !== undefined) {
            return directoryRepToGuildRep(rep);
        }
    }
    
    return 0;
}

/**
 * Check if player can join a guild based on reputation requirements
 */
function canJoinGuild(playerKey, guildId) {
    const guild = GUILD_DATA[guildId] || CHARTER_DATA[guildId];
    if (!guild) return { canJoin: false, reason: 'Guild not found' };
    
    const playerRep = getPlayerGuildReputation(playerKey, guildId);
    const repTier = getReputationTier(playerRep);
    
    // Check reputation tier
    if (repTier.name === 'Hostile' || repTier.name === 'Hated') {
        return { 
            canJoin: false, 
            reason: `Your reputation is too low (${repTier.name}). Improve standing first.`,
            currentRep: playerRep,
            requiredRep: REPUTATION_TIERS.unfriendly.min // Need at least Unfriendly
        };
    }
    
    // Check minimum rank reputation requirement (first rank)
    const firstRank = guild.ranks?.[0];
    if (firstRank && playerRep < firstRank.repRequired) {
        return {
            canJoin: false,
            reason: `Requires ${firstRank.repRequired} reputation to join as ${firstRank.title}`,
            currentRep: playerRep,
            requiredRep: firstRank.repRequired
        };
    }
    
    // Check membership requirements
    const reqs = guild.membershipRequirements;
    if (reqs) {
        // Species check
        if (reqs.species && reqs.species.length > 0) {
            const playerChar = LORE_DATA.characters?.[playerKey];
            const playerSpecies = playerChar?.species?.toLowerCase();
            if (playerSpecies && !reqs.species.includes(playerSpecies)) {
                return {
                    canJoin: false,
                    reason: `Only ${reqs.species.join(', ')} may join this guild`,
                    currentRep: playerRep
                };
            }
        }
        
        // Sponsorship check (would need actual sponsorship tracking)
        if (reqs.sponsorship === true) {
            // For now, allow if reputation is high enough (Friendly+)
            if (playerRep < REPUTATION_TIERS.friendly.min) {
                return {
                    canJoin: false,
                    reason: 'Requires sponsorship from existing member (gain Friendly reputation first)',
                    currentRep: playerRep,
                    requiredRep: REPUTATION_TIERS.friendly.min
                };
            }
        }
    }
    
    return { 
        canJoin: true, 
        currentRep: playerRep,
        startingRank: getStartingRank(guild, playerRep)
    };
}

/**
 * Get the rank a player would start at based on their reputation
 */
function getStartingRank(guild, reputation) {
    if (!guild.ranks) return null;
    
    let startingRank = guild.ranks[0];
    
    for (const rank of guild.ranks) {
        if (reputation >= rank.repRequired) {
            startingRank = rank;
        } else {
            break;
        }
    }
    
    return startingRank;
}

/**
 * Get the next rank for progression
 */
function getNextRank(guild, currentRankTitle) {
    if (!guild.ranks) return null;
    
    const currentIndex = guild.ranks.findIndex(r => r.title === currentRankTitle);
    if (currentIndex === -1 || currentIndex >= guild.ranks.length - 1) {
        return null; // Already at max rank
    }
    
    return guild.ranks[currentIndex + 1];
}

/**
 * Check if player can advance to next rank
 */
function canAdvanceRank(playerKey, guildId) {
    const playerData = getPlayerGuildData(playerKey, guildId);
    if (!playerData || !playerData.rank) {
        return { canAdvance: false, reason: 'Not a member of this guild' };
    }
    
    const guild = GUILD_DATA[guildId] || CHARTER_DATA[guildId];
    if (!guild) return { canAdvance: false, reason: 'Guild not found' };
    
    const nextRank = getNextRank(guild, playerData.rank);
    if (!nextRank) {
        return { canAdvance: false, reason: 'Already at maximum rank' };
    }
    
    const currentRep = getPlayerGuildReputation(playerKey, guildId);
    
    if (currentRep < nextRank.repRequired) {
        return {
            canAdvance: false,
            reason: `Need ${nextRank.repRequired - currentRep} more reputation`,
            currentRep,
            requiredRep: nextRank.repRequired,
            nextRank
        };
    }
    
    return {
        canAdvance: true,
        currentRep,
        nextRank
    };
}
// ============================================
// DOM ELEMENTS
// ============================================

const mainContent = document.getElementById('main-content');

// ============================================
// STATE
// ============================================

let currentView = 'dashboard';
let currentFilter = 'all';
let currentCategory = null;
let selectedGuild = null;
let currentTab = 'overview';
let contractDifficulty = 'all';
let contractGuild = 'all';

// ============================================
// INITIALIZATION
// ============================================

function init() {
    loadState();
    render();
    setupEventListeners();
}

function render() {
    if (!mainContent) return;
    
    mainContent.innerHTML = `
        ${renderHeader()}
        <div id="guilds-content" class="guilds-content">
            ${currentView === 'dashboard' ? renderDashboard() : ''}
            ${currentView === 'directory' ? renderDirectory() : ''}
            ${currentView === 'guild-detail' ? renderGuildDetail() : ''}
            ${currentView === 'contracts' ? renderContractsBoard() : ''}
            ${currentView === 'politics' ? renderPoliticsView() : ''}
            ${currentView === 'ghostlight' ? renderGhostlightBoard({ guilds: { ...GUILD_DATA, ...CHARTER_DATA }, user: state.loggedInUser }) : ''}
        </div>
        ${renderModal()}
    `;
    
    attachDynamicListeners();
}

// ============================================
// HEADER & NAVIGATION
// ============================================

function renderHeader() {
    return `
        <div class="guilds-header">
            <div class="guilds-title-section">
                <h2 class="page-title">
                    <span class="title-icon">📜</span>
                    Guilds & Charters Registry
                </h2>
                <p class="page-subtitle">Organizations, Factions & Alliances</p>
            </div>
            
            <nav class="guilds-nav">
                <button class="nav-btn ${currentView === 'dashboard' ? 'active' : ''}" data-view="dashboard">
                    <span class="nav-icon">🏠</span>
                    <span class="nav-label">Dashboard</span>
                </button>
                <button class="nav-btn nav-btn-ghostlight ${currentView === 'ghostlight' ? 'active' : ''}" data-view="ghostlight">
                    <span class="nav-icon">🚂</span>
                    <span class="nav-label">Ghostlight Board</span>
                    <span class="nav-count">${GHOSTLIGHT_COUNT}</span>
                </button>
                <button class="nav-btn ${currentView === 'directory' ? 'active' : ''}" data-view="directory">
                    <span class="nav-icon">📋</span>
                    <span class="nav-label">Directory</span>
                </button>
                <button class="nav-btn ${currentView === 'contracts' ? 'active' : ''}" data-view="contracts">
                    <span class="nav-icon">📝</span>
                    <span class="nav-label">Contracts</span>
                </button>
                <button class="nav-btn ${currentView === 'politics' ? 'active' : ''}" data-view="politics">
                    <span class="nav-icon">🕸️</span>
                    <span class="nav-label">Politics</span>
                </button>
            </nav>
        </div>
    `;
}

// ============================================
// DASHBOARD VIEW
// ============================================

function renderDashboard() {
    const user = state.loggedInUser;
    const playerGuilds = user && user !== 'generic' ? getAllPlayerGuilds(user) : [];
    
    return `
        <button class="gl-banner" data-view="ghostlight">
            <span class="gl-banner-icon">🚂</span>
            <span class="gl-banner-text"><strong>Next stop: Wickermoor Hollow.</strong> ${GHOSTLIGHT_COUNT} guild contracts are open, and every one of them is a ticket on the Ghostlight Express. Pick one.</span>
            <span class="gl-banner-go">Open the board →</span>
        </button>
        <div class="dashboard-grid">
            ${renderMembershipSummary(playerGuilds)}
            ${renderReputationOverview(user)}
            ${renderActiveContracts(user)}
            ${renderGuildNews()}
            ${renderQuickActions()}
        </div>
    `;
}

function renderMembershipSummary(playerGuilds) {
    if (playerGuilds.length === 0) {
        return `
            <div class="dashboard-card membership-summary">
                <div class="card-header">
                    <h3><span class="card-icon">🎖️</span> Your Memberships</h3>
                </div>
                <div class="card-body empty-state">
                    <div class="empty-icon">📜</div>
                    <p>No active guild memberships</p>
                    <button class="action-btn primary" data-view="directory">Browse Guilds</button>
                </div>
            </div>
        `;
    }
    
    return `
        <div class="dashboard-card membership-summary wide">
            <div class="card-header">
                <h3><span class="card-icon">🎖️</span> Your Memberships</h3>
                <span class="badge">${playerGuilds.length} Active</span>
            </div>
            <div class="card-body">
                <div class="membership-grid">
                    ${playerGuilds.map(guild => `
                        <div class="membership-item" data-guild="${guild.id}">
                            <div class="membership-icon">${guild.icon}</div>
                            <div class="membership-info">
                                <h4 class="membership-name">${guild.shortName || guild.name}</h4>
                                <div class="membership-rank">
                                    <span class="rank-badge">${guild.playerData.rank}</span>
                                </div>
                                <div class="membership-rep">
                                    <div class="rep-bar">
                                        <div class="rep-fill" style="width: ${getRepPercentage(guild.playerData.reputation)}%; background: ${guild.reputationTier.color}"></div>
                                    </div>
                                    <span class="rep-tier" style="color: ${guild.reputationTier.color}">${guild.reputationTier.name}</span>
                                </div>
                            </div>
                            <div class="membership-duties">
                                ${(guild.contracts || []).filter(c => c.status === 'assigned').length > 0 
                                    ? `<span class="duty-count">${(guild.contracts || []).filter(c => c.status === 'assigned').length} duties</span>` 
                                    : '<span class="no-duties">No active duties</span>'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderReputationOverview(user) {
    if (!user || user === 'generic') {
        return '';
    }
    
    const playerData = PLAYER_GUILD_DATA[user] || {};
    const allGuilds = { ...GUILD_DATA, ...CHARTER_DATA };
    
    // Sort by reputation
    const sortedReps = Object.entries(playerData)
        .map(([guildId, data]) => ({
            guild: allGuilds[guildId],
            ...data,
            tier: getReputationTier(data.reputation)
        }))
        .filter(item => item.guild)
        .sort((a, b) => b.reputation - a.reputation);
    
    return `
        <div class="dashboard-card reputation-overview">
            <div class="card-header">
                <h3><span class="card-icon">📊</span> Reputation Standing</h3>
            </div>
            <div class="card-body">
                <div class="reputation-list">
                    ${sortedReps.slice(0, 6).map(item => `
                        <div class="reputation-row ${item.reputation < 0 ? 'negative' : 'positive'}">
                            <span class="rep-guild-icon">${item.guild.icon}</span>
                            <span class="rep-guild-name">${item.guild.shortName || item.guild.name}</span>
                            <div class="rep-meter">
                                <div class="rep-meter-bar">
                                    <div class="rep-meter-fill" style="
                                        width: ${Math.min(Math.abs(item.reputation) / 100, 100)}%;
                                        background: ${item.tier.color};
                                    "></div>
                                </div>
                            </div>
                            <span class="rep-value" style="color: ${item.tier.color}">
                                ${item.reputation > 0 ? '+' : ''}${item.reputation}
                            </span>
                            <span class="rep-tier-icon" title="${item.tier.name}">${item.tier.icon}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderActiveContracts(user) {
    const allGuilds = { ...GUILD_DATA, ...CHARTER_DATA };
    let availableContracts = [];
    
    Object.values(allGuilds).forEach(guild => {
        if (guild.contracts) {
            guild.contracts.forEach(contract => {
                if (contract.status === 'available' || contract.status === 'urgent') {
                    availableContracts.push({
                        ...contract,
                        guildId: guild.id,
                        guildName: guild.shortName || guild.name,
                        guildIcon: guild.icon
                    });
                }
            });
        }
    });
    
    // Sort: urgent first, then by reward
    availableContracts.sort((a, b) => {
        if (a.status === 'urgent' && b.status !== 'urgent') return -1;
        if (b.status === 'urgent' && a.status !== 'urgent') return 1;
        return (b.reward?.gold || 0) - (a.reward?.gold || 0);
    });
    
    return `
        <div class="dashboard-card contracts-preview">
            <div class="card-header">
                <h3><span class="card-icon">📝</span> Available Contracts</h3>
                <button class="view-all-btn" data-view="contracts">View All</button>
            </div>
            <div class="card-body">
                <div class="contracts-list">
                    ${availableContracts.slice(0, 4).map(contract => `
                        <div class="contract-preview-item ${contract.status}" data-contract="${contract.id}">
                            <div class="contract-guild-icon">${contract.guildIcon}</div>
                            <div class="contract-preview-info">
                                <h5 class="contract-title">${contract.title}</h5>
                                <span class="contract-guild">${contract.guildName}</span>
                            </div>
                            <div class="contract-preview-meta">
                                <span class="contract-difficulty difficulty-${contract.difficulty}">${contract.difficulty}</span>
                                <span class="contract-reward">
                                    ${contract.reward?.gold ? `💰 ${contract.reward.gold}` : ''}
                                    ${contract.reward?.reputation ? ` ⭐ ${contract.reward.reputation}` : ''}
                                </span>
                            </div>
                            ${contract.status === 'urgent' ? '<span class="urgent-badge">URGENT</span>' : ''}
                        </div>
                    `).join('') || '<p class="no-contracts">No contracts available</p>'}
                </div>
            </div>
        </div>
    `;
}

function renderGuildNews() {
    const allGuilds = { ...GUILD_DATA, ...CHARTER_DATA };
    let allEvents = [];
    
    Object.values(allGuilds).forEach(guild => {
        if (guild.events) {
            guild.events.forEach(event => {
                allEvents.push({
                    ...event,
                    guildId: guild.id,
                    guildName: guild.shortName || guild.name,
                    guildIcon: guild.icon
                });
            });
        }
    });
    
    // Add some rumors as "news"
    Object.values(allGuilds).slice(0, 3).forEach(guild => {
        if (guild.rumors && guild.rumors.length > 0) {
            allEvents.push({
                date: 'Rumor',
                title: guild.rumors[0].substring(0, 50) + '...',
                description: guild.rumors[0],
                guildId: guild.id,
                guildName: guild.shortName || guild.name,
                guildIcon: guild.icon,
                isRumor: true
            });
        }
    });
    
    return `
        <div class="dashboard-card guild-news">
            <div class="card-header">
                <h3><span class="card-icon">📰</span> Guild News & Events</h3>
            </div>
            <div class="card-body">
                <div class="news-feed">
                    ${allEvents.slice(0, 5).map(event => `
                        <div class="news-item ${event.isRumor ? 'rumor' : ''}">
                            <div class="news-icon">${event.guildIcon}</div>
                            <div class="news-content">
                                <div class="news-header">
                                    <span class="news-guild">${event.guildName}</span>
                                    <span class="news-date">${event.date}</span>
                                </div>
                                <h5 class="news-title">${event.title}</h5>
                                ${event.description ? `<p class="news-desc">${event.description.substring(0, 80)}...</p>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderQuickActions() {
    return `
        <div class="dashboard-card quick-actions">
            <div class="card-header">
                <h3><span class="card-icon">⚡</span> Quick Actions</h3>
            </div>
            <div class="card-body">
                <div class="action-buttons">
                    <button class="quick-action-btn" data-view="directory">
                        <span class="action-icon">🔍</span>
                        <span class="action-label">Find a Guild</span>
                    </button>
                    <button class="quick-action-btn" data-view="contracts">
                        <span class="action-icon">📋</span>
                        <span class="action-label">Browse Contracts</span>
                    </button>
                    <button class="quick-action-btn" data-view="politics">
                        <span class="action-icon">🕸️</span>
                        <span class="action-label">View Relations</span>
                    </button>
                    <button class="quick-action-btn" data-action="compare">
                        <span class="action-icon">⚖️</span>
                        <span class="action-label">Compare Guilds</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// DIRECTORY VIEW
// ============================================

function renderDirectory() {
    return `
        <div class="directory-container">
            ${renderDirectoryFilters()}
            ${renderCategoryCards()}
            ${renderGuildGrid()}
        </div>
    `;
}

function renderDirectoryFilters() {
    return `
        <div class="directory-filters">
            <div class="filter-group">
                <label>Type:</label>
                <div class="filter-buttons">
                    <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
                    <button class="filter-btn ${currentFilter === 'guild' ? 'active' : ''}" data-filter="guild">Guilds</button>
                    <button class="filter-btn ${currentFilter === 'charter' ? 'active' : ''}" data-filter="charter">Charters</button>
                    <button class="filter-btn ${currentFilter === 'member' ? 'active' : ''}" data-filter="member">My Memberships</button>
                </div>
            </div>
            <div class="filter-group">
                <label>Category:</label>
                <div class="category-pills">
                    <button class="category-pill ${!currentCategory ? 'active' : ''}" data-category="">All Categories</button>
                    ${Object.entries(GUILD_CATEGORIES).map(([key, cat]) => `
                        <button class="category-pill ${currentCategory === key ? 'active' : ''}" 
                                data-category="${key}"
                                style="--cat-color: ${cat.color}">
                            ${cat.icon} ${cat.name}
                        </button>
                    `).join('')}
                </div>
            </div>
            <div class="filter-group search-group">
                <input type="text" id="guild-search" class="search-input" placeholder="Search guilds...">
            </div>
        </div>
    `;
}

function renderCategoryCards() {
    return `
        <div class="category-overview">
            ${Object.entries(GUILD_CATEGORIES).map(([key, cat]) => {
                const count = getGuildCountByCategory(key);
                return `
                    <div class="category-card" data-category="${key}" style="--cat-color: ${cat.color}">
                        <div class="category-icon">${cat.icon}</div>
                        <div class="category-info">
                            <h4>${cat.name}</h4>
                            <p>${cat.description}</p>
                        </div>
                        <div class="category-count">${count}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderGuildGrid() {
    const allGuilds = getFilteredGuilds();
    const user = state.loggedInUser;
    
    if (allGuilds.length === 0) {
        return `
            <div class="empty-directory">
                <div class="empty-icon">🔍</div>
                <p>No guilds found matching your criteria</p>
            </div>
        `;
    }
    
    return `
        <div class="guilds-grid">
            ${allGuilds.map(guild => {
                const playerData = user && user !== 'generic' ? getPlayerGuildData(user, guild.id) : null;
                const repTier = playerData ? getReputationTier(playerData.reputation) : null;
                // != null: logged-out visitors have no playerData, and
                // `undefined !== null` used to mark every guild as joined.
                const isMember = playerData?.rank != null;
                const category = GUILD_CATEGORIES[guild.category];

                return `
                    <div class="guild-card ${isMember ? 'is-member' : ''}" 
                         data-guild="${guild.id}"
                         style="--guild-color: ${category?.color || '#888'}">
                        ${isMember ? '<div class="member-ribbon">MEMBER</div>' : ''}
                        <div class="guild-card-header">
                            <div class="guild-icon-large">${guild.icon}</div>
                            <div class="guild-title-section">
                                <h4 class="guild-name">${guild.name}</h4>
                                <span class="guild-category">${category?.icon || ''} ${category?.name || ''}</span>
                            </div>
                        </div>
                        
                        <div class="guild-card-body">
                            <p class="guild-motto">"${guild.motto}"</p>
                            <p class="guild-description">${guild.description.substring(0, 120)}...</p>
                            
                            <div class="guild-stats-row">
                                <div class="stat">
                                    <span class="stat-icon">📍</span>
                                    <span class="stat-value">${guild.headquarters.split(',')[0]}</span>
                                </div>
                                <div class="stat">
                                    <span class="stat-icon">👥</span>
                                    <span class="stat-value">${guild.resources?.manpower || '???'}</span>
                                </div>
                                <div class="stat">
                                    <span class="stat-icon">💪</span>
                                    <span class="stat-value">${guild.resources?.influence || '???'}%</span>
                                </div>
                            </div>
                            
                            ${playerData ? `
                                <div class="guild-reputation-bar">
                                    <div class="rep-header">
                                        <span class="rep-label">Your Standing</span>
                                        <span class="rep-tier" style="color: ${repTier.color}">${repTier.icon} ${repTier.name}</span>
                                    </div>
                                    <div class="rep-bar">
                                        <div class="rep-fill" style="width: ${getRepPercentage(playerData.reputation)}%; background: ${repTier.color}"></div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="guild-card-footer">
                            ${isMember 
                                ? `<span class="rank-display">${playerData.rank}</span>` 
                                : '<button class="learn-more-btn">Learn More</button>'}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ============================================
// GUILD DETAIL VIEW
// ============================================

function renderGuildDetail() {
    if (!selectedGuild) return '<p>No guild selected</p>';
    
    const guild = GUILD_DATA[selectedGuild] || CHARTER_DATA[selectedGuild];
    if (!guild) return '<p>Guild not found</p>';
    
    const user = state.loggedInUser;
    const playerData = user && user !== 'generic' ? getPlayerGuildData(user, guild.id) : null;
    const repTier = playerData ? getReputationTier(playerData.reputation) : null;
    const category = GUILD_CATEGORIES[guild.category];
    
    return `
        <div class="guild-detail-container">
            <button class="back-btn" data-view="directory">
                <span>←</span> Back to Directory
            </button>
            
            <div class="guild-detail-header" style="--guild-color: ${category?.color || '#888'}">
                <div class="guild-banner">
                    <div class="guild-icon-huge">${guild.icon}</div>
                </div>
                <div class="guild-header-info">
                    <span class="guild-category-badge">${category?.icon || ''} ${category?.name || ''}</span>
                    <h1 class="guild-detail-name">${guild.name}</h1>
                    <p class="guild-detail-motto">"${guild.motto}"</p>
                    <div class="guild-header-meta">
                        <span><strong>Founded:</strong> ${guild.founded}</span>
                        <span><strong>HQ:</strong> ${renderSeat(guild)}</span>
                    </div>
                    ${playerData ? `
                        <div class="player-standing-badge">
                            <span class="standing-icon" style="color: ${repTier.color}">${repTier.icon}</span>
                            <span class="standing-text">
                                ${playerData.rank ? `${playerData.rank} • ` : ''}
                                <span style="color: ${repTier.color}">${repTier.name}</span>
                            </span>
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <div class="guild-detail-tabs">
                <button class="tab-btn ${currentTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
                <button class="tab-btn ${currentTab === 'ranks' ? 'active' : ''}" data-tab="ranks">Ranks & Rules</button>
                <button class="tab-btn ${currentTab === 'services' ? 'active' : ''}" data-tab="services">Services</button>
                <button class="tab-btn ${currentTab === 'contracts' ? 'active' : ''}" data-tab="contracts">Contracts</button>
                <button class="tab-btn ${currentTab === 'relations' ? 'active' : ''}" data-tab="relations">Relations</button>
                <button class="tab-btn ${currentTab === 'history' ? 'active' : ''}" data-tab="history">History</button>
            </div>
            
            <div class="guild-detail-content">
                ${renderGuildTab(guild, playerData, repTier)}
            </div>
        </div>
    `;
}

function renderGuildTab(guild, playerData, repTier) {
    switch (currentTab) {
        case 'overview':
            return renderOverviewTab(guild, playerData);
        case 'ranks':
            return renderRanksTab(guild, playerData);
        case 'services':
            return renderServicesTab(guild, playerData, repTier);
        case 'contracts':
            return renderContractsTab(guild);
        case 'relations':
            return renderRelationsTab(guild);
        case 'history':
            return renderHistoryTab(guild);
        default:
            return renderOverviewTab(guild, playerData);
    }
}

function renderOverviewTab(guild, playerData) {
    return `
        <div class="tab-content overview-tab">
            <div class="overview-grid">
                <div class="overview-section description-section">
                    <h3>About</h3>
                    <p>${guild.description}</p>
                    <div class="lore-text">${guild.lore}</div>
                </div>
                
                <div class="overview-section leadership-section">
                    <h3>Leadership</h3>
                    <div class="leader-card">
                        <div class="leader-portrait">
                            <div class="portrait-placeholder">${guild.icon}</div>
                        </div>
                        <div class="leader-info">
                            <h4>${guild.leader.name}</h4>
                            <span class="leader-title">${guild.leader.title}</span>
                            <p>${guild.leader.description}</p>
                        </div>
                    </div>
                    
                    ${guild.officers ? `
                        <h4 style="margin-top: 16px;">Officers</h4>
                        <div class="officers-list">
                            ${guild.officers.map(officer => `
                                <div class="officer-item">
                                    <strong>${officer.name}</strong>
                                    <span class="officer-role">${officer.role}</span>
                                    <p>${officer.description}</p>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
                
                <div class="overview-section resources-section">
                    <h3>Resources & Influence</h3>
                    <div class="resources-grid">
                        ${guild.resources.treasury !== 'Unknown' && guild.resources.treasury !== 'Classified' ? `
                            <div class="resource-item">
                                <span class="resource-icon">💰</span>
                                <span class="resource-label">Treasury</span>
                                <span class="resource-value">${typeof guild.resources.treasury === 'number' ? guild.resources.treasury.toLocaleString() + ' gold' : guild.resources.treasury}</span>
                            </div>
                        ` : ''}
                        <div class="resource-item">
                            <span class="resource-icon">📊</span>
                            <span class="resource-label">Influence</span>
                            <div class="resource-bar">
                                <div class="resource-fill" style="width: ${guild.resources.influence}%"></div>
                            </div>
                            <span class="resource-value">${guild.resources.influence}%</span>
                        </div>
                        ${guild.resources.manpower !== 'Unknown' ? `
                            <div class="resource-item">
                                <span class="resource-icon">👥</span>
                                <span class="resource-label">Members</span>
                                <span class="resource-value">${guild.resources.manpower}</span>
                            </div>
                        ` : ''}
                    </div>
                    
                    ${guild.resources.materials ? `
                        <h4 style="margin-top: 16px;">Material Resources</h4>
                        <div class="materials-grid">
                            ${Object.entries(guild.resources.materials).map(([key, value]) => `
                                <div class="material-item">
                                    <span class="material-label">${key}</span>
                                    <div class="material-bar">
                                        <div class="material-fill" style="width: ${value}%"></div>
                                    </div>
                                    <span class="material-value">${value}%</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
                
                <div class="overview-section facilities-section">
                    <h3>Facilities</h3>
                    <div class="facilities-grid">
                        ${guild.facilities.map(facility => `
                            <div class="facility-card">
                                <h5>${facility.name}</h5>
                                <span class="facility-type">${facility.type}</span>
                                <p>${facility.description}</p>
                                <span class="facility-access">Access: ${facility.access}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="overview-section rumors-section">
                    <h3>Rumors & Whispers</h3>
                    <div class="rumors-list">
                        ${guild.rumors.map(rumor => `
                            <div class="rumor-item">
                                <span class="rumor-icon">👂</span>
                                <p>${rumor}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="overview-section bonus-section">
                    <h3>Research Bonus</h3>
                    <div class="research-bonus-card">
                        <span class="bonus-value">+${(guild.research_bonus.amount * 100)}%</span>
                        <span class="bonus-category">${guild.research_bonus.category}</span>
                        <p>${guild.research_bonus.description}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderRanksTab(guild, playerData) {
    const user = state.loggedInUser;
    const playerRep = user && user !== 'generic' ? getPlayerGuildReputation(user, guild.id) : 0;
    const playerRank = playerData?.rank;
    const isMember = playerRank !== null;
    
    // Check join eligibility
    const joinCheck = user && user !== 'generic' ? canJoinGuild(user, guild.id) : null;
    
    // Check advancement
    const advanceCheck = isMember && user ? canAdvanceRank(user, guild.id) : null;
    
    return `
        <div class="tab-content ranks-tab">
            ${!isMember && joinCheck ? `
                <div class="membership-status-card ${joinCheck.canJoin ? 'can-join' : 'cannot-join'}">
                    <div class="status-header">
                        <span class="status-icon">${joinCheck.canJoin ? '✅' : '🚫'}</span>
                        <h4>${joinCheck.canJoin ? 'Eligible to Join' : 'Cannot Join Yet'}</h4>
                    </div>
                    <p class="status-reason">${joinCheck.canJoin 
                        ? `You can join as: <strong>${joinCheck.startingRank?.title || 'Member'}</strong>` 
                        : joinCheck.reason}</p>
                    ${!joinCheck.canJoin && joinCheck.requiredRep !== undefined ? `
                        <div class="rep-progress">
                            <div class="rep-progress-bar">
                                <div class="rep-progress-fill" style="width: ${Math.max(0, (joinCheck.currentRep / joinCheck.requiredRep) * 100)}%"></div>
                            </div>
                            <span class="rep-progress-text">${joinCheck.currentRep} / ${joinCheck.requiredRep} reputation</span>
                        </div>
                    ` : ''}
                    ${joinCheck.canJoin ? `
                        <button class="join-guild-btn" data-guild="${guild.id}">
                            Apply for Membership
                        </button>
                    ` : ''}
                </div>
            ` : ''}
            
            ${isMember && advanceCheck ? `
                <div class="advancement-status-card ${advanceCheck.canAdvance ? 'can-advance' : ''}">
                    <div class="status-header">
                        <span class="status-icon">${advanceCheck.canAdvance ? '⬆️' : '📊'}</span>
                        <h4>Rank Advancement</h4>
                    </div>
                    ${advanceCheck.nextRank ? `
                        <p class="status-reason">
                            ${advanceCheck.canAdvance 
                                ? `Ready to advance to <strong>${advanceCheck.nextRank.title}</strong>!` 
                                : `Next rank: <strong>${advanceCheck.nextRank.title}</strong> - ${advanceCheck.reason}`}
                        </p>
                        <div class="rep-progress">
                            <div class="rep-progress-bar">
                                <div class="rep-progress-fill" style="width: ${Math.min(100, (advanceCheck.currentRep / advanceCheck.requiredRep) * 100)}%"></div>
                            </div>
                            <span class="rep-progress-text">${advanceCheck.currentRep} / ${advanceCheck.requiredRep || advanceCheck.nextRank.repRequired} reputation</span>
                        </div>
                        ${advanceCheck.canAdvance ? `
                            <button class="advance-rank-btn" data-guild="${guild.id}">
                                Request Advancement
                            </button>
                        ` : ''}
                    ` : `
                        <p class="status-reason">You have achieved the highest rank!</p>
                    `}
                </div>
            ` : ''}
            
            <div class="ranks-grid">
                <div class="ranks-ladder">
                    <h3>Rank Hierarchy</h3>
                    <div class="rank-list">
                        ${(guild.ranks || []).map((rank, index) => {
                            const isPlayerRank = rank.title === playerRank;
                            const isAchievable = playerRep >= rank.repRequired;
                            const isNextRank = advanceCheck?.nextRank?.title === rank.title;
                            
                            return `
                                <div class="rank-item ${isPlayerRank ? 'current-rank' : ''} ${isAchievable ? 'achievable' : 'locked'} ${isNextRank ? 'next-rank' : ''}">
                                    <div class="rank-tier">Tier ${rank.tier}</div>
                                    <div class="rank-info">
                                        <h4 class="rank-title">${rank.title}</h4>
                                        <p class="rank-description">${rank.description}</p>
                                        <div class="rank-requirements">
                                            <strong>Requirements:</strong> ${rank.requirements}
                                        </div>
                                        <div class="rank-benefits">
                                            <strong>Benefits:</strong>
                                            <ul>
                                                ${(rank.benefits || []).map(b => `<li>${b}</li>`).join('')}
                                            </ul>
                                        </div>
                                        <div class="rank-rep-required ${playerRep >= rank.repRequired ? 'met' : 'unmet'}">
                                            <span class="rep-icon">${playerRep >= rank.repRequired ? '✓' : '○'}</span>
                                            ${rank.repRequired.toLocaleString()} reputation required
                                            ${playerRep < rank.repRequired ? `<span class="rep-needed">(need ${(rank.repRequired - playerRep).toLocaleString()} more)</span>` : ''}
                                        </div>
                                    </div>
                                    ${isPlayerRank ? '<span class="current-badge">YOUR RANK</span>' : ''}
                                    ${isNextRank ? '<span class="next-badge">NEXT RANK</span>' : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                
                <div class="guild-rules">
                    <h3>Guild Rules & Laws</h3>
                    <ol class="rules-list">
                        ${(guild.rules || []).map(rule => `<li>${rule}</li>`).join('')}
                    </ol>
                    
                    <h3 style="margin-top: 24px;">Membership Requirements</h3>
                    <div class="membership-reqs">
                        ${guild.membershipRequirements?.species 
                            ? `<p><strong>Allowed Species:</strong> ${guild.membershipRequirements.species.join(', ')}</p>` 
                            : '<p><strong>Species:</strong> All welcome</p>'}
                        <p><strong>Required Skills:</strong> ${guild.membershipRequirements?.skills?.join(', ') || 'None specified'}</p>
                        <p><strong>Sponsorship Required:</strong> ${guild.membershipRequirements?.sponsorship ? 'Yes' : 'No'}</p>
                        <p><strong>Membership Fee:</strong> ${guild.membershipRequirements?.fee || 'None'}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderContractsTab(guild) {
    const contracts = guild.contracts || [];
    
    const availableContracts = contracts.filter(c => c.status === 'available' || c.status === 'urgent');
    const activeContracts = contracts.filter(c => c.status === 'assigned' || c.status === 'in-progress');
    const completedContracts = contracts.filter(c => c.status === 'completed');
    
    return `
        <div class="tab-content contracts-tab">
            <div class="contracts-section">
                <h3>Available Contracts</h3>
                ${availableContracts.length > 0 ? `
                    <div class="contracts-grid">
                        ${availableContracts.map(contract => renderContractCard(contract, guild)).join('')}
                    </div>
                ` : '<p class="no-items">No available contracts at this time.</p>'}
            </div>
            
            ${activeContracts.length > 0 ? `
                <div class="contracts-section" style="margin-top: 32px;">
                    <h3>Your Active Contracts</h3>
                    <div class="contracts-grid">
                        ${activeContracts.map(contract => renderContractCard(contract, guild, true)).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${completedContracts.length > 0 ? `
                <div class="contracts-section" style="margin-top: 32px;">
                    <h3>Completed Contracts</h3>
                    <div class="contracts-grid completed">
                        ${completedContracts.map(contract => renderContractCard(contract, guild, false, true)).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}
function renderContractCard(contract, guild, isActive = false, isCompleted = false) {
    const difficultyColors = {
        'easy': '#4ade80',
        'medium': '#facc15',
        'hard': '#f97316',
        'expert': '#ef4444',
        'legendary': '#a855f7'
    };
    
    // Handle missing objectives - use requirements as fallback
    const objectives = contract.objectives || contract.requirements || [];
    
    return `
        <div class="contract-card ${contract.status} ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}"
             data-contract="${contract.id}">
            ${contract.status === 'urgent' ? '<div class="urgent-banner">⚠️ URGENT</div>' : ''}
            
            <div class="contract-header">
                <h4 class="contract-title">${contract.title}</h4>
                <span class="contract-difficulty" style="background: ${difficultyColors[contract.difficulty] || '#888'}">
                    ${contract.difficulty.toUpperCase()}
                </span>
            </div>
            
            <p class="contract-description">${contract.description}</p>
            
            ${objectives.length > 0 ? `
                <div class="contract-objectives">
                    <strong>${contract.objectives ? 'Objectives:' : 'Requirements:'}</strong>
                    <ul>
                        ${objectives.map(obj => {
                            const task = typeof obj === 'string' ? obj : obj.task;
                            const completed = typeof obj === 'object' && obj.completed;
                            return `<li class="${completed ? 'completed' : ''}">${task}</li>`;
                        }).join('')}
                    </ul>
                </div>
            ` : ''}
            
            <div class="contract-meta">
                ${contract.location ? `
                    <div class="contract-location">
                        <span class="meta-icon">📍</span>
                        ${contract.location}
                    </div>
                ` : ''}
                <div class="contract-deadline">
                    <span class="meta-icon">⏰</span>
                    ${contract.deadline ? (typeof contract.deadline === 'number' ? contract.deadline + ' days' : contract.deadline) : 'No deadline'}
                </div>
            </div>
            
            <div class="contract-rewards">
                <strong>Rewards:</strong>
                <div class="rewards-list">
                    ${contract.reward?.gold ? `<span class="reward-item">💰 ${contract.reward.gold} gold</span>` : ''}
                    ${contract.reward?.reputation ? `<span class="reward-item">⭐ +${contract.reward.reputation} rep</span>` : ''}
                    ${contract.reward?.item ? `<span class="reward-item">🎁 ${contract.reward.item}</span>` : ''}
                </div>
            </div>
            
            ${!isCompleted ? `
                <div class="contract-actions">
                    ${isActive 
                        ? `<button class="contract-btn progress">View Progress</button>`
                        : `<button class="contract-btn accept" data-action="accept-contract">Accept Contract</button>`
                    }
                </div>
            ` : `
                <div class="contract-completed-badge">
                    ✓ Completed
                </div>
            `}
        </div>
    `;
}
function renderRelationsTab(guild) {
    const allGuilds = { ...GUILD_DATA, ...CHARTER_DATA };
    
    // Categorize relations
    const allies = [];
    const rivals = [];
    const neutral = [];
    
    if (guild.relations) {
        Object.entries(guild.relations).forEach(([guildId, relation]) => {
            const relatedGuild = allGuilds[guildId];
            if (!relatedGuild) return;
            
            // Use 'standing' property from data, not 'status'
            const standing = relation.standing || relation.status || 'neutral';
            
            const relationData = {
                guild: relatedGuild,
                standing: standing,
                reason: relation.reason || '',
                history: relation.history || ''
            };
            
            if (standing === 'allied' || standing === 'friendly') {
                allies.push(relationData);
            } else if (standing === 'rival' || standing === 'hostile' || standing === 'war' || standing === 'tense') {
                rivals.push(relationData);
            } else {
                neutral.push(relationData);
            }
        });
    }
    
    return `
        <div class="tab-content relations-tab">
            <div class="relations-overview">
                <div class="relations-section allies">
                    <h3><span class="relation-icon">🤝</span> Allies & Friends</h3>
                    ${allies.length > 0 ? `
                        <div class="relations-grid">
                            ${allies.map(rel => renderRelationCard(rel, 'ally')).join('')}
                        </div>
                    ` : '<p class="no-items">No formal alliances.</p>'}
                </div>
                
                <div class="relations-section rivals">
                    <h3><span class="relation-icon">⚔️</span> Rivals & Enemies</h3>
                    ${rivals.length > 0 ? `
                        <div class="relations-grid">
                            ${rivals.map(rel => renderRelationCard(rel, 'rival')).join('')}
                        </div>
                    ` : '<p class="no-items">No known rivalries.</p>'}
                </div>
                
                <div class="relations-section neutral">
                    <h3><span class="relation-icon">🤷</span> Neutral Relations</h3>
                    ${neutral.length > 0 ? `
                        <div class="relations-grid">
                            ${neutral.map(rel => renderRelationCard(rel, 'neutral')).join('')}
                        </div>
                    ` : '<p class="no-items">No notable neutral relations.</p>'}
                </div>
            </div>
        </div>
    `;
}

function renderRelationCard(rel, type) {
    const statusColors = {
        'allied': '#4ade80',
        'friendly': '#86efac',
        'neutral': '#94a3b8',
        'rival': '#f97316',
        'hostile': '#ef4444',
        'war': '#dc2626',
        'tense': '#fbbf24',
        'business': '#60a5fa',
        'potential': '#a78bfa',
        'rivalry': '#f97316',
        'complicated': '#f59e0b'
    };
    
    const standing = rel.standing || 'neutral';
    
    return `
        <div class="relation-card ${type}" data-guild="${rel.guild.id}">
            <div class="relation-header">
                <span class="relation-guild-icon">${rel.guild.icon}</span>
                <div class="relation-guild-info">
                    <h4>${rel.guild.name}</h4>
                    <span class="relation-status" style="color: ${statusColors[standing] || '#888'}">
                        ${standing.toUpperCase()}
                    </span>
                </div>
            </div>
            <p class="relation-reason">${rel.reason || 'No details available'}</p>
            ${rel.history ? `<p class="relation-history"><em>${rel.history}</em></p>` : ''}
        </div>
    `;
}
function renderHistoryTab(guild) {
    return `
        <div class="tab-content history-tab">
            <div class="history-timeline">
                <h3>Guild History</h3>
                <div class="timeline">
                    ${(guild.history || []).map((event, index) => `
                        <div class="timeline-event ${index === 0 ? 'first' : ''} ${index === guild.history.length - 1 ? 'last' : ''}">
                            <div class="timeline-marker"></div>
                            <div class="timeline-date">${event.year || event.date || 'Unknown'}</div>
                            <div class="timeline-content">
                                <h4>${event.event || event.title || 'Event'}</h4>
                                ${event.description ? `<p>${event.description}</p>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            ${guild.events && guild.events.length > 0 ? `
                <div class="recent-events">
                    <h3 style="margin-top: 32px;">Upcoming Events</h3>
                    <div class="events-list">
                        ${guild.events.map(event => `
                            <div class="event-card">
                                <div class="event-date">${event.date || 'TBD'}</div>
                                <h4>${event.title || 'Event'}</h4>
                                <p>${event.description || ''}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${guild.notableAchievements && guild.notableAchievements.length > 0 ? `
                <div class="achievements-section">
                    <h3 style="margin-top: 32px;">Notable Achievements</h3>
                    <div class="achievements-grid">
                        ${guild.notableAchievements.map(achievement => `
                            <div class="achievement-card">
                                <span class="achievement-icon">🏆</span>
                                <div class="achievement-info">
                                    <h4>${achievement.name}</h4>
                                    <p>${achievement.description}</p>
                                    <span class="achievement-date">${achievement.date}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

// ============================================
// CONTRACTS BOARD VIEW
// ============================================

function renderContractsBoard() {
    const allGuilds = { ...GUILD_DATA, ...CHARTER_DATA };
    let allContracts = [];
    
    Object.values(allGuilds).forEach(guild => {
        if (guild.contracts) {
            guild.contracts.forEach(contract => {
                allContracts.push({
                    ...contract,
                    guildId: guild.id,
                    guildName: guild.shortName || guild.name,
                    guildIcon: guild.icon,
                    location: contract.location || (guild.headquarters || '').split(' (')[0]
                });
            });
        }
    });
    
    // Sort and filter
    allContracts = allContracts.filter(c =>
        (contractDifficulty === 'all' || c.difficulty === contractDifficulty) &&
        (contractGuild === 'all' || c.guildId === contractGuild));
    const urgentContracts = allContracts.filter(c => c.status === 'urgent');
    const availableContracts = allContracts.filter(c => c.status === 'available');
    const playerContracts = allContracts.filter(c => c.status === 'assigned' || c.status === 'in-progress');
    
    return `
        <div class="contracts-board">
            <div class="contracts-board-header">
                <h3>Contracts Board</h3>
                <div class="contracts-filters">
                    <select id="contract-difficulty-filter" class="filter-select">
                        <option value="all">All Difficulties</option>
                        <option value="easy" ${contractDifficulty === 'easy' ? 'selected' : ''}>Easy</option>
                        <option value="medium" ${contractDifficulty === 'medium' ? 'selected' : ''}>Medium</option>
                        <option value="hard" ${contractDifficulty === 'hard' ? 'selected' : ''}>Hard</option>
                        <option value="expert" ${contractDifficulty === 'expert' ? 'selected' : ''}>Expert</option>
                        <option value="legendary" ${contractDifficulty === 'legendary' ? 'selected' : ''}>Legendary</option>
                    </select>
                    <select id="contract-guild-filter" class="filter-select">
                        <option value="all">All Guilds</option>
                        ${Object.values(allGuilds).map(g => `
                            <option value="${g.id}" ${contractGuild === g.id ? 'selected' : ''}>${g.icon} ${g.shortName || g.name}</option>
                        `).join('')}
                    </select>
                </div>
            </div>
            
            ${playerContracts.length > 0 ? `
                <div class="contracts-section player-contracts">
                    <h4><span class="section-icon">📋</span> Your Active Contracts</h4>
                    <div class="contracts-grid">
                        ${playerContracts.map(c => renderBoardContractCard(c)).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${urgentContracts.length > 0 ? `
                <div class="contracts-section urgent-contracts">
                    <h4><span class="section-icon">⚠️</span> Urgent Contracts</h4>
                    <div class="contracts-grid">
                        ${urgentContracts.map(c => renderBoardContractCard(c)).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="contracts-section available-contracts">
                <h4><span class="section-icon">📜</span> Available Contracts (${availableContracts.length})</h4>
                <div class="contracts-grid">
                    ${availableContracts.map(c => renderBoardContractCard(c)).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderBoardContractCard(contract) {
    return `
        <div class="board-contract-card ${contract.status}" data-contract="${contract.id}" data-guild="${contract.guildId}">
            ${contract.status === 'urgent' ? '<div class="urgent-flash"></div>' : ''}
            
            <div class="board-contract-header">
                <span class="guild-badge">${contract.guildIcon} ${contract.guildName}</span>
                <span class="difficulty-badge difficulty-${contract.difficulty}">${contract.difficulty}</span>
            </div>
            
            <h4 class="board-contract-title">${contract.title}</h4>
            <p class="board-contract-desc">${contract.description.substring(0, 100)}...</p>
            
            <div class="board-contract-meta">
                <span class="meta-item"><span class="meta-icon">📍</span> ${contract.location}</span>
                <span class="meta-item"><span class="meta-icon">⏰</span> ${contract.deadline || 'Open'}</span>
            </div>
            
            <div class="board-contract-rewards">
                ${contract.reward.gold ? `<span class="reward">💰 ${contract.reward.gold}</span>` : ''}
                ${contract.reward.reputation ? `<span class="reward">⭐ +${contract.reward.reputation}</span>` : ''}
            </div>
            
            <button class="view-contract-btn" data-action="view-contract">View Details</button>
        </div>
    `;
}

// ============================================
// POLITICS VIEW
// ============================================

function renderPoliticsView() {
    const allGuilds = { ...GUILD_DATA, ...CHARTER_DATA };
    
    // Build relations matrix
    const guildList = Object.values(allGuilds);
    
    return `
        <div class="politics-view">
            <div class="politics-header">
                <h3>Guild Politics & Relations</h3>
                <p class="politics-subtitle">Understanding the web of alliances and rivalries</p>
            </div>
            
            <div class="politics-grid">
                <div class="relations-web">
                    <h4>Relations Overview</h4>
                    <div class="web-container">
                        ${renderRelationsWeb(guildList)}
                    </div>
                </div>
                
                <div class="power-rankings">
                    <h4>Influence Rankings</h4>
                    <div class="rankings-list">
                        ${guildList
                            .sort((a, b) => (b.resources?.influence || 0) - (a.resources?.influence || 0))
                            .slice(0, 10)
                            .map((guild, index) => `
                                <div class="ranking-item" data-guild="${guild.id}">
                                    <span class="rank-number">#${index + 1}</span>
                                    <span class="rank-icon">${guild.icon}</span>
                                    <span class="rank-name">${guild.shortName || guild.name}</span>
                                    <div class="rank-bar">
                                        <div class="rank-fill" style="width: ${guild.resources?.influence || 0}%"></div>
                                    </div>
                                    <span class="rank-value">${guild.resources?.influence || 0}%</span>
                                </div>
                            `).join('')}
                    </div>
                </div>
                
                <div class="conflict-zones">
                    <h4>Active Conflicts</h4>
                    <div class="conflicts-list">
                        ${renderActiveConflicts(guildList)}
                    </div>
                </div>
                
                <div class="alliance-blocs">
                    <h4>Alliance Blocs</h4>
                    <div class="blocs-grid">
                        ${renderAllianceBlocs(guildList)}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderRelationsWeb(guilds) {
    // Simplified text-based relations display
    // In a real implementation, this could be a D3.js force-directed graph
    
    return `
        <div class="relations-text-web">
            ${guilds.slice(0, 8).map(guild => `
                <div class="web-node" data-guild="${guild.id}">
                    <span class="node-icon">${guild.icon}</span>
                    <span class="node-name">${guild.shortName || guild.name}</span>
                    ${guild.relations ? `
                        <div class="node-relations">
                            ${Object.entries(guild.relations).slice(0, 3).map(([id, rel]) => {
                                const relGuild = guilds.find(g => g.id === id);
                                if (!relGuild) return '';
                                const statusIcon = rel.status === 'allied' ? '🤝' : rel.status === 'hostile' ? '⚔️' : '•';
                                return `<span class="relation-link ${rel.status}">${statusIcon} ${relGuild.icon}</span>`;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function renderActiveConflicts(guilds) {
    const conflicts = [];
    
    guilds.forEach(guild => {
        if (guild.relations) {
            Object.entries(guild.relations).forEach(([targetId, rel]) => {
                if (rel.status === 'hostile' || rel.status === 'rival') {
                    const targetGuild = guilds.find(g => g.id === targetId);
                    if (targetGuild) {
                        // Avoid duplicates
                        const existingConflict = conflicts.find(c => 
                            (c.guild1.id === guild.id && c.guild2.id === targetId) ||
                            (c.guild1.id === targetId && c.guild2.id === guild.id)
                        );
                        if (!existingConflict) {
                            conflicts.push({
                                guild1: guild,
                                guild2: targetGuild,
                                reason: rel.reason,
                                status: rel.status
                            });
                        }
                    }
                }
            });
        }
    });
    
    if (conflicts.length === 0) {
        return '<p class="no-items">No active conflicts recorded.</p>';
    }
    
    return conflicts.map(conflict => `
        <div class="conflict-item">
            <div class="conflict-parties">
                <span class="party">${conflict.guild1.icon} ${conflict.guild1.shortName || conflict.guild1.name}</span>
                <span class="vs">⚔️</span>
                <span class="party">${conflict.guild2.icon} ${conflict.guild2.shortName || conflict.guild2.name}</span>
            </div>
            <p class="conflict-reason">${conflict.reason}</p>
            <span class="conflict-status status-${conflict.status}">${conflict.status}</span>
        </div>
    `).join('');
}

function renderAllianceBlocs(guilds) {
    // Group guilds by their primary alliances
    const blocs = {};
    
    guilds.forEach(guild => {
        if (guild.relations) {
            const allies = Object.entries(guild.relations)
                .filter(([, rel]) => rel.status === 'allied')
                .map(([id]) => id);
            
            if (allies.length > 0) {
                const blocKey = [guild.id, ...allies].sort().join('-');
                if (!blocs[blocKey]) {
                    blocs[blocKey] = {
                        members: [guild],
                        ids: new Set([guild.id, ...allies])
                    };
                } else {
                    if (!blocs[blocKey].ids.has(guild.id)) {
                        blocs[blocKey].members.push(guild);
                        blocs[blocKey].ids.add(guild.id);
                    }
                }
            }
        }
    });
    
    const blocArray = Object.values(blocs).filter(bloc => bloc.members.length >= 2);
    
    if (blocArray.length === 0) {
        return '<p class="no-items">No formal alliance blocs identified.</p>';
    }
    
    return blocArray.slice(0, 4).map((bloc, index) => `
        <div class="bloc-card">
            <h5>Alliance Bloc ${index + 1}</h5>
            <div class="bloc-members">
                ${bloc.members.map(g => `
                    <span class="bloc-member">${g.icon} ${g.shortName || g.name}</span>
                `).join('')}
            </div>
        </div>
    `).join('');
}

// ============================================
// MODAL
// ============================================

function renderModal() {
    return `
        <div id="guild-modal" class="modal" style="display: none;">
            <div class="modal-content guild-modal-content">
                <button class="modal-close guild-modal-close">&times;</button>
                <div id="guild-modal-body">
                    <!-- Dynamic content -->
                </div>
            </div>
        </div>
    `;
}

function showContractModal(contractId, guildId) {
    const guild = GUILD_DATA[guildId] || CHARTER_DATA[guildId];
    if (!guild || !guild.contracts) return;
    
    const contract = guild.contracts.find(c => c.id === contractId);
    if (!contract) return;
    
    const modal = document.getElementById('guild-modal');
    const modalBody = document.getElementById('guild-modal-body');
    
    modalBody.innerHTML = `
        <div class="contract-modal-content">
            <div class="contract-modal-header">
                <span class="contract-guild-badge">${guild.icon} ${guild.name}</span>
                <h2>${contract.title}</h2>
                <span class="contract-difficulty difficulty-${contract.difficulty}">${contract.difficulty.toUpperCase()}</span>
            </div>
            
            <div class="contract-modal-body">
                <div class="contract-section">
                    <h4>Description</h4>
                    <p>${contract.description}</p>
                </div>
                
                <div class="contract-section">
                    <h4>Objectives</h4>
                    <ul class="objectives-list">
                        ${contract.objectives.map(obj => `
                            <li class="${obj.completed ? 'completed' : ''}">
                                <span class="objective-check">${obj.completed ? '✓' : '○'}</span>
                                ${obj.task}
                            </li>
                        `).join('')}
                    </ul>
                </div>
                
                <div class="contract-section">
                    <h4>Details</h4>
                    <div class="contract-details-grid">
                        <div class="detail-item">
                            <span class="detail-label">Location</span>
                            <span class="detail-value">${contract.location}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Deadline</span>
                            <span class="detail-value">${contract.deadline || 'No deadline'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Client</span>
                            <span class="detail-value">${contract.client || guild.name}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Type</span>
                            <span class="detail-value">${contract.type}</span>
                        </div>
                    </div>
                </div>
                
                <div class="contract-section">
                    <h4>Requirements</h4>
                    <ul class="requirements-list">
                        ${contract.requirements.map(req => `<li>${req}</li>`).join('')}
                    </ul>
                </div>
                
                <div class="contract-section rewards-section">
                    <h4>Rewards</h4>
                    <div class="rewards-grid">
                        ${contract.reward.gold ? `
                            <div class="reward-item gold">
                                <span class="reward-icon">💰</span>
                                <span class="reward-value">${contract.reward.gold} gold</span>
                            </div>
                        ` : ''}
                        ${contract.reward.reputation ? `
                            <div class="reward-item reputation">
                                <span class="reward-icon">⭐</span>
                                <span class="reward-value">+${contract.reward.reputation} reputation</span>
                            </div>
                        ` : ''}
                        ${contract.reward.item ? `
                            <div class="reward-item item">
                                <span class="reward-icon">🎁</span>
                                <span class="reward-value">${contract.reward.item}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
            
            <div class="contract-modal-footer">
                ${contract.status === 'available' || contract.status === 'urgent' ? `
                    <button class="btn-accept-contract" data-contract="${contract.id}" data-guild="${guildId}">
                        Accept Contract
                    </button>
                ` : contract.status === 'assigned' ? `
                    <button class="btn-abandon-contract" data-contract="${contract.id}" data-guild="${guildId}">
                        Abandon Contract
                    </button>
                ` : ''}
                <button class="btn-close-modal">Close</button>
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
    playSound?.('ui_open');
}

function closeModal() {
    const modal = document.getElementById('guild-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    playSound?.('ui_close');
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getRepPercentage(reputation) {
    // Normalize reputation to a percentage (0-100)
    const maxRep = 10000;
    const minRep = -6000;
    const normalizedRep = Math.max(minRep, Math.min(maxRep, reputation));
    return ((normalizedRep - minRep) / (maxRep - minRep)) * 100;
}

function getGuildCountByCategory(category) {
    const allGuilds = { ...GUILD_DATA, ...CHARTER_DATA };
    return Object.values(allGuilds).filter(g => g.category === category).length;
}

function getFilteredGuilds() {
    let guilds = [];
    const user = state.loggedInUser;
    
    // Combine guilds and charters based on filter
    if (currentFilter === 'all' || currentFilter === 'guild') {
        guilds = guilds.concat(Object.values(GUILD_DATA));
    }
    if (currentFilter === 'all' || currentFilter === 'charter') {
        guilds = guilds.concat(Object.values(CHARTER_DATA));
    }
    
    // Filter by membership
    if (currentFilter === 'member' && user && user !== 'generic') {
        const playerData = PLAYER_GUILD_DATA[user] || {};
        guilds = guilds.filter(guild => playerData[guild.id]?.rank != null);
    }
    
    // Filter by category
    if (currentCategory) {
        guilds = guilds.filter(guild => guild.category === currentCategory);
    }
    
    // Sort by influence
    guilds.sort((a, b) => (b.resources?.influence || 0) - (a.resources?.influence || 0));
    
    return guilds;
}

function searchGuilds(query) {
    if (!query) return;
    
    const allGuilds = { ...GUILD_DATA, ...CHARTER_DATA };
    const lowerQuery = query.toLowerCase();
    
    return Object.values(allGuilds).filter(guild => 
        guild.name.toLowerCase().includes(lowerQuery) ||
        guild.shortName?.toLowerCase().includes(lowerQuery) ||
        guild.description.toLowerCase().includes(lowerQuery) ||
        guild.motto.toLowerCase().includes(lowerQuery)
    );
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Navigation clicks
    document.addEventListener('click', handleClick);
    
    // Search input
    document.addEventListener('input', handleInput);
    
    // Modal close on outside click
    document.addEventListener('click', (e) => {
        const modal = document.getElementById('guild-modal');
        if (e.target === modal) {
            closeModal();
        }
    });
    
    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

function attachDynamicListeners() {
    // Re-attach listeners for dynamically created elements
    const searchInput = document.getElementById('guild-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            const results = searchGuilds(e.target.value);
            if (results && e.target.value.length > 2) {
                // Could show search results dropdown
                console.log('Search results:', results);
            }
        }, 300));
    }
}

function handleClick(e) {
    if (handleGhostlightClick(e, state.loggedInUser, showNotification)) {
        render();
        playSound?.('ui_click');
        return;
    }
    const target = e.target.closest('[data-view]');
    const guildCard = e.target.closest('[data-guild]');
    const filterBtn = e.target.closest('[data-filter]');
    const categoryPill = e.target.closest('[data-category]');
    const tabBtn = e.target.closest('[data-tab]');
    const contractCard = e.target.closest('[data-contract]');
    const actionBtn = e.target.closest('[data-action]');
    const modalClose = e.target.closest('.guild-modal-close, .btn-close-modal');
    
    // Navigation view change
    if (target) {
        const view = target.dataset.view;
        if (view) {
            currentView = view;
            if (view !== 'guild-detail') {
                selectedGuild = null;
            }
            render();
            playSound?.('ui_click');
        }
    }
    
    // Guild card click
    if (guildCard && !target) {
        const guildId = guildCard.dataset.guild;
        selectedGuild = guildId;
        currentView = 'guild-detail';
        currentTab = 'overview';
        render();
        playSound?.('ui_click');
    }
    
    // Filter button
    if (filterBtn) {
        currentFilter = filterBtn.dataset.filter;
        render();
        playSound?.('ui_click');
    }
    
    // Category pill
    if (categoryPill) {
        currentCategory = categoryPill.dataset.category || null;
        render();
        playSound?.('ui_click');
    }
    
    // Tab button
    if (tabBtn) {
        currentTab = tabBtn.dataset.tab;
        render();
        playSound?.('ui_click');
    }
    
    // Contract card click
    if (contractCard && actionBtn?.dataset.action === 'view-contract') {
        const contractId = contractCard.dataset.contract;
        const guildId = contractCard.dataset.guild || selectedGuild;
        showContractModal(contractId, guildId);
    }
    
    // Modal close
    if (modalClose) {
        closeModal();
    }
    
    // Accept contract
    if (actionBtn?.dataset.action === 'accept-contract') {
        const contractId = actionBtn.dataset.contract;
        const guildId = actionBtn.dataset.guild;
        acceptContract(contractId, guildId);
    }
    
    // Back button
    if (e.target.closest('.back-btn')) {
        currentView = 'directory';
        selectedGuild = null;
        render();
        playSound?.('ui_click');
    }
}

function handleInput(e) {
    if (e.target.id === 'guild-search') {
        // Debounced search is handled in attachDynamicListeners
    }
    
    if (e.target.id === 'contract-difficulty-filter' || e.target.id === 'contract-guild-filter') {
        if (e.target.id === 'contract-difficulty-filter') contractDifficulty = e.target.value;
        else contractGuild = e.target.value;
        render();
    }
}

// ============================================
// CONTRACT ACTIONS
// ============================================

function acceptContract(contractId, guildId) {
    const guild = GUILD_DATA[guildId] || CHARTER_DATA[guildId];
    if (!guild || !guild.contracts) return;
    
    const contract = guild.contracts.find(c => c.id === contractId);
    if (!contract) return;
    
    // Check requirements (simplified)
    const user = state.loggedInUser;
    if (!user || user === 'generic') {
        showNotification('You must be logged in to accept contracts.', 'error');
        return;
    }
    
    // Update contract status
    contract.status = 'assigned';
    contract.assignedTo = user;
    contract.assignedDate = new Date().toISOString();
    
    showNotification(`Contract "${contract.title}" accepted!`, 'success');
    playSound?.('quest_accept');
    closeModal();
    render();
}

function abandonContract(contractId, guildId) {
    const guild = GUILD_DATA[guildId] || CHARTER_DATA[guildId];
    if (!guild || !guild.contracts) return;
    
    const contract = guild.contracts.find(c => c.id === contractId);
    if (!contract) return;
    
    // Reputation penalty
    const user = state.loggedInUser;
    if (user && PLAYER_GUILD_DATA[user] && PLAYER_GUILD_DATA[user][guildId]) {
        PLAYER_GUILD_DATA[user][guildId].reputation -= 50;
    }
    
    contract.status = 'available';
    contract.assignedTo = null;
    contract.assignedDate = null;
    
    showNotification(`Contract abandoned. -50 reputation with ${guild.shortName || guild.name}`, 'warning');
    playSound?.('ui_error');
    closeModal();
    render();
}

// ============================================
// NOTIFICATIONS
// ============================================

function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container') || createNotificationContainer();
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span class="notification-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
        <span class="notification-message">${message}</span>
    `;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

function createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.className = 'notification-container';
    document.body.appendChild(container);
    return container;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ============================================
// INITIALIZE
// ============================================

// Module scripts can finish after DOMContentLoaded has already fired (a
// dependency with top-level await is enough), which left the page blank.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for external use
export {
    init as initGuilds,
    render as renderGuilds,
    showContractModal,
    closeModal
};