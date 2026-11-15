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
