(() => {
'use strict';
// Keep useful error pages and their URL intact instead of booting the galaxy over them.
if (document.querySelector('#serverContent[data-state="error"]')) return;
document.querySelector('#app')?.removeAttribute('hidden');

/* ================= CONFIG ================= */
/* Supabase project "expanse" (Stockholm). The publishable key is public by design: tables are
   locked, and the browser can only call the RPC functions and the verify-domain function. */
const SUPA = { url: 'https://gjmkhnrgznorxxaemsmo.supabase.co', key: 'sb_publishable_b1uzRroOaHTGp9oXOhHjtQ_J-A-IUCZ' };
const FOUNDING_LIMIT = 1000;
/* Keep in sync with zone_of() and price_per_cell() in Supabase. */
const ZONES = [
  { id: 'core',  label: 'Spotlight',  r: 14,       price: 0,  color: '#ffffff', reserved: true, line: 'Earned by real use, never sold.' },
  { id: 'inner', label: 'Inner ring', r: 40,       price: 19, color: '#c8ff3d', line: 'Close to the core.' },
  { id: 'belt',  label: 'Belt',       r: 80,       price: 9,  color: '#5ee1ff', line: 'Where the universe gets busy.' },
  { id: 'outer', label: 'Outer rim',  r: 125,      price: 4,  color: '#b39cff', line: 'Room to grow out here.' },
  { id: 'edge',  label: 'Edge',       r: Infinity, price: 1,  color: '#8b94c9', line: 'Out on the frontier.' }
];
const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));
const WORLD_R = 150, CORE_R = 14, CELL = 16, ZMIN = .025, ZMAX = 6, MAX_R = WORLD_R + 25;
const OWNED_KEY = 'expanse.owned.v1', REF_KEY = 'expanse.ref', RECOVER_KEY = 'expanse.recover.v1', DRAFT_KEY = 'expanse.draft.v1', FOLLOW_KEY = 'expanse.follow.v1';
const VOTER_KEY = 'expanse.voter.v1', VOTES_KEY = 'expanse.votes.v1';
const SAVED_KEY = 'expanse.saved.v1', ACTIVITY_KEY = 'expanse.activity.v1';

/* Keep in sync with the category / pricing / platform checks on public.products. */
const CATS = {
  productivity: { label: 'Productivity',       color: '#c8ff3d', rgb: '200,255,61' },
  developer:    { label: 'Developer tools',    color: '#5ee1ff', rgb: '94,225,255' },
  design:       { label: 'Design',             color: '#ff5c7a', rgb: '255,92,122' },
  marketing:    { label: 'Marketing & sales',  color: '#ffcf4a', rgb: '255,207,74' },
  finance:      { label: 'Finance & admin',    color: '#3dff8a', rgb: '61,255,138' },
  ai:           { label: 'AI',                 color: '#b39cff', rgb: '179,156,255' },
  commerce:     { label: 'E-commerce',         color: '#ff9f43', rgb: '255,159,67' },
  education:    { label: 'Education',          color: '#7aa8ff', rgb: '122,168,255' },
  health:       { label: 'Health & wellbeing', color: '#ff7ad9', rgb: '255,122,217' },
  other:        { label: 'Other',              color: '#c3caf0', rgb: '195,202,240' }
};
const PRICING = { unspecified: 'Not specified', free: 'Free', freemium: 'Free plan', trial: 'Free trial', paid: 'Paid' };
const PLATFORMS = { web: 'Web', ios: 'iOS', android: 'Android', macos: 'macOS', windows: 'Windows', linux: 'Linux', api: 'API', extension: 'Browser extension' };
const NEED_IDEAS = ['send invoices', 'track time', 'book meetings', 'manage projects', 'take notes', 'write content', 'design graphics', 'build a website', 'sell online', 'collect payments', 'manage customers', 'send newsletters', 'schedule social posts', 'analyze data', 'automate workflows', 'support customers', 'hire people', 'learn something new', 'monitor uptime', 'share files'];

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const $ = s => document.querySelector(s);
const now = () => performance.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = n => Number(n || 0).toLocaleString('en');
const eur = n => '€' + fmt(n);
const plural = (n, one, many) => fmt(n) + ' ' + (n === 1 ? one : many);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const app = $('#app');
const timeAgo = iso => { const s = (Date.now() - Date.parse(iso)) / 1000; if (!(s >= 60)) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };
const dateStr = iso => { try { return new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
const marketing = window.ExpanseMarketing;
const campaignLanding = marketing.landing(location.href);
function discoveryUrl(value, slug) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return value;
    if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', 'expanse');
    if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', 'referral');
    if (campaignLanding?.slug === slug && !url.searchParams.has('utm_campaign')) url.searchParams.set('utm_campaign', campaignLanding.campaign);
    return url.href;
  } catch (e) { return value; }
}
const isSlug = s => typeof s === 'string' && /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/.test(s);

/* ================= DEMO UNIVERSE =================
   A fixed-seed galaxy of example squares. In normal mode it is only drawn as faint dust that
   gives the galaxy its shape; demo mode shows the squares themselves, clearly labelled. */
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry(20261012);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * rnd()); };

const MODES = {
  sell:   { label: 'Sell',    color: '#ffcf4a', rgb: '255,207,74' },
  create: { label: 'Create',  color: '#ff5c7a', rgb: '255,92,122' },
  build:  { label: 'Build',   color: '#5ee1ff', rgb: '94,225,255' },
  hire:   { label: 'Hire me', color: '#3dff8a', rgb: '61,255,138' }
};
const CITIES = ['Stockholm','Göteborg','Malmö','Uppsala','Lund','Umeå','Oslo','Copenhagen','Berlin','Helsinki','Amsterdam','London','Lisbon','Barcelona','Paris','New York','Tokyo','Reykjavík'];
const NAMES = {
  sell: ['Volvo 240','Saab 900 Turbo','VW Bus 1974','Lund Vintage','Fiskbod Smögen','Hemslöjd Umeå','Nordlys Prints','Notion CRM kit','Bageri Söder','Pho Hanoi','Pizzeria Luna','Vinyl crate #12','Fika Box','Linen & Oak','Cykelverkstan','Retro Consoles','Plant Swap','Kaffe Kollektiv','Moss Candles','Sill & Co','Ramen Ronin','Glasblåsarn','Tape & Thread','Kiln Club'],
  create: ['Lo-Fi Tomten','Nattklubb 404','Pernilla P','Blue Hour','Dödsrit','Vera Ek','Ink & Salt','Fjällvandra','Mats Cooks','Pixel Diaries','Neon Fjord','Tape Hiss','North Light Films','Kladd','Sofia Draws','Brus Radio','Synth Saga','Midnight Sauna','Paper Moons','Ödemark'],
  build: ['VATify','CSV Cleaner','Pixelnote','Shiplog','Tabby','Fjord Analytics','Orbit Notes','QR Reorder','SyncStock','Lagom UI','Ping Pal','Uptime Uggla','Formfix','Stack Sauna','Diffy','Kvitto','Lingon DB','Moose Mail','Polar Pay','Gravel CI'],
  hire: ['Jonas · Plumber','Sara · Photographer','Nils · Fullstack','Amira · Copy','Hugo · Electrician','Maja · Illustrator','Leo · Video edit','Petra · Accountant','Ali · Motion','Ida · Brand','Oskar · Carpenter','Noor · iOS','Frida · Tattoo','Elias · DJ']
};
const TAGS = {
  sell: ['Ships from {c}','Small batch · {c}','Open today · {c}','Handmade in {c}'],
  create: ['New drop every week','Live on Fridays','Prints & zines','New single out'],
  build: ['Open source','Indie SaaS','CLI tool','iOS + Android'],
  hire: ['Same-day jobs · {c}','Remote · EU','Weekend slots · {c}','Booking for spring']
};
const KW = { sell: 'shop buy store sell price product', create: 'music video art creator youtube tiktok spotify', build: 'app saas tool github developer code open source', hire: 'hire freelance book available freelancer' };

let texDirty = true;
const DEMO = [], docc = new Map(), K = (x, y) => x + ',' + y;
const dFree = (x, y, w, h) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (docc.has(K(x + i, y + j))) return false; return true; };
function dput(q) {
  q.id = DEMO.length; q.w = q.h = q.size;
  for (let i = 0; i < q.size; i++) for (let j = 0; j < q.size; j++) docc.set(K(q.x + i, q.y + j), q);
  q.d = Math.hypot(q.x + q.size / 2, q.y + q.size / 2); DEMO.push(q); return q;
}
const ago = d => d === 0 ? 'today' : d === 1 ? 'yesterday' : d + 'd ago';
function receipts(s) {
  const a = ago(s.last);
  if (s.mode === 'sell') return [ri(12, 800) + ' sold', 'ships from ' + s.city, 'last sale ' + a];
  if (s.mode === 'create') return [ri(1, 60) + 'k followers', 'posted ' + a, ri(2, 40) + ' pieces'];
  if (s.mode === 'build') return [(s.last < 30 ? ri(3, 40) : 0) + ' commits / wk', fmt(ri(20, 4000)) + ' stars', 'last push ' + a];
  return [s.avail ? 'available now' : 'booked until ' + pick(['May', 'June', 'Sept']), ri(5, 80) + ' bookings', 'based in ' + s.city];
}
function gen(x, y, size, mode, extra) {
  const m = mode || pick(['sell', 'sell', 'create', 'create', 'build', 'hire']);
  const u = rnd(), last = u < .55 ? ri(0, 6) : u < .8 ? ri(7, 29) : u < .93 ? ri(30, 89) : ri(90, 220);
  const q = { demo: true, x, y, size, mode: m, name: pick(NAMES[m]), city: pick(CITIES), last, avail: rnd() < .7 };
  Object.assign(q, extra || {});
  if (!q.tag) q.tag = pick(TAGS[q.mode]).replace('{c}', q.city);
  if (!q.rec) q.rec = receipts(q);
  return dput(q);
}
const FEATURED = [
  [-4, -12, 8, 'sell', { name: 'Sushi Yama', city: 'Stockholm', tag: 'Cheap sushi lunch · Söder', last: 0, rec: ['1,912 sold', 'ships from Stockholm', 'last sale today'], kw: 'sushi lunch food cheap restaurant' }],
  [5, 2, 4, 'create', { name: 'Kajsa & The Tides', city: 'Malmö', tag: 'Indie folk · new single out', last: 0, rec: ['38k listeners', 'posted today', '12 tracks'], kw: 'music band indie folk spotify' }],
  [-11, 0, 4, 'build', { name: 'DeployCheck', city: 'Göteborg', tag: 'Catch deploy errors before they ship', last: 0, rec: ['14 commits / wk', '2,310 stars', 'last push today'], kw: 'deploy vercel ci check developer tool' }],
  [-2, 6, 4, 'create', { name: 'Studio Mira', city: 'Copenhagen', tag: 'Ceramics · weekly studio vlogs', last: 0, rec: ['22k followers', 'posted today', '96 pieces'], kw: 'ceramics pottery video craft' }],
  [20, -14, 4, 'sell', { name: 'Volvo 240 GL', city: 'Uppsala', tag: '1991 · 21,000 km · one owner', last: 3, rec: ['€4,900', 'listed 3d ago', 'in Uppsala'], kw: 'volvo car classic vintage' }],
  [-30, -18, 4, 'sell', { name: 'Icon Pack Vol.3', city: 'Berlin', tag: '480 icons · Figma + SVG', last: 0, rec: ['212 sold', 'updated today', '4.9 ★'], kw: 'icons figma design svg ui' }],
  [10, 24, 4, 'hire', { name: 'Elin · UX', city: 'Stockholm', tag: 'Product design · booking for June', avail: false, last: 2, rec: ['booked until June', '44 bookings', 'based in Stockholm'], kw: 'ux design designer product figma' }],
  [-20, 18, 2, 'hire', { name: 'Fix my bike', city: 'Malmö', tag: 'Mobile bike repair · same day', last: 1, avail: true, rec: ['available now', '61 bookings', 'based in Malmö'], kw: 'bike repair cycle fix mechanic' }],
  [32, 8, 2, 'build', { name: 'Kronor.js', city: 'Oslo', tag: 'Currency formatting in 2 kB', last: 0, rec: ['9 commits / wk', '880 stars', 'last push today'], kw: 'javascript library currency npm' }],
  [-62, 38, 8, 'create', { name: 'Aurora Records', city: 'Reykjavík', tag: 'Independent label · 40 artists', last: 0, rec: ['410k listeners', 'released today', '40 artists'], kw: 'music label records aurora' }],
  [66, -34, 8, 'sell', { name: 'Nordic Pixel Co.', city: 'Helsinki', tag: 'Pixel-art posters & merch', last: 1, rec: ['8,420 sold', 'ships worldwide', 'last sale today'], kw: 'pixel art posters merch shop' }],
  [16, 88, 8, 'build', { name: 'Open Fjord', city: 'Oslo', tag: 'Open-source maps for everyone', last: 0, rec: ['61 commits / wk', '24,100 stars', 'last push today'], kw: 'maps open source geo' }],
  [-96, -58, 4, 'hire', { name: 'Hus & Hem', city: 'Göteborg', tag: 'Carpentry · renovations', avail: true, last: 0, rec: ['available now', '120 bookings', 'based in Göteborg'], kw: 'carpenter renovation home builder' }]
];
for (const f of FEATURED) gen(f[0], f[1], f[2], f[3], Object.assign({ featured: true }, f[4]));
for (let y = -CORE_R; y <= CORE_R; y++) for (let x = -CORE_R; x <= CORE_R; x++) {
  if (Math.hypot(x + .5, y + .5) > CORE_R || docc.has(K(x, y))) continue;
  const p = rnd(); let s = p < .2 ? 4 : p < .62 ? 2 : 1;
  while (s > 1 && !(dFree(x, y, s, s) && Math.hypot(x + s / 2, y + s / 2) <= CORE_R)) s >>= 1;
  gen(x, y, s);
}
{
  const ARMS = 4;
  for (let i = 0; i < 46000; i++) {
    const r = CORE_R + 1 + Math.pow(rnd(), 1.12) * (WORLD_R - CORE_R);
    const arm = Math.floor(rnd() * ARMS), inArm = rnd() < .8;
    const base = arm * (6.2832 / ARMS) + Math.log(r / CORE_R) * 2.25;
    const a = base + (inArm ? gauss() * (.15 + .14 * r / WORLD_R) : (rnd() - .5) * 6.2832 / ARMS);
    const p = rnd();
    const size = r < 40 ? (p < .05 ? 8 : p < .24 ? 4 : p < .62 ? 2 : 1) : r < 80 ? (p < .012 ? 8 : p < .09 ? 4 : p < .45 ? 2 : 1) : (p < .025 ? 4 : p < .25 ? 2 : 1);
    const keep = inArm ? (r < 40 ? .97 : r < 80 ? .82 : .62) : (r < 40 ? .8 : r < 80 ? .3 : .14);
    const x = Math.round(Math.cos(a) * r - size / 2), y = Math.round(Math.sin(a) * r - size / 2);
    if (rnd() < keep && dFree(x, y, size, size)) gen(x, y, size);
  }
}
const glowOf = q => q.last <= 3 ? 1 : q.last <= 30 ? 1 - (q.last - 3) / 27 * .85 : 0;
const hash = n => (((n | 0) * 2654435761) >>> 0) / 4294967296;
/* Ties never go to the oldest, biggest or alphabetically first: their order rotates every day (UTC). */
const DAY = new Date().toISOString().slice(0, 10);
const dayRot = slug => { let h = 2166136261; for (const ch of slug + '|' + DAY) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
/* 1 on the centre line of a spiral arm, falling to 0 between arms (same spiral as the generator). */
function armness(q) {
  const cx = q.x + q.size / 2, cy = q.y + q.size / 2, r = Math.max(CORE_R, Math.hypot(cx, cy));
  if (r <= CORE_R + 2) return 1;
  let a = Math.atan2(cy, cx) - Math.log(r / CORE_R) * 2.25, best = 9;
  for (let k = 0; k < 4; k++) { let d = (a - k * 6.2832 / 4) % 6.2832; if (d < -Math.PI) d += 6.2832; if (d > Math.PI) d -= 6.2832; best = Math.min(best, Math.abs(d)); }
  const w = .2 + .16 * r / WORLD_R;
  return Math.exp(-(best / w) * (best / w));
}
const fadeOf = q => q.last <= 30 ? 1 : q.last <= 90 ? 1 - (q.last - 30) / 60 * .5 : .3;

/* ================= REAL ITEMS ON THE MAP =================
   product: an approved product · spot: a held spot without a live profile · mine: your own product in review */
const ITEMS = [], occ = new Map();
let PRODUCTS = [], BY_SLUG = new Map(), SPOTS = [], OWNED = store.get(OWNED_KEY) || {}, OWNDATA = {}, PLACEMENTS = [];
/* The Spotlight: 8 places in the core, earned by real use (see public_spotlight). Placed in a ring around the centre. */
let SPOTLIGHT = { picks: [] };
const SPOT_SLOTS = Array.from({ length: 8 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / 4; return { x: Math.round(Math.cos(a) * 8.5 - 2), y: Math.round(Math.sin(a) * 8.5 - 2) }; });
const spotRank = slug => { const i = SPOTLIGHT.picks.findIndex(x => x.slug === slug); return i < 0 ? 0 : i + 1; };
/* Followed products live only in this browser: { slugs: { slug: followedAt }, seen: lastOpenedAt } */
let FOLLOW = (() => { const f = store.get(FOLLOW_KEY); return f && typeof f.slugs === 'object' && f.slugs ? f : { slugs: {}, seen: null }; })(), UPDATES = [];
/* Products this browser upvoted: { slug: 1 }. HL: the current search's top matches, lit up on the map. */
const VOTED = (() => { const v = store.get(VOTES_KEY); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; })();
const SAVED = (() => { const v = store.get(SAVED_KEY); return Array.isArray(v) ? v.filter(x => x && isSlug(x.slug)).slice(0,200) : []; })();
const ACTIVITY = (() => { const v = store.get(ACTIVITY_KEY); return Array.isArray(v) ? v.filter(x => x && isSlug(x.slug)).slice(0,100) : []; })();
let HL = [];
const zoneOf = (x, y, size) => { const d = Math.hypot(x + size / 2, y + size / 2); return ZONES.find(z => d < z.r); };
const paidTotal = (zone, size) => zone.reserved ? 0 : Math.max(3, zone.price * size * size);
const priceOf = (x, y, size) => paidTotal(zoneOf(x, y, size), size);
const isFree = (x, y, w, h) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (occ.has(K(x + i, y + j))) return false; return true; };
function addItem(it) {
  if (!isFree(it.x, it.y, it.size, it.size)) return null;
  it.w = it.h = it.size; it.d = Math.hypot(it.x + it.size / 2, it.y + it.size / 2); it.idx = ITEMS.length;
  for (let i = 0; i < it.size; i++) for (let j = 0; j < it.size; j++) occ.set(K(it.x + i, it.y + j), it);
  ITEMS.push(it); return it;
}
function rebuildItems() {
  const selSlug = sel && sel.slug, hovSlug = hoverIt && hoverIt.slug;
  ITEMS.length = 0; occ.clear();
  for (const p of PRODUCTS) addItem({ kind: 'product', p, slug: p.slug, name: p.name, cat: CATS[p.category] ? p.category : 'other', x: p.x, y: p.y, size: p.size, owned: !!OWNED[p.slug] });
  for (const slug in OWNDATA) {
    const o = OWNDATA[slug];
    if (o && o.status !== 'approved' && o.status !== 'removed') addItem({ kind: 'mine', o, slug, name: o.name, cat: CATS[o.category] ? o.category : 'other', x: o.x, y: o.y, size: o.size, owned: true });
  }
  for (const s of SPOTS) addItem({ kind: 'spot', x: s.x, y: s.y, size: s.size, name: 'Held spot' });
  SPOT_SLOTS.forEach((s, i) => {
    const pick = SPOTLIGHT.picks[i], p = pick && BY_SLUG.get(pick.slug);
    if (p) addItem({ kind: 'star', p, rank: i + 1, name: p.name, cat: CATS[p.category] ? p.category : 'other', x: s.x, y: s.y, size: 4 });
    else addItem({ kind: 'open', rank: i + 1, name: 'Open place', x: s.x, y: s.y, size: 4 });
  });
  if (selSlug) { const it = ITEMS.find(i => i.slug === selSlug); if (it) sel = it; }
  hoverIt = hovSlug ? ITEMS.find(i => i.slug === hovSlug) || null : null;
  zoneFreeCache = null;
  kick();
}
let OFF = null;
function offsets() {
  if (OFF) return OFF;
  const R = 150, tmp = [];
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) { const d = dx * dx + dy * dy; if (d <= R * R) tmp.push([dx, dy, d]); }
  tmp.sort((a, b) => a[2] - b[2]);
  OFF = new Int16Array(tmp.length * 2); tmp.forEach((t, k) => { OFF[k * 2] = t[0]; OFF[k * 2 + 1] = t[1]; });
  return OFF;
}
function spotOk(x, y, size) { return isFree(x, y, size, size) && !zoneOf(x, y, size).reserved && Math.hypot(x + size / 2, y + size / 2) < MAX_R; }
function nearestFree(cx, cy, size) {
  const o = offsets();
  for (let k = 0; k < o.length; k += 2) { const x = cx + o[k], y = cy + o[k + 1]; if (spotOk(x, y, size)) return { x, y }; }
  return null;
}
function freeAround(cx, cy, size) {
  for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) { const x = cx - dx, y = cy - dy; if (spotOk(x, y, size)) return { x, y, size }; }
  return null;
}
/* Cells per zone and how many are still free — the honest version of "spots are filling up". */
let ZONE_CAP = null, zoneFreeCache = null;
function zoneFree(id) {
  if (!ZONE_CAP) { ZONE_CAP = {}; for (let y = -MAX_R; y < MAX_R; y++) for (let x = -MAX_R; x < MAX_R; x++) { if (Math.hypot(x + .5, y + .5) >= MAX_R) continue; const z = zoneOf(x, y, 1).id; ZONE_CAP[z] = (ZONE_CAP[z] || 0) + 1; } }
  if (!zoneFreeCache) {
    zoneFreeCache = Object.assign({}, ZONE_CAP);
    for (const [key, item] of occ) {
      if (item.kind === 'star' || item.kind === 'open') continue;
      const [x,y] = key.split(',').map(Number);
      if (Math.hypot(x + .5, y + .5) < MAX_R) { const z = zoneOf(x,y,1).id; zoneFreeCache[z]--; }
    }
  }
  return { free: Math.max(0, zoneFreeCache[id] || 0), cap: ZONE_CAP[id] || 0 };
}

/* ================= BACKEND ================= */
async function rpc(fn, args, opts) {
  const r = await fetch(SUPA.url + '/rest/v1/rpc/' + fn, Object.assign({ method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPA.key }, body: JSON.stringify(args || {}) }, opts || {}));
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) { const err = new Error((j && j.message) || 'rpc ' + r.status); err.status = r.status; throw err; }
  return j;
}
async function fnCall(name, body) {
  try {
    const r = await fetch(SUPA.url + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPA.key }, body: JSON.stringify(body) });
    return (await r.json()) || { ok: false, reason: 'error' };
  } catch (e) { return { ok: false, reason: 'error' }; }
}
const errCode = e => String((e && e.message) || '');
const tracked = new Set();
function track(slug, kind, source) {
  rememberActivity(slug, kind); // Private activity never changes public ranking or maker statistics.
  if (source && slug && !OWNED[slug] && !navigator.webdriver) rpc('track_discovery', { p_slug: slug, p_kind: kind, p_source: source }, { keepalive: true }).catch(() => {});
  if (!slug || OWNED[slug] || navigator.webdriver) return;
  const k = slug + ':' + kind; if (kind === 'view' && tracked.has(k)) return; tracked.add(k);
  if(campaignLanding?.slug===slug)rpc('track_campaign',{p_slug:slug,p_kind:kind,p_campaign:campaignLanding.campaign,p_channel:campaignLanding.channel},{keepalive:true}).catch(()=>{});
  rpc('track', { p_slug: slug, p_kind: kind }, { keepalive: true }).catch(() => {});
}
let STATS = null, COMMERCE = { enabled: false };
async function loadCommerce() { try { COMMERCE = await rpc('public_commerce'); } catch (e) { COMMERCE = { enabled: false }; } }
async function loadStats() { try { STATS = await rpc('founding_stats'); } catch (e) { STATS = null; } renderLive(); }
function prepProduct(p) {
  const words = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9+#.]+/).filter(Boolean).map(stem);
  p._name = words(p.name); p._needs = (p.needs || []).map(n => ({ n, w: words(n), s: normQ(n) }));
  p._tag = words(p.tagline); p._aud = words(p.audience); p._desc = words(p.description);
  p._int = (p.integrations || []).map(i => ({ i, w: words(i) })); p._cat = words(CATS[p.category] ? CATS[p.category].label : '');
  p._plat = (p.platforms || []).flatMap(x => words(PLATFORMS[x] || x)); p._nameN = normQ(p.name);
  return p;
}
async function loadProducts() {
  try {
    const list = await rpc('public_products');
    if (Array.isArray(list)) { PRODUCTS = list.filter(p => p && isSlug(p.slug) && Number.isInteger(p.x) && Number.isInteger(p.y) && [1, 2, 4, 8].includes(p.size)).map(prepProduct); BY_SLUG = new Map(PRODUCTS.map(p => [p.slug, p])); return true; }
  } catch (e) {}
  return false;
}
async function loadSpots() {
  try { const s = await rpc('public_spots'); if (Array.isArray(s)) SPOTS = s.filter(v => v && Number.isInteger(v.x) && Number.isInteger(v.y) && [1, 2, 4, 8].includes(v.size) && Math.hypot(v.x + v.size / 2, v.y + v.size / 2) < MAX_R); } catch (e) {}
}
async function loadOwned() {
  const slugs = Object.keys(OWNED).filter(isSlug);
  await Promise.all(slugs.map(async slug => {
    try { OWNDATA[slug] = await rpc('owner_get', { p_slug: slug, p_key: OWNED[slug].key }); OWNED[slug].name = OWNDATA[slug].name; }
    catch (e) { if (errCode(e) === 'bad_key') { delete OWNED[slug]; delete OWNDATA[slug]; } }
  }));
  store.set(OWNED_KEY, OWNED); updateMine();
}
async function loadPlacements() {
  try { const l = await rpc('public_placements'); PLACEMENTS = Array.isArray(l) ? l.filter(x => x && Number.isInteger(x.id) && isSlug(x.slug)) : []; } catch (e) { PLACEMENTS = []; }
}
async function loadSpotlight() {
  try { const s = await rpc('public_spotlight'); if (s && Array.isArray(s.picks)) SPOTLIGHT = { picks: s.picks.filter(x => x && isSlug(x.slug)).slice(0, 8), updated_at: s.updated_at }; } catch (e) {}
}
async function refreshAll() { await Promise.all([loadProducts(), loadSpots(), loadPlacements(), loadSpotlight()]); rebuildItems(); if (ui === 'none' && view === 'list') renderList(); }
function saveOwned() { store.set(OWNED_KEY, OWNED); updateMine(); }

/* ================= CANVAS ================= */
const cv = $('#world'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, z: .2 };
const fp = { x: 0, y: 0 };
const isMobile = () => W < 760;
let ui = 'none', view = 'map', demo = false, sel = null, hoverIt = null, hoverDemo = null, ghost = null, explored = false, introRunning = false;

function focusTarget() {
  if (ui === 'pop') return isMobile() ? { x: W / 2, y: H * .22 } : { x: (W - 470) / 2 + 20, y: H / 2 };
  if (ui === 'claim' || ui === 'manage') return isMobile() ? { x: W / 2, y: H * .2 } : { x: Math.max(W * .64, 540), y: H * .47 };
  return isMobile() ? { x: W / 2, y: H * .36 } : { x: W * .6, y: H * .5 };
}
function home() {
  const span = 2 * WORLD_R * CELL;
  return isMobile() ? { x: 0, y: 0, z: W * 1.18 / span } : { x: 0, y: 0, z: Math.min(H * .98, W * .62) / span };
}
const minZoom = () => Math.max(ZMIN, home().z * .65);
function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const f = focusTarget(); fp.x = f.x; fp.y = f.y;
  kick();
}
const toS = (wx, wy) => ({ x: fp.x + (wx - cam.x) * CELL * cam.z, y: fp.y + (wy - cam.y) * CELL * cam.z });
const toW = (sx, sy) => ({ x: cam.x + (sx - fp.x) / (CELL * cam.z), y: cam.y + (sy - fp.y) / (CELL * cam.z) });
function rrect(c, x, y, w, h, r) {
  c.beginPath(); w = Math.max(0, w); h = Math.max(0, h); r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}
const SPR = {};
function sprite(rgb) {
  if (SPR[rgb]) return SPR[rgb];
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${rgb},.9)`); gr.addColorStop(.28, `rgba(${rgb},.32)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return (SPR[rgb] = c);
}
function starSprite() {
  if (SPR.star) return SPR.star;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.12, 'rgba(255,255,255,.6)'); gr.addColorStop(.4, 'rgba(255,255,255,.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[128, 3], [3, 128]]) { const l = g.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2); l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(.5, 'rgba(255,255,255,.9)'); l.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = l; g.fillRect(64 - w / 2, 64 - h / 2, w, h); }
  return (SPR.star = c);
}

/* galaxy texture: dust (normal mode) or example squares (demo mode), plus a blurred copy for bloom */
const TPX = 3, TN = (WORLD_R + 30) * 2, TOFF = TN / 2;
let TEX = null, GLOW = null, MINIBASE = null;
const MINI = $('#minimap'), mctx = MINI.getContext('2d');
function buildTexture() {
  const S = TN * TPX;
  if (!TEX) { TEX = document.createElement('canvas'); GLOW = document.createElement('canvas'); MINIBASE = document.createElement('canvas'); }
  TEX.width = TEX.height = S;
  const g = TEX.getContext('2d');
  for (const q of DEMO) {
    if (demo) {
      g.globalAlpha = fadeOf(q) * (.55 + .45 * glowOf(q)); g.fillStyle = MODES[q.mode].color;
      const ins = q.w === 1 ? .45 : .7;
      g.fillRect((q.x + TOFF) * TPX + ins, (q.y + TOFF) * TPX + ins, q.w * TPX - ins * 2, q.h * TPX - ins * 2);
    } else {
      // one or more soft star points per square, scattered inside it and brighter on the spiral arms
      const n = q.size >= 8 ? 7 : q.size >= 4 ? 3 : 1, arm = armness(q), warm = q.d < 24;
      for (let k = 0; k < n; k++) {
        const h = hash(q.id * 7 + k), h2 = hash(q.id * 13 + k + 1), h3 = hash(q.id * 31 + k + 2);
        const px = (q.x + (n > 1 ? h : .5) * q.w + TOFF) * TPX + (h3 - .5) * TPX, py = (q.y + (n > 1 ? h2 : .5) * q.h + TOFF) * TPX + (hash(q.id * 17 + k) - .5) * TPX;
        g.globalAlpha = clamp(.08 + .62 * arm * (.45 + .55 * h2) + (warm ? .25 : 0), 0, .9);
        g.fillStyle = warm ? (h < .5 ? '#fff0d4' : '#ffe2f0') : h3 < .16 ? '#dcc8ff' : h3 < .5 ? '#b9c9ff' : h3 < .62 ? '#9fe8ff' : '#f2f6ff';
        g.beginPath(); g.arc(px, py, .55 + h * .75 + (q.size >= 4 ? .25 : 0), 0, 6.2832); g.fill();
      }
    }
  }
  const gs = Math.round(S / 6); GLOW.width = GLOW.height = gs;
  const gg = GLOW.getContext('2d'); gg.imageSmoothingEnabled = true; gg.imageSmoothingQuality = 'high';
  gg.drawImage(TEX, 0, 0, gs, gs);
  const t = document.createElement('canvas'); t.width = t.height = Math.round(gs / 4);
  const tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high'; tg.drawImage(GLOW, 0, 0, t.width, t.height);
  gg.globalCompositeOperation = 'lighter'; gg.globalAlpha = demo ? .9 : 1.6; gg.drawImage(t, 0, 0, gs, gs);
  if (!demo) { gg.globalAlpha = .8; gg.drawImage(t, 0, 0, gs, gs); }
  MINIBASE.width = MINIBASE.height = 300;
  const mb = MINIBASE.getContext('2d');
  const mg = mb.createRadialGradient(150, 150, 0, 150, 150, 150); mg.addColorStop(0, '#0d1446'); mg.addColorStop(1, '#03040f');
  mb.fillStyle = mg; mb.fillRect(0, 0, 300, 300);
  const ms = 300 / ((WORLD_R + 8) * 2 * TPX), mo = 150 - TOFF * TPX * ms;
  mb.drawImage(TEX, mo, mo, S * ms, S * ms);
  mb.globalCompositeOperation = 'lighter'; mb.drawImage(GLOW, mo, mo, S * ms, S * ms);
  texDirty = false;
}

