begin;
create or replace function public.activate_crm_invited_user(p_user uuid,p_actor uuid,p_name text,p_role public.app_role)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if not exists(select 1 from public.profiles where id=p_actor and role='administrador' and is_active) then
    raise exception 'Administrador no autorizado' using errcode='42501';
  end if;
  if nullif(btrim(p_name),'') is null or length(p_name)>150 then raise exception 'Nombre inválido'; end if;
  update public.profiles set full_name=btrim(p_name),role=p_role,is_active=true where id=p_user and not is_active;
  if not found then raise exception 'El perfil ya está activo o no existe'; end if;
  insert into public.audit_logs(user_id,action,entity,entity_id,new_data)
    values(p_actor,'CREATE_USER','profiles',p_user::text,jsonb_build_object('full_name',btrim(p_name),'role',p_role,'is_active',true));
end $$;
revoke all on function public.activate_crm_invited_user(uuid,uuid,text,public.app_role) from public,anon,authenticated;
grant execute on function public.activate_crm_invited_user(uuid,uuid,text,public.app_role) to service_role;
commit;
