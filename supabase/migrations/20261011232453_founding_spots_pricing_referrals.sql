-- Sizes, zones, founding prices and referral codes for reservations.
alter table public.reservations
  add column size integer not null default 2,
  add column zone text,
  add column price_eur integer,
  add column code text not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  add column referred_by text;

alter table public.reservations
  add constraint reservations_size_valid check (size in (1, 2, 4, 8)),
  add constraint reservations_code_unique unique (code);

create index reservations_referred_by_idx on public.reservations (referred_by);
create index reservations_created_at_idx on public.reservations (created_at desc);

-- Zones and founding prices. Keep in sync with ZONES in index.html.
create or replace function public.zone_of(p_x integer, p_y integer, p_size integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d < 14 then 'core'
    when d < 40 then 'inner'
    when d < 80 then 'belt'
    when d < 125 then 'outer'
    else 'edge'
  end
  from (select sqrt(power(p_x + p_size / 2.0, 2) + power(p_y + p_size / 2.0, 2)) as d) s
$$;

create or replace function public.price_per_cell(p_zone text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_zone when 'core' then 49 when 'inner' then 19 when 'belt' then 9 when 'outer' then 4 else 1 end
$$;

update public.reservations
set zone = public.zone_of(x, y, size),
    price_eur = public.price_per_cell(public.zone_of(x, y, size)) * size * size
where zone is null;

-- The one write path. Upserts by email, refuses overlapping spots and the invite-only core,
-- computes zone and price server-side, and returns the visitor's referral code and founding number.
create or replace function public.reserve(
  p_email text, p_name text, p_mode text, p_x integer, p_y integer,
  p_size integer default 2, p_ref text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_zone text := public.zone_of(p_x, p_y, p_size);
  v_row public.reservations;
begin
  perform pg_advisory_xact_lock(4242);
  if v_zone = 'core' then
    raise exception 'core_invite_only';
  end if;
  if (select count(*) from public.reservations where created_at > now() - interval '1 minute') >= 40 then
    raise exception 'busy';
  end if;
  if exists (
    select 1 from public.reservations r
    where r.email <> v_email
      and r.x < p_x + p_size and p_x < r.x + r.size
      and r.y < p_y + p_size and p_y < r.y + r.size
  ) then
    raise exception 'spot_taken';
  end if;

  insert into public.reservations (email, name, mode, x, y, size, zone, price_eur, referred_by)
  values (v_email, trim(p_name), p_mode, p_x, p_y, p_size, v_zone,
          public.price_per_cell(v_zone) * p_size * p_size, nullif(trim(p_ref), ''))
  on conflict (email) do update
    set name = excluded.name, mode = excluded.mode, x = excluded.x, y = excluded.y,
        size = excluded.size, zone = excluded.zone, price_eur = excluded.price_eur, updated_at = now()
  returning * into v_row;

  return json_build_object(
    'code', v_row.code,
    'number', (select count(*) from public.reservations r where r.id <= v_row.id),
    'zone', v_row.zone,
    'price', v_row.price_eur);
end;
$$;

-- Aggregates only: no emails, no names.
create or replace function public.founding_stats()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'reserved', (select count(*) from public.reservations),
    'recent', coalesce((
      select json_agg(t) from (
        select zone, mode, size, created_at as at
        from public.reservations order by created_at desc limit 12) t), '[]'::json))
$$;

-- Positions of reserved spots so the map can show them. No emails, no names.
create or replace function public.public_spots()
returns table (x integer, y integer, size integer, mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.x, r.y, r.size, r.mode from public.reservations r order by r.id limit 5000
$$;

create or replace function public.referral_count(p_code text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_code is null or length(p_code) < 6 then 0
    else (select count(*)::int from public.reservations where referred_by = p_code) end
$$;

revoke all on function public.reserve(text, text, text, integer, integer, integer, text) from public;
revoke all on function public.founding_stats() from public;
revoke all on function public.public_spots() from public;
revoke all on function public.referral_count(text) from public;
grant execute on function public.reserve(text, text, text, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.founding_stats() to anon, authenticated;
grant execute on function public.public_spots() to anon, authenticated;
grant execute on function public.referral_count(text) to anon, authenticated;
