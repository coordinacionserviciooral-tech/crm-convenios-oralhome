-- Preserves existing tariffs. Only a real tariff addition/change acknowledges renewal.
begin;
alter table public."Aliados" add column if not exists tariff_reviewed_at timestamptz;
create or replace function public.track_tariff_review() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  if tg_op = 'INSERT' then
    new.tariff_reviewed_at := null;
  else
    new.tariff_reviewed_at := old.tariff_reviewed_at;
    if exists(select 1 from jsonb_each(coalesce(new.tarifa,'{}'::jsonb)) entry
      where entry.value is distinct from old.tarifa->entry.key) then
      new.tariff_reviewed_at := clock_timestamp();
    end if;
  end if;
  return new;
end $$;
-- Runs before the audit trigger, so the acknowledgement is included in history.
drop trigger if exists trg_00_tariff_review on public."Aliados";
create trigger trg_00_tariff_review before insert or update on public."Aliados"
for each row execute function public.track_tariff_review();
revoke all on function public.track_tariff_review() from public,anon,authenticated;
commit;
