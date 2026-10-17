-- Upvotes, popularity and yearly Sponsored slots.
--
-- Upvotes: anyone can upvote a live product, no account. The browser keeps a random voter id; we store only a hash of
-- it, so one browser has one vote per product (and can take it back). Today's visitor hash (the same daily-salted
-- hash as the stats, unlinkable after the day) stops the same network and browser from voting twice for a product on
-- one day by clearing its storage, and caps how many votes it can cast in a day. Makers can't upvote their own product.
--
-- Popularity: unique profile views + 3 × clicks to the site or demo + 5 × upvotes over the last 30 days (the maker's
-- own visits and votes, and clicks that came from a Sponsored card, don't count). Recalculated with the Spotlight at
-- most once an hour. Search uses it after how well a product matches; the Spotlight uses the same score.
--
-- Sponsored slots now run for up to a year (52 weeks); the price setting is per year.

create table if not exists public.votes (
  product_id bigint not null references public.products(id),
  voter text not null,                 -- sha256 of the random id kept in the voter's browser
  vhash text not null,                 -- the visitor hash on the day of the vote (limits only)
  day date not null default current_date,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (product_id, voter)
);
create index if not exists votes_day_vhash_idx on public.votes (day, vhash);
create index if not exists votes_active_idx on public.votes (product_id) where removed_at is null;
alter table public.votes enable row level security;

create table if not exists public.popularity (
  product_id bigint primary key references public.products(id),
  score numeric not null default 0,
  pct int not null default 0,          -- 0-100, relative to the most popular live product
  at timestamptz not null default now()
);
alter table public.popularity enable row level security;

revoke all on public.votes, public.popularity from anon, authenticated;

-- Upvote (p_on true) or take the upvote back (false). p_voter: the random id from the browser.
create or replace function public.upvote(p_slug text, p_voter text, p_on boolean) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id bigint; v_hash text; v_voter text; v_active boolean; v_n int;
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
      if exists (select 1 from public.owner_marks o where o.product_id = v_id and o.day = current_date and o.vhash = v_hash) then
        raise exception 'own_product';
      end if;
      if exists (select 1 from public.votes where product_id = v_id and day = current_date and vhash = v_hash and voter <> v_voter and removed_at is null) then
        raise exception 'already';
      end if;
      if (select count(*) from public.votes where day = current_date and vhash = v_hash) >= 60 then raise exception 'slow_down'; end if;
      insert into public.votes (product_id, voter, vhash, day) values (v_id, v_voter, v_hash, current_date)
      on conflict (product_id, voter) do update
        set removed_at = null, vhash = excluded.vhash, day = excluded.day, created_at = now();
    end if;
  elsif coalesce(v_active, false) then
    update public.votes set removed_at = now() where product_id = v_id and voter = v_voter;
  end if;
  select count(*) into v_n from public.votes where product_id = v_id and removed_at is null;
  return json_build_object('slug', p_slug, 'upvotes', v_n, 'voted', coalesce(p_on, true));
end $$;

-- Popularity for every live product, then the Spotlight from the eligible ones (same score).
create or replace function public._spotlight_refresh() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  with live as (
    select p.id from public.products p where p.status = 'approved'),
  ev as (
    select e.product_id,
           count(*) filter (where e.kind = 'view') as views,
           count(*) filter (where e.kind in ('visit', 'demo')) as clicks
      from public.events e join live on live.id = e.product_id
     where e.day > current_date - 30
       and not exists (select 1 from public.owner_marks o where o.product_id = e.product_id and o.day = e.day and o.vhash = e.vhash)
     group by e.product_id),
  sp as (
    select pl.product_id, count(*) as n
      from public.placement_events x join public.placements pl on pl.id = x.placement_id
     where x.kind = 'click' and x.day > current_date - 30
     group by pl.product_id),
  up as (
    select vo.product_id, count(*) as n
      from public.votes vo join live on live.id = vo.product_id
     where vo.removed_at is null and vo.created_at > now() - interval '30 days'
       and not exists (select 1 from public.owner_marks o where o.product_id = vo.product_id and o.day = vo.day and o.vhash = vo.vhash)
     group by vo.product_id),
  sc as (
    select live.id,
           greatest(0, coalesce(ev.views, 0) - coalesce(sp.n, 0)) + 3 * coalesce(ev.clicks, 0) + 5 * coalesce(up.n, 0) as score
      from live left join ev on ev.product_id = live.id left join sp on sp.product_id = live.id left join up on up.product_id = live.id)
  insert into public.popularity (product_id, score, pct, at)
  select id, score, case when max(score) over () > 0 then round(100 * score / max(score) over ())::int else 0 end, now() from sc
  on conflict (product_id) do update set score = excluded.score, pct = excluded.pct, at = excluded.at;

  select jsonb_build_object('at', now(), 'picks',
           coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'score', r.score) order by r.score desc, r.approved_at asc, r.id asc), '[]'::jsonb))
    into v
    from (select p.id, p.approved_at, po.score
            from public.products p join public.popularity po on po.product_id = p.id
           where p.status = 'approved' and not p.spotlight_blocked and p.verified_at is not null
             and p.site_fails = 0 and p.site_ok_at > now() - interval '3 days'
           order by po.score desc, p.approved_at asc, p.id asc
           limit 8) r;
  perform public._set_setting('spotlight', v);
  return v;
