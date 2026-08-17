export const APP_VERSION = 'r1.0.0-alpha.2';

// Entorno aislado de pruebas. No usar referencias del proyecto de producción.
export const SUPABASE_URL = 'https://aemoouldgguyjsxrfuwo.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_EvSyRoy0Dwa3WlM3UG7zLg_QXxP-Zzy';

export const MODULES = Object.freeze([
  { id: 'hotel', label: 'Hotel · Pizarra', icon: '🏨' },
  { id: 't_programadas', label: 'T programadas', icon: '📅' },
  { id: 'reservas', label: 'Reservas', icon: '🚛' },
  { id: 'historico', label: 'Histórico', icon: '🗓️' },
  { id: 'talleres', label: 'Talleres', icon: '🔧' },
  { id: 'resumen', label: 'Panel', icon: '📊' }
]);
