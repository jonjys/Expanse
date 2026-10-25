-- Additive Growth Studio. Existing payments, ranking and campaign IDs are unchanged.
alter table expanse_private.marketing_campaigns add column name text not null default 'Profile sharing kit', add column kind text not null default 'launch';
alter table expanse_private.marketing_campaigns add constraint campaign_name_length check(char_length(name) between 2 and 60), add constraint campaign_kind check(kind in ('launch','update','comparison','black-friday','christmas','newsletter','community'));
alter table expanse_private.campaign_events drop constraint campaign_events_channel_check;
alter table expanse_private.campaign_events add constraint campaign_events_channel_check check(channel in ('x','threads','linkedin','newsletter','other'));
create table expanse_private.growth_actions (
 product_id bigint not null references public.products(id) on delete cascade,
 action text not null check(action in ('profile','headline','website','campaign-fit','first-campaign')),
 completed_at timestamptz not null default now(), baseline jsonb not null,
 primary key(product_id,action)
);
alter table expanse_private.growth_actions enable row level security;
revoke all on expanse_private.growth_actions from public,anon,authenticated;
create function expanse_private.acquisition_window(pid bigint,days int,back int) returns jsonb
language sql stable security definer set search_path='' as $$
 with e as(select e.* from public.events e where e.product_id=pid and e.day between current_date-back-days+1 and current_date-back and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash)),
 x as(select e.* from expanse_private.exposure_events e where e.product_id=pid and e.day between current_date-back-days+1 and current_date-back and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash)),
 c as(select e.* from expanse_private.campaign_events e where e.product_id=pid and e.day between current_date-back-days+1 and current_date-back and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash))
 select jsonb_build_object('impressions',(select count(distinct(day,vhash)) from x),'views',(select count(*) from e where kind='view'),'visits',(select count(*) from e where kind='visit'),'demos',(select count(*) from e where kind='demo'),
 'matched_visits',(select count(*) from e where kind='view' and exists(select 1 from e v where v.kind='visit' and v.day=e.day and v.vhash=e.vhash)),
 'campaign_views',(select count(distinct(day,vhash)) from c where kind='view'),'campaign_visits',(select count(distinct(day,vhash)) from c where kind='visit'),
 'campaign_matched',(select count(distinct(day,vhash)) from c where kind='view' and exists(select 1 from c v where v.kind='visit' and v.day=c.day and v.vhash=c.vhash and v.campaign=c.campaign and v.channel=c.channel)),
 'card_opens',(select count(distinct(d.day,d.vhash)) from expanse_private.discovery_events d join x on x.day=d.day and x.vhash=d.vhash and x.source=d.source where d.product_id=pid and d.kind='view'),
 'verified_purchases',null,'saves',null,'follows',null)