const STARS = []; for (let i = 0; i < 520; i++) STARS.push([rnd(), rnd(), rnd(), rnd() * 6.28, i % 3]);
const NEB = [[0, 0, 90, '94,225,255', .16], [-70, -50, 80, '255,92,122', .1], [80, 50, 85, '255,207,74', .08], [50, -80, 70, '179,156,255', .11], [-90, 70, 75, '61,255,138', .07], [0, 0, 190, '60,80,200', .1]];
const PULSES = [], SPARKS = [], PARTS = [], WAVES = [];
let VIS = [], nextPulse = 0, nextSpark = 0;
const itemColor = it => it.kind === 'mine' ? '#c8ff3d' : it.kind === 'spot' ? '#ffffff' : it.kind === 'open' ? '#ffcf4a' : CATS[it.cat].color;
const itemRgb = it => it.kind === 'mine' ? '200,255,61' : it.kind === 'spot' ? '255,255,255' : it.kind === 'open' ? '255,207,74' : CATS[it.cat].rgb;

function floatLabel(wx, wy, text, col, T) {
  const p = toS(wx, wy);
  ctx.font = '700 13px "Instrument Sans",system-ui,sans-serif';
  const tw = Math.min(280, ctx.measureText(text).width + 22), bob = reduce ? 0 : Math.sin(T * .004) * 2;
  const x = p.x - tw / 2, y = p.y - 42 + bob;
  ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(4,6,22,.95)'; rrect(ctx, x, y, tw, 26, 13); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, p.x, y + 13.5, tw - 16);
  ctx.globalAlpha = .55; ctx.beginPath(); ctx.moveTo(p.x, y + 26); ctx.lineTo(p.x, p.y - 3); ctx.stroke(); ctx.globalAlpha = 1;
}
function beacon(q, T, col, rgb, strength) {
  const cp = CELL * cam.z, c = toS(q.x + q.w / 2, q.y + q.h / 2), base = Math.max(3, q.w * cp * .5);
  if (c.x < -80 || c.x > W + 80 || c.y < -80 || c.y > H + 80) return;
  const pu = reduce ? .5 : .5 + .5 * Math.sin(T * .004 + q.idx);
  ctx.globalCompositeOperation = 'lighter';
  const R = base * 4 + 16 + pu * 8; ctx.globalAlpha = .55 * strength; ctx.drawImage(sprite(rgb), c.x - R, c.y - R, 2 * R, 2 * R);
  ctx.globalCompositeOperation = 'source-over';
  if (cp < 6) { ctx.globalAlpha = strength; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2.5, base * .8), 0, 6.2832); ctx.fill(); }
  if (!reduce) { const k = (T * .0006 + q.idx * .37) % 1; ctx.globalAlpha = (1 - k) * .7 * strength; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(c.x, c.y, base + 4 + k * 26, 0, 6.2832); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

function drawDemo(T, cp, mA) {
  const tl = toW(-40, -40), br = toW(W + 40, H + 40), detail = cp >= 8;
  if (detail) {
    ctx.globalCompositeOperation = 'lighter';
    for (const q of DEMO) {
      if (q.x + q.w < tl.x || q.x > br.x || q.y + q.h < tl.y || q.y > br.y || occOver(q)) continue;
      const g = glowOf(q); if (g <= 0) continue;
      if (q.last <= 3) VIS.push(q);
      if (q.size < 2) continue;
      const p = toS(q.x, q.y), bw = q.w * cp, cx = p.x + bw / 2, cy = p.y + bw / 2;
      let R = bw * .95 + 14 * Math.min(cam.z, 1.6), a = g * (q.featured ? .7 : .32);
      if (!reduce) {
        if (q.mode === 'create') { const pu = .5 + .5 * Math.sin(T * .0024 + q.id); R *= 1 + .28 * pu; a *= .6 + .55 * pu; }
        if (q.mode === 'build') a *= .8 + .35 * Math.sin(T * .003 + q.id * 1.7);
        if (q.boost) { const b = 1 - (T - q.boost) / 900; if (b > 0) { a += b * .6; R *= 1 + b * .25; } }
      }
      ctx.globalAlpha = clamp(a, 0, 1) * mA;
      ctx.drawImage(sprite(MODES[q.mode].rgb), cx - R, cy - R, 2 * R, 2 * R);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  for (const q of DEMO) {
    if (q.x + q.w < tl.x || q.x > br.x || q.y + q.h < tl.y || q.y > br.y || occOver(q)) continue;
    const col = MODES[q.mode].color, p = toS(q.x, q.y), bw = q.w * cp;
    ctx.globalAlpha = fadeOf(q) * mA; ctx.fillStyle = col;
    if (!detail) { const ins = Math.max(.4, cp * .08); ctx.fillRect(p.x + ins, p.y + ins, bw - ins * 2, bw - ins * 2); continue; }
    const gap = Math.min(1.5, cp * .08), rr = Math.min(5, cp * .18);
    rrect(ctx, p.x + gap, p.y + gap, bw - 2 * gap, bw - 2 * gap, rr); ctx.fill();
    if (bw > 16) { ctx.fillStyle = 'rgba(255,255,255,.24)'; ctx.fillRect(p.x + gap + rr, p.y + gap, bw - 2 * gap - 2 * rr, Math.max(1, cp * .07)); }
    if (q.mode === 'build' && glowOf(q) > 0 && bw > 6) { ctx.strokeStyle = 'rgba(220,250,255,.85)'; ctx.lineWidth = Math.max(1, cp * .07); rrect(ctx, p.x + gap, p.y + gap, bw - 2 * gap, bw - 2 * gap, rr); ctx.stroke(); }
    if (q.size >= 2 ? cp >= 9 : cp >= 22) {
      const bs = Math.max(5, Math.min(cp * .55, 15));
      if (q.mode === 'hire') { ctx.beginPath(); ctx.arc(p.x + bw - bs * .75, p.y + bs * .75, bs * .42, 0, 6.2832); ctx.fillStyle = q.avail ? '#3dff8a' : '#ff5a5a'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#071026'; ctx.stroke(); }
    }
    const showN = q.size >= 8 ? cp >= 8 : q.size >= 4 ? cp >= 13 : q.size >= 2 ? cp >= 27 : cp >= 52;
    if (showN) {
      ctx.fillStyle = '#071026'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const fs = Math.max(8, Math.min(bw / (q.name.length * .56 + 1), cp * .95, 30));
      ctx.font = '700 ' + fs + 'px "Instrument Sans",system-ui,sans-serif'; ctx.fillText(q.name, p.x + cp * .28, p.y + cp * .28, bw - cp * .5);
      if (q.size >= 4 && cp >= 17 && q.tag) { ctx.font = '500 ' + Math.max(7, fs * .58) + 'px "Instrument Sans",system-ui,sans-serif'; ctx.fillStyle = 'rgba(7,16,38,.78)'; ctx.fillText(q.tag, p.x + cp * .28, p.y + cp * .28 + fs * 1.18, bw - cp * .5); }
    }
    if (q === hoverDemo || q === sel) { ctx.globalAlpha = mA; ctx.strokeStyle = '#fff'; ctx.lineWidth = q === sel ? 3 : 1.5; rrect(ctx, p.x - 3, p.y - 3, bw + 6, bw + 6, rr + 3); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}
/* Up close in normal mode, the galaxy dust becomes crisp twinkling stars (the blurred texture fades out). */
function drawDust(T, cp) {
  const fade = clamp((cp - 5) / 5, 0, 1); if (fade <= 0) return;
  const tl = toW(-10, -10), br = toW(W + 10, H + 10), big = cp > 14;
  for (const q of DEMO) {
    if (q.x + q.w < tl.x || q.x > br.x || q.y + q.h < tl.y || q.y > br.y) continue;
    for (const s of q.pts || (q.pts = dustPoints(q))) {
      const sp = toS(s[0], s[1]), a = fade * s[4] * (reduce ? .8 : .55 + .45 * Math.sin(T * .0016 + s[5])), r = s[2] * (big ? 1.25 : 1);
      ctx.globalAlpha = a; ctx.fillStyle = s[3]; ctx.fillRect(sp.x - r / 2, sp.y - r / 2, r, r);
      if (s[6] && big) { ctx.globalAlpha = a * .6; ctx.drawImage(starSprite(), sp.x - 9, sp.y - 9, 18, 18); }
    }
  }
  ctx.globalAlpha = 1;
}
/* [x, y, size px, colour, alpha, twinkle phase, bright] for each star a square turns into up close; computed once. */
function dustPoints(q) {
  const n = q.size >= 8 ? 7 : q.size >= 4 ? 3 : 1, arm = armness(q), out = [];
  for (let k = 0; k < n; k++) {
    const h = hash(q.id * 7 + k), h2 = hash(q.id * 13 + k + 1), h3 = hash(q.id * 31 + k + 2);
    out.push([q.x + (n > 1 ? h : .5) * q.w + (h3 - .5), q.y + (n > 1 ? h2 : .5) * q.h + (hash(q.id * 17 + k) - .5), .7 + h * 1.1,
      h3 < .16 ? '#dcc8ff' : h3 < .5 ? '#c4d2ff' : h3 < .62 ? '#aef0ff' : '#ffffff',
      clamp(.12 + .7 * arm * (.4 + .6 * h2) + (q.d < 24 ? .25 : 0), 0, .95), h * 40, h > .93]);
  }
  return out;
}
/* An example square under a real product is hidden, so real products always win. */
function occOver(q) { for (let i = 0; i < q.size; i++) for (let j = 0; j < q.size; j++) if (occ.has(K(q.x + i, q.y + j))) return true; return false; }

function drawItems(T, cp) {
  const tl = toW(-90, -90), br = toW(W + 90, H + 90), vis = [];
  for (const it of ITEMS) if (it.x + it.w >= tl.x && it.x <= br.x && it.y + it.h >= tl.y && it.y <= br.y) vis.push(it);
  if (!vis.length) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const it of vis) {
    if (it.kind === 'spot' || it.kind === 'open') continue;
    const c = toS(it.x + it.w / 2, it.y + it.h / 2), bw = it.w * cp;
    const pu = reduce ? .5 : .5 + .5 * Math.sin(T * .002 + it.idx * 1.3);
    const R = Math.max(bw * 1.15 + 12, (cp < 4 ? 26 : 16) + 5 * it.size) * (1 + .12 * pu);
    ctx.globalAlpha = (it.kind === 'mine' ? .45 : .8) * (it === hoverIt || it === sel ? 1.3 : 1);
    ctx.drawImage(sprite(itemRgb(it)), c.x - R, c.y - R, 2 * R, 2 * R);
  }
  if (!reduce && cp < 9) for (const it of vis) {
    if (it.kind !== 'product' && it.kind !== 'star') continue;
    const k = (T * .00032 + hash(it.idx + 3)) % 1, c = toS(it.x + it.w / 2, it.y + it.h / 2);
    ctx.globalAlpha = (1 - k) * .55; ctx.strokeStyle = itemColor(it); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(4, it.w * cp * .6) + k * 34, 0, 6.2832); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const it of vis) {
    const p = toS(it.x, it.y), bw = it.w * cp, col = itemColor(it), c = toS(it.x + it.w / 2, it.y + it.h / 2);
    if (it.kind === 'spot') {
      if (bw >= 5) { ctx.globalAlpha = .9; ctx.fillStyle = 'rgba(255,255,255,.12)'; rrect(ctx, p.x + 1, p.y + 1, bw - 2, bw - 2, Math.min(5, cp * .18)); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (it === hoverIt) { ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; rrect(ctx, p.x - 3, p.y - 3, bw + 6, bw + 6, 6); ctx.stroke(); }
      continue;
    }
    if (it.kind === 'open') {
      if (bw >= 5) {
        const rr = Math.min(6, cp * .18);
        ctx.globalAlpha = it === hoverIt ? 1 : .8; ctx.fillStyle = 'rgba(255,207,74,.07)'; rrect(ctx, p.x + 1, p.y + 1, bw - 2, bw - 2, rr); ctx.fill();
        ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,207,74,.75)'; ctx.lineWidth = it === hoverIt ? 2 : 1.4; ctx.stroke(); ctx.setLineDash([]);
        if (bw >= 30) { ctx.fillStyle = 'rgba(255,207,74,.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '500 ' + Math.min(bw * .4, 30) + 'px "Instrument Sans",system-ui,sans-serif'; ctx.fillText('+', c.x, c.y + 1); }
      } else { ctx.globalAlpha = .7; ctx.fillStyle = '#ffcf4a'; ctx.beginPath(); ctx.arc(c.x, c.y, 1.5, 0, 6.2832); ctx.fill(); }
      ctx.globalAlpha = 1; continue;
    }
    ctx.globalAlpha = it.kind === 'mine' ? .6 : 1; ctx.fillStyle = col;
    if (bw < 5) {
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2, bw * .5 + 1), 0, 6.2832); ctx.fill();
    } else {
      const gap = Math.min(1.5, cp * .08), rr = Math.min(6, cp * .18);
      rrect(ctx, p.x + gap, p.y + gap, bw - 2 * gap, bw - 2 * gap, rr); ctx.fill();
      if (bw > 16) { ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(p.x + gap + rr, p.y + gap, bw - 2 * gap - 2 * rr, Math.max(1, cp * .07)); }
      if (it.kind === 'star') {
        ctx.globalAlpha = 1; ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 2; rrect(ctx, p.x - 2, p.y - 2, bw + 4, bw + 4, rr + 2); ctx.stroke();
        if (bw >= 18) { const r = Math.max(6, Math.min(cp * .34, 11)), bx = p.x + bw - r - 3, by = p.y + bw - r - 3; ctx.fillStyle = '#ffcf4a'; ctx.beginPath(); ctx.arc(bx, by, r, 0, 6.2832); ctx.fill(); ctx.fillStyle = '#071026'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 ' + Math.round(r * 1.1) + 'px "Instrument Sans",system-ui,sans-serif'; ctx.fillText(String(it.rank), bx, by + .5); }
      }
      else if (it.kind === 'mine') { ctx.globalAlpha = 1; ctx.setLineDash([4, 4]); ctx.strokeStyle = '#c8ff3d'; ctx.lineWidth = 2; rrect(ctx, p.x - 2, p.y - 2, bw + 4, bw + 4, rr + 2); ctx.stroke(); ctx.setLineDash([]); }
      else if (it.owned) { ctx.globalAlpha = 1; ctx.strokeStyle = '#c8ff3d'; ctx.lineWidth = 2.5; rrect(ctx, p.x - 2, p.y - 2, bw + 4, bw + 4, rr + 2); ctx.stroke(); }
      else if (FOLLOW.slugs[it.slug]) { ctx.globalAlpha = .9; ctx.setLineDash([3, 4]); ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 1.6; rrect(ctx, p.x - 3, p.y - 3, bw + 6, bw + 6, rr + 3); ctx.stroke(); ctx.setLineDash([]); }
      ctx.globalAlpha = 1;
      if (it.p && it.p.verified_at && bw >= 18) {
        const r = Math.max(5, Math.min(cp * .32, 10)), bx = p.x + bw - r - 3, by = p.y + r + 3;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, r, 0, 6.2832); ctx.fill(); ctx.strokeStyle = '#071026'; ctx.lineWidth = Math.max(1.4, r * .28);
        ctx.beginPath(); ctx.moveTo(bx - r * .45, by + r * .02); ctx.lineTo(bx - r * .1, by + r * .38); ctx.lineTo(bx + r * .48, by - r * .35); ctx.stroke();
      }
      const showN = it.size >= 8 ? cp >= 5 : it.size >= 4 ? cp >= 8 : it.size >= 2 ? cp >= 15 : cp >= 30;
      if (showN) {
        ctx.fillStyle = '#071026'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const fs = Math.max(8, Math.min(bw / (it.name.length * .56 + 1), cp * .95, 32));
        ctx.font = '700 ' + fs + 'px "Instrument Sans",system-ui,sans-serif'; ctx.fillText(it.name, p.x + cp * .28, p.y + cp * .28, bw - cp * .5 - (it.p && it.p.verified_at ? cp * .6 : 0));
        const tag = it.p ? it.p.tagline : 'In review';
        if (it.size >= 2 && bw >= 64 && tag) { ctx.font = '500 ' + Math.max(7, fs * .58) + 'px "Instrument Sans",system-ui,sans-serif'; ctx.fillStyle = 'rgba(7,16,38,.78)'; ctx.fillText(tag, p.x + cp * .28, p.y + cp * .28 + fs * 1.18, bw - cp * .5); }
      }
    }
    if (it === hoverIt || it === sel) { ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = it === sel ? 3 : 1.5; const pad = bw < 5 ? 6 : 3; rrect(ctx, Math.min(p.x, c.x - 4) - pad, Math.min(p.y, c.y - 4) - pad, Math.max(bw, 8) + pad * 2, Math.max(bw, 8) + pad * 2, 7); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}

function draw(T) {
  if (texDirty) buildTexture();
  const cp = CELL * cam.z;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);
  const c0 = toS(0, 0), big = Math.max(W, H);
  for (const st of STARS) {
    const layer = st[4] + 1, k = [2, 5, 11][st[4]], ww = W + 200, hh = H + 200;
    const x = ((st[0] * ww - cam.x * k) % ww + ww) % ww - 100, y = ((st[1] * hh - cam.y * k) % hh + hh) % hh - 100;
    const tw = reduce ? .7 : .45 + .55 * Math.abs(Math.sin(T * .0009 * layer + st[3]));
    ctx.globalAlpha = tw * (.15 + st[2] * .5); ctx.fillStyle = st[2] > .92 ? '#cfe6ff' : '#fff';
    const r = .5 + st[2] * layer * .45; ctx.fillRect(x, y, r, r);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';
  if (cp < 10) for (const n of NEB) {
    const c = toS(n[0], n[1]), r = n[2] * cp;
    if (r < 2 || r > big * 2.5 || c.x + r < 0 || c.x - r > W || c.y + r < 0 || c.y - r > H) continue;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    g.addColorStop(0, `rgba(${n[3]},${n[4]})`); g.addColorStop(1, `rgba(${n[3]},0)`); ctx.fillStyle = g; ctx.fillRect(c.x - r, c.y - r, 2 * r, 2 * r);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([2, 8]); ctx.lineWidth = 1;
  for (const zz of ZONES) { if (!isFinite(zz.r)) continue; const r = zz.r * cp; if (r < 30 || r > Math.max(W, H) * 3) continue; ctx.strokeStyle = 'rgba(160,180,255,.15)'; ctx.beginPath(); ctx.arc(c0.x, c0.y, r, 0, 6.2832); ctx.stroke(); }
  ctx.setLineDash([]);

  const gA = clamp((5.6 - cp) / 2.2, 0, 1), mA = clamp((cp - 3.4) / 2.2, 0, 1);
  // In normal mode the dust never fully disappears: up close it becomes a soft nebula behind the products.
  const tA = demo ? gA : Math.max(gA, .6 * clamp((13 - cp) / 7, 0, 1));
  if (tA > 0) {
    const p = toS(-TOFF, -TOFF), S = TN * cp;
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = tA; ctx.drawImage(TEX, p.x, p.y, S, S);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = tA * .9; ctx.drawImage(GLOW, p.x, p.y, S, S);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  VIS = [];
  if (demo && mA > 0) drawDemo(T, cp, mA);
  if (!demo) drawDust(T, cp);
  { const r = CORE_R * cp * 2.6; if (r > 4 && r < big * 3 && c0.x + r > 0 && c0.x - r < W && c0.y + r > 0 && c0.y - r < H) { const g = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, r); const s = .2 + .5 * gA; g.addColorStop(0, `rgba(255,255,255,${.55 * s})`); g.addColorStop(.25, `rgba(190,235,255,${.3 * s})`); g.addColorStop(1, 'rgba(94,225,255,0)'); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(c0.x - r, c0.y - r, 2 * r, 2 * r); ctx.globalCompositeOperation = 'source-over'; } }
  if (demo && gA > .25) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = SPARKS.length - 1; i >= 0; i--) {
      const s = SPARKS[i], k = (T - s.t) / 1100; if (k > 1) { SPARKS.splice(i, 1); continue; }
      const c = toS(s.q.x + s.q.w / 2, s.q.y + s.q.h / 2), R = 6 + s.q.w * cp * 2.5, a = Math.sin(k * Math.PI) * gA;
      ctx.globalAlpha = a; ctx.drawImage(starSprite(), c.x - R, c.y - R, 2 * R, 2 * R);
      ctx.globalAlpha = a * .7; ctx.drawImage(sprite(MODES[s.q.mode].rgb), c.x - R * 1.4, c.y - R * 1.4, R * 2.8, R * 2.8);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  } else SPARKS.length = 0;
  for (let i = PULSES.length - 1; i >= 0; i--) {
    const pl = PULSES[i], k = (T - pl.t) / 1300; if (k > 1) { PULSES.splice(i, 1); continue; }
    const q = pl.q, p = toS(q.x + q.w / 2, q.y + q.h / 2);
    ctx.globalAlpha = (1 - k) * .75 * Math.max(mA, .4); ctx.strokeStyle = pl.col || (q.mode ? MODES[q.mode].color : '#fff'); ctx.lineWidth = 2 * (1 - k) + .5;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4, q.w * cp * .6) + k * Math.max(cp * 5, 24), 0, 6.2832); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawItems(T, cp);
  for (const it of ITEMS) if (it.kind === 'spot') beacon(it, T, '#ffffff', '255,255,255', .85);
  let hlTop = null;
  if (HL.length && !results.hidden) {   // search: the matches light up in the universe, the best one gets a label
    for (const it of ITEMS) {
      if ((it.kind !== 'product' && it.kind !== 'star') || !HL.includes(it.slug)) continue;
      beacon(it, T, itemColor(it), itemRgb(it), 1);
      if (it.slug === HL[0] && (!hlTop || it.kind === 'product')) hlTop = it;
    }
  }
  if (ghost && ui === 'none' && mA > .5) {
    const p = toS(ghost.x, ghost.y), sz = ghost.size * cp;
    ctx.fillStyle = 'rgba(200,255,61,.12)'; rrect(ctx, p.x + 1, p.y + 1, sz - 2, sz - 2, Math.min(5, cp * .18)); ctx.fill();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#c8ff3d'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
  }
  if (ui === 'claim' && sub.spot && sub.step < 6) {
    const c = sub.spot, s = sub.size, p = toS(c.x, c.y), sz = s * cp, named = sub.step >= 2 && sub.name;
    const cat = CATS[sub.cat] || null, col = named && cat ? cat.color : '#c8ff3d', rgb = named && cat ? cat.rgb : '200,255,61';
    const pu = reduce ? .6 : .5 + .5 * Math.sin(T * .006);
    const bg = ctx.createLinearGradient(0, p.y - 240, 0, p.y); bg.addColorStop(0, `rgba(${rgb},0)`); bg.addColorStop(1, `rgba(${rgb},.55)`);
    ctx.fillStyle = bg; ctx.fillRect(p.x + sz / 2 - 1, p.y - 240, 2, 240);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .5 + .4 * pu; const R = Math.max(sz * 1.7 + 22, 30);
    ctx.drawImage(sprite(rgb), p.x + sz / 2 - R, p.y + sz / 2 - R, 2 * R, 2 * R);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const vs = Math.max(sz, 6), vx = p.x + sz / 2 - vs / 2, vy = p.y + sz / 2 - vs / 2;
    rrect(ctx, vx + 1, vy + 1, vs - 2, vs - 2, Math.min(5, vs * .18));
    if (named) { ctx.fillStyle = col; ctx.fill(); }
    else { ctx.fillStyle = `rgba(${rgb},${.18 + .16 * pu})`; ctx.fill(); ctx.setLineDash([4, 4]); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
    floatLabel(c.x + s / 2, c.y, sub.plan === 'free' ? `${named ? sub.name : 'YOUR FREE SPOT'} · 1×1 · €0` : `${named ? sub.name : 'YOUR SPOT'} · ${s}×${s} · ${eur(priceOf(c.x, c.y, s))} / 12 MONTHS`, col, T);
  }
  for (const it of ITEMS) if (it.owned && !(ui === 'claim' && sub.step < 6)) floatLabel(it.x + it.w / 2, it.y, '★ ' + it.name + (it.kind === 'mine' ? ' · in review' : ''), '#c8ff3d', T);
  if (sel && sel.kind === 'product' && !sel.owned && ui === 'pop') floatLabel(sel.x + sel.w / 2, sel.y, sel.name, itemColor(sel), T);
  ctx.font = '600 10px "IBM Plex Mono",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  for (const zz of ZONES) {
    const r = (isFinite(zz.r) ? zz.r : WORLD_R + 8) * cp; if (r < (zz.reserved ? 40 : 70) || r > Math.max(W, H) * 2.2) continue;
    const y = c0.y - r; if (y < 70 || y > H - 20 || c0.x < -200 || c0.x > W + 200) continue;
    const label = zz.reserved ? 'SPOTLIGHT · EARNED, NOT SOLD' : `${zz.label.toUpperCase()} · ${eur(zz.price)}/CELL · €3 MIN`;
    const tw = ctx.measureText(label).width + 20;
    ctx.globalAlpha = .92; ctx.fillStyle = 'rgba(4,6,22,.88)'; rrect(ctx, c0.x - tw / 2, y - 11, tw, 22, 11); ctx.fill();
    ctx.strokeStyle = zz.color; ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = zz.color; ctx.fillText(label, c0.x + 1, y + .5);
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  if (hlTop && ui === 'none') floatLabel(hlTop.x + hlTop.w / 2, hlTop.y, '⌕ ' + hlTop.name, itemColor(hlTop), T);   // above the zone labels
  for (let i = WAVES.length - 1; i >= 0; i--) {
    const w = WAVES[i], k = (T - w.t) / 1200; if (k < 0) continue; if (k > 1) { WAVES.splice(i, 1); continue; }
    const p = toS(w.x, w.y); ctx.globalAlpha = 1 - k; ctx.strokeStyle = w.col; ctx.lineWidth = 3 * (1 - k) + .5;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(cp, 6) * (1 + k * 16), 0, 6.2832); ctx.stroke();
  }
  for (const pt of PARTS) { if (pt.life <= 0) continue; const p = toS(pt.x, pt.y), s = Math.max(2, pt.sz * cp); ctx.globalAlpha = Math.min(1, pt.life * 1.4); ctx.fillStyle = pt.c; ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); }
  ctx.globalAlpha = 1;
  drawMini();
}
let miniShown = false;
function drawMini() {
  const show = cam.z > home().z * 2.2 && !isMobile() && view === 'map';
  if (show !== miniShown) { miniShown = show; MINI.classList.toggle('on', show); app.classList.toggle('has-mini', show); }
  if (!show || !MINIBASE) return;
  mctx.save(); mctx.clearRect(0, 0, 300, 300);
  mctx.beginPath(); mctx.arc(150, 150, 150, 0, 6.2832); mctx.clip();
  mctx.drawImage(MINIBASE, 0, 0);
  const sc = 300 / ((WORLD_R + 8) * 2), tl = toW(0, 0), br = toW(W, H);
  for (const it of ITEMS) { mctx.fillStyle = itemColor(it); mctx.beginPath(); mctx.arc(150 + (it.x + it.w / 2) * sc, 150 + (it.y + it.h / 2) * sc, it.owned ? 4.5 : 3, 0, 6.2832); mctx.fill(); }
  mctx.strokeStyle = '#c8ff3d'; mctx.lineWidth = 3; mctx.strokeRect(150 + tl.x * sc, 150 + tl.y * sc, Math.max(4, (br.x - tl.x) * sc), Math.max(4, (br.y - tl.y) * sc));
  mctx.restore();
}

/* ================= CAMERA ================= */
let fly = null, zAnim = null;
const vel = { x: 0, y: 0 };
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
function flyTo(x, y, z, ms, ease) {
  zAnim = null; vel.x = vel.y = 0; hideTip(); hoverIt = null; hoverDemo = null; ghost = null;
  if (reduce) { cam.x = x; cam.y = y; cam.z = clamp(z || cam.z, ZMIN, ZMAX); fly = null; kick(); return; }
  fly = { sx: cam.x, sy: cam.y, sz: cam.z, x, y, z: clamp(z || cam.z, ZMIN, ZMAX), t0: now(), ms: ms || 900, e: ease || easeOut }; kick();
}
function centerOn(q, z) { flyTo(q.x + q.w / 2, q.y + q.h / 2, z || clamp(Math.max(cam.z, q.size >= 8 ? 1.1 : q.size >= 4 ? 1.7 : q.size >= 2 ? 2.4 : 3.2), ZMIN, ZMAX), 950, easeInOut); }
function zoomBy(f, sx, sy) {
  fly = null; vel.x = vel.y = 0; hideTip(); ghost = null;
  const base = zAnim ? zAnim.target : cam.z;
  zAnim = { target: clamp(base * f, minZoom(), ZMAX), sx, sy }; markExplore(); kick();
}
function goHome() { const h = home(); flyTo(h.x, h.y, h.z, 1400, easeInOut); explored = false; app.classList.remove('explore'); }
function markExplore() { if (!explored && !introRunning) { explored = true; app.classList.add('explore'); } }

/* ================= LOOP ================= */
let running = !document.hidden, raf = 0, lastT = now(), idle = now();
function tick(T) {
  raf = 0; if (!running) return;
  if (view === 'list' && !fly) return; // the list covers the map: stop drawing until it closes
  const dt = Math.min(50, T - lastT) / 1000; lastT = T;
  if (fly) {
    const k = clamp((T - fly.t0) / fly.ms, 0, 1), e = fly.e(k);
    cam.x = fly.sx + (fly.x - fly.sx) * e; cam.y = fly.sy + (fly.y - fly.sy) * e; cam.z = fly.sz * Math.pow(fly.z / fly.sz, e);
    if (k >= 1) fly = null;
  }
  if (zAnim) {
    const a = toW(zAnim.sx, zAnim.sy), k = reduce ? 1 : 1 - Math.exp(-dt * 13);
    cam.z = Math.exp(Math.log(cam.z) + (Math.log(zAnim.target) - Math.log(cam.z)) * k);
    const b = toW(zAnim.sx, zAnim.sy); cam.x += a.x - b.x; cam.y += a.y - b.y;
    if (Math.abs(Math.log(cam.z / zAnim.target)) < .002) zAnim = null;
  }
  if (!drag && (vel.x || vel.y)) {
    cam.x += vel.x * dt; cam.y += vel.y * dt; const d = Math.pow(.004, dt); vel.x *= d; vel.y *= d;
    if (Math.hypot(vel.x, vel.y) * CELL * cam.z < 4) vel.x = vel.y = 0;
  }
  const ft = focusTarget(), lf = reduce ? 1 : Math.min(1, dt * 6); fp.x += (ft.x - fp.x) * lf; fp.y += (ft.y - fp.y) * lf;
  if (!reduce && !drag && !pinch && !fly && !zAnim && ui === 'none' && T - idle > 7000) { const s = dt / Math.sqrt(cam.z * 4); cam.x += Math.cos(T * .00011) * s * .9; cam.y += Math.sin(T * .00009) * s * .6; }
  if (!reduce && demo) {
    if (T > nextSpark) { const q = DEMO[Math.floor(Math.random() * DEMO.length)]; if (q && q.last <= 6) SPARKS.push({ q, t: T }); nextSpark = T + 60 + Math.random() * 140; }
    if (T > nextPulse && VIS.length) { const q = VIS[Math.floor(Math.random() * VIS.length)]; PULSES.push({ q, t: T }); q.boost = T; nextPulse = T + 450 + Math.random() * 650; }
  }
  for (const pt of PARTS) { if (pt.life <= 0) continue; pt.x += pt.vx * dt; pt.y += pt.vy * dt; const d = Math.pow(.12, dt); pt.vx *= d; pt.vy *= d; pt.life -= pt.dec * dt; }
  if (PARTS.length && PARTS.every(p => p.life <= 0)) PARTS.length = 0;
  draw(T);
  raf = requestAnimationFrame(tick);
}
function kick() { if (running && !raf) { lastT = now(); raf = requestAnimationFrame(tick); } }
document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) kick(); });
addEventListener('resize', resize);

