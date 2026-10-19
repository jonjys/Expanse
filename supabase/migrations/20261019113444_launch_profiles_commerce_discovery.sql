-- Optional profile fields keep the first listing small without inventing product facts.
alter table public.products drop constraint products_description_check;
alter table public.products add constraint products_description_check check (char_length(description) = 0 or char_length(description) between 30 and 1200);
alter table public.products drop constraint products_audience_check;
alter table public.products add constraint products_audience_check check (char_length(audience) = 0 or char_length(audience) between 3 and 140);
alter table public.products drop constraint products_needs_check;
alter table public.products add constraint products_needs_check check (cardinality(needs) between 0 and 6);
alter table public.products drop constraint products_pricing_check;
alter table public.products add constraint products_pricing_check check (pricing in ('unspecified','free','freemium','trial','paid'));

-- No table access is granted. Deliberately public RPCs check owner keys, admin keys,
-- visitor limits, or the independent 256-bit webhook credential before doing work.
create schema if not exists expanse_private;
revoke all on schema expanse_private from public, anon, authenticated;
create table expanse_private.commerce_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  webhook_key_hash text not null default ''
);
insert into expanse_private.commerce_config default values;
create table expanse_private.map_catalog (
  zone text not null check (zone in ('inner','belt','outer','edge')),
  size int not null check (size in (1,2,4,8)),
  amount_cents int not null check (amount_cents > 0),
  payment_link text not null unique check (payment_link ~ '^plink_'),
  url text not null check (url ~ '^https://buy[.]stripe[.]com/[a-zA-Z0-9]+$'),
  primary key (zone,size)
);
create table expanse_private.map_purchases (
  id uuid primary key default extensions.gen_random_uuid(),
  product_id bigint not null references public.products(id),
  x int not null, y int not null, size int not null, zone text not null,
  amount_cents int not null, payment_link text not null,
  state text not null default 'pending' check (state in ('pending','paid','failed','expired','refunded','disputed','needs_review')),
  session_id text unique, payment_intent text,
  created_at timestamptz not null default now(),
  paid_at timestamptz, ends_at timestamptz,
  issue text not null default ''
);
create index map_purchases_product_idx on expanse_private.map_purchases(product_id,created_at desc);
create index map_purchases_payment_intent_idx on expanse_private.map_purchases(payment_intent) where payment_intent is not null;
create table expanse_private.stripe_events (
  event_id text primary key,
  session_id text,
  purchase_id uuid references expanse_private.map_purchases(id),
  outcome text not null,
  created_at timestamptz not null default now()
);
alter table expanse_private.commerce_config enable row level security;
alter table expanse_private.map_catalog enable row level security;
alter table expanse_private.map_purchases enable row level security;
alter table expanse_private.stripe_events enable row level security;
revoke all on all tables in schema expanse_private from public,anon,authenticated;

create or replace function public.public_commerce() returns json
language sql stable security definer set search_path = '' as $$
 select json_build_object('enabled', c.enabled, 'currency','eur','months',12,
 'prices',coalesce((select json_agg(json_build_object('zone',m.zone,'size',m.size,'amount_cents',m.amount_cents)) from expanse_private.map_catalog m),'[]'::json))
 from expanse_private.commerce_config c where singleton
$$;

create or replace function public.owner_map_status(p_slug text,p_key text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug,p_key); b expanse_private.map_purchases;
begin
 select * into b from expanse_private.map_purchases where product_id=r.id
 order by (state='paid' and ends_at>now()) desc,created_at desc limit 1;
 return json_build_object('state',case when b.state='paid' and b.ends_at<=now() then 'expired' else coalesce(b.state,'free') end,
   'ends_at',b.ends_at,'paid_at',b.paid_at,'issue',b.issue,
   'zone',r.zone,'size',r.size,'amount_cents',public.price_per_cell(r.zone)*r.size*r.size*100,
   'can_pay',r.status='approved' and not exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()));
end $$;

