# METROGES · SINCRO 14 / SINCRO 13 · Puente causal de nuevas T desde la revisión 4 de Apps Script
**21/11/2026 · Estado: candidato local preparado, NO instalado.**

## Contexto contrastado
- Apps Script verdadero que funciona con los tres activadores de identidad: revisión 4 basada en `alpha75-2026.11.07.12`. En su primer ensayo se confirmó T=7002 como `ACTIVA/INSERT_ROW`, no apta para acreditar una nueva T de trabajo de orden de Hotel.
- En Supabase `metrogestion-pruebas` el receptor SQL S13 y sus funciones de evidencia, aprobación, CAS y adopción están instalados, pero `escritura_segura_manual=false`. Edge `manteniment-sync-r1` está en versión 13 (las seis rutas lease v12 preservadas), Edge `sincro13-google-lector-lab` en v1 con `verify_jwt=true`. Receptor Google SQL `habilitado=false`, sin secreto. Cero recibos T / evidencias K / adopciones al reconsultar el 21/11.
- El proyecto de producción **no** se ha modificado. PR #133 se mantiene DRAFT; Alpha75 NO VALIDADA.

## Código del puente candidato
Se partió del **archivo completo Rev4 real**, no del candidato desfasado de PR133. Archivo entregado al usuario en el chat: `METROGES_SINCRO14_REVISION_5_PUENTE_T_20261121.zip`, SHA-256 de ZIP `6efb60656c72daaff4f376bcadc2f82f579b611b65bace57f3cb61a2e1a9ceea`. Incluye respaldo exacto Rev4, candidato Rev5, diff, 2 archivos test, diagnóstico de solo lectura y README. SHA-256 de candidato `9e11b46c9867f208a20e4202545a5369cef14e3a567508334d191b1c648d270e`. SHA-256 de código Rev4 `2f5203b937c8f8753b2197ca45104011eaf421a0c324e89063be4de79a2550af`.

El candidato Rev5 tiene 5.211 líneas y conserva las **206 declaraciones de funciones originales**, sin duplicarlas; añade cinco funciones especializadas de S13. Mantiene `METROGESTION_S13_RECIBOS_RECEPTOR_VALIDADO=false`.

### Contrato nuevo
1. Una nueva T requiere ID_FILA literal única, `REGISTRO_FILAS ACTIVA / ORDEN_AUTORIZADA` posterior al 15/11, nota E única `METROGESTION_T:UUID`, clase de trabajo válida y confirmación del servidor que incluya ese trabajo. Rechaza de forma expresa R1515, PARADA, ARCHIVO, FIN, ALTA, IDs manuales/históricos y recibos ambiguos.
2. El recibo positivo de T se guarda en el journal DURABLE **antes del ACK**. El journal incorpora `s13_request_id` único guardado antes de la primera operación, de modo que un reintento del mismo recibo usa el **mismo** UUID y no se etiqueta como una nueva emisión.
3. Emisor `ack_t_nuevas` antes de `ack_execution`. Si la respuesta no coincide exactamente con protocolo, request_id, ID de hoja, cardinalidad, estado `PENDIENTE_VERIFICACION_GOOGLE` y `autoriza_sincronizar=false`, se retiene la orden. No se autoriza ACK ni reejecución.
4. Preflight de planificación rechaza órdenes que crearían nuevas T mientras el flag S13 esté apagado, **antes del primer journal o escritura de Google**. Así no se genera una orden parcialmente aplicada cuando aún no existe verificador Google independiente.
5. Se mantienen el código Rev4 existente, ID_FILA T, eventos onChange/onEdit/watchdog, `REGISTRO_FILAS`, reglas de fechas, Drive, Pizarra y rutas lease intactas; los valores manuales de MANTENIMENT conservan prioridad.

## Verificación local
- `node --check < SINCRO14_REVISION_5_PUENTE_T_COMPLETO.gs`: sin error de sintaxis.
- `node --test S14_PRUEBAS_BASE.test.mjs S13_RECIBOS_PUENTE.test.mjs`: **50/50 PASS**, desglosado en 33 de regresión S14 y 17 del nuevo puente T.
- Casos: creación T única y UUID exacto, rechazo de INSERT_ROW T7002, fecha antigua, R1515, clases ajenas, nota falsa/duplicada, journal incompleto, petición y respuesta exactas, idempotencia, error sin ACK, orden estricta recibo→ACK y bloqueo de planning cuando la bandera está OFF.
- No se ha ejecutado este nuevo script en **Apps Script verdadero** y no se ha publicado como Edge/SQL nuevo. La comprobación HTTP directa desde entorno técnico no resolvió el DNS de Supabase; no representa éxito ni error de respuesta del servidor.

## Bloqueo crítico para la operatividad
Hace falta **conectar realmente un lector Google independiente** (cuenta de servicio solo lectura, API Google Sheets habilitada, compartir el libro como lector, configurar sus secretos directamente en el servidor sin revelarlos en chats), comprobar su autenticación y doble lectura T/nota/K, y probar una primera operación verdadera con sesión de administrador, hora real y CAS Hotel sin colas conflictivas. No inventar T, PA, recuperación ni hora. No encender S13 ni la sincronización programada antes de E2E; no reemplazar la revisión 4 actual del usuario todavía.

Este registro conserva el relevo técnico. El archivo Rev5 completo está entregado al usuario en la conversación del 21/11/2026; la rama GitHub mantiene el desarrollo previo hasta que pueda integrarse con cotejo completo.