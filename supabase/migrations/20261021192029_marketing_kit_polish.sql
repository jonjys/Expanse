-- Cover campaign foreign-key checks and lookups as attribution grows.
create index campaign_events_campaign_idx on expanse_private.campaign_events(product_id,campaign);

-- Preserve natural lettering for shorter names; constrain long names to the card width.
create or replace function expanse_private.prepare_marketing_kit(p_id bigint) returns void
language plpgsql volatile security definer set search_path='' as $$
declare r public.products; rev text; c text; picture text; lines text; words text[]; word text; line text:=''; y int:=970; stars text:=''; i int;
begin
 select * into r from public.products where id=p_id;
 if r.id is null then return;end if;
 if r.status<>'approved' then delete from expanse_private.marketing_kits where product_id=p_id;return;end if;
 -- Explicit public-field allowlist; updates to visits, keys and contact data do not regenerate.
 rev:=left(public._key_hash(jsonb_build_array('kit-v2',r.slug,r.name,r.tagline,r.description,r.needs,r.category,r.url,r.x,r.y,r.size,r.zone)::text),20);
 if exists(select 1 from expanse_private.marketing_kits where product_id=p_id and revision=rev) then return;end if;
 c:='mk-'||left(rev,12);
 for i in 1..90 loop stars:=stars||format('<circle cx="%s" cy="%s" r="%s" fill="#b8ccff" opacity=".36"/>',mod(i*197,1080),mod(i*313,880),case when mod(i,7)=0 then 2 else 1 end);end loop;
 words:=regexp_split_to_array(r.tagline,'\s+');lines:='';
 foreach word in array words loop
  if length(line||' '||word)>44 and line<>'' then lines:=lines||format('<text x="80" y="%s">%s</text>',y,expanse_private.xml_text(line));y:=y+44;line:=word;
  else line:=case when line='' then word else line||' '||word end;end if;
 end loop;
 if line<>'' then lines:=lines||format('<text x="80" y="%s">%s</text>',y,expanse_private.xml_text(line));end if;
 picture:=format('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><radialGradient id="g"><stop stop-color="#17275e"/><stop offset="1" stop-color="#02030c"/></radialGradient></defs><rect width="1080" height="1350" fill="#02030c"/><rect width="1080" height="900" fill="url(#g)"/>%s<g fill="none" stroke="#5ee1ff" stroke-opacity=".2"><ellipse cx="540" cy="490" rx="420" ry="155" transform="rotate(-25 540 490)"/><ellipse cx="540" cy="490" rx="310" ry="110" transform="rotate(-25 540 490)"/><ellipse cx="540" cy="490" rx="190" ry="67" transform="rotate(-25 540 490)"/></g><path d="M540 340V640M390 490H690" stroke="#a594ff" stroke-opacity=".3"/><rect x="502" y="452" width="76" height="76" rx="14" fill="#c8ff3d"/><circle cx="540" cy="490" r="65" fill="none" stroke="#c8ff3d" stroke-opacity=".6"/><g font-family="Arial,sans-serif"><text x="80" y="108" fill="#c8ff3d" font-size="28" letter-spacing="7">EXPANSE</text><text x="80" y="805" fill="#5ee1ff" font-size="21" letter-spacing="3">FIND A TOOL FOR WHAT YOU NEED</text><text x="80" y="900" fill="#fff" font-size="64" font-weight="700"%s>%s</text><g fill="#c4cbea" font-size="32">%s</g><text x="80" y="1190" fill="#c8ff3d" font-size="26">Discover %s on Expanse ↗</text><text x="80" y="1250" fill="#8d99bf" font-size="22">expanse.nyttolabs.com/p/%s</text></g></svg>',stars,case when char_length(r.name)>26 then ' textLength="920" lengthAdjust="spacingAndGlyphs"' else '' end,expanse_private.xml_text(r.name),lines,expanse_private.xml_text(r.name),expanse_private.xml_text(r.slug));
 insert into expanse_private.marketing_campaigns(product_id,campaign) values(p_id,c) on conflict do nothing;
 insert into expanse_private.marketing_kits(product_id,revision,campaign,post_text,svg) values(p_id,rev,c,r.name||E' — '||r.tagline||E'\n\nSee what it solves, compare it with other tools and save it to your stack on Expanse.',picture)
 on conflict(product_id) do update set revision=excluded.revision,campaign=excluded.campaign,post_text=excluded.post_text,svg=excluded.svg,prepared_at=now();
end $$;
select expanse_private.prepare_marketing_kit(id) from public.products where status='approved';
