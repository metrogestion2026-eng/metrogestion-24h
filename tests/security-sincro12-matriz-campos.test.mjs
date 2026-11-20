import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditarMatrizCamposSincro12 as audit,CONTRATO_CAMPOS_S12 as C} from '../shared/sincro12-matriz-campos.mjs';

const SHEET='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const metadata=[
 {tabla:'app_private.manteniment_t_trabajos',
  columnas:['id','sync_id','fecha_necesidad','fecha_realizada','fecha_recogida','taller','tipo_trabajo','designacion']},
 {tabla:'app_private.manteniment_parada_sync',
  columnas:['seguimiento_id','sync_id','fecha_programada_parada','fecha_inicio_tramo','fecha_corte','tancament','fila_manteniment']},
 {tabla:'public.etapas_hotel',columnas:['id','fecha_inicio_real','fecha_fin_real','version']},
 {tabla:'public.facturacion_tancament_cierres',columnas:['id','fecha_inicio_tramo','fecha_fin_tramo','fila_manteniment']}
];
const ruta=(over={})=>({
 spreadsheet_id:SHEET,id_fila:90001,clase_fila:'TRABAJO',campo:'K',
 concepto_origen:C.TRABAJO.K,
 tabla_destino:'app_private.manteniment_t_trabajos',columna_destino:'fecha_recogida',
 ...over
});
const prueba=(x)=>audit({rutas:[ruta(x)],metadatos:metadata});
const motivo=x=>x.detalles[0].motivo;
const sinEscritura=x=>{
 assert.equal(x.autoriza_sincronizar,false);
 assert.equal(x.identidades_aptas_para_escritura,0);
 assert.equal(x.escribe_manteniment,false);
 assert.equal(x.escribe_tancament,false);
 assert.equal(x.escribe_supabase,false);
 assert.equal(x.autor_humano_acreditado,false);
 assert.equal(x.vinculo_T_objeto_acreditado,false);
 assert.equal(x.evento_posterior_al_corte_acreditado,false);
};

