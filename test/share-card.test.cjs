'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {cardSvg,render,renderPng,cardVersion,cardUrl,cardSupported,drawable,measure,wrap,FONT_FILES}=require('../lib/og-card');
const {badgeSvg,neutralBadgeSvg}=require('../lib/badge');
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
 assert.doesNotMatch(svg,/secret@example.com/);assert.match(svg,/3 upvotes/);
 // Verification means domain ownership, so the card says so.
 assert.match(svg,/>Verified domain</);
 // Nothing below the chips: X lays the link's domain over the bottom-left corner of the image.
 for(const [,y] of svg.matchAll(/<text [^>]*y="([\d.]+)"/g))assert.ok(+y<=520,`text at y=${y}`);
});
test('every chip fits, and a product with no votes yet does not advertise zero',()=>{
 const labels={core:'Spotlight',inner:'Inner ring',belt:'Belt',outer:'Outer rim',edge:'Edge'};
 for(const zone of Object.keys(labels))for(const size of [1,2,4,8])for(const upvotes of [1,42,1234,99999]){
  const svg=cardSvg({...product,zone,size,upvotes}),what=`${zone} ${size} ${upvotes}`;
  // The zone is always shown, with its size when the row has room; every chip ends clear of the galaxy.
  assert.match(svg,new RegExp(`>${labels[zone]}( · ${size}×${size})?<`),what);
  for(const [,x,w] of svg.matchAll(/<rect x="(\d+)" y="470" width="(\d+)"/g))assert.ok(+x + +w<=740,what);
 }
 assert.match(cardSvg({...product,upvotes:3}),/>Inner ring · 2×2</);
 assert.match(cardSvg({...product,upvotes:1234}),/>1,234 upvotes</);
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
 // RGB, not RGBA: the card is opaque, and the smaller file stays well under WhatsApp's reported ~300 KB preview limit.
 assert.equal(png[25],2);
 const longest=renderPng(cardSvg({...product,name:'Shopify Order Window Manager',tagline:'See every Shopify order from one window, with filters that remember you and bulk actions',upvotes:99999,size:8,zone:'outer'}));
 assert.ok(longest.length<250000,`${longest.length} bytes`);
});
test('text is measured as drawn: it stays in its column, two-line names get room, and the tagline uses the space',()=>{
 const lines=svg=>[...svg.matchAll(/<text x="80" y="([\d.]+)" font-family="([^"]+)" font-weight="(\d+)" font-size="(\d+)"(?: letter-spacing="(-?\d+)")?[^>]*>([^<]*)</g)].map(([,y,family,weight,size,spacing,text])=>({y:+y,family,weight:+weight,size:+size,spacing:+(spacing||0),text:text.replace(/&amp;/g,'&')}));
 for(const name of ['DEPLOYDOCTOR','WWWWWWWWWWWWWWWWWWWW MMMM','ЩЁЛКОВО ЖИЗНЬ ШКОЛА МОЩЬ','ÖVERSÄTTNING ÅTERBRUK','Shopify Order Window Manager']){
  const svg=cardSvg({...product,name,tagline:'WWW MMM WWW MMM WWW MMM WWW MMM WWW MMM WWW MMM WWW MMM WWW MMM WWW MMM WWW MMM'});
  for(const l of lines(svg).filter(l=>l.size>=31))assert.ok(measure(l.text,l.family,l.weight,l.size,l.spacing)<=590,`${name}: "${l.text}"`);
 }
 // A one-line name gets the largest size at which it really fits, not one picked by a pessimistic estimate.
 for(const name of ['DeployDoctor','DEPLOYDOCTOR','Real Tool','Invoices for Freelancers']){
  const size=lines(cardSvg({...product,name}))[0].size,fits=s=>measure(name,'Instrument Sans',700,s,-2)<=590;
  assert.equal(size,fits(76)?76:fits(62)?62:size,name);if(size<76)assert.ok(!fits(76),name);
 }
 const two=lines(cardSvg({...product,name:'Shopify Order Window Manager',tagline:'See every Shopify order from one window, with filters that remember you and bulk actions'}));
 const name=two.filter(l=>l.weight===700),tag=two.filter(l=>l.weight===500);
 assert.equal(name.length,2);assert.ok(name[1].y-name[0].y>=name[0].size*1.1,'descenders clear the next line');
 assert.equal(tag.length,3);assert.doesNotMatch(tag.at(-1).text,/…$/);
 // A long first word is cut, but the last line only gets an ellipsis when words are left over, and never two.
 assert.deepEqual(wrap('WWWWWWWWWWWWWWWWWWWW MMMM',52,590,2,'Instrument Sans',700).map(l=>l.endsWith('…')),[true,false]);
 for(const [text,size,lines,weight] of [['Go WaveDashCommonCommerceWindow Hub',52,2,700],['Plan sprints and ship with your whole team: TeamMomentumMeetingAdminMaximum today',31,3,500]])
  assert.doesNotMatch(wrap(text,size,590,lines,'Instrument Sans',weight).join('\n'),/……/,text);
 // Lines with symbols are drawn where they were measured: a glyph the mono face also has must not turn the line monospaced.
 const ink=line=>{const img=render(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="120"><rect width="1200" height="120" fill="#000"/><text x="80" y="80" font-family="Instrument Sans" font-weight="500" font-size="31" fill="#fff">${line}</text></svg>`),px=img.pixels,w=img.width;let max=0;for(let y=0;y<120;y++)for(let x=0;x<w;x++)if(px[(y*w+x)*4]>60&&x>max)max=x;return max;};
 for(const line of ['Two-way sync ⇄ for Notion, Airtable and','Undo ↩ and redo ↻ every change your','Footnotes‡ for every chart in your','Uptime alerts ✓ status pages ● on-call']){
  const end=80+measure(line,'Instrument Sans',500,31),drawn=ink(line);
  assert.ok(drawn<=end+2&&drawn>=end-30,`${line}: measured ${Math.round(end)}, drawn ${drawn}`);
 }
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
 assert.deepEqual(drawable('🇸🇪 Swedish 👍🏽 team \u{1F468}\u200D\u{1F469}\u200D\u{1F467}'),{text:'Swedish team',family:'Instrument Sans'});
 assert.ok(cardSupported({...product,tagline:'Ship faster 🚀'}));
 // Nothing else is removed: hyphen variants look like a hyphen, other missing characters withhold the card.
 assert.deepEqual(drawable('AI\u2011powered, self\u2010hosted'),{text:'AI-powered, self-hosted',family:'Instrument Sans'});
 assert.equal(drawable('soft\u00adhyphen\u200b').text,'softhyphen');
 // Common marketing symbols are drawn from the bundled symbol fonts.
 for(const tagline of ['Uptime alerts ✓ status pages ✓ on-call','● Live status for your API','Save ≥50% on hosting','From ≈$10 a month','Idea ⇒ launch in a day','Rated ☆☆☆☆☆ by teams']){
  assert.ok(cardSupported({...product,tagline}),tagline);assert.equal(drawable(tagline).text,tagline);
 }
 for(const tagline of ['x\u0302 notation','Fast 𝄞 music'])assert.equal(cardSupported({...product,tagline}),false,tagline);
 // A Cyrillic line keeps its card when it holds a glyph only Instrument Sans has.
 assert.equal(drawable('Идея → запуск за один день').family,'Noto Sans');
 assert.ok(inkInNameArea(cardSvg({...product,name:'Идея → запуск'}))>2000);
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
  // Not public right now (in review, hidden, removed): the neutral badge, so the maker's site never shows a broken image.
  const missing=response();await badge({method:'GET',query:{slug:'nope'}},missing);
  assert.equal(missing.statusCode,200);assert.equal(missing.body,neutralBadgeSvg('dark'));assert.doesNotMatch(missing.body,/LIVE ON|upvote/);
  assert.equal(missing.headers['cache-control'],'public, max-age=60, s-maxage=300');
  const bad=response();await badge({method:'GET',query:{slug:'../etc'}},bad);assert.equal(bad.statusCode,404);
 });
 const original=global.fetch;global.fetch=async()=>{throw new Error('down');};
 try{const res=response();await badge({method:'GET',query:{slug:'real-tool'}},res);assert.equal(res.statusCode,200);assert.equal(res.headers['cache-control'],'no-store');assert.match(res.body,/aria-label="Expanse"/);}
 finally{global.fetch=original;}
 assert.match(neutralBadgeSvg('light'),/^<svg [^>]*width="230" height="54"/);
});
test('the fonts reach both functions that read them',()=>{
 const {functions}=JSON.parse(fs.readFileSync('vercel.json','utf8'));
 for(const f of FONT_FILES)assert.ok(fs.existsSync(`fonts/ttf/${f}`),f);
 assert.match(functions['api/card.js'].includeFiles,/fonts\/ttf\/\*\*/);
 assert.match(functions['api/p.js'].includeFiles,/fonts\/ttf\/\*\.ttf/);
 assert.ok(FONT_FILES.every(f=>f.endsWith('.ttf')));
});
