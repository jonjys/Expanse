'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {cardSvg,renderPng,cardVersion,cardUrl,wrap}=require('../lib/og-card');
const {badgeSvg}=require('../lib/badge');
const card=require('../api/card'),badge=require('../api/badge');
const product={slug:'real-tool',name:'Real Tool',tagline:'Solve a real problem for real people',category:'developer',x:20,y:-6,size:2,zone:'inner',upvotes:3,verified_at:'2026-10-20T00:00:00Z'};
function response(){return {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},statusCode:0,end(b){this.body=b;return this;}};}
const withCatalog=async(rows,fn)=>{const original=global.fetch;global.fetch=async(url,init)=>{const slug=JSON.parse(init.body).p_slug;return {ok:true,json:async()=>rows[slug]??null};};try{return await fn();}finally{global.fetch=original;}};

test('the card shows public fields only and escapes them',()=>{
 const svg=cardSvg({...product,name:'<script>x</script> & Co',tagline:'"quoted" \'single\'',contact_email:'secret@example.com',description:'private-ish long text'});
 assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;x&lt;\/script&gt;/);assert.match(svg,/&amp;/);assert.match(svg,/&quot;quoted&quot; &#39;single&#39;/);
 assert.doesNotMatch(svg,/secret@example.com/);assert.match(svg,/3 upvotes/);assert.match(svg,/Verified domain/);
 assert.match(svg,/expanse\.nyttolabs\.com\/p\/real-tool/);
});
test('long names and taglines wrap within their lines and end with an ellipsis',()=>{
 const lines=wrap('The all-in-one workspace that plans projects, tracks time, sends invoices, books meetings and reports profit',31,590,2);
 assert.equal(lines.length,2);assert.match(lines[1],/…$/);
 assert.deepEqual(wrap('Short',31,590,3),['Short']);
 assert.match(wrap('x'.repeat(200),40,300,1)[0],/…$/);
});
test('the card renders as a 1200x630 PNG with the bundled fonts',()=>{
 const png=renderPng(cardSvg(product));
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
});
test('the version changes with what the card shows',()=>{
 assert.equal(cardVersion(product),cardVersion({...product,description:'not on the card'}));
 assert.notEqual(cardVersion(product),cardVersion({...product,upvotes:4}));
 assert.match(cardUrl(product),/^https:\/\/expanse\.nyttolabs\.com\/api\/card\?slug=real-tool&v=[a-z0-9]+$/);
});
test('the card endpoint renders the current version and redirects any other',async()=>{
 await withCatalog({'real-tool':product},async()=>{
  const v=cardVersion(product);
  let res=response();await card({method:'GET',query:{slug:'real-tool',v}},res);
  assert.equal(res.statusCode,200);assert.equal(res.headers['content-type'],'image/png');assert.match(res.headers['cache-control'],/immutable/);
  res=response();await card({method:'GET',query:{slug:'real-tool',v:'stale'}},res);
  assert.equal(res.statusCode,302);assert.equal(res.headers.location,`https://expanse.nyttolabs.com/api/card?slug=real-tool&v=${v}`);
  res=response();await card({method:'GET',query:{slug:'missing-tool',v}},res);assert.equal(res.statusCode,404);
  res=response();await card({method:'GET',query:{slug:'../etc'}},res);assert.equal(res.statusCode,404);
  res=response();await card({method:'POST',query:{slug:'real-tool'}},res);assert.equal(res.statusCode,405);
 });
});
test('the badge shows live upvotes, escapes the name and can be embedded anywhere',async()=>{
 const svg=badgeSvg({...product,name:'A <b>&</b> "B"',upvotes:12345},'light');
 assert.match(svg,/12k/);assert.match(svg,/A &lt;b&gt;&amp;&lt;\/b&gt; &quot;B&quot;/);assert.match(svg,/#ffffff/);
 // The embed snippet in app.js declares width="230" height="54" once; the badge must keep that size as votes grow.
 for(const upvotes of [0,7,9999,12345,1234567])assert.match(badgeSvg({...product,upvotes}),/^<svg [^>]*width="230" height="54"/);
 assert.match(badgeSvg({...product,upvotes:1234567}),/>1m</);
 await withCatalog({'real-tool':product},async()=>{
  const res=response();await badge({method:'GET',query:{slug:'real-tool'}},res);
  assert.equal(res.statusCode,200);assert.match(res.headers['content-type'],/image\/svg\+xml/);
  assert.equal(res.headers['cross-origin-resource-policy'],'cross-origin');assert.match(res.headers['content-security-policy'],/sandbox/);
  assert.match(res.body,/>3</);
  const missing=response();await badge({method:'GET',query:{slug:'nope'}},missing);assert.equal(missing.statusCode,404);
 });
});
