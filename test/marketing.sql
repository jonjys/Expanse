-- Disposable local CI transaction, never run against production.
do $$
declare pid bigint;slug text:='marketing-fixture';key text:='marketing-fixture-owner-key';kit jsonb;rev text;c text;r jsonb;n int:=0;
begin
 insert into public.products(slug,name,tagline,description,audience,category,needs,pricing,url,domain,x,y,size,zone,price_eur,status,owner_key_hash,contact_email)
 values(slug,'Fixture & <tool>','Find a tool to fix deployment errors','','','developer',array['fix deployment errors'],'free','https://example.invalid','example.invalid',170,150,1,'edge',0,'pending',public._key_hash(key),'private@example.invalid') returning id into pid;
 if public.public_marketing_card(slug) is not null then raise exception 'FAIL unpublished card';end if;n:=n+1;
 update public.products set status='approved' where id=pid;
 kit:=public.owner_marketing_kit(slug,key);rev:=kit->>'revision';c:=kit->>'campaign';
 if rev is null or kit->>'svg' not like '%Fixture &amp; &lt;tool&gt;%' or kit::text like '%private@example.invalid%' or kit::text like '%'||key||'%' then raise exception 'FAIL public kit escaping/private fields';end if;n:=n+1;
 update public.products set contact_email='changed-private@example.invalid' where id=pid;
 if public.owner_marketing_kit(slug,key)->>'revision'<>rev then raise exception 'FAIL private update regenerates';end if;n:=n+1;
 begin perform public.owner_marketing_kit(slug,null);raise exception 'FAIL anonymous kit';exception when others then if sqlerrm<>'bad_key' then raise;end if;end;n:=n+1;
 begin perform public.owner_acquisition_stats(slug,'wrong-key');raise exception 'FAIL anonymous stats';exception when others then if sqlerrm<>'bad_key' then raise;end if;end;n:=n+1;
 if has_table_privilege('anon','expanse_private.marketing_kits','select') or has_function_privilege('anon','expanse_private.prepare_marketing_kit(bigint)','execute') then raise exception 'FAIL direct access';end if;n:=n+1;
 r:=public.owner_acquisition_stats(slug,key);
 if (r#>>'{totals,views}')::int<>0 or (r#>>'{totals,impressions}')::int<>0 or r#>'{totals,verified_purchases}'<>'null'::jsonb or jsonb_array_length(r->'sources')<>6 then raise exception 'FAIL real zeros/sales/source coverage';end if;n:=n+1;
 perform set_config('request.headers','{"user-agent":"Expanse SQL fixture browser","x-forwarded-for":"192.0.2.81"}',true);
 perform public.track_exposure(slug,'list');perform public.track_exposure(slug,'list');perform public.track_exposure(slug,'map');
 perform public.track_campaign(slug,'view',c,'x');perform public.track_campaign(slug,'view',c,'x');perform public.track_campaign(slug,'visit','mk-000000000000','x');perform public.track_campaign(slug,'visit',c,'person@example.invalid');
 if (select count(*) from expanse_private.exposure_events where product_id=pid)<>1 or (select count(*) from expanse_private.campaign_events where product_id=pid)<>1 then raise exception 'FAIL event validation/dedup';end if;n:=n+1;
 insert into public.events(product_id,kind,vhash) values(pid,'view',public._visitor_hash()),(pid,'visit',public._visitor_hash()),(pid,'demo',public._visitor_hash());
 r:=public.owner_acquisition_stats(slug,key);
 if r#>>'{totals,matched_visits}'<>'1' or r#>>'{totals,visits}'<>'1' or r#>>'{totals,demos}'<>'1' then raise exception 'FAIL matched website clicks';end if;n:=n+1;
 perform public._mark_owner(pid);r:=public.owner_acquisition_stats(slug,key);
 if r#>>'{totals,views}'<>'0' or r#>>'{totals,impressions}'<>'0' or jsonb_array_length(r->'campaigns')<>0 then raise exception 'FAIL owner excluded';end if;n:=n+1;
 update public.products set tagline='Changed public description of deployment tools' where id=pid;
 if public.owner_marketing_kit(slug,key)->>'revision'=rev or not exists(select 1 from expanse_private.marketing_campaigns where product_id=pid and campaign=c) then raise exception 'FAIL revision / old campaign';end if;n:=n+1;
 update public.products set status='hidden' where id=pid;
 if public.public_marketing_card(slug) is not null or exists(select 1 from expanse_private.marketing_kits where product_id=pid) then raise exception 'FAIL hidden card';end if;n:=n+1;
 raise notice '% marketing and acquisition assertions passed',n;
end $$;