test('fecha recogida de TRABAJO solo es candidata, nunca autoriza sincronizar',()=>{
 const r=prueba();assert.equal(motivo(r),'MAPEO_PENDIENTE_VINCULO_T_Y_EVENTO_AUTENTICO');sinEscritura(r);
});
test('J de TRABAJO no se convierte automáticamente en fecha_realizada',()=>{
 const r=prueba({campo:'J',concepto_origen:C.TRABAJO.J,columna_destino:'fecha_realizada'});
 assert.equal(motivo(r),'FECHA_REALIZADA_NO_ACREDITA_ENTRADA_TALLER');sinEscritura(r);
});
test('J de PARADA no es fecha_realizada de TRABAJO',()=>{
 const r=prueba({clase_fila:'PARADA',campo:'J',concepto_origen:C.PARADA.J,columna_destino:'fecha_realizada'});
 assert.equal(motivo(r),'CRUCE_SEMANTICO_TALLER_TANCAMENT');sinEscritura(r);
});
test('K de PARADA no es recogida de taller',()=>{
 assert.equal(motivo(prueba({clase_fila:'PARADA',campo:'K',concepto_origen:C.PARADA.K})),
 'CRUCE_SEMANTICO_TALLER_TANCAMENT');
});
test('K de TRABAJO no es fin de tramo de facturación',()=>{
 assert.equal(motivo(prueba({tabla_destino:'public.facturacion_tancament_cierres',
 columna_destino:'fecha_fin_tramo'})),'CRUCE_SEMANTICO_TALLER_TANCAMENT');
});
test('J de PARADA con fecha_inicio_tramo es solo candidata',()=>{
 const r=prueba({clase_fila:'PARADA',campo:'J',concepto_origen:C.PARADA.J,
  tabla_destino:'app_private.manteniment_parada_sync',columna_destino:'fecha_inicio_tramo'});
 assert.equal(motivo(r),'MAPEO_PENDIENTE_VINCULO_T_Y_EVENTO_AUTENTICO');sinEscritura(r);
});
test('un cierre histórico de TANCAMENT no es destino editable',()=>{
 const r=prueba({clase_fila:'PARADA',campo:'I',concepto_origen:C.PARADA.I,
 tabla_destino:'public.facturacion_tancament_cierres',columna_destino:'fecha_inicio_tramo'});
 assert.equal(motivo(r),'TABLA_HISTORICA_NO_ES_DESTINO_OPERATIVO');
});
test('FIN y ROAD son clases estructurales no intercambiables con T',()=>{
 for(const clase_fila of ['FIN','ROAD','ARCHIVO','CARPETA','TRUCKPOINT','IVECO_ON']){
  assert.equal(motivo(prueba({clase_fila})),'FILA_ESTRUCTURAL_PROTEGIDA');
 }
});
test('G no se interpreta como designación si también puede ser pedido',()=>{
 assert.equal(motivo(prueba({campo:'G',concepto_origen:C.TRABAJO.G,columna_destino:'designacion'})),
 'CAMPO_POLISEMICO_SIN_DESAMBIGUACION');
});
test('F no se reduce a taller sin separar referencia documental',()=>{
 assert.equal(motivo(prueba({campo:'F',concepto_origen:C.TRABAJO.F,columna_destino:'taller'})),
 'CAMPO_POLISEMICO_SIN_DESAMBIGUACION');
});
test('H de trabajo no se deduce por mera semejanza de catálogo',()=>{
 assert.equal(motivo(prueba({campo:'H',concepto_origen:C.TRABAJO.H,columna_destino:'tipo_trabajo'})),
 'CAMPO_POLISEMICO_SIN_DESAMBIGUACION');
});
test('significado de origen contradictorio bloquea con nombre de columna válido',()=>{
 const r=prueba({campo:'J',concepto_origen:C.PARADA.J,columna_destino:'fecha_realizada'});
 assert.equal(motivo(r),'CONCEPTO_DE_ORIGEN_CONTRADICTORIO');
});
test('campo destino ausente no se adivina',()=>{
 assert.equal(motivo(prueba({columna_destino:'recogida_ficticia'})),
 'DESTINO_NO_EXISTE_EN_FOTOGRAFIA_ESQUEMA');
});
test('T es identidad, no campo modificable; R/S no tienen staging actual',()=>{
 assert.equal(motivo(prueba({campo:'T'})),'T_ES_IDENTIDAD_NO_ES_CAMPO_EDITABLE');
 for(const campo of ['R','S','U','Z'])assert.equal(motivo(prueba({campo})),
 'COLUMNA_FUERA_DE_CONTRATO_STAGING');
});
test('número de fila A1 no reemplaza ID_FILA',()=>{
 assert.equal(motivo(prueba({id_fila:'A3488'})),'IDENTIDAD_T_INVALIDA');
 assert.equal(motivo(prueba({id_fila:0})),'IDENTIDAD_T_INVALIDA');
});
test('no se permite identidad de hoja ajena',()=>{
 assert.equal(motivo(prueba({spreadsheet_id:'otro'})),'OTRO_LIBRO_NO_ACREDITADO');
});
test('duplicar destino para la misma T/campo bloquea ambos',()=>{
 const a=ruta();const b=ruta({columna_destino:'fecha_realizada'});
 const x=audit({metadatos:metadata,rutas:[a,b]});
 assert.equal(x.total,2);assert.equal(x.motivos.DESTINO_AMBIGUO_PARA_T_CAMPO,2);sinEscritura(x);
});
test('exclusión específica se hace por T acreditada, no por DFM',()=>{
 const x=audit({metadatos:metadata,rutas:[ruta()],identidades_excluidas:[90001]});
 assert.equal(motivo(x),'IDENTIDAD_T_EXCLUIDA');sinEscritura(x);
});
test('rechaza número de fila física, PA, DFM o notas adicionales',()=>{
 for(const field of ['numero_fila','posicion','pa','dfm','nota_e']){
  const r=ruta();r[field]='dato';
  assert.throws(()=>audit({rutas:[r],metadatos:metadata}),/campos desconocidos/);
 }
});
test('si falta foto de metadatos no se afirma que exista destino',()=>{
 assert.equal(motivo(audit({rutas:[ruta()]})),
 'DESTINO_NO_EXISTE_EN_FOTOGRAFIA_ESQUEMA');
});
test('101 resultados: resumen completo, muestra parcial y sin valores',()=>{
 const rutas=Array.from({length:101},(_,i)=>ruta({id_fila:90001+i}));
 const x=audit({rutas,metadatos:metadata});
 assert.equal(x.total,101);assert.equal(x.detalles.length,100);
 assert.equal(x.detalle_parcial,true);sinEscritura(x);
 assert.ok(!JSON.stringify(x).includes('fecha_recogida'));
});
test('invariantes del módulo: sin red, sin credenciales y sin escribir',()=>{
 const source=readFileSync(new URL('../shared/sincro12-matriz-campos.mjs',import.meta.url),'utf8');
 for(const rx of [/SpreadsheetApp\./,/UrlFetchApp\./,/supabase\.from\(/,
 /fetch\(/,/setValues\(/,/INSERT INTO /,/DELETE FROM /,/UPDATE /,/service_role/i])
  assert.doesNotMatch(source,rx);
});
test('cargas, metadatos y exclusiones inválidas fallan cerrado',()=>{
 assert.throws(()=>audit({rutas:Array(10001).fill(ruta())}),/lote rutas/);
 assert.throws(()=>audit({metadatos:[{tabla:'public.etapas_hotel',columnas:['id']},{tabla:'public.etapas_hotel',columnas:['id']}]}),/duplicada/);
 assert.throws(()=>audit({identidades_excluidas:['R1515']}),/identidad excluida no es T/);
});