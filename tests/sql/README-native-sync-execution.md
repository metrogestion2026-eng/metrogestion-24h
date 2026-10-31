# Alpha75.25 · autorización y acuse exactos de ejecución

**MG75-EJECUCION-ORDEN-001** · 29/10/2026 · candidata, sin instalación operativa.

La migración nueva es
`20261029184748_alpha75_autorizar_ejecucion_manteniment.sql`, creada mediante
Supabase CLI 2.122.0. No modifica los archivos de migración anteriores, los
flags, las colas ni los datos de negocio. Instala dos operaciones distintas:

- **Autorizar:** lectura del estado actual de una orden ya entregada. No importa,
  reencola, entrega, confirma ni registra timestamps de actividad.
- **Confirmar:** delegación al confirmador vigente y comprobación de su recibo
  exacto dentro de la misma transacción. Esta operación sí escribe el acuse.

La implementación de Apps Script y el alcance funcional están descritos en
[la guía común](../../docs/alpha75-ejecucion-sincronizacion-001.md).

## Negociación de instalación

Se conserva `version_script = alpha75-2026.10.26.1` para el transporte existente
y se añade `version_ejecucion = MG75-EJECUCION-ORDEN-001`.

La ruta Edge `sync` exige la capacidad antes de llamar al receptor. El wrapper
SQL público exige lo mismo antes de ejecutar cualquier parte del receptor:
una Edge antigua tampoco puede importar ni entregar órdenes a un cliente sin
la capacidad. La guarda devuelve el payload completo, sin filtrar fotografías
por la selección de órdenes ejecutables.

Después del receptor, el wrapper normaliza únicamente el `tipo` exterior de
`parada` a `trabajos` cuando el payload cumple el sobre puro estricto de
continuidad. Conserva el payload, su huella opaca, todos los demás campos de la
respuesta y el orden del array. Así el transporte coincide con el tipo ya
registrado en la entrega y exigido por autorización y acuse.

La migración comprueba las definiciones exactas y los permisos de cinco
funciones candidatas. Cambia únicamente el cuerpo del wrapper público y el
cuerpo del preflight, comprobando después que sus propietarios, ACL y todas
las demás propiedades de `pg_proc` se conservan. El preflight incorpora la
huella nueva del wrapper y las huellas de su guarda de capacidad y del
normalizador de entregas, además de mantener la huella del receptor. Su
protocolo y su significado no cambian:
compatibilidad de instalación no concede permiso para sincronizar.

El autorizador utiliza ese preflight de lectura. Una capacidad declarada por
el cliente no basta si el wrapper, receptor, guarda o normalizador instalados
no coinciden.
Las nuevas funciones revocan `PUBLIC`, `anon` y `authenticated`; sólo reciben
`EXECUTE` sus propietarios y `service_role`. No se añaden roles ni permisos
sobre tablas. Los cuerpos usan un `search_path` explícito.

## Contrato de autorización

Petición a `manteniment-sync-r1`:

```json
{
  "action": "authorize",
  "token": "<clave existente, nunca registrada en el recibo>",
  "payload": {
    "version_script": "alpha75-2026.10.26.1",
    "version_ejecucion": "MG75-EJECUCION-ORDEN-001",
    "escritura_segura_manual": true,
    "spreadsheet_id": "<archivo configurado>",
    "request_id": "<UUID nuevo para este intento>",
    "alcance": [
      { "tipo": "parada", "sync_id": "<UUID>", "revision": 7, "payload_sha256": "<huella entregada>" }
    ],
    "orden": {
      "tipo": "parada", "sync_id": "<UUID>", "revision": 7,
      "payload_sha256": "<huella entregada>", "payload": {}
    }
  }
}
```

El alcance contiene entre 1 y 200 referencias explícitas, sin duplicados.
Cada referencia tiene exactamente cuatro campos. Se admiten `parada` y
`trabajos`, UUID en minúsculas, revisión entera positiva hasta 2147483647 y
huella SHA-256 hexadecimal de 64 caracteres en minúsculas. `orden` añade el
payload completo a esa referencia. El tipo `trabajos` se acredita por el
sobre estricto del servidor; no basta que el cliente lo denomine así.