$$;
-- The original two-argument RPC stays compatible; enriched data comes from the same events.
create or replace function public.owner_acquisition_stats(p_slug text,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);base jsonb;src jsonb;channel_rows jsonb;campaign_rows jsonb;daily jsonb;actions jsonb;
begin
 base:=expanse_private.acquisition_window(r.id,30,0);
 with d as(select e.* from expanse_private.discovery_events e where e.product_id=r.id and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash)),
 x as(select e.* from expanse_private.exposure_events e where e.product_id=r.id and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash))
 select jsonb_agg(jsonb_build_object('source',s,'impressions',case when s in ('search','list','home') then(select count(*) from x where source=s) else null end,'views',(select count(*) from d where source=s and kind='view'),'visits',(select count(*) from d where source=s and kind='visit'))) into src from unnest(array['search','list','home','map','shared','sponsored']) s;
 with c as(select e.* from expanse_private.campaign_events e where e.product_id=r.id and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash))
 select coalesce(jsonb_agg(t),'[]'::jsonb) into channel_rows from(select channel,count(*) filter(where kind='view') views,count(*) filter(where kind='visit') visits,count(*) filter(where kind='demo') demos from c group by channel order by count(*) filter(where kind='visit') desc,channel)t;
 with c as(select e.* from expanse_private.campaign_events e where e.product_id=r.id and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash))
 select coalesce(jsonb_agg(t),'[]'::jsonb) into campaign_rows from(select m.campaign,m.name,m.kind,m.created_at,count(c.*) filter(where c.kind='view') views,count(c.*) filter(where c.kind='visit') visits,count(c.*) filter(where c.kind='demo') demos from expanse_private.marketing_campaigns m left join c on c.campaign=m.campaign where m.product_id=r.id group by m.product_id,m.campaign order by m.created_at desc limit 50)t;
 with e as(select e.* from public.events e where e.product_id=r.id and e.day>=current_date-59 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash))
 select jsonb_agg(jsonb_build_object('day',d::date,'views',(select count(*) from e where day=d::date and kind='view'),'visits',(select count(*) from e where day=d::date and kind='visit'),'demos',(select count(*) from e where day=d::date and kind='demo')) order by d) into daily from generate_series(current_date-59,current_date,interval '1 day') d;
 select coalesce(jsonb_agg(jsonb_build_object('action',a.action,'completed_at',a.completed_at,'baseline',a.baseline,'after',(select jsonb_build_object('days',least(30,greatest(0,current_date-a.completed_at::date)),'views',count(*) filter(where kind='view'),'visits',count(*) filter(where kind='visit')) from public.events e where e.product_id=r.id and e.day>a.completed_at::date and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash)))),'[]'::jsonb) into actions from expanse_private.growth_actions a where a.product_id=r.id;
 return jsonb_build_object('totals',base,'sources',src,'campaigns',channel_rows,'campaign_rows',campaign_rows,'daily',daily,'actions',actions,'window_days',30,
 'windows',jsonb_build_object('7',jsonb_build_object('current',expanse_private.acquisition_window(r.id,7,0),'previous',expanse_private.acquisition_window(r.id,7,7)),'30',jsonb_build_object('current',base,'previous',expanse_private.acquisition_window(r.id,30,30))),
 'coverage',jsonb_build_object('exposures_from','2026-10-21','campaigns_from','2026-10-21','profile_from',r.approved_at::date,'source_days',30,'retention_days',90,'saves','Browser-local; not collected','follows','Browser-local; not collected'));
end $$;
create function public.owner_create_campaign(p_slug text,p_key text,p_name text,p_kind text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);c text;n text:=btrim(p_name);
begin
 if r.status<>'approved' then raise exception 'review_required';end if;
 if n is null or char_length(n) not between 2 and 60 or n~'[[:cntrl:]]' or p_kind is null or p_kind not in ('launch','update','comparison','black-friday','christmas','newsletter','community') then raise exception 'invalid:campaign';end if;
 perform 1 from public.products where id=r.id for update;
 select campaign into c from expanse_private.marketing_campaigns where product_id=r.id and name=n and kind=p_kind order by created_at limit 1;
 if c is null then
  if (select count(*) from expanse_private.marketing_campaigns where product_id=r.id)>=50 then raise exception 'campaign_limit';end if;
  if (select count(*) from expanse_private.marketing_campaigns where product_id=r.id and created_at>now()-interval '1 hour')>=10 then raise exception 'slow_down';end if;
  c:='mk-'||left(public._key_hash(public._new_key()),12);
  insert into expanse_private.marketing_campaigns(product_id,campaign,name,kind) values(r.id,c,n,p_kind);
 end if;
 return jsonb_build_object('campaign',c,'name',n,'kind',p_kind);
end $$;
create function public.owner_growth_action(p_slug text,p_key text,p_action text,p_complete boolean) returns void
language plpgsql volatile security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);
begin
 if p_action is null or p_action not in ('profile','headline','website','campaign-fit','first-campaign') or p_complete is null then raise exception 'invalid:action';end if;
 if p_complete then insert into expanse_private.growth_actions(product_id,action,baseline) values(r.id,p_action,expanse_private.acquisition_window(r.id,7,0)) on conflict do nothing;
 else delete from expanse_private.growth_actions where product_id=r.id and action=p_action;end if;
end $$;

