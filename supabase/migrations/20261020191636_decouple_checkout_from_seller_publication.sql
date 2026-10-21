-- Checkout availability is controlled by commerce_config, independently of
-- publishing proprietor details. Do not publish or seed personal seller data.
-- Keep owner checks, review, server pricing, terms acceptance and webhooks intact.
create or replace function public.owner_map_checkout(p_slug text,p_key text,p_terms_version text default null) returns json
language plpgsql volatile security definer set search_path='' as $$
declare r json;
begin
 perform public._owned(p_slug,p_key);
 if p_terms_version is distinct from '2026-10-20' then raise exception 'terms_required';end if;
 r:=expanse_private.owner_map_checkout(p_slug,p_key);
 update expanse_private.map_purchases set terms_version=p_terms_version,accepted_at=coalesce(accepted_at,now()),contract_text=coalesce(contract_text,expanse_private.contract_terms()) where id=(r->>'id')::uuid;
 return r;
end $$;
create or replace function public.public_commerce() returns json
language sql stable security definer set search_path='' as $$
 select json_build_object('enabled',c.enabled,'currency','eur','months',12,'terms_version','2026-10-20',
 'prices',coalesce((select json_agg(json_build_object('zone',m.zone,'size',m.size,'amount_cents',m.amount_cents)) from expanse_private.map_catalog m),'[]'::json)) from expanse_private.commerce_config c where singleton
$$;

create or replace function expanse_private.contract_terms() returns text
language sql stable security definer set search_path='' as $$
 select E'Expanse map placement — terms version 2026-10-20\nService: Expanse by NyttoLabs\nSupport: https://expanse.nyttolabs.com/?contact=1\n' ||
 case when coalesce((s->>'ready')::boolean,false) then
 E'Seller: '||(s->>'legal_name')||E'\nRegistration number: '||(s->>'registration_number')||E'\nAddress: '||(s->>'address')||E'\nEmail: '||(s->>'email')||E'\nPhone: '||(s->>'phone')
 else E'Seller registration and address have not been published.' end || E'\n\nOne payment in EUR for 12 months of the chosen map square, starting when Stripe confirms payment. Tax is included where applicable. No automatic renewal. Your product profile remains free; after expiry it returns to a free 1×1 Edge spot. Payment does not buy search ranking, Spotlight, guaranteed views, traffic, sales or revenue. Sponsored cards are a separate service. One square per product; different real products from the same maker are allowed. Duplicate or misleading listings are not allowed. Separate purchases cannot be merged; no automatic upgrade or credit for unused time. Content rules apply equally to everyone.\n\nWe provide a full refund if you notify us that you withdraw within 14 days after purchase, including business purchases. We make no deduction for placement used during those 14 days. Starting placement immediately does not waive withdrawal rights. Use https://expanse.nyttolabs.com/withdraw or email the seller with your name and order reference. No explanation is required. We refund to the original payment method without a refund fee, without undue delay and within 14 days after receiving your notice. Paid placement ends when the refund is processed; your free listing continues.\n\nAfter 14 days, a change-of-mind refund is not automatic. Contact us about an incorrect charge, duplicate payment or service problem. Mandatory consumer remedies remain available. If we permanently end a paid placement for reasons other than a breach of content rules, we refund the unused portion. Deleting a listing does not submit a withdrawal notice.\n\nOptional withdrawal template (not required): I hereby withdraw from my contract for Expanse map placement. Order reference: ___. Purchased on: ___. Name: ___. Email: ___. Address: ___. Date: ___. A signature is required only for a paper notice. Send to the seller above or use the online withdrawal function.\n\nOnly list real software you make or represent. Spam, scams, illegal or adult content, misleading profiles and duplicates may be rejected or removed. You can edit or remove your listing in the owner panel. Report inaccurate information using the report button. We may interrupt service for maintenance or security; contact us if this affects paid placement.\n\nComplaints can be sent to the seller above. Swedish law applies without removing mandatory consumer protection in your country. Consumers may bring an eligible dispute to ARN, https://www.arn.se, Box 174, 101 23 Stockholm, Sweden; its eligibility rules apply. Privacy: https://expanse.nyttolabs.com/privacy. Nothing in these terms limits statutory consumer rights.' from (select public.public_seller()::jsonb as s) published_seller
$$;

create or replace function expanse_private.purchase_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.products; body text;
begin
 if new.state='paid' and old.state is distinct from 'paid' then
  select * into r from public.products where id=new.product_id;
  body:=E'Your Expanse map placement is confirmed.\nOrder: '||new.id||E'\nProduct: '||r.name||E'\nPlacement: '||new.zone||' '||new.size||'×'||new.size||E'\nPaid: EUR '||to_char(new.amount_cents/100.0,'FM999999990.00')||E'\nStarts: '||new.paid_at||E'\nEnds: '||new.ends_at||E'\n\n'||coalesce(new.contract_text,'Terms: https://expanse.nyttolabs.com/terms');
  if r.contact_email !~ '[.]invalid$' then
   insert into public.outbox(to_email,subject,body,kind,product_id,reply_to) values(r.contact_email,'Your Expanse order confirmation',left(body,6000),'map_receipt',r.id,nullif(public.public_seller()->>'email',''));perform public._kick_worker('mail');
  end if;
 end if;
 return new;
end $$;
revoke all on function expanse_private.purchase_receipt() from public,anon,authenticated;

revoke all on function expanse_private.contract_terms() from public,anon,authenticated;
revoke execute on function public.owner_map_checkout(text,text,text),public.public_commerce() from public,anon,authenticated;
grant execute on function public.owner_map_checkout(text,text,text),public.public_commerce() to anon,authenticated;

