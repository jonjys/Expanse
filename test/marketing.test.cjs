'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../marketing');
test('campaign links accept only generated IDs and known channels; no arbitrary referrer data',()=>{
 const url=m.link('deploydoctor','mk-123456abcdef','x');assert.deepEqual(m.landing(url),{slug:'deploydoctor',campaign:'mk-123456abcdef',channel:'x'});
 for(const v of [url.replace('expanse.nyttolabs.com','evil.invalid'),url.replace('channel=x','channel=person@example.com'),url.replace('ref=maker','ref=visitor'),url.replace('123456abcdef','unknown'),url.replace('/p/deploydoctor','/browse')])assert.equal(m.landing(v),null);
 assert.throws(()=>m.link('../admin','mk-123456abcdef','x'));assert.throws(()=>m.link('fixture','arbitrary','x'));assert.throws(()=>m.link('fixture','mk-123456abcdef','email@example.com'));
 assert.equal(m.post('Edited by maker',url),'Edited by maker\n\n'+url);
});
test('public prepared card endpoint validates inputs, handles missing/private cards and upstream failure',async()=>{
 const handler=require('../api/marketing-card'),original=global.fetch;let called=0;
 const run=async query=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};await handler({method:'GET',query},res);return res;};
 try{
  global.fetch=async()=>{called++;return {ok:true,json:async()=>({revision:'a'.repeat(20),svg:'<svg xmlns="http://www.w3.org/2000/svg"/>'})};};
  const bad=await run({slug:'../admin'});assert.equal(bad.statusCode,404);assert.equal(called,0);
  const ok=await run({slug:'fixture'});assert.equal(ok.statusCode,200);assert.match(ok.headers['Content-Type'],/image\/svg/);assert.match(ok.headers['Content-Security-Policy'],/sandbox/);
  global.fetch=async()=>({ok:true,json:async()=>null});assert.equal((await run({slug:'fixture'})).statusCode,404);
  global.fetch=async()=>{throw Error('offline');};assert.equal((await run({slug:'fixture'})).statusCode,503);
 }finally{global.fetch=original;}
});
