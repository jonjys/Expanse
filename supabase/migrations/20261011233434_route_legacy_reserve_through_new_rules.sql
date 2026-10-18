-- The 5-argument reserve() is what the currently deployed page calls. Route it through the new
-- 7-argument version so zones, prices, the invite-only core and overlap checks always apply.
create or replace function public.reserve(p_email text, p_name text, p_mode text, p_x integer, p_y integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reserve(p_email, p_name, p_mode, p_x, p_y, 2, null::text);
end;
$$;
