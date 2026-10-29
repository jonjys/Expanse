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

-- Review findings on the first version of these fixes.
do $$
declare a jsonb; b jsonb; o jsonb; out text; adm text; checks int:=0; h timestamptz;
begin
 adm:=public._admin_issue();
 -- A refunded product that later chooses a new spot keeps that spot while its hold runs.
 a:=pg_temp.lc_mk('Review Alpha',90,50,2);
 o:=public.owner_map_checkout(a->>'slug',a->>'key','2026-10-20')::jsonb;
 perform pg_temp.lc_pay(pg_temp.lc_ev('evt_rv_a_paid','checkout.session.completed',o->>'id','cs_rv_a',1600,'outer',2,'pi_rv_a'));
 perform pg_temp.lc_pay('{"id":"evt_rv_a_refund","type":"charge.refunded","livemode":true,"payment_intent":"pi_rv_a","fully_refunded":true}');
 update expanse_private.map_purchases set ends_at=ends_at-interval '25 hours', created_at=created_at-interval '25 hours' where id=(o->>'id')::uuid;
 -- A day after the refund, a new checkout at the same spot is refused and does not keep the spot.
 out:=pg_temp.lc_err(format('select public.owner_map_checkout(%L,%L,%L)',a->>'slug',a->>'key','2026-10-20'));
 if out<>'hold_expired' then raise exception 'FAIL checkout after the renewal window: %',out; end if; checks:=checks+1;
 perform expanse_private.release_expired_map_spots();
 if (select zone||size from public.products where id=(a->>'id')::bigint)<>'edge1' then raise exception 'FAIL refunded spot released'; end if;
 out:=pg_temp.lc_err(format('select public.owner_choose_map_spot(%L,%L,90,55,2)',a->>'slug',a->>'key'));
 perform expanse_private.release_expired_map_spots();
 if out<>'ok' or (select x||','||y||','||size from public.products where id=(a->>'id')::bigint)<>'90,55,2' then raise exception 'FAIL new hold after a refund respected: %',out; end if; checks:=checks+1;
 -- A payment arriving on the refunded order leaves it refunded.
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_rv_a_late','checkout.session.completed',o->>'id','cs_rv_a2',1600,'outer',2,'pi_rv_a2'));
 if out<>'needs_review' or (select state||payment_intent from expanse_private.map_purchases where id=(o->>'id')::uuid)<>'refundedpi_rv_a' then raise exception 'FAIL refunded order rewritten'; end if; checks:=checks+1;

 -- Moving within a lapsed hold does not revive it; the product is released.
 b:=pg_temp.lc_mk('Review Bravo',25,-25,2);
 update public.products set map_hold_until=now()-interval '1 hour' where id=(b->>'id')::bigint;
 perform public.owner_choose_map_spot(b->>'slug',b->>'key',26,-25,2);
 h:=(select map_hold_until from public.products where id=(b->>'id')::bigint);
 perform expanse_private.release_expired_map_spots();
 if h>now() or (select zone||size from public.products where id=(b->>'id')::bigint)<>'edge1' then raise exception 'FAIL lapsed hold revived by a move'; end if; checks:=checks+1;
 -- From the free spot a new choice gets a fresh hold; moving within it keeps the deadline.
 perform public.owner_choose_map_spot(b->>'slug',b->>'key',25,-25,2);
 h:=(select map_hold_until from public.products where id=(b->>'id')::bigint);
 perform public.owner_choose_map_spot(b->>'slug',b->>'key',26,-25,2);
 if h<now()+interval '6 days' or (select map_hold_until from public.products where id=(b->>'id')::bigint)<>h then raise exception 'FAIL hold kept on move'; end if; checks:=checks+1;

 -- An order is reused for 12 hours only.
 o:=public.owner_map_checkout(b->>'slug',b->>'key','2026-10-20')::jsonb;
 update expanse_private.map_purchases set created_at=now()-interval '13 hours' where id=(o->>'id')::uuid;
 if (public.owner_map_checkout(b->>'slug',b->>'key','2026-10-20')::jsonb->>'id')=o->>'id' then raise exception 'FAIL old order reused'; end if; checks:=checks+1;

 -- Rejected -> hidden -> approved also moves a product off cells taken meanwhile.
 a:=pg_temp.lc_mk('Review Charlie',-30,60,2);
 perform public.admin_set_status(adm,a->>'slug','rejected','Fixture');
 b:=pg_temp.lc_mk('Review Delta',-145,30,1);
 perform public.owner_choose_map_spot(b->>'slug',b->>'key',-30,60,2);
 perform public.admin_set_status(adm,a->>'slug','hidden','Fixture');
 if (select zone||size from public.products where id=(a->>'id')::bigint)<>'edge1' then raise exception 'FAIL hidden path overlaps'; end if; checks:=checks+1;

 -- A paying product returning from review is never the one moved.
 a:=pg_temp.lc_mk('Review Echo',-60,-40,2);
 o:=public.owner_map_checkout(a->>'slug',a->>'key','2026-10-20')::jsonb;
 perform pg_temp.lc_pay(pg_temp.lc_ev('evt_rv_e_paid','checkout.session.completed',o->>'id','cs_rv_e',3600,'belt',2,'pi_rv_e'));
 perform public.admin_set_status(adm,a->>'slug','rejected','Fixture');
 b:=pg_temp.lc_mk('Review Foxtrot',-140,-30,1);
 update public.products set x=-60,y=-40,size=2,zone='belt' where id=(b->>'id')::bigint;  -- an overlap left by older code
 out:=pg_temp.lc_err(format('select public.admin_set_status(%L,%L,%L,%L)',adm,a->>'slug','approved',''));
 if out<>'spot_taken' or (select x||','||y from public.products where id=(a->>'id')::bigint)<>'-60,-40' then raise exception 'FAIL paying product moved: %',out; end if; checks:=checks+1;

 raise notice '% payment review regression assertions passed', checks;
