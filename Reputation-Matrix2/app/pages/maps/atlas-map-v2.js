// Atlas Map v3 — keep every existing POI x/y (percent of the painted artwork).
// Pins sit on the letterboxed image, not the empty stage. Region sheets crop
// to their POI hull; province overlays tile the visible sheet. Wiki articles
// open from the sidebar when an articleId is filed.
import { MAP_DATA } from '../../../data/maps/map-data.js';
import { getFaction, getFactionColor } from '../../../systems/faction-registry.js';
import { hashColor, initial, isSafeLogo, topCats, legendChips } from './map-lenses.js';
import { typeColor, typeLabel, familiesPresent } from './map-poi-types.js';
import { buildProvinceCensus, shortlist as rankShortlist, uniquePins } from './map-provinces.js';
import { buildProvinceOutlines, polylineD, ringsD } from './map-province-arcs.js';
import { PROVINCE_POLITICS } from '../../../data/support/politics-data.js';
import { buildTransportForMap, TRANSPORT_MODES, ROUTE_CAPACITY } from '../../../data/maps/map-routes.js';
import { networkFromRoutes, routeSvgD, transitRouteDossierHtml } from './map-transit.js';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const format = value => Math.round(value || 0).toLocaleString();
const humanize = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const WIKI_IDS = {
  poi_mk_castle: 'peachs_castle',
  poi_mk_toadtown: 'toad_town',
  poi_mk_bramblehaven: 'bramblehaven',
  poi_mk_fawful_lab: 'fawful_fortress',
  poi_mp_warp_pipe_junction: 'warp_pipe_junction',
};

/* ---------------- location records ----------------
   Every POI that files an articleId points at a record in locations.json,
   and those records now carry painted plates. The atlas used to ignore the
   file entirely, so a pin could only ever show the POI's own one-line
   description -- the art, the canon summary, the region and the controlling
   faction were all sitting unused one lookup away.

   Fetched once, lazily, and cached. A failure here must never break the map:
   LOC_BY_ID stays empty and every consumer falls back to POI fields, which
   is exactly the behaviour before this existed. */
let LOC_BY_ID = new Map();
let locLoadPromise = null;

function locationsHref() {
  return new URL('../../../data/locations.json', import.meta.url).href;
}

export function loadLocationRecords() {
  if (locLoadPromise) return locLoadPromise;
  locLoadPromise = fetch(locationsHref())
    .then(r => (r.ok ? r.json() : []))
    .then(rows => {
      const list = Array.isArray(rows) ? rows : Object.values(rows || {});
      const map = new Map();
      list.forEach(rec => {
        if (!rec || typeof rec !== 'object' || !rec.id) return;
        map.set(rec.id, rec);
        /* Merged duplicates keep their old id in `aliases`, so links and POI
           articleId lists written before the merge still resolve. */
        (rec.aliases || []).forEach(alias => { if (!map.has(alias)) map.set(alias, rec); });
      });
      LOC_BY_ID = map;
      return map;
    })
    .catch(() => LOC_BY_ID);
  return locLoadPromise;
}

/* A POI may file articleId as a string or as a list of candidate ids. */
function locationRecord(poi) {
  if (!poi || !LOC_BY_ID.size) return null;
  const raw = poi.articleId || poi.locationId || WIKI_IDS[poi.id];
  const candidates = Array.isArray(raw) ? raw : [raw];
  for (const id of candidates) {
    if (id && LOC_BY_ID.has(id)) return LOC_BY_ID.get(id);
  }
  return null;
}

