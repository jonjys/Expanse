// Serves /p/<slug> (rewritten here by vercel.json): the normal single-page app, with the product's
// own title, description and share image in the <head> so links unfurl nicely and search engines
// see the product. Anything unexpected falls back to the unchanged page; the app then shows the
// product itself, or "not live yet".
const fs = require('fs');
const path = require('path');

const SUPA = 'https://gjmkhnrgznorxxaemsmo.supabase.co';
const KEY = 'sb_publishable_b1uzRroOaHTGp9oXOhHjtQ_J-A-IUCZ'; // public by design, same as in app.js

let HTML = null;
function page() {
  if (HTML) return HTML;
  for (const p of [path.join(process.cwd(), 'index.html'), path.join(__dirname, '..', 'index.html')]) {
    try { HTML = fs.readFileSync(p, 'utf8'); return HTML; } catch (e) { /* try the next location */ }
  }
  return null;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setMeta = (html, attr, name, value) =>
  html.replace(new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`), (m, a, b) => a + esc(value) + b);

async function product(slug) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(SUPA + '/rest/v1/rpc/public_product', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }),
      signal: ctl.signal,
    });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function withProduct(html, p, url) {
  const title = `${p.name} — ${p.tagline} · Expanse`;
  const desc = (`${p.tagline}. Solves: ${(p.needs || []).join(', ')}. ${p.description || ''}`).replace(/\s+/g, ' ').slice(0, 220);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = setMeta(html, 'name', 'description', desc);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', desc);
  html = setMeta(html, 'property', 'og:url', url);
  const img = (p.images || []).find(i => /^https:\/\//.test(i));
  if (img) {
    html = setMeta(html, 'property', 'og:image', img);
    html = html.replace(/\s*<meta property="og:image:(width|height)" content="\d+">/g, '');
  }
  return html.replace('<meta name="twitter:card"', `<link rel="canonical" href="${esc(url)}">\n<meta name="twitter:card"`);
}

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.slug) || '').toLowerCase();
  let html = page();
  if (!html) {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    return res.end();
  }
  if (/^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/.test(slug)) {
    const p = await product(slug);
    if (p && p.name) {
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'expanse-inky.vercel.app').replace(/[^a-z0-9.:-]/gi, '');
      html = withProduct(html, p, `https://${host}/p/${slug}`);
    }
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  res.end(html);
};

module.exports.withProduct = withProduct;
