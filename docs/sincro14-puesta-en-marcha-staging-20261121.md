# SINCRO 14 · Puesta en marcha progresiva en staging · 21/11/2026

## Prioridad operativa
La petición de Metro es que la SINCRO **Google → Hotel → K** funcione cuanto antes. No confundir código probado con instalación de extremo a extremo, ni activar escrituras sobre MANTENIMENT a partir de coincidencias de posición, DFM, PA, fecha o nota aislada. R1515 está confirmado correcto por Metro; no abrir una incidencia antigua ni modificarlo.

## Parte Google confirmada previamente
El código REAL de Apps Script está en compilación `alpha75-2026.11.07.12` (SINCRO14 revisión 4), con tres activadores de identidad instalados desde upcpract@gmail.com. El lector `metrogestionVerificarIdentidadFilas` terminó en 4,2 segundos. Primera inserción real creó `ID_FILA=7002` en T, REGISTRO_FILAS `ACTIVA/INSERT_ROW`, H2=7002. Censo: 6.774 filas con T únicas, 228 BORRADA, ninguna RESERVADA. **Esta T es una línea ARCHIVO, no puede acreditar una nueva T de trabajo `ORDEN_AUTORIZADA`.** La consulta de REGISTRO_FILAS no encontró por el momento ninguna T con origen ORDEN_AUTORIZADA.

## Nuevas instalaciones realizadas SOLO en Supabase metrogestion-pruebas
Proyecto `aemoouldgguyjsxrfuwo`. No se ha modificado el proyecto productivo `njtohfkqjjoavtumtmza`.

Migrations instaladas, en orden, el 21/11/2026:
1. `sincro13_recibos_t_staging_desacoplado_20261121`: `app_private.sincro13_lotes_t`, `app_private.sincro13_recibos_t`, RPC de recepción T con token y origen exacto
2. `sincro13_k_evidencias_base_staging_20261121`: evidencias privadas de K, sin emisión autorizada por defecto
3. `sincro13_google_receptor_deshabilitado_staging_20261121`: receptor Google privado y config `habilitado=false`, sin secreto
4. `sincro13_aprobacion_k_staging_segura_20261121`: aprobación admin autenticada, no atribuir autoría de edición Google
5. `sincro13_cas_k_staging_seguro_20261121`: comparación por T/UUID/valor anterior y bloqueo de outboxes
6. `sincro13_adopcion_hotel_staging_segura_20261121`: registro de hora real aprobada en etapa Hotel con CAS y triggers nativos.

Relectura SQL: 5 tablas técnicas presentes, **0 lotes, 0 recibos, 0 evidencias, 0 aprobaciones, 0 adopciones**. Configuración global protegida `solo_lectura_manual_protegida=true`, `escritura_segura_manual=false`, `pausa_importacion_identidad=false`. Receptor de Google con `habilitado=false` y `secreto_sha256=NULL`. Outbox preexistente, sin cambios durante la intervención: 33 PARADA pendientes y 4 ACTIVOS pendientes. No instalar hasta un ensayo controlado los triggers de retención / serialización adicional para no interferir con cola operativa.

### Edge Function manteniment-sync-r1
Se conservó primero código EXACTO desplegado v12 y helper:
`supabase/staging-backups/manteniment-sync-r1-v12-20261121/`.

Sobre ese código se insertó de forma aislada la acción nueva `ack_t_nuevas`, con validación de token, recibo y RPC `sincro13_registrar_recibo_t`. **Reverse diff de la candidata sin la ruta S13 = mismo código original v12 byte por byte.** Quedan intactas las seis rutas lease (preflight_lease, open_lease, sync_lease, authorize_lease, ack_lease, close_lease), más preflight y receptor previo. Rama PR #133 archivo `supabase/functions/manteniment-sync-r1/index.ts`.

**DESPLEGADO EN STAGING**: `manteniment-sync-r1` versión **13**, status ACTIVE, verify_jwt=false (valor heredado); lectura posterior exacta con archivo de GitHub y presencia de las siete rutas. No producción. Edge `sincro13-google-lector-lab` v1 (verify_jwt=true) sigue deshabilitada por flags/secret ausentes. No ha habido llamada HTTP autenticada E2E desde Apps Script a la nueva versión; estado ACTIVE no acredita ejecución de una petición.

CI de PR133 HEAD `c70344095e0b6bb3efd29094d1dbbc69e566a4f5`: GitHub Actions seguridad, integración nativa y laboratorio PostgreSQL17 SUCCESS (runs 44896167000 y 44896167067). Además, prueba de barreras NEGATIVAS ejecutada directamente en staging PostgreSQL: token T falso rechaza `S13_AUTH_DENEGADA`; lector Google deshabilitado rechaza `S13_LECTOR_NO_AUTORIZADO`; adopción Hotel sin sesión admin rechaza `S13_HOTEL_ADMIN_NO_AUTORIZADO`. Sin datos operativos escritos.

