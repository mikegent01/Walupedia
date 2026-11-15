// guilds-data.js
// Comprehensive Guilds & Charters Data System

export const GUILD_CATEGORIES = {
    trade: { name: 'Trade Guilds', icon: '💰', color: '#ffd700', description: 'Commerce and crafting organizations' },
    martial: { name: 'Martial Orders', icon: '⚔️', color: '#dc3545', description: 'Military and combat organizations' },
    arcane: { name: 'Arcane Circles', icon: '🔮', color: '#8a2be2', description: 'Magic and scholarly organizations' },
    faith: { name: 'Religious Orders', icon: '✨', color: '#ffffff', description: 'Divine and spiritual organizations' },
    shadow: { name: 'Shadow Networks', icon: '🗡️', color: '#2d2d2d', description: 'Covert and underground organizations' },
    political: { name: 'Political Factions', icon: '🏛️', color: '#4a90d9', description: 'Governance and diplomatic organizations' },
    artisan: { name: 'Artisan Collectives', icon: '🔨', color: '#cd7f32', description: 'Craft and creation focused organizations' }
};

export const REPUTATION_TIERS = {
    exalted: { name: 'Exalted', min: 10000, color: '#ffd700', icon: '👑', perks: ['Maximum discounts', 'Leadership roles', 'Secret knowledge'] },
    revered: { name: 'Revered', min: 6000, color: '#ff8c00', icon: '⭐', perks: ['Major discounts', 'Special contracts', 'Inner circle access'] },
    honored: { name: 'Honored', min: 3000, color: '#9370db', icon: '🏅', perks: ['Good discounts', 'Priority contracts', 'Member facilities'] },
    friendly: { name: 'Friendly', min: 1000, color: '#3fb950', icon: '🤝', perks: ['Small discounts', 'Basic contracts', 'Guild hall access'] },
    neutral: { name: 'Neutral', min: 0, color: '#888888', icon: '➖', perks: ['Standard prices', 'Public contracts only'] },
    unfriendly: { name: 'Unfriendly', min: -1000, color: '#ffa500', icon: '😠', perks: ['Price markup', 'Limited services'] },
    hostile: { name: 'Hostile', min: -3000, color: '#dc3545', icon: '⚠️', perks: ['Denied entry', 'Active opposition'] },
    hated: { name: 'Hated', min: -6000, color: '#8b0000', icon: '💀', perks: ['Kill on sight', 'Bounty placed'] }
};

