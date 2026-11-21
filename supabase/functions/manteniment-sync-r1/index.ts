import { BodyError, readJsonObject } from "../_shared/http-security.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

const preflightProtocol = "manteniment-preflight-v1";
const preflightRevision = "alpha75-preflight-2026.10.27.1";
const executionRevision = "MG75-EJECUCION-ORDEN-001";
const leaseRevision = "MG75-EJECUCION-LEASE-001";
const leasePreflightRevision = "alpha75-preflight-2026.11.08.2";
const executionScript = "alpha75-2026.10.26.1";
const executionReasons = [
  "AUTORIZADA", "EJECUTOR_NO_COMPATIBLE", "FUERA_DE_ALCANCE", "INSTALACION_NO_COMPATIBLE",
  "BARRERAS_CERRADAS", "ORDEN_NO_VIGENTE", "ORDEN_RETENIDA_O_CONFIRMADA", "ENTREGA_NO_ACREDITADA",
  "ORDEN_YA_CONFIRMADA", "ORDEN_NO_COINCIDE", "CONTINUIDAD_RETENIDA", "OPERACION_NO_PERMITIDA",
  "BAJA_MANUAL_PROTEGIDA",
];
const preflightReasons = [
  "VERSION_SCRIPT_DISTINTA", "VERSION_PREFLIGHT_DISTINTA", "CLIENTE_SIN_ESCRITURA_SEGURA",
  "ARCHIVO_DISTINTO", "RECEPTOR_NO_VERIFICADO", "BARRERAS_NO_CERRADAS",
];

function objectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function preflightVersionValid(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value)
    && !/mg_[0-9a-f]{64}/i.test(value);
}

function executionUuidValid(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function executionReferenceValid(value: unknown): value is Record<string, unknown> {
  return objectRecord(value) && exactKeys(value, ["tipo", "sync_id", "revision", "payload_sha256"])
    && ["parada", "trabajos"].includes(String(value.tipo))
    && typeof value.tipo === "string" && executionUuidValid(value.sync_id)
    && Number.isInteger(value.revision) && Number(value.revision) > 0 && Number(value.revision) <= 2147483647
    && typeof value.payload_sha256 === "string" && /^[0-9a-f]{64}$/.test(value.payload_sha256);
}

function sameExecutionReference(left: unknown, right: unknown) {
  return executionReferenceValid(left) && executionReferenceValid(right)
    && ["tipo", "sync_id", "revision", "payload_sha256"].every(key => left[key] === right[key]);
}

function executionReference(order: Record<string, unknown>) {
  return { tipo: order.tipo, sync_id: order.sync_id, revision: order.revision, payload_sha256: order.payload_sha256 };
}

function executionRequestValid(body: Record<string, unknown>, input: unknown) {
  if (!exactKeys(body, ["action", "token", "payload"]) || body.action !== "authorize"
    || typeof body.token !== "string" || !objectRecord(input)
    || !exactKeys(input, ["version_script", "version_ejecucion", "escritura_segura_manual", "spreadsheet_id", "request_id", "alcance", "orden"])
    || !preflightVersionValid(input.version_script) || !preflightVersionValid(input.version_ejecucion)
    || typeof input.escritura_segura_manual !== "boolean"
    || typeof input.spreadsheet_id !== "string" || !/^[A-Za-z0-9_-]{20,150}$/.test(input.spreadsheet_id)
    || !executionUuidValid(input.request_id) || !Array.isArray(input.alcance)
    || input.alcance.length < 1 || input.alcance.length > 200
    || input.alcance.some(ref => !executionReferenceValid(ref))
    || !objectRecord(input.orden) || !exactKeys(input.orden, ["tipo", "sync_id", "revision", "payload_sha256", "payload"])
    || !executionReferenceValid(executionReference(input.orden)) || !objectRecord(input.orden.payload)) return false;
  return new Set(input.alcance.map(ref => JSON.stringify(executionReference(ref)))).size === input.alcance.length;
}

function exactUtcMilliseconds(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}

function executionResultValid(value: unknown, input: Record<string, unknown>, started: number, secrets: string[]) {
  if (!objectRecord(value) || !exactKeys(value, [
    "protocolo", "version_ejecucion", "version_script", "solo_lectura", "request_id", "spreadsheet_id",
    "alcance", "orden", "autorizada", "motivo", "autorizado_en", "expira_en",
  ]) || value.protocolo !== "manteniment-ejecucion-v1" || value.solo_lectura !== true
    || value.version_ejecucion !== input.version_ejecucion || value.version_script !== input.version_script
    || value.request_id !== input.request_id || value.spreadsheet_id !== input.spreadsheet_id
    || !sameExecutionReference(value.orden, executionReference(input.orden as Record<string, unknown>))
    || !Array.isArray(value.alcance) || !Array.isArray(input.alcance) || value.alcance.length !== input.alcance.length
    || value.alcance.some((ref, index) => !sameExecutionReference(ref, (input.alcance as unknown[])[index]))
    || typeof value.autorizada !== "boolean" || typeof value.motivo !== "string"
    || !executionReasons.includes(value.motivo) || value.autorizada !== (value.motivo === "AUTORIZADA")) return false;
  const issued = exactUtcMilliseconds(value.autorizado_en), expires = exactUtcMilliseconds(value.expira_en);
  const now = Date.now();
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued < started - 5000 || issued > now + 5000
    || expires - issued !== (value.autorizada ? 30000 : 0)) return false;
  if (value.autorizada && (expires <= now || input.version_ejecucion !== executionRevision
    || input.version_script !== executionScript || input.escritura_segura_manual !== true
    || !input.alcance.some(ref => sameExecutionReference(ref, value.orden)))) return false;
  const serialized = JSON.stringify(value);
  return !/mg_[0-9a-f]{64}/i.test(serialized)
    && !secrets.some(secret => secret && serialized.includes(secret));
}

