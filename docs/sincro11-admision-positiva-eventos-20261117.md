# METROGES · SINCRO 11 · Admisión positiva de movimientos futuros

**17 de noviembre de 2026 · Laboratorio aislado · NO instalar, NO fusionar, NO habilitar escrituras.**

## 1. Punto de partida contrastado

La Biblia, norma SYNC-001, y la Bitácora de SINCRO 9/10/11 exigen que la identidad de cada fila sea **T/ID_FILA**, que la modificación manual acreditada prevalezca **por campo y significado** y que solo se procese como nuevo el movimiento realmente ocurrido después del corte del **15/11/2026**. Una fecha de necesidad o de trabajo antigua no demuestra cuándo fue corregida. Una fila desplazada, una fórmula histórica o una nota UUID no prueban un evento manual. TANCAMENT (J/K de tramo) **no se equipara** a un hito de entrada/salida de taller.

La comprobación previa del 17/11 encontró en MANTENIMENT **6.742 T únicas**, 177 referencias `METROGESTION_T`, 140 UUID diferentes y 27 compartidos en 64 filas. Los 140 están presentes en 318 trabajos del servidor, pero ninguna coincidencia textual acredita el vínculo T↔objeto. Las tres tablas de staging `mg9_filas_identidad`, `mg9_cambios_recibidos` y `mg9_entregas_registradas` permanecían vacías. **No crear vínculos por PA/DFM/H/UUID ni reabrir históricos.**

Fuentes oficiales de Google Apps Script confirman que `onEdit(e)` no dispone siempre de la identidad del usuario, que solo admite dos eventos pendientes en la cola simple y que las escrituras mediante API o script no disparan los triggers. Por tanto, un `onEdit`, un barrido F2, una firma del capturador o un instante de ejecución **no acreditan por sí solos ni un cambio manual ni su autoría**:

- https://developers.google.com/apps-script/guides/triggers
- https://developers.google.com/apps-script/guides/triggers/events
- https://developers.google.com/apps-script/guides/triggers/installable

Supabase documenta MFA/AAL2 para sesiones de usuario, pero disponer de una cadena que afirma `aal2` **tampoco equivale a validar una sesión real**; esa validación deberá realizarse en servidor antes de emitir cualquier atestación:
https://supabase.com/docs/guides/auth/auth-mfa

## 2. Candidata implementada

Archivo: `shared/sincro11-admision-eventos-futuros.mjs`. Función pública de laboratorio `auditarAdmisionFuturaSincro11()`.

Recibe **datos ya obtenidos en pruebas** y verifica cuatro pruebas vinculadas por el mismo `evento_id`:

1. **Captura técnica:** firma de un capturador de prueba sobre libro, T, columna, huellas anterior/nueva, revisiones consecutivas y hora posterior al corte. Su existencia **no implica** actuación manual.
2. **Confirmación independiente:** firma de otro emisor de prueba sobre el SHA-256 exacto de la captura, identidad de cuenta, sesión, dispositivo, segundo factor AAL2, permiso explícito, acción declarada y nonce único. Los campos de prueba no prueban una sesión auténtica de Metroges.
3. **Vínculo canónico:** atestación separada de T+columna hacia UUID de destino, clase de fila, significado, revisión y huella esperada del destino; se rechazan referencias producidas por mera coincidencia de H, DFM, PA o nota UUID.
4. **Lectura vigente:** nueva firma del capturador sobre el valor actual de esa misma T/columna; debe coincidir con la huella de la captura y haberse observado después de la confirmación.

Los dos emisores usan **claves Ed25519 efímeras de laboratorio**, con registro de claves públicas suministrado externamente a la función. Las claves privadas no se guardan en código, archivos, documentos ni GitHub. La atestación está vinculada criptográficamente a un evento, no a una persona física. Los campos J y K se distinguen; solo está habilitado un **mapa sintético** `TRABAJO:J→fecha_realizada` y `TRABAJO:K→fecha_recogida` para practicar su semántica. **Las demás clases y columnas quedan retenidas**, en especial J/K contables de TANCAMENT: un mapa de laboratorio no es autorización normativa para esos destinos.

La salida es `RETENER_SIN_ESCRIBIR`, `CANDIDATO_DE_COTEJO_NO_AUTORIZADO` o `DESTINO_YA_COINCIDE`, con recuentos completos y máximo 100 motivos; nunca devuelve valores ni nombres de cuenta, notas, matrículas, PA, DFM, token de sesión o claves privadas. Incluso el caso favorable declara de forma expresa:

- `humano_real_acreditado:false`
- `sesion_real_verificada:false`
- `vinculos_reales_acreditados:false`
- `autoriza_sincronizar:false`
- `escritura_en_manteniment:false`, `escritura_en_tancament:false`, `escritura_en_backend:false`

La función no tiene red, no accede a Sheets ni a Supabase, no instala activadores y **no realiza ninguna escritura**. No reemplaza V1, F2, el sincronizador instalado ni las guardias previas.

## 3. Pruebas

`node --test tests/security-sincro11-admision-eventos-futuros.test.mjs`

**52/52 pruebas locales correctas**. Las pruebas crean sus propias claves de test en memoria y verifican: firmas Ed25519, registro de confianza fuera del sobre, `onEdit` sin autorización, API/importación/recálculo, cierre por falta de confirmación, AAL1, actor/dispositivo/sesión no válidos, nonce duplicado, identidad T exclusiva, R1515 por lista de exclusión de T (sin adivinar DFM), evento anterior al corte, borrado explícito y celda vacía, evento ya consumido, revisión no consecutiva, vínculo de otra T, semántica de TANCAMENT sin mapa, cambios independientes J/K, lectura actual distinta y listas parciales. El ensayo **no utiliza datos de flota** ni acredita una cuenta humana real.

Las pruebas CI de la PR deben comprobarse por separado de estas pruebas locales. El propósito de esta pieza es detectar evidencia insuficiente, **no poner una sincronización en marcha**.

## 4. Lo que falta antes de la futura sincronización

- Crear un capturador duradero y auditado que conserve revisiones por campo, incluso para cambios de API o eventos rápidos que `onEdit` omite. Si no hay prueba anterior/posterior, retener; una fotografía nueva F2 **no reconstruye retroactivamente** una edición antigua.
- Emitir la confirmación únicamente después de validar **en servidor** la sesión real, MFA, permisos y dispositivo autorizado, con un acto explícito de confirmación del operador; no confiar en la identidad opcional de `e.user` ni en un JWT sin validar.
- Registrar positivamente y de modo estable T↔objeto/clase/tramo/campo/revisión, sin adivinar coincidencias de notas UUID, PA, DFM ni H. No poblar las tablas mg9 vacías desde heurísticas.
- Comprobar inmediatamente antes de una futura mutación el valor vigente de hoja, la revisión del destino, que el evento no se haya consumido, la autorización y el alcance del campo. El receptor real deberá aplicar CAS, auditado e idempotente, con invalidación atómica de la orden obsoleta correspondiente y **sin alterar otros campos o T**.
- Validar el caso R1515 exclusivamente cuando la exclusión esté vinculada de forma autorizada a su T, nunca por inferencia. Conservar V1 sellada el 16/11/2026 a las 06:30:25; F2 permanece no instalada.

**Estado:** candidata de laboratorio, PR #132 en borrador, no instalar ni desplegar. **No se modifica MANTENIMENT, TANCAMENT, PISSARRA, Apps Script, Supabase ni datos operativos.**