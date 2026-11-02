const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const productPage=require('../api/p');
const browse=require('../api/browse');
const sitemap=require('../api/sitemap');
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;});
const fixture={slug:'real-tool',name:'A <Tool>',tagline:'Fix builds & deploy',description:'Useful <script>alert(1)</script>',needs:['fix builds'],pricing:'unspecified',url:'https://example.com',images:[],platforms:[],integrations:[]};
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};}
test('live profile has visible initial content, escaped metadata, canonical and safe outbound links',async()=>{
 global.fetch=async()=>({ok:true,json:async()=>fixture});const res=response();await productPage({query:{slug:fixture.slug}},res);
 assert.equal(res.statusCode,200);assert.match(res.body,/<h1>A &lt;Tool&gt;<\/h1>/);assert.match(res.body,/href="https:\/\/expanse.nyttolabs.com\/p\/real-tool"/);assert.match(res.body,/Useful &lt;script&gt;/);assert.match(res.body,/rel="noopener nofollow ugc"/);assert.doesNotMatch(res.body,/Solves: \./);assert.doesNotMatch(res.body,/Useful <script>/);
});
test('nonexistent and invalid product links return 404 and do not cache/index a fake home page',async()=>{
 let calls=0;global.fetch=async()=>{calls++;return {ok:true,json:async()=>null};};
 for(const slug of ['missing','<invalid>']){const res=response();await productPage({query:{slug}},res);assert.equal(res.statusCode,404);assert.equal(res.headers['Cache-Control'],'no-store');assert.match(res.headers['X-Robots-Tag'],/noindex/);assert.match(res.body,/data-state="error"/);assert.match(res.body,/<div id="app" hidden>/);}
 assert.equal(calls,1);
});
test('catalog outages return retryable 503 instead of hiding a real product behind 404',async()=>{
 global.fetch=async()=>{throw new Error('timeout');};for(const handler of [productPage,browse]){const res=response();await handler({query:{slug:'real-tool'}},res);assert.equal(res.statusCode,503);assert.equal(res.headers['Retry-After'],'60');assert.equal(res.headers['Cache-Control'],'no-store');}
});
test('browse exposes crawlable live product links and a stable canonical without campaign/query parameters',async()=>{
 global.fetch=async()=>({ok:true,json:async()=>[fixture,{...fixture,slug:'<invalid>'}]});const res=response();await browse({query:{q:'builds',utm_source:'threads'}},res);
 assert.equal(res.statusCode,200);assert.match(res.body,/<a href="\/p\/real-tool">A &lt;Tool&gt;<\/a>/);assert.match(res.body,/<link rel="canonical" href="https:\/\/expanse.nyttolabs.com\/browse">/);assert.match(res.body,/data-state="browse"/);assert.doesNotMatch(res.body,/href="\/p\/&lt;invalid/);
});
test('product URLs and share images reject unsafe schemes and credential-bearing links',()=>{
 const html=productPage.withProduct(require('node:fs').readFileSync('index.html','utf8'),{...fixture,url:'javascript:alert(1)',demo_url:'https://secret:password@example.com',images:['javascript:alert(2)']},'https://expanse.nyttolabs.com/p/real-tool');
 assert.doesNotMatch(html,/href="javascript:/);assert.doesNotMatch(html,/href="https:\/\/secret:/);assert.match(html,/og:image" content="https:\/\/expanse.nyttolabs.com\/api\/card\?slug=/);assert.doesNotMatch(html,/content="javascript:/);assert.match(html,/og:image:width" content="1200/);
});
test('sitemap includes browse and validated product pages',async()=>{
 global.fetch=async()=>({ok:true,json:async()=>[fixture]});const res=response();await sitemap({},res);assert.equal(res.statusCode,200);assert.match(res.body,/<loc>https:\/\/expanse.nyttolabs.com\/browse<\/loc>/);assert.match(res.body,/<loc>https:\/\/expanse.nyttolabs.com\/p\/real-tool<\/loc>/);
});
