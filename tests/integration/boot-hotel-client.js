// Synthetic transport boundary for the actual published application graph.
// No credentials, network SDK, database mutations or production records.
export const deviceToken = 'synthetic-hotel-owner-device';
const user = { id: '10000000-0000-4000-8000-000000000001', email: 'hotel@example.invalid' };
const profile = { ...user, activo: true, nombre: 'Prueba', apellidos: 'Hotel', correo: user.email,
  tipo_usuario: 'usuario', permisos: { hotel: { ver: true, editar: true }, talleres: { ver: true } } };
const currentRow = { id: '20000000-0000-4000-8000-000000000001', dfm: 'PRUEBA-ACTUAL', matricula: 'SINTETICA',
  estado: 'en_taller', fondo_visual: 'lila', lugar: 'TALLER SINTÉTICO', orden: 0, numero_parada: 'TEST-001' };
const calls = [], writes = [], hotelPlans = [], pending = new Map(), completed = [];
let sequence = 0;
let session = globalThis.__HOTEL_TEST_INITIAL_SESSION__ === false ? null : { user };
const subscribers = new Set();
globalThis.__HOTEL_TEST__ = {
  calls, writes, completed,
  currentRow,
  deferNextHotel({ row = {}, error = null } = {}) {
    const id = ++sequence;
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    pending.set(id, release);
    hotelPlans.push({ id, ready, data: [{ ...currentRow, ...row }], error });
    return id;
  },
  release(id) { pending.get(id)?.(); pending.delete(id); },
  hotelReads() { return calls.filter(call => call.table === 'hotel_actual_detalle'); },
};

const result = data => ({ data, error: null });
const forbidden = name => {
  writes.push(name);
  throw new Error(`Unexpected write in synthetic Hotel boot: ${name}`);
};

class Query {
  constructor(table) { this.table = table; this.filters = []; this.orders = []; this.shape = 'many'; }
  select(columns) { this.columns = columns; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  neq() { return this; }
  is() { return this; }
  not() { return this; }
  or() { return this; }
  in() { return this; }
  gt() { return this; }
  gte() { return this; }
  lt() { return this; }
  lte() { return this; }
  order(column) { this.orders.push(column); return this; }
  limit() { return this; }
  range() { return this; }
  abortSignal() { return this; }
  maybeSingle() { this.shape = 'one'; return this; }
  single() { this.shape = 'one'; return this; }
  update() { return forbidden(`update:${this.table}`); }
  insert() { return forbidden(`insert:${this.table}`); }
  upsert() { return forbidden(`upsert:${this.table}`); }
  delete() { return forbidden(`delete:${this.table}`); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async execute() {
    const call = { table: this.table, columns: this.columns, filters: this.filters, orders: this.orders,
      owner: globalThis.__METROGESTION_MODULE_OWNERS__?.hotel };
    calls.push(call);
    if (this.table === 'usuarios') return result(profile);
    if (this.table === 'pizarras') return result(this.shape === 'one'
      ? { id: '30000000-0000-4000-8000-000000000001', fecha: '2026-10-25', estado: 'en_curso' }
      : []);
    if (this.table === 'hotel_actual_detalle') {
      const plan = hotelPlans.shift();
      if (!plan) return result([{ ...currentRow }]);
      call.pendingId = plan.id;
      await plan.ready;
      completed.push(plan.id);
      return { data: plan.error ? null : plan.data, error: plan.error ? { message: plan.error } : null };
    }
    return result(this.shape === 'one' ? null : []);
  }
}

const channel = { on() { return this; }, subscribe() { return this; }, unsubscribe() {} };
export const supabase = {
  auth: {
    async getSession() { return result({ session }); },
    async getUser() { return result({ user: session?.user || null }); },
    async signInWithPassword() {
      session = { user };
      for (const callback of subscribers) callback('SIGNED_IN', session);
      return result({ session });
    },
    async signOut() {
      session = null;
      for (const callback of subscribers) callback('SIGNED_OUT', null);
      return result({});
    },
    onAuthStateChange(callback) {
      subscribers.add(callback);
      return { data: { subscription: { unsubscribe() { subscribers.delete(callback); } } } };
    },
    mfa: {
      async listFactors() { return result({ all: [] }); },
      async getAuthenticatorAssuranceLevel() { return result({ currentLevel: 'aal1' }); },
    },
  },
  from: table => new Query(table),
  async rpc(name) {
    calls.push({ rpc: name });
    if (name === 'comprobar_dispositivo') return result({ permitido: true, estado: 'autorizado',
      dispositivo_id: '40000000-0000-4000-8000-000000000001', es_administrador_principal: false });
    if (name === 'actualizar_presencia') return result({ permitido: true, estado: 'autorizado' });
    return forbidden(`rpc:${name}`);
  },
  channel: () => channel,
  removeChannel() {},
  functions: { async invoke(name) {
    if (name === 'acceso-anonimo-r1') return result({ bloqueado: false });
    return forbidden(`function:${name}`);
  } },
};
