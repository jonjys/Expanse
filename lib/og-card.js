'use strict';
// Share cards for X and other link previews: a 1200x630 PNG per product, drawn from public profile fields only,
// with the product's real position in the galaxy. Fonts are bundled (fonts/ttf) because serverless runtimes have
// none; system fonts are never loaded, so the card looks the same everywhere.
const path = require('node:path');
const {SITE} = require('./public-pages');

const W = 1200, H = 630;
const CATS = {
  productivity: ['Productivity', '#c8ff3d'], developer: ['Developer tools', '#5ee1ff'], design: ['Design', '#ff5c7a'],
  marketing: ['Marketing & sales', '#ffcf4a'], finance: ['Finance & admin', '#3dff8a'], ai: ['AI', '#b39cff'],
  commerce: ['E-commerce', '#ff9f43'], education: ['Education', '#7aa8ff'], health: ['Health & wellbeing', '#ff7ad9'],
  other: ['Other', '#c3caf0'],
};
const ZONES = {inner: 'Inner ring', belt: 'Belt', outer: 'Outer rim', edge: 'Edge', core: 'Spotlight'};
// Zone radii in map cells; keep in sync with ZONES in app.js and zone_of() in Supabase.
const RINGS = [14, 40, 80, 125];
const MAP_R = 175;

const xml = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// Width estimate in em for Instrument Sans: enough to wrap and fit lines without a text-layout engine.
function em(s) {
  let w = 0;
  for (const c of s) w += /[A-Z0-9@#%&WM]/.test(c) ? .66 : /[mw]/.test(c) ? .78 : /[il.,:;'!|]/.test(c) ? .26 : c === ' ' ? .26 : .54;
  return w;
}
// Greedy word wrap by estimated width; a single word wider than a line is cut with an ellipsis.
function wrap(text, size, width, maxLines) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = []; let line = '';
  const fit = w => { while (w.length > 1 && em(w) * size > width) w = w.slice(0, -2) + '…'; return w; };
  for (const raw of words) {
    const word = fit(raw);
    const next = line ? line + ' ' + word : word;
    if (em(next) * size <= width) { line = next; continue; }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && em(last + '…') * size > width) last = last.slice(0, -1);
    lines[maxLines - 1] = last.replace(/[\s,.;:–—-]+$/, '') + '…';
  }
  return lines;
}

// Deterministic star field along two spiral arms, so every card shows the same galaxy.
function stars() {
  let seed = 20261102; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < 700; i++) {
    const arm = i % 2, r = (.08 + .92 * Math.pow(rnd(), .85)) * MAP_R, a = arm * Math.PI + r / 46 + (rnd() - .5) * (.35 + r / MAP_R * .5);
    out.push([Math.cos(a) * r, Math.sin(a) * r, rnd() * 1.6 + .35, rnd() * .7 + .25]);
  }
  for (let i = 0; i < 140; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * MAP_R; out.push([Math.cos(a) * r, Math.sin(a) * r, rnd() * 1.1 + .3, rnd() * .45 + .15]); }
  return out;
}
const STARS = stars();

