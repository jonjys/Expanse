-- One row holding today's salt. It is overwritten on the first visit of a new day,
-- so yesterday's hashes can never be linked to anyone again.
create table if not exists public.salts (
  id int primary key default 1 check (id = 1),
  day date not null,
  salt bytea not null
);
alter table public.salts enable row level security;
revoke all on public.salts from anon, authenticated;

create or replace function public._visitor_hash() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  h json := public._headers();
  ip text := btrim(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1), ''));
  ua text := coalesce(h->>'user-agent', '');
  s bytea;
begin
  select salt into s from public.salts where id = 1 and day = current_date;
  if s is null then
    insert into public.salts (id, day, salt) values (1, current_date, extensions.gen_random_bytes(32))
    on conflict (id) do update set day = excluded.day, salt = excluded.salt where public.salts.day <> excluded.day;
    select salt into s from public.salts where id = 1;
  end if;
  return encode(extensions.digest(s || convert_to(ip || '|' || ua, 'UTF8'), 'sha256'), 'hex');
end $$;
revoke execute on function public._visitor_hash() from public, anon, authenticated;
