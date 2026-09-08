create index if not exists reservas_pendientes_reaperturas_etapa_idx
  on app_private.reservas_pendientes_reaperturas (etapa_hotel_id);
create index if not exists reservas_pendientes_reaperturas_reabierto_por_idx
  on app_private.reservas_pendientes_reaperturas (reabierto_por);
create index if not exists reservas_pendientes_reaperturas_resuelto_por_idx
  on app_private.reservas_pendientes_reaperturas (resuelto_nuevamente_por);
create index if not exists etapas_hotel_reabierta_por_idx
  on public.etapas_hotel (reabierta_por);

alter function public.reabrir_t_realizada_rapida(uuid, integer, text, text)
  security invoker;

grant execute on function app_private.reabrir_t_realizada_rapida(uuid, integer, text, text)
  to authenticated;
revoke execute on function app_private.reabrir_t_realizada_rapida(uuid, integer, text, text)
  from public, anon;

