# SINCRO 11 · Detector de cambios por ID_FILA (candidata, NO instalada)

Corte operativo decidido: 15/11/2026; sincronizar únicamente cambios futuros cuando estén acreditados, sin retroconciliación. Esta candidata no tiene permisos de sincronización, **no es un ejecutor bidireccional** y no crea fichas ni T.

## Qué hace

- `metroSincro11PrevisualizarBase()`: lee MANTENIMENT, comprueba los ID_FILA en columna T, no escribe.
- `metroSincro11SellarBase()`: solo cuando el operador apruebe la instalación y cierre una ventana sin ediciones, toma dos fotografías y sella la referencia en DocumentProperties del proyecto vinculado. No escribe ninguna celda ni envía datos a Metroges.
- `metroSincro11Comparar()`: compara las 26 columnas y sus notas por ID_FILA, independientemente de número de fila físico, PA, DFM o fechas operativas; devuelve altas, cambios y ausencias **sin escribir**. Una diferencia no acredita por sí sola autor humano ni hora exacta.
- `metroSincro11Estado()`: inspecciona la referencia.

El fichero es **ADICIONAL**, no sustituye `sincronizar_manteniment.gs`, no redefine `onEdit`, no instala disparadores, no toca MANTENIMENT, TANCAMENT ni Supabase. Los scripts de producción siguen bloqueados hasta una aceptación real en el Apps Script vinculado. No usar el menú 'Sincronizar ahora' como prueba: puede escribir.

## Pruebas y límite

Ejecutar `node --test tests/security-sincro11-base-futuro.test.mjs`. Pruebas sintéticas sobre API simulada de Google con límites de 9KB/valor y 500KB para las propiedades, incluido ensayo con 6.742 filas. Verificar con GitHub Actions. **No se acredita ejecución real de Apps Script hasta ejecutar el preflight en el proyecto vinculado.** Los cambios posteriores a la referencia se proponen para cotejo, no se aplican; si se colocó la referencia tras una edición, esa edición no se considera posterior. Las modificaciones rápidas simultáneas son una limitación de onEdit, por eso no se usa como prueba exclusiva.

No ejecutar el sellado hasta que el usuario decida cuándo comienza la captura futura y esté cerrada la ventana de edición.


## 16/11/2026 · Detector FUTURO independiente (aún no conectado)

El módulo **`shared/sincro11-futuro-lector.mjs`** contiene la regla que se aplicará al futuro: **identidad solo por el VALOR de la columna T** (ID_FILA), nunca por posición, PA, DFM, fórmula o fecha operativa. Compara dos fotografías posteriores al corte 16/11/2026, no la fecha antigua de I/J/K.

Las fórmulas existentes anteriores al corte no forman parte del disparador operativo, ni su texto A1 ni sus resultados recalculados; **sí se cotejan las notas** aunque la celda contenga fórmula. Cambios nuevos reales en I/J/K o en otras celdas literales sí aparecen, incluso sobre una T de 2024. Si una fila cambia de posición, el ID_FILA continúa siendo el mismo. Si aparece una PR provisional y luego una PA, es diferencia de E, no alta ni nueva parada automática.

El **sellado V1 realizado el 16/11/2026 a las 06:30:25** sigue intacto: no se reinicia, no se sustituye por una supuesta V2 y **no se infiere autoría ni momento exacto** desde el texto de una fórmula. La V1 usa otra huella (incluye fórmulas); las dos lecturas que necesita el detector futuro deben obtenerse de manera independiente y **no pueden reconstruirse retrospectivamente** a partir de esos hashes. Por tanto, este módulo no se debe presentar como sincronización ya instalada ni usar para autorizar órdenes: todos sus resultados son propuestas de cotejo.

Prueba: `node --test tests/security-sincro11-futuro.test.mjs` — 28 ensayos sintéticos, incluido un lote de 6.742 filas, TANCAMENT histórico editado posteriormente, cambio de nota, desplazamiento de fila con fórmula A1, PR→PA sin nueva parada, duplicados, ausencias y valores privados no expuestos. **No sustituir** el fichero Apps Script existente ni ejecutar `SellarBase` otra vez. No desplegar ni fusionar PR hasta pruebas integradas con el receptor, validación de origen humano y permiso expreso del operador.
