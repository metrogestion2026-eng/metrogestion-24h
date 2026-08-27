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

function cleanName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function initialPermissions(role: string): Record<string, unknown> {
  const permissions: Record<string, unknown> = {
    activar24h: { ver: true, editar: true },
    hotel: { ver: true, editar: false },
    t_programadas: { ver: true, editar: false },
    reservas: { ver: true, editar: false },
    historico: { ver: true, editar: false },
    talleres: { ver: true, editar: false },
    resumen: { ver: true, editar: false },
    documentacion: { ver: true, editar: false },
    usuarios: { ver: true, editar: false },
    listados: { ver: true, editar: false },
  };

  if (role === "administrador_secundario") {
    permissions.incidencias = { ver_todas: false, editar_todas: false };
  }

  return permissions;
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

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) {
    return respond(401, { error: "Sesión caducada o no válida." });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: caller, error: callerError } = await admin
    .from("usuarios")
    .select("id,tipo_usuario,activo")
    .eq("id", authData.user.id)
    .single();

  if (
    callerError ||
    !caller ||
    caller.activo !== true ||
    caller.tipo_usuario !== "administrador_principal"
  ) {
    return respond(403, { error: "Solo el administrador principal puede gestionar usuarios." });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: "Datos no válidos." });
  }

  const action = String(payload.accion || "").trim();

  if (action === "crear_usuario") {
    const fullName = cleanName(payload.nombreCompleto);
    const phone = String(payload.telefono || "").trim();
    const email = String(payload.correo || "").trim().toLowerCase();
    const password = String(payload.clave || "");
    const role = payload.rol === "administrador_secundario"
      ? "administrador_secundario"
      : "usuario";
    const phoneDigits = phone.replace(/\D/g, "");
    const parts = fullName.split(" ").filter(Boolean);
    const firstName = parts.shift() || "";
    const lastName = parts.join(" ");

    if (!firstName || phoneDigits.length < 9 || !validEmail(email) || password.length < 6 || password.length > 72) {
      return respond(400, {
        error: "Nombre, teléfono, correo y contraseña deben tener un formato válido. La contraseña necesita al menos 6 caracteres.",
      });
    }

    const { data: emailMatch, error: emailCheckError } = await admin
      .from("usuarios")
      .select("id")
      .eq("correo", email)
      .limit(1);
    if (emailCheckError) return respond(500, { error: "No se pudo comprobar el correo." });
    if (emailMatch?.length) return respond(409, { error: "Ese correo ya pertenece a otra cuenta." });

    const { data: phoneMatch, error: phoneCheckError } = await admin
      .from("usuarios")
      .select("id")
      .eq("telefono", phone)
      .limit(1);
    if (phoneCheckError) return respond(500, { error: "No se pudo comprobar el teléfono." });
    if (phoneMatch?.length) return respond(409, { error: "Ese teléfono ya pertenece a otra cuenta." });

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre: firstName, apellidos: lastName, telefono: phone },
    });

    if (createError || !created.user) {
      const duplicate = /already|registered|exists/i.test(createError?.message || "");
      return respond(duplicate ? 409 : 400, {
        error: duplicate ? "Ese correo ya está registrado." : "No se pudo crear la cuenta segura.",
      });
    }

    const { data: profile, error: profileError } = await admin
      .from("usuarios")
      .upsert({
        id: created.user.id,
        nombre: firstName,
        apellidos: lastName,
        correo: email,
        telefono: phone,
        tipo_usuario: role,
        permisos: initialPermissions(role),
        activo: true,
      }, { onConflict: "id" })
      .select("id,nombre,apellidos,correo,telefono,tipo_usuario,permisos,activo,creado_en,actualizado_en")
      .single();

    if (profileError || !profile) {
      await admin.auth.admin.deleteUser(created.user.id);
      return respond(400, { error: "No se pudo completar el perfil. La cuenta incompleta ha sido anulada." });
    }

    return respond(201, { ok: true, usuario: profile });
  }

  if (action === "establecer_acceso_usuarios") {
    const targetId = String(payload.usuarioId || "").trim();
    const authorized = payload.autorizado === true;
    if (!targetId) return respond(400, { error: "Usuario no válido." });
    if (targetId === authData.user.id) {
      return respond(400, { error: "El administrador principal conserva siempre el acceso total." });
    }

    const { data: target, error: targetError } = await admin
      .from("usuarios")
      .select("id,tipo_usuario,permisos,activo")
      .eq("id", targetId)
      .single();
    if (targetError || !target) return respond(404, { error: "No se encontró la cuenta indicada." });
    if (target.tipo_usuario === "administrador_principal") {
      return respond(400, { error: "No se pueden limitar los permisos del administrador principal." });
    }

    const currentPermissions = target.permisos && typeof target.permisos === "object"
      ? { ...(target.permisos as Record<string, unknown>) }
      : {};
    currentPermissions.usuarios = { ver: authorized, editar: false };

    const { data: updated, error: updateError } = await admin
      .from("usuarios")
      .update({ permisos: currentPermissions })
      .eq("id", targetId)
      .select("id,nombre,apellidos,correo,telefono,tipo_usuario,permisos,activo,creado_en,actualizado_en")
      .single();
    if (updateError || !updated) return respond(400, { error: "No se pudo cambiar el acceso a Usuarios." });

    return respond(200, { ok: true, usuario: updated });
  }

  if (action === "establecer_activo") {
    const targetId = String(payload.usuarioId || "").trim();
    const active = payload.activo === true;
    if (!targetId) return respond(400, { error: "Usuario no válido." });
    if (targetId === authData.user.id) {
      return respond(400, { error: "El administrador principal no puede bloquear su propia cuenta." });
    }

    const { data: target, error: targetError } = await admin
      .from("usuarios")
      .select("id,tipo_usuario")
      .eq("id", targetId)
      .single();
    if (targetError || !target) return respond(404, { error: "No se encontró la cuenta indicada." });
    if (target.tipo_usuario === "administrador_principal") {
      return respond(400, { error: "No se puede bloquear al administrador principal." });
    }

    const { data: updated, error: updateError } = await admin
      .from("usuarios")
      .update({ activo: active })
      .eq("id", targetId)
      .select("id,nombre,apellidos,correo,telefono,tipo_usuario,permisos,activo,creado_en,actualizado_en")
      .single();
    if (updateError || !updated) return respond(400, { error: "No se pudo cambiar el estado de la cuenta." });

    if (!active) {
      await admin
        .from("dispositivos_usuario")
        .update({ estado: "revocado", observaciones: "Cuenta bloqueada por el administrador principal" })
        .eq("usuario_id", targetId)
        .eq("estado", "autorizado");
    }

    return respond(200, { ok: true, usuario: updated });
  }

  return respond(400, { error: "Acción no reconocida." });
});
