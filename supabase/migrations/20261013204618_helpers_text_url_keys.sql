create or replace function public._text(p text, p_max int) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(
           replace(replace(coalesce(p, ''), E'\r\n', E'\n'), E'\r', E'\n'),
           E'[\\x01-\\x09\\x0b-\\x1f\\x7f]', ' ', 'g'),
           ' {2,}', ' ', 'g'),
           E'\\n{3,}', E'\n\n', 'g'), E' \n'), p_max)
$$;

create or replace function public._domain(p text) returns text
language sql immutable set search_path = '' as $$
  select case when d ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' then d end
  from (select regexp_replace(lower(substring(coalesce(p, '') from '^[hH][tT][tT][pP][sS]://([^/:?#@]+)')), '^www\.', '') as d) s
$$;

create or replace function public._url(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when v = '' then null
    when char_length(v) > 300 or v ~ '\s' or v !~* '^https://[^/?#]+' or v ~ '^[^/]+//[^/?#]*@' then null
    when public._domain(v) is null then null
    else v end
  from (select btrim(coalesce(p, '')) as v) s
$$;

create or replace function public._slugify(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(btrim(left(btrim(regexp_replace(
           translate(lower(coalesce(p, '')), 'åäöæøéèêëüúùûïíìîóòôõñçß', 'aaoaoeeeeuuuuiiiioooonc' || 's'),
           '[^a-z0-9]+', '-', 'g'), '-'), 40), '-'), ''), 'product')
$$;

create or replace function public._key_hash(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex')
$$;

create or replace function public._new_key() returns text
language sql volatile set search_path = '' as $$
  select translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
$$;

create or replace function public._headers() returns json
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json
$$;

create or replace function public._is_bot() returns boolean
language sql stable set search_path = '' as $$
  select ua is null or ua = '' or ua ~* '(bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|preview|curl|wget|python|httpclient|axios|node-fetch|undici|go-http|java/|okhttp|libwww|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|linkedin|pinterest|skype|monitor|uptime|pingdom|statuscake|scan|check)'
  from (select public._headers()->>'user-agent' as ua) s
$$;

revoke execute on function
  public._text(text, int), public._domain(text), public._url(text), public._slugify(text),
  public._key_hash(text), public._new_key(), public._headers(), public._is_bot()
from public, anon, authenticated;
