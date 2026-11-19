# SINCRO 13 · Adopción auténtica de K en T de Hotel, sin inventar horas

**19/11/2026 · PR #133 abierta y en borrador. NO SE HA DESPLEGADO.**

## Por qué no basta con la K técnica

- K de MANTENIMENT registra el día de recogida. La etapa operativa `public.etapas_hotel.fecha_real` contiene **fecha y hora**; no se puede derivar una hora auténtica desde la celda K.
- El flujo de tres hitos de Hotel se encuentra en `app_private.usa_flujo_taller_hitos()`. Para la etapa de `entrada_taller` con ese modelo, `manteniment_fechas_desde_etapa` proyecta J técnica desde `fecha_fin_real` y K técnica desde `fecha_real`, en horario Europe/Madrid.
- El guardado general de Hotel `guardar_ficha_hotel_edicion_core` ya utiliza autorización, `hotel_edicion_piloto`, versionado y auditoría. La candidata adopta las mismas condiciones restrictivas para actualizar exclusivamente `fecha_real`, ejecutando los triggers nativos de Hotel; **no llama al editor con una ficha completa**, para no sobrescribir campos no modificados.

## Candidata implementada

- `sql/sincro13_adopcion_hotel_k_candidato_20261119.sql` define `public.sincro13_adoptar_hotel_k` y el receptor SECURITY DEFINER en `app_private`, accesible únicamente con el JWT de un administrador principal activo, sesión vigente y dispositivo autorizado.
- Entradas obligatorias: UUID de evidencia verificada, UUID de aprobación, UUID exacto de etapa de Hotel, versión CAS actual, **fecha y hora reales con zona horaria explícita**, y la declaración `CONFIRMO_RECOGIDA_HORA_REAL`.
- El día en Europe/Madrid debe coincidir con el valor de K contrastado en Google. Una fecha sin hora, un instante futuro, una recogida anterior al fin de trabajo o una corrección con el mismo día que ya consta se **rechazan**, pues no cabe inventar una nueva hora.
- Comprueba recibo de T de trabajo en REGISTRO_FILAS proveniente de orden entregada tras el corte, UUID canónico, evidencia reciente (`verificado_en` dentro de 90 segundos), aprobación exacta del administrador con la misma sesión, T y fechas, versión de etapa, etapa no anulada, ficha y pizarra activas, permiso de `hotel_edicion_piloto`, existencia del trabajo original y valor K base del catálogo.
- La etapa se bloquea primero; después se obtiene el advisory lock global `MG75-CONTINUIDAD-001:manteniment-sync` que utilizan las colas; después se bloquea el trabajo técnico. Se comprueba que no exista salida PARADA ni ACTIVOS pendiente antes de alterar el hito.
- La actualización SQL modifica **únicamente** `etapas_hotel.fecha_real` y `modificado_por`. Los triggers propios de Hotel auditan y proyectan K en el catálogo; se verifica dentro de la misma transacción que la K técnica final coincide y que J no se haya modificado. De lo contrario se revierte todo.
- Cuando todo coincide, la evidencia pasa a `APLICADA`, la aprobación pasa a `CONSUMIDA` y queda un recibo idempotente con hora real, versión anterior/nueva y usuario aprobador. El autor original de la edición en Google sigue **desconocido**.
- La función no cambia directamente `estado`, orden de T, fechas J/I, PARADA, sustituciones, notas ni recuperación. Se ejecutan los triggers NATIVOS de Hotel, cuyos posibles efectos derivados deben auditarse en pruebas completas antes de un despliegue.

## Carrera entre CAS técnico y editor Hotel

- `sql/sincro13_cas_k_candidato_20261119.sql` ya no espera manteniendo el trabajo bloqueado si el advisory lock global está ocupado: usa `pg_try_advisory_xact_lock` con la misma clave del servidor y devuelve error `S13_CAS_COLA_CONCURRENTE` sin escritura. También obtiene locks de Hotel con `FOR SHARE ... NOWAIT` para evitar el ciclo trabajo → advisory → T frente a T → advisory → trabajo.
- La barrera es una retirada segura; el propio operador podrá volver a solicitar una nueva lectura si una corrección sigue pendiente. **No hay repetición automática de movimientos inciertos.**

