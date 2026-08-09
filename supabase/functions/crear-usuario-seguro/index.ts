import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders as supabaseCorsHeaders } from 'jsr:@supabase/supabase-js@2/cors';

const corsHeadersFor = (request: Request) => {
  const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
  return {
    ...supabaseCorsHeaders,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': requestedHeaders || 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin, Access-Control-Request-Headers',
  };
};

const json = (request: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(request), 'Content-Type': 'application/json; charset=utf-8' },
  });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersFor(request) });
  if (request.method !== 'POST') return json(request, 405, { error: 'Método no permitido.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(request, 500, { error: 'Configuración segura incompleta.' });
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return json(request, 401, { error: 'Sesión no válida.' });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json(request, 401, { error: 'Sesión caducada o no válida.' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: caller, error: callerError } = await admin
    .from('usuarios')
    .select('id,tipo_usuario,activo')
    .eq('id', authData.user.id)
    .single();

  if (callerError || !caller || caller.activo !== true || caller.tipo_usuario !== 'administrador_principal') {
    return json(request, 403, { error: 'Solo el administrador principal puede crear usuarios.' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json(request, 400, { error: 'Datos de usuario no válidos.' });
  }

  const nombreCompleto = String(payload.nombreCompleto || '').trim().replace(/\s+/g, ' ');
  const telefono = String(payload.telefono || '').trim();
  const correo = String(payload.correo || '').trim().toLowerCase();
  const pin = String(payload.pin || '').trim();
  const accion = String(payload.accion || 'crear_usuario');
  const rol = payload.rol === 'secondary' ? 'administrador_secundario' : 'usuario';
  const usuarioObjetivoId = String(payload.usuarioId || '').trim();

  const partes = nombreCompleto.split(' ');
  const nombre = partes.shift() || '';
  const apellidos = partes.join(' ');
  const phoneDigits = telefono.replace(/\D/g, '');

  if (accion === 'actualizar_administrador') {
    if (!nombre || phoneDigits.length < 9 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return json(request, 400, { error: 'Nombre, teléfono y correo no tienen un formato válido.' });
    }

    const { data: duplicate } = await admin
      .from('usuarios')
      .select('id')
      .neq('id', authData.user.id)
      .or(`correo.eq.${correo},telefono.eq.${telefono}`)
      .limit(1);
    if (duplicate?.length) return json(request, 409, { error: 'Ese correo o teléfono ya pertenece a otra cuenta.' });

    const { data: profile, error: updateError } = await admin
      .from('usuarios')
      .update({ nombre, apellidos, telefono, correo, actualizado_en: new Date().toISOString() })
      .eq('id', authData.user.id)
      .select('*')
      .single();
    if (updateError || !profile) return json(request, 400, { error: 'No se pudieron guardar los datos del administrador.' });

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(authData.user.id, {
      email: correo,
      user_metadata: { nombre, apellidos, telefono },
    });
    if (authUpdateError) return json(request, 400, { error: 'El perfil se guardó, pero no se pudo actualizar la cuenta de acceso.' });

    return json(request, 200, { ok: true, usuario: profile });
  }

  if (accion === 'actualizar_permiso_hotel') {
    const accesoHotel = String(payload.accesoHotel || 'ninguno');
    if (!usuarioObjetivoId || !['ninguno', 'ver', 'editar'].includes(accesoHotel)) {
      return json(request, 400, { error: 'Permiso de Hotel no válido.' });
    }
    if (usuarioObjetivoId === authData.user.id) {
      return json(request, 400, { error: 'El administrador principal conserva siempre acceso total.' });
    }
    const { data: target, error: targetError } = await admin
      .from('usuarios')
      .select('id,tipo_usuario,permisos,activo')
      .eq('id', usuarioObjetivoId)
      .single();
    if (targetError || !target) return json(request, 404, { error: 'No se encontró la cuenta indicada.' });
    if (target.tipo_usuario === 'administrador_principal') {
      return json(request, 400, { error: 'No se pueden limitar los permisos del administrador principal.' });
    }
    const permisosActuales = target.permisos && typeof target.permisos === 'object'
      ? target.permisos as Record<string, unknown>
      : {};
    const permisos = {
      ...permisosActuales,
      hotel: {
        ver: accesoHotel === 'ver' || accesoHotel === 'editar',
        editar: accesoHotel === 'editar',
      },
    };
    const { data: profile, error: permissionError } = await admin
      .from('usuarios')
      .update({ permisos, actualizado_en: new Date().toISOString() })
      .eq('id', usuarioObjetivoId)
      .select('*')
      .single();
    if (permissionError || !profile) return json(request, 400, { error: 'No se pudo guardar el permiso del Hotel.' });
    await admin.from('registro_accesos').insert({
      usuario_id: authData.user.id,
      accion: 'actualizar_permiso_hotel',
      modulo: 'usuarios',
      resultado: 'correcto',
      detalles: { usuario_objetivo: usuarioObjetivoId, acceso_hotel: accesoHotel },
    });
    return json(request, 200, { ok: true, usuario: profile });
  }

  if (!nombre || phoneDigits.length < 9 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || !/^\d{4,6}$/.test(pin)) {
    return json(request, 400, { error: 'Nombre, teléfono, correo y PIN no tienen un formato válido.' });
  }

  const { data: duplicate } = await admin
    .from('usuarios')
    .select('id')
    .or(`correo.eq.${correo},telefono.eq.${telefono}`)
    .limit(1);
  if (duplicate?.length) return json(request, 409, { error: 'Ese correo o teléfono ya pertenece a otra cuenta.' });

  const permisos = rol === 'administrador_secundario'
    ? { incidencias: { ver_todas: false, editar_todas: false }, hotel: { ver: false, editar: false } }
    : { hotel: { ver: false, editar: false } };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: correo,
    password: pin,
    email_confirm: true,
    user_metadata: { nombre, apellidos, telefono },
  });

  if (createError || !created.user) {
    const duplicateMessage = /already|registered|exists/i.test(createError?.message || '');
    return json(request, duplicateMessage ? 409 : 400, {
      error: duplicateMessage ? 'Ese correo ya está registrado.' : 'No se pudo crear la cuenta segura.',
    });
  }

  // Puede existir ya una fila creada por el trigger de Auth. Upsert evita que
  // esa fila provoque un falso fallo y la eliminación de la cuenta recién creada.
  const { error: profileError } = await admin.from('usuarios').upsert({
    id: created.user.id,
    nombre,
    apellidos,
    telefono,
    correo,
    tipo_usuario: rol,
    permisos,
    activo: true,
  }, { onConflict: 'id' });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json(request, 400, { error: 'No se pudo completar el perfil. La cuenta incompleta ha sido anulada.' });
  }

  await admin.from('registro_accesos').insert({
    usuario_id: authData.user.id,
    accion: 'crear_usuario',
    modulo: 'usuarios',
    resultado: 'correcto',
    detalles: { usuario_creado: created.user.id, correo, rol },
  });

  return json(request, 201, {
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
