alter policy activaciones_24h_select
on public.activaciones_24h
using (
  (select public.dispositivo_autorizado())
  and (select public.puede_ver_modulo('activar24h'))
  and (
    creado_por = (select auth.uid())
    or (select public.es_administrador_principal())
  )
);

alter policy sugerencias_select_own_or_primary
on public.sugerencias
using (
  (
    usuario_id = (select auth.uid())
    and (select public.usuario_activo())
    and (select public.dispositivo_autorizado())
  )
  or (
    (select public.es_administrador_principal())
    and (select public.dispositivo_autorizado())
  )
);

alter policy usuarios_select_own_or_primary
on public.usuarios
using (
  id = (select auth.uid())
  or (
    (select public.dispositivo_autorizado())
    and (select public.es_administrador_principal())
  )
);