/* ================= INPUT ================= */
const tip = $('#tip');
const local = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function showTip(m, title, sub, col) {
  tip.replaceChildren(el('b', { text: title, style: col ? 'color:' + col : null }), el('small', { text: sub }));
  tip.style.transform = `translate(${Math.min(m.x + 16, W - 290)}px,${Math.min(m.y + 18, H - 70)}px)`; tip.classList.add('on');
}
const hideTip = () => tip.classList.remove('on');
function itemAt(m) {
  const cp = CELL * cam.z; let best = null, bd = 1e9;
  for (const it of ITEMS) {
    const c = toS(it.x + it.w / 2, it.y + it.h / 2), half = Math.max(it.w * cp / 2, 10);
    const dx = Math.abs(m.x - c.x), dy = Math.abs(m.y - c.y);
    if (dx <= half && dy <= half && dx + dy < bd) { bd = dx + dy; best = it; }
  }
  return best;
}
function demoAt(m) {
  if (!demo || CELL * cam.z < 4.5) return null;
  const w = toW(m.x, m.y), q = docc.get(K(Math.floor(w.x), Math.floor(w.y)));
  return q && !occOver(q) ? q : null;
}
function itemTip(it) {
  if (it.kind === 'spot') return ['Held spot', `${zoneOf(it.x, it.y, it.size).label} · profile coming soon`, '#fff'];
  if (it.kind === 'mine') return ['★ ' + it.name, 'Your product · in review', '#c8ff3d'];
  if (it.kind === 'open') return ['Spotlight · open place', 'Earned by real use, never sold · click to see how', '#ffcf4a'];
  if (it.kind === 'star') return [`★ Spotlight #${it.rank} · ${it.p.name}`, it.p.tagline, '#ffcf4a'];
  const p = it.p; return [(p.verified_at ? '✓ ' : '') + p.name, p.tagline, CATS[it.cat].color];
}
function hover(m) {
  const cp = CELL * cam.z, w = toW(m.x, m.y), cx = Math.floor(w.x), cy = Math.floor(w.y);
  hoverIt = null; hoverDemo = null; ghost = null; cv.classList.remove('pointy', 'dive');
  if (introRunning) return;
  if (ui === 'claim' && sub.step === 1) { cv.classList.add('pointy'); hideTip(); return; }
  const it = itemAt(m);
  if (it) { hoverIt = it; cv.classList.add('pointy'); const t = itemTip(it); showTip(m, t[0], t[1], t[2]); kick(); return; }
  if (cp < 4.5) {
    const d = Math.hypot(w.x, w.y);
    if (d > MAX_R) { hideTip(); return; }
    const z = ZONES.find(zz => d < zz.r);
    cv.classList.add('dive');
    showTip(m, z.label, z.reserved ? 'Earned by real use, never sold · click to dive in' : `${eur(z.price)} per cell / 12 months · €3 minimum · click to zoom in`, z.reserved ? '#ffcf4a' : z.color);
    return;
  }
  const q = demoAt(m);
  if (q) { hoverDemo = q; cv.classList.add('pointy'); showTip(m, q.name, 'Example · ' + MODES[q.mode].label + ' · not a real product', '#b39cff'); return; }
  if (ui !== 'none') { hideTip(); return; }
  if (zoneOf(cx, cy, 1).reserved) { cv.classList.add('pointy'); showTip(m, 'The Spotlight', 'Earned by real use, never sold · click to see how', '#ffcf4a'); return; }
  const f = freeAround(cx, cy, 2);
  if (f) { ghost = f; cv.classList.add('pointy'); showTip(m, `Available · ${zoneOf(f.x, f.y, 2).label} · 2×2`, `${eur(priceOf(f.x, f.y, 2))} total / 12 months · click to choose this spot`, '#c8ff3d'); }
  else hideTip();
}
function tap(m) {
  const cp = CELL * cam.z, w = toW(m.x, m.y), cx = Math.floor(w.x), cy = Math.floor(w.y);
  if (introRunning) return;
  if (ui === 'claim' && sub.step === 1) { if (sub.plan === 'free') { toast('Your free place is on the Edge. Choose a map spot to pick another zone.'); return; } const s = nearestFree(cx - (sub.size >> 1), cy - (sub.size >> 1), sub.size); if (s) setSpot(s, true); return; }
  const it = itemAt(m);
  if (it) { openItem(it); return; }
  if (cp < 4.5) { markExplore(); flyTo(w.x, w.y, clamp(18 / CELL, ZMIN, ZMAX), 1300, easeInOut); return; }
  const q = demoAt(m);
  if (q) { openDemo(q); return; }
  if (ui !== 'none') { closeUI(); return; }
  if (zoneOf(cx, cy, 1).reserved) { openSpotlightInfo(); return; }
  const f = freeAround(cx, cy, 2) || nearestFree(cx - 1, cy - 1, 2);
  if (f) startSubmit({ x: f.x, y: f.y }, true);
}
const ptrs = new Map(); let drag = null, pinch = null, moved = false, samples = [];
cv.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  if (introRunning) { endIntro(); return; }
  ptrs.set(e.pointerId, local(e)); fly = null; zAnim = null; vel.x = vel.y = 0; idle = now();
  if (ptrs.size === 1) { drag = { m: local(e), cx: cam.x, cy: cam.y }; moved = false; samples = [{ x: e.clientX, y: e.clientY, t: now() }]; }
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.z, w: toW(mid.x, mid.y) }; drag = null; moved = true;
  }
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
});
cv.addEventListener('pointermove', e => {
  const m = local(e);
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, m);
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    cam.z = clamp(pinch.z * d / pinch.d, minZoom(), ZMAX);
    cam.x = pinch.w.x - (mid.x - fp.x) / (CELL * cam.z); cam.y = pinch.w.y - (mid.y - fp.y) / (CELL * cam.z); markExplore(); kick(); return;
  }
  if (drag) {
    const dx = m.x - drag.m.x, dy = m.y - drag.m.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 5) { moved = true; cv.classList.add('dragging'); hideTip(); ghost = null; hoverIt = null; hoverDemo = null; markExplore(); }
    if (moved) {
      cam.x = drag.cx - dx / (CELL * cam.z); cam.y = drag.cy - dy / (CELL * cam.z); idle = now();
      samples.push({ x: e.clientX, y: e.clientY, t: now() }); if (samples.length > 6) samples.shift(); kick();
    }
    return;
  }
  if (e.pointerType === 'mouse') hover(m);
});
function endPtr(e, cancel) {
  ptrs.delete(e.pointerId); cv.classList.remove('dragging');
  if (pinch) { if (ptrs.size < 2) pinch = null; drag = null; return; }
  const was = drag; drag = null;
  if (was && moved && !reduce && samples.length > 1) {
    const s0 = samples[0], s1 = samples[samples.length - 1], dtm = (s1.t - s0.t) / 1000;
    if (dtm > 0 && now() - s1.t < 80) { const cp = CELL * cam.z; vel.x = -(s1.x - s0.x) / dtm / cp; vel.y = -(s1.y - s0.y) / dtm / cp; kick(); }
  }
  if (!cancel && was && !moved) { const m = local(e); tap(m); if (e.pointerType === 'mouse') hover(m); }
}
cv.addEventListener('pointerup', e => endPtr(e, false));
cv.addEventListener('pointercancel', e => endPtr(e, true));
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !drag) { hideTip(); hoverIt = null; hoverDemo = null; ghost = null; } });
cv.addEventListener('wheel', e => {
  e.preventDefault(); if (introRunning) { endIntro(); return; }
  const m = local(e); idle = now();
  const k = e.deltaMode === 1 ? .055 : e.ctrlKey ? .012 : .0019;
  zoomBy(Math.exp(-e.deltaY * k), m.x, m.y);
}, { passive: false });
addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input,textarea,select');
  if (e.key === 'Escape') {
    if (introRunning) endIntro();
    if (dlg.classList.contains('open')) closeDlg();
    else if (sheet.classList.contains('open')) closeSheet();
    else if (!results.hidden) results.hidden = true;
    else if (ui !== 'none') closeUI();
    else if (view === 'list') setView('map');
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest && e.target.closest('button,a,summary') && (e.key === 'Enter' || e.key === ' ')) return;
  if (introRunning) { endIntro(); return; }
  if (dlg.classList.contains('open') || sheet.classList.contains('open')) return;
  if (view === 'list') { if (e.key === '/') { e.preventDefault(); openSearch(); } return; }
  const st = 360 / (CELL * cam.z); let used = true;
  if (e.key === 'ArrowLeft' || e.key === 'a') vel.x = -st; else if (e.key === 'ArrowRight' || e.key === 'd') vel.x = st;
  else if (e.key === 'ArrowUp' || e.key === 'w') vel.y = -st; else if (e.key === 'ArrowDown' || e.key === 's') vel.y = st;
  else if (e.key === '+' || e.key === '=') zoomBy(1.6, fp.x, fp.y); else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.6, fp.x, fp.y);
  else if (e.key === '0') goHome();
  else if (e.key === '/') openSearch();
  else if (e.key === '?') openSheet();
  else used = false;
  if (used) { e.preventDefault(); if (e.key !== '0') markExplore(); kick(); }
});
$('#zIn').onclick = () => zoomBy(1.8, fp.x, fp.y);
$('#zOut').onclick = () => zoomBy(1 / 1.8, fp.x, fp.y);
$('#zHome').onclick = () => { closeUI(); goHome(); };
$('#logo').onclick = e => { e.preventDefault(); closeUI(); closeSheet(); setView('map'); goHome(); };
MINI.addEventListener('click', e => {
  const r = MINI.getBoundingClientRect(), sc = r.width / ((WORLD_R + 8) * 2);
  flyTo((e.clientX - r.left - r.width / 2) / sc, (e.clientY - r.top - r.height / 2) / sc, cam.z, 900, easeInOut);
});

/* ================= DEMO MODE ================= */
function setDemo(on) {
  if (demo === !!on) return;
  demo = !!on; texDirty = true; SPARKS.length = 0; PULSES.length = 0; hoverDemo = null;
  if (sel && sel.demo) closeUI();
  app.classList.toggle('demo', demo); $('#demoBar').hidden = !demo; $('#demoBtn').setAttribute('aria-pressed', String(demo));
  tickN = 0; nextTick(); kick();
}
$('#demoBtn').onclick = () => { setDemo(!demo); if (demo) { setView('map'); toast('Demo mode: example products only. Nothing here is real.', 3200); } };
$('#demoExit').onclick = () => setDemo(false);
$('#demoHero').onclick = () => { setDemo(true); markExplore(); const h = home(); flyTo(-6, -4, h.z * 3.2, 1600, easeInOut); };

/* ================= TOAST / SHARE ================= */
const toastEl = $('#toast'); let toastT = 0;
function toast(msg, ms) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), ms || 3400); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  try { const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch (e) { return false; }
}
/* Shared links always use the real domain, whichever address the visitor came in on. */
const SITE = 'https://expanse.nyttolabs.com';
const productUrl = slug => SITE + '/p/' + slug;
async function shareUrl(url, title, text, okMsg) {
  if (coarse && navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  toast((await copy(url)) ? okMsg : 'Copy the link: ' + url, 4200);
}
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function setPath(path) { try { if (location.protocol.startsWith('http') && location.pathname + location.search !== path) history.replaceState(null, '', path); } catch (e) {} }

/* 1080×1350 share card: the product's square in its corner of the galaxy. */
const kitCache = new Map();
async function preparedKit(slug) {
  if (kitCache.has(slug)) return kitCache.get(slug);
  const key = OWNED[slug]?.key;
  if (!key) throw new Error('owner_required');
  const kit = await rpc('owner_marketing_kit',{p_slug:slug,p_key:key});
  if (!kit?.svg || !kit.revision) throw new Error('kit_not_ready');
  kitCache.set(slug,kit);return kit;
}
/* ================= PANELS ================= */
const pop = $('#pop'), popBody = $('#popBody'), claimEl = $('#claim'), manageEl = $('#manage'), sheet = $('#sheet'), dlg = $('#dlg'), dlgBody = $('#dlgBody');
function setUI(v) {
  ui = v; app.classList.toggle('ui', v !== 'none'); hideTip(); ghost = null;
  if (v !== 'pop') pop.classList.remove('open');
  if (v !== 'claim') claimEl.classList.remove('open');
  if (v !== 'manage') manageEl.classList.remove('open');
  kick();
}
function closeUI() {
  const wasPop = ui === 'pop';
  setUI('none'); sel = null;
  if (wasPop) setPath('/');
  if (view !== 'list') cv.focus({ preventScroll: true });
}
document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeUI);
function openPanel(elm, kind) {
  setUI(kind); elm.classList.add('open'); elm.scrollTop = 0; elm.focus({ preventScroll: true });
}

/* ---------- product profile ---------- */
function fill(node, ...kids) { node.replaceChildren(...kids.flat().filter(k => k != null && k !== false)); }
function badge(cls, text, style) { return el('span', { class: 'badge ' + cls, text, style }); }
function catBadge(cat) { return badge('b-cat', CATS[cat].label, '--c:' + CATS[cat].color); }
function statusBadge(st) {
  const m = { pending: ['In review', ''], approved: ['Live', 'live'], rejected: ['Changes needed', 'rej'], hidden: ['Hidden', 'hid'] }[st] || [st, ''];
  return badge('b-st ' + m[1], m[0]);
}
function openItem(it) {
  if (it.kind === 'product' || it.kind === 'star') openProduct(it.p);
  else if (it.kind === 'open') openSpotlightInfo();
  else if (it.kind === 'mine') openManage(it.slug);
  else openSpot(it);
}
function openProduct(p, opts) {
  const it = ITEMS.find(i => i.slug === p.slug); sel = it || null;
  const cat = CATS[p.category] ? p.category : 'other', z = zoneOf(p.x, p.y, p.size);
  const source = opts && opts.source || (view === 'list' ? (listQ ? 'search' : 'list') : 'map');
  const visit = el('a', { class: 'btn btn-primary btn-sm', href: discoveryUrl(p.url, p.slug), target: '_blank', rel: 'noopener nofollow ugc', title: p.url, onclick: () => track(p.slug, 'visit', source) }, el('span', { text: 'Visit website' }), ' ↗');
  const demoBtn = p.demo_url ? el('a', { class: 'btn btn-ghost btn-sm', href: p.demo_url, target: '_blank', rel: 'noopener nofollow ugc', onclick: () => track(p.slug, 'demo', source) }, 'Try demo ↗') : null;
  const imgs = (p.images || []).length ? el('div', { class: 'imgs' }, p.images.map(src => el('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', decoding: 'async', onerror: e => e.target.remove() }))) : null;
  const facts = [['For', p.audience], ['Price', p.pricing === 'unspecified' ? '' : PRICING[p.pricing] + (p.price_text ? ' · ' + p.price_text : '')]].filter(f => f[1]);
  if ((p.platforms || []).length) facts.push(['Platforms', p.platforms.map(x => PLATFORMS[x] || x).join(', ')]);
  if ((p.integrations || []).length) facts.push(['Works with', p.integrations.join(', ')]);
  fill(popBody,
    el('div', { class: 'pbadges' }, catBadge(cat), spotRank(p.slug) ? badge('b-star', '★ Spotlight #' + spotRank(p.slug)) : null, p.verified_at ? badge('b-ver', '✓ Verified domain', null) : null, p.sponsored ? badge('b-spon', 'Sponsored') : null, it && it.owned ? badge('b-st live', 'Yours') : null),
    el('h2', { class: 'display pname', text: p.name }),
    p.slug==='deploydoctor'?el('button',{class:'linkbtn',type:'button',text:'A NyttoLabs product · about the operator',onclick:openAboutNytto}):null,
    el('p', { class: 'ptag', text: p.tagline }),
    el('div', { class: 'pmeta mono', text: `${p.domain} · ${z.label} · ${p.size}×${p.size}` }),
    imgs,
    el('div', { class: 'pact' }, visit, demoBtn),
    el('div', { class: 'ptools' }, voteBtn(p), saveBtn(p), stackBtn(p), followBtn(p), el('button', { class: 'chip-btn', type: 'button', 'aria-label': 'Share ' + p.name, onclick: () => shareUrl(productUrl(p.slug), p.name + ' on Expanse', `${p.name} — ${p.tagline}`, 'Link copied.') }, el('span', { 'aria-hidden': 'true', text: '↗' }), 'Share')),
    el('div', { class: 'sec' }, el('h4', { class: 'mono', text: 'Solves' }), el('div', { class: 'needs' }, p.needs.map(n => el('button', { class: 'need', text: n, title: 'Find more products for “' + n + '”', onclick: () => runSearch(n) })))),
    el('div', { class: 'sec' }, el('p', { class: 'pdesc', text: p.description })),
    el('div', { class: 'sec facts' }, facts.map(f => el('div', null, el('small', { text: f[0] }), el('span', { text: f[1] })))),
    signals(p),
    releasesSec(p),
    el('div', { class: 'pfoot' },
      it && it.owned ? el('button', { class: 'linkbtn', text: 'Manage my product', onclick: () => openManage(p.slug) }) : el('button', { class: 'linkbtn', text: 'I make this', onclick: () => openOwnerLogin(p.slug, p.name) }),
      el('button', { class: 'linkbtn', text: 'Report a problem', onclick: () => openReport(p) }),
      view === 'list' ? el('button', { class: 'linkbtn', text: 'Show on map', onclick: () => { setView('map'); setTimeout(() => openProduct(p), 60); } }) : null),
    el('p', { class: 'fine', text: 'Where a product sits on the map is a placement, not a ranking — it never affects search.' })
  );
  popBody.dataset.slug = p.slug;
  productOffer(p,popBody);
  openPanel(pop, 'pop');
  setPath('/p/' + p.slug);
  track(p.slug, 'view', source);
  if (it && view === 'map' && !(opts && opts.noFly)) { centerOn(it); markExplore(); }
}
/* Checked facts about a product, each with its date. None of them can be bought. */
function signals(p) {
  const rows = [];
  if (p.verified_at) rows.push(['ver', 'Verified domain', `The maker proved they control ${p.domain} · ${dateStr(p.verified_at)}`]);
  if (p.site_ok_at) rows.push(['up', 'Website answers', `We open ${p.domain} every day · last checked ${timeAgo(p.site_ok_at)}`]);
  if (p.demo_ok_at) rows.push(['demo', 'Demo works', `The demo link loaded on our daily check · ${timeAgo(p.demo_ok_at)}`]);
  if (p.repo) rows.push(['up', 'GitHub connected', `The maker connected github.com/${p.repo}${p.repo_verified_at ? ' · ' + dateStr(p.repo_verified_at) : ''}`]);
  if (!rows.length) return null;
  return el('div', { class: 'sec' }, el('h4', { class: 'mono', text: 'Checked by Expanse' }),
    el('ul', { class: 'signals' }, rows.map(r => el('li', { class: 's-' + r[0] }, el('b', { text: r[1] }), el('small', { text: r[2] })))));
}
function followBtn(p) {
  const b = el('button', { class: 'chip-btn follow-btn', type: 'button' });
  const paint = () => { const on = isFollowed(p.slug); b.setAttribute('aria-pressed', String(on)); b.title = on ? 'Stop following' : 'Follow updates from ' + p.name; b.replaceChildren(el('span', { 'aria-hidden': 'true', text: on ? '★' : '☆' }), el('span', { class: 'fl', text: on ? 'Following' : 'Follow' })); };
  b.onclick = () => { toggleFollow(p); paint(); };
  paint(); return b;
}
/* Upvotes: one per product per browser, no account. The browser keeps a random voter id (the server stores only a
   hash of it) and which products it upvoted (VOTED). Makers can't upvote their own product. */
function voterId() {
  let v = store.get(VOTER_KEY);
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) {
    const a = new Uint8Array(18); crypto.getRandomValues(a);
    v = btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store.set(VOTER_KEY, v);
  }
  return v;
}
function voteBtn(p) {
  const b = el('button', { class: 'chip-btn vote-btn', type: 'button' }), mine = !!OWNED[p.slug];
  const paint = () => {
    const on = !!VOTED[p.slug], n = p.upvotes || 0;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', (on ? 'Upvoted · ' : 'Upvote · ') + plural(n, 'upvote', 'upvotes'));
    b.title = mine ? 'You can’t upvote your own product' : on ? 'Take your upvote back' : 'Upvote ' + p.name;
    b.replaceChildren(el('span', { 'aria-hidden': 'true', text: '▲' }), el('span', { text: n ? fmt(n) : 'Upvote' }));
  };
  b.onclick = async () => {
    if (mine) { toast('You can’t upvote your own product.'); return; }
    const on = !VOTED[p.slug], before = p.upvotes || 0;
    if (on) VOTED[p.slug] = 1; else delete VOTED[p.slug];
    p.upvotes = Math.max(0, before + (on ? 1 : -1)); b.disabled = true; paint();
    if (on) { b.classList.remove('voted-pulse'); void b.offsetWidth; b.classList.add('voted-pulse'); }
    try {
      const r = await rpc('upvote', { p_slug: p.slug, p_voter: voterId(), p_on: on });
      p.upvotes = r.upvotes; persistPersonal(VOTES_KEY, VOTED);
    } catch (e) {
      if (on) delete VOTED[p.slug]; else VOTED[p.slug] = 1;
      p.upvotes = before;
      const m = errCode(e);
      toast(m === 'already' ? 'Someone on this network already upvoted it today.' : m === 'own_product' ? 'You can’t upvote your own product.' : m === 'slow_down' ? 'That’s a lot of upvotes for one day. Try again tomorrow.' : "Couldn't count that upvote right now. Try again.");
    } finally { b.disabled = false; paint(); }
  };
  paint(); return b;
}
const relItem = r => el('li', null, el('a', { href: r.url, target: '_blank', rel: 'noopener nofollow' }, el('b', { text: r.title || r.tag }), el('small', { text: (r.title && r.title !== r.tag ? r.tag + ' · ' : '') + dateStr(r.at) }), r.notes ? el('p', { text: r.notes }) : null));
/* Releases from the product's connected GitHub repo: the latest comes with the product, the rest load when the profile opens. */
function releasesSec(p) {
  if (!p.repo) return null;
  const box = el('ul', { class: 'rels' }, p.release ? relItem(p.release) : null);
  if (p.release) rpc('public_releases', { p_slug: p.slug }).then(list => { if (Array.isArray(list) && list.length && popBody.dataset.slug === p.slug) fill(box, list.slice(0, 5).map(relItem)); }).catch(() => {});
  return el('div', { class: 'sec' },
    el('h4', { class: 'mono' }, 'Releases · ', el('a', { href: 'https://github.com/' + p.repo, target: '_blank', rel: 'noopener nofollow', style: 'text-transform:none;letter-spacing:.02em;text-decoration:underline', text: 'github.com/' + p.repo })),
    p.release ? box : el('p', { class: 'fine', style: 'margin-top:0', text: 'No releases published on GitHub yet.' }));
}
/* The operator relationship is disclosed; it never enters ranking or eligibility. */
function openAboutNytto() {
  closeSheet();
  openDlg(el('div',{class:'mono kick',text:'The studio behind Expanse'}),el('h2',{class:'display',text:'Made by NyttoLabs.'}),
    el('p',{style:'margin-top:16px',text:'NyttoLabs is an independent software studio in Sweden. We build and maintain Expanse and DeployDoctor.'}),
    el('p',{style:'margin-top:12px',text:'Expanse is open to every maker. Our own products follow the same listing, verification and discovery rules as everyone else. Being made by NyttoLabs does not buy search ranking or a reserved Spotlight place.'}),
    el('p',{class:'fine',text:'The 8 Spotlight places follow published eligibility and ranking rules. When fewer than 8 products qualify, all of them can appear. In an early catalog, a Spotlight place is not evidence of a large audience or proven sales.'}),
    el('div',{class:'c-row'},el('a',{class:'btn btn-primary btn-sm',href:'https://nyttolabs.com',target:'_blank',rel:'noopener',text:'Visit NyttoLabs ↗'}),el('button',{class:'btn btn-ghost btn-sm',text:'How Spotlight works',onclick:openSpotlightInfo}),el('button',{class:'btn btn-ghost btn-sm',text:'Close',onclick:closeDlg})));
}
document.querySelectorAll('[data-about-nytto]').forEach(b=>b.addEventListener('click',openAboutNytto));
/* What the Spotlight is, who is in it now, and how to get there. */
function openSpotlightInfo() {
  const picks = SPOTLIGHT.picks.map(x => BY_SLUG.get(x.slug)).filter(Boolean);
  const mine = Object.keys(OWNED).find(s => OWNDATA[s] && OWNDATA[s].status === 'approved' && !OWNDATA[s].verified_at);
  openDlg(el('div', { class: 'mono kick', style: 'color:var(--amber)', text: '★ The Spotlight' }), el('h2', { class: 'display', text: 'The middle is earned, not bought.' }),
    el('p', { style: 'margin-top:10px', text: 'The 8 places in the core go to the products people like most — not the biggest or the best known. Nobody is invited, and no place is for sale.' }),
    el('ul', { class: 'rules' },
      el('li', null, el('b', { text: 'Who can get in: ' }), 'any live product with a verified domain and a website that answers.'),
      el('li', null, el('b', { text: 'How it ranks: ' }), 'how many of the people who look at a product go on to click through to its site or upvote it, over the last 30 days — not how many visitors it has, so a big audience or a famous name doesn’t buy the middle. New products start at the average, not at zero. The maker’s own visits and votes don’t count.'),
      el('li', null, el('b', { text: 'Room for newcomers: ' }), '2 of the 8 places always go to the best products that went live in the last 30 days, and ties rotate every day instead of going to whoever came first.'),
      el('li', null, el('b', { text: 'When it changes: ' }), 'every hour. While fewer than 8 products qualify, every product that does gets a place.')),
    el('p',{class:'fine',text:'Expanse and DeployDoctor are made by NyttoLabs. Our products use the same eligibility and ranking rules; their places are not reserved. With fewer than 8 eligible products, being in Spotlight is not a claim of high traffic.'}),
    picks.length ? el('div', { class: 'spl' }, el('span', { class: 'mono', text: 'In the Spotlight now' }), el('div', null, picks.map((p, i) => el('button', { type: 'button', onclick: () => { closeDlg(); openProduct(p); } }, el('b', { text: '#' + (i + 1) }), ' ' + p.name))))
      : el('p', { class: 'fine', text: 'All 8 places are open right now. The first verified products to arrive take them.' }),
    el('div', { class: 'c-row' },
      mine ? el('button', { class: 'btn btn-primary', text: 'Verify my domain', onclick: () => { closeDlg(); openManage(mine, 'verify'); } }) : el('button', { class: 'btn btn-primary', text: 'Add your product', onclick: () => { closeDlg(); startSubmit(null); } }),
      el('button', { class: 'btn btn-ghost btn-sm', text: 'Close', onclick: closeDlg })));
}
function openSpot(it) {
  sel = it; const z = zoneOf(it.x, it.y, it.size);
  popBody.replaceChildren(
    el('div', { class: 'pbadges' }, badge('b-ver', 'Held spot')),
    el('h2', { class: 'display pname', text: z.label }),
    el('p', { class: 'ptag', text: `A ${it.size}×${it.size} spot held by a maker. Its profile isn't live yet — it may still be in review.` }),
    el('button', { class: 'nextto', onclick: () => { const s = nearestFree(Math.round(it.x + it.w / 2 - 1), Math.round(it.y + it.h / 2 - 1), 2); if (s) startSubmit(s); } }, el('span', { text: 'Put your product right next to it' }), el('span', { 'aria-hidden': 'true', text: '→' }))
  );
  openPanel(pop, 'pop'); centerOn(it); markExplore();
}
function openDemo(q) {
  sel = q;
  popBody.replaceChildren(
    el('div', { class: 'pbadges' }, badge('b-ex', 'Example'), badge('b-cat', MODES[q.mode].label, '--c:' + MODES[q.mode].color)),
    el('h2', { class: 'display pname', text: q.name }),
    el('p', { class: 'ptag', text: q.tag }),
    el('div', { class: 'receipts' }, q.rec.map(r => el('span', { class: 'rc', text: r, style: '--c:' + MODES[q.mode].color }))),
    el('p', { class: 'fine', text: 'This is an example square in demo mode. It is not a real product, and the numbers are made up.' }),
    el('button', { class: 'nextto', onclick: () => { setDemo(false); startSubmit(nearestFree(Math.round(q.x + q.w / 2 - 1), Math.round(q.y + q.h / 2 - 1), 2)); } }, el('span', { text: 'Put your real product here' }), el('span', { 'aria-hidden': 'true', text: '→' }))
  );
  openPanel(pop, 'pop'); centerOn(q); markExplore();
}

