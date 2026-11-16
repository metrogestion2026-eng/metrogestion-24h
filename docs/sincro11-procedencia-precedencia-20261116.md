# METROGES · SINCRO 11 · Procedencia y retorno por campo (candidata de laboratorio)

**16/11/2026 — NO INSTALAR, NO FUSIONAR, NO DAR PERMISO DE ESCRITURA.**

## 1. Reglas ya aprobadas que se implementan como modelo

Se ha contrastado con la **Biblia, SYNC-001**, y la **Bitácora, SINCRO 9/10/11**:

- La **única identidad** de una línea de MANTENIMENT es el valor **ID_FILA de la columna T**. No se identifica por posición física, DFM, matrícula, número de PA o PR, fecha de I/J/K, fórmula A1 ni UUID compartido de nota.
- El cambio **manual** en un campo de una línea vinculada a Metroges debe prevalecer sobre la copia remota de ese mismo concepto y debe **volver a Metroges** si se acredita su autoría, revisión e identidad. Esto también vale para líneas enviadas anteriormente desde Metroges.
- Los cambios **independientes** se combinan; no se sobrescriben otros campos por corregir una fecha, una nota o unos kilómetros. Una J de tramo contable no significa una J de entrada física a taller: la **clase** y el **significado** deben estar acreditados antes de direccionarla.
- Borrar deliberadamente es una modificación; **no enviar un campo** no lo borra. Leer datos históricos no los convierte en movimientos nuevos. Retener una propuesta obsoleta es protección, no un retorno completado.
- La fecha de ejecución de una sincronización NO se convierte en una fecha de edición humana. El corte de trabajo es 16/11/2026, pero la fórmula y los hechos históricos siguen intocados.
- Las identidades expresamente excluidas por el operador se retienen. R1515 no puede tratarse por similitud de DFM ni inventando su ID_FILA.

## 2. Código nuevo en rama de pruebas

`shared/sincro11-evidencia-precedencia.mjs` y `tests/security-sincro11-evidencia-precedencia.test.mjs`.

Se ha implementado **un contrato de evidencias con firmas Ed25519** para probar en aislamiento la separación entre: (a) una captura del cambio manual atribuida a un agente de captura, (b) un vínculo firmado por el servidor entre T, clase, significado y UUID de objeto, (c) una lectura firmada de la revisión actual del campo en el servidor y (d) una nueva lectura de la celda actual. Dos claves de prueba distintas separan las funciones de captura y servidor. El motor solo acepta huellas SHA-256 y metadatos, no expone valores privados en el informe.

La salida diferencia `RETENER`, `SIN_CAMBIO` y `PREPARAR_COTEJO`. En este último caso incorpora únicamente **la versión y huellas que habrían de cotejarse** con una transacción futura; nunca guarda, ejecuta ni autoriza una propuesta. Las firmas firmadas solo acreditan la tenencia de la **clave de prueba**, **NO** verifican la presencia de una persona real, la lectura desde Google, la validez de un contrato de identidad ni los permisos del backend. Todas estas condiciones quedan expresamente **no acreditadas en producción**.

La prueba usa **registros sintéticos** (ID_FILA 99999 y UUID ficticios), no copia expedientes, teléfonos, documentación ni datos reales de la flota. Las claves privadas se generan temporalmente durante las pruebas y NO se incorporan al repositorio ni al paquete.

## 3. Resultado y límites

`node --test tests/security-sincro11-evidencia-precedencia.test.mjs`: **44/44 pruebas locales**.

Incluyen edición de fecha antigua posterior al corte, cambio en línea que originalmente llegó de Metroges, notas, borrado explícito, valores ausentes, correcciones por campo independientes, rechazo de firmas falsificadas, sustitución de clave no acreditada, evento repetido, lectura obsoleta, correspondencia semántica errónea, duplicidad, ausencia de vínculo, exclusiones, y lectura de 6.742 testigos sintéticos con una sola T cambiada. El módulo **no conecta con Supabase, Google Apps Script ni TANCAMENT**.

**Todavía no se ha instalado:** agente real que registra la modificación manual con revisión; registro de claves confiables; firma y verificación de los vínculos T↔UUID para todas las clases; tabla de eventos consumidos durable; mapeo por campo de la semántica operativa; y receptor transaccional CAS con sustitución de órdenes antiguas y auditoría. Ni V1 ni F2 ni esta candidata permiten saltarse esas comprobaciones. F2 continúa sin instalar ni sellar; la V1 original de las 06:30 del 16/11 sigue sin modificarse.

**Siguiente desarrollo permitido:** implementar y ensayar en laboratorio el cotejo de vínculos y el plan transaccional del retorno por clase/campo, sobre la estructura de staging ya documentada en SINCRO 9, sin reabrir históricos ni escribir en producción. Cualquier instalación final requiere evidencia y autorización separadas.

PR borrador: <https://github.com/metrogestion2026-eng/metrogestion-24h/pull/132>.