create or replace function public.track_campaign(p_slug text,p_kind text,p_campaign text,p_channel text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare pid bigint;h text;
begin
 if p_kind is null or p_kind not in ('view','visit','demo') or p_channel is null or p_channel not in ('x','threads','linkedin','newsletter','other') or public._is_bot() then return;end if;
 select p.id into pid from public.products p join expanse_private.marketing_campaigns c on c.product_id=p.id where p.slug=p_slug and p.status='approved' and c.campaign=p_campaign;if pid is null then return;end if;
 h:=public._visitor_hash();
 if exists(select 1 from public.owner_marks where product_id=pid and day=current_date and vhash=h) then return;end if;
 if (select count(*) from expanse_private.campaign_events where day=current_date and vhash=h)>=300 then return;end if;
 insert into expanse_private.campaign_events(product_id,kind,channel,campaign,vhash) values(pid,p_kind,p_channel,p_campaign,h) on conflict do nothing;
end $$;

revoke all on function expanse_private.acquisition_window(bigint,int,int) from public,anon,authenticated;
revoke all on function public.owner_create_campaign(text,text,text,text),public.owner_growth_action(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.owner_create_campaign(text,text,text,text),public.owner_growth_action(text,text,text,boolean) to anon,authenticated;
notify pgrst,'reload schema';

-- Optional seasonal offers require verified ownership and a separate human evidence review.
create table expanse_private.seasonal_offers (
 product_id bigint primary key references public.products(id) on delete cascade,
 title text not null check(char_length(title) between 5 and 100), details text not null check(char_length(details) between 20 and 600),
 offer_url text not null, evidence_url text not null, season text not null check(season in ('black-friday','christmas','launch')),
 starts_at timestamptz not null, ends_at timestamptz not null, state text not null default 'pending' check(state in ('pending','approved','declined')),
 evidence_note text not null check(char_length(evidence_note) between 20 and 1000),reviewed_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '90 days')
);
alter table expanse_private.seasonal_offers enable row level security;
revoke all on expanse_private.seasonal_offers from public,anon,authenticated;
create index seasonal_offers_active_idx on expanse_private.seasonal_offers(ends_at) where state='approved';
create function public.owner_seasonal_offer(p_slug text,p_key text,p_offer jsonb default null,p_remove boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);u text;e text;
begin
 if p_remove then delete from expanse_private.seasonal_offers where product_id=r.id;
 elsif p_offer is not null then
  if r.status<>'approved' or r.verified_at is null then raise exception 'verified_product_required';end if;
  u:=p_offer->>'offer_url';e:=p_offer->>'evidence_url';
  if u is null or e is null or u!~'^https://[^/@?#[:space:]]+(/|$)' or e!~'^https://[^/@?#[:space:]]+(/|$)' or length(u)>500 or length(e)>500 or lower(split_part(split_part(u,'://',2),'/',1))<>lower(r.domain) or lower(split_part(split_part(e,'://',2),'/',1))<>lower(r.domain) then raise exception 'invalid:offer_url';end if;
  if (p_offer->>'ends_at')::timestamptz<=now() then raise exception 'invalid:offer_date';end if;
  insert into expanse_private.seasonal_offers(product_id,title,details,offer_url,evidence_url,season,starts_at,ends_at,evidence_note)
  values(r.id,btrim(p_offer->>'title'),btrim(p_offer->>'details'),u,e,p_offer->>'season',(p_offer->>'starts_at')::timestamptz,(p_offer->>'ends_at')::timestamptz,btrim(p_offer->>'evidence_note'))
  on conflict(product_id) do update set title=excluded.title,details=excluded.details,offer_url=excluded.offer_url,evidence_url=excluded.evidence_url,season=excluded.season,starts_at=excluded.starts_at,ends_at=excluded.ends_at,evidence_note=excluded.evidence_note,state='pending',reviewed_at=null,updated_at=now();
 end if;
 return(select to_jsonb(o)-'product_id' from expanse_private.seasonal_offers o where product_id=r.id);
end $$;
create function public.public_seasonal_offers() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(t),'[]'::jsonb) from(select p.slug,o.title,o.details,o.offer_url,o.season,o.starts_at,o.ends_at,o.reviewed_at from expanse_private.seasonal_offers o join public.products p on p.id=o.product_id where p.status='approved' and p.verified_at is not null and o.state='approved' and now() between o.starts_at and o.ends_at order by p.slug)t
$$;
create function public.admin_seasonal_offers(p_key text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin perform public._admin(p_key);return(select coalesce(jsonb_agg(t),'[]'::jsonb) from(select p.slug,p.name,o.* from expanse_private.seasonal_offers o join public.products p on p.id=o.product_id where o.ends_at>now() order by (o.state='pending') desc,o.updated_at)t);end $$;
create function public.admin_review_offer(p_key text,p_slug text,p_approve boolean,p_evidence_checked boolean) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform public._admin(p_key);
 if p_approve is null or (p_approve and not coalesce(p_evidence_checked,false)) then raise exception 'evidence_required';end if;
 update expanse_private.seasonal_offers o set state=case when p_approve then 'approved' else 'declined' end,reviewed_at=now() from public.products p where p.id=o.product_id and p.slug=p_slug and p.status='approved' and p.verified_at is not null and o.ends_at>now();
 if not found then raise exception 'not_available';end if;
end $$;
revoke all on function public.owner_seasonal_offer(text,text,jsonb,boolean),public.public_seasonal_offers(),public.admin_seasonal_offers(text),public.admin_review_offer(text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.owner_seasonal_offer(text,text,jsonb,boolean),public.public_seasonal_offers(),public.admin_seasonal_offers(text),public.admin_review_offer(text,text,boolean,boolean) to anon,authenticated;

-- Minimal first-party maker adoption. Daily dedup; no account identifiers or search text.
create table expanse_private.studio_usage (
 product_id bigint not null references public.products(id) on delete cascade,
 day date not null default current_date,
 action text not null check(action in ('open','kit-open','copy','download')),
 primary key(product_id,day,action)
);
alter table expanse_private.studio_usage enable row level security;
revoke all on expanse_private.studio_usage from public,anon,authenticated;
create index studio_usage_day_idx on expanse_private.studio_usage(day);
create function public.owner_studio_event(p_slug text,p_key text,p_action text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);
begin
 if p_action is null or p_action not in ('open','kit-open','copy','download') then raise exception 'invalid:action';end if;
 if r.status='approved' then insert into expanse_private.studio_usage(product_id,action) values(r.id,p_action) on conflict do nothing;end if;
 delete from expanse_private.studio_usage where product_id=r.id and day<current_date-90;
end $$;
create function public.admin_growth_metrics(p_key text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform public._admin(p_key);
 return jsonb_build_object('approved_products',(select count(*) from public.products where status='approved'),
 'unique_makers',null,'unique_makers_note','An owner account can list several products; contact emails are not a reliable unique-maker identity.',
 'median_review_hours',(select percentile_cont(.5) within group(order by extract(epoch from(approved_at-created_at))/3600) from public.products where status='approved' and approved_at is not null),
 'studio_products_30',(select count(distinct product_id) from expanse_private.studio_usage where action='open' and day>=current_date-29),
 'kit_products_30',(select count(distinct product_id) from expanse_private.studio_usage where action='kit-open' and day>=current_date-29),
 'asset_copy_products_30',(select count(distinct product_id) from expanse_private.studio_usage where action='copy' and day>=current_date-29),
 'download_products_30',(select count(distinct product_id) from expanse_private.studio_usage where action='download' and day>=current_date-29),
 'returning_studio_products_30',(select count(*) from(select product_id from expanse_private.studio_usage where action='open' and day>=current_date-29 group by product_id having count(*)>1)t),
 'campaign_reached_products_30',(select count(distinct e.product_id) from expanse_private.campaign_events e where e.day>=current_date-29 and e.kind='view' and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash)),
 'outbound_clicks_30',(select count(*) from public.events e where e.kind='visit' and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash)),
 'paid_map_orders',(select count(*) from expanse_private.map_purchases where paid_at is not null),
 'stripe_confirmed_gross_eur',(select coalesce(sum(amount_cents),0)/100.0 from expanse_private.map_purchases where paid_at is not null),
 'revenue_note','Gross map payments confirmed by the existing Stripe webhook. Refunds, disputes, fees and taxes are not deducted. This is not net revenue or third-party maker sales.');
end $$;
revoke all on function public.owner_studio_event(text,text,text),public.admin_growth_metrics(text) from public,anon,authenticated;
grant execute on function public.owner_studio_event(text,text,text),public.admin_growth_metrics(text) to anon,authenticated;
select cron.schedule('expanse-studio-retention','48 3 * * *',$$delete from expanse_private.studio_usage where day<current_date-90; delete from expanse_private.seasonal_offers where ends_at<now()-interval '90 days'$$);
notify pgrst,'reload schema';
