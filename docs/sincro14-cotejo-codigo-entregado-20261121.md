# SINCRO 14 · Cotejo del Apps Script entregado (21/11/2026)

## Fuente auténtica aportada por el operador
Archivo adjunto en el chat SINCRO 14: `Texto pegado(2).txt` (Google Apps Script completo), 4.770 líneas, `buildVersion: alpha75-2026.11.07.12`, `scriptVersion: alpha75-2026.10.26.1`, `fotografiaVersion: MG75-FOTO-ID-FILA-001`. SHA-256 de los bytes originales recibidos: `3fc74b255ee74b66eef0ae002e08b1b363a8536e459e9e5743c811439df34885`. NO asumir que el archivo pegado representa el código desplegado sin preflight del proyecto vivo.

**No reemplazar por el `sincronizar_manteniment.gs` de la PR #133:** la candidata anterior usa otra compilación y no incorpora automáticamente todas las mejoras del archivo entregado.

## Riesgos localizados en el archivo entregado
- `metrogestionVerificarIdentidadFilas` invoca `metrogestionReconciliarIdentidadFilas_('VERIFICACION_MANUAL')`; por tanto la opción «Verificar» NO es solo lectura en ese archivo.
- `metrogestionReconciliarIdentidadFilas_` podía declarar `BORRADA` a toda T activa ausente en `INSERT_ROW`, `OTHER` e incluso `VERIFICACION_MANUAL`, sin prueba real de borrado de la fila.
- `onEdit` simple asignaba IDs y ocultaba sus excepciones con `catch (_)`.
- El ejecutor de órdenes guardaba el journal sin obtener antes `DocumentLock` para todas sus inserciones; otro activador podía entrar durante el intervalo.
- Los eventos Google no identifican con seguridad la hoja afectada ni la autoría humana; los cambios por API/script no disparan estos activadores.

## Preparación de corrección local, NO instalada
Paquete generado en este chat: `METROGES_SINCRO14_REVISION_CODIGO_20261121.zip`, contiene respaldo íntegro, candidata completa basada en el código entregado, diff unificado, 20 pruebas y diagnóstico independiente solo lector.

SHA-256 de la **candidata** (LF) `fa562755c5f29402c5f34cc487b0a38a279d628025c1a2adfb86c00f9b3eb375` (confirmar SHA256SUMS del paquete si se generan nuevas revisiones). Nombres de archivos en el paquete:
- `01_CODIGO_RECIBIDO_RESPALDO.gs`
- `02_SINCRO14_CANDIDATA_COMPLETA.gs`
- `03_PRUEBAS_ID_FILA_S14.test.mjs`
- `04_DIAGNOSTICO_SOLO_LECTURA_PARA_APPS_SCRIPT.gs`
- `05_DIFERENCIAS_UNIFICADAS.patch`
- `00_LEEME_SINCRO14.txt` y `SHA256SUMS.txt`

Cambios mínimos sobre el archivo entregado: verificar T pasa a lectura exclusiva; las altas usan número creciente y bloqueos, las bajas requieren diferencia acreditada, el onEdit simple deja de escribir T, hay instalable técnico de identidad y vigilancia lectora, y el ejecutor mantiene DocumentLock desde antes de su journal y evita adquirirlo dos veces para T. No alterar `scriptVersion`, plan de trabajo, TANCAMENT, Pizarra, R1515 ni la lógica de SINCRO 13. Una interrupción tras reservar ID se bloquea, no se reintenta a ciegas.

`node --check` de candidata y del diagnóstico: PASS. **20/20 tests Node aislados PASS**, incluidos duplicado, fórmula, fila al final, interrupción, baja real, baja falsa desde otra pestaña y coordinación estática con el ejecutor. Esto NO es prueba de Apps Script real ni equivale a 20 validaciones productivas.

## Libro real 21/11/2026 (solo lectura)
MANTENIMENT conserva 6.773 ID_FILA T positivos, únicos, sin huecos o duplicados. REGISTRO_FILAS 7.001 IDs: 6.773 ACTIVA + 228 BORRADA, sin T extraña, ACTIVA ausentes ni BORRADA reaparecida. Contador H2 = 7001. R1194 ITV T6984 y R1597 FIN T7001 preservadas. No se ha escrito en el libro durante esta fase.

## Puerta de instalación y verificación
1. Añadir **solo** `04_DIAGNOSTICO_SOLO_LECTURA_PARA_APPS_SCRIPT.gs` como archivo nuevo en Apps Script existente, ejecutando `metroSincro14DiagnosticoCodigoRecibido`. No sustituir el principal aún.
2. Cotejar build real, cuenta efectiva que creó cada trigger visible en esa cuenta, permisos nativos de T y existencia de edición técnica de REGISTRO_FILAS. Google no permite retirar permisos al propietario del rango protegido; los triggers de otras cuentas no son visibles entre sí.
3. Tras cotejo del código realmente instalado y de la cuenta técnica, preparar sustitución con respaldo y prueba de inserción real supervisada; NO pulsar botones `Sincronizar ahora` ni `Instalar actualización cada 6 horas`.
4. No declarar la protección preventiva plenamente operativa hasta probar activadores reales y permisos; Alpha 75 seguirá sin validar hasta que funcione toda la SINCRO Google → Hotel → K.

**PR #133 sigue DRAFT / no fusionar ni instalar a ciegas.** Este documento es un relevo técnico y de seguridad, no una autorización de escritura.

## Ampliación SINCRO 14 · Revisión segura 2 · 21/11/2026

Se ha vuelto a verificar byte por byte que `01_CODIGO_RECIBIDO_RESPALDO.gs` coincide con el texto adjunto. La huella publicada anteriormente para ese archivo era incorrecta: **la correcta es `3fc74b255ee74b66eef0ae002e08b1b363a8536e459e9e5743c811439df34885`**. No afecta a las 18 correcciones de identificadores ya confirmadas ni autoriza una nueva asignación.

Nuevo paquete local de la conversación: **`METROGES_SINCRO14_REVISION_SEGURA_2_20261121.zip`**. Su código candidato `02_SINCRO14_CANDIDATA_COMPLETA.gs` tiene SHA-256 **`342a4702f53a7c463d888ede99da38c04796b514eb2c5b78a8e71b8ec0e1d67c`**; el respaldo conserva exactamente los bytes del original. El paquete anterior queda como referencia, no como versión a instalar.

El nuevo control bloquea la asignación si existe cualquier ID `RESERVADA` pendiente de resolver, aunque `ULTIMO_ID_EMITIDO` sea coherente; no vuelve a usarlo. El diagnóstico autónomo informa del número de reservas incompletas y de la protección de `REGISTRO_FILAS`, además de la de T. Los tests sintéticos pasan **26/26**, incluidos bloqueo del journal por `DocumentLock`, fallo tras reserva y ejecución real del diagnóstico con hoja ficticia sin escritura.

Auditoría del original MANTENIMENT del 21/11/2026, solo lectura: **6.773 T válidas y únicas; cero vacías/duplicadas; 7.001 identificadores registrados, 6.773 ACTIVA y 228 BORRADA, contador H2=7001**. No ejecutar la candidata hasta comprobar la cuenta instaladora, el código verdaderamente activo y los permisos. No afirmar que el propietario pierde su capacidad de edición: Google no lo permite con protección de rango. Tampoco asegurar que onEdit/onChange se disparan por escrituras API o scripts.

**SINCRO permanece no operativa y Alpha 75 sin validar.** Solo el nuevo diagnóstico (archivo 04) es apto para añadirse de forma aislada al proyecto actual; no sustituye el principal ni instala activadores.
