import { state, loadState } from '../../core/state.js';
import { WAHWIRE_POSTS } from '../../../data/assembly/assembly-data.js';
import { CURRENT_GAME_DATE, CURRENT_GAME_TIME } from '../../../data/world/calendar.js';

// ============================================
// TABLET STATE
// ============================================

let tabletOpen = false;
let bootComplete = false;

// ============================================
// HELPER FUNCTIONS
// ============================================

function checkForNewPosts() {
    loadState();
    const notificationDot = document.getElementById('wahwire-notification');
    const tabletNotification = document.getElementById('tablet-notification');
    
    if (state.loggedInUser === 'generic' || !state.userState.following || state.userState.following.length === 0) {
        if (notificationDot) notificationDot.style.display = 'none';
        if (tabletNotification) tabletNotification.style.display = 'none';
        return;
    }

    const followedPosts = WAHWIRE_POSTS.filter(p => state.userState.following.includes(p.characterKey));
    const seenIds = new Set(state.userState.seenPostIds);
    const hasNewPosts = followedPosts.some(p => !seenIds.has(p.id));

    if (hasNewPosts) {
        if (notificationDot) notificationDot.style.display = 'inline-block';
        if (tabletNotification) tabletNotification.style.display = 'flex';
    } else {
        if (notificationDot) notificationDot.style.display = 'none';
        if (tabletNotification) tabletNotification.style.display = 'none';
    }
}

async function getPageUpdates() {
    try {
        const response = await fetch(`../../../data/support/site-updates.json?t=${Date.now()}`);
        if (!response.ok) {
            console.warn('⚠️ Could not find site-updates.json');
            return {};
        }
        const updates = await response.json();
        console.log('📊 Loaded site updates manifest:', updates);
        return updates;
    } catch (error) {
        console.error('❌ Error loading updates:', error);
        return {};
    }
}

function markPageAsVisited() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const lastVisits = JSON.parse(localStorage.getItem('pageLastVisits') || '{}');
    const now = new Date().toISOString();
    lastVisits[currentPage] = now;
    localStorage.setItem('pageLastVisits', JSON.stringify(lastVisits));
}

async function markUpdatedPages(container) {
    const links = container.querySelectorAll('a.nav-button');
    const pageUpdates = await getPageUpdates();
    const allDates = Object.values(pageUpdates).map(d => new Date(d).getTime());

    if (allDates.length === 0) return;
    
    const latestUpdateTimestamp = Math.max(...allDates);
    const RECENT_WINDOW = 19 * 60 * 60 * 1000;
    const cutoffTime = latestUpdateTimestamp - RECENT_WINDOW;

    let updatedCount = 0;

    links.forEach(link => {
        const href = link.getAttribute('href');
        const pageUpdateTimeString = pageUpdates[href];

        if (pageUpdateTimeString) {
            const pageTime = new Date(pageUpdateTimeString).getTime();
            if (pageTime > cutoffTime) {
                if (!link.querySelector('.nav-badge.updated')) {
                    const badge = document.createElement('span');
                    badge.className = 'nav-badge updated pulse';
                    badge.textContent = 'NEW';
                    badge.style.marginLeft = 'auto';
                    link.appendChild(badge);
                    updatedCount++;
                }
            }
        }
    });

    console.log(`🏷️ Found ${updatedCount} pages updated recently.`);
}

// ============================================
// TABLET TIME DISPLAY
// ============================================

function updateTabletTime() {
    const timeEl = document.getElementById('tablet-time');
    if (!timeEl) return;
    
    const hours = String(CURRENT_GAME_TIME.hour).padStart(2, '0');
    const mins = String(CURRENT_GAME_TIME.minute).padStart(2, '0');
    
    // Random WAH time format
    const formats = [
        `WAH:${mins}`,
        `${hours}:${mins}`,
        `W${hours}:${mins}`,
        `${hours}:WAH`
    ];
    
    timeEl.textContent = formats[Math.floor(Math.random() * formats.length)];
}

