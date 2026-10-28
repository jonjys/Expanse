-- Map payment lifecycle fixes from the launch verification on 2026-10-28.
-- Every case below was reproduced on a disposable local database first.
--  1. A paid session is accepted even when a sibling session on the same order expired or failed.
--  2. A payment that needs review is never silent: Stripe ids are kept, the admin gets an email,
--     and a refund of that payment is recorded.
--  3. The nightly job leaves a product alone while a checkout opened in time for its spot can
--     still be paid, respects a running hold, only counts an ended term at the product's current
--     spot, never moves a product that already sits on a free Edge 1x1 cell, and keeps refunded
--     and disputed states. A renewal checkout is possible for 24 hours after a term ends.
--  4. An unpaid checkout lapses after 48 hours, the same window in which its sessions can be paid,
--     and the spot can be changed after that. An order is reused for 12 hours, so every session
--     opened from a returned link is inside the 24-hour acceptance window.
--  5. A rejected product keeps its cells while its paid term runs, and a product coming back from
--     review is moved to a free Edge cell when its old cells were taken, never a paying one.
--  6. A withdrawal notice is linked to its order whenever the reference contains the order id.
--  7. A hold is armed on the first approval and on a move from the free spot or from no hold;
--     moving or re-approval never extends a running hold or revives a lapsed one.
-- Owner, admin and webhook credential checks, server-side prices and terms acceptance are unchanged.

alter table expanse_private.stripe_events add column if not exists payment_intent text;
create index if not exists stripe_events_payment_intent_idx on expanse_private.stripe_events(payment_intent) where payment_intent is not null;

