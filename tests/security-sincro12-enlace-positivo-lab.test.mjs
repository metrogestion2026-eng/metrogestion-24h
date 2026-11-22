import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditarAltasPositivasSincro12 as auditar} from '../shared/sincro12-enlace-positivo-lab.mjs';

const hoja='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const fecha={
 ahora:'2026-11-17T11:00:00.000Z',
 inicio:'2026-11-17T09:00:00.000Z',
 acuse:'2026-11-17T09:01:00.000Z',
 lectura:'2026-11-17T09:02:00.000Z',
 destino:'2026-11-17T09:03:00.000Z'
};
const uuid=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const sha='a'.repeat(64);
const crear=(args={})=>{
 const numero=args.numero??90001,peticion=args.peticion??1,trabajo=args.trabajo??2,hotel=args.hotel??3;
 const idPeticion=uuid(peticion),idTrabajo=uuid(trabajo),idHotel=uuid(hotel);
 return {
  alta:{tipo:'NUEVO_TRABAJO_MANTENIMENT',request_id:idPeticion,objeto_sync_id:idTrabajo,
    trabajo_hotel_id:idHotel,revision_destino:3,hash_solicitud:sha,creado_en:fecha.inicio},
  acuse:{request_id:idPeticion,spreadsheet_id:hoja,id_fila:numero,objeto_sync_id:idTrabajo,
    tipo_fila:'TRABAJO',revision_hoja:1,hash_solicitud:sha,
    observado_en:fecha.acuse,origen:'ACK_HOJA_FICTICIO'},
  hoja:{spreadsheet_id:hoja,id_fila:numero,tipo_fila:'TRABAJO',revision_hoja:1,
    hash_solicitud:sha,leido_en:fecha.lectura,origen:'RELECTURA_HOJA_FICTICIA'},
  destino:{objeto_sync_id:idTrabajo,trabajo_hotel_id:idHotel,revision_destino:3,
    existe:true,leido_en:fecha.destino,origen:'RELECTURA_DESTINO_FICTICIA'}
 };
};
const evaluar=(v,options={})=>auditar({observado_en:fecha.ahora,altas:[v],...options});
const motivo=v=>v.detalles[0]?.motivo;
const siempreCerrar=r=>{
 assert.equal(r.autoriza_sincronizar,false);
 assert.equal(r.permite_crear_T,false);
 assert.equal(r.permite_crear_PA,false);
 assert.equal(r.humano_real_acreditado,false);
 assert.equal(r.vinculos_reales_acreditados,0);
 assert.equal(r.escribe_manteniment,false);
 assert.equal(r.escribe_tancament,false);
 assert.equal(r.escribe_supabase,false);
};
test('0 eventos: no se inventa relación T y no hay permiso',()=>{
 const r=auditar({observado_en:fecha.ahora});assert.equal(r.total,0);
 assert.equal(r.candidatos_de_laboratorio,0);siempreCerrar(r);
});
test('alta con cuatro pruebas coherentes solo produce CANDIDATO ficticio',()=>{
 const r=evaluar(crear());
 assert.equal(motivo(r),'ENLACE_TECNICO_FICTICIO_SOLO_CANDIDATO');
 assert.equal(r.detalles[0].id_fila,90001);
 assert.equal(r.detalles[0].estado,'CANDIDATO_SIN_ACREDITACION');siempreCerrar(r);
});
test('un objeto Hotel compartido por dos T distintas no fusiona sus identidades',()=>{
 const a=crear(),b=crear({numero:90002,peticion:9,trabajo:8,hotel:3});
 const r=auditar({observado_en:fecha.ahora,altas:[a,b]});
 assert.equal(r.total,2);assert.equal(r.candidatos_de_laboratorio,2);siempreCerrar(r);
 assert.deepEqual(r.detalles.map(x=>x.id_fila),[90001,90002]);
});
test('sin solicitud operativa no se deduce T por coincidencia',()=>{
 const v=crear();delete v.alta;
 assert.equal(motivo(evaluar(v)),'SIN_SOLICITUD_DE_ALTA');
});
test('un origen distinto de NUEVO_TRABAJO queda fuera',()=>{
 const v=crear();v.alta.tipo='CORRECCION_T_ANTIGUA';
 assert.equal(motivo(evaluar(v)),'SOLICITUD_ORIGEN_INVALIDO');
});
test('sin acuse de Google no se toma fila del servidor',()=>{
 const v=crear();delete v.acuse;
 assert.equal(motivo(evaluar(v)),'SIN_ACUSE_T_DE_HOJA');
});
test('sin relectura de hoja no se acepta un acuse solitario',()=>{
 const v=crear();delete v.hoja;
 assert.equal(motivo(evaluar(v)),'SIN_RELECTURA_VIGENTE_DE_T');
});
test('sin relectura de trabajo destino tampoco se acredita vínculo',()=>{
 const v=crear();delete v.destino;
 assert.equal(motivo(evaluar(v)),'SIN_RELECTURA_ACTUAL_DEL_DESTINO');
});
test('T física como A1 se rechaza',()=>{
 const v=crear();v.acuse.id_fila='T3488';
 assert.equal(motivo(evaluar(v)),'ACUSE_T_SIN_IDENTIDAD_CANONICA');
});
test('T=0 no es identidad',()=>{
 const v=crear();v.acuse.id_fila=0;
 assert.equal(motivo(evaluar(v)),'ACUSE_T_SIN_IDENTIDAD_CANONICA');
});
test('un libro diferente queda retenido',()=>{
 const v=crear();v.acuse.spreadsheet_id='otro';
 assert.equal(motivo(evaluar(v)),'ACUSE_T_SIN_IDENTIDAD_CANONICA');
});
test('clase PARADA no entra en contrato de TRABAJO',()=>{
 const v=crear();v.acuse.tipo_fila='PARADA';
 assert.equal(motivo(evaluar(v)),'ACUSE_T_SIN_IDENTIDAD_CANONICA');
});
test('no se sustituye solicitud por otra request_id',()=>{
 const v=crear();v.acuse.request_id=uuid(100);
 assert.equal(motivo(evaluar(v)),'ACUSE_T_NO_ES_LA_SOLICITUD');
});
test('no se sustituye trabajo por UUID de otro',()=>{
 const v=crear();v.acuse.objeto_sync_id=uuid(100);
 assert.equal(motivo(evaluar(v)),'ACUSE_T_NO_ES_LA_SOLICITUD');
});
test('payload de acuse cambiado retiene la relación',()=>{
 const v=crear();v.acuse.hash_solicitud='b'.repeat(64);
 assert.equal(motivo(evaluar(v)),'ACUSE_T_NO_ES_LA_SOLICITUD');
});
test('no se conserva T distinta en la relectura',()=>{
 const v=crear();v.hoja.id_fila=90002;
 assert.equal(motivo(evaluar(v)),'RELECTURA_HOJA_NO_COINCIDE');
});
test('no se puede retroceder revision en la relectura de hoja',()=>{
 const v=crear();v.acuse.revision_hoja=3;v.hoja.revision_hoja=2;
 assert.equal(motivo(evaluar(v)),'RELECTURA_HOJA_NO_COINCIDE');
});
test('una relectura anterior al acuse falla',()=>{
 const v=crear();v.hoja.leido_en='2026-11-17T08:59:00.000Z';
 assert.equal(motivo(evaluar(v)),'RELECTURA_HOJA_FUERA_DE_SECUENCIA');
});
test('fecha creación anterior al corte no se rejuvenece',()=>{
 const v=crear();v.alta.creado_en='2026-11-15T22:59:59.000Z';
 assert.equal(motivo(evaluar(v)),'SOLICITUD_NO_ACREDITA_MOVIMIENTO_FUTURO');
});
test('fecha creación de contenido histórica no reemplaza evento actual',()=>{
 const v=crear();v.alta.creado_en='2026-10-01T09:00:00.000Z';
 assert.equal(motivo(evaluar(v)),'SOLICITUD_NO_ACREDITA_MOVIMIENTO_FUTURO');
});
test('acuse antes de solicitud se retiene',()=>{
 const v=crear();v.acuse.observado_en='2026-11-17T08:59:00.000Z';
 assert.equal(motivo(evaluar(v)),'ACUSE_T_FUERA_DE_SECUENCIA');
});
test('el destino debe seguir existiendo',()=>{
 const v=crear();v.destino.existe=false;
 assert.equal(motivo(evaluar(v)),'DESTINO_NO_CORRESPONDE_AL_ALTA');
});
test('un segundo trabajo de Hotel no reemplaza al vinculado por solicitud',()=>{
 const v=crear();v.destino.trabajo_hotel_id=uuid(33);
 assert.equal(motivo(evaluar(v)),'DESTINO_NO_CORRESPONDE_AL_ALTA');
});
test('una revisión de destino anterior bloquea',()=>{
 const v=crear();v.destino.revision_destino=2;
 assert.equal(motivo(evaluar(v)),'DESTINO_NO_CORRESPONDE_AL_ALTA');
});
test('si el mismo request_id se duplica, ambos registros quedan bloqueados',()=>{
 const a=crear(),b=crear({numero:90002,peticion:1,trabajo:9,hotel:6});
 const r=auditar({observado_en:fecha.ahora,altas:[a,b]});
 assert.equal(r.motivos.SOLICITUD_DUPLICADA_O_REINTENTO_AMBIGUO,2);siempreCerrar(r);
});
test('si dos solicitudes reclaman la misma T, ambas se bloquean',()=>{
 const a=crear(),b=crear({numero:90001,peticion:9,trabajo:8,hotel:6});
 const r=auditar({observado_en:fecha.ahora,altas:[a,b]});
 assert.equal(r.motivos.T_ASIGNADA_A_VARIAS_SOLICITUDES,2);siempreCerrar(r);
});
test('T previamente vinculada no se reasigna por reintento',()=>{
 assert.equal(motivo(evaluar(crear(),{identidades_ya_vinculadas:[90001]})),
 'T_YA_VINCULADA_NO_REASIGNAR');
});
test('una nota, DFM, PA o fila física no son pruebas aceptadas',()=>{
 for(const campo of ['pa','dfm','numero_fila','nota_uuid','onEdit','usuario_supuesto']){
  const v=crear();v.acuse[campo]='valor';
  assert.equal(motivo(evaluar(v)),'ACUSE_T_CONTRATO_INVALIDO');
 }
});
test('no se revela el UUID, PA, valor ni las huellas en el informe',()=>{
 const r=evaluar(crear());const s=JSON.stringify(r);
 assert.ok(!s.includes(uuid(1)));assert.ok(!s.includes(uuid(2)));
 assert.ok(!s.includes(uuid(3)));assert.ok(!s.includes(sha));siempreCerrar(r);
});
test('101 eventos se contabilizan completos con detalle acotado',()=>{
 const lot=Array.from({length:101},(_,i)=>crear({numero:90001+i,peticion:i+1,trabajo:i+200,hotel:i+500}));
 const r=auditar({observado_en:fecha.ahora,altas:lot});
 assert.equal(r.total,101);assert.equal(r.detalles.length,100);
 assert.equal(r.detalle_parcial,true);assert.equal(r.candidatos_de_laboratorio,101);
 siempreCerrar(r);
});
test('los registros reales no se consultan desde el laboratorio',()=>{
 const source=readFileSync(new URL('../shared/sincro12-enlace-positivo-lab.mjs',import.meta.url),'utf8');
 for(const patron of [/SpreadsheetApp\./,/UrlFetchApp\./,/createClient\(/,
 /fetch\(/,/INSERT INTO /,/UPDATE /,/DELETE FROM /,/setValues\(/,/service_role/i])
  assert.doesNotMatch(source,patron);
});
test('lotes y observación inválidos fallan cerrado',()=>{
 assert.throws(()=>auditar({observado_en:'2026-10-01T00:00:00.000Z'}),/observación inválida/);
 assert.throws(()=>auditar({observado_en:fecha.ahora,altas:Array(10001).fill(crear())}),/lote de altas/);
 assert.throws(()=>auditar({observado_en:fecha.ahora,identidades_ya_vinculadas:['R1515']}),/no es T/);
});