function cardSvg(p) {
  const [catLabel, catColor] = CATS[p.category] || CATS.other;
  const slug = String(p.slug || '');
  const zone = ZONES[p.zone] || '';
  const size = [1, 2, 4, 8].includes(p.size) ? p.size : 1;
  const upvotes = Number.isFinite(+p.upvotes) ? Math.max(0, Math.floor(+p.upvotes)) : 0;
  // Galaxy panel on the right: map cells scaled into a circle.
  const cx = 940, cy = 315, R = 232, k = R / MAP_R;
  const px = Number.isFinite(+p.x) ? +p.x : 0, py = Number.isFinite(+p.y) ? +p.y : 0;
  const sx = cx + (px + size / 2) * k, sy = cy + (py + size / 2) * k, sq = Math.max(14, size * k * 1.6);
  const starDots = STARS.map(([x, y, r, o]) => `<circle cx="${(cx + x * k).toFixed(1)}" cy="${(cy + y * k).toFixed(1)}" r="${r.toFixed(2)}" fill="#dfe6ff" opacity="${o.toFixed(2)}"/>`).join('');
  const rings = RINGS.map(r => `<circle cx="${cx}" cy="${cy}" r="${(r * k).toFixed(1)}" fill="none" stroke="#8fa2ff" stroke-opacity=".16" stroke-dasharray="3 7"/>`).join('');

  const TEXT_W = 590;
  const nameSize = em(p.name || '') * 76 > TEXT_W ? (em(p.name || '') * 62 > TEXT_W ? 52 : 62) : 76;
  const name = wrap(p.name, nameSize, TEXT_W, 2);
  const tagline = wrap(p.tagline, 31, TEXT_W, name.length > 1 ? 2 : 3);
  let y = 186 + Math.round(nameSize * .78);
  const nameText = name.map((l, i) => `<text x="80" y="${y + i * nameSize * 1.02}" font-family="Instrument Sans" font-weight="700" font-size="${nameSize}" letter-spacing="-2" fill="#ffffff">${xml(l)}</text>`).join('');
  y += (name.length - 1) * nameSize * 1.02 + 60;
  const tagText = tagline.map((l, i) => `<text x="80" y="${y + i * 42}" font-family="Instrument Sans" font-weight="500" font-size="31" fill="#c3cbec">${xml(l)}</text>`).join('');

  const chips = [];
  let chipX = 80;
  // Icons are drawn as shapes: the bundled Latin fonts have no ▲ or ✓ glyphs.
  const ICONS = {
    up: (x, c) => `<path d="M${x} 501 L${x + 8} 486 L${x + 16} 501 Z" fill="${c}"/>`,
    check: (x, c) => `<path d="M${x} 493 L${x + 6} 499 L${x + 17} 486" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  };
  const chip = (text, color, fill, icon) => {
    const iw = icon ? 26 : 0, w = Math.round(em(text) * 22 + 44 + iw);
    if (chipX + w > 80 + TEXT_W + 40) return;
    chips.push(`<rect x="${chipX}" y="470" width="${w}" height="46" rx="23" fill="${fill}" stroke="${color}" stroke-opacity=".55"/>${icon ? ICONS[icon](chipX + 20, color) : ''}<text x="${chipX + 22 + iw}" y="501" font-family="Instrument Sans" font-weight="700" font-size="22" fill="${color}">${xml(text)}</text>`);
    chipX += w + 12;
  };
  chip(`${upvotes} ${upvotes === 1 ? 'upvote' : 'upvotes'}`, '#c8ff3d', 'rgba(200,255,61,.10)', 'up');
  if (p.verified_at) chip('Verified domain', '#ffffff', 'rgba(255,255,255,.06)', 'check');
  if (zone) chip(`${zone} · ${size}×${size}`, '#5ee1ff', 'rgba(94,225,255,.08)');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="bg" cx="72%" cy="45%" r="75%"><stop offset="0" stop-color="#18246a"/><stop offset=".5" stop-color="#080c2e"/><stop offset="1" stop-color="#02030c"/></radialGradient>
<radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#bfe8ff" stop-opacity=".55"/><stop offset=".45" stop-color="#5ea0ff" stop-opacity=".18"/><stop offset="1" stop-color="#5ea0ff" stop-opacity="0"/></radialGradient>
<radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${catColor}" stop-opacity=".75"/><stop offset="1" stop-color="${catColor}" stop-opacity="0"/></radialGradient>
<linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#02030c" stop-opacity=".92"/><stop offset=".55" stop-color="#02030c" stop-opacity=".55"/><stop offset="1" stop-color="#02030c" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<circle cx="${cx}" cy="${cy}" r="120" fill="url(#core)"/>
${rings}${starDots}
<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(sq * 2.6).toFixed(1)}" fill="url(#glow)"/>
<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(sq * 1.25).toFixed(1)}" fill="none" stroke="${catColor}" stroke-width="2" stroke-opacity=".8"/>
<rect x="${(sx - sq / 2).toFixed(1)}" y="${(sy - sq / 2).toFixed(1)}" width="${sq.toFixed(1)}" height="${sq.toFixed(1)}" rx="${(sq / 5).toFixed(1)}" fill="${catColor}"/>
<rect x="0" y="0" width="760" height="${H}" fill="url(#fade)"/>
<circle cx="96" cy="104" r="15" fill="#5ee1ff"/><circle cx="91" cy="99" r="7" fill="#c8ff3d" opacity=".9"/>
<text x="124" y="114" font-family="IBM Plex Mono SemiBold" font-size="26" letter-spacing="5" fill="#c8ff3d">EXPANSE</text>
<text x="80" y="160" font-family="IBM Plex Mono SemiBold" font-size="20" letter-spacing="3" fill="${catColor}">${xml(catLabel.toUpperCase())}</text>
${nameText}
${tagText}
${chips.join('')}
<text x="80" y="574" font-family="IBM Plex Mono SemiBold" font-size="22" letter-spacing="1" fill="#8f9ad0">${xml((u => u.length > 46 ? u.slice(0, 45) + '…' : u)(SITE.replace(/^https:\/\//, '') + '/p/' + slug))}</text>
</svg>`;
}

const FONT_DIR = path.join(__dirname, '..', 'fonts', 'ttf');
let Resvg;
function renderPng(svg) {
  if (!Resvg) ({Resvg} = require('@resvg/resvg-js'));
  const r = new Resvg(svg, {fitTo: {mode: 'width', value: W}, font: {loadSystemFonts: false, defaultFontFamily: 'Instrument Sans',
    fontFiles: ['instrument-sans-700.ttf', 'instrument-sans-500.ttf', 'ibm-plex-mono-600.ttf'].map(f => path.join(FONT_DIR, f))}});
  return r.render().asPng();
}

// Changes whenever something on the card changes, so a shared link gets a fresh image instead of a cached old one.
function cardVersion(p) {
  const s = [p.name, p.tagline, p.category, p.x, p.y, p.size, p.zone, p.upvotes, p.verified_at ? 1 : 0].join('|');
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
const cardUrl = p => `${SITE}/api/card?slug=${encodeURIComponent(p.slug)}&v=${cardVersion(p)}`;

module.exports = {cardSvg, renderPng, cardVersion, cardUrl, wrap, W, H};
