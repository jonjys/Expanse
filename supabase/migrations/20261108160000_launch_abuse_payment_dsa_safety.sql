-- Launch safety, from the launch-readiness audit (2026-11-08):
--  1. Legacy reserve_spot/reserve can no longer be called anonymously: they let anyone hold paid map cells forever
--     with no review. Existing legacy holds stay valid, as the terms promise.
--  2. Abuse limits also count per IP address (IPv6 per /64), not only per IP + User-Agent, which a changed
--     User-Agent bypassed: upvotes, product submissions, contact, sign-in codes, withdrawal notices and reports.
--  3. A paid Stripe session that matches no order is recorded for review (and emails the admin) instead of vanishing.
--  4. The withdrawal acknowledgement email carries fixed text only, at most once a day per address, so the form
--     cannot relay a stranger's text and links from expanse@nyttolabs.com. The on-screen receipt is unchanged.
--  5. Reports follow the DSA notice-and-action rules: an "illegal content" reason with a substantiated explanation
--     and a good-faith statement, an optional notifier email that gets an acknowledgement, and an admin alert.

-- 1. Legacy reservations.
do $$ begin
  revoke execute on function public.reserve_spot(text,text,text,integer,integer,integer,text) from public, anon, authenticated;
exception when undefined_function then null; end $$;
do $$ begin
  revoke execute on function public.reserve(text,text,text,integer,integer) from public, anon, authenticated;
exception when undefined_function then null; end $$;

-- 2. Per-address abuse hash: the day's salt and the client address only. Null when no client address is known
--    (server-side calls and tests), in which case only the existing per-visitor limits apply.
create or replace function public._abuse_hash() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  h json := public._headers();
  ip text := btrim(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1), ''));
  b text; s bytea;
begin
  if ip = '' then return null; end if;
  begin
    b := case when family(ip::inet) = 6 then host(network(set_masklen(ip::inet, 64))) else host(ip::inet) end;
  exception when others then b := ip; end;
  perform public._visitor_hash();  -- rotates the daily salt if needed
  select salt into s from public.salts where id = 1;
  return encode(extensions.digest(s || convert_to('abuse|' || b, 'UTF8'), 'sha256'), 'hex');
end $$;
revoke execute on function public._abuse_hash() from public, anon, authenticated;

alter table public.votes add column if not exists ahash text;
create index if not exists votes_ahash_idx on public.votes (ahash, day) where ahash is not null;
create index if not exists votes_product_recent_idx on public.votes (product_id, created_at);
alter table public.contact_log add column if not exists ahash text;
create index if not exists contact_log_ahash_idx on public.contact_log (ahash, at) where ahash is not null;
alter table public.signin_log add column if not exists ahash text;
create index if not exists signin_log_ahash_idx on public.signin_log (ahash, at) where ahash is not null;
alter table public.products add column if not exists submit_ahash text;
create index if not exists products_submit_ahash_idx on public.products (submit_ahash, created_at) where submit_ahash is not null;
alter table expanse_private.withdrawals add column if not exists ahash text;
create index if not exists withdrawals_ahash_idx on expanse_private.withdrawals (ahash, created_at) where ahash is not null;
create index if not exists withdrawals_email_idx on expanse_private.withdrawals (email, created_at);

