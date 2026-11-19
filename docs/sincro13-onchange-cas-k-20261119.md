# METROGES — SINCRO 13 · Barrera onChange y CAS por T/K

**19 de noviembre de 2026 · PR #133 OPEN/DRAFT · no desplegado**

## 1. Concurrencia en Apps Script

El ejecutor de órdenes `r1-alpha75/google-apps-script/sincronizar_manteniment.gs` ahora exige `LockService.getDocumentLock().tryLock(15000)` **antes de crear el journal de intento y antes de aplicar la primera operación**. Revalida la fotografía de MANTENIMENT una vez adquirido el bloqueo y comprueba que la autorización del servidor no haya caducado.

Mientras se sostiene ese bloqueo, se hacen las inserciones y la asignación de nuevos ID_FILA en REGISTRO_FILAS. No se anida un segundo DocumentLock: el ejecutor utiliza `metrogestionAsignarIdFilaNuevaSinLock_` solamente en este tramo ya protegido. El control instalado `metrogestionIdentidadFilasCambio` sigue compartiendo el mismo DocumentLock y se serializa con la orden.

Si falla el bloqueo o la revalidación, no se crea journal de intento ni se modifica la hoja. Si ya se había registrado el intento y falla una mutación, la orden queda incierta y no puede reintentarse automáticamente ni producir ACK.

Pruebas nuevas: `tests/security-sincro13-onchange-document-lock.test.mjs`. Comprueban bloqueo continuo, denegación sin efectos, intento de onChange a mitad de inserción, modificación de hoja tras obtener el bloqueo y fallo parcial sin reejecución.

**Límite:** son pruebas de ejecutor en un simulador que ejecuta el archivo Apps Script real de la rama. La copia de Google Sheets utilizada en SINCRO 13 no tiene este Apps Script instalado; aún falta repetir la concurrencia en un proyecto Apps Script de ensayo autorizado.

## 2. CAS exclusivo para K de TRABAJO

Nueva candidata `sql/sincro13_cas_k_candidato_20261119.sql`, **no instalada ni en producción ni en el proyecto de pruebas conectado**. Crear esta candidata como archivo en el repositorio no equivale a ejecutar SQL.

Solo contempla `TRABAJO/K` en MANTENIMENT, mapeado a `app_private.manteniment_t_trabajos.fecha_recogida`; no interpreta la J de PARADA como entrada de taller ni inventa fechas de trámites.

La corrección requiere un registro separado en `app_private.sincro13_k_evidencias` con: T permanente, UUID exacto, valor base K, valor nuevo K, evento posterior al corte, actor verificado, huella de evidencia y verificación independiente de Google. **La tabla de evidencias NO concede INSERT a anon, authenticated ni service_role y todavía no existe ningún emisor autorizado real.** No es válido presentar un onEdit, timestamp, nota o firma ficticia como autoría.

La función candidata `app_private.sincro13_cas_k` bloquea la evidencia y el objeto exacto con `FOR UPDATE`, comprueba recibo T/UUID, orden entregada después del corte y seguimiento, revisa la outbox por seguimiento, compara el valor K anterior y actualiza únicamente fecha_recogida en la misma transacción. Si existe una outbox pendiente sin identidad por T/campo, bloquea. Una base obsoleta también queda retenida y no se transforma en un conflicto resuelto artificialmente. El resultado de cada evidencia se conserva para reintentos idempotentes.

No se utiliza para T antiguas aún no acreditadas, R1515, FIN/ROAD, BAJA, ni para corregir directamente fases de Hotel. La aplicación positiva en la base ficticia **no prueba que la función sea desplegable**: la outbox heredada necesita protección exacta T/campo y el emisor de evidencias independientes aún no está construido.

## 3. Verificación real de PostgreSQL 17 en GitHub

En el workflow `.github/workflows/sincro13-recibos-t-lab.yml`, sobre `sincro13_lab` y datos inventados, se ejecutan:

1. Los 10 tests del receptor de recibos T.
2. La estructura ficticia `sql/sincro13_cas_k_lab_setup_20261119.sql`.
3. La función candidata `sql/sincro13_cas_k_candidato_20261119.sql`.
4. Los 13 tests `tests/integration-sincro13-cas-k.pg.test.mjs`: evidencia ausente, token falso, CAS K positivo, replay sin doble mutación, solicitud distinta, base obsoleta, outbox pendiente, T↔trabajo incorrecto, fecha pre-corte, recogida anterior al fin de taller, permisos y no modificación de MG9.

**Resultado confirmado:** GitHub Actions run 44490882826 SUCCESS (10/10 recibos y 13/13 CAS; 0 fallos). La suite general de seguridad e integración de ese commit aún estaba en curso al escribir este registro; no atribuirle éxito sin comprobar su estado final.

## 4. Continuidad y siguientes puertas obligatorias

- PR #132 congelada como laboratorio, PR #133 permanece DRAFT, sin fusionar.
- El código de Apps Script instalado no cambia; la bandera `METROGESTION_S13_RECIBOS_RECEPTOR_VALIDADO=false` impide transmisiones reales.
- MANTENIMENT, TANCAMENT, Pizarra, Supabase conectado, V1, F2 y R1515 no se han modificado. Solo GitHub y PostgreSQL autónomo ficticio.
- **SINCRO sigue NO OPERATIVA:** faltan el emisor Google independiente de pruebas positivas con identidad/autoría o adopción expresa, la acreditación de T anteriores, la protección exacta de la outbox por campo, el ensayo Apps Script nativo con onChange y una prueba real supervisada de ida y vuelta.
- No validar Alpha75.26 hasta que la SINCRO funcione, por instrucción posterior y expresa del operador.
