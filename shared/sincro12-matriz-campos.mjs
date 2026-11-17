/**
 * SINCRO 12 · contrato de significado T / clase / campo.
 * LABORATORIO PURO: no obtiene datos, no escribe, no autentica humanos
 * ni convierte coincidencias de esquema en enlaces canónicos.
 */
export const VERSION_MATRIZ_S12 = 'sincro12-matriz-semantica-20261117.1';
const SHEET = '1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const CAMPOS_STAGING = /^(?:[A-Q]|NOTA_[AEG]|ORDEN_T)$/;
const TABLA = /^(?:app_private|public)\.[a-z][a-z0-9_]*$/;
const COLUMNA = /^[a-z][a-z0-9_]*$/;
const MAX = 10000, LIMITE_DETALLE = 100;
const SEMANTICA = Object.freeze({
  TRABAJO:Object.freeze({
    I:'FECHA_NECESIDAD', F:'TALLER_O_REFERENCIA_DOCUMENTAL',
    G:'DESIGNACION_O_PEDIDO', H:'CLASE_INTERVENCION',
    J:'ENTRADA_REAL_TALLER', K:'RECOGIDA_REAL_TALLER'
  }),
  PARADA:Object.freeze({
    I:'FECHA_PROGRAMADA_ORIGINAL', J:'INICIO_TRAMO_FACTURABLE',
    K:'FIN_TRAMO_FACTURABLE', Q:'PERIODO_TANCAMENT'
  })
});
const ESTRUCTURALES = new Set(['ROAD','IVECO_ON','TRUCKPOINT','FIN','ARCHIVO','CARPETA']);
const HISTORICAS = new Set(['public.facturacion_tancament_cierres','public.cierres_facturacion']);
const COLUMNAS_TALLER = new Set([
  'app_private.manteniment_t_trabajos.fecha_realizada',
  'app_private.manteniment_t_trabajos.fecha_recogida',
  'public.etapas_hotel.fecha_inicio_real',
  'public.etapas_hotel.fecha_fin_real'
]);
const COLUMNAS_TRAMO = new Set([
  'app_private.manteniment_parada_sync.fecha_inicio_tramo',
  'app_private.manteniment_parada_sync.fecha_corte',
  'public.facturacion_tancament_cierres.fecha_inicio_tramo',
  'public.facturacion_tancament_cierres.fecha_fin_tramo'
]);
function idFila(v) {
  if(Number.isSafeInteger(v)&&v>0)return v;
  if(typeof v==='string'&&/^[1-9]\d{0,14}$/.test(v)){
    const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;
  }
  return null;
}
function check(ok,message){if(!ok)throw Error('SINCRO12 MATRIZ: '+message)}
function texto(v,n=100){return typeof v==='string'&&v.length>0&&v.length<=n}
function clasificar(r,indices,duplicadas,excluidas) {
  const id=idFila(r.id_fila);
  if(id===null)return 'IDENTIDAD_T_INVALIDA';
  if(excluidas.has(id))return 'IDENTIDAD_T_EXCLUIDA';
  if(r.spreadsheet_id!==SHEET)return 'OTRO_LIBRO_NO_ACREDITADO';
  if(r.campo==='T')return 'T_ES_IDENTIDAD_NO_ES_CAMPO_EDITABLE';
  if(!texto(r.campo,20)||!CAMPOS_STAGING.test(r.campo))return 'COLUMNA_FUERA_DE_CONTRATO_STAGING';
  if(duplicadas.has(id+'|'+r.campo))return 'DESTINO_AMBIGUO_PARA_T_CAMPO';
  if(!texto(r.clase_fila,80))return 'CLASE_FILA_AUSENTE';
  if(ESTRUCTURALES.has(r.clase_fila))return 'FILA_ESTRUCTURAL_PROTEGIDA';
  const esperado=SEMANTICA[r.clase_fila]?.[r.campo];
  if(!esperado)return 'CAMPO_SIN_SEMANTICA_APROBADA';
  if(r.concepto_origen!==esperado)return 'CONCEPTO_DE_ORIGEN_CONTRADICTORIO';
  if(['F','G','H'].includes(r.campo))return 'CAMPO_POLISEMICO_SIN_DESAMBIGUACION';
  if(!texto(r.tabla_destino,150)||!texto(r.columna_destino,80))
    return 'DESTINO_NO_IDENTIFICADO';
  if(!TABLA.test(r.tabla_destino)||!COLUMNA.test(r.columna_destino))
    return 'DESTINO_MALFORMADO';
  const destino=r.tabla_destino+'.'+r.columna_destino;
  if((r.clase_fila==='PARADA'&&['J','K'].includes(r.campo)&&COLUMNAS_TALLER.has(destino))||
     (r.clase_fila==='TRABAJO'&&['J','K'].includes(r.campo)&&COLUMNAS_TRAMO.has(destino)))
    return 'CRUCE_SEMANTICO_TALLER_TANCAMENT';
  if(HISTORICAS.has(r.tabla_destino))return 'TABLA_HISTORICA_NO_ES_DESTINO_OPERATIVO';
  if(!indices.has(r.tabla_destino)||!indices.get(r.tabla_destino).has(r.columna_destino))
    return 'DESTINO_NO_EXISTE_EN_FOTOGRAFIA_ESQUEMA';
  if(r.clase_fila==='TRABAJO'&&r.campo==='J'&&
    destino==='app_private.manteniment_t_trabajos.fecha_realizada')
    return 'FECHA_REALIZADA_NO_ACREDITA_ENTRADA_TALLER';
  // Una columna de nombre parecido no prueba que la T concreta le pertenezca.
  return 'MAPEO_PENDIENTE_VINCULO_T_Y_EVENTO_AUTENTICO';
}
/**
 * ENTRADA: solo metadatos de columnas y propuestas de cotejo, nunca valores.
 * rutas: [{spreadsheet_id,id_fila,clase_fila,campo,concepto_origen,
 *          tabla_destino,columna_destino}]
 * metadatos: [{tabla:'app_private.nombre',columnas:['columna',...]}]
 * identidades_excluidas: T acreditadas a excluir, no DFM inferidos.
 */
