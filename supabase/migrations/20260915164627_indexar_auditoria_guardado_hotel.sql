-- El editor cuenta por request_id en varias capas del guardado.
-- Sin este índice, cada conteo recorre toda la auditoría y puede agotar
-- statement_timeout antes de guardar la recuperación de una ficha.
-- Conserva las políticas de acceso, funciones, datos y límites de tiempo.
CREATE INDEX IF NOT EXISTS auditoria_cambios_request_id_idx
  ON public.auditoria_cambios (request_id)
  WHERE request_id IS NOT NULL;

COMMENT ON INDEX public.auditoria_cambios_request_id_idx IS
  'Localiza los eventos de un guardado sin recorrer toda la auditoría.';
