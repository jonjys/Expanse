'use strict';
const {rpc}=require('../lib/public-pages'),{render}=require('../lib/legal-pages');
module.exports=async(req,res)=>{
 if(req.method&&!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.setHeader('Allow','GET, HEAD');return res.end();}
 const kind=typeof req.query?.kind==='string'?req.query.kind:'terms';if(!['terms','privacy','withdraw','seller'].includes(kind)){res.statusCode=404;return res.end('Not found');}
 let seller;try{seller=await rpc('public_seller',{});}catch{res.statusCode=503;res.setHeader('Retry-After','60');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Temporarily unavailable · Expanse</title><link rel="stylesheet" href="/legal.css"><main><h1>Temporarily unavailable</h1><p>Seller details could not load. Please retry shortly.</p><a href="/">Back to Expanse</a></main></html>');}
 res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');if(kind==='withdraw')res.setHeader('X-Robots-Tag','noindex, follow');res.end(req.method==='HEAD'?'':render(kind,seller));
};
