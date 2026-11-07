'use strict';
// Share cards for X and other link previews: a 1200x630 PNG per product, drawn from public profile fields only,
// with the product's real position in the galaxy. Fonts are bundled (fonts/ttf) because serverless runtimes have
// none; system fonts are never loaded, so the card looks the same everywhere. Instrument Sans covers Latin; a line
// it cannot draw is set in Noto Sans (Latin, Greek, Cyrillic, Vietnamese); symbols such as ✓ ● ≥ → come from Noto
// Sans Symbols 2 and Noto Sans Math. Text with anything no bundled font has gets no card (cardSupported), because
// the renderer silently skips missing glyphs and the card would say something else.
// Text is measured with the fonts' real advance widths, so lines wrap, sizes are chosen and chips are sized the way
// the renderer will actually draw them.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
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
// The text column runs from x=80 to 670, clear of the galaxy (its outer stars reach x≈708 at mid-height). At the
// chips' height the galaxy's edge is at x≈768, so the chip row may run to 740.
const TEXT_X = 80, TEXT_W = 590, CHIP_END = 740;

const xml = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const thousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---- Fonts ----------------------------------------------------------------------------------------------------
const FONT_DIR = path.join(__dirname, '..', 'fonts', 'ttf');
// Faces by family and weight. The order of FONT_FILES is also the order the renderer searches for a glyph a line's
// own font lacks, so measuring follows the same fallback.
const FACES = {
  'Instrument Sans': {700: 'instrument-sans-700.ttf', 500: 'instrument-sans-500.ttf'},
  'IBM Plex Mono SemiBold': {600: 'ibm-plex-mono-600.ttf'},
  'Noto Sans': {700: 'noto-sans-700.ttf', 500: 'noto-sans-500.ttf'},
};
const SYMBOL_FILES = ['noto-sans-symbols-2.ttf', 'noto-sans-math.ttf'];
const FONT_FILES = [...Object.values(FACES).flatMap(f => Object.values(f)), ...SYMBOL_FILES];

// Reads a TrueType font's cmap (formats 4 and 12, the ones these fonts use) and horizontal metrics.
function loadFont(file) {
  const b = fs.readFileSync(file), tables = {};
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) tables[b.toString('latin1', 12 + i * 16, 16 + i * 16)] = b.readUInt32BE(20 + i * 16);
  const glyphs = new Map(), cmap = tables.cmap;
  for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
    const platform = b.readUInt16BE(cmap + 4 + i * 8), encoding = b.readUInt16BE(cmap + 6 + i * 8), at = cmap + b.readUInt32BE(cmap + 8 + i * 8);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = b.readUInt16BE(at);
    if (format === 12) {
      for (let g = 0, groups = b.readUInt32BE(at + 12); g < groups; g++) {
        const o = at + 16 + g * 12, start = b.readUInt32BE(o), end = b.readUInt32BE(o + 4), first = b.readUInt32BE(o + 8);
        for (let c = start; c <= end; c++) if (first + c - start) glyphs.set(c, first + c - start);
      }
    } else if (format === 4) {
      const n = b.readUInt16BE(at + 6) / 2, ends = at + 14, starts = ends + n * 2 + 2, deltas = starts + n * 2, ranges = deltas + n * 2;
      for (let k = 0; k < n; k++) {
        const end = b.readUInt16BE(ends + k * 2), start = b.readUInt16BE(starts + k * 2), delta = b.readInt16BE(deltas + k * 2), range = b.readUInt16BE(ranges + k * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph = range ? b.readUInt16BE(ranges + k * 2 + range + (c - start) * 2) : c + delta;
          if (range && glyph) glyph += delta;
          if (glyph & 0xffff) glyphs.set(c, glyph & 0xffff);
        }
      }
    }
  }
  const upm = b.readUInt16BE(tables.head + 18), metrics = b.readUInt16BE(tables.hhea + 34), hmtx = tables.hmtx;
  const advance = gid => b.readUInt16BE(hmtx + Math.min(gid, metrics - 1) * 4) / upm;
  return {glyphs, advance};
}
let LOADED;
const fonts = () => LOADED || (LOADED = Object.fromEntries(FONT_FILES.map(f => [f, loadFont(path.join(FONT_DIR, f))])));
const codepoints = file => new Set(loadFont(file).glyphs.keys());
let COVER;
function cover() {
  if (COVER) return COVER;
  const f = fonts(), both = family => { const [a, b] = Object.values(FACES[family]).map(x => f[x].glyphs); return new Set([...a.keys()].filter(c => b.has(c))); };
  return COVER = {sans: both('Instrument Sans'), noto: both('Noto Sans'), symbols: new Set(SYMBOL_FILES.flatMap(x => [...f[x].glyphs.keys()]))};
}
// Width in px of a line as the renderer sets it: the line's own face, else the first face that has the glyph.
function measure(text, family, weight, size, spacing = 0) {
  const f = fonts(), own = f[FACES[family][weight] || Object.values(FACES[family])[0]];
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0), face = own.glyphs.has(c) ? own : FONT_FILES.map(x => f[x]).find(x => x.glyphs.has(c)) || own;
    w += face.advance(face.glyphs.get(c) || 0) * size + spacing;
  }
  return w;
}
let LOGGED = false;
// Resolves whether the fonts can be read, logging the cause once: a missing font must not fail silently.
function fontsReady() {
  try { cover(); return true; }
  catch (e) { if (!LOGGED) { LOGGED = true; console.error('og_card_fonts_unreadable', e && e.message); } return false; }
}

