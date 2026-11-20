# METROGES · SINCRO 12 · Puente positivo entre T y objeto, sin instalar

**17/11/2026 — PREPARACIÓN EN LABORATORIO. NO FUSIONAR NI DESPLEGAR LA PR #132. NO ESCRIBIR EN MANTENIMENT, TANCAMENT, PISSARRA NI SUPABASE OPERATIVO.**

## 1. Norma innegociable

- **Única identidad de línea:** el valor **ID_FILA de la columna T**, jamás la posición física, fórmula, DFM, PA, PR, color ni nota de UUID.
- **Corte decisorio:** 15/11/2026. Solo movimientos nacidos desde el 16/11/2026, incluida una corrección auténtica realizada entonces a una T anterior; no reabrir históricos ni crear eventos por lectura tardía.
- **Prevalencia manual:** una edición manual acreditada en MANTENIMENT prevalece para el **mismo campo, objeto y significado**. No reemplazar cambios independientes. **R1515 excluida**. Conservar V1 sellada el 16/11/2026 a las 06:30:25. F2 no instalada.
- Las fechas de **TRABAJO** (entrada/recogida de taller) y de **PARADA** (inicio/fin de tramo de TANCAMENT) no son intercambiables.

Fuentes: [Biblia/SYNC-001](https://docs.google.com/document/d/1fDaBwYiYh_o2uHV4qwMCOxX0Otqw4vtkWszEx-pptkE), [Bitácora](https://docs.google.com/document/d/1jwqM3rPzD0FyvN0GvCRj4Ht3r5u0CrtZoFFM480W50s), [Diccionario](https://docs.google.com/document/d/1CNaBqGxo4VDvNjNrzJt3yChM5ffS69MBdRDKS40nh_o).

## 2. Hechos comprobados con lectura de esquema y agregados

Consultado **Supabase metrogestion-pruebas**, PostgreSQL 17, mediante SELECT; ningún valor de ficha ni datos personales se han publicado.

| Elemento | Hecho comprobado | Qué **no** acredita |
| --- | --- | --- |
| `app_private.manteniment_t_trabajos` | 318 registros; **318/318** enlazados por `trabajo_hotel_id` a un trabajo `public.trabajos_etapa_hotel.id` existente | No contiene el ID_FILA T de hoja |
| Distintos `trabajo_hotel_id` | 317; un ID de Hotel se usa en 2 registros de mantenimiento | No es automáticamente duplicado ni justifica fusionar T |
| `app_private.mg9_filas_identidad` | 0 registros; clave `(spreadsheet_id,id_fila)` | Sin alta real de vínculo T→objeto |
| `app_private.mg9_cambios_recibidos` | 0 registros | Sin prueba actual de edición manual |
| `app_private.mg9_entregas_registradas` | 0 registros | Sin recibos de entrega |
| `public.auditoria_cambios` | Contiene usuario_id, origen, request_id, fecha y datos de objeto | No aporta por sí sola T/columna de hoja ni quién editó esa celda |
| `public.sesiones_presencia` | Permite seguimiento de sesión/dispositivo de Metroges | La presencia no acredita modificación de Google Sheets |
| `manteniment-identidades-r1` y `manteniment-correcciones-r1` | Endpoints activos de consulta/previsualización que validan token; `verify_jwt=false` como configuración del endpoint | No son un receptor de autoría de edición manual ni instalador de enlaces positivos |

**Lectura SQL comprobada ahora:** `sql/sincro12_preflight_puente_t_solo_lectura_20261117.sql`. Devuelve solo agregados: 0 T en staging, 0 vínculos candidatos, 0 eventos y 318 trabajos; `autoriza_sincronizar=false`. La consulta une únicamente `mg9_filas_identidad.id_fila` como identidad canónica de hoja con `manteniment_t_trabajos.sync_id` mediante el `trabajo_sync_id` ya registrado, y el trabajo enlaza por `trabajo_hotel_id` al Hotel. Nunca inventa el eslabón que falta por similitudes de datos.

## 3. Contrato LAB para T **nuevas** y limitaciones

Se incorpora `shared/sincro12-enlace-positivo-lab.mjs`, que recibe **cuatro registros ficticios previamente obtenidos**: (1) solicitud específica de alta de trabajo de Metroges con request_id, objeto y revisión; (2) acuse de la hoja que comunica el **ID_FILA T** asignado y la huella exacta de solicitud; (3) relectura posterior de la **misma T**; (4) relectura actual del **mismo objeto en servidor** y del trabajo de Hotel correspondiente.

El algoritmo verifica identidad, correlación exacta, fechas posteriores al corte, secuencia, revisiones, huellas, existencia del destino y unicidad de T y request_id en el lote. Si las cuatro piezas coinciden produce únicamente **`CANDIDATO_SIN_ACREDITACION`**. Si falta alguna, retiene. Dos T distintas que comparten trabajo de Hotel **no se fusionan**; dos solicitudes que reclaman la misma T **se bloquean**.

**Crítico:** en esta candidata los emisores `ACK_HOJA_FICTICIO` y `RELECTURA_DESTINO_FICTICIA` son etiquetas de prueba, **NO** firmas verificadas. Un sobre ficticio puede falsificarse. Por eso el resultado siempre indica `emisor_hoja_real_autenticado=false`, `humano_real_acreditado=false`, `vinculos_reales_acreditados=0` y `autoriza_sincronizar=false`. Ningún componente se conecta a Google Sheets, Auth o Supabase. No instalar este código.

El flujo real futuro necesita emisores independientes, registro durable e idempotente, permisos comprobados en servidor, lectura actual de hoja, revisión CAS de destino y prueba de que el enlace fue creado cuando se asignó T; la PR no implementa todavía ninguno de esos servicios de producción.

## 4. Caso distinto: una T antigua editada **ahora**

Una T ya existente puede recibir una **corrección manual nueva** desde el 16/11. **No** se exige crear otra T ni retroconciliar su PA: debe acreditarse un evento real nuevo de ese campo y el destino T→objeto, mediante captura y confirmación independiente con sesión validada en servidor, y relectura del valor actual. El módulo nuevo de altas **no** sirve para demostrar ese evento y lo retiene. `onEdit`, una fotografía F2, la hora de lectura o una firma técnica aislada no prueban autoría humana. La confirmación de una sesión acreditaría que el usuario confirma el valor, no necesariamente que hizo la edición material de la celda.

Para construir el receptor real faltan: (a) puente positivo T↔objeto, por clase y campo; (b) captura durable de los hechos nuevos que no pierda eventos; (c) autoría/consentimiento comprobables sin suplantación; (d) CAS real por campo, auditoría, idempotencia y anulación atómica de propuestas obsoletas. No inventar estos mecanismos ni usar los casos históricos 2552/2712/2746 para reparar el pasado.

## 5. Pruebas y continuidad

- `tests/security-sincro12-enlace-positivo-lab.test.mjs`: **32 escenarios nuevos** de datos ficticios: evento antes del corte, acuse ausente, lectura no vigente, T incorrecta, duplicado, reintento, clase inadecuada, UUID compartido, objeto sustituido, revisión incompatible y divulgación de valores.
- `tests/security-sincro12-preflight-sql.test.mjs`: **7 controles estáticos** de SQL. La consulta real a metrogestion-pruebas se ejecutó satisfactoriamente en modo SELECT.
- Comprobar GitHub CI en el commit final y anotar las cifras reales antes de dar la fase por cerrada.

**Relé para chats siguientes:** PR #132, rama `sincro11-base-futuro-20261115`; Biblia, Bitácora y Diccionario se leen antes de programar. No tocar datos operativos ni pedir al operador repetir decisiones. Próximo bloque: diseñar por separado la acreditación de **correcciones nuevas en T ya existentes**, sin pretender que la creación de una T nueva resuelve esa cuestión.
