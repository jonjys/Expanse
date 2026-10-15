(() => {
'use strict';

/* ================= CONFIG ================= */
/* Supabase project "expanse" (Stockholm). The publishable key is public by design: tables are
   locked, and the browser can only call the RPC functions and the verify-domain function. */
const SUPA = { url: 'https://gjmkhnrgznorxxaemsmo.supabase.co', key: 'sb_publishable_b1uzRroOaHTGp9oXOhHjtQ_J-A-IUCZ' };
const FOUNDING_LIMIT = 1000;
/* Keep in sync with zone_of() and price_per_cell() in Supabase. */
const ZONES = [
  { id: 'core',  label: 'Core',       r: 14,       price: 49, color: '#ffffff', invite: true, line: 'Invite only.' },
  { id: 'inner', label: 'Inner ring', r: 40,       price: 19, color: '#c8ff3d', line: 'Close to the core.' },
  { id: 'belt',  label: 'Belt',       r: 80,       price: 9,  color: '#5ee1ff', line: 'Where the universe gets busy.' },
  { id: 'outer', label: 'Outer rim',  r: 125,      price: 4,  color: '#b39cff', line: 'Room to grow out here.' },
  { id: 'edge',  label: 'Edge',       r: Infinity, price: 1,  color: '#8b94c9', line: 'Out on the frontier.' }
];
const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));
const WORLD_R = 150, CORE_R = 14, CELL = 16, ZMIN = .025, ZMAX = 6, MAX_R = WORLD_R + 25;
const OWNED_KEY = 'expanse.owned.v1', REF_KEY = 'expanse.ref', RECOVER_KEY = 'expanse.recover.v1', DRAFT_KEY = 'expanse.draft.v1';

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
const PRICING = { free: 'Free', freemium: 'Free plan', trial: 'Free trial', paid: 'Paid' };
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
const store = ExpanseUI.storage(() => localStorage);
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
let PRODUCTS = [], BY_SLUG = new Map(), SPOTS = [], OWNED = store.get(OWNED_KEY) || {}, OWNDATA = {};
const zoneOf = (x, y, size) => { const d = Math.hypot(x + size / 2, y + size / 2); return ZONES.find(z => d < z.r); };
const priceOf = (x, y, size) => zoneOf(x, y, size).price * size * size;
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
function spotOk(x, y, size) { return isFree(x, y, size, size) && !zoneOf(x, y, size).invite && Math.hypot(x + size / 2, y + size / 2) < MAX_R; }
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
  if (!zoneFreeCache) { zoneFreeCache = Object.assign({}, ZONE_CAP); for (const it of ITEMS) { const z = zoneOf(it.x, it.y, it.size).id; zoneFreeCache[z] -= it.size * it.size; } }
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
function track(slug, kind) {
  if (!slug || OWNED[slug] || navigator.webdriver) return;
  const k = slug + ':' + kind; if (kind === 'view' && tracked.has(k)) return; tracked.add(k);
  rpc('track', { p_slug: slug, p_kind: kind }, { keepalive: true }).catch(() => {});
}
let STATS = null;
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
    if (Array.isArray(list)) { PRODUCTS = list.filter(p => p && isSlug(p.slug) && Number.isInteger(p.x) && Number.isInteger(p.y) && [1, 2, 4, 8].includes(p.size)).map(prepProduct); BY_SLUG = new Map(PRODUCTS.map(p => [p.slug, p])); }
  } catch (e) {}
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
  saveOwned();
}
async function refreshAll() { await Promise.all([loadProducts(), loadSpots()]); rebuildItems(); if (ui === 'none' && view === 'list') renderList(); }
function saveOwned() {
  const saved = store.set(OWNED_KEY, OWNED);
  let notice = $('#ownerStorageNotice');
  if (!saved && Object.keys(OWNED).length) {
    if (!notice) {
      notice = el('div', { id: 'ownerStorageNotice', role: 'alert', class: 'storage-notice' });
      app.appendChild(notice);
    }
    notice.textContent = 'This browser could not save your owner key. Download the key before closing this tab, or you will need domain recovery to edit your product.';
    notice.hidden = false;
  } else if (notice) notice.hidden = true;
  updateMine();
  return saved;
}

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
const itemColor = it => it.kind === 'mine' ? '#c8ff3d' : it.kind === 'spot' ? '#ffffff' : CATS[it.cat].color;
const itemRgb = it => it.kind === 'mine' ? '200,255,61' : it.kind === 'spot' ? '255,255,255' : CATS[it.cat].rgb;

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
    if (it.kind === 'spot') continue;
    const c = toS(it.x + it.w / 2, it.y + it.h / 2), bw = it.w * cp;
    const pu = reduce ? .5 : .5 + .5 * Math.sin(T * .002 + it.idx * 1.3);
    const R = Math.max(bw * 1.15 + 12, (cp < 4 ? 26 : 16) + 5 * it.size) * (1 + .12 * pu);
    ctx.globalAlpha = (it.kind === 'mine' ? .45 : .8) * (it === hoverIt || it === sel ? 1.3 : 1);
    ctx.drawImage(sprite(itemRgb(it)), c.x - R, c.y - R, 2 * R, 2 * R);
  }
  if (!reduce && cp < 9) for (const it of vis) {
    if (it.kind !== 'product') continue;
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
    ctx.globalAlpha = it.kind === 'mine' ? .6 : 1; ctx.fillStyle = col;
    if (bw < 5) {
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2, bw * .5 + 1), 0, 6.2832); ctx.fill();
    } else {
      const gap = Math.min(1.5, cp * .08), rr = Math.min(6, cp * .18);
      rrect(ctx, p.x + gap, p.y + gap, bw - 2 * gap, bw - 2 * gap, rr); ctx.fill();
      if (bw > 16) { ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(p.x + gap + rr, p.y + gap, bw - 2 * gap - 2 * rr, Math.max(1, cp * .07)); }
      if (it.kind === 'mine') { ctx.globalAlpha = 1; ctx.setLineDash([4, 4]); ctx.strokeStyle = '#c8ff3d'; ctx.lineWidth = 2; rrect(ctx, p.x - 2, p.y - 2, bw + 4, bw + 4, rr + 2); ctx.stroke(); ctx.setLineDash([]); }
      else if (it.owned) { ctx.globalAlpha = 1; ctx.strokeStyle = '#c8ff3d'; ctx.lineWidth = 2.5; rrect(ctx, p.x - 2, p.y - 2, bw + 4, bw + 4, rr + 2); ctx.stroke(); }
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
    floatLabel(c.x + s / 2, c.y, named ? sub.name : `YOUR SPOT · ${eur(priceOf(c.x, c.y, s))}`, col, T);
  }
  for (const it of ITEMS) if (it.owned && !(ui === 'claim' && sub.step < 6)) floatLabel(it.x + it.w / 2, it.y, '★ ' + it.name + (it.kind === 'mine' ? ' · in review' : ''), '#c8ff3d', T);
  if (sel && sel.kind === 'product' && !sel.owned && ui === 'pop') floatLabel(sel.x + sel.w / 2, sel.y, sel.name, itemColor(sel), T);
  ctx.font = '600 10px "IBM Plex Mono",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  for (const zz of ZONES) {
    const r = (isFinite(zz.r) ? zz.r : WORLD_R + 8) * cp; if (r < 70 || r > Math.max(W, H) * 2.2) continue;
    const y = c0.y - r; if (y < 70 || y > H - 20 || c0.x < -200 || c0.x > W + 200) continue;
    const label = zz.invite ? `${zz.label.toUpperCase()} · INVITE ONLY` : `${zz.label.toUpperCase()} · ${eur(zz.price)}/CELL`;
    const tw = ctx.measureText(label).width + 20;
    ctx.globalAlpha = .92; ctx.fillStyle = 'rgba(4,6,22,.88)'; rrect(ctx, c0.x - tw / 2, y - 11, tw, 22, 11); ctx.fill();
    ctx.strokeStyle = zz.color; ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = zz.color; ctx.fillText(label, c0.x + 1, y + .5);
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
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
  zAnim = { target: clamp(base * f, ZMIN, ZMAX), sx, sy }; markExplore(); kick();
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
    showTip(m, z.label, z.invite ? 'Invite only · click to dive in' : `Founding price ${eur(z.price)} / cell · click to dive in`, z.color);
    return;
  }
  const q = demoAt(m);
  if (q) { hoverDemo = q; cv.classList.add('pointy'); showTip(m, q.name, 'Example · ' + MODES[q.mode].label + ' · not a real product', '#b39cff'); return; }
  if (ui !== 'none') { hideTip(); return; }
  if (zoneOf(cx, cy, 1).invite) { showTip(m, 'Core', 'Invite only', '#fff'); return; }
  const f = freeAround(cx, cy, 2);
  if (f) { ghost = f; cv.classList.add('pointy'); showTip(m, `Free spot · ${zoneOf(f.x, f.y, 2).label}`, `Click to put your product here · 2×2 founding price ${eur(priceOf(f.x, f.y, 2))}`, '#c8ff3d'); }
  else hideTip();
}
function tap(m) {
  const cp = CELL * cam.z, w = toW(m.x, m.y), cx = Math.floor(w.x), cy = Math.floor(w.y);
  if (introRunning) return;
  if (ui === 'claim' && sub.step === 1) { const s = nearestFree(cx - (sub.size >> 1), cy - (sub.size >> 1), sub.size); if (s) setSpot(s, true); return; }
  const it = itemAt(m);
  if (it) { openItem(it); return; }
  if (cp < 4.5) { markExplore(); flyTo(w.x, w.y, clamp(18 / CELL, ZMIN, ZMAX), 1300, easeInOut); return; }
  const q = demoAt(m);
  if (q) { openDemo(q); return; }
  if (ui !== 'none') { closeUI(); return; }
  if (zoneOf(cx, cy, 1).invite) { toast('The core is invite only. Pick a spot just outside it.'); return; }
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
    cam.z = clamp(pinch.z * d / pinch.d, ZMIN, ZMAX);
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
  if (view === 'list' || dlg.classList.contains('open') || sheet.classList.contains('open')) { if (e.key === '/') { e.preventDefault(); openSearch(); } return; }
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
async function squareCard(it, title, line) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const g = c.getContext('2d');
  const bg = g.createRadialGradient(540, 620, 0, 540, 620, 950); bg.addColorStop(0, '#16206a'); bg.addColorStop(.45, '#080c2c'); bg.addColorStop(1, '#02030c');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1350);
  const r3 = mulberry(it.x * 7919 + it.y * 104729 + 7);
  for (let i = 0; i < 320; i++) { g.globalAlpha = .15 + r3() * .6; g.fillStyle = '#fff'; const s = .6 + r3() * 1.8; g.fillRect(r3() * 1080, r3() * 1350, s, s); }
  const sc = 26, cx = 540, cy = 640, wx = it.x + it.size / 2, wy = it.y + it.size / 2, col = itemColor(it), rgb = itemRgb(it);
  g.globalCompositeOperation = 'lighter';
  for (const q of DEMO) {
    const sx = cx + (q.x + q.w / 2 - wx) * sc, sy = cy + (q.y + q.h / 2 - wy) * sc;
    if (sx < -20 || sy < -20 || sx > 1100 || sy > 1370) continue;
    const fade = clamp(1 - Math.hypot(sx - cx, sy - cy) / 650, 0, 1); if (fade <= 0) continue;
    g.globalAlpha = fade * .5; g.fillStyle = '#a9bcff'; g.fillRect(sx - 1.5, sy - 1.5, 3, 3);
  }
  g.globalCompositeOperation = 'source-over';
  for (const q of ITEMS) {
    if (q === it) continue;
    const sx = cx + (q.x - wx) * sc, sy = cy + (q.y - wy) * sc, sw = q.size * sc;
    if (sx > 1080 || sy > 1350 || sx + sw < 0 || sy + sw < 0) continue;
    g.globalAlpha = clamp(1 - Math.hypot(sx + sw / 2 - cx, sy + sw / 2 - cy) / 650, 0, 1) * .9;
    g.fillStyle = itemColor(q); rrect(g, sx + 2, sy + 2, sw - 4, sw - 4, 6); g.fill();
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'lighter';
  const ms = it.size * sc, mx = cx - ms / 2, my = cy - ms / 2, R = ms * 2.6 + 80;
  g.drawImage(sprite(rgb), cx - R, cy - R, R * 2, R * 2); g.globalCompositeOperation = 'source-over';
  g.fillStyle = col; rrect(g, mx + 2, my + 2, ms - 4, ms - 4, 8); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 6; rrect(g, mx - 6, my - 6, ms + 12, ms + 12, 12); g.stroke();
  g.font = '700 34px "Instrument Sans",sans-serif'; const lw = Math.min(900, g.measureText(title).width + 48);
  g.fillStyle = 'rgba(4,6,22,.95)'; rrect(g, cx - lw / 2, my - 110, lw, 64, 32); g.fill(); g.strokeStyle = col; g.lineWidth = 3; g.stroke();
  g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(title, cx, my - 77, lw - 40);
  g.beginPath(); g.moveTo(cx, my - 46); g.lineTo(cx, my - 10); g.stroke();
  const top = g.createLinearGradient(0, 0, 0, 260); top.addColorStop(0, 'rgba(2,3,12,.95)'); top.addColorStop(1, 'rgba(2,3,12,0)'); g.fillStyle = top; g.fillRect(0, 0, 1080, 260);
  const bot = g.createLinearGradient(0, 960, 0, 1350); bot.addColorStop(0, 'rgba(2,3,12,0)'); bot.addColorStop(.45, 'rgba(2,3,12,.92)'); bot.addColorStop(1, '#02030c'); g.fillStyle = bot; g.fillRect(0, 960, 1080, 390);
  const og = g.createRadialGradient(92, 98, 2, 100, 106, 26); og.addColorStop(0, '#c8ff3d'); og.addColorStop(.5, '#5ee1ff'); og.addColorStop(1, '#1a5fff'); g.fillStyle = og; g.beginPath(); g.arc(100, 106, 26, 0, 6.2832); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = '700 46px "Instrument Sans",sans-serif'; g.fillText('Expanse', 142, 108);
  g.textAlign = 'right'; g.font = '600 22px "IBM Plex Mono",monospace'; g.fillStyle = '#c8ff3d'; g.fillText('THE INTERNET, AS A UNIVERSE', 1000, 108);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = '700 92px "Instrument Sans",sans-serif'; g.fillStyle = '#fff'; g.fillText(it.name, 80, 1150, 920);
  g.font = '500 34px "Instrument Sans",sans-serif'; g.fillStyle = '#c3caf0'; g.fillText(line, 80, 1210, 920);
  g.font = '600 26px "IBM Plex Mono",monospace'; g.fillStyle = '#c8ff3d';
  g.fillText(productUrl(it.slug).replace(/^https:\/\//, '').toUpperCase() + ' →', 80, 1280, 920);
  return new Promise(res => c.toBlob(res, 'image/png'));
}
async function shareCard(slug) {
  const it = ITEMS.find(i => i.slug === slug); if (!it) return;
  const o = OWNDATA[slug] || it.p || {}, z = zoneOf(it.x, it.y, it.size);
  toast('Rendering your share card…', 1500);
  const line = `${CATS[it.cat].label} · ${z.label} · ${it.size}×${it.size}` + (o.number ? ` · Founding spot #${fmt(o.number)}` : '');
  const blob = await squareCard(it, '★ ' + it.name, line); if (!blob) return;
  const file = new File([blob], slug + '-expanse.png', { type: 'image/png' }), url = productUrl(slug);
  if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: it.name + ' on Expanse', text: `${it.name} is in the Expanse universe: ${url}` }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  download(slug + '-expanse.png', blob);
  toast((await copy(url)) ? 'Card saved and link copied — post them together.' : 'Card saved.');
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
  if (it.kind === 'product') openProduct(it.p);
  else if (it.kind === 'mine') openManage(it.slug);
  else openSpot(it);
}
function openProduct(p, opts) {
  const it = ITEMS.find(i => i.slug === p.slug); sel = it || null;
  const cat = CATS[p.category] ? p.category : 'other', z = zoneOf(p.x, p.y, p.size);
  const visit = el('a', { class: 'btn btn-primary btn-sm', href: p.url, target: '_blank', rel: 'noopener nofollow ugc', title: p.url, onclick: () => track(p.slug, 'visit') }, el('span', { text: 'Visit website' }), ' ↗');
  const demoBtn = p.demo_url ? el('a', { class: 'btn btn-ghost btn-sm', href: p.demo_url, target: '_blank', rel: 'noopener nofollow ugc', onclick: () => track(p.slug, 'demo') }, 'Try demo ↗') : null;
  const imgs = (p.images || []).length ? el('div', { class: 'imgs' }, p.images.map(src => el('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', decoding: 'async', onerror: e => e.target.remove() }))) : null;
  const facts = [['For', p.audience], ['Price', PRICING[p.pricing] + (p.price_text ? ' · ' + p.price_text : '')]];
  if ((p.platforms || []).length) facts.push(['Platforms', p.platforms.map(x => PLATFORMS[x] || x).join(', ')]);
  if ((p.integrations || []).length) facts.push(['Works with', p.integrations.join(', ')]);
  fill(popBody,
    el('div', { class: 'pbadges' }, catBadge(cat), p.verified_at ? badge('b-ver', '✓ Verified domain', null) : null, p.sponsored ? badge('b-spon', 'Sponsored') : null, it && it.owned ? badge('b-st live', 'Yours') : null),
    el('h2', { class: 'display pname', text: p.name }),
    el('p', { class: 'ptag', text: p.tagline }),
    el('div', { class: 'pmeta mono', text: `${p.domain} · ${z.label} · ${p.size}×${p.size}` }),
    imgs,
    el('div', { class: 'pact' }, visit, demoBtn, el('button', { class: 'chip-btn', 'aria-label': 'Share ' + p.name, text: '↗', onclick: () => shareUrl(productUrl(p.slug), p.name + ' on Expanse', `${p.name} — ${p.tagline}`, 'Link copied.') })),
    el('div', { class: 'sec' }, el('h4', { class: 'mono', text: 'Solves' }), el('div', { class: 'needs' }, p.needs.map(n => el('button', { class: 'need', text: n, title: 'Find more products for “' + n + '”', onclick: () => runSearch(n) })))),
    el('div', { class: 'sec' }, el('p', { class: 'pdesc', text: p.description })),
    el('div', { class: 'sec facts' }, facts.map(f => el('div', null, el('small', { text: f[0] }), el('span', { text: f[1] })))),
    el('div', { class: 'pfoot' },
      it && it.owned ? el('button', { class: 'linkbtn', text: 'Manage my product', onclick: () => openManage(p.slug) }) : el('button', { class: 'linkbtn', text: 'I make this', onclick: () => openOwnerLogin(p.slug, p.name) }),
      el('button', { class: 'linkbtn', text: 'Report a problem', onclick: () => openReport(p) }),
      view === 'list' ? el('button', { class: 'linkbtn', text: 'Show on map', onclick: () => { setView('map'); setTimeout(() => openProduct(p), 60); } }) : null),
    el('p', { class: 'fine', text: (p.verified_at ? `Verified on ${dateStr(p.verified_at)}: the maker proved they control ${p.domain}. ` : '') + 'Where a product sits on the map is a placement, not a ranking — it never affects search.' })
  );
  openPanel(pop, 'pop');
  setPath('/p/' + p.slug);
  track(p.slug, 'view');
  if (it && view === 'map' && !(opts && opts.noFly)) { centerOn(it); markExplore(); }
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
const STOP = new Set('a an and are as at be by can for from get help how i in is it me my need needs of on or so some that the this to tool tools app apps want with without who your'.split(' '));
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
  return { s, why };
}
function searchProducts(qs, list) {
  const q = normQ(qs), ts = terms(qs); if (q.length < 2) return [];
  const out = [];
  for (const p of list || PRODUCTS) { const r = scoreProduct(p, q, ts); if (r.s > 0) out.push({ p, s: r.s, why: r.why }); }
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
    results.replaceChildren(el('div', { class: 'lbl mono', text: PRODUCTS.length ? 'Popular needs' : 'Try a need' }), el('div', { class: 'ideas' }, topNeeds(8).map(n => el('button', { type: 'button', text: n, onclick: () => runSearch(n) }))));
    results.hidden = false; return;
  }
  const r = searchProducts(v).slice(0, 6), d = searchDemo(v), kids = [];
  for (const x of r) kids.push(el('button', { type: 'button', onclick: () => { results.hidden = true; searchEl.classList.remove('open'); openProduct(x.p); } },
    el('span', { class: 'sw', style: 'background:' + CATS[x.p.category].color }), el('span', { class: 'rt' }, el('b', { text: x.p.name }), el('small', { text: whyLabel(x) })), x.p.verified_at ? el('span', { class: 'tagx', text: '✓' }) : null));
  for (const q of d) kids.push(el('button', { type: 'button', onclick: () => { results.hidden = true; searchEl.classList.remove('open'); openDemo(q); } },
    el('span', { class: 'sw', style: 'background:' + MODES[q.mode].color }), el('span', { class: 'rt' }, el('b', { text: q.name }), el('small', { text: q.tag })), el('span', { class: 'tagx mono', text: 'Example' })));
  if (r.length) kids.push(el('button', { type: 'button', class: 'all', text: `See all ${plural(searchProducts(v).length, 'match', 'matches')} in the list →`, onclick: () => runSearch(v) }));
  if (!r.length) kids.unshift(el('div', { class: 'none' }, `No live product solves “${v}” yet. `, el('button', { type: 'button', text: 'Add yours →', onclick: () => { results.hidden = true; startSubmit(null); } })));
  results.replaceChildren(...kids); results.hidden = false;
}
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
  else { listQ = ''; }
  kick();
}
$('#vMap').onclick = () => { closeUI(); setView('map'); };
$('#vList').onclick = () => { if (ui === 'pop') closeUI(); setView('list'); };
document.querySelectorAll('[data-list]').forEach(b => b.onclick = () => setView('list'));
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
function card(p, why) {
  return el('button', { class: 'card', style: '--c:' + CATS[p.category].color, onclick: () => openProduct(p) },
    el('div', { class: 'top' }, el('b', { text: p.name }), p.verified_at ? el('span', { class: 'ver', title: 'Verified domain', text: '✓' }) : null),
    el('p', { text: p.tagline }),
    why ? el('div', { class: 'why', text: why }) : el('div', { class: 'needs' }, p.needs.slice(0, 3).map(n => el('span', { class: 'need', text: n }))),
    el('div', { class: 'meta' }, el('span', { text: CATS[p.category].label }), el('span', { text: PRICING[p.pricing] }), p.platforms.length ? el('span', { text: p.platforms.slice(0, 3).map(x => PLATFORMS[x]).join(' · ') }) : null, p.sponsored ? el('span', { class: 'spon', text: 'Sponsored' }) : null));
}
function renderList() {
  const base = filtered(); let rows;
  if (listQ) rows = searchProducts(listQ, base).map(r => ({ p: r.p, why: whyLabel(r) }));
  else rows = base.map(p => ({ p, why: null }));
  const sort = lSort.value;
  if (sort === 'new') rows.sort((a, b) => Date.parse(b.p.approved_at || 0) - Date.parse(a.p.approved_at || 0));
  else if (sort === 'az' || (sort === 'match' && !listQ)) rows.sort((a, b) => a.p.name.localeCompare(b.p.name));
  const lq = $('#lQuery'); lq.hidden = !listQ;
  if (listQ) lq.replaceChildren(`Best matches for “${listQ}”`, el('button', { type: 'button', text: 'Clear search', onclick: () => { listQ = ''; qIn.value = ''; renderList(); } }));
  $('#lCount').textContent = plural(rows.length, 'product', 'products');
  if (!rows.length) {
    const none = !PRODUCTS.length;
    cardsEl.replaceChildren(el('div', { class: 'empty' },
      el('h3', { text: none ? 'The universe is wide open.' : listQ ? `Nothing solves “${listQ}” yet.` : 'No products match these filters.' }),
      el('p', { text: none ? 'No products are live yet. The first ones get the best spots, closest to the core.' : 'Know a product that does? Its maker can add it in a couple of minutes.' }),
      el('div', { class: 'c-row' }, el('button', { class: 'btn btn-primary btn-sm', text: 'Add your product', onclick: () => startSubmit(null) }), none ? el('button', { class: 'btn btn-ghost btn-sm', text: 'See the demo universe', onclick: () => { setView('map'); $('#demoHero').click(); } }) : null)));
    return;
  }
  cardsEl.replaceChildren(...rows.map(r => card(r.p, r.why)));
}

