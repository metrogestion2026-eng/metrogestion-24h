# SINCRO 13 · Colas protegidas antes, durante y después del CAS de K

**19/11/2026 — PR #133, borrador, SIN DESPLEGAR. Datos operativos intactos.**

## Diagnóstico de solo lectura del Supabase de pruebas

- La cola `app_private.manteniment_parada_outbox` se serializa ya mediante `app_private.proteger_outbox_continuidad_alpha75`, que toma `app_private.bloquear_sync_continuidad_alpha75()` en su trigger BEFORE INSERT/UPDATE/DELETE. La clave real es `hashtextextended('MG75-CONTINUIDAD-001:manteniment-sync',0)` y el bloqueo es transaccional.
- El escritor `app_private.manteniment_encolar_activo` no comparte esta barrera; tampoco había trigger equivalente sobre `app_private.manteniment_activo_outbox`.
- Las órdenes de trabajo de PARADA se transmiten con `trabajo_sync_id` y, cuando se modifica K, con `fecha_salida`. En la cola de pruebas aparecen ambos grupos `trabajos_asignados` y `trabajos_crear`, por lo que hay riesgo de reenvío posterior de K antigua incluso después de un CAS correcto.
- Hay **32** órdenes PARADA pendientes y **2** de ACTIVOS pendientes según la consulta de solo lectura del 19/11. No se han cambiado, publicado ni confirmado.

## Solución candidata, en dos barreras distintas

### 1. Concurrencia DURANTE el CAS

- Archivo `sql/sincro13_bloqueo_outbox_activo_candidato_20261119.sql`: trigger BEFORE INSERT/UPDATE/DELETE de ACTIVOS que toma el bloqueo global ya usado por PARADA. No cambia payloads, permisos, estados ni datos.
- Archivo `sql/sincro13_cas_k_candidato_20261119.sql`: tras bloquear la fila técnica con FOR UPDATE y comprobar su identidad, adquiere **el mismo** bloqueo global ANTES de consultar las dos colas y antes del ajuste técnico de K.
- El orden **trabajo técnico → lock global** es intencionado: los triggers de Hotel ya pueden recalcular primero el trabajo técnico y encolar después. Adquirir en orden inverso puede provocar deadlock.
- `tests/integration-sincro13-outbox-lock.pg.test.mjs` abre **dos sesiones PostgreSQL 17 reales**; una mantiene el lock y la otra prueba actualizaciones de PARADA/ACTIVOS y el CAS, que deben encontrar lock_timeout. Tras liberarse, funcionan y las colas conservan sus estados. **4/4 PASS**.

### 2. Reenvío de K antigua DESPUÉS del CAS

- Archivo `sql/sincro13_retencion_k_manual_outbox_candidato_20261119.sql`: nuevo trigger de PARADA ejecutado al preparar una salida futura. Solo actúa si hay una evidencia de **K ya APLICADA** a un `trabajo_sync_id` exacto. Obtiene la corrección más reciente de ese trabajo; no utiliza número físico de fila, DFM ni PA para identificarla.
- Comprueba `fecha_salida` tanto en `trabajos_asignados` como en `trabajos_crear`. Si difiere de la última K aprobada, cambia solo el estado de la orden nueva a `retenida_manual` y deja motivo, sin borrar ni modificar el payload. Otros paquetes sin conflicto pueden continuar; si un paquete mezcla varios trabajos, **se retiene entero** para no perder ninguno ni separar arbitrariamente su contexto.
- Se retiene también un lote no cotejable: UUID ausente cuando existe fecha_salida, colección inválida o trabajo malformado. Si no hay fecha_salida para un trabajo, no se inventa K.
- `tests/integration-sincro13-outbox-retencion.pg.test.mjs`: **12/12 PASS** sobre PostgreSQL ficticio, incluidos paquete con varios trabajos, fecha antigua, K correcta, NULL, trabajo ajeno, UUID ausente, datos malformados y preservación de valores.

## Resultado reproducible y límites

- GitHub Actions run **44522458919**: 10/10 recepción T, 15/15 lectura Google, 32/32 CAS y adopción, 4/4 dos conexiones, 12/12 retención. **73/73 tests de PostgreSQL17 SUCCESS.**
- GitHub Actions run **44522458964**: seguridad general SUCCESS; integración nativa continuaba ejecutándose al registrar esta versión. Verificar final antes de declarar verde completo.
- Pruebas en CI de PostgreSQL17 aislado: los triggers actuales de PARADA se reproducen en fixtures; no se han aplicado al proyecto conectado. El SQL candidato activo y el CAS deberán validarse además junto a los triggers complejos reales antes de cualquier despliegue.

## Qué sigue BLOQUEADO

1. La cuenta de servicio de Google, configuración de secrets y ejecución real de la nueva Edge todavía NO están preparadas ni instaladas.
2. No se ha completado la adopción de K en la etapa operativa de Hotel; el CAS sigue siendo solo un espejo técnico posterior.
3. El inventario de T existentes sin vínculo causal positivo sigue excluido. Nada anterior al corte puede acreditarse por fecha, nota u onEdit.
4. No se ha realizado una ida/vuelta efectiva de una T real y autorizada con Google y Hotel. **SINCRO NO OPERATIVA y Alpha75.26 NO VALIDADA**.
5. PR #132 congelada; PR #133 OPEN/DRAFT/UNMERGED. No tocar MANTENIMENT, TANCAMENT, Pizarra, R1515, V1/F2 ni Supabase operativo, ni activar escritura, SQL, triggers, credenciales o Edge hasta cumplir puertas.