end $$;

-- Honest-maker journeys from the second review.
do $$
declare a jsonb; o jsonb; out text; adm text; checks int:=0;
begin
 adm:=public._admin_issue();
 -- Re-approval after an edit leaves at least a day to pay, even if the hold ran out during review.
 a:=pg_temp.lc_mk('Journey Alpha',60,-60,2);
 perform public.owner_update(a->>'slug',a->>'key',jsonb_build_object('name','Journey Alpha','url','https://example.org/journey-alpha-new','tagline','Solves a lifecycle fixture problem','category','other','pricing','unspecified','needs','[]'::jsonb));
 if (select status from public.products where id=(a->>'id')::bigint)<>'pending' then raise exception 'FAIL edit sends to review'; end if;
 update public.products set map_hold_until=now()-interval '1 day' where id=(a->>'id')::bigint;
 perform public.admin_set_status(adm,a->>'slug','approved','');
 out:=pg_temp.lc_err(format('select public.owner_map_checkout(%L,%L,%L)',a->>'slug',a->>'key','2026-10-20'));
 if out<>'ok' then raise exception 'FAIL checkout after re-approval: %',out; end if; checks:=checks+1;

 -- An open order can be resumed after its hold ends and is still protected and payable.
 o:=public.owner_map_checkout(a->>'slug',a->>'key','2026-10-20')::jsonb;
 update public.products set map_hold_until=now()-interval '1 hour' where id=(a->>'id')::bigint;
 update expanse_private.map_purchases set created_at=now()-interval '3 hours' where id=(o->>'id')::uuid;
 if (public.owner_map_checkout(a->>'slug',a->>'key','2026-10-20')::jsonb->>'id')<>o->>'id' then raise exception 'FAIL resume after hold end'; end if;
 perform expanse_private.release_expired_map_spots();
 if (select zone||size from public.products where id=(a->>'id')::bigint)='edge1' then raise exception 'FAIL open order not protected'; end if;
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_jr_a_paid','checkout.session.completed',o->>'id','cs_jr_a',1600,'outer',2,'pi_jr_a'));
 if out<>'paid' then raise exception 'FAIL resumed order paid: %',out; end if; checks:=checks+1;

 -- A term that ended normally keeps its spot for the renewal window, and a renewal can be bought.
 update expanse_private.map_purchases set paid_at=paid_at-interval '12 months 1 hour', ends_at=now()-interval '1 hour', created_at=created_at-interval '12 months 2 hours' where id=(o->>'id')::uuid;
 perform expanse_private.release_expired_map_spots();
 if (select zone||size from public.products where id=(a->>'id')::bigint)<>'outer2' then raise exception 'FAIL renewal window not respected'; end if;
 out:=pg_temp.lc_err(format('select public.owner_map_checkout(%L,%L,%L)',a->>'slug',a->>'key','2026-10-20'));
 if out<>'ok' then raise exception 'FAIL renewal checkout: %',out; end if; checks:=checks+1;

 -- A delayed debit that is still processing after 48 hours keeps the order open and the spot protected.
 a:=pg_temp.lc_mk('Journey Bravo',-60,90,2);
 o:=public.owner_map_checkout(a->>'slug',a->>'key','2026-10-20')::jsonb;
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_jr_b_unpaid','checkout.session.completed',o->>'id','cs_jr_b',1600,'outer',2,'pi_jr_b','unpaid'));
 update expanse_private.map_purchases set created_at=now()-interval '3 days' where id=(o->>'id')::uuid;
 update public.products set map_hold_until=now()-interval '2 days' where id=(a->>'id')::bigint;
 perform expanse_private.release_expired_map_spots();
 if out<>'awaiting_payment' or (public.owner_map_status(a->>'slug',a->>'key')->>'state')<>'pending' or (select zone||size from public.products where id=(a->>'id')::bigint)<>'outer2' then raise exception 'FAIL processing debit keeps the order open'; end if;
 out:=pg_temp.lc_pay(pg_temp.lc_ev('evt_jr_b_paid','checkout.session.async_payment_succeeded',o->>'id','cs_jr_b',1600,'outer',2,'pi_jr_b','paid',now()-interval '3 days'));
 if out<>'paid' then raise exception 'FAIL delayed debit paid: %',out; end if; checks:=checks+1;

 raise notice '% payment journey assertions passed', checks;
end $$;