La selección manual del cliente es una restricción adicional. No es una
concesión de permisos ni una autorización almacenada por el servidor. No se
deriva de toda la cola ni se extiende al aparecer una revisión posterior.

Edge llama únicamente a
`public.autorizar_ejecucion_manteniment(p_token,p_solicitud)`. La función
privada es `STABLE SECURITY DEFINER` y realiza consultas bajo la misma
instantánea de lectura. No toma bloqueos de fila o consultivos. Comprueba:

1. Token activo, huella del token, hoja y compatibilidad de instalación.
2. Flags expresos: `solo_lectura_manual_protegida=false`,
   `escritura_segura_manual=true`, `pausa_importacion_identidad=false`.
   Cualquier valor desconocido deniega. No cambia los flags para obtener éxito.
3. Pertenencia exacta al alcance, outbox vigente y estado pendiente.
4. Entrega registrada del mismo tipo, identidad y revisión, todavía sin acuse.
   No reconstruye evidencia para una cola legada ni para una orden no entregada.
5. Payload completo igual como JSONB a outbox y entrega. La huella recibida debe
   coincidir con la huella guardada y con la recalculada de ambos payloads
   almacenados. La identidad de seguimiento coincide con su registro de sync.
6. Ausencia de continuidad incompatible, operación destructiva o baja manual
   protegida. Los sobres puros de trabajos conservan su ruta independiente.

### Huella opaca y representación numérica

`payload_sha256` es la referencia exacta que el servidor adjunta a la entrega.
No se calcula mediante `SHA256(JSON.stringify(payload))` en el cliente.

PostgreSQL puede conservar `300.00` en `jsonb::text`, mientras JSON/JavaScript
lo reserializa como `300`. Ambos valores JSONB son iguales; las representaciones
textuales y sus huellas difieren. Por eso se cotejan las huellas de los datos
**almacenados** y, por separado, la igualdad completa del JSONB recibido.
Cambiar el valor a `301` se rechaza. Reutilizar la huella de otra entrega también
se rechaza. Este criterio no altera el algoritmo ni la evidencia del registro
de entregas anterior.

### Respuesta

Una comprobación completada devuelve HTTP 200 y
`{ok:true, autorizacion:{...}}`, tanto si autoriza como si deniega. El objeto
interno tiene exactamente:

| Campo | Contrato |
| --- | --- |
| `protocolo` | `manteniment-ejecucion-v1` |
| `version_ejecucion`, `version_script` | Eco del cliente comprobado |
| `solo_lectura` | `true` |
| `request_id`, `spreadsheet_id` | Eco exacto del intento y archivo |
| `alcance` | Lista exacta enviada, conservando su orden |
| `orden` | Referencia exacta de cuatro campos; no devuelve el payload |
| `autorizada` | Booleano; sólo `true` permite ese intento |
| `motivo` | `AUTORIZADA` o un motivo de denegación cerrado |
| `autorizado_en`, `expira_en` | UTC `YYYY-MM-DDTHH:MM:SS.SSSZ` |

La vigencia positiva es exactamente 30.000 ms. En una denegación las dos
fechas son iguales. Edge comprueba la coherencia, el enlace de todos los
campos, la vigencia y la ausencia de contenido adicional antes de responder;
un recibo incompleto o contradictorio produce error, no permiso.

Los motivos de denegación son `EJECUTOR_NO_COMPATIBLE`, `FUERA_DE_ALCANCE`,
`INSTALACION_NO_COMPATIBLE`, `BARRERAS_CERRADAS`, `ORDEN_NO_VIGENTE`,
`ORDEN_RETENIDA_O_CONFIRMADA`, `ENTREGA_NO_ACREDITADA`, `ORDEN_YA_CONFIRMADA`,
`ORDEN_NO_COINCIDE`, `CONTINUIDAD_RETENIDA`, `OPERACION_NO_PERMITIDA` y
`BAJA_MANUAL_PROTEGIDA`. No son instrucciones para forzar una ejecución.

## Contrato de acuse estricto