create or replace function public.owner_choose_map_spot(p_slug text,p_key text,p_x int,p_y int,p_size int) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug,p_key); z text;
begin
 if r.status not in ('pending','approved') then raise exception 'not_available'; end if;
 if p_x is null or p_y is null or p_size is null or p_size not in (1,2,4,8) or abs(p_x)>200 or abs(p_y)>200 then raise exception 'invalid:spot'; end if;
 perform pg_advisory_xact_lock(4242);
 perform 1 from public.products where id=r.id for update;
 if exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()) then raise exception 'active_purchase'; end if;
 if exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='pending' and created_at>now()-interval '24 hours') then raise exception 'checkout_open'; end if;
 perform public._assert_free(p_x,p_y,p_size,r.id,null);
 z := public.zone_of(p_x,p_y,p_size);
 update public.products set x=p_x,y=p_y,size=p_size,zone=z,price_eur=public.price_per_cell(z)*p_size*p_size where id=r.id returning * into r;
 return public._owner_json(r);
end $$;

create or replace function public.owner_map_checkout(p_slug text,p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug,p_key); m expanse_private.map_catalog; b expanse_private.map_purchases;
begin
 if r.status <> 'approved' then raise exception 'review_required'; end if;
 if not (select enabled from expanse_private.commerce_config where singleton) then raise exception 'payments_paused'; end if;
 perform pg_advisory_xact_lock(4242);
 select * into r from public.products where id=r.id for update;
 if exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()) then raise exception 'already_paid'; end if;
 select * into m from expanse_private.map_catalog where zone=r.zone and size=r.size;
 if m.zone is null or m.amount_cents <> public.price_per_cell(r.zone)*r.size*r.size*100 then raise exception 'payments_paused'; end if;
 select * into b from expanse_private.map_purchases where product_id=r.id and state='pending' and x=r.x and y=r.y and size=r.size
 and payment_link=m.payment_link and created_at>now()-interval '24 hours' order by created_at desc limit 1;
 if b.id is null then
   if (select count(*) from expanse_private.map_purchases where product_id=r.id and created_at>now()-interval '1 hour')>=5 then raise exception 'too_many'; end if;
   insert into expanse_private.map_purchases(product_id,x,y,size,zone,amount_cents,payment_link)
   values(r.id,r.x,r.y,r.size,r.zone,m.amount_cents,m.payment_link) returning * into b;
 end if;
 return json_build_object('id',b.id,'url',m.url||'?client_reference_id='||b.id::text,'amount_cents',b.amount_cents,'months',12);
end $$;