/* ================= SEARCH (relevance only — placement never affects ranking) ================= */
const STOP = new Set('a an and are as at be by can for from get help how i in is it me my need needs of on or so some that the this to tool tools app apps want with without who your something anything thing things stuff way best good great simple easy'.split(' '));
function stem(w) { return w.length > 5 ? w.replace(/(ings|ing|ers|er|ed|es|s)$/, '') : w.length > 3 ? w.replace(/s$/, '') : w; }
function normQ(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
function terms(q) { return normQ(q).split(/[^a-z0-9+#.]+/).filter(t => t.length > 1 && !STOP.has(t)).map(stem); }
const hasT = (arr, t) => arr.some(w => w === t || (t.length > 2 && w.startsWith(t)) || (w.length > 3 && t.startsWith(w)));
function scoreProduct(p, q, ts) {
  let s = 0, why = null, missing = 0;
  if (p._nameN === q) s += 60; else if (p._nameN.startsWith(q)) s += 30; else if (q.length > 2 && p._nameN.includes(q)) s += 18;
  for (const n of p._needs) { if (n.s === q) { s += 45; why = why || n.n; } else if (q.length > 3 && (n.s.includes(q) || q.includes(n.s))) { s += 26; why = why || n.n; } }
  for (const t of ts) {
    let hit = 0;
    const need = p._needs.find(n => hasT(n.w, t)); if (need) { hit += 9; why = why || need.n; }
    if (hasT(p._name, t)) hit += 8;
    if (hasT(p._tag, t)) hit += 4;
    const integ = p._int.find(i => hasT(i.w, t)); if (integ) { hit += 5; why = why || 'Works with ' + integ.i; }
    if (hasT(p._cat, t)) hit += 3;
    if (hasT(p._aud, t)) hit += 3;
    if (hasT(p._plat, t)) hit += 3;
    if (hasT(p._desc, t)) hit += 1;
    if (!hit) missing++;
    s += hit;
  }
  if (ts.length > 1 && missing) s *= (ts.length - missing) / ts.length * .8;
  return { s, why, coverage: ts.length ? (ts.length - missing) / ts.length : 0 };
}
function searchProducts(qs, list) {
  const q = normQ(qs), ts = terms(qs); if (q.length < 2) return [];
  const out = [];
  for (const p of list || PRODUCTS) { const r = scoreProduct(p, q, ts); if (r.s > 0) out.push({ p, s: r.s, why: r.why, coverage: r.coverage }); }
  return out.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name));
}
function searchDemo(qs) {
  const q = normQ(qs); if (!demo || q.length < 2) return [];
  const ts = q.split(/\s+/).filter(t => t.length > 1), out = [];
  for (const s of DEMO) {
    if (!s.featured && s.size < 2) continue;
    const hay = normQ(s.name + ' ' + s.tag + ' ' + (s.kw || '') + ' ' + KW[s.mode] + ' ' + s.city);
    let sc = 0; for (const t of ts) if (hay.includes(t)) sc += t.length;
    if (sc) out.push([sc + (s.featured ? 4 : 0), s]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, 4).map(r => r[1]);
}
const whyLabel = r => r.why ? (r.why.startsWith('Works with') ? r.why : `Solves “${r.why}”`) : r.p.tagline;

/* ---------- AI search: matched by meaning (gte-small in Supabase), merged with the word matches above ---------- */
const AI = new Map();       // query → results, or null only while loading
const AI_PENDING = new Map(); // dropdown and list consumers share the same pending request
async function aiSearch(qs) {
  const q = String(qs || '').replace(/\s+/g, ' ').trim(), k = q.toLowerCase();
  if (q.length < 3 || !PRODUCTS.length) return null;
  if (AI_PENDING.has(k)) return AI_PENDING.get(k);
  if (AI.has(k)) return AI.get(k);
  AI.set(k, null);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
  const pending = (async () => {
    try {
      const r = await fetch(SUPA.url + '/functions/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPA.key }, body: JSON.stringify({ q }), signal: ctl.signal });
      const j = await r.json();
      if (r.ok && Array.isArray(j.results)) return j.results;
    } catch (e) {}
    return []; // unavailable: fall back to word matches and useful empty-state actions
  })();
  AI_PENDING.set(k, pending);
  try {
    const rows = await pending;
    AI.set(k, rows); if (AI.size > 80) AI.delete(AI.keys().next().value);
    return rows;
  } finally { clearTimeout(timer); AI_PENDING.delete(k); }
}
const aiCached = qs => AI.get(String(qs || '').replace(/\s+/g, ' ').trim().toLowerCase()) || null;
/* What the words ask for besides the need itself: price, platform, tools it should work with. */
const PLAT_WORDS = [[/\b(ios|iphone|ipad)\b/, 'ios'], [/\bandroid\b/, 'android'], [/\b(mac|macos|macbook)\b/, 'macos'], [/\b(windows|pc)\b/, 'windows'], [/\blinux\b/, 'linux'], [/\b(chrome extension|browser extension|extension|plugin)\b/, 'extension'], [/\b(api|sdk)\b/, 'api'], [/\b(web app|in the browser|web)\b/, 'web']];
function interpret(qs) {
  const q = ' ' + normQ(qs) + ' ', out = { free: /\b(free|gratis|no cost|open source|free plan|freemium)\b/.test(q), plat: [], ints: [] };
  for (const [re, k] of PLAT_WORDS) if (re.test(q) && !out.plat.includes(k)) out.plat.push(k);
  const seen = new Set();
  for (const p of PRODUCTS) for (const i of p.integrations) {
    const n = normQ(i); if (n.length < 2 || seen.has(n)) continue; seen.add(n);
    if (q.includes(' ' + n + ' ') || q.includes(' ' + n + ',') || q.includes(' ' + n + '.')) out.ints.push(i);
  }
  return out;
}
/* Word matches and meaning matches together. Each result says why it's there; asked-for price, platform or
   integration lift the products that have it, and so does popularity — the share of visitors who click through or
   upvote over the last 30 days, not how many visitors a product has, so a big audience doesn't win by size: a
   well-liked product can pass a slightly closer match, never a much closer one. Placement and sponsorship never play a part. */
function rankAll(qs, list) {
  const pool = list || PRODUCTS, inPool = new Set(pool.map(p => p.slug));
  const kw = searchProducts(qs, pool), it = interpret(qs), max = Math.max(1, ...kw.map(r => r.s)), m = new Map();
  for (const r of kw) m.set(r.p.slug, { p: r.p, kw: r.s / max, raw: r.s, why: r.why, coverage:r.coverage, sem: 0 });
  for (const a of aiCached(qs) || []) {
    const p = BY_SLUG.get(a.slug); if (!p || !inPool.has(p.slug)) continue;
    const e = m.get(p.slug) || { p, kw: 0, why: null };
    e.sem = a.score; e.need = a.need; e.strength = a.strength; m.set(p.slug, e);
  }
  const out = [], strongAi = [...m.values()].some(e => e.strength === 'strong');
  for (const e of m.values()) {
    if (e.strength !== 'strong' && e.sem < .5 && e.p._nameN !== normQ(qs) && (e.coverage || 0) < .35) continue;
    if (!e.kw && e.strength === 'possible' && kw.length) continue;   // weak meaning-only matches only when nothing else fits
    if (strongAi && !e.sem && e.raw < 2) continue;                     // a stray word in a description doesn't beat a real match
    let s = Math.max(e.kw, e.sem) + .25 * Math.min(e.kw, e.sem);
    const why = [];
    if (e.why) why.push(e.why.startsWith('Works with') ? e.why : `Solves “${e.why}”`);
    else if (e.need) why.push(`Closest to what you asked: “${e.need}”`);
    else if (e.sem) why.push('Matches what you described');
    if (it.free) { if (['free', 'freemium', 'trial'].includes(e.p.pricing)) why.push(PRICING[e.p.pricing]); else s *= .7; }
    for (const k of it.plat) { if (e.p.platforms.includes(k)) why.push('On ' + PLATFORMS[k]); else s *= .75; }
    for (const i of it.ints) { if (e.p.integrations.some(x => normQ(x) === normQ(i))) why.push('Works with ' + i); else s *= .8; }
    s *= 1 + .35 * clamp((e.p.pop || 0) / 100, 0, 1);
    out.push({ p: e.p, s, match: (e.coverage >= .8 || e.strength === 'strong') ? 'Strong profile match' : 'Partial profile match', why: [...new Set(why)].slice(0, 3).join(' · '), ai: !e.kw && !!e.sem });
  }
  return out.sort((a, b) => b.s - a.s || dayRot(a.p.slug) - dayRot(b.p.slug));
}
const byPopular = (a, b) => (b.p.pop || 0) - (a.p.pop || 0) || dayRot(a.p.slug) - dayRot(b.p.slug);
function understood(qs) {
  const it = interpret(qs), bits = [];
  if (it.free) bits.push('free option');
  for (const k of it.plat) bits.push(PLATFORMS[k]);
  for (const i of it.ints) bits.push('works with ' + i);
  return bits;
}
/* Sponsored slots: at most two cards, above the results and each clearly marked. They show only where they fit — the
   product is a close match for the search (at least 40% of the best match's score, and isn't already the top one), or
   shares a category with the best match; browsing the list without a search shows running slots that pass the filters. When more slots fit than
   there is room for, they take turns. The results below never change. */
const SPON_MAX = 2, SPON_PICK = new Map(), sponSeen = new Set();
function sponsoredFor(qs, organic, pool) {
  if (!PLACEMENTS.length) return [];
  const inPool = new Set((pool || PRODUCTS).map(p => p.slug));
  const live = [...new Map(PLACEMENTS.filter(x => BY_SLUG.has(x.slug) && inPool.has(x.slug)).map(x => [x.slug, x])).values()];   // one card per product
  let cands = live;
  if (qs) {
    const top = organic[0], first = top && top.p.slug, hit = new Set(organic.filter(r => top && r.s >= top.s * .4).map(r => r.p.slug));
    cands = live.filter(x => x.slug !== first && (hit.has(x.slug) || (top && BY_SLUG.get(x.slug).category === top.p.category)));
  }
  if (!cands.length) return [];
  const key = normQ(qs || '') + '|' + cands.map(x => x.id).join(',');
  let picks = SPON_PICK.get(key);
  if (!picks) { picks = cands.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).slice(0, SPON_MAX).map(r => r[1]); SPON_PICK.set(key, picks); }
  return picks.map(x => ({ id: x.id, p: BY_SLUG.get(x.slug) }));
}
function trackSpon(sp, kind) {
  if (!sp || OWNED[sp.p.slug] || navigator.webdriver) return;
  if (kind === 'impression') { if (sponSeen.has(sp.id)) return; sponSeen.add(sp.id); }
  rpc('track_placement', { p_id: sp.id, p_kind: kind }, { keepalive: true }).catch(() => {});
}
const results = $('#results'), qIn = $('#q'), searchEl = $('#search');
function openSearch() { searchEl.classList.add('open'); qIn.focus(); if (!qIn.value) renderResults(); }
$('#searchBtn').onclick = () => { searchEl.classList.toggle('open'); if (searchEl.classList.contains('open')) { qIn.focus(); renderResults(); } };
function topNeeds(n) {
  const c = new Map(); for (const p of PRODUCTS) for (const x of p.needs) c.set(x, (c.get(x) || 0) + 1);
  const list = [...c.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  for (const x of NEED_IDEAS) if (list.length < n && !list.includes(x)) list.push(x);
  return list.slice(0, n);
}
function renderResults() {
  const v = qIn.value.trim();
  if (v.length < 2) {
    HL = [];
    results.replaceChildren(el('div', { class: 'lbl mono', text: PRODUCTS.length ? 'Popular needs' : 'Try a need' }), el('div', { class: 'ideas' }, topNeeds(8).map(n => el('button', { type: 'button', text: n, onclick: () => runSearch(n) }))));
    results.hidden = false; return;
  }
  const all = rankAll(v), r = all.slice(0, 6), d = searchDemo(v), kids = [], u = understood(v), anyAi = r.some(x => x.ai);
  HL = r.map(x => x.p.slug); kick();
  if (u.length || anyAi) kids.push(el('div', { class: 'lbl mono' }, anyAi ? el('span', { class: 'ai', text: '✦ AI' }) : null, u.length ? 'Looking for: ' + u.join(' · ') : 'Matched by meaning, not just words'));
  const sps = sponsoredFor(v, all);
  for (const sp of sps) kids.push(el('button', { type: 'button', class: 'spon', title: 'Paid placement. It doesn’t change the results below.', onclick: () => { trackSpon(sp, 'click'); results.hidden = true; searchEl.classList.remove('open'); openProduct(sp.p, { source: 'sponsored' }); } },
    el('span', { class: 'sw', style: 'background:' + CATS[sp.p.category].color }), el('span', { class: 'rt' }, el('b', { text: sp.p.name }), el('small', { text: sp.p.tagline })), el('span', { class: 'tagx mono', text: 'Sponsored' })));
  for (const x of r) {
    const marks = [x.p.upvotes ? '▲ ' + fmt(x.p.upvotes) : '', x.p.verified_at ? '✓' : ''].filter(Boolean).join('  ');
    kids.push(el('button', { type: 'button', 'data-exposure':x.p.slug, 'data-source':'search', onclick: () => { results.hidden = true; searchEl.classList.remove('open'); openProduct(x.p, { source: 'search' }); } },
      el('span', { class: 'sw', style: 'background:' + CATS[x.p.category].color }), el('span', { class: 'rt' }, el('b', { text: x.p.name }), el('small', { text: x.match+' · '+(x.why || x.p.tagline) })), marks ? el('span', { class: 'tagx', text: marks }) : null));
  }
  for (const q of d) kids.push(el('button', { type: 'button', onclick: () => { results.hidden = true; searchEl.classList.remove('open'); openDemo(q); } },
    el('span', { class: 'sw', style: 'background:' + MODES[q.mode].color }), el('span', { class: 'rt' }, el('b', { text: q.name }), el('small', { text: q.tag })), el('span', { class: 'tagx mono', text: 'Example' })));
  if (r.length) kids.push(el('button', { type: 'button', class: 'all', text: `See all ${plural(all.length, 'match', 'matches')} in the list →`, onclick: () => runSearch(v) }));
  if (!aiCached(v) && v.length >= 3 && PRODUCTS.length) {
    clearTimeout(aiT); aiT = setTimeout(() => aiSearch(v).then(res => { if (res && qIn.value.trim() === v && !results.hidden) renderResults(); }), 420);
  }
  const pendingAi = !r.length && v.length >= 3 && PRODUCTS.length && !aiCached(v);
  if (pendingAi) kids.unshift(el('div', { class: 'none' }, el('span', { class: 'ai mono', text: '✦ AI' }), ' Searching by meaning…'));
  else if (!r.length) kids.unshift(el('div', { class: 'none' }, `No convincing catalog match for “${v}” yet. `, el('button',{type:'button',text:'Leave a need →',onclick:()=>openNeedForm(v)}),' · ', el('button', { type: 'button', text: 'Add yours →', onclick: () => { results.hidden = true; startSubmit(null); } })));
  results.replaceChildren(...kids); results.hidden = false;
  observeProductCards();
  for (const sp of sps) trackSpon(sp, 'impression');
}
let aiT = 0;
qIn.addEventListener('input', renderResults);
qIn.addEventListener('focus', renderResults);
function runSearch(v) {
  qIn.value = v; results.hidden = true; searchEl.classList.remove('open'); qIn.blur();
  listQ = v; lSort.value = 'match'; closeUI(); setView('list');
}
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); const v = qIn.value.trim(); if (v.length < 2) { renderResults(); return; } runSearch(v); });
document.addEventListener('pointerdown', e => { if (!e.target.closest('.search') && !e.target.closest('#searchBtn')) { results.hidden = true; if (isMobile() && !qIn.value) searchEl.classList.remove('open'); } });

/* ================= LIST VIEW ================= */
const listEl = $('#list'), cardsEl = $('#cards'), lSort = $('#lSort');
const F = { cat: new Set(), price: '', plat: new Set(), int: new Set() };
let listQ = '';
function setView(v) {
  if (v === view) { if (v === 'list') renderList(); return; }
  view = v; app.classList.toggle('listing', v === 'list'); listEl.setAttribute('aria-hidden', String(v !== 'list'));
  $('#vMap').setAttribute('aria-pressed', String(v === 'map')); $('#vList').setAttribute('aria-pressed', String(v === 'list'));
  if (v === 'list') { if (ui === 'claim' || ui === 'manage') setUI('none'); renderFilters(); renderList(); }
  else { listQ = ''; lSort.value = 'pop'; }
  kick();
}
$('#vMap').onclick = () => { closeUI(); setView('map'); };
$('#vList').onclick = () => { if (ui === 'pop') closeUI(); setView('list'); };
document.querySelectorAll('[data-list]').forEach(b => b.onclick = e => { e.preventDefault(); setView('list'); });
$('#fToggle').onclick = () => listEl.classList.toggle('showf');
lSort.onchange = renderList;
function optBtn(label, on, color, click) { return el('button', { type: 'button', 'aria-pressed': String(!!on), style: color ? '--c:' + color : null, onclick: click }, color ? el('i') : null, label); }
function renderFilters() {
  $('#fCat').replaceChildren(...Object.entries(CATS).map(([k, c]) => optBtn(c.label, F.cat.has(k), c.color, () => { F.cat.has(k) ? F.cat.delete(k) : F.cat.add(k); renderFilters(); renderList(); })));
  $('#fPrice').replaceChildren(...[['', 'Any'], ['free', 'Has a free option'], ['paid', 'Paid']].map(([k, l]) => optBtn(l, F.price === k, null, () => { F.price = k; renderFilters(); renderList(); })));
  $('#fPlat').replaceChildren(...Object.entries(PLATFORMS).map(([k, l]) => optBtn(l, F.plat.has(k), null, () => { F.plat.has(k) ? F.plat.delete(k) : F.plat.add(k); renderFilters(); renderList(); })));
  const ints = new Map(); for (const p of PRODUCTS) for (const i of p.integrations || []) { const k = i.toLowerCase(); ints.set(k, ints.get(k) || i); }
  const top = [...ints.keys()].sort((a, b) => PRODUCTS.filter(p => p.integrations.some(x => x.toLowerCase() === b)).length - PRODUCTS.filter(p => p.integrations.some(x => x.toLowerCase() === a)).length).slice(0, 12);
  $('#fIntH').hidden = !top.length;
  $('#fInt').replaceChildren(...top.map(k => optBtn(ints.get(k), F.int.has(k), null, () => { F.int.has(k) ? F.int.delete(k) : F.int.add(k); renderFilters(); renderList(); })));
}
$('#fClear').onclick = () => { F.cat.clear(); F.plat.clear(); F.int.clear(); F.price = ''; renderFilters(); renderList(); };
function filtered() {
  return PRODUCTS.filter(p => (!F.cat.size || F.cat.has(p.category))
    && (!F.price || (F.price === 'free' ? ['free', 'freemium', 'trial'].includes(p.pricing) : ['paid', 'trial', 'freemium'].includes(p.pricing)))
    && (!F.plat.size || [...F.plat].every(x => p.platforms.includes(x)))
    && (!F.int.size || [...F.int].every(x => p.integrations.some(i => i.toLowerCase() === x))));
}
function card(p, why, source) {
  const src=source||(listQ?'search':'list');
  const profile=el('button',{class:'profile-open',type:'button','aria-label':'Open '+p.name+' product profile',onclick:()=>openProduct(p,{source:src})},
    el('div',{class:'top'},el('b',{text:p.name}),p.verified_at?el('span',{class:'ver',title:'Domain ownership verified, not a product endorsement',text:'✓'}):null),
    el('p',{text:p.tagline}),el('div',{class:'needs'},(p.needs||[]).slice(0,2).map(n=>el('span',{class:'need',text:n}))),
    p.audience?el('p',{class:'card-audience',text:'For '+p.audience}):null,
    why?el('div',{class:'why',text:why}):null,
    el('div',{class:'card-domain',text:(p.domain||new URL(p.url).hostname)+(p.verified_at?' · verified ownership':' · ownership not verified')}),
    el('div',{class:'meta'},el('span',{text:PRICING[p.pricing]||'Pricing not specified'}),p.price_text?el('span',{text:p.price_text}):null));
  return el('article',{class:'card','data-exposure':p.slug,'data-source':src,style:'--c:'+CATS[p.category].color},profile,
    el('div',{class:'card-actions'},el('a',{class:'btn btn-primary btn-sm',href:discoveryUrl(p.url,p.slug),target:'_blank',rel:'noopener nofollow ugc',text:'Visit website ↗',onclick:()=>track(p.slug,'visit',src)}),saveBtn(p),stackBtn(p)));
}
function sponCard(sp) {
  const c = card(sp.p, null, 'sponsored'); c.classList.add('sponsored');
  c.prepend(el('div', { class: 'spon-h mono' }, 'Sponsored', el('small', { text: ' · paid, doesn’t change the ranking' })));
  c.addEventListener('click', () => trackSpon(sp, 'click'));
  return c;
}
function renderList() {
  const base = filtered(); let rows, ranked = [];
  if (listQ) {
    ranked = rankAll(listQ, base);
    rows = ranked.map(r => ({ p: r.p, why: r.match+' · '+(r.why || r.p.tagline) }));
    if (!aiCached(listQ)) { const q = listQ; aiSearch(q).then(res => { if (res && listQ === q && view === 'list') renderList(); }); }
  }
  else rows = base.map(p => ({ p, why: null }));
  const sort = lSort.value;
  if (sort === 'new') rows.sort((a, b) => Date.parse(b.p.approved_at || 0) - Date.parse(a.p.approved_at || 0));
  else if (sort === 'az') rows.sort((a, b) => a.p.name.localeCompare(b.p.name));
  else if (!listQ) rows.sort(byPopular);
  const lq = $('#lQuery'); lq.hidden = !listQ;
  if (listQ) {
    const u = understood(listQ), aiAny = rows.some(r => r.why.startsWith('✦'));
    lq.replaceChildren(aiAny ? el('span', { class: 'ai mono', text: '✦ AI' }) : '', `Best matches for “${listQ}”`, u.length ? ` · looking for ${u.join(', ')}` : '',
      el('button', { type: 'button', text: 'Clear search', onclick: () => { listQ = ''; qIn.value = ''; lSort.value = 'pop'; renderList(); } }));
  }
  $('#lCount').textContent = plural(rows.length, 'product', 'products');
  if (!rows.length && listQ && PRODUCTS.length && AI.has(listQ.replace(/\s+/g, ' ').trim().toLowerCase()) && !aiCached(listQ)) {
    cardsEl.replaceChildren(el('div', { class: 'empty' }, el('h3', { text: 'Searching by meaning…' }), el('p', { text: 'No product uses those exact words — checking what they mean.' })));
    return;
  }
  if (!rows.length) {
    const none = !PRODUCTS.length;
    cardsEl.replaceChildren(el('div', { class: 'empty' },
      el('h3', { text: none ? 'The universe is wide open.' : listQ ? `No convincing match for “${listQ}” yet.` : 'No products match these filters.' }),
      el('p', { text: none ? 'No products are live yet. Every maker can add a free profile under the same review rules.' : 'This is a small, reviewed catalog. Try one specific task, remove a filter, or save your need for future matches.' }),
      el('div', { class: 'c-row' }, el('button', { class: 'btn btn-primary btn-sm', text: 'Add your product', onclick: () => startSubmit(null) }), listQ ? el('button',{class:'btn btn-ghost btn-sm',text:'Save need & check new matches',onclick:()=>openNeedForm(listQ)}):null, none ? el('button', { class: 'btn btn-ghost btn-sm', text: 'See the demo universe', onclick: () => { setView('map'); $('#demoHero').click(); } }) : null)));
    if(!none){cardsEl.append(el('div',{class:'discovery-suggestions'},...PRODUCTS.flatMap(p=>p.needs||[]).slice(0,4).map(n=>el('button',{class:'chip-btn',text:n,onclick:()=>runSearch(n)})),el('button',{class:'chip-btn',text:'Clear filters & browse all real products',onclick:()=>{$('#fClear').click();listQ='';qIn.value='';renderList();}})));}
    return;
  }
  const sps = sponsoredFor(listQ, ranked, base);
  cardsEl.replaceChildren(...sps.map(sponCard), ...rows.map(r => card(r.p, r.why)));
  observeProductCards();
  for (const sp of sps) trackSpon(sp, 'impression');
}

const exposed=new Set(),exposureTimers=new Map();let exposureObserver;const observedCards=new Set();
function observeProductCards(){
  if(!window.IntersectionObserver||navigator.webdriver)return;
  if(!exposureObserver)exposureObserver=new IntersectionObserver(entries=>{for(const e of entries){const node=e.target;clearTimeout(exposureTimers.get(node));exposureTimers.delete(node);if(!e.isIntersecting||e.intersectionRatio<.6)continue;
    exposureTimers.set(node,setTimeout(()=>{exposureTimers.delete(node);const slug=node.dataset.exposure,source=node.dataset.source,key=slug+':'+source;
      if(!node.isConnected||document.hidden||topModal()||demo||OWNED[slug]||exposed.has(key)||node.closest('[hidden]')||!['home','search','list'].includes(source)||!BY_SLUG.has(slug))return;
      if(source==='home'&&(ui!=='none'||app.classList.contains('explore')||view==='list'))return;
      if(source!=='home'&&ui!=='none')return;
      exposed.add(key);rpc('track_exposure',{p_slug:slug,p_source:source},{keepalive:true}).catch(()=>{});
    },1000));}}, {threshold:[0,.6,1]});
  for(const node of observedCards)if(!node.isConnected){exposureObserver.unobserve(node);observedCards.delete(node);clearTimeout(exposureTimers.get(node));exposureTimers.delete(node);}
  for(const node of document.querySelectorAll('[data-exposure]'))if(!observedCards.has(node)){observedCards.add(node);exposureObserver.observe(node);}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){for(const timer of exposureTimers.values())clearTimeout(timer);exposureTimers.clear();}else if(exposureObserver){exposureObserver.disconnect();observedCards.clear();observeProductCards();}});

/* ================= PRODUCT FORM (used by "add" and by the owner panel) ================= */
function normUrl(v) {
  v = String(v || '').trim(); if (!v) return '';
  if (/^http:\/\//i.test(v)) v = 'https://' + v.slice(7);
  else if (!/^https:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
  return v;
}
const urlOk = v => /^https:\/\/(?!(?:[^\/?#]*@))[a-z0-9.-]+\.[a-z]{2,24}(:\d{2,5})?([\/?#]\S*)?$/i.test(v) && v.length <= 300;
function makeForm() {
  const f = {}, data = { category: 'other', pricing: 'unspecified', needs: [], platforms: [], integrations: [] };
  const input = (name, label, attrs, hint) => { const i = el('input', Object.assign({ autocomplete: 'off', spellcheck: 'false' }, attrs)); const w = el('label', { class: 'field', 'data-f': name }, el('span', { class: 'mono' }, label), i, hint ? el('small', { class: 'hint', text: hint }) : null); f[name] = { w, i }; return w; };
  const opts = (name, label, entries, multi, colors) => {
    const box = el('div', { class: 'opts', role: 'group', 'aria-label': label });
    const paint = () => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(multi ? data[name].includes(b.dataset.v) : data[name] === b.dataset.v)));
    for (const [k, l] of entries) box.append(el('button', { type: 'button', 'data-v': k, 'aria-pressed': 'false', style: colors ? '--c:' + colors[k] : null, onclick: () => { if (multi) { const a = data[name]; const i = a.indexOf(k); i < 0 ? a.push(k) : a.splice(i, 1); } else data[name] = k; paint(); f[name].w.classList.remove('bad'); changed(); } }, colors ? el('i') : null, l));
    const w = el('div', { class: 'field', 'data-f': name }, el('span', { class: 'mono', text: label }), box); f[name] = { w, paint }; return w;
  };
  const tags = (name, label, ph, max, maxLen, ideas, lower) => {
    const inp = el('input', { placeholder: ph, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'enter', maxlength: String(maxLen) });
    const box = el('div', { class: 'tagbox', onclick: () => inp.focus() });
    const ideaBox = ideas ? el('div', { class: 'ideas' }) : null;
    const paint = () => {
      box.replaceChildren(...data[name].map((t, i) => el('span', { class: 't' }, t, el('button', { type: 'button', 'aria-label': 'Remove ' + t, text: '×', onclick: e => { e.stopPropagation(); data[name].splice(i, 1); paint(); changed(); } }))), inp);
      if (ideaBox) ideaBox.replaceChildren(...ideas().filter(x => !data[name].includes(x)).slice(0, 8).map(x => el('button', { type: 'button', text: '+ ' + x, onclick: () => { add(x); inp.focus(); } })));
    };
    const add = v => { v = String(v || '').replace(/\s+/g, ' ').trim().slice(0, maxLen); if (lower) v = v.toLowerCase(); if (v.length < (lower ? 2 : 1) || data[name].some(x => x.toLowerCase() === v.toLowerCase())) return; if (data[name].length >= max) { toast(`Up to ${max}.`); return; } data[name].push(v); paint(); f[name].w.classList.remove('bad'); changed(); };
    inp.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) { e.preventDefault(); add(inp.value); inp.value = ''; } else if (e.key === 'Backspace' && !inp.value && data[name].length) { data[name].pop(); paint(); changed(); } });
    inp.addEventListener('blur', () => { if (inp.value.trim()) { add(inp.value); inp.value = ''; } });
    const w = el('div', { class: 'field', 'data-f': name }, el('span', { class: 'mono' }, label), box, ideaBox);
    f[name] = { w, paint, inp }; paint(); return w;
  };
  let onChange = null; const changed = () => { if (onChange) onChange(); };
  const counter = el('em', { text: '0 / 1200' });
  const desc = el('textarea', { maxlength: '1200', rows: '6', placeholder: 'What it does, how it works and what makes it different. Plain text, line breaks are fine.' });
  desc.addEventListener('input', () => { counter.textContent = desc.value.length + ' / 1200'; });
  f.description = { w: el('label', { class: 'field', 'data-f': 'description' }, el('span', { class: 'mono' }, 'Description · optional', counter), desc), i: desc };
  const imgs = el('textarea', { rows: '3', placeholder: 'https://… one image link per line, up to 4', spellcheck: 'false', style: 'min-height:84px' });
  f.images = { w: el('label', { class: 'field', 'data-f': 'images' }, el('span', { class: 'mono' }, 'Images ', el('em', { text: 'optional · screenshots work best' })), imgs, el('small', { class: 'hint', text: 'Links to images already online (https). We show them as they are.' })), i: imgs };
  const groups = {
    basics: [
      input('name', 'Product name', { maxlength: '40', placeholder: 'Your product’s name' }),
      input('url', 'Website', { type: 'url', inputmode: 'url', maxlength: '300', placeholder: 'yourproduct.com' }, 'Where people go when they click Visit. Must work over https.'),
      input('tagline', 'One line: what it does', { maxlength: '90', placeholder: 'e.g. Invoices for freelancers in two clicks' }),
      opts('category', 'Category', Object.entries(CATS).map(([k, c]) => [k, c.label]), false, Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.color])))
    ],
    fit: [
      tags('needs', 'Problems it solves · optional', 'Type a need and press Enter, e.g. send invoices', 6, 60, () => NEED_IDEAS, true),
      input('audience', 'Who it’s for · optional', { maxlength: '140', placeholder: 'e.g. Freelancers and small agencies in the EU' }),
      opts('pricing', 'Price', Object.entries(PRICING), false),
      input('price_text', 'Price details · optional', { maxlength: '60', placeholder: 'e.g. From €9 / month' }),
      opts('platforms', 'Platforms · optional', Object.entries(PLATFORMS), true),
      tags('integrations', 'Works with · optional', 'e.g. Slack, Stripe — press Enter after each', 12, 30, null, false)
    ],
    story: [f.description.w, input('demo_url', 'Demo link · optional', { type: 'url', inputmode: 'url', maxlength: '300', placeholder: 'A live demo, video or sandbox' }), f.images.w]
  };
  f.needs.w.querySelector('.mono').append(el('em', { text: 'what people would search for' }));
  for (const k of ['name', 'url', 'tagline', 'audience', 'price_text', 'demo_url']) f[k].i.addEventListener('input', () => { f[k].w.classList.remove('bad'); changed(); });
  desc.addEventListener('input', () => { f.description.w.classList.remove('bad'); changed(); });
  imgs.addEventListener('input', () => { f.images.w.classList.remove('bad'); changed(); });
  function get() {
    return {
      name: f.name.i.value.replace(/\s+/g, ' ').trim(), url: normUrl(f.url.i.value), tagline: f.tagline.i.value.replace(/\s+/g, ' ').trim(),
      category: data.category, needs: data.needs.slice(), audience: f.audience.i.value.replace(/\s+/g, ' ').trim(), pricing: data.pricing,
      price_text: f.price_text.i.value.replace(/\s+/g, ' ').trim(), platforms: data.platforms.slice(), integrations: data.integrations.slice(),
      description: f.description.i.value.trim(), demo_url: normUrl(f.demo_url.i.value),
      images: f.images.i.value.split(/\s+/).map(s => s.trim()).filter(Boolean).slice(0, 5)
    };
  }
  function set(d) {
    d = d || {};
    for (const k of ['name', 'url', 'tagline', 'audience', 'price_text', 'demo_url', 'description']) f[k].i.value = d[k] || '';
    f.images.i.value = (d.images || []).join('\n');
    data.category = CATS[d.category] ? d.category : 'other'; data.pricing = PRICING[d.pricing] ? d.pricing : 'unspecified';
    data.needs = (d.needs || []).slice(0, 6); data.platforms = (d.platforms || []).filter(x => PLATFORMS[x]); data.integrations = (d.integrations || []).slice(0, 12);
    f.category.paint(); f.pricing.paint(); f.platforms.paint(); f.needs.paint(); f.integrations.paint();
    counter.textContent = f.description.i.value.length + ' / 1200';
    for (const k in f) f[k].w.classList.remove('bad');
  }
  const CHECKS = {
    name: d => d.name.length >= 2 || 'Give your product a name.',
    url: d => urlOk(d.url) || 'That website link doesn’t look right — it needs to work over https.',
    tagline: d => d.tagline.length >= 8 || 'Write one line about what it does (at least 8 characters).',
    category: d => !!d.category || 'Pick a category.',
    needs: d => d.needs.length <= 6 || 'Use up to six problems.',
    audience: d => !d.audience || d.audience.length >= 3 || 'Use at least three characters, or leave this blank.',
    pricing: d => !!d.pricing || 'Pick a price option.',
    description: d => !d.description || d.description.length >= 30 || 'Use at least 30 characters, or leave this blank.',
    demo_url: d => !d.demo_url || urlOk(d.demo_url) || 'The demo link needs to work over https.',
    images: d => (d.images.length <= 4 && d.images.every(urlOk)) || 'Use up to 4 image links that start with https://.'
  };
  const GROUP_FIELDS = { basics: ['name', 'url', 'tagline', 'category'], fit: ['needs', 'audience', 'pricing'], story: ['description', 'demo_url', 'images'] };
  function check(groupNames) {
    const d = get();
    for (const g of groupNames) for (const k of GROUP_FIELDS[g]) {
      const r = CHECKS[k](d);
      if (r !== true) { bad(k); toast(r, 4000); return k; }
    }
    return null;
  }
  function bad(k) { const w = f[k] && f[k].w; if (!w) return; w.classList.add('bad'); w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); const i = w.querySelector('input,textarea'); if (i) i.focus({ preventScroll: false }); w.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); }
  const groupOf = k => Object.keys(GROUP_FIELDS).find(g => GROUP_FIELDS[g].includes(k));
  return { groups, get, set, check, bad, groupOf, onChange: fn => { onChange = fn; } };
}

