# Alpha75.25 · editor completo y fechas exactas

29/10/2026 · **MG75-EDITOR-FECHAS-001** · candidata de la PR #90.

Esta ampliación responde al «ADELANTE» de Metro después de validar la
continuidad entre PA. Comprueba el guardado completo del editor y corrige un
defecto reproducido en ese recorrido. La regla de imputación aprobada en la
Biblia se mantiene: el día de entrada real pertenece íntegramente al destino.

## Defecto y efecto observado

Al abrir una ficha, el editor representaba las fechas en hora de Madrid con
precisión de minuto. Al guardar una nota, reenviaba también esas fechas
recortadas. Una entrada real a las `11:00:37.123456` se enviaba como `11:00`.

La RPC completa reprodujo el rechazo `23514` de la guarda de continuidad y
revirtió la operación entera. El navegador reprodujo también el rechazo al
añadir una nota en el origen con fechas precisas. El inventario de PA, T,
trabajos, anotaciones, vínculo y reserva quedó intacto: la protección del
servidor impedía cambiar el hecho, pero una edición válida no podía guardarse.

El parser anterior utilizaba `::timestamp AT TIME ZONE 'Europe/Madrid'`.
Reenviar directamente una cadena UTC tampoco servía, porque ese cast descarta
su zona. Además, las dos `02:30` del 25/10/2026 son instantes diferentes; la
representación local sin zona no permite distinguirlos. La reproducción
anterior desplazaba la primera de ellas casi una hora.

## Corrección

El editor captura la cadena exacta recibida y el valor local que muestra al
abrir. Al serializar, recupera la cadena original únicamente si el valor
editable sigue igual. Empareja las T por su ID persistido, incluso cuando se
reordenan. Las T nuevas no heredan fechas de otras T; borrar o cambiar una fecha
continúa enviando la decisión expresa del usuario. No se convierte la cadena
original mediante `Date`, para conservar sus seis decimales y su offset.

Se protegen los dos campos de ficha `fecha_entrada` y
`fecha_limite_sustitucion`, y los cuatro campos de T `fecha_prevista`,
`fecha_inicio_real`, `fecha_fin_real` y `fecha_real`.

La migración nueva modifica sólo las diez conversiones del core —dos de ficha,
cuatro de inserción de T y cuatro de actualización— y la respuesta del lector
público. Las fechas ISO con zona explícita se interpretan como instantes; las
fechas locales sin zona conservan la interpretación anterior de Madrid.

El lector anuncia `contrato_fechas_editor: MG75-EDITOR-FECHAS-001` en la misma
transacción que instala el parser. Si falta ese contrato, el editor muestra la
incompatibilidad y no construye el formulario de guardado. Esto impide enviar
fechas ISO a un servidor con el parser anterior.

### Resultado de guardado incierto

La revisión también reprodujo dos vías que permitían volver a iniciar un
guardado tras perder su respuesta: el error de red devuelto como valor por el
SDK y un evento de clic despachado pese al botón deshabilitado.

El editor conserva ahora un estado de incertidumbre que bloquea tanto otro
guardado como la rectificación de vehículo hasta reabrir la ficha. Una
excepción, `status: 0`, un error sin código de rechazo identificable o un recibo
incompleto llevan al mismo estado. Los rechazos SQL/PostgREST reconocidos
permiten corregir el borrador. El éxito exige un recibo con la misma petición,
ficha, seguimiento y pizarra, identidad validada y versiones coherentes. Una
anotación puede conservar la versión de PA; no se exige incrementarla.

