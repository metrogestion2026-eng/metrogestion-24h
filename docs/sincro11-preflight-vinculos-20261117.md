# SINCRO 11 · Preflight de vínculo T → objeto, 17/11/2026

**CANDIDATA EN LABORATORIO. NO INSTALAR, NO FUSIONAR, NO SINCRONIZAR.**

## Propósito y regla vigente

Esta pieza **no** vuelve al pasado. Examina qué falta para poder acreditar la correspondencia estable entre la columna **T (`ID_FILA`)** de MANTENIMENT y el objeto correcto de Metroges cuando llegue una actuación nueva **realmente posterior al corte del 15/11/2026**.

Norma contrastada directamente con la **Biblia SYNC-001**, la **Bitácora SINCRO 9/10/11** y el **Diccionario de MANTENIMENT**: la identidad de la T es exclusivamente su valor en columna T; PA, PR, DFM, posición física, fechas I/J/K y notas UUID no suplantan esa identidad. Las correcciones manuales acreditadas prevalecen **por campo y por significado**, sin modificar campos independientes. Una J de TANCAMENT no se equipara a una entrada o actuación física de taller. Reordenar filas, recálculos de fórmulas y fechas históricas no crean movimientos.

## Censo real comprobado, todo de solo lectura

* MANTENIMENT: **6.742 ID_FILA válidas, sin duplicados** en lectura de T2:T6743; **177 apariciones `METROGESTION_T`**, **140 UUID distintos**, **27 UUID usados en más de una fila** (64 filas). Datos leídos el 17/11/2026; Metro trabaja normalmente, por lo que son **una observación**, no un bloqueo de edición.
* Cruce solo informativo de E.nota/H contra `app_private.manteniment_t_trabajos.sync_id` y `designacion`/`tipo_trabajo`: **los 140 UUID anotados aparecen en el catálogo**; para 129 la etiqueta H coincide en una sola fila, para 7 coincide en varias y para 4 no coincide en ninguna. **Ni una coincidencia H única es vínculo acreditado**: faltan la procedencia, los ID de T validados y el evento nuevo.
* Supabase `metrogestion-pruebas`: **318 trabajos** con `sync_id` distinto; **97** registros con `fuentes` vacío o sin array utilizable (esto no demuestra que carezcan de cualquier otra fuente). Tablas `app_private.mg9_filas_identidad`, `mg9_cambios_recibidos` y `mg9_entregas_registradas`: **0 registros cada una**. No existe aún allí un mapa positivo T↔objeto autorizado.
* El campo `manteniment_t_trabajos.sync_id` es el **UUID del trabajo**. La identidad del episodio/PA, el tramo contable y la vinculación de clase/columna requieren comprobación independiente. **Nunca** vincular una T a un trabajo únicamente por UUID compartido, H, PA o DFM.

## Código y pruebas

- `shared/sincro11-preflight-vinculos.mjs` exporta `preflightVinculosSincro11()`. Recibe **fotografías ya leídas** (T/H/notas E), trabajos del catálogo y las referencias de staging existentes; no lleva credenciales, conexión, consultas a Google/Supabase, mutaciones ni disparadores. Reconoce duplicados, vínculos ausentes, UUID compartido, divergencia de H, trabajos no existentes y eventos no acreditados. Entrega **motivos de retención por ID_FILA**, sin devolver notas, UUID, DFM, PA ni valores privados.
- `tests/security-sincro11-preflight-vinculos.test.mjs`: **39/39 pruebas locales**, incluyendo 6.742 filas sintéticas, 177 notas, 140 UUID y 27 compartidos, cambios históricos, tramos TANCAMENT, conflictos y ausencia de legitimación del evento. Estas pruebas son sintéticas y **no certifican la captura humana real**.
- `sql/sincro11_preflight_vinculos_solo_lectura_20261117.sql` ofrece una consulta estrictamente `SELECT` para repetir el censo técnico, sin introducir enlaces nuevos ni modificar objetos.

Incluso si el staging hipotético contiene `estado='ACREDITADA'`, el módulo devuelve `autoriza_sincronizar=false` y `identidades_aptas_para_escritura=0`. **El estado de una tabla por sí solo no acredita la firma de una persona ni la revisión actual de cada campo**. El análisis de H y las notas no es una corrección automática. Un sello nuevo de detección tampoco acredita la hora de una edición en la hoja.

## Estado y siguiente paso

**Confirmado:** censo de notas y T, tablas SQL reales de preparación vacías y funcionamiento de auditoría local sin escrituras. **No confirmado:** vínculos T↔UUID por clase, procedencia manual verificable, F2 instalada, revisión CAS real por campo y mapeo integral hasta retorno a Metroges. **No instalable** en producción; conservar PR #132 borrador, la V1 sellada del 16/11 a las 06:30:25, y MANTENIMENT/TANCAMENT/PISSARRA intactos. R1515 excluida de acciones.

**Próximo paso técnico:** construir un mecanismo **positivo de acreditación** para movimientos realmente nuevos, con registro de origen/revisión/campo y vínculo a objeto; trabajar sobre fuentes autorizadas antes de pensar en aplicación. No completar el censo de 0 vínculos por deducción, y no consultar a Metro por normas ya decididas.