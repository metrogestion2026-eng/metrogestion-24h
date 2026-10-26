-- Alpha75.24 · optimización RLS de lectura para Listados.
-- Mantiene exactamente los mismos permisos; fuerza evaluación estable una vez por consulta.

alter policy registros_select_secure
on public.registros_hotel
using (
  (select public.dispositivo_autorizado())
  and (
    (select public.puede_ver_modulo('hotel'))
    or (select public.puede_ver_modulo('historico'))
  )
);

alter policy pizarras_select_secure
on public.pizarras
using (
  (select public.dispositivo_autorizado())
  and (
    (select public.puede_ver_modulo('hotel'))
    or (select public.puede_ver_modulo('historico'))
  )
);

alter policy etapas_select_secure
on public.etapas_hotel
using (
  (select public.dispositivo_autorizado())
  and (
    (select public.puede_ver_modulo('hotel'))
    or (select public.puede_ver_modulo('historico'))
    or (select public.puede_ver_modulo('t_programadas'))
  )
);
