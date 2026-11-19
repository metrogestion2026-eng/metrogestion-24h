import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExecutorHarness, HEADERS, IDS, command, paradaRow, workPayload, scopeOf,
} from './helpers/alpha75-sync-executor-harness.mjs';

function setup(opts={}) {
  const h=createExecutorHarness({
    rows:[HEADERS,paradaRow()],
    cells:{'2,1':{note:'METROGESTION_PARADA:'+IDS.stop}},
    ...opts
  });
  const order=command({payload:{solo_trabajos:true,trabajos_crear:[workPayload()]}});
  h.call('metrogestionGuardarAlcanceOrdenes_', [scopeOf(order)]);
  const state=h.newState([order]);
  h.save(state);h.clearEvents();
  return {h,order,state};
}

test('DocumentLock surrounds the entire authorized order, T assignment and journal',()=>{
 const {h,state}=setup();
 h.process(state);
 const events=h.events;
 const lock=events.findIndex(e=>e.kind==='lock'&&e.method==='tryDocumentLock'&&e.acquired);
 const firstJournal=events.findIndex(e=>e.kind==='property'&&e.method==='setProperty'
   &&String(e.key).startsWith('METROGESTION_ORDEN_V1:'));
 const firstEffect=events.findIndex(e=>e.kind==='sheet');
 const release=events.findIndex(e=>e.kind==='lock'&&e.method==='releaseDocumentLock');
 assert.ok(lock>=0);
 assert.ok(lock<firstJournal,'acquire BEFORE durable attempted intent');
 assert.ok(firstJournal<firstEffect,'persist intent BEFORE first Sheet write');
 assert.ok(release>firstEffect,'release AFTER writes');
 assert.equal(h.world.documentLockHeld,false);
 assert.equal(state.confirmados,1);
 assert.equal(h.sheet.getLastRow(),3);
 assert.ok(Number(h.sheet.getRange(3,20).getValue())>0);
 assert.equal(h.world.registroFilas.filas[0][4],'ORDEN_AUTORIZADA');
 const saved=Object.entries(h.properties).find(([key])=>key.startsWith('METROGESTION_ORDEN_V1:'));
 assert.equal(JSON.parse(saved[1]).recibos_t_nuevas.length,1);
});

test('busy DocumentLock denies before journal, sheet writes and ACK',()=>{
 const {h,state}=setup({documentLockBusy:true}),before=h.snapshot();
 assert.throws(()=>h.process(state),/REGISTRO_FILAS está ocupado/);
 assert.equal(h.world.documentLockHeld,false);
 assert.equal(h.effects.length,0);
 assert.deepEqual(h.snapshot(),before);
 assert.equal(Object.keys(h.properties).some(k=>k.startsWith('METROGESTION_ORDEN_V1:')),false);
 assert.equal(h.httpCalls.some(x=>x.method==='ack_execution'),false);
});

test('onChange attempted during insert cannot assign T while order holds DocumentLock',()=>{
 const {h,state}=setup(),original=h.world.effect.bind(h.world);
 let attempted=0;
 h.world.effect=(event,mutation)=>{
   original(event,mutation);
   if(event.kind==='sheet'&&event.method==='insertRowAfter'){
      attempted++;
      assert.equal(h.world.documentLockHeld,true);
      assert.throws(
       ()=>h.call('metrogestionIdentidadFilasCambio',{
          source:h.world.book,changeType:'INSERT_ROW'
       }),/Synthetic document lock busy/);
      assert.equal(h.world.registroFilas.filas.length,0,'onChange made no T');
   }
 };
 h.process(state);
 assert.equal(attempted,1);
 assert.equal(h.world.documentLockHeld,false);
 assert.equal(h.world.registroFilas.filas.length,1,'order made exactly one T');
 assert.equal(h.world.registroFilas.filas[0][4],'ORDEN_AUTORIZADA');
 assert.equal(state.confirmados,1);
});

test('editing sheet while acquiring lock fails before journal and sheet effects',()=>{
 const {h,state}=setup();
 const originalPush=h.world.events.push.bind(h.world.events);
 let injected=false;
 h.world.events.push=(event)=>{
  if(!injected && event.kind==='lock'&&event.method==='tryDocumentLock'&&event.acquired){
    injected=true;
    h.sheet.at(2,11).value='2026-11-19';
  }
  return originalPush(event);
 };
 assert.throws(()=>h.process(state),/MANTENIMENT cambió durante la autorización/);
 assert.equal(injected,true);
 assert.equal(h.world.documentLockHeld,false);
 assert.equal(Object.keys(h.properties).some(k=>k.startsWith('METROGESTION_ORDEN_V1:')),false);
 assert.equal(h.events.filter(e=>e.kind==='sheet').length,0);
});

test('no automatic replay of uncertain execution after partial Sheet write',()=>{
 const {h,state}=setup();
 h.fault(e=>e.kind==='sheet'&&e.method==='insertRowAfter',
   {timing:'after',error:new Error('synthetic insert interrupted')});
 assert.throws(()=>h.process(state),/Resultado incierto/);
 assert.equal(h.world.documentLockHeld,false);
 const records=Object.entries(h.properties).filter(([k])=>k.startsWith('METROGESTION_ORDEN_V1:'));
 assert.equal(records.length,1);
 assert.equal(JSON.parse(records[0][1]).estado,'incierto');
});
