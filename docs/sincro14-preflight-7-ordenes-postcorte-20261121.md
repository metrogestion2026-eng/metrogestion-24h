# SINCRO 14 · Preflight real de cola posterior al corte (solo lectura)

**Fecha:** 21/11/2026. **Fuentes:** Supabase `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`), `app_private.manteniment_parada_outbox`, `app_private.manteniment_activo_outbox`; Google Sheet original MANTENIMIENTOS/MANTENIMENT, columnas A, E, H, T (ID_FILA) y fecha J. Consultas **solo lectura**. No se han confirmado, descartado, retenido ni aplicado órdenes; sus estados reales siguen siendo PENDIENTE.

## Censo de 37 pendientes

| Tipo | Total pendiente | Creadas antes de 15/11/2026 23:00 UTC | Creadas después |
|---|---:|---:|---:|
| PARADA | 33 | 28 | 5 |
| ACTIVO | 4 | 2 | 2 |
| **Total** | **37** | **30** | **7** |

**Norma vinculante:** la Biblia rechaza sincronizar retroactivamente los cierres históricos y hace prevalecer las correcciones manuales de MANTENIMENT. El corte temporal ayuda a acotar el trabajo, pero **no demuestra identidad operativa** ni autoriza automáticamente ninguna orden. Las 30 antiguas deben quedar fuera del piloto de SINCRO futura.

## Siete candidatos posteriores al corte: contraste de identidad del receptor

| Tipo | Objeto / PA | Estado en la cola | Observación en Google | Decisión preflight |
|---|---|---|---|---|
| PARADA DFM 2693 | PA-2600305, rev. 10 | PENDIENTE, 0 nuevas T declaradas | Existe T6976 H=GP con E=PA-2600305. También existe T6977 H=PARADA de DFM2693 J03/11/2026 **sin PA en E**; coincidencia de DFM/fecha NO vincula identidades | **RETENER para contraste de identidad PA+DFM+UUID. No rellenar E ni crear segunda PARADA por deducción** |
| PARADA R1320 | PA-2600304, rev. 9 | PENDIENTE, 0 nuevas T | T6972 H=RUEDAS ya existe con E=PA-2600304. R semirremolque excluido de días/periodo TANCAMENT DFM | Comprobar vínculo canónico, no forzar L/Q ni duplicar RUEDAS |
| PARADA DFM 2725 | PA-2600302, rev. 19 | PENDIENTE, 0 nuevas T | Seis filas ya relacionadas por E, entre ellas EXTINTOR, GP, CV, MCD, 44TN, ITV | Conciliar por UUID de seguimiento y revisiones, no duplicar órdenes/trabajos |
| PARADA DFM 2562 | PA-2600301, rev. 21 | PENDIENTE, 0 nuevas T | Existen T1523 ITV y T6974 FG y T1522 MCD con la PA | No crear duplicados ni repintar hechos manuales |
| Solo trabajos DFM2625 | PA-2600247, rev. 45 | PENDIENTE, 2 `trabajos_crear` | Existen T2281/44TN y T2282/ITV con E=PA-2600247, realizadas el 21/10/2026; las 2 nuevas propuestas en Supabase están explícitamente `retener_propuesta=true` | **BLOQUEADA**. No emitir recibos ORDEN_AUTORIZADA ni confirmar ACK. El contrato del Apps Script y SQL receptor rechaza propuestas retenidas |
| ACTIVO DFM2539 | ALTA, rev. 1 | PENDIENTE | **0 coincidencias de DFM2539** en columna A del libro | **Candidato a primer ensayo NO DESTRUCTIVO de identidad**: antes de crear ALTA exigir vínculo servidor/DFM y preflight OAuth, sin usar igualdad de DFM como prueba exclusiva |
| ACTIVO R1597 | ALTA, rev. 1 | PENDIENTE | Ya existe ALTA T6985 para R1597/R3608BDX, junto a sus otras necesidades y FIN T7001 | **NO duplicar ALTA**. Conciliar identidad y condición manual antes de ACK |

El hecho de que una PA exista en E prueba únicamente presencia de ese literal; la identidad completa exige `PA+DFM+UUID seguimiento`, revisión, clase, T literal/REGISTRO_FILAS y correspondencia con Hotel. No extrapolar filas por posición. No crear recibos S13 de T con origen `INSERT_ROW`: sirven para identidades ya existentes pero no son una orden nueva `ORDEN_AUTORIZADA`.

## Estado técnico del servicio comprobado

- `manteniment-sync-r1` v13 ACTIVE únicamente en **metrogestion-pruebas**; preserva seis rutas lease del v12 y añade `ack_t_nuevas`.
- SQL `app_private.sincro13_recibos_t`, evidencias K, aprobaciones y adopciones están instalados; **0** recibos, 0 evidencias, 0 adopciones.
- `manteniment_sync_config`: `solo_lectura_manual_protegida=true`, `escritura_segura_manual=false`, `token_activo=true`; versión declarada `alpha75-2026.10.26.1`.
- Lector Google independiente `sincro13-google-lector-lab` desplegado pero sin `S13_GOOGLE_SERVICE_ACCOUNT_JSON`; receptor SQL `habilitado=false`, sin secreto; no habilitar ni suponer confirmación.
- Candidata Apps Script REV5 completa preparada, 50 pruebas locales superadas, pero **no instalada en el proyecto real**. No cambiar sin cotejar contra REV4 que ya usa Metro.

## Próximas barreras para ensayo seguro

1. **Conectar Google OAuth readonly de forma independiente**, autorizando a una cuenta de servicio dedicada como lector de MANTENIMIENTOS; credenciales almacenadas **solo** en Supabase Edge Secrets, nunca aquí ni en GitHub. El lector usa `https://www.googleapis.com/auth/spreadsheets.readonly`.
2. Desde el Apps Script real rev4, efectuar `metrogestionComprobarInstalacionSoloLectura` y cotejar lectura/preflight HTTP con el servidor v13, sin activar el sincronizador.
3. Verificar que REV5 conserva todas las barreras REV4 y su emisor S13 usa `s13_request_id` persistente; publicar la revisión únicamente tras una prueba de Google→receptor→K en entorno no destructivo.
4. Seleccionar una **única** orden inequívoca posterior al corte; las que ya tienen datos manuales o `retener_propuesta=true` no son prueba válida de alta nueva. Validar además parada/sustituto/fecha y bloqueo de ambas outboxes, sin abrir las 37 órdenes.
5. Solo tras doble cotejo independiente y aprobación de administrador, adopción de K en Hotel con CAS y **hora real**, jamás inferida de la fecha K de Sheets.

**Estado:** SINCRO completa NO OPERATIVA. Alpha75 NO VALIDADA. No se han producido escrituras de sincronización, ni mutaciones de MANTENIMENT, Hotel, TANCAMENT, outboxes o configuraciones en este preflight.
