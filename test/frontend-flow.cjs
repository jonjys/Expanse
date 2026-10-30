const fs=require('fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=require('node:path').join(__dirname,'..')+'/';
const calls=[],errors=[];
const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e.message)});
const product={slug:'fixture',name:'Real Fixture',tagline:'Solve a real user problem',description:'',audience:'',category:'other',needs:[],pricing:'unspecified',price_text:'',platforms:[],integrations:[],url:'https://example.com',demo_url:'',images:[],domain:'example.com',x:130,y:10,size:1,zone:'edge',status:'approved'};
function boot(blockStorage=false,url='https://expanse.nyttolabs.com/',html=fs.readFileSync(root+'index.html','utf8'),storage={},scenario={}){
 const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window;w.AbortSignal=global.AbortSignal;w.matchMedia=()=>({matches:true,addEventListener(){}});w.requestAnimationFrame=fn=>0;w.cancelAnimationFrame=()=>{};
 if(scenario.searchTimeout){const later=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>{if(ms===10000){scenario.searchTimeout.fire=()=>fn(...args);return 1000000;}return later(fn,ms,...args);};}
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 if(scenario.exposure){
  const io=scenario.exposure,timers=new Map();let seq=100000;const later=w.setTimeout.bind(w),cancel=w.clearTimeout.bind(w);
  w.setTimeout=(fn,ms,...args)=>{if(ms===1000){const id=++seq;timers.set(id,()=>fn(...args));return id;}return later(fn,ms,...args);};w.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else cancel(id);};
  io.advance=()=>{const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn());};io.nodes=new Set();
  w.IntersectionObserver=class{constructor(cb){io.callback=cb;}observe(n){io.nodes.add(n);}unobserve(n){io.nodes.delete(n);}disconnect(){io.nodes.clear();}};
 }

 const noop=()=>{};const ctx=new Proxy({measureText:t=>({width:t.length*7}),createRadialGradient:()=>({addColorStop:noop}),createLinearGradient:()=>({addColorStop:noop})},{get:(t,k)=>k in t?t[k]:noop,set:(t,k,v)=>(t[k]=v,true)});
 w.URL.createObjectURL=()=> 'blob:fixture-only';w.URL.revokeObjectURL=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>ctx;w.HTMLCanvasElement.prototype.toDataURL=()=>'';
 w.fetch=async(url,opts)=>{const method=url.split('/').at(-1),body=JSON.parse(opts?.body||'{}');calls.push({method,body});let r;
 if(method==='search'&&scenario.search)return scenario.search(body,opts);
 const defaults={public_seller:{ready:true,legal_name:'Fixture <seller>',registration_number:'TEST-ONLY',address:'Test street\nSweden',email:'support@example.invalid',phone:'TEST-PHONE'},public_products:[product],public_spots:[],public_placements:[],public_spotlight:{picks:[]},founding_stats:{live:1,reserved:1,recent:[]},public_commerce:{enabled:true,prices:[]},public_updates:[],public_releases:[],owner_get:product,owner_map_status:{state:'free',can_pay:true,amount_cents:300},owner_acquisition_stats:{totals:{impressions:0,views:0,visits:0,demos:0,verified_purchases:null},sources:[{source:'list',impressions:0,views:0,visits:0}],campaigns:[]},owner_marketing_kit:{revision:'a'.repeat(20),campaign:'mk-123456abcdef',svg:'<svg xmlns="http://www.w3.org/2000/svg"/>',post_text:'Maker post from public profile',prepared_at:'2026-10-21T12:00:00Z'},owner_need_preferences:{enabled:false},owner_need_matches:[],public_tool_needs:[],submit_tool_need:{id:'c3edd38a-1299-4000-8888-555555555555',key:'fixture-private-receipt-key',state:'private',expires_at:'2099-01-01T00:00:00Z',matches:[]},tool_need_status:{id:'c3edd38a-1299-4000-8888-555555555555',text:'I need to explain failed deployment errors',state:'private',expires_at:'2099-01-01T00:00:00Z',matches:[{slug:'fixture',name:'Real Fixture',reason:'Shared terms in the product profile: deployment, errors.'}]},owner_discovery_stats:[],owner_stats:{days:[{view:3,visit:2,demo:1}]}};
 if(method==='ai'){
   if(scenario.failAI)return {ok:false,status:429,json:async()=>({error:'rate_limited'})};
   if(scenario.delayAI)await scenario.delayAI();
   r=body.mode==='profile'?{profile:{...product,name:'AI Fixture',tagline:'Drafted from a public product website',description:'A real draft that needs review before any submission.',category:'developer',needs:['fix deployments']}}:{mission:{title:'Ship a working app',steps:[{slug:'fixture',task:'Fix the build',reason:'The product description matches this job.'}],gaps:['No payment tool is listed yet.']},catalog_count:1};
   return {ok:true,status:200,json:async()=>r};
 }
 if((method==='owner_marketing_kit'&&scenario.failKit)||(method==='submit_tool_need'&&scenario.failNeed))return {ok:false,status:503,text:async()=>JSON.stringify({message:'unavailable'})};
 if(method==='upvote' && scenario.failVote)return {ok:false,status:429,text:async()=>JSON.stringify({message:'slow_down'})};
 if(method==='upvote')r={upvotes:body.p_on?1:0};
 else if(method==='owner_create_campaign')r={campaign:'mk-abcdef123456',name:body.p_name,kind:body.p_kind};
 else if(method==='submit_product')r={...product,...body.p,slug:'new-fixture',key:'fixture-owner-key',status:'pending',number:2};
 else if(method==='owner_map_checkout')r={id:'fixture-order',url:'https://buy.stripe.com/fixture?client_reference_id=fixture-order',amount_cents:300};
 else r=defaults[method]??[];
 return {ok:true,status:200,text:async()=>JSON.stringify(r),json:async()=>r};};
 if(blockStorage)Object.defineProperty(w,'localStorage',{get(){throw new Error('blocked')}});
 for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
 const source=fs.readFileSync(root+'app.js','utf8').replace(/\}\)\(\);\s*$/, 'window.testRank=(q,ps)=>rankAll(q,ps.map(prepProduct));window.testObserve=()=>observeProductCards();window.testOwner=(slug,tab)=>openManage(slug,tab);window.testMapPick = spot => startSubmit(spot,true);})();');
 w.eval(fs.readFileSync(root+'growth.js','utf8'));w.eval(fs.readFileSync(root+'marketing.js','utf8'));w.eval(source);return dom;
}
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dom=boot();const w=dom.window,d=w.document;await tick();
 assert.ok(d.querySelector('.site-legal a[href="/terms"]'));assert.match(d.querySelector('.site-legal').textContent,/by NyttoLabs/);assert.equal(d.querySelector('.site-legal details'),null,'main footer stays compact without a company panel');
 const click=id=>d.querySelector(id).click();const set=(selector,v)=>{const i=d.querySelector(selector);i.value=v;i.dispatchEvent(new w.Event('input',{bubbles:true}));};
 click('#addBtn');assert.equal(d.querySelector('#cStep2').hidden,false);assert.equal(d.querySelector('#cStep1').hidden,true);
 click('#cNext2');assert.equal(d.querySelector('#cStep2').hidden,false,'invalid profile blocked');
 set('#fBasics input[maxlength="40"]','New Fixture');set('#fBasics input[type="url"]','example.com');set('#fBasics input[maxlength="90"]','Solve a real user problem');click('#cNext2');
 assert.equal(d.querySelector('#cStep1').hidden,false);assert.equal(d.querySelector('#cPrice').textContent,'€0');assert.equal(d.querySelector('#cZone').textContent,'Edge');
 click('[data-plan="paid"]');assert.equal(d.querySelector('#cPrice').textContent,'€4','a paid Edge placement starts at 2×2');assert.equal(d.querySelector('[data-s="1"]').disabled,true,'1×1 Edge is the free spot');
 const zones=()=>[...d.querySelectorAll('#cZones button')];zones().find(e=>e.querySelector('b').textContent==='Inner ring').click();click('[data-s="2"]');assert.equal(d.querySelector('#cPrice').textContent,'€76');
 zones().find(e=>e.querySelector('b').textContent==='Edge').click();assert.equal(d.querySelector('#cPrice').textContent,'€4');
 click('[data-plan="free"]');assert.equal(d.querySelector('#cPrice').textContent,'€0');assert.equal(d.querySelector('[data-s="1"]').getAttribute('aria-pressed'),'true');
 click('#cNext1');assert.equal(d.querySelector('#cStep5').hidden,false);set('#cMail','maker@example.invalid');d.querySelector('#cOwn').checked=true;
 d.querySelector('#cSubmit').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.equal(d.querySelector('#cStep6').hidden,false);const submit=calls.find(x=>x.method==='submit_product');assert.equal(submit.body.p.size,1);assert.equal(submit.body.p.pricing,'unspecified');assert.deepEqual(submit.body.p.needs,[]);assert.equal(submit.body.p.description,'');
 assert.equal(errors.length,0,errors.join('\n'));dom.window.close();
 const blocked=boot(true);await tick();assert.equal(errors.length,0,errors.join('\n'));blocked.window.close();
 const add=boot(false,'https://expanse.nyttolabs.com/add?utm_source=threads');await tick();assert.equal(add.window.document.querySelector('#cStep2').hidden,false);assert.ok(add.window.document.querySelector('#claim').classList.contains('open'));add.window.close();
 const browse=boot(false,'https://expanse.nyttolabs.com/browse?q=Fixture');await tick();assert.equal(browse.window.document.querySelector('#list').getAttribute('aria-hidden'),'false');assert.match(browse.window.document.querySelector('#cards').textContent,/Real Fixture/);browse.window.close();
 // A dropdown search may already be in flight when the visitor submits to list view.
 // Every consumer must receive the eventual empty/error result, not a cached loading marker.
 for(const offline of [false,true]){
  let started,finish,fail;const ready=new Promise(r=>{started=r;}),response=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});let requests=0;
  const pending=boot(false,'https://expanse.nyttolabs.com/',fs.readFileSync(root+'index.html','utf8'),{},{search:()=>{requests++;started();return response;}});await tick();
  const sw=pending.window,sd=sw.document;sd.querySelector('#q').value='verify an EU VAT number';sd.querySelector('#q').dispatchEvent(new sw.Event('input',{bubbles:true}));await ready;
  sd.querySelector('#searchForm').dispatchEvent(new sw.Event('submit',{bubbles:true,cancelable:true}));assert.match(sd.querySelector('#cards').textContent,/Searching by meaning/);
  if(offline)fail(new Error('network unavailable'));else finish({ok:true,json:async()=>({results:[],count:1})});await tick();
  assert.match(sd.querySelector('#cards').textContent,/No convincing match/,'submitted search must finish when an existing dropdown request returns no match or fails');
  assert.ok([...sd.querySelectorAll('#cards button')].some(b=>b.textContent==='Save need & check new matches'));
  sd.querySelector('#lSort').dispatchEvent(new sw.Event('change'));await tick();assert.equal(requests,1,'reuse the settled empty result');sw.close();
 }
 const timeout={};let timeoutSignal;
 const stalled=boot(false,'https://expanse.nyttolabs.com/',fs.readFileSync(root+'index.html','utf8'),{},{searchTimeout:timeout,search:(_body,opts)=>new Promise((_resolve,reject)=>{timeoutSignal=opts.signal;opts.signal?.addEventListener('abort',()=>reject(new Error('timed out')),{once:true});})});await tick();
 const tw=stalled.window,td=tw.document;td.querySelector('#q').value='verify an EU VAT number';td.querySelector('#searchForm').dispatchEvent(new tw.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(typeof timeout.fire,'function','semantic requests must have a finite deadline');timeout.fire();await tick();assert.equal(timeoutSignal.aborted,true);assert.match(td.querySelector('#cards').textContent,/No convincing match/);tw.close();
 const rendered=require('../api/p').withProduct(fs.readFileSync(root+'index.html','utf8'),product,'https://expanse.nyttolabs.com/p/fixture');
 const profile=boot(false,'https://expanse.nyttolabs.com/p/fixture',rendered);await tick();assert.equal(profile.window.document.querySelector('#serverContent'),null,'app replaces initial profile after load');assert.equal(errors.length,0,errors.join('\n'));profile.window.close();

 const personal=boot(false,'https://expanse.nyttolabs.com/p/fixture');await tick();const pd=personal.window.document;
 pd.querySelector('.save-btn').click();assert.equal(pd.querySelector('.save-btn').getAttribute('aria-pressed'),'true');assert.equal(JSON.parse(personal.window.localStorage.getItem('expanse.saved.v1')).length,1);
 const beforeFollowVotes=calls.filter(x=>x.method==='upvote').length;pd.querySelector('.follow-btn').click();await tick();assert.equal(calls.filter(x=>x.method==='upvote').length,beforeFollowVotes,'saving/following never cast votes');
 pd.querySelector('.vote-btn').click();await tick();assert.equal(pd.querySelector('.vote-btn').classList.contains('pop'),false,'upvote animation must not acquire product-panel layout');assert.equal(pd.querySelector('.vote-btn').getAttribute('aria-pressed'),'true');
 pd.querySelector('.pact a').click();pd.querySelector('#followBtn').click();assert.match(pd.querySelector('#dlgBody').textContent,/My space/);assert.match(pd.querySelector('#space-content').textContent,/Real Fixture/);assert.match(pd.querySelector('.space-kpis').textContent,/1your website\/demo clicks/);
 pd.querySelector('[data-space-tab="following"]').click();assert.match(pd.querySelector('#space-content').textContent,/Real Fixture/);
 pd.querySelector('[data-space-tab="upvoted"]').click();assert.match(pd.querySelector('#space-content').textContent,/Real Fixture/);
 const storage={};for(let i=0;i<personal.window.localStorage.length;i++){const key=personal.window.localStorage.key(i);storage[key]=personal.window.localStorage.getItem(key);}personal.window.close();
 const reload=boot(false,'https://expanse.nyttolabs.com/me',fs.readFileSync(root+'index.html','utf8'),storage);await tick();const rd=reload.window.document;assert.match(rd.querySelector('#space-content').textContent,/Real Fixture/);rd.querySelector('[data-space-tab="history"]').click();assert.match(rd.querySelector('#space-content').textContent,/1 website\/demo clicks/);rd.querySelector('[data-space-tab="saved"]').click();rd.querySelector('[aria-label="Remove saved Real Fixture"]').click();assert.equal(JSON.parse(reload.window.localStorage.getItem('expanse.saved.v1')).length,0);reload.window.close();
 const map=boot();await tick();map.window.testMapPick({x:20,y:20});const md=map.window.document;assert.equal(md.querySelector('#cPrice').textContent,'€76','clicked 2×2 Inner ring preview must keep its €76 total');assert.equal(md.querySelector('[data-s="2"]').getAttribute('aria-pressed'),'true');for(const [sel,value]of [['#fBasics input[maxlength="40"]','Map Fixture'],['#fBasics input[type="url"]','https://example.com'],['#fBasics input[maxlength="90"]','A product with a map-selected spot']]){const field=md.querySelector(sel);field.value=value;field.dispatchEvent(new map.window.Event('input',{bubbles:true}));}md.querySelector('#cNext2').click();assert.equal(md.querySelector('#cStep1').hidden,false);assert.equal(md.querySelector('#cPrice').textContent,'€76','quote survives basics → placement');assert.equal(md.querySelector('#intro').classList.contains('out'),true);assert.equal(md.querySelector('#app').classList.contains('ready'),true);map.window.close();

 const failedVote=boot(false,'https://expanse.nyttolabs.com/p/fixture',fs.readFileSync(root+'index.html','utf8'),{},{failVote:true});await tick();failedVote.window.document.querySelector('.vote-btn').click();await tick();assert.equal(failedVote.window.document.querySelector('.vote-btn').getAttribute('aria-pressed'),'false','failed vote rolls back');assert.equal(failedVote.window.localStorage.getItem('expanse.votes.v1'),null);failedVote.window.close();
 const noSave=boot(true,'https://expanse.nyttolabs.com/p/fixture');await tick();noSave.window.document.querySelector('.save-btn').click();assert.match(noSave.window.document.querySelector('#toast').textContent,/blocked saving/);noSave.window.close();
 const own=boot(false,'https://expanse.nyttolabs.com/me',fs.readFileSync(root+'index.html','utf8'),{'expanse.owned.v1':JSON.stringify({fixture:{name:'Real Fixture',key:'test-owner-key'}})});await tick();own.window.document.querySelector('[data-space-tab="owned"]').click();await tick();assert.match(own.window.document.querySelector('.space-owner-stat').textContent,/30 days: 3 profile views · 3 website\/demo clicks/);own.window.close();
 const keyboard=boot();await tick();const kw=keyboard.window,kd=kw.document;
 kw.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};
 const press=(key,shiftKey=false)=>kd.activeElement.dispatchEvent(new kw.KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}));
 const info=kd.querySelector('#infoBtn');info.focus();info.click();
 const sheet=kd.querySelector('#sheet'),sheetButtons=[...sheet.querySelectorAll('button,a[href]')].filter(e=>!e.closest('[hidden]'));
 sheetButtons.at(-1).focus();assert.equal(press('Tab'),false);assert.equal(kd.activeElement,sheetButtons[0],'Tab stays in information dialog');
 press('Tab',true);assert.equal(kd.activeElement,sheetButtons.at(-1),'Shift+Tab wraps backwards');
 info.focus();assert.ok(sheet.contains(kd.activeElement),'background focus returns to modal');
 press('/');assert.ok(sheet.contains(kd.activeElement),'search shortcut cannot take focus behind modal');
 press('Escape');assert.equal(kd.activeElement,info,'Escape returns focus to opener');
 info.click();const owner=kd.querySelector('#ownerOpen');owner.focus();owner.click();
 const dialog=kd.querySelector('#dlg');assert.equal(kd.getElementById(dialog.getAttribute('aria-labelledby')).textContent,'Manage your product');
 const inputs=dialog.querySelectorAll('input');assert.equal(kd.activeElement,inputs[0]);
 const email=[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Sign in with email');email.click();
 assert.match(kd.getElementById(dialog.getAttribute('aria-labelledby')).textContent,/Sign in/);
 press('Escape');assert.equal(kd.activeElement,info,'replacing dialog content keeps original opener');
 const spaceButton=kd.querySelector('#followBtn');spaceButton.focus();spaceButton.click();
 kd.querySelector('[data-space-tab="following"]').click();press('Escape');
 assert.equal(kd.activeElement,spaceButton,'My space restores its opener after collection changes');
 info.focus();info.click();const contact=sheet.querySelector('[data-contact]');contact.focus();contact.click();
 assert.match(kd.getElementById(dialog.getAttribute('aria-labelledby')).textContent,/Write to us/);
 press('Escape');assert.equal(kd.activeElement,contact,'closing a nested action restores focus inside the information dialog');
 assert.ok(sheet.classList.contains('open'));press('Escape');assert.equal(kd.activeElement,info);
 keyboard.window.close();
 assert.equal(errors.length,0,errors.join('\n'));
 // AI profile drafts are explicitly reviewed, preserve manual edits and never submit.
 const ai=boot(false,'https://expanse.nyttolabs.com/add');await tick();const aw=ai.window,ad=aw.document;
 const change=(selector,value)=>{const input=ad.querySelector(selector);input.value=value;input.dispatchEvent(new aw.Event('input',{bubbles:true}));};
 change('#fBasics input[type="url"]','example.com');change('#fBasics input[maxlength="40"]','My manually typed name');const beforeAI=calls.filter(x=>x.method==='submit_product').length;
 ad.querySelector('#cAiDraft').click();await tick();assert.equal(ad.querySelector('#cAiReview').hidden,false);assert.equal(ad.querySelector('#fBasics input[maxlength="90"]').value,'','AI cannot apply before review');ad.querySelector('#cAiUse').click();assert.equal(ad.querySelector('#fBasics input[maxlength="40"]').value,'My manually typed name');assert.match(ad.querySelector('#fBasics input[maxlength="90"]').value,/Drafted/);assert.equal(calls.filter(x=>x.method==='submit_product').length,beforeAI,'draft never submits a product');
 ad.querySelector('#cAiDraft').click();await tick();ad.querySelector('#cAiReplace').checked=true;ad.querySelector('#cAiUse').click();assert.equal(ad.querySelector('#fBasics input[maxlength="40"]').value,'AI Fixture');ai.window.close();
 const quota=boot(false,'https://expanse.nyttolabs.com/add',undefined,{}, {failAI:true});await tick();quota.window.document.querySelector('#fBasics input[type="url"]').value='example.com';quota.window.document.querySelector('#cAiDraft').click();await tick();assert.match(quota.window.document.querySelector('#cAiStatus').textContent,/Try later/);assert.equal(quota.window.document.querySelector('#cAiDraft').disabled,false);quota.window.close();
 // A response for an earlier address must not overwrite a later address.
 let resume;const stale=boot(false,'https://expanse.nyttolabs.com/add',undefined,{}, {delayAI:()=>new Promise(r=>resume=r)});await tick();const sd=stale.window.document;sd.querySelector('#fBasics input[type="url"]').value='example.com';sd.querySelector('#cAiDraft').click();sd.querySelector('#fBasics input[type="url"]').value='different.example.com';resume();await tick();assert.equal(sd.querySelector('#cAiReview').hidden,true);assert.match(sd.querySelector('#cAiStatus').textContent,/website changed/);stale.window.close();
 const mission=boot();await tick();const mw=mission.window,mm=mw.document;let shared='';Object.defineProperty(mw.navigator,'clipboard',{value:{writeText:async value=>shared=value}});
 mm.querySelector('#heroMission').click();mm.querySelector('#missionGoal').value='Fix a failing deployment';mm.querySelector('#missionSubmit').click();await tick();assert.match(mm.querySelector('#missionResults').textContent,/Real Fixture/);assert.match(mm.querySelector('.mission-gaps').textContent,/No payment tool/);assert.equal(mm.querySelectorAll('[data-mission-slug]').length,1);mm.querySelector('.stack-btn').click();assert.equal(mm.querySelector('#stackDock').hidden,false);
 mm.querySelector('#missionCompare').click();assert.match(mm.querySelector('.stack-table').textContent,/Not specified/);mm.querySelector('#stackTitle').value='My launch stack';mm.querySelector('#saveStack').click();mm.querySelector('#saveStack').click();assert.equal(JSON.parse(mw.localStorage.getItem('expanse.stacks.v1')).length,1,'repeated save updates a stack');mm.querySelector('#shareStack').click();await tick();assert.match(shared,/\/stack#/);assert.doesNotMatch(shared,/owner|email|key|fixture-owner-key/);
 assert.equal(mm.querySelector('#stackShareLink').value,shared,'share link stays visible for manual copying');
 const ms={};for(let i=0;i<mw.localStorage.length;i++){const key=mw.localStorage.key(i);ms[key]=mw.localStorage.getItem(key);}mw.close();
 const stackReload=boot(false,'https://expanse.nyttolabs.com/me',undefined,ms);await tick();stackReload.window.document.querySelector('[data-space-tab="stacks"]').click();assert.match(stackReload.window.document.querySelector('#space-content').textContent,/My launch stack/);stackReload.window.close();
 const share=boot(false,shared);await tick();assert.match(share.window.document.querySelector('.stack-table').textContent,/Real Fixture/);assert.equal(share.window.localStorage.getItem('expanse.stacks.v1'),null,'opening a shared stack never silently saves it');share.window.close();
 const unsafe=boot(false,'https://expanse.nyttolabs.com/stack#'+encodeURIComponent(JSON.stringify({v:1,title:'<img src=x onerror=alert(1)>',slugs:['fixture','../admin','https://evil.test']})));await tick();assert.equal(unsafe.window.document.querySelector('#stackTitle').value,'<img src=x onerror=alert(1)>');assert.equal(unsafe.window.document.querySelector('#dlgBody img'),null);assert.equal(unsafe.window.document.querySelectorAll('.stack-table thead th').length,2);unsafe.window.close();
 assert.equal(errors.length,0,errors.join('\n'));
 // Visible-card attribution requires dwell and releases removed DOM nodes.
 const io={},exposure=boot(false,undefined,undefined,{}, {exposure:io});await tick();const en=exposure.window.document.querySelector('#heroProducts [data-exposure]');assert.ok(en);const startExposure=calls.filter(x=>x.method==='track_exposure').length;
 io.callback([{target:en,isIntersecting:true,intersectionRatio:.4}]);io.advance();assert.equal(calls.filter(x=>x.method==='track_exposure').length,startExposure,'below 60% excluded');
 io.callback([{target:en,isIntersecting:true,intersectionRatio:1}]);io.callback([{target:en,isIntersecting:false,intersectionRatio:0}]);io.advance();assert.equal(calls.filter(x=>x.method==='track_exposure').length,startExposure,'leaving before dwell excluded');
 io.callback([{target:en,isIntersecting:true,intersectionRatio:1}]);io.advance();assert.equal(calls.filter(x=>x.method==='track_exposure').length,startExposure+1);io.callback([{target:en,isIntersecting:true,intersectionRatio:1}]);io.advance();assert.equal(calls.filter(x=>x.method==='track_exposure').length,startExposure+1,'repeat exposure deduplicated');
 en.remove();exposure.window.testObserve();assert.ok(!io.nodes.has(en),'removed cards released');exposure.window.close();
 // The incoming campaign is captured before the product router removes its query string.
 const campaignUrl='https://expanse.nyttolabs.com/p/fixture?ref=maker&channel=linkedin&campaign=mk-123456abcdef';
 const priorCampaign=calls.filter(x=>x.method==='track_campaign').length;
 const attributed=boot(false,campaignUrl);await tick();const at=attributed.window.document;
 assert.equal(attributed.window.location.search,'');assert.equal(calls.filter(x=>x.method==='track_campaign').length,priorCampaign+1);
 const outbound=at.querySelector('.pact a');assert.match(outbound.href,/utm_campaign=mk-123456abcdef/);outbound.click();await tick();
 const recorded=calls.filter(x=>x.method==='track_campaign').slice(priorCampaign);assert.deepEqual(recorded.map(x=>x.body.p_kind),['view','visit']);assert.ok(recorded.every(x=>x.body.p_channel==='linkedin'&&x.body.p_slug==='fixture'));attributed.window.close();
 const ranked=w.testRank('fix failed vercel deployment errors',[{...product,slug:'relevant',name:'Deploy helper',tagline:'Fix failed Vercel deployment errors',needs:['fix failed vercel deployment errors'],pop:0},{...product,slug:'famous',name:'Famous',tagline:'Errors in invoices',needs:['invoices'],pop:100}]);assert.equal(ranked[0].p.slug,'relevant');assert.ok(ranked.every(x=>x.p.slug!=='famous'),'weak popular match excluded');
 const makerStorage={'expanse.owned.v1':JSON.stringify({fixture:{name:'Real Fixture',key:'test-owner-key'}})};
 const maker=boot(false,undefined,undefined,makerStorage);await tick();maker.window.testOwner('fixture','stats');await tick();const mk=maker.window.document;
 assert.match(mk.querySelector('#mStats').textContent,/Not enough data/);assert.match(mk.querySelector('#mStats').textContent,/purchases: not connected/);assert.match(mk.querySelector('#mStats').textContent,/No recorded campaign traffic/);
 maker.window.testOwner('fixture','share');await tick();assert.match(mk.querySelector('#mShare').textContent,/ready-to-share kit/);const post=mk.querySelector('#mShare textarea');post.value='A post I wrote myself';post.dispatchEvent(new maker.window.Event('input'));
 const channel=mk.querySelector('#mShare select[aria-label="Where you will share"]');channel.value='newsletter';channel.dispatchEvent(new maker.window.Event('change'));assert.match(mk.querySelector('#mShare input[readonly]').value,/channel=newsletter/);
 const purpose=mk.querySelector('select[aria-label="Campaign purpose"]');purpose.value='black-friday';purpose.dispatchEvent(new maker.window.Event('change'));mk.querySelector('input[aria-label="New campaign name"]').value='BFCM launch';[...mk.querySelectorAll('#mShare button')].find(b=>b.textContent==='Create tracked campaign').click();await tick();assert.match(mk.querySelector('#mShare input[readonly]').value,/mk-abcdef123456/);assert.equal(calls.filter(x=>x.method==='owner_create_campaign').at(-1).body.p_kind,'black-friday');
 const imageFormat=mk.querySelector('select[aria-label="Image format"]');imageFormat.value='story';imageFormat.dispatchEvent(new maker.window.Event('change'));assert.equal(mk.querySelector('.kit-preview').height,1920);
 const beforeKit=calls.filter(x=>x.method==='owner_marketing_kit').length;mk.querySelector('#mTabs [data-tab="stats"]').click();await tick();mk.querySelector('#mTabs [data-tab="share"]').click();await tick();assert.equal(calls.filter(x=>x.method==='owner_marketing_kit').length,beforeKit,'prepared kit reused');assert.equal(mk.querySelector('#mShare textarea').value,'A post I wrote myself');
 mk.querySelector('#mTabs [data-tab="needs"]').click();await tick();assert.equal(mk.querySelector('#mNeeds input[type=checkbox]').checked,false,'maker opt-in off by default');assert.match(mk.querySelector('#mNeeds').textContent,/Matching is off/);maker.window.close();
 const kitFailure=boot(false,undefined,undefined,makerStorage,{failKit:true});await tick();kitFailure.window.testOwner('fixture','share');await tick();assert.match(kitFailure.window.document.querySelector('#mShare').textContent,/unavailable right now/);assert.match(kitFailure.window.document.querySelector('#mShare').textContent,/https:\/\/expanse.nyttolabs.com\/p\/fixture/);kitFailure.window.close();
 const needs=boot(false,'https://expanse.nyttolabs.com/needs');await tick();const nd=needs.window.document;assert.match(nd.querySelector('#needsBoardRows').textContent,/No reviewed needs/);
 [...nd.querySelectorAll('#dlgBody button')].find(b=>b.textContent==='I need a tool that…').click();assert.equal(nd.querySelector('#needConsent').checked,false);assert.equal(nd.querySelector('#dlgBody input[type=email]'),null);
 nd.querySelector('.need-form textarea').value='I need to explain failed deployment errors';const beforeNeed=calls.filter(x=>x.method==='submit_tool_need').length;nd.querySelector('.need-form').dispatchEvent(new needs.window.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(calls.filter(x=>x.method==='submit_tool_need').length,beforeNeed+1);assert.equal(calls.filter(x=>x.method==='submit_tool_need').at(-1).body.p_share,false);assert.match(nd.querySelector('#dlgBody').textContent,/Saved privately/);
 const privateReceipt=JSON.parse(needs.window.localStorage.getItem('expanse.needs.v1'))[0];assert.equal(privateReceipt.key,'fixture-private-receipt-key');
 [...nd.querySelectorAll('#dlgBody button')].find(b=>b.textContent==='My needs').click();await tick();assert.match(nd.querySelector('#space-content').textContent,/Private/);assert.match(nd.querySelector('#space-content').textContent,/Shared terms/);
 [...nd.querySelectorAll('#space-content button')].find(b=>b.textContent==='Withdraw and remove shared text').click();await tick();assert.ok(calls.some(x=>x.method==='withdraw_tool_need'&&x.body.p_key===privateReceipt.key));needs.window.close();
 const failedNeed=boot(false,'https://expanse.nyttolabs.com/needs',undefined,{}, {failNeed:true});await tick();const fnd=failedNeed.window.document;[...fnd.querySelectorAll('#dlgBody button')].find(b=>b.textContent==='I need a tool that…').click();fnd.querySelector('.need-form textarea').value='I need to explain failed deployment errors';fnd.querySelector('#needConsent').checked=true;fnd.querySelector('.need-form').dispatchEvent(new failedNeed.window.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.match(fnd.querySelector('#dlgBody [role=status]').textContent,/could not be saved/);assert.equal(failedNeed.window.localStorage.getItem('expanse.needs.v1'),null);assert.equal(fnd.querySelector('.need-form button[type=submit]').disabled,false);failedNeed.window.close();

 assert.equal(errors.length,0,errors.join('\n'));
 console.log('DOM flow passed: campaign attribution, sharing kit, real zero statistics, needs consent/withdrawal,  registration, pricing, private collections, accessibility, reviewed AI imports, preserved edits, quota errors, stale requests, mission gaps, stack comparison, save/reload and safe portable sharing.');
})().catch(e=>{console.error(e);process.exit(1)});