-- Upvotes: one address may add at most three distinct votes per product per day (a shared office or home network),
-- at most 60 votes a day, and no product gains more than 300 votes an hour.
create or replace function public.upvote(p_slug text, p_voter text, p_on boolean) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id bigint; v_hash text; v_ah text; v_voter text; v_active boolean; v_n int;
begin
  if p_voter is null or p_voter !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'invalid:voter'; end if;
  select id into v_id from public.products where slug = p_slug and status = 'approved';
  if v_id is null then raise exception 'not_found'; end if;
  v_voter := encode(extensions.digest(convert_to('expanse-vote|' || p_voter, 'UTF8'), 'sha256'), 'hex');
  select removed_at is null into v_active from public.votes where product_id = v_id and voter = v_voter for update;
  if coalesce(p_on, true) then
    if not coalesce(v_active, false) then
      if public._is_bot() then raise exception 'bot'; end if;
      v_hash := public._visitor_hash();
      v_ah := public._abuse_hash();
      if exists (select 1 from public.owner_marks o where o.product_id = v_id and o.day = current_date and o.vhash = v_hash) then
        raise exception 'own_product';
      end if;
      if exists (select 1 from public.votes where product_id = v_id and day = current_date and vhash = v_hash and voter <> v_voter and removed_at is null) then
        raise exception 'already';
      end if;
      if v_ah is not null and (select count(*) from public.votes where product_id = v_id and day = current_date and ahash = v_ah and voter <> v_voter and removed_at is null) >= 3 then
        raise exception 'already';
      end if;
      if (select count(*) from public.votes where day = current_date and vhash = v_hash) >= 60 then raise exception 'slow_down'; end if;
      if v_ah is not null and (select count(*) from public.votes where day = current_date and ahash = v_ah) >= 60 then raise exception 'slow_down'; end if;
      if (select count(*) from public.votes where product_id = v_id and created_at > now() - interval '1 hour') >= 300 then raise exception 'slow_down'; end if;
      insert into public.votes (product_id, voter, vhash, ahash, day) values (v_id, v_voter, v_hash, v_ah, current_date)
      on conflict (product_id, voter) do update
        set removed_at = null, vhash = excluded.vhash, ahash = excluded.ahash, day = excluded.day, created_at = now();
    end if;
  elsif coalesce(v_active, false) then
    update public.votes set removed_at = now() where product_id = v_id and voter = v_voter;
  end if;
  select count(*) into v_n from public.votes where product_id = v_id and removed_at is null;
  return json_build_object('slug', p_slug, 'upvotes', v_n, 'voted', coalesce(p_on, true));
end $$;

