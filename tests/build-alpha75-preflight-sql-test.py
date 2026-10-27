#!/usr/bin/env python3
"""Build an isolated SQL test for the preflight migration.

Usage: python3 tests/build-alpha75-preflight-sql-test.py PATH_TO_MIGRATION [inputs|config|catalog]
The output touches only pg_temp objects and finishes with ROLLBACK. It never
changes operational configuration, credentials, functions or outboxes.
Production source is reused; only dependency names and pinned fixture hashes
are redirected to temporary fixtures.
"""
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_text()
start = source.index("create or replace function app_private.manteniment_preflight_solo_lectura(")
end = source.index("revoke all on function")
candidate = source[start:end]
replacements = {
    "app_private.manteniment_preflight_solo_lectura": "pg_temp.mg_preflight_private",
    "public.preflight_manteniment": "pg_temp.mg_preflight_public",
    "app_private.manteniment_sync_config": "pg_temp.mg_preflight_config",
    "public.recibir_snapshot_manteniment(text,jsonb)": "pg_temp.mg_sync_wrapper(text,jsonb)",
    "app_private.recibir_snapshot_manteniment_7525(text,jsonb)": "pg_temp.mg_sync_receiver(text,jsonb)",
    "'2e7bd5cb02bb5f582b9eaa241cc7d2db8b36879fe8b048de71e150aeee9defbd'":
        "(select sha from pg_temp.mg_preflight_expected where name='wrapper')",
    "'d5f484eee92b433ae9e8a176e16a4ce1727f0909692628cca65414080511e494'":
        "(select sha from pg_temp.mg_preflight_expected where name='receiver')",
}
for old, new in replacements.items():
    if old not in candidate:
        raise SystemExit("Missing expected source fragment: " + old)
    candidate = candidate.replace(old, new)
if "from app_private." in candidate or "'public.recibir_" in candidate:
    raise SystemExit("An operational dependency remains in the fixture")

