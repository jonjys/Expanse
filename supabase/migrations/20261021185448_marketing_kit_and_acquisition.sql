-- Prepared on publication/profile changes. No owner/contact information enters a kit.
create table expanse_private.marketing_kits (
 product_id bigint primary key references public.products(id) on delete cascade,
 revision text not null, campaign text not null, post_text text not null,
 svg text not null, prepared_at timestamptz not null default now()
);
create table expanse_private.marketing_campaigns (
 product_id bigint not null references public.products(id) on delete cascade,
 campaign text not null, created_at timestamptz not null default now(),
 primary key(product_id,campaign)
);
create table expanse_private.campaign_events (
 product_id bigint not null references public.products(id) on delete cascade,
 kind text not null check(kind in ('view','visit','demo')),
 channel text not null check(channel in ('x','linkedin','newsletter','other')),
 campaign text not null, day date not null default current_date, vhash text not null,
 primary key(product_id,kind,channel,campaign,day,vhash),
 foreign key(product_id,campaign) references expanse_private.marketing_campaigns(product_id,campaign)
);
create table expanse_private.exposure_events (
 product_id bigint not null references public.products(id) on delete cascade,
 source text not null check(source in ('search','list','home')),
 day date not null default current_date, vhash text not null,
 primary key(product_id,source,day,vhash)
);
alter table expanse_private.marketing_kits enable row level security;
alter table expanse_private.marketing_campaigns enable row level security;
alter table expanse_private.campaign_events enable row level security;
alter table expanse_private.exposure_events enable row level security;
revoke all on expanse_private.marketing_kits,expanse_private.marketing_campaigns,expanse_private.campaign_events,expanse_private.exposure_events from public,anon,authenticated;
create index campaign_events_day_idx on expanse_private.campaign_events(day,vhash);
create index exposure_events_day_idx on expanse_private.exposure_events(day,vhash);

