-- The Spotlight: the 8 places in the core of the map go to the products people actually use. Nobody is invited and
-- nothing is sold. Eligible: live, a verified domain, a website that answered in the last 3 days, not kept out by the
-- admin. Ranked by unique profile views plus 3 × unique clicks to the site or demo over the last 30 days (the maker's
-- own visits and clicks that came from a Sponsored card don't count); ties go to the product that went live first.
-- While fewer than 8 products are eligible, every eligible product has a place. Recalculated at most once an hour.

alter table public.products add column if not exists spotlight_blocked boolean not null default false;

-- Recalculates and stores { at, picks: [{ id, score }] } in settings ("spotlight").
create or replace function public._spotlight_refresh() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  with elig as (
    select p.id, p.approved_at from public.products p
     where p.status = 'approved' and not p.spotlight_blocked and p.verified_at is not null
       and p.site_fails = 0 and p.site_ok_at > now() - interval '3 days'),
  ev as (
    select e.product_id,
           count(*) filter (where e.kind = 'view') as views,
           count(*) filter (where e.kind in ('visit', 'demo')) as clicks
      from public.events e join elig on elig.id = e.product_id
     where e.day > current_date - 30
       and not exists (select 1 from public.owner_marks o where o.product_id = e.product_id and o.day = e.day and o.vhash = e.vhash)
     group by e.product_id),
  sp as (
    select pl.product_id, count(*) as n
      from public.placement_events x join public.placements pl on pl.id = x.placement_id
     where x.kind = 'click' and x.day > current_date - 30
     group by pl.product_id),
  ranked as (
    select elig.id, elig.approved_at,
           greatest(0, coalesce(ev.views, 0) - coalesce(sp.n, 0)) + 3 * coalesce(ev.clicks, 0) as score
      from elig left join ev on ev.product_id = elig.id left join sp on sp.product_id = elig.id
     order by score desc, elig.approved_at asc, elig.id asc
     limit 8)
  select jsonb_build_object('at', now(), 'picks',
           coalesce(jsonb_agg(jsonb_build_object('id', id, 'score', score) order by score desc, approved_at asc, id asc), '[]'::jsonb))
    into v from ranked;
  perform public._set_setting('spotlight', v);
  return v;
end $$;

-- The Spotlight for the map: up to 8 picks in order. Refreshed here when the stored one is over an hour old.
create or replace function public.public_spotlight() returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb := public._setting('spotlight');
begin
  if v is null or jsonb_typeof(v) <> 'object' or (v->>'at')::timestamptz < now() - interval '1 hour' then
    if pg_try_advisory_xact_lock(4243) then v := public._spotlight_refresh(); end if;
  end if;
  return json_build_object(
    'slots', 8,
    'updated_at', v->>'at',
    'picks', coalesce((
      select json_agg(json_build_object('slug', p.slug, 'rank', x.n) order by x.n)
        from jsonb_array_elements(coalesce(v->'picks', '[]'::jsonb)) with ordinality as x(j, n)
        join public.products p on p.id = (x.j->>'id')::bigint
       where p.status = 'approved' and not p.spotlight_blocked), '[]'::json));
end $$;

-- The owner's place in the Spotlight (null when not in it), next to the existing owner view.
create or replace function public._spotlight_rank(p_id bigint) returns int
language sql stable security definer set search_path = '' as $$
  select x.n::int from jsonb_array_elements(coalesce(public._setting('spotlight')->'picks', '[]'::jsonb)) with ordinality as x(j, n)
   where (x.j->>'id')::bigint = p_id
$$;

create or replace function public._owner_json(r public.products) returns json
language sql stable security definer set search_path = '' as $$
  select (public._public_json(r)::jsonb || jsonb_build_object(
    'status', r.status, 'review_note', r.review_note, 'verify_token', r.verify_token,
    'created_at', r.created_at, 'price_eur', r.price_eur,
    'number', (select count(*) from public.reservations) + (select count(*) from public.products q where q.id <= r.id and q.status in ('pending', 'approved', 'hidden')),
    'referrals', (select count(*) from public.products q where q.referred_by = r.slug and q.status in ('pending', 'approved', 'hidden')),
    'email', regexp_replace(r.contact_email, '^(.{1,2})[^@]*', '\1•••'),
    'repo_requested', r.repo,
    'devices', (select count(*) from public.owner_keys k where k.product_id = r.id and k.revoked_at is null),
    'spotlight_rank', public._spotlight_rank(r.id),
    'spotlight_blocked', r.spotlight_blocked,
    'checks', jsonb_build_object(
      'site_checked_at', r.site_checked_at, 'site_status', r.site_status, 'site_fails', r.site_fails,
      'demo_checked_at', r.demo_checked_at, 'demo_status', r.demo_status, 'demo_fails', r.demo_fails)))::json
$$;

create or replace function public._admin_json(r public.products) returns json
language sql stable security definer set search_path = '' as $$
  select (public._public_json(r)::jsonb || jsonb_build_object(
    'id', r.id, 'status', r.status, 'review_note', r.review_note, 'contact_email', r.contact_email,
    'created_at', r.created_at, 'price_eur', r.price_eur, 'referred_by', r.referred_by,
    'site_checked_at', r.site_checked_at, 'site_status', r.site_status, 'site_fails', r.site_fails, 'site_last_ok_at', r.site_ok_at,
    'demo_checked_at', r.demo_checked_at, 'demo_status', r.demo_status, 'demo_fails', r.demo_fails, 'demo_last_ok_at', r.demo_ok_at,
    'open_reports', (select count(*) from public.reports x where x.product_id = r.id and not x.resolved),
    'views_30', (select count(*) from public.events e where e.product_id = r.id and e.kind = 'view' and e.day > current_date - 30),
    'clicks_30', (select count(*) from public.events e where e.product_id = r.id and e.kind in ('visit', 'demo') and e.day > current_date - 30),
    'spotlight_rank', public._spotlight_rank(r.id),
    'spotlight_blocked', r.spotlight_blocked))::json
$$;

-- Admin: keep a product out of the Spotlight (or let it back in). The Spotlight is recalculated at once.
create or replace function public.admin_spotlight_block(p_key text, p_slug text, p_blocked boolean) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products;
begin
  perform public._admin(p_key);
  update public.products set spotlight_blocked = coalesce(p_blocked, false) where slug = p_slug returning * into r;
  if r.id is null then raise exception 'not_found'; end if;
  perform public._spotlight_refresh();
  return public._admin_json(r);
end $$;

-- A newly verified domain can earn a place right away.
create or replace function public._mark_verified(p_slug text) returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare v timestamptz;
begin
  update public.products set verified_at = coalesce(verified_at, now()) where slug = p_slug returning verified_at into v;
  perform public._spotlight_refresh();
  return v;
end $$;

revoke execute on function public._spotlight_refresh(), public._spotlight_rank(bigint) from public, anon, authenticated;
revoke execute on function public._mark_verified(text) from public, anon, authenticated;
revoke execute on function public.public_spotlight(), public.admin_spotlight_block(text, text, boolean) from public;
grant execute on function public.public_spotlight(), public.admin_spotlight_block(text, text, boolean) to anon, authenticated;

select public._spotlight_refresh();