-- Called only by the signature-verifying Vercel endpoint. A publishable Supabase key
-- alone can never fulfil an order. We persist no Stripe customer/address/card data.
create or replace function public.confirm_map_payment(p_token text,p_event jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare b expanse_private.map_purchases; r public.products; v_id uuid; v_event text:=p_event->>'id';
 v_type text:=p_event->>'type'; v_session text:=p_event->>'session_id'; v_out text; v_rows int;
begin
 if p_token is null or char_length(p_token)<40 or public._key_hash(p_token) is distinct from
   (select webhook_key_hash from expanse_private.commerce_config where singleton) then raise exception 'forbidden'; end if;
 if v_event is null or v_event !~ '^evt_[a-zA-Z0-9_]+$' then raise exception 'invalid:event'; end if;
 if coalesce((p_event->>'livemode')::boolean,false) is not true then return json_build_object('outcome','ignored_test'); end if;
 perform pg_advisory_xact_lock(4242);
 if exists(select 1 from expanse_private.stripe_events where event_id=v_event) then return json_build_object('outcome','duplicate'); end if;
 if v_type in ('charge.refunded','charge.dispute.created') then
   select * into b from expanse_private.map_purchases where payment_intent=p_event->>'payment_intent' and state='paid' limit 1 for update;
   if b.id is null then return json_build_object('outcome','unrelated'); end if;
   if v_type='charge.refunded' and not coalesce((p_event->>'fully_refunded')::boolean,false) then return json_build_object('outcome','partial_refund'); end if;
   v_out:=case when v_type='charge.refunded' then 'refunded' else 'disputed' end;
   update expanse_private.map_purchases set state=v_out,ends_at=least(ends_at,now()) where id=b.id;
   insert into expanse_private.stripe_events(event_id,purchase_id,outcome) values(v_event,b.id,v_out);
   return json_build_object('outcome',v_out);
 end if;
 if p_event->>'app' is distinct from 'expanse' or p_event->>'kind' is distinct from 'map_placement' then return json_build_object('outcome','unrelated'); end if;
 begin v_id:=(p_event->>'reference')::uuid; exception when others then return json_build_object('outcome','missing_reference'); end;
 select * into b from expanse_private.map_purchases where id=v_id for update;
 if b.id is null then return json_build_object('outcome','unknown_order'); end if;
 if v_type='checkout.session.completed' and p_event->>'payment_status'<>'paid' then return json_build_object('outcome','awaiting_payment'); end if;
 if v_type in ('checkout.session.async_payment_failed','checkout.session.expired') then
   update expanse_private.map_purchases set state='failed' where id=b.id and state='pending';
   insert into expanse_private.stripe_events(event_id,session_id,purchase_id,outcome) values(v_event,v_session,b.id,'failed');
   return json_build_object('outcome','failed');
 end if;
 if v_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') then return json_build_object('outcome','ignored'); end if;
 select * into r from public.products where id=b.product_id for update;
 v_out := case
   when b.state='paid' and b.session_id=v_session then 'duplicate'
   when b.state<>'pending' then 'needs_review'
   when p_event->>'payment_status' is distinct from 'paid' or p_event->>'currency' is distinct from 'eur'
     or p_event->>'payment_link' is distinct from b.payment_link
     or (p_event->>'amount_total')::int is distinct from b.amount_cents
     or p_event->>'zone' is distinct from b.zone or (p_event->>'size')::int is distinct from b.size then 'needs_review'
   when r.status<>'approved' or r.x<>b.x or r.y<>b.y or r.size<>b.size then 'needs_review'
   when to_timestamp((p_event->>'session_created')::bigint)>b.created_at+interval '24 hours' then 'needs_review'
   when exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()) then 'needs_review'
   else 'paid' end;
 if v_out='paid' then
   update expanse_private.map_purchases set state='paid',paid_at=now(),ends_at=now()+interval '12 months',session_id=v_session,
      payment_intent=p_event->>'payment_intent' where id=b.id;
 elsif v_out='needs_review' then
   -- Never remove an already-paid placement for a duplicate second checkout.
   if b.state<>'paid' then update expanse_private.map_purchases set state='needs_review',issue='Payment needs manual review. Contact support before paying again.' where id=b.id; end if;
 end if;
 insert into expanse_private.stripe_events(event_id,session_id,purchase_id,outcome) values(v_event,v_session,b.id,v_out);
 return json_build_object('outcome',v_out);
end $$;

