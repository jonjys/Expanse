-- The admin page (/admin) talks to these functions with an admin key. Only the key's SHA-256 is stored.

create or replace function public._admin(p_key text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  select id into v_id from public.admin_keys
   where key_hash = public._key_hash(p_key) and revoked_at is null and char_length(coalesce(p_key, '')) >= 20;
  if v_id is null then raise exception 'bad_admin'; end if;
  update public.admin_keys set last_used_at = now()
   where id = v_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
end $$;

-- Issues a new admin key. Internal: run from the SQL editor to create the first key.
create or replace function public._admin_issue() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_key text := 'adm_' || translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
begin
  insert into public.admin_keys (key_hash) values (public._key_hash(v_key));
  return v_key;
end $$;

create or replace function public._setting(p_k text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select v from public.settings where k = p_k
$$;

create or replace function public._set_setting(p_k text, p_v jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.settings (k, v, updated_at) values (p_k, p_v, now())
  on conflict (k) do update set v = excluded.v, updated_at = now()
$$;

-- Queues an email to the maker about a review decision. Nothing is queued for wiped addresses.
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
      E'\n\nOpen the page and choose “Manage my product” (or “I make this” on another device) to see profile views and clicks, verify your domain and share your page.';
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

-- Asks the worker edge function to run now (asynchronous; the cron job runs it every 10 minutes anyway).
create or replace function public._kick_worker(p_task text) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  if v_secret is null then return null; end if;
  return net.http_post(
    url := 'https://gjmkhnrgznorxxaemsmo.supabase.co/functions/v1/worker',
    body := jsonb_build_object('task', coalesce(p_task, 'all')),
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    timeout_milliseconds := 60000);
exception when others then
  return null;
end $$;

create or replace function public._admin_json(r public.products) returns json
language sql stable security definer set search_path = '' as $$
  select (public._public_json(r)::jsonb || jsonb_build_object(
    'id', r.id, 'status', r.status, 'review_note', r.review_note, 'contact_email', r.contact_email,
    'created_at', r.created_at, 'price_eur', r.price_eur, 'referred_by', r.referred_by,
    'site_checked_at', r.site_checked_at, 'site_status', r.site_status, 'site_fails', r.site_fails, 'site_last_ok_at', r.site_ok_at,
    'demo_checked_at', r.demo_checked_at, 'demo_status', r.demo_status, 'demo_fails', r.demo_fails, 'demo_last_ok_at', r.demo_ok_at,
    'open_reports', (select count(*) from public.reports x where x.product_id = r.id and not x.resolved),
    'views_30', (select count(*) from public.events e where e.product_id = r.id and e.kind = 'view' and e.day > current_date - 30),
    'clicks_30', (select count(*) from public.events e where e.product_id = r.id and e.kind in ('visit', 'demo') and e.day > current_date - 30)))::json
$$;

create or replace function public.admin_overview(p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  return json_build_object(
    'counts', (select json_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected'),
        'hidden', count(*) filter (where status = 'hidden'),
        'removed', count(*) filter (where status = 'removed'),
        'failing', count(*) filter (where status = 'approved' and site_fails >= 2),
        'verified', count(*) filter (where status = 'approved' and verified_at is not null))
      from public.products),
    'open_reports', (select count(*) from public.reports where not resolved),
    'reservations', (select count(*) from public.reservations),
    'days', (select json_agg(json_build_object('d', d.day,
        'view', (select count(*) from public.events e where e.day = d.day and e.kind = 'view'),
        'click', (select count(*) from public.events e where e.day = d.day and e.kind in ('visit', 'demo'))) order by d.day)
      from (select generate_series(current_date - 29, current_date, interval '1 day')::date as day) d),
    'top', (select coalesce(json_agg(t), '[]'::json) from (
        select p.slug, p.name, count(*) filter (where e.kind = 'view') as views, count(*) filter (where e.kind in ('visit', 'demo')) as clicks
        from public.events e join public.products p on p.id = e.product_id
        where e.day > current_date - 30
        group by p.slug, p.name order by 3 desc, 4 desc limit 10) t),
    'outbox', (select json_build_object(
        'pending', count(*) filter (where sent_at is null and failed_at is null),
        'failed', count(*) filter (where failed_at is not null and created_at > now() - interval '30 days'),
        'sent_7d', count(*) filter (where sent_at > now() - interval '7 days'))
      from public.outbox),
    'worker', public._setting('worker_last_run'));
end $$;

-- p_filter: queue (needs a decision) | pending | approved | rejected | hidden | removed | all
create or replace function public.admin_products(p_key text, p_filter text) returns json
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  return coalesce((select json_agg(public._admin_json(p) order by
      case when p.status = 'pending' then 0 else 1 end, p.created_at desc)
    from public.products p
    where case coalesce(p_filter, 'queue')
      when 'queue' then p.status = 'pending'
        or (p.status in ('approved', 'hidden') and exists (select 1 from public.reports r where r.product_id = p.id and not r.resolved))
        or (p.status = 'approved' and p.site_fails >= 3)
      when 'all' then true
      else p.status = p_filter end
    limit 1000), '[]'::json);
end $$;

create or replace function public.admin_set_status(p_key text, p_slug text, p_status text, p_note text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.products;
  v_old text;
  v_note text := public._line(p_note, 400);
begin
  perform public._admin(p_key);
  if p_status not in ('approved', 'rejected', 'hidden', 'removed') then raise exception 'invalid:status'; end if;
  select * into r from public.products where slug = p_slug;
  if r.id is null or r.status = 'removed' then raise exception 'not_found'; end if;
  if p_status in ('rejected', 'hidden') and char_length(v_note) < 3 then raise exception 'invalid:note'; end if;
  v_old := r.status;
  if p_status = 'removed' then
    update public.products
       set status = 'removed', review_note = v_note, contact_email = 'removed@removed.invalid', owner_key_hash = '',
           submit_hash = null, recovery_token = null, recovery_secret_hash = null, recovery_expires_at = null
     where id = r.id returning * into r;
  else
    update public.products set status = p_status, review_note = case when p_status = 'approved' then '' else v_note end
     where id = r.id returning * into r;
  end if;
  update public.reports set resolved = true where product_id = r.id and not resolved;
  if v_old is distinct from p_status then
    perform public._notify_owner(r, p_status, v_note);
    perform public._kick_worker('mail');
  end if;
  return public._admin_json(r);
end $$;

create or replace function public.admin_reports(p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  return coalesce((select json_agg(t order by t.resolved, t.created_at desc) from (
    select x.id, x.reason, x.details, x.created_at, x.resolved, x.vhash = 'system' as automatic,
           p.slug, p.name, p.status, p.url
    from public.reports x join public.products p on p.id = x.product_id
    where not x.resolved or x.created_at > now() - interval '30 days'
    order by x.resolved, x.created_at desc limit 300) t), '[]'::json);
end $$;

create or replace function public.admin_resolve_report(p_key text, p_id bigint, p_resolved boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  update public.reports set resolved = coalesce(p_resolved, true) where id = p_id;
  return found;
end $$;

-- Replaces the key used for this call with a new one. The old key stops working at once.
create or replace function public.admin_rotate_key(p_key text) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  update public.admin_keys set revoked_at = now() where key_hash = public._key_hash(p_key);
  return public._admin_issue();
end $$;

create or replace function public.admin_settings(p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._admin(p_key);
  return json_build_object(
    'notify_email', coalesce(public._setting('notify_email') #>> '{}', ''),
    'keys', (select count(*) from public.admin_keys where revoked_at is null));
end $$;

create or replace function public.admin_save_settings(p_key text, p jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v_mail text := lower(btrim(coalesce(p->>'notify_email', '')));
begin
  perform public._admin(p_key);
  if p ? 'notify_email' then
    if v_mail <> '' and (char_length(v_mail) > 254 or v_mail !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid:notify_email'; end if;
    perform public._set_setting('notify_email', to_jsonb(v_mail));
  end if;
  return public.admin_settings(p_key);
end $$;

revoke execute on function
  public._admin(text), public._admin_issue(), public._setting(text), public._set_setting(text, jsonb),
  public._notify_owner(public.products, text, text), public._kick_worker(text), public._admin_json(public.products)
from public, anon, authenticated;

revoke execute on function
  public.admin_overview(text), public.admin_products(text, text), public.admin_set_status(text, text, text, text),
  public.admin_reports(text), public.admin_resolve_report(text, bigint, boolean), public.admin_rotate_key(text),
  public.admin_settings(text), public.admin_save_settings(text, jsonb)
from public;
grant execute on function
  public.admin_overview(text), public.admin_products(text, text), public.admin_set_status(text, text, text, text),
  public.admin_reports(text), public.admin_resolve_report(text, bigint, boolean), public.admin_rotate_key(text),
  public.admin_settings(text), public.admin_save_settings(text, jsonb)
to anon, authenticated;
