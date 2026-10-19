'use strict';
const {SITE,isSlug,esc,https,page,rpc,metadata,content,send,failure} = require('../lib/public-pages');
function withProduct(html, p, url) {
  const description = [p.tagline, (p.needs || []).length ? `Solves: ${p.needs.join(', ')}` : '', p.description].filter(Boolean).join('. ').replace(/\s+/g,' ').slice(0,220);
  html = metadata(html,{title:`${p.name} — ${p.tagline} · Expanse`,description,url,image:(p.images || []).find(https)});
  const website = https(p.url), demo = https(p.demo_url);
  const needs = (p.needs || []).length ? `<h2>What it solves</h2><ul>${p.needs.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>` : '';
  const pricing = {free:'Free',freemium:'Free plan',trial:'Free trial',paid:'Paid'}[p.pricing];
  return content(html,'product',`<p class="mono">A real product on Expanse${p.verified_at ? ' · Verified domain' : ''}</p><h1>${esc(p.name)}</h1><p>${esc(p.tagline)}</p>${p.description ? `<p>${esc(p.description)}</p>` : ''}${needs}${p.audience ? `<p>For: ${esc(p.audience)}</p>` : ''}${pricing ? `<p>${pricing}${p.price_text ? ' · '+esc(p.price_text) : ''}</p>` : ''}<div class="server-links">${website ? `<a href="${esc(website)}" target="_blank" rel="noopener nofollow ugc">Visit website ↗</a>` : ''}${demo ? `<a href="${esc(demo)}" target="_blank" rel="noopener nofollow ugc">Try demo ↗</a>` : ''}<a href="/?p=${esc(p.slug)}">Open in the galaxy</a></div><p class="server-note">Verified means domain ownership, not a quality guarantee. Map payments never buy search ranking or Spotlight.</p>`);
}
module.exports = async (req,res) => {
  const slug = String(req.query?.slug || '').toLowerCase();
  const url = `${SITE}/p/${encodeURIComponent(slug)}`;
  if (!isSlug(slug)) return failure(res,404,url);
  try {
    const p = await rpc('public_product',{p_slug:slug});
    if (!p?.name) return failure(res,404,url);
    return send(res,withProduct(page(),p,url));
  } catch { return failure(res,503,url); }
};
module.exports.withProduct = withProduct;
