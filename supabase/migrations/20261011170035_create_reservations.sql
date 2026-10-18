create table public.reservations (
  id bigint generated always as identity primary key,
  email text not null,
  name text not null,
  mode text not null,
  x integer not null,
  y integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_email_unique unique (email),
  constraint reservations_email_format check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint reservations_name_len check (char_length(name) between 1 and 24),
  constraint reservations_mode_valid check (mode in ('sell', 'create', 'build', 'hire')),
  constraint reservations_x_range check (x between -200 and 200),
  constraint reservations_y_range check (y between -200 and 200)
);

comment on table public.reservations is 'Founding-square reservations from the Expanse landing page. Written only through public.reserve().';

-- RLS on with no policies: the table is unreachable through the API. Writes go through reserve().
alter table public.reservations enable row level security;
revoke all on table public.reservations from anon, authenticated;

create or replace function public.reserve(p_email text, p_name text, p_mode text, p_x integer, p_y integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reservations (email, name, mode, x, y)
  values (lower(trim(p_email)), trim(p_name), p_mode, p_x, p_y)
  on conflict (email) do update
    set name = excluded.name,
        mode = excluded.mode,
        x = excluded.x,
        y = excluded.y,
        updated_at = now();
end;
$$;

revoke all on function public.reserve(text, text, text, integer, integer) from public;
grant execute on function public.reserve(text, text, text, integer, integer) to anon, authenticated;