/* ================= ADD YOUR PRODUCT ================= */
const sub = { step: 0, spot: null, size: 1, plan: 'free', zone: 'edge', name: '', cat: '', result: null };
const wiz = makeForm();
$('#fBasics').append(wiz.groups.basics[1],$('#cAiImport'),wiz.groups.basics[0],wiz.groups.basics[2]); $('#fFit').append(wiz.groups.basics[3], ...wiz.groups.fit); $('#fStory').append(...wiz.groups.story);
async function aiRequest(body) {
  const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
  let result;try{result=await r.json();}catch{throw new Error('ai_unavailable');}
  if(!r.ok)throw new Error(result.error||'ai_unavailable');return result;
}
function aiMessage(e) {
  return {rate_limited:'You’ve used your suggestions for now. Try later, or continue manually.',daily_capacity:'Today’s AI suggestions are used up. You can still search, compare and register manually.',invalid_url:'Enter a public HTTPS website above first.',website_unavailable:'We couldn’t read that public page. You can fill in your profile manually.',page_too_large:'That page is too large to import. Try a simpler product page or fill in the details.',not_enough_content:'There isn’t enough readable text on that page. Fill in the details below.',invalid_brief:'Describe your goal in at least 12 characters.'}[e.message]||'AI suggestions are temporarily unavailable. Your work is safe; you can continue manually.';
}
let profileRequest=0;
$('#cAiDraft').onclick=async()=>{
  const url=wiz.get().url,status=$('#cAiStatus'),review=$('#cAiReview'),button=$('#cAiDraft');
  if(!urlOk(url)){status.textContent='Enter your public website above first.';wiz.groups.basics[1].querySelector('input').focus();return;}
  const request=++profileRequest;button.disabled=true;review.hidden=true;status.textContent='Reading your public page and drafting a profile…';
  try{
    const {profile}=await aiRequest({mode:'profile',url});
    if(request!==profileRequest||wiz.get().url!==url){status.textContent='The website changed. Request a new draft for the current address.';return;}
    const replace=el('input',{type:'checkbox',id:'cAiReplace'});
    const use=el('button',{type:'button',id:'cAiUse',class:'btn btn-primary btn-sm',text:'Use this draft',onclick:()=>{
      if(wiz.get().url!==url){status.textContent='The website changed. Request a new draft.';review.hidden=true;return;}
      const current=wiz.get(),next={...current};
      for(const k of ['name','tagline','description','audience','price_text','needs','platforms','integrations'])if(replace.checked||!(Array.isArray(current[k])?current[k].length:current[k]))next[k]=profile[k];
      if(replace.checked||current.category==='other')next.category=profile.category;
      if(replace.checked||current.pricing==='unspecified')next.pricing=profile.pricing;
      wiz.set(next);sub.name=next.name;sub.cat=next.category;store.set(DRAFT_KEY,{...next,size:sub.size,plan:sub.plan,zone:sub.zone});kick();
      review.hidden=true;status.textContent='Draft applied. Check the details below before continuing. Nothing has been submitted.';
    }});
    fill(review,el('div',{class:'mono',text:'Review the suggestion'}),el('h3',{text:profile.name}),el('p',{text:profile.tagline}),el('p',{text:profile.description}),el('p',{class:'fine',text:[CATS[profile.category]?.label,PRICING[profile.pricing],...(profile.needs||[])].filter(Boolean).join(' · ')}),el('label',{class:'check'},replace,' Replace details I already typed'),el('div',{class:'c-row'},use,el('button',{type:'button',class:'linkbtn',text:'Discard',onclick:()=>{review.hidden=true;status.textContent='Draft discarded. Your details were kept.';}})));
    review.hidden=false;status.textContent='AI can make mistakes. Review all facts, including pricing. Existing details are kept unless you choose to replace them.';
  }catch(e){status.textContent=aiMessage(e);}finally{button.disabled=false;}
};
let draftT = 0;
wiz.onChange(() => { const d = wiz.get(); sub.name = d.name; sub.cat = d.category; kick(); clearTimeout(draftT); draftT = setTimeout(() => store.set(DRAFT_KEY, Object.assign(d, { size: sub.size, plan: sub.plan, zone: sub.zone })), 400); });
const STEP_OF = { basics: 2, fit: 2, story: 2 };
const FLOW = [2, 1, 5, 6];
function setStep(n) {
  const prev = sub.step; sub.step = n;
  for (const i of FLOW) $('#cStep' + i).hidden = i !== n;
  claimEl.querySelectorAll('.steps i').forEach((e, i) => e.classList.toggle('on', i <= FLOW.indexOf(n)));
  claimEl.querySelector('.steps').hidden = n === 6;
  if (n === 5) renderSummary();
  if (n === 1 && sub.spot) { describe(); if (prev !== 1) centerOnSpot(true); }
  claimEl.scrollTop = 0; kick();
}
function placementSpotOk(x,y,size) {
  if (!sub.moving) return spotOk(x,y,size);
  if (zoneOf(x,y,size).reserved || Math.hypot(x+size/2,y+size/2)>=MAX_R) return false;
  for(let i=0;i<size;i++)for(let j=0;j<size;j++){const occupant=occ.get(K(x+i,y+j));if(occupant&&occupant.slug!==sub.moving)return false;}
  return true;
}
function zoneSpot(id, size, preferred) {
  if (preferred && placementSpotOk(preferred.x, preferred.y, size) && zoneOf(preferred.x, preferred.y, size).id === id) return preferred;
  const radii = { inner: 26, belt: 58, outer: 100, edge: 140 }, r = radii[id] || 140;
  // Stay in the requested zone even if a neighbouring zone has a closer empty cell.
  for (let ring = 0; ring <= 32; ring += 2) for (const radius of ring ? [r + ring, r - ring] : [r]) {
    if (radius < CORE_R || radius >= MAX_R) continue;
    for (let k = 0; k < 180; k++) { const angle = -Math.PI / 2 + k * Math.PI / 90;
      const x = Math.round(Math.cos(angle) * radius - size / 2), y = Math.round(Math.sin(angle) * radius - size / 2);
      if (zoneOf(x, y, size).id === id && placementSpotOk(x, y, size)) return { x, y };
    }
  }
  return null;
}
function chooseZone(id, size) {
  const next = zoneSpot(id, size || sub.size, sub.zone === id ? sub.spot : null);
  if (!next) { toast('No free spot of this size in this zone. Try a smaller size or another zone.'); return false; }
  sub.zone = id; sub.size = size || sub.size; setSpot(next, true); return true;
}
function startSubmit(spot, fromMap) {
  sub.moving = null; $('#cNext1').textContent = 'Review your listing →';
  if (demo) setDemo(false);
  closeSheet(); closeDlg(); sel = null; if (view === 'list') setView('map');
  if (sub.step === 6 || !sub.step) {
    sub.result = null; const d = store.get(DRAFT_KEY); wiz.set(d);
    sub.plan = d && d.plan === 'paid' ? 'paid' : 'free';
    sub.size = sub.plan === 'paid' && d && [1, 2, 4, 8].includes(d.size) ? d.size : 1;
    sub.zone = sub.plan === 'paid' && d && ['inner','belt','outer','edge'].includes(d.zone) ? d.zone : 'edge';
    sub.name = d ? d.name || '' : ''; sub.cat = d ? d.category || 'other' : 'other';
  }
  // Map previews offer a 2×2 block: keep that exact size when entering the product-first form.
  if (spot) { sub.plan = 'paid'; sub.size = [1,2,4,8].includes(spot.size) ? spot.size : 2; sub.zone = zoneOf(spot.x, spot.y, sub.size).id; }
  openPanel(claimEl, 'claim'); markExplore();
  const candidate = spot || zoneSpot(sub.zone, sub.size);
  if (candidate) { sub.spot = { x: candidate.x, y: candidate.y }; describe(); }
  setStep(2);
  if (!coarse) requestAnimationFrame(() => wiz.groups.basics[0].querySelector('input').focus({ preventScroll: true }));
}
function describe() {
  if (!sub.spot) return;
  const z = zoneOf(sub.spot.x, sub.spot.y, sub.size), zf = zoneFree(z.id);
  sub.zone = z.id;
  $('#cZone').textContent = z.label; $('#cZone').style.background = z.color;
  $('#cCloser').textContent = `${fmt(zf.free)} of ${fmt(zf.cap)} cells unoccupied`;
  $('#cPrice').textContent = sub.plan === 'free' ? '€0' : eur(paidTotal(z, sub.size));
  $('#cPriceTerms').textContent = sub.plan === 'free' ? 'Free profile · no payment required' : `${plural(sub.size * sub.size, 'cell', 'cells')} × ${eur(z.price)} · €3 minimum · one payment for 12 months · tax included where applicable`;
  $('#cPaidOptions').hidden = sub.plan === 'free';
  $('#cPlans').querySelectorAll('[data-plan]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.plan === sub.plan)));
  $('#cZoneValue').textContent = 'Every zone includes your own page, website link and stats. Map position changes where you appear while exploring; it never buys search ranking or Spotlight. No traffic or sales are guaranteed.';
  $('#cZones').replaceChildren(...ZONES.filter(z => !z.reserved).slice().reverse().map(item => {
    const f = zoneFree(item.id);
    return el('button', { type: 'button', class: 'zone-option', style: '--zc:' + item.color, 'aria-pressed': String(item.id === sub.zone), onclick: () => chooseZone(item.id) },
      el('b', { text: item.label }), el('strong', { text: eur(item.price) + ' / cell · €3 minimum' }),
      el('small', { text: `${fmt(f.free)} of ${fmt(f.cap)} cells unoccupied · ${item.line}` }));
  }));
  claimEl.querySelectorAll('[data-s]').forEach(b => {
    const sz = +b.dataset.s, candidate = zoneSpot(sub.zone, sz);
    b.disabled = !candidate; b.setAttribute('aria-pressed', String(sz === sub.size));
    b.querySelector('small').textContent = candidate ? eur(paidTotal(z, sz)) : 'Unavailable';
  });
  $('#cMoveHint').textContent = sub.plan === 'free' ? 'Your free 1×1 place is on the Edge. You can explore paid placement after review.' : (coarse ? 'Tap' : 'Click') + ' the map to move your spot. Held during review and for 7 days after approval. Pay then to keep it for 12 months.';
}
function centerOnSpot(quick) { const s = sub.spot; if (!s) return; flyTo(s.x + sub.size / 2, s.y + sub.size / 2, clamp(Math.max(cam.z, (isMobile() ? 26 : 34) / CELL / Math.max(1, sub.size / 2)), ZMIN, ZMAX), quick ? 550 : 1300, easeInOut); }
function setSpot(s, quick) { sub.spot = { x: s.x, y: s.y }; describe(); centerOnSpot(quick); }
$('#cPlans').addEventListener('click', e => {
  const b = e.target.closest('[data-plan]'); if (!b) return;
  const plan = b.dataset.plan;
  if (plan === 'free') { if (!chooseZone('edge', 1)) return; }
  sub.plan = plan; describe();
});
$('#cSizes').addEventListener('click', e => {
  const b = e.target.closest('[data-s]'); if (!b || b.disabled) return;
  chooseZone(sub.zone, +b.dataset.s);
});
$('#cNext1').onclick = async () => {
  if (!sub.spot || !placementSpotOk(sub.spot.x, sub.spot.y, sub.size)) { if (!chooseZone(sub.zone)) return; }
  if (sub.moving) {
    const slug = sub.moving, button = $('#cNext1'); button.disabled = true;
    try { OWNDATA[slug] = await rpc('owner_choose_map_spot', {p_slug:slug,p_key:OWNED[slug].key,p_x:sub.spot.x,p_y:sub.spot.y,p_size:sub.size}); sub.moving=null; await refreshAll(); openManage(slug,'placement'); toast('Spot saved. No payment has been taken.'); }
    catch(e) { toast(errCode(e)==='checkout_open'?'Finish your open payment or wait for the checkout to expire before moving.':errCode(e)==='active_purchase'?'Your paid spot is already active.':'That spot could not be saved. It may have just been taken.',5000); }
    finally { button.disabled=false; }
    return;
  }
  setStep(5); if (!coarse) requestAnimationFrame(() => $('#cMail').focus({ preventScroll: true }));
};
$('#cNext2').onclick = () => {
  const error = wiz.check(['basics', 'fit', 'story']);
  if (error) { if (!['name','url','tagline'].includes(error)) $('#cExtras').open = true; wiz.bad(error); return; }
  setStep(1);
};
claimEl.querySelectorAll('[data-back]').forEach(b => b.onclick = () => { if (sub.moving) { const slug=sub.moving;sub.moving=null;openManage(slug,'placement'); } else setStep(FLOW[Math.max(0, FLOW.indexOf(sub.step) - 1)]); });
function renderSummary() {
  const d = wiz.get(), s = sub.spot, z = zoneOf(s.x, s.y, sub.size), cat = CATS[d.category] || CATS.other;
  $('#cSummary').style.setProperty('--c', cat.color);
  $('#sName').textContent = d.name; $('#sWhere').textContent = `${cat.label} · ${z.label} · ${sub.size}×${sub.size}`;
  $('#sAmt').replaceChildren(el('b', { text: '€0' }), el('br'), sub.plan === 'free' ? 'free profile' : `${eur(paidTotal(z, sub.size))} / 12 months after review`);
  $('#cReviewTerms').textContent = sub.plan === 'free' ? 'Every product is reviewed under the same rules. Your free profile, search listing and stats have no expiry. No payment required.' : 'Every product is reviewed under the same rules. Your spot is held free during review and for 7 days after approval. Once approved, you can pay once for 12 months of placement. No automatic renewal. Payment never buys approval, search ranking or Spotlight.';
}
$('#cSubmit').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('#cWeb').value) return;
  const input = $('#cMail'), email = input.value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#fMail').classList.add('bad'); input.focus(); toast('That email looks off.'); return; }
  $('#fMail').classList.remove('bad');
  if (!$('#cOwn').checked) { toast('Please confirm that you make or represent this product.'); $('#cOwn').focus(); return; }
  const stepWithError = wiz.check(['basics', 'fit', 'story']); if (stepWithError) { setStep(2); $('#cExtras').open = true; wiz.bad(stepWithError); return; }
  const btn = $('#cSend'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const ref = store.get(REF_KEY);
    const r = await rpc('submit_product', { p: Object.assign(wiz.get(), { x: sub.spot.x, y: sub.spot.y, size: sub.size, email, ref: typeof ref === 'string' ? ref : null }) });
    OWNED[r.slug] = { key: r.key, name: r.name }; saveOwned();
    OWNDATA[r.slug] = Object.assign({}, r); delete OWNDATA[r.slug].key;
    store.del(DRAFT_KEY); store.del(REF_KEY);
    sub.result = r; rebuildItems(); loadStats();
    finish(r);
  } catch (err) {
    const m = errCode(err);
    if (m.startsWith('invalid:')) {
      const k = m.slice(8);
      if (k === 'email') { $('#fMail').classList.add('bad'); toast('That email looks off.'); }
      else if (k === 'spot') { setStep(1); toast('Pick your spot again.'); }
      else { const g = wiz.groupOf(k); if (g) { setStep(STEP_OF[g]); wiz.bad(k); } toast('Something in your profile needs a fix — check the highlighted field.', 4500); }
    } else if (m.includes('spot_taken')) {
      await refreshAll();
      const s = nearestFree(sub.spot.x, sub.spot.y, sub.size); if (s) setSpot(s, true);
      setStep(1); toast('Someone just took that exact spot! We moved you to the nearest free one.', 5000);
    } else if (m.includes('core_invite_only')) { setStep(1); toast('The middle is the Spotlight — it’s earned, not picked. Choose a spot just outside it.', 4500); }
    else if (m.includes('out_of_bounds')) { setStep(1); toast('That spot is outside the universe — pick one closer in.'); }
    else if (m.includes('too_many')) toast('You have sent several products recently. Give it an hour, or wait for the review.', 5000);
    else if (m.includes('busy')) toast('Lots of makers are adding products right now — try again in a minute.', 4500);
    else toast("Couldn't send it right now — check your connection and try again.");
  } finally { btn.disabled = false; btn.textContent = 'Send for review · free'; }
});
function finish(r) {
  setStep(6);
  const z = ZONE_BY_ID[r.zone] || zoneOf(r.x, r.y, r.size);
  $('#dTitle').textContent = `Founding spot #${fmt(r.number)}.`;
  $('#dText').textContent = `${r.name} is held in the ${z.label} (${r.size}×${r.size}). We review it before it goes live. Your link will be ${productUrl(r.slug).replace(/^https?:\/\//, '')}.`;
  $('#dKey').textContent = r.key;
  $('#dPlacement').replaceChildren(el('div', { class: 'note', text: sub.plan === 'paid' ? 'Your spot is held during review and for 7 days after approval. Once approved, open My product → Map spot to pay for 12 months. No payment has been taken.' : 'Your free profile is reserved. Add more detail or choose paid placement from your owner panel after review.' }));
  if (!store.get(OWNED_KEY)?.[r.slug]) $('#dPlacement').prepend(el('div', { class: 'note', text: 'This browser could not save your owner key. Download it now so you can manage your product later.' }));
  const it = ITEMS.find(i => i.slug === r.slug); if (it) { celebrate(it); setTimeout(() => { if (ui === 'claim' && sub.step === 6) flyTo(it.x + it.w / 2, it.y + it.h / 2, clamp(cam.z * .5, ZMIN, ZMAX), 2200, easeInOut); }, 1200); }
}
$('#dKeyCopy').onclick = async () => toast((await copy($('#dKey').textContent)) ? 'Owner key copied. Keep it somewhere safe.' : 'Select the key and copy it.');
$('#dKeySave').onclick = () => { const r = sub.result; if (r) saveKeyFile(r.slug, r.name, $('#dKey').textContent); };
$('#dManage').onclick = () => { if (sub.result) openManage(sub.result.slug, 'verify'); };
$('#dCard').onclick = () => { if (sub.result) openManage(sub.result.slug, 'share'); };
$('#dExplore').onclick = () => closeUI();
function saveKeyFile(slug, name, key) {
  download(`expanse-owner-key-${slug}.txt`, new Blob([`Expanse owner key for ${name}\n\nProduct: ${productUrl(slug)}\nOwner key: ${key}\n\nKeep this private. Anyone with this key can edit the listing.\n`], { type: 'text/plain' }));
}
function celebrate(q) {
  const cx = q.x + q.w / 2, cy = q.y + q.h / 2, t = now(), col = itemColor(q);
  if (!reduce) {
    const cols = [col, '#c8ff3d', '#ffffff', '#5ee1ff'];
    for (let i = 0; i < 90; i++) { const a = Math.random() * 6.2832, v = (5 + Math.random() * 16) * Math.max(1, q.size / 2); PARTS.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, dec: .45 + Math.random() * .6, c: cols[i % 4], sz: .22 + Math.random() * .5 }); }
    for (let i = 0; i < 3; i++) WAVES.push({ x: cx, y: cy, t: t + i * 170, col: i === 1 ? col : '#c8ff3d' });
  }
  const p = toS(cx, cy), f = $('#flash'); f.style.setProperty('--fx', p.x + 'px'); f.style.setProperty('--fy', p.y + 'px');
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); kick();
}
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { closeSheet(); startSubmit(null); });

/* Map purchases use the current reserved coordinates and a server-priced order. */
let mapPoll = 0;
async function renderMapPlacement(o) {
  const box=$('#mPlacement'),slug=mSlug; clearTimeout(mapPoll);
  if (!o.slug) { box.replaceChildren(el('p',{class:'fine',text:'Loading…'})); return; }
  box.replaceChildren(el('p',{class:'fine',text:'Checking your map spot…'}));
  let status;
  try { status=await rpc('owner_map_status',{p_slug:slug,p_key:OWNED[slug].key}); }
  catch { if(mSlug===slug&&mTab==='placement')box.replaceChildren(el('p',{class:'fine',text:'Map payments are temporarily unavailable. Your profile is safe. Please try again.'})); return; }
  if(mSlug!==slug||mTab!=='placement')return;
  const active=status.state==='paid'&&Date.parse(status.ends_at)>Date.now(),z=ZONE_BY_ID[o.zone]||ZONE_BY_ID.edge;
  const holdText=status.hold_until&&Date.parse(status.hold_until)>Date.now()?` Your chosen spot is held until ${dateStr(status.hold_until)}; without payment it returns to a free 1×1 Edge spot.`:'';
  const paid=el('div',{class:'purchase-state'},el('b',{text:active?'Your placement is active':status.state==='needs_review'?'Payment needs review':status.state==='pending'?'Waiting for payment confirmation':'Your current map spot'}),
    el('p',{class:'fine',text:active?`Paid until ${dateStr(status.ends_at)}. No automatic renewal. Your free profile continues afterwards.`:status.state==='needs_review'?status.issue:'Your product page, search listing and stats remain free.'+holdText}));
  const buy=el('button',{type:'button',class:'btn btn-primary',text:`Pay ${eur(status.amount_cents/100)} for 12 months ↗`,onclick:async()=>{
    buy.disabled=true;buy.textContent='Preparing secure payment…';
    try{
      const order=await rpc('owner_map_checkout',{p_slug:slug,p_key:OWNED[slug].key,p_terms_version:'2026-10-20'});
      const u=new URL(order.url);
      if(u.origin!=='https://buy.stripe.com'||!order.id)throw new Error('invalid_checkout');
      store.set('expanse.checkout.v1',{slug,id:order.id}); location.assign(u.href);
    }catch(err){
      const m=errCode(err);toast(m==='already_paid'?'This spot is already paid for.':m==='review_required'?'Payment opens after your product is approved.':m==='hold_expired'?'This hold expired. Choose an available spot again.':'Could not start payment. Nothing was charged. Please try again.',5000);
      buy.disabled=false;buy.textContent=`Pay ${eur(status.amount_cents/100)} for 12 months ↗`;
    }
  }});
  const change=el('button',{type:'button',class:'btn btn-ghost btn-sm',text:'Choose another zone or size',onclick:()=>{
    sub.moving=slug;sub.plan='paid';sub.size=o.size;sub.zone=o.zone;sub.spot={x:o.x,y:o.y};sub.name=o.name;sub.cat=o.category;
    openPanel(claimEl,'claim');setStep(1);$('#cNext1').textContent='Save this spot →';
  }});
  const consent=el('input',{type:'checkbox'});
  const terms=el('label',{class:'check'},consent,el('span',{text:'I agree to the purchase terms and request placement to start when payment is confirmed. One payment for 12 months, no automatic renewal, no guaranteed traffic or sales, and no effect on search or Spotlight. I keep the 14-day full-refund right.'}));
  buy.disabled=true;consent.addEventListener('change',()=>buy.disabled=!consent.checked);
  box.replaceChildren(el('h3',{class:'display',text:`${z.label} · ${o.size}×${o.size}`}),paid);
  if(!active){
    box.append(el('div',{class:'placement-total',text:`${eur(status.amount_cents/100)} / 12 months`}),el('p',{class:'fine',text:'One payment in euros. Tax included where applicable. No automatic renewal. Map placement is separate from Sponsored cards.'}));
    if(o.status!=='approved')box.append(el('p',{class:'note',text:'Your spot is held free while your product is reviewed. Payment opens after approval, under the same rules for every maker.'}));
    else if(!COMMERCE.enabled)box.append(el('p',{class:'note',text:'Payments are temporarily paused. Your free listing continues.'}));
    else if(status.state!=='needs_review')box.append(el('p',{class:'fine'},el('a',{href:'/terms',target:'_blank',rel:'noopener',text:'Read terms & refunds ↗'}),' · ',el('a',{href:'/seller',target:'_blank',rel:'noopener',text:'Seller details ↗'})),terms,buy);
    if(status.state!=='pending')box.append(change);
    else box.append(el('p',{class:'fine',text:'If you have just paid, wait for confirmation before trying again. An unpaid checkout can be resumed with the button above.'}));
  }
  box.append(el('a',{class:'linkbtn',href:'/withdraw',text:'Withdraw from a contract / request a refund'}));
  renderPurchaseHistory(box,slug);
  if(status.state==='needs_review')box.append(el('button',{class:'linkbtn',text:'Contact support',onclick:()=>openContact('other')}));
  if(status.state==='pending')mapPoll=setTimeout(()=>{if(mSlug===slug&&mTab==='placement')renderMapPlacement(OWNDATA[slug]||o);},5000);
}

async function renderPurchaseHistory(box,slug) {
 const section=el('section');box.append(section);
 try {const rows=await rpc('owner_purchase_history',{p_slug:slug,p_key:OWNED[slug].key});if(mSlug!==slug||mTab!=='placement'||!box.isConnected||!rows.length)return;
  section.append(el('h3',{text:'Order history'}));
  for(const row of rows){const text=`Expanse order ${row.id}\nState: ${row.state}\nPlacement: ${row.zone} ${row.size}×${row.size}\nTotal: ${eur(row.amount_cents/100)}\nPaid: ${row.paid_at||'Not confirmed'}\nEnds: ${row.ends_at||'Not started'}\n\n${row.contract_text||'No purchase terms recorded for this unpaid/legacy order.'}`;
   section.append(el('article',{class:'note'},el('b',{text:`${eur(row.amount_cents/100)} · ${row.state}`}),el('p',{class:'fine',text:`Order reference: ${row.id}`}),el('button',{type:'button',class:'linkbtn',text:'Download order details',onclick:()=>download(`expanse-order-${row.id}.txt`,new Blob([text],{type:'text/plain;charset=utf-8'}))}),row.paid_at?el('a',{class:'linkbtn',href:'/withdraw?reference='+encodeURIComponent(row.id),text:'Withdraw from this contract'}):null));
  }
 }catch{section.append(el('p',{class:'fine',text:'Order history could not load. Try again or contact support.'}));}
}