function executionAckRequestValid(body: Record<string, unknown>, input: unknown) {
  if (!exactKeys(body, ["action", "token", "payload"]) || body.action !== "ack_execution"
    || typeof body.token !== "string" || !objectRecord(input)
    || !exactKeys(input, ["version_ejecucion", "spreadsheet_id", "request_id", "confirmacion"])
    || input.version_ejecucion !== executionRevision || !executionUuidValid(input.request_id)
    || typeof input.spreadsheet_id !== "string" || !/^[A-Za-z0-9_-]{20,150}$/.test(input.spreadsheet_id)
    || !objectRecord(input.confirmacion) || input.confirmacion.estado !== "aplicado"
    || !executionReferenceValid(executionReference(input.confirmacion))) return false;
  return Object.keys(input.confirmacion).every(key => [
    "tipo", "sync_id", "revision", "payload_sha256", "estado", "fila", "trabajos_asignados",
    "ajustes_24h", "filas_archivo_enlazadas", "trabajos_creados",
  ].includes(key));
}

function executionAckResultValid(value: unknown, input: Record<string, unknown>) {
  return objectRecord(value) && exactKeys(value, ["protocolo", "version_ejecucion", "request_id", "spreadsheet_id", "confirmada", "orden"])
    && value.protocolo === "manteniment-acuse-ejecucion-v1" && value.version_ejecucion === executionRevision
    && value.request_id === input.request_id && value.spreadsheet_id === input.spreadsheet_id && value.confirmada === true
    && sameExecutionReference(value.orden, executionReference(input.confirmacion as Record<string, unknown>));
}

function scopeStatusRequestValid(body: Record<string, unknown>, input: unknown) {
  if (!exactKeys(body, ["action", "token", "payload"]) || body.action !== "scope_status"
    || typeof body.token !== "string" || !objectRecord(input)
    || !exactKeys(input, ["version_ejecucion", "spreadsheet_id", "alcance"])
    || input.version_ejecucion !== executionRevision
    || typeof input.spreadsheet_id !== "string" || !/^[A-Za-z0-9_-]{20,150}$/.test(input.spreadsheet_id)
    || !Array.isArray(input.alcance) || input.alcance.length < 1 || input.alcance.length > 200
    || input.alcance.some(ref => !executionReferenceValid(ref))) return false;
  return new Set(input.alcance.map(ref => JSON.stringify(executionReference(ref)))).size === input.alcance.length;
}

