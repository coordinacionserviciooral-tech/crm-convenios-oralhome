-- Run after schema.sql and after deploying power-automate-alerts.
-- Store project URL and CRON_SECRET in Supabase Vault, never in repository SQL.
-- Example (replace values only in the private SQL editor):
-- select vault.create_secret('https://YOUR-PROJECT.supabase.co','oralhome_project_url');
-- select vault.create_secret('YOUR-RANDOM-SECRET','oralhome_cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ declare j record; begin
  for j in select jobid from cron.job where jobname in ('oralhome-alertas-am','oralhome-alertas-pm','oralhome-alertas-retry') loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;
select cron.schedule('oralhome-alertas-am','0 13 * * *', $job$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='oralhome_project_url' limit 1) || '/functions/v1/power-automate-alerts',
   headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='oralhome_cron_secret' limit 1),'x-run-slot','am'),
   body := '{}'::jsonb, timeout_milliseconds := 30000);
$job$);
select cron.schedule('oralhome-alertas-pm','0 20 * * *', $job$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='oralhome_project_url' limit 1) || '/functions/v1/power-automate-alerts',
   headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='oralhome_cron_secret' limit 1),'x-run-slot','pm'),
   body := '{}'::jsonb, timeout_milliseconds := 30000);
$job$);
-- Retry failed messages promptly while the provider idempotency key remains valid (24 h).
select cron.schedule('oralhome-alertas-retry','15 * * * *', $job$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='oralhome_project_url' limit 1) || '/functions/v1/power-automate-alerts',
   headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='oralhome_cron_secret' limit 1),'x-run-slot','retry'),
   body := '{}'::jsonb, timeout_milliseconds := 30000);
$job$);

