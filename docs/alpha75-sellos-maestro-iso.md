# Alpha75 · admisión de sellos ISO del maestro

**Corrección revisada · 07/11/2026.** La instalación de código y la aplicación
a datos son pasos separados. El estado operativo y sus comprobaciones se
registran en la bitácora del proyecto.

## Problema confirmado

Una corrección puede llegar correctamente a la fotografía de MANTENIMENT y a
`vehiculo_campo_maestro.valor_manteniment`, mientras el campo correspondiente de
`public.vehiculos` conserva su valor anterior. El receptor necesita el sello
real de la edición humana para resolver la prioridad entre MANTENIMENT y
Registro.

El importador privado instalado, `aplicar_snapshot_manteniment`, filtra los
sellos de `cambios_maestro` mediante:

~~~sql
and c.value ~ '^\\d{4}-\\d{2}-\\d{2}T'
~~~

Con `standard_conforming_strings=on`, las dos barras llegan al motor de
expresiones regulares y ese filtro no acepta una fecha ISO normal. Un SELECT
sin efectos y la reproducción local del importador confirman el rechazo.

Los triggers de arbitraje están presentes y habilitados. El árbitro conserva
deliberadamente el dato de Registro cuando no encuentra un sello admitido:
actualiza la evidencia recibida, pero no atribuye a la mera sincronización la
autoridad de una edición humana. La corrección conserva ese contrato.

## Cambio acotado

La migración
`supabase/migrations/20261107183233_alpha75_sellos_maestro_iso.sql`, creada con
Supabase CLI, sustituye exactamente una aparición del filtro por:

~~~sql
and c.value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
~~~

Se mantiene la conversión posterior a `timestamptz`, que sigue rechazando
fechas y horas inválidas. También se conservan la lista de campos admitidos,
las reglas de prioridad, la pausa de importación y la protección de salida.

| Definición | MD5 de `pg_get_functiondef` |
|---|---|
| Importador revisado anterior | `cf7c2a01aaf8db1c2a68c8ba42bd8249` |
| Importador tras el reemplazo exacto | `4a3fcfe1e98eb6315aef5e5d219c71c0` |

La instalación:

1. Comprueba la definición del bloqueo existente y toma el mismo bloqueo
   transaccional utilizado por el receptor.
2. Exige la huella exacta del importador y una única coincidencia del texto
   que se va a sustituir.
3. Comprueba la huella del resultado antes de ejecutar `CREATE OR REPLACE`.
4. Verifica después la definición completa y todas las propiedades de
   `pg_proc` salvo `prosrc`: OID, propietario, ACL, firma, valores por defecto,
   volatilidad, modo de seguridad y configuración se conservan.
5. Confirma la transacción solamente si se cumplen esas condiciones.

Una base distinta o una segunda instalación directa abortan la transacción.
La migración no ejecuta una recepción, no fabrica sellos, no promociona
baselines y no cambia fichas, colas, retenciones, acuses ni banderas. Los
wrappers públicos y el preflight conservan sus definiciones.

## Pruebas

Archivo principal:
`tests/sql/alpha75-sellos-maestro-iso-native.test.mjs`.

La opción predeterminada usa el harness nativo PostgreSQL17 existente. Solo
acepta el socket Unix del clúster desechable y crea una base de prueba nueva;
no acepta credenciales remotas ni reutiliza una base operativa.

~~~bash
METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' \
  node --test tests/sql/alpha75-sellos-maestro-iso-native.test.mjs
~~~

La alternativa explícita ejecuta el mismo SQL literal en PGlite:

~~~bash
METROGESTION_SQL_ENGINE=pglite \
  node --test tests/sql/alpha75-sellos-maestro-iso-native.test.mjs
~~~

### Frontera de la prueba

El wrapper que admite los sellos, el árbitro y su trigger usan cuerpos SQL
reales. La migración se ejecuta literalmente, sin cambiar sus huellas ni
relajar sus condiciones para el test.

`tests/sql/fixtures/alpha75-sellos-maestro-iso-runtime.sql` contiene las dos
funciones de arbitraje capturadas únicamente como esquema. La validación
general del maestro se representa por un doble explícito que propone una
actualización de bastidor; el trigger y el árbitro reales deciden si puede
guardarse. Por tanto, la prueba acredita la admisión y el arbitraje del sello,
no la importación completa de toda la flota.