## Pruebas PostgreSQL 17 de laboratorio (no producción)

- `sql/sincro13_adopcion_hotel_lab_setup_20261119.sql` crea exclusivamente objetos sintéticos de Hotel (T, ficha, Pizarra activa, `hotel_edicion_piloto`, versión de etapa y un **trigger simplificado** de fecha K/cola); no reproduce los 28 triggers del sistema real.
- `tests/integration-sincro13-hotel-adopcion.pg.test.mjs` ejecuta **18 pruebas**: datos sin hora, fecha incompatible, versión obsoleta, T ajena, administrador/sesión/dispositivo inválidos, outbox existente, ficha fuera de piloto, recogida antes del fin, instante futuro, adopción positiva, proyección de K y preservación de J/estado, idempotencia, evidencia y autoría, y rechazo de cambios de hora que Google no acredita.
- `tests/integration-sincro13-outbox-lock.pg.test.mjs` ahora contiene **5 pruebas**: añade una segunda sesión que bloquea la T de Hotel mientras el CAS intenta obtener su lectura y confirma salida inmediata sin modificar K.
- GitHub Actions run **44531548540**: 10/10 receptor de T, 15/15 receptor Google, 32/32 aprobación/CAS, 5/5 concurrencia, 12/12 retención outbox, 18/18 adopción Hotel = **92/92 PASS**. La seguridad general de la misma revisión terminó SUCCESS; la integración nativa de navegador estaba ejecutándose cuando se registró este resumen (verificar final).

## Puertas que siguen cerradas

**La sincronización aún NO es operativa.** La Edge independiente de Google aún no está desplegada ni tiene cuenta de servicio habilitada, y no se ha realizado una primera actualización supervisada de una T real con los triggers y permisos reales de Hotel. La vía nueva para adoptar K sólo existe en GitHub y fue ensayada con una proyección simplificada; cualquier despliegue debe demostrar primero comportamiento con el conjunto íntegro de triggers en un entorno autorizado. No se ha modificado MANTENIMENT, TANCAMENT, Pizarra, Hotel real, Supabase conectado, V1/F2, R1515, credenciales ni permisos.

**No fusionar PR #133 ni validar Alpha75 hasta tener una sincronización de ida y vuelta completa y segura. PR #132 permanece congelada.**
## Corrección del contrato operativo y paridad de triggers · 19/11/2026

**Este epígrafe sustituye la interpretación anterior de «solo cambia fecha_real»**. Al examinar el RPC de tres hitos instalado y los estados de Hotel, se confirmó que registrar «Recogido de taller» también **marca esa misma T como `realizada`** y sincroniza la situación de la ficha. La candidata SQL se corrigió para actualizar `fecha_real`, `estado='realizada'`, `estado_catalogo_codigo='realizada'` (cuando proceda) y `modificado_por`, sin tocar J/`fecha_fin_real`, orden de T ni ejecutar Recuperar. El estado de la ficha lo deriva el sistema: `recogido_pendiente_ruta` cuando corresponda; reserva sigue ocupada hasta realizar explícitamente Recuperar. La hora continúa exigiéndose como hecho real confirmado por administrador, nunca inventada a partir del día K.

Se descubrió además que el seguimiento propio de la etapa **no es** el de su ficha: en 327 trabajos observados en Supabase de pruebas diferían. El vínculo válido es T/ID_FILA → UUID trabajo → trabajo Hotel → etapa Hotel → ficha con seguimiento del episodio. Se corrigieron las funciones de adopción y CAS y añadieron tests adversariales.

El entorno nativo de prueba ya no usa solo un trigger de fechas simplificado: carga el candidato real de tres hitos, las funciones de fecha y las definiciones actuales de los **43 triggers de etapa/ficha** del Supabase de pruebas. El ensayo de CI verificó SHA-256 de sus cuerpos y de sus definiciones de activación: 25/25 de etapa y 18/18 de ficha coinciden sin nombres ausentes. Esto no acredita equivalencia de datos, políticas RLS, configuración o hechos operativos.

Ver `docs/sincro13-paridad-hotel-43-triggers-20261119.md` para resultados, dependencias y límites. **No desplegado, no fusionado, SINCRO bloqueada y Alpha75 no validada.**