// Text as it can be drawn. Only emoji and invisible formatting characters are left out (decoration, or nothing to
// see); hyphen variants become the hyphen they look like. Every other character is kept, so text with anything the
// fonts cannot draw (a CJK word, an uncommon symbol) gets no card instead of a card that says something else.
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}︎️⃣]/u;
const FOLD = {'‐': '-', '‑': '-', '‒': '–', '―': '—'};
function drawable(value) {
  const {sans, noto, symbols} = cover(), has = c => sans.has(c) || noto.has(c) || symbols.has(c);
  const text = String(value ?? '').normalize('NFC').replace(/[‐-‒―]/g, c => FOLD[c]).replace(/\s+/g, ' ')
    .replace(/[^\s]/gu, ch => /\p{Cf}/u.test(ch) ? '' : has(ch.codePointAt(0)) || !EMOJI.test(ch) ? ch : '')
    .replace(/ {2,}/g, ' ').trim();
  const cps = [...text].map(ch => ch.codePointAt(0));
  // Symbols, and the few glyphs only Instrument Sans has in a Noto line (arrows, ‰), come from the fallback faces.
  const family = cps.every(c => sans.has(c) || symbols.has(c)) ? 'Instrument Sans' : cps.every(has) ? 'Noto Sans' : null;
  return {text, family};
}
// False, never an exception, if the fonts cannot be read: the page then keeps its other share image.
function cardSupported(p) {
  if (!fontsReady()) return false;
  const name = drawable(p?.name), tagline = drawable(p?.tagline);
  return !!(name.family && name.text && tagline.family);
}

