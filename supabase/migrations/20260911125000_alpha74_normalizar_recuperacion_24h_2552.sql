begin;

update public.etapas_hotel e
set tipo_etapa = 'recuperar_ruta',
    actualizado_en = clock_timestamp(),
    version = e.version + 1
from public.registros_hotel r
join public.activaciones_24h a on a.registro_hotel_id = r.id
where e.registro_hotel_id = r.id
  and regexp_replace(upper(btrim(a.dfm)), '[[:space:]]+', '', 'g') = '2552'
  and upper(btrim(coalesce(r.tipo_movimiento, ''))) = '24H'
  and not e.cancelado
  and e.accion_sistema = 'recuperar_y_liberar'
  and e.tipo_etapa is distinct from 'recuperar_ruta';

commit;
