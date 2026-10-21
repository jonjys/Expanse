'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const ai=require('../lib/ai-assistant');
const env={ANTHROPIC_SECRET_KEY:'test-only-not-a-real-key',EXPANSE_AI_TOKEN:'test-only-server-token'};
function request(body,headers={}){const req=Readable.from([typeof body==='string'?body:JSON.stringify(body)]);req.method='POST';req.headers={origin:'https://expanse.nyttolabs.com','content-type':'application/json',...headers};return req;}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
const live={slug:'real-tool',name:'Real tool',tagline:'Diagnose failing software deployments',description:'Reads build logs and explains deployment failures.',pricing:'freemium',platforms:['web'],needs:['fix deployments'],url:'https://example.com'};
test('public importer rejects local, credential, port, IP and protocol targets',()=>{
 for(const v of ['https://127.0.0.1','https://2130706433','https://[::1]','https://10.0.0.1','https://local.internal','https://a.localhost','https://a.invalid','https://name:secret@example.com','https://example.com:8443','http://example.com','file:///etc/passwd','https://a\\@example.com'])assert.throws(()=>ai.publicURL(v),undefined,v);
 assert.equal(ai.publicURL('example.com/product?token=private#key').href,'https://example.com/product');
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.18.0.1','192.168.1.2','100.100.100.200','0.0.0.0','224.1.2.3','::ffff:127.0.0.1'])assert.equal(ai.publicIP(ip),false,ip);
 assert.equal(ai.publicIP('8.8.8.8'),true);
});
test('DNS checks every address and redirects cannot bypass public URL checks',async()=>{
 await assert.rejects(ai.publicAddresses('example.com',async()=>[{address:'8.8.8.8'},{address:'10.0.0.1'}]));
 let calls=0;await assert.rejects(ai.fetchPublicPage('https://example.com',{lookup:async()=>[{address:'8.8.8.8'}],page:async()=>{calls++;return {location:'https://169.254.169.254/latest/meta-data'};}}));assert.equal(calls,1);
 await assert.rejects(ai.fetchPublicPage('https://example.com',{lookup:async()=>[{address:'127.0.0.1'}],page:async()=>{throw Error('should not fetch');}}));
});
test('fetch uses the checked DNS address in its socket lookup',async()=>{
 let pinned;
 const request=(_u,opts,callback)=>{opts.lookup('example.com',{all:true},(_e,r)=>pinned=r);const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.headers={'content-type':'text/html'};res.statusCode=200;callback(res);res.emit('data',Buffer.from('<p>Fixture public text</p>'));res.emit('end');req.emit('close');};return req;};
 const r=await ai.pinnedPage(new URL('https://example.com'),[{address:'8.8.8.8'}],request);assert.equal(pinned[0].address,'8.8.8.8');assert.match(r.html,/Fixture/);
});
test('page text removes scripts, limits input and normalizes a bounded profile',()=>{
 const text=ai.pageText('<meta name="description" content="A real product for independent software makers"><script>secret-script</script><style>secret-style</style><p>Real &amp; useful tools for small software teams.</p>');
 assert.doesNotMatch(text,/secret-script|secret-style/);assert.match(text,/Real & useful/);
 const p=ai.profileDraft({name:'<Tool>',tagline:'A helpful public product',description:'x',category:'fake',pricing:'imaginary',platforms:['web','fake'],needs:['a','a'],audience:'x'},'https://example.com');
 assert.equal(p.description,'');assert.equal(p.category,'other');assert.equal(p.pricing,'unspecified');assert.deepEqual(p.platforms,['web']);assert.equal(p.url,'https://example.com');
});
test('Claude request is one bounded call with a fixed endpoint and validated structured output',async()=>{
 let captured;const result=await ai.askClaude({type:'object'},'trusted instructions',{page:'untrusted'}, {env,fetcher:async(url,opts)=>{captured={url,opts};return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:'{"ok":true}'}]})};}});
 assert.equal(result.ok,true);assert.equal(captured.url,'https://api.anthropic.com/v1/messages');assert.equal(captured.opts.headers['x-api-key'],env.ANTHROPIC_SECRET_KEY);const body=JSON.parse(captured.opts.body);assert.equal(body.max_tokens,1600);assert.equal(body.output_config.format.type,'json_schema');assert.equal(body.model,'claude-haiku-4-5-20251001');assert.equal(body.tools,undefined);
 await assert.rejects(ai.askClaude({},'',{}, {env,fetcher:async()=>({ok:false})}),/ai_unavailable/);
 await assert.rejects(ai.askClaude({},'',{}, {env,fetcher:async()=>({ok:true,json:async()=>({stop_reason:'max_tokens'})})}),/invalid_ai_response/);
});
test('mission filters run before AI and invented or duplicate products are removed',async()=>{
 const catalog=ai.missionCatalog([live,{...live,slug:'paid-tool',pricing:'paid'},{...live,slug:'phone-tool',platforms:['ios']}],'fix deployment',{free:true,platform:'web'});assert.deepEqual(catalog.map(p=>p.slug),['real-tool']);
 const mission=await ai.generateMission('fix deployment',catalog,{env,fetcher:async()=>({ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({title:'Ship a working app',steps:[{task:'Fix build',slug:'real-tool',reason:'Explains build logs and identifies the supplied product’s documented causes of deployment errors. '+('More explanation without a new fact. ').repeat(20)},{task:'More of the same',slug:'real-tool',reason:'duplicate'},{task:'Get customers',slug:'invented',reason:'fake'}],gaps:[]})}]})})});
 assert.equal(mission.steps.length,1);assert.match(mission.gaps[0],/no matching product/);assert.ok(mission.steps[0].reason.length<=220);assert.match(mission.steps[0].reason,/\.$/,'long reasons end at a sentence instead of a broken word');
 const empty=await ai.generateMission('anything',[],{fetcher:()=>{throw Error('must not spend');}});assert.equal(empty.steps.length,0);
});
test('API rejects cross-site and malformed requests before consuming quota or fetching',async()=>{
 let spent=0;const handler=ai.createHandler({env,reserve:async()=>spent++});
 for(const [body,headers,status] of [[{mode:'profile',url:'https://example.com'},{origin:'https://evil.example'},403],['null',{},400],['{}',{},400],[{mode:'profile',url:'https://127.0.0.1'},{},400],[{mode:'mission',goal:'short'},{},400],[{mode:'mission',goal:'A long enough mission',platform:'fake'},{},400],['x'.repeat(4097),{},413]]){const res=response();await handler(request(body,headers),res);assert.equal(res.statusCode,status,JSON.stringify(body).slice(0,80));}
 assert.equal(spent,0);
});
test('quota failures fail closed; provider errors never expose secrets',async()=>{
 let fetched=0;const handler=ai.createHandler({env,reserve:async()=>{throw Object.assign(Error('rate_limited'),{status:429,retryAfter:3600});},page:async()=>fetched++});const res=response();await handler(request({mode:'profile',url:'https://example.com'}),res);assert.equal(res.statusCode,429);assert.equal(fetched,0);assert.equal(res.headers['Retry-After'],'3600');
 const fail=ai.createHandler({env,reserve:async()=>{throw Error(env.EXPANSE_AI_TOKEN);}}),r=response();await fail(request({mode:'profile',url:'https://example.com'}),r);assert.deepEqual(r.body,{error:'ai_unavailable'});
});
test('API returns reviewable drafts and missions without any listing or payment mutation',async()=>{
 const handler=ai.createHandler({env,reserve:async()=>{},page:async()=>({url:'https://example.com/',text:'public page'}),profile:async()=>({name:'Fixture',url:'https://example.com/'}),catalog:async()=>[live],mission:async(_g,c)=>({title:'Start',steps:[{slug:c[0].slug}],gaps:[]})});
 let r=response();await handler(request({mode:'profile',url:'https://example.com'}),r);assert.equal(r.statusCode,200);assert.equal(r.body.profile.name,'Fixture');assert.equal(r.headers['Cache-Control'],'no-store');
 r=response();await handler(request({mode:'mission',goal:'Fix a failing deployment',free:true,platform:'web'}),r);assert.equal(r.statusCode,200);assert.equal(r.body.catalog_count,1);assert.equal(r.body.mission.steps[0].slug,'real-tool');
});