function scopeStatusResultValid(value: unknown, input: Record<string, unknown>, secrets: string[]) {
  if (!objectRecord(value) || !exactKeys(value, ["protocolo","version_ejecucion","spreadsheet_id","solo_lectura","referencias"])
    || value.protocolo !== "manteniment-conciliar-alcance-v1"
    || value.version_ejecucion !== input.version_ejecucion
    || value.spreadsheet_id !== input.spreadsheet_id || value.solo_lectura !== true
    || !Array.isArray(value.referencias) || !Array.isArray(input.alcance)
    || value.referencias.length !== input.alcance.length) return false;
  for (let i=0;i<value.referencias.length;i++) {
    const item=value.referencias[i];
    if (!objectRecord(item) || !exactKeys(item,["tipo","sync_id","revision","payload_sha256","estado"])
      || !executionReferenceValid(executionReference(item))
      || !sameExecutionReference(executionReference(item),(input.alcance as unknown[])[i])
      || !["VIGENTE","NO_VIGENTE","DUDOSA"].includes(String(item.estado))) return false;
  }
  const serialized=JSON.stringify(value);
  return !/mg_[0-9a-f]{64}/i.test(serialized) && !secrets.some(secret=>secret && serialized.includes(secret));
}


function leasePreflightRequestValid(body: Record<string, unknown>, client: unknown) {
  return exactKeys(body, ["action","token","payload"]) && body.action === "preflight_lease"
    && typeof body.token === "string" && objectRecord(client)
    && exactKeys(client, ["version_script","version_preflight","version_lease","escritura_segura_manual","spreadsheet_id"])
    && preflightVersionValid(client.version_script)
    && client.version_preflight === leasePreflightRevision
    && client.version_lease === leaseRevision
    && client.escritura_segura_manual === true
    && typeof client.spreadsheet_id === "string"
    && /^[A-Za-z0-9_-]{20,150}$/.test(client.spreadsheet_id);
}

function leaseOpenRequestValid(body: Record<string, unknown>, input: unknown) {
  return exactKeys(body, ["action","token","payload"]) && body.action === "open_lease"
    && typeof body.token === "string" && objectRecord(input)
    && exactKeys(input, ["protocolo","version_script","version_ejecucion","version_lease","spreadsheet_id","request_id","alcance"])
    && input.protocolo === leaseRevision && preflightVersionValid(input.version_script)
    && input.version_ejecucion === executionRevision && input.version_lease === leaseRevision
    && typeof input.spreadsheet_id === "string" && /^[A-Za-z0-9_-]{20,150}$/.test(input.spreadsheet_id)
    && executionUuidValid(input.request_id) && Array.isArray(input.alcance)
    && input.alcance.length >= 1 && input.alcance.length <= 200
    && input.alcance.every(executionReferenceValid);
}

function leaseSyncRequestValid(body: Record<string, unknown>, input: unknown) {
  return exactKeys(body, ["action","token","payload"]) && body.action === "sync_lease"
    && typeof body.token === "string" && objectRecord(input)
    && input.version_ejecucion === executionRevision && input.version_lease === leaseRevision
    && executionUuidValid(input.ejecucion_lease_id)
    && Array.isArray(input.filas) && input.filas.length <= 2500;
}

function leaseExecutionRequestValid(body: Record<string, unknown>, input: unknown, action: string) {
  if (!exactKeys(body, ["action","token","payload"]) || body.action !== action
    || typeof body.token !== "string" || !objectRecord(input)
    || input.version_lease !== leaseRevision || !executionUuidValid(input.lease_id)) return false;
  if (action === "authorize_lease") {
    const clean={...input}; delete clean.lease_id; delete clean.version_lease;
    return executionRequestValid({action:"authorize",token:body.token,payload:clean},clean);
  }
  if (action === "ack_lease") {
    const clean={...input}; delete clean.lease_id; delete clean.version_lease;
    return executionAckRequestValid({action:"ack_execution",token:body.token,payload:clean},clean);
  }
  return action === "close_lease"
    && exactKeys(input,["version_lease","lease_id","motivo"])
    && typeof input.motivo === "string" && input.motivo.trim().length >= 8 && input.motivo.trim().length <= 200;
}

function preflightRequestValid(body: Record<string, unknown>, client: unknown) {
  if (!exactKeys(body, ["action", "token", "payload"])
    || body.action !== "preflight" || typeof body.token !== "string"
    || !objectRecord(client)
    || !exactKeys(client, ["version_script", "version_preflight", "escritura_segura_manual", "spreadsheet_id"])) return false;
  return preflightVersionValid(client.version_script) && preflightVersionValid(client.version_preflight)
    && typeof client.escritura_segura_manual === "boolean"
    && typeof client.spreadsheet_id === "string"
    && /^[A-Za-z0-9_-]{20,150}$/.test(client.spreadsheet_id);
}

