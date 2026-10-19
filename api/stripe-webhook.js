'use strict';
const {verifySignature,normalizeEvent}=require('../lib/stripe-webhook');
const SUPA='https://gjmkhnrgznorxxaemsmo.supabase.co';
const KEY='sb_publishable_b1uzRroOaHTGp9oXOhHjtQ_J-A-IUCZ';
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
  const secret=process.env.STRIPE_WEBHOOK_SECRET,token=process.env.EXPANSE_PAYMENT_CALLBACK_TOKEN;
  if(!secret||!token)return res.status(503).json({error:'payments_not_configured'});
  let raw;
  try{const chunks=[];let length=0;for await(const chunk of req){length+=Buffer.byteLength(chunk);if(length>262144)return res.status(413).json({error:'body_too_large'});chunks.push(Buffer.from(chunk));}raw=Buffer.concat(chunks);}
  catch{return res.status(400).json({error:'invalid_body'});}
  if(!verifySignature(raw,req.headers['stripe-signature'],secret))return res.status(400).json({error:'invalid_signature'});
  let event;
  try{event=normalizeEvent(JSON.parse(raw.toString('utf8')),process.env.STRIPE_ACCOUNT_ID||'acct_1U1ToQBEo0Yzuylw');}
  catch{return res.status(400).json({error:'invalid_event'});}
  if(!event)return res.status(200).json({received:true,ignored:true});
  try{
    const r=await fetch(SUPA+'/rest/v1/rpc/confirm_map_payment',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({p_token:token,p_event:event}),signal:AbortSignal.timeout(10000)});
    if(!r.ok)return res.status(503).json({error:'confirmation_unavailable'});
    const result=await r.json();
    return res.status(200).json({received:true,outcome:result.outcome});
  }catch{return res.status(503).json({error:'confirmation_unavailable'});}
};
module.exports.config={api:{bodyParser:false}};
