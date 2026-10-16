-- Sponsored placements. A maker asks for a Sponsored slot for a number of weeks; the admin schedules it (dates, price,
-- optional payment link) and marks it paid. While it runs, the product can appear in one clearly labelled "Sponsored"
-- card above search and list results, only when it is relevant, and never changing the ranking below it.
-- The maker gets a report: impressions and clicks on the card, and profile views and site clicks during the slot
-- compared with the same number of days just before it.

create table if not exists public.placements (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id),
  status text not null default 'requested' check (status in ('requested', 'scheduled', 'rejected', 'cancelled')),
  weeks int not null check (weeks between 1 and 12),
  wish_start date,
  owner_note text not null default '' check (char_length(owner_note) <= 400),
  start_date date,
  end_date date,
  price_eur numeric(10, 2) check (price_eur >= 0),
  pay_url text check (char_length(pay_url) <= 300),
  paid_at timestamptz,
  stopped_at timestamptz,
  admin_note text not null default '' check (char_length(admin_note) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date is null or end_date >= start_date)
);
create index if not exists placements_product_idx on public.placements (product_id);
create index if not exists placements_live_idx on public.placements (start_date, end_date) where status = 'scheduled' and paid_at is not null and stopped_at is null;
alter table public.placements enable row level security;

-- Unique visitors per placement, kind and day (same daily-salted hash as the product stats).
create table if not exists public.placement_events (
  placement_id bigint not null references public.placements(id),
  kind text not null check (kind in ('impression', 'click')),
  day date not null default current_date,
  vhash text not null,
  primary key (placement_id, kind, day, vhash)
);
create index if not exists placement_events_day_vhash_idx on public.placement_events (day, vhash);
alter table public.placement_events enable row level security;

revoke all on public.placements, public.placement_events from anon, authenticated;

-- requested | awaiting_payment | expired | upcoming | live | ended | rejected | cancelled
create or replace function public._placement_state(pl public.placements) returns text
language sql stable set search_path = '' as $$
  select case
    when pl.status <> 'scheduled' then pl.status
    when pl.paid_at is null then case when current_date > pl.end_date then 'expired' else 'awaiting_payment' end
    when pl.stopped_at is not null then 'ended'
    when current_date < pl.start_date then 'upcoming'
    when current_date > pl.end_date then 'ended'
    else 'live' end
$$;

-- Numbers for a placement that has started: the slot's days so far, and the same number of days just before it.
-- The maker's own visits (owner marks) are left out, as in the owner stats.
create or replace function public._placement_report(pl public.placements) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  v_state text := public._placement_state(pl);
  v_end date; v_days int;
begin
  if pl.paid_at is null or v_state not in ('live', 'ended') then return null; end if;
  v_end := least(pl.end_date, coalesce((pl.stopped_at at time zone 'UTC')::date, pl.end_date), current_date);
  if v_end < pl.start_date then v_end := pl.start_date; end if;
  v_days := v_end - pl.start_date + 1;
  return (
    with ev as (
      select e.kind, e.day >= pl.start_date as during
        from public.events e
       where e.product_id = pl.product_id and e.day between pl.start_date - v_days and v_end
         and not exists (select 1 from public.owner_marks o where o.product_id = e.product_id and o.day = e.day and o.vhash = e.vhash)),
    pe as (
      select x.kind from public.placement_events x
       where x.placement_id = pl.id and x.day between pl.start_date and v_end
         and not exists (select 1 from public.owner_marks o where o.product_id = pl.product_id and o.day = x.day and o.vhash = x.vhash))
    select json_build_object(
      'days', v_days, 'from', pl.start_date, 'to', v_end,
      'impressions', (select count(*) from pe where kind = 'impression'),
      'clicks', (select count(*) from pe where kind = 'click'),
      'views', (select count(*) from ev where during and kind = 'view'),
      'site_clicks', (select count(*) from ev where during and kind in ('visit', 'demo')),
      'before', json_build_object(
        'from', pl.start_date - v_days, 'to', pl.start_date - 1,
        'views', (select count(*) from ev where not during and kind = 'view'),
        'site_clicks', (select count(*) from ev where not during and kind in ('visit', 'demo')))));
end $$;

