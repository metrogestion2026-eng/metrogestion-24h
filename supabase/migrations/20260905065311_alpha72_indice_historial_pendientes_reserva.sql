-- La pestaña Reservas consulta el histórico por el código visible de la unidad.
create index if not exists reservas_pendientes_resueltos_codigo_idx
  on public.reservas_pendientes_resueltos (reserva_codigo, resuelto_en desc);
