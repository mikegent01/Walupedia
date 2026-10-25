// legacy-toads-data.js
// Canon extracts preserved verbatim from the previous liberated-toads-system.js:
// the Accountability Docket (Emergency Resolution 17-A) and the faction timeline
// (days 5-21). Sources cited in docs/notes/TOAD_CASE_REBUILD_PLAN.md. These are
// records, not generated content -- do not edit tallies here.

const ACCOUNTABILITY_DOCKET = {
    authority: "Emergency Resolution 17-A",
    established: "Day 18",
    enforcer: "Pond Patrol under Captain Fernback",
    protocol: "Apprehend, but do not slay. Lethal force denied unless by threat defied.",
    purpose: "To account for actions that endangered the Cohort, not as punishment but as restoration",
    
    quote: {
        text: "This is not retribution's art, but the mending of the fractured heart. By pond and law, by vow and steel, the wound must close for peace to heal.",
        speaker: "Speaker L, Day 18"
    },
    
    pillars: [
        { name: "CONTAIN", icon: "🛡️", description: "Halt the spread of disorder" },
        { name: "ACCOUNT", icon: "📜", description: "Every action has a cost that must be acknowledged" },
        { name: "RESTORE", icon: "🔨", description: "Rebuild what was broken, heal what was wounded" },
        { name: "ADHERE", icon: "⚔️", description: "To the Will of the Cohort, as spoken by the Council" }
    ],
    
    targets: [
        { 
            name: "Archie Miser", 
            id: "archie",
            status: "at_large",
            priority: "high",
            portrait: "🧙",
            crimes: [
                "Reckless Mind - Loss of magical control",
                "Greenhouse Inferno - Destruction of property, injury to allies",
                "Casualties resulting from uncontrolled spellcasting"
            ],
            evidence: [
                "Multiple witness accounts",
                "Physical damage to Raventree Manor",
                "Archie's own public confession on WAHwire"
            ],
            notes: "Escaped custody with help from an Iron Legion spy named 'Jerry'. Last seen traversing alien dimensions via his Third Eye. Considered magically unstable and dangerous, but not malicious.",
            last_seen: "Day 20 - Dimensional breach at Raventree Manor",
            bounty: null,
            added: "Day 18",
            speaker_note: "Archie is not evil. He is broken. We seek to help him, not destroy him."
        },
        { 
            name: "King Bowser", 
            id: "bowser",
            status: "complicated",
            priority: "medium",
            portrait: "🐢",
            crimes: [
                "Flame without Restraint - Collateral fire damage",
                "Destruction of Infrastructure aboard the Vigilance"
            ],
            evidence: [
                "Burn damage assessment",
                "Witness accounts"
            ],
            notes: "Current whereabouts unknown. May be with Wally/Waluigi. Political complications due to his status as former Koopa King and current alliance with the party. His cooperation in the X.O. confrontation is noted.",
            last_seen: "Day 20 - Raventree Manor area",
            bounty: null,
            added: "Day 18",
            speaker_note: "Bowser is an ally, but his flames have cost us. Accountability, not vengeance."
        },
        { 
            name: "Waluigi", 
            id: "waluigi",
            status: "at_large",
            priority: "medium",
            portrait: "💜",
            crimes: [
                "Jester's Sin - Chaotic magical behavior",
                "Breach of Lab and Discipline",
                "The Cone of Cold Incident - Nearly killed Eager"
            ],
            evidence: [
                "Frozen damage to crew",
                "Laboratory breach evidence",
                "Eager's medical records"
            ],
            notes: "Escaped Raventree Manor on a summoned wyvern with Green T. Known for unpredictable magical outbursts. Owns the cursed mansion. Unclear if genuinely malicious or simply chaotic.",
            last_seen: "Day 20 - Fleeing Raventree Manor on wyvern",
            bounty: null,
            added: "Day 18",
            speaker_note: "The purple one is chaos incarnate. Approach with extreme caution."
        },
        { 
            name: "Dan", 
            id: "dan_docket",
            status: "probationary_active", // Updated
            priority: "low",
            portrait: "🐸⚔️",
            crimes: [
                "Unstable Hand - Magic Endangerment",
            ],
            evidence: ["Witness accounts"],
            notes: "Returned to active duty during Wraith attack despite injuries. Demonstrated control and loyalty. Charges suspended pending review.",
            last_seen: "Day 21 - Raventree Manor (Combat)",
            bounty: null,
            added: "Day 18",
            speaker_note: "His spirit is unbroken. He fights for us still."
        },
        { 
            name: "Eager", 
            id: "eager_docket",
            status: "active", // Updated
            priority: "low",
            portrait: "🐸🗡️",
            crimes: [
                "Blind Loyalty - Crossing the Line of Engagement",
                "Disobeying direct orders in combat"
            ],
            evidence: [
                "After-action reports",
                "Witness accounts",
                "Eager's 1 Aethel, 1040 BF testimony aboard the TOADALNAEC"
            ],
            notes: "Awakened from coma and rejoined combat operations in the Silent Grove. On 1 Aethel, 1040 BF, Eager said he had been sent without a detachment and could not locate Rodger or Toad Lee. The interrogators' claim that the Pond Patrol had been missing three weeks is not independently confirmed.",
            last_seen: "1 Aethel, 1040 BF - released after questioning aboard the TOADALNAEC; later location unrecorded",
            bounty: null,
            added: "Day 18",
            speaker_note: "Eager's heart was in the right place. His body paid the price, and he paid it again."
        },
        { 
            name: "Green Decoy (Unknown ID)", 
            id: "green_decoy",
            status: "captured_by_legion",
            priority: "medium",
            portrait: "🐸🟢",
            crimes: [
                "Impersonating an Officer",
                "Spreading False Doctrine ('The Fractured Heart')",
                "Endangering the Cohort"
            ],
            evidence: ["Interrogation logs from Bones"],
            notes: "Toad claiming to be Speaker L. Captured by Legion. Claimed skin turned green from mushrooms. Spouting cult rhetoric.",
            last_seen: "Day 21 - Aegis Command Interrogation Room",
            bounty: null,
            added: "Day 21",
            speaker_note: "Who is this impostor? And who taught him our codes?"
        }
    ],    
    resolved: [
        {
            name: "The Mole (Identity: Unknown)",
            resolution: "Escaped with Iron Legion forces",
            date: "Day 16",
            crimes: ["Infiltration", "Espionage", "Conspiracy to capture Cohort members"],
            notes: "True identity never confirmed. Operated as trusted Scout cohort leader before betrayal. Responsible for Bones' capture and compromising faction security.",
            speaker_note: "This one will face the Pond's justice. Someday."
        }
    ]
};

