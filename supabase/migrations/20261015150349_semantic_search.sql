-- AI search: each live product gets an embedding of its profile (gte-small, 384 dimensions, computed by the worker
-- inside Supabase) plus one per need. The search edge function embeds the visitor's words and compares.
create extension if not exists vector with schema extensions;

alter table public.products
  add column if not exists embedding extensions.vector(384),
  add column if not exists need_embeddings extensions.vector(384)[],
  add column if not exists embed_hash text not null default '';

-- The text that describes a product for matching. A change in it means a new embedding.
create or replace function public._embed_text(r public.products) returns text
language sql immutable set search_path = '' as $$
  select left(
    r.name || '. ' || r.tagline || '. Solves: ' || array_to_string(r.needs, '; ') || '. For ' || r.audience || '. ' ||
    case r.category when 'productivity' then 'Productivity' when 'developer' then 'Developer tools' when 'design' then 'Design'
      when 'marketing' then 'Marketing and sales' when 'finance' then 'Finance and admin' when 'ai' then 'AI'
      when 'commerce' then 'E-commerce' when 'education' then 'Education' when 'health' then 'Health and wellbeing' else 'Software' end || '. ' ||
    case when cardinality(r.integrations) > 0 then 'Works with ' || array_to_string(r.integrations, ', ') || '. ' else '' end ||
    r.description, 2000)
$$;

-- Internal (worker): live products whose embedding is missing or out of date.
create or replace function public._embed_due(p_limit int) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', p.id, 'hash', p.h, 'text', p.t, 'needs', p.needs)), '[]'::json)
  from (select pr.id, pr.needs, public._embed_text(pr) as t, md5(public._embed_text(pr)) as h
        from public.products pr
        where pr.status = 'approved' and pr.embed_hash is distinct from md5(public._embed_text(pr))
        order by pr.approved_at, pr.id
        limit greatest(1, least(p_limit, 25))) p
$$;

-- Internal (worker): stores the vectors (as pgvector text, e.g. "[0.1,0.2,...]").
create or replace function public._embed_record(p_id bigint, p_hash text, p_doc text, p_needs text[]) returns void
language sql volatile security definer set search_path = '' as $$
  update public.products
     set embedding = p_doc::extensions.vector(384),
         need_embeddings = (select array_agg(v::extensions.vector(384) order by i) from unnest(p_needs) with ordinality as n(v, i)),
         embed_hash = p_hash
   where id = p_id
$$;

-- Internal (search edge function): similarity of every live product to the query, best first, plus the median
-- over the whole catalog so the caller can tell a real match from noise.
create or replace function public._semantic_search(p_query text, p_limit int) returns json
language sql stable security definer set search_path = '' as $$
  with q as (select p_query::extensions.vector(384) as v),
  s as (
    select p.slug, p.needs, p.need_embeddings,
           1 - (p.embedding operator(extensions.<=>) q.v) as sim
    from public.products p, q
    where p.status = 'approved' and p.embedding is not null),
  best as (
    select s.slug, s.sim,
           (select json_build_object('need', s.needs[n.i], 'sim', 1 - (n.v operator(extensions.<=>) q.v))
              from unnest(s.need_embeddings) with ordinality as n(v, i), q
             where n.i <= cardinality(s.needs)
             order by n.v operator(extensions.<=>) q.v limit 1) as need
    from s order by s.sim desc limit greatest(1, least(p_limit, 50)))
  select json_build_object(
    'count', (select count(*) from s),
    'median', (select percentile_cont(0.5) within group (order by sim) from s),
    'results', coalesce((select json_agg(json_build_object('slug', b.slug, 'sim', round(b.sim::numeric, 4), 'need', b.need->>'need', 'need_sim', round((b.need->>'sim')::numeric, 4)) order by b.sim desc) from best b), '[]'::json))
$$;

revoke execute on function
  public._embed_text(public.products), public._embed_due(int), public._embed_record(bigint, text, text, text[]),
  public._semantic_search(text, int)
from public, anon, authenticated;

-- Approving a product now also asks the worker to make it findable by AI search right away ("review" = mail + embed).
create or replace function public.admin_set_status(p_key text, p_slug text, p_status text, p_note text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.products;
  v_old text;
  v_note text := public._line(p_note, 400);
begin
  perform public._admin(p_key);
  if p_status not in ('approved', 'rejected', 'hidden', 'removed') then raise exception 'invalid:status'; end if;
  select * into r from public.products where slug = p_slug;
  if r.id is null or r.status = 'removed' then raise exception 'not_found'; end if;
  if p_status in ('rejected', 'hidden') and char_length(v_note) < 3 then raise exception 'invalid:note'; end if;
  v_old := r.status;
  if p_status = 'removed' then
    update public.products
       set status = 'removed', review_note = v_note, contact_email = 'removed@removed.invalid', owner_key_hash = '',
           submit_hash = null, recovery_token = null, recovery_secret_hash = null, recovery_expires_at = null
     where id = r.id returning * into r;
  else
    update public.products set status = p_status, review_note = case when p_status = 'approved' then '' else v_note end
     where id = r.id returning * into r;
  end if;
  update public.reports set resolved = true where product_id = r.id and not resolved;
  if v_old is distinct from p_status then
    perform public._notify_owner(r, p_status, v_note);
    perform public._kick_worker('review');
  end if;
  return public._admin_json(r);
end $$;