-- Product submissions: at most ten an hour from one address, on top of submit_product's own five per visitor.
create or replace function expanse_private.submission_address_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ah text := public._abuse_hash();
begin
  if v_ah is not null and (select count(*) from public.products where submit_ahash = v_ah and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'slow_down';
  end if;
  new.submit_ahash := v_ah;
  return new;
end $$;
revoke execute on function expanse_private.submission_address_limit() from public, anon, authenticated;
drop trigger if exists submission_address_limit on public.products;
create trigger submission_address_limit before insert on public.products
  for each row when (new.submit_hash is not null) execute function expanse_private.submission_address_limit();

-- Contact form: at most six messages an hour from one address.
create or replace function public.contact_message(p_email text, p_message text, p_topic text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_msg text := public._text(p_message, 2000);
  v_topic text := case when p_topic in ('question', 'data', 'placement', 'other') then p_topic else 'question' end;
  v_to text := coalesce(public._setting('notify_email') #>> '{}', '');
  v_vh text := public._visitor_hash();
  v_ah text := public._abuse_hash();
  v_label text;
begin
  if char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email'; end if;
  if char_length(v_msg) < 10 then raise exception 'invalid:message'; end if;
  if v_to = '' or not public._email_ready() then return json_build_object('ok', false, 'reason', 'unavailable'); end if;
  if (select count(*) from public.contact_log where vhash = v_vh and at > now() - interval '1 hour') >= 3 then raise exception 'slow_down'; end if;
  if v_ah is not null and (select count(*) from public.contact_log where ahash = v_ah and at > now() - interval '1 hour') >= 6 then raise exception 'slow_down'; end if;
  if (select count(*) from public.contact_log where at > now() - interval '1 hour') >= 30 then raise exception 'busy'; end if;
  insert into public.contact_log (vhash, ahash) values (v_vh, v_ah);
  v_label := case v_topic when 'data' then 'My data' when 'placement' then 'Sponsored slot' when 'other' then 'Something else' else 'Question' end;
  insert into public.outbox (to_email, subject, body, kind, reply_to)
  values (v_to, left('Expanse contact · ' || v_label || ' · ' || v_email, 200),
    left('From: ' || v_email || E'\nTopic: ' || v_label || E'\n\n' || v_msg || E'\n\n— Sent from the contact form on expanse.nyttolabs.com. Reply to this email to answer.', 6000),
    'contact', v_email);
  perform public._kick_worker('mail');
  return json_build_object('ok', true);
end $$;

-- Sign-in codes: at most twenty requests an hour from one address.
create or replace function public.email_signin_start(p_email text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_eh text;
  v_vh text := public._visitor_hash();
  v_ah text := public._abuse_hash();
  v_code text; v_names text; v_n int;
begin
  if char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email'; end if;
  if not public._email_ready() then return json_build_object('ok', true, 'delivery', 'unavailable'); end if;
  if (select count(*) from public.signin_log where vhash = v_vh and kind = 'start' and at > now() - interval '1 hour') >= 10 then
    raise exception 'slow_down';
  end if;
  if v_ah is not null and (select count(*) from public.signin_log where ahash = v_ah and kind = 'start' and at > now() - interval '1 hour') >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.signin_log (vhash, ahash, kind) values (v_vh, v_ah, 'start');
  v_eh := public._key_hash(v_email);
  select count(*), string_agg(p.name, ', ' order by p.created_at) into v_n, v_names
    from (select name, created_at from public.products where contact_email = v_email and status <> 'removed' order by created_at limit 20) p;
  if v_n = 0
     or exists (select 1 from public.email_codes where email_hash = v_eh and created_at > now() - interval '1 minute')
     or (select count(*) from public.email_codes where email_hash = v_eh and created_at > now() - interval '1 hour') >= 5 then
    return json_build_object('ok', true, 'delivery', 'queued');
  end if;
  v_code := lpad((('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint % 1000000)::text, 6, '0');
  -- Only the newest code works.
  update public.email_codes set expires_at = now() where email_hash = v_eh and used_at is null and expires_at > now();
  insert into public.email_codes (email_hash, code_hash, expires_at)
  values (v_eh, public._key_hash(v_eh || ':' || v_code), now() + interval '15 minutes');
  insert into public.outbox (to_email, subject, body, kind, expires_at)
  values (v_email, 'Your Expanse sign-in code: ' || v_code,
    left(E'Your sign-in code for Expanse:\n\n' || v_code || E'\n\nIt works for 15 minutes and signs you in to manage ' || left(v_names, 300) ||
      E'.\n\nIf you didn''t ask for this code, you can ignore this email. Nobody can sign in without it.' ||
      E'\n\n— Expanse\nhttps://expanse.nyttolabs.com', 6000),
    'signin_code', now() + interval '15 minutes');
  perform public._kick_worker('mail');
  return json_build_object('ok', true, 'delivery', 'queued');
end $$;

-- 3. Paid sessions with no matching order.
create or replace function public.confirm_map_payment(p_token text,p_event jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare b expanse_private.map_purchases; r public.products; v_id uuid; v_event text:=p_event->>'id';
 v_type text:=p_event->>'type'; v_session text:=p_event->>'session_id'; v_pi text:=p_event->>'payment_intent'; v_out text; v_review uuid; v_foreign boolean; v_badref boolean:=false;
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
 begin v_id:=(p_event->>'reference')::uuid; exception when others then v_id:=null; v_badref:=true; end;
 if v_id is not null then select * into b from expanse_private.map_purchases where id=v_id for update; end if;
 if b.id is null then
   -- A paid session that matches no order (a bare, bookmarked or copied payment link) must not vanish: it is
   -- recorded for review, which emails the admin its ids. Unpaid, expired and failed sessions stay quiet.
   if v_type='checkout.session.async_payment_succeeded' or (v_type='checkout.session.completed' and p_event->>'payment_status'='paid') then
     insert into expanse_private.stripe_events(event_id,session_id,purchase_id,outcome,payment_intent) values(v_event,v_session,null,'needs_review',v_pi);
   end if;
   return json_build_object('outcome',case when v_badref then 'missing_reference' else 'unknown_order' end);
 end if;
 if v_type='checkout.session.completed' and p_event->>'payment_status'<>'paid' then
   -- A delayed payment method is processing: remember it, so the order counts as open until it succeeds or fails.
   -- Only a session that matches the order exactly counts.
   if b.state in ('pending','failed') and p_event->>'currency'='eur' and p_event->>'payment_link' is not distinct from b.payment_link
     and (p_event->>'amount_total')::int is not distinct from b.amount_cents and p_event->>'zone' is not distinct from b.zone
     and (p_event->>'size')::int is not distinct from b.size
     and to_timestamp((p_event->>'session_created')::bigint)<=b.created_at+interval '24 hours' then
     insert into expanse_private.stripe_events(event_id,session_id,purchase_id,outcome,payment_intent) values(v_event,v_session,b.id,'processing',v_pi);
   end if;
   return json_build_object('outcome','awaiting_payment');
 end if;
 if v_type in ('checkout.session.async_payment_failed','checkout.session.expired') then
   -- One session ending unpaid does not end the order: the owner may have paid in another session.
   update expanse_private.map_purchases set state='failed' where id=b.id and state='pending';
   insert into expanse_private.stripe_events(event_id,session_id,purchase_id,outcome,payment_intent) values(v_event,v_session,b.id,'failed',v_pi);
   return json_build_object('outcome','failed');
 end if;
 if v_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') then return json_build_object('outcome','ignored'); end if;
 select * into r from public.products where id=b.product_id for update;
 -- A payment through another link, amount or square was not made for this order (for example a reference copied into
 -- another Payment Link); it goes to review without changing the order.
 v_foreign := p_event->>'payment_status' is distinct from 'paid' or p_event->>'currency' is distinct from 'eur'
   or p_event->>'payment_link' is distinct from b.payment_link or (p_event->>'amount_total')::int is distinct from b.amount_cents
   or p_event->>'zone' is distinct from b.zone or (p_event->>'size')::int is distinct from b.size;
 v_out := case
   when b.state='paid' and b.session_id=v_session then 'duplicate'
   when b.state not in ('pending','failed') then 'needs_review'
   when v_foreign then 'needs_review'
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
   if b.state in ('pending','failed') and not v_foreign then
     update expanse_private.map_purchases set state='needs_review',issue='Payment needs manual review. Contact support before paying again.',
       session_id=case when v_session is not null and not exists(select 1 from expanse_private.map_purchases q where q.session_id=v_session and q.id<>b.id) then v_session else session_id end,
       payment_intent=coalesce(v_pi,payment_intent) where id=b.id;
   end if;
 end if;
 insert into expanse_private.stripe_events(event_id,session_id,purchase_id,outcome,payment_intent) values(v_event,v_session,b.id,v_out,v_pi);
 return json_build_object('outcome',v_out);
end $$;

-- 4. Withdrawal notices. The on-screen receipt keeps every detail; the email is fixed text with the request id, the
--    time and the matched order, sent at most once a day to an address (and to the order's contact email when the
--    reference matches an order and that address differs).
create or replace function public.submit_withdrawal(p_name text,p_email text,p_reference text,p_message text default '') returns json
language plpgsql volatile security definer set search_path='' as $$
declare n text:=public._line(p_name,160);e text:=lower(public._line(p_email,254));ref text:=public._line(p_reference,200);
 msg text:=public._text(p_message,2000);vh text:=public._visitor_hash();ah text:=public._abuse_hash();w expanse_private.withdrawals;mailid bigint;
 admin_email text;receipt text;ack text;owner_email text;
begin
 if n='' or ref='' then raise exception 'invalid:withdrawal';end if;
 if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email';end if;
 perform pg_advisory_xact_lock(4243);
 select * into w from expanse_private.withdrawals where vhash=vh and email=e and reference=ref and created_at>now()-interval '24 hours' order by created_at desc limit 1;
 if w.id is null then
  if (select count(*) from expanse_private.withdrawals where vhash=vh and created_at>now()-interval '1 hour')>=3
     or (ah is not null and (select count(*) from expanse_private.withdrawals where ahash=ah and created_at>now()-interval '1 hour')>=5)
     or (select count(*) from expanse_private.withdrawals where created_at>now()-interval '1 hour')>=60 then raise exception 'slow_down';end if;
  insert into expanse_private.withdrawals(name,email,reference,message,vhash,ahash) values(n,e,ref,msg,vh,ah) returning * into w;
  receipt:=E'Expanse — withdrawal notice received\nRequest: '||w.id||E'\nReceived (UTC): '||to_char(w.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||E'\nName: '||w.name||E'\nEmail: '||w.email||E'\nContract / order reference: '||w.reference||E'\nMessage: '||w.message||E'\n\nWe received your notice that you withdraw from the identified contract. This is an automatic acknowledgement, not confirmation that a refund has been issued. We will check the payment and reply by email. Keep this confirmation. A notice received within 14 days of purchase qualifies for our full-refund policy. Mandatory consumer rights remain unchanged.\nhttps://expanse.nyttolabs.com/terms';
  ack:=E'Expanse — withdrawal notice received\nRequest: '||w.id||E'\nReceived (UTC): '||to_char(w.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')
    ||case when w.purchase_id is not null then E'\nOrder: '||w.purchase_id else E'\nOrder: no order matched the reference given; we will check it by hand.' end
    ||E'\n\nWe received a notice of withdrawal from a contract with Expanse. This is an automatic acknowledgement, not confirmation that a refund has been issued. We will check the payment and reply by email. Keep this confirmation. A notice received within 14 days of purchase qualifies for our full-refund policy. Mandatory consumer rights remain unchanged.\nhttps://expanse.nyttolabs.com/terms';
  if not exists(select 1 from expanse_private.withdrawals x where x.email=e and x.id<>w.id and x.receipt_outbox_id is not null and x.created_at>now()-interval '24 hours') then
   insert into public.outbox(to_email,subject,body,kind) values(e,'Expanse — withdrawal notice received',ack,'withdrawal_receipt') returning id into mailid;
   update expanse_private.withdrawals set receipt_outbox_id=mailid where id=w.id;
  end if;
  if w.purchase_id is not null then
   select p.contact_email into owner_email from expanse_private.map_purchases b join public.products p on p.id=b.product_id where b.id=w.purchase_id;
   if owner_email is not null and lower(owner_email)<>e and owner_email not like '%.invalid'
      and not exists(select 1 from public.outbox o where o.to_email=owner_email and o.kind='withdrawal_receipt' and o.created_at>now()-interval '24 hours') then
    insert into public.outbox(to_email,subject,body,kind) values(owner_email,'Expanse — withdrawal notice received',ack,'withdrawal_receipt');
   end if;
  end if;
  admin_email:=coalesce(public._setting('notify_email')#>>'{}','');
  if admin_email<>'' then insert into public.outbox(to_email,subject,body,kind,reply_to) values(admin_email,'Expanse — withdrawal needs review',left(receipt||E'\nReview in https://expanse.nyttolabs.com/admin#withdrawals . Verify the original Stripe payment before any refund.',6000),'withdrawal_admin',e);end if;
  perform public._kick_worker('mail');
 else
  receipt:=E'Expanse — withdrawal notice received\nRequest: '||w.id||E'\nReceived (UTC): '||to_char(w.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||E'\nName: '||w.name||E'\nEmail: '||w.email||E'\nContract / order reference: '||w.reference||E'\nMessage: '||w.message||E'\n\nYour original notice is already recorded. No duplicate notice or refund was created. We will check the payment and reply by email. https://expanse.nyttolabs.com/terms';
 end if;
 return json_build_object('ok',true,'id',w.id,'received_at',w.created_at,'receipt',receipt);
end $$;

-- 5. Reports (DSA Art. 16): an illegal-content reason, a longer explanation, an optional notifier email and a
--    good-faith statement. The notifier gets an acknowledgement (fixed text, at most once a day per address) and
--    the admin is alerted to illegal-content notices.
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason in ('broken_link', 'wrong_info', 'spam', 'illegal', 'other'));
alter table public.reports drop constraint if exists reports_details_check;
alter table public.reports add constraint reports_details_check check (char_length(details) <= 2000);
alter table public.reports add column if not exists notifier_email text check (notifier_email is null or char_length(notifier_email) <= 254);
alter table public.reports add column if not exists good_faith boolean not null default false;
alter table public.reports add column if not exists ahash text;
create index if not exists reports_ahash_idx on public.reports (ahash, created_at) where ahash is not null;

drop function if exists public.report_product(text, text, text);
create or replace function public.report_product(p_slug text, p_reason text, p_details text, p_email text default null, p_good_faith boolean default false) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id bigint; v_name text; v_ah text := public._abuse_hash();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_details text := public._text(p_details, 2000);
  v_admin text := coalesce(public._setting('notify_email') #>> '{}', '');
  v_new bigint;
begin
  if p_reason not in ('broken_link', 'wrong_info', 'spam', 'illegal', 'other') then raise exception 'invalid:reason'; end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid:email'; end if;
  if p_reason = 'illegal' and (char_length(v_details) < 30 or not coalesce(p_good_faith, false)) then raise exception 'invalid:notice'; end if;
  if p_reason <> 'illegal' and char_length(v_details) > 600 then v_details := left(v_details, 600); end if;
  select id, name into v_id, v_name from public.products where slug = p_slug and status = 'approved';
  if v_id is null then raise exception 'not_found'; end if;
  if v_ah is not null and (select count(*) from public.reports where ahash = v_ah and created_at > now() - interval '1 hour') >= 10 then raise exception 'slow_down'; end if;
  if (select count(*) from public.reports where created_at > now() - interval '1 hour') >= 200 then raise exception 'busy'; end if;
  insert into public.reports (product_id, reason, details, vhash, notifier_email, good_faith, ahash)
  values (v_id, p_reason, v_details, public._visitor_hash(), v_email, coalesce(p_good_faith, false), v_ah)
  on conflict do nothing returning id into v_new;
  if v_new is null then return true; end if;
  if v_email is not null and public._email_ready()
     and not exists (select 1 from public.outbox o where o.to_email = v_email and o.kind = 'report_receipt' and o.created_at > now() - interval '24 hours') then
    insert into public.outbox (to_email, subject, body, kind, product_id)
    values (v_email, 'Expanse — we received your report',
      left(E'We received your report about “' || v_name || E'” on Expanse (report ' || v_new || ', ' ||
        to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || E' UTC).\n\nA person checks every report. We will tell you what we decided and why. ' ||
        E'If you did not send this report, you can ignore this email.\n\n— Expanse\nhttps://expanse.nyttolabs.com/terms', 6000),
      'report_receipt', v_id);
  end if;
  if p_reason = 'illegal' and v_admin <> '' then
    insert into public.outbox (to_email, subject, body, kind, product_id, reply_to)
    values (v_admin, 'Expanse — illegal content notice: ' || left(v_name, 80),
      left(E'An illegal-content notice was filed (DSA Art. 16).\nProduct: ' || v_name || ' (' || p_slug || E')\nReport: ' || v_new ||
        E'\nNotifier email: ' || coalesce(v_email, 'not given') || E'\nGood-faith statement: yes\n\nExplanation:\n' || v_details ||
        E'\n\nDecide in https://expanse.nyttolabs.com/admin and inform the notifier and the maker of the decision and the reasons.', 6000),
      'report_admin', v_id, v_email);
  end if;
  if v_email is not null or p_reason = 'illegal' then perform public._kick_worker('mail'); end if;
  return true;
end $$;
revoke all on function public.report_product(text, text, text, text, boolean) from public;
grant execute on function public.report_product(text, text, text, text, boolean) to anon, authenticated;

-- Retention: a notifier's email goes with the report (resolved reports are deleted after 90 days; an open report's
-- explanation and email are cleared after a year).
create or replace function expanse_private.prune_personal_data() returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 delete from public.contact_log where at<now()-interval '7 days';
 delete from public.signin_log where at<now()-interval '7 days';
 delete from public.email_codes where expires_at<now()-interval '1 day';
 delete from public.outbox where (sent_at is not null or failed_at is not null) and created_at<now()-interval '90 days';
 update public.outbox set subject='Your Expanse sign-in code',body='(sign-in code cleared after one day)' where kind='signin_code' and created_at<now()-interval '1 day';
 delete from public.reports where resolved and created_at<now()-interval '90 days';
 update public.reports set details='',notifier_email=null where not resolved and created_at<now()-interval '365 days' and (details<>'' or notifier_email is not null);
 delete from public.events where day<current_date-90;
 delete from public.owner_marks where day<current_date-90;
 delete from public.placement_events where day<current_date-90;
 delete from expanse_private.discovery_events where day<current_date-90;
 delete from public.votes where removed_at is not null and removed_at<now()-interval '90 days';
 delete from public.owner_keys where revoked_at is not null and revoked_at<now()-interval '90 days';
 update public.products set recovery_token=null,recovery_secret_hash=null,recovery_expires_at=null where recovery_expires_at<now();
 delete from expanse_private.withdrawals where resolved_at<now()-interval '2 years' and created_at<now()-interval '2 years';
 delete from expanse_private.stripe_events where created_at<date_trunc('year',now())-interval '7 years';
 update expanse_private.withdrawals set purchase_id=null where purchase_id in(select id from expanse_private.map_purchases where created_at<date_trunc('year',now())-interval '7 years' and state<>'paid');
 delete from expanse_private.map_purchases where created_at<date_trunc('year',now())-interval '7 years' and state<>'paid' and not exists(select 1 from expanse_private.stripe_events e where e.purchase_id=map_purchases.id);
 perform public._set_setting('retention_last_run',to_jsonb(now()));
end $$;

notify pgrst, 'reload schema';
