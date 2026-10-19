const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {Readable}=require('node:stream');
const {verifySignature,normalizeEvent}=require('../lib/stripe-webhook');
const handler=require('../api/stripe-webhook');
const secret='whsec_local_test_only_not_a_live_secret';
const raw=Buffer.from('{"hello":"world"}');
const sign=(body,t=1000)=>`t=${t},v1=${createHmac('sha256',secret).update(t+'.').update(body).digest('hex')}`;
test('verifies the raw bytes and tolerates secret rotation signatures',()=>{
 assert.equal(verifySignature(raw,sign(raw),secret,1000),true);
 assert.equal(verifySignature(raw,sign(raw)+',v1='+'a'.repeat(64),secret,1000),true);
 assert.equal(verifySignature(Buffer.from('{"hello": "world"}'),sign(raw),secret,1000),false);
});
test('rejects stale, future, malformed and ambiguous signatures',()=>{
 for(const header of [sign(raw,699),sign(raw,1301),'t=1000,v1=nope',sign(raw)+',t=1000','v1='+'0'.repeat(64)])assert.equal(verifySignature(raw,header,secret,1000),false);
 assert.equal(verifySignature(raw,sign(raw),'',1000),false);
});
const session={id:'cs_live_fixture',created:1000,amount_total:400,currency:'eur',payment_status:'paid',payment_link:'plink_fixture',payment_intent:'pi_fixture',client_reference_id:'01234567-89ab-4def-8012-3456789abcde',metadata:{app:'expanse',kind:'map_placement',zone:'edge',size:'2'}};
const event=(type='checkout.session.completed')=>({id:'evt_fixture',type,livemode:true,data:{object:structuredClone(session)}});
test('normalizes only our live sessions and never forwards customer data',()=>{
 const e=event();e.data.object.customer_details={email:'private@example.invalid'};
 const n=normalizeEvent(e,'acct_fixture');assert.equal(n.amount_total,400);assert.equal(n.size,2);assert.equal(n.payment_status,'paid');assert.equal(JSON.stringify(n).includes('private@'),false);
 assert.equal(normalizeEvent({...e,livemode:false},'acct_fixture'),null);
 assert.equal(normalizeEvent({...e,account:'acct_other'},'acct_fixture'),null);
 e.data.object.metadata.app='unrelated';assert.equal(normalizeEvent(e,'acct_fixture'),null);
});
test('preserves unpaid async status rather than granting on checkout completion',()=>{
 const e=event();e.data.object.payment_status='unpaid';assert.equal(normalizeEvent(e,'acct_fixture').payment_status,'unpaid');
 assert.equal(normalizeEvent(event('checkout.session.async_payment_succeeded'),'acct_fixture').type,'checkout.session.async_payment_succeeded');
});
test('rejects malformed amounts, zone and size before database work',()=>{
 for(const [key,value] of [['amount_total',4.5],['created',null]]){const e=event();e.data.object[key]=value;assert.throws(()=>normalizeEvent(e,'acct_fixture'));}
 for(const [key,value] of [['zone','core'],['size','128']]){const e=event();e.data.object.metadata[key]=value;assert.throws(()=>normalizeEvent(e,'acct_fixture'));}
});
test('refund events distinguish full from partial refunds',()=>{
 const e={id:'evt_refund',type:'charge.refunded',livemode:true,data:{object:{payment_intent:'pi_fixture',amount:400,amount_refunded:200,refunded:false}}};
 assert.equal(normalizeEvent(e,'acct_fixture').fully_refunded,false);e.data.object.amount_refunded=400;e.data.object.refunded=true;assert.equal(normalizeEvent(e,'acct_fixture').fully_refunded,true);
});
async function invoke(body,signature,{method='POST'}={}){
 const req=Readable.from([body]);req.method=method;req.headers={'stripe-signature':signature};
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 await handler(req,res);return res;
}
test('endpoint fails closed when unconfigured, rejects methods and bad signatures',async()=>{
 delete process.env.STRIPE_WEBHOOK_SECRET;delete process.env.EXPANSE_PAYMENT_CALLBACK_TOKEN;
 assert.equal((await invoke(raw,'')).code,503);assert.equal((await invoke(raw,'',{method:'GET'})).code,405);
 process.env.STRIPE_WEBHOOK_SECRET=secret;process.env.EXPANSE_PAYMENT_CALLBACK_TOKEN='local_callback_token_not_real';
 assert.equal((await invoke(raw,'bad')).code,400);
});
test('endpoint passes only a verified event and retries temporary database failure',async()=>{
 process.env.STRIPE_WEBHOOK_SECRET=secret;process.env.EXPANSE_PAYMENT_CALLBACK_TOKEN='local_callback_token_not_real';
 const body=Buffer.from(JSON.stringify(event())),header=sign(body,Math.floor(Date.now()/1000)),original=global.fetch;
 try{
  global.fetch=async(url,init)=>{const p=JSON.parse(init.body);assert.equal(p.p_event.reference,session.client_reference_id);return {ok:true,json:async()=>({outcome:'paid'})};};
  const ok=await invoke(body,header);assert.equal(ok.code,200);assert.equal(ok.body.outcome,'paid');
  global.fetch=async()=>({ok:false});assert.equal((await invoke(body,header)).code,503);
 }finally{global.fetch=original;}
});
