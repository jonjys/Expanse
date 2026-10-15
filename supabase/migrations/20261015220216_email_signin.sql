-- Sign-in with email. A 6-digit code goes to the contact email of a product; entering it gives this browser its own
-- key (a device key) for every product listed with that address. The original owner key keeps working. Device keys
-- can be signed out from the owner panel, and recovering a key through the domain signs them all out.

create table if not exists public.owner_keys (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id),
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists owner_keys_product_idx on public.owner_keys (product_id) where revoked_at is null;
alter table public.owner_keys enable row level security;

-- Codes are stored as hashes, tied to a hash of the address.
create table if not exists public.email_codes (
  id bigint generated always as identity primary key,
  email_hash text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz
);
create index if not exists email_codes_email_idx on public.email_codes (email_hash, created_at desc);
alter table public.email_codes enable row level security;

-- One row per request and per code attempt, by visitor (daily-salted hash), for rate limits.
create table if not exists public.signin_log (
  id bigint generated always as identity primary key,
  vhash text not null,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists signin_log_idx on public.signin_log (vhash, kind, at desc);
alter table public.signin_log enable row level security;

revoke all on public.owner_keys, public.email_codes, public.signin_log from anon, authenticated;

-- Emails that are useless after a point in time (sign-in codes) are never sent late.
alter table public.outbox add column if not exists expires_at timestamptz;

-- Owner check: the owner key or an active device key. Returns the product row or raises "bad_key".
create or replace function public._owned(p_slug text, p_key text) returns public.products
language plpgsql stable security definer set search_path = '' as $$
declare r public.products; h text := public._key_hash(p_key);
begin
  select * into r from public.products where slug = p_slug and status <> 'removed';
  if r.id is null or char_length(coalesce(p_key, '')) < 10
     or (r.owner_key_hash <> h and not exists (
           select 1 from public.owner_keys k where k.key_hash = h and k.product_id = r.id and k.revoked_at is null)) then
    raise exception 'bad_key';
  end if;
  return r;
end $$;

-- Is email sending set up (a Resend key saved from the admin page)?
create or replace function public._email_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select decrypted_secret <> '' from vault.decrypted_secrets where name = 'resend_api_key' limit 1), false)
$$;

