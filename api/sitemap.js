// Serves /sitemap.xml (rewritten here by vercel.json): the home page plus one page per live product, so search
// engines find every product page. Falls back to just the home page if Supabase doesn't answer in time.
const SUPA = 'https://gjmkhnrgznorxxaemsmo.supabase.co';
const KEY = 'sb_publishable_b1uzRroOaHTGp9oXOhHjtQ_J-A-IUCZ'; // public by design, same as in app.js
const SITE = 'https://expanse.nyttolabs.com';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const day = iso => { const t = Date.parse(iso || ''); return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10); };

async function products() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(SUPA + '/rest/v1/rpc/public_products', {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}', signal: ctl.signal,
    });
    const list = r.ok ? await r.json() : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  const list = (await products()).filter(p => p && /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/.test(p.slug || ''));
  const urls = [`  <url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`, `  <url><loc>${SITE}/browse</loc></url>`]
    .concat(list.map(p => {
      const mod = day(p.updated_at || p.approved_at);
      return `  <url><loc>${esc(SITE + '/p/' + p.slug)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}<changefreq>weekly</changefreq></url>`;
    }));
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
};

