# METROGES · SINCRO 12 · Correcciones actuales sobre una T existente

**18/11/2026 · DOCUMENTO DE LABORATORIO · PR #132 en borrador. NO fusionar, instalar, habilitar escritura ni modificar operativa.**

## Continuidad normativa

Referencias obligatorias:
- Biblia SYNC-001: https://docs.google.com/document/d/1fDaBwYiYh_o2uHV4qwMCOxX0Otqw4vtkWszEx-pptkE
- Bitácora central SINCRO 9–12: https://docs.google.com/document/d/1jwqM3rPzD0FyvN0GvCRj4Ht3r5u0CrtZoFFM480W50s
- Diccionario MANTENIMENT: https://docs.google.com/document/d/1CNaBqGxo4VDvNjNrzJt3yChM5ffS69MBdRDKS40nh_o

La única identidad de línea es el **valor de columna T / ID_FILA**, nunca posición física, A1, DFM, PR, PA, fechas, fórmulas o nota UUID compartida. La prioridad de una corrección manual ACREDITADA de MANTENIMENT se aplica por la T, el campo y su significado al objeto correcto de Metroges, conservando cambios independientes. Corte del 15/11/2026: solo movimientos realmente nuevos desde el 16/11, aunque una T sea antigua. No reabrir históricos, no tocar R1515, no resellar la V1 del 16/11 06:30:25. F2 no instalada. Metro continúa su edición ordinaria en TANCAMENT.

## Diferencia ≠ evento manual

Google documenta que onEdit puede carecer de identidad de usuario, solo encola hasta dos eventos, y no se activa por cambios hechos con scripts o API: https://developers.google.com/apps-script/guides/triggers .

Por tanto se distinguen tres vías, NO equivalentes:
1. **Edición desde un editor controlado futuro**: solo una captura transaccional acreditada puede demostrar que se generó un nuevo hecho de edición; la PR actual contiene un simulador.
2. **Búsqueda F2, onEdit aislado o fotografía de la hoja**: solo observación, NO demuestra ni cuándo ni quién modificó una celda. Siempre retener, nunca sincronizar automáticamente un histórico.
3. **Adopción expresamente aprobada por el operador en una revisión FUTURA por lote**: sería un NUEVO acto de conformidad con los valores actuales, no prueba de quién tecleó en Google Sheets. No se instalará esa opción ni se ejecutará sin autorización; el simulador permite ensayar su contrato.

La futura revisión por lote pretende no exigir al operador una confirmación por cada T. Una única aprobación quedaría vinculada criptográficamente a la lista exacta de pares T+campo, huellas y revisiones. Cualquier celda añadida o modificada después quedaría fuera, y el receptor tendría que cotejar de nuevo las celdas y la versión del destino. No hay todavía botón de aprobación, emisor autenticado, ledger duradero ni receptor real.

Las cadenas "aal2" y "SERVIDOR" dentro de una prueba NO demuestran autenticación real. El servidor tendrá que validar efectivamente sesión, factor, permiso y nonce antes de emitir evidencia. Referencia: https://supabase.com/docs/guides/auth/auth-mfa .

## Nuevo desarrollo aislado

Módulo: shared/sincro12-correccion-existente-lab.mjs .
Pruebas: tests/security-sincro12-correccion-existente-lab.test.mjs — **49 escenarios sintéticos**, pendiente de cierre definitivo de CI en el momento de redactar.

El contrato compara:
- Evento identificado por ID de evento, libro, valor T, columna, clase, significado, huellas anterior y nueva, revisiones consecutivas y tiempo después del corte.
- Aprobación única de lote con usuario/sesión/dispositivo ficticios, acción explícita, nonce, hora y hash canónico de la lista completa.
- Enlace exacto y ficticio de T+columna a objeto, clase, significado, revisión y campo destino.
- Lectura posterior de la misma celda T+columna con huella y revisión compatibles.
- Lectura posterior del campo destino con objeto y revisión correctos para un cotejo CAS futuro.

Se rechazan eventos ambiguos, T inválidas o duplicadas, onEdit/F2 aislados, instantes anteriores al corte, aprobaciones inexistentes, huella de lote alterada, AAL1 de prueba, campo ajeno, vínculo ausente, relectura caducada, propuesta ya consumida y T excluida por el operador. Una diferencia sin cambio de huella no es evento. Si el valor del destino ya coincide, no se propone modificación.

**Mapeo de ensayo muy limitado:** TRABAJO/K (recogida real de taller) hacia el campo fecha_recogida del trabajo de mantenimiento, como *candidato semántico*, jamás vínculo real acreditado. TRABAJO/J no se equipara por deducción a fecha_realizada. PARADA/J y PARADA/K no son entrada ni recogida de taller. Los demás campos quedan por definir por clase, no olvidados ni desechados.

El módulo recibe solo objetos simulados, no se conecta a Sheets, Apps Script o Supabase y no contiene funciones de escritura. Todas las salidas dicen: usuario_real_autenticado=false, autor_edicion_hoja_acreditado=false, vinculos_reales_acreditados=0, eventos_reales_acreditados=0, autoriza_sincronizar=false. Una confirmación de valor podría llegar a estar autenticada en el futuro, pero aun así **no demostraría la autoría de la edición anterior**.

## Censo real verificado el 18/11/2026 — SELECT exclusivamente

En Supabase metrogestion-pruebas:
- app_private.mg9_filas_identidad: 0 filas.
- app_private.mg9_cambios_recibidos: 0 filas.
- app_private.mg9_entregas_registradas: 0 filas.
- app_private.manteniment_t_trabajos: 318 filas.

No hay en esas tablas un puente T→objeto validado ni una evidencia real posterior al corte. No completar por coincidencia de PA, DFM, taller o UUID. No se han consultado datos de fichas ni efectuado escrituras.

## Relevo exacto

Se continuará desde PR #132, rama sincro11-base-futuro-20261115. Tras cerrar y verificar el CI, registrar SHA, run y resultados en esta documentación y Bitácora. Próximo trabajo: diseñar un origen REAL y durable de cambios nuevos, empezando por un editor controlado; para las correcciones que Metro hace directamente en TANCAMENT, plantear una revisión expresa de diferencias por lote como alternativa a la imposible autoría automática mediante onEdit, sin adoptar históricos masivamente. Después exigir vínculo T→objeto positivo, lector vigente y CAS transaccional/idempotente que no afecte a campos independientes. Ninguna instalación o activación sin aprobación específica.

**No se ha instalado ni modificado MANTENIMENT, TANCAMENT, PISSARRA, Apps Script, Supabase operativo, V1 o R1515.** Solo código candidato en GitHub y lecturas diagnósticas. No pedir a Metro que repita normas o pare su trabajo.
