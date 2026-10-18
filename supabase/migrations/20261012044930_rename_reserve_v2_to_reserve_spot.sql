-- Two public.reserve overloads make PostgREST ambiguous (HTTP 300) for 5-argument calls.
-- Give the new version its own name; the legacy 5-argument reserve() delegates to it.
alter function public.reserve(text, text, text, integer, integer, integer, text) rename to reserve_spot;

create or replace function public.reserve(p_email text, p_name text, p_mode text, p_x integer, p_y integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reserve_spot(p_email, p_name, p_mode, p_x, p_y, 2, null::text);
end;
$$;

notify pgrst, 'reload schema';
