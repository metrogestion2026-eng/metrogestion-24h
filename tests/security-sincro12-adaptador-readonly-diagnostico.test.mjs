import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 diagnosticarFuentesSincro12 as auditar,
 S12_READONLY_LIBRO as LIBRO,
 S12_READONLY_CONSULTA as CONSULTA
} from '../shared/sincro12-adaptador-readonly-diagnostico.mjs';

function fixture(){
 const calls=[];
 const meta={spreadsheetId:LIBRO,sheets:[
  {properties:{title:'MANTENIMENT',sheetId:1211148219,sheetType:'GRID',hidden:false}},
  {properties:{title:'REGISTRO_FILAS',sheetId:2077110101,sheetType:'GRID',hidden:true}},
  {properties:{title:'PREDICTIVO',sheetId:2019072026,sheetType:'GRID',hidden:false}}
 ]};
 const ranges={
  'MANTENIMENT|T1:T1':{values:[['ID_FILA']]},
  'REGISTRO_FILAS|A1:E1':{values:[['ID_FILA','ESTADO','FECHA_ASIGNACION','FECHA_ELIMINACION','OBSERVACION']]},
  'REGISTRO_FILAS|G2:H2':{values:[['ULTIMO_ID_EMITIDO','6969']]}
 };
 const db={
  filas_t_registradas:0,identidades_declaradas_acreditadas:0,
  cambios_recibidos:0,recibos_de_entrega:0,trabajos_catalogados:318,
  usuarios_con_permiso_s12:0,
  auth_sesiones_campos:true,usuarios_campos:true,dispositivos_campos:true,
  vinculos_staging_campos:true,eventos_staging_campos:true,
  fecha_recogida_disponible:true,outbox_identifica_t_y_campo:false,
  clasificacion:'SOLO_CAPACIDADES_NO_ES_ACREDITACION',
  evento_manual_real_acreditado:false,
  vinculo_t_objeto_real_acreditado_por_esta_consulta:false,
  nonce_consumido_en_transaccion:false,autoriza_sincronizar:false
 };
 const hojas={
  leerMetadatos:async id=>{calls.push(['meta',id]);return meta;},
  leerRango:async ({spreadsheetId,hoja,rango})=>{
   calls.push(['range',spreadsheetId,hoja,rango]);
   if(spreadsheetId!==LIBRO||!Object.hasOwn(ranges,hoja+'|'+rango))
    throw new Error('LECTURA FUERA DEL ALCANCE');
   return ranges[hoja+'|'+rango];
  }
 };
 const servidor={
  leerConsultaFija:async nombre=>{
   calls.push(['sql',nombre]);
   assert.equal(nombre,CONSULTA);
   return db;
  }
 };
 return {calls,meta,ranges,db,hojas,servidor};
}
function closed(r){
 for(const name of ['prueba_de_autor_de_edicion','acuse_de_T_objeto_real',
  'revision_por_celda_real_acreditada','sesion_productiva_validada',
  'evento_manual_nuevo_acreditado','autoriza_crear_T','autoriza_crear_PA',
  'autoriza_sincronizar','escritura_google','escritura_supabase',
  'autoriza_activar_scripts'])assert.equal(r[name],false,name);
 assert.ok(!JSON.stringify(r).includes('Bearer '));
}
test('fuentes actuales: reconoce MANTENIMENT y registro de IDs sin dar permisos',async()=>{
 const h=fixture(),r=await auditar(h);
 assert.equal(r.estado,'SINCRONIZACION_BLOQUEADA');
 assert.equal(r.libro_reconocido,true);
 assert.equal(r.columna_t_es_id_fila,true);
 assert.equal(r.registro_identidades_detectado,true);
 assert.equal(r.registro_identidades_oculto,true);
 assert.equal(r.ultimo_id_emitido,6969);
 assert.equal(r.conteos.trabajos_catalogados,318);
 assert.equal(r.conteos.usuarios_con_permiso_s12,0);
 assert.equal(r.outbox_identifica_t_y_campo,false);
 closed(r);
});
test('origen de hoja no acredita autor ni evento manual',async()=>{
 const r=await auditar(fixture());
 assert.ok(r.motivos.includes('ORIGEN_HUMANO_GOOGLE_NO_ACREDITADO'));
 assert.ok(r.motivos.includes('NONCE_Y_CAS_REAL_PENDIENTES'));
 closed(r);
});
test('cero vínculos T y permisos explícitos reportan bloqueos separados',async()=>{
 const r=await auditar(fixture());
 for(const reason of ['SIN_VINCULOS_T_OBJETO_ACREDITADOS','SIN_PERMISO_EXPLICITO_DE_LOTE',
 'SIN_EVENTOS_T_REGISTRADOS','OUTBOX_SIN_CLAVE_T_Y_CAMPO'])
  assert.ok(r.motivos.includes(reason));
});
test('solo permite 3 rangos literales y metadatos del libro exacto',async()=>{
 const h=fixture();await auditar(h);
 assert.deepEqual(h.calls,[
  ['meta',LIBRO],
  ['range',LIBRO,'MANTENIMENT','T1:T1'],
  ['range',LIBRO,'REGISTRO_FILAS','A1:E1'],
  ['range',LIBRO,'REGISTRO_FILAS','G2:H2'],
  ['sql',CONSULTA]
 ]);
});
test('no se leen celdas operativas I/J/K ni TANCAMENT ni notas',async()=>{
 const h=fixture();await auditar(h);
 assert.ok(!h.calls.some(c=>JSON.stringify(c).includes('TANCAMENT')));
 assert.ok(!h.calls.some(c=>c[0]==='range'&&!['T1:T1','A1:E1','G2:H2'].includes(c[3])));
});
test('sin puertos no intenta consultar ni inventar valores',async()=>{
 const r=await auditar();assert.equal(r.estado,'DIAGNOSTICO_INCOMPLETO');
 assert.ok(r.motivos.includes('FUENTE_ADAPTADOR_SOLO_LECTURA_NO_CONFIGURADO'));
 closed(r);
});
test('metadatos devueltos con wrapper result se admiten',async()=>{
 const h=fixture(),orig=h.hojas.leerMetadatos;
 h.hojas.leerMetadatos=async id=>({result:await orig(id)});
 h.servidor.leerConsultaFija=async()=>({result:h.db});
 const r=await auditar(h);assert.equal(r.libro_reconocido,true);closed(r);
});
test('otro spreadsheet se rechaza ANTES de lecturas de celdas',async()=>{
 const h=fixture();h.meta.spreadsheetId='OTRO_LIBRO';
 const r=await auditar(h);
 assert.ok(r.motivos.includes('FUENTE_LIBRO_INCORRECTO'));
 assert.deepEqual(h.calls,[['meta',LIBRO]]);
 closed(r);
});
test('pestaña REGISTRO_FILAS oculta ausente se rechaza',async()=>{
 const h=fixture();h.meta.sheets=h.meta.sheets.filter(s=>s.properties.title!=='REGISTRO_FILAS');
 const r=await auditar(h);
 assert.equal(r.estado,'DIAGNOSTICO_INCOMPLETO');
 assert.ok(r.motivos.includes('ESTRUCTURA_REGISTRO_HOJA_NO_CONFIABLE'));
 closed(r);
});
test('no desocultar ni modificar registro si se encuentra visible',async()=>{
 const h=fixture();h.meta.sheets[1].properties.hidden=false;
 const r=await auditar(h);
 assert.ok(r.motivos.includes('ESTRUCTURA_REGISTRO_HOJA_NO_CONFIABLE'));
 assert.equal(h.calls.length,1);closed(r);
});
test('duplicar nombre de pestaña impide confundir origen',async()=>{
 const h=fixture();h.meta.sheets.push({...h.meta.sheets[1]});
 const r=await auditar(h);
 assert.ok(r.motivos.includes('ESTRUCTURA_REGISTRO_HOJA_NO_CONFIABLE'));
});
test('la columna T debe decir ID_FILA, no un índice posicional',async()=>{
 const h=fixture();h.ranges['MANTENIMENT|T1:T1'].values=[['FILA 20']];
 const r=await auditar(h);
 assert.equal(r.columna_t_es_id_fila,false);
 assert.ok(r.motivos.includes('ESTRUCTURA_COLUMNA_T_SIN_ID_FILA'));
 closed(r);
});
test('cabecera oculta exige ID_FILA/ESTADO/FECHA_ASIGNACION/FECHA_ELIMINACION/OBSERVACION',async()=>{
 const h=fixture();h.ranges['REGISTRO_FILAS|A1:E1'].values=[['FILA','ESTADO','FECHA_ASIGNACION','FECHA_ELIMINACION','OBSERVACION']];
 const r=await auditar(h);
 assert.equal(r.registro_identidades_detectado,false);
 assert.ok(r.motivos.includes('ESTRUCTURA_REGISTRO_CABECERAS_INVALIDAS'));
 closed(r);
});
test('contador de T se reconoce como control, no como vínculo T/objeto',async()=>{
 const r=await auditar(fixture());
 assert.equal(r.ultimo_id_emitido,6969);
 assert.equal(r.acuse_de_T_objeto_real,false);
});
test('contador antiguo sin etiqueta nunca se toma como último ID',async()=>{
 const h=fixture();h.ranges['REGISTRO_FILAS|G2:H2'].values=[['ULTIMA_FILA','6969']];
 const r=await auditar(h);assert.equal(r.ultimo_id_emitido,null);
 assert.ok(r.motivos.includes('ESTRUCTURA_CONTADOR_T_NO_VERIFICADO'));
});
test('contador con fórmula/texto en lugar de entero no es prueba de identidad',async()=>{
 for(const value of ['=MAX(A:A)','R1515','6940foo',-1,'9007199254740992']){
  const h=fixture();h.ranges['REGISTRO_FILAS|G2:H2'].values=[['ULTIMO_ID_EMITIDO',value]];
  const r=await auditar(h);assert.equal(r.ultimo_id_emitido,null);
  assert.ok(r.motivos.includes('ESTRUCTURA_ULTIMO_ID_EMITIDO_INVALIDO'));
 }
});
test('contador válido puede venir como número no formateado',async()=>{
 const h=fixture();h.ranges['REGISTRO_FILAS|G2:H2'].values=[['ULTIMO_ID_EMITIDO',6969]];
 const r=await auditar(h);assert.equal(r.ultimo_id_emitido,6969);closed(r);
});
test('censo de Supabase ausente o etiqueta alterada no abre sincronización',async()=>{
 for(const mock of [null,{}, {clasificacion:'AUTORIZADO'}]){
  const h=fixture();h.servidor.leerConsultaFija=async()=>mock;
  const r=await auditar(h);assert.ok(r.motivos.includes('FUENTE_CENSO_SERVIDOR_INVALIDA'));closed(r);
 }
});
test('un SELECT que dice autorizar escritura se rechaza de inmediato',async()=>{
 const h=fixture();h.db.autoriza_sincronizar=true;
 const r=await auditar(h);
 assert.ok(r.motivos.includes('FUENTE_NO_SE_DECLARA_SOLO_LECTURA'));
 closed(r);
});
test('servidor que finge acreditar autoría no pasa como diagnóstico',async()=>{
 const h=fixture();h.db.evento_manual_real_acreditado=true;
 const r=await auditar(h);
 assert.ok(r.motivos.includes('FUENTE_NO_SE_DECLARA_SOLO_LECTURA'));
 closed(r);
});
test('un recibo declarado transaccional no equivale al diagnóstico y se rechaza',async()=>{
 const h=fixture();h.db.nonce_consumido_en_transaccion=true;
 const r=await auditar(h);
 assert.ok(r.motivos.includes('FUENTE_NO_SE_DECLARA_SOLO_LECTURA'));closed(r);
});
test('los conteos deben ser enteros finitos no negativos, no fechas ni filas',async()=>{
 for(const value of [-1,'=COUNT(A:A)','R1515','NaN',1.5]){
  const h=fixture();h.db.trabajos_catalogados=value;
  const r=await auditar(h);
  assert.ok(r.motivos.includes('FUENTE_CONTADOR_NO_VALIDO'));closed(r);
 }
});
test('servidor incompleto se retiene; no se rellenan campos de memoria',async()=>{
 const h=fixture();delete h.db.usuarios_campos;
 const r=await auditar(h);
 assert.ok(r.motivos.includes('FUENTE_ESQUEMA_SERVIDOR_INCOMPLETO'));
 closed(r);
});
test('falta una tabla de sesiones o dispositivos: estructura incompleta',async()=>{
 for(const field of ['auth_sesiones_campos','usuarios_campos','dispositivos_campos',
 'vinculos_staging_campos','eventos_staging_campos']){
  const h=fixture();h.db[field]=false;
  const r=await auditar(h);
  assert.ok(r.motivos.includes('ESTRUCTURA_SERVIDOR_CAPACIDADES_INCOMPLETAS'));
  closed(r);
 }
});
test('si mañana hay vínculos en staging, siguen sin ser autoría humana',async()=>{
 const h=fixture();Object.assign(h.db,{
  filas_t_registradas:100,identidades_declaradas_acreditadas:90,
  cambios_recibidos:8,usuarios_con_permiso_s12:2,
  outbox_identifica_t_y_campo:true
 });
 const r=await auditar(h);
 assert.ok(!r.motivos.includes('SIN_VINCULOS_T_OBJETO_ACREDITADOS'));
 assert.equal(r.prueba_de_autor_de_edicion,false);
 assert.equal(r.autoriza_sincronizar,false);
 closed(r);
});
test('no se confunde el número de trabajos con T acreditadas',async()=>{
 const r=await auditar(fixture());
 assert.equal(r.conteos.trabajos_catalogados,318);
 assert.equal(r.conteos.filas_t_registradas,0);
});
test('errores de lectura externa se sanitizan y no divulgan valores',async()=>{
 const h=fixture();
 h.hojas.leerRango=async()=>{throw Error('SECRETO_MANTENIMENT_TABLA_USUARIOS');};
 const r=await auditar(h);
 assert.ok(r.motivos.includes('FUENTE_FALLO_LECTURA_RESTRINGIDA'));
 assert.ok(!JSON.stringify(r).includes('SECRETO_MANTENIMENT'));
 closed(r);
});
test('si una lectura de hoja contiene valores privados extra, el resultado no los expone',async()=>{
 const h=fixture();
 h.ranges['REGISTRO_FILAS|A1:E1'].values[0].push('CONTACTO_PRIVADO_VALOR');
 h.db.secreto='TOKEN_SECRETO_DEL_SERVIDOR';
 const r=await auditar(h);
 assert.ok(!JSON.stringify(r).includes('CONTACTO_PRIVADO_VALOR'));
 assert.ok(!JSON.stringify(r).includes('TOKEN_SECRETO_DEL_SERVIDOR'));
 closed(r);
});
test('sin acceso a puertos no hay llamadas de escritura ni claves',()=>{
 const src=readFileSync(new URL('../shared/sincro12-adaptador-readonly-diagnostico.mjs',import.meta.url),'utf8');
 for(const rx of [/SpreadsheetApp\./,/UrlFetchApp\./,/fetch\s*\(/,
 /createClient\s*\(/,/execute_sql\s*\(/,/batch_update/i,
 /service_role/i,/\bINSERT\s+INTO\b/i,/\bDELETE\s+FROM\b/i,/\bUPDATE\s+\w+\s+SET\b/i,
 /trigger\s*\(/i,/createTrigger\s*\(/i])assert.doesNotMatch(src,rx);
});
