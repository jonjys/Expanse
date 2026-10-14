-- Internal: called by the verify-domain edge function over the database connection.
create or replace function public._verify_target(p_slug text, p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug, p_key);
begin
  if r.last_check_at > now() - interval '8 seconds' then raise exception 'slow_down'; end if;
  update public.products set last_check_at = now() where id = r.id;
  return json_build_object('domain', r.domain, 'url', r.url, 'token', r.verify_token);
end $$;

create or replace function public._mark_verified(p_slug text) returns timestamptz
language sql volatile security definer set search_path = '' as $$
  update public.products set verified_at = coalesce(verified_at, now()) where slug = p_slug returning verified_at
$$;

create or replace function public._recovery_target(p_slug text, p_token text, p_secret text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products;
begin
  select * into r from public.products
   where slug = p_slug and status in ('pending', 'approved', 'hidden')
     and recovery_token = p_token and recovery_secret_hash = public._key_hash(p_secret) and recovery_expires_at > now();
  if r.id is null then raise exception 'bad_recovery'; end if;
  if r.last_check_at > now() - interval '8 seconds' then raise exception 'slow_down'; end if;
  update public.products set last_check_at = now() where id = r.id;
  return json_build_object('domain', r.domain, 'url', r.url, 'token', p_token);
end $$;

create or replace function public._complete_recovery(p_slug text, p_token text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_key text := public._new_key(); v_id bigint;
begin
  update public.products
     set owner_key_hash = public._key_hash(v_key), verified_at = coalesce(verified_at, now()),
         recovery_token = null, recovery_secret_hash = null, recovery_expires_at = null
   where slug = p_slug and recovery_token = p_token and recovery_expires_at > now()
  returning id into v_id;
  if v_id is null then raise exception 'bad_recovery'; end if;
  return v_key;
end $$;

revoke execute on function
  public._verify_target(text, text), public._mark_verified(text),
  public._recovery_target(text, text, text), public._complete_recovery(text, text)
from public, anon, authenticated;

-- Legacy founding reservations must not land on top of products either.
create or replace function public.reserve_spot(p_email text, p_name text, p_mode text, p_x integer, p_y integer, p_size integer default 2, p_ref text default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_zone text := public.zone_of(p_x, p_y, p_size);
  v_row public.reservations;
begin
  perform pg_advisory_xact_lock(4242);
  if (select count(*) from public.reservations where created_at > now() - interval '1 minute') >= 40 then
    raise exception 'busy';
  end if;
  perform public._assert_free(p_x, p_y, p_size, null, v_email);

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

notify pgrst, 'reload schema';
