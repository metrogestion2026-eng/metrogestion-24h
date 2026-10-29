import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const REAL_READS = new Set(['pizarras', 'hotel_actual_detalle', 'etapas_hotel', 'activaciones_24h', 'vehiculos', 'reservas_hotel', 'usuarios']);
const RECOVERY_HISTORY_READS = new Set(['hotel_por_dia', 'registros_hotel', 'hotel_edicion_piloto',
  'trabajos_etapa_hotel', 'anotaciones_manuales_hotel', 'anotaciones_generadas_hotel_anuladas',
  'catalogo_tipos_trabajo']);
const RECOVERY_HISTORY_EMPTY_READS = new Set(['documentos_gestion', 'dispositivos_usuario']);
const CONTINUITY_READS = new Set(['cierres_facturacion', 'facturacion_dfm_periodos', 'facturacion_r_sustituciones',
  'paradas_sustitucion_resumen', 'config_facturacion_sustituciones']);
const EDITOR_READS = new Set(['vehiculos_hotel_autocompletar']);
// Legacy assistance/recovery journeys use explicit empty financial fixtures.
// Continuity journeys opt into the real financial views in CONTINUITY_READS.
// Documents remain outside all of these test boundaries.
const EMPTY_READS = new Set(['cierres_facturacion', 'facturacion_dfm_periodos', 'facturacion_r_sustituciones',
  'paradas_sustitucion_resumen', 'config_facturacion_sustituciones', 'anotaciones_manuales_hotel', 'anotaciones_generadas_hotel_anuladas']);
const identifier = value => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('Unsupported fixture identifier');
  return `"${value}"`;
};

async function readQuery(db, spec, recoveryHistory, continuity, editor) {
  const actual = REAL_READS.has(spec.table) || (recoveryHistory && RECOVERY_HISTORY_READS.has(spec.table))
    || (continuity && CONTINUITY_READS.has(spec.table)) || (editor && EDITOR_READS.has(spec.table));
  if (!actual && (EMPTY_READS.has(spec.table) || (recoveryHistory && RECOVERY_HISTORY_EMPTY_READS.has(spec.table)))) {
    return { data: spec.single ? null : [], error: null };
  }
  if (!actual) throw new Error(`Unexpected fixture read: ${spec.table}`);
  const columns = spec.columns === '*' ? '*' : String(spec.columns).split(',').map(identifier).join(',');
  const values = [];
  const filters = spec.filters.map(filter => {
    values.push(filter.value);
    if (filter.operator === 'eq') return `${identifier(filter.column)} = $${values.length}`;
    if (filter.operator === 'gt') return `${identifier(filter.column)} > $${values.length}`;
    if (filter.operator === 'gte') return `${identifier(filter.column)} >= $${values.length}`;
    if (filter.operator === 'lte') return `${identifier(filter.column)} <= $${values.length}`;
    if (filter.operator === 'in') return `${identifier(filter.column)} = ANY($${values.length})`;
    throw new Error('Unsupported fixture filter');
  });
  const orders = spec.orders.map(order => `${identifier(order.column)} ${order.ascending === false ? 'DESC' : 'ASC'}${order.nullsFirst === false ? ' NULLS LAST' : ''}`);
  const limit = spec.limit === undefined ? '' : ` LIMIT ${Math.max(0, Math.min(Number(spec.limit) || 0, 1000))}`;
  const sql = `SELECT ${columns} FROM public.${identifier(spec.table)}${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''}${orders.length ? ` ORDER BY ${orders.join(',')}` : ''}${limit}`;
  // PostgreSQL encodes its values directly. In particular SQL DATE remains
  // YYYY-MM-DD, like PostgREST, with no node-postgres/local-time conversion.
  const result = await db.query(`SELECT to_jsonb(fixture_row) AS value FROM (${sql}) fixture_row`, values);
  const rows = result.rows.map(row => row.value);
  return { data: spec.single ? rows[0] || null : rows, error: null };
}

