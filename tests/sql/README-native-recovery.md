# Recuperación explícita en PostgreSQL nativo

Este ensayo valida el flujo explícito de recuperación con la candidata congelada
de **MG75-24H-PARADAS-SEPARADAS-002**. Usa una base sintética nueva en el mismo
PostgreSQL 17 local dedicado a las pruebas de concurrencia. No importa datos
operativos, despliega la migración, modifica cierres contables ni habilita
sincronización.

## Ruta que se prueba

Hotel Alpha75 importa el control de `r1-alpha67/src/stage-quick.js`. Para una T
con `accion_sistema='recuperar_y_liberar'`, su segunda confirmación llama a:

```js
supabase.rpc('marcar_t_realizada_rapida', {
  p_etapa_id: stage.id,
  p_version: Number(stage.version),
  p_request_id: `quick_${uuidSinGuiones}`,
});
```

El cliente no envía la fecha de recuperación. La RPC registra `clock_timestamp()`
en la T, comprueba la versión, exige actor, dispositivo autorizado y administrador
principal, y devuelve `ok`, `etapa`, `efecto` y `registro_estado`.

La suite ejecuta **`public.marcar_t_realizada_rapida(uuid,integer,text)`** y su
implementación privada vigentes, obtenidas mediante lectura del catálogo el
28/10/2026. No sustituye esa RPC por una actualización directa de la T.

## Preparación y ejecución

Dependencias: las ya fijadas en `tests/sql/package-lock.json`, Node 24 y
`pg@8.16.3`. El servidor debe cumplir los requisitos de
[README-native-concurrency.md](./README-native-concurrency.md): PostgreSQL 17,
usuario `metrogestion_test`, socket Unix dentro de
`/tmp/metrogestion-pg17-native`, TCP deshabilitado y base inicial `postgres`.

```bash
npm ci --prefix tests/sql

METROGESTION_LOCAL_PG_DSN='postgresql://metrogestion_test@localhost/postgres?host=/tmp/metrogestion-pg17-native/socket&port=55473' \
METROGESTION_RECOVERY_REPORT='/tmp/metrogestion-native-recovery-report.json' \
node tests/sql/alpha75-recovery-explicit.test.mjs
```

El informe JSON es opcional. Incluye entorno, huellas de funciones, conexiones,
resultados de RPC, inventarios antes y después, errores de negocio, límites de
hora del servidor y eliminación de la base temporal. `passed` exige los cinco
casos aprobados, los centinelas históricos intactos y la base eliminada.

El helper compartido conserva sus controles de destino local y comprueba la
SHA256 de la migración antes de instalarla:

```text
60cfff3ae8fd99818d88748080073a100ab52582eb4bc8dbcf5c02b8ce548092
```

## Mejora de la frontera del fixture

El fixture base tenía un doble de `liberar_sustituto_registro` que vaciaba los
campos de sustituto de la PA. Esa simplificación no sirve para acreditar el
comportamiento histórico de una recuperación. El fixture específico
`fixtures/recovery-runtime.sql` carga la definición vigente: **conserva esos
campos** y actualiza el estado de `reservas_hotel` a `libre` o
`disponible_con_pendientes`, según sus pendientes.

Se cargan siete definiciones reales y se contrastan sus MD5 mediante
`pg_get_functiondef`, su modo `SECURITY DEFINER` y su `search_path`:

| Función | Motivo |
| --- | --- |
| `public.marcar_t_realizada_rapida` | Misma entrada que usa el botón |
| `app_private.marcar_t_realizada_rapida` | Validación, bloqueo de fila, fecha real y respuesta |
| `app_private.liberar_sustituto_registro` | Liberación de disponibilidad sin borrar el sustituto histórico |
| `app_private.capturar_estado_registro_antes_realizar_t` | Conserva el estado previo para trazabilidad de la T |
| `app_private.normalizar_control_marcado_rapido_etapa` | Coherencia del aviso de datos pendientes |
| `app_private.sincronizar_catalogo_estado_etapa` | Estado visible `realizada` de la T |
| `app_private.modalidad_codigo_rec001` | Modalidad vigente, incluido su contexto transaccional real |

Las tres definiciones de RPC/liberación incorporan los permisos de ejecución
capturados. El propietario local es el usuario de pruebas, no el propietario
operativo. Las capturas anteriores de triggers no incluían sus ACL o propietario;
sus permisos locales son restrictivos y se declaran como política del fixture.
No se presenta ese dato ausente como un permiso operativo verificado.

Se conservan los triggers reales de recuperación, retirada, sincronización de
disponibilidad, guardas REC-001, versión y coherencia diferida del fixture base,
con la candidata congelada. Cada recuperación positiva ejecuta `COMMIT` y se
vuelve a leer desde una conexión distinta; una respuesta seguida de un error en
las restricciones diferidas no puede contar como éxito.

## Escenarios y resultado observado

Ejecución local del 28/10/2026: **cinco casos aprobados en PostgreSQL 17.11**.

