
// This file contains all the core narrative, character, and faction data for the application.
// It imports data from smaller, more manageable files.

import { CHARACTERS } from '../../data/characters/characters-1.js';
import { MIDLANDS_FACTIONS } from '../../factions/midlands.js';
import { MUSHROOM_KINGDOM_FACTIONS } from '../../factions/mushroom-kingdom.js';
import { WIDESPREAD_FACTIONS } from '../../data/world/realms/widespread.js';
import { WILDERLANDS_FACTIONS } from '../../factions/wilderlands.js';
import { MIDDLE_EARTH_FACTIONS } from '../../factions/middle-earth.js';
import { INTERNET_FACTIONS } from '../../factions/internet.js';
import { WARHAMMER_FACTIONS } from '../../factions/warhammer.js';
import { KIVOTOS_FACTIONS } from '../../factions/kivotos.js';
import { SPACE_FACTIONS } from '../../factions/space.js';
import { POKEMON_FACTIONS } from '../../factions/pokemon.js';
import { EQUESTRIA_FACTIONS } from '../../factions/equestria.js'; // NEW IMPORT

import { RUMORS } from './party-and-events.js';
import { PARLIAMENT_MEMBERS } from '../systems/parliament-members.js';
import { REBEL_CLANS_DETAILS } from '../../data/factions/rebel-clans-details.js';
import { FAWFUL_DETAILS } from '../../data/factions/fawful-details.js';
import { COSMIC_JESTERS_DETAILS } from '../../data/factions/cosmic-jesters-details.js';
import {AUXILIARY_PARTY} from './party-and-events.js'
export { CHARACTER_RELATIONS } from '../../data/characters/character-relations.js';

const combinedCharacters = {
    ...CHARACTERS,
    ...PARLIAMENT_MEMBERS
};


const combinedFactions = {
    ...MIDLANDS_FACTIONS,
    ...MUSHROOM_KINGDOM_FACTIONS,
    ...WIDESPREAD_FACTIONS,
    ...WILDERLANDS_FACTIONS,
    ...MIDDLE_EARTH_FACTIONS,
    ...INTERNET_FACTIONS,
    ...WARHAMMER_FACTIONS,
    ...KIVOTOS_FACTIONS,
    ...SPACE_FACTIONS,
    ...POKEMON_FACTIONS,
    ...EQUESTRIA_FACTIONS, // Added here
};

// Modify Mushroom Kingdom factions before final export
const modifiedMushroomKingdomFactions = { ...MUSHROOM_KINGDOM_FACTIONS };
if (modifiedMushroomKingdomFactions.liberated_toads) {
    modifiedMushroomKingdomFactions.liberated_toads = {
        ...modifiedMushroomKingdomFactions.liberated_toads,
        description: "A group of former slaves forged in tragedy. After discovering and freeing 150 more trafficked toads, a catastrophic magical accident killed 13 of the newcomers and gravely injured their leader, Dan. Now bound by a fragile vow and reeling from the discovery of an Iron Legion spy in their midst, they are split by distrust and grief, trying to find a path forward in a world that sees them as pawns.",
        internal_politics: {
            ruling_faction: "dan",
            sub_factions: {
                dan: {
                    name: "Dan, The Cautious Leader",
                    influence: 35,
                    status: "Leading with Caution",
                    description: "Once shattered by tragedy, Dan has found his voice again. His successful counter-proposal for safer, more organized expeditions has re-established his leadership, this time tempered by a deep-seated caution and a fierce desire to prevent any further loss of life.",
                    opinions: {
                        toad_lee: "He stands with me. His strength gives my words weight. Together, we can protect them.",
                        speaker_l: "He agreed to my plan. There is a path to unity, if we can walk it carefully."
                    }
                },
                toad_lee: {
                    name: "Toad Lee, The Warden",
                    influence: 30,
                    status: "Enforcing The New Doctrine",
                    description: "The first toad to join the party. Now the reluctant warden of X.O.'s staff, he has fully endorsed Dan's new, cautious strategy and is focused on organizing the larger, well-armed expeditions.",
                     opinions: {
                        dan: "He has found his strength again. My axe is his to command.",
                        speaker_l: "His conditions are acceptable, so long as they do not compromise the safety of our people."
                    }
                },
                speaker_l: {
                    name: "Speaker L & The First Cohort",
                    influence: 25,
                    status: "Watchful & Pragmatic",
                    description: "The de facto leader of the 137 survivors. While still demanding justice for their fallen comrades, L has pragmatically aligned with Dan's cautious strategy, seeing it as the best way to preserve their numbers while gathering intelligence on their enemies.",
                    opinions: {
                        dan: "His plan is sound. It protects our people. We will support it, but we have not forgotten his past failures.",
                        toad_lee: "He is a hammer. Useful for breaking things, including dissent. We will watch him."
                    }
                },
                roger: {
                    name: "Roger, The Pragmatist",
                    influence: 15,
                    status: "Managing Logistics",
                    description: "A practical toad who sees Dan's new doctrine as the most logistically sound strategy for minimizing attrition and maximizing resource gain. He is fully focused on equipping the new expeditions.",
                    opinions: {
                        dan: "His plan is efficient. It reduces risk and preserves our most valuable asset: personnel. I support it.",
                        toad_lee: "A necessary tool for maintaining order during a difficult transition."
                    }
                },
                ryan: {
                    name: "Ryan, The Arcane Student",
                    influence: 10,
                    status: "Studious & Worried",
                    description: "A quiet, studious toad with a natural but untrained affinity for magic. He backed Dan's proposal, fearing the loss of more lives, and is focused on understanding the nature of the threats they face.",
                    opinions: {
                        dan: "He chose the path that preserves life. It was the right choice.",
                        toad_lee: "His strength is a comfort, but the staff he holds is a source of great concern."
                    }
                },
                the_mole: {
                    name: "The Mole, Legion Infiltrator",
                    influence: 0,
                    status: "Exposed & At Large",
                    description: "An Iron Legion plant who infiltrated the toads. His identity was revealed after Shadeward Mansion. The cohort has voted to capture him and a second mole, Gerick, for interrogation.",
                    opinions: {
                        dan: "A predictable emotional wreck. His weakness made my job easy.",
                        toad_lee: "All bark and no bite. His 'order' is just fear."
                    }
                }
            }
        }
    };
}
combinedFactions.liberated_toads = modifiedMushroomKingdomFactions.liberated_toads;



