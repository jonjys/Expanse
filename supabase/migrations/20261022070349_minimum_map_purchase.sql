-- Minimum for NEW paid orders only. Existing quotes, payments and free placements remain unchanged.
create function public.map_price_cents(p_zone text,p_size int) returns int
language sql immutable set search_path='' as $$
 select case when p_zone in ('edge','outer','belt','inner') and p_size in (1,2,4,8)
 then greatest(300,public.price_per_cell(p_zone)*p_size*p_size*100) else null end
$$;
revoke all on function public.map_price_cents(text,int) from public,anon,authenticated;
grant execute on function public.map_price_cents(text,int) to anon,authenticated;

insert into expanse_private.map_catalog(zone,size,amount_cents,payment_link,url)
values('edge',1,300,'plink_1UTG1jBEo0YzuylwM7F3ocPh','https://buy.stripe.com/9B68wO1PH0cueSYbrf8og2B')
on conflict(zone,size) do update set amount_cents=excluded.amount_cents,payment_link=excluded.payment_link,url=excluded.url;

create or replace function public.owner_map_status(p_slug text,p_key text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug,p_key); b expanse_private.map_purchases;
begin
 select * into b from expanse_private.map_purchases where product_id=r.id
 order by (state='paid' and ends_at>now()) desc,created_at desc limit 1;
 return json_build_object('state',case when b.state='paid' and b.ends_at<=now() then 'expired' else coalesce(b.state,'free') end,
   'hold_until',r.map_hold_until,'ends_at',b.ends_at,'paid_at',b.paid_at,'issue',b.issue,
   'zone',r.zone,'size',r.size,'amount_cents',case when b.state='paid' then b.amount_cents else public.map_price_cents(r.zone,r.size) end,
   'can_pay',r.status='approved' and not exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()));
end $$;


create or replace function expanse_private.owner_map_checkout(p_slug text,p_key text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug,p_key); m expanse_private.map_catalog; b expanse_private.map_purchases;
begin
 if r.status <> 'approved' then raise exception 'review_required'; end if;
 if r.map_hold_until is not null and r.map_hold_until<=now() then raise exception 'hold_expired'; end if;
 if not (select enabled from expanse_private.commerce_config where singleton) then raise exception 'payments_paused'; end if;
 perform pg_advisory_xact_lock(4242);
 select * into r from public.products where id=r.id for update;
 if exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()) then raise exception 'already_paid'; end if;
 select * into m from expanse_private.map_catalog where zone=r.zone and size=r.size;
 if m.zone is null or m.amount_cents <> public.map_price_cents(r.zone,r.size) then raise exception 'payments_paused'; end if;
 select * into b from expanse_private.map_purchases where product_id=r.id and state='pending' and x=r.x and y=r.y and size=r.size
 and payment_link=m.payment_link and amount_cents=m.amount_cents and created_at>now()-interval '24 hours' order by created_at desc limit 1;
 if b.id is null then
   if (select count(*) from expanse_private.map_purchases where product_id=r.id and created_at>now()-interval '1 hour')>=5 then raise exception 'too_many'; end if;
   insert into expanse_private.map_purchases(product_id,x,y,size,zone,amount_cents,payment_link)
   values(r.id,r.x,r.y,r.size,r.zone,m.amount_cents,m.payment_link) returning * into b;
 end if;
 return json_build_object('id',b.id,'url',m.url||'?client_reference_id='||b.id::text,'amount_cents',b.amount_cents,'months',12);
end $$;


revoke all on function expanse_private.owner_map_checkout(text,text) from public,anon,authenticated;
notify pgrst, 'reload schema';
