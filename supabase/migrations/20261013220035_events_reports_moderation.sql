-- Unique visitors per product, kind and day. vhash is a daily-salted hash (see _visitor_hash).
create table if not exists public.events (
  product_id bigint not null,
  kind text not null check (kind in ('view', 'visit', 'demo')),
  day date not null default current_date,
  vhash text not null,
  primary key (product_id, kind, day, vhash)
);
create index if not exists events_day_vhash_idx on public.events (day, vhash);
alter table public.events enable row level security;

-- Visitor hashes that opened the owner panel on a given day; left out of the owner's stats.
create table if not exists public.owner_marks (
  product_id bigint not null,
  day date not null default current_date,
  vhash text not null,
  primary key (product_id, day, vhash)
);
alter table public.owner_marks enable row level security;

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  product_id bigint not null,
  reason text not null check (reason in ('broken_link', 'wrong_info', 'spam', 'other')),
  details text not null default '' check (char_length(details) <= 600),
  vhash text not null,
  day date not null default current_date,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, vhash, day, reason)
);
create index if not exists reports_open_idx on public.reports (product_id) where not resolved;
alter table public.reports enable row level security;

revoke all on public.events, public.owner_marks, public.reports from anon, authenticated;

-- For the person reviewing: everything waiting for a decision.
create or replace view public.moderation_queue with (security_invoker = true) as
  select p.id, p.status, p.name, p.slug, p.url, p.category, p.tagline, p.contact_email, p.created_at, p.updated_at,
         (select count(*) from public.reports r where r.product_id = p.id and not r.resolved) as open_reports
  from public.products p
  where p.status = 'pending'
     or (p.status = 'approved' and exists (select 1 from public.reports r where r.product_id = p.id and not r.resolved))
  order by p.created_at;
revoke all on public.moderation_queue from anon, authenticated;
