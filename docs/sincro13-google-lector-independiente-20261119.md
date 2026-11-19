# METROGES · SINCRO 13 · Lector Google independiente y recibo de evidencia K

**19/11/2026 — candidata en GitHub, PR #133 DRAFT, NO INSTALADA NI HABILITADA.**

## Qué se ha hecho de verdad

Se ha añadido una ruta separada del ejecutor Apps Script para leer datos de MANTENIMENT **directamente desde Google Sheets API v4**, usando una cuenta de servicio Google con acceso restringido al permiso `https://www.googleapis.com/auth/spreadsheets.readonly`. Su credencial sería un secreto exclusivo del servidor, nunca la clave `METROGESTION_SYNC_TOKEN` de Apps Script.

La lectura comprueba exactamente la T como ID_FILA única en toda la columna T; exige la hoja MANTENIMENT y REGISTRO_FILAS, origen `ORDEN_AUTORIZADA`, registro `ACTIVA`, fecha de asignación posterior al corte, una sola nota E `METROGESTION_T:UUID` y K de tipo DATE reconocida por Google. Rechaza R1515, PARADA, BAJA, ALTA, ROAD, FIN, ARCHIVO, hojas cambiadas, formatos incompatibles, T duplicadas, UUID compartidos y fórmulas usadas como K.

El libro operativo real tiene `locale=ca_ES` y `timeZone=Europe/Madrid`; el lector lo exige para interpretar `DD/MM/AAAA` de K sin confundir calendario. El lector consulta cinco columnas concretas A/E/H/K/T y REGISTRO_FILAS A:E usando `spreadsheets.get` con rangos y máscara de campos limitados. Repite la lectura completa dos veces. Si cambia T, K, la nota, la clase o el registro entre consultas, **RETENER**. Este doble cotejo no es una transacción distribuida entre Google y PostgreSQL y no demuestra quién editó la celda.

## Archivos nuevos

- `supabase/functions/_shared/sincro13-google-k-readonly.mjs`: parser/cotejo independiente, sin escrituras
- `supabase/functions/_shared/sincro13-google-oauth-readonly.mjs`: firma OAuth RS256 de cuenta de servicio y único scope Google Sheets readonly
- `supabase/functions/_shared/sincro13-google-k-edge.mjs`: autenticación de administrador principal (usuario activo, dispositivo autorizado, JWT comprobado ante Supabase), dos flags y contrato exacto
- `supabase/functions/sincro13-google-lector/index.ts`: nueva Edge Function candidata, **no desplegada**
- `sql/sincro13_google_lectura_receptor_20261119.sql`: receptor privado separado por secreto verificador, con tabla de configuración `habilitado=false` de fábrica
- `tests/security-sincro13-google-k-readonly.test.mjs`: 26 pruebas de lectura/duplicados/fechas/alteraciones
- `tests/security-sincro13-google-edge-oauth.test.mjs`: 13 pruebas de permisos y OAuth con clave efímera **ficticia**
- `tests/security-sincro13-google-edge-emision.test.mjs`: 8 pruebas de flags separados, nonce y emisión al RPC
- `tests/integration-sincro13-google-verificador.pg.test.mjs`: 15 pruebas PostgreSQL reales sobre base de laboratorio

## Barreras y permisos

Ambas banderas Edge están **apagadas** si no se configuran expresamente:
- `S13_GOOGLE_READER_ENABLED`: permite lectura **solo a administrador principal autenticado**
- `S13_GOOGLE_EVIDENCE_ENABLED`: una segunda autorización independiente para registrar una evidencia, no para actualizar Hotel ni K

