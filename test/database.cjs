'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
// Intentionally fixed to the disposable local Docker container. No production credentials.
const sql=['commerce.sql','withdrawal.sql','ai.sql','marketing.sql','needs.sql','growth.sql'].map(f=>fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n');
const isolation="UPDATE cron.job SET active=false;\nCREATE OR REPLACE FUNCTION public._kick_worker(p_task text) RETURNS bigint LANGUAGE sql AS $$ SELECT NULL::bigint $$;\n";
const r=spawnSync('docker',['exec','-i','supabase_db_expanse','psql','-X','--set','ON_ERROR_STOP=1','--username','supabase_admin','--dbname','postgres'],{input:'BEGIN;\n'+isolation+sql+'\nROLLBACK;\n',encoding:'utf8'});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error('Start the local Supabase stack (project_id = expanse) and Docker to run database tests.');process.exit(r.status??1);
