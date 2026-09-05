import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const migration = await readFile(path.join(
  root,
  'supabase/migrations/20260905101500_alpha72_modalidades_operativas_historico.sql'
), 'utf8');
const create = await readFile(path.join(root, 'r1-alpha72/src/hotel-create.js'), 'utf8');
const editor = await readFile(path.join(root, 'r1-alpha72/src/hotel-editor.js'), 'utf8');
const main = await readFile(path.join(root, 'r1-alpha72/src/hotel-editor-main.js'), 'utf8');
const card = await readFile(path.join(root, 'r1-alpha72/src/hotel-card.js'), 'utf8');
const history = await readFile(path.join(root, 'r1-alpha72/src/history-card.js'), 'utf8');

assert.match(migration, /catalogo_modalidades_operativas_hotel/);
assert.match(migration, /'sin_sustitucion','Sin sustitución','sin_sustitucion'/);
assert.match(migration, /'reparado_en_ruta','Reparado en ruta','reparado_en_ruta'/);
assert.match(migration, /'reserva_en_reparacion','Reserva en reparación','reserva_en_reparacion'/);
assert.match(migration, /alter table public\.registros_hotel[\s\S]*?add column if not exists modalidad_operativa/);
assert.match(migration, /enable row level security/);
assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*catalogo_modalidades_operativas_hotel[^;]*authenticated/i);

assert.match(migration, /modalidad_hotel_requiere_recuperacion/);
assert.match(migration, /v_comportamiento in \('reparado_en_ruta','reserva_en_reparacion'\) then return false/);
assert.match(migration, /v_comportamiento<>'sin_sustitucion'/);
assert.match(migration, /greatest\(coalesce\(v_ultima_fecha,v_fecha_parada\),v_hoy\)>v_fecha_parada/);
assert.match(migration, /cerrar_modalidad_hotel_sin_recuperacion/);
assert.match(migration, /set estado='recuperado',[\s\S]*?retirado_hotel_activo=true/);
assert.match(migration, /accion_sistema='recuperar_y_liberar' and estado<>'realizada'/);

assert.match(migration, /crear_ficha_hotel_con_etapas_alpha72/);
assert.match(migration, /v_numero_parada:=nullif\(btrim\(v_created->>'numero_parada'\),''\)/);
assert.match(migration, /if v_numero_parada is null then raise exception 'La ficha recién creada no tiene número de parada'/);
assert.match(migration, /obtener_ficha_hotel_edicion_alpha72/);
assert.match(migration, /guardar_ficha_hotel_edicion_alpha72/);
assert.match(migration, /with \(security_invoker=true\)/);

assert.match(create, /crear_ficha_hotel_con_etapas_alpha72/);
assert.match(create, /catalogo_modalidades_operativas_hotel/);
assert.match(create, /aunque la fecha real de parada sea anterior/);
assert.match(editor, /obtener_ficha_hotel_edicion_alpha72/);
assert.match(editor, /guardar_ficha_hotel_edicion_alpha72/);
assert.match(main, /Modalidad operativa/);
assert.match(main, /Sustituto real \(RESERVA\/FLOTA\)/);
assert.match(main, /Al finalizar, la ficha sale del Hotel activo pero conserva el número de parada/);
assert.match(card, /modalidad_operativa_nombre/);
assert.match(history, /Modalidad operativa/);

console.log('Alpha72: modalidades, número de parada y conservación en Histórico verificados.');
