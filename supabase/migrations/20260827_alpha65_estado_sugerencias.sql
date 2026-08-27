begin;

create or replace function app_private.actualizar_estado_sugerencia(
  p_sugerencia_id uuid,
  p_estado text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_estado text := lower(btrim(coalesce(p_estado, '')));
  v_row public.sugerencias%rowtype;
begin
  if not app_private.es_administrador_principal()
     or not app_private.usuario_activo()
     or not app_private.dispositivo_autorizado() then
    raise exception 'Solo el administrador principal puede gestionar sugerencias';
  end if;

  if v_estado not in ('nueva','leida','en_estudio','resuelta','descartada') then
    raise exception 'Estado no válido';
  end if;

  update public.sugerencias
  set estado = v_estado,
      actualizado_en = now()
  where id = p_sugerencia_id
  returning * into v_row;

  if not found then
    raise exception 'Sugerencia no encontrada';
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'estado', v_row.estado
  );
end;
$$;

create or replace function public.actualizar_estado_sugerencia(
  p_sugerencia_id uuid,
  p_estado text
)
returns jsonb
language sql
set search_path = pg_catalog, app_private
as $$
  select app_private.actualizar_estado_sugerencia(p_sugerencia_id, p_estado);
$$;

revoke all on function public.actualizar_estado_sugerencia(uuid,text) from public;
revoke all on function public.actualizar_estado_sugerencia(uuid,text) from anon;
grant execute on function public.actualizar_estado_sugerencia(uuid,text) to authenticated;

commit;