export const GUILD_DATA = {
    stonecarvers_brethren: {
        id: 'stonecarvers_brethren',
        name: "The Stonecarver's Brethren",
        shortName: "Stonecarvers",
        motto: "From Stone, Eternity",
        category: 'artisan',
        icon: '⚒️',
        banner: 'guild_banners/stonecarvers.png',
        founded: '847 BF',
        headquarters: 'Wickermoor Hollow, Druskenvald (chapter hall unconfirmed)',
        locationStatus: 'unconfirmed',
        
        description: "An ancient and prestigious guild of master stonemasons, sculptors, and architects. The Brethren have built the greatest monuments and fortifications across the realm for centuries.",
        
        lore: `The Stonecarver's Brethren traces its origins to the reconstruction era following the Tyrant Wars. When the great cities lay in ruins, it was the first Grandmaster, Theron Ironchisel, who united the scattered masons under a single banner.

Their works include the Iron Citadel, the Cathedral of the Eternal Flame, and countless lesser structures. The guild jealously guards ancient techniques passed down through generations, including methods of working enchanted stone that modern artificers cannot replicate.

In recent years, the Brethren have faced challenges from cheaper labor and magical construction methods, but their reputation for quality remains unmatched.`,

        leader: {
            name: "Grandmaster Aldric Stoneheart",
            title: "Grandmaster",
            portrait: "portraits/aldric_stoneheart.png",
            description: "A stern dwarf of 340 years who has led the guild for three decades. Known for his uncompromising standards."
        },
        
        officers: [
            { name: "Warden Helga Ironvein", role: "Warden of Standards", description: "Oversees quality control and apprentice training" },
            { name: "Quartermaster Boris Granitefist", role: "Quartermaster", description: "Manages guild resources and contracts" },
            { name: "Lorekeeper Maeve Chiselwright", role: "Keeper of Techniques", description: "Guards the guild's ancient secrets" }
        ],

        ranks: [
            { 
                tier: 1, 
                title: "Apprentice", 
                description: "Learning the fundamentals of stonework",
                requirements: "Sponsored by a Journeyman, pass basic assessment",
                benefits: ["Access to training halls", "Basic tool allowance", "Dormitory housing"],
                repRequired: 0
            },
            { 
                tier: 2, 
                title: "Journeyman", 
                description: "Competent craftsman, may take independent contracts",
                requirements: "5 years apprenticeship, masterwork submission",
                benefits: ["Independent contracts", "Vote in guild matters", "Workshop access"],
                repRequired: 1000
            },
            { 
                tier: 3, 
                title: "Stonecarver", 
                description: "Full guild member with all privileges",
                requirements: "Notable project completion, peer endorsement",
                benefits: ["Major contracts", "Apprentice sponsorship", "Profit sharing"],
                repRequired: 3000
            },
            { 
                tier: 4, 
                title: "Master Carver", 
                description: "Elite artisan, shapes guild policy",
                requirements: "Landmark achievement, council approval",
                benefits: ["Council seat", "Secret techniques", "Premium contracts"],
                repRequired: 6000
            },
            { 
                tier: 5, 
                title: "Grandmaster", 
                description: "Supreme leader of the guild",
                requirements: "Election by Master Carvers upon vacancy",
                benefits: ["Full authority", "Guild treasury access", "Legendary status"],
                repRequired: 10000
            }
        ],

        rules: [
            "Never reveal guild techniques to outsiders",
            "Complete all contracted work to the highest standard",
            "Assist fellow Brethren in times of need",
            "Pay guild dues promptly and honestly",
            "Respect the hierarchy and decisions of superiors",
            "Never undercut a fellow member's contract"
        ],

        resources: {
            treasury: 75000,
            influence: 68,
            manpower: 450,
            materials: {
                stone: 85,
                metal: 40,
                gems: 25
            }
        },

        facilities: [
            { name: "The Granite Hall", type: "Headquarters", description: "Main guild hall with meeting chambers and archives", access: "Apprentice+" },
            { name: "Training Quarries", type: "Training", description: "Practice areas for apprentices", access: "Apprentice+" },
            { name: "Master's Workshop", type: "Crafting", description: "Premium workspace with enchanted tools", access: "Stonecarver+" },
            { name: "The Vault of Forms", type: "Archive", description: "Repository of ancient blueprints and techniques", access: "Master Carver+" }
        ],

        services: [
            { name: "Stonework Commission", description: "Custom masonry and sculpture", priceRange: "50-10,000 gold", discount: { friendly: 10, honored: 20, revered: 30, exalted: 40 } },
            { name: "Fortification Consultation", description: "Expert advice on defensive structures", priceRange: "100-500 gold", discount: { friendly: 5, honored: 15, revered: 25, exalted: 35 } },
            { name: "Apprentice Training", description: "Basic stonework instruction", priceRange: "200 gold/month", discount: { friendly: 0, honored: 10, revered: 20, exalted: 50 } },
            { name: "Material Procurement", description: "Access to quality stone sources", priceRange: "Market rate", discount: { friendly: 5, honored: 10, revered: 15, exalted: 25 } }
        ],

        research_bonus: { 
            category: 'Construction', 
            amount: 0.15,
            description: "+15% to Construction research when allied"
        },

        relations: {
            merchants_consortium: { standing: 'friendly', reason: 'Regular business partners' },
            iron_legion: { standing: 'neutral', reason: 'Occasional military contracts' },
            mages_guild: { standing: 'unfriendly', reason: 'Competition from magical construction' },
            miners_collective: { standing: 'allied', reason: 'Essential material suppliers' }
        },

        contracts: [
            {
                id: 'sc_001',
                title: "Repair the Eastgate Bridge",
                type: 'construction',
                difficulty: 'medium',
                reward: { gold: 500, reputation: 150 },
                deadline: 14,
                description: "The eastern bridge has developed cracks. Requires skilled repair work.",
                requirements: ["Journeyman rank", "Construction skill 3+"],
                status: 'available'
            },
            {
                id: 'sc_002',
                title: "Memorial Statue Commission",
                type: 'crafting',
                difficulty: 'hard',
                reward: { gold: 1200, reputation: 300, item: 'Master Chisel' },
                deadline: 30,
                description: "Create a memorial statue for the fallen of the recent conflicts.",
                requirements: ["Stonecarver rank", "Sculpture skill 4+"],
                status: 'available'
            },
            {
                id: 'sc_003',
                title: "Emergency Fortification",
                type: 'urgent',
                difficulty: 'hard',
                reward: { gold: 2000, reputation: 500 },
                deadline: 7,
                description: "Iron Legion requires immediate defensive works. Time-critical.",
                requirements: ["Any rank", "Available immediately"],
                status: 'urgent'
            }
        ],

        events: [
            { date: "Day 25", title: "Annual Masonry Competition", description: "Apprentices compete for advancement" },
            { date: "Day 30", title: "Quarterly Council Meeting", description: "Guild policy discussions" }
        ],

        history: [
            { year: '847 BF', event: 'Guild founded by Theron Ironchisel' },
            { year: '892 BF', event: 'Completed the Iron Citadel' },
            { year: '956 BF', event: 'Great Schism - Sculptors briefly split off' },
            { year: '1020 BF', event: 'Current Grandmaster elected' }
        ],

        rumors: [
            "They say the Brethren know how to build structures that can withstand any magic...",
            "The Vault of Forms supposedly contains blueprints for weapons of immense power.",
            "Grandmaster Stoneheart is seeking to recover techniques lost in the Tyrant Wars."
        ],

        membershipRequirements: {
            species: ['dwarf', 'human', 'golem'],
            skills: ['stonework', 'architecture'],
            sponsorship: true,
            fee: 100
        },

        isPlayerMember: 'hjumpik',
        playerRank: 'Stonecarver',
        playerReputation: 3500
    },

    merchants_consortium: {
        id: 'merchants_consortium',
        name: "The Merchants' Consortium",
        shortName: "Consortium",
        motto: "Profit Through Unity",
        category: 'trade',
        icon: '💰',
        banner: 'guild_banners/consortium.png',
        founded: '723 BF',
        headquarters: 'Wickermoor Hollow, Druskenvald (market charter; hall unconfirmed)',
        locationStatus: 'unconfirmed',
        
        description: "The largest and most influential trade organization in the realm. The Consortium controls major trade routes, sets market standards, and provides banking services.",
        
        lore: `Born from the chaos of the post-war economy, the Merchants' Consortium was founded by seven wealthy traders who recognized that cooperation would benefit all. Their "Pact of Seven Coins" established the framework that still governs inter-regional commerce today.

The Consortium's influence extends into every marketplace. They maintain the only reliable banking network, insure cargo shipments, and arbitrate trade disputes. Critics accuse them of monopolistic practices, but few can deny the stability they bring to commerce.

Recent events have strained the Consortium's resources. The conflict in the Mushroom Kingdom has disrupted trade routes, and the Iron Legion's expansion threatens their autonomy.`,

        leader: {
            name: "Guildmaster Theodora Goldweaver",
            title: "Guildmaster",
            portrait: "portraits/theodora.png",
            description: "A shrewd Toad businesswoman who rose from humble origins to control the realm's largest trading network."
        },

        officers: [
            { name: "Chancellor Marcus Coinsworth", role: "Master of Coin", description: "Oversees the banking division" },
            { name: "Admiral Petra Stormwind", role: "Fleet Admiral", description: "Commands the merchant marine" },
            { name: "Arbiter Lysander", role: "Chief Arbiter", description: "Handles trade disputes and contracts" }
        ],

        ranks: [
            { tier: 1, title: "Associate", description: "Licensed to trade under Consortium banner", requirements: "Pay membership fee", benefits: ["Trade license", "Basic insurance"], repRequired: 0 },
            { tier: 2, title: "Merchant", description: "Full trading privileges", requirements: "1000 gold in trade volume", benefits: ["Banking access", "Route protection"], repRequired: 1000 },
            { tier: 3, title: "Factor", description: "May operate trading posts", requirements: "Establish profitable route", benefits: ["Trading post rights", "Bulk discounts"], repRequired: 3000 },
            { tier: 4, title: "Magnate", description: "Voting member of the Council", requirements: "Major economic contribution", benefits: ["Council vote", "Exclusive contracts"], repRequired: 6000 },
            { tier: 5, title: "Guildmaster", description: "Leader of the Consortium", requirements: "Election by Magnates", benefits: ["Full authority", "Treasury access"], repRequired: 10000 }
        ],

        rules: [
            "Honor all contracts sealed with the Consortium mark",
            "Pay tariffs and dues promptly",
            "Report any trade route disruptions immediately",
            "Never engage in smuggling of prohibited goods",
            "Maintain fair prices within established ranges",
            "Protect Consortium trade secrets"
        ],

        resources: {
            treasury: 500000,
            influence: 85,
            manpower: 2000,
            materials: {
                gold: 95,
                goods: 90,
                ships: 60
            }
        },

        facilities: [
            { name: "The Golden Exchange", type: "Headquarters", description: "Main trading floor and administrative center", access: "Associate+" },
            { name: "Consortium Bank", type: "Banking", description: "Secure vaults and lending services", access: "Merchant+" },
            { name: "Trade Academy", type: "Training", description: "Business and negotiation training", access: "Associate+" },
            { name: "Magnate Lounge", type: "Exclusive", description: "Private meeting space for elite members", access: "Magnate+" }
        ],

        services: [
            { name: "Banking Services", description: "Deposits, loans, and money transfers", priceRange: "2-10% fees", discount: { friendly: 5, honored: 15, revered: 25, exalted: 40 } },
            { name: "Cargo Insurance", description: "Protection against loss", priceRange: "5-15% of cargo value", discount: { friendly: 10, honored: 20, revered: 30, exalted: 50 } },
            { name: "Trade Route Access", description: "Use of protected trade routes", priceRange: "100-1000 gold/trip", discount: { friendly: 5, honored: 15, revered: 25, exalted: 35 } },
            { name: "Market Intelligence", description: "Price and demand information", priceRange: "50-500 gold", discount: { friendly: 10, honored: 25, revered: 40, exalted: 60 } }
        ],

        research_bonus: { 
            category: 'Economics', 
            amount: 0.20,
            description: "+20% to Economics research when allied"
        },

        relations: {
            stonecarvers_brethren: { standing: 'friendly', reason: 'Regular business partners' },
            iron_legion: { standing: 'tense', reason: 'Taxation disputes' },
            tea_leaf_syndicate: { standing: 'hostile', reason: 'Smuggling competition' },
            mages_guild: { standing: 'friendly', reason: 'Magical goods trade' }
        },

        contracts: [
            {
                id: 'mc_001',
                title: "Escort Valuable Shipment",
                type: 'escort',
                difficulty: 'medium',
                reward: { gold: 300, reputation: 100 },
                deadline: 7,
                description: "Guard a cargo of magical components traveling to the capital.",
                requirements: ["Combat capable", "Trustworthy reputation"],
                status: 'available'
            },
            {
                id: 'mc_002',
                title: "Investigate Market Manipulation",
                type: 'investigation',
                difficulty: 'hard',
                reward: { gold: 800, reputation: 250 },
                deadline: 21,
                description: "Someone is artificially inflating grain prices. Find out who.",
                requirements: ["Investigation skill", "Market knowledge"],
                status: 'available'
            }
        ],

        events: [
            { date: "Day 28", title: "Quarterly Auction", description: "Rare goods and contracts available" },
            { date: "Day 35", title: "Trade Summit", description: "Inter-guild negotiations" }
        ],

        history: [
            { year: '723 BF', event: 'Pact of Seven Coins signed' },
            { year: '801 BF', event: 'Established banking monopoly' },
            { year: '945 BF', event: 'Survived the Great Depression' },
            { year: '1038 BF', event: 'Current Guildmaster elected' }
        ],

        rumors: [
            "The Consortium's vaults hold enough gold to buy a kingdom...",
            "Guildmaster Goldweaver has secret dealings with the Tea Leaf Syndicate.",
            "They're planning to establish their own private army."
        ],

        membershipRequirements: {
            species: null,
            skills: ['commerce', 'negotiation'],
            sponsorship: false,
            fee: 500
        },

        isPlayerMember: null,
        playerRank: null,
        playerReputation: 250
    },

    shadow_weavers: {
        id: 'shadow_weavers',
        name: "The Shadow Weavers",
        shortName: "Weavers",
        motto: "Unseen, Unheard, Undone",
        category: 'shadow',
        icon: '🕷️',
        banner: 'guild_banners/weavers.png',
        founded: '??? BF',
        headquarters: 'Wickermoor Hollow, Druskenvald (rumored)',
        locationStatus: 'rumored',
        
        description: "A secretive organization of spies, assassins, and information brokers. Their existence is officially denied by all governments, yet their influence is felt everywhere.",
        
        lore: `No one knows when the Shadow Weavers truly began. Some claim they predate the kingdoms themselves, others that they emerged from the chaos of the Tyrant Wars. What is known is that they deal in the currency of secrets, and their price is always paid.

The Weavers operate through a cell structure—no member knows more than a handful of others. Contracts are accepted through dead drops and coded messages. Payment is made in ways that leave no trace.

To attract their attention, one must know the signs. A particular arrangement of coins on a tavern table. A phrase spoken to the right beggar. Those who seek the Weavers without proper introduction often simply... disappear.`,

        leader: {
            name: "The Weavemaster",
            title: "Weavemaster",
            portrait: "portraits/shadow_silhouette.png",
            description: "Identity unknown. May be one person or several. Some doubt they exist at all."
        },

        officers: [
            { name: "The Whisper", role: "Information Network", description: "Coordinates intelligence gathering" },
            { name: "The Blade", role: "Wet Work Division", description: "Handles... permanent solutions" },
            { name: "The Face", role: "Infiltration", description: "Masters of disguise and social engineering" }
        ],

        ranks: [
            { tier: 1, title: "Thread", description: "Lowest rank, used for simple tasks", requirements: "Recruited by existing member", benefits: ["Basic jobs", "Protection from exposure"], repRequired: 0 },
            { tier: 2, title: "Strand", description: "Proven operative", requirements: "Successful operations", benefits: ["Better contracts", "Safe houses"], repRequired: 1000 },
            { tier: 3, title: "Pattern", description: "Cell leader", requirements: "Demonstrated leadership", benefits: ["Own cell", "Major operations"], repRequired: 3000 },
            { tier: 4, title: "Weaver", description: "Senior operative", requirements: "Exceptional service", benefits: ["Strategic planning", "Elite resources"], repRequired: 6000 },
            { tier: 5, title: "Weavemaster", description: "The shadow that guides all others", requirements: "Unknown", benefits: ["Ultimate authority"], repRequired: 10000 }
        ],

        rules: [
            "Never reveal the organization's existence",
            "Complete all contracts or die trying",
            "Leave no witnesses, no evidence",
            "Never betray a fellow Weaver",
            "The Weavemaster's word is absolute",
            "Death before dishonor to the web"
        ],

        resources: {
            treasury: 'Unknown',
            influence: 95,
            manpower: 'Unknown',
            materials: {
                intelligence: 99,
                poison: 85,
                safehouses: 70
            }
        },

        facilities: [
            { name: "The Whisper Market", type: "Headquarters", description: "Hidden bazaar of secrets", access: "Thread+" },
            { name: "Dead Drops", type: "Communication", description: "Secure message points across the realm", access: "Thread+" },
            { name: "Safe Houses", type: "Refuge", description: "Hidden locations for operatives", access: "Strand+" },
            { name: "The Black Archive", type: "Intelligence", description: "Repository of all gathered secrets", access: "Weaver+" }
        ],

        services: [
            { name: "Information Gathering", description: "Learn secrets about anyone", priceRange: "100-10,000 gold", discount: { friendly: 10, honored: 20, revered: 35, exalted: 50 } },
            { name: "Surveillance", description: "Track a target's movements", priceRange: "200-2,000 gold", discount: { friendly: 5, honored: 15, revered: 25, exalted: 40 } },
            { name: "Elimination", description: "Permanent problem solving", priceRange: "1,000-100,000 gold", discount: { friendly: 0, honored: 10, revered: 20, exalted: 30 } },
            { name: "Protection", description: "Counter-intelligence services", priceRange: "500-5,000 gold", discount: { friendly: 10, honored: 20, revered: 30, exalted: 45 } }
        ],

        research_bonus: { 
            category: 'Espionage', 
            amount: 0.25,
            description: "+25% to Espionage research when allied"
        },

        relations: {
            iron_legion: { standing: 'hostile', reason: 'Natural enemies' },
            merchants_consortium: { standing: 'business', reason: 'Mutual utility' },
            tea_leaf_syndicate: { standing: 'rivalry', reason: 'Competing in similar markets' },
            onyx_hand: { standing: 'neutral', reason: 'Professional respect' }
        },

        contracts: [
            {
                id: 'sw_001',
                title: "Eyes and Ears",
                type: 'espionage',
                difficulty: 'easy',
                reward: { gold: 200, reputation: 75 },
                deadline: 14,
                description: "Observe and report on a noble's activities. No contact required.",
                requirements: ["Stealth skill", "Patience"],
                status: 'available'
            },
            {
                id: 'sw_002',
                title: "The Silent Treatment",
                type: 'assassination',
                difficulty: 'extreme',
                reward: { gold: 5000, reputation: 800 },
                deadline: 30,
                description: "[CLASSIFIED] - Details provided upon acceptance.",
                requirements: ["Pattern rank", "Proven discretion"],
                status: 'restricted'
            }
        ],

        events: [
            { date: "Unknown", title: "The Gathering", description: "Rare meeting of senior Weavers" }
        ],

        history: [
            { year: '??? BF', event: 'Origins lost to time' },
            { year: '~800 BF', event: 'First documented activity' },
            { year: '1015 BF', event: 'The Night of Falling Stars (mass assassination)' },
            { year: '1040 BF', event: 'Current activities classified' }
        ],

        rumors: [
            "They say the Weavers have agents in every court...",
            "The Weavemaster is actually a council of seven.",
            "They've been hired to eliminate someone in the party..."
        ],

        membershipRequirements: {
            species: null,
            skills: ['stealth', 'deception'],
            sponsorship: true,
            fee: 'Your first secret'
        },

        isPlayerMember: 'archie',
        playerRank: 'Thread',
        playerReputation: 500
    },

    mages_guild: {
        id: 'mages_guild',
        name: "The Mages' Guild",
        shortName: "Mages Guild",
        motto: "Knowledge Is Power",
        category: 'arcane',
        icon: '🔮',
        banner: 'guild_banners/mages.png',
        founded: '412 BF',
        headquarters: 'The Arcane Quarter (central tower complex)',
        locationStatus: 'canon',
        article: 'mages_guild',
        
        description: "The preeminent organization of magical practitioners. The Guild regulates magic use, trains new mages, and researches the arcane arts. Recently under political pressure from the Iron Legion.",
        
        lore: `The Mages' Guild was established in the aftermath of the Arcane Cataclysm, when unregulated magic nearly destroyed the realm. The founding Archmages created the Guild to ensure such devastation would never occur again.

For centuries, the Guild has maintained a careful balance—preserving magical knowledge while preventing its misuse. They license practitioners, investigate magical crimes, and serve as advisors to governments across the realm.

The recent Supernatural Sovereignty Act has placed the Guild in a precarious position. While officially exempt, many members fear they will be the next targets. Some advocate cooperation with the Iron Legion, while others counsel resistance.`,

        leader: {
            name: "Archmage Quintus Brightwater",
            title: "Archmage",
            portrait: "portraits/quintus.png",
            description: "A powerful human wizard known for his diplomatic skill and political acumen. Currently navigating the Guild through its greatest crisis."
        },

        officers: [
            { name: "Grand Enchanter Lyria Moonwhisper", role: "Dean of Enchantment", description: "Heads the Enchantment College" },
            { name: "High Conjurer Thaddeus Vex", role: "Dean of Conjuration", description: "Heads the Conjuration College" },
            { name: "Keeper Mordecai", role: "Master of the Library", description: "Guards the Forbidden Archives" }
        ],

        ranks: [
            { tier: 1, title: "Initiate", description: "Student of the arcane arts", requirements: "Pass magical aptitude test", benefits: ["Basic training", "Library access"], repRequired: 0 },
            { tier: 2, title: "Apprentice", description: "Assigned to a master for training", requirements: "Complete initiate studies", benefits: ["Master mentorship", "Practice labs"], repRequired: 1000 },
            { tier: 3, title: "Journeymage", description: "Licensed to practice magic independently", requirements: "Pass certification exams", benefits: ["Legal practice", "Guild contracts"], repRequired: 3000 },
            { tier: 4, title: "Magister", description: "Respected expert in magical field", requirements: "Significant magical achievement", benefits: ["Teaching rights", "Research grants"], repRequired: 6000 },
            { tier: 5, title: "Archmage", description: "Supreme magical authority", requirements: "Election by the Conclave", benefits: ["Full authority", "Artifact access"], repRequired: 10000 }
        ],

        rules: [
            "Never use magic for wanton destruction",
            "Report all magical anomalies to the Guild",
            "Maintain accurate records of all spell research",
            "Do not teach magic to unlicensed individuals",
            "Submit to Guild arbitration in magical disputes",
            "Protect non-magical persons from magical harm"
        ],

        resources: {
            treasury: 150000,
            influence: 72,
            manpower: 800,
            materials: {
                mana_crystals: 80,
                rare_reagents: 65,
                artifacts: 45
            }
        },

        facilities: [
            { name: "The Astral Spire", type: "Headquarters", description: "Main tower containing all colleges", access: "Initiate+" },
            { name: "The Great Library", type: "Archive", description: "Vast collection of magical texts", access: "Initiate+" },
            { name: "The Forbidden Archives", type: "Restricted", description: "Dangerous knowledge under seal", access: "Magister+" },
            { name: "The Crucible", type: "Laboratory", description: "Advanced magical experimentation", access: "Journeymage+" }
        ],

        services: [
            { name: "Spellcasting Services", description: "Hire a mage for magical needs", priceRange: "50-5,000 gold", discount: { friendly: 10, honored: 20, revered: 35, exalted: 50 } },
            { name: "Magical Training", description: "Learn spells and magical theory", priceRange: "200 gold/week", discount: { friendly: 5, honored: 15, revered: 30, exalted: 45 } },
            { name: "Enchantment Services", description: "Have items enchanted", priceRange: "100-10,000 gold", discount: { friendly: 10, honored: 25, revered: 40, exalted: 55 } },
            { name: "Magical Identification", description: "Identify unknown magical items", priceRange: "25-500 gold", discount: { friendly: 15, honored: 30, revered: 45, exalted: 60 } }
        ],

        research_bonus: { 
            category: 'Arcane', 
            amount: 0.30,
            description: "+30% to Arcane research when allied"
        },

        relations: {
            iron_legion: { standing: 'tense', reason: 'Supernatural Sovereignty Act' },
            stonecarvers_brethren: { standing: 'unfriendly', reason: 'Magical construction competition' },
            merchants_consortium: { standing: 'friendly', reason: 'Magical goods trade' },
            onyx_hand: { standing: 'complicated', reason: 'Mutual interest in the arcane' }
        },

        contracts: [
            {
                id: 'mg_001',
                title: "Investigate Magical Anomaly",
                type: 'investigation',
                difficulty: 'medium',
                reward: { gold: 400, reputation: 150 },
                deadline: 14,
                description: "Strange magical readings detected in the eastern forest. Investigate and report.",
                requirements: ["Basic magical knowledge", "Investigation skill"],
                status: 'available'
            },
            {
                id: 'mg_002',
                title: "Escort Researcher",
                type: 'escort',
                difficulty: 'hard',
                reward: { gold: 600, reputation: 200 },
                deadline: 21,
                description: "Protect a Guild researcher traveling to study ancient ruins.",
                requirements: ["Combat capability", "Discretion"],
                status: 'available'
            }
        ],

        events: [
            { date: "Day 28", title: "Mage Registry Amendment Vote", description: "Diet votes on Guild exemption" },
            { date: "Day 35", title: "Conclave Assembly", description: "Emergency meeting of all Magisters" }
        ],

        history: [
            { year: '412 BF', event: 'Guild founded after Arcane Cataclysm' },
            { year: '567 BF', event: 'Established the Licensing System' },
            { year: '890 BF', event: 'The Mage Wars - Guild nearly destroyed' },
            { year: '1040 BF', event: 'Supernatural Sovereignty Act crisis' }
        ],

        rumors: [
            "The Archmage is secretly negotiating with vampire emissaries...",
            "Some Magisters are planning to defect to the supernatural factions.",
            "The Forbidden Archives contain spells that could destroy armies."
        ],

        membershipRequirements: {
            species: null,
            skills: ['arcana', 'spellcasting'],
            sponsorship: false,
            fee: 'Magical aptitude test'
        },

        isPlayerMember: null,
        playerRank: null,
        playerReputation: -500
    },

    iron_crown_brigade: {
        id: 'iron_crown_brigade',
        name: "Iron Crown Brigade",
        shortName: "Iron Crown",
        motto: "Order Through Strength",
        category: 'martial',
        icon: '⚔️',
        banner: 'guild_banners/iron_crown.png',
        founded: '1038 BF',
        headquarters: 'Mobile Command (Currently: Mushroom Kingdom)',
        locationStatus: 'mobile',
        
        description: "The elite covert operations arm of the Iron Legion. Officially, they don't exist. In practice, they're the tip of the Empire's spear in foreign territories.",
        
        lore: `The Iron Crown Brigade was formed in secret as the Iron Legion's answer to unconventional threats. Where the main Legion operates openly, the Brigade works in shadows—infiltrating, destabilizing, and preparing the ground for eventual conquest.

Their operatives are drawn from the Legion's most capable soldiers, supplemented by recruited specialists. Training is brutal, with a 60% washout rate. Those who survive emerge as some of the most dangerous individuals in the realm.

Currently, the Brigade is focused on the Mushroom Kingdom, where they've successfully captured the airship Vigilance and are expanding their network of agents and sympathizers.`,

        leader: {
            name: "Viceroy Hammer Forgeheart",
            title: "Viceroy",
            portrait: "portraits/forgeheart.jpg",
            description: "A calculating strategist who views the Kingdom as a puzzle to be solved. Known for patience and ruthlessness in equal measure."
        },

        officers: [
            { name: "Tribune Aldric Stone", role: "Field Commander", description: "Leads direct action operations" },
            { name: "Operative Shade", role: "Intelligence Chief", description: "Manages spy networks" },
            { name: "Captain Creek", role: "Medical/Infiltration", description: "Surgeon and deep cover specialist" }
        ],

        ranks: [
            { tier: 1, title: "Recruit", description: "In training", requirements: "Legion service + selection", benefits: ["Training", "Basic gear"], repRequired: 0 },
            { tier: 2, title: "Operative", description: "Field agent", requirements: "Survive training", benefits: ["Field assignments", "Cover identity"], repRequired: 1000 },
            { tier: 3, title: "Senior Operative", description: "Experienced agent", requirements: "Successful missions", benefits: ["Team leadership", "Priority intel"], repRequired: 3000 },
            { tier: 4, title: "Tribune", description: "Operation commander", requirements: "Exceptional service", benefits: ["Operation planning", "Asset access"], repRequired: 6000 },
            { tier: 5, title: "Viceroy", description: "Theater commander", requirements: "Appointment by Grand Forgemaster", benefits: ["Full authority", "Direct line to command"], repRequired: 10000 }
        ],

        rules: [
            "The mission is paramount",
            "Leave no evidence of Legion involvement",
            "Expendable assets are to be expended",
            "Intelligence is to be shared up the chain only",
            "Capture is not an option—die first",
            "The Brigade does not exist"
        ],

        resources: {
            treasury: 'Classified',
            influence: 60,
            manpower: 2000,
            materials: {
                weapons: 90,
                intel: 85,
                safehouses: 75
            }
        },

        facilities: [
            { name: "Mobile Command", type: "Headquarters", description: "Relocatable command center", access: "Operative+" },
            { name: "The Vigilance", type: "Asset", description: "Captured airship serving as mobile base", access: "Senior Operative+" },
            { name: "Dead Drops", type: "Communication", description: "Secure message points", access: "Operative+" },
            { name: "Safe Houses", type: "Refuge", description: "Hidden locations throughout the Kingdom", access: "Operative+" }
        ],

        services: [
            { name: "Intelligence Sharing", description: "Access to Legion intelligence", priceRange: "Favor-based", discount: { friendly: 0, honored: 0, revered: 0, exalted: 0 } },
            { name: "Extraction", description: "Emergency evacuation services", priceRange: "Mission-based", discount: { friendly: 0, honored: 0, revered: 0, exalted: 0 } },
            { name: "Equipment", description: "Access to military-grade gear", priceRange: "Requisition", discount: { friendly: 0, honored: 0, revered: 0, exalted: 0 } }
        ],

        research_bonus: { 
            category: 'Military', 
            amount: 0.20,
            description: "+20% to Military research when allied"
        },

        relations: {
            iron_legion: { standing: 'allied', reason: 'Parent organization' },
            liberated_toads: { standing: 'hostile', reason: 'Primary opposition' },
            shadow_weavers: { standing: 'hostile', reason: 'Competing intelligence services' },
            mages_guild: { standing: 'hostile', reason: 'Supernatural Sovereignty Act' }
        },

        contracts: [
            {
                id: 'icb_001',
                title: "[CLASSIFIED]",
                type: 'classified',
                difficulty: 'extreme',
                reward: { gold: 'Varies', reputation: 'Varies' },
                deadline: 'Mission-dependent',
                description: "Details available to authorized personnel only.",
                requirements: ["Iron Legion affiliation"],
                status: 'restricted'
            }
        ],

        events: [
            { date: "Classified", title: "Operation Updates", description: "Need-to-know basis only" }
        ],

        history: [
            { year: '1038 BF', event: 'Brigade formally established' },
            { year: '1040 BF', event: 'Deployed to Mushroom Kingdom' },
            { year: '1040 BF', event: 'Captured the Vigilance' },
            { year: '1040 BF', event: 'Iron Mandate grants expanded authority' }
        ],

        rumors: [
            "They've infiltrated every major faction in the Kingdom...",
            "The Viceroy reports directly to the Grand Forgemaster.",
            "They're planning something big for the Starfall Festival."
        ],

        membershipRequirements: {
            species: null,
            skills: ['combat', 'stealth', 'loyalty'],
            sponsorship: 'Legion service required',
            fee: 'Blood oath'
        },

        isPlayerMember: null,
        playerRank: null,
        playerReputation: -3500
    }
};

