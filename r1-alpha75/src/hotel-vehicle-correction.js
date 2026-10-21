import { element } from '../../r1-alpha17/src/dom.js';

const MASTER_FIELDS = ['vehiculo_sustituido', 'matricula_sustituido', 'tipo_unidad',
  'marca', 'modelo', 'tipo_motor', 'upc', 'telefono'];
const normal = value => String(value ?? '').trim().toUpperCase();
export function vehicleChanged(ficha, loaded) {
  return normal(ficha.vehiculo_sustituido) !== normal(loaded.vehiculo_sustituido)
    || normal(ficha.matricula_sustituido) !== normal(loaded.matricula_sustituido);
}
export function substituteLabel(ficha = {}) {
  const code = String(ficha.vehiculo_reserva || '').trim();
  if (!code) return 'Sin sustituto asignado';
  return `${ficha.tipo_sustituto === 'FLOTA' ? 'FLOTA' : 'Sustituto'} ${code}${ficha.matricula_reserva ? ` · ${ficha.matricula_reserva}` : ''}`;
}
export function applyCorrectedVehicle(detail, saved, controls = {}) {
  const current = detail.ficha;
  if (!saved?.ok || !saved.ficha || !['id', 'seguimiento_id', 'pizarra_id', 'numero_parada']
    .every(key => String(saved.ficha[key] ?? '') === String(current[key] ?? ''))
    || !Number.isInteger(Number(saved.ficha.version)) || Number(saved.ficha.version) < Number(current.version)) {
    throw new Error('El servidor no ha devuelto una rectificación identificable. Conserva el borrador y comprueba la ficha.');
  }
  for (const key of MASTER_FIELDS) {
    current[key] = saved.ficha[key] ?? '';
    if (controls[key]) controls[key].value = current[key];
  }
  current.version = Number(saved.ficha.version);
  current.actualizado_en = saved.ficha.actualizado_en;
  // No sustituir la ficha completa: permanecen los demás cambios del borrador,
  // las T y los archivos preparados que todavía no se han guardado.
  return current;
}
export function installVehicleCorrection({ detail, controls, host, notice, status,
  getIdentity, acceptIdentity, rpc, isSaving, setSaving, requestId, onCorrected }) {
  const reason = element('input', { type: 'text', maxlength: '500', placeholder: 'Motivo de la rectificación', 'aria-label': 'Motivo de rectificar el vehículo' });
  const action = element('button', { type: 'button', className: 'button secondary compact', text: 'Confirmar rectificación del vehículo' });
  const hint = element('small', { text: 'Esta acción guarda solo la rectificación del vehículo. Conserva las T y el sustituto guardado. Si existen históricos, asistencias o vínculos externos, se detendrá para conciliarlos. Los demás cambios del formulario seguirán pendientes.' });
  const box = element('div', { className: 'editor-conditional' }, [reason, action, hint]);
  host.append(box);
  let uncertain = false;
  const refresh = () => {
    const changed = vehicleChanged(detail.ficha, getIdentity());
    box.hidden = !changed;
    const heading = notice.querySelector('strong');
    const substitute = notice.querySelector('span');
    if (heading) heading.textContent = `${detail.ficha.vehiculo_sustituido || 'Vehículo sin indicar'} · actuación ${getIdentity().numero_parada || 'sin número'}${changed ? ' · rectificación pendiente' : ''}`;
    if (substitute) substitute.textContent = substituteLabel(detail.ficha);
  };
  host.addEventListener('input', refresh);
  host.addEventListener('change', refresh);
  host.addEventListener('focusout', () => queueMicrotask(refresh));
  refresh();
  action.addEventListener('click', async () => {
    if (isSaving() || uncertain) return;
    const original = getIdentity();
    if (!vehicleChanged(detail.ficha, original)) return;
    if (reason.value.trim().length < 5) {
      status.className = 'hotel-editor-status error';
      status.textContent = 'Indica el motivo de la rectificación (al menos cinco caracteres).';
      reason.focus(); return;
    }
    const proposed = { dfm: normal(detail.ficha.vehiculo_sustituido), matricula: normal(detail.ficha.matricula_sustituido) };
    if (!window.confirm(`Rectificar la misma actuación ${original.numero_parada}:\n${original.vehiculo_sustituido} · ${original.matricula_sustituido}\n→ ${proposed.dfm} · ${proposed.matricula}\n\nSe conservan las T, fechas, documentos y el sustituto guardado. Los demás cambios siguen pendientes. ¿Confirmar?`)) return;
    const disabled = [...host.querySelectorAll('input,select,button,textarea')].map(control => [control, control.disabled]);
    disabled.forEach(([control]) => { control.disabled = true; });
    const finish = (unknown = false) => {
      disabled.forEach(([control, wasDisabled]) => { control.disabled = wasDisabled; });
      action.disabled = unknown;
      setSaving(false, unknown);
    };
    setSaving(true);
    status.className = 'hotel-editor-status';
    status.textContent = 'Comprobando y rectificando solo el vehículo…';
    const reference = requestId();
    let reply;
    try {
      reply = await rpc('rectificar_vehiculo_ficha_hotel_alpha75', {
        p_registro_id: detail.ficha.id, p_version: Number(detail.ficha.version),
        p_identidad: original, p_dfm: proposed.dfm, p_matricula: proposed.matricula,
        p_motivo: reason.value.trim(), p_request_id: reference,
      });
      if (reply.error) {
        if (!/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(reply.error.code || '')) throw new Error('Resultado sin confirmar');
        status.className = 'hotel-editor-status error';
        status.textContent = reply.error.message || 'Rectificación rechazada. El borrador se conserva.';
        finish(); return;
      }
      if (!reply.data?.ok) throw new Error('Resultado sin confirmar');
      applyCorrectedVehicle(detail, reply.data, controls);
      acceptIdentity(reply.data.ficha);
      refresh(); onCorrected?.(detail.ficha);
      status.className = 'hotel-editor-status success';
      status.textContent = '✓ Vehículo rectificado y guardado en la misma actuación. Las T y los documentos se conservan. Los demás cambios preparados siguen pendientes de Guardar ficha completa.';
      finish();
    } catch {
      uncertain = true;
      status.className = 'hotel-editor-status error';
      status.textContent = `No se pudo confirmar la rectificación. Conserva el borrador y vuelve a abrir la actuación antes de repetir. Referencia ${reference}.`;
      finish(true);
    }
  });
  return refresh;
}
