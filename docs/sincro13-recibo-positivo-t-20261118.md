# METROGES · SINCRO 13 · recibo causal de nueva T

**18/11/2026 — candidata NO desplegada; prueba en GitHub, sin tocar MANTENIMENT, TANCAMENT ni Supabase.**

## Qué corrige

El ejecutor real de Alpha75 asigna un ID permanente en la **columna T** al insertar una fila, pero su confirmación anterior conservaba únicamente la posición física de las filas creadas. Esa posición no acredita la identidad ni permanece estable al reordenar. Una nota de UUID, DFM, PA, estado o coincidencia de taller tampoco acredita quién originó una T.

Esta candidata une la **orden efectivamente autorizada en Apps Script** con las **inserciones realmente realizadas por el ejecutor** y con el **ID_FILA T leído después de asignarse**, guardándolo en el journal local de la propia orden. No se emiten vínculos para filas equivalentes preexistentes.

## Flujo real aprovechado

1. El ejecutor existente planifica y autoriza una orden exacta y guarda el estado de intento antes de los primeros cambios.
2. Si la orden crea filas, el ejecutor inserta y escribe las columnas A:Q, sin copiar ni inventar la identidad T.
3. El mecanismo instalado de REGISTRO_FILAS asigna la T. La candidata exige T única, estado ACTIVA, alta posterior al 15/11/2026 y procedencia exacta ORDEN_AUTORIZADA.
4. Un recibo únicamente se emite cuando una fila recién insertada por **esa misma orden** contiene una única referencia de trabajo, igual a la prevista por la orden y a la relectura de Google.
5. El journal local conserva solo ID_FILA T, UUID del trabajo ordenado, fecha de asignación, marca de origen y estado PENDIENTE_COTEJO_OBJETO. No guarda posición física, PA, DFM, matrículas, fechas de facturación ni contenido de documentos.
6. Antes del ACK habitual se vuelve a buscar la T por su **valor**, no por su posición. Si cambió el estado del registro, la fecha, la nota, la clase o desapareció la T, el ACK se bloquea.

La prueba anterior del receptor no recibe todavía este recibo: su contrato se mantiene **sin cambios**. El journal es un **hecho local no transmitido**; no es aún un vínculo acreditado en Supabase y no demuestra una edición humana posterior.

## Exclusiones y barreras

- Nunca resolver identidades por PA, DFM, fechas, fórmula, UUID de nota por sí solo o posición física.
- No confundir una nueva **T de trabajo** con PARADA o TANCAMENT. La semántica de J/K se decide posteriormente, por clase y campo.
- R1515 excluida; históricos anteriores al corte fuera. No se modifica la V1 sellada, F2 ni el registro del operador.
- Se rechazan duplicados de T, trabajos repetidos, filas BORRADA, fechas anteriores al corte, registros nacidos como INSERT_ROW/OTHER, notas ambiguas y cambios posteriores.
- Si el activador de cambio de filas asignó la T antes del ejecutor, el origen del registro será INSERT_ROW y **se retiene**: no se etiqueta falsamente como ORDEN_AUTORIZADA. Resolver esta concurrencia en aislamiento antes de instalar.
- Por diseño, incluso con recibo local válido: **autoriza_sincronizar=false**. No añade activadores, permisos, endpoint, escrituras de hoja ni llamadas de red.

## Prueba y límite de aceptación

Ejecutar:

    node --test tests/security-sincro13-recibo-t-positivo.test.mjs

El test usa un clon de Google Sheets en memoria y carga el mismo archivo Apps Script de la rama. Comprueba identidad causal, reordenación de filas, duplicación, borrado, origen manual, R1515, nota ajena, fecha anterior y comprobación del recibo antes de ACK.

**NO publicar esta rama ni copiar todavía el script de GitHub al editor vinculado**: las pruebas de Node no equivalen a la ejecución con Apps Script autorizado. Este cambio añade prueba de procedencia técnica de una inserción futura, pero faltan:
- Validación funcional en un libro de ensayo con el mecanismo real de REGISTRO_FILAS, incluyendo carrera con onChange.
- Transferencia autenticada e idempotente al staging privado y acreditación positiva del trabajo en el servidor.
- CAS por T/campo, retorno de correcciones manuales acreditadas y control independiente de permisos.
- Prueba completa de ida/vuelta con datos ficticios, seguida de prueba supervisada con hechos reales, nunca falsos.

## Continuidad

La PR #132 queda congelada como laboratorio. Esta rama es independiente y parte de main. Alpha75.26 no queda validada por este trabajo; no fusionar ni activar la sincronización. Documentos rectores: Biblia SYNC-001, Bitácora central y Diccionario de MANTENIMENT.
