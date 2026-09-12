begin;

update public.catalogo_estados_hotel
set nombre = 'Pendiente de recuperar'
where codigo = 'recogido_pendiente_ruta'
  and nombre is distinct from 'Pendiente de recuperar';

commit;
