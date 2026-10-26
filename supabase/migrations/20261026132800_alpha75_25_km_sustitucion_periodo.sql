-- Alpha75.25 · kilómetros de sustitución facturables por periodo.
-- Se calculan únicamente sobre los días facturables del periodo y la media válida de la parada.
-- No se reactiva km_sustitucion_total de toda la parada.

create or replace view public.facturacion_dfm_periodos
with (security_invoker = true)
as
with tramos as (
  select
    p.seguimiento_id,
    p.numero_parada,
    p.unidad as dfm,
    p.matricula,
    p.sustituto,
    p.matricula_sustituto,
    p.incidencia,
    p.causa,
    p.upc,
    c.periodo,
    c.fecha_inicio as periodo_inicio,
    c.fecha_cierre as periodo_cierre,
    greatest(p.fecha_inicio_parada, c.fecha_inicio) as tramo_inicio,
    least(coalesce(p.fecha_fin_parada, current_date), c.fecha_cierre, current_date) as tramo_fin,
    greatest(
      0,
      least(coalesce(p.fecha_fin_parada, current_date), c.fecha_cierre, current_date)
        - greatest(p.fecha_inicio_parada, c.fecha_inicio) + 1
    ) as dias_facturables,
    p.km_dia_automatico,
    p.km_dia_manual,
    p.km_dia,
    p.km_dia_fuente,
    p.dias_parada_total,
    p.km_sustitucion_total,
    p.estado
  from public.paradas_sustitucion_resumen p
  join public.cierres_facturacion c
    on p.clase_facturacion = 'DFM'
   and p.sustituto is not null
   and p.km_dia is not null
   and p.fecha_inicio_parada <= c.fecha_cierre
   and coalesce(p.fecha_fin_parada, current_date) >= c.fecha_inicio
   and c.fecha_inicio <= current_date
)
select
  seguimiento_id,
  numero_parada,
  dfm,
  matricula,
  sustituto,
  matricula_sustituto,
  incidencia,
  causa,
  upc,
  periodo,
  periodo_inicio,
  periodo_cierre,
  tramo_inicio,
  tramo_fin,
  dias_facturables,
  km_dia_automatico,
  km_dia_manual,
  km_dia,
  km_dia_fuente,
  case
    when km_dia is null then null::numeric
    else round(dias_facturables::numeric * km_dia)
  end as km_facturables,
  dias_parada_total,
  km_sustitucion_total,
  estado
from tramos;