/* ================= OWNER PANEL ================= */
const mform = makeForm();
$('#eBasics').append(...mform.groups.basics); $('#eFit').append(...mform.groups.fit); $('#eStory').append(...mform.groups.story);
let mSlug = null, mTab = 'stats';
function updateMine() {
  const slugs = Object.keys(OWNED), b = $('#mineBtn');
  b.hidden = !slugs.length;
  b.querySelector('.long').textContent = slugs.length > 1 ? `My products (${slugs.length})` : 'My product';
}
$('#mineBtn').onclick = () => {
  const slugs = Object.keys(OWNED);
  if (slugs.length === 1) { openManage(slugs[0]); return; }
  openDlg(el('div', { class: 'mono kick', text: 'Your products' }), el('h2', { class: 'display', text: 'Which one?' }),
    el('div', { class: 'radios' }, slugs.map(s => el('button', { class: 'btn btn-ghost', style: 'justify-content:flex-start', text: OWNED[s].name || s, onclick: () => { closeDlg(); openManage(s); } }))));
};
async function openManage(slug, tab) {
  const own = OWNED[slug]; if (!own) { openOwnerLogin(slug); return; }
  closeSheet(); closeDlg(); if (view === 'list') setView('map');
  mSlug = slug; mTab = tab || (OWNDATA[slug] && OWNDATA[slug].status === 'approved' ? 'stats' : 'verify');
  renderManage();
  openPanel(manageEl, 'manage'); markExplore();
  const it = ITEMS.find(i => i.slug === slug); if (it) { sel = it; centerOn(it); }
  try { OWNDATA[slug] = await rpc('owner_get', { p_slug: slug, p_key: own.key }); kitCache.delete(slug); own.name = OWNDATA[slug].name; saveOwned(); if (mSlug === slug) renderManage(); }
  catch (e) { if (errCode(e) === 'bad_key') { delete OWNED[slug]; saveOwned(); closeUI(); toast('That key no longer works. Sign in again with your email, or use “Lost your key?”.', 5000); } }
}
function renderManage() {
  const o = OWNDATA[mSlug] || { name: (OWNED[mSlug] || {}).name || mSlug, status: '' };
  $('#mName').textContent = o.name;
  $('#mBadges').replaceChildren(...[o.status ? statusBadge(o.status) : null, o.category ? catBadge(o.category) : null, o.verified_at ? badge('b-ver', '✓ Verified') : null].filter(Boolean));
  const note = $('#mNote'); note.replaceChildren();
  if (o.status === 'pending') note.append(el('div', { class: 'note', text: 'In review. We check every new product before it goes live — you can verify your domain and polish the profile meanwhile.' }));
  else if (o.status === 'rejected') note.append(el('div', { class: 'note' }, el('b', { text: 'Changes needed. ' }), o.review_note || 'This profile was turned down in review.', ' Edit it and save to send it again.'));
  else if (o.status === 'hidden') note.append(el('div', { class: 'note' }, el('b', { text: 'Hidden. ' }), o.review_note || 'This product is hidden after reports, until it has been checked.'));
  else if (o.status === 'approved') note.append(el('div', { class: 'note ok' }, 'Live at ', el('a', { href: productUrl(mSlug), style: 'text-decoration:underline', onclick: e => { e.preventDefault(); const p = BY_SLUG.get(mSlug); if (p) openProduct(p); }, text: productUrl(mSlug).replace(/^https?:\/\//, '') })));
  $('#mTabs').querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === mTab)));
  manageEl.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== mTab);
  if (mTab === 'stats') renderStats(o);
  if (mTab === 'edit' && o.slug) mform.set(o);
  if (mTab === 'verify') renderVerify(o);
  if (mTab === 'share') renderShare(o);
  if (mTab === 'needs') renderMakerNeeds(o);
  if (mTab === 'promote') renderPromote(o);
  if (mTab === 'placement') renderMapPlacement(o);
  if (mTab === 'key') renderKey(o);
}
$('#mTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; mTab = b.dataset.tab; renderManage(); });
let growthDays=30,growthRequest=0;
async function renderStats(o) {
 const box=$('#mStats'),slug=mSlug,request=++growthRequest,G=window.ExpanseGrowth;
 if(o.status!=='approved'){fill(box,el('p',{class:'fine',text:'Growth Studio opens when your product is live.'}));return;}
 fill(box,el('p',{class:'fine',text:'Loading Growth Studio…'}));
 try{
 const [s,kit]=await Promise.all([rpc('owner_acquisition_stats',{p_slug:slug,p_key:OWNED[slug].key}),preparedKit(slug).catch(()=>null)]);
 if(request!==growthRequest||mSlug!==slug||mTab!=='stats')return;
 studioEvent(slug,'open');
 const period=s.windows?.[growthDays],t=period?.current||(growthDays===30?s.totals:{} )||{},prev=period?.previous||{},ready=G.readiness(o,kit),actions=s.actions||[],complete=new Set(actions.map(x=>x.action));
 const value=v=>typeof v==='number'?fmt(v):'Not measured',labels={map:'Map',search:'Need search',list:'Browse',shared:'Direct / saved links',sponsored:'Sponsored',home:'Home page'};
 const table=(heads,rows)=>el('div',{class:'growth-table-wrap'},el('table',{class:'source-table'},el('thead',null,el('tr',null,heads.map(text=>el('th',{scope:'col',text})))),el('tbody',null,rows)));
 const coverage=s.coverage||{},date=(new Date(Date.now()-(growthDays*2-1)*86400000)).toISOString().slice(0,10);
 const kpi=(key,label)=>{const start=['impressions','campaign_views'].includes(key)?coverage.exposures_from:coverage.profile_from;const partial=!start||start>date;return el('div',{class:'kpi'},el('small',{text:label}),el('b',{text:value(t[key])}),el('small',{text:partial?'Previous period: partial coverage':G.delta(t[key],prev[key])}));};
 const controls=el('div',{class:'growth-period','aria-label':'Statistics period'},[7,30].map(days=>el('button',{type:'button',class:'chip-btn','aria-pressed':String(days===growthDays),text:days+' days',onclick:()=>{growthDays=days;renderStats(o);}})));
 fill(box,el('div',{class:'growth-title'},el('div',null,el('span',{class:'mono kick',text:'DISCOVER → PROMOTE → GROW'}),el('h3',{class:'display',text:'Your Growth Studio'})),controls),
 el('p',{class:'fine',text:`Last ${growthDays} calendar days (UTC), including today · daily unique visitors, not page loads. One person on two days counts twice.`}),
 el('div',{class:'growth-state',text:Object.values(t).some(v=>typeof v==='number'&&v>0)?'Connected and collecting · partial measurement coverage':'Connected · no recorded traffic in this period'}),
 el('div',{class:'kpis growth-kpis'},kpi('impressions','Discovery exposure'),kpi('views','Profile views'),kpi('visits','Website clicks'),kpi('demos','Demo clicks'),kpi('campaign_views','Campaign profile views')),
 el('p',{class:'fine',text:'Not enough data for reliable engagement rates until at least 30 profile views or 100 card impressions.'}),el('p',{class:'fine',text:'Saves and follows: not measured centrally (browser-local). Verified product purchases: not connected. Third-party revenue: not connected. Website clicks are not purchases.'}));
 const days=(s.daily||[]).slice(-growthDays),chart=el('div',{class:'growth-chart'});box.append(el('h4',{text:'Engagement over time'}),chart);
 if(days.length){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 640 150');svg.setAttribute('role','img');svg.setAttribute('aria-label','Daily profile views in cyan and website clicks in lime. Exact values follow in a table.');const max=Math.max(1,...days.flatMap(d=>[d.views,d.visits]));for(const [key,color]of [['views','#5ee1ff'],['visits','#c8ff3d']]){const line=document.createElementNS(ns,'polyline');line.setAttribute('points',days.map((d,i)=>`${10+i*620/Math.max(1,days.length-1)},${135-(Number(d[key])||0)*120/max}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke',color);line.setAttribute('stroke-width','3');svg.append(line);}chart.append(svg,el('p',{class:'fine',text:'Cyan: profile views · Lime: website clicks · '+days[0].day+' → '+days.at(-1).day}));box.append(el('details',null,el('summary',{text:'Exact daily observations'}),table(['UTC day','Profile','Website','Demo'],days.map(d=>el('tr',null,...[d.day,value(d.views),value(d.visits),value(d.demos)].map(text=>el('td',{text})))))));}
 else chart.append(el('p',{class:'fine',text:'Daily observations are unavailable. No chart has been estimated.'}));
 const checklist=el('div',{class:'growth-readiness'},el('div',{class:'growth-score'},el('b',{text:ready.score+'/100'}),el('span',{text:'Profile readiness'})),el('p',{class:'fine',text:'Controllable profile quality. This is not popularity, search rank or a sales prediction.'}),ready.checks.map(c=>el('button',{class:'growth-check',type:'button',onclick:()=>{mTab=c.tab;renderManage();}},el('span',{text:(c.ok?'✓ ':'○ ')+c.label}),el('small',{text:(c.ok?'+':'0 / ')+c.points}))));box.append(checklist,el('h4',{text:'Your next useful actions'}));
 const recs=G.recommendations(o,t,kit).filter(r=>!complete.has(r.id));if(!recs.length)box.append(el('p',{class:'fine',text:'No new recommendation from the available evidence. Keep your profile accurate and review genuine campaign results.'}));
 for(const rec of recs)box.append(el('article',{class:'growth-opportunity'},el('span',{class:'mono kick',text:rec.kind}),el('b',{text:rec.title}),el('p',{class:'fine',text:rec.evidence}),el('div',{class:'c-row'},el('button',{class:'btn btn-ghost btn-sm',text:'Open '+(rec.tab==='share'?'marketing kit':rec.tab),onclick:()=>{mTab=rec.tab;renderManage();}}),el('button',{class:'linkbtn',text:'Mark completed',onclick:async e=>{e.currentTarget.disabled=true;try{await rpc('owner_growth_action',{p_slug:slug,p_key:OWNED[slug].key,p_action:rec.id,p_complete:true});renderStats(o);}catch{toast('Action could not be saved.');e.currentTarget.disabled=false;}}}))));
 box.append(el('p',{class:'fine',text:'Rules use minimum samples and describe patterns, not statistical significance. Suggestions without traffic evidence are labeled. No AI call is made for dashboard recommendations.'}));
 if(actions.length)box.append(el('details',null,el('summary',{text:'Completed actions & observations'}),actions.map(a=>el('article',{class:'growth-opportunity'},el('b',{text:a.action+' · '+dateStr(a.completed_at)}),el('p',{class:'fine',text:`Before: ${value(a.baseline?.views)} profile views, ${value(a.baseline?.visits)} website clicks over 7 days. After: ${value(a.after?.views)} views, ${value(a.after?.visits)} clicks over ${a.after?.days??'unknown'} complete UTC days (up to 30). Unequal periods; this does not prove the action caused a change.`}),el('button',{class:'linkbtn',text:'Reopen action',onclick:async()=>{try{await rpc('owner_growth_action',{p_slug:slug,p_key:OWNED[slug].key,p_action:a.action,p_complete:false});renderStats(o);}catch{toast('Could not reopen action.');}}})))));
 box.append(el('h4',{text:'Discovery sources · last 30 days'}),table(['Source','Impressions','Profile','Website'],(s.sources||[]).map(r=>el('tr',null,el('th',{scope:'row',text:labels[r.source]||r.source}),...[r.impressions,r.views,r.visits].map(v=>el('td',{text:value(v)}))))),el('h4',{text:'Top channels · last 30 days'}),table(['Channel','Profile','Website'],(s.campaigns||[]).map(r=>el('tr',null,el('th',{scope:'row',text:r.channel}),el('td',{text:value(r.views)}),el('td',{text:value(r.visits)})))));
 if(!s.campaigns?.length)box.append(el('p',{class:'fine',text:'No recorded campaign traffic. Use a tracked campaign link from your marketing kit.'}));
 box.append(el('details',null,el('summary',{text:'Metric definitions & measurement limits'}),el('p',{class:'fine',text:'Discovery exposure: a product card at least 60% visible for one second in an active tab. Map and direct-link exposures are not measured. Profile/website/demo events are deduplicated per visitor, product, kind and UTC day. Sources and campaigns can overlap; do not add them to the unique totals. Owner visits and recognized bots are excluded. Tracking cannot identify buyers. Exposure/campaign collection began 21 October 2026; comparisons spanning earlier dates are partial. Low counts are not reliable trends. No private search text or visitor identities are shown. Source and campaign tables use 30 days regardless of the selected overview period.'})),el('button',{class:'btn btn-primary btn-sm',text:'Open marketing kit →',onclick:()=>{mTab='share';renderManage();}}));
 }catch{if(request===growthRequest&&mSlug===slug&&mTab==='stats')fill(box,el('p',{class:'fine',text:'Statistics are unavailable right now. No figures have been estimated.'}),el('button',{class:'btn btn-ghost btn-sm',text:'Try again',onclick:()=>renderStats(o)}));}
}

function checksBox(o) {
  const c = o.checks || {}, row = (label, at, fails, status, okText) => el('li', { class: !at ? '' : fails ? 's-bad' : 's-up' },
    el('b', { text: label + ': ' + (!at ? 'not checked yet' : fails ? `didn’t load on the last ${fails === 1 ? 'check' : fails + ' checks'}` : okText) }),
    el('small', { text: at ? `Last check ${timeAgo(at)}${fails && status ? ' · ' + status.replace('http_', 'HTTP ') : ''}` : 'We check once a day, starting soon after you add or change a link.' }));
  return el('div', { class: 'sec' }, el('h4', { class: 'mono', text: 'Daily checks' }),
    el('ul', { class: 'signals' }, row('Website', c.site_checked_at, c.site_fails, c.site_status, 'answers'), o.demo_url ? row('Demo', c.demo_checked_at, c.demo_fails, c.demo_status, 'works') : null),
    el('p', { class: 'fine', text: 'Passing checks show on your profile with their date. If your website doesn’t answer three days in a row, we take a look.' }));
}
/* Where the owner stands for the Spotlight: in it, or what's still missing. */
function spotBox(o) {
  if (o.status !== 'approved') return null;
  if (o.spotlight_rank) return el('div', { class: 'note ok', style: 'margin-top:14px' }, el('b', { text: `★ You’re in the Spotlight, place ${o.spotlight_rank} of 8.` }), ' Your product shows in the core of the map. Places follow real use over the last 30 days and update every hour.');
  if (o.spotlight_blocked) return null;
  const c = o.checks || {}, siteOk = !!o.site_ok_at && !c.site_fails;
  return el('div', { class: 'sec spotreq' }, el('h4', { class: 'mono', text: '★ Get into the Spotlight' }),
    el('p', { class: 'c-text', style: 'font-size:13.5px;margin-top:0', text: 'The 8 places in the core go to the most-used products. They’re earned, never sold. To qualify:' }),
    el('div', { class: 'req ' + (o.verified_at ? 'ok' : '') }, o.verified_at ? '✓ ' : '○ ', 'Verified domain'),
    el('div', { class: 'req ' + (siteOk ? 'ok' : '') }, siteOk ? '✓ ' : '○ ', 'Website answers (checked daily)'),
    el('p', { class: 'fine', text: o.verified_at && siteOk ? 'You qualify. Places go to the products the largest share of visitors click through to or upvote over the last 30 days, updated every hour. 2 places are kept for products that went live in the last 30 days.' : 'Then places go to the products the largest share of visitors click through to or upvote over the last 30 days — not the ones with the most visitors. 2 places are kept for products that went live in the last 30 days, and while fewer than 8 qualify, everyone who does gets a place.' }));
}
function renderVerify(o) {
  const box = $('#mVerify');
  if (!o.slug) { box.replaceChildren(el('p', { class: 'fine', text: 'Loading…' })); return; }
  if (o.verified_at) { fill(box, spotBox(o), el('div', { class: 'note ok', style: 'margin-top:14px' }, el('b', { text: `✓ ${o.domain} verified on ${dateStr(o.verified_at)}.` }), ' The badge shows on your profile. It proves you control the domain — it is not a rating and it is never sold.'), checksBox(o), repoBox(o)); return; }
  const meta = `<meta name="expanse-verification" content="${o.verify_token}">`;
  const btn = el('button', { class: 'btn btn-primary btn-sm', text: 'Check now', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Checking ' + o.domain + '…';
    const r = await fnCall('verify-domain', { slug: mSlug, key: OWNED[mSlug].key });
    btn.disabled = false; btn.textContent = 'Check now';
    if (r.ok) { toast('Verified! The badge is on your profile.'); o.verified_at = r.verified_at; await refreshAll(); try { OWNDATA[mSlug] = await rpc('owner_get', { p_slug: mSlug, p_key: OWNED[mSlug].key }); } catch (e) {} renderManage(); }
    else if (r.reason === 'missing') toast(`We reached ${o.domain} but didn't find the code yet. If you just added it, give it a minute.`, 5500);
    else if (r.reason === 'unreachable') toast(`We couldn't reach https://${o.domain}. Check that the site is up and works over https.`, 5500);
    else if (r.reason === 'slow_down') toast('Give it a few seconds between checks.');
    else toast("Couldn't check right now — try again in a moment.");
  } });
  fill(box, spotBox(o),
    el('p', { class: 'c-text', text: `Prove you control ${o.domain} and your profile gets a verified badge with today's date. Pick one:` }),
    el('div', { class: 'sec' }, el('h4', { class: 'mono', text: 'A · Add a meta tag to your home page' }), el('div', { class: 'codeblock', text: meta }), el('button', { class: 'linkbtn', style: 'margin-top:6px', text: 'Copy tag', onclick: async () => toast((await copy(meta)) ? 'Tag copied — paste it inside <head>.' : 'Select the tag and copy it.') })),
    el('div', { class: 'sec' }, el('h4', { class: 'mono', text: 'B · Or upload a text file' }), el('div', { class: 'codeblock', text: `https://${o.domain}/.well-known/expanse-verification.txt` }), el('small', { class: 'hint', style: 'display:block;color:var(--muted);font-size:12px;margin-top:6px', text: 'containing only: ' + o.verify_token })),
    el('div', { class: 'c-row' }, btn),
    el('p', { class: 'fine', text: 'Verification is free and separate from payment. If you change your website to another domain, you verify again.' }),
    checksBox(o), repoBox(o));
}
/* GitHub: the repo counts once the product's site links to it, or the repo holds the verify code. */
function repoBox(o) {
  const inp = el('input', { placeholder: 'github.com/you/your-repo', autocomplete: 'off', spellcheck: 'false', inputmode: 'url' });
  inp.value = o.repo_requested ? 'github.com/' + o.repo_requested : '';
  const status = o.repo ? el('div', { class: 'note ok' }, el('b', { text: `✓ Connected to github.com/${o.repo}.` }), o.release ? ` Latest release: ${o.release.title || o.release.tag}, ${timeAgo(o.release.at)}.` : ' New releases show up on your profile within a few minutes of being published.')
    : o.repo_requested ? el('div', { class: 'note' }, `Not connected yet. Link to https://github.com/${o.repo_requested} from ${o.domain}, or add a file named expanse-verification.txt containing ${o.verify_token} to the repo. Then check again.`) : null;
  const btn = el('button', { class: 'btn btn-primary btn-sm', text: o.repo_requested && !o.repo ? 'Check again' : 'Save & check' });
  btn.onclick = async () => {
    const slug = mSlug, v = inp.value.trim(); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      OWNDATA[slug] = await rpc('owner_set_repo', { p_slug: slug, p_key: OWNED[slug].key, p_repo: v });
      if (!v) { toast('GitHub disconnected.'); await refreshAll(); renderManage(); return; }
      const r = await fnCall('verify-domain', { slug, key: OWNED[slug].key, repo: true });
      if (r.ok) { toast('Connected! Your releases show on your profile and in your followers’ updates.', 4500); OWNDATA[slug] = await rpc('owner_get', { p_slug: slug, p_key: OWNED[slug].key }); await refreshAll(); }
      else if (r.reason === 'missing') toast(`We didn’t find a link to github.com/${r.repo} on ${r.domain}, or the code file in the repo.`, 6000);
      else if (r.reason === 'unreachable') toast(`We couldn’t reach https://${r.domain} or the repo. Check that both are public.`, 5500);
      else if (r.reason === 'slow_down') toast('Give it a few seconds between checks.');
      else toast('Couldn’t check right now — try again in a moment.');
      if (mSlug === slug) renderManage();
    } catch (e) {
      const m = errCode(e); toast(m === 'invalid:repo' ? 'Use the repo link, like github.com/you/your-repo.' : m === 'hidden' ? 'This product is hidden while it is being checked.' : 'Couldn’t save right now — try again.');
    } finally { btn.disabled = false; btn.textContent = 'Save & check'; }
  };
  return el('div', { class: 'sec' }, el('h4', { class: 'mono', text: 'GitHub releases' }),
    el('p', { class: 'c-text', style: 'font-size:13.5px;margin-top:0', text: 'Connect your public repo: new releases show on your profile and in the updates of everyone who follows you.' }),
    el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Repository' }), inp), status, el('div', { class: 'c-row' }, btn));
}
async function renderShare(o) {
 const box=$('#mShare'),slug=mSlug,url=productUrl(slug),G=window.ExpanseGrowth;
 if(o.status!=='approved'){fill(box,el('p',{class:'fine',text:'Your sharing kit is prepared when your product goes live. Your future profile link:'}),el('div',{class:'codeblock',text:url}));return;}
 fill(box,el('p',{class:'fine',text:'Loading your prepared sharing kit…'}));
 try{
 const kit=await preparedKit(slug),s=await rpc('owner_acquisition_stats',{p_slug:slug,p_key:OWNED[slug].key});if(mSlug!==slug||mTab!=='share')return;
 studioEvent(slug,'kit-open');
 const draftKey='expanse.post.v1.'+slug+'.'+kit.revision,local=store.get(draftKey)||{},campaignRows=s.campaign_rows||[],campaign=el('select',{'aria-label':'Campaign'},el('option',{value:kit.campaign,text:'Profile sharing kit'}),campaignRows.filter(r=>r.campaign!==kit.campaign).map(r=>el('option',{value:r.campaign,text:r.name}))),kind=el('select',{'aria-label':'Campaign purpose'},Object.entries(G.kinds).map(([value,text])=>el('option',{value,text}))),channel=el('select',{'aria-label':'Where you will share'},marketing.channels.map(v=>el('option',{value:v,text:({x:'X',threads:'Threads',linkedin:'LinkedIn',newsletter:'Newsletter',other:'Other / short announcement'})[v]}))),format=el('select',{'aria-label':'Image format'},[['prepared','Original prepared card'],['launch','Launch portrait · 1080×1350'],['square','Square · 1080×1080'],['story','Story · 1080×1920']].map(([value,text])=>el('option',{value,text}))),other=el('select',{'aria-label':'Product to compare'},el('option',{value:'',text:'Optional: choose another real product'}),PRODUCTS.filter(p=>p.slug!==slug).map(p=>el('option',{value:p.slug,text:p.name})));
 channel.value=marketing.channels.includes(local.channel)?local.channel:'x';kind.value='launch';
 const text=el('textarea',{rows:6,maxlength:3000,'aria-label':'Editable post',value:typeof local.text==='string'?local.text:kit.post_text}),link=el('input',{type:'url',readonly:true,'aria-label':'Trackable product link'}),preview=el('img',{class:'kit-preview',src:'/api/marketing-card?slug='+encodeURIComponent(slug)+'&revision='+kit.revision,alt:o.name+' — prepared Expanse share card',width:1080,height:1350}),performance=el('p',{class:'fine'});let activeKit=kit,previewUrl;
 const currentLink=()=>marketing.link(slug,campaign.value,channel.value);
 const update=()=>{link.value=currentLink();store.set(draftKey,{text:text.value,channel:channel.value});const row=campaignRows.find(r=>r.campaign===campaign.value);performance.textContent=row?`${row.views} profile opens · ${row.visits} website clicks · last 30 days, all channels. Not sales.`:'No campaign observations available.';};
 const image=()=>{if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}if(format.value==='prepared'){activeKit=kit;preview.src='/api/marketing-card?slug='+encodeURIComponent(slug)+'&revision='+kit.revision;}else{const compare=BY_SLUG.get(other.value),svg=G.asset(o,kind.value,format.value,compare);activeKit={...kit,svg,revision:kit.revision+':'+kind.value+':'+format.value+':'+(compare?.slug||'')+':'+(compare?.tagline||'')};previewUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));preview.src=previewUrl;}const dims=format.value==='prepared'?[1080,1350]:G.formats[format.value];preview.width=dims[0];preview.height=dims[1];};
 const generate=()=>{text.value=G.copy(o,kind.value,channel.value,BY_SLUG.get(other.value));update();};
 channel.onchange=update;text.oninput=update;campaign.onchange=()=>{const row=campaignRows.find(r=>r.campaign===campaign.value);if(row)kind.value=row.kind;update();};kind.onchange=image;format.onchange=image;other.onchange=image;update();
 const name=el('input',{maxlength:60,placeholder:'e.g. Black Friday launch','aria-label':'New campaign name'}),create=el('button',{class:'btn btn-ghost btn-sm',text:'Create tracked campaign',onclick:async()=>{create.disabled=true;try{const row=await rpc('owner_create_campaign',{p_slug:slug,p_key:OWNED[slug].key,p_name:name.value.trim(),p_kind:kind.value});if(!campaignRows.some(x=>x.campaign===row.campaign)){campaignRows.unshift({...row,views:0,visits:0});campaign.append(el('option',{value:row.campaign,text:row.name}));}campaign.value=row.campaign;update();toast('Campaign link ready. Publish it yourself.');}catch(e){toast(errCode(e).includes('slow_down')?'Campaign limit reached for this hour. Try later.':'Could not create campaign. Use a name of 2–60 characters, or reuse an existing campaign.');}finally{create.disabled=false;}}});
 const save=el('button',{class:'btn btn-primary btn-sm',text:'Download PNG',onclick:async()=>{save.disabled=true;try{download(slug+'-'+format.value+'.png',await marketing.png(slug,activeKit));studioEvent(slug,'download');toast('Image saved.');}catch{toast('PNG conversion failed. Download original image (SVG) instead.',5000);}finally{save.disabled=false;}}});
 fill(box,el('h3',{text:'Your ready-to-share kit · 2.0'}),el('p',{class:'fine',text:'Prepared from approved public facts. Choose a campaign and format; edit before publishing. Feature-update copy describes listed capabilities, not an invented release. Seasonal templates do not claim a discount.'}),
 el('div',{class:'kit-layout'},el('div',null,preview,el('button',{class:'linkbtn',text:'Download original image',onclick:()=>download(slug+'-'+format.value+'.svg',new Blob([activeKit.svg],{type:'image/svg+xml'}))})),el('div',null,el('label',{class:'field'},el('span',{text:'Campaign'}),campaign),performance,el('label',{class:'field'},el('span',{text:'Purpose'}),kind),el('label',{class:'field'},el('span',{text:'Create a recognizable campaign'}),name),create,el('label',{class:'field'},el('span',{text:'Channel / copy style'}),channel),el('label',{class:'field'},el('span',{text:'Image format'}),format),el('label',{class:'field'},el('span',{text:'Comparison · approved public facts only'}),other),el('button',{class:'linkbtn',text:'Prepare copy from product facts',onclick:generate}),el('label',{class:'field'},el('span',{text:'Your post · edit freely'}),text),el('label',{class:'field'},el('span',{text:'Trackable profile link'}),link),el('div',{class:'c-row'},save,el('button',{class:'btn btn-ghost btn-sm',text:'Copy post + link',onclick:async()=>{const ok=await copy(marketing.post(text.value,link.value));if(ok)studioEvent(slug,'copy');toast(ok?'Post and link copied.':'Select your post and link to copy.');}}),el('button',{class:'btn btn-ghost btn-sm',text:'Copy link',onclick:async()=>toast(await copy(link.value)?'Tracking link copied.':'Select the link to copy.')})))),
 el('p',{class:'fine',text:'Campaign IDs are generated and validated by Expanse. Names stay in your private studio. Legacy links continue working. Profile views are attributed to the link, not proof of a customer or sale. Cached images and post drafts stay in this browser. No automatic posting.'}),
 el('div',{class:'growth-handoff'},el('h4',{text:'Create a campaign in MakeItReal'}),el('p',{class:'fine',text:'Review and copy your approved public product facts, then paste them into Campaign Studio. No accounts, private analytics or owner keys are shared.'}),el('button',{class:'btn btn-ghost btn-sm',text:'Review campaign brief →',onclick:()=>{const brief=G.brief(o,currentLink()),payload=JSON.stringify(brief,null,2);openDlg(el('h2',{class:'display',text:'Review your public campaign brief'}),el('pre',{class:'codeblock',text:payload}),el('p',{class:'fine',text:'Manual handoff: copy the one-sentence summary into “What is it?” and the website into “Website” in MakeItReal. Review and confirm the facts there. Return to Expanse → Growth Studio to review tracked link visits. No OAuth, automatic project import or sales synchronization is connected.'}),el('div',{class:'c-row'},el('button',{class:'btn btn-primary btn-sm',text:'Copy approved facts',onclick:()=>copy(payload)}),el('button',{class:'btn btn-ghost btn-sm',text:'Copy one-sentence summary',onclick:()=>copy(o.name+' — '+o.tagline)}),el('button',{class:'btn btn-ghost btn-sm',text:'Copy website',onclick:()=>copy(o.url)}),el('a',{class:'btn btn-ghost btn-sm',href:'https://makeit-real.vercel.app/en/launch.html',target:'_blank',rel:'noopener',text:'Open MakeItReal Campaign Studio ↗'}),el('button',{class:'btn btn-ghost btn-sm',text:'Back to Expanse',onclick:closeDlg})));}})));
 renderSeasonalForm(box,o);
 }catch{if(mSlug===slug&&mTab==='share')fill(box,el('p',{class:'fine',text:'The prepared kit is unavailable right now. Your product page still works:'}),el('div',{class:'codeblock',text:url}),el('button',{class:'btn btn-ghost btn-sm',text:'Copy profile link',onclick:()=>copy(url)}),el('button',{class:'btn btn-ghost btn-sm',text:'Try again',onclick:()=>{kitCache.delete(slug);renderShare(o);}}));}
}

function studioEvent(slug,action){if(OWNED[slug])rpc('owner_studio_event',{p_slug:slug,p_key:OWNED[slug].key,p_action:action}).catch(()=>{});}
async function renderSeasonalForm(parent,o){
 const slug=o.slug,section=el('details',{class:'growth-handoff'},el('summary',{text:'Submit a real seasonal offer for review'}));parent.append(section);
 try{const current=await rpc('owner_seasonal_offer',{p_slug:slug,p_key:OWNED[slug].key});if(!section.isConnected)return;
 const field=(label,type,value,max)=>{const i=el(type==='textarea'?'textarea':'input',{type:type==='textarea'?null:type,maxlength:max,value:value||'',required:true});section.append(el('label',{class:'field'},el('span',{text:label}),i));return i;};
 section.append(el('p',{class:'fine',text:'One offer per verified product, under the same review rules for everyone. It is invisible until a reviewer checks your evidence. Discounts require a clearly stated price basis and any legally required prior lowest price. No ranking benefit. Dates use UTC; offers disappear automatically when they expire.'}));
 if(current)section.append(el('p',{class:'note',text:'Current submission: '+current.state+' · valid until '+dateStr(current.ends_at)}));
 if(!o.verified_at){section.append(el('p',{class:'fine',text:'Verify domain ownership before submitting a seasonal offer.'}));return;}
 const title=field('Offer title','text',current?.title,100),details=field('Exact offer details and pricing disclosures','textarea',current?.details,600),url=field('Offer page · same verified domain','url',current?.offer_url||o.url,500),evidence=field('Public evidence page · same verified domain','url',current?.evidence_url,500),note=field('Evidence and price history for reviewer · not public','textarea',current?.evidence_note,1000),season=el('select',{'aria-label':'Season'},[['black-friday','Black Friday'],['christmas','Christmas'],['launch','Launch promotion']].map(([value,text])=>el('option',{value,text})));season.value=current?.season||'black-friday';section.append(el('label',{class:'field'},el('span',{text:'Season'}),season));
 const start=field('Starts · UTC','datetime-local',current?.starts_at?.slice(0,16)||'2026-11-27T00:00'),end=field('Ends · UTC','datetime-local',current?.ends_at?.slice(0,16)||'2026-11-30T23:59'),ack=el('input',{type:'checkbox'}),status=el('p',{class:'fine',role:'status'});
 section.append(el('label',{class:'check'},ack,el('span',{text:'These details are accurate. I provided evidence, current terms and applicable prior-price disclosures. Changes require a fresh review.'})),el('button',{class:'btn btn-ghost btn-sm',text:'Submit offer for evidence review',onclick:async e=>{if(!ack.checked){status.textContent='Confirm the accuracy and evidence before submitting.';return;}const b=e.currentTarget;b.disabled=true;try{await rpc('owner_seasonal_offer',{p_slug:slug,p_key:OWNED[slug].key,p_offer:{title:title.value,details:details.value,offer_url:url.value,evidence_url:evidence.value,evidence_note:note.value,season:season.value,starts_at:new Date(start.value+'Z').toISOString(),ends_at:new Date(end.value+'Z').toISOString()}});status.textContent='Submitted privately for review. Nothing has been advertised.';}catch{status.textContent='Could not submit. Check lengths, dates (maximum 90 days), your verified domain and evidence.';}finally{b.disabled=false;}}}),current?el('button',{class:'linkbtn',text:'Remove offer',onclick:async()=>{try{await rpc('owner_seasonal_offer',{p_slug:slug,p_key:OWNED[slug].key,p_remove:true});section.remove();toast('Offer removed.');}catch{toast('Could not remove offer.');}}}):null,status);
 }catch{section.append(el('p',{class:'fine',text:'Offer submissions are unavailable right now.'}));}
}
function offerCard(offer){return el('article',{class:'growth-opportunity'},el('span',{class:'mono kick',text:'Evidence-reviewed seasonal offer'}),el('b',{text:offer.title}),el('p',{text:offer.details}),el('p',{class:'fine',text:'Valid until '+new Date(offer.ends_at).toISOString().replace('T',' ').slice(0,16)+' UTC · maker-provided terms; review is not legal certification.'}),el('button',{class:'btn btn-ghost btn-sm',text:'View product & offer',onclick:()=>{const p=BY_SLUG.get(offer.slug);if(p)openProduct(p);}}));}
async function showSeasonalOffers(){openDlg(el('h2',{class:'display',text:'Real seasonal offers'}),el('p',{class:'fine',text:'Verified products, evidence-reviewed terms and real expiry dates. Offers never affect organic search ranking.'}),el('div',{id:'seasonalRows'},el('p',{class:'fine',text:'Loading…'})));const box=$('#seasonalRows');try{const rows=await rpc('public_seasonal_offers');if(!box.isConnected)return;fill(box,rows.length?rows.map(offerCard):el('p',{class:'note',text:'No reviewed seasonal offers are active. We do not invent discounts. Explore the real catalog or submit an offer from your product’s Marketing kit.'}));}catch{if(box.isConnected)fill(box,el('p',{class:'fine',text:'Seasonal offers are temporarily unavailable.'}));}}
async function productOffer(p,box){try{const rows=await rpc('public_seasonal_offers');if(!box.isConnected||popBody.dataset.slug!==p.slug)return;const o=rows.find(x=>x.slug===p.slug&&Date.parse(x.ends_at)>Date.now());if(o)box.append(el('div',{class:'growth-opportunity'},el('b',{text:o.title}),el('p',{text:o.details}),el('p',{class:'fine',text:'Evidence-reviewed · valid until '+dateStr(o.ends_at)+' · see the maker’s exact terms.'}),el('a',{class:'btn btn-ghost btn-sm',href:discoveryUrl(o.offer_url,p.slug),target:'_blank',rel:'noopener nofollow ugc',text:'See seasonal offer ↗',onclick:()=>track(p.slug,'visit','shared')})));}catch{/* Optional offers never block the product. */}}

function renderKey(o) {
  const slug = mSlug, own = OWNED[slug], key = own.key, viaEmail = own.via === 'email', code = el('code', { text: '•'.repeat(24) });
  const others = Math.max(0, (o.devices || 0) - (viaEmail ? 1 : 0));
  const forget = msg => { delete OWNED[slug]; delete OWNDATA[slug]; saveOwned(); rebuildItems(); closeUI(); toast(msg); };
  let shown = false;
  box_($('#mKey'), ...[
    el('div', { class: 'keybox' }, el('b', { text: viaEmail ? 'Key for this device' : 'Owner key' }), code,
      el('div', { class: 'c-row' },
        el('button', { class: 'btn btn-ghost btn-xs', text: 'Show', onclick: e => { shown = !shown; code.textContent = shown ? key : '•'.repeat(24); e.target.textContent = shown ? 'Hide' : 'Show'; } }),
        el('button', { class: 'btn btn-ghost btn-xs', text: 'Copy', onclick: async () => toast((await copy(key)) ? 'Key copied.' : 'Couldn’t copy.') }),
        viaEmail ? null : el('button', { class: 'btn btn-ghost btn-xs', text: 'Download', onclick: () => saveKeyFile(slug, o.name, key) })),
      el('small', { text: viaEmail
        ? `This browser is signed in with ${o.email || 'your email'}. Its key works until you sign out here; your original owner key keeps working.`
        : 'Anyone with this key can edit your listing. Contact email on file: ' + (o.email || '—') })),
    others ? el('p', { class: 'fine' }, `Signed in with email on ${others} other ${others === 1 ? 'device' : 'devices'}. `,
      el('button', { class: 'linkbtn', text: 'Sign them out', onclick: async e => {
        e.currentTarget.disabled = true;
        try { const r = await rpc('owner_signout', { p_slug: slug, p_key: key, p_scope: 'others' }); toast(`Signed out on ${r.revoked} ${r.revoked === 1 ? 'device' : 'devices'}.`); OWNDATA[slug] = await rpc('owner_get', { p_slug: slug, p_key: key }); if (mSlug === slug) renderManage(); }
        catch (err) { toast("Couldn't sign them out right now — try again."); }
      } })) : null,
    el('div', { class: 'c-row' },
      viaEmail
        ? el('button', { class: 'btn btn-ghost btn-sm', text: 'Sign out on this device', onclick: async () => { try { await rpc('owner_signout', { p_slug: slug, p_key: key, p_scope: 'this' }); } catch (e) {} forget('Signed out on this device. Your listing is unchanged.'); } })
        : el('button', { class: 'btn btn-ghost btn-sm', text: 'Forget on this device', onclick: () => forget('Removed from this browser. Your listing is unchanged.') }),
      el('button', { class: 'btn btn-danger btn-sm', text: 'Take listing down', onclick: () => confirmRemove(o) }))].filter(Boolean));
}
/* Promote: ask for a Sponsored slot, pay once it's confirmed, and see what it did. */
const PSTATE = { requested: 'Requested', awaiting_payment: 'Waiting for payment', expired: 'Not paid in time', upcoming: 'Starts soon', live: 'Running now', ended: 'Ended', rejected: 'Declined', cancelled: 'Withdrawn' };
const dayFmt = d => { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; } };
async function renderPromote(o) {
  const box = $('#mPromote'), slug = mSlug;
  if (o.status !== 'approved') { box.replaceChildren(el('p', { class: 'fine', text: 'Promotion opens when your product is live.' })); return; }
  box.replaceChildren(el('p', { class: 'fine', text: 'Loading…' }));
  let d; try { d = await rpc('owner_placements', { p_slug: slug, p_key: OWNED[slug].key }); }
  catch (e) { box.replaceChildren(el('p', { class: 'fine', text: "Couldn't load this right now." })); return; }
  if (mTab !== 'promote' || mSlug !== slug) return;
  const items = d.items || [], open = items.some(x => ['requested', 'awaiting_payment', 'upcoming', 'live'].includes(x.state));
  const price = d.price_year_eur != null ? Number(d.price_year_eur) : null;
  box.replaceChildren(...[
    el('div', { class: 'promo' },
      el('h4', { text: 'Sponsored for a year' }),
      el('p', { text: 'For a whole year, your product can show in a card marked “Sponsored” above the results when people search for what it solves, and at the top of the list. It only shows where it fits the search, and it never changes where you rank.' }),
      el('p', { class: 'fine', text: (price != null ? `${eur(price)} for the year. ` : 'We confirm the price with you before you pay. ') + 'Nothing is charged automatically: you pay once we have confirmed the dates. You get a report of how often the card was shown and clicked, and of your views and clicks compared with the days before.' })),
    open ? null : promoForm(slug, price),
    ...items.map(x => placementItem(slug, x))].filter(Boolean));
}
const weeksLabel = w => w === 52 ? '1 year' : plural(w, 'week', 'weeks');
function promoForm(slug, price) {
  const weeks = 52;
  const start = el('input', { type: 'date', min: new Date().toISOString().slice(0, 10), 'aria-label': 'Preferred start' });
  const note = el('textarea', { maxlength: '400', rows: '2', placeholder: 'Anything we should know (optional)' });
  const send = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Request a slot' });
  const form = el('form', { onsubmit: async e => {
    e.preventDefault(); send.disabled = true;
    try {
      await rpc('owner_request_placement', { p_slug: slug, p_key: OWNED[slug].key, p: { weeks, start: start.value || null, note: note.value } });
      toast('Request sent. We’ll email you to confirm the dates and payment.', 4500);
      if (mSlug === slug) renderManage();
    } catch (err) {
      const m = errCode(err);
      toast(m === 'busy' ? 'You already have a slot requested or running.' : m === 'invalid:start' ? 'Pick a start date from today and up to six months ahead.' : m === 'not_live' ? 'Promotion opens when your product is live.' : "Couldn't send the request — try again.");
    } finally { send.disabled = false; }
  } },
    el('div', { class: 'field' }, el('span', { class: 'mono', text: 'Length' }), el('b', { class: 'plen', text: '1 year' + (price != null ? ' · ' + eur(price) : '') })),
    el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Preferred start' }), start, el('small', { class: 'hint', text: 'Leave empty for as soon as possible.' })),
    el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Note' }), note),
    el('div', { class: 'c-row' }, send));
  return form;
}
function placementItem(slug, x) {
  const dates = x.start_date ? `${dayFmt(x.start_date)} – ${dayFmt(x.end_date)}` : `${weeksLabel(x.weeks)}, ${x.wish_start ? 'from ' + dayFmt(x.wish_start) : 'as soon as possible'}`;
  const withdraw = ['requested', 'awaiting_payment'].includes(x.state) ? el('button', { class: 'linkbtn', text: 'Withdraw', onclick: async e => {
    e.currentTarget.disabled = true;
    try { await rpc('owner_cancel_placement', { p_slug: slug, p_key: OWNED[slug].key, p_id: x.id }); toast('Withdrawn. Nothing was charged.'); if (mSlug === slug) renderManage(); }
    catch (err) { toast("Couldn't withdraw it right now."); }
  } }) : null;
  return el('div', { class: 'plc' },
    el('div', { class: 'plc-h' }, el('b', { text: dates }), el('span', { class: 'stp mono ' + x.state, text: PSTATE[x.state] || x.state })),
    x.price_eur != null && x.start_date ? el('p', { class: 'fine', text: `${weeksLabel(x.weeks)} · ${eur(x.price_eur)}${x.paid_at ? ' · paid' : ''}` }) : null,
    x.state === 'requested' ? el('p', { class: 'fine', text: 'We’ll email you to confirm the dates and payment.' }) : null,
    x.state === 'awaiting_payment' ? el('p', { class: 'fine', text: x.pay_url ? 'The slot starts once the payment is confirmed.' : 'Payment details come by email. The slot starts once the payment is confirmed.' }) : null,
    x.state === 'rejected' && x.admin_note ? el('div', { class: 'note', text: x.admin_note }) : null,
    x.report ? placementReport(x.report) : null,
    (x.state === 'awaiting_payment' && x.pay_url) || withdraw ? el('div', { class: 'c-row' },
      x.state === 'awaiting_payment' && x.pay_url ? el('a', { class: 'btn btn-primary btn-sm', href: x.pay_url, target: '_blank', rel: 'noopener', text: `Pay ${x.price_eur != null ? eur(x.price_eur) : ''} ↗` }) : null, withdraw) : null);
}
function placementReport(r) {
  const ch = (a, b) => { if (!b) return el('td', { text: a ? 'new' : '—' }); const pct = Math.round((a - b) / b * 100); return el('td', { class: pct > 0 ? 'up' : pct < 0 ? 'down' : null, text: (pct > 0 ? '+' : '') + pct + '%' }); };
  const row = (label, a, b) => el('tr', null, el('td', { text: label }), el('td', { text: fmt(a) }), el('td', { text: fmt(b) }), ch(a, b));
  return el('div', null,
    el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('b', { text: fmt(r.impressions) }), el('small', { text: 'times the card was shown' })),
      el('div', { class: 'kpi' }, el('b', { text: fmt(r.clicks) }), el('small', { text: r.impressions ? `clicks · ${Math.round(r.clicks / r.impressions * 100)}% of views` : 'clicks on the card' }))),
    el('table', { class: 'cmp' },
      el('thead', null, el('tr', null, el('th', { text: '' }), el('th', { text: (r.cmp_days && r.cmp_days < r.days ? 'First ' : 'During · ') + plural(r.cmp_days || r.days, 'day', 'days') }), el('th', { text: 'Before' }), el('th', { text: 'Change' }))),
      el('tbody', null, row('Profile views', r.views, r.before.views), row('Clicks to your site', r.site_clicks, r.before.site_clicks))),
    el('p', { class: 'fine', text: `Unique visitors per day; your own visits and known bots aren’t counted. “Before” is the same number of days just before the slot (${r.before.from === r.before.to ? dayFmt(r.before.from) : dayFmt(r.before.from) + ' – ' + dayFmt(r.before.to)}).` }));
}
function box_(b, ...kids) { b.replaceChildren(...kids); }
function confirmRemove(o) {
  openDlg(el('div', { class: 'mono kick', style: 'color:#ff8a8a', text: 'Take listing down' }), el('h2', { class: 'display', text: `Remove ${o.name}?` }),
    el('p', { style: 'margin-top:12px', text: 'The profile disappears everywhere, the spot is released and your contact email is wiped. This can’t be undone.' }),
    el('div', { class: 'c-row' }, el('button', { class: 'btn btn-danger', text: 'Yes, take it down', onclick: async e => {
      e.target.disabled = true;
      try { await rpc('owner_remove', { p_slug: mSlug, p_key: OWNED[mSlug].key }); delete OWNED[mSlug]; delete OWNDATA[mSlug]; saveOwned(); closeDlg(); closeUI(); await refreshAll(); loadStats(); toast('Your listing has been taken down.'); }
      catch (err) { e.target.disabled = false; toast("Couldn't take it down right now — try again."); }
    } }), el('button', { class: 'btn btn-ghost btn-sm', text: 'Cancel', onclick: closeDlg })));
}
$('#eSave').onclick = async () => {
  const bad = mform.check(['basics', 'fit', 'story']); if (bad) return;
  const b = $('#eSave'); b.disabled = true; b.textContent = 'Saving…';
  try {
    const before = OWNDATA[mSlug] && OWNDATA[mSlug].status;
    OWNDATA[mSlug] = await rpc('owner_update', { p_slug: mSlug, p_key: OWNED[mSlug].key, p: mform.get() });
    kitCache.delete(mSlug);
    OWNED[mSlug].name = OWNDATA[mSlug].name; saveOwned();
    await refreshAll(); renderManage();
    toast(before === 'approved' && OWNDATA[mSlug].status === 'pending' ? 'Saved. Your new link or images go to review before they show.' : before === 'rejected' ? 'Saved and sent for review again.' : 'Saved.', 4500);
  } catch (err) {
    const m = errCode(err);
    if (m.startsWith('invalid:')) { mform.bad(m.slice(8)); toast('Check the highlighted field.'); }
    else if (m === 'hidden') toast('This product is hidden while it is being checked.');
    else toast("Couldn't save right now — try again.");
  } finally { b.disabled = false; b.textContent = 'Save changes'; }
};

