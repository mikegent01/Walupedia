// wickermoor-contracts.js
// The Ghostlight Board: contracts that all end on the same platform.
//
// Next campaign: the party picks ONE contract. Whatever the job, the ticket is
// for the Ghostlight Express and the line ends in Wickermoor Hollow, a
// province of Druskenvald. The jobs differ on purpose -- the destination is
// the constant. Prose here is in-world and original; nothing is quoted from
// the published module.
//
// Fields
//   guild      id in GUILD_DATA / CHARTER_DATA, or 'independent'
//   status     'open' | 'taken' (taken = already accepted in a filed session)
//   takenBy    article id of whoever took it (only when status is 'taken')
//   links      [{ label, article }] -> Waluipedia #/article/<id>
//   source     event id the contract was filed in (only for canon contracts)

export const WICKERMOOR = {
    name: 'Wickermoor Hollow',
    realm: 'Druskenvald',
    status: 'Not yet visited',
    summary: "A valley province of Druskenvald, a crescent-shaped realm that sits outside the mortal lands. The archive has no filed visit. What it has are tickets, rumours, and a growing pile of guild paperwork that names the same place.",
    route: "The only filed way in is the Ghostlight Express, a spirit-drawn train. Passengers report boarding; nobody has filed a return trip.",
    known: [
        "The moon over the Hollow sits wrong in the sky, and several guilds want it measured, blessed, or sold.",
        "Most guild chapter houses on this registry list the Hollow as their seat. None of those halls has been confirmed by a filing.",
        "The locals are described as superstitious, afraid, and organised around rites the guilds do not understand."
    ],
    unknown: [
        "Which hall, street, or farm each guild actually works from",
        "Whether anyone the guilds sent ahead is still answering letters",
        "What the Hollow wants from the people who arrive"
    ]
};

export const GHOSTLIGHT_TICKET = 'Ghostlight Express · one way · Wickermoor Hollow';

