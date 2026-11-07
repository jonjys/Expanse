'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../growth.js');
const long={name:'Shopify Order Window Manager',tagline:'See every Shopify order from one window, with filters that remember you and bulk actions',audience:'Shopify merchants and small e-commerce teams who handle more than a hundred orders a day',needs:['see every order from one window, with saved filters and bulk actions for busy days'],description:'x'.repeat(400)};
const other={name:'Rival Order Dashboard Pro',tagline:'Another long tagline about orders, dashboards, filters, exports and everything in between'};
test('X counts like X: links weigh 23, emoji and CJK weigh 2',()=>{
 assert.equal(G.xLength('abc'),3);assert.equal(G.xLength('🚀'),2);assert.equal(G.xLength('東京'),4);assert.equal(G.xLength('— “ok” …'),9);
 assert.equal(G.xLength('see https://expanse.nyttolabs.com/p/a-very-long-product-slug?ref=maker&channel=x'),27);
});
test('X copy fits in one post with its link, keeps its caveat and never cuts a word',()=>{
 for(const kind of Object.keys(G.kinds))for(const p of [long,{...long,audience:''}]){
  const text=G.copy(p,kind,'x',other),lines=text.split('\n');
  assert.ok(G.xLength(text)+24<=280,`${kind}: ${G.xLength(text)+24}`);
  // A shortened line is a whole-word prefix of the line it came from.
  const sources=[`${p.name} — ${p.tagline}`,`${other.name} — ${other.tagline}`];
  for(const l of lines.filter(l=>l.endsWith('…'))){const prefix=l.slice(0,-1);assert.ok(sources.some(s=>s.startsWith(prefix)&&/^[\s,.;:–—-]/.test(s.slice(prefix.length))),`${kind}: ${l}`);}
  if(kind==='black-friday')assert.equal(lines.at(-1),'Check the product website for current pricing. No discount is claimed.');
  if(kind==='comparison')assert.equal(lines.at(-1),'Check each product’s current features and pricing before choosing.');
 }
});
