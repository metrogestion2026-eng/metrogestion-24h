import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  auditarAdmisionFuturaSincro11,
  SINCRO11_ADMISION_DOMINIO,
  __admisionTestCanon,
} from '../shared/sincro11-admision-eventos-futuros.mjs';
const D=SINCRO11_ADMISION_DOMINIO;
const SHEET='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const NOW='2026-11-17T10:30:00.000Z';
const OBS='2026-11-17T10:00:00.000Z';
const CONF='2026-11-17T10:05:00.000Z';
const LECT='2026-11-17T10:10:00.000Z';
const VALOR=v=>createHash('sha256').update(__admisionTestCanon({tipo:'VALOR_CANONICO',valor:v})).digest('hex');
const DIGEST=p=>createHash('sha256').update(__admisionTestCanon(p)).digest('hex');
const UUID=()=>randomUUID();

function setup(){
  const a=generateKeyPairSync('ed25519'), b=generateKeyPairSync('ed25519');
  const keys={capture:a,server:b};
  const registroClaves={
    captura:{kid:'capturador-lab-v1',pem:a.publicKey.export({type:'spki',format:'pem'})},
    servidor:{kid:'servidor-lab-v1',pem:b.publicKey.export({type:'spki',format:'pem'})},
  };
  function firmado(payload){
    const origin=payload.tipo==='CAPTURA'||payload.tipo==='LECTURA'?'capture':'server';
    return {kid:origin==='capture'?'capturador-lab-v1':'servidor-lab-v1',payload,
      firma:sign(null,Buffer.from(__admisionTestCanon(payload)),keys[origin].privateKey).toString('base64url')};
  }
  function bundle({id=90001,campo='J',clase_fila='TRABAJO',significado='fecha_realizada',base='ANTERIOR',nuevo='NUEVO'}={}){
    const eid=UUID();
    const cap={dominio:D,tipo:'CAPTURA',evento_id:eid,spreadsheet_id:SHEET,id_fila:id,campo,
      revision_anterior:3,revision_nueva:4,hash_anterior:VALOR(base),hash_nuevo:VALOR(nuevo),
      operacion:'ASIGNAR',observado_en:OBS,origen:'OBSERVACION_DE_HOJA'};
    const confirm={dominio:D,tipo:'CONFIRMACION',evento_id:eid,huella_captura:DIGEST(cap),
      actor_id:UUID(),sesion_id:UUID(),dispositivo_id:UUID(),aal:'aal2',
      permiso:'MANTENIMENT_CONFIRMAR_CORRECCION',accion:'CONFIRMACION_EXPLICITA',
      confirmado_en:CONF,nonce:UUID()};
    const link={dominio:D,tipo:'VINCULO',evento_id:eid,spreadsheet_id:SHEET,id_fila:id,campo,
      objeto_id:UUID(),clase_fila,significado,revision_vinculo:3,revision_destino:7,
      hash_destino:VALOR(base),origen_vinculo:'REGISTRO_T_CANONICO',atestiguado_en:OBS};
    const read={dominio:D,tipo:'LECTURA',evento_id:eid,spreadsheet_id:SHEET,id_fila:id,campo,
      revision_lectura:4,hash_vigente:VALOR(nuevo),leido_en:LECT};
    return {cap:firmado(cap),confirm:firmado(confirm),link:firmado(link),read:firmado(read)};
  }
  const f=bundle();
  const input=({caps=[f.cap],confs=[f.confirm],links=[f.link],reads=[f.read],now=NOW,
    consumed=[],excluded=[]}={})=>({observadoEn:now,registroClaves,capturas:caps,confirmaciones:confs,
    vinculos:links,lecturas:reads,consumidos:consumed,identidadesExcluidas:excluded});
  function replace(which,patch,entry=f){return firmado({...entry[which].payload,...patch});}
  const call=args=>auditarAdmisionFuturaSincro11(args??input());
  return {f,input,call,replace,firmado,bundle,registroClaves,keys};
}
const output=(r,reason='COTEJO_SOLO_LABORATORIO')=>{
 assert.equal(r.autoriza_sincronizar,false);assert.equal(r.escritura_en_manteniment,false);
 assert.equal(r.escritura_en_tancament,false);assert.equal(r.escritura_en_backend,false);
 assert.equal(r.humano_real_acreditado,false);assert.equal(r.sesion_real_verificada,false);
 assert.equal(r.vinculos_reales_acreditados,false);assert.equal(r.expone_valores_privados,false);
 assert.equal(r.crea_T,undefined); // no hay creador oculto: únicamente parámetros descritos
 assert.equal(r.detalles[0]?.motivo,reason);
};