// ============================================
// STORY ARCS
// ============================================
export const STORY_ARCS = {
raventree_manor: {
        id: 'raventree_manor',
        name: 'The Raventree Manor Crisis',
        description: 'The central conflict binding the fractured realities. The Oracle (a necromancer) seeks to merge the timelines to awaken his "Vessel." The party is now scattered across the shards, with teams trapped in the high-stakes political games of the Shadowfell, the chaotic revelry of the Feywild, and the void-touched laboratory of the Deep Mirror.',
        icon: '🏚️',
        status: 'active',
        startDate: { day: 16, monthIndex: 6, year: 1040 },
        endDate: null,
        phases: [
            { id: 'discovery', name: 'Discovery', description: 'The party arrives and encounters the first supernatural threats.' },
            { id: 'escalation', name: 'Escalation', description: 'The Manor responds with escalating force, from wraiths to rust monsters.' },
            { id: 'containment', name: 'Containment', description: 'The party breaks the three anchors, preparing for the final ritual.' },
            { id: 'fracture', name: 'Fracture', description: 'The ritual fails, shattering reality and scattering the party across the planes.' },
            { id: 'reconvergence', name: 'Reconvergence', description: 'The party attempts to reunite the fractured timelines.' }
        ],
        currentPhase: 3, // Still in the 'Fracture' phase
        themes: ['supernatural', 'survival', 'mystery', 'horror', 'planar-travel', 'cosmic-horror'],
        keyFactions: ['mages_guild', 'cosmic_jesters', 'iron_legion', 'onyx_hand', 'liberated_toads'],
        consequences: {
            positive: ['Unprecedented knowledge of planar physics', 'Powerful artifacts from other dimensions', 'Potential for new, strange allies'],
            negative: ['Permanent separation of the party', 'Unleashing of the "Vessel"', 'Loss of key witnesses and allies (Eager captured)']
        }
    },
shadowfell_estate: {
        id: 'shadowfell_estate',
        name: 'The Shadowfell Dinner Party',
        description: 'Archie and Bowser navigated a high-stakes dinner with the Vampire Lords of the Onyx Hand. After Archie lost his magic, he adopted the "Dracacide" disguise to bluff his way through the social intrigue, ultimately aiding Green T in a desperate escape that involved shattering the Shadowfell anchor crystal.',
        icon: '🍷',
        status: 'resolved',
        startDate: { day: 21, monthIndex: 6, year: 1040 },
        endDate: { day: 26, monthIndex: 6, year: 1040 },
        phases: [
            { id: 'arrival', name: 'Arrival', description: 'Entering the Shadow Plane and losing magic.' },
            { id: 'dinner', name: 'The Feast', description: 'Surviving the courses and social combat.' },
            { id: 'betrayal', name: 'The Turn', description: 'Green T revealed his escape plan and firearm.' },
            { id: 'escape', name: 'The Exit', description: 'Shattering the anchor and fleeing the manor.' }
        ],
        currentPhase: 3,
        themes: ['social-combat', 'horror', 'diplomacy', 'escape'],
        keyFactions: ['onyx_hand', 'silver_flame', 'mages_guild'],
        consequences: {
            positive: ['Rescued Green T', 'Destroyed the Shadowfell anchor crystal', 'Gained intel on the Convergence Protocol'],
            negative: ['Enraged the Vampire Lords of the Onyx Hand', 'Left Bowser behind during the escape']
        }
    },
feywild_attic: {
        id: 'feywild_attic',
        name: 'The Feywild Fracture',
        description: 'Hjumpik, Waluigi, and Toad Lee are trapped in the chaotic Feywild reflection of Raventree. After escaping a hag, they have become unwilling agents of the manor\'s ruler, Lady Aurelian, tasked with evicting her unwanted Satyr guests while secretly investigating the manor\'s connection to the "Orange Heir" and a greater conspiracy.',
        icon: '🦋',
        status: 'active',
        startDate: { day: 21, monthIndex: 6, year: 1040 },
        endDate: null,
        phases: [
            { id: 'entry', name: 'The Hag & The Greenhouse', description: 'Escaping the Hag and finding sanctuary.' },
            { id: 'infiltration', name: 'The Feywild Party', description: 'Navigating the grotesque banquet and meeting the manor\'s staff.' },
            { id: 'service', name: 'Service to the Lady', description: 'Evicting Satyrs and clearing trapped rooms.' },
            { id: 'investigation', name: 'The Theater Reveal', description: 'Searching for Rakasha and the true "Guest of Honor".' }
        ],
        currentPhase: 2,
        themes: ['chaos', 'wild-magic', 'survival', 'social-stealth'],
        keyFactions: ['cosmic_jesters', 'ratchet_raiders', 'iron_legion', 'mages_guild'],
        consequences: {
            positive: ['Powerful fey artifacts (Morning Glory)', 'Gained insight into the Corvinarus lineage', 'Tentative trust from Lady Aurelian'],
            negative: ['Time dilation issues', 'Conflicting missions from the Legion and Perrius', 'Rakasha is missing in action']
        }
    },
    capital_intrigue: {
        id: 'capital_intrigue',
        name: 'Capital Intrigue',
        description: 'A web of political schemes, prison breaks, and shadow deals in the heart of the Regal Empire.',
        icon: '🏛️',
        status: 'resolved',
        startDate: { day: 14, monthIndex: 6, year: 1040 },
        endDate: { day: 14, monthIndex: 6, year: 1040 },
        phases: [
            { id: 'arrival', name: 'Arrival', description: 'The Vigilance arrives at the capital' },
            { id: 'dealings', name: 'Shadow Dealings', description: 'Secret meetings and marketplace chaos' },
            { id: 'rescue', name: 'Rescue Attempt', description: 'The failed prison break' },
            { id: 'escape', name: 'Escape', description: 'Fleeing the capital' }
        ],
        currentPhase: 3,
        themes: ['political', 'espionage', 'survival'],
        keyFactions: ['regal_empire', 'iron_legion', 'freelancer_underworld'],
        consequences: {
            positive: ['New underworld contacts', 'Intel on Legion operations'],
            negative: ['Increased Imperial scrutiny', 'Failed to rescue Eager cleanly']
        }
    },
    vigilance_saga: {
        id: 'vigilance_saga',
        name: 'The Vigilance Saga',
        description: 'The acquisition of a legendary airship and the chaos that followed.',
        icon: '🚀',
        status: 'resolved',
        startDate: { day: 20, monthIndex: 4, year: 1040 },
        endDate: { day: 28, monthIndex: 5, year: 1040 },
        phases: [
            { id: 'pursuit', name: 'Pursuit', description: 'Tracking down X.O.' },
            { id: 'battle', name: 'Battle', description: 'The fight for the Vigilance' },
            { id: 'crisis', name: 'Core Crisis', description: "hjumpik's reckless action" },
            { id: 'aftermath', name: 'Aftermath', description: 'Dealing with the fallout' }
        ],
        currentPhase: 3,
        themes: ['action', 'liberation', 'recklessness'],
        keyFactions: ['liberated_toads', 'regal_empire', 'ratchet_raiders'],
        consequences: {
            positive: ['Gained the Vigilance', 'Freed toad slaves', 'Defeated X.O.'],
            negative: ['Massive reputation damage', 'Ship nearly destroyed']
        }
    },
    toadalnaec_saga: {
        id: 'toadalnaec_saga',
        name: 'The TOADALNAEC Saga',
        description: 'A follow-on to the resolved Vigilance Saga: the Toads claim the old airship under its new name, and the first shipboard crisis ends with Remi still searching for an exit.',
        icon: '🍄',
        status: 'active',
        startDate: { day: 1, monthIndex: 8, year: 1040 },
        endDate: null,
        phases: [
            { id: 'renaming', name: 'The Ship Changes Hands', description: 'The Toads claim the old Vigilance as the TOADALNAEC; authority aboard and Speaker L’s status are disputed.' },
            { id: 'intake', name: 'The Intake Drone', description: 'Remi is confined aboard ship while the Toads question Eager and Salam.' },
            { id: 'blackout', name: 'The Blackout', description: 'Remi removes X.O.’s staff from the field and the ship loses power; the vessel’s movement is not recorded.' },
            { id: 'unfinished_escape', name: 'The Unfinished Escape', description: 'Remi remains in conflict, blinded and invisible, feeling along a wall; her escape and the ship’s condition remain unresolved.' }
        ],
        currentPhase: 3,
        themes: ['shipboard', 'survival', 'leadership', 'unfinished-escape'],
        keyFactions: ['liberated_toads'],
        consequences: {
            positive: ['The Toads hold the ship under the name TOADALNAEC'],
            negative: ['The ship loses power; Remi’s escape and Perot’s condition remain unresolved']
        }
    },
    supernatural_sovereignty: {
        id: 'supernatural_sovereignty',
        name: 'The Supernatural Sovereignty Crisis',
        description: 'A political earthquake as the Empire moves to outlaw supernatural factions.',
        icon: '⚖️',
        status: 'active',
        startDate: { day: 18, monthIndex: 6, year: 1040 },
        endDate: null,
        phases: [
            { id: 'proposal', name: 'The Proposal', description: 'Dan introduces the act' },
            { id: 'vote', name: 'The Vote', description: 'The Diet passes the act 81-30' },
            { id: 'enforcement', name: 'Enforcement', description: 'Military protocols activated' },
            { id: 'consequences', name: 'Consequences', description: 'The supernatural factions respond' }
        ],
        currentPhase: 2,
        themes: ['political', 'supernatural', 'war'],
        keyFactions: ['regal_empire', 'onyx_hand', 'moonfang_pack', 'silver_flame'],
        consequences: {
            positive: ['Imperial favor', 'Silver Flame support'],
            negative: ['Supernatural enemies', 'War on two fronts']
        }
    },
    mushroom_civil_war: {
        id: 'mushroom_civil_war',
        name: 'The Mushroom Kingdom Civil War',
        description: "A 45-year conflict following Princess Peach's death, now reaching a bloody crescendo.",
        icon: '🍄',
        status: 'active',
        startDate: { day: 1, monthIndex: 0, year: 995 },
        endDate: null,
        phases: [
            { id: 'assassination', name: 'The Assassination', description: 'Princess Peach is killed' },
            { id: 'fragmentation', name: 'Fragmentation', description: 'The kingdom splinters' },
            { id: 'stalemate', name: 'Stalemate', description: 'Decades of grinding warfare' },
            { id: 'escalation', name: 'Escalation', description: 'New players enter the conflict' },
            { id: 'endgame', name: 'Endgame', description: 'The final confrontation approaches' }
        ],
        currentPhase: 3,
        themes: ['war', 'political', 'tragedy'],
        keyFactions: ['mushroom_regency', 'peach_loyalists', 'koopa_troop', 'fawfuls_furious_freaks'],
        consequences: {
            positive: ['Koopa-Loyalist truce'],
            negative: ['Bramblehaven massacre', 'Civilian casualties']
        }
    },

    kong_kremling_cold_war: {
        id: 'kong_kremling_cold_war',
        name: 'The Kong-Kremling Cold War',
        description: 'A false peace hides assassination plots and espionage between two bitter rivals.',
        icon: '🦍',
        status: 'active',
        startDate: { day: 18, monthIndex: 6, year: 1040 },
        endDate: null,
        phases: [
            { id: 'discovery', name: 'Bug Discovery', description: 'Funky finds the listening device' },
            { id: 'confrontation', name: 'Confrontation', description: 'DK calls K. Rool' },
            { id: 'assassination', name: 'Assassination Plot', description: 'Galypso targets Funky' },
            { id: 'war', name: 'Open War?', description: 'Will the cold war turn hot?' }
        ],
        currentPhase: 2,
        themes: ['espionage', 'political', 'betrayal'],
        keyFactions: ['dk_crew', 'kremling_krew'],
        consequences: {
            positive: ['Intel on Kremling operations'],
            negative: ['Peace shattered', 'Assassination imminent']
        }
    },
    shadow_war: {
        id: 'shadow_war',
        name: 'The Shadow War',
        description: 'An escalating supernatural conflict between vampires and werewolves.',
        icon: '🌙',
        status: 'active',
        startDate: { day: 1, monthIndex: 6, year: 1040 },
        endDate: null,
        phases: [
            { id: 'tensions', name: 'Rising Tensions', description: 'Old grudges resurface' },
            { id: 'skirmishes', name: 'Skirmishes', description: 'First blood is drawn' },
            { id: 'escalation', name: 'Escalation', description: 'Open warfare begins' },
            { id: 'intervention', name: 'Intervention', description: 'Outside forces get involved' }
        ],
        currentPhase: 1,
        themes: ['supernatural', 'war', 'horror'],
        keyFactions: ['onyx_hand', 'moonfang_pack', 'silver_flame'],
        consequences: {
            positive: ['Potential supernatural allies'],
            negative: ['Collateral damage', 'Hunter attention']
        }
    },
    toad_liberation: {
        id: 'toad_liberation',
        name: 'The Toad Liberation Movement',
        description: 'The ongoing struggle to free toads from slavery and establish their freedom.',
        icon: '⛓️',
        status: 'active',
        startDate: { day: 22, monthIndex: 5, year: 1040 },
        endDate: null,
        phases: [
            { id: 'awakening', name: 'Awakening', description: 'Dan and others are freed' },
            { id: 'organization', name: 'Organization', description: 'The Liberated Toads form' },
            { id: 'infiltration', name: 'Infiltration', description: 'Spies are discovered' },
            { id: 'reckoning', name: 'Reckoning', description: "The movement's future is decided" }
        ],
        currentPhase: 2,
        themes: ['liberation', 'betrayal', 'identity'],
        keyFactions: ['liberated_toads', 'the_unchained', 'iron_legion'],
        consequences: {
            positive: ['Freed toads', 'Growing movement'],
            negative: ['Infiltration by spies', 'Identity crisis (Two Dans)']
        }
    }
};