/* ================= PRODUCT FORM (used by "add" and by the owner panel) ================= */
function normUrl(v) {
  v = String(v || '').trim(); if (!v) return '';
  if (/^http:\/\//i.test(v)) v = 'https://' + v.slice(7);
  else if (!/^https:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
  return v;
}
const urlOk = v => /^https:\/\/(?!(?:[^\/?#]*@))[a-z0-9.-]+\.[a-z]{2,24}(:\d{2,5})?([\/?#]\S*)?$/i.test(v) && v.length <= 300;
function makeForm() {
  const f = {}, data = { category: '', pricing: '', needs: [], platforms: [], integrations: [] };
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
  f.description = { w: el('label', { class: 'field', 'data-f': 'description' }, el('span', { class: 'mono' }, 'Description', counter), desc), i: desc };
  const imgs = el('textarea', { rows: '3', placeholder: 'https://… one image link per line, up to 4', spellcheck: 'false', style: 'min-height:84px' });
  f.images = { w: el('label', { class: 'field', 'data-f': 'images' }, el('span', { class: 'mono' }, 'Images ', el('em', { text: 'optional · screenshots work best' })), imgs, el('small', { class: 'hint', text: 'Links to images already online (https). We show them as they are.' })), i: imgs };
  const groups = {
    basics: [
      input('name', 'Product name', { maxlength: '40', placeholder: 'e.g. Kvitto' }),
      input('url', 'Website', { type: 'url', inputmode: 'url', maxlength: '300', placeholder: 'yourproduct.com' }, 'Where people go when they click Visit. Must work over https.'),
      input('tagline', 'One line: what it does', { maxlength: '90', placeholder: 'e.g. Invoices for freelancers in two clicks' }),
      opts('category', 'Category', Object.entries(CATS).map(([k, c]) => [k, c.label]), false, Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.color])))
    ],
    fit: [
      tags('needs', 'Problems it solves', 'Type a need and press Enter, e.g. send invoices', 6, 60, () => NEED_IDEAS, true),
      input('audience', 'Who it’s for', { maxlength: '140', placeholder: 'e.g. Freelancers and small agencies in the EU' }),
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
    data.category = CATS[d.category] ? d.category : ''; data.pricing = PRICING[d.pricing] ? d.pricing : '';
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
    needs: d => d.needs.length >= 1 || 'Add at least one problem it solves — that’s how people find it.',
    audience: d => d.audience.length >= 3 || 'Who is it for?',
    pricing: d => !!d.pricing || 'Pick a price option.',
    description: d => d.description.length >= 30 || 'Describe it in at least 30 characters.',
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
const sub = { step: 0, spot: null, size: 2, name: '', cat: '', result: null };
const wiz = makeForm();
$('#fBasics').append(...wiz.groups.basics); $('#fFit').append(...wiz.groups.fit); $('#fStory').append(...wiz.groups.story);
let draftT = 0;
wiz.onChange(() => { const d = wiz.get(); sub.name = d.name; sub.cat = d.category; kick(); clearTimeout(draftT); draftT = setTimeout(() => store.set(DRAFT_KEY, Object.assign(d, { size: sub.size })), 400); });
const STEP_OF = { basics: 2, fit: 3, story: 4 };
function setStep(n) {
  const prev = sub.step; sub.step = n;
  for (let i = 1; i <= 6; i++) $('#cStep' + i).hidden = i !== n;
  claimEl.querySelectorAll('.steps i').forEach((e, i) => e.classList.toggle('on', i < n));
  claimEl.querySelector('.steps').hidden = n === 6;
  claimEl.querySelectorAll('[data-s]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.s === sub.size)));
  if (n === 5) renderSummary();
  claimEl.scrollTop = 0;
  if (n === 1 && prev > 1 && sub.spot) centerOnSpot(true);
  kick();
}
function startSubmit(spot, fromMap) {
  if (demo) setDemo(false);
  closeSheet(); closeDlg(); sel = null; if (view === 'list') setView('map');
  if (sub.step === 6 || !sub.step) { sub.result = null; const d = store.get(DRAFT_KEY); wiz.set(d); sub.size = d && [1, 2, 4, 8].includes(d.size) ? d.size : 2; sub.name = d ? d.name || '' : ''; sub.cat = d ? d.category || '' : ''; }
  openPanel(claimEl, 'claim'); markExplore();
  setStep(1);
  const s = spot || nearestFree(-(sub.size >> 1), -(sub.size >> 1), sub.size);
  if (s) setSpot(s, !!fromMap);
}
function describe() {
  const s = sub.spot, z = zoneOf(s.x, s.y, sub.size), zf = zoneFree(z.id);
  const zb = $('#cZone'); zb.textContent = z.label; zb.style.background = z.color;
  $('#cCloser').textContent = `${fmt(zf.free)} of ${fmt(zf.cap)} cells free`;
  $('#cTitle').textContent = z.line;
  $('#cPrice').textContent = eur(z.price * sub.size * sub.size);
  claimEl.querySelectorAll('[data-s]').forEach(b => { const sz = +b.dataset.s; b.querySelector('small').textContent = eur(zoneOf(s.x, s.y, sz).price * sz * sz) + (sz === 8 ? ' · landmark' : ''); });
  $('#cMoveHint').textContent = (coarse ? 'Tap' : 'Click') + ' anywhere on the map to move your spot.';
}
function centerOnSpot(quick) { const s = sub.spot; if (!s) return; flyTo(s.x + sub.size / 2, s.y + sub.size / 2, clamp(Math.max(cam.z, (isMobile() ? 26 : 34) / CELL / Math.max(1, sub.size / 2)), ZMIN, ZMAX), quick ? 550 : 1300, easeInOut); }
function setSpot(s, quick) { sub.spot = { x: s.x, y: s.y }; describe(); centerOnSpot(quick); }
$('#cSizes').addEventListener('click', e => {
  const b = e.target.closest('[data-s]'); if (!b) return; const sz = +b.dataset.s; if (sz === sub.size) return;
  const c = sub.spot || { x: 0, y: 0 }, old = sub.size; sub.size = sz;
  const s = nearestFree(Math.round(c.x + old / 2 - sz / 2), Math.round(c.y + old / 2 - sz / 2), sz);
  if (s) setSpot(s, true); setStep(1);
});
$('#cCore').onclick = () => { const s = nearestFree(-(sub.size >> 1), -(sub.size >> 1), sub.size); if (s) setSpot(s, false); };
$('#cNext1').onclick = () => { if (!sub.spot || !spotOk(sub.spot.x, sub.spot.y, sub.size)) { const s = nearestFree(sub.spot ? sub.spot.x : 0, sub.spot ? sub.spot.y : 0, sub.size); if (s) setSpot(s, true); } setStep(2); if (!coarse) setTimeout(() => wiz.groups.basics[0].querySelector('input').focus({ preventScroll: true }), 220); };
$('#cNext2').onclick = () => { if (!wiz.check(['basics'])) setStep(3); };
$('#cNext3').onclick = () => { if (!wiz.check(['fit'])) setStep(4); };
$('#cNext4').onclick = () => { if (!wiz.check(['story'])) { setStep(5); if (!coarse) setTimeout(() => $('#cMail').focus({ preventScroll: true }), 220); } };
claimEl.querySelectorAll('[data-back]').forEach(b => b.onclick = () => setStep(Math.max(1, sub.step - 1)));
function renderSummary() {
  const d = wiz.get(), s = sub.spot, z = zoneOf(s.x, s.y, sub.size), cat = CATS[d.category] || CATS.other;
  $('#cSummary').style.setProperty('--c', cat.color);
  $('#sName').textContent = d.name; $('#sWhere').textContent = `${cat.label} · ${z.label} · ${sub.size}×${sub.size}`;
  $('#sAmt').replaceChildren(el('b', { text: '€0' }), el('br'), `today · founding ${eur(z.price * sub.size * sub.size)}`);
}
$('#cSubmit').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('#cWeb').value) return;
  const input = $('#cMail'), email = input.value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#fMail').classList.add('bad'); input.focus(); toast('That email looks off.'); return; }
  $('#fMail').classList.remove('bad');
  if (!$('#cOwn').checked) { toast('Please confirm that you make or represent this product.'); $('#cOwn').focus(); return; }
  const stepWithError = wiz.check(['basics', 'fit', 'story']); if (stepWithError) { setStep(STEP_OF[wiz.groupOf(stepWithError)]); wiz.bad(stepWithError); return; }
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
    } else if (m.includes('core_invite_only')) { setStep(1); toast('The core is invite only — pick a spot just outside it.'); }
    else if (m.includes('out_of_bounds')) { setStep(1); toast('That spot is outside the universe — pick one closer in.'); }
    else if (m.includes('too_many')) toast('You have sent several products recently. Give it an hour, or wait for the review.', 5000);
    else if (m.includes('busy')) toast('Lots of makers are adding products right now — try again in a minute.', 4500);
    else toast("Couldn't send it right now — check your connection and try again.");
  } finally { btn.disabled = false; btn.textContent = 'Send for review'; }
});
function finish(r) {
  setStep(6);
  const z = ZONE_BY_ID[r.zone] || zoneOf(r.x, r.y, r.size);
  $('#dTitle').textContent = `Founding spot #${fmt(r.number)}.`;
  $('#dText').textContent = `${r.name} is held in the ${z.label} (${r.size}×${r.size}). We review it before it goes live. Your link will be ${productUrl(r.slug).replace(/^https?:\/\//, '')}.`;
  $('#dKey').textContent = r.key;
  const it = ITEMS.find(i => i.slug === r.slug); if (it) { celebrate(it); setTimeout(() => { if (ui === 'claim' && sub.step === 6) flyTo(it.x + it.w / 2, it.y + it.h / 2, clamp(cam.z * .5, ZMIN, ZMAX), 2200, easeInOut); }, 1200); }
}
$('#dKeyCopy').onclick = async () => toast((await copy($('#dKey').textContent)) ? 'Owner key copied. Keep it somewhere safe.' : 'Select the key and copy it.');
$('#dKeySave').onclick = () => { const r = sub.result; if (r) saveKeyFile(r.slug, r.name, $('#dKey').textContent); };
$('#dManage').onclick = () => { if (sub.result) openManage(sub.result.slug, 'verify'); };
$('#dCard').onclick = () => { if (sub.result) shareCard(sub.result.slug); };
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
  try { OWNDATA[slug] = await rpc('owner_get', { p_slug: slug, p_key: own.key }); own.name = OWNDATA[slug].name; saveOwned(); if (mSlug === slug) renderManage(); }
  catch (e) { if (errCode(e) === 'bad_key') { delete OWNED[slug]; saveOwned(); closeUI(); toast('That owner key no longer works. Use “Lost your key?” to get a new one.', 5000); } }
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
  if (mTab === 'key') renderKey(o);
}
$('#mTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; mTab = b.dataset.tab; renderManage(); });
async function renderStats(o) {
  const box = $('#mStats');
  if (o.status !== 'approved') { box.replaceChildren(el('p', { class: 'fine', text: 'Stats start counting when your product is live. We count profile views and clicks to your site and demo — once per visitor per day, without cookies, and without your own visits or known bots.' })); return; }
  box.replaceChildren(el('p', { class: 'fine', text: 'Loading…' }));
  let s; try { s = await rpc('owner_stats', { p_slug: mSlug, p_key: OWNED[mSlug].key }); } catch (e) { box.replaceChildren(el('p', { class: 'fine', text: "Couldn't load stats right now." })); return; }
  if (mTab !== 'stats') return;
  const days = s.days || [], sum = k => days.reduce((a, d) => a + (d[k] || 0), 0);
  const views = sum('view'), visits = sum('visit'), demos = sum('demo'), max = Math.max(1, ...days.map(d => d.view || 0), ...days.map(d => (d.visit || 0) + (d.demo || 0)));
  box.replaceChildren(
    el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('b', { text: fmt(views) }), el('small', { text: 'profile views · 30 days' })),
      el('div', { class: 'kpi' }, el('b', { text: fmt(visits) }), el('small', { text: 'clicks to your site' })),
      el('div', { class: 'kpi' }, el('b', { text: fmt(demos) }), el('small', { text: 'demo clicks' })),
      el('div', { class: 'kpi' }, el('b', { text: views ? Math.round((visits + demos) / views * 100) + '%' : '—' }), el('small', { text: 'of viewers clicked through' }))),
    el('div', { class: 'chart', role: 'img', 'aria-label': `Daily profile views and clicks for the last 30 days: ${views} views, ${visits + demos} clicks.` },
      days.map(d => el('div', { class: 'd', title: `${d.d}: ${d.view} views, ${d.visit + d.demo} clicks` }, el('div', { class: 'v', style: `height:${(d.view || 0) / max * 100}%` }), el('div', { class: 'c', style: `height:${((d.visit || 0) + (d.demo || 0)) / max * 100}%` })))),
    el('div', { class: 'chart-legend' }, el('span', null, el('i', { style: 'background:rgba(94,225,255,.55)' }), 'Profile views'), el('span', null, el('i', { style: 'background:var(--lime)' }), 'Clicks')),
    el('p', { class: 'fine', text: 'Unique visitors per day. Counted without cookies; your own visits on days you open this panel and known bots are left out, as far as we can tell.' }));
}
function renderVerify(o) {
  const box = $('#mVerify');
  if (!o.slug) { box.replaceChildren(el('p', { class: 'fine', text: 'Loading…' })); return; }
  if (o.verified_at) { box.replaceChildren(el('div', { class: 'note ok', style: 'margin-top:14px' }, el('b', { text: `✓ ${o.domain} verified on ${dateStr(o.verified_at)}.` }), ' The badge shows on your profile. It proves you control the domain — it is not a rating and it is never sold.')); return; }
  const meta = `<meta name="expanse-verification" content="${o.verify_token}">`;
  const btn = el('button', { class: 'btn btn-primary btn-sm', text: 'Check now', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Checking ' + o.domain + '…';
    const r = await fnCall('verify-domain', { slug: mSlug, key: OWNED[mSlug].key });
    btn.disabled = false; btn.textContent = 'Check now';
    if (r.ok) { toast('Verified! The badge is on your profile.'); o.verified_at = r.verified_at; await refreshAll(); renderManage(); }
    else if (r.reason === 'missing') toast(`We reached ${o.domain} but didn't find the code yet. If you just added it, give it a minute.`, 5500);
    else if (r.reason === 'unreachable') toast(`We couldn't reach https://${o.domain}. Check that the site is up and works over https.`, 5500);
    else if (r.reason === 'slow_down') toast('Give it a few seconds between checks.');
    else toast("Couldn't check right now — try again in a moment.");
  } });
  box.replaceChildren(
    el('p', { class: 'c-text', text: `Prove you control ${o.domain} and your profile gets a verified badge with today's date. Pick one:` }),
    el('div', { class: 'sec' }, el('h4', { class: 'mono', text: 'A · Add a meta tag to your home page' }), el('div', { class: 'codeblock', text: meta }), el('button', { class: 'linkbtn', style: 'margin-top:6px', text: 'Copy tag', onclick: async () => toast((await copy(meta)) ? 'Tag copied — paste it inside <head>.' : 'Select the tag and copy it.') })),
    el('div', { class: 'sec' }, el('h4', { class: 'mono', text: 'B · Or upload a text file' }), el('div', { class: 'codeblock', text: `https://${o.domain}/.well-known/expanse-verification.txt` }), el('small', { class: 'hint', style: 'display:block;color:var(--muted);font-size:12px;margin-top:6px', text: 'containing only: ' + o.verify_token })),
    el('div', { class: 'c-row' }, btn),
    el('p', { class: 'fine', text: 'Verification is free and separate from payment. If you change your website to another domain, you verify again.' }));
}
function renderShare(o) {
  const box = $('#mShare'), live = o.status === 'approved', url = productUrl(mSlug), n = Math.max(0, o.referrals | 0);
  box.replaceChildren(
    el('p', { class: 'c-text', text: live ? 'Your product page:' : 'Your page goes live after review. This will be its link:' }),
    el('div', { class: 'codeblock', text: url }),
    el('div', { class: 'c-row' }, el('button', { class: 'btn btn-primary btn-sm', text: live ? 'Share link ↗' : 'Copy link', onclick: () => shareUrl(url, o.name + ' on Expanse', `${o.name} — ${o.tagline}`, 'Link copied.') }), el('button', { class: 'btn btn-ghost btn-sm', text: 'Share card', onclick: () => shareCard(mSlug) })),
    el('div', { class: 'refs' }, el('b', { text: 'Invite 3 makers → +1 free cell.' }), el('div', { class: 'dots' }, [0, 1, 2].map(i => el('i', { class: i < n ? 'on' : '' }))),
      el('small', { text: n >= 3 ? 'Done — your extra cell is waiting for when placement opens.' : `${n} of 3 makers have added a product after opening your page.` })));
}
function renderKey(o) {
  const key = OWNED[mSlug].key, code = el('code', { text: '•'.repeat(24) });
  let shown = false;
  box_($('#mKey'),
    el('div', { class: 'keybox' }, el('b', { text: 'Owner key' }), code,
      el('div', { class: 'c-row' },
        el('button', { class: 'btn btn-ghost btn-xs', text: 'Show', onclick: e => { shown = !shown; code.textContent = shown ? key : '•'.repeat(24); e.target.textContent = shown ? 'Hide' : 'Show'; } }),
        el('button', { class: 'btn btn-ghost btn-xs', text: 'Copy', onclick: async () => toast((await copy(key)) ? 'Owner key copied.' : 'Couldn’t copy.') }),
        el('button', { class: 'btn btn-ghost btn-xs', text: 'Download', onclick: () => saveKeyFile(mSlug, o.name, key) })),
      el('small', { text: 'Anyone with this key can edit your listing. Contact email on file: ' + (o.email || '—') })),
    el('div', { class: 'c-row' },
      el('button', { class: 'btn btn-ghost btn-sm', text: 'Forget on this device', onclick: () => { delete OWNED[mSlug]; delete OWNDATA[mSlug]; saveOwned(); rebuildItems(); closeUI(); toast('Removed from this browser. Your listing is unchanged.'); } }),
      el('button', { class: 'btn btn-danger btn-sm', text: 'Take listing down', onclick: () => confirmRemove(o) })));
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
const modalFocus = ExpanseUI.dialogs(document);
function openDlg(...kids) {
  fill(dlgBody, ...kids); hideTip();
  const heading = dlgBody.querySelector('h2');
  if (heading) { heading.id = 'dlgTitle'; dlg.setAttribute('aria-labelledby', 'dlgTitle'); dlg.removeAttribute('aria-label'); }
  else { dlg.removeAttribute('aria-labelledby'); dlg.setAttribute('aria-label', 'Product action'); }
  modalFocus.open(dlg, dlgBody.querySelector('input,textarea,button') || dlg.querySelector('.sheet-in'));
}
function closeDlg() { modalFocus.close(dlg); }
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
    el('p', { style: 'margin-top:10px', text: 'Use the owner key you got when you added the product.' }), form,
    el('button', { class: 'linkbtn', style: 'margin-top:14px', text: 'Lost your key?', onclick: () => { const s = slug || slugFrom(slugIn && slugIn.value); if (!isSlug(s)) { toast('First enter your product link or name.'); return; } startRecovery(s, name); } }));
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

