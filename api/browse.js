'use strict';
const {SITE,isSlug,esc,page,rpc,metadata,content,send,failure} = require('../lib/public-pages');
module.exports = async (req,res) => {
  try {
    const data = await rpc('public_products',{});
    if (!Array.isArray(data)) throw new Error('invalid_catalog');
    // Rotate daily: no handpicked products or paid ordering in the initial HTML.
    const day = new Date().toISOString().slice(0,10);
    const hash = text => { let n=0; for (const c of text) n=(Math.imul(n,31)+c.charCodeAt(0))>>>0; return n; };
    const list = data.filter(p=>p?.name && isSlug(p.slug)).sort((a,b)=>hash(day+a.slug)-hash(day+b.slug));
    let html = metadata(page(),{title:'Browse real products by what you need · Expanse',description:'Explore the live Expanse catalog. Find tools by the problems they solve. Every product is reviewed; listing is free and search ranking cannot be bought.',url:`${SITE}/browse`});
    const cards = list.map(p=>`<article><h2><a href="/p/${esc(p.slug)}">${esc(p.name)}</a></h2><p>${esc(p.tagline)}</p>${p.audience?`<p>For ${esc(p.audience)}</p>`:''}<p>${esc(({free:'Free',freemium:'Free plan available',trial:'Free trial',paid:'Paid'})[p.pricing]||'Pricing not specified')}${p.verified_at?' · Domain ownership verified':''}</p>${p.needs?.length ? `<p>${esc(p.needs.slice(0,3).join(' · '))}</p>` : ''}</article>`).join('');
    html = content(html,'browse',`<p class="mono">Live catalog · ${list.length} ${list.length === 1 ? 'product' : 'products'}</p><h1>Find a tool for what you need.</h1><p>Browse real products, then open a profile to see what it solves and visit its website. Search ranking and Spotlight cannot be bought.</p>${cards || '<p>The catalog is just getting started. Add your product under the same rules as everyone else.</p>'}<div class="server-links"><a href="/add">List your product for free</a><a href="/">Explore the galaxy</a></div><p class="server-note">Early catalog. Demo products are kept separate and are never shown as real listings.</p>`);
    send(res,html);
  } catch { failure(res,503,`${SITE}/browse`); }
};
