// The navigation remains synthetic. The Hotel, History, Panel, Listados and
// complete Hotel editor modules are unmodified product modules. Only the
// Supabase transport and Auth session are replaced by browser-client.js.
await import('./browser-continuity-app.js');
window.__EDITOR_FIXTURE_READY__ = true;
