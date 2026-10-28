-- Executed only inside BEGIN ... ROLLBACK with commerce.sql (cron off, worker calls stubbed).
-- Map payment lifecycle: sessions, review safety net, nightly release, lapsed checkouts,
-- rejected products' cells and withdrawal references.
create function pg_temp.lc_mk(p_name text,p_x int,p_y int,p_size int) returns jsonb language plpgsql as $f$
declare r json; begin
 r:=public.submit_product(jsonb_build_object('name',p_name,'url','https://example.com/'||md5(p_name),'tagline','Solves a lifecycle fixture problem','category','other','pricing','unspecified','needs','[]'::jsonb,'email',md5(p_name)||'@example.invalid','x',p_x,'y',p_y,'size',p_size));
 update public.products set created_at=now()-interval '2 hours',submit_hash=null,status='approved' where slug=r->>'slug';
 return jsonb_build_object('slug',r->>'slug','key',r->>'key','id',(select id from public.products where slug=r->>'slug'));
end $f$;
create function pg_temp.lc_ev(p_id text,p_type text,p_ref text,p_session text,p_amount int,p_zone text,p_size int,p_pi text,p_status text default 'paid',p_created timestamptz default now()) returns jsonb language sql as $f$
 select jsonb_build_object('id',p_id,'type',p_type,'livemode',true,'app','expanse','kind','map_placement','zone',p_zone,'size',p_size,'reference',p_ref,
  'session_id',p_session,'session_created',extract(epoch from p_created)::bigint,'payment_status',p_status,'currency','eur','amount_total',p_amount,
  'payment_link','plink_lc_'||p_zone||p_size,'payment_intent',p_pi)
$f$;
create function pg_temp.lc_pay(e jsonb) returns text language sql as $f$ select public.confirm_map_payment('fixture-token-0123456789012345678901234567890123456789',e)->>'outcome' $f$;
create function pg_temp.lc_err(q text) returns text language plpgsql as $f$ begin execute q; return 'ok'; exception when others then return sqlerrm; end $f$;

do $$
declare a jsonb; b jsonb; c jsonb; o jsonb; out text; checks int:=0;
begin
 update expanse_private.commerce_config set enabled=true,webhook_key_hash=public._key_hash('fixture-token-0123456789012345678901234567890123456789');
 insert into expanse_private.map_catalog(zone,size,amount_cents,payment_link,url)
 select z,s,public.map_price_cents(z,s),'plink_lc_'||z||s,'https://buy.stripe.com/lc'||z||s
 from unnest(array['edge','outer','belt','inner']) z cross join unnest(array[1,2,4,8]) s
 on conflict(zone,size) do update set amount_cents=excluded.amount_cents,payment_link=excluded.payment_link,url=excluded.url;
 perform public._set_setting('notify_email','"lifecycle-admin@example.invalid"'::jsonb);

 -- 1. Session A expires, session B on the same order is paid: the placement is granted.
 a:=pg_temp.lc_mk('Lifecycle Alpha',100,-30,2);
 o:=public.owner_map_checkout(a->>'slug',a->>'key','2026-10-20')::jsonb;
 if (public.owner_map_checkout(a->>'slug',a->>'key','2026-10-20')::jsonb->>'id')<>o->>'id' then raise exception 'FAIL resumed checkout reuses the order'; end if;
 if pg_temp.lc_pay(pg_temp.lc_ev('evt_lc_a_expired','checkout.session.expired',o->>'id','cs_lc_a1',1600,'outer',2,null,'unpaid'))<>'failed' then raise exception 'FAIL expiry recorded'; end if;
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_lc_a_paid','checkout.session.completed',o->>'id','cs_lc_a2',1600,'outer',2,'pi_lc_a2'));
 if out<>'paid' or (public.owner_map_status(a->>'slug',a->>'key')->>'state')<>'paid' then raise exception 'FAIL paid sibling session after expiry: %',out; end if; checks:=checks+1;
 if (select map_hold_until from public.products where id=(a->>'id')::bigint) is not null then raise exception 'FAIL hold cleared once paid'; end if; checks:=checks+1;

 -- 2. The hold ends while a checkout is open: the nightly job waits, the payment is granted, the spot stays protected.
 b:=pg_temp.lc_mk('Lifecycle Bravo',100,30,2);
 o:=public.owner_map_checkout(b->>'slug',b->>'key','2026-10-20')::jsonb;
 update public.products set map_hold_until=now()-interval '1 minute' where id=(b->>'id')::bigint;
 perform expanse_private.release_expired_map_spots();
 if (select size from public.products where id=(b->>'id')::bigint)<>2 then raise exception 'FAIL release moved a product with an open checkout'; end if; checks:=checks+1;
 c:=pg_temp.lc_mk('Lifecycle Charlie',-140,0,1);
 if pg_temp.lc_err(format('select public.owner_choose_map_spot(%L,%L,100,30,2)',c->>'slug',c->>'key'))<>'spot_taken' then raise exception 'FAIL held spot taken during checkout'; end if; checks:=checks+1;
 if pg_temp.lc_pay(pg_temp.lc_ev('evt_lc_b_paid','checkout.session.completed',o->>'id','cs_lc_b',1600,'outer',2,'pi_lc_b'))<>'paid' then raise exception 'FAIL payment after hold end'; end if; checks:=checks+1;
 raise notice '% payment session and hold assertions passed', checks;