export const CHARTER_DATA = {
    liberated_toads: {
        id: 'liberated_toads',
        name: "The Liberated Toads",
        shortName: "Liberated",
        motto: "Freedom Through Unity",
        category: 'political',
        icon: '🍄',
        banner: 'charter_banners/liberated.png',
        founded: '1040 BF',
        headquarters: 'No fixed capital (travels with the Vigilance diaspora)',
        locationStatus: 'canon',
        article: 'liberated_toads',
        
        description: "A resistance movement formed by those who refuse to accept Iron Legion occupation. Part freedom fighters, part refugees, wholly determined to reclaim their homeland.",
        
        lore: `The Liberated Toads emerged from the chaos of the Legion's incursion into the Mushroom Kingdom. What began as scattered groups of refugees and deserters has coalesced into an organized resistance under the unlikely leadership of an adventuring party.

Their resources are limited, their enemies numerous, but their resolve is unshakeable. Operating from hidden bases and relying on sympathizers throughout the Kingdom, they strike at Legion operations wherever possible.

Recent events have tested them severely. The loss of the Vigilance, the intensifying crackdown, and the passage of the Iron Mandate have all added pressure. Yet they continue to fight, believing that freedom is worth any price.`,

        leader: {
            name: "The Party",
            title: "Leadership Council",
            portrait: "portraits/party_emblem.png",
            description: "An adventuring party that has become the de facto leadership. Decisions are made collectively."
        },

        officers: [
            { name: "Captain Toadette", role: "Military Liaison", description: "Provides tactical expertise and some official cover" },
            { name: "Archie Miser", role: "Intelligence", description: "Information gathering and analysis" },
            { name: "Bowser", role: "Heavy Support", description: "When subtlety fails, Bowser succeeds" }
        ],

        ranks: [
            { tier: 1, title: "Sympathizer", description: "Provides passive support", requirements: "Share our values", benefits: ["Safe passage", "Information"], repRequired: 0 },
            { tier: 2, title: "Supporter", description: "Active assistance", requirements: "Proven trustworthy", benefits: ["Safe houses", "Basic resources"], repRequired: 500 },
            { tier: 3, title: "Operative", description: "Full resistance member", requirements: "Demonstrated commitment", benefits: ["Full support", "Mission participation"], repRequired: 1500 },
            { tier: 4, title: "Cell Leader", description: "Commands a resistance cell", requirements: "Leadership proven", benefits: ["Resource allocation", "Strategic input"], repRequired: 4000 },
            { tier: 5, title: "Council Member", description: "Part of central leadership", requirements: "Exceptional contribution", benefits: ["Policy decisions", "Full access"], repRequired: 8000 }
        ],

        rules: [
            "Protect civilians at all costs",
            "Never betray a fellow Liberated",
            "Minimize collateral damage",
            "Share resources with those in need",
            "The cause comes before personal gain",
            "Hope is our greatest weapon"
        ],

        resources: {
            treasury: 5000,
            influence: 35,
            manpower: 150,
            materials: {
                weapons: 30,
                supplies: 40,
                safehouses: 50
            }
        },

        facilities: [
            { name: "The Network", type: "Communication", description: "Hidden message system", access: "Sympathizer+" },
            { name: "Safe Houses", type: "Refuge", description: "Hidden locations for members", access: "Supporter+" },
            { name: "The Armory", type: "Equipment", description: "Cached weapons and supplies", access: "Operative+" },
            { name: "Command Post", type: "Headquarters", description: "Mobile leadership location", access: "Cell Leader+" }
        ],

        services: [
            { name: "Safe Passage", description: "Help moving through dangerous areas", priceRange: "Free for allies", discount: { friendly: 100, honored: 100, revered: 100, exalted: 100 } },
            { name: "Intelligence", description: "Information about Legion movements", priceRange: "Shared freely", discount: { friendly: 100, honored: 100, revered: 100, exalted: 100 } },
            { name: "Medical Care", description: "Treatment for the wounded", priceRange: "What you can give", discount: { friendly: 100, honored: 100, revered: 100, exalted: 100 } }
        ],

        research_bonus: { 
            category: 'Guerrilla Tactics', 
            amount: 0.15,
            description: "+15% to asymmetric warfare research"
        },

        relations: {
            iron_crown_brigade: { standing: 'war', reason: 'Primary enemy' },
            iron_legion: { standing: 'war', reason: 'Occupying force' },
            mages_guild: { standing: 'friendly', reason: 'Common enemy' },
            onyx_hand: { standing: 'potential', reason: 'Enemy of our enemy...' }
        },

        contracts: [
            {
                id: 'lt_001',
                title: "Supply Run",
                type: 'logistics',
                difficulty: 'medium',
                reward: { gold: 0, reputation: 200, gratitude: 'Immense' },
                deadline: 7,
                description: "Smuggle medical supplies to refugees in the eastern district.",
                requirements: ["Stealth", "Dedication to the cause"],
                status: 'urgent'
            },
            {
                id: 'lt_002',
                title: "Intelligence Gathering",
                type: 'espionage',
                difficulty: 'hard',
                reward: { gold: 0, reputation: 350 },
                deadline: 14,
                description: "Learn the Legion's patrol schedules in the market district.",
                requirements: ["Observation", "Patience"],
                status: 'available'
            }
        ],

        events: [
            { date: "Unknown", title: "Strategy Meeting", description: "Planning next operations" },
            { date: "Day 25", title: "Remembrance", description: "Honoring fallen comrades" }
        ],

        history: [
            { year: '1040 BF', event: 'Movement began forming' },
            { year: '1040 BF', event: 'Party assumes leadership role' },
            { year: '1040 BF', event: 'Vigilance lost to Legion' },
            { year: '1040 BF', event: 'Continued resistance despite setbacks' }
        ],

        rumors: [
            "They're planning to retake the Vigilance...",
            "The party has allies even among the Legion's ranks.",
            "Some say they've contacted the supernatural factions for help."
        ],

        membershipRequirements: {
            species: null,
            skills: ['courage', 'conviction'],
            sponsorship: 'Prove your commitment',
            fee: 'None - we all give what we can'
        },

        isPlayerMember: 'bowser',
        playerRank: 'Council Member',
        playerReputation: 8500
    },
    

    // ===== ARTISAN GUILDS =====

    deephold_smiths: {
        id: 'deephold_smiths',
        name: "Deephold Smithing Guild",
        shortName: "Deephold Smiths",
        motto: "From Stone We Rise, To Stone We Return",
        category: 'artisan',
        icon: '⛏️',
        banner: 'guild_banners/deephold.png',
        founded: '89 BF',
        headquarters: 'Wickermoor Hollow, Druskenvald (forge site unconfirmed)',
        locationStatus: 'unconfirmed',
        
        description: "The legendary dwarven smithing guild, producers of the finest weapons and armor in the known world. Their runic enchantments are unmatched by any magical academy.",
        
        lore: `The Deephold Smithing Guild predates most surface kingdoms. Founded by Smith-King Thordak after the First Forging, they have supplied weapons to armies, adventurers, and kings for nearly a thousand years.

Their Great Forge has burned continuously for nine centuries, fed by volcanic vents deep beneath the Ironroot Mountains. The secrets of dwarven runic smithing are guarded more closely than any nation's military plans.

The Iron Legion's rise troubles the guild deeply. The Legion's 'Gospel of the Cog' ideology views dwarven craft as inefficient compared to standardized machine production. Legion envoys have demanded exclusive contracts—demands the guild has firmly refused.

Individual guild members like hjumpik often travel the surface world, both to practice their craft and to gather intelligence on potential threats to dwarven interests. The guild maintains strict neutrality, but that neutrality is tested when customers threaten dwarven traditions.`,

        leader: {
            name: "Forge-Father Brokkir Ironmantle",
            title: "Forge-Father",
            portrait: "portraits/brokkir.png",
            description: "Master of the legendary hammer Worldshaper. Has personally forged over a hundred legendary weapons in his 340 years."
        },

        officers: [
            { name: "Forge-Mother Helga Emberheart", role: "Production Master", description: "Oversees all guild smithing operations" },
            { name: "Runelord Dorin Stonescript", role: "Keeper of Runes", description: "Guards ancient runic enchantment secrets" },
            { name: "Trade-Thane Grimjaw Shieldbreaker", role: "External Relations", description: "Manages contracts with surface kingdoms" }
        ],

        ranks: [
            { tier: 1, title: "Furnace-Tender", description: "Apprentice maintaining forges", requirements: "Dwarven heritage or exceptional talent", benefits: ["Basic training", "Room and board"], repRequired: 0 },
            { tier: 2, title: "Journeysmith", description: "Traveling craftsman", requirements: "Complete apprenticeship", benefits: ["Guild certification", "Tool allowance"], repRequired: 1000 },
            { tier: 3, title: "Master Smith", description: "Expert craftsman", requirements: "Create masterwork item", benefits: ["Own forge rights", "Apprentice allotment"], repRequired: 3000 },
            { tier: 4, title: "Runesmith", description: "Enchantment specialist", requirements: "Master runic inscription", benefits: ["Rune access", "Artifact commission rights"], repRequired: 6000 },
            { tier: 5, title: "Forge-Father/Mother", description: "Guild leadership", requirements: "Unanimous acclaim of Runesmiths", benefits: ["Worldshaper access", "Guild treasury"], repRequired: 10000 }
        ],

        rules: [
            "A dwarf's word is unbreakable stone",
            "Guild secrets die with the keeper",
            "Never craft shoddy work—reputation is everything",
            "Maintain the Great Forge above all else",
            "Trade fairly with all who pay fairly",
            "The mountain provides, the dwarf endures"
        ],

        resources: {
            treasury: 500000,
            influence: 65,
            manpower: 2000,
            materials: {
                ore: 95,
                gems: 80,
                runic_components: 70,
                masterwork_equipment: 90
            }
        },

        facilities: [
            { name: "The Great Forge", type: "Smithy", description: "Legendary volcanic forge", access: "Furnace-Tender+" },
            { name: "Runehold Archives", type: "Library", description: "Repository of runic knowledge", access: "Master Smith+" },
            { name: "Surface Outposts", type: "Trade", description: "Smithies in major cities", access: "Journeysmith+" },
            { name: "The Deep Mines", type: "Resources", description: "Guild-controlled ore deposits", access: "Master Smith+" }
        ],

        services: [
            { name: "Masterwork Smithing", description: "Commission legendary equipment", priceRange: "500-50,000 gold", discount: { friendly: 10, honored: 25, revered: 40, exalted: 60 } },
            { name: "Runic Enchantment", description: "Ancient dwarven enchantments", priceRange: "1,000-25,000 gold", discount: { friendly: 5, honored: 20, revered: 35, exalted: 55 } },
            { name: "Equipment Repair", description: "Restore damaged gear", priceRange: "50-2,000 gold", discount: { friendly: 15, honored: 30, revered: 45, exalted: 65 } },
            { name: "Ore Refining", description: "Process raw materials", priceRange: "10% of value", discount: { friendly: 10, honored: 20, revered: 30, exalted: 50 } }
        ],

        research_bonus: { 
            category: 'Crafting', 
            amount: 0.35,
            description: "+35% to Smithing, Runic, and Crafting research when allied"
        },

        relations: {
            merchants_consortium: { standing: 'excellent', reason: 'Primary distribution partner' },
            mages_guild: { standing: 'respectful', reason: 'Mutual interest in enchantment' },
            iron_legion: { standing: 'cold', reason: 'Gospel of the Cog threatens dwarven traditions' },
            silver_flame_templars: { standing: 'profitable', reason: 'Holy weapon contracts' },
            thieves_guild: { standing: 'hostile', reason: 'They stole guild secrets once. Once.' }
        },

        contracts: [
            {
                id: 'ds_001',
                title: "Ore Expedition",
                type: 'gathering',
                difficulty: 'medium',
                reward: { gold: 300, reputation: 150, materials: 'Share of ore' },
                deadline: 21,
                description: "Join an expedition to recover rare ores from a collapsed section.",
                requirements: ["Mining skill or combat capability"],
                status: 'available'
            },
            {
                id: 'ds_002',
                title: "Recover Stolen Designs",
                type: 'retrieval',
                difficulty: 'hard',
                reward: { gold: 1000, reputation: 400 },
                deadline: 30,
                description: "Thieves stole runic schematics. Retrieve them—and silence the thieves.",
                requirements: ["Combat capability", "Discretion"],
                status: 'urgent'
            }
        ],

        events: [
            { date: "Day 40", title: "Forge Festival", description: "Annual celebration of smithing excellence" },
            { date: "Day 60", title: "Ancestor's Remembrance", description: "Honoring fallen smiths" }
        ],

        history: [
            { year: '89 BF', event: 'Smith-King Thordak founds the guild' },
            { year: '234 BF', event: 'Great Forge ignited' },
            { year: '567 BF', event: 'Supplied weapons for Dragon Wars' },
            { year: '1035 BF', event: 'Iron Legion demands exclusive contracts—refused' },
            { year: '1040 BF', event: 'hjumpik granted leave to aid surface resistance' }
        ],

        rumors: [
            "The guild is secretly supplying resistance fighters...",
            "Forge-Father Brokkir threw a Legion envoy down a mine shaft.",
            "The Deep Mines connect to tunnels older than the dwarves..."
        ],

        membershipRequirements: {
            species: ['dwarf', 'exceptional others'],
            skills: ['smithing', 'mining'],
            sponsorship: 'Guild member must vouch',
            fee: 'Prove worth through craft'
        },

        isPlayerMember: 'hjumpik',
        playerRank: 'Master Smith',
        playerReputation: 4200
    },

    // ===== MARTIAL GUILDS =====

    silver_flame_templars: {
        id: 'silver_flame_templars',
        name: "Order of the Silver Flame",
        shortName: "Silver Flame",
        motto: "Purge the Darkness",
        category: 'martial',
        icon: '🔥',
        banner: 'guild_banners/silver_flame.png',
        founded: '567 BF',
        headquarters: 'Wickermoor Hollow, Druskenvald (mission house unconfirmed)',
        locationStatus: 'unconfirmed',
        
        description: "A militant religious order dedicated to destroying supernatural evil. Popular among humans in the Midlands, they've become controversial since the Supernatural Sovereignty Act aligned their goals with the Iron Legion.",
        
        lore: `The Order of the Silver Flame was founded during the Dragon Wars, when mortal heroes needed divine aid against draconic devastation. The Silver Flame itself—a pillar of divine fire in Flamekeep—became the symbol of humanity's defiance against supernatural threats.

For centuries, the Order hunted vampires, werewolves, and demons. Their Templars were welcomed in most lands as protectors against the things that lurk in darkness. The Onyx Hand and Moonfang Pack learned to fear the silver-blessed blades.

The Supernatural Sovereignty Act has complicated their reputation. The Order's goals now align with the Iron Legion's, making them uncomfortable allies—or willing collaborators, depending on who you ask. Some Templars embrace the Legion's efficiency; others worry about losing their independence to the military machine.

The current High Inquisitor walks a careful line, accepting Legion support while maintaining the Order's autonomy. Not all Templars agree with this compromise.`,

        leader: {
            name: "High Inquisitor Aldric Dawnblade",
            title: "High Inquisitor",
            portrait: "portraits/dawnblade.png",
            description: "A veteran monster hunter struggling to maintain Order independence while accepting Legion resources."
        },

        officers: [
            { name: "Templar Commander Sera Brightshield", role: "Military Leader", description: "Commands Templar forces in the field" },
            { name: "Keeper of the Flame", role: "Spiritual Head", description: "Maintains the Silver Flame itself" },
            { name: "Grand Inquisitor Vale", role: "Investigation Chief", description: "Leads supernatural threat investigations" }
        ],

        ranks: [
            { tier: 1, title: "Initiate", description: "Training to join the Order", requirements: "Pass trials of faith", benefits: ["Training", "Blessed equipment"], repRequired: 0 },
            { tier: 2, title: "Templar", description: "Full knight of the Order", requirements: "Complete initiation", benefits: ["Silver weapons", "Order support"], repRequired: 1000 },
            { tier: 3, title: "Inquisitor", description: "Supernatural investigator", requirements: "Proven against darkness", benefits: ["Investigation authority", "Advanced training"], repRequired: 3000 },
            { tier: 4, title: "Grand Templar", description: "Elite warrior", requirements: "Exceptional service", benefits: ["Command authority", "Artifact access"], repRequired: 6000 },
            { tier: 5, title: "High Inquisitor", description: "Order leader", requirements: "Election by Grand Templars", benefits: ["Full authority", "Flame communion"], repRequired: 10000 }
        ],

        rules: [
            "Purge supernatural evil wherever found",
            "Protect the innocent from darkness",
            "The Silver Flame guides all actions",
            "Show no mercy to the corrupted",
            "Maintain purity of body and soul",
            "The Order's mission supersedes politics"
        ],

        resources: {
            treasury: 150000,
            influence: 70,
            manpower: 3000,
            materials: {
                silver_weapons: 90,
                holy_relics: 75,
                blessed_armor: 80,
                intelligence: 65
            }
        },

        facilities: [
            { name: "Flamekeep", type: "Headquarters", description: "Fortress-cathedral housing the Silver Flame", access: "Initiate+" },
            { name: "Chapter Houses", type: "Barracks", description: "Order outposts in major cities", access: "Templar+" },
            { name: "The Pyre", type: "Training", description: "Combat and spiritual training grounds", access: "Initiate+" },
            { name: "Inquisition Archives", type: "Intelligence", description: "Records on supernatural threats", access: "Inquisitor+" }
        ],

        services: [
            { name: "Monster Hunting", description: "Professional supernatural elimination", priceRange: "100-5,000 gold", discount: { friendly: 15, honored: 30, revered: 50, exalted: 75 } },
            { name: "Holy Blessing", description: "Bless weapons against supernatural", priceRange: "50-500 gold", discount: { friendly: 20, honored: 40, revered: 60, exalted: 80 } },
            { name: "Exorcism", description: "Remove possession or corruption", priceRange: "200-2,000 gold", discount: { friendly: 10, honored: 25, revered: 45, exalted: 70 } },
            { name: "Protection Detail", description: "Templar bodyguards", priceRange: "100 gold/day", discount: { friendly: 10, honored: 20, revered: 35, exalted: 55 } }
        ],

        research_bonus: { 
            category: 'Divine', 
            amount: 0.25,
            description: "+25% to Divine Magic and Monster Lore research when allied"
        },

        relations: {
            iron_legion: { standing: 'aligned', reason: 'Supernatural Sovereignty Act—shared goals' },
            onyx_hand: { standing: 'war', reason: 'Ancient enemies—vampires must burn' },
            moonfang_pack: { standing: 'war', reason: 'Werewolves are abominations' },
            mages_guild: { standing: 'suspicious', reason: 'Magic borders on the supernatural' },
            celestial_church: { standing: 'allied', reason: 'Shared faith traditions' }
        },

        contracts: [
            {
                id: 'sf_001',
                title: "Vampire Nest Elimination",
                type: 'combat',
                difficulty: 'hard',
                reward: { gold: 800, reputation: 300 },
                deadline: 14,
                description: "A vampire coven has been located. Purge them.",
                requirements: ["Combat capability", "Silver weapons recommended"],
                status: 'available'
            },
            {
                id: 'sf_002',
                title: "Investigate Haunting",
                type: 'investigation',
                difficulty: 'medium',
                reward: { gold: 300, reputation: 150 },
                deadline: 21,
                description: "A village reports supernatural activity. Investigate and resolve.",
                requirements: ["Investigation skills", "Faith"],
                status: 'available'
            }
        ],

        events: [
            { date: "Day 18", title: "Supernatural Sovereignty Act", description: "Order goals align with Legion policy" },
            { date: "Annual", title: "Festival of Flame", description: "Celebration of the Silver Flame" }
        ],

        history: [
            { year: '567 BF', event: 'Order founded during Dragon Wars' },
            { year: '800 BF', event: 'Great Purge against vampire covens' },
            { year: '890 BF', event: 'Aided against the Lich King' },
            { year: '1040 BF', event: 'Supernatural Sovereignty Act—controversial alignment with Legion' }
        ],

        rumors: [
            "Some Templars are uncomfortable with Legion alliance...",
            "The Silver Flame itself has grown dim lately.",
            "Grand Inquisitor Vale may be planning a coup against moderates."
        ],

        membershipRequirements: {
            species: ['human', 'non-supernatural'],
            skills: ['combat', 'faith'],
            sponsorship: 'Temple recommendation',
            fee: 'Vow of service'
        },

        isPlayerMember: null,
        playerRank: null,
        playerReputation: -1500
    },

    freelance_adventurers: {
        id: 'freelance_adventurers',
        name: "Adventurer's League",
        shortName: "Adventurers",
        motto: "Fortune Favors the Bold",
        category: 'martial',
        icon: '⚔️',
        banner: 'guild_banners/adventurers.png',
        founded: '650 BF',
        headquarters: 'Wickermoor Hollow, Druskenvald (lost chapter; other chapters scattered)',
        locationStatus: 'unconfirmed',
        
        description: "A loose confederation of professional adventurers, monster hunters, and sellswords. They maintain neutrality, taking contracts from anyone who pays.",
        
        lore: `The Adventurer's League began as a mutual aid society for traveling warriors, mages, and rogues who made their living taking dangerous jobs. Over centuries, it evolved into a semi-professional organization with chapters in every major city.

Unlike military orders or mercenary companies, the League doesn't deploy units—it certifies individuals. An Adventurer's League badge tells potential employers that the bearer has been vetted, their skills verified, and their reputation tracked.

The League maintains strict political neutrality. A Gold-ranked adventurer might work for the Iron Legion one week and the Liberated Toads the next. This neutrality is protected by the simple fact that everyone needs adventurers—and blacklisting the League means losing access to the realm's most capable problem-solvers.

The current conflict has been a boom time for adventurers. There's never been more work available—or more ways to die.`,

        leader: {
            name: "Guildmaster Helena Stormblade",
            title: "Grand Guildmaster",
            portrait: "portraits/stormblade.png",
            description: "Retired legendary adventurer who killed three dragons. Now manages the League's largest chapter."
        },

        officers: [
            { name: "Registrar Quill", role: "Certification Head", description: "Manages adventurer rankings" },
            { name: "Contract Master Deals", role: "Job Coordinator", description: "Distributes contracts to appropriate adventurers" },
            { name: "Arbiter Fairwind", role: "Dispute Resolution", description: "Handles conflicts between members and clients" }
        ],

        ranks: [
            { tier: 1, title: "Copper", description: "Beginner adventurer", requirements: "Basic combat or magic test", benefits: ["License", "Board access"], repRequired: 0 },
            { tier: 2, title: "Silver", description: "Experienced adventurer", requirements: "Complete 10+ contracts", benefits: ["Better contracts", "Insurance"], repRequired: 1000 },
            { tier: 3, title: "Gold", description: "Professional adventurer", requirements: "Significant achievement", benefits: ["Premium contracts", "Legal protection"], repRequired: 3000 },
            { tier: 4, title: "Platinum", description: "Elite adventurer", requirements: "Legendary deed", benefits: ["Named contracts", "Political immunity"], repRequired: 6000 },
            { tier: 5, title: "Mythril", description: "Living legend", requirements: "Realm-changing accomplishment", benefits: ["Retire wealthy", "Statue in guild hall"], repRequired: 10000 }
        ],

        rules: [
            "Complete your contracts",
            "Don't steal from clients—bad for business",
            "Guild neutrality must be maintained",
            "Help fellow adventurers in genuine distress",
            "Report monster sightings to local chapters",
            "Don't die—it looks bad on your record"
        ],

        resources: {
            treasury: 75000,
            influence: 55,
            manpower: 8000,
            materials: {
                contracts: 90,
                equipment: 60,
                intelligence: 70,
                reputation: 85
            }
        },

        facilities: [
            { name: "Chapter Houses", type: "Headquarters", description: "Guild halls in major cities", access: "Copper+" },
            { name: "Contract Boards", type: "Employment", description: "Job postings sorted by difficulty", access: "Copper+" },
            { name: "Training Grounds", type: "Training", description: "Practice facilities", access: "Copper+" },
            { name: "The Vault", type: "Banking", description: "Secure storage for adventurer loot", access: "Silver+" }
        ],

        services: [
            { name: "Contract Matching", description: "Find work suited to your skills", priceRange: "5% of contract value", discount: { friendly: 10, honored: 25, revered: 40, exalted: 60 } },
            { name: "Party Formation", description: "Find adventuring companions", priceRange: "Free for members", discount: { friendly: 0, honored: 0, revered: 0, exalted: 0 } },
            { name: "Legal Defense", description: "When contracts go wrong", priceRange: "200-2,000 gold", discount: { friendly: 15, honored: 30, revered: 50, exalted: 75 } },
            { name: "Resurrection Services", description: "If you can afford it, death isn't permanent", priceRange: "5,000+ gold", discount: { friendly: 5, honored: 15, revered: 30, exalted: 50 } }
        ],

        research_bonus: { 
            category: 'Monster Lore', 
            amount: 0.20,
            description: "+20% to Monster and Dungeon research when allied"
        },

        relations: {
            merchants_consortium: { standing: 'cooperative', reason: 'Caravan escort contracts' },
            mages_guild: { standing: 'neutral', reason: 'Some overlap in membership' },
            iron_legion: { standing: 'business', reason: 'They pay well' },
            liberated_toads: { standing: 'business', reason: 'They pay... eventually' },
            thieves_guild: { standing: 'rivalry', reason: 'Occasional contract conflicts' }
        },

        contracts: [
            {
                id: 'al_001',
                title: "Clear Monster Nest",
                type: 'combat',
                difficulty: 'medium',
                reward: { gold: 400, reputation: 150 },
                deadline: 14,
                description: "A nest of creatures has formed near a village. Eliminate them.",
                requirements: ["Combat capability"],
                status: 'available'
            },
            {
                id: 'al_002',
                title: "Escort Expedition",
                type: 'escort',
                difficulty: 'hard',
                reward: { gold: 600, reputation: 200 },
                deadline: 21,
                description: "Protect a research team exploring dangerous ruins.",
                requirements: ["Combat capability", "Survival skills"],
                status: 'available'
            }
        ],

        events: [
            { date: "Monthly", title: "Ranking Trials", description: "Test for rank advancement" },
            { date: "Annual", title: "Grand Tournament", description: "Competition between top adventurers" }
        ],

        history: [
            { year: '650 BF', event: 'League founded as mutual aid society' },
            { year: '800 BF', event: 'Ranking system established' },
            { year: '890 BF', event: 'League adventurers crucial in defeating Lich King' },
            { year: '1040 BF', event: 'Record contract volume due to current conflict' }
        ],

        rumors: [
            "Some Platinum-ranked adventurers are secretly working for the resistance.",
            "The League has blacklisted the Iron Legion internally—unofficially.",
            "Guildmaster Stormblade is coming out of retirement for one last job..."
        ],

        membershipRequirements: {
            species: null,
            skills: ['combat or magic or stealth'],
            sponsorship: false,
            fee: '50 gold registration'
        },

        isPlayerMember: null,
        playerRank: 'Gold',
        playerReputation: 3500
    },

    // ===== SHADOW GUILDS =====

    thieves_guild: {
        id: 'thieves_guild',
        name: "The Hollow Lanterns",
        shortName: "Lanterns",
        motto: "What You Don't See Can Hurt You",
        category: 'shadow',
        icon: '🗡️',
        banner: 'guild_banners/shadows.png',
        founded: 'Unknown',
        headquarters: 'Wickermoor Hollow, Druskenvald (rumored)',
        locationStatus: 'rumored',
        
        description: "The organized criminal underworld. Thieves, smugglers, assassins, and information brokers all answer to the Shadow Weavers—or find themselves floating in the harbor.",
        
        lore: `The Shadow Weavers have existed in some form since civilization began accumulating things worth stealing. The current organization emerged from the unification of competing criminal gangs approximately two centuries ago.

They operate on a simple principle: crime is inevitable, so it should be organized. Freelance criminals are bad for business—they draw attention, leave witnesses, and undercut prices. Under the Weavers, crime is professional, predictable, and profitable.

Their services are available to anyone with coin and discretion. Need someone killed? There's a price list. Need something stolen? They have specialists. Need to disappear? They know every hidden route in the realm.

The current conflict has been complicated for the Weavers. The Iron Legion's order and surveillance makes traditional crime harder, but war creates new opportunities in smuggling, espionage, and assassination. The Liberated Toads have proven surprisingly good customers.`,

        leader: {
            name: "The Silence",
            title: "Guildmaster",
            portrait: "portraits/silence.png",
            description: "No one knows their true identity, face, or even species. Commands through intermediaries. May not be a single person."
        },

        officers: [
            { name: "Whisper", role: "Intelligence Director", description: "Runs the information network" },
            { name: "Coin", role: "Financial Operations", description: "Manages guild funds and fencing" },
            { name: "Shade", role: "Enforcement", description: "Deals with those who break guild rules" },
            { name: "Ghost", role: "Assassination Coordinator", description: "Manages contract killings" }
        ],

        ranks: [
            { tier: 1, title: "Finger", description: "Petty criminal under guild protection", requirements: "Pay tribute", benefits: ["Territory rights", "Fence access"], repRequired: 0 },
            { tier: 2, title: "Hand", description: "Full guild thief", requirements: "Successful jobs", benefits: ["Better fencing rates", "Job referrals"], repRequired: 1000 },
            { tier: 3, title: "Shadow", description: "Elite operative", requirements: "Major heist", benefits: ["Premium jobs", "Safe houses"], repRequired: 3000 },
            { tier: 4, title: "Silence", description: "Guild officer", requirements: "Exceptional service", benefits: ["Command authority", "Treasury access"], repRequired: 6000 },
            { tier: 5, title: "The Silence", description: "Guildmaster", requirements: "Unknown", benefits: ["Absolute authority", "True anonymity"], repRequired: 10000 }
        ],

        rules: [
            "Never steal from the guild",
            "Never rat on a fellow member",
            "Pay your tribute on time",
            "Respect territory boundaries",
            "A contract accepted is a contract completed",
            "The guild protects its own—until they become a liability"
        ],

        resources: {
            treasury: 300000,
            influence: 60,
            manpower: 4000,
            materials: {
                safe_houses: 85,
                blackmail: 90,
                smuggling_routes: 80,
                assassins: 65
            }
        },

        facilities: [
            { name: "The Nowhere", type: "Headquarters", description: "Guild command—location unknown", access: "Silence+" },
            { name: "Thieves' Dens", type: "Hideouts", description: "Local guild hideouts", access: "Finger+" },
            { name: "The Black Market", type: "Fencing", description: "Where stolen goods become clean money", access: "Hand+" },
            { name: "Dead Drops", type: "Communication", description: "Secure message points", access: "Shadow+" }
        ],

        services: [
            { name: "Acquisition Services", description: "Professional theft to order", priceRange: "10-50% of item value", discount: { friendly: 5, honored: 15, revered: 30, exalted: 50 } },
            { name: "Smuggling", description: "Move goods past any checkpoint", priceRange: "20% of cargo value", discount: { friendly: 10, honored: 20, revered: 35, exalted: 55 } },
            { name: "Information Brokerage", description: "Secrets for sale", priceRange: "100-10,000 gold", discount: { friendly: 10, honored: 25, revered: 40, exalted: 60 } },
            { name: "Assassination", description: "Permanent problem solving", priceRange: "1,000-50,000 gold", discount: { friendly: 5, honored: 15, revered: 25, exalted: 45 } },
            { name: "Disappearing", description: "New identity, new life", priceRange: "5,000-20,000 gold", discount: { friendly: 10, honored: 20, revered: 35, exalted: 55 } }
        ],

        research_bonus: { 
            category: 'Subterfuge', 
            amount: 0.30,
            description: "+30% to Stealth, Deception, and Espionage research when allied"
        },

        relations: {
            iron_legion: { standing: 'hostile', reason: 'Their order is bad for business' },
            iron_crown_brigade: { standing: 'rivalry', reason: 'Competing intelligence networks' },
            liberated_toads: { standing: 'business', reason: 'Good paying customers lately' },
            merchants_consortium: { standing: 'complicated', reason: 'Competition and corruption' },
            mages_guild: { standing: 'neutral', reason: 'Magic users are useful' }
        },

        contracts: [
            {
                id: 'tw_001',
                title: "Acquire Documents",
                type: 'theft',
                difficulty: 'medium',
                reward: { gold: 500, reputation: 200 },
                deadline: 14,
                description: "Steal specific documents from a merchant's office.",
                requirements: ["Stealth", "Lockpicking"],
                status: 'available'
            },
            {
                id: 'tw_002',
                title: "Eliminate Target",
                type: 'assassination',
                difficulty: 'hard',
                reward: { gold: 2000, reputation: 350 },
                deadline: 21,
                description: "A Legion officer needs to stop breathing. Make it look accidental.",
                requirements: ["Assassination skills", "Discretion"],
                status: 'available'
            }
        ],

        events: [
            { date: "Unknown", title: "Guild Meetings", description: "Location and time vary" },
            { date: "Quarterly", title: "The Accounting", description: "Tribute collection and territory disputes" }
        ],

        history: [
            { year: 'Unknown', event: 'Guild origins lost to history' },
            { year: '200 BF', event: 'Current organization structure established' },
            { year: '955 BF', event: 'Profited from Mushroom Kingdom civil war' },
            { year: '1040 BF', event: 'Major contracts from resistance movements' }
        ],

        rumors: [
            "The Silence is actually three people who rotate...",
            "They have blackmail on every noble in the realm.",
            "Ghost hasn't failed a contract in fifteen years."
        ],

        membershipRequirements: {
            species: null,
            skills: ['stealth', 'crime'],
            sponsorship: 'Guild member must vouch',
            fee: 'Percentage of earnings'
        },

        isPlayerMember: 'archie',
        playerRank: 'Shadow',
        playerReputation: 2500
    },


    // ===== FAITH GUILDS =====

    celestial_church: {
        id: 'celestial_church',
        name: "Church of the Star Spirits",
        shortName: "Star Church",
        motto: "The Stars Guide, The Stars Provide",
        category: 'faith',
        icon: '✨',
        banner: 'guild_banners/star_church.png',
        founded: 'Ancient',
        headquarters: 'Star Haven Temple, Mushroom Kingdom',
        locationStatus: 'seat',
        article: 'star_spirits',
        
        description: "The dominant faith of the Mushroom Kingdom. Followers believe the Star Spirits grant wishes and guide destiny. Provides healing, sanctuary, and moral guidance.",
        
        lore: `The Veneration of the Stars is the oldest organized religion in the Mushroom Kingdom, predating the current royal dynasty. The Star Spirits themselves—Eldstar, Mamar, Skolar, Muskular, Misstar, Klevar, and Kalmar—are said to dwell in Star Haven, granting wishes to the worthy.

The Church operates temples in every major settlement, providing healing to the sick, comfort to the grieving, and moral guidance to all who seek it. Their clerics are trained in divine magic, channeling the power of the stars.

The assassination of Princess Peach in 955 BF devastated the Church—she was considered divinely blessed. The century of civil war that followed tested their faith severely. Many believe the current chaos is a consequence of failing to protect her.

The Iron Legion's invasion has forced the Church into difficult decisions. Some clerics counsel cooperation; others quietly support resistance movements. The Star Spirits themselves have been unusually silent.`,

        leader: {
            name: "High Priestess Celestine",
            title: "Voice of the Stars",
            portrait: "portraits/celestine.png",
            description: "Elderly Toad woman who claims to receive visions from the Star Spirits. Her guidance is sought by commoners and kings alike."
        },

        officers: [
            { name: "Father Luminos", role: "Head of Healing", description: "Oversees all Church medical services" },
            { name: "Sister Starweaver", role: "Head of Prophecy", description: "Interprets Star Spirit messages" },
            { name: "Brother Sanctuary", role: "Temple Defense", description: "Protects Church holdings" }
        ],

        ranks: [
            { tier: 1, title: "Faithful", description: "Regular worshipper", requirements: "Attend services", benefits: ["Blessing", "Community"], repRequired: 0 },
            { tier: 2, title: "Acolyte", description: "Church servant", requirements: "Take vows", benefits: ["Training", "Room and board"], repRequired: 500 },
            { tier: 3, title: "Cleric", description: "Ordained priest", requirements: "Complete training", benefits: ["Divine magic", "Temple assignment"], repRequired: 2000 },
            { tier: 4, title: "High Cleric", description: "Temple leader", requirements: "Years of service", benefits: ["Temple authority", "Artifact access"], repRequired: 5000 },
            { tier: 5, title: "Voice of the Stars", description: "Church leader", requirements: "Star Spirit communion", benefits: ["Divine revelation", "Full authority"], repRequired: 9000 }
        ],

        rules: [
            "Aid all who suffer",
            "Speak truth in the Stars' name",
            "Protect the innocent",
            "Honor the Star Spirits in all actions",
            "Maintain temple sanctity",
            "Hope is the greatest gift"
        ],

        resources: {
            treasury: 80000,
            influence: 75,
            manpower: 2000,
            materials: {
                star_bits: 60,
                healing_supplies: 85,
                sanctuary_space: 90,
                divine_power: 70
            }
        },

        facilities: [
            { name: "Star Haven Temple", type: "Headquarters", description: "Central temple of the faith", access: "Faithful+" },
            { name: "Healing Halls", type: "Medical", description: "Free healing for the faithful", access: "Faithful+" },
            { name: "Sanctuaries", type: "Refuge", description: "Safe haven for the persecuted", access: "Faithful+" },
            { name: "Star Observatories", type: "Divination", description: "Where prophecies are interpreted", access: "Cleric+" }
        ],

        services: [
            { name: "Divine Healing", description: "Magical and mundane medical care", priceRange: "Donation-based", discount: { friendly: 50, honored: 75, revered: 90, exalted: 100 } },
            { name: "Blessing", description: "Star Spirit blessing for endeavors", priceRange: "Donation-based", discount: { friendly: 50, honored: 75, revered: 90, exalted: 100 } },
            { name: "Sanctuary", description: "Protection from persecution", priceRange: "Free for the worthy", discount: { friendly: 100, honored: 100, revered: 100, exalted: 100 } },
            { name: "Last Rites", description: "Funeral services and soul guidance", priceRange: "Donation-based", discount: { friendly: 50, honored: 75, revered: 90, exalted: 100 } }
        ],

        research_bonus: { 
            category: 'Divine', 
            amount: 0.25,
            description: "+25% to Divine Magic and Prophecy research when allied"
        },

        relations: {
            silver_flame_templars: { standing: 'allied', reason: 'Shared faith traditions' },
            iron_legion: { standing: 'wary', reason: 'They demand compliance, not faith' },
            liberated_toads: { standing: 'sympathetic', reason: 'Many faithful among their ranks' },
            mages_guild: { standing: 'neutral', reason: 'Different approaches to the supernatural' },
            onyx_hand: { standing: 'hostile', reason: 'Undead are an abomination to the Stars' }
        },

        contracts: [
            {
                id: 'cc_001',
                title: "Escort Refugees",
                type: 'escort',
                difficulty: 'medium',
                reward: { gold: 0, reputation: 200, blessing: 'Star Spirit Blessing' },
                deadline: 14,
                description: "Help refugees reach Church sanctuary safely.",
                requirements: ["Combat capability", "Compassion"],
                status: 'available'
            }
        ],

        events: [
            { date: "Annual", title: "Star Festival", description: "Celebration honoring the Star Spirits" },
            { date: "New Moon", title: "Night of Wishes", description: "Community wish ceremony" }
        ],

        history: [
            { year: 'Ancient', event: 'Star Spirit worship begins' },
            { year: '400 BF', event: 'Church formally organized' },
            { year: '955 BF', event: 'Princess Peach assassinated—Church devastated' },
            { year: '1040 BF', event: 'Iron Legion invasion tests Church neutrality' }
        ],

        rumors: [
            "The Star Spirits have been silent for months...",
            "High Priestess Celestine is secretly aiding the resistance.",
            "Some say Princess Peach received a final Star Spirit blessing before death."
        ],

        membershipRequirements: {
            species: null,
            skills: ['faith', 'compassion'],
            sponsorship: false,
            fee: 'None—faith is free'
        },

        isPlayerMember: null,
        playerRank: null,
        playerReputation: 2000
    }
};