create or replace function public._placement_json(pl public.placements, p_admin boolean) returns json
language sql stable security definer set search_path = '' as $$
  select (jsonb_build_object(
    'id', pl.id, 'state', public._placement_state(pl), 'weeks', pl.weeks, 'wish_start', pl.wish_start,
    'owner_note', pl.owner_note, 'start_date', pl.start_date, 'end_date', pl.end_date, 'price_eur', pl.price_eur,
    'pay_url', case when pl.status = 'scheduled' and pl.paid_at is null then pl.pay_url end,
    'paid_at', pl.paid_at, 'stopped_at', pl.stopped_at,
    'admin_note', case when p_admin or pl.status = 'rejected' then pl.admin_note else '' end,
    'created_at', pl.created_at, 'report', public._placement_report(pl))
   || case when p_admin then (
        select jsonb_build_object('slug', p.slug, 'name', p.name, 'domain', p.domain, 'category', p.category,
                                  'product_status', p.status, 'contact_email', p.contact_email, 'pay_url', pl.pay_url)
          from public.products p where p.id = pl.product_id)
      else '{}'::jsonb end)::json
$$;

-- "€29" or "€29.50".
create or replace function public._eur(p numeric) returns text
language sql immutable set search_path = '' as $$
  select '€' || case when p = trunc(p) then trunc(p)::text else to_char(p, 'FM999999990.00') end
$$;

