create or replace function public._line(p text, p_max int) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(coalesce(p, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), p_max)
$$;
revoke execute on function public._line(text, int) from public, anon, authenticated;
