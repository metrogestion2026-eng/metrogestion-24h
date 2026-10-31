# Editor completo: instantes exactos y cambio de horario

## Defecto reproducido y corrección candidata

El normalizador anterior de la interfaz mostraba las fechas en Madrid con
precisión de minuto y volvía a enviar ese valor al guardar toda la ficha. Una
entrada persistida a las `11:00:37.123456` se enviaba como `11:00`. El core
interpretaba además cualquier cadena como `timestamp` sin zona y después
aplicaba Madrid: reenviar directamente el ISO original tampoco conservaba el
instante. La hora repetida del cambio de octubre añadía una ambigüedad de una
hora.

La regresión TF01 utiliza el normalizador anterior real y la cadena pública de
guardado del editor, con todos los identificadores y versiones de las T. En una
continuidad confirmada reproduce el rechazo `23514` de las fechas físicas y
comprueba que la transacción no modifica filas. La prueba no debilita esa guarda.

La migración
`20261029072758_alpha75_editor_timestamps_exactos.sql` introduce
**MG75-EDITOR-FECHAS-001** en dos funciones existentes:

- `public.guardar_ficha_hotel_edicion_core`: diez expresiones de conversión
  correspondientes a dos campos de ficha y cuatro de T, estos últimos en
  inserción y actualización. Una fecha ISO con `Z` u offset numérico utiliza
  `timestamptz`; una fecha local sin zona conserva la interpretación anterior
  de `Europe/Madrid`. Las cadenas vacías y los valores nulos siguen permitiendo
  vaciar un campo.
- `public.obtener_ficha_hotel_edicion_alpha72`: añade
  `contrato_fechas_editor: "MG75-EDITOR-FECHAS-001"` en el objeto raíz. El
  frontend corregido exige esta capacidad antes de habilitar el formulario y
  reenviar fechas originales exactas.

Ambos cambios se confirman en una misma transacción. No se crea otro endpoint,
helper privilegiado, permiso ni tabla persistente; no se actualizan filas.
El guardado conserva sus firmas, controles de autorización y versiones.

La instalación requiere las definiciones revisadas del core
(`093c9f6c9f2b9dd172ed640969c3464c`) y del lector
(`770cfe5b3429c7026e00cfa961b40d3c`), ambos propiedad de `postgres` e invoker,
con sus ACL, `search_path` y flags revisados. Después de sustituirlos se compara
exactamente el resto de `pg_proc`, incluidas identidad, propietario y permisos.
Una deriva o una instalación repetida se detiene antes de anunciar la capacidad.

## Ejecución aislada

Se necesita el PostgreSQL17 dedicado descrito en
[README-native-concurrency.md](README-native-concurrency.md) y las dependencias
fijadas de `tests/sql`.

```bash
METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' \
node --test tests/sql/alpha75-editor-timestamps.test.mjs
```

`METROGESTION_EDITOR_TIMESTAMPS_REPORT` permite escribir un informe JSON opcional.
Cada fixture crea una base nueva y la elimina en `finally`. No admite conexión
remota ni importa filas operativas. Las consultas de los centinelas y las
barreras se comparan en UTC para que un cambio de zona de la sesión no confunda
su representación JSON con un cambio del instante.

## Matriz verificada

| Caso | Evidencia |
| --- | --- |
| TF01 | Regresión real anterior: normalizador a minuto, RPC pública completa, rechazo específico y rollback de todas las filas. |
| TF02 | Actualización de los seis campos existentes con segundos y seis decimales; `Z`, `z`, `+hh`, `+hhmm` y `+hh:mm`, con sesión en Auckland. |
| TF03 | Inserción de una T mediante el core real: los cuatro campos conservan offsets negativos y microsegundos. |
| TF04 | Las diez conversiones conservan la semántica Madrid de clientes con valores locales, con sesión en Nueva York; vaciar con `""` y `null` sigue funcionando. |
| TF05 | Dos guardados completos conservan por separado las dos ocurrencias de `2026-10-25 02:30` en Madrid, separadas por 3.600 segundos. |
| TF06 | Offset inválido rechazado por PostgreSQL; se revierte también la escritura de ficha que precedía a la T. |
| TF07 | Otra conexión no ve parser ni capacidad antes del commit. Rollback elimina ambos; commit publica ambos. Se conservan exactamente las propiedades y ACL, y una repetición falla sin cambios. |
| TF08 | Doce variantes de deriva de definición, owner, ACL, grant option, `search_path`, security definer, volatilidad o paralelismo impiden una instalación parcial y nunca anuncian el contrato. |

**Resultado local: ocho escenarios aprobados en PostgreSQL 17.11.** Las doce
variantes de TF08 pertenecen a ese escenario; no se presentan como otras doce
pruebas independientes.

TF02, TF03, TF04 y TF06 llaman al core real para aislar sus ramas de conversión.
TF01 y TF05 atraviesan la cadena pública completa del editor. El resto de los
recorridos funcionales del editor y la continuidad se documenta en
[README-native-editor.md](README-native-editor.md) y en el
[README de navegador](../integration/README.md).

## Frontera de esta evidencia

Esta suite verifica el contrato de fechas, su instalación atómica y las
propiedades de las dos funciones en bases sintéticas. El fixture reproduce
literalmente las funciones capturadas, asignando a estas dos el propietario
`postgres` de la instalación revisada. Crea ese rol local como `NOLOGIN` sólo
si no existe, sin modificar un rol existente.

La identidad, el dispositivo y los servicios auxiliares mantienen las fronteras
de prueba documentadas por el fixture del editor. Estas pruebas no acreditan una
sesión Supabase Auth/JWT real, la instalación remota ni una autorización de
despliegue o sincronización. Las tres migraciones anteriores permanecen intactas.

### Referencias técnicas consultadas

- [PostgreSQL17: tipos de fecha y hora](https://www.postgresql.org/docs/17/datatype-datetime.html).
- [PostgreSQL17: CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html).
- [Supabase: funciones de base de datos](https://supabase.com/docs/guides/database/functions).
- [Cambios de PostgreSQL15.19 / 17.11 en Supabase](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).
