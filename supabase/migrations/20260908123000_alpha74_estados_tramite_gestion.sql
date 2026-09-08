insert into public.catalogo_estados_hotel (
  codigo,
  nombre,
  orden,
  color_semantico,
  activo
)
values
  ('tramite', 'Trámite', 26, 'blanco', true),
  ('gestion', 'Gestión', 27, 'blanco', true)
on conflict (codigo) do update
set nombre = excluded.nombre,
    orden = excluded.orden,
    color_semantico = excluded.color_semantico,
    activo = true;
