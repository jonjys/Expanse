-- Public data now includes the connected repo and its latest release.
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
                order by x.published_at desc limit 1))
$$;
revoke execute on function public._public_json(public.products) from public, anon, authenticated;

create or replace function public._owner_json(r public.products) returns json
language sql stable security definer set search_path = '' as $$
  select (public._public_json(r)::jsonb || jsonb_build_object(
    'status', r.status, 'review_note', r.review_note, 'verify_token', r.verify_token,
    'created_at', r.created_at, 'price_eur', r.price_eur,
    'number', (select count(*) from public.reservations) + (select count(*) from public.products q where q.id <= r.id and q.status in ('pending', 'approved', 'hidden')),
    'referrals', (select count(*) from public.products q where q.referred_by = r.slug and q.status in ('pending', 'approved', 'hidden')),
    'email', regexp_replace(r.contact_email, '^(.{1,2})[^@]*', '\1•••'),
    'repo_requested', r.repo,
    'checks', jsonb_build_object(
      'site_checked_at', r.site_checked_at, 'site_status', r.site_status, 'site_fails', r.site_fails,
      'demo_checked_at', r.demo_checked_at, 'demo_status', r.demo_status, 'demo_fails', r.demo_fails)))::json
$$;
revoke execute on function public._owner_json(public.products) from public, anon, authenticated;

-- Updates for the products someone follows (slugs kept in their browser). Last 90 days, newest first.
create or replace function public.public_updates(p_slugs text[]) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(t order by t.at desc), '[]'::json) from (
    select p.slug, p.name, p.category, u.kind, u.title, u.url, u.at
    from public.updates u join public.products p on p.id = u.product_id
    where p.status = 'approved' and p.slug = any ((coalesce(p_slugs, '{}'::text[]))[1:200]) and u.at > now() - interval '90 days'
    order by u.at desc limit 300) t
$$;

create or replace function public.public_releases(p_slug text) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('tag', x.tag, 'title', x.title, 'url', x.url, 'at', x.published_at, 'notes', x.notes) order by x.published_at desc), '[]'::json)
  from (select x.* from public.releases x join public.products p on p.id = x.product_id
        where p.slug = p_slug and p.status = 'approved' and p.repo_verified_at is not null and x.repo = p.repo
        order by x.published_at desc limit 8) x
$$;

-- The owner names a GitHub repo ("owner/name" or a github.com link). It shows once verified.
create or replace function public.owner_set_repo(p_slug text, p_key text, p_repo text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.products := public._owned(p_slug, p_key);
  v text := regexp_replace(btrim(coalesce(p_repo, '')), '^(https?://)?(www\.)?github\.com/', '', 'i');
begin
  if r.status = 'hidden' then raise exception 'hidden'; end if;
  if v <> '' then
    v := substring(v from '^([A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100})');
    v := regexp_replace(coalesce(v, ''), '\.git$', '');
    if v = '' or v !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$' then raise exception 'invalid:repo'; end if;
  end if;
  update public.products set repo = v where id = r.id returning * into r;
  perform public._mark_owner(r.id);
  return public._owner_json(r);
end $$;

-- Internal (verify-domain edge function): what to look for when the owner asks to connect the repo.
create or replace function public._repo_target(p_slug text, p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug, p_key);
begin
  if r.repo = '' then raise exception 'no_repo'; end if;
  if r.last_check_at > now() - interval '8 seconds' then raise exception 'slow_down'; end if;
  update public.products set last_check_at = now() where id = r.id;
  return json_build_object('domain', r.domain, 'url', r.url, 'repo', r.repo, 'token', r.verify_token);
end $$;

create or replace function public._mark_repo_verified(p_slug text, p_repo text) returns timestamptz
language sql volatile security definer set search_path = '' as $$
  update public.products set repo_verified_at = coalesce(repo_verified_at, now()), releases_checked_at = null
  where slug = p_slug and repo = p_repo returning repo_verified_at
$$;

-- Internal (worker): repos to refresh, every 6 hours.
create or replace function public._releases_due(p_limit int) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', p.id, 'repo', p.repo)), '[]'::json)
  from (select id, repo from public.products
        where status = 'approved' and repo <> '' and repo_verified_at is not null
          and (releases_checked_at is null or releases_checked_at < now() - interval '6 hours')
        order by releases_checked_at nulls first, id
        limit greatest(1, least(p_limit, 30))) p
$$;

-- Stores releases from the feed. New releases become updates for followers; on the first sync only the
-- newest one does (if it's recent), so connecting a repo doesn't flood anyone.
create or replace function public._releases_record(p_id bigint, p_repo text, p_items jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.products;
  e jsonb;
  v_first boolean;
  v_n int;
  v_new int := 0;
  v_at timestamptz;
  v_newest timestamptz;
begin
  select * into r from public.products where id = p_id;
  if r.id is null or r.repo <> p_repo then return 0; end if;
  v_first := not exists (select 1 from public.releases where product_id = p_id and repo = p_repo);
  select max((x->>'at')::timestamptz) into v_newest from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
   where coalesce(x->>'tag', '') <> '' and coalesce(x->>'url', '') ~ '^https://github\.com/';
  for e in select x from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x loop
    if coalesce(e->>'tag', '') = '' or coalesce(e->>'url', '') !~ '^https://github\.com/' then continue; end if;
    v_at := (e->>'at')::timestamptz;
    insert into public.releases (product_id, repo, tag, title, url, published_at, notes)
    values (p_id, p_repo, left(e->>'tag', 120), left(coalesce(nullif(btrim(e->>'title'), ''), e->>'tag'), 160), left(e->>'url', 400), v_at, left(coalesce(e->>'notes', ''), 400))
    on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_new := v_new + 1;
      if r.status = 'approved' and v_at > now() - interval '30 days' and (not v_first or v_at = v_newest) then
        insert into public.updates (product_id, kind, title, url, at)
        values (p_id, 'release', left('Released ' || coalesce(nullif(btrim(e->>'title'), ''), e->>'tag'), 160), left(e->>'url', 400), least(v_at, now()));
      end if;
    end if;
  end loop;
  update public.products set releases_checked_at = now() where id = p_id;
  return v_new;
end $$;

revoke execute on function
  public._repo_target(text, text), public._mark_repo_verified(text, text),
  public._releases_due(int), public._releases_record(bigint, text, jsonb)
from public, anon, authenticated;

revoke execute on function public.public_updates(text[]), public.public_releases(text), public.owner_set_repo(text, text, text) from public;
grant execute on function public.public_updates(text[]), public.public_releases(text), public.owner_set_repo(text, text, text) to anon, authenticated;
