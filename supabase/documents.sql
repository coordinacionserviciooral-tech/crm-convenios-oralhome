-- Install after schema.sql. Existing agreements and files are preserved.
begin;
create table if not exists public.agreement_documents (
 id uuid primary key default gen_random_uuid(),
 agreement_id bigint not null references public."Aliados"("Id"),
 original_name text not null check(length(original_name) between 1 and 255),
 storage_path text not null unique, media_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 26214400),
 category text not null default 'Otro' check(category in ('Contrato','Anexo','Otrosí','Soporte','Otro')),
 description text not null default '' check(length(description)<=4000),
 created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 updated_by uuid references auth.users(id), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index if not exists agreement_documents_agreement_idx on public.agreement_documents(agreement_id,created_at desc);
insert into storage.buckets(id,name,public,file_size_limit) values('crm-convenios-documentos','crm-convenios-documentos',false,26214400)
 on conflict(id) do update set public=false,file_size_limit=26214400;

create or replace function public.can_upload_crm_document(p_path text) returns boolean
language sql stable security definer set search_path = public
as $$ select public.my_role() in ('administrador','comercial')
 and p_path ~ '^[1-9][0-9]*/[a-f0-9-]{36}/[a-zA-Z0-9._-]+$'
 and exists(select 1 from public."Aliados" where "Id"::text=split_part(p_path,'/',1) and archived_at is null) $$;
revoke all on function public.can_upload_crm_document(text) from public,anon;
grant execute on function public.can_upload_crm_document(text) to authenticated,service_role;

create or replace function public.guard_crm_document() returns trigger
language plpgsql security definer set search_path = public
as $$ declare object_size bigint; object_owner text; begin
 if auth.uid() is not null and public.my_role() not in ('administrador','comercial') then
  raise exception 'No autorizado' using errcode='42501';
 end if;
 if tg_op='INSERT' then
  if not public.can_upload_crm_document(new.storage_path) and auth.uid() is not null then
   raise exception 'No puedes cargar documentos en este convenio' using errcode='42501';
  end if;
  if split_part(new.storage_path,'/',1) <> new.agreement_id::text or split_part(new.storage_path,'/',2) <> new.id::text then
   raise exception 'Ruta de documento incorrecta';
  end if;
  select (metadata->>'size')::bigint,owner_id into object_size,object_owner from storage.objects
   where bucket_id='crm-convenios-documentos' and name=new.storage_path;
  if object_size is null or object_size<>new.size_bytes or (auth.uid() is not null and object_owner is distinct from auth.uid()::text) then
   raise exception 'El archivo no está cargado o no pertenece a esta carga';
  end if;
  if new.archived_at is not null then raise exception 'El documento debe crearse activo'; end if;
  new.created_by=auth.uid();new.created_at=now();
 else
  if auth.uid() is not null and public.my_role()<>'administrador' then raise exception 'Solo el administrador puede modificar o archivar documentos' using errcode='42501'; end if;
  if (new.id,new.agreement_id,new.storage_path,new.size_bytes,new.media_type,new.original_name) is distinct from (old.id,old.agreement_id,old.storage_path,old.size_bytes,old.media_type,old.original_name) then
   raise exception 'El vínculo y el archivo del documento no pueden cambiar';
  end if;
  new.created_by=old.created_by;new.created_at=old.created_at;
 end if;
 new.updated_by=auth.uid();new.updated_at=clock_timestamp();
 insert into public.audit_logs(user_id,action,entity,entity_id,old_data,new_data)
 values(auth.uid(),case when tg_op='INSERT' then 'UPLOAD_DOCUMENT' when new.archived_at is distinct from old.archived_at then case when new.archived_at is null then 'RESTORE_DOCUMENT' else 'ARCHIVE_DOCUMENT' end else 'UPDATE_DOCUMENT' end,
 'agreement_documents',new.id::text,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
revoke all on function public.guard_crm_document() from public,anon,authenticated;
drop trigger if exists guard_crm_document on public.agreement_documents;
create trigger guard_crm_document before insert or update on public.agreement_documents for each row execute function public.guard_crm_document();
alter table public.agreement_documents enable row level security;
drop policy if exists crm_documents_read on public.agreement_documents;
drop policy if exists crm_documents_insert on public.agreement_documents;
drop policy if exists crm_documents_update on public.agreement_documents;
create policy crm_documents_read on public.agreement_documents for select to authenticated
 using(public.my_role() is not null and (archived_at is null or public.my_role()='administrador'));
create policy crm_documents_insert on public.agreement_documents for insert to authenticated
 with check(public.my_role() in ('administrador','comercial') and created_by=auth.uid());
create policy crm_documents_update on public.agreement_documents for update to authenticated
 using(public.my_role()='administrador') with check(public.my_role()='administrador');
revoke all on public.agreement_documents from anon,authenticated;
grant select,insert,update on public.agreement_documents to authenticated;
grant all on public.agreement_documents to service_role;

-- Only these bucket-specific policies are changed. No public URLs or overwrites.
create or replace function public.crm_document_is_unlinked(p_path text) returns boolean
language sql stable security definer set search_path = public
as $$ select public.my_role() in ('administrador','comercial') and not exists(select 1 from public.agreement_documents where storage_path=p_path) $$;
revoke all on function public.crm_document_is_unlinked(text) from public,anon;
grant execute on function public.crm_document_is_unlinked(text) to authenticated,service_role;
drop policy if exists crm_document_storage_read on storage.objects;
drop policy if exists crm_document_storage_insert on storage.objects;
drop policy if exists crm_document_storage_cleanup on storage.objects;
create policy crm_document_storage_read on storage.objects for select to authenticated
 using(bucket_id='crm-convenios-documentos' and public.my_role() is not null
 and (exists(select 1 from public.agreement_documents d where d.storage_path=name and (d.archived_at is null or public.my_role()='administrador'))
 or (owner_id=auth.uid()::text and public.my_role() in ('administrador','comercial') and public.crm_document_is_unlinked(name))));
create policy crm_document_storage_insert on storage.objects for insert to authenticated
 with check(bucket_id='crm-convenios-documentos' and public.can_upload_crm_document(name) and owner_id=auth.uid()::text);
-- Allows cleanup only of the caller's upload that failed BEFORE it was linked.
create policy crm_document_storage_cleanup on storage.objects for delete to authenticated
 using(bucket_id='crm-convenios-documentos' and owner_id=auth.uid()::text and public.my_role() in ('administrador','comercial')
 and public.crm_document_is_unlinked(name));
commit;