Los vehículos, valores y fechas de edición de los tests son ficticios y se
declaran dentro de cada caso. No se copian filas operativas ni se asignan
fechas humanas a los tres casos reales.

### Casos cubiertos

- Reproducción del defecto sobre la huella exacta anterior: un sello ISO válido
  se descarta y el maestro conserva su valor previo.
- Instalación sin diferencias en datos, OID, propietario, ACL, contratos,
  otras funciones, triggers, colas, acuses ni banderas.
- Admisión de un sello suministrado más reciente y aplicación del dato mediante
  el árbitro existente.
- Rechazo de sellos antiguos, iguales, ausentes, vacíos, nulos o malformados.
- Rechazo atómico de fecha u hora inválida por la conversión a `timestamptz`.
- Prioridad de Registro cuando su edición es posterior o igual; admisión de una
  edición humana de hoja posterior a ambas marcas.
- Reintento sin rejuvenecer el sello ni autorizar un valor distinto.
- Conservación de la lista de campos admitidos y de la pausa de identidad.
- Rechazo de una definición alterada y de una reinstalación directa.

### Resultado obtenido en este entorno

**12/12 casos pasan con PGlite0.3.16, PostgreSQL17.5 compilado a WASM.**

El único intento autorizado de arrancar el clúster nativo PostgreSQL17.6
existente falló al crear su socket Unix con `Operation not permitted`. No se
cambiaron permisos, seguridad ni configuración y no se repitió el intento.
La ejecución nativa y la concurrencia no quedan acreditadas por el resultado
WASM.

## Comprobación manual pendiente de los sellos originales

Antes de decidir otra recepción, conviene conocer los sellos que realmente
conserva el proyecto de Apps Script. El diagnóstico independiente preparado en
`r1-alpha75/google-apps-script/diagnostico_sellos_maestro.gs` se añade como
archivo separado al proyecto existente; no sustituye `Código.gs` ni el build
`.12`.

Ejecutar `metrogestionComprobarSellosMaestroSoloLectura` permite leer
exclusivamente:

- `METROGESTION_MAESTRO:R1315:bastidor`
- `METROGESTION_MAESTRO:R1317:bastidor`
- `METROGESTION_MAESTRO:R1318:bastidor`

El diagnóstico indica presencia y formato y devuelve el sello solo si es
válido. No enumera propiedades, no lee el token y no escribe propiedades,
celdas, activadores, diarios ni datos del servidor.

Se deben contrastar esas fechas originales con
`manteniment_cambio_en` y `registro_cambio_en`. Si falta un sello o es inválido,
no debe sustituirse por la hora actual ni darse por acreditada una edición
anterior. La corrección SQL resuelve el rechazo del formato; la evidencia
temporal ausente requiere una decisión separada. No se pide reescribir datos
que ya están correctos.

La migración SQL no contiene el diagnóstico de Apps Script ni modifica sus
propiedades. Tampoco resuelve por sí misma las retenciones de identidad de las
PARADAS o de los cierres.

## Instalación verificada

La corrección se instaló el 07/11/2026 con la versión de historial
`20261107183233`. Tras la interrupción de la siguiente operación, una lectura
del 08/11/2026 confirmó la definición esperada
`4a3fcfe1e98eb6315aef5e5d219c71c0` y la protección de salida activa.

El archivo inicialmente creado por CLI con el prefijo `20261107180725` se
renombró para coincidir con esa versión real del historial. El SQL se conserva
byte por byte: SHA256
`f508c4fd6da312be0276f179f194e51dff76d9a96b52857c5bff3a135f1be29f`.

La migración de tramos cerrados sigue pendiente de instalación y no se ha
conciliado ningún caso. No usar esta comprobación como prueba de que la
sincronización total esté terminada. La divergencia previa de versiones de la
dependencia de identidad se revisa por separado; este cambio no autoriza un
envío general de todas las migraciones pendientes.

## Referencias técnicas

- [PostgreSQL17: constantes de cadena y barras invertidas](https://www.postgresql.org/docs/17/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS)
- [PostgreSQL17: expresiones regulares](https://www.postgresql.org/docs/17/functions-matching.html#FUNCTIONS-POSIX-REGEXP)
- [Supabase: funciones de base de datos](https://supabase.com/docs/guides/database/functions)
