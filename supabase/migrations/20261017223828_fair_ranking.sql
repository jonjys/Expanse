-- Fair ranking: being big, famous or early doesn't keep you on top.
--
-- Popularity is now a share, not a volume: (clicks to the site or demo + 2 × upvotes) per unique profile view over
-- the last 30 days, without the maker's own visits and votes. A big audience brings more views and more clicks, so it
-- doesn't move the share; only how much visitors actually like the product does. Every product is smoothed towards the
-- average with 20 "virtual" average views, so a brand-new product starts at the average instead of at zero, and a few
-- lucky clicks don't shoot a product to the top. Paid exposure doesn't help either: more views don't raise the share.
-- Clicks and upvotes count at most once per view, so votes cast without anyone looking at the product don't count.
--
-- Spotlight: the same score, but 2 of the 8 places always go to the best products that went live in the last 30 days,
-- so new faces keep reaching the core. Ties no longer go to whoever came first: they rotate every day.

create or replace function public._spotlight_refresh() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_out jsonb;
begin
  with live as (
    select p.id from public.products p where p.status = 'approved'),
  ev as (
    select e.product_id,
           count(*) filter (where e.kind = 'view') as views,
           count(*) filter (where e.kind in ('visit', 'demo')) as clicks
      from public.events e join live on live.id = e.product_id
     where e.day > current_date - 30
       and not exists (select 1 from public.owner_marks o where o.product_id = e.product_id and o.day = e.day and o.vhash = e.vhash)
     group by e.product_id),
  up as (
    select vo.product_id, count(*) as n
      from public.votes vo join live on live.id = vo.product_id
     where vo.removed_at is null and vo.created_at > now() - interval '30 days'
       and not exists (select 1 from public.owner_marks o where o.product_id = vo.product_id and o.day = vo.day and o.vhash = vo.vhash)
     group by vo.product_id),
  st as (
    select live.id, coalesce(ev.views, 0) as v, coalesce(ev.clicks, 0) as c, coalesce(up.n, 0) as u
      from live left join ev on ev.product_id = live.id left join up on up.product_id = live.id),
  mean as (
    select coalesce((sum(least(c, v)) + 2 * sum(least(u, v)))::numeric / nullif(sum(v), 0), 0) as m from st),
  sc as (
    select st.id, (least(st.c, st.v) + 2 * least(st.u, st.v) + 20 * mean.m) / (st.v + 20) as score from st, mean)
  insert into public.popularity (product_id, score, pct, at)
  select id, round(score, 6), case when max(score) over () > 0 then round(100 * score / max(score) over ())::int else 0 end, now() from sc
  on conflict (product_id) do update set score = excluded.score, pct = excluded.pct, at = excluded.at;

  with ranked as (
    select p.id, po.score, coalesce(p.approved_at > now() - interval '30 days', false) as is_new,
           md5(p.id::text || '|' || current_date::text) as rot
      from public.products p join public.popularity po on po.product_id = p.id
     where p.status = 'approved' and not p.spotlight_blocked and p.verified_at is not null
       and p.site_fails = 0 and p.site_ok_at > now() - interval '3 days'),
  marked as (
    select r.*, r.is_new and row_number() over (partition by r.is_new order by r.score desc, r.rot) <= 2 as reserved
      from ranked r),
  pick as (
    select m.*, row_number() over (order by m.reserved desc, m.score desc, m.rot) as k from marked m)
  select jsonb_build_object('at', now(), 'picks',
           coalesce(jsonb_agg(jsonb_build_object('id', id, 'score', round(score, 4)) order by score desc, rot), '[]'::jsonb))
    into v_out
    from pick where k <= 8;
  perform public._set_setting('spotlight', v_out);
  return v_out;
end $$;

select public._spotlight_refresh();
