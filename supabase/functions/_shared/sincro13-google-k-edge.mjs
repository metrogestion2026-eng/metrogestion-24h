/**
 * SINCRO13 - Edge read-only HTTP handler. Always disabled by default.
 * Authenticates a Metroges administrator, obtains a separate Google
 * service-account read-only OAuth token, compares two Google snapshots.
 * Evidence registration is a SEPARATELY gated action, OFF by default.
 * It cannot approve K or write operational data.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reply(status,body) {
 return new Response(JSON.stringify(body),{
   status,headers:{'content-type':'application/json; charset=utf-8',
   'cache-control':'no-store','x-content-type-options':'nosniff'}
 });
}
function exact(obj,keys){
 return !!obj&&typeof obj==='object'&&!Array.isArray(obj)
   &&Object.keys(obj).length===keys.length
   &&Object.keys(obj).every(k=>keys.includes(k));
}
function blocked(status,reason) {
 return reply(status,{ok:false,motivo:reason,
   autor_google_acreditado:false,actor_editor_acreditado:false,
   adopcion_autorizada:false,autoriza_sincronizar:false});
}
export function crearHandlerGoogleK({createClient,env,fetcher,obtenerToken,cotejar}) {
 if(typeof createClient!=='function'||typeof env?.get!=='function'
   ||typeof fetcher!=='function'||typeof obtenerToken!=='function'
   ||typeof cotejar!=='function')throw Error('S13_DEPENDENCIAS_INCOMPLETAS');
 return async function(req){
  if(req.method!=='POST')return blocked(405,'METODO_NO_PERMITIDO');
  if(env.get('S13_GOOGLE_READER_ENABLED')!=='true')
    return blocked(503,'VERIFICADOR_NO_ACTIVADO');
  if(!String(req.headers.get('content-type')||'').toLowerCase().includes('application/json'))
    return blocked(415,'JSON_REQUERIDO');
  const length=Number(req.headers.get('content-length')||'0');
  if(!Number.isFinite(length)||length>1200)return blocked(413,'SOLICITUD_DEMASIADO_GRANDE');
  let body;
  try{
   const raw=await req.text();
   if(raw.length<2||raw.length>1200)return blocked(413,'SOLICITUD_NO_VALIDA');
   body=JSON.parse(raw);
  }catch{return blocked(400,'SOLICITUD_NO_VALIDA');}
  const emitEvidence=env.get('S13_GOOGLE_EVIDENCE_ENABLED')==='true';
  if(!(emitEvidence?exact(body,['id_fila','trabajo_sync_id','solicitud_id']):
     exact(body,['id_fila','trabajo_sync_id']))
    ||!Number.isSafeInteger(body.id_fila)||body.id_fila<=0
    ||typeof body.trabajo_sync_id!=='string'||!UUID.test(body.trabajo_sync_id)
    ||(emitEvidence&&(typeof body.solicitud_id!=='string'||!UUID.test(body.solicitud_id))))
    return blocked(400,'SOLICITUD_NO_VALIDA');
  const auth=req.headers.get('authorization')||'';
  if(!/^Bearer [A-Za-z0-9_.-]{40,4096}$/.test(auth))
    return blocked(401,'USUARIO_NO_AUTENTICADO');
  const supabaseUrl=env.get('SUPABASE_URL'),
    publishable=env.get('SUPABASE_ANON_KEY')||env.get('SUPABASE_PUBLISHABLE_KEY');
  const book=env.get('S13_GOOGLE_SPREADSHEET_ID');
  const acct=env.get('S13_GOOGLE_SERVICE_ACCOUNT_JSON');
  if(!supabaseUrl||!publishable||!book||!acct)
    return blocked(503,'VERIFICADOR_SIN_CONFIGURACION');
  try {
   // The Supabase Auth server authenticates the user JWT. Do not derive a
   // user from caller-supplied user_id, email, note or Apps Script token.
   const jwt=auth.slice(7);
   const device=req.headers.get('x-device-token')||'';
   const userClient=createClient(supabaseUrl,publishable,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:auth,'x-device-token':device}}
   });
   const userResult=await userClient.auth.getUser(jwt);
   const uid=userResult?.data?.user?.id;
   if(userResult?.error||typeof uid!=='string'||!UUID.test(uid))
     return blocked(401,'USUARIO_NO_AUTENTICADO');
   for(const rpc of ['usuario_activo','dispositivo_autorizado','es_administrador_principal']){
      const result=await userClient.rpc(rpc);
      if(result.error||result.data!==true)
        return blocked(403,'SIN_PERMISO_DE_VERIFICACION');
   }
   const token=await obtenerToken({
      serviceAccountJson:acct,fetcher,cryptoImpl:crypto,nowMs:Date.now()
   });
   const data=await cotejar({
      fetcher,accessToken:token,spreadsheetId:book,
      id_fila:body.id_fila,trabajo_sync_id:body.trabajo_sync_id
   });
   if(data?.estado!=='COTEJO_T_K_SIN_AUTORIA'
     ||data?.origen!=='GOOGLE_SHEETS_API_SOLO_LECTURA'
     ||data?.lecturas_independientes!==2
     ||data?.autoriza_sincronizar!==false
     ||data?.actor_editor_acreditado!==false)
      return blocked(409,data?.motivo||'LECTURA_INSUFICIENTE');
   // Caller cannot submit the K value: it comes only from the two server
   // Google Sheets API readbacks. The SQL receiver obtains K base itself.
   if(data.id_fila!==body.id_fila
      ||data.trabajo_sync_id!==body.trabajo_sync_id.toLowerCase()
      ||data.columna!=='K'
      ||typeof data.valor_nuevo!=='string'
      ||!/^\d{4}-\d{2}-\d{2}$/.test(data.valor_nuevo))
      return blocked(409,'LECTURA_GOOGLE_NO_COINCIDE');
   const lectura={
      protocolo:data.protocolo,estado:data.estado,
      id_fila:data.id_fila,trabajo_sync_id:data.trabajo_sync_id,
      columna:'K',valor_nuevo:data.valor_nuevo,lecturas_independientes:2,
      actor_editor_acreditado:false,adopcion_autorizada:false,
      autoriza_sincronizar:false,escritura_realizada:false
   };
   if(!emitEvidence)return reply(200,{ok:true,lectura});

   // Second OFF-by-default gate: independently configured secret and a
   // private RPC, separate from Apps Script. Even a valid read cannot
   // execute CAS or approve itself.
   const key=env.get('S13_GOOGLE_VERIFIER_SECRET'),
      serviceRole=env.get('SUPABASE_SERVICE_ROLE_KEY');
   if(typeof key!=='string'||!/^s13g_[0-9a-f]{64}$/.test(key)||!serviceRole)
      return blocked(503,'REGISTRO_EVIDENCIA_SIN_CONFIGURACION');
   const server=createClient(supabaseUrl,serviceRole,{
      auth:{persistSession:false,autoRefreshToken:false}
   });
   const observedAt=new Date().toISOString();
   const {data:proof,error:proofError}=await server.rpc(
      'sincro13_recibir_lectura_google_k',{
         p_clave:key,
         p_lectura:{
            protocolo:data.protocolo,solicitud_id:body.solicitud_id,
            spreadsheet_id:book,id_fila:data.id_fila,
            trabajo_sync_id:data.trabajo_sync_id,columna:'K',
            valor_nuevo:data.valor_nuevo,observado_en:observedAt,
            lecturas_independientes:2,editor_google_acreditado:false,
            escritura_realizada:false
         }
      });
   if(proofError||!proof||proof.protocolo!=='sincro13-evidencia-k-v1'
      ||proof.autoriza_sincronizar!==false)
      return blocked(502,'EVIDENCIA_NO_REGISTRADA');
   if(proof.estado==='SIN_CAMBIO')
      return reply(200,{ok:true,lectura,evidencia:{
         estado:'SIN_CAMBIO',autoriza_sincronizar:false
      }});
   if(proof.estado!=='PENDIENTE_ADOPCION'
      ||proof.id_fila!==data.id_fila
      ||proof.trabajo_sync_id!==data.trabajo_sync_id
      ||proof.valor_nuevo!==data.valor_nuevo
      ||proof.solicitud_id!==body.solicitud_id
      ||typeof proof.evidencia_id!=='string'||!UUID.test(proof.evidencia_id)
      ||typeof proof.evidencia_sha256!=='string'
      ||!/^[0-9a-f]{64}$/.test(proof.evidencia_sha256))
      return blocked(502,'EVIDENCIA_NO_VERIFICABLE');
   return reply(200,{ok:true,lectura,evidencia:{
      estado:'PENDIENTE_ADOPCION',id_fila:data.id_fila,
      evidencia_id:proof.evidencia_id,solicitud_id:body.solicitud_id,
      valor_base:proof.valor_base,valor_nuevo:data.valor_nuevo,
      evidencia_sha256:proof.evidencia_sha256,
      editor_google_acreditado:false,
      autoriza_sincronizar:false,escritura_realizada:false
   }});
  }catch{
   return blocked(502,'GOOGLE_O_AUTENTICACION_NO_VERIFICABLE');
  }
 };
}
