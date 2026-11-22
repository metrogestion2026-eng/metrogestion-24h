import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {preflightAutorizacionLoteS12 as check,huellaAlcanceS12} from '../shared/sincro12-autenticacion-lote-preflight.mjs';

const SHEET='1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU';
const UUID=(i)=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const NOW='2026-11-18T08:50:00.000Z';
const PRESENT='2026-11-18T08:49:00.000Z';
const DEVICE='A'.repeat(40);
const JWT='eyJzdWIiOiJ0ZXN0In0.eyJhdWQiOiJ0ZXN0In0.c2lnbmF0dXJl';
const AUTH='Bearer '+JWT;
const SHA=(s)=>createHash('sha256').update(s).digest('hex');
const CELL=(id=90001,revision=7,hash='b'.repeat(64))=>({
 id_fila:id,columna:'K',clase:'TRABAJO',revision_hoja:revision,hash_vigente:hash
});
function harness(){
 const celdas=[CELL()];
 const solicitud={
  tipo:'ADOPTAR_VALORES_ACTUALES',
  spreadsheet_id:SHEET,lote_id:UUID(1),request_id:UUID(2),nonce:UUID(3),
  huella_alcance:huellaAlcanceS12(celdas),presentado_en:PRESENT,celdas
 };
 const audit=[];
 const claims={
  sub:UUID(4),session_id:UUID(5),aal:'aal2',role:'authenticated',
  iat:Math.floor(Date.parse('2026-11-18T08:40:00.000Z')/1000),
  exp:Math.floor(Date.parse('2026-11-18T09:40:00.000Z')/1000),
  is_anonymous:false
 };
 const auth={auth:{
  getClaims:async t=>{audit.push('getClaims');assert.equal(t,JWT);return {data:{claims}};},
  getUser:async t=>{audit.push('getUser');assert.equal(t,JWT);return {data:{user:{id:claims.sub}}};},
  mfa:{getAuthenticatorAssuranceLevel:async t=>{
   audit.push('getAuthenticatorAssuranceLevel');assert.equal(t,JWT);
   return {data:{currentLevel:'aal2'}};}}
 }};
 const perfil={id:claims.sub,activo:true,
  permisos:{sincro12_confirmar_lote:true},
  credenciales_actualizadas_en:'2026-11-17T09:00:00.000Z'};
 const sesion={id:claims.session_id,user_id:claims.sub,aal:'aal2',not_after:null};
 const device={id:UUID(6),usuario_id:claims.sub,estado:'autorizado'};
 const saved={lote_id:solicitud.lote_id,usuario_id:claims.sub,
  session_id:claims.session_id,huella_alcance:solicitud.huella_alcance,
  request_id:solicitud.request_id,nonce:solicitud.nonce,
  estado:'PRESENTADO',presentado_en:solicitud.presentado_en};
 const fuentes={
  leerUsuario:async id=>{audit.push('leerUsuario');assert.equal(id,claims.sub);return perfil;},
  leerSesionAuth:async ({userId,sessionId})=>{
   audit.push('leerSesionAuth');assert.equal(userId,claims.sub);
   assert.equal(sessionId,claims.session_id);return sesion;},
  buscarDispositivoPorHuella:async ({userId,tokenHash})=>{
   audit.push('buscarDispositivoPorHuella');
   assert.equal(userId,claims.sub);assert.equal(tokenHash,SHA(DEVICE));
   return device;
  },
  leerLotePreparado:async ({loteId,userId})=>{
   audit.push('leerLotePreparado');assert.equal(loteId,solicitud.lote_id);
   assert.equal(userId,claims.sub);return saved;},
  nonceNoConsumido:async ({nonce})=>{
   audit.push('nonceNoConsumido');assert.equal(nonce,solicitud.nonce);return true;},
  leerVinculoT:async ({spreadsheetId,idFila,campo})=>{
   audit.push('leerVinculoT');assert.equal(spreadsheetId,SHEET);
   assert.equal(campo,'K');
   return {spreadsheet_id:SHEET,id_fila:idFila,estado:'ACREDITADA',
    clase:'TRABAJO',origen_vinculo:'ACUSE_T_CANONICO_VERIFICADO',
    trabajo_sync_id:UUID(900)};
  },
  leerCeldaHoja:async ({spreadsheetId,idFila,campo})=>{
   audit.push('leerCeldaHoja');assert.equal(spreadsheetId,SHEET);
   return {spreadsheet_id:SHEET,id_fila:idFila,columna:campo,
    revision:solicitud.celdas.find(x=>x.id_fila===idFila).revision_hoja,
    hash:solicitud.celdas.find(x=>x.id_fila===idFila).hash_vigente};
  }
 };
 return {authorization:AUTH,deviceToken:DEVICE,solicitud,auth,fuentes,
  observado_en:NOW,audit,claims,perfil,sesion,device,saved};
}
function cerrado(r){
 assert.equal(r.autoriza_sincronizar,false);
 assert.equal(r.recibo_de_confirmacion_emitido,false);
 assert.equal(r.sesion_productiva_acreditada_por_este_modulo,false);
 assert.equal(r.autor_de_edicion_en_google_acreditado,false);
 assert.equal(r.origen_hoja_real_acreditado,false);
 assert.equal(r.vinculos_T_objeto_reales_acreditados,false);
 assert.equal(r.permite_crear_T,false);
 assert.equal(r.permite_crear_PA,false);
 assert.equal(r.escritura_manteniment,false);
 assert.equal(r.escritura_tancament,false);
 assert.equal(r.escritura_supabase,false);
}
const evalo=async(h)=>check(h);
test('candidato LAB completo nunca permite escritura, firma ni autoría de hoja',async()=>{
 const h=harness(),r=await evalo(h);
 assert.equal(r.motivo,'CONTRATO_COTEJADO_NO_AUTORIZADO');
 assert.equal(r.resultado,'CANDIDATO_SIN_AUTORIZACION');
 assert.deepEqual(h.audit,['getClaims','getUser','getAuthenticatorAssuranceLevel',
 'leerUsuario','leerSesionAuth','buscarDispositivoPorHuella',
 'leerLotePreparado','nonceNoConsumido','leerVinculoT','leerCeldaHoja']);
 cerrado(r);
});
test('no hay token JWT: ni siquiera se consulta la cuenta',async()=>{
 const h=harness();h.authorization='';
 const r=await evalo(h);assert.equal(r.motivo,'TOKEN_BEARER_AUSENTE');
 assert.equal(h.audit.length,0);cerrado(r);
});
test('no se acepta token en Basic, doble Bearer, querystring o con saltos',async()=>{
 for(const authorization of ['Basic '+JWT,'Bearer Bearer '+JWT,
  'Bearer '+JWT+'\nAuthorization: other','Bearer token','Bearer '+JWT+' otro']){
  const h=harness();h.authorization=authorization;
  const r=await evalo(h);assert.ok(r.motivo.startsWith('TOKEN_BEARER'));
  assert.equal(h.audit.length,0);cerrado(r);
 }
});
test('falta dispositivo autorizado: no se consulta Auth',async()=>{
 const h=harness();h.deviceToken='corta';
 const r=await evalo(h);assert.equal(r.motivo,'PRUEBA_DISPOSITIVO_AUSENTE');
 assert.equal(h.audit.length,0);
});
test('cambiar una huella del lote invalida alcance antes de leer credenciales',async()=>{
 const h=harness();h.solicitud.celdas[0].hash_vigente='c'.repeat(64);
 const r=await evalo(h);assert.equal(r.motivo,'ALCANCE_T_CAMPOS_NO_COINCIDE');
 assert.equal(h.audit.length,0);
});
test('normalización del alcance no depende de orden físico',()=>{
 const cells=[CELL(90002),CELL(90001)];
 assert.equal(huellaAlcanceS12(cells),huellaAlcanceS12([...cells].reverse()));
});
test('ID_FILA T no es una posición A1; número inválido no produce hash',()=>{
 assert.equal(huellaAlcanceS12([CELL('K1624')]),null);
 assert.equal(huellaAlcanceS12([CELL(0)]),null);
});
test('no se acepta la misma T/campo dos veces en un lote',()=>{
 assert.equal(huellaAlcanceS12([CELL(),CELL()]),null);
});
test('no se adoptan campos J, G, TANCAMENT ni clases estructurales por semejanza',()=>{
 for(const override of [{columna:'J'},{columna:'T'},{clase:'PARADA'},
  {columna:'G'},{clase:'ROAD'}]){
  assert.equal(huellaAlcanceS12([{...CELL(),...override}]),null);
 }
});
test('lotes vacíos o excesivos no admitidos',()=>{
 assert.equal(huellaAlcanceS12([]),null);
 assert.equal(huellaAlcanceS12(Array(101).fill(CELL())),null);
});
test('no se admiten campos extra enviados por navegador como permisos o PA',async()=>{
 const h=harness();h.solicitud.administrador=true;
 const r=await evalo(h);
 assert.equal(r.motivo,'SOLICITUD_DE_LOTE_INVALIDA');
 assert.equal(h.audit.length,0);
});
test('fecha de presentación anterior a corte se retiene',async()=>{
 const h=harness();h.solicitud.presentado_en='2026-11-14T08:49:00.000Z';
 const r=await evalo(h);assert.equal(r.motivo,'PRESENTACION_DEL_LOTE_CADUCADA');
});
test('fecha de presentación antigua fuera de 5 minutos se retiene',async()=>{
 const h=harness();h.solicitud.presentado_en='2026-11-18T08:40:00.000Z';
 const r=await evalo(h);assert.equal(r.motivo,'PRESENTACION_DEL_LOTE_CADUCADA');
});
test('reloj del servidor inválido cierra el preflight',async()=>{
 const h=harness();h.observado_en='2024-01-01T00:00:00.000Z';
 const r=await evalo(h);assert.equal(r.motivo,'RELOJ_SERVIDOR_NO_ACREDITADO');
});
test('sin adaptadores el módulo no puede falsear sesión verificada',async()=>{
 const h=harness();delete h.fuentes.leerSesionAuth;
 const r=await evalo(h);assert.equal(r.motivo,'ADAPTADORES_CONFIABLES_NO_INSTALADOS');
});
test('claims sin firma verificable impiden pasar a perfil',async()=>{
 const h=harness();h.auth.auth.getClaims=async()=>({error:{message:'fake error'},data:null});
 const r=await evalo(h);assert.equal(r.motivo,'CLAIMS_VERIFICADOS_INSUFICIENTES');
 assert.equal(h.audit.length,0);cerrado(r);
});
test('sub de claims no equivale a usuario autenticado',async()=>{
 const h=harness();h.auth.auth.getUser=async()=>({data:{user:{id:UUID(88)}}});
 const r=await evalo(h);assert.equal(r.motivo,'CUENTA_AUTH_NO_COINCIDE');
});
test('JWT con AAL1 y MFA local no debe pasar',async()=>{
 const h=harness();h.claims.aal='aal1';
 const r=await evalo(h);assert.equal(r.motivo,'CLAIMS_VERIFICADOS_INSUFICIENTES');
});
test('JWT con AAL2 declarado pero MFA validado como AAL1 no pasa',async()=>{
 const h=harness();
 h.auth.auth.mfa.getAuthenticatorAssuranceLevel=async()=>({data:{currentLevel:'aal1'}});
 const r=await evalo(h);assert.equal(r.motivo,'MFA_REAL_NO_ACREDITADA_POR_ADAPTADOR');
});
test('JWT no autenticado o anónimo se rechaza',async()=>{
 for(const change of [{role:'anon'},{is_anonymous:true}]){
  const h=harness();Object.assign(h.claims,change);
  const r=await evalo(h);assert.equal(r.motivo,'CLAIMS_VERIFICADOS_INSUFICIENTES');
 }
});
test('JWT caducado se rechaza antes de perfil',async()=>{
 const h=harness();h.claims.exp=Math.floor(Date.parse('2026-11-18T08:49:00.000Z')/1000);
 const r=await evalo(h);assert.equal(r.motivo,'CLAIMS_VERIFICADOS_INSUFICIENTES');
});
test('perfil inactivo o sin permiso explícito deniega sin fallback a rol',async()=>{
 for(const change of [{activo:false},{permisos:{}},{permisos:null}]){
  const h=harness();Object.assign(h.perfil,change);
  const r=await evalo(h);
  assert.equal(r.motivo,'PERMISO_EXPLICITO_NO_EXISTE_O_CUENTA_INACTIVA');
 }
});
test('token emitido antes del cambio de credenciales no reutilizable',async()=>{
 const h=harness();h.perfil.credenciales_actualizadas_en='2026-11-18T08:45:00.000Z';
 const r=await evalo(h);assert.equal(r.motivo,'TOKEN_ANTERIOR_A_CREDENCIALES');
});
test('sesión ausente o revocada no pasa',async()=>{
 const h=harness();h.fuentes.leerSesionAuth=async()=>null;
 const r=await evalo(h);assert.equal(r.motivo,'SESION_REVOCADA_O_NO_VIGENTE');
});
test('session_id válido de otra persona se rechaza',async()=>{
 const h=harness();h.sesion.user_id=UUID(88);
 const r=await evalo(h);assert.equal(r.motivo,'SESION_REVOCADA_O_NO_VIGENTE');
});
test('sesión con not_after expirado rechazada',async()=>{
 const h=harness();h.sesion.not_after='2026-11-18T08:49:00.000Z';
 const r=await evalo(h);assert.equal(r.motivo,'SESION_REVOCADA_O_NO_VIGENTE');
});
test('dispositivo no autorizado, ajeno o con id inválido se rechaza',async()=>{
 for(const change of [{estado:'revocado'},{usuario_id:UUID(88)},{id:'fabricado'}]){
  const h=harness();Object.assign(h.device,change);
  const r=await evalo(h);assert.equal(r.motivo,'DISPOSITIVO_NO_AUTORIZADO');
 }
});
test('solo hash del dispositivo entra al lector de permisos',async()=>{
 const h=harness();await evalo(h);
 assert.ok(h.audit.includes('buscarDispositivoPorHuella'));
 assert.equal(SHA(DEVICE).length,64);
});
test('lote no preparado o no presentado desde servidor se rechaza',async()=>{
 for(const change of [{estado:'BORRADOR'},{huella_alcance:'a'.repeat(64)},
  {usuario_id:UUID(88)},{nonce:UUID(44)}, {session_id:UUID(39)}]){
  const h=harness();Object.assign(h.saved,change);
  const r=await evalo(h);assert.equal(r.motivo,'LOTE_NO_PRESENTADO_POR_SERVIDOR');
 }
});
test('nonce consumido o no verificable se rechaza antes de fuentes Google',async()=>{
 const h=harness();h.fuentes.nonceNoConsumido=async()=>false;
 const r=await evalo(h);assert.equal(r.motivo,'NONCE_USADO_O_NO_VERIFICABLE');
 assert.ok(!h.audit.includes('leerCeldaHoja'));
});
test('registro T canónico ausente impide emitir prueba',async()=>{
 const h=harness();h.fuentes.leerVinculoT=async()=>null;
 const r=await evalo(h);assert.equal(r.motivo,'VINCULO_T_OBJETO_NO_ACREDITADO');
});
test('identidad basada en notas, PA o UUID no entra en el registro',async()=>{
 for(const origin of ['NOTA_UUID','PA_DFM','FILA_FISICA']){
  const h=harness();h.fuentes.leerVinculoT=async ({idFila})=>({
   spreadsheet_id:SHEET,id_fila:idFila,estado:'ACREDITADA',clase:'TRABAJO',
   origen_vinculo:origin,trabajo_sync_id:UUID(900)});
  const r=await evalo(h);assert.equal(r.motivo,'VINCULO_T_OBJETO_NO_ACREDITADO');
 }
});
test('clase de PARADA nunca es clase de TRABAJO',async()=>{
 const h=harness();h.fuentes.leerVinculoT=async ({idFila})=>({
  spreadsheet_id:SHEET,id_fila:idFila,estado:'ACREDITADA',clase:'PARADA',
  origen_vinculo:'ACUSE_T_CANONICO_VERIFICADO',trabajo_sync_id:UUID(900)});
 const r=await evalo(h);assert.equal(r.motivo,'VINCULO_T_OBJETO_NO_ACREDITADO');
});
test('relectura con revisión más reciente y mismo hash no es coincidencia',async()=>{
 const h=harness();h.fuentes.leerCeldaHoja=async({idFila})=>({
  spreadsheet_id:SHEET,id_fila:idFila,columna:'K',revision:8,hash:'b'.repeat(64)});
 const r=await evalo(h);assert.equal(r.motivo,'RELECTURA_HOJA_NO_COINCIDE');
});
test('relectura con otro valor y misma revisión tampoco pasa',async()=>{
 const h=harness();h.fuentes.leerCeldaHoja=async({idFila})=>({
  spreadsheet_id:SHEET,id_fila:idFila,columna:'K',revision:7,hash:'c'.repeat(64)});
 const r=await evalo(h);assert.equal(r.motivo,'RELECTURA_HOJA_NO_COINCIDE');
});
test('lote de dos T coteja cada celda de forma independiente',async()=>{
 const h=harness();h.solicitud.celdas.push(CELL(90002,5,'c'.repeat(64)));
 h.solicitud.huella_alcance=huellaAlcanceS12(h.solicitud.celdas);
 h.saved.huella_alcance=h.solicitud.huella_alcance;
 const r=await evalo(h);
 assert.equal(r.elementos,2);assert.equal(r.motivo,'CONTRATO_COTEJADO_NO_AUTORIZADO');
 assert.equal(h.audit.filter(x=>x==='leerVinculoT').length,2);
 cerrado(r);
});
test('errores del proveedor Auth/DB no divulgan credenciales',async()=>{
 const h=harness();h.fuentes.leerSesionAuth=async()=>{
  throw Error('service_role=secreto superprivado');
 };
 const r=await evalo(h);
 assert.equal(r.motivo,'SERVICIO_CONFIABLE_NO_VERIFICABLE');
 assert.ok(!JSON.stringify(r).includes('secreto'));cerrado(r);
});
test('nunca entrega IDs de usuario, JWT, dispositivo ni valores privados',async()=>{
 const h=harness(),r=await evalo(h),s=JSON.stringify(r);
 for(const v of [JWT,DEVICE,UUID(4),UUID(6),'b'.repeat(64)])assert.ok(!s.includes(v));
});
test('código no incluye red, secreto, acción de escritura ni rol privilegiado',()=>{
 const s=readFileSync(new URL('../shared/sincro12-autenticacion-lote-preflight.mjs',import.meta.url),'utf8');
 for(const rx of [/service_role/i,/fetch\s*\(/,/createClient\s*\(/,/SpreadsheetApp\./,
 /UrlFetchApp\./,/\bINSERT\s+INTO\b/i,/\bDELETE\s+FROM\b/i,/\bUPDATE\s+[a-z]/i,
 /\bauth\.getSession\s*\(/,/user_metadata/i])assert.doesNotMatch(s,rx);
});
