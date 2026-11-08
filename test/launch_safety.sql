-- Executed only inside BEGIN ... ROLLBACK after payment_lifecycle.sql (uses its pg_temp helpers, webhook key and
-- notify_email). Launch safety migration 20261108160000.
do $$
declare checks int:=0; p jsonb; p6 jsonb; r json; out text; v_body text; i int;
begin
 -- 1. Legacy reservations and the abuse hash are closed to anonymous callers.
 if has_function_privilege('anon','public.reserve_spot(text,text,text,integer,integer,integer,text)','execute')
    or has_function_privilege('anon','public.reserve(text,text,text,integer,integer)','execute') then raise exception 'FAIL legacy reserve still callable'; end if; checks:=checks+1;
 if has_function_privilege('anon','public._abuse_hash()','execute') then raise exception 'FAIL abuse hash exposed'; end if; checks:=checks+1;

 -- 2. A paid session that matches no order is recorded for review and alerts the admin; unpaid ones stay quiet.
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_ls_badref','checkout.session.completed','not-a-uuid','cs_ls_badref',400,'edge',1,'pi_ls_badref'));
 if out<>'missing_reference' or not exists(select 1 from expanse_private.stripe_events where event_id='evt_ls_badref' and outcome='needs_review' and purchase_id is null) then raise exception 'FAIL bad reference not reviewed: %',out; end if; checks:=checks+1;
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_ls_noref','checkout.session.completed',null,'cs_ls_noref',400,'edge',1,'pi_ls_noref'));
 if out<>'unknown_order' or not exists(select 1 from expanse_private.stripe_events where event_id='evt_ls_noref' and outcome='needs_review') then raise exception 'FAIL missing reference not reviewed: %',out; end if; checks:=checks+1;
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_ls_unknown','checkout.session.async_payment_succeeded',gen_random_uuid()::text,'cs_ls_unknown',400,'edge',1,'pi_ls_unknown'));
 if out<>'unknown_order' or not exists(select 1 from expanse_private.stripe_events where event_id='evt_ls_unknown' and outcome='needs_review') then raise exception 'FAIL unknown order not reviewed: %',out; end if; checks:=checks+1;
 if not exists(select 1 from public.outbox where kind='map_review' and body like '%evt_ls_badref%' and body like '%pi_ls_badref%') then raise exception 'FAIL admin not alerted'; end if; checks:=checks+1;
 perform pg_temp.lc_pay(pg_temp.lc_ev('evt_ls_unpaid','checkout.session.completed','not-a-uuid','cs_ls_unpaid',400,'edge',1,'pi_ls_unpaid','unpaid'));
 if exists(select 1 from expanse_private.stripe_events where event_id='evt_ls_unpaid') then raise exception 'FAIL unpaid session recorded'; end if; checks:=checks+1;
 if pg_temp.lc_pay(pg_temp.lc_ev('evt_ls_badref','checkout.session.completed','not-a-uuid','cs_ls_badref',400,'edge',1,'pi_ls_badref'))<>'duplicate' then raise exception 'FAIL replayed event not deduplicated'; end if; checks:=checks+1;

 -- 3. Upvotes: a changed User-Agent no longer gives a fresh allowance. Three voters per address per product per day.
 p:=pg_temp.lc_mk('Launch Safety Votes',150,40,1);
 for i in 1..4 loop
  perform set_config('request.headers',json_build_object('user-agent','Fixture browser '||i,'x-forwarded-for','198.51.100.7')::text,true);
  out:=pg_temp.lc_err(format('select public.upvote(%L,%L,true)',p->>'slug','fixturevoter'||lpad(i::text,12,'0')));
  if i<=3 and out<>'ok' then raise exception 'FAIL vote % refused: %',i,out; end if;
  if i=4 and out<>'already' then raise exception 'FAIL fourth vote from one address: %',out; end if;
 end loop; checks:=checks+1;
 perform set_config('request.headers',json_build_object('user-agent','Fixture browser 1','x-forwarded-for','198.51.100.8')::text,true);
 if pg_temp.lc_err(format('select public.upvote(%L,%L,true)',p->>'slug','fixturevoterother001'))<>'ok' then raise exception 'FAIL another address blocked'; end if; checks:=checks+1;
 -- IPv6 counts per /64.
 p6:=pg_temp.lc_mk('Launch Safety Votes Six',152,40,1);
 for i in 1..4 loop
  perform set_config('request.headers',json_build_object('user-agent','Fixture browser','x-forwarded-for','2001:db8:aa:bb::'||i)::text,true);
  out:=pg_temp.lc_err(format('select public.upvote(%L,%L,true)',p6->>'slug','fixturevoter6'||lpad(i::text,11,'0')));
  if i=4 and out<>'already' then raise exception 'FAIL IPv6 /64 not grouped: %',out; end if;
 end loop; checks:=checks+1;

 -- 4. Submissions: ten an hour per address, whatever the User-Agent.
 for i in 1..11 loop
  perform set_config('request.headers',json_build_object('user-agent','Submit browser '||i,'x-forwarded-for','198.51.100.20')::text,true);
  out:=pg_temp.lc_err(format('select public.submit_product(%L::jsonb)',jsonb_build_object('name','Address Limit '||i,'url','https://example.com/address-limit-'||i,
   'tagline','Solves an address limit fixture problem','category','other','pricing','unspecified','needs','[]'::jsonb,'email','address-limit-'||i||'@example.invalid','x',57+i*3,'y',138,'size',1)));
  if i<=10 and out<>'ok' then raise exception 'FAIL submission % refused: %',i,out; end if;
  if i=11 and out<>'slow_down' then raise exception 'FAIL eleventh submission from one address: %',out; end if;
 end loop; checks:=checks+1;

 -- 5. Withdrawal emails carry fixed text only, once a day per address; the on-screen receipt keeps the details.
 perform set_config('request.headers',json_build_object('user-agent','Withdraw browser 1','x-forwarded-for','198.51.100.30')::text,true);
 r:=public.submit_withdrawal('Mallory Fixture','victim-fixture@example.invalid','nothing-matches','Click https://evil.example/phish now');
 select o.body into v_body from public.outbox o where o.kind='withdrawal_receipt' and o.to_email='victim-fixture@example.invalid' order by o.id desc limit 1;
 if v_body is null or v_body like '%evil.example%' or v_body like '%Mallory%' or v_body like '%nothing-matches%' then raise exception 'FAIL emailed acknowledgement echoes caller text: %',v_body; end if; checks:=checks+1;
 if r->>'receipt' not like '%evil.example%' or r->>'receipt' not like '%nothing-matches%' then raise exception 'FAIL on-screen receipt lost the details'; end if; checks:=checks+1;
 perform set_config('request.headers',json_build_object('user-agent','Withdraw browser 2','x-forwarded-for','198.51.100.31')::text,true);
 perform public.submit_withdrawal('Mallory Fixture','victim-fixture@example.invalid','another-reference','again');
 if (select count(*) from public.outbox where kind='withdrawal_receipt' and to_email='victim-fixture@example.invalid')<>1 then raise exception 'FAIL second email to one address within a day'; end if; checks:=checks+1;
 for i in 1..6 loop
  perform set_config('request.headers',json_build_object('user-agent','Withdraw flood '||i,'x-forwarded-for','198.51.100.32')::text,true);
  out:=pg_temp.lc_err(format('select public.submit_withdrawal(%L,%L,%L,%L)','Flood','flood-'||i||'@example.invalid','ref-'||i,''));
  if i<=5 and out<>'ok' then raise exception 'FAIL withdrawal % refused: %',i,out; end if;
  if i=6 and out<>'slow_down' then raise exception 'FAIL sixth withdrawal from one address: %',out; end if;
 end loop; checks:=checks+1;

 -- 6. Reports: an illegal-content notice needs an explanation and a good-faith statement; the notifier gets an
 --    acknowledgement and the admin an alert. Three-argument calls from cached pages keep working.
 perform set_config('request.headers',json_build_object('user-agent','Report browser','x-forwarded-for','198.51.100.40')::text,true);
 if pg_temp.lc_err(format('select public.report_product(%L,%L,%L,null,false)',p->>'slug','illegal','This listing sells counterfeit goods, see the linked page.'))<>'invalid:notice' then raise exception 'FAIL notice without good faith accepted'; end if; checks:=checks+1;
 if pg_temp.lc_err(format('select public.report_product(%L,%L,%L,%L,true)',p->>'slug','illegal','too short','n@example.invalid'))<>'invalid:notice' then raise exception 'FAIL unsubstantiated notice accepted'; end if; checks:=checks+1;
 perform vault.create_secret('fixture-resend-key','resend_api_key');
 perform public.report_product(p->>'slug','illegal','This listing sells counterfeit goods; the linked shop page shows the fake logos.','notifier-fixture@example.invalid',true);
 if not exists(select 1 from public.reports where reason='illegal' and good_faith and notifier_email='notifier-fixture@example.invalid') then raise exception 'FAIL notice not stored'; end if; checks:=checks+1;
 if not exists(select 1 from public.outbox where kind='report_receipt' and to_email='notifier-fixture@example.invalid' and body not like '%counterfeit%') then raise exception 'FAIL notifier not acknowledged (or text echoed)'; end if; checks:=checks+1;
 if not exists(select 1 from public.outbox where kind='report_admin' and body like '%counterfeit%') then raise exception 'FAIL admin not alerted to the notice'; end if; checks:=checks+1;
 if not public.report_product(p->>'slug','broken_link','') then raise exception 'FAIL three-argument report'; end if; checks:=checks+1;

 raise notice '% launch safety assertions passed', checks;
end $$;
