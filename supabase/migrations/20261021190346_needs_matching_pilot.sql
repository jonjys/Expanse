-- Bounded, opt-in, moderated needs pilot. No contact field and no outbound messages.
create table expanse_private.tool_needs (
 id uuid primary key default extensions.gen_random_uuid(),
 raw_text text not null, public_text text,
 consent boolean not null default false,
 state text not null default 'private' check(state in ('private','pending','approved','declined','withdrawn')),
 receipt_hash text not null, vhash text, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '90 days', reviewed_at timestamptz,
 check(state<>'approved' or (consent and public_text is not null))
);
create table expanse_private.need_preferences (
 product_id bigint primary key references public.products(id) on delete cascade,
 enabled boolean not null default false, updated_at timestamptz not null default now()
);
alter table expanse_private.tool_needs enable row level security;
alter table expanse_private.need_preferences enable row level security;
revoke all on expanse_private.tool_needs,expanse_private.need_preferences from public,anon,authenticated;
create index tool_needs_rates_idx on expanse_private.tool_needs(created_at,vhash);
create index tool_needs_public_idx on expanse_private.tool_needs(expires_at) where state='approved';
create function expanse_private.need_safe(t text) returns boolean language sql immutable set search_path='' as $$
 select char_length(btrim(coalesce(t,''))) between 18 and 600 and t !~* '(@|https?://|www\.|[[:cntrl:]]|([+0-9][0-9(). -]*){7})'
$$;
create function expanse_private.match_tool_need(brief text) returns jsonb
language sql stable security definer set search_path='' as $$
 with q as(select array(select unnest(tsvector_to_array(to_tsvector('english',brief))) except select unnest(array['tool','need','app','product','want','look','help','use','someth','solut','softwar','platform','like','make','best','good'])) as terms),
 matches as(select p.slug,p.name,p.tagline,p.needs,array(select unnest(q.terms) intersect select unnest(tsvector_to_array(to_tsvector('english',p.name||' '||p.tagline||' '||array_to_string(p.needs,' ')||' '||p.description)))) as shared,cardinality(q.terms) as total from public.products p cross join q where p.status='approved'),
 ranked as(select * from matches where cardinality(shared)>=2 and cardinality(shared)::numeric/greatest(total,1)>=0.35 order by cardinality(shared) desc,slug limit 5)
 select coalesce(jsonb_agg(jsonb_build_object('slug',slug,'name',name,'reason','Shared terms in the product profile: '||array_to_string(shared,', ')||'. Profile says: “'||tagline||'”. Check the product page to confirm the fit.','matched_terms',shared)),'[]'::jsonb) from ranked
