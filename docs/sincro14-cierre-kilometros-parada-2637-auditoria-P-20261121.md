# METROGES · SINCRO 14 · Auditoría de kilómetros P y períodos Q de PARADA
**21/11/2026 · corrección real verificada en MANTENIMIENTOS, sin habilitar SINCRO**

## Interpretación correcta
En `MANTENIMENT`, para una fila `H=PARADA` de DFM:
- `Q` muestra la etiqueta del período de `TANCAMENT` (p. ej. `TANCAMENT 11`); **no es una celda que deba calcular días o kilómetros**.
- `L` contiene los días del tramo, `K-J+1`, condicionada a que K tenga fecha. `P` calcula los kilómetros a partir de L y una media km/día **acreditada**.
- Un corte en K para cerrar TANCAMENT puede convivir con una PARADA operativamente **pendiente de recuperar**. No declarar vehículo recuperado por haber cerrado un período contable.
- Un R/semirremolque no tiene obligación de L ni kilómetros de PARADA; conservar históricos.

## 2637 · PA-2600223, sustituto R1515/33CD
La identidad estable es `ID_FILA T`, no la posición de las líneas, que cambió entre las auditorías.

| T | Q | Fecha J | Fecha K | Días L | Kilómetros P | Fórmula P | Resultado |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| 2453 | TANCAMENT 10 | 14/10/2026 | 23/10/2026 | 9 | 5.247 | `=L4938*583` | **Mantener intacto**, cierre manual validado por Metro |
| 2454 | TANCAMENT 11 | 24/10/2026 | 23/11/2026 | 31 | **18.073** | `=IF(L5035="";"";L5035*583)` | Fórmula P instalada y relectura comprobada |
| 7004 | TANCAMENT 12 | 24/11/2026 | vacía | vacía | vacía | `=IF(L5036="";"";L5036*583)` | Fórmula P preparada, sin inventar fecha ni cierre |

Las fórmulas L de T2454/T7004 ya eran inclusivas. El coeficiente 583 procede del mismo episodio `PA-2600223`, mismo sustituto `R1515/33CD` y P/L del T2453 validado (5.247/9 = 583), además de otras PARADA próximas de 2637 que usan 583. No derivar 583 para otro vehículo, otra PA o un período con una media distinta acreditada. Formato de `P` actualizado a número con separador de miles en los dos tramos, igual que el tramo anterior. Las fórmulas L, las fechas, PA, Q y las identidades T se conservaron.

T7004 consta en REGISTRO_FILAS como `ACTIVA / INSERT_ROW` (21/11/2026): **no** es una T de trabajo creada por orden autorizada, ni debe vincularse automáticamente a Hotel por el número o PA.

## Revisión general de PARADA (actual, tras dos nuevas filas)
Se comprobaron **756 PARADA = 470 DFM + 286 R**. Entre las 470 de DFM, 466 muestran Q=TANCAMENT; 453 de ellas tienen K informada y 13 K vacía. Las fórmulas P existentes no presentan referencias L a filas ajenas ni diferencias aritméticas respecto a L × coeficiente. No se han normalizado cierres ni fechas históricas.

### Otros diez tramos de DFM con K y P sin cálculo
Identidades `T1400, T2003, T2700, T2684, T2658, T1890, T3633, T592, T3163, T6862`.

- `T1400, T2003, T2700, T2684, T2658`: sin PA acreditada en la hoja y con valores de 2024–2026, no completar con medias de otros episodios ni rehacer históricos.
- `T1890/2605/PA-2600135`, `T3633/2810/PA-2600139`, `T592/2501/PA-2600159`, `T3163/2723/PA-2600160`: hay fechas y días, pero ninguna media km/día del mismo episodio PA+DFM validada que permita completar P sin inventar cifras.
- `T6862/2660/PA-2600283`: K informada, pero L vacía y P vacía; conservar hasta cotejar el significado y el hecho de cierre/recuperación. No fijar días ni kilómetros por sistema.

### Otros dos tramos abiertos con P sin cálculo
- `T6838/2548/PA-2600268`: J=02/11/2026, K vacía, L originalmente vacía y SIN fórmula. Se instaló `=IF(K5128="";"";K5128-J5128+1)`. Resultado visible L vacío; P conserva vacío por media no acreditada.
- `T6977/2693`: J=03/11/2026, K vacía, E/PA vacía. Se instaló `=IF(K5133="";"";K5133-J5133+1)` sin rellenar PA ni K. Además se corrigió el formato nativo de L, que estaba erróneamente en DATE, a NUMBER "0". P sigue vacía por falta de media y vínculo PA. No introducir esta línea en el canal operativo de SINCRO sin vínculo canónico acreditado.

**Seis tramos de DFM con K llena y L vacía:** `T2003, T2684, T2658, T6839, T6862, T6861`. No llenar L por inferencia cuando el operador considera que representa recuperación pendiente/ausente; algunos K son cortes de período y no recuperaciones físicas.

## Qué cambió realmente
- En `MANTENIMENT`: **P de T2454 y T7004**, fórmulas `L*583` condicionadas a L; formato numérico de P para ambos, y **L de T6838 y T6977** inclusivas condicionadas a K; formato numérico de L6977.
- Nada más. No modificar T2453/2637 validado, ni TANCAMENT externo, R, Hotel, Supabase, fechas J/K, Q, PA, valor manual de otros, ni las identidades T.
- Comprobación posterior por Google API: T2454 `31 × 583 = 18.073`; T7004 L/P vacías con fórmulas listas; T2453 `9/5.247` intacta; T6838 y T6977 L vacías con fórmula inclusiva; registro T7004 ACTIVA/INSERT_ROW. El estado operativo 2637 continúa pendiente de recuperar.

**SINCRO Google→Hotel→K NO OPERATIVA; Alpha75 NO VALIDADA.** La intervención es un arreglo de fórmulas de la hoja, no una confirmación de sincronización.