Variables exclusivas necesarias más adelante: `S13_GOOGLE_SERVICE_ACCOUNT_JSON` (cuenta de servicio Google readonly, acceso explícito a la hoja), `S13_GOOGLE_SPREADSHEET_ID` (hoja fija del servidor, no seleccionable desde la petición), `S13_GOOGLE_VERIFIER_SECRET` (secreto nuevo y distinto del token Apps Script) y variables Supabase ya existentes. No hay claves reales almacenadas en GitHub ni en este documento. La función SQL tiene una **segunda barrera**: `app_private.sincro13_verificador_config` nace con `habilitado=false` y ningún secreto activo. No se ha modificado ninguna configuración del proyecto conectado.

La emisión recibe T y UUID de la doble lectura de Google; no acepta una fecha K enviada por el cliente. El servidor SQL busca por su cuenta la K anterior del objeto canónico asociado a esa T y mantiene la evidencia como `PENDIENTE`. Si no ha cambiado, devuelve `SIN_CAMBIO`. Reintentos idénticos no duplican; mismo nonce con fecha contradictoria se bloquea; otra evidencia pendiente para la misma T también se retiene.

**El autor original de Google se guarda DESCONOCIDO/NULL**, nunca como actor ficticio; `editor_google_acreditado=false`. El administrador de Metroges es la persona que **adopta explícitamente** la corrección mediante su propia sesión, aprobación limitada y CAS del destino. Adoptar no equivale a atribuirle la edición original. El CAS sólo armoniza la copia técnica de K si la etapa Hotel ya tiene esa misma fecha real, no altera Hotel.

## Ensayo real de Google, sin tocar operaciones

Con el libro ficticio de Google Sheets https://docs.google.com/spreadsheets/d/1QOA6D__GKWse6BRvPJE5m0wrOFhCgvA_i43b2Isc9KQ/edit se ajustaron únicamente el idioma de ensayo a ca_ES, el huso a Europe/Madrid y la **K4 ficticia** a la fecha nativa Google 19/11/2026. Después se ejecutó el parser de esta misma rama sobre el GridData obtenido del conector nativo de Google y se hicieron **dos lecturas separadas**. Ambas encontraron T 800001, nota técnica de UUID `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, ACTIVA/ORDEN_AUTORIZADA, K=2026-11-19 y resultado `COTEJO_T_K_SIN_AUTORIA` sin permiso de escritura. Esto verifica el parser contra una hoja real de laboratorio, **NO equivale a ejecutar la Edge Function con una credencial de Google independiente instalada**.

## Pruebas automáticas

GitHub Actions en el último HEAD comprobado:
- Run 44514744625: PostgreSQL 17 de laboratorio **SUCCESS**: 10/10 recibo T, 15/15 receptor Google, 32/32 aprobación y CAS; total **57/57** de estas suites, sin modificar los proyectos conectados
- Run 44514744732: **security SUCCESS**, batería principal 388/388, e **integración nativa SUCCESS**

El archivo CAS candidato requirió una reparación de sintaxis al detectar una cadena SQL truncada y líneas duplicadas; se restituyó una única función y un único COMMIT y se volvió a comprobar en PostgreSQL, con resultado de ambas CI en verde.

## Lo que sigue bloqueado

1. Cuenta de servicio Google real con acceso readonly y habilitación supervisada de la nueva Edge Function; no se han creado ni utilizado credenciales nuevas.
2. Acreditar T→objeto y K existente en un ciclo real supervisado, sin inventar hechos ni fechas.
3. Guardado autorizado de K en la **T operativa de Hotel** antes del espejo técnico; la implementación CAS no sustituye ese guardado.
4. Protección de concurrencia completa frente a los escritores de todas las outboxes; el chequeo de una cola por SELECT no es una barrera transaccional universal.
5. Probar Apps Script con onChange real en un entorno de ensayo y después aceptar el ciclo de sincronización. No validar Alpha75.26 hasta que SINCRO funcione.

**NO fusionar ni desplegar PR #133 o #132; no activar triggers, no editar MANTENIMENT/TANCAMENT/Pizarra, R1515, V1/F2, Supabase operativo ni permisos.**