// ========================================

const FACTION_TIMELINE = [
{
        day: 21,
        date: { day: 21, monthIndex: 6, year: 1040 },
        isCurrent: true,
        title: "The Iron Mandate & Order 120",
        events: [
            {
                time: "09:00",
                title: "Iron Mandate Enacted",
                type: "political",
                severity: "critical",
                icon: "⚖️",
                description: "The Midlands Diet passes the Iron Mandate. The Liberated Toads are classified as an 'organized supernatural entity.'",
                involved: ["Iron Legion", "Midlands Diet"]
            },
            {
                time: "10:00",
                title: "Dragon Conspiracy Revealed",
                type: "intel",
                severity: "high",
                icon: "🐉",
                description: "Robinson (Markop's father) discovers the Dragon-Empire war is a fabrication. He and the dragon 'Ignis-Major' are captured by the Legion.",
                involved: ["Robinson", "Iron Legion", "Markop"]
            },
            {
                time: "14:30",
                title: "Massacre at Aegis Command",
                type: "combat",
                severity: "critical",
                icon: "🩸",
                description: "Infiltration failed. Bones stabbed by General Ironhand. A 'Green Decoy' of Speaker L was discovered. Ironhand issues 'Order 120': Execute all Toad prisoners.",
                involved: ["Bones", "Creek", "Marcus Ironhand", "Green Decoy"]
            },
            {
                time: "19:30",
                title: "Banishment of the Wraith",
                type: "magic",
                severity: "high",
                icon: "👻",
                description: "The party defeats an Arcane Wraith at Raventree Manor. Dan fights one-armed; Bowser physically assaults the ghost. The Oracle banishes the entity.",
                involved: ["Bowser", "Dan", "Archie", "Oracle", "Pernus Annmatar"]
            }
        ]
    },    
    {
        day: 21,
        date: { day: 21, monthIndex: 6, year: 1040 },
        isCurrent: true,
        title: "The Iron Mandate",
        events: [
            {
                time: "09:00",
                title: "Iron Mandate Enacted",
                type: "political",
                severity: "critical",
                icon: "⚖️",
                description: "The Midlands Diet passes the Iron Mandate 28-8-3, granting the Iron Legion emergency powers to purge supernatural threats. The Liberated Toads are now classified as an 'organized supernatural entity.'",
                involved: ["Iron Legion", "Midlands Diet", "Speaker Rivers (resigned)"]
            },
            {
                time: "10:00",
                title: "Emergency Vote Called",
                type: "governance",
                severity: "high",
                icon: "🗳️",
                description: "Speaker L convenes the Council to vote on the faction's response. Four options presented: evacuation, diplomacy, resistance, or strategic withdrawal.",
                involved: ["Speaker L", "Cohort Council"]
            },
            {
                time: "Current",
                title: "Council Deliberation",
                type: "governance",
                severity: "ongoing",
                icon: "⏳",
                description: "The Council debates. Strategic Withdrawal currently leads with 3 votes. Legion patrols are mobilizing.",
                involved: ["All Council Members"]
            }
        ]
    },
    {
        day: 20,
        date: { day: 20, monthIndex: 6, year: 1040 },
        title: "The Iron Sky Breach",
        events: [
    {
                time: "16:30",
                title: "Vigilance Captured",
                type: "military",
                severity: "critical",
                icon: "🚀",
                description: "The Iron Legion boards and captures the Vigilance.",
                involved: ["Iron Legion", "Ryan"]
            },            
            {
                time: "16:30",
                title: "Vigilance Captured",
                type: "military",
                severity: "critical",
                icon: "🚀",
                description: "The Iron Legion boards and captures the Vigilance. Multiple toads forced to escape, including Ryan who jumps from the ship.",
                involved: ["Iron Legion", "Ryan", "Multiple crew"]
            },
            {
                time: "17:00",
                title: "Bones Confirmed Captured",
                type: "intel",
                severity: "high",
                icon: "⛓️",
                description: "Bones is confirmed held at an Imperial Processing Facility. Council begins planning rescue operation.",
                involved: ["Bones", "Iron Legion"]
            },
            {
                time: "17:30",
                title: "Ryan Meets Rakasha",
                type: "exploration",
                severity: "medium",
                icon: "🦁",
                description: "Ryan survives their fall and is taken in by a Rakasha spirit-walker who senses their magical potential.",
                involved: ["Ryan", "Rakasha Tribe"]
            },
            {
                time: "23:15",
                title: "Spider Grove Rescue",
                type: "combat",
                severity: "medium",
                icon: "🕷️",
                description: "Markop and Remi rescue Eager from a web-choked grove in Raventree Manor, defeating a massive Arachnid Matriarch.",
                involved: ["Markop", "Remi", "Eager", "Waluigi", "Mossy"]
            }
        ]
    },
    {
        day: 19,
        date: { day: 19, monthIndex: 6, year: 1040 },
        title: "Siege of Raventree",
        events: [
            {
                time: "06:30",
                title: "Containment Perimeter",
                type: "military",
                severity: "high",
                icon: "🛡️",
                description: "Pond Patrol establishes containment perimeter around Raventree Manor. The manor responds by manifesting powerful wraiths.",
                involved: ["Pond Patrol", "Captain Fernback"]
            },
            {
                time: "06:55",
                title: "Green T Lost",
                type: "casualty",
                severity: "critical",
                icon: "💀",
                description: "Green T is violently pulled into a mirror dimension by a supernatural entity. Status: Unknown, presumed lost.",
                involved: ["Green T"]
            },
            {
                time: "08:00",
                title: "Archie Surrenders",
                type: "political",
                severity: "medium",
                icon: "🏳️",
                description: "Archie surrenders to Speaker L to buy time, but a glass monster emerges from a mirror, complicating the situation.",
                involved: ["Archie", "Speaker L", "Pond Patrol"]
            }
        ]
    },
    {
        day: 18,
        date: { day: 18, monthIndex: 6, year: 1040 },
        title: "Resolution 17-A",
        events: [
            {
                time: "10:00",
                title: "Emergency Powers Granted",
                type: "governance",
                severity: "critical",
                icon: "👑",
                description: "Council unanimously passes Emergency Resolution 17-A, granting Speaker L emergency powers. The Accountability Docket is established.",
                involved: ["Speaker L", "Full Council"]
            },
            {
                time: "13:00",
                title: "Supernatural Sovereignty Act",
                type: "political",
                severity: "critical",
                icon: "⚖️",
                description: "The Regal Empire passes a law declaring organized vampires and werewolves illegal, effectively declaring war on supernatural factions.",
                involved: ["Regal Empire", "Onyx Hand", "Moonfang Pack"]
            },
            {
                time: "18:30",
                title: "Raventree Standoff",
                type: "military",
                severity: "medium",
                icon: "🏚️",
                description: "Speaker L's Pond Patrol besieges Archie and hjumpik in the manor after a failed healing attempt on Eager.",
                involved: ["Speaker L", "Archie", "hjumpik", "Eager"]
            }
        ]
    },
    {
        day: 16,
        date: { day: 16, monthIndex: 6, year: 1040 },
        title: "The Day of Betrayal",
        events: [
            {
                time: "14:00",
                title: "Scavenging Doctrine Vote",
                type: "governance",
                severity: "medium",
                icon: "🗳️",
                description: "Dan's proposal for cautious expeditions defeats Archie's high-risk plan 5-1. First major policy shift toward safety.",
                involved: ["Dan", "Archie", "Council"]
            },
            {
                time: "19:30",
                title: "The Dinner That Broke Time",
                type: "exploration",
                severity: "critical",
                icon: "⏰",
                description: "Toads enter Shadeward Mansion seeking Archie. Encounter the Oracle, time loops, multiple Archie clones, and an Iron Legion raid.",
                involved: ["Multiple toads", "The Oracle", "Iron Legion"]
            },
            {
                time: "21:00",
                title: "The Mole Revealed",
                type: "intel",
                severity: "critical",
                icon: "🎭",
                description: "The Mole's true allegiance to the Iron Legion is exposed. Bones is captured during the chaos. Trust in the Scout cohort shattered.",
                involved: ["The Mole", "Bones", "Iron Legion"]
            }
        ]
    },
    {
        day: 12,
        date: { day: 12, monthIndex: 6, year: 1040 },
        title: "The Barrel Secret",
        events: [
            {
                time: "11:00",
                title: "FNG Remi Arrives",
                type: "political",
                severity: "low",
                icon: "📦",
                description: "Remi is discovered in a crate. Wario gives her an exploding box. She survives and is offered a place in his crew.",
                involved: ["Remi", "Wario", "Bowser"]
            },
            {
                time: "11:15",
                title: "Cone of Cold Incident",
                type: "friendly_fire",
                severity: "high",
                icon: "❄️",
                description: "Waluigi's Cone of Cold spell freezes Eager solid and injures Remi. Eager presumed dead by the crew.",
                involved: ["Waluigi", "Eager", "Remi"]
            },
            {
                time: "15:00",
                title: "150 Toads Discovered",
                type: "intel",
                severity: "critical",
                icon: "🪣",
                description: "The Iron Legion reveals that 150+ trafficked toads are hidden in barrels throughout the ship, accessible via Mini-Mushroom.",
                involved: ["hjumpik", "Iron Legion informant", "150 toads"]
            }
        ]
    },
    {
        day: 5,
        date: { day: 5, monthIndex: 6, year: 1040 },
        title: "The Great Betrayal",
        events: [
            {
                time: "18:45",
                title: "X.O. Neutralized",
                type: "combat",
                severity: "critical",
                icon: "⚔️",
                description: "The party, with critical assistance from Dan the Toad, neutralizes X.O. and regains control of the Vigilance.",
                involved: ["Dan", "Party members", "X.O."]
            }
        ]
    }
];



export { ACCOUNTABILITY_DOCKET, FACTION_TIMELINE };
