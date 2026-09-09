begin;

-- Alpha74.7: Gestión también debe estar disponible en el selector Tipo de T.
insert into public.catalogo_tipos_etapa_hotel (
  codigo,
  nombre,
  orden,
  activo
)
values ('GESTIÓN', 'GESTIÓN', 60, true)
on conflict (codigo) do update
set nombre = excluded.nombre,
    orden = excluded.orden,
    activo = true;

commit;