-- Attribution is separate from popularity so paying cannot affect search or Spotlight.
create table expanse_private.discovery_events (
 product_id bigint not null references public.products(id),
 kind text not null check(kind in ('view','visit','demo')),
 source text not null check(source in ('map','search','list','shared','sponsored','home')),
 day date not null default current_date, vhash text not null,
 primary key(product_id,kind,source,day,vhash)
);
alter table expanse_private.discovery_events enable row level security;
revoke all on expanse_private.discovery_events from public,anon,authenticated;
create index discovery_events_day_idx on expanse_private.discovery_events(day,vhash);
create or replace function public.track_discovery(p_slug text,p_kind text,p_source text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint; v_hash text;
begin
 if p_kind not in ('view','visit','demo') or p_source not in ('map','search','list','shared','sponsored','home') or public._is_bot() then return; end if;
 select id into v_id from public.products where slug=p_slug and status='approved'; if v_id is null then return; end if;
 v_hash:=public._visitor_hash();
 if exists(select 1 from public.owner_marks where product_id=v_id and day=current_date and vhash=v_hash) then return; end if;
 if (select count(*) from expanse_private.discovery_events where day=current_date and vhash=v_hash)>=300 then return; end if;
 insert into expanse_private.discovery_events(product_id,kind,source,vhash) values(v_id,p_kind,p_source,v_hash) on conflict do nothing;
end $$;
create or replace function public.owner_discovery_stats(p_slug text,p_key text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare r public.products:=public._owned(p_slug,p_key);
begin
 return (select coalesce(json_agg(t),'[]'::json) from
 (select e.source,count(*) filter(where e.kind='view') as views,count(*) filter(where e.kind='visit') as visits,count(*) filter(where e.kind='demo') as demos
 from expanse_private.discovery_events e where product_id=r.id and day>=current_date-29
 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash)
 group by e.source) t);
end $$;

-- Paid terms never silently renew. Expired/fully-refunded/disputed placements move to
-- a free 1x1 Edge cell; product pages, search and stats remain. Legacy holds are untouched.
create or replace function expanse_private.release_expired_map_spots() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products; point record; n int:=0;
begin
 perform pg_advisory_xact_lock(4242);
 for r in select p.* from public.products p where p.status in ('pending','approved','hidden')
 and exists(select 1 from expanse_private.map_purchases b where b.product_id=p.id and b.state in ('paid','refunded','disputed') and b.ends_at<=now())
 and not exists(select 1 from expanse_private.map_purchases b where b.product_id=p.id and b.state='paid' and b.ends_at>now())
 loop
   select g.x,g.y into point from generate_series(-174,174) as g_x(x) cross join generate_series(-174,174) as g_y(y)
   cross join lateral (select g_x.x,g_y.y) g
   where public.zone_of(g.x,g.y,1)='edge' and sqrt(power(g.x+.5,2)+power(g.y+.5,2))<175
   and not exists(select 1 from public.products q where q.id<>r.id and q.status in ('pending','approved','hidden') and q.x<g.x+1 and g.x<q.x+q.size and q.y<g.y+1 and g.y<q.y+q.size)
   and not exists(select 1 from public.reservations q where q.x<g.x+1 and g.x<q.x+q.size and q.y<g.y+1 and g.y<q.y+q.size)
   order by abs(g.x)+abs(g.y),g.x,g.y limit 1;
   if point.x is not null then
     update public.products set x=point.x,y=point.y,size=1,zone='edge',price_eur=1 where id=r.id;
     update expanse_private.map_purchases set state='expired' where product_id=r.id and state in ('paid','refunded','disputed') and ends_at<=now();
     n:=n+1;
   end if;
 end loop;
 return n;
end $$;
revoke all on function expanse_private.release_expired_map_spots() from public,anon,authenticated;
select cron.schedule('expanse-map-terms','17 3 * * *',$$select expanse_private.release_expired_map_spots()$$);

revoke execute on function public.public_commerce(),public.owner_map_status(text,text),public.owner_choose_map_spot(text,text,int,int,int),public.owner_map_checkout(text,text),public.confirm_map_payment(text,jsonb),public.track_discovery(text,text,text),public.owner_discovery_stats(text,text) from public,anon,authenticated;
grant execute on function public.public_commerce(),public.owner_map_status(text,text),public.owner_choose_map_spot(text,text,int,int,int),public.owner_map_checkout(text,text),public.confirm_map_payment(text,jsonb),public.track_discovery(text,text,text),public.owner_discovery_stats(text,text) to anon,authenticated;

-- Normalizes and validates the editable fields. Raises "invalid:<field>".
create or replace function public._product_fields(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_name text := public._line(p->>'name', 40);
  v_tag text := public._line(p->>'tagline', 90);
  v_desc text := public._text(p->>'description', 1200);
  v_aud text := public._line(p->>'audience', 140);
  v_cat text := coalesce(p->>'category', '');
  v_pricing text := coalesce(p->>'pricing', '');
  v_ptext text := public._line(p->>'price_text', 60);
  v_url text := public._url(p->>'url');
  v_demo text := btrim(coalesce(p->>'demo_url', ''));
  v_needs text[] := '{}';
  v_plat text[] := '{}';
  v_int text[] := '{}';
  v_img text[] := '{}';
  e text;
begin
  if char_length(v_name) < 2 then raise exception 'invalid:name'; end if;
  if char_length(v_tag) < 8 then raise exception 'invalid:tagline'; end if;
  if v_desc <> '' and char_length(v_desc) < 30 then raise exception 'invalid:description'; end if;
  if v_aud <> '' and char_length(v_aud) < 3 then raise exception 'invalid:audience'; end if;
  if v_cat not in ('productivity','developer','design','marketing','finance','ai','commerce','education','health','other') then raise exception 'invalid:category'; end if;
  if v_pricing not in ('unspecified','free','freemium','trial','paid') then raise exception 'invalid:pricing'; end if;
  if v_url is null then raise exception 'invalid:url'; end if;
  if v_demo <> '' then
    v_demo := public._url(v_demo);
    if v_demo is null then raise exception 'invalid:demo_url'; end if;
  end if;

  for e in select jsonb_array_elements_text(case when jsonb_typeof(p->'needs') = 'array' then p->'needs' else '[]' end) loop
    e := lower(public._line(e, 60));
    if char_length(e) >= 2 and not (e = any (v_needs)) then v_needs := v_needs || e; end if;
  end loop;
  if cardinality(v_needs) > 6 then raise exception 'invalid:needs'; end if;

  for e in select jsonb_array_elements_text(case when jsonb_typeof(p->'platforms') = 'array' then p->'platforms' else '[]' end) loop
    if e in ('web','ios','android','macos','windows','linux','api','extension') and not (e = any (v_plat)) then v_plat := v_plat || e; end if;
  end loop;

  for e in select jsonb_array_elements_text(case when jsonb_typeof(p->'integrations') = 'array' then p->'integrations' else '[]' end) loop
    e := public._line(e, 30);
    if char_length(e) >= 1 and not (lower(e) = any (select lower(x) from unnest(v_int) x)) then v_int := v_int || e; end if;
  end loop;
  if cardinality(v_int) > 12 then raise exception 'invalid:integrations'; end if;

  for e in select jsonb_array_elements_text(case when jsonb_typeof(p->'images') = 'array' then p->'images' else '[]' end) loop
    e := btrim(e);
    if e = '' then continue; end if;
    if char_length(e) > 400 or e ~ '\s' or e !~* '^https://[^/?#@]+\.[a-z]{2,}(/|$)' then raise exception 'invalid:images'; end if;
    if not (e = any (v_img)) then v_img := v_img || e; end if;
  end loop;
  if cardinality(v_img) > 4 then raise exception 'invalid:images'; end if;

  return jsonb_build_object(
    'name', v_name, 'tagline', v_tag, 'description', v_desc, 'audience', v_aud,
    'category', v_cat, 'pricing', v_pricing, 'price_text', v_ptext,
    'url', v_url, 'demo_url', coalesce(v_demo, ''), 'domain', public._domain(v_url),
    'needs', to_jsonb(v_needs), 'platforms', to_jsonb(v_plat),
    'integrations', to_jsonb(v_int), 'images', to_jsonb(v_img));
end $$;


notify pgrst, 'reload schema';
create or replace function public.admin_map_purchases(p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
begin
 perform public._admin(p_key);
 return (select coalesce(json_agg(t),'[]'::json) from
 (select b.id,p.slug,p.name,b.zone,b.size,b.amount_cents,b.state,b.created_at,b.paid_at,b.ends_at,b.session_id,b.payment_intent,b.issue,
  (select count(*) from expanse_private.stripe_events e where e.purchase_id=b.id and e.outcome='needs_review') as review_events
 from expanse_private.map_purchases b join public.products p on p.id=b.product_id
 order by b.created_at desc limit 300) t);
end $$;
revoke execute on function public.admin_map_purchases(text) from public,anon,authenticated;
grant execute on function public.admin_map_purchases(text) to anon,authenticated;
