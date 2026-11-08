-- Executed only inside BEGIN ... ROLLBACK after payment_lifecycle.sql (uses its pg_temp helpers, webhook key and
-- notify_email). Launch safety migration 20261108160000.
do $$
declare checks int:=0; p jsonb; p6 jsonb; r json; out text; v_body text; i int; k int;
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
  if i=11 and out<>'too_many' then raise exception 'FAIL eleventh submission from one address: %',out; end if;
 end loop; checks:=checks+1;

 -- 5. Every withdrawal notice is acknowledged by email (up to three a day per address) without relaying free text;
 --    the on-screen receipt keeps every detail.
 perform set_config('request.headers',json_build_object('user-agent','Withdraw browser 1','x-forwarded-for','198.51.100.30')::text,true);
 r:=public.submit_withdrawal('Mallory www.evil-name.example','victim-fixture@example.invalid','see https://evil-ref.example/x','Click https://evil.example/phish now');
 select o.body into v_body from public.outbox o where o.kind='withdrawal_receipt' and o.to_email='victim-fixture@example.invalid' order by o.id desc limit 1;
 if v_body is null or v_body like '%evil%' or v_body like '%Click%' or v_body like '%Mallory%' then raise exception 'FAIL emailed acknowledgement echoes caller text: %',v_body; end if; checks:=checks+1;
 if r->>'receipt' not like '%evil.example/phish%' or r->>'receipt' not like '%evil-ref.example%' then raise exception 'FAIL on-screen receipt lost the details'; end if; checks:=checks+1;
 perform set_config('request.headers',json_build_object('user-agent','Withdraw browser 2','x-forwarded-for','198.51.100.31')::text,true);
 r:=public.submit_withdrawal('Erika Fixture','victim-fixture@example.invalid','Order 12345','second order');
 if (r->>'emailed')::boolean is not true then raise exception 'FAIL second notice not acknowledged'; end if;
 select o.body into v_body from public.outbox o where o.kind='withdrawal_receipt' and o.to_email='victim-fixture@example.invalid' order by o.id desc limit 1;
 if v_body not like '%Reference given: Order 12345%' or v_body not like '%Name: Erika Fixture%' or v_body like '%second order%' then raise exception 'FAIL acknowledgement lacks the safe parts of the notice: %',v_body; end if; checks:=checks+1;
 perform set_config('request.headers',json_build_object('user-agent','Withdraw browser 3','x-forwarded-for','198.51.100.33')::text,true);
 perform public.submit_withdrawal('Third Fixture','victim-fixture@example.invalid','third-ref','');
 perform set_config('request.headers',json_build_object('user-agent','Withdraw browser 4','x-forwarded-for','198.51.100.34')::text,true);
 r:=public.submit_withdrawal('Fourth Fixture','victim-fixture@example.invalid','fourth-ref','');
 if (r->>'emailed')::boolean is not false or (select count(*) from public.outbox where kind='withdrawal_receipt' and to_email='victim-fixture@example.invalid')<>3 then raise exception 'FAIL more than three acknowledgements to one address a day'; end if; checks:=checks+1;
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
 -- A first notice without an email, then the same notice again with one: merged, and the receipt goes out.
 r:=public.report_product(p->>'slug','illegal','This listing sells counterfeit goods; the linked shop page shows the fake logos.',null,true);
 if (r->>'receipt')::boolean then raise exception 'FAIL receipt without an email'; end if;
 r:=public.report_product(p->>'slug','illegal','This listing sells counterfeit goods; the linked shop page shows the fake logos.','notifier-fixture@example.invalid',true);
 if (r->>'receipt')::boolean is not true then raise exception 'FAIL resubmitted notice with an email got no receipt'; end if;
 if (select count(*) from public.reports where reason='illegal' and product_id=(p->>'id')::bigint)<>1 then raise exception 'FAIL resubmitted notice duplicated'; end if; checks:=checks+1;
 if not exists(select 1 from public.reports where reason='illegal' and good_faith and notifier_email='notifier-fixture@example.invalid') then raise exception 'FAIL notice not stored'; end if; checks:=checks+1;
 if not exists(select 1 from public.outbox where kind='report_receipt' and to_email='notifier-fixture@example.invalid' and body not like '%counterfeit%') then raise exception 'FAIL notifier not acknowledged (or text echoed)'; end if; checks:=checks+1;
 if not exists(select 1 from public.outbox where kind='report_admin' and body like '%counterfeit%') then raise exception 'FAIL admin not alerted to the notice'; end if; checks:=checks+1;
 if (public.report_product(p->>'slug','broken_link','')->>'ok')::boolean is not true then raise exception 'FAIL three-argument report'; end if; checks:=checks+1;
 -- Receipts are capped per recipient, ignoring +tags.
 for i in 1..4 loop
  perform set_config('request.headers',json_build_object('user-agent','Receipt browser '||i,'x-forwarded-for','198.51.100.'||(50+i))::text,true);
  perform public.report_product(p->>'slug','wrong_info','Receipt cap fixture','cap+'||i||'@example.invalid',false);
 end loop;
 if (select count(*) from public.outbox where kind='report_receipt' and to_email like 'cap+%@example.invalid')<>3 then raise exception 'FAIL report receipts not capped per recipient'; end if; checks:=checks+1;
 if not exists(select 1 from json_array_elements(public.admin_reports(public._admin_issue())) e where e->>'notifier_email'='notifier-fixture@example.invalid' and (e->>'good_faith')::boolean) then raise exception 'FAIL admin cannot see the notifier'; end if; checks:=checks+1;

 -- 7. Vote-and-withdraw cycles cannot lock other voters out: only live votes count toward the hourly cap.
 for i in 1..5 loop
  for k in 1..60 loop
   perform set_config('request.headers',json_build_object('user-agent','Cycle '||k,'x-forwarded-for','203.0.113.'||i)::text,true);
   perform public.upvote(p6->>'slug','cyclevoter'||lpad(i::text,3,'0')||lpad(k::text,8,'0'),true);
   perform public.upvote(p6->>'slug','cyclevoter'||lpad(i::text,3,'0')||lpad(k::text,8,'0'),false);
  end loop;
 end loop;
 perform set_config('request.headers',json_build_object('user-agent','Legit browser','x-forwarded-for','203.0.113.200')::text,true);
 if pg_temp.lc_err(format('select public.upvote(%L,%L,true)',p6->>'slug','legitvoter0000000001'))<>'ok' then raise exception 'FAIL withdrawn votes locked out a real voter'; end if; checks:=checks+1;

 raise notice '% launch safety assertions passed', checks;
end $$;
