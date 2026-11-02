'use strict';
// GET /api/badge?slug=<slug>&theme=dark|light — "Live on Expanse" badge (SVG) with the product's upvotes.
const {isSlug,rpc} = require('../lib/public-pages');
const {badgeSvg} = require('../lib/badge');
module.exports = async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
  if (!['GET','HEAD'].includes(req.method || 'GET')) { res.setHeader('Allow','GET, HEAD'); res.statusCode = 405; return res.end(); }
  const slug = String(req.query?.slug || '').toLowerCase(), theme = req.query?.theme === 'light' ? 'light' : 'dark';
  if (!isSlug(slug)) { res.setHeader('Cache-Control','public, max-age=300'); res.statusCode = 404; return res.end(); }
  let p;
  try { p = await rpc('public_product',{p_slug:slug}); } catch { res.setHeader('Cache-Control','no-store'); res.statusCode = 503; return res.end(); }
  if (!p?.name) { res.setHeader('Cache-Control','public, max-age=60, s-maxage=300'); res.statusCode = 404; return res.end(); }
  const svg = badgeSvg(p, theme);
  res.setHeader('Content-Type','image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control','public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400');
  res.statusCode = 200;
  return res.end(req.method === 'HEAD' ? undefined : svg);
};
