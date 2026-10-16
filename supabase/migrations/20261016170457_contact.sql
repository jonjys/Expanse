-- Contact: visitors and makers can write to the people running Expanse without a public address. The message goes
-- to the admin's notification email, with the sender as reply-to, so a reply is one click.

alter table public.outbox add column if not exists reply_to text check (reply_to is null or char_length(reply_to) <= 254);

-- One row per message, by visitor (daily-salted hash), for rate limits.
create table if not exists public.contact_log (
  id bigint generated always as identity primary key,
  vhash text not null,
  at timestamptz not null default now()
);
create index if not exists contact_log_idx on public.contact_log (vhash, at desc);
alter table public.contact_log enable row level security;
revoke all on public.contact_log from anon, authenticated;

-- p_topic: question | data | placement | other. Three messages an hour per visitor, 30 an hour in all.
create or replace function public.contact_message(p_email text, p_message text, p_topic text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_msg text := public._text(p_message, 2000);
  v_topic text := case when p_topic in ('question', 'data', 'placement', 'other') then p_topic else 'question' end;
  v_to text := coalesce(public._setting('notify_email') #>> '{}', '');
  v_vh text := public._visitor_hash();
  v_label text;
begin
  if char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email'; end if;
  if char_length(v_msg) < 10 then raise exception 'invalid:message'; end if;
  if v_to = '' or not public._email_ready() then return json_build_object('ok', false, 'reason', 'unavailable'); end if;
  if (select count(*) from public.contact_log where vhash = v_vh and at > now() - interval '1 hour') >= 3 then raise exception 'slow_down'; end if;
  if (select count(*) from public.contact_log where at > now() - interval '1 hour') >= 30 then raise exception 'busy'; end if;
  insert into public.contact_log (vhash) values (v_vh);
  v_label := case v_topic when 'data' then 'My data' when 'placement' then 'Sponsored slot' when 'other' then 'Something else' else 'Question' end;
  insert into public.outbox (to_email, subject, body, kind, reply_to)
  values (v_to, left('Expanse contact · ' || v_label || ' · ' || v_email, 200),
    left('From: ' || v_email || E'\nTopic: ' || v_label || E'\n\n' || v_msg || E'\n\n— Sent from the contact form on expanse.nyttolabs.com. Reply to this email to answer.', 6000),
    'contact', v_email);
  perform public._kick_worker('mail');
  return json_build_object('ok', true);
end $$;

-- The worker's claim now includes reply_to.
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
    returning o.id, o.to_email, o.subject, o.body, o.kind, o.attempts, o.reply_to)
  select coalesce(json_agg(json_build_object('id', u.id, 'to', u.to_email, 'subject', u.subject, 'body', u.body, 'kind', u.kind, 'attempts', u.attempts, 'reply_to', u.reply_to) order by u.id), '[]'::json)
    into v from u;
  return v;
end $$;

revoke execute on function public.contact_message(text, text, text) from public;
grant execute on function public.contact_message(text, text, text) to anon, authenticated;
