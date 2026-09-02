import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
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
    body = await request.json();
  } catch {
    return reply(400, { ok: false, error: "El contenido no es un JSON válido." });
  }

  const token = String(body.token || "").trim();
  const action = String(body.action || "sync").trim().toLowerCase();
  const payload = body.payload as Record<string, unknown> | undefined;
  const rows = Array.isArray(payload?.filas) ? payload.filas : null;

  if (!/^mg_[0-9a-f]{64}$/i.test(token)) {
    return reply(401, { ok: false, error: "Clave de conexión no válida." });
  }
  if (!["sync", "ack"].includes(action)) {
    return reply(400, { ok: false, error: "Acción de sincronización no válida." });
  }
  if (action === "sync" && (!payload || !rows)) {
    return reply(400, { ok: false, error: "No se ha recibido una fotografía válida de MANTENIMENT." });
  }
  if (action === "sync" && rows && rows.length > 2500) {
    return reply(400, { ok: false, error: "La fotografía contiene demasiadas filas." });
  }
  const confirmations = Array.isArray(body.confirmaciones) ? body.confirmaciones : null;
  if (action === "ack" && (!confirmations || confirmations.length > 500)) {
    return reply(400, { ok: false, error: "Las confirmaciones no tienen un formato válido." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return reply(500, { ok: false, error: "Configuración segura incompleta." });
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

  return reply(200, action === "ack"
    ? { ok: true, confirmacion: data, recibido_en: new Date().toISOString() }
    : { ok: true, resultado: data, recibido_en: new Date().toISOString() });
});
