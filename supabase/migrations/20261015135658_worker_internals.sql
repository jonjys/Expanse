-- Internal functions for the worker edge function (it connects with SUPABASE_DB_URL; none of these are callable through the API).

-- Products whose website / demo check is due (once a day), oldest first.
create or replace function public._health_due(p_limit int) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', p.id, 'url', p.url, 'demo_url', p.demo_url)), '[]'::json)
  from (select id, url, demo_url from public.products
        where status in ('pending', 'approved')
          and (site_checked_at is null or site_checked_at < now() - interval '20 hours')
        order by site_checked_at nulls first, id
        limit greatest(1, least(p_limit, 50))) p
$$;

-- Records one check. After three failed website checks in a row a live product gets an automatic
-- "broken link" report, so it shows up in the admin queue.
create or replace function public._health_record(p_id bigint, p_site_ok boolean, p_site_status text, p_demo_ok boolean, p_demo_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products;
begin
  update public.products set
    site_checked_at = now(),
    site_ok_at = case when p_site_ok then now() else site_ok_at end,
    site_fails = case when p_site_ok then 0 else site_fails + 1 end,
    site_status = left(coalesce(p_site_status, ''), 40),
    demo_checked_at = case when demo_url <> '' and p_demo_ok is not null then now() else demo_checked_at end,
    demo_ok_at = case when demo_url <> '' and p_demo_ok then now() else demo_ok_at end,
    demo_fails = case when demo_url = '' or p_demo_ok is null then demo_fails when p_demo_ok then 0 else demo_fails + 1 end,
    demo_status = case when demo_url <> '' and p_demo_ok is not null then left(coalesce(p_demo_status, ''), 40) else demo_status end
  where id = p_id
  returning * into r;
  if r.id is not null and r.status = 'approved' and r.site_fails >= 3 then
    insert into public.reports (product_id, reason, details, vhash)
    values (r.id, 'broken_link', 'Automatic check: ' || r.url || ' did not answer on 3 daily checks in a row (' || r.site_status || ').', 'system')
    on conflict do nothing;
  end if;
end $$;

-- Emails due for sending; claims them for 10 minutes so two runs never send the same email.
create or replace function public._outbox_claim(p_limit int) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare v json;
begin
  with c as (
    select id from public.outbox
    where sent_at is null and failed_at is null and send_after <= now()
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

create or replace function public._outbox_done(p_id bigint, p_ok boolean, p_error text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.outbox set
    sent_at = case when p_ok then now() end,
    error = left(coalesce(p_error, ''), 300),
    failed_at = case when not p_ok and attempts >= 5 then now() end,
    send_after = case when p_ok then send_after else now() + (attempts * interval '15 minutes') end
  where id = p_id
$$;

-- One summary email to the admin when new products are waiting (only if an address is set in the admin page).
create or replace function public._admin_digest() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_to text := coalesce(public._setting('notify_email') #>> '{}', '');
  v_since timestamptz := coalesce((public._setting('notified_until') #>> '{}')::timestamptz, now() - interval '1 day');
  v_new int; v_names text; v_reports int;
begin
  if v_to = '' then return; end if;
  select count(*), string_agg(name, ', ' order by created_at) into v_new, v_names
    from (select name, created_at from public.products where status = 'pending' and created_at > v_since order by created_at limit 20) s;
  select count(*) into v_reports from public.reports where not resolved and created_at > v_since;
  if v_new = 0 and v_reports = 0 then return; end if;
  insert into public.outbox (to_email, subject, body, kind)
  values (v_to,
    case when v_new > 0 then v_new || ' new product' || case when v_new = 1 then '' else 's' end || ' waiting for review' else v_reports || ' new report' || case when v_reports = 1 then '' else 's' end end,
    case when v_new > 0 then E'Waiting for review: ' || v_names || E'\n\n' else '' end ||
    case when v_reports > 0 then v_reports || E' new report(s) on live products.\n\n' else '' end ||
    E'Open the admin page: https://expanse.nyttolabs.com/admin\n\n— Expanse (you can turn these emails off in the admin settings)',
    'admin_digest');
  perform public._set_setting('notified_until', to_jsonb(now()));
end $$;

revoke execute on function
  public._health_due(int), public._health_record(bigint, boolean, text, boolean, text),
  public._outbox_claim(int), public._outbox_done(bigint, boolean, text), public._admin_digest()
from public, anon, authenticated;