// The preflight response is a diagnostic contract, never permission to sync.
// Reject malformed/expanded responses rather than forward RPC output blindly.
function preflightResultValid(value: unknown, client: Record<string, unknown>, secrets: string[]) {
  if (!objectRecord(value) || !exactKeys(value, [
    "protocolo", "version_preflight", "solo_lectura", "compatible",
    "version_script_recibida", "version_script_esperada", "version_preflight_recibida",
    "cliente_escritura_segura_manual", "archivo_coincide", "receptor_coincide",
    "barreras", "barreras_cerradas", "sincronizacion_autorizada", "motivos",
  ])) return false;
  if (value.protocolo !== preflightProtocol || value.version_preflight !== preflightRevision
    || !preflightVersionValid(value.version_script_esperada)
    || value.solo_lectura !== true || value.sincronizacion_autorizada !== false
    || value.version_script_recibida !== client.version_script
    || value.version_preflight_recibida !== client.version_preflight
    || value.cliente_escritura_segura_manual !== client.escritura_segura_manual
    || typeof value.compatible !== "boolean" || typeof value.archivo_coincide !== "boolean"
    || typeof value.receptor_coincide !== "boolean" || typeof value.barreras_cerradas !== "boolean") return false;
  const barriers = value.barreras;
  if (!objectRecord(barriers) || !exactKeys(barriers, [
    "solo_lectura_manual_protegida", "escritura_segura_manual", "pausa_importacion_identidad",
  ]) || Object.values(barriers).some(flag => flag !== null && typeof flag !== "boolean")) return false;
  const closed = barriers.solo_lectura_manual_protegida === true
    && barriers.escritura_segura_manual === false && barriers.pausa_importacion_identidad === false;
  const compatible = client.version_script === value.version_script_esperada
    && client.version_preflight === preflightRevision && client.escritura_segura_manual === true
    && value.archivo_coincide === true && value.receptor_coincide === true;
  if (value.barreras_cerradas !== closed || value.compatible !== compatible) return false;
  if (!Array.isArray(value.motivos) || value.motivos.length > preflightReasons.length
    || new Set(value.motivos).size !== value.motivos.length
    || value.motivos.some(reason => typeof reason !== "string" || !preflightReasons.includes(reason))) return false;
  const expectedReasons: string[] = [];
  if (client.version_script !== value.version_script_esperada) expectedReasons.push("VERSION_SCRIPT_DISTINTA");
  if (client.version_preflight !== preflightRevision) expectedReasons.push("VERSION_PREFLIGHT_DISTINTA");
  if (client.escritura_segura_manual !== true) expectedReasons.push("CLIENTE_SIN_ESCRITURA_SEGURA");
  if (!value.archivo_coincide) expectedReasons.push("ARCHIVO_DISTINTO");
  if (!value.receptor_coincide) expectedReasons.push("RECEPTOR_NO_VERIFICADO");
  if (!closed) expectedReasons.push("BARRERAS_NO_CERRADAS");
  if (value.motivos.length !== expectedReasons.length
    || value.motivos.some(reason => !expectedReasons.includes(reason))) return false;
  const serialized = JSON.stringify(value);
  return !/mg_[0-9a-f]{64}/i.test(serialized)
    && !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(serialized)
    && !secrets.some(secret => secret && serialized.includes(secret));
}