// ============================================
// TABLET TOGGLE FUNCTIONALITY
// ============================================
function openTablet() {
    const overlay = document.getElementById('wah-tablet-overlay');
    const toggleBtn = document.getElementById('tablet-toggle-btn');
    const bootScreen = document.getElementById('boot-screen');
    
    if (!overlay || !toggleBtn) return;
    
    tabletOpen = true;
    toggleBtn.classList.add('hidden');
    document.body.classList.add('tablet-open');
    
    // Check if debug mode is on - skip boot screen if so
    const debugMode = localStorage.getItem('debugMode') === 'true';
    
    // Show boot screen on first open (unless debug mode)
    if (!bootComplete && bootScreen && !debugMode) {
        bootScreen.classList.add('active');
        setTimeout(() => {
            bootScreen.classList.remove('active');
            bootComplete = true;
        }, 1800);
    } else {
        bootComplete = true;
        if (bootScreen) {
            bootScreen.classList.remove('active');
        }
    }

    overlay.classList.add('open');
    localStorage.setItem('tabletOpen', 'true');

    // Play open sound effect (optional)
    playTabletSound('open');
}

function closeTablet() {
    const overlay = document.getElementById('wah-tablet-overlay');
    const toggleBtn = document.getElementById('tablet-toggle-btn');
    
    if (!overlay || !toggleBtn) return;
    
    tabletOpen = false;
    overlay.classList.remove('open');
    document.body.classList.remove('tablet-open');
    
    setTimeout(() => {
        toggleBtn.classList.remove('hidden');
    }, 300);
    
    localStorage.setItem('tabletOpen', 'false');
    
    // Play close sound effect (optional)
    playTabletSound('close');
}

function toggleTablet() {
    if (tabletOpen) {
        closeTablet();
    } else {
        openTablet();
    }
}

// Optional sound effects
function playTabletSound(type) {
    // You can add actual audio files here
    // const audio = new Audio(`sounds/tablet-${type}.mp3`);
    // audio.volume = 0.3;
    // audio.play().catch(() => {});
}

// ============================================
// TABLET CONTROLS
// ============================================

function initTabletControls() {
    // Toggle button (bottom right)
    const toggleBtn = document.getElementById('tablet-toggle-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', openTablet);
    }
    
    // Close button (X in top right of tablet)
    const closeBtn = document.getElementById('tablet-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeTablet);
    }
    
    // Home button (close tablet)
    const homeBtn = document.getElementById('tablet-home-button');
    if (homeBtn) {
        homeBtn.addEventListener('click', closeTablet);
    }
    
    // Click outside tablet to close (on the overlay background)
    const overlay = document.getElementById('wah-tablet-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            // Only close if clicking directly on overlay, not on tablet
            if (e.target === overlay) {
                closeTablet();
            }
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Don't trigger if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        // Press 'T' or 'N' to toggle tablet
        if ((e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'n') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            toggleTablet();
        }
        
        // Escape to close
        if (e.key === 'Escape' && tabletOpen) {
            closeTablet();
        }
    });
}

// ============================================
// SPRINGBOARD
// ============================================
// The home screen is a grid of app icons; the old grouped list is kept
// behind "All apps" because 40+ destinations do not belong on a home
// screen. The choice is remembered, so a player who prefers the full list
// is not made to re-open it on every page.

// Every destination, as a path relative to the Reputation-Matrix2 root.
// The pages are scattered (some at the root, some under app/pages/<name>/,
// some under app/pages/standalone/), and the tablet is injected into host
// pages sitting at several different depths -- so a bare "quests.html" only
// resolves correctly from some of them. We anchor on navigation.js's own
// URL, which is always .../app/pages/navigation/, and resolve from there.
const APP_TARGETS = {
    waluipedia: '../../../index.html',
    calendar:   '../../../index.html#/calendar',
    mission:    'app/pages/standalone/liberated-toads-event.html',
    quests:     'quests.html',
    guilds:     'app/pages/guilds/guilds.html',
    shop:       'app/pages/shop/shop.html',
    currency:   'currency.html',
    maps:       'app/pages/maps/maps.html',
    globalwar:  'app/pages/standalone/global-war.html',
    assembly:   'app/pages/assembly/assembly.html',
    intel:      'app/pages/intel/intel.html',
    directory:  'app/pages/directory/directory.html',
    dynasty:    'app/pages/family-tree/family-tree.html',
    religion:   'app/pages/religion/religion.html',
    artifacts:  'app/pages/artifacts/artifacts.html',
    library:    'app/pages/library/library.html',
    alliances:  'app/pages/alliances/alliances.html',
    crafting:   'app/pages/crafting/crafting.html'
};

