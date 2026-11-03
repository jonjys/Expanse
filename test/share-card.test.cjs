'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {cardSvg,render,renderPng,cardVersion,cardUrl,cardSupported,drawable,wrap}=require('../lib/og-card');
const {badgeSvg}=require('../lib/badge');
const card=require('../api/card'),badge=require('../api/badge'),productPage=require('../api/p');
const product={slug:'real-tool',name:'Real Tool',tagline:'Solve a real problem for real people',category:'developer',x:20,y:-6,size:2,zone:'inner',upvotes:3,verified_at:'2026-10-20T00:00:00Z'};
function response(){return {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},statusCode:0,end(b){this.body=b;return this;}};}
const withCatalog=async(rows,fn)=>{const original=global.fetch;global.fetch=async(url,init)=>{const slug=JSON.parse(init.body).p_slug;return {ok:true,json:async()=>rows[slug]??null};};try{return await fn();}finally{global.fetch=original;}};
// Like Vercel: req.url is the path and query as requested, req.query the parsed values.
const get=(search,method='GET')=>({method,url:'/api/card'+search,query:Object.fromEntries(new URLSearchParams(search))});
// Bright pixels in the name area of a rendered card: zero means the name was not drawn.
const inkInNameArea=svg=>{const img=render(svg),px=img.pixels,w=img.width;let n=0;for(let y=190;y<300;y++)for(let x=80;x<680;x++){const i=(y*w+x)*4;if(px[i]>200&&px[i+1]>200&&px[i+2]>200)n++;}return n;};

test('the card shows public fields only and escapes them',()=>{
 const svg=cardSvg({...product,name:'<script>x</script> & Co',tagline:'"quoted" \'single\'',contact_email:'secret@example.com',description:'private-ish long text'});
 assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;x&lt;\/script&gt;/);assert.match(svg,/&amp;/);assert.match(svg,/&quot;quoted&quot; &#39;single&#39;/);
 assert.doesNotMatch(svg,/secret@example.com/);assert.match(svg,/3 upvotes/);assert.match(svg,/>Verified</);
 assert.match(svg,/expanse\.nyttolabs\.com\/p\/real-tool/);
});
test('every chip fits, and a product with no votes yet does not advertise zero',()=>{
 for(const zone of ['core','inner','belt','outer','edge'])for(const size of [1,2,4,8])for(const upvotes of [1,42,1234]){
  const svg=cardSvg({...product,zone,size,upvotes});
  assert.match(svg,new RegExp(`· ${size}×${size}<`),`${zone} ${size} ${upvotes}`);
 }
 assert.doesNotMatch(cardSvg({...product,upvotes:0}),/upvote/);
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
test('Greek, Cyrillic and Vietnamese names are drawn; other scripts get no card instead of a blank one',()=>{
 assert.equal(drawable('Łódź Kraków').family,'Instrument Sans');
 for(const name of ['Привет Мир','Ελλάδα','Tiếng Việt']){
  assert.equal(drawable(name).family,'Noto Sans',name);assert.ok(cardSupported({...product,name}),name);
  assert.ok(inkInNameArea(cardSvg({...product,name}))>2000,`${name} is drawn`);
 }
 assert.ok(inkInNameArea(cardSvg({...product,name:''}))<50,'the probe sees an empty name area as empty');
 for(const name of ['東京ツール','مرحبا','🚀'])assert.equal(cardSupported({...product,name}),false,name);
 assert.equal(cardSupported({...product,tagline:'速い'}),false);
 // Emoji are decoration: dropped from the drawn text, never a reason to lose the card.
 assert.deepEqual(drawable('Ship faster 🚀✨'),{text:'Ship faster',family:'Instrument Sans'});
 assert.ok(cardSupported({...product,tagline:'Ship faster 🚀'}));
});
test('the version follows what the card shows, but not the vote count',()=>{
 assert.equal(cardVersion(product),cardVersion({...product,description:'not on the card'}));
 assert.equal(cardVersion(product),cardVersion({...product,upvotes:4}));
 for(const change of [{name:'Other'},{tagline:'Another line'},{category:'design'},{x:21},{size:4},{zone:'belt'},{verified_at:null}])
  assert.notEqual(cardVersion(product),cardVersion({...product,...change}),JSON.stringify(change));
 assert.match(cardUrl(product),/^https:\/\/expanse\.nyttolabs\.com\/api\/card\?slug=real-tool&v=[a-z0-9]+$/);
});
test('only the exact canonical URL of the current version is rendered',async()=>{
 await withCatalog({'real-tool':product,'tokyo':{...product,slug:'tokyo',name:'東京ツール'}},async()=>{
  const v=cardVersion(product),canonical=`https://expanse.nyttolabs.com/api/card?slug=real-tool&v=${v}`;
  let res=response();await card(get(`?slug=real-tool&v=${v}`),res);
  assert.equal(res.statusCode,200);assert.equal(res.headers['content-type'],'image/png');
  assert.equal(res.headers['cache-control'],'public, max-age=3600, s-maxage=86400');
  res=response();await card(get(`?slug=real-tool&v=${v}`,'HEAD'),res);assert.equal(res.statusCode,200);assert.equal(res.body,undefined);
  // Stale versions and every other spelling of the URL redirect without rendering, and the redirect is never cached.
  for(const search of ['?slug=real-tool&v=stale','?slug=real-tool',`?slug=real-tool&v=${v}&cb=1`,`?v=${v}&slug=real-tool`,`?slug=REAL-TOOL&v=${v}`,`?slug=real%2Dtool&v=${v}`,`?slug=real-tool&v=${v}&v=${v}`]){
   res=response();await card(get(search),res);
   assert.equal(res.statusCode,302,search);assert.equal(res.headers.location,canonical,search);
   assert.equal(res.headers['cache-control'],'no-store',search);assert.equal(res.headers['content-type'],undefined,search);
  }
  res=response();await card(get(`?slug=tokyo&v=${cardVersion({...product,slug:'tokyo',name:'東京ツール'})}`),res);assert.equal(res.statusCode,404);
  res=response();await card(get(`?slug=missing-tool&v=${v}`),res);assert.equal(res.statusCode,404);
  res=response();await card(get('?slug=../etc'),res);assert.equal(res.statusCode,404);
  res=response();await card({method:'POST',url:'/api/card?slug=real-tool',query:{slug:'real-tool'}},res);assert.equal(res.statusCode,405);
 });
});
test('a product page uses its card, or its own image when the card cannot draw the name',async()=>{
 const html=fs.readFileSync('index.html','utf8'),url='https://expanse.nyttolabs.com/p/real-tool';
 let out=productPage.withProduct(html,{...product,images:['https://example.com/shot.png']},url);
 assert.match(out,/og:image" content="https:\/\/expanse\.nyttolabs\.com\/api\/card\?slug=real-tool&amp;v=/);assert.match(out,/og:image:width" content="1200/);
 assert.match(out,/og:image:alt" content="Real Tool on Expanse: Solve a real problem/);
 out=productPage.withProduct(html,{...product,name:'東京ツール',images:['https://example.com/shot.png']},url);
 assert.match(out,/og:image" content="https:\/\/example\.com\/shot\.png"/);assert.doesNotMatch(out,/og:image:width/);
 out=productPage.withProduct(html,{...product,name:'東京ツール',images:[]},url);
 assert.match(out,/og:image" content="https:\/\/expanse\.nyttolabs\.com\/og\.jpg"/);assert.match(out,/og:image:alt" content="Expanse: a galaxy/);
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
