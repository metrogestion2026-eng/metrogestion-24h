begin;

drop policy if exists usuarios_select_own_or_primary on public.usuarios;
drop policy if exists usuarios_select_own_primary_or_authorized on public.usuarios;

create policy usuarios_select_own_primary_or_authorized
on public.usuarios
for select
to authenticated
using (
  id = (select auth.uid())
  or (
    public.dispositivo_autorizado()
    and public.puede_ver_modulo('usuarios')
  )
);

commit;