// Greedy word wrap by measured width; a word wider than a line is cut, and text that does not fit in maxLines ends
// with an ellipsis. `fits` tells whether everything fitted without cutting.
function layout(text, maxLines, width, m) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = []; let line = '', cut = false, placed = 0;
  const fit = w => { if (m(w) <= width) return w; cut = true; while (w.length > 1 && m(w + '…') > width) w = [...w].slice(0, -1).join(''); return w + '…'; };
  for (const raw of words) {
    const word = fit(raw), next = line ? line + ' ' + word : word;
    if (m(next) <= width) { line = next; placed++; continue; }
    if (line) lines.push(line);
    if (lines.length === maxLines) { line = ''; break; }
    line = word; placed++;
  }
  if (line && lines.length < maxLines) lines.push(line);
  // Words left over: the last line ends with an ellipsis.
  if (placed < words.length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && m(last + '…') > width) last = [...last].slice(0, -1).join('');
    lines[maxLines - 1] = last.replace(/[\s,.;:–—-]+$/, '') + '…';
    cut = true;
  }
  return {lines, fits: !cut};
}
const wrap = (text, size, width, maxLines, family = 'Instrument Sans', weight = 500) => layout(text, maxLines, width, s => measure(s, family, weight, size)).lines;

// The largest name size that shows the whole name: one line at 76 or 62, else two lines at 52 or 46.
function nameLayout(n) {
  const spacing = n.family === 'Noto Sans' ? -1 : -2, m = size => s => measure(s, n.family, 700, size, spacing);
  for (const [size, lines] of [[76, 1], [62, 1], [52, 2], [46, 2]]) {
    const l = layout(n.text, lines, TEXT_W, m(size));
    if (l.fits) return {size, spacing, lines: l.lines};
  }
  return {size: 46, spacing, lines: layout(n.text, 2, TEXT_W, m(46)).lines};
}

