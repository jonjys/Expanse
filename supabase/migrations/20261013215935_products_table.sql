create table if not exists public.products (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'),
  name text not null check (char_length(name) between 2 and 40),
  tagline text not null check (char_length(tagline) between 8 and 90),
  description text not null check (char_length(description) between 30 and 1200),
  audience text not null check (char_length(audience) between 3 and 140),
  category text not null check (category in ('productivity','developer','design','marketing','finance','ai','commerce','education','health','other')),
  needs text[] not null check (cardinality(needs) between 1 and 6),
  pricing text not null check (pricing in ('free','freemium','trial','paid')),
  price_text text not null default '' check (char_length(price_text) <= 60),
  platforms text[] not null default '{}' check (platforms <@ array['web','ios','android','macos','windows','linux','api','extension']),
  integrations text[] not null default '{}' check (cardinality(integrations) <= 12),
  url text not null check (public._url(url) = url),
  demo_url text not null default '' check (demo_url = '' or public._url(demo_url) = demo_url),
  images text[] not null default '{}' check (cardinality(images) <= 4),
  domain text not null,
  x int not null check (x between -200 and 200),
  y int not null check (y between -200 and 200),
  size int not null check (size in (1, 2, 4, 8)),
  zone text not null,
  price_eur int not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','hidden','removed')),
  review_note text not null default '' check (char_length(review_note) <= 400),
  sponsored boolean not null default false,
  verified_at timestamptz,
  verify_token text not null default encode(extensions.gen_random_bytes(10), 'hex'),
  last_check_at timestamptz,
  owner_key_hash text not null,
  contact_email text not null check (char_length(contact_email) <= 254 and contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  referred_by text,
  submit_hash text,
  recovery_token text,
  recovery_secret_hash text,
  recovery_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists products_status_idx on public.products (status);
create index if not exists products_pos_idx on public.products (x, y);
create index if not exists products_ref_idx on public.products (referred_by);
alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;

create or replace function public._products_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end $$;
revoke execute on function public._products_touch() from public, anon, authenticated;
create trigger products_touch before update on public.products for each row execute function public._products_touch();
