'use strict';
// GET /api/card?slug=<slug>&v=<version> — the product's 1200x630 share card (PNG) for X and other link previews.
// Only the current version is rendered; any other version redirects to it, so cache-busting parameters cannot
// force repeated renders and a shared link always shows the card as it is now.
const {SITE,isSlug,rpc} = require('../lib/public-pages');
const {cardSvg,renderPng,cardVersion} = require('../lib/og-card');
module.exports = async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  if (!['GET','HEAD'].includes(req.method || 'GET')) { res.setHeader('Allow','GET, HEAD'); res.statusCode = 405; return res.end(); }
  const slug = String(req.query?.slug || '').toLowerCase(), v = String(req.query?.v || '');
  if (!isSlug(slug)) { res.setHeader('Cache-Control','public, max-age=300'); res.statusCode = 404; return res.end(); }
  let p;
  try { p = await rpc('public_product',{p_slug:slug}); } catch { res.setHeader('Cache-Control','no-store'); res.statusCode = 503; return res.end(); }
  if (!p?.name) { res.setHeader('Cache-Control','public, max-age=60, s-maxage=300'); res.statusCode = 404; return res.end(); }
  const current = cardVersion(p);
  if (v !== current) {
    res.setHeader('Cache-Control','public, max-age=60, s-maxage=300');
    res.setHeader('Location',`${SITE}/api/card?slug=${encodeURIComponent(slug)}&v=${current}`);
    res.statusCode = 302; return res.end();
  }
  let png;
  try { png = renderPng(cardSvg(p)); } catch { res.setHeader('Cache-Control','no-store'); res.statusCode = 500; return res.end(); }
  res.setHeader('Content-Type','image/png');
  res.setHeader('Content-Length',String(png.length));
  res.setHeader('Cache-Control','public, max-age=86400, s-maxage=31536000, immutable');
  res.statusCode = 200;
  return res.end(req.method === 'HEAD' ? undefined : png);
};