// ============================================
// ARC HELPER FUNCTIONS
// ============================================
export function getRumorsByArc(arcId) {
    return LORE_DATA.rumors.filter(rumor => rumor.arc === arcId);
}

export function getArcProgress(arcId) {
    const arc = STORY_ARCS[arcId];
    if (!arc) return 0;
    return (arc.currentPhase + 1) / arc.phases.length;
}

export function getArcStats(arcId) {
    const rumors = getRumorsByArc(arcId);
    const arc = STORY_ARCS[arcId];

    if (!arc) return null;

    const factionImpacts = {};
    rumors.forEach(rumor => {
        Object.entries(rumor.effects || {}).forEach(([faction, value]) => {
            factionImpacts[faction] = (factionImpacts[faction] || 0) + value;
        });
    });

    const totalCycleImpact = rumors.reduce((sum, r) => sum + (r.cycle_impact?.score || 0), 0);

    return {
        rumorCount: rumors.length,
        factionImpacts,
        totalCycleImpact,
        progress: getArcProgress(arcId),
        currentPhaseName: arc.phases[arc.currentPhase]?.name || 'Unknown'
    };
}

export function getUnassignedRumors() {
    return RUMORS.filter(rumor => !rumor.arc);
}
// ============================================
// RUMORS (with Arc References)
// ============================================
export const LORE_DATA = {
    characters: combinedCharacters,
    auxiliary_party: { ...AUXILIARY_PARTY, group: { name: "Group Focuses" } },
    factions: combinedFactions,
    rumors: RUMORS,
    story_arcs: STORY_ARCS,  // ADD THIS LINE
    faction_details: {
        rebel_clans: REBEL_CLANS_DETAILS,
        fawfuls_furious_freaks: FAWFUL_DETAILS,
        cosmic_jesters: COSMIC_JESTERS_DETAILS
    }
};
