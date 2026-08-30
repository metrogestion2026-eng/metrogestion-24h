import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://metrogestion2026-eng.github.io";
const EVENTS = new Set(["vista_login", "credenciales_rechazadas", "comprobar_bloqueo"]);

function headers(origin: string | null) {
  const base: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
  };
  if (origin === ALLOWED_ORIGIN) {
    base["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
    base["Access-Control-Allow-Headers"] =
      "authorization, x-client-info, apikey, content-type, x-device-token";
    base["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    base["Access-Control-Max-Age"] = "600";
  }
  return base;
}

function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin !== ALLOWED_ORIGIN) {
    return reply(403, { ok: false, error: "Origen no permitido." }, origin);
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: headers(origin) });
  }
  if (request.method !== "POST") {
    return reply(405, { ok: false, error: "Método no permitido." }, origin);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return reply(415, { ok: false, error: "Se requiere contenido JSON." }, origin);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return reply(413, { ok: false, error: "Petición demasiado grande." }, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return reply(400, { ok: false, error: "JSON no válido." }, origin);
  }

  const fingerprint = String(body.huella || "").trim().toLowerCase();
  const event = String(body.evento || "").trim().toLowerCase();
  const route = String(body.ruta || "").trim().slice(0, 160);
  let email = String(body.correo || "").trim().toLowerCase().slice(0, 160);

  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    return reply(400, { ok: false, error: "Huella no válida." }, origin);
  }
  if (!EVENTS.has(event)) {
    return reply(400, { ok: false, error: "Evento no válido." }, origin);
  }
  if (event !== "credenciales_rechazadas" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    email = "";
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return reply(500, { ok: false, error: "Configuración segura incompleta." }, origin);
  }

  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim()
    || request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || "";
  const [fingerprintHash, ipHash] = await Promise.all([
    sha256(fingerprint),
    ip ? sha256(ip + "|" + serviceRoleKey.slice(-48)) : Promise.resolve(""),
  ]);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("registrar_intento_acceso_anonimo", {
    p_huella_hash: fingerprintHash,
    p_ip_hash: ipHash,
    p_correo: email,
    p_evento: event,
    p_agente: request.headers.get("user-agent") || "",
    p_ruta: route,
  });

  if (error) {
    return reply(400, { ok: false, error: "No se pudo comprobar el acceso." }, origin);
  }
  return reply(200, {
    ok: true,
    bloqueado: data?.bloqueado === true,
    comprobado_en: new Date().toISOString(),
  }, origin);
});
