-- When the email plan's quota (Resend: daily, or monthly) is used up, waiting emails are held until the next UTC day
-- instead of failing, and email sign-in says it's paused until then (the owner key and domain recovery still work).

-- Internal (worker): puts a claimed email back in the queue for the next UTC day and pauses email until then.
create or replace function public._outbox_defer(p_id bigint) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_until timestamptz := (date_trunc('day', now() at time zone 'utc') + interval '1 day') at time zone 'utc';
begin
  update public.outbox
     set send_after = v_until, attempts = greatest(0, attempts - 1), error = 'held: the email plan''s quota is used up for today'
   where id = p_id and sent_at is null;
  perform public._set_setting('email_paused_until', to_jsonb(v_until));
end $$;

-- Is email sending set up and not paused by the quota?
create or replace function public._email_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select decrypted_secret <> '' from vault.decrypted_secrets where name = 'resend_api_key' limit 1), false)
     and coalesce((public._setting('email_paused_until') #>> '{}')::timestamptz <= now(), true)
$$;

-- Settings show the pause to the admin.
create or replace function public.admin_settings(p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_paused timestamptz := (public._setting('email_paused_until') #>> '{}')::timestamptz;
begin
  perform public._admin(p_key);
  return json_build_object(
    'notify_email', coalesce(public._setting('notify_email') #>> '{}', ''),
    'placement_price_eur', (public._setting('placement_price_eur') #>> '{}')::numeric,
    'keys', (select count(*) from public.admin_keys where revoked_at is null),
    'email', json_build_object(
      'connected', exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key' and coalesce(decrypted_secret, '') <> ''),
      'paused_until', case when v_paused > now() then v_paused end,
      'last_sent_at', (select max(sent_at) from public.outbox),
      'last_error', (select error from public.outbox where error <> '' and error <> 'expired' and error not like 'held:%' and sent_at is null order by id desc limit 1),
      'waiting', (select count(*) from public.outbox where sent_at is null and failed_at is null)));
end $$;

revoke execute on function public._outbox_defer(bigint), public._email_ready() from public, anon, authenticated;

-- Saving settings can resume email at once (after upgrading the email plan), or with a new key.
create or replace function public.admin_save_settings(p_key text, p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mail text := lower(btrim(coalesce(p->>'notify_email', '')));
  v_resend text := btrim(coalesce(p->>'resend_api_key', ''));
  v_price numeric;
begin
  perform public._admin(p_key);
  if p ? 'notify_email' then
    if v_mail <> '' and (char_length(v_mail) > 254 or v_mail !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid:notify_email'; end if;
    perform public._set_setting('notify_email', to_jsonb(v_mail));
  end if;
  if p ? 'placement_price_eur' then
    begin
      v_price := nullif(btrim(coalesce(p->>'placement_price_eur', '')), '')::numeric;
    exception when others then raise exception 'invalid:placement_price_eur';
    end;
    if v_price is not null and (v_price < 0 or v_price > 100000) then raise exception 'invalid:placement_price_eur'; end if;
    perform public._set_setting('placement_price_eur', coalesce(to_jsonb(round(v_price, 2)), 'null'::jsonb));
  end if;
  if p ? 'resend_api_key' then
    if v_resend !~ '^re_[A-Za-z0-9_]{10,120}$' then raise exception 'invalid:resend_api_key'; end if;
    perform public._set_resend_key(v_resend);
    -- emails that failed on a bad key get another go right away
    update public.outbox set failed_at = null, attempts = 0, send_after = now(), error = ''
     where sent_at is null and error like 'resend 401%';
  end if;
  if p ? 'resend_api_key' or coalesce((p->>'resume_email')::boolean, false) then
    perform public._set_setting('email_paused_until', 'null'::jsonb);
    update public.outbox set send_after = now(), error = '' where sent_at is null and failed_at is null and error like 'held:%';
    perform public._kick_worker('mail');
  end if;
  return public.admin_settings(p_key);
end $$;