wrapper = """create or replace function pg_temp.mg_sync_wrapper(text,jsonb)
returns jsonb language plpgsql as $f$
begin raise exception 'TEST: sync wrapper must never execute'; end;
$f$;"""
receiver = """create or replace function pg_temp.mg_sync_receiver(text,jsonb)
returns jsonb language plpgsql as $f$
begin raise exception 'TEST: sync receiver must never execute'; end;
$f$;"""
grants = """
revoke all on function pg_temp.mg_sync_wrapper(text,jsonb) from public,anon,authenticated;
revoke all on function pg_temp.mg_sync_receiver(text,jsonb) from public,anon,authenticated;
grant execute on function pg_temp.mg_sync_wrapper(text,jsonb) to service_role;
grant execute on function pg_temp.mg_sync_receiver(text,jsonb) to service_role;
"""
setup = """
begin;
create temporary table mg_preflight_config(
 id smallint primary key,token_activo boolean,token_hash text,spreadsheet_id text,
 solo_lectura_manual_protegida boolean,escritura_segura_manual boolean,
 pausa_importacion_identidad boolean
) on commit drop;
create temporary table mg_preflight_expected(name text primary key,sha text) on commit drop;
create temporary table mg_preflight_results(name text primary key) on commit drop;
insert into mg_preflight_config values(
 1,true,encode(extensions.digest('mg_'||repeat('a',64),'sha256'),'hex'),
 'TEST_SPREADSHEET_0123456789',true,false,true
);
"""
expected = """
insert into mg_preflight_expected values
('wrapper',encode(extensions.digest(pg_get_functiondef('pg_temp.mg_sync_wrapper(text,jsonb)'::regprocedure),'sha256'),'hex')),
('receiver',encode(extensions.digest(pg_get_functiondef('pg_temp.mg_sync_receiver(text,jsonb)'::regprocedure),'sha256'),'hex'));
"""
helper = r"""
create function pg_temp.mg_client() returns jsonb language sql immutable as $client$
select '{"version_script":"alpha75-2026.10.26.1","version_preflight":"alpha75-preflight-2026.10.27.1","escritura_segura_manual":true,"spreadsheet_id":"TEST_SPREADSHEET_0123456789"}'::jsonb;
$client$;
create function pg_temp.mg_expect(
 p_name text,p_client jsonb,p_expected jsonb,
 p_error text default null,
 p_token text default 'mg_'||repeat('a',64)
) returns void language plpgsql as $test$
declare
 v_actual jsonb; v_before text; v_after text; v_error text;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) into v_before
 from pg_temp.mg_preflight_config c;
 begin
   v_actual:=pg_temp.mg_preflight_public(p_token,p_client);
 exception when others then
   get stacked diagnostics v_error=returned_sqlstate;
   if p_error is null or v_error<>p_error then
     raise exception 'TEST %: unexpected SQLSTATE %',p_name,v_error;
   end if;
 end;
 if p_error is not null and v_error is null then
   raise exception 'TEST %: expected rejection %',p_name,p_error;
 end if;
 if p_error is null then
   if v_actual is null or not (v_actual @> p_expected)
      or v_actual->'sincronizacion_autorizada' is distinct from 'false'::jsonb
      or v_actual->'solo_lectura' is distinct from 'true'::jsonb
      or v_actual::text like '%mg_'||repeat('a',64)||'%'
      or v_actual ?| array['comandos','confirmaciones','token','token_hash'] then
     raise exception 'TEST %: invalid diagnostic',p_name;
   end if;
 end if;
 select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) into v_after
 from pg_temp.mg_preflight_config c;
 if v_before is distinct from v_after then
   raise exception 'TEST %: configuration changed',p_name;
 end if;
 insert into pg_temp.mg_preflight_results values(p_name);
end;
$test$;
"""
base = "pg_temp.mg_client()"
cases = []
groups = {}
def case(name, client=base, expected='{"compatible":true,"barreras_cerradas":true,"motivos":[]}', error=None, token=None):
    quote = lambda value: "'" + value.replace("'", "''") + "'"
    args = [quote(name), client, quote(expected) + "::jsonb"]
    if error is not None or token is not None:
        args.append("null" if error is None else quote(error))
    if token is not None:
        args.append(token)
    cases.append("select pg_temp.mg_expect(" + ",".join(args) + ");")

case("compatible")
for name, patch, reason in [
    ("old-script",'{"version_script":"alpha75-2026.10.14.1"}',"VERSION_SCRIPT_DISTINTA"),
    ("old-preflight",'{"version_preflight":"alpha75-preflight-2026.10.26.1"}',"VERSION_PREFLIGHT_DISTINTA"),
    ("client-write-disabled",'{"escritura_segura_manual":false}',"CLIENTE_SIN_ESCRITURA_SEGURA"),
    ("wrong-sheet",'{"spreadsheet_id":"WRONG_SPREADSHEET_0123456789"}',"ARCHIVO_DISTINTO"),
]:
    case(name, base+"||'"+patch+"'::jsonb", '{"compatible":false,"motivos":["'+reason+'"]}')
for name, client in [
    ("null-client","null"), ("array-client","'[]'::jsonb"),
    ("missing-version",base+"-'version_script'"),
    ("missing-bool",base+"-'escritura_segura_manual'"),
    ("null-bool",base+"""||'{"escritura_segura_manual":null}'::jsonb"""),
    ("string-bool",base+"""||'{"escritura_segura_manual":"true"}'::jsonb"""),
    ("number-bool",base+"""||'{"escritura_segura_manual":1}'::jsonb"""),
    ("rows-forbidden",base+"""||'{"filas":[]}'::jsonb"""),
    ("ack-forbidden",base+"""||'{"confirmaciones":[]}'::jsonb"""),
    ("empty-version",base+"""||'{"version_script":""}'::jsonb"""),
    ("long-version",base+"||jsonb_build_object('version_script',repeat('a',97))"),
    ("reflected-token",base+"||jsonb_build_object('version_script','mg_'||repeat('a',64))"),
]:
    case(name,client,"{}", "22023")
