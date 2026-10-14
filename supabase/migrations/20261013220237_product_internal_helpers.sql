-- Normalizes and validates the editable fields. Raises "invalid:<field>".
create or replace function public._product_fields(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_name text := public._line(p->>'name', 40);
  v_tag text := public._line(p->>'tagline', 90);
  v_desc text := public._text(p->>'description', 1200);
  v_aud text := public._line(p->>'audience', 140);
  v_cat text := coalesce(p->>'category', '');
  v_pricing text := coalesce(p->>'pricing', '');
  v_ptext text := public._line(p->>'price_text', 60);
  v_url text := public._url(p->>'url');
  v_demo text := btrim(coalesce(p->>'demo_url', ''));
  v_needs text[] := '{}';
  v_plat text[] := '{}';
  v_int text[] := '{}';
  v_img text[] := '{}';
  e text;
begin
  if char_length(v_name) < 2 then raise exception 'invalid:name'; end if;
  if char_length(v_tag) < 8 then raise exception 'invalid:tagline'; end if;
  if char_length(v_desc) < 30 then raise exception 'invalid:description'; end if;
  if char_length(v_aud) < 3 then raise exception 'invalid:audience'; end if;
  if v_cat not in ('productivity','developer','design','marketing','finance','ai','commerce','education','health','other') then raise exception 'invalid:category'; end if;
  if v_pricing not in ('free','freemium','trial','paid') then raise exception 'invalid:pricing'; end if;
  if v_url is null then raise exception 'invalid:url'; end if;
  if v_demo <> '' then
    v_demo := public._url(v_demo);
    if v_demo is null then raise exception 'invalid:demo_url'; end if;
  end if;

  for e in select jsonb_array_elements_text(case when jsonb_typeof(p->'needs') = 'array' then p->'needs' else '[]' end) loop
    e := lower(public._line(e, 60));
    if char_length(e) >= 2 and not (e = any (v_needs)) then v_needs := v_needs || e; end if;
  end loop;
  if cardinality(v_needs) < 1 or cardinality(v_needs) > 6 then raise exception 'invalid:needs'; end if;

  for e in select jsonb_array_elements_text(case when jsonb_typeof(p->'platforms') = 'array' then p->'platforms' else '[]' end) loop
    if e in ('web','ios','android','macos','windows','linux','api','extension') and not (e = any (v_plat)) then v_plat := v_plat || e; end if;
  end loop;

  for e in select jsonb_array_elements_text(case when jsonb_typeof(p->'integrations') = 'array' then p->'integrations' else '[]' end) loop
    e := public._line(e, 30);
    if char_length(e) >= 1 and not (lower(e) = any (select lower(x) from unnest(v_int) x)) then v_int := v_int || e; end if;
  end loop;
  if cardinality(v_int) > 12 then raise exception 'invalid:integrations'; end if;

  for e in select jsonb_array_elements_text(case when jsonb_typeof(p->'images') = 'array' then p->'images' else '[]' end) loop
    e := btrim(e);
    if e = '' then continue; end if;
    if char_length(e) > 400 or e ~ '\s' or e !~* '^https://[^/?#@]+\.[a-z]{2,}(/|$)' then raise exception 'invalid:images'; end if;
    if not (e = any (v_img)) then v_img := v_img || e; end if;
  end loop;
  if cardinality(v_img) > 4 then raise exception 'invalid:images'; end if;

  return jsonb_build_object(
    'name', v_name, 'tagline', v_tag, 'description', v_desc, 'audience', v_aud,
    'category', v_cat, 'pricing', v_pricing, 'price_text', v_ptext,
    'url', v_url, 'demo_url', coalesce(v_demo, ''), 'domain', public._domain(v_url),
    'needs', to_jsonb(v_needs), 'platforms', to_jsonb(v_plat),
    'integrations', to_jsonb(v_int), 'images', to_jsonb(v_img));
end $$;

create or replace function public._public_json(r public.products) returns json
language sql stable set search_path = '' as $$
  select json_build_object(
    'slug', r.slug, 'name', r.name, 'tagline', r.tagline, 'description', r.description,
    'audience', r.audience, 'category', r.category, 'needs', r.needs, 'pricing', r.pricing,
    'price_text', r.price_text, 'platforms', r.platforms, 'integrations', r.integrations,
    'url', r.url, 'demo_url', r.demo_url, 'images', r.images, 'domain', r.domain,
    'x', r.x, 'y', r.y, 'size', r.size, 'zone', r.zone, 'sponsored', r.sponsored,
    'verified_at', r.verified_at, 'approved_at', r.approved_at, 'updated_at', r.updated_at)
$$;

-- Raises "spot_taken" when the square overlaps a held spot (reservations or live/pending products).
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
    where q.status in ('pending', 'approved', 'hidden') and q.id is distinct from p_ignore_product
      and q.x < p_x + p_size and p_x < q.x + q.size and q.y < p_y + p_size and p_y < q.y + q.size)
  then raise exception 'spot_taken'; end if;
end $$;

-- Owner check: returns the product row or raises "bad_key".
create or replace function public._owned(p_slug text, p_key text) returns public.products
language plpgsql stable security definer set search_path = '' as $$
declare r public.products;
begin
  select * into r from public.products where slug = p_slug and status <> 'removed';
  if r.id is null or r.owner_key_hash <> public._key_hash(p_key) then raise exception 'bad_key'; end if;
  return r;
end $$;

create or replace function public._mark_owner(p_id bigint) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.owner_marks (product_id, day, vhash) values (p_id, current_date, public._visitor_hash())
  on conflict do nothing
$$;

create or replace function public._owner_json(r public.products) returns json
language sql stable security definer set search_path = '' as $$
  select (public._public_json(r)::jsonb || jsonb_build_object(
    'status', r.status, 'review_note', r.review_note, 'verify_token', r.verify_token,
    'created_at', r.created_at, 'price_eur', r.price_eur,
    'number', (select count(*) from public.reservations) + (select count(*) from public.products q where q.id <= r.id and q.status in ('pending', 'approved', 'hidden')),
    'referrals', (select count(*) from public.products q where q.referred_by = r.slug and q.status in ('pending', 'approved', 'hidden')),
    'email', regexp_replace(r.contact_email, '^(.{1,2})[^@]*', '\1•••')))::json
$$;

revoke execute on function
  public._product_fields(jsonb), public._public_json(public.products),
  public._assert_free(int, int, int, bigint, text), public._owned(text, text),
  public._mark_owner(bigint), public._owner_json(public.products)
from public, anon, authenticated;
