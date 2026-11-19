-- SINCRO 13 · 1/3: esquema de evidencias K.
-- EXCLUSIVAMENTE CANDIDATO SIN DESPLEGAR. No emisor Google aquí.
BEGIN;

CREATE TABLE IF NOT EXISTS app_private.sincro13_k_evidencias (
 evidencia_id uuid PRIMARY KEY,
 solicitud_id uuid NOT NULL UNIQUE,
 spreadsheet_id text NOT NULL,
 id_fila bigint NOT NULL CHECK (id_fila BETWEEN 1 AND 9007199254740991),
 trabajo_sync_id uuid NOT NULL,
 columna text NOT NULL DEFAULT 'K' CHECK (columna = 'K'),
 valor_base date,
 valor_nuevo date NOT NULL,
 evento_en timestamptz NOT NULL,
 verificado_en timestamptz NOT NULL,
 verificador text NOT NULL CHECK (verificador = 'GOOGLE_INDEPENDIENTE'),
 -- Google Sheets API no identifica al editor. Este campo sigue NULL.
 actor_google_verificado uuid CHECK (actor_google_verificado IS NULL),
 editor_google_acreditado boolean NOT NULL DEFAULT false
    CHECK (editor_google_acreditado = false),
 evidencia_sha256 text NOT NULL CHECK (evidencia_sha256 ~ '^[0-9a-f]{64}$'),
 estado text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','APLICADA','RETENIDA')),
 resultado jsonb,
 consumido_en timestamptz,
 creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (spreadsheet_id,id_fila)
   REFERENCES app_private.sincro13_recibos_t(spreadsheet_id,id_fila) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS sincro13_k_evidencia_pendiente_unica
 ON app_private.sincro13_k_evidencias(spreadsheet_id,id_fila)
 WHERE estado='PENDIENTE';

ALTER TABLE app_private.sincro13_k_evidencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.sincro13_k_evidencias FROM PUBLIC,anon,authenticated,service_role;
-- No se concede INSERT al receptor de T ni a la Edge Function.
-- En laboratorio, el test simula el verificador insertando con dueño SQL.

COMMIT;