export function auditarMatrizCamposSincro12({
  rutas=[],metadatos=[],identidades_excluidas=[]
}={}) {
  for(const [nombre,v] of Object.entries({rutas,metadatos,identidades_excluidas}))
    check(Array.isArray(v)&&v.length<=MAX,'lote '+nombre+' inválido');
  const esquema=new Map();
  for(const item of metadatos){
    check(item&&TABLA.test(item.tabla)&&Array.isArray(item.columnas)&&item.columnas.length<=200,
      'metadatos de tabla inválidos');
    check(!esquema.has(item.tabla),'tabla de esquema duplicada');
    check(item.columnas.every(c=>COLUMNA.test(c)),'columna de esquema inválida');
    esquema.set(item.tabla,new Set(item.columnas));
  }
  const excluidas=new Set();
  for(const value of identidades_excluidas){
    const id=idFila(value);check(id!==null,'identidad excluida no es T');
    excluidas.add(id);
  }
  const permitidas=['spreadsheet_id','id_fila','clase_fila','campo',
    'concepto_origen','tabla_destino','columna_destino'];
  const cuenta=new Map();
  for(const r of rutas){
    check(r&&typeof r==='object'&&!Array.isArray(r)&&
      Object.keys(r).every(k=>permitidas.includes(k)),
      'ruta con campos desconocidos o datos no autorizados');
    const id=idFila(r.id_fila);
    if(id!==null&&texto(r.campo,20)){
      const k=id+'|'+r.campo;cuenta.set(k,(cuenta.get(k)||0)+1);
    }
  }
  const duplicadas=new Set([...cuenta].filter(([,n])=>n>1).map(([k])=>k));
  const motivos={},detalles=[];
  for(const r of rutas){
    const motivo=clasificar(r,esquema,duplicadas,excluidas);
    motivos[motivo]=(motivos[motivo]||0)+1;
    if(detalles.length<LIMITE_DETALLE)
      detalles.push({id_fila:idFila(r.id_fila),campo:texto(r.campo,20)?r.campo:null,
        estado:'RETENER_SIN_ESCRIBIR',motivo});
  }
  return {
    version:VERSION_MATRIZ_S12,modo:'SOLO_COTEJO_SEMANTICO_LOCAL',
    total:rutas.length,motivos:Object.fromEntries(Object.entries(motivos).sort()),
    detalles,detalle_parcial:rutas.length>LIMITE_DETALLE,
    identidades_aptas_para_escritura:0,autor_humano_acreditado:false,
    vinculo_T_objeto_acreditado:false,evento_posterior_al_corte_acreditado:false,
    autoriza_sincronizar:false,
    escribe_manteniment:false,escribe_tancament:false,escribe_supabase:false,
    aviso:'Concordancia de nombre de columna NO equivale a identidad de T ni a evento manual acreditado.'
  };
}
export const CONTRATO_CAMPOS_S12 = SEMANTICA;