const s13ReceiptProtocol = "sincro13-recibos-nuevos-v1";
function s13ReceiptRequestValid(body: Record<string, unknown>, value: unknown) {
  if (!exactKeys(body, ["action","token","payload"]) || body.action !== "ack_t_nuevas"
    || typeof body.token !== "string" || !objectRecord(value)
    || !exactKeys(value, ["version_ejecucion","spreadsheet_id","request_id","orden","recibos"])
    || value.version_ejecucion !== executionRevision
    || typeof value.spreadsheet_id !== "string"
    || !/^[A-Za-z0-9_-]{20,150}$/.test(value.spreadsheet_id)
    || !executionUuidValid(value.request_id) || !executionReferenceValid(value.orden)
    || !Array.isArray(value.recibos) || value.recibos.length < 1 || value.recibos.length > 8) return false;
  const seenT = new Set<number>(), seenWork = new Set<string>();
  for (const item of value.recibos) {
    if (!objectRecord(item)
      || !exactKeys(item,["id_fila","trabajo_sync_id","creado_en","origen","estado"])
      || !Number.isSafeInteger(item.id_fila) || (item.id_fila as number) <= 0
      || !executionUuidValid(item.trabajo_sync_id)
      || typeof item.creado_en !== "string"
      || !Number.isFinite(exactUtcMilliseconds(item.creado_en))
      || Date.parse(item.creado_en) < Date.parse("2026-11-15T23:00:00.000Z")
      || Date.parse(item.creado_en) > Date.now() + 5 * 60 * 1000
      || item.origen !== "ORDEN_AUTORIZADA"
      || item.estado !== "PENDIENTE_COTEJO_OBJETO") return false;
    const uuid = (item.trabajo_sync_id as string).toLowerCase();
    if (seenT.has(item.id_fila as number) || seenWork.has(uuid)) return false;
    seenT.add(item.id_fila as number); seenWork.add(uuid);
  }
  return true;
}
function s13ReceiptResultValid(value: unknown, input: Record<string, unknown>, secrets: string[]) {
  if (!objectRecord(value) || !exactKeys(value,[
    "protocolo","request_id","spreadsheet_id","recibidos","estado","autoriza_sincronizar"
  ]) || value.protocolo !== s13ReceiptProtocol
    || value.request_id !== input.request_id
    || value.spreadsheet_id !== input.spreadsheet_id
    || !Array.isArray(input.recibos) || value.recibidos !== input.recibos.length
    || value.estado !== "PENDIENTE_VERIFICACION_GOOGLE"
    || value.autoriza_sincronizar !== false) return false;
  const raw = JSON.stringify(value);
  return !/mg_[0-9a-f]{64}/i.test(raw)
    && !secrets.some(secret => secret && raw.includes(secret));
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return reply(405, { ok: false, error: "Método no permitido." });
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return reply(415, { ok: false, error: "Se requiere contenido JSON." });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 4_000_000) {
    return reply(413, { ok: false, error: "El envío supera el tamaño permitido." });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, 4_000_000);
  } catch (error) {
    return reply(error instanceof BodyError ? error.status : 400, { ok: false, error: error instanceof BodyError ? error.message : "JSON no válido." });
  }

  const token = String(body.token || "").trim();
  const action = String(body.action || "sync").trim().toLowerCase();
  const payload = body.payload as Record<string, unknown> | undefined;
  const rows = Array.isArray(payload?.filas) ? payload.filas : null;
  const works = Array.isArray(payload?.trabajos) ? payload.trabajos : [];

  if (!/^mg_[0-9a-f]{64}$/i.test(token)) {
    return reply(401, { ok: false, error: "Clave de conexión no válida." });
  }
  if (!["sync","ack","preflight","authorize","ack_execution","scope_status",
    "preflight_lease","open_lease","sync_lease","authorize_lease","ack_lease","close_lease","ack_t_nuevas"].includes(action)) {
    return reply(400, { ok: false, error: "Acción de sincronización no válida." });
  }
  if (action === "preflight_lease" && !leasePreflightRequestValid(body, payload)) {
    return reply(400,{ok:false,error:"Solicitud de preflight lease no válida."});
  }
  if (action === "open_lease" && !leaseOpenRequestValid(body, payload)) {
    return reply(400,{ok:false,error:"Solicitud de apertura de lease no válida."});
  }
  if (action === "sync_lease" && !leaseSyncRequestValid(body, payload)) {
    return reply(400,{ok:false,error:"Solicitud de sincronización con lease no válida."});
  }
  if (action === "authorize_lease" && !leaseExecutionRequestValid(body,payload,"authorize_lease")) {
    return reply(400,{ok:false,error:"Solicitud de autorización con lease no válida."});
  }
  if (action === "ack_lease" && !leaseExecutionRequestValid(body,payload,"ack_lease")) {
    return reply(400,{ok:false,error:"Acuse con lease no válido."});
  }
  if (action === "close_lease" && !leaseExecutionRequestValid(body,payload,"close_lease")) {
    return reply(400,{ok:false,error:"Cierre de lease no válido."});
  }
  if (action === "ack_t_nuevas" && !s13ReceiptRequestValid(body, payload)) {
    return reply(400,{ok:false,error:"Solicitud de recibo T no válida."});
  }
  if (action === "scope_status" && !scopeStatusRequestValid(body, payload)) {
    return reply(400, { ok: false, error: "Solicitud de conciliación de alcance no válida." });
  }
  if (action === "preflight" && !preflightRequestValid(body, payload)) {
    return reply(400, { ok: false, error: "Solicitud de comprobación previa no válida." });
  }
  if (action === "authorize" && !executionRequestValid(body, payload)) {
    return reply(400, { ok: false, error: "Solicitud de autorización de ejecución no válida." });
  }
  if (action === "ack_execution" && !executionAckRequestValid(body, payload)) {
    return reply(400, { ok: false, error: "Acuse de ejecución no válido." });
  }
  if (action === "sync" && (!payload || !rows)) {
    return reply(400, { ok: false, error: "No se ha recibido una fotografía válida de MANTENIMENT." });
  }
  if (action === "sync" && rows && rows.length > 2500) {
    return reply(400, { ok: false, error: "La fotografía contiene demasiadas filas." });
  }
  if (action === "sync" && payload?.version_ejecucion !== executionRevision) {
    return reply(400, { ok: false, error: "El ejecutor de MANTENIMENT debe actualizarse antes de sincronizar." });
  }
  if (works.length > 10000) return reply(400, { ok: false, error: "Demasiadas necesidades de mantenimiento." });
  const confirmations = Array.isArray(body.confirmaciones) ? body.confirmaciones : null;
  if (action === "ack" && (!confirmations || confirmations.length > 500)) {
    return reply(400, { ok: false, error: "Las confirmaciones no tienen un formato válido." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return reply(500, { ok: false, error: "Configuración segura incompleta." });
  }

  if (action === "ack_t_nuevas") {
    try {
      // La RPC es un invoker público ejecutable solo por service_role;
      // el receptor PRIVADO valida token, entrega y trabajo canónico.
      const receiver = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const {data,error} = await receiver.rpc("sincro13_registrar_recibo_t", {
        p_token:token, p_solicitud:payload,
      });
      if (error) return reply(error.code === "28000" ? 401 : 400, {
        ok:false,error:error.code === "28000" ? "Clave de conexión no válida."
          : "No pudo conservarse el recibo T. No se ha confirmado la orden.",
      });
      if (!s13ReceiptResultValid(data,payload!,[token,serviceRoleKey])) {
        return reply(502,{ok:false,error:"Recibo T no verificable. No se ha confirmado la orden."});
      }
      return reply(200,{ok:true,recibos_t:data});
    } catch {
      return reply(502,{ok:false,error:"No se pudo completar la recepción de la T."});
    }
  }

  if (["preflight_lease","open_lease","sync_lease","authorize_lease","ack_lease","close_lease"].includes(action)) {
    try {
      const leaseClient=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
      const rpc = action === "preflight_lease" ? "preflight_manteniment_lease"
        : action === "open_lease" ? "abrir_lease_ejecucion_manteniment"
        : action === "sync_lease" ? "recibir_snapshot_manteniment_lease"
        : action === "authorize_lease" ? "autorizar_ejecucion_manteniment_lease"
        : action === "ack_lease" ? "confirmar_ejecucion_manteniment_lease"
        : "cerrar_lease_ejecucion_manteniment";
      const args = action === "preflight_lease" ? {p_token:token,p_cliente:payload}
        : action === "sync_lease" ? {p_token:token,p_payload:payload}
        : {p_token:token,p_solicitud:payload};
      const {data,error}=await leaseClient.rpc(rpc,args);
      if(error) return reply(error.code==="28000"?401:400,{
        ok:false,error:error.code==="28000"?"Clave de conexión no válida.":(error.message||"No se pudo completar la operación lease.")
      });
      if(!objectRecord(data)) return reply(502,{ok:false,error:"El servidor no devolvió un recibo lease válido."});
      const serialized=JSON.stringify(data);
      if(/mg_[0-9a-f]{64}/i.test(serialized) || serialized.includes(serviceRoleKey)) {
        return reply(502,{ok:false,error:"El recibo lease contiene información no permitida."});
      }
      const key = action==="preflight_lease" ? "preflight"
        : action==="open_lease" ? "lease"
        : action==="sync_lease" ? "resultado"
        : action==="authorize_lease" ? "autorizacion"
        : action==="ack_lease" ? "confirmacion" : "cierre";
      return reply(200,{ok:true,[key]:data,recibido_en:new Date().toISOString()});
    } catch {
      return reply(502,{ok:false,error:"No se pudo completar la operación lease."});
    }
  }

  if (action === "scope_status") {
    try {
      const diagnostic = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await diagnostic.rpc("conciliar_alcance_manteniment", {
        p_token: token, p_solicitud: payload,
      });
      if (error) return reply(error.code === "28000" ? 401 : 400, {
        ok: false, error: error.code === "28000" ? "Clave de conexión no válida."
          : "No se pudo conciliar el alcance seleccionado.",
      });
      if (!scopeStatusResultValid(data,payload!,[token,serviceRoleKey])) {
        return reply(502,{ok:false,error:"El servidor no devolvió una conciliación de alcance válida."});
      }
      return reply(200,{ok:true,conciliacion:data});
    } catch {
      return reply(502,{ok:false,error:"No se pudo completar la conciliación de alcance."});
    }
  }

  // Return before the sync/ack branch. This route calls only a read-only RPC.
  if (action === "preflight") {
    try {
      const diagnostic = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await diagnostic.rpc("preflight_manteniment", {
        p_token: token,
        p_cliente: payload,
      });
      if (error) {
        return reply(error.code === "28000" ? 401 : 400, {
          ok: false,
          error: error.code === "28000"
            ? "Clave de conexión no válida para la comprobación previa."
            : "No se pudo completar la comprobación previa de solo lectura.",
        });
      }
      if (!preflightResultValid(data, payload!, [token, serviceRoleKey])) {
        return reply(502, { ok: false, error: "El servidor no confirmó una comprobación previa válida de solo lectura." });
      }
      return reply(200, { ok: true, preflight: data, recibido_en: new Date().toISOString() });
    } catch {
      return reply(502, { ok: false, error: "No se pudo completar la comprobación previa de solo lectura." });
    }
  }

  // Each new route has a distinct RPC and an exact, bounded receipt. authorize
  // performs only reads. ack_execution confirms an already applied receipt;
  // neither route can fall through to the snapshot receiver or legacy ACK.
  if (action === "authorize" || action === "ack_execution") {
    const started = Date.now();
    try {
      const execution = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await execution.rpc(action === "authorize"
        ? "autorizar_ejecucion_manteniment" : "confirmar_ejecucion_manteniment", {
        p_token: token, p_solicitud: payload,
      });
      if (error) {
        return reply(error.code === "28000" ? 401 : 400, {
          ok: false, error: error.code === "28000" ? "Clave de conexión no válida."
            : action === "authorize" ? "No se pudo autorizar la ejecución de la orden."
            : "No se pudo acreditar la confirmación exacta de la orden.",
        });
      }
      const valid = action === "authorize"
        ? executionResultValid(data, payload!, started, [token, serviceRoleKey])
        : executionAckResultValid(data, payload!);
      if (!valid) return reply(502, { ok: false, error: "El servidor no devolvió un recibo de ejecución válido." });
      return reply(200, action === "authorize" ? { ok: true, autorizacion: data } : { ok: true, confirmacion: data });
    } catch {
      return reply(502, { ok: false, error: "No se pudo completar la comprobación de ejecución." });
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = action === "ack"
    ? await admin.rpc("confirmar_comandos_manteniment", {
        p_token: token,
        p_confirmaciones: confirmations,
      })
    : await admin.rpc("recibir_snapshot_manteniment", {
        p_token: token,
        p_payload: payload,
      });

  if (error) {
    const unauthorized = /clave de conexión|no está activada/i.test(error.message || "");
    return reply(unauthorized ? 401 : 400, {
      ok: false,
      error: error.message || "No se pudo aplicar la actualización de MANTENIMENT.",
    });
  }

  // Preserve the deployed v6 behavior: an RPC success is not an import success.
  if (action === "sync") {
    const result = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown>
      : null;
    if (!result || result.ok !== true) {
      const rejected = result?.ok === false;
      return reply(rejected ? 400 : 502, {
        ok: false,
        error: rejected && typeof result.error === "string" && result.error.trim()
          ? result.error
          : "El servidor no confirmó la importación de MANTENIMENT.",
        ...(rejected ? { resultado: result } : {}),
        recibido_en: new Date().toISOString(),
      });
    }
  }

  return reply(200, action === "ack"
    ? { ok: true, confirmacion: data, recibido_en: new Date().toISOString() }
    : { ok: true, resultado: data, recibido_en: new Date().toISOString() });
});
