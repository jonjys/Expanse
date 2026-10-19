-- Real reservation terms, never a manufactured countdown. Legacy founding holds are unchanged.
alter table public.products add column map_hold_until timestamptz;
create function expanse_private.map_hold() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op='INSERT' then
   if new.zone<>'edge' or new.size<>1 then new.map_hold_until:=now()+interval '7 days'; end if;
 elsif new.x is distinct from old.x or new.y is distinct from old.y or new.size is distinct from old.size then
   new.map_hold_until:=case when new.zone='edge' and new.size=1 then null else now()+interval '7 days' end;
 elsif old.status<>'approved' and new.status='approved' and old.map_hold_until is not null then
   new.map_hold_until:=now()+interval '7 days';
 end if;
 return new;
end $$;
revoke execute on function expanse_private.map_hold() from public,anon,authenticated;
create trigger map_hold before insert or update on public.products for each row execute function expanse_private.map_hold();

create or replace function public.owner_map_status(p_slug text,p_key text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare r public.products := public._owned(p_slug,p_key); b expanse_private.map_purchases;
begin
 select * into b from expanse_private.map_purchases where product_id=r.id
 order by (state='paid' and ends_at>now()) desc,created_at desc limit 1;
 return json_build_object('state',case when b.state='paid' and b.ends_at<=now() then 'expired' else coalesce(b.state,'free') end,
   'hold_until',r.map_hold_until,'ends_at',b.ends_at,'paid_at',b.paid_at,'issue',b.issue,
   'zone',r.zone,'size',r.size,'amount_cents',public.price_per_cell(r.zone)*r.size*r.size*100,
   'can_pay',r.status='approved' and not exists(select 1 from expanse_private.map_purchases where product_id=r.id and state='paid' and ends_at>now()));
end $$;


create or replace function public.owner_map_checkout(p_slug text,p_key text) returns json
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


create or replace function expanse_private.release_expired_map_spots() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r public.products; point record; n int:=0;
begin
 perform pg_advisory_xact_lock(4242);
 for r in select p.* from public.products p where p.status in ('pending','approved','hidden')
 and (exists(select 1 from expanse_private.map_purchases b where b.product_id=p.id and b.state in ('paid','refunded','disputed') and b.ends_at<=now()) or (p.status='approved' and p.map_hold_until<=now()))
 and not exists(select 1 from expanse_private.map_purchases b where b.product_id=p.id and b.state='paid' and b.ends_at>now())
 loop
   select g.x,g.y into point from generate_series(126,174) as ring(radius) cross join generate_series(0,359) as turn(angle)
   cross join lateral (select round(ring.radius*cos(turn.angle*pi()/180))::int as x,round(ring.radius*sin(turn.angle*pi()/180))::int as y) g
   where public.zone_of(g.x,g.y,1)='edge' and sqrt(power(g.x+.5,2)+power(g.y+.5,2))<175
   and not exists(select 1 from public.products q where q.id<>r.id and q.status in ('pending','approved','hidden') and q.x<g.x+1 and g.x<q.x+q.size and q.y<g.y+1 and g.y<q.y+q.size)
   and not exists(select 1 from public.reservations q where q.x<g.x+1 and g.x<q.x+q.size and q.y<g.y+1 and g.y<q.y+q.size)
   limit 1;
   if point.x is not null then
     update public.products set x=point.x,y=point.y,size=1,zone='edge',price_eur=1,map_hold_until=null where id=r.id;
     update expanse_private.map_purchases set state='expired' where product_id=r.id and state in ('paid','refunded','disputed') and ends_at<=now();
     n:=n+1;
   end if;
 end loop;
 return n;
end $$;

notify pgrst, 'reload schema';
