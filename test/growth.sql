-- Disposable CI only. Outer transaction always rolls back.
do $$
declare pid bigint;k text:='growth-fixture-owner-key-12345';slug text:='growth-fixture';other_key text:='another-fixture-owner-key-123';r jsonb;c jsonb;offer jsonb;n int:=0;
begin
 insert into public.products(slug,name,tagline,description,audience,category,needs,pricing,url,domain,x,y,size,zone,price_eur,status,owner_key_hash,contact_email,approved_at,verified_at)
 values(slug,'Growth Fixture','Explain failed deployment logs','Understand the actual deployment error and fix missing settings safely.','Developers','developer',array['fix failed deployments'],'free','https://growth.example.invalid','growth.example.invalid',173,155,1,'edge',0,'approved',public._key_hash(k),'growth@example.invalid',now()-interval '60 days',now()) returning id into pid;
 begin perform public.owner_create_campaign(slug,other_key,'Not mine','launch');raise exception 'FAIL campaign owner isolation';exception when others then if sqlerrm<>'bad_key' then raise;end if;end;n:=n+1;
 begin perform public.owner_growth_action(slug,other_key,'profile',true);raise exception 'FAIL action owner isolation';exception when others then if sqlerrm<>'bad_key' then raise;end if;end;n:=n+1;
 c:=public.owner_create_campaign(slug,k,'Black Friday facts','black-friday');
 if c->>'campaign'!~'^mk-[a-f0-9]{12}$' or public.owner_create_campaign(slug,k,'Black Friday facts','black-friday')->>'campaign'<>c->>'campaign' then raise exception 'FAIL campaign generation/reuse';end if;n:=n+1;
 perform set_config('request.headers','{"user-agent":"Growth SQL fixture browser","x-forwarded-for":"192.0.2.93"}',true);
 perform public.track_campaign(slug,'view',c->>'campaign','threads');perform public.track_campaign(slug,'view',c->>'campaign','threads');perform public.track_campaign(slug,'visit','mk-000000000000','threads');
 if(select count(*) from expanse_private.campaign_events where product_id=pid)<>1 then raise exception 'FAIL Threads validation/dedup';end if;n:=n+1;
 insert into public.events(product_id,kind,day,vhash) values(pid,'view',current_date,'visitor-today'),(pid,'visit',current_date,'visitor-today'),(pid,'view',current_date-8,'visitor-before');
 r:=public.owner_acquisition_stats(slug,k);
 if r#>>'{windows,7,current,views}'<>'1' or r#>>'{windows,7,previous,views}'<>'1' or jsonb_array_length(r->'daily')<>60 or r#>'{totals,saves}'<>'null'::jsonb or r#>'{totals,verified_purchases}'<>'null'::jsonb then raise exception 'FAIL windows / unknown data';end if;n:=n+1;
 perform public.owner_growth_action(slug,k,'website',true);perform public.owner_growth_action(slug,k,'website',true);
 if(select count(*) from expanse_private.growth_actions where product_id=pid)<>1 or (select baseline->>'views' from expanse_private.growth_actions where product_id=pid)<>'1' then raise exception 'FAIL baseline / dedup';end if;n:=n+1;
 perform public.owner_growth_action(slug,k,'website',false);if exists(select 1 from expanse_private.growth_actions where product_id=pid) then raise exception 'FAIL reopen';end if;n:=n+1;
 perform public.owner_studio_event(slug,k,'open');perform public.owner_studio_event(slug,k,'open');
 if(select count(*) from expanse_private.studio_usage where product_id=pid)<>1 then raise exception 'FAIL usage dedup';end if;n:=n+1;
 offer:=jsonb_build_object('title','Actual seasonal offer','details','Current maker-provided offer terms and prior-price disclosures.','offer_url','https://growth.example.invalid/offer','evidence_url','https://growth.example.invalid/prices','evidence_note','Price history checked against the maker source.','season','black-friday','starts_at',now()-interval '1 day','ends_at',now()+interval '2 days');
 begin perform public.owner_seasonal_offer(slug,other_key,offer);raise exception 'FAIL private offer';exception when others then if sqlerrm<>'bad_key' then raise;end if;end;n:=n+1;
 perform public.owner_seasonal_offer(slug,k,offer);
 if exists(select 1 from jsonb_array_elements(public.public_seasonal_offers()) x where x->>'slug'=slug) then raise exception 'FAIL pending offer public';end if;n:=n+1;
 update expanse_private.seasonal_offers set state='approved',reviewed_at=now() where product_id=pid;
 r:=public.public_seasonal_offers();if not exists(select 1 from jsonb_array_elements(r) x where x->>'slug'=slug) or r::text like '%Price history checked%' then raise exception 'FAIL approved/evidence leak';end if;n:=n+1;
 update expanse_private.seasonal_offers set starts_at=now()-interval '4 days',ends_at=now()-interval '1 day' where product_id=pid;
 if exists(select 1 from jsonb_array_elements(public.public_seasonal_offers()) x where x->>'slug'=slug) then raise exception 'FAIL expired offer';end if;n:=n+1;
 perform public.owner_seasonal_offer(slug,k,offer);if(select state from expanse_private.seasonal_offers where product_id=pid)<>'pending' then raise exception 'FAIL edits bypass review';end if;n:=n+1;
 begin perform public.owner_seasonal_offer(slug,k,offer||'{"offer_url":"https://evil.example.invalid"}'::jsonb);raise exception 'FAIL unrelated offer domain';exception when others then if sqlerrm<>'invalid:offer_url' then raise;end if;end;n:=n+1;
 if has_table_privilege('anon','expanse_private.growth_actions','select') or has_table_privilege('anon','expanse_private.studio_usage','select') or has_table_privilege('anon','expanse_private.seasonal_offers','select') or has_function_privilege('anon','expanse_private.acquisition_window(bigint,integer,integer)','execute') then raise exception 'FAIL private access';end if;n:=n+1;
 begin perform public.admin_growth_metrics('wrong');raise exception 'FAIL admin growth exposed';exception when others then if sqlerrm<>'bad_admin' then raise;end if;end;n:=n+1;
 if public.map_price_cents('edge',1)<>300 or public.map_price_cents('edge',2)<>400 then raise exception 'FAIL price regression';end if;n:=n+1;
 raise notice '% Growth Studio assertions passed',n;
end $$;