function resolveAppTargets(root) {
    const script = document.querySelector('script[src*="navigation.js"]');
    if (!script) return;
    // .../Reputation-Matrix2/app/pages/navigation/navigation.js -> repo-relative base
    const rmRoot = new URL('../../../', script.src);

    root.querySelectorAll('[data-app]').forEach(a => {
        const rel = APP_TARGETS[a.getAttribute('data-app')];
        if (!rel) return;
        // index.html lives one level ABOVE Reputation-Matrix2
        a.href = new URL(rel.startsWith('../') ? rel.replace('../../../', '../') : rel, rmRoot).href;
    });
}

function initSpringboard() {
    const btn = document.getElementById('sb-more');
    const nav = document.getElementById('main-nav-bar');
    const board = document.getElementById('springboard');
    if (!btn || !nav) return;

    const apply = (open) => {
        nav.classList.toggle('is-collapsed', !open);
        btn.classList.toggle('open', open);
        btn.querySelector('span').textContent = open ? 'Hide list' : 'All apps';
        if (board) board.style.display = '';
    };

    apply(localStorage.getItem('tabletAllApps') === 'true');

    btn.addEventListener('click', () => {
        const open = nav.classList.contains('is-collapsed');
        apply(open);
        localStorage.setItem('tabletAllApps', String(open));
        if (open) nav.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// ============================================
// SEARCH FUNCTIONALITY
// ============================================

function initSearch() {
    const searchBtn = document.getElementById('quick-search');
    const searchOverlay = document.getElementById('tablet-search-overlay');
    const searchClose = document.getElementById('search-close');
    const searchInput = document.getElementById('tablet-search-input');
    const searchResults = document.getElementById('tablet-search-results');
    
    if (!searchBtn || !searchOverlay) return;
    
    // Get all nav links for searching
    const navLinks = document.querySelectorAll('.tablet-nav .nav-button');
    const searchableItems = Array.from(navLinks).map(link => ({
        text: link.querySelector('span')?.textContent || '',
        href: link.getAttribute('href'),
        icon: link.querySelector('img')?.src || ''
    }));
    
    searchBtn.addEventListener('click', () => {
        searchOverlay.classList.add('active');
        setTimeout(() => searchInput.focus(), 100);
    });
    
    searchClose.addEventListener('click', () => {
        searchOverlay.classList.remove('active');
        searchInput.value = '';
        searchResults.innerHTML = '';
    });
    
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        if (!query) {
            searchResults.innerHTML = '';
            return;
        }
        
        const matches = searchableItems.filter(item => 
            item.text.toLowerCase().includes(query)
        );
        
        if (matches.length === 0) {
            searchResults.innerHTML = `
                <div class="search-empty">
                    <p>No results for "${query}"</p>
                </div>
            `;
            return;
        }
        
        searchResults.innerHTML = matches.map(item => `
            <a href="${item.href}" class="search-result-item">
                <img src="${item.icon}" alt="" style="width: 24px; height: 24px;">
                <span>${item.text}</span>
            </a>
        `).join('');
    });
    
    // Close on escape
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchOverlay.classList.remove('active');
        }
    });
}

// ============================================
// COLLAPSIBLE NAV GROUPS
// ============================================

function initCollapsibleGroups() {
    const groupTitles = document.querySelectorAll('.tablet-nav .nav-group-title');
    
    // Load saved state
    const collapsedGroups = JSON.parse(localStorage.getItem('collapsedNavGroups') || '[]');
    
    groupTitles.forEach((title, index) => {
        const group = title.parentElement;
        
        // Restore collapsed state
        if (collapsedGroups.includes(index)) {
            group.classList.add('collapsed');
        }
        
        title.addEventListener('click', () => {
            group.classList.toggle('collapsed');
            
            // Save state
            const collapsed = [];
            document.querySelectorAll('.tablet-nav .nav-group').forEach((g, i) => {
                if (g.classList.contains('collapsed')) {
                    collapsed.push(i);
                }
            });
            localStorage.setItem('collapsedNavGroups', JSON.stringify(collapsed));
        });
    });
}

