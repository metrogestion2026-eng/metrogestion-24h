# METROGES · SINCRO 12 · Comprobación de identidad y alcance para confirmar lotes

**18/11/2026 · Código candidato en PR #132 · No instalar, no fusionar ni abrir escrituras operativas.**

## Regla de continuidad

Leídos directamente: [Biblia SYNC-001](https://docs.google.com/document/d/1fDaBwYiYh_o2uHV4qwMCOxX0Otqw4vtkWszEx-pptkE), [Bitácora común](https://docs.google.com/document/d/1jwqM3rPzD0FyvN0GvCRj4Ht3r5u0CrtZoFFM480W50s), [Diccionario de MANTENIMENT](https://docs.google.com/document/d/1CNaBqGxo4VDvNjNrzJt3yChM5ffS69MBdRDKS40nh_o).

- **T / ID_FILA es la identidad única de la línea**, no su posición, fórmula A1, PA, PR, DFM, matrícula, UUID compartida o fecha.
- Corte decidido 15/11/2026: solo **acciones genuinamente nuevas** desde 16/11, aunque se modifique una T existente. No recuperar atrasos ni reescribir históricos.
- La corrección manual acreditada en MANTENIMENT debe regresar al objeto correcto de Metroges **por campo y significado**, sin pisar campos independientes.
- V1 sellada 16/11/2026 06:30:25 intacta; **F2 no instalada**; R1515 excluida. No pedir al operador que pare TANCAMENT, repita decisiones o reselle su base.
- Un onEdit, una relectura o un cambio de huella no acreditan por sí mismos quién editó. Una eventual **adopción expresa** del valor actual es una decisión nueva, **no** prueba de autoría de la edición anterior.

## Qué infraestructura existe en el servidor de pruebas

Inspección **solo lectura** del esquema y recuentos agregados en Supabase \`metrogestion-pruebas\`, sin exponer datos de usuarios:

| Infraestructura | Verificado | Implicación |
| --- | --- | --- |
| \`public.usuarios\` | \`id\`, \`activo\`, \`permisos\`, \`credenciales_actualizadas_en\` | Permitir solo autorización **expresa** específica y cuenta activa. No usar \`user_metadata\` editable. |
| \`public.dispositivos_usuario\` | \`usuario_id\`, \`token_hash\`, \`estado\`, \`id\` | El dispositivo debe estar autorizado por **huella de token** calculada en servidor; no vale el ID indicado por el navegador. |
| \`auth.sessions\` | \`id\`, \`user_id\`, \`aal\`, \`not_after\` | Verificar la sesión real por usuario e identificador firmado; presencia no equivale a autenticación. |
| Supabase Auth | Métodos públicos \`getClaims(jwt)\`, \`getUser(jwt)\` y \`mfa.getAuthenticatorAssuranceLevel(jwt)\` | Comprobar token firmado, usuario y nivel MFA actual. |
| Permiso nuevo \`sincro12_confirmar_lote\` | **0 de 10 cuentas lo tienen** en los perfiles del 18/11 | **No existe todavía permiso operativo** para confirmar lotes. No inventar concesiones ni asignarlo. |
| \`app_private.mg9_filas_identidad\`, \`mg9_cambios_recibidos\`, \`mg9_entregas_registradas\` | 0, 0, 0 en lectura anterior | Falta censo acreditado T→objeto y eventos reales; cualquier ruta productiva queda cerrada. |

Referencias oficiales de los métodos: [getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims), [MFA / getAuthenticatorAssuranceLevel](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel) y [Auth MFA](https://supabase.com/docs/guides/auth/auth-mfa).

## Código añadido

\`shared/sincro12-autenticacion-lote-preflight.mjs\`:
- Declara un límite **de solo consulta** mediante adaptadores inyectables: no contiene red, claves, SQL mutador ni conexiones a producción.
- Recibe una petición exclusivamente de tipo \`ADOPTAR_VALORES_ACTUALES\`, un lote de hasta 100 T/campos y la fecha de un reloj de servidor confiable. Acepta solo \`TRABAJO/K\` como supuesto de **laboratorio**; J de taller no equivale automáticamente a \`fecha_realizada\`, ni J/K de PARADA/TANCAMENT a hitos de taller.
- Calcula SHA-256 canónico de todas las T/columnas/revisiones/huellas; rechaza duplicaciones y nuevos campos añadidos después de presentar el lote. La presentación caduca tras cinco minutos **en el contrato**.
- Pide comprobación del JWT firmado \`getClaims(jwt)\`, \`getUser(jwt)\`, MFA AAL2, cuenta activa, emisión posterior al cambio de credenciales, \`auth.sessions\` vigente, permiso explícito propio, token de dispositivo por SHA-256 y registro del lote ya presentado por el servidor.
- Requiere un nonce no consumido y, para cada elemento, vínculo T→objeto acreditado por **acuse positivo** y una relectura vigente de la **misma celda**, con revisión y huella exactas.
- **No emite firma, recibo ni autorización ejecutable**. Siempre devuelve \`autoriza_sincronizar=false\`, \`recibo_de_confirmacion_emitido=false\`, \`autor_de_edicion_en_google_acreditado=false\` y todas las banderas de escritura a \`false\`. Aunque los adaptadores simulados sean coherentes, la salida es solo \`CANDIDATO_SIN_AUTORIZACION\`.

\`tests/security-sincro12-autenticacion-lote-preflight.test.mjs\`: 39 pruebas con proveedores *ficticios* de Supabase Auth y de lectura, incluidas sesión no vigente, MFA insuficiente, cuenta y dispositivo bloqueados, token caducado, petición con otros campos, hash modificado, lote de dos T, duplicados, corrección de revisión manteniendo el mismo valor, nonce usado y rechazo de errores sin divulgar secretos. La ejecución del CI debe verificarse y registrarse antes de dar por cerrada esta fase.

## Brechas que NO se han resuelto ni disimulado

1. **No hay todavía un servicio de servidor instalado** para construir los adaptadores y autenticar solicitudes reales, ni autorización de Metro para introducir este flujo en la app.
2. El **permiso explícito aún no existe** en perfiles; no se concede automáticamente a administradores ni a otros roles.
3. No hay **historial duradero de revisiones por celda de Google Sheets** ni emisor de acuse T acreditado. Los métodos de lectura de la hoja en este módulo son interfaces de prueba, no servicios reales.
4. Una consulta de nonce disponible puede cambiar antes de un INSERT; la seguridad real exige **unicidad transaccional** en el receptor, no solo preflight.
5. **No hay emisor criptográfico autorizado**, receptor CAS real, mapeo integral de todas las clases/columnas ni ACK productivo. Las credenciales ficticias y los tests no los sustituyen.
6. Una confirmación del valor vigente **nunca demuestra autoría de la edición original**: no confundirla con la captura de un evento manual desde un editor controlado.

## Siguiente punto técnico

Cerrar la batería CI y registrar las pruebas. Después evaluar únicamente en laboratorio la integración entre (a) el preflight autenticado con interfaces de servidor, (b) el **lote seleccionado y presentado** y (c) el ledger transaccional PostgreSQL aislado, sin emitir ninguna firma productiva ni escribir en Google/Supabase operativo. Aparte, documentar qué falta para un **capturador real** de eventos nuevos sin depender de onEdit ni de escaneos históricos. Mantener PR #132 en DRAFT hasta aprobación explícita de Metro para cualquier instalación.

**No se modificaron MANTENIMENT, TANCAMENT, PISSARRA, Apps Script instalado, activadores ni datos operativos.**
