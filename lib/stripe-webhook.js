'use strict';
const { createHmac, timingSafeEqual } = require('node:crypto');
const TYPES = new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','charge.refunded','charge.dispute.created']);
function verifySignature(raw, header, secret, seconds = Math.floor(Date.now()/1000)) {
  if (!secret || typeof header !== 'string') return false;
  const parts = header.split(',').map(v=>v.trim().split('='));
  const stamps = parts.filter(([k])=>k==='t');
  if (stamps.length !== 1 || !/^\d+$/.test(stamps[0][1]||'')) return false;
  const timestamp = Number(stamps[0][1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(seconds-timestamp)>300) return false;
  const expected = createHmac('sha256',secret).update(String(timestamp)+'.').update(raw).digest();
  return parts.some(([k,v])=>k==='v1' && /^[a-f0-9]{64}$/i.test(v||'') && timingSafeEqual(expected,Buffer.from(v,'hex')));
}
function normalizeEvent(event, expectedAccount) {
  if (!event || !TYPES.has(event.type) || event.livemode !== true || (event.account && event.account !== expectedAccount)) return null;
  const s=event.data && event.data.object;
  if (!s || typeof event.id !== 'string' || !/^evt_[A-Za-z0-9_]+$/.test(event.id)) throw new Error('invalid_event');
  const id=v=>typeof v==='string'?v:v && typeof v.id==='string'?v.id:null;
  if (event.type.startsWith('charge.')) return {id:event.id,type:event.type,livemode:true,payment_intent:id(s.payment_intent),fully_refunded:s.refunded === true && s.amount_refunded>=s.amount};
  const m=s.metadata||{};
  if (m.app!=='expanse'||m.kind!=='map_placement') return null;
  if (!/^cs_[A-Za-z0-9_]+$/.test(s.id||'') || !Number.isSafeInteger(s.created) || !Number.isSafeInteger(s.amount_total) || !/^[1248]$/.test(m.size||'') || !['edge','outer','belt','inner'].includes(m.zone)) throw new Error('invalid_session');
  return {id:event.id,type:event.type,livemode:true,app:m.app,kind:m.kind,zone:m.zone,size:Number(m.size),reference:s.client_reference_id,
    session_id:s.id,session_created:s.created,payment_status:s.payment_status,currency:s.currency,amount_total:s.amount_total,
    payment_link:id(s.payment_link),payment_intent:id(s.payment_intent)};
}
module.exports={verifySignature,normalizeEvent};