// ============================================
// QUICK ACTION BUTTONS
// ============================================

/* Resolve a path relative to navigation.js itself. The tablet is injected into
 * pages living at different depths, so anything resolved against the *document*
 * breaks on all but one of them. */
function pageUrl(relative) {
    const tag = document.querySelector('script[src*="navigation.js"]');
    return tag ? new URL(relative, tag.src).href : relative;
}

function initQuickActions() {
    const homeBtn = document.getElementById('quick-home');
    const missionsBtn = document.getElementById('quick-missions');

    if (homeBtn) {
        homeBtn.addEventListener('click', () => {
            window.location.href = 'index.html';
        });
    }
    
    if (missionsBtn) {
        missionsBtn.addEventListener('click', () => {
            window.location.href = 'quests.html';
        });
    }
    
}

// ============================================
// INITIALIZE TABLET
// ============================================

async function initializeTablet() {
    console.log('🎮 Initializing WAH-Tablet...');
    
    // Create container and append directly to body
    let tabletContainer = document.getElementById('wah-tablet-root');
    if (!tabletContainer) {
        tabletContainer = document.createElement('div');
        tabletContainer.id = 'wah-tablet-root';
        document.body.appendChild(tabletContainer);
    }

    try {
        // Fetch tablet HTML
        const navScriptElement = document.querySelector('script[src*="navigation.js"]');
        if (!navScriptElement) throw new Error("Could not find navigation.js script tag");
        
        const scriptSrc = navScriptElement.src;
        const navHtmlUrl = new URL('navigation.html', scriptSrc);

        const response = await fetch(navHtmlUrl.href);
        if (!response.ok) throw new Error(`Failed to fetch navigation`);
        
        tabletContainer.innerHTML = await response.text();

        // Update subtitle
        const subtitle = document.title.split('|')[1]?.trim() || 'Directory';
        const sidebarSubtitle = document.getElementById('sidebar-subtitle');
        if (sidebarSubtitle) sidebarSubtitle.textContent = subtitle;

        // Hide current page link
        const currentPage = window.location.pathname.split('/').pop();
        const mapPages = ['maps.html', 'mushroom-kingdom-maps.html', 'midlands-maps.html', 'internet-maps.html', 'middle-earth-maps.html', 'warhammer-maps.html', 'kivotos-maps.html', 'doughnut-hole-maps.html'];
        const navLinks = tabletContainer.querySelectorAll('.nav-button');

        navLinks.forEach(link => {
            const linkHref = link.getAttribute('href');
            if (linkHref === currentPage) link.style.display = 'none';
            if (mapPages.includes(currentPage) && linkHref === 'maps.html') link.style.display = 'none';
        });

        // Initialize features
        markPageAsVisited();
        checkForNewPosts();
        await markUpdatedPages(tabletContainer);
        
        // Resolve links before search indexes the nav, so it stores the real destination.
        resolveAppTargets(tabletContainer);

        // Initialize tablet-specific features
        initTabletControls();
        initSearch();
        initCollapsibleGroups();
        initQuickActions();
        const guildNavLink = tabletContainer.querySelector('#main-nav-bar .nav-button[data-app="guilds"]');
        if (guildNavLink && new URL(guildNavLink.href).pathname === window.location.pathname) {
            guildNavLink.style.display = 'none';
        }
        initSpringboard();
        
        // Start time updates
        updateTabletTime();
        setInterval(updateTabletTime, 60000);
        
        console.log('✅ WAH-Tablet initialized successfully!');

    } catch (error) {
        console.error('❌ Failed to load tablet navigation:', error);
    }
}

// Alias for backward compatibility
const initializeSidebar = initializeTablet;

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTablet);
} else {
    initializeTablet();
}

// Export for external use if needed
export { initializeTablet, initializeSidebar, openTablet, closeTablet, toggleTablet };