// Player reputation data (would normally be in state.js)
export const PLAYER_GUILD_DATA = {
    archie: {
        liberated_toads: { reputation: 8000, rank: 'Council Member', joinDate: '1040 BF' },
        thieves_guild: { reputation: 2500, rank: null, joinDate: '1039 BF' },
        mages_guild: { reputation: -2500, rank: null, joinDate: null }, // THEY HATE HIM
        merchants_consortium: { reputation: 10, rank: null, joinDate: '1038 BF' },
        iron_crown_brigade: { reputation: -600, rank: null, joinDate: null },
        freelance_adventurers: { reputation: 350, rank: null, joinDate: null },
        deephold_smiths: { reputation: 500, rank: null, joinDate: null },
        celestial_church: { reputation: 1500, rank: null, joinDate: null },
        silver_flame_templars: { reputation: -1500, rank: null, joinDate: null }
    },
    hjumpik: {
        liberated_toads: { reputation: 7500, rank: 'Council Member', joinDate: '1040 BF' },
        deephold_smiths: { reputation: 4200, rank: 'Master Smith', joinDate: '1010 BF' }, // LONG-TIME MEMBER
        merchants_consortium: { reputation: 800, rank: null, joinDate: null },
        freelance_adventurers: { reputation: 3200, rank: null, joinDate: null },
        mages_guild: { reputation: 200, rank: null, joinDate: null },
        iron_crown_brigade: { reputation: -5000, rank: null, joinDate: null },
        thieves_guild: { reputation: -500, rank: null, joinDate: null },
        celestial_church: { reputation: 1000, rank: null, joinDate: null },
        silver_flame_templars: { reputation: 0, rank: null, joinDate: null }
    },
    markop: {
        liberated_toads: { reputation: 7000, rank: 'Council Member', joinDate: '1040 BF' },
        freelance_adventurers: { reputation: 3000, rank: null, joinDate: null },
        mages_guild: { reputation: -800, rank: null, joinDate: null }, // Association with Archie
        merchants_consortium: { reputation: 500, rank: null, joinDate: null },
        iron_crown_brigade: { reputation: -4500, rank: null, joinDate: null },
        deephold_smiths: { reputation: 400, rank: null, joinDate: null },
        thieves_guild: { reputation: 300, rank: null, joinDate: null },
        celestial_church: { reputation: 800, rank: null, joinDate: null },
        silver_flame_templars: { reputation: 0, rank: null, joinDate: null }
    },
    bowser: {
        liberated_toads: { reputation: 9000, rank: 'Council Member', joinDate: '1040 BF' },
        freelance_adventurers: { reputation: 2000, rank: null, joinDate: null}, // Recent, reputation for... directness
        merchants_consortium: { reputation: -500, rank: null, joinDate: null }, // Burned bridges
        mages_guild: { reputation: -500, rank: null, joinDate: null },
        iron_crown_brigade: { reputation: -10000, rank: null, joinDate: null }, // BLOOD FEUD
        deephold_smiths: { reputation: 1200, rank: null, joinDate: null }, // They respect his firepower
        thieves_guild: { reputation: -2000, rank: null, joinDate: null }, // Too loud for crime
        celestial_church: { reputation: -1000, rank: null, joinDate: null }, // His past
        silver_flame_templars: { reputation: -500, rank: null, joinDate: null }
    },
    remi: {
        liberated_toads: { reputation: 5500, rank: 'Operative', joinDate: '1040 BF' }, // Newer, joined Day 12
        freelance_adventurers: { reputation: 1500, rank: null, joinDate: null },
        merchants_consortium: { reputation: 400, rank: null, joinDate: null },
        mages_guild: { reputation: -200, rank: null, joinDate: null },
        iron_crown_brigade: { reputation: -3000, rank: null, joinDate: null },
        deephold_smiths: { reputation: 200, rank: null, joinDate: null },
        thieves_guild: { reputation: 100, rank: null, joinDate: null },
        celestial_church: { reputation: 500, rank: null, joinDate: null },
        silver_flame_templars: { reputation: 0, rank: null, joinDate: null }
    }
};
export function getReputationTier(reputation) {
    if (reputation >= 10000) return REPUTATION_TIERS.exalted;
    if (reputation >= 6000) return REPUTATION_TIERS.revered;
    if (reputation >= 3000) return REPUTATION_TIERS.honored;
    if (reputation >= 1000) return REPUTATION_TIERS.friendly;
    if (reputation >= 0) return REPUTATION_TIERS.neutral;
    if (reputation >= -1000) return REPUTATION_TIERS.unfriendly;
    if (reputation >= -3000) return REPUTATION_TIERS.hostile;
    return REPUTATION_TIERS.hated;
}

export function getPlayerGuildData(playerKey, guildId) {
    if (!PLAYER_GUILD_DATA[playerKey]) return null;
    return PLAYER_GUILD_DATA[playerKey][guildId] || { reputation: 0, rank: null, joinDate: null };
}

export function getAllPlayerGuilds(playerKey) {
    if (!PLAYER_GUILD_DATA[playerKey]) return [];
    
    const result = [];
    const playerData = PLAYER_GUILD_DATA[playerKey];
    
    Object.entries(playerData).forEach(([guildId, data]) => {
        if (data.rank) {
            const guild = GUILD_DATA[guildId] || CHARTER_DATA[guildId];
            if (guild) {
                result.push({
                    ...guild,
                    playerData: data,
                    reputationTier: getReputationTier(data.reputation)
                });
            }
        }
    });
    
    return result;
}