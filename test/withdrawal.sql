-- Executed only inside BEGIN ... ROLLBACK with commerce.sql.
do $$
declare w json; again json; fixture json; slug_fixture text; k text; n int; request_id uuid; admin_key text; order_data json; checks int:=0;
begin
 fixture:=public.submit_product(jsonb_build_object('name','Legal Fixture','url','https://example.com','tagline','Solve a real fixture problem','category','other','pricing','unspecified','needs','[]'::jsonb,'email','legal-fixture@example.invalid','x',140,'y',10,'size',2));slug_fixture:=fixture->>'slug';k:=fixture->>'key';
 update public.products set status='approved' where slug=slug_fixture;
 begin perform public.owner_map_checkout(slug_fixture,k);raise exception 'FAIL missing terms';exception when others then if sqlerrm<>'terms_required' then raise;end if;end;checks:=checks+1;
 update expanse_private.seller set published=false,legal_name='PRIVATE FIXTURE SELLER',registration_number='PRIVATE-FIXTURE-ID',address='PRIVATE FIXTURE ADDRESS',email='private-fixture@example.invalid';
 if not (public.public_commerce()->>'enabled')::boolean then raise exception 'FAIL seller publication changes commerce availability';end if;checks:=checks+1;
 if public.public_seller()->>'legal_name'<>'' or public.public_seller()->>'email'<>'' then raise exception 'FAIL private seller exposed';end if;checks:=checks+1;
 order_data:=public.owner_map_checkout(slug_fixture,k,'2026-10-29');
 if (order_data->>'amount_cents')::int<>400 then raise exception 'FAIL private seller blocks server-priced checkout';end if;checks:=checks+1;
 if exists(select 1 from expanse_private.map_purchases where id=(order_data->>'id')::uuid and (contract_text like '%PRIVATE FIXTURE%' or contract_text like '%PRIVATE-FIXTURE-ID%' or contract_text like '%private-fixture@%')) then raise exception 'FAIL private seller leaked into contract';end if;checks:=checks+1;
 if not exists(select 1 from expanse_private.map_purchases where id=(order_data->>'id')::uuid and contract_text like '%NyttoLabs%' and accepted_at is not null and terms_version='2026-10-29') then raise exception 'FAIL accepted contract missing';end if;checks:=checks+1;
 update expanse_private.commerce_config set enabled=false;
 if (public.public_commerce()->>'enabled')::boolean then raise exception 'FAIL configured pause ignored';end if;checks:=checks+1;
 begin perform public.owner_map_checkout(slug_fixture,k,'2026-10-29');raise exception 'FAIL paused checkout';exception when others then if sqlerrm<>'payments_paused' then raise;end if;end;checks:=checks+1;
 update expanse_private.commerce_config set enabled=true;
 update public.products set contact_email='receipt-fixture@example.com' where slug=slug_fixture;
 update expanse_private.map_purchases set state='paid',paid_at=now(),ends_at=now()+interval '12 months' where id=(order_data->>'id')::uuid;
 if not exists(select 1 from public.outbox where kind='map_receipt' and product_id=(select id from public.products where slug=slug_fixture) and reply_to is null and body not like '%PRIVATE FIXTURE%' and body not like '%private-fixture@%') then raise exception 'FAIL private seller leaked into receipt';end if;checks:=checks+1;
 update expanse_private.seller set published=true;
 if expanse_private.contract_terms() not like '%PRIVATE FIXTURE SELLER%' then raise exception 'FAIL explicitly published seller missing from contract';end if;checks:=checks+1;
 begin perform public.admin_withdrawals('wrong-admin');raise exception 'FAIL admin exposure';exception when others then if sqlerrm<>'bad_admin' then raise;end if;end;checks:=checks+1;
 begin perform public.owner_purchase_history(slug_fixture,'wrong-owner');raise exception 'FAIL owner exposure';exception when others then if sqlerrm='FAIL owner exposure' then raise;end if;end;checks:=checks+1;
 w:=public.submit_withdrawal('Fixture Person','fixture@example.invalid','nonexistent-order','');request_id:=(w->>'id')::uuid;
 if not (w->>'ok')::boolean or w->>'receipt' not like '%Contract / order reference: nonexistent-order%' then raise exception 'FAIL acknowledgement';end if;checks:=checks+1;
 select count(*) into n from public.outbox where kind='withdrawal_receipt' and body like '%'||request_id||'%';if n<>1 then raise exception 'FAIL missing email';end if;checks:=checks+1;
 again:=public.submit_withdrawal('Fixture Person','fixture@example.invalid','nonexistent-order','');if again->>'id'<>w->>'id' then raise exception 'FAIL duplicate notice';end if;checks:=checks+1;
 if (select count(*) from public.outbox where kind='withdrawal_receipt' and body like '%'||request_id||'%')<>n then raise exception 'FAIL duplicate email';end if;checks:=checks+1;
 admin_key:=public._admin_issue();if json_array_length(public.admin_withdrawals(admin_key))<1 then raise exception 'FAIL admin review';end if;checks:=checks+1;
 perform public.admin_resolve_withdrawal(admin_key,request_id,'Fixture checked, no real charge or refund');if (select resolved_at is null from expanse_private.withdrawals where id=request_id) then raise exception 'FAIL resolution';end if;checks:=checks+1;
 if has_function_privilege('anon','expanse_private.owner_map_checkout(text,text)','execute') or has_table_privilege('anon','expanse_private.withdrawals','select') then raise exception 'FAIL private bypass';end if;checks:=checks+1;
 insert into public.contact_log(vhash,at) values('retention-fixture',now()-interval '8 days');insert into public.outbox(to_email,subject,body,kind,sent_at,created_at) values('fixture@example.invalid','Fixture','Fixture','retention-fixture',now()-interval '100 days',now()-interval '100 days');perform expanse_private.prune_personal_data();
 if exists(select 1 from public.contact_log where vhash='retention-fixture') or exists(select 1 from public.outbox where kind='retention-fixture') then raise exception 'FAIL retention';end if;checks:=checks+1;
 if not exists(select 1 from expanse_private.withdrawals where id=request_id) then raise exception 'FAIL recent notice purged';end if;checks:=checks+1;
 raise notice '% legal and retention assertions passed',checks;
end $$;