for name, token in [
    ("null-token","null"), ("bad-token","'bad'"),
    ("wrong-token","'mg_'||repeat('b',64)")
]:
    case(name,base,"{}","28000",token)
groups['inputs'] = cases[:]
cases.clear()

for field, correct in [
    ("solo_lectura_manual_protegida","true"),
    ("escritura_segura_manual","false"),
    ("pausa_importacion_identidad","true"),
]:
    for value in ["false" if correct=="true" else "true","null"]:
        cases.append(f"update pg_temp.mg_preflight_config set {field}={value};")
        case(field+"-"+value,base,'{"compatible":true,"barreras_cerradas":false,"motivos":["BARRERAS_NO_CERRADAS"]}')
    cases.append(f"update pg_temp.mg_preflight_config set {field}={correct};")
for name, assignment in [
    ("inactive","token_activo=false"),("null-active","token_activo=null"),
    ("null-hash","token_hash=null"),("empty-hash","token_hash=''"),
    ("malformed-hash","token_hash='invalid'")
]:
    cases.append("update pg_temp.mg_preflight_config set "+assignment+";")
    case(name,base,"{}","28000")
    cases.append("update pg_temp.mg_preflight_config set token_activo=true,token_hash=encode(extensions.digest('mg_'||repeat('a',64),'sha256'),'hex');")
cases.append("delete from pg_temp.mg_preflight_config;")
case("missing-config",base,"{}","28000")
cases.append("""insert into pg_temp.mg_preflight_config values(1,true,encode(extensions.digest('mg_'||repeat('a',64),'sha256'),'hex'),'TEST_SPREADSHEET_0123456789',true,false,true);""")
for value in ["null","''"]:
    cases.append("update pg_temp.mg_preflight_config set spreadsheet_id="+value+";")
    case("missing-sheet-"+value,base,'{"compatible":false,"archivo_coincide":false,"motivos":["ARCHIVO_DISTINTO"]}')
cases.append("update pg_temp.mg_preflight_config set spreadsheet_id='TEST_SPREADSHEET_0123456789';")
groups['config'] = cases[:]
cases.clear()

for name, definition in [("wrapper",wrapper),("receiver",receiver)]:
    cases.append(definition.replace("must never execute","must never execute -- drift"))
    case(name+"-drift",base,'{"compatible":false,"receptor_coincide":false,"motivos":["RECEPTOR_NO_VERIFICADO"]}')
    cases.append(definition)
    for role in ["anon","authenticated"]:
        cases.append(f"grant execute on function pg_temp.mg_sync_{name}(text,jsonb) to {role};")
        case(name+"-acl-"+role,base,'{"compatible":false,"receptor_coincide":false,"motivos":["RECEPTOR_NO_VERIFICADO"]}')
        cases.append(f"revoke execute on function pg_temp.mg_sync_{name}(text,jsonb) from {role};")
    cases.append(f"revoke execute on function pg_temp.mg_sync_{name}(text,jsonb) from service_role;")
    case(name+"-service-missing",base,'{"compatible":false,"receptor_coincide":false,"motivos":["RECEPTOR_NO_VERIFICADO"]}')
    cases.append(f"grant execute on function pg_temp.mg_sync_{name}(text,jsonb) to service_role;")
    cases.append(f"drop function pg_temp.mg_sync_{name}(text,jsonb);")
    case(name+"-missing",base,'{"compatible":false,"receptor_coincide":false,"motivos":["RECEPTOR_NO_VERIFICADO"]}')
    cases.append(definition)
    cases.append(grants)
case("restored-compatible")
cases.append("set transaction read only;")
for i in range(3):
    case("readonly-repeat-"+str(i))
groups['catalog'] = cases[:]
footer = """
set transaction read only;
select count(*) as tests_passed,
       current_setting('transaction_read_only') as transaction_read_only,
       jsonb_agg(name order by name) as cases
from pg_temp.mg_preflight_results;
rollback;
"""
selected = groups[sys.argv[2]] if len(sys.argv) > 2 else sum(groups.values(), [])
print(setup,wrapper,receiver,grants,expected,candidate,helper,"\n".join(selected),footer,sep="\n")
