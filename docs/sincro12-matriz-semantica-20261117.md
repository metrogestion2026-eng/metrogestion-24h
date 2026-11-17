# METROGES · SINCRO 12 · Contrato de campos y destinos (17/11/2026)

**Candidata exclusivamente de laboratorio. PR #132 borrador, sin fusionar, sin instalar, sin escribir datos de producción.**

## Fuentes normativas

- Biblia / SYNC-001: https://docs.google.com/document/d/1fDaBwYiYh_o2uHV4qwMCOxX0Otqw4vtkWszEx-pptkE
- Bitácora / relevo SINCRO 9–12: https://docs.google.com/document/d/1jwqM3rPzD0FyvN0GvCRj4Ht3r5u0CrtZoFFM480W50s
- Diccionario de MANTENIMENT: https://docs.google.com/document/d/1CNaBqGxo4VDvNjNrzJt3yChM5ffS69MBdRDKS40nh_o

**Identidad invariable:** el valor de la columna T = ID_FILA. No usar fila física, fórmulas A1, DFM, PA, PR, color, fecha ni UUID compartidos para reemplazar esa identidad. No reabrir históricos anteriores al corte del 15/11/2026; una edición de una T antigua solo es nueva si el EVENTO realmente ocurrió desde el 16/11 y puede acreditarse. La V1 sellada el 16/11 06:30:25 no debe resellarse. R1515 excluida, sin deducir su T a partir de DFM.

## Metadatos reales comprobados con SELECT en Supabase metrogestion-pruebas

El 17/11 se inspeccionaron exclusivamente información de columnas, restricciones y recuentos del proyecto de pruebas; no se consultaron ni copiaron valores operativos de fichas.

| Tabla real | Observación técnica | Límite |
| --- | --- | --- |
| `app_private.mg9_filas_identidad` | `(spreadsheet_id,id_fila)` es PK; incluye clase, trabajo_sync_id, revisión y huella | **0 filas**; ninguna relación T↔objeto acreditada |
| `app_private.mg9_cambios_recibidos` | Tiene T, columna, revisión y valores JSON; CHECK admite A–Q, NOTA_A/E/G y ORDEN_T | **0 filas**; R/S/U–Z no son campos admitidos por este staging |
| `app_private.mg9_entregas_registradas` | `request_id`, huella de payload y recibo | **0 filas** |
| `app_private.manteniment_t_trabajos` | **318 filas**; UUID `sync_id` único, `fecha_necesidad`, `fecha_realizada`, `fecha_recogida`, `actualizado_en` | No contiene ID_FILA T ni revisión CAS de campo propia; UUID/texto no acreditan destino |
| `public.etapas_hotel` | `id`, `version`, `fecha_inicio_real`, `fecha_fin_real` y estado de la T de Hotel | La versión de etapa no acredita el vínculo con T de MANTENIMENT |
| `app_private.manteniment_parada_sync` | `fecha_programada_parada`, `fecha_inicio_tramo`, `fecha_corte`, `tancament` y `fila_manteniment` | No se puede convertir `fila_manteniment` (referencia heredada) en ID_FILA T |
| `public.facturacion_tancament_cierres` | Contiene tramos históricos y `fila_manteniment` | No es por ello un destino editable de retorno |
| `app_private.manteniment_parada_outbox` | PK por `seguimiento_id`; usa `sync_id`, revisión y payload | Sin identidad individual `ID_FILA + columna + revisión` no se retira una propuesta obsoleta por campo con garantías |

Los recuentos son una **fotografía** de esta consulta; Metro sigue trabajando. No representan un bloqueo ni un censo actualizado automáticamente.

## Matriz semántica con decisiones conservadoras

| Clase | Columna | Significado vigente en la hoja | Destino observado / decisión |
| --- | --- | --- | --- |
| TRABAJO | I | Fecha de necesidad | `manteniment_t_trabajos.fecha_necesidad`: semejanza conceptual, **vínculo T pendiente** |
| TRABAJO | F | Taller y posible referencia documental | `taller` por sí solo **no conserva todo F**; sin asignación |
| TRABAJO | G | Designación, detalle o pedido según reglas/color | Sin desambiguación no asociar automáticamente a `designacion` |
| TRABAJO | H | Clase AV, AVRT, MCD u otra conforme al Diccionario | No reclasificar por texto libre de G |
| TRABAJO | J | Entrada real a taller | **No afirmar** equivalencia con `fecha_realizada` ni con cierre de TANCAMENT |
| TRABAJO | K | Recogida real de taller | `fecha_recogida` es candidato de examen, **no enlace acreditado** |
| PARADA | I | Fecha programada original de parada | No completar J automáticamente a partir de I |
| PARADA | J | Inicio real del tramo facturable | No equivale a entrada al taller |
| PARADA | K | Fin del tramo facturable / recuperación / corte | No equivale a recogida del taller |
| PARADA | Q | Periodo TANCAMENT | Un semirremolque R no debe informar periodo en PARADA |
| FIN | J / K | Fin contractual / baja real | Fila estructural, no se convierte en trabajo |
| ROAD / ARCHIVO / CARPETA / TRUCKPOINT / IVECO ON | cualquier | Control o referencia estructural | Mantener significado sin crear T ni trabajo |

La clase debe venir de una clasificación contrastada por Diccionario, no de una coincidencia textual. Esta matriz **no afirma mapeo operativo alguno**. Para una T nueva de taller puede existir además una etapa Hotel y un trabajo diferente; hay que acreditar la relación con el objeto específico y la revisión. No comparar únicamente fechas.

## Código añadido en esta fase

- `shared/sincro12-matriz-campos.mjs`: compara un contrato semántico con metadatos entregados, sin leer APIs, DB ni hojas. Bloquea cruces taller/TANCAMENT, clase estructural, columnas no admitidas, destino histórico, duplicidad T+campo y referencias a fila/PA/DFM. Aun en coincidencia plausible devuelve `MAPEO_PENDIENTE_VINCULO_T_Y_EVENTO_AUTENTICO`; todas las salidas son `RETENER_SIN_ESCRIBIR`.
- `tests/security-sincro12-matriz-campos.test.mjs`: 23 regresiones sintéticas; comprobar ejecución en GitHub Actions antes de declarar correctas.

**Límites:** este archivo es un guardarraíl de significado, NO receptor, NO atestador humano, NO vínculo firmado, NO migración de BD y NO autorización de escritura. El módulo anterior `sincro11-admision-eventos-futuros.mjs` sigue siendo laboratorio con claves y sesiones ficticias. F2 permanece no instalada.

## Continuación sin nuevo bucle

1. Verificar test y CI de la nueva matriz, y documentar cifras solo una vez confirmadas.
2. Identificar por qué mecanismo verificable se crea en producción cada vínculo T→objeto *al producirse un evento realmente nuevo*, sin poblar las tablas de staging vacías a partir de la foto histórica.
3. Resolver semántica de destinos de etapa frente a trabajo y de los tramos TANCAMENT, y diseñar revisión CAS real por campo, aislada e idempotente.
4. Sin activar sincronización, instalar código, alterar hoja ni fusionar la PR sin la autorización específica de Metro.

**Relevo para SINCRO 13 o posterior:** leer este documento, Biblia, Bitácora y Diccionario; la continuidad técnica está en PR #132. No exigir a Metro que repita sus decisiones ni que detenga la edición diaria de TANCAMENT.