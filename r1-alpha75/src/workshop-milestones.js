// Los nombres del catálogo pueden conservar su escritura original. Esta clave
// se utiliza solo para interpretar el flujo; nunca sustituye el valor guardado.
export function normalizeStageType(value) {
  const key = String(value || '').trim().toLocaleLowerCase('es-ES')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const entryKey = key.replace(/[\s_]+/g, ' ').trim();
  return ['entrada taller', 'entrada en taller', 'entrada a taller'].includes(entryKey)
    ? 'entrada_taller'
    : key;
}

export function isWorkshopEntryStage(stage = {}) {
  return normalizeStageType(stage.tipo_etapa) === 'entrada_taller';
}

export function usesWorkshopMilestones(stage = {}, model = stage.modelo_flujo_taller) {
  const action = String(stage.accion_sistema || '').trim().toLocaleLowerCase('es-ES');
  return model === 'entrada_hitos_v1' && isWorkshopEntryStage(stage)
    && !['recuperar_y_liberar', 'liberar_reserva'].includes(action);
}

const ACTIONS = {
  entrada: {
    hito: 'entrada',
    field: 'fecha_inicio_real',
    label: 'Entrada a taller',
    confirm: '¿Confirmar entrada a taller?',
    warning: 'Registrará la hora actual de entrada y dejará esta T en curso.',
    success: 'Entrada a taller registrada',
  },
  terminado: {
    hito: 'terminado',
    field: 'fecha_fin_real',
    label: 'Terminado en taller',
    confirm: '¿Confirmar terminado en taller?',
    warning: 'Registrará la hora actual de finalización del taller. La T seguirá en curso hasta la recogida.',
    success: 'Finalización del taller registrada',
  },
  recogido: {
    hito: 'recogido',
    field: 'fecha_real',
    label: 'Recogido de taller',
    confirm: '¿Confirmar recogida de taller?',
    warning: 'Registrará la hora actual de recogida y marcará esta T como realizada.',
    success: 'Recogida de taller registrada',
  },
};

// Devuelve el único hecho que puede confirmarse ahora. No rellena huecos ni
// convierte una ficha legacy al modelo de hitos.
export function workshopMilestoneAction(stage = {}) {
  if (!usesWorkshopMilestones(stage) || stage.cancelado || stage.estado === 'anulada') return null;
  const dates = [
    ['fecha_inicio_real', 'entrada'],
    ['fecha_fin_real', 'finalización del taller'],
    ['fecha_real', 'recogida'],
  ];
  for (const [field, label] of dates) {
    if (stage[field] && Number.isNaN(new Date(stage[field]).getTime())) {
      return { hito: null, issue: `La fecha de ${label} no es válida. Revisa esa fecha en la ficha.` };
    }
  }
  const start = stage.fecha_inicio_real;
  const finish = stage.fecha_fin_real;
  const pickup = stage.fecha_real;
  if (!start && (finish || pickup)) {
    return { hito: null, issue: 'Falta la fecha real de entrada a taller, pero ya hay un hito posterior. Completa la fecha real de entrada en la ficha.' };
  }
  if (pickup && !finish) {
    return { hito: null, issue: 'Ya hay fecha de recogida, pero falta la de finalización del taller. Completa la fecha real de finalización en la ficha.' };
  }
  if (finish && new Date(finish).getTime() < new Date(start).getTime()) {
    return { hito: null, issue: 'La finalización del taller es anterior a la entrada. Revisa ambas fechas en la ficha.' };
  }
  if (pickup && new Date(pickup).getTime() < new Date(finish).getTime()) {
    return { hito: null, issue: 'La recogida es anterior a la finalización del taller. Revisa ambas fechas en la ficha.' };
  }
  if (stage.estado === 'realizada' && !pickup) {
    return { hito: null, issue: 'La T figura realizada, pero no tiene fecha real de recogida. Revisa sus hitos y su estado en la ficha.' };
  }
  if (pickup && stage.estado !== 'realizada') {
    return { hito: null, issue: 'La recogida ya tiene fecha, pero la T no figura realizada. Revisa sus hitos y su estado en la ficha.' };
  }
  if (pickup) return null;
  return { ...ACTIONS[!start ? 'entrada' : (!finish ? 'terminado' : 'recogido')] };
}