const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Metrogestión · UI fixture aislada</title>
<style>body{font:16px sans-serif;margin:20px}.a50-modal{position:fixed;inset:0;background:white;overflow:auto;padding:20px;z-index:50}.a50-modal-card{max-width:900px;margin:auto}.a52-metrics{display:flex;gap:12px;flex-wrap:wrap}.a52-metric{display:grid;min-width:130px;padding:8px}.hotel-card{border:1px solid #777;padding:10px;margin:10px}.a52-detail-card{border:1px solid #777;padding:10px}</style>
<span id="app-version"></span><nav id="module-nav"><button data-module="resumen">Panel</button><button id="fixture-hotel-button" data-module="hotel">Hotel</button><button id="fixture-incidents-button">Asistencias</button></nav><main id="module-content"></main>
<script type="module" src="/tests/integration/browser-app.js"></script></html>`;

export async function startBrowserServer(db, { recoveryHistory = false, continuity = false, editor = false } = {}) {
  if (editor) continuity = true;
  if (continuity) recoveryHistory = true;
  const calls = [], queries = [], readTables = [], failures = [], doubledRpcs = [];
  const controls = { delayNextSave: 0, loseNextCreateResponse: false, delayNextHistoryAccess: 0,
    delayNextContinuityConfirmation: 0, loseNextContinuityResponse: false,
    delayNextEditorSave: 0, loseNextEditorSaveResponse: false,
    editorSaveNetworkErrorAsValue: false, omitEditorDateContract: false };
  let origin;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'");
    try {
      // Chrome's deny proxy also reaches this server. Absolute external URLs
      // are rejected here rather than forwarded to the network.
      if (/^https?:\/\//i.test(request.url) && !request.url.startsWith(origin + '/')) {
        response.writeHead(403).end(); return;
      }
      const url = new URL(request.url, origin);
      if (url.origin !== origin) { response.writeHead(403).end(); return; }
      if (request.method === 'POST' && url.pathname.startsWith('/__test/')) {
        let raw = '';
        for await (const chunk of request) {
          raw += chunk;
          if (raw.length > 100000) throw new Error('Fixture request too large');
        }
        const data = JSON.parse(raw);
        let result;
        if (url.pathname === '/__test/query') {
          readTables.push(data.table);
          queries.push(structuredClone(data));
          if (recoveryHistory && data.table === 'usuarios' && data.columns === 'activo,tipo_usuario,permisos') {
            const delay = controls.delayNextHistoryAccess;
            controls.delayNextHistoryAccess = 0;
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          }
          result = await readQuery(db, data, recoveryHistory, continuity, editor);
        } else if (url.pathname === '/__test/rpc') {
          if (recoveryHistory && data.name === 'listar_ordenes_manteniment_pendientes_alpha74') {
            // Read-only Panel dependency; no MANTENIMENT queue is connected.
            doubledRpcs.push(data.name);
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ data: [], error: null })); return;
          }
          const continuityPreview = continuity && data.name === 'previsualizar_continuidad_sustitucion_alpha75';
          const continuityConfirm = continuity && data.name === 'confirmar_continuidad_sustitucion_alpha75';
          const editorRead = editor && data.name === 'obtener_ficha_hotel_edicion_alpha72';
          const editorSave = editor && data.name === 'guardar_ficha_hotel_edicion_alpha73';
          if (data.name !== 'guardar_activacion_24h'
              && !(recoveryHistory && data.name === 'marcar_t_realizada_rapida')
              && !continuityPreview && !continuityConfirm && !editorRead && !editorSave) {
            throw new Error(`Unexpected fixture RPC: ${data.name}`);
          }
          calls.push(structuredClone(data));
          const wait = controls.delayNextSave;
          controls.delayNextSave = 0;
          if (wait) await new Promise(resolve => setTimeout(resolve, wait));
          const args = data.args;
          let saved;
          if (editorRead) {
            saved = await db.query('SELECT public.obtener_ficha_hotel_edicion_alpha72($1::uuid) AS value',
              [args.p_registro_id]);
            if (controls.omitEditorDateContract) {
              // Explicit compatibility fault: preserve the real detail, remove
              // only the advertised parser contract to represent an older API.
              delete saved.rows[0].value.contrato_fechas_editor;
            }
          } else if (editorSave) {
            const editorDelay = controls.delayNextEditorSave;
            controls.delayNextEditorSave = 0;
            if (editorDelay) await new Promise(resolve => setTimeout(resolve, editorDelay));
            saved = await db.query('SELECT public.guardar_ficha_hotel_edicion_alpha73($1::uuid,$2::integer,$3::jsonb,$4::jsonb,$5::jsonb,$6::text) AS value',
              [args.p_registro_id, args.p_version, JSON.stringify(args.p_ficha), JSON.stringify(args.p_etapas),
                JSON.stringify(args.p_identidad), args.p_request_id]);
          } else if (continuityPreview) {
            saved = await db.query('SELECT public.previsualizar_continuidad_sustitucion_alpha75($1::uuid,$2::uuid,$3::uuid) AS value',
              [args.p_destino_id, args.p_origen_id ?? null, args.p_etapa_entrada_id ?? null]);
          } else if (continuityConfirm) {
            const confirmationDelay = controls.delayNextContinuityConfirmation;
            controls.delayNextContinuityConfirmation = 0;
            if (confirmationDelay) await new Promise(resolve => setTimeout(resolve, confirmationDelay));
            saved = await db.query('SELECT public.confirmar_continuidad_sustitucion_alpha75($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::integer,$6::integer,$7::text,$8::text) AS value',
              [args.p_origen_id, args.p_destino_id, args.p_etapa_entrada_id, args.p_version_origen,
                args.p_version_destino, args.p_version_entrada, args.p_huella_prevision, args.p_request_id]);
          } else if (data.name === 'marcar_t_realizada_rapida') {
            saved = await db.query('SELECT public.marcar_t_realizada_rapida($1::uuid,$2::integer,$3::text) AS value',
              [args.p_etapa_id, args.p_version, args.p_request_id]);
          } else {
            saved = await db.query('SELECT public.guardar_activacion_24h($1::uuid,$2::jsonb,$3::text) AS value',
              [args.p_id, JSON.stringify(args.p_payload), args.p_request_id]);
          }
          if (continuityConfirm && controls.loseNextContinuityResponse) {
            controls.loseNextContinuityResponse = false;
            response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '10000' });
            response.write('{"data":', () => response.destroy());
            return;
          }
          if (editorSave && controls.loseNextEditorSaveResponse) {
            controls.loseNextEditorSaveResponse = false;
            response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '10000' });
            response.write('{"data":', () => response.destroy());
            return;
          }
          if (editorSave && controls.editorSaveNetworkErrorAsValue) {
            controls.editorSaveNetworkErrorAsValue = false;
            // Supabase/PostgREST without throwOnError resolves a network failure
            // as a value. The SQL above has committed; this distinct injected
            // reply checks the product handler, not the SDK or real transport.
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ data: null, error: {
              code: '', message: 'TypeError: Failed to fetch',
              details: 'Synthetic SDK network failure after committed editor RPC', hint: '',
            }, status: 0, statusText: '' }));
            return;
          }
          if (data.name === 'guardar_activacion_24h' && !args.p_id && controls.loseNextCreateResponse) {
            controls.loseNextCreateResponse = false;
            // Deliver headers and an incomplete JSON body after commit. A bare
            // socket reset may be transparently retried by Chromium itself.
            response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '10000' });
            response.write('{"data":', () => response.destroy());
            return;
          }
          result = { data: saved.rows[0].value, error: null };
        } else throw new Error('Unknown fixture endpoint');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(result)); return;
      }
      if (request.method !== 'GET') { response.writeHead(405).end(); return; }
      if (url.pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        let fixtureHtml = continuity
          ? html.replace('<button id="fixture-incidents-button">Asistencias</button>', '<button data-module="historico">Histórico</button><button data-module="listados">Listados</button>')
            .replace('browser-app.js', 'browser-continuity-app.js')
          : recoveryHistory
          ? html.replace('<button id="fixture-incidents-button">Asistencias</button>', '<button data-module="historico">Histórico</button>')
            .replace('browser-app.js', 'browser-recovery-history-app.js')
          : html;
        if (editor) {
          // Keep the test navigation explicit, but render the complete editor
          // with the candidate's actual styles instead of the fixture styles.
          const candidate = await readFile(path.join(repo, 'r1-alpha75/index.html'), 'utf8');
          const stylesheetLinks = [...candidate.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)]
            .map(([tag]) => tag.replace(/href="([^"]+)"/, (_match, href) => {
              const asset = new URL(href, `${origin}/r1-alpha75/index.html`);
              if (asset.origin !== origin) throw new Error('Editor fixture requires local candidate styles');
              return `href="${asset.pathname}${asset.search}"`;
            })).join('\n');
          if (!stylesheetLinks.includes('/r1-alpha17/hotel-editor.css')) throw new Error('Candidate editor stylesheet missing');
          fixtureHtml = fixtureHtml.replace(/<style>[\s\S]*?<\/style>/, stylesheetLinks)
            .replace('browser-continuity-app.js', 'browser-editor-app.js');
        }
        response.end(fixtureHtml);
        return;
      }
      const relative = decodeURIComponent(url.pathname).slice(1);
      if (!/^(r1-alpha\d+\/|shared\/|tests\/integration\/browser-)/.test(relative)
          || !(/\.m?js$/.test(relative) || (editor && /\.css$/.test(relative))) || relative.split('/').includes('..')) {
        response.writeHead(404).end(); return;
      }
      let source;
      if (relative === 'r1-alpha17/src/supabase.js') {
        source = await readFile(new URL('./browser-client.js', import.meta.url), 'utf8');
      } else {
        source = await readFile(path.join(repo, relative), 'utf8');
        if (relative === 'r1-alpha34/src/app.js') {
          // Only the unrelated historical application bootstrap is substituted.
          // Rendering, validation, event handlers, payload and save stay intact.
          const inherited = "import '../../r1-alpha33/src/app.js';";
          if (!source.includes(inherited)) throw new Error('Unexpected wizard import');
          source = source.replace(inherited, '// Synthetic application shell provided by this fixture.');
        }
      }
      response.setHeader('Content-Type', relative.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
      response.end(source);
    } catch (error) {
      failures.push({ path: request.url, message: error.message });
      if (request.url.startsWith('/__test/')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ data: null, error: { message: error.message, code: error.code } }));
      } else response.writeHead(500).end(error.message);
    }
  });
  server.on('connect', (_request, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, calls, queries, readTables, failures, doubledRpcs, controls,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
