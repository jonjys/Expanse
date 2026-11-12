'use strict';
// GET /api/card?slug=<slug>&v=<version> — the product's 1200x630 share card (PNG) for X and other link previews.
// Only the exact canonical URL of the current version is rendered. Any other spelling (a stale v, extra or reordered
// parameters, an upper-case slug) redirects to it without rendering, so cache-busting URLs cannot force renders or
// fill the CDN with copies: each product has one cached card per version.
const {SITE,isSlug,rpc} = require('../lib/public-pages');
const {cardSvg,renderPng,cardVersion,cardUrl,cardSupported,fontsReady} = require('../lib/og-card');
module.exports = async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  if (!['GET','HEAD'].includes(req.method || 'GET')) { res.setHeader('Allow','GET, HEAD'); res.statusCode = 405; return res.end(); }
  const slug = String(req.query?.slug || '').toLowerCase();
  if (!isSlug(slug)) { res.setHeader('Cache-Control','public, max-age=300'); res.statusCode = 404; return res.end(); }
  let p;
  try { p = await rpc('public_product',{p_slug:slug}); } catch (e) { console.error('card_catalog_unavailable', slug, e && e.message); res.setHeader('Cache-Control','no-store'); res.statusCode = 503; return res.end(); }
  // Unreadable fonts are a deploy fault, not an unsupported name: never cache it as "no card" (fontsReady logs it).
  if (!fontsReady()) { res.setHeader('Cache-Control','no-store'); res.statusCode = 500; return res.end(); }
  // No card for a hidden product, or for a name in a script the bundled fonts cannot draw (its page keeps the
  // maker's image or the site image instead, see api/p.js).
  if (!p?.name || !cardSupported(p)) { res.setHeader('Cache-Control','public, max-age=60, s-maxage=300'); res.statusCode = 404; return res.end(); }
  const canonical = cardUrl(p);
  let search = null;
  try { search = new URL(req.url || '', SITE).search; } catch { /* treated as not canonical */ }
  if (search !== new URL(canonical).search) {
    // Never cached: a version can come back (an edit undone), and a cached redirect could then point in a circle.
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Location',canonical);
    res.statusCode = 302; return res.end();
  }
  let png;
  try { png = renderPng(cardSvg(p)); } catch (e) { console.error('card_render_failed', slug, e && e.message); res.setHeader('Cache-Control','no-store'); res.statusCode = 500; return res.end(); }
  res.setHeader('Content-Type','image/png');
  res.setHeader('Content-Length',String(png.length));
  // Bounded rather than immutable: the vote count on the card refreshes, and a product that is hidden or removed
  // loses its card within a day instead of keeping it in the CDN until the next deploy.
  res.setHeader('Cache-Control','public, max-age=3600, s-maxage=86400');
  res.statusCode = 200;
  return res.end(req.method === 'HEAD' ? undefined : png);
};
