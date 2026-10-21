-- The public Data API can route the RPC, but only the Vercel server knows its token.
create function public.reserve_ai_request(p_token text,p_visitor text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare c expanse_private.ai_config; h timestamptz:=date_trunc('hour',now());d timestamptz:=date_trunc('day',now() at time zone 'utc') at time zone 'utc'; hourly int;daily int;total int;
begin
  select * into c from expanse_private.ai_config where singleton;
  if p_token is null or char_length(p_token)<40 or public._key_hash(p_token) is distinct from c.key_hash then raise exception 'forbidden';end if;
  if not c.enabled then return jsonb_build_object('allowed',false,'reason','daily_capacity','retry_after',3600);end if;
  if p_visitor is null or p_visitor!~'^[a-f0-9]{64}$' then raise exception 'invalid_visitor';end if;
  -- One short transaction serializes quota checks across every Vercel instance.
  perform pg_advisory_xact_lock(81429021);
  delete from expanse_private.ai_usage where bucket<d-interval '2 days';
  select coalesce(sum(requests),0) into total from expanse_private.ai_usage where bucket>=d;
  select coalesce(sum(requests),0) into daily from expanse_private.ai_usage where bucket>=d and visitor=p_visitor;
  select coalesce(requests,0) into hourly from expanse_private.ai_usage where bucket=h and visitor=p_visitor;
  if total>=c.daily_limit then return jsonb_build_object('allowed',false,'reason','daily_capacity','retry_after',ceil(extract(epoch from d+interval '1 day'-now()))::int);end if;
  if daily>=10 or coalesce(hourly,0)>=3 then return jsonb_build_object('allowed',false,'reason','rate_limited','retry_after',case when daily>=10 then ceil(extract(epoch from d+interval '1 day'-now()))::int else ceil(extract(epoch from h+interval '1 hour'-now()))::int end);end if;
  insert into expanse_private.ai_usage(bucket,visitor,requests) values(h,p_visitor,1)
  on conflict(bucket,visitor) do update set requests=expanse_private.ai_usage.requests+1;
  return jsonb_build_object('allowed',true);
end $$;
revoke all on function public.reserve_ai_request(text,text) from public,anon,authenticated;
grant execute on function public.reserve_ai_request(text,text) to anon,authenticated;
comment on function public.reserve_ai_request(text,text) is 'Server-token authenticated AI quota; denies by default. Independent of payments and owner access.';
select cron.schedule('expanse-ai-retention','41 3 * * *', $$delete from expanse_private.ai_usage where bucket < (date_trunc('day',now() at time zone 'utc') at time zone 'utc')-interval '2 days'$$);
