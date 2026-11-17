# SINCRO 11 · Continuidad 16→17/11 y documentos · SOLO LECTURA

**Fecha de verificación: 17/11/2026.** Fuentes consultadas directamente: Biblia SYNC-001, Bitácora, Diccionario y definiciones actuales de `app_private.crear_pizarra_diaria` y `crear_pizarra_diaria_sin_situacion_alpha75` mediante `pg_get_functiondef`. Sin ejecución de las funciones mutadoras ni edición de Pizarras. Se parte de la auditoría del 15→16 ya registrada; no se duplica.

## Hallazgo del nuevo cambio de día

Al consultar `metrogestion-pruebas`, Pizarra 15 y 16 figuran **archivadas** y 17/11 figura **en_curso**. No atribuir ese cambio a este agente. Cohorte definida como las **21 fichas no canceladas ni retiradas del 16/11** (las otras 2 no se reactivan). Cruce estricto por `registros_hotel.seguimiento_id` y, para etapas, por `(ficha.seguimiento_id, etapa.seguimiento_id)`:

- **21/21 fichas presentes** el 17, sin perdidas ni seguimientos duplicados; destino 21 fichas, actualmente 20 visibles y 1 retirada. No reactivada 2633; R1515 presente en destino y no tocada.
- **65/65 etapas presentes**, sin perdidas ni identidades duplicadas.
- **56 trabajos** en las 65 etapas de la cohorte del 16, **57** en las 65 del 17; una etapa con recuento diferente. Esto NO demuestra duplicación automática: pudo añadirse trabajo en una edición posterior.
- Observación de **1 diferencia de estado, 1 de lugar y 1 de conjunto de campos observaciones/causa/próximo** entre las fichas; 2 etapas con diferencias de orden/nombre, 2 de estado/lugar y 1 de observaciones. No se conoce el momento ni autor de cada cambio, por tanto NO corregir ni restaurar la copia anterior.
- **8 anotaciones manuales activas** están vinculadas por seguimiento a fichas presentes en destino. El esquema permite `registro_origen_id` físico, por lo que su recuperación real debe consultarse a través del seguimiento y no asumir que se clonaron.
- **56 documentos activos vinculados por grupos documentales de etapa** son alcanzables a través del grupo de origen **y también** del de destino. Hay **1 grupo documental de etapa distinto**, pero dicho grupo antiguo no tiene documentos activos asociados (0). NO demuestra que la UI o los permisos de descarga funcionen: pendiente ensayo con navegador y autorización de lectura sin exponer archivos.

La consulta para reproducir las métricas es `docs/sincro11-auditoria-rollover-20261117.sql`, una sola `WITH ... SELECT` sin llamada a funciones mutadoras. Los totales son observaciones, no inventario inmutable de la hora exacta de copia; ediciones humanas entre fechas son válidas.

## Riesgos que no se maquillan

La función real de creación del día llama a proyección/sincronización de situaciones en la Pizarra de origen y de destino; no es una copia puramente pasiva. `public.pizarras` tiene unicidad de fecha y de estado `en_curso`, pero `registros_hotel` no tiene una restricción general UNIQUE(`pizarra_id`,`seguimiento_id`), y la implementación no contiene un bloqueo/advisory lock explícito para carreras del mismo día. **El 0 duplicados observado no acredita seguridad ante ejecución simultánea**. No se ejecutará la función real para comprobarlo en producción. Se necesita una simulación con datos ficticios y dos sesiones en base efímera antes de recomendar cambios.

`hotel_edicion_piloto.observaciones` recibe un `ON CONFLICT DO UPDATE` para la Pizarra de origen (texto «Histórico editable»), potencialmente reemplazando contenido anterior. No afirmar pérdida histórica sin comprobar uso del campo; sí conservar como prueba de regresión pendiente, y evitar que un parche futuro lo borre de manera indiscriminada.

**Estado:** análisis del día completado, sin autorización de despliegue ni sincronización. V1 sellada 16/11/2026 06:30:25 intacta; F2 no instalada. Sin escrituras a RESERVAS 2026, MANTENIMENT, TANCAMENT, Pizarras, Supabase, Apps Script o datos operativos. Solo archivos candidatos nuevos en PR #132 borrador. El día 17 está en curso; ninguna fecha de trabajo se cambia por pasar de día.