-- 5. Cells of a rejected product with an active paid term stay taken.
create or replace function public._assert_free(p_x int, p_y int, p_size int, p_ignore_product bigint, p_ignore_email text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if public.zone_of(p_x, p_y, p_size) = 'core' then raise exception 'core_invite_only'; end if;
  if sqrt(power(p_x + p_size / 2.0, 2) + power(p_y + p_size / 2.0, 2)) > 175 then raise exception 'out_of_bounds'; end if;
  if exists (
    select 1 from public.reservations r
    where r.email is distinct from p_ignore_email
      and r.x < p_x + p_size and p_x < r.x + r.size and r.y < p_y + p_size and p_y < r.y + r.size)
  or exists (
    select 1 from public.products q
    where (q.status in ('pending', 'approved', 'hidden')
           or (q.status = 'rejected' and exists (select 1 from expanse_private.map_purchases b where b.product_id = q.id and b.state = 'paid' and b.ends_at > now())))
      and q.id is distinct from p_ignore_product
      and q.x < p_x + p_size and p_x < q.x + q.size and q.y < p_y + p_size and p_y < q.y + q.size)
  then raise exception 'spot_taken'; end if;
end $$;

-- The first free 1x1 Edge cell, using the same occupancy rules as _assert_free.
create or replace function expanse_private.free_edge_cell(p_ignore bigint) returns table(x int, y int)
language sql stable security definer set search_path = '' as $$
 select g.x, g.y from generate_series(126,174) as ring(radius) cross join generate_series(0,359) as turn(angle)
 cross join lateral (select round(ring.radius*cos(turn.angle*pi()/180))::int as x, round(ring.radius*sin(turn.angle*pi()/180))::int as y) g
 where public.zone_of(g.x,g.y,1)='edge' and sqrt(power(g.x+.5,2)+power(g.y+.5,2))<175
 and not exists(select 1 from public.products q where q.id is distinct from p_ignore
   and (q.status in ('pending','approved','hidden')
        or (q.status='rejected' and exists(select 1 from expanse_private.map_purchases b where b.product_id=q.id and b.state='paid' and b.ends_at>now())))
   and q.x<g.x+1 and g.x<q.x+q.size and q.y<g.y+1 and g.y<q.y+q.size)
 and not exists(select 1 from public.reservations q where q.x<g.x+1 and g.x<q.x+q.size and q.y<g.y+1 and g.y<q.y+q.size)
 limit 1
$$;
revoke execute on function expanse_private.free_edge_cell(bigint) from public, anon, authenticated;

-- 5. A product leaving review whose cells were taken meanwhile moves to a free Edge cell instead of overlapping.
create or replace function expanse_private.unreject_spot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare point record;
begin
 if old.status = 'rejected' and new.status in ('pending','approved','hidden') then
   -- Same map lock as every other writer of product positions.
   perform pg_advisory_xact_lock(4242);
   begin
     perform public._assert_free(new.x, new.y, new.size, new.id, null);
   exception when others then
     -- A product with an active paid term keeps the cells it paid for; the admin resolves the conflict.
     if exists(select 1 from expanse_private.map_purchases b where b.product_id=new.id and b.state='paid' and b.ends_at>now()) then raise exception 'spot_taken'; end if;
     select * into point from expanse_private.free_edge_cell(new.id);
     if point.x is null then raise exception 'spot_taken'; end if;
     new.x := point.x; new.y := point.y; new.size := 1; new.zone := 'edge'; new.price_eur := 1; new.map_hold_until := null;
   end;
 end if;
 return new;
end $$;
revoke execute on function expanse_private.unreject_spot() from public, anon, authenticated;
drop trigger if exists unreject_spot on public.products;
create trigger unreject_spot before update of status on public.products for each row execute function expanse_private.unreject_spot();

-- 1, 2. Webhook confirmation.
create or replace function public.confirm_map_payment(p_token text,p_event jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare b expanse_private.map_purchases; r public.products; v_id uuid; v_event text:=p_event->>'id';
 v_type text:=p_event->>'type'; v_session text:=p_event->>'session_id'; v_pi text:=p_event->>'payment_intent'; v_out text; v_review uuid;
begin
 if p_token is null or char_length(p_token)<40 or public._key_hash(p_token) is distinct from
   (select webhook_key_hash from expanse_private.commerce_config where singleton) then raise exception 'forbidden'; end if;
 if v_event is null or v_event !~ '^evt_[a-zA-Z0-9_]+$' then raise exception 'invalid:event'; end if;
 if coalesce((p_event->>'livemode')::boolean,false) is not true then return json_build_object('outcome','ignored_test'); end if;
 perform pg_advisory_xact_lock(4242);
 if exists(select 1 from expanse_private.stripe_events where event_id=v_event) then return json_build_object('outcome','duplicate'); end if;
 if v_type in ('charge.refunded','charge.dispute.created') then
   if v_pi is null then return json_build_object('outcome','unrelated'); end if;
   select * into b from expanse_private.map_purchases where payment_intent=v_pi and state in ('paid','needs_review')
   order by (state='paid') desc limit 1 for update;
   if b.id is null then
     -- A second payment for an order that was already paid only exists on its review event.
     select purchase_id into v_review from expanse_private.stripe_events where payment_intent=v_pi and outcome='needs_review' order by created_at desc limit 1;
     if v_review is null then return json_build_object('outcome','unrelated'); end if;
     if v_type='charge.refunded' and not coalesce((p_event->>'fully_refunded')::boolean,false) then return json_build_object('outcome','partial_refund'); end if;
     v_out:=case when v_type='charge.refunded' then 'review_refunded' else 'review_disputed' end;
     insert into expanse_private.stripe_events(event_id,purchase_id,outcome,payment_intent) values(v_event,v_review,v_out,v_pi);
     return json_build_object('outcome',v_out);
   end if;
   if v_type='charge.refunded' and not coalesce((p_event->>'fully_refunded')::boolean,false) then return json_build_object('outcome','partial_refund'); end if;
   v_out:=case when v_type='charge.refunded' then 'refunded' else 'disputed' end;
   update expanse_private.map_purchases set state=v_out,ends_at=case when b.state='paid' then least(ends_at,now()) else ends_at end where id=b.id;
   insert into expanse_private.stripe_events(event_id,purchase_id,outcome,payment_intent) values(v_event,b.id,v_out,v_pi);
   return json_build_object('outcome',v_out);
 end if;
 if p_event->>'app' is distinct from 'expanse' or p_event->>'kind' is distinct from 'map_placement' then return json_build_object('outcome','unrelated'); end if;
 begin v_id:=(p_event->>'reference')::uuid; exception when others then return json_build_object('outcome','missing_reference'); end;
 select * into b from expanse_private.map_purchases where id=v_id for update;
 if b.id is null then return json_build_object('outcome','unknown_order'); end if;
 if v_type='checkout.session.completed' and p_event->>'payment_status'<>'paid' then return json_build_object('outcome','awaiting_payment'); end if;
 if v_type in ('checkout.session.async_payment_failed','checkout.session.expired') then
   -- One session ending unpaid does not end the order: the owner may have paid in another session.
   update expanse_private.map_purchases set state='failed' where id=b.id and state='pending';
   insert into expanse_private.stripe_events(event_id,session_id,purchase_id,outcome,payment_intent) values(v_event,v_session,b.id,'failed',v_pi);
   return json_build_object('outcome','failed');
 end if;
 if v_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') then return json_build_object('outcome','ignored'); end if;
 select * into r from public.products where id=b.product_id for update;
 v_out := case
   when b.state='paid' and b.session_id=v_session then 'duplicate'
   when b.state not in ('pending','failed') then 'needs_review'
   when p_event->>'payment_status' is distinct from 'paid' or p_event->>'currency' is distinct from 'eur'
     or p_event->>'payment_link' is distinct from b.payment_link
     or (p_event->>'amount_total')::int is distinct from b.amount_cents
     or p_event->>'zone' is distinct from b.zone or (p_event->>'size')::int is distinct from b.size then 'needs_review'
   when r.status<>'approved' or r.x<>b.x or r.y<>b.y or r.size<>b.size then 'needs_review'
   when to_timestamp((p_event->>'session_created')::bigint)>b.created_at+interval '24 hours' then 'needs_review'
   when exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()) then 'needs_review'
   else 'paid' end;
 if v_out='paid' then
   update expanse_private.map_purchases set state='paid',paid_at=now(),ends_at=now()+interval '12 months',session_id=v_session,
      payment_intent=v_pi,issue='' where id=b.id;
   -- The reservation hold has done its job; it must not block a renewal at the same spot later.
   update public.products set map_hold_until=null where id=r.id and map_hold_until is not null;
 elsif v_out='needs_review' then
   -- Only an order still waiting for its payment is rewritten. A paid, refunded, disputed or expired order keeps
   -- its state; this payment's ids are on its review event, which a refund or dispute of it is matched against.
   if b.state in ('pending','failed') then
     update expanse_private.map_purchases set state='needs_review',issue='Payment needs manual review. Contact support before paying again.',
       session_id=case when v_session is not null and not exists(select 1 from expanse_private.map_purchases q where q.session_id=v_session and q.id<>b.id) then v_session else session_id end,
       payment_intent=coalesce(v_pi,payment_intent) where id=b.id;
   end if;
 end if;
 insert into expanse_private.stripe_events(event_id,session_id,purchase_id,outcome,payment_intent) values(v_event,v_session,b.id,v_out,v_pi);
 return json_build_object('outcome',v_out);
end $$;

-- 2. Tell the admin about every payment that needs review.
create or replace function expanse_private.alert_payment_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare admin_email text:=coalesce(public._setting('notify_email')#>>'{}',''); b expanse_private.map_purchases; r public.products;
begin
 if new.outcome<>'needs_review' or admin_email='' then return new; end if;
 select * into b from expanse_private.map_purchases where id=new.purchase_id;
 select * into r from public.products where id=b.product_id;
 insert into public.outbox(to_email,subject,body,kind,product_id) values(admin_email,'Expanse — a map payment needs review',
   left(E'A Stripe payment for a map placement could not be confirmed automatically, so no spot was granted.\nOrder: '||coalesce(b.id::text,'unknown')
   ||E'\nOrder state: '||coalesce(b.state,'unknown')||E'\nProduct: '||coalesce(r.name,'unknown')||' ('||coalesce(r.slug,'unknown')||')'
   ||E'\nStripe event: '||new.event_id||E'\nCheckout session: '||coalesce(new.session_id,'unknown')||E'\nPayment intent: '||coalesce(new.payment_intent,'unknown')
   ||E'\n\nCheck the payment in Stripe and in https://expanse.nyttolabs.com/admin before granting a spot or refunding. The maker sees “Payment needs review” and is asked to contact support.',6000),
   'map_review',r.id);
 perform public._kick_worker('mail');
 return new;
end $$;
revoke execute on function expanse_private.alert_payment_review() from public, anon, authenticated;
drop trigger if exists alert_payment_review on expanse_private.stripe_events;
create trigger alert_payment_review after insert on expanse_private.stripe_events for each row execute function expanse_private.alert_payment_review();

-- 3. Nightly release of lapsed holds and ended terms.
create or replace function expanse_private.release_expired_map_spots() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products; point record; n int:=0;
begin
 perform pg_advisory_xact_lock(4242);
 for r in select p.* from public.products p where p.status in ('pending','approved','hidden','rejected')
 and not (p.zone='edge' and p.size=1)
 and (p.map_hold_until is null or p.map_hold_until<=now())
 and (exists(select 1 from expanse_private.map_purchases b where b.product_id=p.id and b.state in ('paid','refunded','disputed') and b.ends_at<=now()
        and b.x=p.x and b.y=p.y and b.size=p.size)
      or (p.status='approved' and p.map_hold_until<=now()))
 and not exists(select 1 from expanse_private.map_purchases b where b.product_id=p.id and b.state='paid' and b.ends_at>now())
 -- A checkout opened for this spot can be paid for up to 48 hours (a session lives 24 hours and is accepted when opened within
 -- 24 hours of the order). Only a checkout opened before the spot fell due, or within the 24-hour renewal window after it,
 -- counts, so opening new checkouts cannot keep a spot.
 and not exists(select 1 from expanse_private.map_purchases b where b.product_id=p.id and b.state in ('pending','failed') and b.created_at>now()-interval '48 hours'
   and b.x=p.x and b.y=p.y and b.size=p.size
   and b.created_at<=coalesce(p.map_hold_until,(select max(e.ends_at) from expanse_private.map_purchases e where e.product_id=p.id
       and e.state in ('paid','refunded','disputed') and e.x=p.x and e.y=p.y and e.size=p.size))+interval '24 hours')
 loop
   select * into point from expanse_private.free_edge_cell(r.id);
   if point.x is not null then
     update public.products set x=point.x,y=point.y,size=1,zone='edge',price_eur=1,map_hold_until=null where id=r.id;
     n:=n+1;
   end if;
 end loop;
 -- Only a paid term expires. Refunded and disputed purchases keep that state for withdrawal and dispute review.
 update expanse_private.map_purchases b set state='expired' where b.state='paid' and b.ends_at<=now()
 and exists(select 1 from public.products p where p.id=b.product_id and (p.x<>b.x or p.y<>b.y or p.size<>b.size or (p.zone='edge' and p.size=1)));
 return n;
end $$;

-- 4. What the owner panel shows.
create or replace function public.owner_map_status(p_slug text,p_key text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug,p_key); b expanse_private.map_purchases; st text;
begin
 select * into b from expanse_private.map_purchases where product_id=r.id
 order by (state='paid' and ends_at>now()) desc,created_at desc limit 1;
 st:=case when b.state='paid' and b.ends_at<=now() then 'expired'
   -- An order whose sessions can no longer be paid is over; the owner can choose a spot again.
   when b.state in ('pending','failed') and b.created_at<=now()-interval '48 hours' then 'free'
   else coalesce(b.state,'free') end;
 return json_build_object('state',st,
   'hold_until',r.map_hold_until,'ends_at',b.ends_at,'paid_at',b.paid_at,'issue',case when st='free' then null else b.issue end,
   'zone',r.zone,'size',r.size,'amount_cents',case when b.state='paid' then b.amount_cents else public.map_price_cents(r.zone,r.size) end,
   'can_pay',r.status='approved'
     and not exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()));
end $$;

-- Checkout: a renewal at the same spot is possible for 24 hours after a term ends; an order is reused for 12 hours.
create or replace function expanse_private.owner_map_checkout(p_slug text,p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug,p_key); m expanse_private.map_catalog; b expanse_private.map_purchases;
begin
 if r.status <> 'approved' then raise exception 'review_required'; end if;
 if r.map_hold_until is not null and r.map_hold_until<=now() and not (r.zone='edge' and r.size=1) then raise exception 'hold_expired'; end if;
 if r.map_hold_until is null and not (r.zone='edge' and r.size=1)
   and (select max(e.ends_at) from expanse_private.map_purchases e where e.product_id=r.id and e.state in ('paid','refunded','disputed','expired')
        and e.ends_at<=now() and e.x=r.x and e.y=r.y and e.size=r.size)+interval '24 hours'<now() then raise exception 'hold_expired'; end if;
 if not (select enabled from expanse_private.commerce_config where singleton) then raise exception 'payments_paused'; end if;
 perform pg_advisory_xact_lock(4242);
 select * into r from public.products where id=r.id for update;
 if exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()) then raise exception 'already_paid'; end if;
 select * into m from expanse_private.map_catalog where zone=r.zone and size=r.size;
 if m.zone is null or m.amount_cents <> public.map_price_cents(r.zone,r.size) then raise exception 'payments_paused'; end if;
 select * into b from expanse_private.map_purchases where product_id=r.id and state='pending' and x=r.x and y=r.y and size=r.size
 and payment_link=m.payment_link and amount_cents=m.amount_cents and created_at>now()-interval '12 hours' order by created_at desc limit 1;
 if b.id is null then
   if (select count(*) from expanse_private.map_purchases where product_id=r.id and created_at>now()-interval '1 hour')>=5 then raise exception 'too_many'; end if;
   insert into expanse_private.map_purchases(product_id,x,y,size,zone,amount_cents,payment_link)
   values(r.id,r.x,r.y,r.size,r.zone,m.amount_cents,m.payment_link) returning * into b;
 end if;
 return json_build_object('id',b.id,'url',m.url||'?client_reference_id='||b.id::text,'amount_cents',b.amount_cents,'months',12);