create function expanse_private.xml_text(t text) returns text language sql immutable set search_path='' as $$
 select replace(replace(replace(replace(replace(coalesce(t,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&apos;')
$$;
create function expanse_private.prepare_marketing_kit(p_id bigint) returns void
language plpgsql volatile security definer set search_path='' as $$
declare r public.products; rev text; c text; picture text; lines text; words text[]; word text; line text:=''; y int:=970; stars text:=''; i int;
begin
 select * into r from public.products where id=p_id;
 if r.id is null then return;end if;
 if r.status<>'approved' then delete from expanse_private.marketing_kits where product_id=p_id;return;end if;
 -- Explicit public-field allowlist; updates to visits, keys and contact data do not regenerate.
 rev:=left(public._key_hash(jsonb_build_array('kit-v1',r.slug,r.name,r.tagline,r.description,r.needs,r.category,r.url,r.x,r.y,r.size,r.zone)::text),20);
 if exists(select 1 from expanse_private.marketing_kits where product_id=p_id and revision=rev) then return;end if;
 c:='mk-'||left(rev,12);
 for i in 1..90 loop stars:=stars||format('<circle cx="%s" cy="%s" r="%s" fill="#b8ccff" opacity=".36"/>',mod(i*197,1080),mod(i*313,880),case when mod(i,7)=0 then 2 else 1 end);end loop;
 words:=regexp_split_to_array(r.tagline,'\s+');lines:='';
 foreach word in array words loop
  if length(line||' '||word)>44 and line<>'' then lines:=lines||format('<text x="80" y="%s">%s</text>',y,expanse_private.xml_text(line));y:=y+44;line:=word;
  else line:=case when line='' then word else line||' '||word end;end if;
 end loop;
 if line<>'' then lines:=lines||format('<text x="80" y="%s">%s</text>',y,expanse_private.xml_text(line));end if;
 picture:=format('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><radialGradient id="g"><stop stop-color="#17275e"/><stop offset="1" stop-color="#02030c"/></radialGradient></defs><rect width="1080" height="1350" fill="#02030c"/><rect width="1080" height="900" fill="url(#g)"/>%s<g fill="none" stroke="#5ee1ff" stroke-opacity=".2"><ellipse cx="540" cy="490" rx="420" ry="155" transform="rotate(-25 540 490)"/><ellipse cx="540" cy="490" rx="310" ry="110" transform="rotate(-25 540 490)"/><ellipse cx="540" cy="490" rx="190" ry="67" transform="rotate(-25 540 490)"/></g><path d="M540 340V640M390 490H690" stroke="#a594ff" stroke-opacity=".3"/><rect x="502" y="452" width="76" height="76" rx="14" fill="#c8ff3d"/><circle cx="540" cy="490" r="65" fill="none" stroke="#c8ff3d" stroke-opacity=".6"/><g font-family="Arial,sans-serif"><text x="80" y="108" fill="#c8ff3d" font-size="28" letter-spacing="7">EXPANSE</text><text x="80" y="805" fill="#5ee1ff" font-size="21" letter-spacing="3">FIND A TOOL FOR WHAT YOU NEED</text><text x="80" y="900" fill="#fff" font-size="58" font-weight="700" textLength="920" lengthAdjust="spacingAndGlyphs">%s</text><g fill="#c4cbea" font-size="32">%s</g><text x="80" y="1190" fill="#c8ff3d" font-size="26">Discover %s on Expanse ↗</text><text x="80" y="1250" fill="#8d99bf" font-size="22">expanse.nyttolabs.com/p/%s</text></g></svg>',stars,expanse_private.xml_text(r.name),lines,expanse_private.xml_text(r.name),expanse_private.xml_text(r.slug));
 insert into expanse_private.marketing_campaigns(product_id,campaign) values(p_id,c) on conflict do nothing;
 insert into expanse_private.marketing_kits(product_id,revision,campaign,post_text,svg) values(p_id,rev,c,r.name||E' — '||r.tagline||E'\n\nSee what it solves, compare it with other tools and save it to your stack on Expanse.',picture)
 on conflict(product_id) do update set revision=excluded.revision,campaign=excluded.campaign,post_text=excluded.post_text,svg=excluded.svg,prepared_at=now();
end $$;
create function expanse_private.refresh_marketing_kit() returns trigger language plpgsql security definer set search_path='' as $$
begin perform expanse_private.prepare_marketing_kit(new.id);return new;end $$;
create trigger product_marketing_kit after insert or update of status,slug,name,tagline,description,needs,category,url,x,y,size,zone on public.products for each row execute function expanse_private.refresh_marketing_kit();
select expanse_private.prepare_marketing_kit(id) from public.products where status='approved';

create function public.owner_marketing_kit(p_slug text,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);
begin return (select jsonb_build_object('revision',revision,'campaign',campaign,'post_text',post_text,'svg',svg,'prepared_at',prepared_at) from expanse_private.marketing_kits where product_id=r.id);end $$;
create function public.public_marketing_card(p_slug text,p_revision text default '') returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',k.revision,'svg',k.svg) from expanse_private.marketing_kits k join public.products p on p.id=k.product_id where p.slug=p_slug and p.status='approved' and (coalesce(p_revision,'')='' or k.revision=p_revision)
$$;
create function public.track_exposure(p_slug text,p_source text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare pid bigint; h text;
begin
 if p_source is null or p_source not in ('search','list','home') or public._is_bot() then return;end if;
 select id into pid from public.products where slug=p_slug and status='approved';if pid is null then return;end if;
 h:=public._visitor_hash();
 if exists(select 1 from public.owner_marks where product_id=pid and day=current_date and vhash=h) then return;end if;
 if (select count(*) from expanse_private.exposure_events where day=current_date and vhash=h)>=300 then return;end if;
 insert into expanse_private.exposure_events(product_id,source,vhash) values(pid,p_source,h) on conflict do nothing;
end $$;
create function public.track_campaign(p_slug text,p_kind text,p_campaign text,p_channel text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare pid bigint;h text;
begin
 if p_kind is null or p_kind not in ('view','visit','demo') or p_channel is null or p_channel not in ('x','linkedin','newsletter','other') or public._is_bot() then return;end if;
 select p.id into pid from public.products p join expanse_private.marketing_campaigns c on c.product_id=p.id where p.slug=p_slug and p.status='approved' and c.campaign=p_campaign;if pid is null then return;end if;
 h:=public._visitor_hash();
 if exists(select 1 from public.owner_marks where product_id=pid and day=current_date and vhash=h) then return;end if;
 if (select count(*) from expanse_private.campaign_events where day=current_date and vhash=h)>=300 then return;end if;
 insert into expanse_private.campaign_events(product_id,kind,channel,campaign,vhash) values(pid,p_kind,p_channel,p_campaign,h) on conflict do nothing;
end $$;
create function public.owner_acquisition_stats(p_slug text,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);totals jsonb;sources jsonb;campaigns jsonb;
begin
 with e as(select e.* from public.events e where e.product_id=r.id and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash)),
 x as(select e.* from expanse_private.exposure_events e where e.product_id=r.id and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash))
 select jsonb_build_object('impressions',(select count(distinct (day,vhash)) from x),'views',count(*) filter(where kind='view'),'visits',count(*) filter(where kind='visit'),'demos',count(*) filter(where kind='demo'),'matched_visits',count(*) filter(where kind='view' and exists(select 1 from e v where v.kind='visit' and v.day=e.day and v.vhash=e.vhash)),'verified_purchases',null) into totals from e;
 with d as(select e.* from expanse_private.discovery_events e where e.product_id=r.id and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash)),
 x as(select e.* from expanse_private.exposure_events e where e.product_id=r.id and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash))
 select jsonb_agg(jsonb_build_object('source',s,'impressions',case when s in ('search','list','home') then(select count(*) from x where source=s) else null end,'views',(select count(*) from d where source=s and kind='view'),'visits',(select count(*) from d where source=s and kind='visit'))) into sources from unnest(array['search','list','home','map','shared','sponsored']) as s;
 select coalesce(jsonb_agg(t),'[]'::jsonb) into campaigns from(select e.channel,count(*) filter(where kind='view') as views,count(*) filter(where kind='visit') as visits,count(*) filter(where kind='demo') as demos from expanse_private.campaign_events e where e.product_id=r.id and e.day>=current_date-29 and not exists(select 1 from public.owner_marks o where o.product_id=e.product_id and o.day=e.day and o.vhash=e.vhash) group by e.channel)t;
 return jsonb_build_object('totals',totals,'sources',sources,'campaigns',campaigns,'window_days',30);
end $$;
create function expanse_private.prune_acquisition() returns void language sql volatile security definer set search_path='' as $$
 delete from expanse_private.exposure_events where day<current_date-90;
 delete from expanse_private.campaign_events where day<current_date-90;
$$;
revoke all on function expanse_private.xml_text(text),expanse_private.prepare_marketing_kit(bigint),expanse_private.refresh_marketing_kit(),expanse_private.prune_acquisition() from public,anon,authenticated;
revoke all on function public.owner_marketing_kit(text,text),public.public_marketing_card(text,text),public.track_exposure(text,text),public.track_campaign(text,text,text,text),public.owner_acquisition_stats(text,text) from public,anon,authenticated;
grant execute on function public.owner_marketing_kit(text,text),public.public_marketing_card(text,text),public.track_exposure(text,text),public.track_campaign(text,text,text,text),public.owner_acquisition_stats(text,text) to anon,authenticated;
select cron.schedule('expanse-acquisition-retention','38 3 * * *',$$select expanse_private.prune_acquisition()$$);
notify pgrst,'reload schema';