end $$;

do $$
declare a jsonb; b jsonb; c jsonb; o jsonb; out text; adm text; checks int:=0; mails int; st jsonb; wid uuid;
begin
 adm:=public._admin_issue();
 -- 4. An abandoned checkout lapses after 48 hours: status is free and the spot can be changed; before that it is locked.
 a:=pg_temp.lc_mk('Lifecycle Echo',-100,-30,2);
 o:=public.owner_map_checkout(a->>'slug',a->>'key','2026-10-20')::jsonb;
 update expanse_private.map_purchases set created_at=now()-interval '30 hours' where id=(o->>'id')::uuid;
 if (public.owner_map_status(a->>'slug',a->>'key')->>'state')<>'pending' then raise exception 'FAIL open checkout status'; end if;
 out:=pg_temp.lc_err(format('select public.owner_choose_map_spot(%L,%L,-100,-40,2)',a->>'slug',a->>'key'));
 if out<>'checkout_open' then raise exception 'FAIL open checkout lock: %',out; end if; checks:=checks+1;
 update expanse_private.map_purchases set created_at=now()-interval '49 hours' where id=(o->>'id')::uuid;
 if (public.owner_map_status(a->>'slug',a->>'key')->>'state')<>'free' then raise exception 'FAIL lapsed checkout status'; end if;
 out:=pg_temp.lc_err(format('select public.owner_choose_map_spot(%L,%L,-100,-40,2)',a->>'slug',a->>'key'));
 if out<>'ok' then raise exception 'FAIL lapsed checkout still blocks: %',out; end if; checks:=checks+1;

 -- 2. A payment that needs review keeps its Stripe ids, alerts the admin and can be refunded.
 b:=pg_temp.lc_mk('Lifecycle Foxtrot',60,40,2);
 o:=public.owner_map_checkout(b->>'slug',b->>'key','2026-10-20')::jsonb;
 select count(*) into mails from public.outbox where kind='map_review' and to_email='lifecycle-admin@example.invalid';
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_lc_f_wrong','checkout.session.completed',o->>'id','cs_lc_f',9999,'belt',2,'pi_lc_f'));
 if out<>'needs_review' then raise exception 'FAIL amount mismatch accepted'; end if;
 if not exists(select 1 from expanse_private.map_purchases where id=(o->>'id')::uuid and state='needs_review' and session_id='cs_lc_f' and payment_intent='pi_lc_f') then raise exception 'FAIL review keeps Stripe ids'; end if; checks:=checks+1;
 if (select count(*) from public.outbox where kind='map_review' and to_email='lifecycle-admin@example.invalid')<>mails+1 then raise exception 'FAIL admin not told about review'; end if; checks:=checks+1;
 out:=pg_temp.lc_pay('{"id":"evt_lc_f_refund","type":"charge.refunded","livemode":true,"payment_intent":"pi_lc_f","fully_refunded":true}');
 if out<>'refunded' or not exists(select 1 from expanse_private.map_purchases where id=(o->>'id')::uuid and state='refunded') then raise exception 'FAIL refund of reviewed payment: %',out; end if; checks:=checks+1;
 -- A second payment on an order that is already paid is reviewed, and its refund is recorded against it.
 o:=public.owner_map_checkout(b->>'slug',b->>'key','2026-10-20')::jsonb;
 if pg_temp.lc_pay(pg_temp.lc_ev('evt_lc_f_paid','checkout.session.completed',o->>'id','cs_lc_f2',3600,'belt',2,'pi_lc_f2'))<>'paid' then raise exception 'FAIL retry after review'; end if;
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_lc_f_twice','checkout.session.completed',o->>'id','cs_lc_f3',3600,'belt',2,'pi_lc_f3'));
 if out<>'needs_review' then raise exception 'FAIL second payment reviewed: %',out; end if;
 out:=pg_temp.lc_pay('{"id":"evt_lc_f3_refund","type":"charge.refunded","livemode":true,"payment_intent":"pi_lc_f3","fully_refunded":true}');
 if out<>'review_refunded' or (select state from expanse_private.map_purchases where id=(o->>'id')::uuid)<>'paid' then raise exception 'FAIL second payment refund: %',out; end if; checks:=checks+1;

 -- 5. A rejected product keeps its paid cells; a product coming back from review onto taken cells moves to a free Edge cell.
 perform public.admin_set_status(adm,b->>'slug','rejected','Fixture: changes needed');
 c:=pg_temp.lc_mk('Lifecycle Golf',-140,10,1);
 if pg_temp.lc_err(format('select public.owner_choose_map_spot(%L,%L,60,40,2)',c->>'slug',c->>'key'))<>'spot_taken' then raise exception 'FAIL paid cells of rejected product taken'; end if; checks:=checks+1;
 a:=pg_temp.lc_mk('Lifecycle Hotel',30,-20,2);
 perform public.admin_set_status(adm,a->>'slug','rejected','Fixture: changes needed');
 if pg_temp.lc_err(format('select public.owner_choose_map_spot(%L,%L,30,-20,2)',c->>'slug',c->>'key'))<>'ok' then raise exception 'FAIL unpaid rejected cells stay free'; end if;
 perform public.admin_set_status(adm,a->>'slug','approved','');
 if (select count(*) from public.products where status in ('pending','approved','hidden') and x<32 and x+size>30 and y<-18 and y+size>-20)<>1
   or (select zone||size from public.products where id=(a->>'id')::bigint)<>'edge1' then raise exception 'FAIL returning product overlaps'; end if; checks:=checks+1;

 -- 3. Refunds keep their state through the nightly job, which moves the product once.
 a:=pg_temp.lc_mk('Lifecycle India',90,-60,2);
 o:=public.owner_map_checkout(a->>'slug',a->>'key','2026-10-20')::jsonb;
 perform pg_temp.lc_pay(pg_temp.lc_ev('evt_lc_i_paid','checkout.session.completed',o->>'id','cs_lc_i',1600,'outer',2,'pi_lc_i'));
 perform pg_temp.lc_pay('{"id":"evt_lc_i_refund","type":"charge.refunded","livemode":true,"payment_intent":"pi_lc_i","fully_refunded":true}');
 perform expanse_private.release_expired_map_spots();
 if (select zone||size from public.products where id=(a->>'id')::bigint)<>'edge1' or (select state from expanse_private.map_purchases where id=(o->>'id')::uuid)<>'refunded' then raise exception 'FAIL refund state kept'; end if;
 st:=jsonb_build_object('x',(select x from public.products where id=(a->>'id')::bigint),'y',(select y from public.products where id=(a->>'id')::bigint));
 perform expanse_private.release_expired_map_spots();
 if (select x from public.products where id=(a->>'id')::bigint)<>(st->>'x')::int or (select y from public.products where id=(a->>'id')::bigint)<>(st->>'y')::int then raise exception 'FAIL product moved again'; end if; checks:=checks+1;

 -- 6. A withdrawal reference in any case or with surrounding text is linked to its order.
 perform public.submit_withdrawal('Lifecycle Fixture','lifecycle-withdraw@example.invalid','Order '||upper(o->>'id'),'Fixture notice');
 if not exists(select 1 from expanse_private.withdrawals where purchase_id=(o->>'id')::uuid) then raise exception 'FAIL withdrawal link'; end if; checks:=checks+1;

 raise notice '% payment lifecycle assertions passed', checks;
end $$;
