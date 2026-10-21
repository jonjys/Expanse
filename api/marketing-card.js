'use strict';
const {isSlug,rpc}=require('../lib/public-pages');
module.exports=async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; sandbox");
 res.setHeader('Cache-Control','no-store');
 if(!['GET','HEAD'].includes(req.method||'GET')){res.setHeader('Allow','GET, HEAD');res.statusCode=405;return res.end();}
 const slug=String(req.query?.slug||''),revision=String(req.query?.revision||'');
 if(!isSlug(slug)||(revision&&!/^[a-f0-9]{20}$/.test(revision))){res.statusCode=404;return res.end();}
 try{const kit=await rpc('public_marketing_card',{p_slug:slug,p_revision:revision});if(!kit?.svg){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type','image/svg+xml; charset=utf-8');res.setHeader('Cache-Control','public, max-age=300, s-maxage=3600');res.setHeader('ETag','"'+kit.revision+'"');res.statusCode=200;return res.end(req.method==='HEAD'?'':kit.svg);
 }catch{res.statusCode=503;return res.end();}
};
