-- Local CI only, rolled back with all fixtures. Never manufacture production needs.
do $$
declare pid bigint;slug text:='needs-fixture';key text:='needs-fixture-owner-key';admin_key text:='needs-fixture-admin-key-123456789';r jsonb;private_need jsonb;shared_need jsonb;matches jsonb;n int:=0;
begin
 perform set_config('request.headers','{"user-agent":"Expanse SQL fixture browser","x-forwarded-for":"192.0.2.91"}',true);
 insert into public.products(slug,name,tagline,description,audience,category,needs,pricing,url,domain,x,y,size,zone,price_eur,status,owner_key_hash,contact_email)
 values(slug,'Needs fixture','Explain failed deployment errors','Checks deployment logs and explains build errors','','developer',array['fix deployment errors'],'free','https://example.invalid','example.invalid',172,154,1,'edge',0,'approved',public._key_hash(key),'private@example.invalid') returning id into pid;
 insert into public.admin_keys(key_hash) values(public._key_hash(admin_key));
 if public.owner_need_preferences(slug,key)->>'enabled'<>'false' or public.owner_need_matches(slug,key)<>'[]'::jsonb then raise exception 'FAIL opt-in default';end if;n:=n+1;
 begin perform public.submit_tool_need('Email person@example.invalid for a deployment tool',true);raise exception 'FAIL contact accepted';exception when others then if sqlerrm<>'invalid:need' then raise;end if;end;n:=n+1;
 private_need:=public.submit_tool_need('I need to explain failed deployment errors',false);
 if private_need->>'state'<>'private' or (select count(*) from jsonb_array_elements(public.public_tool_needs()))<>0 then raise exception 'FAIL private published';end if;n:=n+1;
 if jsonb_array_length(public.tool_need_status((private_need->>'id')::uuid,private_need->>'key')->'matches')=0 then raise exception 'FAIL real profile match';end if;n:=n+1;
 begin perform public.tool_need_status((private_need->>'id')::uuid,'wrong');raise exception 'FAIL receipt auth';exception when others then if sqlerrm<>'bad_key' then raise;end if;end;n:=n+1;
 shared_need:=public.submit_tool_need('I need to explain failed deployment errors',true);
 if shared_need->>'state'<>'pending' or jsonb_array_length(public.public_tool_needs())<>0 then raise exception 'FAIL unreviewed published';end if;n:=n+1;
 begin perform public.admin_review_tool_need(admin_key,(shared_need->>'id')::uuid,true,'I need to explain failed deployment errors',false);raise exception 'FAIL review ack';exception when others then if sqlerrm<>'invalid:anonymize' then raise;end if;end;n:=n+1;
 begin perform public.admin_review_tool_need('wrong',(shared_need->>'id')::uuid,true,'I need to explain failed deployment errors',true);raise exception 'FAIL admin auth';exception when others then if sqlerrm<>'bad_admin' then raise;end if;end;n:=n+1;
 begin perform public.admin_review_tool_need(admin_key,(private_need->>'id')::uuid,true,'I need to explain failed deployment errors',true);raise exception 'FAIL no-consent publishing';exception when others then if sqlerrm<>'unavailable' then raise;end if;end;n:=n+1;
 perform public.admin_review_tool_need(admin_key,(shared_need->>'id')::uuid,true,'I need to explain failed deployment errors',true);
 r:=public.public_tool_needs();
 if jsonb_array_length(r)<>1 or r::text like '%'||(shared_need->>'key')||'%' or r::text like '%receipt_hash%' or r::text like '%vhash%' or r::text like '%raw_text%' or r::text like '%private@example.invalid%' then raise exception 'FAIL public payload';end if;n:=n+1;
 perform public.owner_need_preferences(slug,key,true);matches:=public.owner_need_matches(slug,key);
 if jsonb_array_length(matches)<>1 or matches->0->>'reason' not like '%Profile says:%' or matches->0->>'reason' not like '%deploy%' then raise exception 'FAIL explained maker match';end if;n:=n+1;
 perform public.owner_need_preferences(slug,key,false);if public.owner_need_matches(slug,key)<>'[]'::jsonb then raise exception 'FAIL opt-out';end if;n:=n+1;
 perform public.withdraw_tool_need((shared_need->>'id')::uuid,shared_need->>'key');
 if jsonb_array_length(public.public_tool_needs())<>0 or public.tool_need_status((shared_need->>'id')::uuid,shared_need->>'key')->>'state'<>'withdrawn' then raise exception 'FAIL withdrawal';end if;n:=n+1;
 if has_table_privilege('anon','expanse_private.tool_needs','select') or has_table_privilege('authenticated','expanse_private.need_preferences','update') or has_function_privilege('anon','expanse_private.match_tool_need(text)','execute') then raise exception 'FAIL private access';end if;n:=n+1;
 perform public.submit_tool_need('I need to explain failed deployment errors again',false);
 begin perform public.submit_tool_need('I need to explain failed deployment errors today',false);raise exception 'FAIL hourly cap';exception when others then if sqlerrm<>'slow_down' then raise;end if;end;n:=n+1;
 update expanse_private.tool_needs set created_at=now()-interval '8 days' where id=(private_need->>'id')::uuid;
 perform expanse_private.prune_tool_needs();if exists(select 1 from expanse_private.tool_needs where id=(private_need->>'id')::uuid and vhash is not null) then raise exception 'FAIL rate hash retention';end if;n:=n+1;
 update expanse_private.tool_needs set expires_at=now()-interval '1 day' where id=(private_need->>'id')::uuid;perform expanse_private.prune_tool_needs();if exists(select 1 from expanse_private.tool_needs where id=(private_need->>'id')::uuid) then raise exception 'FAIL expired retention';end if;n:=n+1;
 raise notice '% needs pilot assertions passed',n;
end $$;
