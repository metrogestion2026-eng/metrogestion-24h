// Test boundary: the real application boots with no authenticated session.
// No credentials, remote SDK, data reads, writes, or device registrations.
export const deviceToken = 'synthetic-boot-device';
globalThis.__BOOT_AUTH_CALLS__ = [];
const authResult = (name, data) => {
  globalThis.__BOOT_AUTH_CALLS__.push(name);
  return Promise.resolve({ data, error: null });
};
const forbidden = name => {
  throw new Error(`Unexpected service call during anonymous boot: ${name}`);
};
export const supabase = {
  auth: {
    getSession: () => authResult('getSession', { session: null }),
    getUser: () => authResult('getUser', { user: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => authResult('signOut', {}),
    mfa: {},
  },
  from: name => forbidden(`from:${name}`),
  rpc: name => forbidden(`rpc:${name}`),
};