La acción `ack_execution` recibe token y un `payload` con cuatro campos:
`version_ejecucion`, `spreadsheet_id`, `request_id` nuevo y `confirmacion`.
`confirmacion` es el ACK canónico guardado por el cliente después de comprobar
la aplicación; incluye `tipo`, `sync_id`, `revision`, `payload_sha256`,
`estado:'aplicado'` y los campos de resultado existentes que correspondan.
Las huellas del plan, fotografías y diario local no se añaden a ese objeto.

La RPC `public.confirmar_ejecucion_manteniment(p_token,p_solicitud)` comprueba
token, hoja y entrega exacta antes de delegar en
`app_private.manteniment_confirmar_comandos`. Usa el orden de bloqueo vigente.
Después comprueba que esa misma entrega quedó confirmada y que el ACK coincide.
Si falla la comprobación, se revierte toda la transacción. No basta un contador
de confirmaciones ni un HTTP 200.

La respuesta exacta es:

```json
{
  "ok": true,
  "confirmacion": {
    "protocolo": "manteniment-acuse-ejecucion-v1",
    "version_ejecucion": "MG75-EJECUCION-ORDEN-001",
    "request_id": "<nonce del intento de acuse>",
    "spreadsheet_id": "<archivo>",
    "confirmada": true,
    "orden": { "tipo": "parada", "sync_id": "<UUID>", "revision": 7, "payload_sha256": "<huella entregada>" }
  }
}
```

Un reintento cambia el nonce exterior, pero conserva el ACK canónico. Puede
confirmar una entrega anterior aunque la outbox ya tenga otra revisión; no
confirma esa revisión nueva. No solicita una autorización para volver a
escribir en Google. Un acuse todavía sin confirmar conserva las condiciones
de token y pausa del confirmador vigente: si vuelve a cerrarse la pausa,
queda retenido y el cliente conserva su recibo sin volver a aplicar la orden.

Si la entrega ya estaba confirmada y el ACK completo es idéntico, la ruta nueva
devuelve la evidencia persistida mediante lectura incluso con la pausa cerrada.
No invoca el confirmador ni cambia marcas, fechas o cola. Un replay
contradictorio continúa rechazado. La ruta `ack` anterior permanece intacta,
sin exigir una nueva versión de script a un acuse antiguo ya aplicado.

## Evidencia reproducible

```sh
METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' npm run test:sync-execution --prefix tests/sql
node tests/security-alpha75-sync-execution-edge.test.mjs
node tests/security-alpha75-preflight-edge.test.mjs
```

El helper exige PostgreSQL 17 en el socket Unix dedicado y crea una base
sintética única; se elimina en `finally`. Carga el runtime de continuidad,
sus migraciones y esta nueva migración. No consulta Supabase ni una hoja real.

| Caso | Comprobación nativa |
| --- | --- |
| EX01 | Instalación sin cambiar flags/colas; propiedades/ACL preservadas; preflight compatible sin permiso |
| EX02 | Autorización positiva en `BEGIN READ ONLY`; nonce/alcance/ref exactos; 30 s; decimal `300.00→300` y rechazo `300→301` |
| EX03 | Flags actuales cerrados y valores desconocidos deniegan sin efectos; una autorización anterior no evita la nueva consulta |
| EX04 | Orden fuera de alcance, payload modificado, hash de otra entrega, tipo incorrecto y revisión posterior |
| EX05 | Orden no entregada, retenida o ya confirmada |
| EX06 | Autenticación/formato/versiones/hoja y deriva real de la guarda o del normalizador instalados |
| EX07 | Cliente/Edge antiguos rechazados antes del receptor; payload completo conservado |
| EX08 | PARADA vinculada bloqueada; trabajos puros y su ACK no cambian metadatos físicos |
| EX09 | ACK exacto y replay con nonce nuevo; revisión anterior confirmada sin consumir la nueva; ACK legado conservado |
| EX10 | Hash/revisión/tipo/hoja incorrectos y replay contradictorio sin mutación |
| EX11 | Baja manual y operación destructiva no autorizadas |
| EX12 | Reinstalación/deriva aborta antes de modificar funciones o estado |
| EX13 | Pausa posterior retiene el ACK no confirmado; replay exacto confirmado se lee sin efectos y replay contradictorio se rechaza |

El mismo comando `test:sync-execution` incluye dos pruebas de contrato entre
SQL, Edge y el Apps Script distribuido:

