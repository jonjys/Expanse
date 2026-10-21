-- Public seller data must be explicitly authorized, especially a sole trader's
-- personal identity number. No personal details are seeded or published here.
create table expanse_private.seller (
 singleton boolean primary key default true check(singleton),
 legal_name text not null default '', registration_number text not null default '',
 address text not null default '', email text not null default '', phone text not null default '',
 published boolean not null default false
);
insert into expanse_private.seller default values;
alter table expanse_private.seller enable row level security;
revoke all on expanse_private.seller from public,anon,authenticated;
create function public.public_seller() returns json
language sql stable security definer set search_path='' as $$
 select json_build_object('ready',published and legal_name<>'' and registration_number<>'' and address<>'' and email<>'' and phone<>'',
 'legal_name',case when published then legal_name else '' end,
 'registration_number',case when published then registration_number else '' end,
 'address',case when published then address else '' end,'email',case when published then email else '' end,
 'phone',case when published then phone else '' end,'terms_version','2026-10-20') from expanse_private.seller where singleton
$$;
create function public.admin_seller(p_key text) returns json
language plpgsql volatile security definer set search_path='' as $$
begin perform public._admin(p_key); return (select row_to_json(s) from expanse_private.seller s where singleton); end $$;
create function public.admin_save_seller(p_key text,p jsonb) returns json
language plpgsql volatile security definer set search_path='' as $$
declare s expanse_private.seller;
begin
 perform public._admin(p_key);
 s.legal_name:=public._line(p->>'legal_name',160);s.registration_number:=public._line(p->>'registration_number',40);
 s.address:=public._text(p->>'address',300);s.email:=lower(public._line(p->>'email',254));s.phone:=public._line(p->>'phone',50);
 s.published:=coalesce((p->>'published')::boolean,false);
 if s.published and (s.legal_name='' or s.registration_number='' or s.address='' or s.phone='' or s.email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid:seller';end if;
 update expanse_private.seller set legal_name=s.legal_name,registration_number=s.registration_number,address=s.address,email=s.email,phone=s.phone,published=s.published where singleton;
 return public.admin_seller(p_key);
end $$;

alter table expanse_private.map_purchases add column terms_version text,add column accepted_at timestamptz,add column contract_text text;
create function expanse_private.contract_terms() returns text
language sql stable security definer set search_path='' as $$
 select E'Expanse map placement — terms version 2026-10-20\nSeller: '||legal_name||E'\nRegistration number: '||registration_number||E'\nAddress: '||address||E'\nEmail: '||email||E'\nPhone: '||phone||E'\n\nOne payment in EUR for 12 months of the chosen map square, starting when Stripe confirms payment. Tax is included where applicable. No automatic renewal. Your product profile remains free; after expiry it returns to a free 1×1 Edge spot. Payment does not buy search ranking, Spotlight, guaranteed views, traffic, sales or revenue. Sponsored cards are a separate service. One square per product; different real products from the same maker are allowed. Duplicate or misleading listings are not allowed. Separate purchases cannot be merged; no automatic upgrade or credit for unused time. Content rules apply equally to everyone.\n\nWe provide a full refund if you notify us that you withdraw within 14 days after purchase, including business purchases. We make no deduction for placement used during those 14 days. Starting placement immediately does not waive withdrawal rights. Use https://expanse.nyttolabs.com/withdraw or email the seller with your name and order reference. No explanation is required. We refund to the original payment method without a refund fee, without undue delay and within 14 days after receiving your notice. Paid placement ends when the refund is processed; your free listing continues.\n\nAfter 14 days, a change-of-mind refund is not automatic. Contact us about an incorrect charge, duplicate payment or service problem. Mandatory consumer remedies remain available. If we permanently end a paid placement for reasons other than a breach of content rules, we refund the unused portion. Deleting a listing does not submit a withdrawal notice.\n\nOptional withdrawal template (not required): I hereby withdraw from my contract for Expanse map placement. Order reference: ___. Purchased on: ___. Name: ___. Email: ___. Address: ___. Date: ___. A signature is required only for a paper notice. Send to the seller above or use the online withdrawal function.\n\nOnly list real software you make or represent. Spam, scams, illegal or adult content, misleading profiles and duplicates may be rejected or removed. You can edit or remove your listing in the owner panel. Report inaccurate information using the report button. We may interrupt service for maintenance or security; contact us if this affects paid placement.\n\nComplaints can be sent to the seller above. Swedish law applies without removing mandatory consumer protection in your country. Consumers may bring an eligible dispute to ARN, https://www.arn.se, Box 174, 101 23 Stockholm, Sweden; its eligibility rules apply. Privacy: https://expanse.nyttolabs.com/privacy. Nothing in these terms limits statutory consumer rights.' from expanse_private.seller where singleton
$$;
revoke all on function expanse_private.contract_terms() from public,anon,authenticated;
alter function public.owner_map_checkout(text,text) set schema expanse_private;
revoke all on function expanse_private.owner_map_checkout(text,text) from public,anon,authenticated;
create function public.owner_map_checkout(p_slug text,p_key text,p_terms_version text default null) returns json
language plpgsql volatile security definer set search_path='' as $$
declare r json;
begin
 perform public._owned(p_slug,p_key);
 if p_terms_version is distinct from '2026-10-20' then raise exception 'terms_required';end if;
 if not coalesce((public.public_seller()->>'ready')::boolean,false) then raise exception 'seller_not_ready';end if;
 r:=expanse_private.owner_map_checkout(p_slug,p_key);
 update expanse_private.map_purchases set terms_version=p_terms_version,accepted_at=coalesce(accepted_at,now()),contract_text=coalesce(contract_text,expanse_private.contract_terms()) where id=(r->>'id')::uuid;
 return r;
end $$;
create or replace function public.public_commerce() returns json
language sql stable security definer set search_path='' as $$
 select json_build_object('enabled',c.enabled and coalesce((public.public_seller()->>'ready')::boolean,false),'currency','eur','months',12,'terms_version','2026-10-20',
 'prices',coalesce((select json_agg(json_build_object('zone',m.zone,'size',m.size,'amount_cents',m.amount_cents)) from expanse_private.map_catalog m),'[]'::json)) from expanse_private.commerce_config c where singleton
$$;
create function expanse_private.purchase_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.products; s expanse_private.seller; body text;
begin
 if new.state='paid' and old.state is distinct from 'paid' then
  select * into r from public.products where id=new.product_id;select * into s from expanse_private.seller where singleton;
  body:=E'Your Expanse map placement is confirmed.\nOrder: '||new.id||E'\nProduct: '||r.name||E'\nPlacement: '||new.zone||' '||new.size||'×'||new.size||E'\nPaid: EUR '||to_char(new.amount_cents/100.0,'FM999999990.00')||E'\nStarts: '||new.paid_at||E'\nEnds: '||new.ends_at||E'\n\n'||coalesce(new.contract_text,'Terms: https://expanse.nyttolabs.com/terms');
  if r.contact_email !~ '[.]invalid$' then
   insert into public.outbox(to_email,subject,body,kind,product_id,reply_to) values(r.contact_email,'Your Expanse order confirmation',left(body,6000),'map_receipt',r.id,nullif(s.email,''));perform public._kick_worker('mail');
  end if;
 end if;
 return new;
end $$;
revoke all on function expanse_private.purchase_receipt() from public,anon,authenticated;
create trigger map_purchase_receipt after update on expanse_private.map_purchases for each row execute function expanse_private.purchase_receipt();
create function public.owner_purchase_history(p_slug text,p_key text) returns json
language plpgsql stable security definer set search_path='' as $$
declare r public.products:=public._owned(p_slug,p_key);
begin return (select coalesce(json_agg(t),'[]'::json) from (select b.id,b.state,b.zone,b.size,b.amount_cents,b.created_at,b.paid_at,b.ends_at,b.terms_version,b.contract_text from expanse_private.map_purchases b where b.product_id=r.id order by b.created_at desc limit 30)t);end $$;

create table expanse_private.withdrawals (
 id uuid primary key default extensions.gen_random_uuid(),name text not null,email text not null,reference text not null,
 purchase_id uuid references expanse_private.map_purchases(id),message text not null default '',vhash text not null,
 created_at timestamptz not null default now(),resolved_at timestamptz,admin_note text not null default '',receipt_outbox_id bigint
);
alter table expanse_private.withdrawals enable row level security;
revoke all on expanse_private.withdrawals from public,anon,authenticated;
create index withdrawals_open_idx on expanse_private.withdrawals(created_at) where resolved_at is null;
create index withdrawals_rate_idx on expanse_private.withdrawals(vhash,created_at);
create index withdrawals_purchase_idx on expanse_private.withdrawals(purchase_id) where purchase_id is not null;
create function public.submit_withdrawal(p_name text,p_email text,p_reference text,p_message text default '') returns json
language plpgsql volatile security definer set search_path='' as $$
declare n text:=public._line(p_name,160);e text:=lower(public._line(p_email,254));ref text:=public._line(p_reference,200);
 msg text:=public._text(p_message,2000);vh text:=public._visitor_hash();w expanse_private.withdrawals;pid uuid;mailid bigint;admin_email text;receipt text;
begin
 if n='' or ref='' then raise exception 'invalid:withdrawal';end if;
 if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email';end if;
 perform pg_advisory_xact_lock(4243);
 select * into w from expanse_private.withdrawals where vhash=vh and email=e and reference=ref and created_at>now()-interval '24 hours' order by created_at desc limit 1;
 if w.id is null then
  if (select count(*) from expanse_private.withdrawals where vhash=vh and created_at>now()-interval '1 hour')>=3 or (select count(*) from expanse_private.withdrawals where created_at>now()-interval '1 hour')>=60 then raise exception 'slow_down';end if;
  select id into pid from expanse_private.map_purchases where id::text=ref;
  insert into expanse_private.withdrawals(name,email,reference,purchase_id,message,vhash) values(n,e,ref,pid,msg,vh) returning * into w;
  receipt:=E'Expanse — withdrawal notice received\nRequest: '||w.id||E'\nReceived (UTC): '||to_char(w.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||E'\nName: '||w.name||E'\nEmail: '||w.email||E'\nContract / order reference: '||w.reference||E'\nMessage: '||w.message||E'\n\nWe received your notice that you withdraw from the identified contract. This is an automatic acknowledgement, not confirmation that a refund has been issued. We will check the payment and reply by email. Keep this confirmation. A notice received within 14 days of purchase qualifies for our full-refund policy. Mandatory consumer rights remain unchanged.\nhttps://expanse.nyttolabs.com/terms';
  insert into public.outbox(to_email,subject,body,kind) values(e,'Expanse — withdrawal notice received',receipt,'withdrawal_receipt') returning id into mailid;
  update expanse_private.withdrawals set receipt_outbox_id=mailid where id=w.id;
  admin_email:=coalesce(public._setting('notify_email')#>>'{}','');
  if admin_email<>'' then insert into public.outbox(to_email,subject,body,kind,reply_to) values(admin_email,'Expanse — withdrawal needs review',left(receipt||E'\nReview in https://expanse.nyttolabs.com/admin#withdrawals . Verify the original Stripe payment before any refund.',6000),'withdrawal_admin',e);end if;
  perform public._kick_worker('mail');
 else
  receipt:=E'Expanse — withdrawal notice received\nRequest: '||w.id||E'\nReceived (UTC): '||to_char(w.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||E'\nName: '||w.name||E'\nEmail: '||w.email||E'\nContract / order reference: '||w.reference||E'\nMessage: '||w.message||E'\n\nYour original notice is already recorded. No duplicate notice or refund was created. We will check the payment and reply by email. https://expanse.nyttolabs.com/terms';
 end if;
 return json_build_object('ok',true,'id',w.id,'received_at',w.created_at,'receipt',receipt);
end $$;
create function public.admin_withdrawals(p_key text) returns json
language plpgsql volatile security definer set search_path='' as $$
begin perform public._admin(p_key);return (select coalesce(json_agg(t),'[]'::json) from (select w.*,b.state as payment_state,b.payment_intent,b.amount_cents,b.paid_at,o.sent_at as receipt_sent_at,o.failed_at as receipt_failed_at from expanse_private.withdrawals w left join expanse_private.map_purchases b on b.id=w.purchase_id left join public.outbox o on o.id=w.receipt_outbox_id order by w.resolved_at nulls first,w.created_at desc limit 200)t);end $$;
create function public.admin_resolve_withdrawal(p_key text,p_id uuid,p_note text) returns void
language plpgsql volatile security definer set search_path='' as $$
begin perform public._admin(p_key);if length(btrim(coalesce(p_note,'')))<5 then raise exception 'invalid:note';end if;
 update expanse_private.withdrawals set resolved_at=now(),admin_note=public._text(p_note,1000) where id=p_id;if not found then raise exception 'not_found';end if;end $$;

-- No active/open notices or unsent messages are deleted. Financial records are
-- kept through the seventh year after the purchase year. Runs once daily.
create function expanse_private.prune_personal_data() returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 delete from public.contact_log where at<now()-interval '7 days';
 delete from public.signin_log where at<now()-interval '7 days';
 delete from public.email_codes where expires_at<now()-interval '1 day';
 delete from public.outbox where (sent_at is not null or failed_at is not null) and created_at<now()-interval '90 days';
 update public.outbox set subject='Your Expanse sign-in code',body='(sign-in code cleared after one day)' where kind='signin_code' and created_at<now()-interval '1 day';
 delete from public.reports where resolved and created_at<now()-interval '90 days';
 update public.reports set details='' where not resolved and created_at<now()-interval '365 days' and details<>'';
 delete from public.events where day<current_date-90;
 delete from public.owner_marks where day<current_date-90;
 delete from public.placement_events where day<current_date-90;
 delete from expanse_private.discovery_events where day<current_date-90;
 delete from public.votes where removed_at is not null and removed_at<now()-interval '90 days';
 delete from public.owner_keys where revoked_at is not null and revoked_at<now()-interval '90 days';
 update public.products set recovery_token=null,recovery_secret_hash=null,recovery_expires_at=null where recovery_expires_at<now();
 delete from expanse_private.withdrawals where resolved_at<now()-interval '2 years' and created_at<now()-interval '2 years';
 delete from expanse_private.stripe_events where created_at<date_trunc('year',now())-interval '7 years';
 update expanse_private.withdrawals set purchase_id=null where purchase_id in(select id from expanse_private.map_purchases where created_at<date_trunc('year',now())-interval '7 years' and state<>'paid');
 delete from expanse_private.map_purchases where created_at<date_trunc('year',now())-interval '7 years' and state<>'paid' and not exists(select 1 from expanse_private.stripe_events e where e.purchase_id=map_purchases.id);
 perform public._set_setting('retention_last_run',to_jsonb(now()));
end $$;
revoke all on function expanse_private.prune_personal_data() from public,anon,authenticated;
select cron.schedule('expanse-retention','31 3 * * *',$$select expanse_private.prune_personal_data()$$);
revoke all on function public.public_seller(),public.admin_seller(text),public.admin_save_seller(text,jsonb),public.owner_map_checkout(text,text,text),public.owner_purchase_history(text,text),public.submit_withdrawal(text,text,text,text),public.admin_withdrawals(text),public.admin_resolve_withdrawal(text,uuid,text) from public,anon,authenticated;
grant execute on function public.public_seller(),public.admin_seller(text),public.admin_save_seller(text,jsonb),public.owner_map_checkout(text,text,text),public.owner_purchase_history(text,text),public.submit_withdrawal(text,text,text,text),public.admin_withdrawals(text),public.admin_resolve_withdrawal(text,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';

