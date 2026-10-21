'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
test('recorded production migrations keep their version and SQL with only the documented bootstrap guard',()=>{
 const history=JSON.parse(fs.readFileSync(path.join(__dirname,'../supabase/migration-history.json'),'utf8'));
 assert.equal(history.project_ref,'gjmkhnrgznorxxaemsmo');
 const files=fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(f=>f.endsWith('.sql'));
 for(const migration of history.migrations){
  const name=migration.version+'_'+migration.name+'.sql';
  assert.ok(files.includes(name),'Missing original production migration: '+name);
  let sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8').trim();
  if(migration.version==='20261013220355'){
   // Production had a temporary debugging helper. A fresh database does not.
   // Verify that the existing conditional revoke is the ONLY replay difference.
   const guard="-- This one-off debugging helper exists only on some older installations.\ndo $$ begin\n  if to_regprocedure('public.probe_headers()') is not null then\n    revoke execute on function public.probe_headers() from public, anon, authenticated;\n  end if;\nend $$;";
   assert.ok(sql.endsWith(guard),'Unexpected change to the documented bootstrap guard');
   sql=sql.slice(0,-guard.length)+'revoke execute on function public.probe_headers() from public, anon, authenticated;';
  }
  assert.equal(createHash('sha256').update(sql).digest('hex'),migration.sha256,'Applied SQL changed: '+name);
  assert.equal(files.filter(f=>f.slice(15)===migration.name+'.sql').length,1,'Duplicate version for '+migration.name);
 }
});
