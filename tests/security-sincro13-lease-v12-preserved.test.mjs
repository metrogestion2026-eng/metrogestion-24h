import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const text = readFileSync(new URL('../supabase/functions/manteniment-sync-r1/index.ts', import.meta.url),'utf8');
const validate = ['preflight_lease','open_lease','sync_lease','authorize_lease','ack_lease','close_lease','ack_t_nuevas'];

test('S13 preserva TODAS las rutas lease del servicio desplegado v12',()=>{
  for(const action of validate){
    assert.ok(text.includes('"' + action + '"'), 'Falta ruta '+action);
  }
  assert.match(text, /const leaseRevision = "MG75-EJECUCION-LEASE-001"/);
  assert.match(text, /function leasePreflightRequestValid/);
  assert.match(text, /function leaseOpenRequestValid/);
  assert.match(text, /function leaseSyncRequestValid/);
  assert.match(text, /function leaseExecutionRequestValid/);
  assert.match(text, /"abrir_lease_ejecucion_manteniment"/);
  assert.match(text, /"recibir_snapshot_manteniment_lease"/);
  assert.match(text, /"cerrar_lease_ejecucion_manteniment"/);
});

test('S13 valida recibos antes de abrir el cliente privado y no cae en snapshot heredado',()=>{
  assert.match(text,/function s13ReceiptRequestValid/);
  assert.match(text,/function s13ReceiptResultValid/);
  const validation=text.indexOf('if (action === "ack_t_nuevas" && !s13ReceiptRequestValid');
  const receipt=text.indexOf('if (action === "ack_t_nuevas") {');
  const lease=text.indexOf('if (["preflight_lease","open_lease"');
  const snapshot=text.indexOf('const { data, error } = action === "ack"');
  assert.ok(validation>0 && receipt>validation && lease>receipt && snapshot>lease);
  assert.match(text,/receiver\.rpc\("sincro13_registrar_recibo_t"/);
  assert.match(text,/return reply\(200,\{ok:true,recibos_t:data\}\)/);
  assert.match(text,/value\.autoriza_sincronizar !== false/);
});

test('S13 no reemplaza receptor manteniment-sync-r1 de v12 ni activa recepcion por importación',()=>{
  for(const action of ['scope_status','preflight','authorize','ack_execution']) {
    assert.ok(text.includes('action === "'+action+'"'));
  }
  assert.match(text,/admin\.rpc\("recibir_snapshot_manteniment"/);
  assert.match(text,/admin\.rpc\("confirmar_comandos_manteniment"/);
  assert.match(text,/Deno\.serve\(async \(request: Request\)/);
});