$$;
create function public.submit_tool_need(p_text text,p_share boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare t text:=btrim(coalesce(p_text,''));h text;k text;r expanse_private.tool_needs;
begin
 if public._is_bot() then raise exception 'unavailable';end if;
 if not expanse_private.need_safe(t) then raise exception 'invalid:need';end if;
 h:=public._visitor_hash();
 -- Serialize the small pilot's cap and per-visitor limit; no overbooking on concurrent requests.
 perform pg_advisory_xact_lock(74193211);
 if (select count(*) from expanse_private.tool_needs where created_at>now()-interval '1 hour' and vhash=h)>=3 or (select count(*) from expanse_private.tool_needs where created_at>=date_trunc('day',now()) and vhash=h)>=5 then raise exception 'slow_down';end if;
 if (select count(*) from expanse_private.tool_needs where expires_at>now() and state in ('private','pending','approved'))>=200 then raise exception 'pilot_full';end if;
 k:=public._new_key();
 insert into expanse_private.tool_needs(raw_text,consent,state,receipt_hash,vhash) values(t,coalesce(p_share,false),case when coalesce(p_share,false) then 'pending' else 'private' end,public._key_hash(k),h) returning * into r;
 return jsonb_build_object('id',r.id,'key',k,'state',r.state,'expires_at',r.expires_at,'matches',expanse_private.match_tool_need(t));
end $$;
create function public.tool_need_status(p_id uuid,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r expanse_private.tool_needs;
begin
 select * into r from expanse_private.tool_needs where id=p_id and receipt_hash=public._key_hash(p_key) and char_length(coalesce(p_key,''))>=20 and expires_at>now();
 if r.id is null then raise exception 'bad_key';end if;
 return jsonb_build_object('id',r.id,'text',r.raw_text,'public_text',r.public_text,'state',r.state,'consent',r.consent,'expires_at',r.expires_at,'matches',case when r.state='withdrawn' then '[]'::jsonb else expanse_private.match_tool_need(r.raw_text) end);
end $$;
create function public.withdraw_tool_need(p_id uuid,p_key text) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 update expanse_private.tool_needs set state='withdrawn',consent=false,raw_text='(withdrawn)',public_text=null where id=p_id and receipt_hash=public._key_hash(p_key) and char_length(coalesce(p_key,''))>=20;
 if not found then raise exception 'bad_key';end if;
end $$;
create function public.public_tool_needs() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(t),'[]'::jsonb) from(select id,public_text as text,created_at::date as posted,expanse_private.match_tool_need(public_text) as matches from expanse_private.tool_needs where consent and state='approved' and expires_at>now() order by created_at desc limit 50)t
$$;
create function public.owner_need_preferences(p_slug text,p_key text,p_enabled boolean default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);
begin
 if p_enabled is not null then insert into expanse_private.need_preferences(product_id,enabled) values(r.id,p_enabled) on conflict(product_id) do update set enabled=excluded.enabled,updated_at=now();end if;
 return jsonb_build_object('enabled',coalesce((select enabled from expanse_private.need_preferences where product_id=r.id),false),'delivery','in_app');
end $$;
create function public.owner_need_matches(p_slug text,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);
begin
 if r.status<>'approved' or not coalesce((select enabled from expanse_private.need_preferences where product_id=r.id),false) then return '[]'::jsonb;end if;
 return (select coalesce(jsonb_agg(t),'[]'::jsonb) from(select n.id,n.public_text as text,n.created_at::date as posted,m->>'reason' as reason from expanse_private.tool_needs n cross join lateral jsonb_array_elements(expanse_private.match_tool_need(n.public_text)) m where n.consent and n.state='approved' and n.expires_at>now() and m->>'slug'=r.slug order by n.created_at desc limit 50)t);
end $$;
create function public.admin_tool_needs(p_key text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin perform public._admin(p_key);return(select coalesce(jsonb_agg(t),'[]'::jsonb) from(select id,raw_text,public_text,state,created_at,expires_at from expanse_private.tool_needs where consent and state in ('pending','approved') and expires_at>now() order by (state='pending') desc,created_at limit 200)t);end $$;
create function public.admin_review_tool_need(p_key text,p_id uuid,p_approve boolean,p_text text default '',p_anonymized boolean default false) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform public._admin(p_key);
 if p_approve is null then raise exception 'invalid:review';end if;
 if p_approve and (not coalesce(p_anonymized,false) or not expanse_private.need_safe(p_text)) then raise exception 'invalid:anonymize';end if;
 update expanse_private.tool_needs set state=case when p_approve then 'approved' else 'declined' end,public_text=case when p_approve then btrim(p_text) else null end,reviewed_at=now() where id=p_id and consent and state in ('pending','approved') and expires_at>now();
 if not found then raise exception 'unavailable';end if;
end $$;
create function expanse_private.prune_tool_needs() returns void language sql volatile security definer set search_path='' as $$
 delete from expanse_private.tool_needs where expires_at<now() or (state='withdrawn' and created_at<now()-interval '7 days');
 update expanse_private.tool_needs set vhash=null where created_at<now()-interval '7 days' and vhash is not null;
 delete from expanse_private.need_preferences where product_id in(select id from public.products where status='removed');
$$;
revoke all on function expanse_private.need_safe(text),expanse_private.match_tool_need(text),expanse_private.prune_tool_needs() from public,anon,authenticated;
revoke all on function public.submit_tool_need(text,boolean),public.tool_need_status(uuid,text),public.withdraw_tool_need(uuid,text),public.public_tool_needs(),public.owner_need_preferences(text,text,boolean),public.owner_need_matches(text,text),public.admin_tool_needs(text),public.admin_review_tool_need(text,uuid,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.submit_tool_need(text,boolean),public.tool_need_status(uuid,text),public.withdraw_tool_need(uuid,text),public.public_tool_needs(),public.owner_need_preferences(text,text,boolean),public.owner_need_matches(text,text),public.admin_tool_needs(text),public.admin_review_tool_need(text,uuid,boolean,text,boolean) to anon,authenticated;
select cron.schedule('expanse-needs-retention','43 3 * * *',$$select expanse_private.prune_tool_needs()$$);
notify pgrst,'reload schema';