| Caso | Operación | Resultado exigido |
| --- | --- | --- |
| REC1 | Recuperar taller con una PA distinta de la 24H abierta del mismo DFM | Taller recuperado y retirado; reserva libre; activación, PA24H, T24H y demás T idénticas; identidades independientes conservadas |
| REC2 | Recuperación explícita aplicable dentro de una PA24H con decisión manual de modalidad | PA recuperada; asistencia abierta sin fechas de cierre inventadas; reserva disponible con `MCD + ITV` intactos; demás T intactas |
| REC3 | Versión obsoleta y repetición tras una confirmación válida | Rechazos `P0001`; ninguna nueva fecha, versión, PA, T o liberación por los reintentos rechazados |
| REC4 | Actor ausente, dispositivo no autorizado o usuario sin condición de administrador principal | Rechazos `P0001` en la rama real de la RPC; reserva ocupada y filas idénticas |
| REC5 | T manual pendiente conservada tras elegir una modalidad que no requiere recuperación | Rechazo `23514` de REC-001; T y reserva conservadas, sin anulación ni realización implícita |

La RPC registra el mismo instante en `fecha_real`, `fecha_fin_real` y
`marcado_rapido_en`. La suite contrasta ese instante con límites consultados al
servidor antes y después de la operación. También comprueba el estado visible,
la captura del estado anterior y que la respuesta coincide con la T persistida.

En los casos positivos, el trámite manual pendiente **sigue pendiente**, aunque
la recuperación explícita retire la PA. Es el comportamiento observado del flujo
vigente. Estas pruebas no reinterpretan esa recuperación como realización de
otras T.

REC2 no acredita que toda asistencia nueva requiera recuperación. El alta24H con
sustituto utiliza por defecto `reserva_en_reparacion`, modalidad que no requiere
esa T según REC-001. El escenario cambia expresamente la modalidad **solo en
datos sintéticos** para representar una decisión manual/legacy aplicable y probar
la independencia entre recuperar y terminar la asistencia. No cambia esa regla
de producto ni afirma haber recorrido el editor de modalidad.

Los cinco casos verifican los centinelas sintéticos de 2556/2637, sus identidades,
otras T, datos manuales y barrera de sincronización. No se cargan fichas reales.

## Reutilización desde el recorrido de navegador

`recovery-scenarios.mjs` proporciona una semilla compartida, sin modificar el
harness base ni ejecutar código al importarlo:

```js
import { createLocalFixture } from './local-postgres-harness.mjs';
import { loadRecoveryRuntime, seedRecoveryScenario } from './recovery-scenarios.mjs';

const fixture = await createLocalFixture({ prefix: 'ui_recovery' });
try {
  await loadRecoveryRuntime(fixture.admin);
  const scenario = await seedRecoveryScenario(fixture.admin, { tag: 'UIREC' });
  // scenario.recovery.id/version son los datos que consume el botón real.
  // scenario.activation y scenario.targetId identifican las dos PA distintas.
} finally {
  await fixture.destroy();
}
```

El helper devuelve también `dfm`, `reserve`, `registration`, `request`, `other`
y un inventario `before`. La T de recuperación y el trámite se insertan como
decisiones explícitas de la semilla; no se exige ni se simula una recuperación
automática. En el escenario normal, la sustitución pertenece únicamente al
taller y nunca se copia de la 24H.

## Límites de esta evidencia

- Autenticación, dispositivo y condición de administrador usan dobles controlables.
  Se ejecutan las ramas reales de rechazo de la RPC; no se certifican JWT,
  PostgREST, una sesión con RLS ni la asignación operativa de roles.
- Auditoría, documentos, partes del editor y transporte/colas de MANTENIMENT
  conservan sus dobles declarados. El resultado de auditoría cero procede del
  fixture. No se certifica aquí el cierre de un tramo, recálculo de facturación,
  escritura externa o sincronización.
- Las PA y sus T iniciales son sintéticas. La recuperación pasa por la RPC real;
  el alta de las T y la elección manual de modalidad son preparación de datos,
  no una prueba del editor completo.
- La suite SQL no conduce un navegador ni prueba Histórico/Hotel/Panel. El
  recorrido de integración de navegador reutiliza las definiciones y semillas.
- No es una prueba de concurrencia de recuperaciones. Los escenarios de
  concurrencia de idempotencia y asignación tienen su runner separado.

## Lectura del pendiente de tramos entre PA

La revisión se limita al SQL y documentación disponibles. La candidata crea
seguimientos/PA distintos y rechaza una segunda asignación activa ambigua. La
vista `facturacion_dfm_periodos` y el constructor de payload de MANTENIMENT
parten del seguimiento de una PA y calculan su intersección con el periodo
contable. Las fechas `tramo_inicio`/`tramo_fin` de esas vistas no establecen por
sí solas una continuidad entre dos PA diferentes.

Sigue faltando una decisión explícita y una representación del enlace cuando
**el mismo sustituto continúa entre PA distintas**, con sus límites temporales
y su imputación. Esta revisión no elige a qué PA corresponde un posible día
compartido, no traslada asignaciones y no crea recuperaciones ficticias.

La regla ya documentada de que el día del cambio corresponde al sustituto nuevo
se refiere al **cambio de sustituto dentro de la misma PA**. No se extrapola a
continuar con el mismo sustituto en dos PA distintas. Tampoco se deduce un corte
físico a partir de TANCAMENT. La solución de esa continuidad queda fuera de estas
pruebas de recuperación explícita.
