begin;

drop policy if exists historial_seguridad_claves_select_primary on public.historial_seguridad_claves;
create policy historial_seguridad_claves_select_primary
on public.historial_seguridad_claves
for select
to authenticated
using (
  public.es_administrador_principal()
  and public.dispositivo_autorizado()
);

drop policy if exists sugerencias_select_own_or_primary on public.sugerencias;
create policy sugerencias_select_own_or_primary
on public.sugerencias
for select
to authenticated
using (
  (
    usuario_id = auth.uid()
    and public.usuario_activo()
    and public.dispositivo_autorizado()
  )
  or (
    public.es_administrador_principal()
    and public.dispositivo_autorizado()
  )
);

commit;
