# METROGES · SINCRO 11 · Receptor transaccional CAS de laboratorio

**17/11/2026 · CANDIDATA AISLADA · NO INSTALAR NI EJECUTAR SOBRE EL SUPABASE DE METROGES.**

## 1. Decisiones ya aprobadas (Biblia, SYNC-001; Bitácora, SINCRO 9–11)

- Identidad física de la T: **exclusivamente valor `ID_FILA` de la columna T**. Se ignora el número de fila, PA/PR, DFM, fórmula histórica y fecha operativa como identidad. R1515 está excluido por instrucción del operador.
- Solo se consideran **eventos genuinamente posteriores al 15/11/2026**, incluso si la fecha del trabajo fuese de 2024; no se recuperan cambios anteriores al corte.
- La corrección manual acreditada sobre un campo prevalece; debe volver al objeto Metroges correspondiente **por clase y significado**, sin modificar campos independientes. No basta con marcar `retenida_manual` o comparar hashes.
- Retrasos, reintentos, recargas y lecturas no cambian autoría ni fecha del hecho, no crean nuevas T/PA, no confirman una orden obsoleta ni resucitan un borrado intencional.

## 2. Contraste de estructura en el Supabase real (solo SELECT de catálogo)

Se han leído los nombres de columnas y restricciones, **sin consultar valores privados ni escribir**:

- `app_private.mg9_filas_identidad`: clave primaria `(spreadsheet_id, id_fila)`, revisión, vector SHA-256, `sync_id`, `trabajo_sync_id`, clase y estado.
- `app_private.mg9_cambios_recibidos`: `(spreadsheet_id, id_fila)` referenciado por clave foránea, columna, valor base/nuevo, `sync_id`, estado, revisión. El CHECK admite A–Q, `NOTA_A`, `NOTA_E`, `NOTA_G`, `ORDEN_T` (no T como un campo editable).
- `app_private.mg9_entregas_registradas`: clave primaria `request_id`, `payload_sha256` y respuesta JSON.
- `app_private.manteniment_t_trabajos`: tiene `sync_id`, `fecha_realizada`, `fecha_recogida` y `actualizado_en`, **pero no una revisión CAS propia de campo**.
- `app_private.manteniment_parada_outbox`: tiene `(seguimiento_id, sync_id, revision)`, estado y payload; **no** `(id_fila, campo)` para invalidar propuestas individualmente. El receptor REAL todavía requiere adaptación cuidadosa, no una sustitución directa.
- `public.facturacion_tancament_cierres`: contiene una clave `source_key` y `fila_manteniment` física; ninguna se equipara a `ID_FILA` de T sin vínculo inequívoco. Los tramos TANCAMENT permanecen fuera del mapa de esta candidata.

## 3. Lo que se ha construido

El fichero `sql/sincro11_receptor_cas_laboratorio_20261117.sql` implementa **solo en una BD ficticia** `sincro11_lab` (PostgreSQL 17, GitHub Actions):

1. `BEGIN`, comprobación explícita del nombre de BD, siete tablas `TEMP` y una función `pg_temp` sin permisos de red.
2. Simulación de staging con **el mismo papel** de las tres tablas mg9 ya existentes; **no** se ejecuta ningún INSERT en las tablas reales.
3. Testigo ficticio de evento posterior al corte, vínculo de T acreditado en laboratorio, revisión/vector de origen y revisión/valor base de destino.
4. Única equivalencia de laboratorio probada: `clase=TRABAJO`, `columna=J`, `significado=FECHA_REALIZADA` **simulado** → `fecha_realizada`; no se presume equivalente en el resto de la operativa.
5. Una transacción controla simultáneamente **CAS del dato destino**, retención de outbox antigua de ese mismo campo (cola FICTICIA), marca de evento consumido, auditoría e idempotencia de `request_id` con SHA; si falla una comprobación, no queda efecto parcial.
6. Verifica que otro campo (`fecha_recogida`/K) no cambia, que un replay exacto no duplica, que un replay alterado se rechaza, y que T ausente, TANCAMENT, R1515, versión origen posterior y CAS obsoleto bloquean.
7. `ROLLBACK` al final. El workflow exige como postcondición que no queden tablas `s11_%`.

**La fuente de evidencia manual y el almacén de revisión del destino son ficticios.** En particular, el parámetro SHA de laboratorio no constituye una verificación criptográfica de un payload real; una fila en una tabla llamada «verificada» no demuestra autoría humana. No hay emisor ni verificador real, ni conexión a F2, ni correspondencia T↔UUID acreditada para todas las clases, ni actualización de `hotel`, facturación o notas. El test de CAS por revisión no es todavía una prueba de carrera entre dos sesiones simultáneas.

## 4. Pruebas y seguridad de ejecución

- `node --test tests/security-sincro11-cas-lab.test.mjs` verifica estructuralmente que el SQL rechaza otras BD, mantiene solo objetos TEMP/`pg_temp`, tiene `ROLLBACK`, conserva identidad T y no contiene operaciones sobre `app_private` ni `public`.
- El workflow `.github/workflows/sincro11-cas-laboratorio.yml` levanta su propio contenedor **PostgreSQL 17** y usa un usuario/contraseña de prueba sin secretos de Metroges. Ejecuta el SQL con `ON_ERROR_STOP=1`, exige el resultado de las pruebas y comprueba ausencia de tablas residuales.
- No lanzar manualmente SQL contra `metrogestion-pruebas`, no crear migraciones, no fusionar la PR #132 ni desplegar un receptor funcional basándose en esta demostración.

### Condiciones pendientes para una sincronización real

Captura manual auditada y firma/autoría auténticas; vínculo comprobado por T para cada clase; mapeo de campo y significado operativo completo; revisión CAS verificable del destino; invalidación de colas antiguas con trazabilidad por campo sin anular órdenes independientes; bloqueo de escritura hacia MANTENIMENT; pruebas multi-sesión y de idempotencia; pruebas integradas completas y autorización expresa de Metro.

**Estado de producción:** ninguna modificación por este trabajo. La base V1 sellada el 16/11/2026 permanece intacta; F2 sigue sin instalar y sin referencia creada. PR borrador: https://github.com/metrogestion2026-eng/metrogestion-24h/pull/132.

## 5. Verificación efectivamente realizada el 17/11/2026

- GitHub Actions, ejecución **44034986250** (`SINCRO 11 - Receptor CAS en PostgreSQL 17 aislado`): **SUCCESS**.
- `node --test tests/security-sincro11-cas-lab.test.mjs`: **8/8**.
- PostgreSQL **17** real en contenedor aislado: se ejecutó el fichero SQL completo. El registro confirma `CREATE FUNCTION`, `NOTICE: SINCRO 11 CAS SOLO LAB: 11 comprobaciones; 1 aplicación ficticia...`, seguido de `ROLLBACK`.
- Postcondición del workflow: ninguna tabla `s11_%` persistente encontrada. No se han usado credenciales de Supabase real.
- Primera tentativa de CI 44034800466 fue **FAILURE antes de ejecutar SQL** por entrecomillado de `--health-cmd` al crear el contenedor. Se corrigió únicamente la opción de arranque y se volvió a probar; la ejecución 44034986250 pasó íntegramente. Este histórico no se oculta ni se cuenta como aprobación SQL.

**Aceptación de esta fase:** mecanismo **ficticio** de transacción/retención/acuse y sus controles superados en PostgreSQL real, sin escritura operativa. **No aceptado para producción:** procedencia humana, vínculo T↔UUID no ambiguo, reconciliación universal por clase/campo, revisión CAS del destino real, outbox real y pruebas de simultaneidad entre dos conexiones.