begin;

revoke execute on function public.conciliar_alcance_manteniment(text,jsonb)
from public, anon, authenticated;

grant execute on function public.conciliar_alcance_manteniment(text,jsonb)
to service_role;

commit;