test('cotejo completo con cuatro firmas: SOLO candidato de laboratorio',()=>{
 const h=setup(), r=h.call();output(r);assert.equal(r.candidatos_laboratorio,1);assert.equal(r.retenidos,0);
 assert.equal(r.detalles[0].id_fila,90001);assert.equal(r.detalles[0].resultado,'CANDIDATO_DE_COTEJO_NO_AUTORIZADO');
});
test('ningún evento: ninguna T ni escritura',()=>{
 const h=setup(),r=h.call(h.input({caps:[],confs:[],links:[],reads:[]}));
 assert.equal(r.total,0);assert.equal(r.candidatos_laboratorio,0);assert.equal(r.autoriza_sincronizar,false);
});
test('onEdit observado sin confirmación externa NO demuestra humano',()=>{
 const h=setup(),r=h.call(h.input({confs:[]}));output(r,'SIN_CONFIRMACION_INDEPENDIENTE');
});
test('evento provocado por onEdit sin revisión persistente se retiene',()=>{
 const h=setup(),cap=h.replace('cap',{origen:'ON_EDIT'});
 const r=h.call(h.input({caps:[cap]}));output(r,'ORIGEN_AUTOMATICO_O_NO_ACREDITADO');
});
test('el origen API automático o importación nunca se convierte en manual',()=>{
 for(const origin of ['API_AUTOMATICA','IMPORTACION','RECALCULO','BARRIDO_F2']){
  const h=setup(),cap=h.replace('cap',{origen:origin});output(h.call(h.input({caps:[cap]})),'ORIGEN_AUTOMATICO_O_NO_ACREDITADO');
 }
});
test('firma de captura alterada se rechaza criptográficamente',()=>{
 const h=setup(),cap=structuredClone(h.f.cap);cap.payload.campo='K';
 assert.throws(()=>h.call(h.input({caps:[cap]})),/firma criptográfica inválida/);
});
test('firma de confirmación alterada no se acepta',()=>{
 const h=setup(),confirm=structuredClone(h.f.confirm);confirm.payload.aal='aal1';
 assert.throws(()=>h.call(h.input({confs:[confirm]})),/firma criptográfica inválida/);
});
test('firma de vínculo alterada no se acepta',()=>{
 const h=setup(),link=structuredClone(h.f.link);link.payload.objeto_id=UUID();
 assert.throws(()=>h.call(h.input({links:[link]})),/firma criptográfica inválida/);
});
test('firma de lectura actual alterada no se acepta',()=>{
 const h=setup(),read=structuredClone(h.f.read);read.payload.hash_vigente=VALOR('ACTUAL');
 assert.throws(()=>h.call(h.input({reads:[read]})),/firma criptográfica inválida/);
});
test('el atacante no puede sustituir clave pública confiable en el sobre',()=>{
 const h=setup(),rogue=generateKeyPairSync('ed25519');
 const cap={kid:'capturador-lab-v1',payload:h.f.cap.payload,firma:sign(null,Buffer.from(__admisionTestCanon(h.f.cap.payload)),rogue.privateKey).toString('base64url')};
 assert.throws(()=>h.call(h.input({caps:[cap]})),/firma criptográfica inválida/);
});
test('claves de emisor distintas son obligatorias',()=>{
 const h=setup(),input=h.input(); input.registroClaves={captura:h.registroClaves.captura,servidor:h.registroClaves.captura};
 assert.throws(()=>h.call(input),/compartir identidad/);
});
test('ninguna firma tipo captura puede suplantar al servidor',()=>{
 const h=setup(),p=h.f.confirm.payload;
 const forged={kid:'capturador-lab-v1',payload:p,firma:sign(null,Buffer.from(__admisionTestCanon(p)),h.keys.capture.privateKey).toString('base64url')};
 assert.throws(()=>h.call(h.input({confs:[forged]})),/emisor no está/);
});
test('campos extra en prueba firmada quedan rechazados',()=>{
 const h=setup(),cap=h.replace('cap',{uuid_notas:'NO_DEBE_PROBAR_IDENTIDAD'});
 assert.throws(()=>h.call(h.input({caps:[cap]})),/campos de payload/);
});
test('firma sin sobre se rechaza',()=>{
 const h=setup(),cap={...h.f.cap};delete cap.firma;
 assert.throws(()=>h.call(h.input({caps:[cap]})),/sobre sin firma/);
});
test('identidad T vacía o inválida se retiene, no se empareja por PA',()=>{
 for(const id of [0,-1,1.5,'0001','PA-1',null]){
  const h=setup(),cap=h.replace('cap',{id_fila:id});output(h.call(h.input({caps:[cap]})),'IDENTIDAD_T_O_CAMPO_INVALIDO');
 }
});
test('la propia columna T no se corrige por esta vía',()=>{
 const h=setup(),cap=h.replace('cap',{campo:'T'});output(h.call(h.input({caps:[cap]})),'IDENTIDAD_T_O_CAMPO_INVALIDO');
});
test('libro incorrecto no habilita T',()=>{
 const h=setup(),cap=h.replace('cap',{spreadsheet_id:'FALSO'});output(h.call(h.input({caps:[cap]})),'ORIGEN_HOJA_NO_ACREDITADO');
});
test('T excluida por operador se retiene aunque las cuatro firmas encajen',()=>{
 const h=setup(),r=h.call(h.input({excluded:[90001]}));output(r,'T_EXCLUIDA_POR_OPERADOR');
});
test('evento ya consumido se retiene sin segundo ACK',()=>{
 const h=setup(),r=h.call(h.input({consumed:[h.f.cap.payload.evento_id]}));output(r,'EVENTO_YA_CONSUMIDO');
});
test('revisión no consecutiva no se toma como captura completa',()=>{
 const h=setup(),cap=h.replace('cap',{revision_nueva:6});output(h.call(h.input({caps:[cap]})),'REVISIONES_DE_CAPTURA_NO_CONSECUTIVAS');
});
test('hash anterior idéntico al nuevo no es cambio',()=>{
 const h=setup(),cap=h.replace('cap',{hash_nuevo:h.f.cap.payload.hash_anterior});output(h.call(h.input({caps:[cap]})),'SIN_DIFERENCIA_ACREDITABLE');
});
test('timestamp de evento anterior al corte no se rejuvenece al leer',()=>{
 const h=setup(),cap=h.replace('cap',{observado_en:'2026-11-15T22:59:59.000Z'});
 output(h.call(h.input({caps:[cap]})),'NO_SE_DEMUESTRA_EVENTO_POSTERIOR_CORTE');
});
test('fecha de trabajo antigua no entra en algoritmo, sólo evento posterior al corte',()=>{
 const h=setup(), r=h.call();output(r);
 assert.equal(r.detalles[0].id_fila,90001);
});
test('evento futuro con reloj imposible no se acepta',()=>{
 const h=setup(),cap=h.replace('cap',{observado_en:'2026-11-17T11:00:00.000Z'});
 output(h.call(h.input({caps:[cap]})),'NO_SE_DEMUESTRA_EVENTO_POSTERIOR_CORTE');
});
test('AAL1 o sesión sin permiso no acreditan la acción explícita',()=>{
 for(const patch of [{aal:'aal1'},{permiso:'CONSULTAR'},{accion:'SILENCIOSA'}]){
  const h=setup(),conf=h.replace('confirm',patch);output(h.call(h.input({confs:[conf]})),'CONFIRMACION_SIN_SEGURIDAD_SUFICIENTE');
 }
});
test('actor, sesión y dispositivo firmados con identidad inválida se retienen',()=>{
 for(const field of ['actor_id','sesion_id','dispositivo_id']){
  const h=setup(),conf=h.replace('confirm',{[field]:'fake'});output(h.call(h.input({confs:[conf]})),'CONFIRMACION_NO_VINCULADA_AL_CAMBIO');
 }
});
test('confirmación no ligada al hash exacto de captura se retiene',()=>{
 const h=setup(),conf=h.replace('confirm',{huella_captura:'a'.repeat(64)});
 output(h.call(h.input({confs:[conf]})),'CONFIRMACION_NO_VINCULADA_AL_CAMBIO');
});
test('confirmación anterior a observación no sirve como consentimiento',()=>{
 const h=setup(),conf=h.replace('confirm',{confirmado_en:'2026-11-17T09:59:59.000Z'});
 output(h.call(h.input({confs:[conf]})),'CONFIRMACION_FUERA_DE_PERIODO');
});
test('ausencia de vínculo T-objeto, aunque haya nota UUID, se retiene',()=>{
 const h=setup(),r=h.call(h.input({links:[]}));output(r,'SIN_VINCULO_CANONICO_T_OBJETO');
});
test('vínculo con otra T se retiene sin buscar por DFM, PA ni posición',()=>{
 const h=setup(),link=h.replace('link',{id_fila:90002});output(h.call(h.input({links:[link]})),'VINCULO_T_OBJETO_NO_ACREDITADO');
});
test('vínculo basado en coincidencia textual de nota no es canónico',()=>{
 const h=setup(),link=h.replace('link',{origen_vinculo:'COINCIDENCIA_H_UUID_NOTA'});
 output(h.call(h.input({links:[link]})),'VINCULO_T_OBJETO_NO_ACREDITADO');
});
test('trabajo con tipo y significado no correspondientes se retiene',()=>{
 for(const patch of [{clase_fila:'TANCAMENT',significado:'fecha_inicio_tramo'},{clase_fila:'TRABAJO',significado:'fecha_entrada_tramo'}]){
  const h=setup(),link=h.replace('link',patch);output(h.call(h.input({links:[link]})),'CAMPO_Y_CLASE_SIN_MAPEO');
 }
});
test('sin revisión de destino no hay cotejo CAS preparado',()=>{
 const h=setup(),link=h.replace('link',{revision_destino:0});output(h.call(h.input({links:[link]})),'VINCULO_T_OBJETO_NO_ACREDITADO');
});
test('sin lectura vigente posterior a confirmación no se atribuye cambio',()=>{
 const h=setup(),r=h.call(h.input({reads:[]}));output(r,'SIN_LECTURA_VIGENTE_DE_CELDA');
});
test('la celda fue modificada otra vez: se retiene el cambio anterior',()=>{
 const h=setup(),read=h.replace('read',{hash_vigente:VALOR('TERCERA_EDICION')});
 output(h.call(h.input({reads:[read]})),'LECTURA_NO_COINCIDE_CON_CAMBIO');
});
test('lectura con revisión anterior a captura se retiene',()=>{
 const h=setup(),read=h.replace('read',{revision_lectura:3});
 output(h.call(h.input({reads:[read]})),'LECTURA_NO_COINCIDE_CON_CAMBIO');
});
test('lectura anterior a la confirmación se retiene aunque hash coincida',()=>{
 const h=setup(),read=h.replace('read',{leido_en:OBS});
 output(h.call(h.input({reads:[read]})),'LECTURA_NO_POSTERIOR_A_CONFIRMACION');
});
test('si el campo destino ya coincide, no se lanza escritura',()=>{
 const h=setup(),link=h.replace('link',{hash_destino:h.f.cap.payload.hash_nuevo});
 output(h.call(h.input({links:[link]})),'DESTINO_YA_COINCIDE');
});
test('BORRAR exige operación explícita y hash de celda vacía',()=>{
 const h=setup(),cap=h.replace('cap',{operacion:'BORRAR'});
 output(h.call(h.input({caps:[cap]})),'BORRADO_SIN_HUELLA_VACIA');
});
test('BORRAR explícito de dato existente puede ser candidato sin valor expuesto',()=>{
 const h=setup(),bundle=h.bundle({nuevo:''});const cap=h.replace('cap',{operacion:'BORRAR'},bundle),conf=h.replace('confirm',{huella_captura:DIGEST(cap.payload)},bundle);
 const r=h.call(h.input({caps:[cap],confs:[conf],links:[bundle.link],reads:[bundle.read]}));
 output(r);assert.equal(JSON.stringify(r).includes('ANTERIOR'),false);
});
test('campo omitido o acción no declarada no es una orden de borrado',()=>{
 const h=setup(),cap=h.replace('cap',{operacion:'OMITIR'});output(h.call(h.input({caps:[cap]})),'OPERACION_NO_EXPLICITA');
});
test('dos capturas para mismo evento quedan retenidas, no gana la última',()=>{
 const h=setup(),cap2=h.replace('cap',{revision_nueva:5});
 output(h.call(h.input({caps:[h.f.cap,cap2]})),'EVIDENCIA_DUPLICADA_O_AMBIGUA');
});
test('dos vínculos diferentes para mismo evento se retienen',()=>{
 const h=setup(),link2=h.replace('link',{objeto_id:UUID()});
 output(h.call(h.input({links:[h.f.link,link2]})),'EVIDENCIA_DUPLICADA_O_AMBIGUA');
});
test('doble confirmación con nonce duplicado se retiene',()=>{
 const h=setup(),conf2=h.replace('confirm',{actor_id:UUID()});
 output(h.call(h.input({confs:[h.f.confirm,conf2]})),'EVIDENCIA_DUPLICADA_O_AMBIGUA');
});
test('dos eventos distintos que reutilizan nonce no pasan',()=>{
 const h=setup(),other=h.bundle({id:90002,campo:'K',significado:'fecha_recogida'});
 const otherConfirm=h.replace('confirm',{nonce:h.f.confirm.payload.nonce},other);
 const r=h.call(h.input({caps:[h.f.cap,other.cap],confs:[h.f.confirm,otherConfirm],links:[h.f.link,other.link],reads:[h.f.read,other.read]}));
 assert.equal(r.total,2);assert.equal(r.candidatos_laboratorio,0);
 assert.ok(r.detalles.every(x=>x.motivo==='NONCE_AUSENTE_O_DUPLICADO'));
});
test('J y K de una misma T se cotejan independientemente sin sobrescritura',()=>{
 const h=setup(),other=h.bundle({id:90001,campo:'K',significado:'fecha_recogida'});
 const r=h.call(h.input({caps:[h.f.cap,other.cap],confs:[h.f.confirm,other.confirm],links:[h.f.link,other.link],reads:[h.f.read,other.read]}));
 assert.equal(r.total,2);assert.equal(r.candidatos_laboratorio,2);assert.equal(r.autoriza_sincronizar,false);
 assert.deepEqual(r.detalles.map(x=>x.campo),['J','K']);
});
test('orden físico o número de PA no son campos exigidos, tampoco identidades',()=>{
 const h=setup(), r=h.call();output(r);
 assert.ok(!JSON.stringify(r).includes('numero_fila'));
 assert.ok(!JSON.stringify(r).includes('numero_parada'));
});
test('un lote de 101 eventos marca vista parcial pero mantiene conteos completos',()=>{
 const h=setup(),f=[];for(let i=0;i<101;i++){f.push(h.bundle({id:i+1}));}
 const r=h.call(h.input({caps:f.map(x=>x.cap),confs:[],links:[],reads:[]}));
 assert.equal(r.total,101);assert.equal(r.retenidos,101);assert.equal(r.detalles.length,100);assert.equal(r.lista_parcial,true);
});
test('capacidad máxima cerrada antes de validaciones externas',()=>{
 const h=setup(),tooMany=Array(10001).fill(h.f.cap);
 assert.throws(()=>h.call(h.input({caps:tooMany})),/lote capturas/);
});
test('hora de observación fuera del corte se rechaza',()=>{
 const h=setup();assert.throws(()=>h.call(h.input({now:'2026-11-15T22:59:59.999Z'})),/observación antes del corte/);
});
test('registro de claves ilegible no permite fallar abierto',()=>{
 const h=setup(),input=h.input();input.registroClaves={};
 assert.throws(()=>h.call(input),/clave captura ausente/);
});
test('el módulo no contiene red, Google ni comandos de escritura en hojas',()=>{
 const s=readFileSync(new URL('../shared/sincro11-admision-eventos-futuros.mjs',import.meta.url),'utf8');
 for(const rx of [/SpreadsheetApp\./,/UrlFetchApp\./,/createTrigger\(/,/fetch\(/,/setValues\(/,/DELETE FROM /,/UPDATE /,/INSERT INTO /,/service_role/i])assert.doesNotMatch(s,rx);
});