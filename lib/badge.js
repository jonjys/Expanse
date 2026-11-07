'use strict';
// "Live on Expanse" badge for makers' own sites: an SVG that links back to the product page and shows its upvotes.
// It renders in an <img> on any site, so it uses a common font stack instead of web fonts.
const xml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const W = 230, H = 54;
function badgeSvg(p, theme) {
  const light = theme === 'light';
  const bg = light ? '#ffffff' : '#070b24', border = light ? '#d7dcf0' : '#2a3170', ink = light ? '#0b1030' : '#ffffff', muted = light ? '#5a6390' : '#9aa6dc';
  const upvotes = Number.isFinite(+p.upvotes) ? Math.max(0, Math.floor(+p.upvotes)) : 0;
  // Fixed size: the embed snippet declares 230x54 and is pasted once, so the badge must not resize as votes grow.
  const count = upvotes > 999999 ? Math.floor(upvotes / 1e6) + 'm' : upvotes > 9999 ? Math.floor(upvotes / 1000) + 'k' : String(upvotes);
  const w = W, pillW = 64, pillX = w - pillW - 12, inner = 16 + count.length * 8, ix = Math.round(pillX + (pillW - inner) / 2);
  const font = "'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="54" viewBox="0 0 ${w} 54" role="img" aria-label="${xml(p.name)} is live on Expanse with ${upvotes} upvotes">
<title>${xml(p.name)} on Expanse</title>
<rect x="1" y="1" width="${w - 2}" height="52" rx="12" fill="${bg}" stroke="${border}" stroke-width="2"/>
<defs><radialGradient id="o" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#c8ff3d"/><stop offset=".55" stop-color="#5ee1ff"/><stop offset="1" stop-color="#3b5bff"/></radialGradient></defs>
<circle cx="29" cy="27" r="12" fill="url(#o)"/>
<text x="51" y="22" font-family="${font}" font-size="10" font-weight="700" letter-spacing="1.6" fill="${muted}">LIVE ON</text>
<text x="51" y="41" font-family="${font}" font-size="19" font-weight="700" letter-spacing="-.4" fill="${ink}">Expanse</text>
<rect x="${pillX}" y="14" width="${pillW}" height="26" rx="13" fill="${light ? '#eef9cf' : 'rgba(200,255,61,.12)'}" stroke="${light ? '#a8d42a' : '#c8ff3d'}" stroke-opacity=".7"/>
<path d="M${ix} 32 L${ix + 5} 23 L${ix + 10} 32 Z" fill="${light ? '#5b7a00' : '#c8ff3d'}"/>
<text x="${ix + 16}" y="32" font-family="${font}" font-size="13" font-weight="700" fill="${light ? '#3c5200' : '#c8ff3d'}">${xml(count)}</text>
</svg>`;
}
// The same frame without a claim: shown while the product is not public (in review, hidden, removed) or the catalog
// cannot be read, so a maker's site shows the Expanse mark instead of a broken image.
function neutralBadgeSvg(theme) {
  const light = theme === 'light';
  const bg = light ? '#ffffff' : '#070b24', border = light ? '#d7dcf0' : '#2a3170', ink = light ? '#0b1030' : '#ffffff';
  const font = "'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Expanse">
<title>Expanse</title>
<rect x="1" y="1" width="${W - 2}" height="52" rx="12" fill="${bg}" stroke="${border}" stroke-width="2"/>
<defs><radialGradient id="o" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#c8ff3d"/><stop offset=".55" stop-color="#5ee1ff"/><stop offset="1" stop-color="#3b5bff"/></radialGradient></defs>
<circle cx="29" cy="27" r="12" fill="url(#o)"/>
<text x="51" y="34" font-family="${font}" font-size="19" font-weight="700" letter-spacing="-.4" fill="${ink}">Expanse</text>
</svg>`;
}
module.exports = {badgeSvg, neutralBadgeSvg, W, H};
