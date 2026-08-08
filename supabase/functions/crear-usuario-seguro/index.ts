import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://metrogestion2026-eng.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: 'Configuración segura incompleta.' });
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { error: 'Sesión no válida.' });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json(401, { error: 'Sesión caducada o no válida.' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: caller, error: callerError } = await admin
    .from('usuarios')
    .select('id,tipo_usuario,activo')
    .eq('id', authData.user.id)
    .single();

  if (callerError || !caller || caller.activo !== true || caller.tipo_usuario !== 'administrador_principal') {
    return json(403, { error: 'Solo el administrador principal puede crear usuarios.' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: 'Datos de usuario no válidos.' });
  }

  const nombreCompleto = String(payload.nombreCompleto || '').trim().replace(/\s+/g, ' ');
  const telefono = String(payload.telefono || '').trim();
  const correo = String(payload.correo || '').trim().toLowerCase();
  const pin = String(payload.pin || '').trim();
  const rol = payload.rol === 'secondary' ? 'administrador_secundario' : 'usuario';

  const partes = nombreCompleto.split(' ');
  const nombre = partes.shift() || '';
  const apellidos = partes.join(' ');
  const phoneDigits = telefono.replace(/\D/g, '');

  if (!nombre || phoneDigits.length < 9 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || !/^\d{4,6}$/.test(pin)) {
    return json(400, { error: 'Nombre, teléfono, correo y PIN no tienen un formato válido.' });
  }

  const { data: duplicate } = await admin
    .from('usuarios')
    .select('id')
    .or(`correo.eq.${correo},telefono.eq.${telefono}`)
    .limit(1);
  if (duplicate?.length) return json(409, { error: 'Ese correo o teléfono ya pertenece a otra cuenta.' });

  const permisos = rol === 'administrador_secundario'
    ? { incidencias: { ver_todas: false, editar_todas: false } }
    : {};

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: correo,
    password: pin,
    email_confirm: true,
    user_metadata: { nombre, apellidos, telefono },
  });

  if (createError || !created.user) {
    const duplicateMessage = /already|registered|exists/i.test(createError?.message || '');
    return json(duplicateMessage ? 409 : 400, {
      error: duplicateMessage ? 'Ese correo ya está registrado.' : 'No se pudo crear la cuenta segura.',
    });
  }

  const { error: profileError } = await admin.from('usuarios').insert({
    id: created.user.id,
    nombre,
    apellidos,
    telefono,
    correo,
    tipo_usuario: rol,
    permisos,
    activo: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json(400, { error: 'No se pudo completar el perfil. La cuenta incompleta ha sido anulada.' });
  }

  await admin.from('registro_accesos').insert({
    usuario_id: authData.user.id,
    accion: 'crear_usuario',
    modulo: 'usuarios',
    resultado: 'correcto',
    detalles: { usuario_creado: created.user.id, correo, rol },
  });

  return json(201, {
    ok: true,
    usuario: {
      id: created.user.id,
      nombre,
      apellidos,
      telefono,
      correo,
      tipo_usuario: rol,
      permisos,
      activo: true,
    },
  });
});