-- Step 1: send a code. The answer is the same whether or not the address is on file, and whether or not a code
-- went out (at most one a minute and five an hour per address), so it can't be used to test addresses.
create or replace function public.email_signin_start(p_email text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_eh text;
  v_vh text := public._visitor_hash();
  v_code text; v_names text; v_n int;
begin
  if char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email'; end if;
  if not public._email_ready() then return json_build_object('ok', true, 'delivery', 'unavailable'); end if;
  if (select count(*) from public.signin_log where vhash = v_vh and kind = 'start' and at > now() - interval '1 hour') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into public.signin_log (vhash, kind) values (v_vh, 'start');
  v_eh := public._key_hash(v_email);
  select count(*), string_agg(p.name, ', ' order by p.created_at) into v_n, v_names
    from (select name, created_at from public.products where contact_email = v_email and status <> 'removed' order by created_at limit 20) p;
  if v_n = 0
     or exists (select 1 from public.email_codes where email_hash = v_eh and created_at > now() - interval '1 minute')
     or (select count(*) from public.email_codes where email_hash = v_eh and created_at > now() - interval '1 hour') >= 5 then
    return json_build_object('ok', true, 'delivery', 'queued');
  end if;
  v_code := lpad((('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint % 1000000)::text, 6, '0');
  -- Only the newest code works.
  update public.email_codes set expires_at = now() where email_hash = v_eh and used_at is null and expires_at > now();
  insert into public.email_codes (email_hash, code_hash, expires_at)
  values (v_eh, public._key_hash(v_eh || ':' || v_code), now() + interval '15 minutes');
  insert into public.outbox (to_email, subject, body, kind, expires_at)
  values (v_email, 'Your Expanse sign-in code: ' || v_code,
    left(E'Your sign-in code for Expanse:\n\n' || v_code || E'\n\nIt works for 15 minutes and signs you in to manage ' || left(v_names, 300) ||
      E'.\n\nIf you didn''t ask for this code, you can ignore this email. Nobody can sign in without it.' ||
      E'\n\n— Expanse\nhttps://expanse.nyttolabs.com', 6000),
    'signin_code', now() + interval '15 minutes');
  perform public._kick_worker('mail');
  return json_build_object('ok', true, 'delivery', 'queued');
end $$;

-- Step 2: the code. Right → a device key for each product listed with the address. Wrong → { ok: false } (five
-- wrong tries end the code). Answers instead of raising, so the attempt is counted.
create or replace function public.email_signin_verify(p_email text, p_code text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_eh text := public._key_hash(lower(btrim(coalesce(p_email, ''))));
  v_vh text := public._visitor_hash();
  c public.email_codes;
  v_out json;
begin
  if (select count(*) from public.signin_log where vhash = v_vh and kind = 'verify' and at > now() - interval '1 hour') >= 30 then
    return json_build_object('ok', false, 'reason', 'slow_down');
  end if;
  insert into public.signin_log (vhash, kind) values (v_vh, 'verify');
  select * into c from public.email_codes
   where email_hash = v_eh and used_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if c.id is null then return json_build_object('ok', false, 'reason', 'bad_code'); end if;
  if char_length(v_code) <> 6 or c.code_hash <> public._key_hash(v_eh || ':' || v_code) then
    update public.email_codes
       set attempts = attempts + 1, expires_at = case when attempts + 1 >= 5 then now() else expires_at end
     where id = c.id;
    return json_build_object('ok', false, 'reason', 'bad_code');
  end if;
  update public.email_codes set used_at = now() where id = c.id;
  with p as (
    select id, slug, name, public._new_key() as k
      from public.products where contact_email = v_email and status <> 'removed' order by created_at limit 20),
  ins as (insert into public.owner_keys (product_id, key_hash) select id, public._key_hash(k) from p returning product_id)
  select coalesce(json_agg(json_build_object('slug', p.slug, 'name', p.name, 'key', p.k) order by p.name), '[]'::json)
    into v_out from p;
  return json_build_object('ok', true, 'products', v_out);
end $$;

-- Owner panel: sign out this device ("this", only for a device key) or every other email sign-in ("others").
create or replace function public.owner_signout(p_slug text, p_key text, p_scope text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug, p_key); h text := public._key_hash(p_key); n int;
begin
  if p_scope = 'this' then
    update public.owner_keys set revoked_at = now() where product_id = r.id and key_hash = h and revoked_at is null;
  elsif p_scope = 'others' then
    update public.owner_keys set revoked_at = now() where product_id = r.id and key_hash <> h and revoked_at is null;
  else
    raise exception 'invalid:scope';
  end if;
  get diagnostics n = row_count;
  return json_build_object('revoked', n);
end $$;

-- Owner view gains the number of active email sign-ins.
create or replace function public._owner_json(r public.products) returns json
language sql stable security definer set search_path = '' as $$
  select (public._public_json(r)::jsonb || jsonb_build_object(
    'status', r.status, 'review_note', r.review_note, 'verify_token', r.verify_token,
    'created_at', r.created_at, 'price_eur', r.price_eur,
    'number', (select count(*) from public.reservations) + (select count(*) from public.products q where q.id <= r.id and q.status in ('pending', 'approved', 'hidden')),
    'referrals', (select count(*) from public.products q where q.referred_by = r.slug and q.status in ('pending', 'approved', 'hidden')),
    'email', regexp_replace(r.contact_email, '^(.{1,2})[^@]*', '\1•••'),
    'repo_requested', r.repo,
    'devices', (select count(*) from public.owner_keys k where k.product_id = r.id and k.revoked_at is null),
    'checks', jsonb_build_object(
      'site_checked_at', r.site_checked_at, 'site_status', r.site_status, 'site_fails', r.site_fails,
      'demo_checked_at', r.demo_checked_at, 'demo_status', r.demo_status, 'demo_fails', r.demo_fails)))::json
$$;

-- A key recovered through the domain also signs out every email sign-in.
create or replace function public._complete_recovery(p_slug text, p_token text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_key text := public._new_key(); v_id bigint;
begin
  update public.products
     set owner_key_hash = public._key_hash(v_key), verified_at = coalesce(verified_at, now()),
         recovery_token = null, recovery_secret_hash = null, recovery_expires_at = null
   where slug = p_slug and recovery_token = p_token and recovery_expires_at > now()
  returning id into v_id;
  if v_id is null then raise exception 'bad_recovery'; end if;
  update public.owner_keys set revoked_at = now() where product_id = v_id and revoked_at is null;
  return v_key;
end $$;

-- Emails due for sending; claims them for 10 minutes so two runs never send the same email.
-- Expired emails (sign-in codes) are marked failed instead, and a sent code is cleared from the outbox after a day.
create or replace function public._outbox_claim(p_limit int) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v json;
begin
  update public.outbox set failed_at = now(), error = 'expired'
   where sent_at is null and failed_at is null and expires_at <= now();
  update public.outbox set subject = 'Your Expanse sign-in code', body = '(sign-in code, cleared after a day)'
   where kind = 'signin_code' and created_at < now() - interval '1 day' and subject <> 'Your Expanse sign-in code';
  with c as (
    select id from public.outbox
    where sent_at is null and failed_at is null and send_after <= now() and (expires_at is null or expires_at > now())
    order by id limit greatest(1, least(p_limit, 50))
    for update skip locked),
  u as (
    update public.outbox o set send_after = now() + interval '10 minutes', attempts = o.attempts + 1
    from c where o.id = c.id
    returning o.id, o.to_email, o.subject, o.body, o.kind, o.attempts)
  select coalesce(json_agg(json_build_object('id', u.id, 'to', u.to_email, 'subject', u.subject, 'body', u.body, 'kind', u.kind, 'attempts', u.attempts) order by u.id), '[]'::json)
    into v from u;
  return v;
end $$;

-- The "live" email now mentions signing in with the address too.
create or replace function public._notify_owner(r public.products, p_kind text, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_url text := 'https://expanse.nyttolabs.com/p/' || r.slug;
  v_subject text; v_body text;
  v_foot text := E'\n\n— Expanse\nhttps://expanse.nyttolabs.com\n\nYou get this email because ' || r.name || E' is listed on Expanse. Replies to this address aren''t read.';
begin
  if r.contact_email is null or r.contact_email like '%.invalid' then return; end if;
  if p_kind = 'approved' then
    v_subject := r.name || ' is live on Expanse';
    v_body := 'Good news: ' || r.name || E' passed review and is now live in the Expanse universe.\n\n' || v_url ||
      E'\n\nOpen the page and choose “Manage my product” to see profile views and clicks, verify your domain and share your page. ' ||
      E'On another device, choose “I make this” and sign in with your owner key or this email address.';
  elsif p_kind = 'rejected' then
    v_subject := r.name || ' needs a few changes';
    v_body := r.name || E' wasn''t approved yet. The reviewer wrote:\n\n“' || p_note || E'”\n\nOpen ' || v_url ||
      E', choose “I make this” and sign in with your owner key or this email address. Edit the profile and save: it goes back to review automatically.';
  elsif p_kind = 'hidden' then
    v_subject := r.name || ' is hidden for now';
    v_body := r.name || E' is hidden from Expanse while we look into it. The reviewer wrote:\n\n“' || p_note || E'”\n\nOpen ' || v_url ||
      E' and sign in as the maker to see the details. Once it''s sorted, we show it again.';
  else
    return;
  end if;
  insert into public.outbox (to_email, subject, body, kind, product_id)
  values (r.contact_email, left(v_subject, 200), left(v_body || v_foot, 6000), 'review_' || p_kind, r.id);
end $$;

revoke execute on function public._email_ready() from public, anon, authenticated;
revoke execute on function
  public.email_signin_start(text), public.email_signin_verify(text, text), public.owner_signout(text, text, text)
from public;
grant execute on function
  public.email_signin_start(text), public.email_signin_verify(text, text), public.owner_signout(text, text, text)
to anon, authenticated;
