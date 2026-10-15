-- Runs the worker edge function every 10 minutes: website/demo checks, emails, and the admin digest.
-- The shared secret lives in Vault; the edge function reads it over its database connection.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'worker_secret', 'Shared secret between pg_cron and the worker edge function');
  end if;
end $$;

select cron.schedule('expanse-worker', '*/10 * * * *', $$select public._kick_worker('all')$$);
