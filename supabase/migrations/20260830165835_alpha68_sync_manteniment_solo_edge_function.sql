-- Alpha68: la sincronización externa entra exclusivamente por la Edge Function
-- manteniment-sync-r1, que valida la clave compartida y ejecuta el RPC con service_role.
-- Se elimina la superficie Data API directa para anon/authenticated.

revoke execute on function public.recibir_snapshot_manteniment(text, jsonb)
  from public, anon, authenticated;
revoke execute on function app_private.recibir_snapshot_manteniment(text, jsonb)
  from public, anon, authenticated;

grant execute on function public.recibir_snapshot_manteniment(text, jsonb)
  to service_role;
grant execute on function app_private.recibir_snapshot_manteniment(text, jsonb)
  to service_role;

comment on function public.recibir_snapshot_manteniment(text, jsonb) is
  'Entrada interna para manteniment-sync-r1. No expuesta a anon ni authenticated.';
comment on function app_private.recibir_snapshot_manteniment(text, jsonb) is
  'Valida token y snapshot de MANTENIMENT. Invocable solo por service_role a través de la Edge Function.';
