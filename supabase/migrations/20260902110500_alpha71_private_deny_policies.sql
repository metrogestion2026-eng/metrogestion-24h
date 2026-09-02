begin;

drop policy if exists manteniment_parada_sync_explicit_deny
  on app_private.manteniment_parada_sync;
create policy manteniment_parada_sync_explicit_deny
on app_private.manteniment_parada_sync
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists manteniment_parada_outbox_explicit_deny
  on app_private.manteniment_parada_outbox;
create policy manteniment_parada_outbox_explicit_deny
on app_private.manteniment_parada_outbox
for all
to anon, authenticated
using (false)
with check (false);

commit;