export const GHOSTLIGHT_CONTRACTS = [
    {
        id: 'gl_crooked_tree',
        guild: 'independent',
        sponsor: 'An independent researcher in the Slump',
        icon: '🌳',
        title: 'Samples from the Crooked Tree',
        kind: 'Research',
        difficulty: 'medium',
        reward: { gold: 150, extra: 'Train tickets paid for' },
        pitch: "Collect biological data from the Crooked Tree and bring it back intact. The map is marked; the fare is covered.",
        hook: "The researcher's map names Yal Belanor and Ironhold. The ticket he offered names the train.",
        status: 'taken',
        takenBy: 'bones',
        source: 'the_blackout_the_waves_and_the_crooked_tree',
        links: [
            { label: 'Bones', article: 'bones' },
            { label: 'Filed: the Crooked Tree assignment', article: 'the_blackout_the_waves_and_the_crooked_tree' }
        ]
    },
    {
        id: 'gl_lunar_parallax',
        guild: 'mages_guild',
        icon: '🌙',
        title: 'Lunar Parallax',
        kind: 'Survey',
        difficulty: 'hard',
        reward: { gold: 900, reputation: 250 },
        pitch: "Take three readings of the moon from three points in the Hollow and send them back by the next train.",
        hook: "Every reading the Guild has received disagrees with the last one by more than the instruments allow.",
        status: 'open',
        links: [{ label: "Mages' Guild", article: 'mages_guild' }]
    },
    {
        id: 'gl_refugee_manifest',
        guild: 'liberated_toads',
        icon: '🍄',
        title: 'Check the Manifest',
        kind: 'Search',
        difficulty: 'medium',
        reward: { reputation: 300, extra: 'Council favour' },
        pitch: "Some Toads who fled the fighting bought one-way tickets. The council wants every name on the passenger list checked against the living.",
        hook: "Rodger and Toad Lee are still unlocated. Nobody says the train took them; the council wants it ruled out.",
        status: 'open',
        links: [
            { label: 'Liberated Toads', article: 'liberated_toads' },
            { label: 'Rodger', article: 'rodger' }
        ]
    },
    {
        id: 'gl_leaning_stones',
        guild: 'stonecarvers_brethren',
        icon: '🪨',
        title: 'The Leaning Stones',
        kind: 'Survey',
        difficulty: 'medium',
        reward: { gold: 600, reputation: 150 },
        pitch: "Map the standing stones around the chapter's claimed quarry and mark which ones have moved since the last survey.",
        hook: "The last surveyor's drawings show the same stone in four places.",
        status: 'open',
        links: []
    },
    {
        id: 'gl_harvest_ledger',
        guild: 'merchants_consortium',
        icon: '💰',
        title: 'The Harvest Ledger',
        kind: 'Collection',
        difficulty: 'easy',
        reward: { gold: 400, reputation: 100 },
        pitch: "A Hollow market owes the Consortium three seasons of tithe. Collect it, in coin if possible.",
        hook: "The market has offered to pay. It has not said in what.",
        status: 'open',
        links: []
    },
    {
        id: 'gl_dead_letter',
        guild: 'shadow_weavers',
        icon: '✉️',
        title: 'Postmarked Nowhere',
        kind: 'Delivery',
        difficulty: 'medium',
        reward: { gold: 500, reputation: 120 },
        pitch: "Hand-deliver one sealed letter to a named resident of the Hollow. Do not open it.",
        hook: "The Weavers' own records list the recipient as buried. The letter is a reply.",
        status: 'open',
        links: []
    },
    {
        id: 'gl_cold_iron',
        guild: 'deephold_smiths',
        icon: '⚒️',
        title: 'The Forge That Stayed Lit',
        kind: 'Retrieval',
        difficulty: 'hard',
        reward: { gold: 800, reputation: 200, extra: 'First pick of the iron' },
        pitch: "Bring back a cart of iron from a Hollow forge that the Smiths abandoned. Its fire was never put out.",
        hook: "Nobody has fed that fire in years. Someone has.",
        status: 'open',
        links: []
    },
    {
        id: 'gl_lantern_census',
        guild: 'silver_flame_templars',
        icon: '🕯️',
        title: 'Lantern Census',
        kind: 'Investigation',
        difficulty: 'hard',
        reward: { gold: 700, reputation: 250 },
        pitch: "Ride the line, count the passengers who board and the passengers who step off, and report the difference.",
        hook: "The Order's last two census-takers sent back the same number. It was not a small one.",
        status: 'open',
        links: []
    },
    {
        id: 'gl_lost_chapter',
        guild: 'freelance_adventurers',
        icon: '🗺️',
        title: 'The Lost Chapter',
        kind: 'Expedition',
        difficulty: 'medium',
        reward: { gold: 550, reputation: 150, extra: 'Founding membership' },
        pitch: "The League's Wickermoor chapter stopped posting jobs. Find its board, reopen it, and take the first contract pinned there.",
        hook: "The last posting on the board was for help.",
        status: 'open',
        links: []
    },
    {
        id: 'gl_falling_light',
        guild: 'celestial_church',
        icon: '✨',
        title: 'The Light That Fell Toward the Hollow',
        kind: 'Pilgrimage',
        difficulty: 'expert',
        reward: { reputation: 400, extra: 'A blessing from Star Haven' },
        pitch: "Follow a falling light to where it lands and learn whether it belongs to a Star Spirit.",
        hook: "Star Haven saw it fall. The almanacs say it has not landed yet.",
        status: 'open',
        links: [{ label: 'Star Spirits', article: 'star_spirits' }]
    },
    {
        id: 'gl_lantern_run',
        guild: 'thieves_guild',
        icon: '🏮',
        title: 'Lantern Run',
        kind: 'Smuggling',
        difficulty: 'medium',
        reward: { gold: 650, reputation: 120 },
        pitch: "Carry one locked crate on the Ghostlight and leave it on the platform at the Hollow. Somebody will collect it.",
        hook: "The crate is warm, and the Lanterns will not say who is paying.",
        status: 'open',
        links: []
    }
];