## Lo que aún impide declarar «operativa»
1. **Prueba HTTP real desde Apps Script actual al receptor v13:** ejecutar únicamente `metrogestionComprobarInstalacionSoloLectura`, ya presente en S14 revisión 4. Usa preflight con token instalado, no escribe datos ni abre sincronización; cotejar log y barreras (su informe debe mantener `sincronizacion_autorizada=false`).
2. **Google independiente:** crear cuenta de servicio Google Cloud dedicada, habilitar Sheets API, compartir MANTENIMIENTOS como Lector y configurar `S13_GOOGLE_SERVICE_ACCOUNT_JSON` en Edge Secrets; fijar `S13_GOOGLE_SPREADSHEET_ID` al ID autorizado. La clave JSON debe almacenarse **directamente** en Supabase, NUNCA enviarse al chat ni guardarse en GitHub. Se requieren además secreto independiente de verificador y configuración SQL correspondiente, con posterior prueba bajo flags controladas. Ninguna credencial está configurada por este trabajo.
3. **Emisor Apps Script:** el actual S14 revisión 4 no incluye aún envío S13 de recibos causales T antes de ACK. La PR133 tiene un emisor candidato basado en un script anterior; no reemplazar por él el código S14 actual. Integrar y probar manteniendo revisión 4 y flags apagadas hasta E2E con datos ficticios.
4. **Primer trabajo válido real:** ninguna fila actual de origen INSERT_ROW (incluido T7002 ARCHIVO) permite fingir una T de trabajo ORDEN_AUTORIZADA. Se necesita una orden auténtica autorizada de Hotel con T positiva y UUID, o el libro de ensayo ficticio para E2E.
5. **CAS de K con Hotel:** K Google es día, no hora. Registrar hora real únicamente con confirmación explícita de administrador autenticado y mismo día Europe/Madrid; realizar ensayo completo con triggers Hotel y proteger ambas outboxes antes de habilitar cambios. No completar Recuperar automáticamente.

### Siguiente acción segura para Metro
En Apps Script original, desde upcpract, ejecutar solo `metrogestionComprobarInstalacionSoloLectura` y aportar la salida del Registro de ejecución (sin token). NO pulsar Sincronizar ahora, Enviar hoja, Instalar actualización cada seis horas, ni abrir flags Google.

**Resultado actual**: receptor S13 SQL + Edge v13 instalado en STAGING y barreras verificadas; Google→Hotel→K aún **NO OPERATIVA**, Alpha75 aún **NO VALIDADA**. Mantener PR #133 DRAFT y PR #132 congelada.

## 21/11/2026 · Barrera SQL adicional de solo lectura — INSTALADA EN STAGING

El preflight técnico ha descubierto que `app_private.recibir_snapshot_manteniment(text,jsonb)` ejecutaba `aplicar_snapshot_manteniment` y marcaba pendientes como `retenida_manual` **incluso con** `solo_lectura_manual_protegida=true`. Esto contradice la intención de no modificar datos al diagnosticar la sincronización.

**Instalado solo en metrogestion-pruebas:** migración `sincro14_snapshot_solo_lectura_guard_staging_20261121` a partir de [SQL exacto](../sql/sincro14_barrera_snapshot_antes_efectos_staging_20261121.sql). Tras verificar token y pausa, una nueva guardia exige `solo_lectura_manual_protegida=false` y `escritura_segura_manual=true`. Si no se cumplen ambas, lanza `S14_BLOQUEO_SOLO_LECTURA` **antes** de cualquier UPDATE de configuración o `aplicar_snapshot_manteniment`; la transacción no llega a alterar colas. La RPC separada `preflight_manteniment` no se cambia.

**Prueba real:** primera compilación de la función dentro de `BEGIN ... ROLLBACK` sin persistir cambios; lectura posterior confirmó que la guardia no había quedado instalada y había 33 PARADA más 4 ACTIVO pendientes. Después se aplicó la migración de staging. SQL de verificación confirmó `guard_barrera_precede_escrituras=true`, `manual_protegido=true`, `escritura_segura_habilitada=false`, 33 PARADA pendientes, 4 ACTIVO, 0 recibos T, 0 evidencias K, 0 adopciones Hotel. **No se ha probado un POST con token verdadero desde Apps Script**; no declarar E2E.

**Importante:** existe también una ruta de ejecución por lease con alcance autorizado que sigue separada y protegida por su propio flujo; este parche endurece únicamente la ruta clásica `recibir_snapshot_manteniment`. No afirmar que invalida los permisos de un lease legítimo ni que integra la cuenta Google.

### Credencial Google: verificación objetiva del bloqueo
Consulta de los permisos reales de MANTENIMIENTOS a través de Google Drive: únicamente tres entradas (dos editores y propietario), **ninguna cuenta `*.gserviceaccount.com` con permiso de lector**. El código del lector Edge sigue demandando `S13_GOOGLE_SERVICE_ACCOUNT_JSON`, `S13_GOOGLE_SPREADSHEET_ID`, `S13_GOOGLE_READER_ENABLED=true`, autenticación de administrador con dispositivo autorizado, y sólo usa el ámbito OAuth `spreadsheets.readonly`; el registro de evidencias tiene otra puerta `S13_GOOGLE_EVIDENCE_ENABLED` independiente. Mantener ambas puertas OFF hasta probar credenciales desde la sesión de administrador.

**Acción fuera del alcance de las conexiones actuales:** crear la cuenta de servicio en Google Cloud y generar la clave JSON, compartir con ella el libro original como lector, guardar JSON y Spreadsheet ID directamente en Supabase Edge Function Secrets (proyecto de pruebas). **Jamás** introducir la clave JSON en este chat, en GitHub ni en una hoja. El correo público de servicio sí puede compartirse sin la clave y se puede otorgar permiso Lector por la conexión de Drive.

**CI:** la verificación de privacidad detectó una matrícula real dentro del documento público `sincro14-preflight-7-ordenes-postcorte-20261121.md`; fue retirada del contenido actual y se lanzaron de nuevo las comprobaciones. No publicar datos identificables de flota en GitHub en futuras bitácoras.

**La sincronización Google→Hotel→K continúa deshabilitada y Alpha75 sigue sin validar**. El cambio instalado es preventivo y medido, no un anuncio de operatividad.
