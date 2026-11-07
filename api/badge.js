'use strict';
// GET /api/badge?slug=<slug>&theme=dark|light — "Live on Expanse" badge (SVG) with the product's upvotes. A product
// that is not public right now (in review after an edit, hidden, removed) or a catalog outage gets the neutral badge,
// briefly cached, so the maker's site never shows a broken image; only a malformed slug is a 404.
const {isSlug,rpc} = require('../lib/public-pages');
const {badgeSvg,neutralBadgeSvg} = require('../lib/badge');
module.exports = async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
  if (!['GET','HEAD'].includes(req.method || 'GET')) { res.setHeader('Allow','GET, HEAD'); res.statusCode = 405; return res.end(); }
  const slug = String(req.query?.slug || '').toLowerCase(), theme = req.query?.theme === 'light' ? 'light' : 'dark';
  if (!isSlug(slug)) { res.setHeader('Cache-Control','public, max-age=300'); res.statusCode = 404; return res.end(); }
  let p, cache = 'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400';
  try { p = await rpc('public_product',{p_slug:slug}); } catch (e) { console.error('badge_catalog_unavailable', slug, e && e.message); p = undefined; cache = 'no-store'; }
  if (p !== undefined && !p?.name) cache = 'public, max-age=60, s-maxage=300';
  const svg = p?.name ? badgeSvg(p, theme) : neutralBadgeSvg(theme);
  res.setHeader('Content-Type','image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control',cache);
  res.statusCode = 200;
  return res.end(req.method === 'HEAD' ? undefined : svg);
};
