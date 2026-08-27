import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function validNewPassword(value: string) {
  return value.length >= 8
    && value.length <= 72
    && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(value)
    && /\d/.test(value);
}

function randomTemporaryPassword() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const all = letters + digits;
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let middle = "";
  for (const byte of bytes) middle += all[byte % all.length];
  const digitBytes = new Uint8Array(2);
  crypto.getRandomValues(digitBytes);
  return `Mg-${middle}-${digits[digitBytes[0] % digits.length]}${digits[digitBytes[1] % digits.length]}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function secondPrecisionNow() {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
}

function jwtIssuedAtMs(authorization: string) {
  try {
    const token = authorization.replace(/^Bearer\s+/i, "");
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    const issuedAt = Number(payload?.iat);
    return Number.isFinite(issuedAt) ? issuedAt * 1000 : null;
  } catch {
    return null;
  }
}

function credentialIsCurrent(authorization: string, changedAt: unknown) {
  const issuedAt = jwtIssuedAtMs(authorization);
  const changedAtMs = Date.parse(String(changedAt || "1970-01-01T00:00:00Z"));
  return issuedAt !== null
    && Number.isFinite(changedAtMs)
    && issuedAt + 5000 >= changedAtMs;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Método no permitido." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(500, { error: "Configuración segura incompleta." });
  }

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return respond(401, { error: "Sesión no válida." });
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authorization,
        "x-device-token": request.headers.get("x-device-token") || "",
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) {
    return respond(401, { error: "Sesión caducada o no válida." });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profileError } = await admin
    .from("usuarios")
    .select("id,nombre,apellidos,correo,tipo_usuario,activo,debe_cambiar_clave,credenciales_actualizadas_en,clave_temporal_emitida_en,clave_temporal_emitida_por,ultimo_cambio_clave_en")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !profile || profile.activo !== true) {
    return respond(403, { error: "La cuenta no está activa." });
  }

  if (!credentialIsCurrent(authorization, profile.credenciales_actualizadas_en)) {
    return respond(401, {
      error: "Esta sesión pertenece a una contraseña anterior. Inicia sesión de nuevo con la contraseña vigente.",
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: "Datos no válidos." });
  }

  const action = String(payload.accion || "").trim();
  if (profile.debe_cambiar_clave === true && action !== "cambiar_clave_propia") {
    return respond(403, { error: "Debes sustituir la contraseña temporal antes de realizar otras operaciones." });
  }

  if (action === "cambiar_clave_propia") {
    const currentPassword = String(payload.claveActual || "");
    const newPassword = String(payload.claveNueva || "");

    if (!currentPassword) {
      return respond(400, { error: "Introduce la contraseña actual." });
    }
    if (!validNewPassword(newPassword)) {
      return respond(400, {
        error: "La nueva contraseña necesita entre 8 y 72 caracteres, al menos una letra y un número.",
      });
    }
    if (currentPassword === newPassword) {
      return respond(400, { error: "La nueva contraseña debe ser distinta de la actual." });
    }

    if (profile.tipo_usuario !== "administrador_principal" && profile.debe_cambiar_clave !== true) {
      const deviceToken = request.headers.get("x-device-token") || "";
      if (deviceToken.length < 32) {
        return respond(403, { error: "Este dispositivo no está autorizado para cambiar la contraseña." });
      }
      const tokenHash = await sha256Hex(deviceToken);
      const { data: device, error: deviceError } = await admin
        .from("dispositivos_usuario")
        .select("id")
        .eq("usuario_id", profile.id)
        .eq("token_hash", tokenHash)
        .eq("estado", "autorizado")
        .maybeSingle();
      if (deviceError || !device) {
        return respond(403, { error: "Este dispositivo no está autorizado para cambiar la contraseña." });
      }
    }

    const verifier = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: profile.correo,
      password: currentPassword,
    });
    if (verifyError) {
      return respond(400, { error: "La contraseña actual no es correcta." });
    }

    const credentialTime = secondPrecisionNow();
    const { error: updateAuthError } = await admin.auth.admin.updateUserById(profile.id, {
      password: newPassword,
    });
    if (updateAuthError) {
      return respond(400, { error: "No se pudo actualizar la contraseña segura." });
    }

    const { error: updateProfileError } = await admin
      .from("usuarios")
      .update({
        debe_cambiar_clave: false,
        credenciales_actualizadas_en: credentialTime,
        clave_temporal_emitida_en: null,
        clave_temporal_emitida_por: null,
        ultimo_cambio_clave_en: credentialTime,
      })
      .eq("id", profile.id);

    if (updateProfileError) {
      await admin.auth.admin.updateUserById(profile.id, { password: currentPassword });
      return respond(500, { error: "No se pudo completar el cambio. La contraseña anterior continúa activa." });
    }

    await admin.from("historial_seguridad_claves").insert({
      usuario_id: profile.id,
      actor_id: profile.id,
      accion: "cambio_propio",
      detalle: { obligatorio: profile.debe_cambiar_clave === true },
    });

    return respond(200, {
      ok: true,
      mensaje: "Contraseña cambiada. Debes iniciar sesión nuevamente.",
      cerrar_sesiones: true,
    });
  }

  if (action === "crear_clave_temporal") {
    if (profile.tipo_usuario !== "administrador_principal") {
      return respond(403, { error: "Solo el administrador principal puede crear contraseñas temporales." });
    }

    const targetId = String(payload.usuarioId || "").trim();
    if (!targetId) return respond(400, { error: "Usuario no válido." });
    if (targetId === profile.id) {
      return respond(400, { error: "Utiliza Cambiar contraseña para modificar tu propia clave." });
    }

    const { data: target, error: targetError } = await admin
      .from("usuarios")
      .select("id,nombre,apellidos,correo,tipo_usuario,activo,debe_cambiar_clave,credenciales_actualizadas_en,clave_temporal_emitida_en,clave_temporal_emitida_por,ultimo_cambio_clave_en")
      .eq("id", targetId)
      .single();
    if (targetError || !target) return respond(404, { error: "No se encontró la cuenta indicada." });
    if (target.tipo_usuario === "administrador_principal") {
      return respond(400, { error: "No se puede emitir una contraseña temporal para el administrador principal." });
    }

    const temporaryPassword = randomTemporaryPassword();
    const credentialTime = secondPrecisionNow();
    const oldProfile = {
      debe_cambiar_clave: target.debe_cambiar_clave,
      credenciales_actualizadas_en: target.credenciales_actualizadas_en,
      clave_temporal_emitida_en: target.clave_temporal_emitida_en,
      clave_temporal_emitida_por: target.clave_temporal_emitida_por,
      ultimo_cambio_clave_en: target.ultimo_cambio_clave_en,
    };

    const { error: markError } = await admin
      .from("usuarios")
      .update({
        debe_cambiar_clave: true,
        credenciales_actualizadas_en: credentialTime,
        clave_temporal_emitida_en: credentialTime,
        clave_temporal_emitida_por: profile.id,
      })
      .eq("id", target.id);
    if (markError) return respond(500, { error: "No se pudo preparar la contraseña temporal." });

    const { error: updateAuthError } = await admin.auth.admin.updateUserById(target.id, {
      password: temporaryPassword,
    });
    if (updateAuthError) {
      await admin.from("usuarios").update(oldProfile).eq("id", target.id);
      return respond(400, { error: "No se pudo establecer la contraseña temporal." });
    }

    await admin.from("historial_seguridad_claves").insert({
      usuario_id: target.id,
      actor_id: profile.id,
      accion: target.debe_cambiar_clave ? "temporal_sustituida" : "temporal_emitida",
      detalle: { cuenta_activa: target.activo === true },
    });

    return respond(200, {
      ok: true,
      usuario_id: target.id,
      usuario: [target.nombre, target.apellidos].filter(Boolean).join(" ").trim() || target.correo,
      correo: target.correo,
      clave_temporal: temporaryPassword,
      cambio_obligatorio: true,
      aviso: "La contraseña se muestra una sola vez. El usuario deberá cambiarla antes de acceder a Metrogestión.",
    });
  }

  return respond(400, { error: "Acción no reconocida." });
});
