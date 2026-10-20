-- Run inside a transaction and ALWAYS roll back. No fixtures or sales are retained.
do $$
declare r json; k text; fixture_slug text; order_data json; v_event jsonb; result json; before_end timestamptz; checks int:=0;
begin
 update expanse_private.seller set legal_name='Fixture only',registration_number='TEST-ONLY',address='Fixture street, Sweden',email='fixture@example.invalid',phone='TEST-ONLY',published=true;
 r:=public._product_fields('{"name":"Fixture","url":"https://example.com","tagline":"A real problem solved","category":"other","pricing":"unspecified","needs":[]}'::jsonb)::json;
 if r->>'description'<>'' or r->>'audience'<>'' or r->>'pricing'<>'unspecified' then raise exception 'FAIL optional profile fields'; end if; checks:=checks+1;
 begin perform public._product_fields('{"name":"X"}'); raise exception 'FAIL invalid profile accepted'; exception when others then if sqlerrm='FAIL invalid profile accepted' then raise; end if; end; checks:=checks+1;
 r:=public.submit_product(jsonb_build_object('name','Commerce Fixture','url','https://example.com','tagline','Solve an actual test problem','category','other','pricing','unspecified','needs','[]'::jsonb,'email','commerce-fixture@example.invalid','x',130,'y',10,'size',1));
 fixture_slug:=r->>'slug';k:=r->>'key';
 begin perform public.owner_map_status(fixture_slug,'wrong-key'); raise exception 'FAIL unauthorized owner'; exception when others then if sqlerrm='FAIL unauthorized owner' then raise; end if; end; checks:=checks+1;
 begin perform public.owner_map_checkout(fixture_slug,k,'2026-10-20'); raise exception 'FAIL unreviewed product can pay'; exception when others then if sqlerrm='FAIL unreviewed product can pay' then raise; end if; end; checks:=checks+1;
 update expanse_private.commerce_config set enabled=true,webhook_key_hash=public._key_hash('fixture-token-0123456789012345678901234567890123456789');
 insert into expanse_private.map_catalog(zone,size,amount_cents,payment_link,url) values('edge',1,100,'plink_fixture','https://buy.stripe.com/fixture') on conflict(zone,size) do update set amount_cents=100,payment_link='plink_fixture',url='https://buy.stripe.com/fixture';
 update public.products set status='approved' where products.slug=fixture_slug;
 order_data:=public.owner_map_checkout(fixture_slug,k,'2026-10-20');
 if (public.owner_map_checkout(fixture_slug,k,'2026-10-20')->>'id') <> order_data->>'id' then raise exception 'FAIL checkout not idempotent'; end if; checks:=checks+1;
 v_event:=jsonb_build_object('id','evt_fixture_unpaid','type','checkout.session.completed','livemode',true,'app','expanse','kind','map_placement','reference',order_data->>'id','session_id','cs_fixture','session_created',extract(epoch from now())::bigint,'payment_status','unpaid','currency','eur','amount_total',100,'payment_link','plink_fixture','payment_intent','pi_fixture','zone','edge','size',1);
 begin perform public.confirm_map_payment('bad-token',v_event); raise exception 'FAIL webhook without secret'; exception when others then if sqlerrm='FAIL webhook without secret' then raise; end if; end; checks:=checks+1;
 result:=public.confirm_map_payment('fixture-token-0123456789012345678901234567890123456789',v_event);
 if result->>'outcome'<>'awaiting_payment' then raise exception 'FAIL unpaid checkout activated'; end if; checks:=checks+1;
 result:=public.confirm_map_payment('fixture-token-0123456789012345678901234567890123456789',v_event||'{"id":"evt_fixture_paid","payment_status":"paid","type":"checkout.session.async_payment_succeeded"}');
 if result->>'outcome'<>'paid' then raise exception 'FAIL verified payment did not activate: %',result; end if; checks:=checks+1;
 before_end:=(public.owner_map_status(fixture_slug,k)->>'ends_at')::timestamptz;
 if before_end<now()+interval '364 days' then raise exception 'FAIL term length'; end if; checks:=checks+1;
 result:=public.confirm_map_payment('fixture-token-0123456789012345678901234567890123456789',v_event||'{"id":"evt_fixture_paid","payment_status":"paid","type":"checkout.session.async_payment_succeeded"}');
 if result->>'outcome'<>'duplicate' or (public.owner_map_status(fixture_slug,k)->>'ends_at')::timestamptz<>before_end then raise exception 'FAIL duplicate extended placement'; end if; checks:=checks+1;
 result:=public.confirm_map_payment('fixture-token-0123456789012345678901234567890123456789',v_event||'{"id":"evt_fixture_second","payment_status":"paid","session_id":"cs_second"}');
 if result->>'outcome'<>'needs_review' or (public.owner_map_status(fixture_slug,k)->>'state')<>'paid' then raise exception 'FAIL duplicate second checkout'; end if; checks:=checks+1;
 begin perform public.owner_choose_map_spot(fixture_slug,k,134,12,1); raise exception 'FAIL moved paid placement'; exception when others then if sqlerrm='FAIL moved paid placement' then raise; end if; end; checks:=checks+1;
 result:=public.confirm_map_payment('fixture-token-0123456789012345678901234567890123456789','{"id":"evt_fixture_refund","type":"charge.refunded","livemode":true,"payment_intent":"pi_fixture","fully_refunded":true}');
 if result->>'outcome'<>'refunded' then raise exception 'FAIL refund'; end if; checks:=checks+1;
 perform expanse_private.release_expired_map_spots();
 if (select size from public.products where products.slug=fixture_slug)<>1 or (public.owner_map_status(fixture_slug,k)->>'state')<>'expired' then raise exception 'FAIL free fallback'; end if; checks:=checks+1;
 raise notice '% commerce assertions passed',checks;
end $$;

