# SINCRO 11 · Auditoría real SOLO LECTURA de crear_pizarra_diaria · 16/11/2026

**Candidata documental en PR #132 (borrador). NO INSTALAR NI FUSIONAR.** No se ha llamado a `crear_pizarra_diaria` ni a ninguna función mutadora. El cotejo se ha hecho con consultas **SELECT** al proyecto `metrogestion-pruebas` y lectura de las definiciones `pg_get_functiondef`, sin escrituras.

## Regla y alcance
Consultadas Biblia, Bitácora y Diccionario; solo se comprueban las pizarras existentes de 15 y 16 de noviembre. En la PISSARRA manual (RESERVAS 2026) se leyeron 1–8, PENDENTS, 11 y la pestaña de prueba para interpretar campos, pero **no se ha escrito en el libro**. La 11 fue completada por Metro con su propia operativa, no es salida del proceso SQL. La casa de Metro (RESERVAS 2026, MANTENIMENT y TANCAMENT) permanece estrictamente inaccesible para escritura desde esta tarea.

## Código REAL inspeccionado (no reconstruido)
Existe `app_private.crear_pizarra_diaria(date)`: si ya existe fecha, devuelve la pizarra; si no existe, selecciona la anterior no anulada, preproyecta la situación de fichas admisibles, llama a `crear_pizarra_diaria_sin_situacion_alpha75(date)` y reproyecta destino. El subproceso selecciona fichas no canceladas ni retiradas con `activa_recomendada=true`, archiva la pizarra de origen **si estaba en_curso**, crea la fecha nueva, copia cabeceras, etapas y trabajos preservando seguimiento estable y atributos de usuario, remapea los `etapa_origen_id` **internos** y repasa situaciones. Esto describe código leído, no certifica su ejecución en un laboratorio independiente ni impide cambios humanos posteriores.

`public.pizarras` tiene índice **UNIQUE(fecha)** y `etapas_hotel` índice único `(registro_hotel_id, seguimiento_id)`. `registros_hotel` NO tiene UNIQUE general `(pizarra_id, seguimiento_id)`, de modo que se verifica explícitamente que no se repiten fichas. No se ha alterado ningún índice.

## Verificación real del par 15→16 de noviembre
Consulta reproducible en `docs/sincro11-auditoria-rollover-20261116.sql`:

| Control | Lectura |
|---|---:|
| Pizarra 15/11 | `archivada` |
| Pizarra 16/11 | `en_curso` |
| Fichas activas origen 15/11 | **23** |
| Identidades de ficha presentes 16/11 | **23/23**, faltantes **0** |
| Fichas totales 16/11 | **23** |
| Fichas visibles actualmente 16/11 | **21**, otras **2 retiradas** |
| Fichas duplicadas por seguimiento | **0** |
| Etapas de las 23 fichas, ambas fechas | **68/68**, todas con identidad estable; perdidas **0**, duplicadas **0** |
| Trabajos distribuidos en esas etapas | **60/60**, etapas con recuento distinto **0** |
| DFM 2633 reactivado | **0** (retirado en pizarra 15, no copiado a 16) |
| R1515 | presente en ambas; **consulta únicamente, no tocar** |
| Cambios observados en nombre/posición de etapa | **1** |
| Campos ficha: observaciones, causa, próximo, modalidad, tipo sustituto y trazo marrón | **0 diferencias** entre las 23 fichas |
| Estado ficha | **5 diferencias observadas** |
| Lugar ficha | **0 diferencias** |

El caso de orden es la etapa «Recuperar ruta y liberar reserva» del R1246, con posición 3 en origen y 2 en destino: R1246 figura actualmente retirado. La discrepancia **no se etiqueta como error ni se revierte**, pues el usuario puede reordenar. Los cinco cambios de estado tampoco se atribuyen automáticamente a error de copia: son hechos posteriores que requieren origen/revisión para clasificarse. Los cambios humanos entre días son válidos y el cierre de día por sí solo no autoriza escribir fechas nuevas.

**Contraste adicional de las 68 etapas (lectura posterior):** 0 diferencias de observaciones, nombre, lugar, fecha prevista y grupo documental. Hay 1 diferencia de orden, 6 de estado, 2 de inicio real, 4 de fin real y 4 de fecha real. No se les atribuye origen automático, pues Metro puede modificar etapas después del cambio de Pizarra. Hay 8 diferencias de referencia `etapa_origen_id`: la función copia y remapea identificadores internos; una diferencia de UUID físico no prueba pérdida de continuidad. No se recalculan ni escriben fechas.

Las tablas de documentos y notas pueden vincularse al seguimiento y al grupo documental, además del registro/etapa físicos. El SQL de copia conserva el grupo documental de la etapa, pero **no clona explícitamente** `documentos_gestion` ni `anotaciones_manuales_hotel`; esto **no prueba pérdida** por sí mismo. El cotejo directo de `documentos_gestion` por registro y seguimiento fue **0** en estas dos fechas. Queda pendiente un ensayo aislado que verifique acceso a los documentos reales por sus enlaces estables, sin copiar ni alterar ninguno.

## Limitación principal y próximos ensayos
Esta lectura confirma continuidad de identidades y recuentos en el cambio real 15→16; **no demuestra** que `crear_pizarra_diaria` sea a prueba de concurrencia, que el traslado conserve la visibilidad de todos los documentos, ni que la preproyección respete cada edición humana en presencia de una carrera de actualización. Se exige ensayo con registros ficticios y auditoría CAS antes de cambiar código o ejecutar otra copia. La fuente de MANTENIMENT siempre se identifica solo por **valor de columna T / ID_FILA**, distinto del `seguimiento_id` utilizado aquí exclusivamente para seguir una ficha o etapa dentro de Metroges.

No se han ejecutado triggers, `crear_pizarra_diaria`, archivados de producción, sincronización, descargas de datos privados ni mutaciones en Supabase. El código y las pruebas ya existentes en PR #132 siguen en borrador, sin mezclar ramas ni desplegar. Única escritura de esta intervención: archivos de auditoría y prueba en la rama de GitHub de laboratorio.
