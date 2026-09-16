-- Regresión de selección de órdenes BAJA. Las cuatro filas deben devolver correcto=true.
WITH casos(nombre,activo,baja_protegida,payload,esperado) AS (VALUES
 ('baja archivada',false,true,'{"filas":[]}'::jsonb,true),
 ('baja pendiente en madre',false,true,'{"filas":[{"dfm":"2523"}]}'::jsonb,false),
 ('vehículo activo',true,false,'{"filas":[]}'::jsonb,false),
 ('inactivo sin baja manual',false,false,'{"filas":[]}'::jsonb,false)
), resultados AS (
 SELECT nombre,esperado,(NOT activo AND baja_protegida AND NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(payload->'filas') x(value)
 WHERE '2523'=regexp_replace(upper(btrim(x.value->>'dfm')),'[[:space:]]+','','g'))) AS retirar
 FROM casos)
SELECT nombre,retirar,retirar=esperado AS correcto FROM resultados;