end $$;

-- Public product JSON gains the live upvote count and the hourly popularity (0-100).
create or replace function public._public_json(r public.products) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'slug', r.slug, 'name', r.name, 'tagline', r.tagline, 'description', r.description,
    'audience', r.audience, 'category', r.category, 'needs', r.needs, 'pricing', r.pricing,
    'price_text', r.price_text, 'platforms', r.platforms, 'integrations', r.integrations,
    'url', r.url, 'demo_url', r.demo_url, 'images', r.images, 'domain', r.domain,
    'x', r.x, 'y', r.y, 'size', r.size, 'zone', r.zone, 'sponsored', r.sponsored,
    'verified_at', r.verified_at, 'approved_at', r.approved_at, 'updated_at', r.updated_at,
    'site_ok_at', case when r.site_fails = 0 then r.site_ok_at end,
    'demo_ok_at', case when r.demo_fails = 0 and r.demo_url <> '' then r.demo_ok_at end,
    'repo', case when r.repo_verified_at is not null then r.repo end,
    'repo_verified_at', r.repo_verified_at,
    'release', (select json_build_object('tag', x.tag, 'title', x.title, 'url', x.url, 'at', x.published_at)
                from public.releases x
                where r.repo_verified_at is not null and x.product_id = r.id and x.repo = r.repo
                order by x.published_at desc limit 1),
    'upvotes', (select count(*) from public.votes v where v.product_id = r.id and v.removed_at is null),
    'pop', coalesce((select po.pct from public.popularity po where po.product_id = r.id), 0))
$$;

