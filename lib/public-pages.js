'use strict';
const fs = require('node:fs');
const path = require('node:path');
const SITE = 'https://expanse.nyttolabs.com';
const SUPA = 'https://gjmkhnrgznorxxaemsmo.supabase.co';
const KEY = 'sb_publishable_b1uzRroOaHTGp9oXOhHjtQ_J-A-IUCZ';
const isSlug = s => /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/.test(s || '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const https = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } };
let cached;
function page() {
  if (cached) return cached;
  for (const file of [path.join(process.cwd(), 'index.html'), path.join(__dirname, '..', 'index.html')]) {
    try { return cached = fs.readFileSync(file, 'utf8'); } catch { /* try bundled path */ }
  }
  throw new Error('page_missing');
}
async function rpc(name, args) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${name}`, {method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(4000)});
  if (!r.ok) throw new Error('catalog_unavailable');
  return r.json();
}
function metadata(html, {title, description, url, image, card, alt, noindex = false}) {
  // Function replacements throughout: product text may contain $&, $1 or $` and must come through verbatim.
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  const set = (attr, key, value) => { html = html.replace(new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`), (_, a, b) => a + esc(value) + b); };
  set('name', 'description', description);
  for (const [key, value] of Object.entries({title, description, url})) set('property', `og:${key}`, value);
  // A generated 1200x630 card keeps the declared size; a maker's own image has unknown dimensions.
  if (https(card)) set('property','og:image',https(card));
  else if (https(image)) { set('property','og:image',https(image)); html = html.replace(/\s*<meta property="og:image:(width|height)" content="\d+">/g, ''); }
  if (alt) set('property','og:image:alt',alt);
  html = html.replace(/<link rel="canonical" href="[^"]*">/, () => `<link rel="canonical" href="${esc(url)}">`);
  if (noindex) html = html.replace('</head>', '<meta name="robots" content="noindex, follow">\n</head>');
  return html;
}
function content(html, state, body) {
  // Visible to people and crawlers; the app removes this after loading the same view.
  const css = `<style>#serverContent{position:fixed;inset:0;z-index:1000;overflow:auto;background:radial-gradient(ellipse at 60% 20%,#141d5e,#02030c 75%);padding:clamp(24px,6vw,80px);color:#fff}#serverContent .server-wrap{max-width:850px;margin:auto}#serverContent nav{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:56px}#serverContent a{text-decoration:underline;text-underline-offset:4px}#serverContent h1{font-size:clamp(36px,7vw,64px);line-height:1.1;letter-spacing:-.04em;margin:20px 0}#serverContent p{color:#c3caf0;margin:16px 0;white-space:pre-line}#serverContent .server-links{display:flex;gap:16px;flex-wrap:wrap;margin:28px 0}#serverContent .server-links a{display:inline-block;border:1px solid #5ee1ff;padding:12px 20px;border-radius:24px}#serverContent article{padding:24px 0;border-bottom:1px solid #303965}#serverContent li{margin:8px 0}#serverContent h2{font-size:24px}#serverContent .server-note{font-size:13px;color:#8b94c9}</style>`;
  const section = `<section id="serverContent" data-state="${state}" aria-label="${state === 'product' ? 'Product profile' : 'Expanse'}"><div class="server-wrap"><nav><a href="/">EXPANSE</a><a href="/browse">Browse products</a><a href="/add">Add your product</a></nav><main>${body}</main></div></section>`;
  html = html.replace('<div id="app">', '<div id="app" hidden>');
  return html.replace('</head>', () => css + '</head>').replace(/<body([^>]*)>/, m => m + section);
}
function send(res, html, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control',status === 200 ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600' : 'no-store');
  if (status !== 200) res.setHeader('X-Robots-Tag','noindex, follow');
  if (status === 503) res.setHeader('Retry-After','60');
  res.end(html);
}
function failure(res, status, url) {
  const unavailable = status === 503;
  const title = unavailable ? 'Products are temporarily unavailable' : 'This product is not live';
  const description = unavailable ? 'We could not load the catalog right now. Please try again shortly.' : 'This product may be in review, removed or the link may be incorrect. Explore the live catalog instead.';
  send(res,content(metadata(page(),{title:`${title} · Expanse`,description,url,noindex:true}),'error',`<h1>${title}</h1><p>${description}</p><div class="server-links"><a href="/browse">Browse live products</a><a href="/">Back to Expanse</a></div>`),status);
}
module.exports = {SITE,isSlug,esc,https,page,rpc,metadata,content,send,failure};
