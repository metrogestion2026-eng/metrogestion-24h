create index if not exists sesiones_presencia_bloqueada_por_idx
  on public.sesiones_presencia (bloqueada_por);

create index if not exists intentos_acceso_bloqueado_por_idx
  on public.intentos_acceso_no_reconocido (bloqueado_por);
