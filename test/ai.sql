-- Isolated quota fixtures, run only in the local CI transaction and roll back.
do $$
declare token text:=repeat('ai-fixture-',8);v_visitor text:=repeat('a',64);r jsonb;checks int:=0;i int;
begin
 update expanse_private.ai_config set enabled=true,key_hash=public._key_hash(token),daily_limit=100;
 begin perform public.reserve_ai_request('wrong',v_visitor);raise exception 'FAIL invalid token';exception when others then if sqlerrm<>'forbidden' then raise;end if;end;checks:=checks+1;
 if has_table_privilege('anon','expanse_private.ai_usage','select') or has_table_privilege('authenticated','expanse_private.ai_config','update') then raise exception 'FAIL direct quota access';end if;checks:=checks+1;
 for i in 1..3 loop r:=public.reserve_ai_request(token,v_visitor);if not (r->>'allowed')::boolean then raise exception 'FAIL valid request denied';end if;end loop;
 r:=public.reserve_ai_request(token,v_visitor);if (r->>'allowed')::boolean or r->>'reason'<>'rate_limited' then raise exception 'FAIL hourly cap';end if;checks:=checks+1;
 if (select sum(requests) from expanse_private.ai_usage where visitor=repeat('a',64))<>3 then raise exception 'FAIL denied request charged';end if;checks:=checks+1;
 update expanse_private.ai_config set daily_limit=3;
 r:=public.reserve_ai_request(token,repeat('b',64));if (r->>'allowed')::boolean or r->>'reason'<>'daily_capacity' then raise exception 'FAIL global cap';end if;checks:=checks+1;
 update expanse_private.ai_config set enabled=false;
 r:=public.reserve_ai_request(token,repeat('c',64));if (r->>'allowed')::boolean then raise exception 'FAIL paused AI';end if;checks:=checks+1;
 update expanse_private.ai_config set enabled=true,daily_limit=100;
 insert into expanse_private.ai_usage(bucket,visitor,requests) values(now()-interval '4 days',repeat('d',64),1);
 perform public.reserve_ai_request(token,repeat('e',64));
 if exists(select 1 from expanse_private.ai_usage where visitor=repeat('d',64)) then raise exception 'FAIL old hash retained';end if;checks:=checks+1;
 -- Reach the per-day cap without reaching this hour's cap.
 update expanse_private.ai_usage set bucket=date_trunc('day',now() at time zone 'utc') at time zone 'utc',requests=10 where visitor=repeat('a',64);
 r:=public.reserve_ai_request(token,v_visitor);if (r->>'allowed')::boolean then raise exception 'FAIL daily visitor cap';end if;checks:=checks+1;
 raise notice '% AI quota assertions passed',checks;
end $$;
