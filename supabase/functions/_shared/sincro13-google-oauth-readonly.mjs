/**
 * SINCRO13 - Google service account OAuth2, read-only scope ONLY.
 * Credentials come only from server environment; never from the HTTP caller.
 * No JWT tokens, private keys or Google responses may be logged.
 */
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
function b64url(bytes) {
  let s='';
  for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function pemDecode(pem){
  if(typeof pem!=='string'||!/^-----BEGIN PRIVATE KEY-----\r?\n[A-Za-z0-9+\/=\r\n]+-----END PRIVATE KEY-----\r?\n?$/.test(pem))
    throw Error('S13_CREDENCIAL_SERVIDOR_INVALIDA');
  const text=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,'');
  if(text.length>13000||text.length<100)return new Uint8Array(0);
  const bin=atob(text);return Uint8Array.from(bin,c=>c.charCodeAt(0));
}
export async function obtenerGoogleTokenSoloLectura({serviceAccountJson,fetcher,cryptoImpl,nowMs}){
  if(typeof fetcher!=='function'||!cryptoImpl?.subtle
    ||typeof serviceAccountJson!=='string'||serviceAccountJson.length>20000)
    throw Error('S13_CREDENCIAL_SERVIDOR_NO_CONFIGURADA');
  let acct;
  try {acct=JSON.parse(serviceAccountJson);}
  catch{throw Error('S13_CREDENCIAL_SERVIDOR_INVALIDA');}
  if(acct?.type!=='service_account'
    ||typeof acct.client_email!=='string'
    ||!acct.client_email.endsWith('.gserviceaccount.com')
    ||acct.client_email.length>255
    ||acct.token_uri!==TOKEN_URL)
    throw Error('S13_CREDENCIAL_SERVIDOR_INVALIDA');
  let privateKey;
  try{
    const keyBytes=pemDecode(acct.private_key);
    privateKey=await cryptoImpl.subtle.importKey('pkcs8',keyBytes,{
      name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'
    },false,['sign']);
  }catch{throw Error('S13_CREDENCIAL_SERVIDOR_INVALIDA');}
  const now=Math.floor((nowMs??Date.now())/1000);
  if(!Number.isFinite(now)||now<1700000000)throw Error('S13_FECHA_SERVIDOR_INVALIDA');
  const encoder=new TextEncoder();
  const header=b64url(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload=b64url(encoder.encode(JSON.stringify({
    iss:acct.client_email,scope:SCOPE,aud:TOKEN_URL,iat:now,exp:now+900
  })));
  const signing=header+'.'+payload;
  const bytes=await cryptoImpl.subtle.sign(
    {name:'RSASSA-PKCS1-v1_5'},privateKey,encoder.encode(signing));
  const assertion=signing+'.'+b64url(new Uint8Array(bytes));
  const response=await fetcher(TOKEN_URL,{
    method:'POST',redirect:'error',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion
    }).toString()
  });
  if(response?.status!==200)throw Error('S13_GOOGLE_OAUTH_NO_AUTORIZADO');
  let result;
  try{result=await response.json();}catch{throw Error('S13_GOOGLE_OAUTH_NO_VERIFICABLE');}
  if(typeof result?.access_token!=='string'||result.access_token.length<12
    ||result.token_type?.toLowerCase()!=='bearer'
    ||!Number.isInteger(result.expires_in)||result.expires_in<60)
    throw Error('S13_GOOGLE_OAUTH_NO_VERIFICABLE');
  return result.access_token;
}
export const S13_GOOGLE_OAUTH_SCOPE = SCOPE;
