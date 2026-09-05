begin;

create index if not exists intentos_acceso_reconocido_por_idx
  on public.intentos_acceso_no_reconocido (reconocido_por)
  where reconocido_por is not null;

commit;
