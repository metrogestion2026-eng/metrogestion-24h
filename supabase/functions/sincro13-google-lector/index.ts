import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.111.0';
import {crearHandlerGoogleK} from '../_shared/sincro13-google-k-edge.mjs';
import {obtenerGoogleTokenSoloLectura} from '../_shared/sincro13-google-oauth-readonly.mjs';
import {cotejarGoogleKDosLecturas} from '../_shared/sincro13-google-k-readonly.mjs';

// CANDIDATO NO DESPLEGADO. If installed without explicit setup, ALWAYS 503.
// Independent Google Sheets OAuth is READ ONLY and not the Apps Script token.
Deno.serve(crearHandlerGoogleK({
 createClient,env:Deno.env,fetcher:fetch,
 obtenerToken:obtenerGoogleTokenSoloLectura,
 cotejar:cotejarGoogleKDosLecturas
}));