-- Emails to the maker about their placement (nothing for wiped addresses).
create or replace function public._notify_placement(pl public.placements, p_kind text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.products;
  v_url text; v_dates text; v_subject text; v_body text;
begin
  select * into r from public.products where id = pl.product_id;
  if r.id is null or r.contact_email is null or r.contact_email like '%.invalid' then return; end if;
  v_url := 'https://expanse.nyttolabs.com/p/' || r.slug;
  v_dates := to_char(pl.start_date, 'FMDD Mon YYYY') || ' – ' || to_char(pl.end_date, 'FMDD Mon YYYY');
  if p_kind = 'scheduled' then
    v_subject := r.name || ': your Sponsored slot is scheduled';
    v_body := 'Your Sponsored slot for ' || r.name || ' is scheduled for ' || v_dates || ' (' || pl.weeks || ' week' ||
      case when pl.weeks = 1 then '' else 's' end || ').' ||
      case when pl.price_eur is not null then E'\nPrice: ' || public._eur(pl.price_eur) || '.' else '' end ||
      case when pl.pay_url is not null then E'\n\nPay here: ' || pl.pay_url || E'\n\nThe slot starts once the payment is confirmed.'
           else E'\n\nWe''ll send payment details separately. The slot starts once the payment is confirmed.' end ||
      E'\n\nFollow it under “Manage my product” → Promote: ' || v_url;
  elsif p_kind = 'paid' then
    v_subject := r.name || ': payment received';
    v_body := 'Thanks — the Sponsored slot for ' || r.name || ' runs ' || v_dates || E'.\n\n' ||
      E'Impressions, clicks and a before/after comparison show under “Manage my product” → Promote: ' || v_url;
  elsif p_kind = 'rejected' then
    v_subject := r.name || ': about your Sponsored slot request';
    v_body := 'We can''t run the Sponsored slot you asked for right now.' ||
      case when pl.admin_note <> '' then E'\n\n“' || pl.admin_note || '”' else '' end || E'\n\nNothing was charged.';
  else
    return;
  end if;
  insert into public.outbox (to_email, subject, body, kind, product_id)
  values (r.contact_email, left(v_subject, 200),
          left(v_body || E'\n\n— Expanse\nhttps://expanse.nyttolabs.com\n\nReplies to this address aren''t read.', 6000),
          'placement_' || p_kind, r.id);
  perform public._kick_worker('mail');
end $$;

/* ---------- maker ---------- */

create or replace function public.owner_placements(p_slug text, p_key text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug, p_key);
begin
  return json_build_object(
    'price_week_eur', (public._setting('placement_price_eur') #>> '{}')::numeric,
    'items', coalesce((select json_agg(public._placement_json(pl, false) order by pl.created_at desc)
                         from public.placements pl where pl.product_id = r.id), '[]'::json));
end $$;

-- p: { weeks: 1-12, start?: "YYYY-MM-DD", note?: text }. One open request or slot at a time.
create or replace function public.owner_request_placement(p_slug text, p_key text, p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.products := public._owned(p_slug, p_key);
  v_weeks int; v_start date; v_to text := coalesce(public._setting('notify_email') #>> '{}', '');
begin
  if r.status <> 'approved' then raise exception 'not_live'; end if;
  begin
    v_weeks := (p->>'weeks')::int;
    v_start := nullif(btrim(coalesce(p->>'start', '')), '')::date;
  exception when others then raise exception 'invalid:placement';
  end;
  if v_weeks is null or v_weeks not between 1 and 12 then raise exception 'invalid:weeks'; end if;
  if v_start is not null and (v_start < current_date or v_start > current_date + 180) then raise exception 'invalid:start'; end if;
  if exists (select 1 from public.placements pl where pl.product_id = r.id
              and public._placement_state(pl) in ('requested', 'awaiting_payment', 'upcoming', 'live')) then
    raise exception 'busy';
  end if;
  if (select count(*) from public.placements where created_at > now() - interval '1 hour') >= 30 then raise exception 'busy'; end if;
  insert into public.placements (product_id, weeks, wish_start, owner_note)
  values (r.id, v_weeks, v_start, public._text(p->>'note', 400));
  if v_to <> '' then
    insert into public.outbox (to_email, subject, body, kind, product_id)
    values (v_to, left('Sponsored slot request: ' || r.name, 200),
      left(r.name || ' asks for a Sponsored slot: ' || v_weeks || ' week' || case when v_weeks = 1 then '' else 's' end ||
        case when v_start is not null then ', from ' || to_char(v_start, 'FMDD Mon YYYY') else ', as soon as possible' end || '.' ||
        case when btrim(coalesce(p->>'note', '')) <> '' then E'\n\n“' || public._text(p->>'note', 400) || '”' else '' end ||
        E'\n\nSchedule or decline it under Placements: https://expanse.nyttolabs.com/admin#placements', 6000),
      'admin_placement', r.id);
    perform public._kick_worker('mail');
  end if;
  return public.owner_placements(p_slug, p_key);
end $$;

-- A request, or a scheduled slot that isn't paid yet, can be withdrawn.
create or replace function public.owner_cancel_placement(p_slug text, p_key text, p_id bigint) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug, p_key);
begin
  update public.placements set status = 'cancelled', updated_at = now()
   where id = p_id and product_id = r.id and (status = 'requested' or (status = 'scheduled' and paid_at is null));
  if not found then raise exception 'not_found'; end if;
  return public.owner_placements(p_slug, p_key);
end $$;

/* ---------- public ---------- */

-- Slots running today (paid, not stopped) for live products. The browser decides where one is relevant.
create or replace function public.public_placements() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', pl.id, 'slug', p.slug) order by pl.id), '[]'::json)
    from public.placements pl join public.products p on p.id = pl.product_id
   where pl.status = 'scheduled' and pl.paid_at is not null and pl.stopped_at is null
     and current_date between pl.start_date and pl.end_date and p.status = 'approved'
$$;

-- Counts a Sponsored card being shown or clicked: once per visitor, placement, kind and day. Bots and the maker's
-- own visits are left out.
create or replace function public.track_placement(p_id bigint, p_kind text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare pl public.placements; v_hash text;
begin
  if p_kind not in ('impression', 'click') or public._is_bot() then return; end if;
  select * into pl from public.placements where id = p_id;
  if pl.id is null or public._placement_state(pl) <> 'live' then return; end if;
  v_hash := public._visitor_hash();
  if exists (select 1 from public.owner_marks o where o.product_id = pl.product_id and o.day = current_date and o.vhash = v_hash) then return; end if;
  if (select count(*) from public.placement_events where day = current_date and vhash = v_hash) >= 200 then return; end if;
  insert into public.placement_events (placement_id, kind, day, vhash) values (p_id, p_kind, current_date, v_hash) on conflict do nothing;
end $$;

/* ---------- admin ---------- */

create or replace function public.admin_placements(p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  return coalesce((select json_agg(public._placement_json(pl, true) order by
      case public._placement_state(pl) when 'requested' then 0 when 'live' then 1 when 'awaiting_payment' then 2 when 'upcoming' then 3 else 4 end,
      pl.created_at desc)
    from (select * from public.placements order by created_at desc limit 300) pl), '[]'::json);
end $$;

-- p_action: schedule { start, weeks, price_eur, pay_url? } | paid | reject { note } | stop
create or replace function public.admin_placement_action(p_key text, p_id bigint, p_action text, p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  pl public.placements;
  v_state text;
  v_start date; v_weeks int; v_price numeric; v_url text; v_note text := public._line(p->>'note', 400);
begin
  perform public._admin(p_key);
  select * into pl from public.placements where id = p_id for update;
  if pl.id is null then raise exception 'not_found'; end if;
  v_state := public._placement_state(pl);
  if p_action = 'schedule' then
    if v_state not in ('requested', 'awaiting_payment', 'expired') then raise exception 'invalid:state'; end if;
    begin
      v_start := (p->>'start')::date; v_weeks := (p->>'weeks')::int; v_price := (p->>'price_eur')::numeric;
    exception when others then raise exception 'invalid:schedule';
    end;
    if v_start is null or v_start < current_date or v_start > current_date + 365 then raise exception 'invalid:start'; end if;
    if v_weeks is null or v_weeks not between 1 and 12 then raise exception 'invalid:weeks'; end if;
    if v_price is null or v_price < 0 or v_price > 100000 then raise exception 'invalid:price'; end if;
    if btrim(coalesce(p->>'pay_url', '')) <> '' then
      v_url := public._url(p->>'pay_url');
      if v_url is null then raise exception 'invalid:pay_url'; end if;
    end if;
    update public.placements
       set status = 'scheduled', start_date = v_start, end_date = v_start + v_weeks * 7 - 1, weeks = v_weeks,
           price_eur = round(v_price, 2), pay_url = v_url, admin_note = v_note, updated_at = now()
     where id = pl.id returning * into pl;
    perform public._notify_placement(pl, 'scheduled');
  elsif p_action = 'paid' then
    if v_state not in ('awaiting_payment', 'expired') then raise exception 'invalid:state'; end if;
    if pl.end_date < current_date then raise exception 'invalid:dates'; end if;
    update public.placements set paid_at = now(), updated_at = now() where id = pl.id returning * into pl;
    perform public._notify_placement(pl, 'paid');
  elsif p_action = 'reject' then
    if v_state not in ('requested', 'awaiting_payment', 'expired') then raise exception 'invalid:state'; end if;
    if char_length(v_note) < 3 then raise exception 'invalid:note'; end if;
    update public.placements set status = 'rejected', admin_note = v_note, updated_at = now() where id = pl.id returning * into pl;
    perform public._notify_placement(pl, 'rejected');
  elsif p_action = 'stop' then
    if v_state not in ('upcoming', 'live') then raise exception 'invalid:state'; end if;
    update public.placements set stopped_at = now(), admin_note = coalesce(nullif(v_note, ''), admin_note), updated_at = now()
     where id = pl.id returning * into pl;
  else
    raise exception 'invalid:action';
  end if;
  return public._placement_json(pl, true);
end $$;

-- Settings gain the weekly price shown to makers (empty = "price confirmed before you pay").
create or replace function public.admin_settings(p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  return json_build_object(
    'notify_email', coalesce(public._setting('notify_email') #>> '{}', ''),
    'placement_price_eur', (public._setting('placement_price_eur') #>> '{}')::numeric,
    'keys', (select count(*) from public.admin_keys where revoked_at is null),
    'email', json_build_object(
      'connected', exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key' and coalesce(decrypted_secret, '') <> ''),
      'last_sent_at', (select max(sent_at) from public.outbox),
      'last_error', (select error from public.outbox where error <> '' and error <> 'expired' and sent_at is null order by id desc limit 1),
      'waiting', (select count(*) from public.outbox where sent_at is null and failed_at is null)));
end $$;

create or replace function public.admin_save_settings(p_key text, p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mail text := lower(btrim(coalesce(p->>'notify_email', '')));
  v_resend text := btrim(coalesce(p->>'resend_api_key', ''));
  v_price numeric;
begin
  perform public._admin(p_key);
  if p ? 'notify_email' then
    if v_mail <> '' and (char_length(v_mail) > 254 or v_mail !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid:notify_email'; end if;
    perform public._set_setting('notify_email', to_jsonb(v_mail));
  end if;
  if p ? 'placement_price_eur' then
    begin
      v_price := nullif(btrim(coalesce(p->>'placement_price_eur', '')), '')::numeric;
    exception when others then raise exception 'invalid:placement_price_eur';
    end;
    if v_price is not null and (v_price < 0 or v_price > 100000) then raise exception 'invalid:placement_price_eur'; end if;
    perform public._set_setting('placement_price_eur', coalesce(to_jsonb(round(v_price, 2)), 'null'::jsonb));
  end if;
  if p ? 'resend_api_key' then
    if v_resend !~ '^re_[A-Za-z0-9_]{10,120}$' then raise exception 'invalid:resend_api_key'; end if;
    perform public._set_resend_key(v_resend);
    -- emails that failed on a bad key get another go right away
    update public.outbox set failed_at = null, attempts = 0, send_after = now(), error = ''
     where sent_at is null and error like 'resend 401%';
    perform public._kick_worker('mail');
  end if;
  return public.admin_settings(p_key);
end $$;

-- The overview gains placement counts (requests waiting, slots running).
create or replace function public.admin_overview(p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  return json_build_object(
    'counts', (select json_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected'),
        'hidden', count(*) filter (where status = 'hidden'),
        'removed', count(*) filter (where status = 'removed'),
        'failing', count(*) filter (where status = 'approved' and site_fails >= 2),
        'verified', count(*) filter (where status = 'approved' and verified_at is not null))
      from public.products),
    'open_reports', (select count(*) from public.reports where not resolved),
    'reservations', (select count(*) from public.reservations),
    'placements', (select json_build_object(
        'requested', count(*) filter (where public._placement_state(pl) = 'requested'),
        'awaiting_payment', count(*) filter (where public._placement_state(pl) = 'awaiting_payment'),
        'live', count(*) filter (where public._placement_state(pl) = 'live'))
      from public.placements pl),
    'days', (select json_agg(json_build_object('d', d.day,
        'view', (select count(*) from public.events e where e.day = d.day and e.kind = 'view'),
        'click', (select count(*) from public.events e where e.day = d.day and e.kind in ('visit', 'demo'))) order by d.day)
      from (select generate_series(current_date - 29, current_date, interval '1 day')::date as day) d),
    'top', (select coalesce(json_agg(t), '[]'::json) from (
        select p.slug, p.name, count(*) filter (where e.kind = 'view') as views, count(*) filter (where e.kind in ('visit', 'demo')) as clicks
        from public.events e join public.products p on p.id = e.product_id
        where e.day > current_date - 30
        group by p.slug, p.name order by 3 desc, 4 desc limit 10) t),
    'outbox', (select json_build_object(
        'pending', count(*) filter (where sent_at is null and failed_at is null),
        'failed', count(*) filter (where failed_at is not null and error <> 'expired' and created_at > now() - interval '30 days'),
        'sent_7d', count(*) filter (where sent_at > now() - interval '7 days'))
      from public.outbox),
    'worker', public._setting('worker_last_run'));
end $$;

revoke execute on function
  public._placement_state(public.placements), public._placement_report(public.placements),
  public._placement_json(public.placements, boolean), public._eur(numeric), public._notify_placement(public.placements, text)
from public, anon, authenticated;
revoke execute on function
  public.owner_placements(text, text), public.owner_request_placement(text, text, jsonb), public.owner_cancel_placement(text, text, bigint),
  public.public_placements(), public.track_placement(bigint, text),
  public.admin_placements(text), public.admin_placement_action(text, bigint, text, jsonb)
from public;
grant execute on function
  public.owner_placements(text, text), public.owner_request_placement(text, text, jsonb), public.owner_cancel_placement(text, text, bigint),
  public.public_placements(), public.track_placement(bigint, text),
  public.admin_placements(text), public.admin_placement_action(text, bigint, text, jsonb)
to anon, authenticated;
