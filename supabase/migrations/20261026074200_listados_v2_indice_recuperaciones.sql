-- Listados V2: acelera la búsqueda del hito real de recuperación.
-- No modifica datos ni reglas; solo evita recorrer todas las T para cada consulta.
create index if not exists etapas_hotel_recuperar_realizada_idx
on public.etapas_hotel (registro_hotel_id)
include (fecha_real, fecha_fin_real, fecha_inicio_real)
where cancelado = false
  and estado = 'realizada'
  and tipo_etapa = 'recuperar_ruta';
