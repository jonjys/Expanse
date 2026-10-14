create or replace function public.public_products() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(s.j), '[]'::json)
  from (select public._public_json(p) as j from public.products p
        where p.status = 'approved' order by p.approved_at, p.id limit 3000) s
$$;

create or replace function public.public_product(p_slug text) returns json
language sql stable security definer set search_path = '' as $$
  select public._public_json(p) from public.products p where p.slug = p_slug and p.status = 'approved'
$$;

-- Spots that are held but have no live profile: founding reservations and products in review.
create or replace function public.public_spots() returns table (x int, y int, size int, mode text)
language sql stable security definer set search_path = '' as $$
  select r.x, r.y, r.size, r.mode from public.reservations r
  union all
  select p.x, p.y, p.size, 'build' from public.products p where p.status in ('pending', 'hidden')
  limit 6000
$$;

create or replace function public.founding_stats() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'reserved', (select count(*) from public.reservations) + (select count(*) from public.products where status in ('pending', 'approved', 'hidden')),
    'live', (select count(*) from public.products where status = 'approved'),
    'recent', coalesce((select json_agg(t) from (
      select * from (
        (select 'spot' as kind, r.zone, r.mode, null::text as name, null::text as category, null::text as slug, r.created_at as at
           from public.reservations r order by r.created_at desc limit 12)
        union all
        (select 'spot', p.zone, null, null, null, null, p.created_at
           from public.products p where p.status in ('pending', 'approved', 'hidden') order by p.created_at desc limit 12)
        union all
        (select 'product', p.zone, null, p.name, p.category, p.slug, p.approved_at
           from public.products p where p.status = 'approved' and p.approved_at is not null order by p.approved_at desc limit 12)
      ) u order by at desc limit 12) t), '[]'::json))
$$;

create or replace function public.referral_count(p_code text) returns integer
language sql stable security definer set search_path = '' as $$
  select ((select count(*) from public.reservations where referred_by = p_code)
        + (select count(*) from public.products where referred_by = p_code and status in ('pending', 'approved', 'hidden')))::int
$$;

