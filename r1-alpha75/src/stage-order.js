function activeStage(stage) {
  return stage?.cancelado !== true;
}

export function activeStageCount(stages) {
  return (Array.isArray(stages) ? stages : []).filter(activeStage).length;
}

export function renumberActiveStages(stages) {
  let position = 0;
  (Array.isArray(stages) ? stages : []).forEach(stage => {
    if (!activeStage(stage)) return;
    position += 1;
    stage.posicion = position;
  });
  return stages;
}

export function moveActiveStageToPosition(stages, stage, requestedPosition) {
  if (!Array.isArray(stages) || !activeStage(stage)) return null;

  const activeSlots = [];
  const ordered = [];
  stages.forEach((candidate, index) => {
    if (!activeStage(candidate)) return;
    activeSlots.push(index);
    ordered.push(candidate);
  });

  const fromIndex = ordered.indexOf(stage);
  if (fromIndex < 0 || !ordered.length) return null;

  const numeric = Number(requestedPosition);
  const requested = Number.isFinite(numeric) ? Math.trunc(numeric) : fromIndex + 1;
  const toIndex = Math.min(ordered.length, Math.max(1, requested)) - 1;

  ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, stage);
  ordered.forEach((candidate, index) => {
    candidate.posicion = index + 1;
    stages[activeSlots[index]] = candidate;
  });

  return {
    from: fromIndex + 1,
    to: toIndex + 1,
    count: ordered.length,
  };
}