/* ================= INFO SHEET ================= */
function openSheet() { hideTip(); modalFocus.open(sheet); }
function closeSheet() { modalFocus.close(sheet); }
$('#infoBtn').onclick = openSheet;
sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('[data-sheet-close]')) closeSheet(); });

/* ================= LIVE: COUNTER + FEED (real data only; demo items are labelled) ================= */
function renderLive() {
  const live = STATS ? STATS.live | 0 : PRODUCTS.length, held = STATS ? STATS.reserved | 0 : 0, left = Math.max(0, FOUNDING_LIMIT - held);
  $('#heroLive').textContent = STATS ? `${fmt(left)} of ${fmt(FOUNDING_LIMIT)} founding spots left` : 'Founding prices for the first 1,000 spots';
  const hc = $('#heroCounts'); hc.replaceChildren();
  if (live) hc.append(el('b', { text: fmt(live) }), live === 1 ? ' product live' : ' products live', ' · listing is ', el('b', { text: 'free' }));
  else hc.append('No products live yet — the first get the ', el('b', { text: 'best spots' }));
  const dock = $('#dockTxt'); dock.replaceChildren(el('b', { text: fmt(left) }), ' founding spots left');
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
updateMine();
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
  if (deepSlug || deepSpot || reduce) { introEl.classList.add('out'); app.classList.add('ready'); }
  else {
    introRunning = true; cam.z = h.z * .07;
    setTimeout(() => { if (introRunning) introEl.classList.add('out'); }, 1500);
    setTimeout(() => { if (!introRunning) return; flyTo(h.x, h.y, h.z, 4200, easeInOut); if (fly) fly.intro = true; }, 900);
    setTimeout(() => { introRunning = false; app.classList.add('ready'); }, 3700);
    introEl.addEventListener('pointerdown', endIntro);
  }
}
kick();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);
(async () => {
  await Promise.all([loadProducts(), loadSpots(), loadOwned()]);
  rebuildItems(); renderLive();
  if (deepSlug) {
    const p = BY_SLUG.get(deepSlug);
    if (p) { const it = ITEMS.find(i => i.slug === deepSlug); app.classList.add('explore'); explored = true; if (it) { cam.x = it.x + it.w / 2; cam.y = it.y + it.h / 2; cam.z = it.size >= 4 ? 1.6 : 2.4; } openProduct(p, { noFly: true }); }
    else if (OWNED[deepSlug]) openManage(deepSlug);
    else { setPath('/'); toast('That product isn’t live yet — it may still be in review.', 4500); }
  } else if (deepSpot) {
    app.classList.add('explore'); explored = true; cam.x = deepSpot.x + 1; cam.y = deepSpot.y + 1; cam.z = 2.4;
    toast('A friend invited you — put your product right next to theirs.', 4500);
  }
})();
loadStats();
setInterval(() => { if (!document.hidden) loadStats(); }, 30000);
setInterval(() => { if (!document.hidden && ui === 'none') refreshAll(); }, 120000);
setTimeout(nextTick, 4400); setInterval(nextTick, 5200);
if (window.requestIdleCallback) requestIdleCallback(() => offsets(), { timeout: 5000 }); else setTimeout(offsets, 2500);
})();

