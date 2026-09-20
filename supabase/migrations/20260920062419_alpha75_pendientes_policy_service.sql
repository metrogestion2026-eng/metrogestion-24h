-- Only the synchronization service may access the raw read snapshot.
create policy manteniment_pendientes_service_only
on app_private.manteniment_pendientes_lectura
for all to service_role using (true) with check (true);
