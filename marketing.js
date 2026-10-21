/* Shared, deterministic campaign links and a bounded local cache of prepared images. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ExpanseMarketing=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const SITE='https://expanse.nyttolabs.com',channels=['x','linkedin','newsletter','other'];
 const slugOK=s=>/^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/.test(s||'');
 const campaignOK=s=>/^mk-[a-f0-9]{12}$/.test(s||'');
 function landing(value){try{const u=new URL(value),m=u.pathname.match(/^\/p\/([^/]+)$/),slug=m&&m[1],campaign=u.searchParams.get('campaign'),channel=u.searchParams.get('channel');return u.origin===SITE&&slugOK(slug)&&u.searchParams.get('ref')==='maker'&&campaignOK(campaign)&&channels.includes(channel)?{slug,campaign,channel}:null;}catch{return null;}}
 function link(slug,campaign,channel){if(!slugOK(slug)||!campaignOK(campaign)||!channels.includes(channel))throw new Error('invalid_campaign');const u=new URL(SITE+'/p/'+slug);u.searchParams.set('ref','maker');u.searchParams.set('channel',channel);u.searchParams.set('campaign',campaign);return u.href;}
 function post(text,url){return String(text||'').trim()+'\n\n'+url;}
 const memory=new Map();let dbPromise;
 function db(){if(dbPromise)return dbPromise;dbPromise=new Promise(resolve=>{try{const r=indexedDB.open('expanse-marketing-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('png');r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);r.onblocked=()=>resolve(null);}catch{resolve(null);}});return dbPromise;}
 async function read(key){const d=await db();if(!d)return null;return new Promise(resolve=>{try{const r=d.transaction('png').objectStore('png').get(key);r.onsuccess=()=>resolve(r.result?.blob||null);r.onerror=()=>resolve(null);}catch{resolve(null);}});}
 async function write(key,blob){const d=await db();if(!d)return;await new Promise(resolve=>{try{const tx=d.transaction('png','readwrite'),s=tx.objectStore('png');s.put({blob,at:Date.now()},key);const r=s.openCursor(),entries=[];r.onsuccess=()=>{const c=r.result;if(c){entries.push([c.key,c.value.at]);c.continue();}else entries.sort((a,b)=>b[1]-a[1]).slice(20).forEach(([k])=>s.delete(k));};tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve;}catch{resolve();}});}
 function render(svg){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),img=new Image();img.onload=()=>{try{const c=document.createElement('canvas');c.width=1080;c.height=1350;const ctx=c.getContext('2d');if(!ctx)throw new Error('canvas_unavailable');ctx.drawImage(img,0,0);c.toBlob(b=>{URL.revokeObjectURL(url);b?resolve(b):reject(new Error('image_unavailable'));},'image/png');}catch(e){URL.revokeObjectURL(url);reject(e);}};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('image_unavailable'));};img.src=url;});}
 async function png(slug,kit){const key=slug+':'+kit.revision;if(memory.has(key))return memory.get(key);const existing=await read(key);if(existing){memory.set(key,existing);return existing;}const blob=await render(kit.svg);memory.set(key,blob);if(memory.size>20)memory.delete(memory.keys().next().value);await write(key,blob);return blob;}
 return {channels,landing,link,post,png};
});