end $$;

-- 4. Moving: locked for as long as an open checkout for the current spot can still be paid.
create or replace function public.owner_choose_map_spot(p_slug text,p_key text,p_x int,p_y int,p_size int) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug,p_key); z text;
begin
 if r.status not in ('pending','approved') then raise exception 'not_available'; end if;
 if p_x is null or p_y is null or p_size is null or p_size not in (1,2,4,8) or abs(p_x)>200 or abs(p_y)>200 then raise exception 'invalid:spot'; end if;
 perform pg_advisory_xact_lock(4242);
 perform 1 from public.products where id=r.id for update;
 if exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()) then raise exception 'active_purchase'; end if;
 if exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='pending' and created_at>now()-interval '48 hours') then raise exception 'checkout_open'; end if;
 perform public._assert_free(p_x,p_y,p_size,r.id,null);
 z := public.zone_of(p_x,p_y,p_size);
 update public.products set x=p_x,y=p_y,size=p_size,zone=z,price_eur=public.price_per_cell(z)*p_size*p_size where id=r.id returning * into r;
 return public._owner_json(r);
end $$;

-- 6. Link a withdrawal notice to its order when the reference contains the order id in any case.
create or replace function expanse_private.withdrawal_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ref text:=lower(substring(new.reference from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'));
begin
 if new.purchase_id is null and ref is not null then
   select id into new.purchase_id from expanse_private.map_purchases where id::text=ref;
 end if;
 return new;
end $$;
revoke execute on function expanse_private.withdrawal_link() from public, anon, authenticated;
drop trigger if exists withdrawal_link on expanse_private.withdrawals;
create trigger withdrawal_link before insert on expanse_private.withdrawals for each row execute function expanse_private.withdrawal_link();

-- 7. Holds: armed on the first approval and on a move from the free spot or from no hold. A move or a re-approval
-- never extends a running hold or revives a lapsed one, so shuffling between cells or editing the listing cannot keep a
-- premium spot for free.
create or replace function expanse_private.map_hold() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op='INSERT' then
   if new.zone<>'edge' or new.size<>1 then new.map_hold_until:=now()+interval '7 days'; end if;
 elsif new.x is distinct from old.x or new.y is distinct from old.y or new.size is distinct from old.size then
   new.map_hold_until:=case
     when old.map_hold_until>now() then old.map_hold_until               -- a running hold keeps its deadline
     when new.zone='edge' and new.size=1 then null                        -- the free spot needs no hold
     when (old.zone='edge' and old.size=1) or old.map_hold_until is null then now()+interval '7 days'
     else old.map_hold_until end;                                         -- a lapsed hold stays lapsed until the product is released
 elsif old.status<>'approved' and new.status='approved' and old.map_hold_until is not null and old.approved_at is null then
   new.map_hold_until:=now()+interval '7 days';
 end if;
 return new;
end $$;
revoke execute on function expanse_private.map_hold() from public, anon, authenticated;