| Caso | Transporte y ejecución del cliente |
| --- | --- |
| CT01 | Sobres puros con el contrato real de seis campos, sin DFM raíz: creación y asignación de trabajos; entrega SQL normalizada, hash/payload intactos, autorización y ACK reales, fila creada guardada en las fuentes del trabajo |
| CT02 | Dos PARADA entregadas una sola vez: selección de la primera conserva íntegra la segunda; tras reiniciar la VM, otra selección ejecuta la segunda sin nueva sync, redelivery ni reaplicación de la primera |

Resultado del 29/10: **13/13 escenarios nativos + 2/2 contratos SQL→Edge→GS**,
**51/51 casos Edge nuevos** y **73/73 casos Edge de preflight/compatibilidad**.
El helper de autorización nativa ejecuta cada solicitud en transacción
`READ ONLY` y compara configuración,
outbox, entregas, acuses, metadatos de sync, ejecuciones y trabajos antes y
después, incluso ante rechazo. EX06 altera deliberadamente una definición
dentro de una transacción reversible para comprobar la denegación por deriva
de código; luego revierte la transacción. Los centinelas protegidos se conservan.

La suite Edge ejecuta el handler distribuido y las validaciones HTTP reales,
con la llamada RPC sustituida por respuestas sintéticas. El puente
`execution-edge-bridge.mjs` sustituye ese transporte RPC por llamadas
parametrizadas a las funciones públicas del PostgreSQL local: usa el handler
Edge distribuido y devuelve sus respuestas JSON reales al cliente. Sólo admite
el socket dedicado, bases efímeras y las tres RPC concretas de este protocolo;
`authorize` abre expresamente una transacción `READ ONLY`.

Las pruebas de contrato ejecutan íntegro el Apps Script, incluidos planificación,
diario durable, bandeja, verificación de la aplicación y acuse. Los servicios
Google son sintéticos. Los payloads de trabajos se siembran con los campos y
tipos obtenidos mediante lectura de catálogo de las funciones reales
`manteniment_trabajos_por_crear` y `manteniment_trabajos_asignados`; sus MD5 de
procedencia están anotados junto a CT01. La importación de flota, la construcción
de trabajos y los permisos de identidad/dispositivo conservan los doubles
declarados del fixture. No se presenta este ensayo como prueba de esas rutas.

Estas suites no certifican JWT, PostgREST, permisos Google, persistencia real de
PropertiesService, motor de fórmulas de Sheets ni contenido de una hoja remota.
Las suites nativas anteriores conservan su propio fixture y no instalan esta
migración.

## Límites de concurrencia y operación

La autorización es una lectura reciente, **no un lease ni un compare-and-swap
entre PostgreSQL y Google**. Los flags, una revisión o la hoja pueden cambiar
después del SELECT. Los 30 segundos limitan el intento, no bloquean otras
transacciones. La comprobación del cliente antes de aplicar y su diario
conservador son parte necesaria del protocolo; no crean atomicidad entre
servicios.

Se conserva una entrega PARADA como máximo por revisión y la incertidumbre
explícita ante una respuesta perdida. Autorizar no vuelve a entregar ni elimina
evidencia. Un cliente antiguo con cola local todavía puede escribir sin pedir
permiso; la instalación futura requiere detener sus instancias y revisar sus
colas/acuses, además de instalar conjuntamente SQL, Edge y Apps Script.

El nuevo cliente conserva toda entrega antes de seleccionar las órdenes de su
alcance. Una PARADA no seleccionada puede elegirse después desde esa bandeja,
sin pedir una segunda entrega, y recibe una autorización nueva antes del intento.
Si una respuesta o su publicación durable queda incierta, el cliente conserva
la referencia y bloquea el reintento automático; no presupone que el servidor
volverá a entregar la misma revisión.

La selección manual no constituye aprobación registrada por el servidor.
La autenticación y las barreras de ejecución siguen siendo las autoridades
del servidor. La candidata no incluye provisión de permisos, apertura de flags,
reconciliación automática de históricos ni ejecución de órdenes operativas.

Referencias de implementación: [funciones de base de datos Supabase](https://supabase.com/docs/guides/database/functions)
y [permisos de roles](https://supabase.com/docs/guides/database/postgres/roles).
