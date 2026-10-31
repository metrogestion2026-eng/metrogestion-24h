# Comprobación previa de Apps Script — MG75-PREFLIGHT-001

Este control permite comprobar la comunicación de Google con el servidor mientras
la sincronización sigue pausada. No importa filas ni ejecuta o confirma órdenes.

## Versiones

- Apps Script operativo: `alpha75-2026.10.26.1`.
- Revisión del preflight: `alpha75-preflight-2026.10.27.1`.
- Protocolo de respuesta: `manteniment-preflight-v1`.
- Migración SQL: `20261027105748_alpha75_preflight_solo_lectura.sql`.

## Instalación y comprobación desde Google

1. Abre el proyecto de Apps Script vinculado al archivo MANTENIMIENTOS.
2. Conserva fuera del proyecto una copia del contenido anterior de Código.gs.
3. Sustituye el contenido completo de Código.gs por el archivo
   sincronizar_manteniment.gs de esta entrega. No lo añadas como un segundo
   script con las mismas funciones. Guarda.
4. En el selector de funciones, elige
   `metrogestionComprobarInstalacionSoloLectura` y pulsa Ejecutar.
5. Revisa el JSON que aparece en el registro de ejecución.

Este paso no requiere instalar activadores, volver a guardar la clave ni ejecutar
Sincronizar ahora. La clave existente permanece en las propiedades del proyecto.

Para una comprobación apta deben aparecer:

```json
{
  "version_script_actual": "alpha75-2026.10.26.1",
  "version_preflight_actual": "alpha75-preflight-2026.10.27.1",
  "diagnostico_apto": true,
  "sincronizacion_autorizada": false
}
```

Dentro de preflight, compatible y barreras_cerradas deben ser true. Las barreras
deben ser exactamente:

| Protección | Valor |
| --- | --- |
| solo_lectura_manual_protegida | true |
| escritura_segura_manual | false |
| pausa_importacion_identidad | true |

Un diagnóstico apto no autoriza a sincronizar. La prueba integral de
sincronización y la decisión de habilitarla son pasos posteriores separados.
Si aparece un error o diagnostico_apto=false, conserva el resultado y revisa la
causa sin cambiar las protecciones.

## Alcance técnico

La acción HTTP preflight solo admite los cuatro metadatos declarados por el
cliente y la clave de conexión existente. La función de entrada llama únicamente
a public.preflight_manteniment. Esa RPC autentica el token y lee la configuración
privada y los metadatos de las dos funciones de recepción revisadas.

Las huellas SHA-256 aprobadas se fijan en la migración. Un cambio en el receptor,
en su wrapper o en sus permisos hace que la comprobación deje de ser compatible.
No se aprueba automáticamente una huella nueva.

Se separan compatible y barreras_cerradas; el cliente calcula diagnostico_apto
usando ambos y contrastando además las versiones locales. La autorización de
sincronización permanece siempre falsa. Se rechazan campos desconocidos,
órdenes, respuestas incompletas, tipos incorrectos y motivos contradictorios.
Los errores de preflight no reflejan claves ni mensajes SQL internos.

El control no actualiza ultima_version_script ni sus fechas, no escribe colas,
no abre hojas, no cambia propiedades y no instala activadores. El diagnóstico
histórico distingue ahora la versión del último registro de la versión actual.

La versión declarada por Google no es una prueba criptográfica de todo el
contenido del editor. El archivo entregado se verifica por su huella; la
ejecución en Google comprueba su identidad declarada y la comunicación
autenticada. No sustituye la validación funcional de todos los importadores.

## Preservación del comportamiento desplegado

La función de entrada conserva la protección de la versión operativa v6:
un RPC de sync que devuelve ok=false o una respuesta sin confirmación válida
no se transforma en éxito HTTP. Esa protección faltaba en la fuente anterior
del PR y se ha recuperado al integrar el preflight.

Los motores existentes de lectura de cierres, aplicación de comandos, cambio
de periodo, copia de fórmulas y creación de activadores no se modifican.

## Pruebas reproducibles

```sh
node tests/security-alpha75-preflight-client.test.mjs
node tests/security-alpha75-preflight-edge.test.mjs
node tests/security-http-body.test.mjs
node tests/security-alpha75-25-estabilizacion-sync-facturacion.test.mjs
python3 tests/build-alpha75-preflight-sql-test.py supabase/migrations/20261027105748_alpha75_preflight_solo_lectura.sql
```

El generador SQL emite un ensayo sobre objetos pg_temp y termina con ROLLBACK.
Se puede elegir un bloque añadiendo inputs, config o catalog como último
argumento. Redirige las dependencias a datos y funciones ficticios; las
funciones simuladas de sync fallan si alguien intenta ejecutarlas. No modifica
la configuración ni las colas operativas.

Validación de esta entrega: 11 pruebas de cliente, 73 de Edge, 12 de cuerpo HTTP,
5 de regresión de estabilización y 48 casos SQL aislados. Las repeticiones
positivas finales se ejecutaron con transaction_read_only=on.

El test histórico alpha75-manteniment-escritura-segura.test.mjs conserva dos
aserciones de una versión anterior (versión .17.1 y forma de escritura de nota).
Falla también sobre la base intacta del PR #90; no se ha alterado ese test ni se
presenta como superado. La puerta CI vigente es la definida por el repositorio.

## Estado de entrega

El preflight del servidor está instalado y su fuente fue comprobada por lectura
posterior. Se mantienen las tres barreras de esta fase. La instalación en el
editor Google y la comprobación autenticada positiva desde Google están
pendientes de la ejecución manual indicada arriba.
