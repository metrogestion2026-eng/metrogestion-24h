# METROGES · SINCRO 12 · Origen positivo de una T nueva

**18/11/2026 · PR #132 candidata exclusivamente de laboratorio; no fusionar ni instalar.**

## Punto de continuidad

Normas oficiales: [Biblia SYNC-001](https://docs.google.com/document/d/1fDaBwYiYh_o2uHV4qwMCOxX0Otqw4vtkWszEx-pptkE), [Bitácora central](https://docs.google.com/document/d/1jwqM3rPzD0FyvN0GvCRj4Ht3r5u0CrtZoFFM480W50s) y [Diccionario MANTENIMENT](https://docs.google.com/document/d/1CNaBqGxo4VDvNjNrzJt3yChM5ffS69MBdRDKS40nh_o).

**Identidad única:** valor T/ID_FILA de columna T. La posición física, una fórmula, DFM, PA, PR, fechas del episodio o UUID compartidos no sustituyen ese valor. Conservar V1 sellada el 16/11/2026 a las 06:30:25; no instalar F2 ni tocar R1515. Solo acciones realmente nuevas después del corte del 15/11/2026, aunque afecten a T antiguas. La corrección manual acreditada de MANTENIMENT manda sobre Metroges por objeto, campo y significado, sin sobrescribir cambios independientes.

## La brecha que se está resolviendo

Los módulos anteriores de SINCRO 12 verifican esquemas, sesión, dispositivo, lote, CAS y datos sintéticos de altas/correcciones. Sin embargo, ninguno tiene un **emisor real autorizado en Google Sheets** ni registros positivos T→objeto en las tres tablas mg9, que en la última comprobación estaban vacías. Se verificó que MANTENIMENT!T1 es ID_FILA y que REGISTRO_FILAS oculta contiene identificadores técnicos con fecha de alta/baja, no el autor de una modificación ni la relación a un objeto. Por sí solo, onEdit y un barrido F2 tampoco acreditan autoría.

**Objetivo limitado de esta candidata:** especificar una secuencia de origen que pueda verificarse sin recurrir a PA/DFM/UUID inferidos, y someterla a falsificación, duplicados y carreras de la T. La candidata no crea T nuevas en la hoja ni toca ninguna cuenta.

## Nuevo protocolo con dos emisores de PRUEBA

`shared/sincro12-origen-positivo-t-lab.mjs`: validador Node puro; `tests/security-sincro12-origen-positivo-t-lab.test.mjs`: batería sintética. Los tests generan claves Ed25519 efímeras, exclusivamente en memoria.

Cuatro sobres ligados por el mismo `request_id`, `hoja_id`, hash de solicitud y revisiones:

1. **INTENCION**: emisor ficticio del servidor Metroges firma petición concreta de una T para un objeto nuevo con UUID de trabajo, revisión y nonce únicos. La intención no asigna una T por sí misma.
2. **ACUSE**: supuesto puente de Google independiente firma el ID_FILA **que realmente tendría que haber sido asignado en columna T**, clase TRABAJO, revisión, hash de solicitud y estado `ACTIVA`. En este ensayo ese emisor y esa asignación son FICTICIOS.
3. **RELECTURA**: el mismo puente de prueba firma una lectura posterior de **la misma T**, mismo hash, revisión y estado activo. No vale una relectura con revisión posterior, aunque el valor vuelva a ser igual.
4. **DESTINO**: emisor de prueba del servidor firma que todavía existe el mismo trabajo/objeto en Metroges con su revisión original. No vale una UUID textual similar ni el último PA o DFM.

Las claves públicas de servidor y puente deben ser **distintas**; cada tipo solo acepta la firma del emisor correspondiente. Firmas manipuladas, sobres con campos adicionales y payloads anidados se rechazan. Se controla la secuencia temporal posterior al corte, request/nonce duplicados, dos solicitudes que reclamen una T, T excluidas o ya vinculadas, clase equivocada, T borrada, relecturas caducadas, destino con objeto/revisión diferente y pruebas huérfanas.

**Resultado incluso ante los cuatro sobres ficticios correctos:** `CANDIDATO_FICTICIO_SIN_AUTORIZAR`, `autorizacion_real_servidor=false`, `acuse_real_google=false`, `persona_que_edito_acreditada=false`, `vinculo_real_t_objeto_acreditado=false`, `autoriza_sincronizar=false`, y todas las escrituras deshabilitadas. Las firmas verifican solo los sobres de **emisores ficticios**; no demuestran que la hoja haya sido modificada ni conceden permiso de escritura.

## Diferenciar alta nueva de corrección de T existente

- **T nueva:** en una futura implementación real, la firma del servidor expresa intención; el puente autorizado debería confirmar la T asignada por la hoja. No fabricar ID_FILA desde el contador REGISTRO_FILAS ni reutilizar T marcadas BORRADA.
- **T existente:** no volver a asignar otra T ni suponer una edición humana porque aparece diferencia en una fotografía. El mecanismo de correcciones nuevas y la adopción expresa por lote ya documentados seguirán separados. Una aprobación expresa del valor vigente no prueba quién lo editó originalmente.
- **J/K:** este protocolo solo acredita identidad de alta de clase TRABAJO ficticia; no interpreta J de TRABAJO como fecha_realizada, ni J/K de PARADA/TANCAMENT como entrada/recogida de taller. El mapeo completo y el CAS productivo siguen pendientes.

## Para una instalación real (aún pendiente de decidir y autorizar)

Hacen falta emisores operativos independientes y autenticados, autoridad para asignar T, controles contra reintentos, almacenamiento duradero del evento y un enlace positivo T→objeto con revisión. El emisor de Google tendría que leer/verificar la asignación en la hoja **por valor de T** sin perder eventos y sin confundir inserciones automáticas con ediciones humanas. El receptor transaccional debe volver a consultar la hoja y el destino, comprobar revisiones y permisos reales, consumir el nonce de manera atómica y no invalidar otros campos ni propuestas vigentes. No desplegar servicios, Apps Script, secretos ni SQL de producción mientras no existan esas pruebas y la autorización de Metro.

**Esta fase únicamente añade código y tests al PR #132 DRAFT.** Las cifras CI deberán anotarse tras revisar las ejecuciones finales; no convertir test de laboratorio en aceptación productiva.