-- Admin: take back every upvote on a product (for vote rings and the like). Popularity follows at once.
create or replace function public.admin_reset_votes(p_key text, p_slug text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products;
begin
  perform public._admin(p_key);
  select * into r from public.products where slug = p_slug;
  if r.id is null then raise exception 'not_found'; end if;
  update public.votes set removed_at = now() where product_id = r.id and removed_at is null;
  perform public._spotlight_refresh();
  return public._admin_json(r);
end $$;

/* ---------- Sponsored slots: up to a year ---------- */

-- The original column only allowed 1-12 weeks; it is kept (renamed) for history and new rows use the new one.
alter table public.placements rename column weeks to weeks_v1;
alter table public.placements alter column weeks_v1 set default 1;
alter table public.placements add column if not exists weeks int;
update public.placements set weeks = weeks_v1 where weeks is null;
alter table public.placements alter column weeks set not null;
alter table public.placements add constraint placements_weeks_1_52 check (weeks between 1 and 52);

-- "1 year", "1 week", "6 weeks".
create or replace function public._weeks_label(w int) returns text
language sql immutable set search_path = '' as $$
  select case when w = 52 then '1 year' when w = 1 then '1 week' else w || ' weeks' end
$$;

-- Report: impressions and clicks over the whole slot; profile views and site clicks over its first 30 days (or fewer
-- so far) compared with the same number of days just before it.
create or replace function public._placement_report(pl public.placements) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  v_state text := public._placement_state(pl);
  v_end date; v_days int; v_cmp int;
begin
  if pl.paid_at is null or v_state not in ('live', 'ended') then return null; end if;
  v_end := least(pl.end_date, coalesce((pl.stopped_at at time zone 'UTC')::date, pl.end_date), current_date);
  if v_end < pl.start_date then v_end := pl.start_date; end if;
  v_days := v_end - pl.start_date + 1;
  v_cmp := least(v_days, 30);
  return (
    with ev as (
      select e.kind, e.day >= pl.start_date as during
        from public.events e
       where e.product_id = pl.product_id and e.day between pl.start_date - v_cmp and pl.start_date + v_cmp - 1
         and not exists (select 1 from public.owner_marks o where o.product_id = e.product_id and o.day = e.day and o.vhash = e.vhash)),
    pe as (
      select x.kind from public.placement_events x
       where x.placement_id = pl.id and x.day between pl.start_date and v_end
         and not exists (select 1 from public.owner_marks o where o.product_id = pl.product_id and o.day = x.day and o.vhash = x.vhash))
    select json_build_object(
      'days', v_days, 'cmp_days', v_cmp, 'from', pl.start_date, 'to', v_end,
      'impressions', (select count(*) from pe where kind = 'impression'),
      'clicks', (select count(*) from pe where kind = 'click'),
      'views', (select count(*) from ev where during and kind = 'view'),
      'site_clicks', (select count(*) from ev where during and kind in ('visit', 'demo')),
      'before', json_build_object(
        'from', pl.start_date - v_cmp, 'to', pl.start_date - 1,
        'views', (select count(*) from ev where not during and kind = 'view'),
        'site_clicks', (select count(*) from ev where not during and kind in ('visit', 'demo')))));
end $$;

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
    v_body := 'Your Sponsored slot for ' || r.name || ' is scheduled for ' || v_dates || ' (' || public._weeks_label(pl.weeks) || ').' ||
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

-- The price is per year now. price_week_eur stays (empty) so a page loaded before this change shows
-- "we confirm the price with you" instead of a wrong weekly price.
create or replace function public.owner_placements(p_slug text, p_key text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug, p_key);
begin
  return json_build_object(
    'price_year_eur', (public._setting('placement_price_eur') #>> '{}')::numeric,
    'price_week_eur', null,
    'items', coalesce((select json_agg(public._placement_json(pl, false) order by pl.created_at desc)
                         from public.placements pl where pl.product_id = r.id), '[]'::json));
end $$;

-- p: { weeks: 1-52 (52 = a year), start?: "YYYY-MM-DD", note?: text }. One open request or slot at a time.
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
  if v_weeks is null or v_weeks not between 1 and 52 then raise exception 'invalid:weeks'; end if;
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
      left(r.name || ' asks for a Sponsored slot: ' || public._weeks_label(v_weeks) ||
        case when v_start is not null then ', from ' || to_char(v_start, 'FMDD Mon YYYY') else ', as soon as possible' end || '.' ||
        case when btrim(coalesce(p->>'note', '')) <> '' then E'\n\n“' || public._text(p->>'note', 400) || '”' else '' end ||
        E'\n\nSchedule or decline it under Placements: https://expanse.nyttolabs.com/admin#placements', 6000),
      'admin_placement', r.id);
    perform public._kick_worker('mail');
  end if;
  return public.owner_placements(p_slug, p_key);
end $$;

-- p_action: schedule { start, weeks (1-52), price_eur, pay_url? } | paid | reject { note } | stop
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
    if v_weeks is null or v_weeks not between 1 and 52 then raise exception 'invalid:weeks'; end if;
    if v_price is null or v_price < 0 or v_price > 100000 then raise exception 'invalid:price'; end if;
    if btrim(coalesce(p->>'pay_url', '')) <> '' then
      v_url := public._url(p->>'pay_url');
      if v_url is null then raise exception 'invalid:pay_url'; end if;
    end if;
    update public.placements
       set status = 'scheduled', start_date = v_start,
           end_date = case when v_weeks = 52 then (v_start + interval '1 year')::date - 1 else v_start + v_weeks * 7 - 1 end,
           weeks = v_weeks, price_eur = round(v_price, 2), pay_url = v_url, admin_note = v_note, updated_at = now()
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

revoke execute on function public._weeks_label(int) from public, anon, authenticated;
revoke execute on function public.upvote(text, text, boolean), public.admin_reset_votes(text, text) from public;
grant execute on function public.upvote(text, text, boolean), public.admin_reset_votes(text, text) to anon, authenticated;

select public._spotlight_refresh();
