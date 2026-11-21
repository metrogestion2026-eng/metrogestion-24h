# SINCRO14 · Respaldo antes de instalar fórmulas en seis L de PARADA/TANCAMENT

**Fecha:** 21/11/2026. Hoja: MANTENIMIENTOS / MANTENIMENT. Datos originales leídos desde Google Sheets antes de la actuación. Cada fila se identifica por columna T / ID_FILA; el número físico se consigna únicamente como localizador temporal de la lectura.

**Petición de Metro:** «2716 CORREGIDO, APLICA FÓRMULA DONDE FALTEN». Se conserva el valor previo en blanco y todas las fórmulas de P preexistentes. Cambiar solo L vacía, usando condición K, y corregir formato DATE a NUMBER en L cuando sea necesario. Históricos sin PA se documentan como dato previo; esta operación no autoriza su inclusión en SINCRO.

| T ID_FILA | DFM | PA | Q | J | K | Fila temporal | L previa | Formato previo | P fórmula previa |
|---|---|---|---|---|---|---|---|---|---|
| 2003 | 2611 | — | TANCAMENT 9 | 03/09/2025 | 10/09/2025 | 2442 | vacía/sin fórmula | DATE | `—` |
| 2684 | 2696 | — | TANCAMENT 2 | 05/02/2026 | 16/02/2026 | 3184 | vacía/sin fórmula | DATE | `—` |
| 2658 | 2693 | — | TANCAMENT 5 | 20/05/2026 | 18/06/2026 | 3940 | vacía/sin fórmula | DATE | `—` |
| 6839 | 2490 | — | TANCAMENT 11 | 28/10/2026 | 04/11/2026 | 5094 | vacía/sin fórmula | NUMBER | `=IF(L5094="";"";L5094*236)` |
| 6862 | 2660 | PA-2600283 | TANCAMENT 11 | 30/10/2026 | 12/11/2026 | 5119 | vacía/sin fórmula | NUMBER | `—` |
| 6861 | 2709 | PA-2600279 | TANCAMENT 11 | 06/11/2026 | 10/11/2026 | 5198 | vacía/sin fórmula | UNSET | `=IF(L5198="";"";228*L5198)` |

**No se modificarán J/K, E/PA, Q, T/ID_FILA, P, estados, hoja TANCAMENT ni R.** Los cambios visibles que deriven de las fechas existentes serán recalculados por Google; no demuestran recuperación física.