function locationImageHref(rec) {
  if (!rec || !rec.image) return '';
  const src = String(rec.image);
  /* Records may file an absolute URL or a path relative to Reputation-Matrix2. */
  if (/^https?:\/\//i.test(src)) return src;
  return new URL(`../../../${src}`, import.meta.url).href;
}

/* ---------------- archetype art ----------------
   Only 29 of ~500 pins link to a location record, so record art alone leaves
   the overwhelming majority of panels with no image at all. The pins do,
   however, all file a `type`, and 50 types cover every pin on every sheet.

   So each of the most common types gets one painted archetype plate: a
   generic village, a generic ruin, a generic lair. It is explicitly NOT a
   portrait of that specific place -- it is scene-setting for a pin that has
   no filed art, and it is captioned as such so nobody mistakes it for canon.
   The top 18 types cover roughly 69% of unlinked pins for 2 generations.

   Filed record art always wins; this is only ever the fallback. */
const TYPE_ART = new Set([
  'landmark', 'ruins', 'village', 'lair', 'outpost', 'fortress', 'shrine',
  'cosmic_anomaly', 'haunted_place', 'workshop', 'port', 'mountain_pass',
  'forest', 'dungeon_entrance', 'ley_line', 'market', 'shipwreck',
  'cave_entrance', 'battlefield', 'mine', 'farm', 'barracks', 'watchtower',
  'capital_city', 'waterfall', 'swamp', 'portal',
]);

/* Types with no plate of their own borrow a close relative rather than
   showing nothing. Kept deliberately small and obvious -- a town reads as a
   village, a castle as a fortress. Anything genuinely unlike the set (a
   black hole, a crystal entity) is left imageless on purpose. */
const TYPE_ALIASES = {
  town: 'village', hamlet: 'village', major_city: 'capital_city',
  district: 'capital_city', castle: 'fortress', siege_camp: 'barracks',
  bandit_camp: 'outpost', ambush: 'outpost', prison: 'fortress',
  tower: 'watchtower', mages_tower: 'watchtower', observatory: 'watchtower',
  temple: 'shrine', monastery: 'shrine', graveyard: 'haunted_place',
  quarry: 'mine', trade_post: 'market', inn: 'market', resource: 'farm',
  river: 'waterfall', oasis: 'waterfall', volcano: 'mountain_pass',
  ancient_circle: 'ley_line', academy: 'workshop', library: 'workshop',
};

function typeArtHref(poi) {
  const raw = String((poi && poi.type) || '').toLowerCase();
  const t = TYPE_ART.has(raw) ? raw : TYPE_ALIASES[raw];
  if (!t || !TYPE_ART.has(t)) return '';
  return new URL(`../../../assets/images/poi-types/${t}.jpg`, import.meta.url).href;
}

/* Stat lenses: each mode tints its buttons AND its pins, so Population, */
/* Military, Economy, and Influence read as four different maps. Faction  */
/* identity moves to the detail panel, where it was always listed anyway. */
const MODES = {
  population: { label: 'Population', key: 'population', color: '#4ade80', unit: 'residents' },
  military: { label: 'Military', key: 'military_strength', color: '#f87171', unit: 'garrison' },
  economy: { label: 'Economy', key: 'economic_value', color: '#fbbf24', unit: 'trade value' },
  influence: { label: 'Influence', key: 'political_influence', color: '#a78bfa', unit: 'influence' },
};

/* Each stat lens has its own dot SHAPE as well as its own colour, so the mode
   can be read off the map without the legend: population is a disc, military a
   diamond, economy a hollow ring, influence a dot with a halo. Size follows the
   value on every one of them. Shapes are pure CSS (no clip-path), so the hover
   and selection outlines still work. */
const LENS_SHAPE = { population: 'disc', military: 'diamond', economy: 'ring', influence: 'halo' };
const SHAPE_GLYPH = { disc: '●', diamond: '◆', ring: '◯', halo: '◉' };

/* Planar layers (cartography desk): a POI's `plane` tag decides which layer
   shows it. Absent = material, so older sheets need no edits. */
const PLANE_LABELS = {
  material: 'Material',
  shadow: 'Shadeward',
  fey: 'Feyward',
  mirror: 'Deep Mirror',
};
const planeOf = poi => (poi && poi.plane) || 'material';

/* Intel clearance. `intelReq` is filed either as a bare number or as
   { faction, level }; both are read, and anything unparseable is 0 (open)
   rather than a thrown error. */
function intelLevel(poi) {
  const req = poi && poi.intelReq;
  if (req === undefined || req === null || req === '') return 0;
  const n = (typeof req === 'object') ? Number(req.level) : Number(req);
  return Number.isFinite(n) ? n : 0;
}
function intelFaction(poi) {
  const req = poi && poi.intelReq;
  return (req && typeof req === 'object' && req.faction) ? req.faction : '';
}
/* Bands, low to high. A reader remembers four tiers; they cannot remember 90
   distinct clearance numbers. */
const INTEL_BANDS = [
  { key: 'low', max: 19, label: 'Clearance 1-19 · routine', color: '#a3e635', icon: '·' },
  { key: 'mid', max: 39, label: 'Clearance 20-39 · restricted', color: '#fbbf24', icon: ':' },
  { key: 'high', max: 59, label: 'Clearance 40-59 · secret', color: '#fb923c', icon: '∷' },
  { key: 'top', max: Infinity, label: 'Clearance 60+ · black', color: '#ef4444', icon: '▲' },
];

/* Chatter overlay (Wah Notes map mode): set fresh on every mount, read by
   detailHtml. One map is ever mounted at a time, so module scope is safe. */
let ACTIVE_CHATTER = null;
/* One keyboard owner per page, for the same reason: a re-mount replaces the
   renderer inside the same host, and stale arrow-key listeners would fight. */
let BOARD_KEYS = null;
let ACTIVE_CENSUS = null;

function wikiId(poi) {
  return poi.articleId || poi.locationId || WIKI_IDS[poi.id] || null;
}

function factionMeta(factionId) {
  /* Names, colors, and logos resolve through the faction registry — the same
     authority the demographics panel uses — so pins, legend, and detail all
     agree. Unfiled flags fall back to a grey dot, never a thrown error. */
  if (!factionId) return { id: '', name: 'Unaligned', color: '#7c8aa5', icon: '●', logo: '' };
  let name = '', color = '', logo = '';
  try { const f = getFaction(factionId); if (f) { name = f.name || ''; logo = isSafeLogo(f.logo) ? f.logo : ''; } } catch {}
  try { color = getFactionColor(factionId) || ''; } catch {}
  return { id: factionId, name: name || humanize(factionId), color: color || '#7c8aa5', icon: '●', logo };
}

function factionLogoHref(logo) {
  return logo ? new URL(`../../../${logo}`, import.meta.url).href : '';
}

function containBox(stage, img) {
  const sw = stage.clientWidth || 1;
  const sh = stage.clientHeight || 1;
  const nw = img.naturalWidth || sw;
  const nh = img.naturalHeight || sh;
  const scale = Math.min(sw / nw, sh / nh);
  const w = nw * scale;
  const h = nh * scale;
  return { left: (sw - w) / 2, top: (sh - h) / 2, w, h };
}

function defaultPinScore(poi) {
  if (!poi) return 0;
  return (Number(poi.political_influence) || 0) * 3
    + (Number(poi.military_strength) || 0) * 2
    + (Number(poi.economic_value) || 0)
    + Math.log10(Math.max(1, Number(poi.population) || 1));
}

function clusterPois(pois, radius = 1.15, opts = {}) {
  const list = (pois || []).filter(Boolean);
  if (!list.length) return [];
  if (radius <= 0.05) {
    return list.map(poi => { const group = [poi]; group.x = Number(poi.x) || 0; group.y = Number(poi.y) || 0; return group; });
  }
  const score = typeof opts.score === 'function' ? opts.score : defaultPinScore;
  const maxSize = Math.max(2, Number(opts.maxSize) || 80);
  const clusters = [];
  list.slice()
    .sort((a, b) => (score(b) - score(a)) || String(a.id || '').localeCompare(String(b.id || '')))
    .forEach(poi => {
      const x = Number(poi.x) || 0, y = Number(poi.y) || 0;
      let best = null, bestD = Infinity;
      clusters.forEach(group => {
        if (group.length >= maxSize) return;
        const d = Math.hypot(x - group.x, y - group.y);
        if (d <= radius && d < bestD) { best = group; bestD = d; }
      });
      if (!best) {
        const group = [poi];
        group.x = x;
        group.y = y;
        group.power = 1 + Math.max(0, score(poi));
        clusters.push(group);
        return;
      }
      const w = 1 + Math.max(0, score(poi));
      const total = (best.power || best.length) + w;
      best.x = ((best.x || 0) * (best.power || best.length) + x * w) / total;
      best.y = ((best.y || 0) * (best.power || best.length) + y * w) / total;
      best.power = total;
      best.push(poi);
    });
  return clusters;
}

/* A marker is drawn in PIXELS (18px base, up to ~50px for a big cluster) but
   the cluster radius is measured in map-PERCENT. Those two only agree at one
   particular viewport size and zoom, which is why dense sheets still drew a
   pile: on the Midlands at rest the old radius left 29 markers stacked around
   the Capital Province with 86 overlapping pairs.
   So the radius is derived from the marker footprint instead. boxW/boxH are
   the rendered art size in CSS px; dividing the footprint by them converts a
   pixel gap into the percent gap the clusterer actually uses, and dividing by
   the zoom lets groups unroll as the reader pushes in. */
/* Sized to the DOT, not to the old badge markers: a lone pin draws at 4-6px
   with a ~15px transparent hit pad, so two dots are distinct and clickable far
   closer together than two 34px discs ever were. Gathering only has to start
   where the hit targets would fight. */
const MARKER_FOOTPRINT_PX = 15;

/* ---------------- deep zoom ----------------
   The sheet zooms like a real atlas rather than a picture: all the way down,
   until two provinces that touch on the continent view are a long drag apart.
   This is the actual cure for crowding. Clutter is not a property of the map,
   it is a property of the SCALE you read it at — a hundred pins inside one
   province is a pile at 1x and a comfortable scatter at 30x, because at 30x
   that province is the whole screen.
   Two things have to hold for that to work, and only the first was true here:
     1. the artwork grows with the zoom (it already did), and
     2. the MARKERS DO NOT. A pin that grows with the world keeps the same
        neighbours at every depth, so zooming magnified the crowding instead
        of relieving it. Pins are now counter-scaled against the zoom (see
        --pin-zoom), so they hold their size on screen while the ground slides
        apart underneath them. */
const MAX_ZOOM = 160;
const MIN_ZOOM = 1;

/* Name the depth in the reader's terms. "12.4x" is a number; "street" is a
   place. The thresholds are eyeballed against the Midlands sheet, where the
   whole continent is ~100 percent across and a town occupies about one. */
function scaleWord(zoom) {
  const z = Number(zoom) || 1;
  if (z < 1.6) return 'continent';
  if (z < 4) return 'kingdom';
  if (z < 10) return 'province';
  if (z < 26) return 'district';
  if (z < 65) return 'town';
  return 'street';
}

function dynamicClusterRadius(count, scale, plane, journeyOnly, densityMode, box, forceGather) {
  if (journeyOnly || densityMode === 'all') return plane ? 0.18 : 0.05;
  if (densityMode === 'key') return 0.05;
  /* A sparse sheet is legible as-is; gathering there only hides detail.
     Scoped views (drill-down) opt out via `forceGather`, because there the
     small count is the RESULT of zooming in, not evidence the sheet is quiet. */
  if (count <= 60 && !forceGather) return plane ? 0.18 : 0.05;

  const zoom = Math.max(0.35, Number(scale) || 1);
  const boxW = Math.max(1, Number(box && box.w) || 900);
  const boxH = Math.max(1, Number(box && box.h) || boxW * 0.62);

  /* Percent-of-sheet occupied by one marker, on the tighter axis, at this
     zoom. Two markers closer than this cannot both be read. */
  const footprint = MARKER_FOOTPRINT_PX / Math.min(boxW, boxH) * 100 / zoom;

  /* Crowding still matters: a sheet with 500 pins needs to gather harder than
     the footprint alone demands, or the reader gets a uniform carpet. */
  const pressure = Math.min(1, Math.max(0, (count - 60) / 520));
  const crowd = 1 + pressure * 1.35;

  /* A cluster marker grows with its membership (up to ~50px vs the 18px base),
     so the gathered group is drawn WIDER than the footprint that gathered it.
     Allow for that or the biggest groups still touch their neighbours. */
  const clusterGrowth = 1 + Math.min(0.55, pressure * 0.75);

  const radius = footprint * crowd * clusterGrowth;
  /* Ceiling keeps a dense sheet from collapsing into a handful of blobs;
     floor keeps a sparse one from gathering at all. */
  return Math.max(0.18, Math.min(radius, 8));
}

/* Clustering is OFF by default and 'all' leads the cycle. Gathering pins into
   fat badges buried the province plots underneath them and made the map
   genuinely hard to click — a marker that hides the thing you were aiming at
   is worse than a crowded sheet. Every location draws as its own dot; 'key'
   thins the sheet by importance if the reader wants that, and clustering is
   available but no longer the default anyone lands on. */
const PIN_DENSITY_ORDER = ['auto', 'all', 'key', 'smart'];
/* Auto is the default: while a crowded sheet is read from far away only the
   key pins draw, because a hundred dots at continent scale cannot be told apart
   or clicked; once the reader pushes in (or the sheet is sparse) every pin
   draws. Thresholds mirror the clusterer's own "sparse sheet" line. */
const AUTO_KEY_MIN_PINS = 60;
const AUTO_KEY_BELOW_ZOOM = 4;
const PIN_DENSITY = {
  auto: { label: '◐ Auto', hint: 'key locations while crowded and zoomed out, every pin once you zoom in' },
  all: { label: '• All POIs', hint: 'every location, one dot each' },
  key: { label: '◆ Key only', hint: 'seats, articles, top pins' },
  smart: { label: '✨ Cluster', hint: 'auto-clustered' },
};

function settlementInsetKind(stack) {
  const types = new Set((stack || []).map(p => String((p && p.type) || '').toLowerCase()));
  if ([...types].some(t => /capital|major_city|city|district/.test(t))) return { label: 'City inset', icon: '🏙️' };
  if ([...types].some(t => /town|port|market|guild|academy|hospital|library/.test(t))) return { label: 'Town inset', icon: '🏘️' };
  if ([...types].some(t => /village|farm|outpost|camp|shrine/.test(t))) return { label: 'Village inset', icon: '🏡' };
  return { label: 'Local inset', icon: '🔎' };
}

function localInsetPositions(stack, cx, cy) {
  const items = (stack || []).filter(Boolean);
  if (!items.length) return [];
  const xs = items.map(p => Number(p.x) || 0);
  const ys = items.map(p => Number(p.y) || 0);
  const span = Math.max(0.35, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const used = [];
  const clamp = v => Math.max(8, Math.min(92, v));
  return items.map((poi, i) => {
    let x = 50 + (((Number(poi.x) || 0) - cx) / span) * 72;
    let y = 50 + (((Number(poi.y) || 0) - cy) / span) * 72;
    const collides = () => used.some(pt => Math.hypot(x - pt.x, y - pt.y) < 13);
    if (span < 0.9 || collides()) {
      const ring = 19 + Math.floor(i / 8) * 13;
      const angle = (-Math.PI / 2) + (Math.PI * 2 * (i % Math.max(3, Math.min(8, items.length))) / Math.max(3, Math.min(8, items.length)));
      x += Math.cos(angle) * ring;
      y += Math.sin(angle) * ring;
      if (collides()) {
        x += Math.cos(angle + Math.PI / 5) * 9;
        y += Math.sin(angle + Math.PI / 5) * 9;
      }
    }
    x = clamp(x); y = clamp(y);
    used.push({ x, y });
    return { poi, x, y };
  });
}

function model(mapId, plane, onlyIds) {
  const map = MAP_DATA[mapId];
  if (!map) return null;
  /* One filed id is one place: a record listed twice would otherwise render as
     a stack of pins, double-count the census, and be shortlisted twice. */
  let pois = uniquePins((map.pointsOfInterest || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  if (plane && plane !== 'all') pois = pois.filter(p => planeOf(p) === plane);
  /* Journey mode: hide every surveyed pin except the stops that connect. */
  if (onlyIds) pois = pois.filter(p => onlyIds.has(p.id));
  pois = spreadCoincident(pois);
  return { map, pois, population: pois.reduce((n, poi) => n + (Number(poi.population) || 0), 0) };
}

/* Deep zoom separates everything EXCEPT pins filed at the identical
   coordinate: those stay welded together at 1x and at 160x alike, because no
   magnification can divide a distance of zero. (On the Midlands sheet that is
   Veridia Estate and the Forgotten Barrow, both filed at the same point.)
   Nudge such a stack onto a tiny ring around its shared point — small enough
   to be invisible at continent scale and a lie about nothing, big enough that
   pushing in eventually pulls them apart like every other pair. */
function spreadCoincident(list) {
  const buckets = new Map();
  list.forEach(p => {
    const key = `${p.x.toFixed(3)}:${p.y.toFixed(3)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  });
  const moved = new Map();
  buckets.forEach(group => {
    if (group.length < 2) return;
    /* 0.05% of the sheet: under a tenth of a pixel at rest, a comfortable gap
       by the time the reader is at town scale. */
    const r = 0.05;
    group.forEach((p, i) => {
      const a = (i / group.length) * Math.PI * 2;
      moved.set(p.id, { ...p, x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
    });
  });
  return moved.size ? list.map(p => moved.get(p.id) || p) : list;
}

function stopBannerHtml(stop) {
  if (!stop) return '';
  const plane = PLANE_LABELS[stop.plane] || PLANE_LABELS.material;
  return `<div class="atlas-v2-stopbanner"><span class="atlas-v2-stopnum">${esc(stop.n)}</span>`
    + `<div><span class="atlas-v2-kicker">journey stop ${esc(stop.n)} · ${esc(plane)} layer</span>`
    + `<h3>${esc(stop.name)}</h3><p>${esc(stop.date || 'undated')}</p>`
    + (stop.eventId ? `<button class="atlas-v2-wiki" data-open-article="${esc(stop.eventId)}">Open event record</button>` : '')
    + `</div></div>`;
}

function detailHtml(poi, pois) {
  if (!poi) {
    return `<div class="atlas-v2-empty"><span>◎</span><b>Select a location</b><p>Pins sit on the painted map. Scroll to zoom. Drag to pan. Region sheets start cropped to their POI hull so a plains sheet does not look like the whole kingdom.</p></div>`;
  }
  const faction = factionMeta(poi.factionId);
  const nearby = pois.filter(other => other.id !== poi.id)
    .map(other => ({ other, d: Math.hypot((other.x || 0) - (poi.x || 0), (other.y || 0) - (poi.y || 0)) }))
    .filter(x => x.d < 12).sort((a, b) => a.d - b.d).slice(0, 5);
  const article = wikiId(poi);
  /* Filed extras surface only where the POI record files them: unrest and */
  /* antiquity are /10 ratings, intelReq is a clearance number or a        */
  /* {faction, level} posting, and library_summary is the archive note.    */
  const extras = [];
  if (Number.isFinite(poi.crime_rate)) extras.push(['Unrest', `${poi.crime_rate}/10`]);
  if (Number.isFinite(poi.age_of_antiquity)) extras.push(['Antiquity', `${poi.age_of_antiquity}/10`]);
  if (poi.intelReq !== undefined && poi.intelReq !== null && poi.intelReq !== '') {
    const req = poi.intelReq;
    const reqText = (req && typeof req === 'object')
      ? `clearance ${req.level ?? '?'}${req.faction ? ` · ${humanize(req.faction)}` : ''}`
      : `clearance ${req}`;
    extras.push(['Intel req.', esc(reqText)]);
  }
  const planeTag = planeOf(poi) === 'material' ? '' : ` · ${PLANE_LABELS[planeOf(poi)] || planeOf(poi)}`;
  const chatter = (ACTIVE_CHATTER && ACTIVE_CHATTER.remarks && ACTIVE_CHATTER.remarks[poi.id]) || [];
  const chatterHtml = chatter.length ? `<div class="atlas-v2-chatter"><b>✍️ Wah Notes here</b>${chatter.map(r => `<p><b>${esc(r.icon)} ${esc(r.author)}</b> — ${esc(r.text)}${r.recordId ? ` <button class="atlas-v2-wiki" data-open-article="${esc(r.recordId)}">record</button>` : ''}</p>`).join('')}</div>` : '';
  const spTop = ACTIVE_CENSUS && ACTIVE_CENSUS.species.top[poi.id];
  const faTop = ACTIVE_CENSUS && ACTIVE_CENSUS.faiths.top[poi.id];
  const cuTop = ACTIVE_CENSUS && ACTIVE_CENSUS.cultures && ACTIVE_CENSUS.cultures.top[poi.id];
  const censusHtml = (spTop || faTop || cuTop) ? `<div class="atlas-v2-chatter"><b>📊 Filed census</b>${spTop ? `<p>🧬 ${esc(spTop.list.join(' · '))}</p>` : ''}${faTop ? `<p>🛐 ${esc(faTop.list.join(' · '))}</p>` : ''}${cuTop ? `<p>🏛️ ${esc(cuTop.list.join(' · '))}</p>` : ''}</div>` : '';
  const factionMark = faction.logo
    ? `<span class="atlas-v2-factionmark"><i style="background:${esc(faction.color)}"></i><img src="${esc(factionLogoHref(faction.logo))}" alt="" loading="lazy"></span>`
    : `<i style="background:${esc(faction.color)}"></i>`;
  /* The filed location record, when the POI links to one, supplies the
     painted plate and the canon prose. The POI's own description stays as
     the fallback so unlinked pins are unchanged. */
  const rec = locationRecord(poi);
  /* Filed art for this exact place wins. Failing that, the archetype plate
     for the pin's type dresses the panel -- flagged as a type illustration,
     never captioned as if it were a picture of this location. */
  const filed = locationImageHref(rec);
  const plate = filed || typeArtHref(poi);
  const isArchetype = !filed && !!plate;
  const caption = isArchetype
    ? `${esc(typeLabel(poi.type) || humanize(poi.type))} · archetype`
    : esc((rec && rec.name) || poi.name);
  const plateHtml = plate
    ? `<figure class="atlas-v2-plate${isArchetype ? ' is-archetype' : ''}">`
      + `<img src="${esc(plate)}" alt="" loading="lazy"`
      + ` onerror="this.closest('.atlas-v2-plate').remove()">`
      + `<figcaption>${caption}</figcaption>`
      + `</figure>`
    : '';
  const blurb = (rec && rec.summary) || poi.description || 'No field report filed.';
  const regionLine = rec && rec.region
    ? `<p class="atlas-v2-region">📍 ${esc(rec.region)}</p>` : '';
  const statusLine = rec && rec.status
    ? `<p class="atlas-v2-status">${esc(rec.status)}</p>` : '';

  return `<article class="atlas-v2-detail">
    ${plateHtml}
    <span class="atlas-v2-kicker">${esc(poi.type || 'location')}${esc(planeTag)}</span>
    <h3>${esc(poi.name)}</h3>
    ${regionLine}
    <p>${esc(blurb)}</p>${statusLine}${censusHtml}${chatterHtml}
    <div class="atlas-v2-faction">${factionMark}${esc(faction.name)}</div>
    <dl>
      <div><dt>Population</dt><dd>${format(poi.population)}</dd></div>
      <div><dt>Military</dt><dd>${format(poi.military_strength)}</dd></div>
      <div><dt>Economy</dt><dd>${format(poi.economic_value)}</dd></div>
      <div><dt>Influence</dt><dd>${format(poi.political_influence)}</dd></div>
      ${extras.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}
    </dl>
    ${poi.library_summary ? `<p class="atlas-v2-library">📚 ${esc(poi.library_summary)}</p>` : ''}
    ${article ? `<button class="atlas-v2-wiki" data-open-article="${esc(article)}">Open wiki article</button>` : ''}
    ${nearby.length ? `<div class="atlas-v2-nearby"><b>Nearby</b>${nearby.map(x => `<button data-jump="${esc(x.other.id)}">${esc(x.other.name)} <span>${x.d.toFixed(1)}</span></button>`).join('')}</div>` : ''}
  </article>`;
}

/* ---------------- the province layer ---------------- */

/* Raw cell paths: the fallback when a province has no arc outline. The normal
   path is map-province-arcs.js, where fill and border ink share the same
   smoothed arc points and a guard keeps every pin inside its province. */
function polygonPathD(polygon) {
  const poly = (polygon || []).filter(pt => pt && Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
  if (poly.length < 3) return '';
  return `M ${poly.map(pt => `${pt[0]} ${pt[1]}`).join(' L ')} Z`;
}

/* The painted Mushroom Kingdom sheet contains a great deal of surrounding
   ocean and other-realm artwork. Province cells must still tile the 100×100
   census box for arithmetic, but the reader should not see those empty-water
   assignments as political borders. Clip the visible layer to the convex hull
   of the actual surveyed pins, with a small deterministic breathing margin. */
function surveyHull(provinces, scale = 1.08) {
  const points = (provinces || []).flatMap(prov => (prov.pois || [])
    .filter(poi => poi && Number.isFinite(Number(poi.x)) && Number.isFinite(Number(poi.y)))
    .map(poi => [Number(poi.x), Number(poi.y)]));
  if (points.length < 3) return [];
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  sorted.forEach(point => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper = [];
  [...sorted].reverse().forEach(point => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  });
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) return [];
  const cx = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return hull.map(([x, y]) => [
    Math.max(0, Math.min(100, cx + (x - cx) * scale)),
    Math.max(0, Math.min(100, cy + (y - cy) * scale)),
  ]);
}

function provincePolygons(prov) {
  const cells = (prov && Array.isArray(prov.cells)) ? prov.cells.filter(poly => poly && poly.length >= 3) : [];
  if (cells.length) return cells;
  return prov && prov.polygon && prov.polygon.length >= 3 ? [prov.polygon] : [];
}

function provincePathD(prov) {
  return provincePolygons(prov).map(polygonPathD).filter(Boolean).join(' ');
}

/* Vacant hand-filed claims are drawn over ground the survey gave to somebody
   else, so they are inked as their own boxes rather than as shared borders. */
function claimEdgeInk(claims, colorOf) {
  const line = (p, q, color, owner) => `<line class="atlas-v2-edge rim vacant" data-edge-owner="${esc(owner)}" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" style="--plot:${esc(color)}" vector-effect="non-scaling-stroke"/>`;
  const ink = [];
  (claims || []).filter(p => p.vacant).forEach(prov => {
    (prov.polygon || []).forEach((pt, i, poly) => {
      const q = poly[(i + 1) % poly.length];
      if (Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 0.02) return;
      ink.push(line(pt, q, colorOf(prov), prov.id));
    });
  });
  return ink.join('');
}

/* Frontiers are inked from the shared arcs built by map-province-arcs.js: one
   path per arc, drawn once, with both neighbours' fills walking the same
   points. The rim is the sheet edge and is never softened. */
function arcEdgeInk(outlines, provinces, colorOf) {
  const byId = new Map(provinces.map(p => [p.id, p]));
  const crownOf = prov => prov.census.controller || prov.census.claimant || 'unclaimed';
  return outlines.arcs.map(arc => {
    const d = polylineD(arc.points) + (arc.closed ? ' Z' : '');
    if (d.length < 4) return '';
    const a = byId.get(arc.sides[0]);
    if (!a) return '';
    if (arc.rim) {
      return `<path class="atlas-v2-edge rim" fill="none" data-edge-owner="${esc(a.id)}" style="--plot:${esc(colorOf(a))}" vector-effect="non-scaling-stroke" d="${esc(d)}"/>`;
    }
    const b = byId.get(arc.sides[1]);
    if (!b) return '';
    const hot = a.census.contested || b.census.contested;
    const cls = crownOf(a) === crownOf(b) ? 'atlas-v2-edge inner' : 'atlas-v2-edge frontier' + (hot ? ' hot' : '');
    return `<path class="${cls}" fill="none" data-edge-provinces="${esc(a.id)} ${esc(b.id)}" vector-effect="non-scaling-stroke" d="${esc(d)}"/>`;
  }).join('');
}

/* Outlines are a pure function of the census, which is fixed for a mount; the
   overlay repaints on every zoom, so build them once per province list. */
const OUTLINE_CACHE = new WeakMap();

function outlinesFor(provinces) {
  let outlines = OUTLINE_CACHE.get(provinces);
  if (!outlines) {
    outlines = buildProvinceOutlines(provinces);
    OUTLINE_CACHE.set(provinces, outlines);
  }
  return outlines;
}

/* Where a province's name sits: the centroid of its biggest outline, kept only
   if it really lies inside the province (a crescent's centroid can be outside
   it). The seed pin is the fallback — it is where the survey put the seat, not
   where the territory's middle is, which is why labels used to crowd one pin. */
function labelAnchors(provinces) {
  const out = new Map();
  const outlines = outlinesFor(provinces);
  const area = ring => {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    return a / 2;
  };
  const inside = (pt, rings) => {
    let hit = false;
    rings.forEach(ring => {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) hit = !hit;
      }
    });
    return hit;
  };
  provinces.forEach(prov => {
    const rings = outlines.rings.get(prov.id) || [];
    let best = null, bestA = 0;
    rings.forEach(r => { const a = Math.abs(area(r)); if (a > bestA) { best = r; bestA = a; } });
    let pt = null;
    if (best && bestA > 0) {
      let cx = 0, cy = 0, signed = 0;
      for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
        const f = best[j][0] * best[i][1] - best[i][0] * best[j][1];
        signed += f;
        cx += (best[j][0] + best[i][0]) * f;
        cy += (best[j][1] + best[i][1]) * f;
      }
      if (signed) {
        const c = [cx / (3 * signed), cy / (3 * signed)];
        if (Number.isFinite(c[0]) && Number.isFinite(c[1]) && inside(c, rings)) pt = c;
      }
    }
    out.set(prov.id, pt ? { x: Math.round(pt[0] * 100) / 100, y: Math.round(pt[1] * 100) / 100 } : { x: prov.x, y: prov.y });
  });
  return out;
}

/* The province layer is filled first and inked second. Contested/unreadable
   provinces no longer get diagonal hatching or dashed squiggles; the fill uses
   the leading/nearest faction colour when one exists, and grey when the census
   cannot name a hand. */
function bordersSvg(provinces, colorOf, mapId = 'sheet') {
  const list = (provinces || []).filter(p => provincePathD(p));
  if (!list.length) return '';
  const solid = list.filter(prov => !prov.vacant);
  const claims = list.filter(prov => prov.vacant);
  const outlines = outlinesFor(provinces);
  const pathFor = prov => {
    const color = colorOf(prov);
    const cls = `atlas-v2-plot${prov.census.contested ? ' contested' : ''}${prov.vacant ? ' vacant' : ''}`;
    const smooth = !prov.vacant && outlines.rings.get(prov.id);
    const d = smooth && smooth.length ? ringsD(smooth) : provincePathD(prov);
    return `<path class="${cls}" fill-rule="evenodd" data-province="${esc(prov.id)}" style="--plot:${esc(color)}" d="${esc(d)}"><title>${esc(prov.name)}${prov.census.contested ? ' — contested' : (prov.census.controller ? '' : ' — unclaimed')}</title></path>`;
  };
  const fills = solid.map(pathFor).join('');
  const claimFills = claims.map(pathFor).join('');
  const hull = surveyHull(solid);
  const clipId = `atlas-v2-survey-${String(mapId).replace(/[^a-z0-9_-]/gi, '-')}`;
  const clipped = hull.length >= 3 ? ` clip-path="url(#${clipId})"` : '';
  const defs = hull.length >= 3
    ? `<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><path d="${esc(polygonPathD(hull))}"/></clipPath></defs>`
    : '';
  return `<svg class="atlas-v2-borders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">`
    + defs
    + `<g class="atlas-v2-survey-clip"${clipped}><g class="atlas-v2-fills">${fills}</g><g class="atlas-v2-edges">${arcEdgeInk(outlines, solid, colorOf)}</g></g>`
    + `<g class="atlas-v2-claims"><g class="atlas-v2-fills">${claimFills}</g><g class="atlas-v2-edges">${claimEdgeInk(claims, colorOf)}</g></g>`
    + `</svg>`;
}

function provinceBarsHtml(census, colorOf) {
  const rows = (census.ranked || []).filter(r => r.share >= 3).slice(0, 6);
  if (!rows.length) return '';
  return `<div class="atlas-v2-census">${rows.map(r => {
    const meta = colorOf(r.factionId);
    const pins = (census.pinCount || {})[r.factionId] || 0;
    return `<div class="atlas-v2-censusrow${r.factionId === census.controller ? ' holds' : ''}" title="${esc(meta.name)} — ${r.share}% of the census from ${pins} pin${pins === 1 ? '' : 's'}">`
      + `<i style="background:${esc(meta.color)}"></i><b>${esc(meta.name)}</b>`
      + `<span><em style="width:${Math.max(2, Math.min(100, r.share))}%"></em></span>`
      + `<u>${r.share}%</u></div>`;
  }).join('')}</div>`;
}

/* Who runs the ground the census crowned: the faction registry files the
   leader, the key figures, and — where a realm bothered to file them — the
   internal vote split of the court itself (the Regal Empire's Imperial Core /
   Magitek Ascension / Silent Service / Diplomatic Corps numbers live here).
   Realms differ in what they file, so the block shows whatever exists and
   omits itself entirely when nothing does; a march shows the leading hand
   under an honest label, never as a crown. */
function governanceHtml(fid, note) {
  if (!fid) return '';
  let f = null;
  try { f = getFaction(fid); } catch { f = null; }
  if (!f) return '';
  const hasLeader = f.leaderName && f.leaderName !== 'Unknown' && f.leaderName !== 'N/A';
  const people = (f.notablePeople || []).slice(0, 3);
  const ip = f.internalPolitics || {};
  const subs = Object.entries(ip.sub_factions || {})
    .map(([key, s]) => ({ key, name: s.name || key, influence: Number(s.influence) || 0 }))
    .sort((a, b) => b.influence - a.influence);
  if (!hasLeader && !people.length && !subs.length) return '';
  const leader = hasLeader
    ? `<p class="atlas-v2-govhead">👑 <b>${esc(f.leaderName)}</b>${f.leaderTitle && f.leaderTitle !== 'Leader' ? ` — ${esc(f.leaderTitle)}` : ''}</p>`
    : '';
  const court = people.length
    ? `<ul class="atlas-v2-court">${people.map(p => `<li><b>${esc(p.name)}</b>${p.role ? `<span>${esc(p.role)}</span>` : ''}</li>`).join('')}</ul>`
    : '';
  const votes = subs.length
    ? `<div class="atlas-v2-votes">${subs.map(s => `<div class="atlas-v2-voterow${ip.ruling_faction && s.key === ip.ruling_faction ? ' ruling' : ''}" title="${esc(s.name)} — ${s.influence}% of the court's filed influence">`
        + `<b>${esc(ip.ruling_faction && s.key === ip.ruling_faction ? '⚑ ' : '')}${esc(s.name)}</b>`
        + `<span><em style="width:${Math.max(2, Math.min(100, s.influence))}%"></em></span><u>${s.influence}%</u></div>`).join('')}</div>`
    : '';
  return `<div class="atlas-v2-gov"><b>🏛️ ${note || 'the hand that runs it'}</b>${leader}${court}${votes}</div>`;
}

function provinceDossierHtml(prov, opts) {
  if (!prov) return '';
  const { colorOf, pins, onNation, rollup } = opts;
  const c = prov.census;
  const crown = c.controller ? colorOf(c.controller) : '#f0b4b4';
  const verdict = c.contested
    ? `<b>Contested march.</b> ${esc(colorOf(c.claimant).name)} leads by ${c.margin} points over ${esc((c.rivals[0] || {}).factionId ? colorOf(c.rivals[0].factionId).name : 'the field')} — not enough to hold it.`
    : c.noLead
      ? `<b>Nobody holds it.</b> The filed pins are too thin to read a government off ${prov.name}.`
      : c.neutral
        ? `<b>Unclaimed.</b> ${c.pins} pin${c.pins === 1 ? '' : 's'} filed here, none of them under a flag.`
        : `<b>Held by ${esc(colorOf(c.controller).name)}</b> at ${c.claimantShare}% of the census.`;
  /* A held province names its government; a march names the leading hand under
     an honest label. Both only where the registry actually files one. */
  const gov = c.controller
    ? governanceHtml(c.controller, 'the hand that runs it')
    : c.contested && c.claimant
      ? governanceHtml(c.claimant, 'the leading hand — the census crowns nobody here')
      : '';
  const ledger = prov.delta ? `<div class="atlas-v2-ledger">
      <b>📜 The filed ledger, checked</b>
      ${prov.delta.rows.slice(0, 5).map(r => `<p><i style="background:${esc(colorOf(r.factionId).color)}"></i>${esc(colorOf(r.factionId).name)} — filed ${r.filed}% → census ${r.census}% <b class="${Math.abs(r.delta) >= 15 ? 'bad' : 'fine'}">${r.delta >= 0 ? '+' : ''}${r.delta}</b></p>`).join('')}
      <p class="atlas-v2-verdict">${prov.delta.agrees
        ? `The census agrees with ${esc(colorOf(prov.delta.filedController).name)} as the leading hand — the numbers just moved.`
        : `The census puts a different hand on this province than the ledger does. ${esc(colorOf(c.claimant).name)} now leads.`}</p>
    </div>` : '';
  const here = (prov.pois || []).slice().sort((a, b) => (Number(b.population) || 0) - (Number(a.population) || 0));
  const limit = opts.limit || 9;
  const seat = prov.seat ? `<button data-jump="${esc(prov.seat.id)}">👑 ${esc(prov.seat.name)}</button>` : '';
  return `<article class="atlas-v2-detail atlas-v2-province">
    <span class="atlas-v2-kicker">${prov.origin === 'filed' ? 'province · filed in the atlas' : 'province · merged from the survey'}${prov.sourceMapId ? ` · ${esc(prov.sourceMapId)}` : ''}</span>
    <h3>${esc(prov.name)}</h3>
    <p class="atlas-v2-hold" style="--hold:${esc(crown)}">${verdict}</p>
    ${gov}
    <dl>
      <div><dt>Pins counted</dt><dd>${c.pins}</dd></div>
      <div><dt>Residents</dt><dd>${format(c.population)}</dd></div>
      <div><dt>Military</dt><dd>${format(c.military)}</dd></div>
      <div><dt>Economy</dt><dd>${format(c.economic)}</dd></div>
      <div><dt>Influence</dt><dd>${format(c.political)}</dd></div>
      <div><dt>Census power</dt><dd>${format(c.power)}</dd></div>
    </dl>
    ${provinceBarsHtml(c, colorOf)}
    ${ledger}
    ${rollup ? `<p class="atlas-v2-nation">${rollup.provinceCount} provinces make the realm: <b>${esc(colorOf(rollup.sovereign).name)}</b> holds ${rollup.sovereignProvinces} of them (${rollup.sovereignShare}%). ${rollup.contestedProvinces} contested, ${rollup.unclaimedProvinces} unclaimed.</p>` : ''}
    <div class="atlas-v2-pins"><b>${here.length} pin${here.length === 1 ? '' : 's'} in this province</b>${seat}${here.filter(p => p.id !== (prov.seat || {}).id).slice(0, limit).map(x => `<button data-jump="${esc(x.id)}">${esc(x.name)} <span>${format(x.population)}</span></button>`).join('')}${here.length > limit + 1 ? `<button data-moreprovince="${esc(prov.id)}">+${here.length - limit - 1} more pins — show the whole province</button>` : ''}</div>
    <button class="atlas-v2-wiki" data-pickprovince="${esc(prov.id)}">🎯 Choose a pin in ${esc(prov.name)}</button>
    ${onNation ? `<button class="atlas-v2-wiki" data-open-map="${esc(onNation)}">🗺️ Open this province as its own sheet</button>` : ''}
  </article>`;
}

/* ---------------- the shortlist ---------------- */

function shortlistHtml(board, state) {
  const rows = (board.picks || []).map((row, i) => `<button class="atlas-v2-pick${i === state.pickIndex ? ' on' : ''}" data-pick="${esc(row.id)}">
      <b class="atlas-v2-pickrank">${i + 1}</b>
      <span class="atlas-v2-pickname">${esc(row.name)}${row.province ? `<i>${esc(row.province)}</i>` : ''}</span>
      <em>${esc(row.reasons.slice(0, 3).join(' · '))}</em>
    </button>`).join('');
  return `<article class="atlas-v2-detail atlas-v2-shortlist">
    <span class="atlas-v2-kicker">the desk's shortlist</span>
    <h3>${board.total} pins. Six worth choosing.</h3>
    <p>Waluigi ranks what is on this sheet by the lens you have open, then tells you why each one is on the list. Arrow keys move, Enter picks, Esc drops it.</p>
    ${rows || '<p class="text-muted">Nothing left after the filters.</p>'}
    <div class="atlas-v2-picktools"><button data-pickroll>⚄ Reroll the six</button><button data-pickclose>✕ Back to the map</button></div>
  </article>`;
}

export function mountAtlasMapV2(host, mapId, opts = {}) {
  const plane = (opts.plane && opts.plane !== 'all') ? opts.plane : '';
  /* Journey mode mounts trail-only: every surveyed pin that is not a stop */
  /* stays out of the model, so clusters, counts, and filters all agree.  */
  /* With no stops on this sheet the filter would blank the map, so an    */
  /* empty trail falls back to the full survey.                           */
  const stopIds = new Set((opts.journey || []).filter(s => s && s.poiId).map(s => s.poiId));
  const journeyOnly = !!opts.journeyOnly && stopIds.size > 0;
  const data = model(mapId, plane, journeyOnly ? stopIds : null);
  if (!data) {
    host.innerHTML = '<div class="atlas-v2-error">This map record is unavailable.</div>';
    return null;
  }
  const { map, pois, population } = data;
  /* Transport is a separate travel overlay. It is bounded and computed once
     per mount, so a resize or lens change cannot create another copy of every
     route. Journey mode owns its historical event path instead. */
  const transport = buildTransportForMap(map);
  const transportById = new Map(pois.map(poi => [poi.id, poi]));
  const visibleRoutes = transport.routes.filter(route => transportById.has(route.from) && transportById.has(route.to));
  /* Warm the location cache as the map mounts so the first pin a reader
     opens already has its plate. Fire-and-forget: the panel redraws itself
     if this lands late, and the map works unchanged if it never lands. */
  loadLocationRecords();
  ACTIVE_CHATTER = opts.chatter || null;
  /* The Province Census (map-provinces.js) merges these pins into provinces,
     names a controller for each from the filed faction data, and hands back a
     border polygon. Journey mode hides pins, so it must not draw borders over
     a survey the reader cannot see; a sheet with one province gets no overlay. */
  const census = (opts.provinces === false || journeyOnly) ? null
    : buildProvinceCensus(map, MAP_DATA, { pois, politics: PROVINCE_POLITICS, ...(opts.provinceCensus || {}) });
  const provinceList = census && census.provinces.length > 1 ? census.provinces : [];

  /* The filed transport layer, run through the transit engine: distances,
     times, station roles and dossiers come from map-transit.js; which lines
     exist, their mode and their waypoints stay as filed in map-routes.js. A line
     with no filed status reads as contested where it crosses a frontier the
     census marks as disputed. */
  const poiProvince = new Map();
  provinceList.forEach(prov => (prov.pois || []).forEach(p => poiProvince.set(p.id, prov)));
  const derivedStatus = (route, u, v) => {
    if (route.status && route.status !== 'open') return route.status;
    const a = poiProvince.get(u.id), b = poiProvince.get(v.id);
    if (a && b && a.id !== b.id && ((a.census && a.census.contested) || (b.census && b.census.contested))) return 'contested';
    return 'open';
  };
  const labelAt = provinceList.length ? labelAnchors(provinceList) : new Map();
  const transitNet = visibleRoutes.length ? networkFromRoutes(map, pois, visibleRoutes, { statusOf: derivedStatus }) : null;
  const transitRouteById = new Map((transitNet ? transitNet.routes : []).map(r => [r.id, r]));
  const provinceById = new Map(provinceList.map(p => [p.id, p]));
  const pinProvince = new Map();
  provinceList.forEach(prov => prov.poiIds.forEach(id => pinProvince.set(id, prov)));

  ACTIVE_CENSUS = opts.census || null;
  /* Chatter lens: pin size = Wah Notes volume. A value fn instead of a key
     because loudness is computed, not filed on the POI. */
  const modes = Object.assign({}, MODES);
  /* Places: dots coloured by what KIND of place they are (market, fortress,
     shrine…). It used to be baked into every numeric lens, which left
     Population, Military, Economy and Influence looking identical; it is its
     own lens now. Size still follows population. */
  modes.places = {
    label: 'Places', color: '#94a3b8', unit: 'residents', sizeLabel: 'residents', byType: true,
    value: poi => Number(poi.population) || 0,
  };
  /* Categorical lenses: pin COLOR carries the dominant category (faith group,
     culture, species, faction) while pin SIZE keeps the log ladder, now fed
     by filed adherents or residents. `value` stays numeric so the existing
     size/range/total pipeline is untouched; `catOf` adds the category. */
  if (opts.census) {
    const spTop = poi => ((opts.census.species || {}).top || {})[poi.id] || null;
    const faTop = poi => ((opts.census.faiths || {}).top || {})[poi.id] || null;
    const cuTop = poi => ((opts.census.cultures || {}).top || {})[poi.id] || null;
    modes.species = {
      label: 'Species', color: '#5eead4', unit: 'filed members', sizeLabel: 'filed members', categorical: true,
      value: poi => (spTop(poi) || {}).n || 0,
      catOf: poi => { const t = spTop(poi); return t ? { key: 'sp:' + t.label, label: t.label, color: hashColor('species:' + t.label), icon: initial(t.label) } : null; },
    };
    modes.religion = {
      label: 'Religion', color: '#f0abfc', unit: 'filed adherents', sizeLabel: 'filed adherents', categorical: true,
      value: poi => (faTop(poi) || {}).groupN || (faTop(poi) || {}).n || 0,
      catOf: poi => {
        const t = faTop(poi); if (!t) return null;
        const g = t.group;
        return (g && g.color)
          ? { key: 'rel:' + g.name, label: g.name, color: g.color, icon: g.icon || '🛐' }
          : { key: 'rel:other', label: 'Other faiths', color: '#8a94a6', icon: '🛐' };
      },
    };
    modes.culture = {
      label: 'Culture', color: '#f9a8d4', unit: 'residents', sizeLabel: 'residents', categorical: true,
      value: poi => Number(poi.population) || 0,
      catOf: poi => { const t = cuTop(poi); return t ? { key: 'cu:' + t.label, label: t.label, color: hashColor('culture:' + t.label), icon: initial(t.label) } : null; },
    };
  }
  /* Faction lens: every pin has a flag status (filed factionId or Unaligned),
     so this mode needs no census — like population, it is POI-intrinsic. */
  modes.factions = {
    label: 'Factions', color: '#fb923c', unit: 'residents', sizeLabel: 'residents', categorical: true,
    value: poi => Number(poi.population) || 0,
    catOf: poi => {
      const m = factionMeta(poi.factionId);
      return { key: 'fac:' + (m.id || 'unaligned'), label: m.name, color: m.color, icon: initial(m.name), img: factionLogoHref(m.logo) };
    },
  };
  /* Intel lens: pin colour is the clearance BAND, pin size the level, so a
     reader can see at a glance how much of a sheet is gated and by whom. Like
     factions this is POI-intrinsic and needs no census. `intelReq` is filed in
     two shapes - a bare number, or { faction, level } - so both are read here
     rather than assuming the normalised form. */
  modes.intel = {
    label: 'Intel', color: '#f472b6', unit: 'clearance', sizeLabel: 'clearance', categorical: true,
    value: poi => intelLevel(poi),
    catOf: poi => {
      const lv = intelLevel(poi);
      if (!Number.isFinite(lv) || lv <= 0) return { key: 'int:open', label: 'Open · no clearance', color: '#5eead4', icon: '○' };
      const band = INTEL_BANDS.find(b => lv <= b.max) || INTEL_BANDS[INTEL_BANDS.length - 1];
      return { key: 'int:' + band.key, label: band.label, color: band.color, icon: band.icon };
    },
  };
  if (opts.chatter) modes.chatter = { label: 'Chatter', color: '#f472b6', unit: 'wah notes', value: poi => ((opts.chatter.counts || {})[poi.id] || 0) };
  const startMode = (opts.defaultMode && modes[opts.defaultMode]) ? opts.defaultMode : 'population';
  /* Journey stops: [{poiId, n, eventId, name, date, plane}]. Stops whose pin
     is not on this layer keep their numbers but render no marker or path. */
  const poiIds = new Set(pois.map(p => p.id));
  const stops = (opts.journey || []).filter(s => s && poiIds.has(s.poiId));
  const stopByPoi = new Map();
  stops.forEach(s => { if (!stopByPoi.has(s.poiId)) stopByPoi.set(s.poiId, s); });
  const isFull = /_full$/.test(map.id) || /\(Full\)/i.test(map.name || '');
  const imgHref = new URL(`../../../${map.imageSrc}`, import.meta.url).href;
  const types = [...new Set(pois.map(p => p.type).filter(Boolean))].sort();
  let currentVisiblePois = pois.slice();
  const pinWord = journeyOnly ? 'journey stops · Survey holds the full survey'
    : plane ? `${PLANE_LABELS[plane] || plane} pins` : 'surveyed pins';

  const plotsOn = provinceList.length > 0 && opts.showProvinces !== false;
  host.innerHTML = `<section class="atlas-v2" aria-label="${esc(map.name)} tactical map">
    <header>
      <div>
        <span class="atlas-v2-eyebrow">WORLD ATLAS · PINNED ARTWORK</span>
        <h2>${esc((map.name || map.id).replace(' (Full)', ''))}</h2>
        <p>${pois.length} ${pinWord} · ${format(population)} mapped residents · x/y kept as percent of the painting${provinceList.length ? ` · ${provinceList.length} provinces from the filed survey` : ''}${visibleRoutes.length && !journeyOnly ? ` · ${visibleRoutes.length} transport routes` : ''}</p>
      </div>
      <div class="atlas-v2-actions">
        <button type="button" data-action="fit">Reset view</button>
        <button type="button" data-action="labels">Labels</button>
        <button type="button" data-action="expand">⛶ Full screen</button>
      </div>
    </header>
    <div class="atlas-v2-tools">
      <input type="search" data-search placeholder="Search mapped locations…">
      <select data-type><option value="">All types</option>${types.map(t => `<option value="${esc(t)}">${esc(humanize(t))}</option>`).join('')}</select>
      <button type="button" data-action="wiki" title="Show only pins that open a wiki article">📖 Wiki</button>
      ${provinceList.length ? `<button type="button" data-action="plots" class="${plotsOn ? 'active' : ''}" title="Merge the pins into provinces and draw the borders the census can prove">🗺️ Provinces</button>` : ''}
      ${visibleRoutes.length && !journeyOnly ? `<button type="button" data-action="routes" class="active" title="Show or hide the inferred transport network">🚆 Routes</button>` : ''}
      <button type="button" data-action="density" data-density="auto" title="Cycle marker density: auto, every location, key locations only, or clustered">${PIN_DENSITY.auto.label}</button>
      <button type="button" data-action="bigpins" class="active" title="Bigger, easier-to-hit dots (on by default) — click to return to small dots">⬤ Big dots</button>
      <button type="button" data-action="shortlist" title="Rank the pins on this sheet and pick one to act on">🎯 Choose a pin</button>
      <span data-visible>${pois.length} markers</span>
    </div>
    <div class="atlas-v2-drill" data-drill hidden></div>
    <div class="atlas-v2-typekey" data-typekey></div>
    <div class="atlas-v2-modes">
      ${Object.entries(modes).map(([id, m]) => `<button type="button" class="${id === startMode ? 'active' : ''}" data-mode="${id}" style="--mode:${m.color}">${m.label}</button>`).join('')}
      <b data-mode-total>${format(population)} residents</b>
    </div>
    <div class="atlas-v2-layout">
      <main class="atlas-v2-stage">
        <div class="atlas-v2-viewport">
          <div class="atlas-v2-world">
            <img data-map-art alt="${esc(map.name)} map" src="${imgHref}">
            <div class="atlas-v2-overlay" data-overlay></div>
          </div>
          <div class="atlas-v2-zoomer">
            <button type="button" data-action="zoomin" title="Zoom in">+</button>
            <button type="button" data-action="zoomout" title="Zoom out">−</button>
            <button type="button" data-action="zoomreset" title="Back to the whole sheet">⤢</button>
          </div>
          <div class="atlas-v2-depth" data-depth>1× continent</div>
        </div>
        <div class="atlas-v2-legend"><span data-legend-lens></span><span>${transportLegendHtml()} ${esc(map.group || '')}</span></div>
      </main>
      <aside class="atlas-v2-sidebar">${detailHtml(null, pois)}</aside>
    </div>
  </section>`;

  const img = host.querySelector('[data-map-art]');
  const overlay = host.querySelector('[data-overlay]');
  const world = host.querySelector('.atlas-v2-world');
  const viewport = host.querySelector('.atlas-v2-viewport');
  const sidebar = host.querySelector('.atlas-v2-sidebar');
  const state = {
    /* drill: the zoom-in stack. Empty = the whole sheet. Each entry scopes the
       map to one group of pins and remembers how to draw its way back out:
       { ids:Set, label, x, y, scale }. Clicking a cluster pushes; the
       breadcrumb pops. This is what makes the sheet behave like a real atlas —
       continent, then region, then town — instead of one flat pile. */
    drill: [],
    scale: 1, tx: 0, ty: 0, box: { left: 0, top: 0, w: 1, h: 1 }, mode: startMode, selected: null, wikiOnly: false,
    plots: plotsOn, routes: visibleRoutes.length > 0 && !journeyOnly && opts.routes !== false, province: null, board: null, pickIndex: 0, nonce: 0, dragged: false, labelZoom: 1,
    pinDensity: PIN_DENSITY[opts.pinDensity] ? opts.pinDensity : 'auto',
    /* Big-target mode: same dots, bigger hit areas, for touch and for anyone
       who would rather aim at a disc than a point. Opt-in, off by default. */
    bigPins: true,
  };
  /* One colour source for the census: the same registry the pins and the
     demographics panel already read, so a province and its capital agree. */
  const plotColor = prov => {
    const fid = prov.census.controller || (prov.census.claimant !== 'unaligned' ? prov.census.claimant : null);
    return fid ? factionMeta(fid).color : '#64748b';
  };

  function hull() {
    if (isFull || pois.length < 2) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const xs = pois.map(p => p.x);
    const ys = pois.map(p => p.y);
    const pad = 8;
    return {
      minX: Math.max(0, Math.min(...xs) - pad),
      minY: Math.max(0, Math.min(...ys) - pad),
      maxX: Math.min(100, Math.max(...xs) + pad),
      maxY: Math.min(100, Math.max(...ys) + pad),
    };
  }

  function applyTransform() {
    world.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    /* Labels are counter-scaled against the zoom so they stay their own size
       on screen at every depth — which is also why decluttering is re-run
       whenever the zoom actually changes (see refreshLabels). */
    overlay.style.setProperty('--label-zoom', String(state.scale || 1));
    /* Pins hold their size on screen at every depth. Without this the dots
       grow with the ground and the sheet is exactly as crowded at 40x as it
       was at 1x — zooming would move the pile closer rather than spread it. */
    overlay.style.setProperty('--pin-zoom', String(state.scale || 1));
    if ((state.scale || 1) !== state.labelZoom) {
      state.labelZoom = state.scale || 1;
      refreshLabels();
    }
    showDepth();
  }

  function fitRegion() {
    const h = hull();
    const vw = viewport.clientWidth || 1;
    const vh = viewport.clientHeight || 1;
    const box = state.box;
    const regionW = box.w * (h.maxX - h.minX) / 100;
    const regionH = box.h * (h.maxY - h.minY) / 100;
    const s = Math.min(vw / Math.max(regionW, 1), vh / Math.max(regionH, 1), 4.2);
    state.scale = Math.max(1, s * 0.92);
    const cx = box.left + box.w * ((h.minX + h.maxX) / 200);
    const cy = box.top + box.h * ((h.minY + h.maxY) / 200);
    state.tx = vw / 2 - cx * state.scale;
    state.ty = vh / 2 - cy * state.scale;
    applyTransform();
    placePins();
  }

  /* ---------------- drill-down ----------------
     The reader clicks a cluster; the sheet zooms to exactly that group and
     hides everything else, so the next click is a decision about THAT place
     rather than about the whole continent again. Repeat until single pins
     remain. The breadcrumb walks back out. */

  /* Say how deep we are, and offer the way back. Without a readout a reader at
     60x on an unfamiliar corner has no idea whether they are lost or just
     close. */
  function showDepth() {
    const el = host.querySelector('[data-depth]');
    if (!el) return;
    const z = state.scale || 1;
    el.textContent = `${z < 1.05 ? '1' : z.toFixed(z < 10 ? 1 : 0)}×  ${scaleWord(z)}`;
    el.classList.toggle('deep', z > 3);
  }

  function drillTop() {
    return state.drill.length ? state.drill[state.drill.length - 1] : null;
  }

  /* Name a level after its most significant place, the way an atlas names a
     region after its capital: "Mighdural +7" reads, "8 locations" does not. */
  function drillLabelFor(group) {
    const lead = [...group].sort((a, b) =>
      defaultPinScore(b) - defaultPinScore(a) || String(a.name || '').localeCompare(String(b.name || '')))[0];
    if (!lead) return `${group.length} locations`;
    const rest = group.length - 1;
    return rest > 0 ? `${lead.name} +${rest}` : lead.name;
  }

  /* The pins currently in scope: the whole sheet, or the innermost drill. */
  function scopedPois() {
    const top = drillTop();
    if (!top) return pois;
    return pois.filter(p => top.ids.has(p.id));
  }

  /* Frame a set of pins: centre them and zoom so they fill the viewport with
     a margin. This is what makes each click feel like it went somewhere. */
  function framePois(list, opts = {}) {
    const pts = (list || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!pts.length) return;
    const box = state.box;
    const vw = viewport.clientWidth || 1;
    const vh = viewport.clientHeight || 1;

    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    /* Pad proportionally to the group's own extent, so a tight pair gets a
       tight window and can actually be zoomed apart, while a sprawling region
       still gets breathing room. A floor stops a zero-extent group (pins filed
       at the identical coordinate) dividing into infinite zoom. */
    const extent = Math.max(maxX - minX, maxY - minY);
    const padPct = opts.pad ?? Math.max(0.25, Math.min(3.5, extent * 0.18));
    const spanX = Math.max(maxX - minX, 0) + padPct * 2;
    const spanY = Math.max(maxY - minY, 0) + padPct * 2;

    const wantW = box.w * spanX / 100;
    const wantH = box.h * spanY / 100;
    const fit = Math.min(vw / Math.max(wantW, 1), vh / Math.max(wantH, 1));
    /* Deep zoom is the whole point of drilling; the art gets soft long before
       the geometry does, and a blurry readable pin beats a crisp pile. */
    const maxZoom = opts.maxZoom ?? MAX_ZOOM;
    state.scale = Math.max(1, Math.min(fit, maxZoom));

    const cx = box.left + box.w * ((minX + maxX) / 200);
    const cy = box.top + box.h * ((minY + maxY) / 200);
    state.tx = vw / 2 - cx * state.scale;
    state.ty = vh / 2 - cy * state.scale;
    applyTransform();
  }

  /* Push one level in, scoped to `group` (an array of POIs). */
  function drillInto(group, label) {
    const members = (group || []).filter(Boolean);
    if (members.length < 2) return false;
    /* Refuse a level that would show exactly what is already on screen.
       Pins filed at the identical coordinate can never be separated by zoom,
       so without this the reader can drill forever into the same two dots. */
    const top = drillTop();
    if (top && top.ids.size === members.length && members.every(p => top.ids.has(p.id))) {
      return openLocalInset(members.map(p => p.id), members[0].x, members[0].y);
    }
    state.drill.push({
      ids: new Set(members.map(p => p.id)),
      label: label || `${members.length} locations`,
      count: members.length,
    });
    state.selected = null;
    framePois(members);
    placePins();
    renderBreadcrumb();
    sidebar.innerHTML = drillHtml(members);
    bindDrillList();
    return true;
  }

  /* Pop back out to depth `n` (0 = the whole sheet). */
  function drillTo(n) {
    state.drill.length = Math.max(0, Math.min(n, state.drill.length));
    state.selected = null;
    const scope = scopedPois();
    if (state.drill.length) framePois(scope);
    else reframe();
    placePins();
    renderBreadcrumb();
    sidebar.innerHTML = state.drill.length ? drillHtml(scope) : detailHtml(null, pois);
    if (state.drill.length) bindDrillList();
  }

  function renderBreadcrumb() {
    const bar = host.querySelector('[data-drill]');
    if (!bar) return;
    if (!state.drill.length) { bar.innerHTML = ''; bar.hidden = true; return; }
    bar.hidden = false;
    const crumbs = [`<button type="button" data-drill-to="0">🌍 ${esc(map.name)}</button>`]
      .concat(state.drill.map((d, i) =>
        `<button type="button" data-drill-to="${i + 1}"${i === state.drill.length - 1 ? ' class="on" aria-current="true"' : ''}>${esc(d.label)}</button>`));
    bar.innerHTML = `<span class="atlas-v2-drill-trail">${crumbs.join('<i>›</i>')}</span>`
      + `<button type="button" class="atlas-v2-drill-up" data-drill-to="${state.drill.length - 1}">↩ Back out</button>`;
    bar.querySelectorAll('[data-drill-to]').forEach(b =>
      b.addEventListener('click', () => drillTo(Number(b.dataset.drillTo))));
  }

  /* Sidebar for a drilled group: what is in here, and a way into each one. */
  function drillHtml(list) {
    const top = drillTop();
    const rows = [...list]
      .sort((a, b) => defaultPinScore(b) - defaultPinScore(a) || String(a.name || '').localeCompare(String(b.name || '')))
      .map(poi => `<button type="button" data-drill-jump="${esc(poi.id)}">
          <b>${esc(humanize(poi.type || 'location').slice(0, 1))}</b>
          <span>${esc(poi.name)}<i>${esc(humanize(poi.type || 'location'))} · ${format(poi.population)} residents</i></span>
        </button>`).join('');
    const types = [...list.reduce((m, p) => m.set(humanize(p.type || 'location'), (m.get(humanize(p.type || 'location')) || 0) + 1), new Map()).entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return `<article class="atlas-v2-detail atlas-v2-inset">
      <span class="atlas-v2-kicker">🔍 Zoomed in · depth ${state.drill.length}</span>
      <h3>${esc(top ? top.label : 'Selection')}</h3>
      <p>${list.length} locations in view. Click a cluster on the map to go deeper, a single pin to open it, or use the trail above to come back out.</p>
      <div class="atlas-v2-inset-meta">${types.map(([n, c]) => `<span>${esc(n)} ×${c}</span>`).join('')}</div>
      <div class="atlas-v2-inset-list">${rows}</div>
    </article>`;
  }

  function bindDrillList() {
    sidebar.querySelectorAll('[data-drill-jump]').forEach(b => b.addEventListener('click', () => {
      const poi = pois.find(p => p.id === b.dataset.drillJump);
      if (!poi) return;
      select(poi, null, stopByPoi.get(poi.id));
      centerOn(poi.x, poi.y, Math.max(state.scale, 6));
      placePins();
    }));
  }

  /* Fold companions filed at (near enough) the same coordinate into one mark.
     Order inside a group is stable so the sidebar does not reshuffle. */
  function groupTokens(list) {
    const buckets = new Map();
    list.forEach(t => {
      const key = `${t.x.toFixed(1)}:${t.y.toFixed(1)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    });
    return [...buckets.values()].map(members => ({
      ...members[0],
      x: members.reduce((n, m) => n + m.x, 0) / members.length,
      y: members.reduce((n, m) => n + m.y, 0) / members.length,
      members,
    }));
  }

  function journeyPathSvg() {
    if (stops.length < 2) return '';
    const pts = stops.map(s => {
      const p = pois.find(q => q.id === s.poiId);
      return p ? `${p.x},${p.y}` : null;
    }).filter(Boolean);
    if (pts.length < 2) return '';
    return `<svg class="atlas-v2-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">`
      + `<polyline points="${pts.join(' ')}" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function transportPathSvg() {
    if (!state.routes || !visibleRoutes.length || journeyOnly) return '';
    const lines = visibleRoutes.map(route => {
      const from = transportById.get(route.from);
      const to = transportById.get(route.to);
      const mode = TRANSPORT_MODES[route.mode] || TRANSPORT_MODES.trail;
      const tr = transitRouteById.get(route.id);
      const d = tr ? routeSvgD(tr) : `M ${from.x},${from.y} L ${to.x},${to.y}`;
      const status = (tr && tr.status) || route.status || 'open';
      const cap = (tr && tr.capacity) || route.capacity || 1;
      const name = (tr && tr.name) || `${from.name} to ${to.name}`;
      const tip = `${mode.icon} ${name} · ${mode.label} · ${(ROUTE_CAPACITY[cap] || ROUTE_CAPACITY[1]).label} capacity · ${status}`;
      const cls = `atlas-v2-route atlas-v2-route-${esc(route.mode)} cap-${cap} status-${esc(status)}`;
      /* Line weight follows capacity; rail and road get a dark casing so they
         read as built lines, with ties / a centre line on top. Sea, air and
         trail stay dashed and light. */
      const w = (1.5 + (cap - 1) * 0.8).toFixed(1);
      const built = route.mode === 'rail' || route.mode === 'road';
      return `<g data-route="${esc(route.id)}" style="--w:${w}px">`
        + (built ? `<path class="atlas-v2-route-casing" d="${esc(d)}" vector-effect="non-scaling-stroke"/>` : '')
        + `<path class="${cls}" fill="none" style="--route:${esc(mode.color)};--route-dash:${esc(mode.dash)}" vector-effect="non-scaling-stroke" d="${esc(d)}"><title>${esc(tip)}</title></path>`
        + (built ? `<path class="atlas-v2-route-detail atlas-v2-route-detail-${esc(route.mode)}" d="${esc(d)}" vector-effect="non-scaling-stroke"/>` : '')
        + `<path class="atlas-v2-route-hit" fill="none" data-route-id="${esc(route.id)}" vector-effect="non-scaling-stroke" d="${esc(d)}"/>`
        + `</g>`;
    }).join('');
    return `<svg class="atlas-v2-routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Transport routes">${lines}</svg>`;
  }

  /* Stations are drawn as markers, not as SVG circles: the pins under them are
     tiny dots, so a line ending at a pin ended at nothing. A ring in the line's
     own colour makes each terminal a place; junctions (three or more lines) are
     larger and carry their name. They are counter-scaled like pins and sit
     under them, so the pin inside stays the click target. */
  function stationsHtml() {
    if (!state.routes || !transitNet || journeyOnly) return '';
    return transitNet.stations.filter(st => (st.degree || 0) >= 1).map(st => {
      const lead = (st.connections || []).slice().sort((a, b) => (b.capacity || 1) - (a.capacity || 1))[0];
      const color = lead && lead.modeMeta ? lead.modeMeta.color : '#e8f0ff';
      const hub = (st.degree || 0) >= 3;
      const tip = `${st.name} · ${st.stationRole || 'Station'} · ${st.degree} line${st.degree === 1 ? '' : 's'}`;
      return `<span class="atlas-v2-station${hub ? ' hub' : ''}" data-station="${esc(st.id)}" style="left:${Number(st.x)}%;top:${Number(st.y)}%;--station:${esc(color)}" title="${esc(tip)}">${hub ? `<em>${esc(st.name)}</em>` : ''}</span>`;
    }).join('');
  }

  function transportLegendHtml() {
    if (!visibleRoutes.length || journeyOnly) return '';
    const counts = visibleRoutes.reduce((out, route) => {
      out[route.mode] = (out[route.mode] || 0) + 1;
      return out;
    }, {});
    return Object.entries(counts).map(([mode, count]) => {
      const meta = TRANSPORT_MODES[mode] || TRANSPORT_MODES.trail;
      return `<span class="atlas-v2-route-key"><i style="background:${esc(meta.color)}"></i>${esc(meta.icon)} ${esc(meta.label)} ${count}</span>`;
    }).join('') + '<span class="atlas-v2-route-key atlas-v2-route-key-note">line weight = capacity · red dashed = closed · amber = contested</span>';
  }

  function placePins() {
    state.box = containBox(world, img);
    const { left, top, w, h } = state.box;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;
    const lens = modes[state.mode] || MODES.population;
    const lensVal = p => lens.value ? lens.value(p) : (Number(p[lens.key]) || 0);
    const lensEl = host.querySelector('[data-legend-lens]');
    const query = (host.querySelector('[data-search]')?.value || '').toLowerCase();
    const type = host.querySelector('[data-type]')?.value || '';
    /* Party last-seen tokens: companions whose latest filed appearance pins
       onto this sheet. Rendered above pins, never clustered. */
    /* Companions standing in the same place are ONE marker. Two tokens filed
       at the same tavern used to draw two 30px discs on top of each other,
       which is both a lie about the geography and a pile the reader has to
       pick apart. Rounding to a tenth of a percent is tight enough that
       genuinely separate places stay separate. */
    const toks = groupTokens((opts.party || []).filter(t => Number.isFinite(t.x) && Number.isFinite(t.y)));
    /* Lens weight on a log scale: sheet values run 0..60,000 with a median
       near 50, so a linear share of max flattens 95% of pins to one dot.
       log(1+v)/log(1+max) spreads hamlets, towns, and cities across the
       whole size range; the top 5 pins earn a ring so the giants pop at
       thumbnail scale. Stacked pins size by their largest member. */
    const values = pois.map(p => lensVal(p));
    const max = Math.max(0, ...values);
    const denom = Math.log1p(max) || 1;
    const weight = v => Math.min(1, Math.log1p(Math.max(0, v)) / denom);
    const ranked = [...pois].sort((a, b) => lensVal(b) - lensVal(a)).slice(0, 5);
    const major = new Set(ranked.filter(p => lensVal(p) > 0).map(p => p.id));
    const seatIds = new Set(provinceList.map(prov => prov.seat && prov.seat.id).filter(Boolean));
    const stopIdsOnSheet = new Set(stops.map(s => s.poiId).filter(Boolean));
    const chatterCounts = (opts.chatter && opts.chatter.counts) || {};
    const isKeyPin = poi => !!(poi && (
      major.has(poi.id)
      || seatIds.has(poi.id)
      || stopIdsOnSheet.has(poi.id)
      || wikiId(poi)
      || (chatterCounts[poi.id] || 0) > 0
    ));
    /* Drilling in narrows the sheet to the group the reader chose, so every
       later count, cluster and legend describes THAT place and not the
       continent it sits on. */
    const inScope = scopedPois();
    const matches = poi => (!query || `${poi.name} ${poi.description || ''}`.toLowerCase().includes(query))
      && (!type || poi.type === type)
      && (!state.wikiOnly || wikiId(poi));
    let displayPois = inScope.filter(matches);
    const unfilteredMatches = displayPois.length;
    /* What 'auto' resolves to right now. A drilled-in scope is already the
       small answer to a crowd, so it counts the scoped pins, not the sheet. */
    const density = state.pinDensity === 'auto'
      ? (inScope.length > AUTO_KEY_MIN_PINS && (state.scale || 1) < AUTO_KEY_BELOW_ZOOM ? 'key' : 'all')
      : state.pinDensity;
    if (density === 'key' && !journeyOnly) displayPois = displayPois.filter(isKeyPin);
    if (!displayPois.length && unfilteredMatches) displayPois = inScope.filter(matches).slice(0, 1);
    currentVisiblePois = displayPois.slice();
    const min = values.length ? Math.min(...values) : 0;
    const radius = dynamicClusterRadius(displayPois.length, state.scale, plane, journeyOnly, density, state.box, state.drill.length > 0);
    const clusterOpts = {
      maxSize: density === 'smart' ? Math.max(18, Math.ceil(displayPois.length / 12)) : 4,
      score: p => (lensVal(p) * 2) + defaultPinScore(p) + (isKeyPin(p) ? 999 : 0),
    };
    const clusters = provinceList.length
      ? [...displayPois.reduce((buckets, poi) => {
          const key = (pinProvince.get(poi.id) || {}).id || '';
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(poi);
          return buckets;
        }, new Map()).values()].flatMap(bucket => clusterPois(bucket, radius, clusterOpts))
      : clusterPois(displayPois, radius, clusterOpts);
    if (provinceList.length) {
      clusters.forEach(group => {
        const rep = group[0];
        if (rep) { group.x = Number(rep.x) || group.x; group.y = Number(rep.y) || group.y; }
      });
    }
    const clusterCount = clusters.filter(group => group.length > 1).length;
    const hiddenKeyCount = Math.max(0, unfilteredMatches - displayPois.length);
    const visibleEl = host.querySelector('[data-visible]');
    if (visibleEl) {
      const markerLabel = clusters.length === displayPois.length
        ? `${displayPois.length} markers visible`
        : `${clusters.length} clustered markers · ${displayPois.length} POIs`;
      visibleEl.textContent = markerLabel + (displayPois.length !== pois.length ? ` · ${pois.length - displayPois.length} tucked` : '');
    }
    /* Dot colours are only useful if the reader can decode them, and only in
       the lenses where dots actually carry type (the categorical lenses paint
       pins by their own category instead). */
    const typeKeyEl = host.querySelector('[data-typekey]');
    if (typeKeyEl) {
      if (lens.categorical) {
        typeKeyEl.hidden = true;
        typeKeyEl.innerHTML = '';
      } else {
        typeKeyEl.hidden = false;
        typeKeyEl.innerHTML = '<b>Dot colour</b>' + familiesPresent(displayPois)
          .map(f => `<span><i style="background:${f.color}"></i>${esc(f.label)} ×${f.count}</span>`).join('');
      }
    }
    /* The province overlay rides along in every lens, so the legend says what
       its ink means: how many provinces, and how many of them are contested —
       now shown by plain fill/labels instead of hatch marks. */
    const contestedCount = provinceList.filter(p => p.census.contested).length;
    const densityHint = state.pinDensity === 'auto' ? (density === 'key' ? 'key locations — zoom in for every pin' : 'every location') : (PIN_DENSITY[state.pinDensity]?.hint || 'auto-clustered');
    const clusterHint = clusterCount ? ` · ${clusterCount} cluster${clusterCount === 1 ? '' : 's'}` : '';
    const keyHint = hiddenKeyCount ? ` · ${hiddenKeyCount} tucked` : '';
    const plotHint = state.plots && provinceList.length ? ` · 🗺️ ${provinceList.length} provinces${contestedCount ? ` · ⚔ ${contestedCount} contested` : ''}` : '';
    if (lensEl) {
      if (lens.categorical) {
        const cats = topCats(displayPois, p => lens.catOf(p));
        lensEl.innerHTML = `<i style="background:${lens.color}"></i>${format(min)} – ${format(max)} ${esc(lens.unit)} · pin size = ${esc(lens.sizeLabel || lens.label)} · ${esc(densityHint)}${clusterHint}${keyHint}${major.size ? ' · ◎ top 5 ringed' : ''}${toks.length ? ` · 🛰️ ${toks.length} party` : ''} · ${legendChips(cats.cats, cats.more)}${plotHint}`;
      } else lensEl.innerHTML = `<i style="background:${lens.color}"></i>${lens.byType || !LENS_SHAPE[state.mode] ? '' : SHAPE_GLYPH[LENS_SHAPE[state.mode]] + ' '}${format(min)} – ${format(max)} ${esc(lens.unit)} · pin size = ${esc(lens.label)} · ${esc(densityHint)}${clusterHint}${keyHint}${major.size ? ' · ◎ top 5 ringed' : ''}${toks.length ? ` · 🛰️ ${toks.length} party` : ''}${plotHint}`;
    }
    overlay.innerHTML = (state.plots ? bordersSvg(provinceList, plotColor, map.id) : '') + transportPathSvg() + stationsHtml() + (state.plots ? provinceLabelsHtml() : '') + journeyPathSvg() + clusters.slice().sort((a, b) => Math.max(0, ...b.map(g => lensVal(g))) - Math.max(0, ...a.map(g => lensVal(g)))).map(group => {
      const poi = group[0];
      const faction = factionMeta(poi.factionId);
      const cat = lens.categorical ? lens.catOf(poi) : null;
      const top = Math.max(0, ...group.map(g => lensVal(g)));
      const weighted = (lens.categorical && !cat) ? 0.06 : weight(top);
      /* Dots stay dots. A lone pin gets a few pixels that barely grow with the
         lens, so a sheet reads as a scatter of points rather than a field of
         badges; only groups earn real size, because a group has a number to
         show and a door to be. */
      const diameter = group.length > 1
        ? Math.round(12 + weighted * 20 + Math.min(18, Math.log2(group.length) * 5))
        : Math.round(4 + Math.pow(weighted, 1.4) * 15);
      const isMajor = group.some(g => major.has(g.id));
      const extra = group.length > 1 ? `<em>${group.length}</em>` : '';
      const groupStops = group.map(g => stopByPoi.get(g.id)).filter(Boolean);
      const badge = groupStops.length === 1 ? `<b class="atlas-v2-stop">${esc(groupStops[0].n)}</b>`
        : groupStops.length > 1 ? `<b class="atlas-v2-stop atlas-v2-stop-multi">${groupStops.length}</b>` : '';
      const ids = group.map(g => g.id).join(',');
      /* A lone location is a DOT: no ring, no glyph, no label — just a
         coloured point at its filed coordinate, the way a printed atlas marks
         a place. Colour carries the one fact a dot has room for: what kind of
         place it is. The lens still tints groups and categorical views, where
         the reader has explicitly asked to see something else. */
      /* Dots are for the plain numeric lenses. A categorical lens (Species,
         Religion, Culture, Factions, Provinces) exists precisely to show WHICH
         category a pin belongs to, so there it keeps its glyph and its
         category colour — turning those into anonymous dots would delete the
         only thing the lens is for. */
      /* A categorical pin with no filed category is still a pin, just a quiet
         one: a small dim dot in its place-type colour, not a grey badge. That
         is what made Species, Religion and Culture read as a grey map — only
         pins with filed presence carry a category, so the rest step back. */
      const uncategorised = group.length === 1 && lens.categorical && !cat;
      const isDot = group.length === 1 && (!lens.categorical || !cat);
      /* Numeric lenses keep their own colour (population green, military red,
         economy gold, influence violet); size and brightness carry the value. */
      const tint = isDot ? ((lens.byType || uncategorised) ? typeColor(poi) : lens.color)
        : cat ? cat.color
        : (lens.categorical ? '#5b6b8a' : lens.color);
      const shape = isDot && !uncategorised && !lens.categorical && !lens.byType ? (LENS_SHAPE[state.mode] || 'disc') : '';
      const glow = isDot && !uncategorised && !lens.byType ? (0.1 + weighted * 0.9).toFixed(2) : '';
      const glyph = isDot ? ''
        : !lens.categorical ? faction.icon
        : !cat ? '●'
        : cat.img ? `<img class="atlas-v2-glyph" data-fb="${esc(cat.icon || '●')}" src="${esc(cat.img)}" alt="">`
        : esc(cat.icon || '●');
      const plotOf = group.map(g => pinProvince.get(g.id)).find(Boolean);
      const selectedStack = state.selected ? group.some(g => g.id === state.selected.id) : false;
      const inSelectedProvince = state.province ? group.some(g => (pinProvince.get(g.id) || {}).id === state.province) : true;
      const cx = Number.isFinite(group.x) ? group.x : poi.x;
      const cy = Number.isFinite(group.y) ? group.y : poi.y;
      /* Hover is the only thing a dot can say, so say the useful part: the
         name, then what kind of place it is. */
      const title = isDot
        ? esc(`${poi.name} · ${typeLabel(poi.type)}`)
        : esc(`${group.length} locations — click to zoom in: ` + group.map(g => g.name).join(', ') + (cat ? ` · ${cat.label}` : '') + (plotOf && !cat ? ` · ${plotOf.name}` : ''));
      const klass = `atlas-v2-marker${isDot ? ' atlas-v2-dot' : ''}${uncategorised ? ' atlas-v2-uncat' : ''}${shape ? ` atlas-v2-shape-${shape}` : ''}${group.length > 1 ? ' atlas-v2-cluster' : ''}${groupStops.length ? ' journey' : ''}${isMajor ? ' atlas-v2-major' : ''}${selectedStack ? ' selected' : ''}${inSelectedProvince ? '' : ' atlas-v2-dimmed'}`;
      return `<button type="button" class="${klass}" data-ids="${esc(ids)}" data-poi="${esc(poi.id)}" data-cx="${cx.toFixed(3)}" data-cy="${cy.toFixed(3)}" style="left:${cx}%;top:${cy}%;width:${diameter}px;height:${diameter}px;--marker:${tint};--intensity:${glow || (0.45 + weighted * 0.55).toFixed(2)}" title="${title}"><span>${glyph}</span>${extra}${badge}</button>`;
    }).join('');
    overlay.querySelectorAll('[data-poi]').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const ids = (btn.dataset.ids || '').split(',').filter(Boolean);
        if (ids.length > 1) {
          /* A cluster is a door, not a dead end: step INTO it. The sheet
             reframes on just these pins and everything else drops away, so
             the next click is about this place. Keep stepping until single
             pins remain; the breadcrumb walks back out. */
          const group = ids.map(id => pois.find(p => p.id === id)).filter(Boolean);
          const cx = Number(btn.dataset.cx) || 50;
          const cy = Number(btn.dataset.cy) || 50;
          if (drillInto(group, drillLabelFor(group))) return;
          /* No ceiling: stepping into a group always goes meaningfully
             deeper, however deep the reader already is. */
          centerOn(cx, cy, Math.max(state.scale * 1.85, 4.8));
          placePins();
          openLocalInset(ids, cx, cy);
          return;
        }
        const picked = pois.find(p => p.id === (ids[0] || btn.dataset.poi));
        if (picked) select(picked, ids);
      });
    });
    /* Faction pins carry logo art; a missing file swaps to the letter glyph
       instead of a broken-image box. (jsdom never fires this; browsers do.) */
    overlay.querySelectorAll('img.atlas-v2-glyph').forEach(im => {
      im.addEventListener('error', () => {
        const s = overlay.ownerDocument.createElement('span');
        s.textContent = im.dataset.fb || '●';
        im.replaceWith(s);
      });
    });
    overlay.querySelectorAll('[data-province]').forEach(shape => {
      if (shape.dataset.province === state.province) shape.classList.add('selected');
      const label = () => overlay.querySelector(`[data-plotlabel="${shape.dataset.province}"]`);
      shape.addEventListener('pointerenter', () => { const l = label(); if (l) l.classList.add('peek'); });
      shape.addEventListener('pointerleave', () => { const l = label(); if (l) l.classList.remove('peek'); });
      shape.addEventListener('click', ev => {
        ev.stopPropagation();
        if (state.dragged) return;
        const prov = provinceById.get(shape.dataset.province);
        if (prov) selectProvince(prov);
      });
    });
    /* Labels are clickable too — on a crowded sheet the label is a far bigger
       target than the plot it names. */
    overlay.querySelectorAll('[data-plotlabel]').forEach(el => {
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        if (state.dragged) return;
        const prov = provinceById.get(el.dataset.plotlabel);
        if (prov) selectProvince(prov);
      });
    });
    /* A route opens its logistics dossier: terminals, distance, status and
       capacity. The back button returns to whatever pin was selected. */
    overlay.querySelectorAll('[data-route-id]').forEach(el => {
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        if (state.dragged) return;
        const tr = transitRouteById.get(el.dataset.routeId);
        if (!tr) return;
        sidebar.innerHTML = transitRouteDossierHtml(tr, transitNet);
        sidebar.querySelectorAll('[data-jump-poi]').forEach(btn => btn.addEventListener('click', () => {
          const target = pois.find(p => p.id === btn.dataset.jumpPoi);
          if (!target) return;
          select(target, null, stopByPoi.get(target.id));
          centerOn(target.x, target.y, Math.max(state.scale, 4));
          placePins();
        }));
        const back = sidebar.querySelector('[data-transit-back]');
        if (back) back.addEventListener('click', () => { sidebar.innerHTML = detailHtml(state.selected || null, pois); });
        const frame = sidebar.querySelector('[data-transit-frame-route]');
        if (frame) frame.addEventListener('click', () => {
          centerOn((tr.u.x + tr.v.x) / 2, (tr.u.y + tr.v.y) / 2, Math.max(2.5, Math.min(state.scale || 1, 6)));
          placePins();
        });
      });
    });
    if (toks.length) {
      /* A party token is now the same size as the places it stands among, and
         it PULSES. Size was the wrong way to say "someone is here" — it just
         buried the map under the marker. A small mark that blinks is louder
         than a big one that sits still, and it costs the sheet nothing. */
      overlay.insertAdjacentHTML('beforeend', toks.map((t, i) => {
        const title = t.members.length > 1
          ? `${t.members.length} here: ` + t.members.map(m => `${m.name} (${m.recordName})`).join(', ')
          : `${t.name} — last seen: ${t.recordName} (${t.date || 'undated'})`;
        const stack = t.members.length > 1 ? `<em>${t.members.length}</em>` : '';
        return `<button type="button" class="atlas-v2-token" data-token="${i}" style="left:${t.x}%;top:${t.y}%" title="${esc(title)}"><span>${esc(t.icon)}</span>${stack}</button>`;
      }).join(''));
      overlay.querySelectorAll('[data-token]').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          const t = toks[Number(btn.dataset.token)];
          if (!t) return;
          overlay.querySelectorAll('[data-token]').forEach(b => b.classList.toggle('selected', b === btn));
          /* A grouped token opens everyone standing there, not just whoever
             happened to sort first. */
          const who = t.members.map(m => `<article class="atlas-v2-detail"><h3>${esc(m.icon)} ${esc(m.name)}</h3><p>Last filed appearance: <b>${esc(m.recordName)}</b><br>${esc(m.date || 'undated')}</p>${m.recordId ? `<button class="atlas-v2-wiki" data-open-article="${esc(m.recordId)}">Open the record</button>` : ''}</article>`).join('');
          sidebar.innerHTML = `<span class="atlas-v2-kicker">🛰️ party last seen${t.members.length > 1 ? ` · ${t.members.length} together` : ''}</span>${who}`;
        });
      });
    }
    /* Rebuilding the overlay replaces the focus ink along with everything
       else; put it back for whatever province is still selected. */
    markSelectedPlot();
  }

  /* Crowded sheets stack labels into an unreadable smudge, so they declutter:
     the bigger provinces claim their names first, and a label that would land
     on top of one already placed is tucked away rather than drawn over it.
     Labels are counter-scaled against the map zoom (see applyTransform), so
     zooming in spreads the provinces apart while the labels keep their size —
     more labels earn their place as the reader dives in. The selected or
     hovered province always shows its label. */
  function labelPlan() {
    const zoom = Math.max(0.2, state.scale || 1);
    const wPct = px => (state.box.w ? px / state.box.w * 100 : px);
    const hPct = px => (state.box.h ? px / state.box.h * 100 : px);
    const items = provinceList.map(prov => {
      const c = prov.census;
      const sub = c.contested ? '⚔ contested' : c.controller ? `${c.claimantShare}%` : '';
      const w = Math.max(prov.name.length * 6.6, sub.length * 5.4) + 10;
      const h = sub ? 26 : 15;
      return { prov, hw: wPct(w) / (2 * zoom), hh: hPct(h) / (2 * zoom) };
    }).sort((a, b) => (b.prov.area || 0) - (a.prov.area || 0) || (b.prov.census.power || 0) - (a.prov.census.power || 0));
    const placed = [];
    const kept = new Set(state.province ? [state.province] : []);
    /* Overview hierarchy: the whole continent shows only its largest provinces;
       the rest earn a name as the reader zooms toward them. The selected
       province is always named and does not count against the cap. */
    const cap = zoom < 1.6 ? 14 : zoom < 4 ? 32 : Infinity;
    let shown = 0;
    items.forEach(it => {
      const at = labelAt.get(it.prov.id) || it.prov;
      it.x = at.x; it.y = at.y;
      if (kept.has(it.prov.id)) { placed.push(it); return; }
      if (shown >= cap) return;
      if (placed.some(b => Math.abs(b.x - it.x) < b.hw + it.hw && Math.abs(b.y - it.y) < b.hh + it.hh)) return;
      placed.push(it);
      kept.add(it.prov.id);
      shown++;
    });
    return kept;
  }

  function refreshLabels() {
    if (!state.plots) return;
    const kept = labelPlan();
    overlay.querySelectorAll('[data-plotlabel]').forEach(el => {
      el.classList.toggle('tucked', !kept.has(el.dataset.plotlabel));
    });
  }

  function provinceLabelsHtml() {
    if (!provinceList.length) return '';
    const kept = labelPlan();
    return provinceList.map(prov => {
      const c = prov.census;
      const crown = c.contested ? '⚔ contested' : c.controller ? `${c.claimantShare}%` : '';
      return `<div class="atlas-v2-plotlabel${c.contested ? ' contested' : ''}${c.neutral ? ' neutral' : ''}${state.province === prov.id ? ' on' : ''}${kept.has(prov.id) ? '' : ' tucked'}" data-plotlabel="${esc(prov.id)}" style="left:${(labelAt.get(prov.id) || prov).x}%;top:${(labelAt.get(prov.id) || prov).y}%" title="${esc(prov.name)} — open its dossier"><b>${esc(prov.name)}</b>${crown ? `<i>${esc(crown)}</i>` : ''}</div>`;
    }).join('');
  }

  /* The selected province gets its own ink by brightening the real border
     segments that already outline it. That avoids drawing the internal seams of
     compound POI cells as a fake gold web. */
  function markSelectedPlot() {
    const svg = overlay.querySelector('.atlas-v2-borders');
    if (!svg) return;
    const prov = provinceById.get(state.province);
    svg.querySelectorAll('.atlas-v2-edge').forEach(edge => {
      const ids = `${edge.dataset.edgeOwner || ''} ${edge.dataset.edgeProvinces || ''}`.trim().split(/\s+/).filter(Boolean);
      edge.classList.toggle('focused', !!(prov && ids.includes(prov.id)));
    });
  }

  function selectProvince(prov, how) {
    if (!prov) return;
    state.province = prov.id;
    state.selected = null;
    state.pinLimit = (how && how.allPins) ? prov.pois.length : 0;
    overlay.querySelectorAll('[data-province]').forEach(el => el.classList.toggle('selected', el.dataset.province === prov.id));
    overlay.querySelectorAll('[data-plotlabel]').forEach(el => {
      el.classList.toggle('on', el.dataset.plotlabel === prov.id);
      if (el.dataset.plotlabel === prov.id) el.classList.remove('tucked');
    });
    overlay.querySelectorAll('[data-poi]').forEach(el => {
      const stack = (el.dataset.ids || el.dataset.poi || '').split(',');
      const belongs = stack.some(id => (pinProvince.get(id) || {}).id === prov.id);
      el.classList.toggle('atlas-v2-dimmed', !belongs);
    });
    markSelectedPlot();
    closeBoard();
    const other = prov.sourceMapId && prov.sourceMapId !== map.id && MAP_DATA[prov.sourceMapId] ? prov.sourceMapId : '';
    sidebar.innerHTML = provinceDossierHtml(prov, {
      colorOf: factionMeta, pins: pois, rollup: census ? census.rollup : null,
      onNation: (how && how.allPins) ? other : other, limit: state.pinLimit || 9,
    });
    /* Flying to a province never zooms the reader out — on a crowded sheet the
       zoom they already chose is part of the answer. */
    if (how && how.centre !== false) centerOn(prov.x, prov.y, Math.max(state.scale, 2.1));
  }

  /* ---- the shortlist: a way to actually choose a pin ---- */
  function visiblePins() {
    return currentVisiblePois.length ? currentVisiblePois.slice() : pois;
  }

  function boardFor(pool) {
    const lens = modes[state.mode] || MODES.population;
    const lensVal = p => (lens.value ? lens.value(p) : (Number(p[lens.key]) || 0));
    const board = rankShortlist(pool, provinceList, {
      top: opts.shortlistSize || 6,
      nonce: state.nonce,
      lensValue: lensVal,
      lensLabel: String(lens.label || 'population').toLowerCase(),
    });
    return state.nonce ? Object.assign({}, board, { picks: board.reroll(state.nonce) }) : board;
  }

  function renderBoard() {
    if (!state.board) return;
    const pool = state.board.provinceId ? (((provinceById.get(state.board.provinceId) || {}).pois) || []) : visiblePins();
    state.boardData = boardFor(pool);
    state.pickIndex = Math.min(state.pickIndex, Math.max(0, state.boardData.picks.length - 1));
    sidebar.innerHTML = shortlistHtml(state.boardData, state);
  }

  function openBoard(provinceId) {
    state.board = { provinceId: provinceId || null };
    state.pickIndex = 0;
    state.province = provinceId || state.province;
    renderBoard();
  }

  function closeBoard() {
    if (!state.board) return;
    state.board = null;
    state.boardData = null;
    state.nonce = 0;
  }

  function pickRow(row) {
    if (!row) return;
    const poi = pois.find(p => p.id === row.id);
    closeBoard();
    if (!poi) return;
    select(poi, null, stopByPoi.get(poi.id));
    const prov = pinProvince.get(poi.id);
    if (prov) {
      state.province = prov.id;
      overlay.querySelectorAll('[data-province]').forEach(el => el.classList.toggle('selected', el.dataset.province === prov.id));
      overlay.querySelectorAll('[data-plotlabel]').forEach(el => el.classList.toggle('on', el.dataset.plotlabel === prov.id));
      markSelectedPlot();
    }
    if (ready) centerOn(poi.x, poi.y, Math.max(state.scale, 3.4));
    else pendingFocus = { id: poi.id, z: 3.4, stop: null };
  }

  function boardKeys(event) {
    if (!state.board || !host.isConnected) return;
    const picks = (state.boardData || {}).picks || [];
    if (event.key === 'Escape') { event.preventDefault(); closeBoard(); sidebar.innerHTML = detailHtml(state.selected, pois); return; }
    if (!picks.length) return;
    if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); state.pickIndex = (state.pickIndex + 1) % picks.length; renderBoard(); }
    else if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); state.pickIndex = (state.pickIndex - 1 + picks.length) % picks.length; renderBoard(); }
    else if (event.key === 'Enter') { event.preventDefault(); pickRow(picks[state.pickIndex]); }
  }
  if (BOARD_KEYS) document.removeEventListener('keydown', BOARD_KEYS);
  BOARD_KEYS = boardKeys;
  document.addEventListener('keydown', BOARD_KEYS);

  /* Deep-link focus: a location article's "Open in the World Atlas" chip lands the
     reader on this sheet with the matching pin already selected and centred.
     The journey stepper drives the same path through the returned handle. */
  let ready = false;
  let pendingFocus = null;
  function centerOn(x, y, z) {
    const vw = viewport.clientWidth || 1;
    const vh = viewport.clientHeight || 1;
    const box = state.box;
    const px = box.left + box.w * x / 100;
    const py = box.top + box.h * y / 100;
    state.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(z) || 1));
    state.tx = vw / 2 - px * z;
    state.ty = vh / 2 - py * z;
    applyTransform();
  }

  function openLocalInset(ids, cx, cy) {
    const stack = (ids || []).map(id => pois.find(p => p.id === id)).filter(Boolean)
      .sort((a, b) => defaultPinScore(b) - defaultPinScore(a) || String(a.name || '').localeCompare(String(b.name || '')));
    if (stack.length < 2) return false;
    const kind = settlementInsetKind(stack);
    const positions = localInsetPositions(stack, cx, cy);
    const typeCounts = [...stack.reduce((m, p) => m.set(humanize(p.type || 'location'), (m.get(humanize(p.type || 'location')) || 0) + 1), new Map()).entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const pinButtons = positions.map(({ poi, x, y }, i) => {
      const faction = factionMeta(poi.factionId);
      return `<button type="button" class="atlas-v2-inset-pin" data-inset-jump="${esc(poi.id)}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--marker:${esc(faction.color)}" title="${esc(poi.name)}"><span>${i + 1}</span></button>`;
    }).join('');
    const rows = stack.map((poi, i) => `<button type="button" data-inset-jump="${esc(poi.id)}"><b>${i + 1}</b><span>${esc(poi.name)}<i>${esc(humanize(poi.type || 'location'))} · ${format(poi.population)} residents</i></span></button>`).join('');
    sidebar.innerHTML = `<article class="atlas-v2-detail atlas-v2-inset">
      <span class="atlas-v2-kicker">${esc(kind.icon)} ${esc(kind.label)} · ${stack.length} crowded POIs</span>
      <h3>${esc(stack[0].name)} and nearby filings</h3>
      <p>These pins were too close to read on the main sheet, so the desk opened a local inset and spread them apart. The geography stays anchored to the same x/y marks; the inset is a reader's magnifier, not a new province survey.</p>
      <div class="atlas-v2-inset-map" role="group" aria-label="${esc(kind.label)} for ${esc(stack[0].name)}">${pinButtons}</div>
      <div class="atlas-v2-inset-meta">${typeCounts.map(([name, n]) => `<span>${esc(name)} ×${n}</span>`).join('')}</div>
      <div class="atlas-v2-inset-list">${rows}</div>
      <div class="atlas-v2-picktools"><button type="button" data-inset-unroll>Unroll all POIs here</button><button type="button" data-inset-close>Back to selected pin</button></div>
    </article>`;
    sidebar.querySelectorAll('[data-inset-jump]').forEach(button => button.addEventListener('click', () => {
      const poi = pois.find(p => p.id === button.dataset.insetJump);
      if (!poi) return;
      select(poi, null, stopByPoi.get(poi.id));
      centerOn(poi.x, poi.y, Math.max(state.scale, 6.2));
      placePins();
    }));
    const unroll = sidebar.querySelector('[data-inset-unroll]');
    if (unroll) unroll.addEventListener('click', () => {
      state.pinDensity = 'all';
      renderDensityButton();
      centerOn(cx, cy, Math.max(state.scale, 7));
      placePins();
    });
    const close = sidebar.querySelector('[data-inset-close]');
    if (close) close.addEventListener('click', () => {
      const picked = stack[0];
      if (picked) select(picked, ids, stopByPoi.get(picked.id));
    });
    return true;
  }

  function focusOn(id, z, stop) {
    const poi = pois.find(p => p.id === id);
    if (!poi) return false;
    select(poi, null, stop);
    if (!ready) { pendingFocus = { id, z: z || 3.2, stop: stop || null }; return true; }
    centerOn(poi.x, poi.y, z || 3.2);
    placePins();
    return true;
  }
  /* A province deep link (the atlas nation page's census rows) waits for the
     same ready flag as a pin does, so the border is drawn before it is flown to. */
  let pendingPlot = opts.focusProvince || null;
  function focusProvince(id) {
    if (!id) return false;
    const prov = provinceById.get(id);
    if (!prov) return false;
    state.plots = true;
    const btn = host.querySelector('[data-action="plots"]');
    if (btn) btn.classList.add('active');
    placePins();
    selectProvince(prov);
    return true;
  }

  function select(poi, ids, stopOverride) {
    state.selected = poi;
    /* A clustered pin lights its cluster marker even when it is not the
       representative: match the whole id stack, not just data-poi. */
    overlay.querySelectorAll('[data-poi]').forEach(item => {
      const stack = (item.dataset.ids || item.dataset.poi || '').split(',');
      item.classList.toggle('selected', stack.includes(poi.id));
    });
    if (ids && ids.length > 1) {
      const stack = ids.map(id => pois.find(p => p.id === id)).filter(Boolean);
      const rows = stack.map(p => {
        const st = stopByPoi.get(p.id);
        return `<button data-jump="${esc(p.id)}">${st ? `<b class="atlas-v2-stopinline">${esc(st.n)}</b>` : ''}${esc(p.name)}</button>`;
      }).join('');
      sidebar.innerHTML = `<article class="atlas-v2-detail"><span class="atlas-v2-kicker">stacked pins</span><h3>${stack.length} locations share this mark</h3><p>Same painted coordinate. Pick one.</p>${rows}</article>`;
      return;
    }
    sidebar.innerHTML = stopBannerHtml(stopOverride || stopByPoi.get(poi.id)) + detailHtml(poi, pois);
    /* Location records load asynchronously. If a pin is opened before the
       fetch settles, redraw that same pin once -- and only if it is still the
       selected one, so a fast clicker never gets a stale panel. */
    if (!LOC_BY_ID.size) {
      loadLocationRecords().then(() => {
        if (state.selected && state.selected.id === poi.id && LOC_BY_ID.size) {
          sidebar.innerHTML = stopBannerHtml(stopOverride || stopByPoi.get(poi.id)) + detailHtml(poi, pois);
          sidebar.querySelectorAll('.atlas-v2-factionmark img').forEach(im => {
            im.addEventListener('error', () => im.remove());
          });
        }
      });
    }
    /* A missing logo file reveals the color dot it sits on. */
    sidebar.querySelectorAll('.atlas-v2-factionmark img').forEach(im => {
      im.addEventListener('error', () => im.remove());
    });
  }

  function applyFilter() {
    placePins();
  }

  img.addEventListener('load', () => {
    placePins();
    ready = true;
    if (pendingPlot) { focusProvince(pendingPlot); pendingPlot = null; }
    else if (pendingFocus) { focusOn(pendingFocus.id, pendingFocus.z, pendingFocus.stop); pendingFocus = null; }
    else if (opts.focusPoi) focusOn(opts.focusPoi);
    else if (opts.focus && Number.isFinite(opts.focus.x) && Number.isFinite(opts.focus.y)) {
      centerOn(opts.focus.x, opts.focus.y, opts.focus.scale || 2.6);
      placePins();
    }
    else if (!isFull) fitRegion();
    else { state.scale = 1; state.tx = 0; state.ty = 0; applyTransform(); placePins(); }
  });
  if (img.complete) img.dispatchEvent(new Event('load'));
  window.addEventListener('resize', () => { placePins(); });

  host.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    host.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === button));
    const lens = modes[state.mode] || MODES.population;
    if (lens.categorical) {
      const filed = pois.filter(p => { try { return !!lens.catOf(p); } catch { return false; } }).length;
      host.querySelector('[data-mode-total]').textContent = `${filed} of ${pois.length} pins filed`;
    } else {
      const lv = p => lens.value ? lens.value(p) : (Number(p[lens.key]) || 0);
      host.querySelector('[data-mode-total]').textContent = `${format(pois.reduce((n, p) => n + lv(p), 0))} ${lens.unit}`;
    }
    placePins();
  }));
  host.querySelector('[data-action="wiki"]').addEventListener('click', event => {
    state.wikiOnly = !state.wikiOnly;
    event.currentTarget.classList.toggle('active', state.wikiOnly);
    applyFilter();
  });
  const plotsBtn = host.querySelector('[data-action="plots"]');
  if (plotsBtn) plotsBtn.addEventListener('click', event => {
    state.plots = !state.plots;
    event.currentTarget.classList.toggle('active', state.plots);
    if (!state.plots) { state.province = null; }
    placePins();
  });
  const routesBtn = host.querySelector('[data-action="routes"]');
  if (routesBtn) routesBtn.addEventListener('click', event => {
    state.routes = !state.routes;
    event.currentTarget.classList.toggle('active', state.routes);
    placePins();
  });
  host.classList.toggle('atlas-v2-bigpins', state.bigPins);
  const bigPinsBtn = host.querySelector('[data-action="bigpins"]');
  if (bigPinsBtn) bigPinsBtn.addEventListener('click', event => {
    state.bigPins = !state.bigPins;
    event.currentTarget.classList.toggle('active', state.bigPins);
    host.classList.toggle('atlas-v2-bigpins', state.bigPins);
  });

  const densityBtn = host.querySelector('[data-action="density"]');
  function renderDensityButton() {
    if (!densityBtn) return;
    const d = PIN_DENSITY[state.pinDensity] || PIN_DENSITY.smart;
    densityBtn.textContent = d.label;
    densityBtn.dataset.density = state.pinDensity;
    densityBtn.classList.toggle('active', state.pinDensity !== 'smart');
    densityBtn.title = d.hint;
  }
  renderDensityButton();
  if (densityBtn) densityBtn.addEventListener('click', () => {
    const i = PIN_DENSITY_ORDER.indexOf(state.pinDensity);
    state.pinDensity = PIN_DENSITY_ORDER[(i + 1) % PIN_DENSITY_ORDER.length];
    renderDensityButton();
    placePins();
  });
  host.querySelector('[data-action="shortlist"]').addEventListener('click', event => {
    if (state.board) { closeBoard(); sidebar.innerHTML = detailHtml(state.selected, pois); event.currentTarget.classList.remove('active'); return; }
    openBoard(null);
    event.currentTarget.classList.add('active');
  });
  host.querySelector('[data-search]').addEventListener('input', applyFilter);
  host.querySelector('[data-type]').addEventListener('change', applyFilter);
  host.querySelector('[data-action="labels"]').addEventListener('click', event => {
    host.classList.toggle('atlas-v2-labels');
    event.currentTarget.classList.toggle('active');
  });
  function reframe() {
    if (!isFull) fitRegion();
    else { state.scale = 1; state.tx = 0; state.ty = 0; applyTransform(); placePins(); }
  }
  host.querySelector('[data-action="fit"]').addEventListener('click', () => {
    /* Reset view means all the way out, including out of every drill level. */
    state.drill.length = 0;
    renderBreadcrumb();
    sidebar.innerHTML = detailHtml(null, pois);
    reframe();
  });
  /* Zoom buttons: the wheel is not available to every reader or every device,
     and holding a deep-zoom map should not require a mouse. Each press is the
     same proportional step the wheel takes, about the centre of the view. */
  function zoomBy(factor) {
    const vw = viewport.clientWidth || 1;
    const vh = viewport.clientHeight || 1;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.scale * factor));
    const k = next / state.scale;
    state.tx = vw / 2 - (vw / 2 - state.tx) * k;
    state.ty = vh / 2 - (vh / 2 - state.ty) * k;
    state.scale = next;
    applyTransform();
    placePins();
  }
  host.querySelector('[data-action="zoomin"]').addEventListener('click', () => zoomBy(1.6));
  host.querySelector('[data-action="zoomout"]').addEventListener('click', () => zoomBy(1 / 1.6));
  host.querySelector('[data-action="zoomreset"]').addEventListener('click', () => {
    state.drill.length = 0;
    renderBreadcrumb();
    reframe();
  });

  /* Full screen: the host becomes a fixed overlay so the painted sheet fills
     the viewport instead of a card column. Both the atlas page and the
     cartography desk mount through here, so both inherit the button. */
  const expandBtn = host.querySelector('[data-action="expand"]');
  function setExpanded(on) {
    host.classList.toggle('atlas-v2-full', on);
    expandBtn.classList.toggle('active', on);
    expandBtn.textContent = on ? '✕ Exit full screen' : '⛶ Full screen';
    /* Lock the page scroll behind the overlay; the overlay itself scrolls. */
    document.body.style.overflow = on ? 'hidden' : '';
    placePins();
    reframe();
  }
  expandBtn.addEventListener('click', () => setExpanded(!host.classList.contains('atlas-v2-full')));
  /* Wired once per page, not once per mount: region switches re-mount the
     renderer into the same host, and stacked document listeners would all fire. */
  if (!window.__atlasV2ChromeWired) {
    window.__atlasV2ChromeWired = true;
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.atlas-v2-full [data-action="expand"].active').forEach(b => b.click());
    });
    /* Navigating away destroys the host; never leave the page scroll-locked. */
    window.addEventListener('hashchange', () => {
      if (!document.querySelector('.atlas-v2-full')) document.body.style.overflow = '';
    });
  }
  sidebar.addEventListener('click', event => {
    const jump = event.target.closest('[data-jump]');
    if (jump) {
      const poi = pois.find(p => p.id === jump.dataset.jump);
      if (poi) select(poi);
    }
    const pick = event.target.closest('[data-pick]');
    if (pick && state.boardData) {
      pickRow(state.boardData.picks.find(r => r.id === pick.dataset.pick));
      const btn = host.querySelector('[data-action="shortlist"]');
      if (btn) btn.classList.remove('active');
      return;
    }
    if (event.target.closest('[data-pickroll]')) { state.nonce += 1; renderBoard(); return; }
    if (event.target.closest('[data-pickclose]')) {
      const prov = state.province && provinceById.get(state.province);
      closeBoard();
      sidebar.innerHTML = prov ? provinceDossierHtml(prov, { colorOf: factionMeta, pins: pois, rollup: census ? census.rollup : null, onNation: '', limit: 9 }) : detailHtml(state.selected, pois);
      return;
    }
    const pickHere = event.target.closest('[data-pickprovince]');
    if (pickHere) { openBoard(pickHere.dataset.pickprovince); return; }
    const more = event.target.closest('[data-moreprovince]');
    if (more) { const prov = provinceById.get(more.dataset.moreprovince); if (prov) selectProvince(prov, { allPins: true, centre: false }); return; }
    const openMap = event.target.closest('[data-open-map]');
    if (openMap) {
      const wanted = openMap.dataset.openMap;
      const chip = [...document.querySelectorAll('.amr-chip')].find(b => b.dataset.map === wanted);
      if (chip) chip.click();
      else if (typeof opts.onMapSwitch === 'function') opts.onMapSwitch(wanted);
      return;
    }
    const open = event.target.closest('[data-open-article]');
    if (open && typeof window.openId === 'function') window.openId(open.dataset.openArticle);
  });

  /* Escape steps back out one drill level — the cheap way out of a deep dive
     without hunting for the breadcrumb. Only while this map is on screen. */
  host.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !state.drill.length) return;
    event.stopPropagation();
    drillTo(state.drill.length - 1);
  });
  if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');

  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    /* Zoom compounds, so the wheel keeps its feel at every depth: one notch is
       always the same PROPORTION of the current scale, whether the reader is
       looking at a continent or at one street of a town. A fixed step would
       crawl at 1x and teleport at 100x. */
    const step = event.deltaY < 0 ? 1.16 : 1 / 1.16;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.scale * step));
    const k = next / state.scale;
    state.tx = mx - (mx - state.tx) * k;
    state.ty = my - (my - state.ty) * k;
    state.scale = next;
    applyTransform();
    placePins();
  }, { passive: false });

  let drag = null;
  /* Capturing the pointer on pointerdown felt harmless and was not: while the
     capture is held, every later event of that pointer — the click included —
     is retargeted to the viewport, so nothing under the map (province plots
     first among them) could ever be clicked. Capture is therefore taken only
     once the gesture has proved itself a drag; a press that never moves stays
     a click wherever it landed. */
  viewport.addEventListener('pointerdown', event => {
    if (event.target.closest('.atlas-v2-marker') || event.target.closest('.atlas-v2-token')) return;
    drag = { x: event.clientX, y: event.clientY, tx: state.tx, ty: state.ty, held: false };
    state.dragged = false;
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag) return;
    /* A pointerup outside the viewport (or a lost pointer) leaves a stale drag
       behind; a move with no buttons held ends it instead of panning. */
    if (!event.buttons) { drag = null; state.dragged = false; return; }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.held && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.held = true;
      state.dragged = true;
      try { viewport.setPointerCapture(event.pointerId); } catch { /* capture is an optimisation, not a promise */ }
    }
    if (!drag.held) return;
    state.tx = drag.tx + dx;
    state.ty = drag.ty + dy;
    applyTransform();
  });
  /* The click event fires after pointerup, so the flag cannot be cleared in
     the same gesture — release it one task later. */
  viewport.addEventListener('pointerup', () => { drag = null; setTimeout(() => { state.dragged = false; }, 0); });
  viewport.addEventListener('pointercancel', () => { drag = null; state.dragged = false; });

  /* Control handle for the cartography desk's journey stepper. Existing
     callers ignore the return value; their behaviour is unchanged. */
  return {
    focus: (poiId, z, stop) => focusOn(poiId, z, stop),
    center: (x, y, z) => { if (ready) centerOn(x, y, z || 2.6); },
    select: (poiId, stop) => { const p = pois.find(q => q.id === poiId); if (p) select(p, null, stop); },
    getPois: () => pois.slice(),
    getStops: () => stops.slice(),
    /* Province census surface: the atlas nation page and the cartography desk
       both link straight into a province dossier with these. */
    getProvinces: () => provinceList.map(p => ({
      id: p.id, name: p.name, kind: p.origin, controller: p.census.controller,
      contested: p.census.contested, pins: p.census.pins, population: p.census.population,
      share: p.census.claimantShare, seatPoiId: p.seat ? p.seat.id : null, sourceMapId: p.sourceMapId,
      vacant: !!p.vacant, shape: p.shape, ledger: !!p.delta,
    })),
    getCensus: () => (census ? { ...census, provinces: provinceList.map(p => p.id) } : null),
    selectProvince: provinceId => focusProvince(provinceId),
    openShortlist: () => { openBoard(null); return true; },
  };
}
