-- What followers see: launches, verifications, profile updates and releases, one row per event.
create table if not exists public.updates (
  id bigint generated always as identity primary key,
  product_id bigint not null,
  kind text not null check (kind in ('launched', 'verified', 'updated', 'release')),
  title text not null default '' check (char_length(title) <= 160),
  url text not null default '',
  at timestamptz not null default now()
);
create index if not exists updates_product_at_idx on public.updates (product_id, at desc);
alter table public.updates enable row level security;

-- GitHub: the owner connects a public repo; it counts once the product's site links to it (or the repo holds the
-- verification token). Releases come from the repo's public releases feed.
alter table public.products
  add column if not exists repo text not null default '' check (repo = '' or repo ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$'),
  add column if not exists repo_verified_at timestamptz,
  add column if not exists releases_checked_at timestamptz;

create table if not exists public.releases (
  product_id bigint not null,
  repo text not null,
  tag text not null check (char_length(tag) <= 120),
  title text not null check (char_length(title) <= 160),
  url text not null,
  published_at timestamptz not null,
  notes text not null default '' check (char_length(notes) <= 400),
  primary key (product_id, repo, tag)
);
create index if not exists releases_recent_idx on public.releases (product_id, published_at desc);
alter table public.releases enable row level security;

revoke all on public.updates, public.releases from anon, authenticated;

-- Writes update rows when a live product changes. Text edits within a day are merged into one "updated" row.
create or replace function public._products_updates() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_parts text[] := '{}'; v_prev text[]; v_id bigint;
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and not exists (select 1 from public.updates where product_id = new.id and kind = 'launched') then
    insert into public.updates (product_id, kind, title) values (new.id, 'launched', 'Launched on Expanse');
  end if;
  if new.status = 'approved' and new.verified_at is not null and old.verified_at is null then
    insert into public.updates (product_id, kind, title) values (new.id, 'verified', 'Verified ' || new.domain);
  end if;
  if new.status = 'approved' and old.status = 'approved' then
    if new.tagline is distinct from old.tagline or new.description is distinct from old.description then v_parts := v_parts || 'description'::text; end if;
    if new.pricing is distinct from old.pricing or new.price_text is distinct from old.price_text then v_parts := v_parts || 'price'::text; end if;
    if new.needs is distinct from old.needs then v_parts := v_parts || 'what it solves'::text; end if;
    if new.platforms is distinct from old.platforms then v_parts := v_parts || 'platforms'::text; end if;
    if new.integrations is distinct from old.integrations then v_parts := v_parts || 'integrations'::text; end if;
    if new.demo_url is distinct from old.demo_url and new.demo_url <> '' then v_parts := v_parts || 'demo'::text; end if;
    if cardinality(v_parts) > 0 then
      select id, string_to_array(substring(title from 9), ', ') into v_id, v_prev
        from public.updates where product_id = new.id and kind = 'updated' and at > now() - interval '1 day' order by at desc limit 1;
      if v_id is null then
        insert into public.updates (product_id, kind, title) values (new.id, 'updated', left('Updated ' || array_to_string(v_parts, ', '), 160));
      else
        update public.updates
           set title = left('Updated ' || array_to_string(v_prev || array(select x from unnest(v_parts) x where not (x = any (v_prev))), ', '), 160), at = now()
         where id = v_id;
      end if;
    end if;
  end if;
  return null;
end $$;
revoke execute on function public._products_updates() from public, anon, authenticated;
create or replace trigger products_updates after update on public.products for each row execute function public._products_updates();

-- A new link or repo starts its checks from scratch, so an old "works" or "connected" never sticks to a new address.
create or replace function public._products_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  if new.url is distinct from old.url then
    new.site_checked_at := null; new.site_ok_at := null; new.site_fails := 0; new.site_status := '';
  end if;
  if new.demo_url is distinct from old.demo_url then
    new.demo_checked_at := null; new.demo_ok_at := null; new.demo_fails := 0; new.demo_status := '';
  end if;
  if new.repo is distinct from old.repo then
    new.repo_verified_at := null; new.releases_checked_at := null;
  end if;
  return new;
end $$;
revoke execute on function public._products_touch() from public, anon, authenticated;