function cardSvg(p) {
  const [catLabel, catColor] = CATS[p.category] || CATS.other;
  const zone = ZONES[p.zone] || '';
  const size = [1, 2, 4, 8].includes(p.size) ? p.size : 1;
  const upvotes = Number.isFinite(+p.upvotes) ? Math.max(0, Math.floor(+p.upvotes)) : 0;
  // Galaxy panel on the right: map cells scaled into a circle.
  const cx = 940, cy = 315, R = 232, k = R / MAP_R;
  const px = Number.isFinite(+p.x) ? +p.x : 0, py = Number.isFinite(+p.y) ? +p.y : 0;
  const sx = cx + (px + size / 2) * k, sy = cy + (py + size / 2) * k, sq = Math.max(14, size * k * 1.6);
  const starDots = STARS.map(([x, y, r, o]) => `<circle cx="${(cx + x * k).toFixed(1)}" cy="${(cy + y * k).toFixed(1)}" r="${r.toFixed(2)}" fill="#dfe6ff" opacity="${o.toFixed(2)}"/>`).join('');
  const rings = RINGS.map(r => `<circle cx="${cx}" cy="${cy}" r="${(r * k).toFixed(1)}" fill="none" stroke="#8fa2ff" stroke-opacity=".16" stroke-dasharray="3 7"/>`).join('');

  const n = drawable(p.name), t = drawable(p.tagline);
  n.family ||= 'Instrument Sans'; t.family ||= 'Instrument Sans';
  const name = nameLayout(n), lineGap = Math.round(name.size * 1.12);
  let y = 186 + Math.round(name.size * .78);
  const nameText = name.lines.map((l, i) => `<text x="${TEXT_X}" y="${y + i * lineGap}" font-family="${n.family}" font-weight="700" font-size="${name.size}" letter-spacing="${name.spacing}" fill="#ffffff">${xml(l)}</text>`).join('');
  y += (name.lines.length - 1) * lineGap + 60;
  // As many tagline lines (up to three) as fit above the chips.
  const tagLines = Math.max(1, Math.min(3, Math.floor((452 - y) / 42) + 1));
  const tagline = wrap(t.text, 31, TEXT_W, tagLines, t.family, 500);
  const tagText = tagline.map((l, i) => `<text x="${TEXT_X}" y="${y + i * 42}" font-family="${t.family}" font-weight="500" font-size="31" fill="#c3cbec">${xml(l)}</text>`).join('');

  // Chips sized from the measured label; a chip that does not fit tries its shorter label, then is left out.
  const chips = [];
  let chipX = TEXT_X;
  const ICONS = {
    up: (x, c) => `<path d="M${x} 501 L${x + 8} 486 L${x + 16} 501 Z" fill="${c}"/>`,
    check: (x, c) => `<path d="M${x} 493 L${x + 6} 499 L${x + 17} 486" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  };
  const chip = (labels, color, fill, icon) => {
    const iw = icon ? 26 : 0;
    for (const text of labels) {
      const w = Math.round(measure(text, 'Instrument Sans', 700, 22) + 44 + iw);
      if (chipX + w > CHIP_END) continue;
      chips.push(`<rect x="${chipX}" y="470" width="${w}" height="46" rx="23" fill="${fill}" stroke="${color}" stroke-opacity=".55"/>${icon ? ICONS[icon](chipX + 20, color) : ''}<text x="${chipX + 22 + iw}" y="501" font-family="Instrument Sans" font-weight="700" font-size="22" fill="${color}">${xml(text)}</text>`);
      chipX += w + 12;
      return;
    }
  };
  // A new product's card should not advertise zero votes; the count is refreshed whenever the cached card expires.
  if (upvotes) chip([`${thousands(upvotes)} ${upvotes === 1 ? 'upvote' : 'upvotes'}`], '#c8ff3d', 'rgba(200,255,61,.10)', 'up');
  // Verification means domain ownership, so the card says so rather than a bare "Verified".
  if (p.verified_at) chip(['Verified domain'], '#ffffff', 'rgba(255,255,255,.06)', 'check');
  if (zone) chip([`${zone} · ${size}×${size}`, zone], '#5ee1ff', 'rgba(94,225,255,.08)');

  // Nothing is drawn below the chips: X lays the link's domain over the bottom-left corner of the image.
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
<text x="${TEXT_X}" y="160" font-family="IBM Plex Mono SemiBold" font-size="20" letter-spacing="3" fill="${catColor}">${xml(catLabel.toUpperCase())}</text>
${nameText}
${tagText}
${chips.join('')}
</svg>`;
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

let Resvg;
function render(svg) {
  if (!Resvg) ({Resvg} = require('@resvg/resvg-js'));
  return new Resvg(svg, {fitTo: {mode: 'width', value: W}, font: {loadSystemFonts: false, defaultFontFamily: 'Instrument Sans',
    fontFiles: FONT_FILES.map(f => path.join(FONT_DIR, f))}}).render();
}
// resvg writes RGBA, but the card is fully opaque: an RGB PNG (Up filter) is pixel-identical and about 40% smaller,
// which keeps it well under the ~300 KB at which WhatsApp is widely reported to drop link-preview images.
const CRC = Array.from({length: 256}, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function rgbPng({width: w, height: h, pixels: px}) {
  const row = w * 3 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0, s = 0; y < h; y++) {
    let d = y * row; raw[d++] = 2;
    for (let x = 0; x < w; x++, s += 4) for (let c = 0; c < 3; c++) raw[d++] = (px[s + c] - (y ? px[s + c - w * 4] : 0)) & 0xff;
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const renderPng = svg => rgbPng(render(svg));

// Changes whenever the text, category, position or verification on the card changes, so a shared link gets a fresh
// image instead of X's cached old one. Upvotes are left out on purpose: a version that moved with every vote would
// make crawlers holding a slightly older page meet a redirect instead of the image. Bump DESIGN when the drawing changes.
const DESIGN = 3;
function cardVersion(p) {
  const s = [DESIGN, p.name, p.tagline, p.category, p.x, p.y, p.size, p.zone, p.verified_at ? 1 : 0].join('|');
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
const cardUrl = p => `${SITE}/api/card?slug=${encodeURIComponent(p.slug)}&v=${cardVersion(p)}`;

module.exports = {cardSvg, render, renderPng, cardVersion, cardUrl, cardSupported, fontsReady, drawable, measure, codepoints, wrap, FONT_FILES, W, H};