/* ================= DIALOGS: owner key, recovery, report ================= */
const modalOrigins = new Map();
const topModal = () => dlg.classList.contains('open') ? dlg : sheet.classList.contains('open') ? sheet : null;
const modalControls = node => [...node.querySelectorAll('a[href],button,input,textarea,select,summary,[tabindex]')]
  .filter(e => !e.matches(':disabled') && e.tabIndex >= 0 && !e.closest('[hidden],[inert]') && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
function focusModal(node, preferred) { (preferred || modalControls(node)[0] || node.querySelector('.sheet-in')).focus({ preventScroll: true }); }
function openModal(node, preferred) {
  if (!node.classList.contains('open')) modalOrigins.set(node, document.activeElement);
  node.classList.add('open'); focusModal(node, preferred);
}
function closeModal(node) {
  if (!node.classList.contains('open')) return;
  const wasTop = topModal() === node, opener = modalOrigins.get(node);
  node.classList.remove('open'); modalOrigins.delete(node);
  if (!wasTop) return;
  const parent = topModal();
  if (opener?.isConnected && !opener.closest('[hidden],[inert]') && getComputedStyle(opener).visibility !== 'hidden' && (!parent || parent.contains(opener))) opener.focus({ preventScroll: true });
  else if (parent) focusModal(parent);
}
document.addEventListener('keydown', e => {
  const node = topModal(); if (e.key !== 'Tab' || !node) return;
  const controls = modalControls(node), index = controls.indexOf(document.activeElement);
  if (!controls.length) { e.preventDefault(); focusModal(node); }
  else if (index < 0 || (e.shiftKey ? index === 0 : index === controls.length - 1)) {
    e.preventDefault(); controls[e.shiftKey ? controls.length - 1 : 0].focus({ preventScroll: true });
  }
});
document.addEventListener('focusin', () => { const node = topModal(); if (node && !node.contains(document.activeElement)) focusModal(node); });
function openDlg(...kids) {
  dlg.classList.remove('my-space','mission-dialog'); fill(dlgBody, ...kids); hideTip();
  const title = dlgBody.querySelector('h2');
  if (title) { title.id = 'dlgTitle'; dlg.setAttribute('aria-labelledby', title.id); dlg.removeAttribute('aria-label'); }
  else { dlg.removeAttribute('aria-labelledby'); dlg.setAttribute('aria-label', 'Product action'); }
  openModal(dlg, dlgBody.querySelector('[role=tab][aria-selected=true]') || dlgBody.querySelector('input,textarea,button') || dlg.querySelector('.sheet-in'));
}
function closeDlg() { closeModal(dlg); }
dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-dlg-close]')) closeDlg(); });
function slugFrom(v) { v = String(v || '').trim(); const m = v.match(/\/p\/([a-z0-9-]+)/i); if (m) return m[1].toLowerCase(); return normQ(v).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48); }
function openOwnerLogin(slug, name) {
  const slugIn = slug ? null : el('input', { placeholder: 'Product link or name', autocomplete: 'off', spellcheck: 'false' });
  const keyIn = el('input', { placeholder: 'Your owner key', autocomplete: 'off', spellcheck: 'false', style: 'font-family:"IBM Plex Mono",monospace' });
  const go = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Open owner panel' });
  const form = el('form', { onsubmit: async e => {
    e.preventDefault(); const s = slug || slugFrom(slugIn.value), k = keyIn.value.trim();
    if (!isSlug(s)) { toast('Paste your product link, like expanse…/p/your-product.'); return; }
    if (k.length < 10) { toast('Paste the owner key you got when you added the product.'); return; }
    go.disabled = true;
    try { OWNDATA[s] = await rpc('owner_get', { p_slug: s, p_key: k }); OWNED[s] = { key: k, name: OWNDATA[s].name }; saveOwned(); rebuildItems(); closeDlg(); openManage(s); }
    catch (err) { toast(errCode(err) === 'bad_key' ? 'That key doesn’t match this product.' : "Couldn't check right now — try again."); }
    finally { go.disabled = false; }
  } },
    slugIn ? el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Product' }), slugIn) : null,
    el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Owner key' }), keyIn),
    el('div', { class: 'c-row' }, go));
  openDlg(el('div', { class: 'mono kick', text: 'For makers' }), el('h2', { class: 'display', text: name ? `Manage ${name}` : 'Manage your product' }),
    el('p', { style: 'margin-top:10px', text: 'Use the owner key you got when you added the product, or sign in with the email address you added it with.' }), form,
    el('div', { class: 'c-row', style: 'margin-top:14px' },
      el('button', { class: 'btn btn-ghost btn-sm', text: 'Sign in with email', onclick: () => openEmailSignin(slug, name) }),
      el('button', { class: 'linkbtn', text: 'Lost your key?', onclick: () => { const s = slug || slugFrom(slugIn && slugIn.value); if (!isSlug(s)) { toast('First enter your product link or name.'); return; } startRecovery(s, name); } })));
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Sign-in with email: a 6-digit code to the product's contact email gives this browser its own key for every product
// listed with that address. The answer is the same whether or not the address is on file.
function openEmailSignin(slug, name, email) {
  const emailIn = el('input', { type: 'email', placeholder: 'you@company.com', autocomplete: 'email', spellcheck: 'false', value: email || '' });
  const send = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Email me a code' });
  openDlg(el('div', { class: 'mono kick', text: 'For makers' }), el('h2', { class: 'display', text: 'Sign in with email' }),
    el('p', { style: 'margin-top:10px', text: 'Use the address you gave when you added your product. We send a 6-digit code — no password.' }),
    el('form', { onsubmit: async e => {
      e.preventDefault(); const v = emailIn.value.trim();
      if (!EMAIL_RE.test(v)) { toast('Enter the email address you added your product with.'); return; }
      send.disabled = true;
      try {
        const r = await rpc('email_signin_start', { p_email: v });
        if (r && r.delivery === 'unavailable') { toast('Email sign-in is paused right now. Use your owner key, or “Lost your key?”.', 6000); return; }
        openEmailCode(slug, name, v);
      } catch (err) { toast(errCode(err) === 'slow_down' ? 'Too many tries from here. Wait a while and try again.' : "Couldn't send a code right now — try again."); }
      finally { send.disabled = false; }
    } }, el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Email' }), emailIn), el('div', { class: 'c-row' }, send)),
    el('button', { class: 'linkbtn', style: 'margin-top:14px', text: 'Use my owner key instead', onclick: () => openOwnerLogin(slug, name) }));
}
function openEmailCode(slug, name, email) {
  const codeIn = el('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', placeholder: '000000', 'aria-label': '6-digit code', style: 'font-family:"IBM Plex Mono",monospace;letter-spacing:.3em;font-size:20px' });
  const go = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Sign in' });
  const again = el('button', { class: 'linkbtn', type: 'button' });
  let left = 0, timer = 0;
  const tick = () => { if (!again.isConnected || left <= 0) { clearInterval(timer); again.disabled = false; again.textContent = 'Send a new code'; return; } again.disabled = true; again.textContent = `Send a new code (${left--} s)`; };
  const wait = () => { left = 60; clearInterval(timer); tick(); timer = setInterval(tick, 1000); };
  again.onclick = async () => {
    wait();
    try { await rpc('email_signin_start', { p_email: email }); toast('If the address is on file, a new code is on its way.'); }
    catch (e) { toast(errCode(e) === 'slow_down' ? 'Too many tries from here. Wait a while and try again.' : "Couldn't send a code right now."); }
  };
  openDlg(el('div', { class: 'mono kick', text: 'Check your inbox' }), el('h2', { class: 'display', text: 'Enter your code' }),
    el('p', { style: 'margin-top:10px', text: `If ${email} is the contact email for a product on Expanse, a 6-digit code is on its way. It works for 15 minutes — check spam if it hasn't arrived in a minute.` }),
    el('form', { onsubmit: async e => {
      e.preventDefault(); const v = codeIn.value.replace(/\D/g, '');
      if (v.length !== 6) { toast('The code has 6 digits.'); return; }
      go.disabled = true;
      try {
        const r = await rpc('email_signin_verify', { p_email: email, p_code: v });
        if (!r || !r.ok) { toast(r && r.reason === 'slow_down' ? 'Too many tries from here. Wait a while and try again.' : 'That code doesn’t match or has expired. Use the newest email, or send a new code.', 5000); return; }
        const list = (r.products || []).filter(p => p && isSlug(p.slug) && typeof p.key === 'string');
        if (!list.length) { closeDlg(); toast('No product is listed with this address any more.'); return; }
        // A key already saved in this browser stays; the new device key fills in where there is none (or it stopped working).
        const add = () => { let n = 0; for (const p of list) if (!OWNED[p.slug]) { OWNED[p.slug] = { key: p.key, name: p.name, via: 'email' }; n++; } return n; };
        add(); await loadOwned(); if (add()) await loadOwned();
        rebuildItems();
        const mine = list.filter(p => OWNED[p.slug]);
        const target = slug && OWNED[slug] ? slug : mine.length === 1 ? mine[0].slug : null;
        if (target) { closeDlg(); openManage(target); toast('Signed in.'); return; }
        openDlg(el('div', { class: 'mono kick', text: 'Signed in' }), el('h2', { class: 'display', text: `You manage ${mine.length} products` }),
          el('div', { class: 'c-row', style: 'flex-wrap:wrap;margin-top:14px' }, mine.map(p => el('button', { class: 'btn btn-ghost btn-sm', text: p.name, onclick: () => { closeDlg(); openManage(p.slug); } }))));
      } catch (err) { toast("Couldn't check the code right now — try again."); }
      finally { go.disabled = false; }
    } }, el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Code' }), codeIn), el('div', { class: 'c-row' }, go)),
    el('div', { class: 'c-row', style: 'margin-top:14px' }, again, el('button', { class: 'linkbtn', type: 'button', text: 'Use a different email', onclick: () => openEmailSignin(slug, name, email) })));
  wait();
}
$('#ownerOpen').onclick = () => { closeSheet(); openOwnerLogin(null); };
async function startRecovery(slug, name) {
  let rec = (store.get(RECOVER_KEY) || {})[slug];
  if (!rec) {
    try { rec = await rpc('start_recovery', { p_slug: slug }); }
    catch (e) { const m = errCode(e); toast(m === 'not_found' ? 'We couldn’t find that product.' : m === 'busy' ? 'A recovery was started a moment ago. Try again in 30 minutes, or finish the one you started in that browser.' : "Couldn't start recovery right now."); return; }
    const all = store.get(RECOVER_KEY) || {}; all[slug] = rec; store.set(RECOVER_KEY, all);
  }
  const meta = `<meta name="expanse-verification" content="${rec.token}">`;
  const btn = el('button', { class: 'btn btn-primary', text: 'Check my site', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Checking ' + rec.domain + '…';
    const r = await fnCall('verify-domain', { slug, recover: { token: rec.token, secret: rec.secret } });
    btn.disabled = false; btn.textContent = 'Check my site';
    if (r.ok && r.key) {
      const all = store.get(RECOVER_KEY) || {}; delete all[slug]; store.set(RECOVER_KEY, all);
      OWNED[slug] = { key: r.key, name: name || slug }; saveOwned();
      openDlg(el('div', { class: 'mono kick', text: 'Recovered' }), el('h2', { class: 'display', text: 'Here is your new key.' }),
        el('div', { class: 'keybox' }, el('b', { text: 'New owner key — save it now.' }), el('code', { text: r.key }), el('small', { text: 'Your old key no longer works. You can remove the recovery code from your site.' })),
        el('div', { class: 'c-row' }, el('button', { class: 'btn btn-primary', text: 'Open owner panel', onclick: () => { closeDlg(); loadOwned().then(rebuildItems); openManage(slug); } }), el('button', { class: 'btn btn-ghost btn-sm', text: 'Download key', onclick: () => saveKeyFile(slug, name || slug, r.key) })));
    } else if (r.reason === 'missing') toast(`We reached ${rec.domain} but didn't find the code yet.`, 5000);
    else if (r.reason === 'unreachable') toast(`We couldn't reach https://${rec.domain}.`, 5000);
    else if (r.reason === 'bad_recovery') { const all = store.get(RECOVER_KEY) || {}; delete all[slug]; store.set(RECOVER_KEY, all); toast('This recovery code has expired. Start again.'); closeDlg(); }
    else if (r.reason === 'slow_down') toast('Give it a few seconds between checks.');
    else toast("Couldn't check right now — try again in a moment.");
  } });
  openDlg(el('div', { class: 'mono kick', text: 'Lost key' }), el('h2', { class: 'display', text: 'Prove it’s your site.' }),
    el('p', { style: 'margin-top:10px', text: `Publish this code on ${rec.domain} — as a meta tag on the home page, or in a file at /.well-known/expanse-verification.txt. Then check. The code is tied to this browser and works for 48 hours.` }),
    el('div', { class: 'codeblock', text: meta }),
    el('button', { class: 'linkbtn', style: 'margin-top:6px', text: 'Copy tag', onclick: async () => toast((await copy(meta)) ? 'Tag copied.' : 'Select the tag and copy it.') }),
    el('div', { class: 'c-row' }, btn));
}
/* Contact: goes to the admin's email with the sender as reply-to. No public address needed. */
function openContact(topic) {
  const email = el('input', { type: 'email', placeholder: 'you@company.com', autocomplete: 'email', spellcheck: 'false' });
  const msg = el('textarea', { maxlength: '2000', rows: '4', placeholder: 'What can we help with?' });
  const hp = el('input', { class: 'hp', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', name: 'website' });
  const topics = [['question', 'A question'], ['data', 'My data'], ['placement', 'Sponsored slot'], ['other', 'Something else']];
  const send = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Send' });
  openDlg(el('div', { class: 'mono kick', text: 'Contact' }), el('h2', { class: 'display', text: 'Write to us' }),
    el('p', { style: 'margin-top:10px', text: 'We read every message and answer by email, usually within a day.' }),
    el('form', { onsubmit: async e => {
      e.preventDefault();
      if (hp.value) { closeDlg(); toast('Sent. We’ll answer by email.'); return; }
      const t = dlgBody.querySelector('input[name=topic]:checked');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) { toast('Enter your email so we can answer.'); return; }
      if (msg.value.trim().length < 10) { toast('Write a little more so we can help.'); return; }
      send.disabled = true;
      try {
        const r = await rpc('contact_message', { p_email: email.value.trim(), p_message: msg.value, p_topic: t ? t.value : 'question' });
        if (r && r.ok) { closeDlg(); toast('Sent. We’ll answer by email.', 4000); }
        else toast('The contact form is paused right now — please try again later.', 5000);
      } catch (err) { const m = errCode(err); toast(m === 'slow_down' || m === 'busy' ? 'Too many messages right now. Try again in a while.' : m === 'invalid:email' ? 'Enter your email so we can answer.' : "Couldn't send right now — try again."); }
      finally { send.disabled = false; }
    } },
      el('div', { class: 'radios' }, topics.map(([v, l]) => el('label', null, el('input', { type: 'radio', name: 'topic', value: v, checked: v === (topic || 'question') }), l))),
      el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Your email' }), email),
      el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Message' }), msg), hp,
      el('div', { class: 'c-row' }, send)),
    el('p', { class: 'fine', text: 'Your email is only used to answer you.' }));
}
document.querySelectorAll('[data-contact]').forEach(b => b.onclick = () => openContact());
function openReport(p) {
  const reasons = [['broken_link', 'The link is broken'], ['wrong_info', 'Information is wrong'], ['spam', 'Spam, scam or harmful'], ['other', 'Something else']];
  const txt = el('textarea', { maxlength: '600', rows: '3', placeholder: 'Anything that helps us check (optional)' });
  const send = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Send report' });
  openDlg(el('div', { class: 'mono kick', text: 'Report a problem' }), el('h2', { class: 'display', text: p.name }),
    el('form', { onsubmit: async e => {
      e.preventDefault(); const r = dlgBody.querySelector('input[name=reason]:checked'); if (!r) { toast('Pick what’s wrong.'); return; }
      send.disabled = true;
      try { await rpc('report_product', { p_slug: p.slug, p_reason: r.value, p_details: txt.value }); closeDlg(); toast('Thanks — we’ll take a look.'); }
      catch (err) { toast("Couldn't send the report right now."); } finally { send.disabled = false; }
    } }, el('div', { class: 'radios' }, reasons.map(([v, l]) => el('label', null, el('input', { type: 'radio', name: 'reason', value: v }), l))),
      el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Details' }), txt), el('div', { class: 'c-row' }, send)),
    el('p', { class: 'fine', text: 'Reports are anonymous. We check them by hand.' }));
}

$('#seasonalBrowse').onclick=showSeasonalOffers;
/* ================= VOLUNTARY NEEDS PILOT ================= */
const NEED_RECEIPTS_KEY='expanse.needs.v1';
const savedNeedReceipts=store.get(NEED_RECEIPTS_KEY);
const NEED_RECEIPTS=(Array.isArray(savedNeedReceipts)?savedNeedReceipts:[]).filter(r=>r&&typeof r.id==='string'&&typeof r.key==='string'&&Date.parse(r.expires_at)>Date.now()).slice(0,20);
if(savedNeedReceipts)store.set(NEED_RECEIPTS_KEY,NEED_RECEIPTS);
function needMatchList(matches){
  return el('div',{class:'need-matches'},matches?.length?matches.map(m=>el('article',{class:'mission-step'},el('b',{text:m.name}),el('p',{class:'fine',text:m.reason}),el('button',{class:'btn btn-ghost btn-sm',text:'Check product',onclick:()=>{const p=BY_SLUG.get(m.slug);if(p)openProduct(p,{source:'search'});else toast('This product is no longer public.');}}))):el('p',{class:'fine',text:'No clear match in the live catalog yet. We will show a match here if a published product’s profile shares enough relevant terms. A match is a starting point, not a compatibility guarantee.'}));
}
function openNeedForm(initial=''){
  closeSheet();closeUI();results.hidden=true;
  const input=el('textarea',{rows:4,maxlength:600,minlength:18,required:true,placeholder:'I need a tool that checks failed deployments and explains the errors…','aria-label':'The problem you need a tool for',value:String(initial).slice(0,600)});
  const watch=el('input',{type:'checkbox',id:'needWatch'});
  const consent=el('input',{type:'checkbox',id:'needConsent'}),status=el('p',{class:'fine',role:'status','aria-live':'polite'}),submit=el('button',{class:'btn btn-primary',type:'submit',text:'Find matches & save need'});
  const form=el('form',{class:'need-form'},el('label',{class:'field'},el('span',{text:'I need a tool that…'}),input),el('p',{class:'fine',text:'Describe the job and the constraints, in English for this pilot. No names, emails, phone numbers, links or confidential information.'}),el('label',{class:'check'},watch,el('span',{text:'Show newly matching products when I return to My space → Needs. Optional in-app pilot; no email notifications.'})),el('label',{class:'check',style:'display:flex;align-items:flex-start;gap:10px'},consent,el('span',{text:'I agree to share an anonymized version publicly and with relevant makers, after review. Optional; leave unchecked to keep it private.'})),el('p',{class:'fine',text:'No contact details are collected. Makers can see only approved anonymized needs. No emails are sent. You can withdraw sharing in My space. Needs expire after 90 days. Up to 200 active needs in this pilot. '}),el('a',{href:'/privacy',target:'_blank',rel:'noopener',text:'How needs are handled'}),el('div',{class:'c-row'},submit));
  form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;submit.disabled=true;status.textContent='Checking the real catalog…';try{
    const r=await rpc('submit_tool_need',{p_text:input.value.replace(/\s+/g,' ').trim(),p_share:consent.checked});
    if(!r?.id||!r.key)throw Error('unavailable');
    NEED_RECEIPTS.unshift({id:r.id,key:r.key,expires_at:r.expires_at,watch:watch.checked,seen:(r.matches||[]).map(m=>m.slug)});NEED_RECEIPTS.splice(20);store.set(NEED_RECEIPTS_KEY,NEED_RECEIPTS);
    const stored=store.get(NEED_RECEIPTS_KEY)?.some(x=>x.id===r.id);
    const receipt=JSON.stringify({service:'Expanse needs pilot',id:r.id,key:r.key,expires_at:r.expires_at},null,2);
    openDlg(el('div',{class:'mono kick',text:'Need saved'}),el('h2',{class:'display',text:r.state==='pending'?'Saved. Review before sharing.':'Saved privately.'}),el('p',{class:'fine',text:stored?'Your private management key is saved in this browser. Open My space → Needs to see matches or withdraw.':'Browser saving is blocked. Download your private receipt now so you can reopen or withdraw this need.'}),needMatchList(r.matches),el('div',{class:'c-row'},el('button',{class:'btn btn-primary btn-sm',text:'Download private receipt',onclick:()=>download('expanse-need-'+r.id+'.json',new Blob([receipt],{type:'application/json'}))}),el('button',{class:'btn btn-ghost btn-sm',text:'My needs',onclick:()=>openMySpace('needs')})),el('p',{class:'fine',text:'Keep the receipt private. It controls this need; it is not a payment receipt.'}));
  }catch(err){const code=errCode(err);status.textContent=code.includes('invalid:need')?'Use 18–600 characters without contact details, links or phone numbers.':code.includes('slow_down')?'You have saved several needs recently. Please try later.':code.includes('pilot_full')?'The pilot is full right now. You can still search and build a stack.':'Your need could not be saved. Try again; nothing has been published.';}finally{submit.disabled=false;}};
  openDlg(el('div',{class:'mono kick',text:'Needs pilot · voluntary'}),el('h2',{class:'display',text:'What tool is missing?'}),el('p',{class:'fine',text:'Start with a real problem. We match published product descriptions and explain the overlap. Payment does not affect matching.'}),form,status);
}
async function openNeedBoard(){
  closeUI();openDlg(el('div',{class:'mono kick',text:'Needs pilot'}),el('h2',{class:'display',text:'Real needs. Small products.'}),el('p',{class:'fine',text:'Voluntarily shared, anonymized and reviewed. These are requests for tools, not verified buyers or promised sales.'}),el('div',{class:'c-row'},el('button',{class:'btn btn-primary btn-sm',text:'I need a tool that…',onclick:()=>openNeedForm()}),el('button',{class:'btn btn-ghost btn-sm',text:'My needs',onclick:()=>openMySpace('needs')})),el('div',{id:'needsBoardRows'},el('p',{class:'fine',text:'Loading…'})));
  const box=$('#needsBoardRows');try{const rows=await rpc('public_tool_needs');if(!box.isConnected)return;fill(box,rows.length?rows.map(n=>el('article',{class:'mission-step'},el('p',{text:n.text}),el('p',{class:'fine',text:'Shared '+dateStr(n.posted)+' · anonymized after review'}),needMatchList(n.matches))):el('p',{class:'note',text:'No reviewed needs have been shared yet. We only show real submissions with permission.'}));}catch{if(box.isConnected)fill(box,el('p',{class:'fine',text:'The needs board is unavailable. Try again later.'}));}
}
async function renderMyNeeds(panel){
  panel.append(el('p',{class:'fine',text:'Private management receipts from this browser. Requests expire after 90 days. Only the anonymized text you agreed to share can appear publicly.'}),el('div',{class:'c-row'},el('button',{class:'btn btn-primary btn-sm',text:'Add a need',onclick:()=>openNeedForm()}),el('button',{class:'btn btn-ghost btn-sm',text:'Open reviewed needs',onclick:()=>openNeedBoard()})));
  if(!NEED_RECEIPTS.length)panel.append(el('p',{class:'fine',text:'No saved needs in this browser.'}));
  const id=el('input',{'aria-label':'Need ID',placeholder:'Need ID from your receipt'}),key=el('input',{type:'password','aria-label':'Private need key',placeholder:'Private key from your receipt',autocomplete:'off'});
  panel.append(el('details',{class:'sec'},el('summary',{text:'Open a need from a private receipt'}),el('label',{class:'field'},el('span',{text:'Need ID'}),id),el('label',{class:'field'},el('span',{text:'Private key'}),key),el('button',{class:'btn btn-ghost btn-sm',text:'Open private need',onclick:async()=>{try{const r=await rpc('tool_need_status',{p_id:id.value.trim(),p_key:key.value.trim()});NEED_RECEIPTS.unshift({id:r.id,key:key.value.trim(),expires_at:r.expires_at});const unique=new Map(NEED_RECEIPTS.map(x=>[x.id,x]));NEED_RECEIPTS.splice(0,NEED_RECEIPTS.length,...[...unique.values()].slice(0,20));store.set(NEED_RECEIPTS_KEY,NEED_RECEIPTS);openMySpace('needs');}catch{toast('That receipt is invalid or the need has expired.');}}})));
  for(const receipt of NEED_RECEIPTS){const row=el('article',{class:'mission-step'},el('p',{class:'fine',text:'Loading your need…'}));panel.append(row);try{const n=await rpc('tool_need_status',{p_id:receipt.id,p_key:receipt.key});if(!panel.isConnected)return;
    const fresh=receipt.watch?(n.matches||[]).filter(m=>!(receipt.seen||[]).includes(m.slug)):[];
    fill(row,fresh.length?el('p',{class:'note ok',text:fresh.length+' newly matching product(s) since your last check.'}):null,el('label',{class:'check'},el('input',{type:'checkbox',checked:!!receipt.watch,onchange:e=>{receipt.watch=e.target.checked;receipt.seen=(n.matches||[]).map(m=>m.slug);store.set(NEED_RECEIPTS_KEY,NEED_RECEIPTS);}}),el('span',{text:'Check new matches here when I return · no email'})),el('b',{text:({private:'Private',pending:'Waiting for anonymization review',approved:'Shared with permission',declined:'Kept private after review',withdrawn:'Withdrawn'})[n.state]||n.state}),el('p',{text:n.text}),n.public_text?el('p',{class:'fine',text:'Public version: '+n.public_text}):null,el('p',{class:'fine',text:'Expires '+dateStr(n.expires_at)}),needMatchList(n.matches),n.state!=='withdrawn'?el('button',{class:'btn btn-ghost btn-sm',text:'Withdraw and remove shared text',onclick:async e=>{e.currentTarget.disabled=true;try{await rpc('withdraw_tool_need',{p_id:receipt.id,p_key:receipt.key});openMySpace('needs');}catch{toast('Could not withdraw right now. Try again.');e.currentTarget.disabled=false;}}}):null);
    receipt.seen=(n.matches||[]).map(m=>m.slug);store.set(NEED_RECEIPTS_KEY,NEED_RECEIPTS);
  }catch{fill(row,el('p',{class:'fine',text:'This need is unavailable, expired, or its key no longer works.'}),el('button',{class:'linkbtn',text:'Forget this receipt',onclick:()=>{NEED_RECEIPTS.splice(NEED_RECEIPTS.indexOf(receipt),1);store.set(NEED_RECEIPTS_KEY,NEED_RECEIPTS);openMySpace('needs');}}));}}
}
async function renderMakerNeeds(o){
  const box=$('#mNeeds'),slug=mSlug;if(o.status!=='approved'){fill(box,el('p',{class:'fine',text:'Relevant need matching becomes available when your product is live.'}));return;}
  fill(box,el('p',{class:'fine',text:'Loading…'}));
  try{const prefs=await rpc('owner_need_preferences',{p_slug:slug,p_key:OWNED[slug].key});if(slug!==mSlug||mTab!=='needs')return;
    const opt=el('input',{type:'checkbox',checked:prefs.enabled,'aria-label':'Receive relevant needs in this panel'}),feed=el('div');
    fill(box,el('h3',{text:'Needs that may fit your product'}),el('p',{class:'fine',text:'Opt in to relevant, reviewed requests in this panel. No email is sent and no contact information is shared. These are needs, not qualified leads or guaranteed sales.'}),el('label',{class:'check',style:'display:flex;gap:10px;align-items:flex-start'},opt,el('span',{text:'Show relevant needs here · optional'})),feed);
    const load=async()=>{if(!opt.checked){fill(feed,el('p',{class:'fine',text:'Matching is off. You can enable it whenever you want.'}));return;}fill(feed,el('p',{class:'fine',text:'Checking reviewed needs…'}));try{const rows=await rpc('owner_need_matches',{p_slug:slug,p_key:OWNED[slug].key});if(!feed.isConnected)return;fill(feed,rows.length?rows.map(n=>el('article',{class:'mission-step'},el('p',{text:n.text}),el('p',{class:'fine',text:n.reason}),el('small',{text:'Shared '+dateStr(n.posted)}))):el('p',{class:'note',text:'0 relevant shared needs so far. Keep the problems your product solves accurate; matching uses published profile text and never paid placement.'}));}catch{fill(feed,el('p',{class:'fine',text:'Could not load matches. Try again later.'}));}};
    opt.onchange=async()=>{opt.disabled=true;try{await rpc('owner_need_preferences',{p_slug:slug,p_key:OWNED[slug].key,p_enabled:opt.checked});await load();}catch{opt.checked=!opt.checked;toast('Could not save your preference.');}finally{opt.disabled=false;}};await load();
  }catch{if(slug===mSlug&&mTab==='needs')fill(box,el('p',{class:'fine',text:'Need matching is unavailable right now.'}));}
}

/* ================= MY SPACE: private, local collections and activity ================= */
const isSaved = slug => SAVED.some(p => p.slug === slug);
const activityCount = key => ACTIVITY.reduce((n,p) => n + Math.max(0, Math.min(1000000,Number(p[key]) || 0)),0);
function persistPersonal(key, value) {
  store.set(key,value);
  const persisted = JSON.stringify(store.get(key)) === JSON.stringify(value);
  if (!persisted) toast('This browser blocked saving. Your collection will last only until this page closes.',5500);
  return persisted;
}
function rememberActivity(slug, kind) {
  if (!isSlug(slug) || !['view','visit','demo'].includes(kind)) return;
  const p = BY_SLUG.get(slug); if (!p) return;
  let row = ACTIVITY.find(x => x.slug === slug);
  if (!row) { row = {slug,name:p.name,tagline:p.tagline,views:0,clicks:0}; ACTIVITY.unshift(row); }
  row.name=p.name; row.tagline=p.tagline; row.at=new Date().toISOString();
  const key = kind === 'view' ? 'views' : 'clicks'; row[key] = Math.min(1000000,Math.max(0,Number(row[key]) || 0)+1);
  ACTIVITY.sort((a,b)=>String(b.at).localeCompare(String(a.at))); ACTIVITY.splice(100);
  persistPersonal(ACTIVITY_KEY,ACTIVITY);
}
function saveBtn(p) {
  const b=el('button',{class:'chip-btn save-btn',type:'button'});
  const paint=()=>{const on=isSaved(p.slug);b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',(on?'Unsave ':'Save ')+p.name);b.replaceChildren(el('span',{'aria-hidden':'true',text:on?'◆':'◇'}),on?'Saved':'Save');};
  b.onclick=()=>{
    const i=SAVED.findIndex(x=>x.slug===p.slug);
    if(i>=0)SAVED.splice(i,1);
    else {if(SAVED.length>=200){toast('Your saved collection holds up to 200 products. Remove one to add another.');return;}SAVED.unshift({slug:p.slug,name:p.name,tagline:p.tagline,at:new Date().toISOString()});}
    const persisted=persistPersonal(SAVED_KEY,SAVED);paint();if(persisted)toast(isSaved(p.slug)?'Saved to My space. Saving never changes rankings.':'Removed from saved products.');
  };paint();return b;
}
function spaceItem(slug, fallback, tab) {
  const p=BY_SLUG.get(slug), local=ACTIVITY.find(x=>x.slug===slug), title=p?.name || fallback?.name || OWNED[slug]?.name || slug;
  const info=el('div',{class:'space-info'},el('b',{text:title}),el('p',{text:p?.tagline || fallback?.tagline || 'This profile is not currently public.'}));
  if(tab==='history' && local)info.append(el('p',{text:`${fmt(local.views)} profile opens · ${fmt(local.clicks)} website/demo clicks from this browser`}),el('p',{text:local.at?`Last opened ${timeAgo(local.at)}`:''}));
  if(tab==='owned')info.append(el('p',{class:'space-owner-stat',text:'Loading your 30-day product statistics…'}));
  const actions=el('div',{class:'space-actions'});
  if(tab==='owned')actions.append(el('button',{class:'chip-btn',text:'Manage & stats',onclick:()=>{closeDlg();openManage(slug,'stats');}}));
  else if(p)actions.append(el('button',{class:'chip-btn',text:'Open',onclick:()=>{closeDlg();openProduct(p,{source:'shared'});}}));
  if(tab==='saved')actions.append(el('button',{class:'linkbtn','aria-label':'Remove saved '+title,text:'Remove',onclick:()=>{const i=SAVED.findIndex(x=>x.slug===slug);if(i>=0)SAVED.splice(i,1);persistPersonal(SAVED_KEY,SAVED);openMySpace('saved');}}));
  if(tab==='following')actions.append(el('button',{class:'linkbtn','aria-label':'Unfollow '+title,text:'Unfollow',onclick:()=>{if(p)toggleFollow(p);else{delete FOLLOW.slugs[slug];saveFollow();loadUpdates();}openMySpace('following');}}));
  const row=el('article',{class:'space-item','data-slug':slug},info,actions);
  if(tab==='owned'){
    rpc('owner_stats',{p_slug:slug,p_key:OWNED[slug].key}).then(s=>{
      if(!row.isConnected)return;
      const days=s.days||[],sum=key=>days.reduce((n,d)=>n+(Number(d[key])||0),0), own=OWNDATA[slug]||p;
      const votes=own && Number.isFinite(Number(own.upvotes)) ? ` · ${fmt(own.upvotes)} total upvotes` : '';
      row.querySelector('.space-owner-stat').textContent=`30 days: ${fmt(sum('view'))} profile views · ${fmt(sum('visit')+sum('demo'))} website/demo clicks${votes}`;
    }).catch(()=>{if(row.isConnected)row.querySelector('.space-owner-stat').textContent='Statistics unavailable. Open Manage & stats to try again.';});
  }
  return row;
}
function openMySpace(tab='saved',focusTab=false) {
  if(!['saved','stacks','following','upvoted','history','owned','needs'].includes(tab))tab='saved';
  const opener = topModal() ? null : document.activeElement;
  closeSheet();closeUI();
  const counter=(n,label)=>el('div',null,el('b',{text:fmt(n)}),el('small',{text:label}));
  const tabs=el('div',{class:'space-tabs',role:'tablist','aria-label':'My space collections'});
  const choices=[['saved','Saved',SAVED.length],['stacks','Stacks',STACKS.length],['needs','Needs',NEED_RECEIPTS.length],['following','Following',Object.keys(FOLLOW.slugs).filter(isSlug).length],['upvoted','Upvoted',Object.keys(VOTED).filter(isSlug).length],['history','History',ACTIVITY.length],['owned','My products',Object.keys(OWNED).filter(isSlug).length]];
  for(const [id,label,count]of choices){
    const button=el('button',{type:'button',class:'chip-btn',role:'tab',id:'space-tab-'+id,'data-space-tab':id,'aria-controls':'space-content','aria-selected':String(tab===id),tabindex:tab===id?'0':'-1',text:`${label} (${count})`,onclick:()=>openMySpace(id,true)});
    button.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();let i=choices.findIndex(x=>x[0]===id);i=e.key==='Home'?0:e.key==='End'?choices.length-1:(i+(e.key==='ArrowRight'?1:-1)+choices.length)%choices.length;openMySpace(choices[i][0],true);});tabs.append(button);
  }
  const panel=el('section',{id:'space-content',role:'tabpanel','aria-labelledby':'space-tab-'+tab});
  let entries=[];
  if(tab==='saved')entries=SAVED.map(p=>[p.slug,p]);
  if(tab==='following')entries=Object.keys(FOLLOW.slugs).filter(isSlug).map(s=>[s]);
  if(tab==='upvoted')entries=Object.keys(VOTED).filter(isSlug).map(s=>[s]);
  if(tab==='history')entries=ACTIVITY.map(p=>[p.slug,p]);
  if(tab==='owned')entries=Object.keys(OWNED).filter(isSlug).slice(0,20).map(s=>[s]);
  const empty={saved:'Save a product with ◇ Save to keep it here. Saving is private and does not affect rankings.',following:'Follow a product to keep up with its launches and releases.',upvoted:'Your successful upvotes from this browser will appear here. Saving and following do not cast a vote.',history:'The profiles you open and website/demo links you click will appear here.',owned:'Your own products and their statistics appear here when this browser has an owner key. Sign in with your email or owner key.'};
  if(tab==='needs'){renderMyNeeds(panel);}
  else if(tab==='stacks') {
    if(!STACKS.length)panel.append(el('p',{class:'fine',text:'Build a stack for a goal, or add products to a stack from their profiles. Compare them, save a collection and share it with a link.'}));
    for(const stack of STACKS)panel.append(el('article',{class:'stack-saved'},el('b',{text:stack.title}),el('p',{class:'fine',text:stack.slugs.length+' products · stored in this browser'}),el('div',{class:'c-row'},el('button',{class:'chip-btn',text:'Open & compare',onclick:()=>openStack(stack)}),el('button',{class:'chip-btn',text:'Share',onclick:()=>shareStack(stack)}),el('button',{class:'linkbtn','aria-label':'Delete stack '+stack.title,text:'Delete',onclick:()=>{STACKS.splice(STACKS.indexOf(stack),1);persistPersonal(STACK_KEY,STACKS);openMySpace('stacks');}}))));
    panel.append(el('button',{class:'btn btn-ghost btn-sm',text:'Build a new stack',onclick:()=>openMission()}));
  } else if(entries.length)panel.append(el('div',{class:'space-list'},entries.map(([s,p])=>spaceItem(s,p,tab))));else panel.append(el('p',{class:'fine',text:empty[tab]}));
  if(tab==='following')panel.prepend(el('button',{class:'btn btn-ghost btn-sm',text:'Open updates feed',onclick:openFollowing}));
  if(tab==='owned'&&!entries.length)panel.append(el('button',{class:'btn btn-ghost btn-sm',text:'Sign in to my product',onclick:()=>openOwnerLogin()}));
  if(tab==='history'&&entries.length)panel.append(el('button',{class:'linkbtn',style:'margin-top:16px',text:'Clear local activity history',onclick:()=>{ACTIVITY.splice(0);store.del(ACTIVITY_KEY);openMySpace('history');}}));
  openDlg(el('div',{class:'mono kick',text:'Your private collection'}),el('h2',{class:'display',text:'My space'}),el('p',{class:'fine',text:'Save tools you want to return to. Follow releases. Keep your votes and activity in one place.'}),el('div',{class:'space-kpis'},counter(SAVED.length,'saved apps'),counter(Object.keys(FOLLOW.slugs).filter(isSlug).length,'following'),counter(Object.keys(VOTED).filter(isSlug).length,'your upvotes'),counter(activityCount('clicks'),'your website/demo clicks')),tabs,panel,el('p',{class:'fine',style:'margin-top:20px',text:'Saved apps, follows, votes and activity belong to this browser. They are not a public profile and do not sync across devices. Activity totals cover your latest 100 products. Maker statistics come from Expanse and count other visitors separately.'}));
  dlg.classList.add('my-space');
  if (opener) modalOrigins.set(dlg, opener);
  if(focusTab)$('#space-tab-'+tab)?.focus({preventScroll:true});
}

/* ================= MISSIONS & PORTABLE TOOL STACKS ================= */
const STACK_KEY='expanse.stacks.v1',SELECTION_KEY='expanse.stack-selection.v1';
const plainTitle=v=>String(v||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,100);
function cleanStack(v) {
  if(!v||typeof v!=='object'||!Array.isArray(v.slugs))return null;
  const slugs=[...new Set(v.slugs.filter(s=>typeof s==='string'&&isSlug(s)))].slice(0,8);
  return slugs.length?{id:typeof v.id==='string'&&/^[a-z0-9-]{1,50}$/.test(v.id)?v.id:'',title:plainTitle(v.title)||'My tool stack',slugs}:null;
}
const storedStacks=store.get(STACK_KEY),STACKS=(Array.isArray(storedStacks)?storedStacks:[]).map(cleanStack).filter(Boolean).slice(0,20);
const selection=store.get(SELECTION_KEY);let STACK_SELECTION=(Array.isArray(selection)?selection:[]).filter(s=>typeof s==='string'&&isSlug(s)).slice(0,8);
const stackDock=el('div',{class:'stack-dock glass',id:'stackDock',hidden:!STACK_SELECTION.length},el('span',{id:'stackCount'}),el('button',{class:'btn btn-primary btn-sm',id:'openStack',text:'Compare & save',onclick:()=>openStack({title:'My tool stack',slugs:STACK_SELECTION})}));app.append(stackDock);
function paintStackSelection() {
  stackDock.hidden=!STACK_SELECTION.length;$('#stackCount').textContent=STACK_SELECTION.length+' '+(STACK_SELECTION.length===1?'tool':'tools')+' in your stack';
  document.querySelectorAll('[data-stack-slug]').forEach(b=>{const on=STACK_SELECTION.includes(b.dataset.stackSlug);b.setAttribute('aria-pressed',String(on));b.classList.toggle('stack-selected',on);b.textContent=on?'✓ In stack':'+ Add to stack';});
}
function addToSelection(slug) {
  if(STACK_SELECTION.includes(slug))STACK_SELECTION=STACK_SELECTION.filter(s=>s!==slug);
  else{if(STACK_SELECTION.length>=8){toast('Compare up to 8 tools. Remove one first.');return;}STACK_SELECTION.push(slug);}
  persistPersonal(SELECTION_KEY,STACK_SELECTION);paintStackSelection();
}
function stackBtn(p) {
  const on=STACK_SELECTION.includes(p.slug);return el('button',{class:'chip-btn stack-btn'+(on?' stack-selected':''),type:'button','data-stack-slug':p.slug,'aria-pressed':String(on),'aria-label':'Add or remove '+p.name+' from your stack',text:on?'✓ In stack':'+ Add to stack',onclick:()=>addToSelection(p.slug)});
}
function stackLink(stack) {
  const safe=cleanStack(stack);if(!safe)return null;
  return SITE+'/stack#'+encodeURIComponent(JSON.stringify({v:1,title:safe.title,slugs:safe.slugs}));
}
function shareStack(stack) {
  const url=stackLink(stack);if(!url)return;
  $('#stackShareLink')?.parentElement.remove();
  dlgBody.append(el('label',{class:'field',style:'margin-top:16px'},el('span',{class:'mono',text:'Your stack link'}),el('input',{id:'stackShareLink',value:url,readonly:true,'aria-label':'Your stack link',onclick:e=>e.target.select()})));
  shareUrl(url,stack.title,'A tool stack on Expanse','Stack link copied.');
}
function saveStack(stack,status) {
  const safe=cleanStack(stack);if(!safe){status.textContent='Add at least one product first.';return;}
  const i=STACKS.findIndex(x=>x.id&&x.id===safe.id);
  if(i<0&&STACKS.length>=20){status.textContent='You have 20 saved stacks. Delete one in My space first.';return;}
  if(!safe.id)safe.id=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const next=STACKS.slice();if(i>=0)next[i]=safe;else next.unshift(safe);
  if(!persistPersonal(STACK_KEY,next)){status.textContent='Browser storage is blocked. Share the stack link to keep a copy.';return;}
  STACKS.splice(0,STACKS.length,...next);stack.id=safe.id;status.textContent='Saved to My space → Stacks in this browser.';return safe.id;
}
function openStack(value) {
  const stack=cleanStack(value);if(!stack){toast('Add a product to a stack first.');return;}
  closeUI();closeSheet();
  const title=el('input',{id:'stackTitle',class:'stack-title',value:stack.title,maxlength:'100','aria-label':'Stack name'});
  const products=stack.slugs.map(s=>BY_SLUG.get(s));
  const facts=[['What it does',p=>p.tagline],['Solves',p=>(p.needs||[]).join(', ')||'Not specified'],['Who it’s for',p=>p.audience||'Not specified'],['Price',p=>(PRICING[p.pricing]||'Not specified')+(p.price_text?' · '+p.price_text:'')],['Platforms',p=>(p.platforms||[]).map(x=>PLATFORMS[x]||x).join(', ')||'Not specified'],['Works with',p=>(p.integrations||[]).join(', ')||'Not specified'],['Checked by Expanse',p=>[p.verified_at?'Domain verified '+dateStr(p.verified_at):'Domain not verified',p.site_ok_at?'Website answered '+dateStr(p.site_ok_at):'No website check shown'].join(' · ')]];
  const table=el('table',{class:'stack-table'},el('thead',null,el('tr',null,el('th',{scope:'col',text:'Compare facts'}),stack.slugs.map((slug,i)=>el('th',{scope:'col'},el('span',{text:products[i]?.name||slug}),el('br'),el('button',{class:'linkbtn','aria-label':'Remove '+(products[i]?.name||slug)+' from comparison',text:'Remove',onclick:()=>{stack.slugs=stack.slugs.filter(s=>s!==slug);if(stack.slugs.length)openStack({...stack,title:title.value});else{closeDlg();toast('No tools left in this comparison.');}}}))))),el('tbody',null,facts.map(([label,get])=>el('tr',null,el('th',{scope:'row',text:label}),products.map(p=>el('td',{text:p?get(p):'This product is no longer public.'})))),el('tr',null,el('th',{scope:'row',text:'Explore'}),products.map(p=>el('td',null,p?el('button',{class:'chip-btn',text:'Open product',onclick:()=>{closeDlg();openProduct(p,{source:'shared'});}}):null)))));
  const status=el('p',{class:'mission-status',role:'status','aria-live':'polite'});
  const current=()=>({...stack,title:plainTitle(title.value)||'My tool stack'});
  openDlg(el('div',{class:'mono kick',text:'Your tools, together'}),el('h2',{class:'display',text:'Compare your stack.'}),title,el('p',{class:'mission-intro',text:'Compare maker-provided facts and dated checks. “Not specified” means we don’t know. Listing products together does not prove they integrate.'}),el('div',{class:'stack-table-wrap',tabindex:'0','aria-label':'Product comparison, scroll horizontally'},table),el('div',{class:'stack-toolbar'},el('button',{class:'btn btn-primary btn-sm',id:'saveStack',text:'Save stack',onclick:()=>{const id=saveStack(current(),status);if(id)stack.id=id;}}),el('button',{class:'btn btn-ghost btn-sm',id:'shareStack',text:'Share stack',onclick:()=>shareStack(current())}),el('button',{class:'linkbtn',text:'Use as my current stack',onclick:()=>{STACK_SELECTION=stack.slugs.slice();persistPersonal(SELECTION_KEY,STACK_SELECTION);paintStackSelection();status.textContent='Current stack updated. Add more tools from their profiles.';}})),status,el('p',{class:'fine',text:'Saved stacks stay in this browser. A share link includes only the stack name and selected product IDs. Anyone with that link can open it. Owner keys, email, votes and private statistics are never included.'}));
  dlg.classList.add('mission-dialog');
}
let missionResult=null,missionGoal='';
function openMission(initial='') {
  closeUI();closeSheet();if(demo)setDemo(false);
  const goal=el('textarea',{id:'missionGoal',rows:'3',maxlength:'500',placeholder:'e.g. Launch my indie app, find my first customers and manage payments',value:initial||missionGoal});
  const free=el('input',{type:'checkbox',id:'missionFree'}),platform=el('select',{id:'missionPlatform','aria-label':'Required platform'},el('option',{value:'',text:'Any platform'}),Object.entries(PLATFORMS).map(([v,label])=>el('option',{value:v,text:label})));
  const status=el('p',{class:'mission-status',id:'missionStatus',role:'status','aria-live':'polite'}),results=el('div',{id:'missionResults'});
  const render=result=>{
    const steps=(result.steps||[]).filter(s=>BY_SLUG.has(s.slug));
    fill(results,el('h3',{text:result.title}),el('p',{class:'fine',text:'Suggested fit from public product details. Confirm critical features and prices on the maker’s site.'}),steps.map((step,i)=>{
      const p=BY_SLUG.get(step.slug);
      return el('article',{class:'mission-step','data-mission-slug':p.slug},el('div',{class:'mono',text:'0'+(i+1)+' · '+step.task}),el('h3',{text:p.name}),el('p',{text:step.reason}),el('p',{text:p.tagline}),el('div',{class:'mission-facts'},el('span',{text:PRICING[p.pricing]||'Price not specified'}),(p.platforms||[]).slice(0,3).map(x=>el('span',{text:PLATFORMS[x]||x})),p.verified_at?el('span',{text:'✓ Verified domain'}):null),el('div',{class:'c-row'},el('button',{class:'chip-btn',text:'Explore product ↗',onclick:()=>{closeDlg();openProduct(p,{source:'search'});}}),stackBtn(p)));
    }),el('div',{class:'mission-gaps'},el('h3',{text:'What’s still missing'}),el('ul',null,(result.gaps?.length?result.gaps:['No additional gaps were identified by AI. Check the fit yourself before choosing.']).map(g=>el('li',{text:g})))),steps.length?el('div',{class:'stack-toolbar'},el('button',{class:'btn btn-primary btn-sm',id:'missionCompare',text:'Compare & save these tools',onclick:()=>openStack({title:result.title,slugs:steps.map(s=>s.slug)})})):null);
  };
  const submit=el('button',{class:'btn btn-primary',type:'submit',id:'missionSubmit',text:'Find my starting stack ↗'});
  const form=el('form',{onsubmit:async e=>{
    e.preventDefault();const brief=goal.value.trim();if(brief.length<12){status.textContent='Describe your goal in at least 12 characters.';goal.focus();return;}
    submit.disabled=true;status.textContent='Matching your goal to the live catalog…';results.replaceChildren();missionGoal=brief;
    try{const r=await aiRequest({mode:'mission',goal:brief,free:free.checked,platform:platform.value});missionResult=r.mission;if(!form.isConnected)return;render(r.mission);status.textContent=`Based on ${r.catalog_count} live ${r.catalog_count===1?'product':'products'} matching your filters. Suggestions cannot be bought.`;}
    catch(err){status.textContent=aiMessage(err);}finally{submit.disabled=false;}
  }},el('label',{class:'field'},el('span',{class:'mono',text:'What are you trying to do?'}),goal),el('div',{class:'mission-controls'},el('label',null,free,'Free plan available'),platform),submit);
  openDlg(el('div',{class:'mono kick',text:'From a goal to a starting stack'}),el('h2',{class:'display',text:'What’s your next move?'}),el('p',{class:'mission-intro',text:'Describe the job. Get a small set of tools with a reason for each one, and see the needs our catalog cannot cover yet.'}),el('div',{class:'mission-examples'},['Fix a failing deployment','Launch my first indie product','Run my freelance business'].map(text=>el('button',{class:'chip-btn',type:'button',text,onclick:()=>{goal.value=text;goal.focus();}}))),form,status,results,el('p',{class:'fine',style:'margin-top:22px',text:'Your brief and public catalog details are sent to Anthropic only when you ask. Don’t include private information. AI suggestions can be wrong; they do not verify compatibility or change search rankings.'}),el('div',{class:'stack-toolbar'},el('button',{class:'linkbtn',text:'Browse without AI',onclick:()=>{closeDlg();if(goal.value.trim())runSearch(goal.value.trim());else setView('list');}}),el('button',{class:'linkbtn',text:'My saved stacks',onclick:()=>openMySpace('stacks')})));
  dlg.classList.add('mission-dialog');if(missionResult&&missionGoal===goal.value)render(missionResult);
}
$('#missionBtn').onclick=()=>openMission();$('#heroMission').onclick=()=>openMission();paintStackSelection();

/* ================= FOLLOWING: saved in this browser, one combined feed of updates ================= */
const isFollowed = slug => !!FOLLOW.slugs[slug];
function saveFollow() { persistPersonal(FOLLOW_KEY, FOLLOW); renderFollowBtn(); }
function toggleFollow(p) {
  const now = new Date().toISOString();
  if (isFollowed(p.slug)) { delete FOLLOW.slugs[p.slug]; toast(`Stopped following ${p.name}.`); }
  else { FOLLOW.slugs[p.slug] = now; if (!FOLLOW.seen) FOLLOW.seen = now; toast(`Following ${p.name}. Its releases and changes show up under ★ Following.`, 4200); }
  saveFollow(); loadUpdates(); kick();
  if (view === 'list') renderList();
}
async function loadUpdates() {
  const slugs = Object.keys(FOLLOW.slugs).filter(isSlug).slice(0, 200);
  if (!slugs.length) { UPDATES = []; renderFollowBtn(); return; }
  try { const u = await rpc('public_updates', { p_slugs: slugs }); if (Array.isArray(u)) UPDATES = u.filter(x => x && isSlug(x.slug) && x.at); } catch (e) {}
  renderFollowBtn();
}
const isNewUpdate = u => !!FOLLOW.seen && Date.parse(u.at) > Math.max(Date.parse(FOLLOW.seen) || 0, Date.parse(FOLLOW.slugs[u.slug]) || 0);
function renderFollowBtn() {
  const n = Object.keys(FOLLOW.slugs).length, k = UPDATES.filter(isNewUpdate).length, c = $('#followCount');
  $('#followBtn').hidden = false; c.hidden = !k; c.textContent = k;
  $('#followBtn').setAttribute('aria-label', 'My space' + (k ? ` · ${k} new update${k === 1 ? '' : 's'}` : ''));
}
const KIND = { launched: ['★', '#c8ff3d', 'Launched'], verified: ['✓', '#ffffff', 'Verified'], updated: ['✎', '#5ee1ff', 'Profile updated'], release: ['↑', '#b39cff', 'GitHub release'] };
function openFollowing() {
  const slugs = Object.keys(FOLLOW.slugs);
  const chips = el('div', { class: 'fchips' }, slugs.map(s => { const p = BY_SLUG.get(s); return el('span', null, p ? p.name : s, el('button', { type: 'button', 'aria-label': 'Stop following ' + (p ? p.name : s), text: '×', onclick: () => { delete FOLLOW.slugs[s]; saveFollow(); kick(); loadUpdates().then(() => { if (Object.keys(FOLLOW.slugs).length) openFollowing(); else closeDlg(); }); } })); }));
  const items = UPDATES.slice(0, 60);
  const list = items.length ? el('ul', { class: 'feed' }, items.map(u => {
    const k = KIND[u.kind] || KIND.updated;
    const inner = [el('span', { class: 'ic', style: '--c:' + k[1], text: k[0], 'aria-hidden': 'true' }), el('span', { class: 'tx' }, el('b', { text: `${u.name} · ${u.title}` }), el('small', { text: `${k[2]} · ${timeAgo(u.at)}` }))];
    return el('li', { class: isNewUpdate(u) ? 'new' : null }, u.url
      ? el('a', { href: u.url, target: '_blank', rel: 'noopener nofollow' }, inner)
      : el('button', { type: 'button', onclick: () => { const p = BY_SLUG.get(u.slug); if (p) { closeDlg(); openProduct(p); } } }, inner));
  })) : el('p', { class: 'fine', text: 'Nothing new in the last 90 days. Launches, verifications, profile changes and GitHub releases show up here.' });
  openDlg(el('div', { class: 'mono kick', text: '★ Following' }), el('h2', { class: 'display', text: 'Your updates' }), el('button',{class:'linkbtn',text:'← Back to My space',onclick:()=>openMySpace('following')}), chips, list,
    el('p', { class: 'fine', text: 'Saved in this browser only — no account needed. Follow more from any product page.' }));
  FOLLOW.seen = new Date(Math.max(Date.now(), ...UPDATES.map(u => Date.parse(u.at) || 0))).toISOString(); saveFollow();
}
$('#followBtn').onclick = () => openMySpace();
$('#needsBoard').onclick=()=>openNeedBoard();

/* ================= INFO SHEET ================= */
function openSheet() { hideTip(); openModal(sheet, sheet.querySelector('.sheet-in')); }
function closeSheet() { closeModal(sheet); }
$('#infoBtn').onclick = openSheet;
sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('[data-sheet-close]')) closeSheet(); });

