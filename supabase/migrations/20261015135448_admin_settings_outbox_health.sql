-- Admin keys (only hashes are stored), a small settings table, an email outbox,
-- and the columns the daily website / demo checks write to.

create table if not exists public.admin_keys (
  id bigint generated always as identity primary key,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.admin_keys enable row level security;

create table if not exists public.settings (
  k text primary key,
  v jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;

-- Emails waiting to be sent by the worker (Resend). Plain text; the worker adds a simple HTML version.
create table if not exists public.outbox (
  id bigint generated always as identity primary key,
  to_email text not null check (char_length(to_email) <= 254),
  subject text not null check (char_length(subject) <= 200),
  body text not null check (char_length(body) <= 6000),
  kind text not null,
  product_id bigint,
  created_at timestamptz not null default now(),
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  attempts int not null default 0,
  error text not null default ''
);
create index if not exists outbox_due_idx on public.outbox (send_after) where sent_at is null and failed_at is null;
alter table public.outbox enable row level security;

revoke all on public.admin_keys, public.settings, public.outbox from anon, authenticated;

-- Daily checks. *_ok_at is the last time the page answered; *_fails counts failed checks in a row.
alter table public.products
  add column if not exists site_checked_at timestamptz,
  add column if not exists site_ok_at timestamptz,
  add column if not exists site_fails int not null default 0,
  add column if not exists site_status text not null default '',
  add column if not exists demo_checked_at timestamptz,
  add column if not exists demo_ok_at timestamptz,
  add column if not exists demo_fails int not null default 0,
  add column if not exists demo_status text not null default '';
create index if not exists products_site_check_idx on public.products (site_checked_at nulls first) where status in ('pending', 'approved');

-- A new link starts its checks from scratch, so an old "works" never sticks to a new address.
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
  return new;
end $$;
revoke execute on function public._products_touch() from public, anon, authenticated;

-- Public signals only show while the latest check passed.
create or replace function public._public_json(r public.products) returns json
language sql stable set search_path = '' as $$
  select json_build_object(
    'slug', r.slug, 'name', r.name, 'tagline', r.tagline, 'description', r.description,
    'audience', r.audience, 'category', r.category, 'needs', r.needs, 'pricing', r.pricing,
    'price_text', r.price_text, 'platforms', r.platforms, 'integrations', r.integrations,
    'url', r.url, 'demo_url', r.demo_url, 'images', r.images, 'domain', r.domain,
    'x', r.x, 'y', r.y, 'size', r.size, 'zone', r.zone, 'sponsored', r.sponsored,
    'verified_at', r.verified_at, 'approved_at', r.approved_at, 'updated_at', r.updated_at,
    'site_ok_at', case when r.site_fails = 0 then r.site_ok_at end,
    'demo_ok_at', case when r.demo_fails = 0 and r.demo_url <> '' then r.demo_ok_at end)
$$;
revoke execute on function public._public_json(public.products) from public, anon, authenticated;

-- The owner panel also shows the latest check results.
create or replace function public._owner_json(r public.products) returns json
language sql stable security definer set search_path = '' as $$
  select (public._public_json(r)::jsonb || jsonb_build_object(
    'status', r.status, 'review_note', r.review_note, 'verify_token', r.verify_token,
    'created_at', r.created_at, 'price_eur', r.price_eur,
    'number', (select count(*) from public.reservations) + (select count(*) from public.products q where q.id <= r.id and q.status in ('pending', 'approved', 'hidden')),
    'referrals', (select count(*) from public.products q where q.referred_by = r.slug and q.status in ('pending', 'approved', 'hidden')),
    'email', regexp_replace(r.contact_email, '^(.{1,2})[^@]*', '\1•••'),
    'checks', jsonb_build_object(
      'site_checked_at', r.site_checked_at, 'site_status', r.site_status, 'site_fails', r.site_fails,
      'demo_checked_at', r.demo_checked_at, 'demo_status', r.demo_status, 'demo_fails', r.demo_fails)))::json
$$;
revoke execute on function public._owner_json(public.products) from public, anon, authenticated;
