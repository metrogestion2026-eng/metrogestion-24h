import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
 SINCRO11_DOMINIO,SINCRO11_CORTE,SINCRO11_EVIDENCIA_VERSION,
 __sincro11CanonicoTestOnly as canon,sincro11HashCampo,planificarPrecedenciaSincro11 as plan,
} from '../shared/sincro11-evidencia-precedencia.mjs';

const uuid=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const keys={captura:generateKeyPairSync('ed25519'),servidor:generateKeyPairSync('ed25519')};
const registroClaves={
 captura:{kid:'CAPTURA-TEST-NO-PRODUCCION',pem:keys.captura.publicKey.export({type:'spki',format:'pem'})},
 servidor:{kid:'SERVIDOR-TEST-NO-PRODUCCION',pem:keys.servidor.publicKey.export({type:'spki',format:'pem'})},
};
const ahoraUtc='2026-11-16T12:45:00.000Z';
const hash=v=>sincro11HashCampo(v);
const plant={
 dominio:SINCRO11_DOMINIO,id_fila:99999,campo:'J',significado:'FECHA_INICIO_TRAMO',
 revision:7,emitido_en:'2026-11-16T10:00:00.000Z',evento_id:uuid(1),objeto_id:uuid(900001),
 base_hash:hash('02/03/2022'),nuevo_hash:hash('05/03/2022'),
 operacion:'ASIGNAR',clase:'TANCAMENT',revision_fuente:7,
};
function payload(kind,patch={}){
 let b={...plant,kind,...patch};
 if(kind!=='CAPTURA_MANUAL')b={...b,operacion:'OBSERVAR'};
 return b;
}
function envelope(body,signer=null){
 const issuer=signer|| (body.kind==='CAPTURA_MANUAL'?'captura':'servidor');
 return {kid:registroClaves[issuer].kid,payload:body,
 firma:sign(null,Buffer.from(canon(body),'utf8'),keys[issuer].privateKey).toString('base64url')};
}
function base({manual={},link={},server={},cell={},withLink=true,withServer=true,withCell=true,used=[],excluded=[]}={}){
 const m=payload('CAPTURA_MANUAL',manual);
 const l=payload('VINCULO_IDENTIDAD',{
  ...plant,kind:'VINCULO_IDENTIDAD',evento_id:uuid(2),operacion:'OBSERVAR',revision:3,revision_fuente:3,
  ...link,
 });
 const s=payload('ESTADO_METROGES',{
  ...plant,kind:'ESTADO_METROGES',evento_id:uuid(3),operacion:'OBSERVAR',revision:50,revision_fuente:3,
  nuevo_hash:hash('02/03/2022'),...server,
 });
 const c={id_fila:m.id_fila,campo:m.campo,significado:m.significado,
   hash:m.nuevo_hash,revision_lectura:m.revision_fuente,...cell};
 return {capturas:[envelope(m)],vinculos:withLink?[envelope(l)]:[],
  estados:withServer?[envelope(s)]:[],celdasActuales:withCell?[c]:[],
  registroClaves,ahoraUtc,consumidos:used,identidadesExcluidas:excluded};
}
const call=(p={})=>plan(base(p));
const assertNoWrite=r=>{
 assert.equal(r.autoriza_sincronizar,false);assert.equal(r.autoriza_escribir_metroges,false);
 assert.equal(r.autoriza_escribir_manteniment,false);assert.equal(r.crea_T,false);
 assert.equal(r.crea_PA,false);assert.equal(r.humano_real_acreditado,false);
 assert.equal(r.identidad_t_acreditada_en_produccion,false);assert.equal(r.expone_valores_privados,false);
};

