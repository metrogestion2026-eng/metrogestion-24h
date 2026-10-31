// Test-only transport. All reads/writes go to the loopback fixture server.
// This replaces the production Supabase client, never its business handlers.
async function request(kind, args, signal) {
  const response = await fetch(`/__test/${kind}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal,
  });
  if (!response.ok) throw new Error(`Local fixture HTTP ${response.status}`);
  return response.json();
}

class Query {
  constructor(table) { this.spec = { table, columns: '*', filters: [], orders: [] }; }
  select(columns) { this.spec.columns = columns; return this; }
  eq(column, value) { this.spec.filters.push({ operator: 'eq', column, value }); return this; }
  gt(column, value) { this.spec.filters.push({ operator: 'gt', column, value }); return this; }
  gte(column, value) { this.spec.filters.push({ operator: 'gte', column, value }); return this; }
  lte(column, value) { this.spec.filters.push({ operator: 'lte', column, value }); return this; }
  in(column, value) { this.spec.filters.push({ operator: 'in', column, value }); return this; }
  order(column, options = {}) { this.spec.orders.push({ column, ...options }); return this; }
  limit(value) { this.spec.limit = value; return this; }
  maybeSingle() { this.spec.single = true; return this; }
  single() { this.spec.single = true; return this; }
  abortSignal(signal) { this.signal = signal; return this; }
  then(resolve, reject) { return request('query', this.spec, this.signal).then(resolve, reject); }
}

export const supabase = {
  from: table => new Query(table),
  rpc: (name, args) => request('rpc', { name, args }),
  auth: {
    getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
};