Se verifica una única anotación persistida después del commit y de ambas formas
de pérdida de respuesta. La forma del error se contrasta con
[PostgrestBuilder de Supabase 2.111.0](https://github.com/supabase/supabase-js/blob/v2.111.0/packages/core/postgrest-js/src/PostgrestBuilder.ts)
y la [documentación oficial de throwOnError](https://supabase.com/docs/reference/javascript/using-modifiers-throwonerror).
El ensayo sigue usando transporte local controlado, sin afirmar que ejecute el
SDK, Auth o PostgREST reales.

La instalación verifica las definiciones revisadas, propietario, ACL, flags y
configuración de las dos funciones. Rechaza la deriva y conserva exactamente
sus propiedades después de `CREATE OR REPLACE`; no concede permisos nuevos ni
reescribe filas. Las guardas de continuidad siguen rechazando cualquier cambio
explícito de una fecha protegida.

## Migración y revisión

Archivo: `20261029072758_alpha75_editor_timestamps_exactos.sql`.

```text
SHA256 c060fc32808f9e42ca7369863b7cd04984e1d48ab8d31fe804d0c2a7d7a3e64d
```

Las tres migraciones anteriores permanecen intactas. Esta migración requiere
las definiciones reales del editor verificadas en su preflight. Una eventual
instalación autorizada debe completar primero las migraciones y después servir
la aplicación, con recarga completa y comprobación de la revisión
`75.25-editor-fechas-001`. La versión visible continúa siendo 75.25.

## Evidencia

| Capa nueva | Cobertura |
| --- | --- |
| 6 escenarios SQL del editor | Anotaciones, T y trabajos existentes, hitos reales, recuperación, versiones obsoletas, rollback e histórico. |
| 8 escenarios SQL de fechas | Reproducción anterior, seis campos y diez conversiones, microsegundos, offsets, las dos horas repetidas, datos inválidos, instalación atómica y 12 derivas rechazadas. |
| 8 recorridos de navegador | Guardado real en origen y destino, origen tras cerrar la asistencia, hitos/recuperación/Histórico, conflicto, cambio protegido, dos formas de respuesta perdida y backend incompatible. |
| 20 casos frontend | Doce de fechas exactas y ocho de clasificación del resultado, identidad, versiones y errores de transporte. |
| 1 escenario adicional de caché | Editor previo de `18ba1e8` acreditado en caché HTTP; el index candidato carga el SHA256 del editor corregido y no ejecuta el anterior. |

Se conservan los 44 escenarios SQL anteriores, los 14 recorridos funcionales y
los cuatro escenarios de arranque anteriores. La suma es **58 escenarios SQL
nativos, 22 recorridos funcionales y cinco de arranque/caché**. Los 44 SQL
anteriores mantienen su fixture de continuidad con parte del editor
simplificada; los 14 SQL nuevos y los ocho recorridos nuevos sí cargan el
runtime completo del editor y esta migración. No se atribuye la nueva cobertura
a las suites antiguas.

Los ensayos locales usan PostgreSQL 17.11, Chrome 156.0.8078.73 y Europe/Madrid.
Las capturas del editor se revisan a 1440 × 1000 y 390 × 844 con CSS de producto.
Son ventanas de navegador sintéticas, no dispositivos físicos certificados.

## Frontera que permanece

Las 26 definiciones del runtime se obtuvieron exclusivamente del catálogo en
transacciones de lectura. Las bases y datos de los ensayos son sintéticos y
locales. Las pruebas de anotaciones sí escriben mediante las funciones reales
del editor; autenticación, dispositivo, autorización, transporte y auditoría
conservan los dobles declarados. Documentos, Apps Script, hojas y otros servicios
externos quedan fuera. Tampoco se certifican todo el rollover, el shell
autenticado, el alojamiento o el arranque propio de Alpha80test.

La PR continúa en borrador. Esta ampliación no instala las migraciones en el
backend operativo, no publica la aplicación y no abre sincronización. La
aceptación con Metro requiere un entorno expresamente autorizado con sesión y
dispositivo reales; `metrogestion-pruebas` sigue siendo operativo.

## Referencias del repositorio

- [Editor SQL completo](../tests/sql/README-native-editor.md).
- [Fechas, compatibilidad e instalación](../tests/sql/README-native-editor-timestamps.md).
- [Recorridos funcionales](../tests/integration/README.md).
- [Arranque y caché](../tests/integration/README-boot-cache.md).
- [Estado general de la candidata](alpha75-paradas-separadas-002.md).