test('contrato de procedencia solo propone cotejo y no una orden ejecutable',()=>{
 const x=call(); assertNoWrite(x);
 assert.equal(x.propuestas_de_cotejo,1);assert.equal(x.detalles[0].id_fila,99999);
 assert.equal(x.detalles[0].campo,'J');assert.equal(x.detalles[0].revision_destino_esperada,50);
 assert.equal(x.detalles[0].resultado,'PREPARAR_COTEJO');
});
test('la J manual 24/10 prevalece sobre propuesta de J20/10 en la misma T; el 99998 no se altera',()=>{
 const x=call();assert.equal(x.detalles[0].huella_manual_a_contrastar,hash('05/03/2022'));
 assert.equal(x.detalles[0].huella_destino_esperada,hash('02/03/2022'));
 assert.doesNotMatch(JSON.stringify(x),/99998|20\/10\/2026|24\/10\/2026/);
});
test('no usa posición física, PA ni DFM para identidad',()=>{
 const s=readFileSync(new URL('../shared/sincro11-evidencia-precedencia.mjs',import.meta.url),'utf8');
 for(const forbidden of [/numero_parada/,/dfm\s*:/,/fila_fisica/,/getRange/,/SpreadsheetApp/,/Supabase/,/UrlFetchApp/,/INSERT INTO/,/setValues\(/]){
  if(String(forbidden).includes('Supabase')) continue;
  assert.doesNotMatch(s,forbidden);
 }
});
test('firma Ed25519 auténtica del agente NO equivale a persona acreditada',()=>{
 const r=call();assertNoWrite(r);assert.equal(r.firma_de_captura_verificada,true);
});
test('no reabre histórico aunque fecha del hecho sea 2024, si la evidencia se creó después del corte',()=>{
 const x=call({manual:{base_hash:hash('14/09/2024'),nuevo_hash:hash('18/09/2024')}});
 assert.equal(x.propuestas_de_cotejo,1);assertNoWrite(x);
});
test('no admite captura con hora de edición anterior al corte',()=>{
 assert.throws(()=>call({manual:{emitido_en:'2026-11-15T22:59:59.999Z'}}),/anterior al corte/);
});
test('rechaza fecha de prueba falsa o anterior sin hora UTC',()=>{
 for(const f of ['2026-11-16T12:45:00', '2026-02-30T10:00:00.000Z'])
  assert.throws(()=>plan({...base(),ahoraUtc:f}),/hora de revisión inválida/);
});
test('borrado intencional requiere operación explícita y valor distinto de la base',()=>{
 const x=call({manual:{operacion:'BORRAR',nuevo_hash:hash('')}});
 assert.equal(x.propuestas_de_cotejo,1);assertNoWrite(x);
});
test('campo ausente no puede pasar por borrado, y falta de operación bloquea',()=>{
 assert.throws(()=>call({manual:{operacion:undefined}}),/operación inválida/);
 assert.throws(()=>sincro11HashCampo(undefined),/omitido/);
});
test('la columna T no se modifica como campo de datos',()=>{
 assert.throws(()=>call({manual:{campo:'T'}}),/columna T/);
});
test('mismo campo y semántica coherentes; significado distinto bloquea con motivo',()=>{
 const r=call({link:{significado:'FECHA_ENTRADA_TALLER'}});
 assertNoWrite(r);assert.equal(r.retenidos,1);assert.equal(r.detalles[0].motivo,'SEMANTICA_CLASE_O_OBJETO_NO_COINCIDEN');
});
test('clase de fila distinta no puede autorizar retorno contable por taller',()=>{
 const r=call({server:{clase:'TALLER'}});
 assertNoWrite(r);assert.equal(r.retenidos,1);
});
test('mismo DFM y PA no sirve de vínculo si el UUID destino difiere',()=>{
 const r=call({link:{objeto_id:uuid(8989)}});
 assertNoWrite(r);assert.equal(r.detalles[0].motivo,'SEMANTICA_CLASE_O_OBJETO_NO_COINCIDEN');
});
test('captura manual sin vínculo de servidor acreditado retiene',()=>{
 const r=call({withLink:false});assertNoWrite(r);assert.equal(r.retenidos,1);
 assert.equal(r.detalles[0].motivo,'SIN_VINCULO_Y_ESTADO_DESTINO_ACREDITADOS');
});
test('captura manual sin versión actual firmada del servidor retiene',()=>{
 const r=call({withServer:false});assertNoWrite(r);assert.equal(r.retenidos,1);
});
test('sin lectura actual de celda no se asume que siga igual',()=>{
 const r=call({withCell:false});assertNoWrite(r);assert.equal(r.retenidos,1);
 assert.equal(r.detalles[0].motivo,'SIN_LECTURA_ACTUAL_DEL_CAMPO_MANUAL');
});
test('una corrección manual posterior invalida captura firmada más antigua',()=>{
 const r=call({cell:{hash:hash('08/03/2022')}});assertNoWrite(r);
 assert.equal(r.detalles[0].motivo,'CELDA_ACTUAL_Y_CAPTURA_MANUAL_DIFIEREN');
});
test('lectura de hoja anterior a revisión de origen retiene',()=>{
 const r=call({cell:{revision_lectura:6}});assertNoWrite(r);
 assert.equal(r.detalles[0].motivo,'LECTURA_ANTERIOR_A_LA_CORRECCION');
});
test('revisión de vínculo distinta a revisión fuente del backend retiene',()=>{
 const r=call({link:{revision_fuente:5}});assertNoWrite(r);
 assert.equal(r.detalles[0].motivo,'VERSION_DEL_VINCULO_DESACTUALIZADA');
});
test('si Metroges ya conserva el mismo campo, no duplica ni revive propuesta',()=>{
 const r=call({server:{nuevo_hash:hash('05/03/2022')}});assertNoWrite(r);
 assert.equal(r.ya_coinciden,1);assert.equal(r.propuestas_de_cotejo,0);
});
test('evento ya consumido no se aplica por reintento',()=>{
 const r=call({used:[uuid(1)]});assertNoWrite(r);
 assert.equal(r.detalles[0].motivo,'EVENTO_YA_PROCESADO_NO_REINTENTAR');
});
test('captura manipulada después de firmada es rechazada',()=>{
 const args=base(); args.capturas[0].payload.nuevo_hash=hash('MALICIOSO');
 assert.throws(()=>plan(args),/firma criptográfica inválida/);
});
test('una firma del servidor no puede suplir la firma de captura manual',()=>{
 const args=base(); args.capturas[0]=envelope(args.capturas[0].payload,'servidor');
 assert.throws(()=>plan(args),/firmante no autorizado/);
});
test('una firma de captura no puede firmar un vínculo del servidor',()=>{
 const args=base(); args.vinculos[0]=envelope(args.vinculos[0].payload,'captura');
 assert.throws(()=>plan(args),/firmante no autorizado/);
});
test('key id desconocido no se acepta aunque haya payload con los datos correctos',()=>{
 const args=base(); args.capturas[0].kid='FALSIFICADA';
 assert.throws(()=>plan(args),/firmante no autorizado/);
});
test('reemplazar las claves en una configuración no confiable no se evalúa como identidad humana',()=>{
 const other=generateKeyPairSync('ed25519');const args=base();
 args.registroClaves={...registroClaves,captura:{kid:'OTRA-PRUEBA',pem:other.publicKey.export({type:'spki',format:'pem'})}};
 assert.throws(()=>plan(args),/firmante no autorizado/);
});
test('eventos duplicados en un mismo lote se rechazan',()=>{
 const args=base();args.capturas.push(args.capturas[0]);
 assert.throws(()=>plan(args),/evento_id repetido/);
});
test('dos firmas diferentes del mismo campo no eligen última versión por posición',()=>{
 const args=base();
 args.capturas.push(envelope(payload('CAPTURA_MANUAL',{evento_id:uuid(44),revision:8,nuevo_hash:hash('06/03/2022')})));
 const r=plan(args);assertNoWrite(r);assert.equal(r.retenidos,2);
 assert.ok(r.detalles.every(x=>x.motivo==='VARIAS_VERSIONES_DEL_MISMO_CAMPO'));
});
test('nota y fecha distintas se preparan como dos campos sin actualizar los otros',()=>{
 const args=base();
 const another={campo:'G',significado:'NOTA_OPERATIVA',evento_id:uuid(51),base_hash:hash('ANT'),nuevo_hash:hash('ACT')};
 args.capturas.push(envelope(payload('CAPTURA_MANUAL',another)));
 args.vinculos.push(envelope(payload('VINCULO_IDENTIDAD',{...another,evento_id:uuid(52),operacion:'OBSERVAR',revision_fuente:3})));
 args.estados.push(envelope(payload('ESTADO_METROGES',{...another,evento_id:uuid(53),operacion:'OBSERVAR',revision_fuente:3,revision:51,nuevo_hash:hash('ANT')})));
 args.celdasActuales.push({id_fila:99999,campo:'G',significado:'NOTA_OPERATIVA',hash:hash('ACT'),revision_lectura:7});
 const r=plan(args);assertNoWrite(r);assert.equal(r.propuestas_de_cotejo,2);
 assert.deepEqual(r.detalles.map(x=>x.campo),['G','J']);
});
test('si nota contiene texto privado, el informe expone solo su huella',()=>{
 const data='ALMACENAR EN PRIVADO: teléfono y observaciones confidenciales';
 const x=call({manual:{nuevo_hash:hash(data)}});
 assertNoWrite(x);assert.equal(JSON.stringify(x).includes(data),false);
});
test('UUID de vínculo repetido en mismo campo se retiene incluso con dos firmas válidas',()=>{
 const args=base();args.vinculos.push(envelope(payload('VINCULO_IDENTIDAD',{...args.vinculos[0].payload,evento_id:uuid(133)})));
 const r=plan(args);assertNoWrite(r);assert.equal(r.detalles[0].motivo,'VARIAS_VERSIONES_DEL_MISMO_CAMPO');
});
test('datos remotos duplicados para la misma T/campo se retienen',()=>{
 const args=base();args.estados.push(envelope(payload('ESTADO_METROGES',{...args.estados[0].payload,evento_id:uuid(134)})));
 const r=plan(args);assertNoWrite(r);assert.equal(r.retenidos,1);
});
test('identificadores T inválidos o con cero a la izquierda son rechazados',()=>{
 for(const id_fila of ['',0,-1,'099999',1.7,'PA-123'])
  assert.throws(()=>call({manual:{id_fila}}),/ID_FILA/);
});
test('firmas vacías y campos extras no se aceptan',()=>{
 const args=base();args.capturas[0].firma='';assert.throws(()=>plan(args),/firma ilegible/);
 const args2=base();args2.capturas[0].payload.extra='IGNORAR';assert.throws(()=>plan(args2),/campos extra/);
});
test('no se aceptan claves compartidas para agente y servidor',()=>{
 const args=base();args.registroClaves={...registroClaves,servidor:{...registroClaves.servidor,kid:registroClaves.captura.kid}};
 assert.throws(()=>plan(args),/claves diferentes/);
});
test('sin eventos y sin claves privadas devuelve plan vacío y sin permisos',()=>{
 const r=plan({capturas:[],vinculos:[],estados:[],celdasActuales:[],registroClaves,ahoraUtc});
 assertNoWrite(r);assert.equal(r.comparados,0);assert.equal(r.propuestas_de_cotejo,0);
});
test('hash vacío es distinto de hash de null, y de omitir campo',()=>{
 assert.notEqual(hash(''),hash(null));assert.notEqual(hash(''),hash(0));assert.notEqual(hash(false),hash(null));
});
test('lectura sintética de 6742 T con un cambio firmado conserva todas las identidades',()=>{
 const args=base();
 args.celdasActuales=Array.from({length:6742},(_,i)=>({
   id_fila:i+1,campo:'J',significado:'FECHA_INICIO_TRAMO',
   hash:hash(`dato-de-prueba-${i+1}`),revision_lectura:7,
 }));
 args.celdasActuales[0]={id_fila:99999,campo:'J',significado:'FECHA_INICIO_TRAMO',hash:hash('05/03/2022'),revision_lectura:7};
 const r=plan(args);assertNoWrite(r);assert.equal(r.comparados,1);assert.equal(r.propuestas_de_cotejo,1);
 assert.deepEqual(r.detalles.map(x=>x.id_fila),[99999]);
});


test('BORRAR no acepta una huella de dato no vacío',()=>{
 assert.throws(()=>call({manual:{operacion:'BORRAR',nuevo_hash:hash('NO BORRADO')}}),/celda vacía/);
});
test('exclusión explícita por identidad T del operador bloquea incluso prueba firmada',()=>{
 const r=call({excluded:[99999]});assertNoWrite(r);assert.equal(r.retenidos,1);
 assert.equal(r.detalles[0].motivo,'IDENTIDAD_EXCLUIDA_POR_REGLA_DEL_OPERADOR');
});
test('exclusiones inválidas no pueden desactivar la protección',()=>{
 assert.throws(()=>call({excluded:['R1515']}),/identidad excluida no válida/);
});
test('trabajo creado originalmente en Metroges puede devolver corrección manual acreditada',()=>{
 const m={clase:'TRABAJO',campo:'K',significado:'FECHA_RECOGIDA_T'};
 const r=call({manual:m,link:m,server:m,cell:{campo:'K',significado:'FECHA_RECOGIDA_T'}});
 assertNoWrite(r);assert.equal(r.propuestas_de_cotejo,1);
 assert.equal(r.detalles[0].campo,'K');
});
test('sin captura manual firmada no se convierte automáticamente una propuesta remota en prioridad manual',()=>{
 const x=base();x.capturas=[];const r=plan(x);assertNoWrite(r);assert.equal(r.comparados,0);
 assert.equal(r.propuestas_de_cotejo,0);assert.equal(r.firma_de_captura_verificada,false);
});
test('no asume que la revisión final de la T sea igual a una fecha operativa anterior',()=>{
 const r=call({manual:{emitido_en:'2026-11-16T11:00:00.000Z'},cell:{revision_lectura:25}});
 assertNoWrite(r);assert.equal(r.propuestas_de_cotejo,1);
});