/* ================= LIVE: COUNTER + FEED (real data only; demo items are labelled) ================= */
function renderLive() {
  const live = STATS ? STATS.live | 0 : PRODUCTS.length, held = STATS ? STATS.reserved | 0 : 0, left = Math.max(0, FOUNDING_LIMIT - held);
  $('#heroLive').textContent = 'Open to every maker · search is not for sale';
  const hp = $('#heroProducts'); hp.replaceChildren(...PRODUCTS.slice().sort((a,b) => dayRot(a.slug) - dayRot(b.slug)).slice(0, 3).map(p => el('button', { type: 'button', 'data-exposure':p.slug, 'data-source':'home', onclick: () => openProduct(p, { source: 'home' }) }, el('i', { style: '--pc:' + (CATS[p.category] || CATS.other).color }), p.name, p.verified_at ? ' ✓' : '')));
  observeProductCards();
  const hc = $('#heroCounts'); hc.replaceChildren();
  if (live) hc.append(el('b', { text: fmt(live) }), live === 1 ? ' product live' : ' products live', ' · listing is ', el('b', { text: 'free' }));
  else hc.append('Open to every maker · ', el('b', { text: 'same rules for everyone' }));
  const dock = $('#dockTxt'); dock.replaceChildren(el('b', { text: 'Your product, discoverable.' }), ' Free profile · optional paid placement');
}
const ticker = $('#ticker'); let tickN = 0, tickItem = null;
function demoLine(q) {
  if (q.mode === 'sell') return `${q.name} just made a sale · ${q.city}`;
  if (q.mode === 'create') return `${q.name} posted something new`;
  if (q.mode === 'build') return `${q.name} shipped ${2 + Math.floor(Math.random() * 8)} commits`;
  return `${q.name} is ${q.avail ? 'available this week' : 'booked solid'}`;
}
function nextTick() {
  if (document.hidden || introRunning) return;
  let item = null;
  if (demo) {
    let q = null; for (let i = 0; i < 60 && !q; i++) { const c = DEMO[Math.floor(Math.random() * DEMO.length)]; if (c && c.last <= 3 && (c.featured || c.size >= 2)) q = c; }
    if (q) { item = { live: false, text: demoLine(q), q }; PULSES.push({ q, t: now() }); SPARKS.push({ q, t: now() }); q.boost = now(); }
  } else {
    const recent = ((STATS && STATS.recent) || []).filter(r => r && r.at && Date.now() - Date.parse(r.at) < 30 * 864e5 && ZONE_BY_ID[r.zone]);
    if (recent.length) {
      const r = recent[tickN % recent.length];
      if (r.kind === 'product' && r.name) item = { live: true, text: `New in ${CATS[r.category] ? CATS[r.category].label : 'the universe'}: ${r.name} · ${timeAgo(r.at)}`, slug: r.slug };
      else item = { live: true, text: `A spot was claimed in the ${ZONE_BY_ID[r.zone].label} · ${timeAgo(r.at)}`, zone: r.zone };
    }
  }
  tickN++; tickItem = item;
  if (!item) { ticker.classList.remove('on'); return; }
  ticker.classList.add('swap');
  setTimeout(() => {
    const tag = $('#tickTag'); tag.textContent = item.live ? 'Live' : 'Example'; tag.className = 'tag mono ' + (item.live ? 'live' : 'prev');
    $('#tickTxt').textContent = item.text; ticker.classList.remove('swap'); ticker.classList.add('on');
  }, 380);
}
ticker.onclick = () => {
  if (!tickItem) return;
  if (tickItem.q) openDemo(tickItem.q);
  else if (tickItem.slug && BY_SLUG.get(tickItem.slug)) openProduct(BY_SLUG.get(tickItem.slug));
  else if (tickItem.zone) { const z = ZONE_BY_ID[tickItem.zone], r = isFinite(z.r) ? z.r : WORLD_R; markExplore(); flyTo(0, -r + 6, clamp(10 / CELL, ZMIN, ZMAX), 1400, easeInOut); }
};

/* ================= ROUTING + BOOT ================= */
let deepSlug = null, deepSpot = null;
{
  const pm = location.pathname.match(/^\/p\/([a-z0-9-]{1,48})\/?$/), qp = new URLSearchParams(location.search);
  deepSlug = pm ? pm[1] : isSlug(qp.get('p')) ? qp.get('p') : null;
  const ref = qp.get('ref');
  if (deepSlug && !OWNED[deepSlug]) store.set(REF_KEY, deepSlug);
  else if (isSlug(ref) && !OWNED[ref]) store.set(REF_KEY, ref);
  const h = location.hash, ms = h.match(/^#s=([\w-]{4,800})$/);
  if (ms) { // links shared from the earlier version of the site
    try {
      const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(ms[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
      if (d && Number.isInteger(d.x) && Number.isInteger(d.y)) deepSpot = { x: d.x, y: d.y };
      if (d && typeof d.r === 'string' && /^[\w-]{6,20}$/.test(d.r)) store.set(REF_KEY, d.r);
    } catch (e) {}
  }
  if (h === '#demo') setDemo(true);
}
updateMine(); renderFollowBtn();
resize();
const introEl = $('#intro');
function endIntro() {
  if (!introRunning) return; introRunning = false; introEl.classList.add('out'); app.classList.add('ready');
  if (fly && fly.intro) { const f = fly; flyTo(f.x, f.y, f.z, 1000, easeOut); }
  else if (!fly && cam.z < home().z * .9) { const h = home(); flyTo(h.x, h.y, h.z, 1000, easeOut); }
}
{
  const h = home();
  cam.x = h.x; cam.y = h.y; cam.z = h.z;
  introEl.classList.add('out'); app.classList.add('ready');
}
kick();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);
(async () => {
  const [productsLoaded] = await Promise.all([loadProducts(), loadSpots(), loadOwned(), loadPlacements(), loadSpotlight(), loadCommerce()]);
  rebuildItems(); renderLive(); loadUpdates();
  if (new URLSearchParams(location.search).get('payment') === 'return') {
    const pending = store.get('expanse.checkout.v1');
    if (pending && OWNED[pending.slug]) { openManage(pending.slug, 'placement'); toast('Checking payment confirmation…', 4000); }
    else toast('Payment is confirmed by Stripe in the background. Sign in to your product to see its status.', 6000);
    history.replaceState(null, '', location.pathname);
  }
  if (new URLSearchParams(location.search).get('contact') === '1') openContact();
  if (deepSlug) {
    const p = BY_SLUG.get(deepSlug);
    if (p) { const it = ITEMS.find(i => i.slug === deepSlug); app.classList.add('explore'); explored = true; if (it) { cam.x = it.x + it.w / 2; cam.y = it.y + it.h / 2; cam.z = it.size >= 4 ? 1.6 : 2.4; } openProduct(p, { noFly: true, source: 'shared' }); $('#serverContent')?.remove(); }
    else if (OWNED[deepSlug]) openManage(deepSlug);
    else if (!$('#serverContent')) { setPath('/'); toast('That product isn’t live yet — it may still be in review.', 4500); }
  } else if (location.pathname === '/add') {
    startSubmit();
  } else if (location.pathname === '/stack') {
    let shared;try{if(location.hash.length<=3000){const payload=JSON.parse(decodeURIComponent(location.hash.slice(1)));if(payload.v===1)shared=cleanStack(payload);}}catch{}
    if(shared)openStack(shared);else{openMission();toast('That stack link is incomplete. Build a new stack below.');}
  } else if (location.pathname === '/needs') {
    openNeedBoard();
  } else if (location.pathname === '/me') {
    openMySpace();
  } else if (location.pathname === '/browse') {
    if (!productsLoaded && $('#serverContent')) return;
    const query = new URLSearchParams(location.search).get('q')?.trim().slice(0,160);
    if (query) runSearch(query); else setView('list');
    $('#serverContent')?.remove();
  } else if (deepSpot) {
    app.classList.add('explore'); explored = true; cam.x = deepSpot.x + 1; cam.y = deepSpot.y + 1; cam.z = 2.4;
    toast('A friend invited you — put your product right next to theirs.', 4500);
  }
})();
loadStats();
setInterval(() => { if (!document.hidden) loadStats(); }, 30000);
setInterval(() => { if (!document.hidden && ui === 'none') refreshAll(); }, 120000);
setInterval(() => { if (!document.hidden) loadUpdates(); }, 300000);
setTimeout(nextTick, 4400); setInterval(nextTick, 5200);
if (window.requestIdleCallback) requestIdleCallback(() => offsets(), { timeout: 5000 }); else setTimeout(offsets, 2500);
})();


