'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
// Intentionally fixed to the isolated local stack. No production credentials.
const sql=['commerce.sql','withdrawal.sql'].map(f=>fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n');
const isolation="UPDATE cron.job SET active=false;\nCREATE OR REPLACE FUNCTION public._kick_worker(p_task text) RETURNS bigint LANGUAGE sql AS $$ SELECT NULL::bigint $$;\n";
const r=spawnSync('psql',['-X','--set','ON_ERROR_STOP=1','postgresql://postgres:postgres@127.0.0.1:54322/postgres'],{input:'BEGIN;\n'+isolation+sql+'\nROLLBACK;\n',encoding:'utf8'});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error('Start local Supabase and install psql to run database tests.');process.exit(r.status??1);