create or replace function public.submit_product(p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  f jsonb := public._product_fields(p);
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_x int; v_y int; v_size int;
  v_zone text; v_slug text; v_base text; v_key text := public._new_key();
  v_hash text := public._visitor_hash();
  v_ref text := nullif(left(btrim(coalesce(p->>'ref', '')), 60), '');
  r public.products;
  i int := 1;
begin
  begin
    v_x := (p->>'x')::int; v_y := (p->>'y')::int; v_size := (p->>'size')::int;
  exception when others then raise exception 'invalid:spot';
  end;
  if v_x is null or v_y is null or v_size is null or v_size not in (1, 2, 4, 8) or abs(v_x) > 200 or abs(v_y) > 200 then raise exception 'invalid:spot'; end if;
  if char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email'; end if;

  perform pg_advisory_xact_lock(4242);
  if (select count(*) from public.products where created_at > now() - interval '1 minute') >= 20 then raise exception 'busy'; end if;
  if (select count(*) from public.products where submit_hash = v_hash and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.products where contact_email = v_email and status = 'pending') >= 5 then
    raise exception 'too_many';
  end if;
  perform public._assert_free(v_x, v_y, v_size, null, null);

  v_zone := public.zone_of(v_x, v_y, v_size);
  v_base := public._slugify(f->>'name');
  v_slug := v_base;
  while exists (select 1 from public.products where slug = v_slug) loop
    i := i + 1; v_slug := v_base || '-' || i;
  end loop;

  insert into public.products (slug, name, tagline, description, audience, category, needs, pricing, price_text,
    platforms, integrations, url, demo_url, images, domain, x, y, size, zone, price_eur,
    owner_key_hash, contact_email, referred_by, submit_hash)
  values (v_slug, f->>'name', f->>'tagline', f->>'description', f->>'audience', f->>'category',
    array(select jsonb_array_elements_text(f->'needs')), f->>'pricing', f->>'price_text',
    array(select jsonb_array_elements_text(f->'platforms')), array(select jsonb_array_elements_text(f->'integrations')),
    f->>'url', f->>'demo_url', array(select jsonb_array_elements_text(f->'images')), f->>'domain',
    v_x, v_y, v_size, v_zone, public.price_per_cell(v_zone) * v_size * v_size,
    public._key_hash(v_key), v_email, v_ref, v_hash)
  returning * into r;

  perform public._mark_owner(r.id);
  return (public._owner_json(r)::jsonb || jsonb_build_object('key', v_key))::json;
end $$;

create or replace function public.owner_get(p_slug text, p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug, p_key);
begin
  perform public._mark_owner(r.id);
  return public._owner_json(r);
end $$;

-- Text edits go live right away. A new link or new images send the product back to review,
-- and a new domain also clears the verification. Rejected products are resubmitted on edit.
create or replace function public.owner_update(p_slug text, p_key text, p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.products := public._owned(p_slug, p_key);
  f jsonb := public._product_fields(p);
  v_status text := r.status;
  v_verified timestamptz := r.verified_at;
  v_images text[] := array(select jsonb_array_elements_text(f->'images'));
begin
  if r.status = 'hidden' then raise exception 'hidden'; end if;
  if (f->>'url' <> r.url or v_images is distinct from r.images) and r.status = 'approved' then v_status := 'pending'; end if;
  if f->>'domain' <> r.domain then v_verified := null; end if;
  if r.status = 'rejected' then v_status := 'pending'; end if;

  update public.products set
    name = f->>'name', tagline = f->>'tagline', description = f->>'description', audience = f->>'audience',
    category = f->>'category', needs = array(select jsonb_array_elements_text(f->'needs')),
    pricing = f->>'pricing', price_text = f->>'price_text',
    platforms = array(select jsonb_array_elements_text(f->'platforms')),
    integrations = array(select jsonb_array_elements_text(f->'integrations')),
    url = f->>'url', demo_url = f->>'demo_url', images = v_images, domain = f->>'domain',
    status = v_status, verified_at = v_verified,
    review_note = case when v_status <> r.status then '' else review_note end
  where id = r.id
  returning * into r;

  perform public._mark_owner(r.id);
  return public._owner_json(r);
end $$;

-- The owner takes the listing down: it disappears everywhere, the spot is freed,
-- and the contact email and key are wiped.
create or replace function public.owner_remove(p_slug text, p_key text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug, p_key);
begin
  update public.products
     set status = 'removed', contact_email = 'removed@removed.invalid', owner_key_hash = '', submit_hash = null,
         recovery_token = null, recovery_secret_hash = null, recovery_expires_at = null
   where id = r.id;
  return true;
end $$;

-- Last 30 days, one row per day. Each number counts unique visitors per day; the owner's own
-- visits (on days they opened their owner panel) and known bots are left out.
create or replace function public.owner_stats(p_slug text, p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug, p_key);
begin
  perform public._mark_owner(r.id);
  return (
    with d as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day),
    ev as (
      select e.day, e.kind, count(*)::int as n
      from public.events e
      where e.product_id = r.id and e.day >= current_date - 29
        and not exists (select 1 from public.owner_marks o where o.product_id = e.product_id and o.day = e.day and o.vhash = e.vhash)
      group by e.day, e.kind)
    select json_build_object(
      'since', r.approved_at,
      'days', json_agg(json_build_object(
        'd', d.day,
        'view', coalesce((select n from ev where ev.day = d.day and ev.kind = 'view'), 0),
        'visit', coalesce((select n from ev where ev.day = d.day and ev.kind = 'visit'), 0),
        'demo', coalesce((select n from ev where ev.day = d.day and ev.kind = 'demo'), 0)) order by d.day))
    from d);
end $$;

create or replace function public.track(p_slug text, p_kind text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint; v_hash text;
begin
  if p_kind not in ('view', 'visit', 'demo') or public._is_bot() then return; end if;
  select id into v_id from public.products where slug = p_slug and status = 'approved';
  if v_id is null then return; end if;
  v_hash := public._visitor_hash();
  if (select count(*) from public.events where day = current_date and vhash = v_hash) >= 300 then return; end if;
  insert into public.events (product_id, kind, day, vhash) values (v_id, p_kind, current_date, v_hash) on conflict do nothing;
end $$;

create or replace function public.report_product(p_slug text, p_reason text, p_details text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  if p_reason not in ('broken_link', 'wrong_info', 'spam', 'other') then raise exception 'invalid:reason'; end if;
  select id into v_id from public.products where slug = p_slug and status = 'approved';
  if v_id is null then raise exception 'not_found'; end if;
  if (select count(*) from public.reports where created_at > now() - interval '1 hour') >= 200 then raise exception 'busy'; end if;
  insert into public.reports (product_id, reason, details, vhash)
  values (v_id, p_reason, public._text(p_details, 600), public._visitor_hash())
  on conflict do nothing;
  return true;
end $$;

-- Lost key: the requester gets a token to publish on the site plus a secret only they hold.
-- Publishing the token proves control of the domain; the secret proves it's the same person.
-- One open request per product; a new one can replace it after 30 minutes.
create or replace function public.start_recovery(p_slug text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.products;
  v_token text := 'expanse-recover-' || encode(extensions.gen_random_bytes(8), 'hex');
  v_secret text := public._new_key();
begin
  select * into r from public.products where slug = p_slug and status in ('pending', 'approved', 'hidden');
  if r.id is null then raise exception 'not_found'; end if;
  if r.recovery_expires_at > now() + interval '47 hours 30 minutes' then raise exception 'busy'; end if;
  update public.products
     set recovery_token = v_token, recovery_secret_hash = public._key_hash(v_secret), recovery_expires_at = now() + interval '48 hours'
   where id = r.id;
  return json_build_object('token', v_token, 'secret', v_secret, 'domain', r.domain);
end $$;

revoke execute on function
  public.public_products(), public.public_product(text), public.public_spots(), public.founding_stats(),
  public.referral_count(text), public.submit_product(jsonb), public.owner_get(text, text),
  public.owner_update(text, text, jsonb), public.owner_remove(text, text), public.owner_stats(text, text),
  public.track(text, text), public.report_product(text, text, text), public.start_recovery(text)
from public;

grant execute on function
  public.public_products(), public.public_product(text), public.public_spots(), public.founding_stats(),
  public.referral_count(text), public.submit_product(jsonb), public.owner_get(text, text),
  public.owner_update(text, text, jsonb), public.owner_remove(text, text), public.owner_stats(text, text),
  public.track(text, text), public.report_product(text, text, text), public.start_recovery(text)
to anon, authenticated;

revoke execute on function public.probe_headers() from public, anon, authenticated;
