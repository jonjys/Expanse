-- Email sending is connected from the admin page: the Resend key goes straight into Vault and is never readable again.

create or replace function public._set_resend_key(p_key text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'resend_api_key';
  if v_id is null then
    perform vault.create_secret(p_key, 'resend_api_key', 'Resend API key used by the worker edge function');
  else
    perform vault.update_secret(v_id, p_key);
  end if;
end $$;

create or replace function public.admin_settings(p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  return json_build_object(
    'notify_email', coalesce(public._setting('notify_email') #>> '{}', ''),
    'keys', (select count(*) from public.admin_keys where revoked_at is null),
    'email', json_build_object(
      'connected', exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key' and coalesce(decrypted_secret, '') <> ''),
      'last_sent_at', (select max(sent_at) from public.outbox),
      'last_error', (select error from public.outbox where error <> '' and sent_at is null order by id desc limit 1),
      'waiting', (select count(*) from public.outbox where sent_at is null and failed_at is null)));
end $$;

create or replace function public.admin_save_settings(p_key text, p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mail text := lower(btrim(coalesce(p->>'notify_email', '')));
  v_resend text := btrim(coalesce(p->>'resend_api_key', ''));
begin
  perform public._admin(p_key);
  if p ? 'notify_email' then
    if v_mail <> '' and (char_length(v_mail) > 254 or v_mail !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid:notify_email'; end if;
    perform public._set_setting('notify_email', to_jsonb(v_mail));
  end if;
  if p ? 'resend_api_key' then
    if v_resend !~ '^re_[A-Za-z0-9_]{10,120}$' then raise exception 'invalid:resend_api_key'; end if;
    perform public._set_resend_key(v_resend);
    -- emails that failed on a bad key get another go right away
    update public.outbox set failed_at = null, attempts = 0, send_after = now(), error = ''
     where sent_at is null and error like 'resend 401%';
    perform public._kick_worker('mail');
  end if;
  return public.admin_settings(p_key);
end $$;

revoke execute on function public._set_resend_key(text) from public, anon, authenticated;
revoke execute on function public.admin_settings(text), public.admin_save_settings(text, jsonb) from public;
grant execute on function public.admin_settings(text), public.admin_save_settings(text, jsonb) to anon, authenticated;
