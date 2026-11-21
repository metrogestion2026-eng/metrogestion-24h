# SINCRO 13 · Endurecimiento del ensayo Hotel actual · 19/11/2026

**Solo candidata en PR #133, sin desplegar ni modificar datos operativos.**

## Punto de partida comprobado

La rama ya cuenta con `tests/sql/sincro13-hotel-adoption-current-runtime.test.mjs` y `tests/sql/sincro13-hotel-current-date-functions.test.mjs` que cargan en PostgreSQL aislado funciones y triggers capturados en modo de lectura del Supabase de pruebas. La información de la suite anterior incluía **43 triggers (25 de T y 18 de ficha)**, paridad de SHA de funciones y definición de activación, y una adopción sintética por K que actualiza `fecha_real`, propaga K mediante funciones de Hotel, conserva J y trabajos ajenos y cambia el estado real de esa T de acuerdo con sus triggers. No equivale a instalar el lector real de Google ni a modificar un vehículo operativo.

## Nuevo trabajo en esta revisión

1. **La paridad de los 43 triggers es ahora una aserción estricta** en vez de únicamente informativa. Se rechaza cualquier nombre, hash de cuerpo de función, SQL de trigger o trigger extra discrepante tanto en etapas como en fichas. Se obliga a una actualización consciente de fixtures si el esquema evoluciona.
2. Se añaden cinco pruebas adversariales directamente a la RPC candidata de adopción de Hotel, ejecutada en el entorno con triggers capturados del servidor de pruebas: rechazo de recogida futura, fecha-hora sin zona, falta de declaración expresa, día que no coincide con K de Google y aprobación de otra solicitud.
3. Antes y después de cada rechazo se leen **inventarios completos de la ficha** y los hechos históricos sintéticos protegidos. El test exige que no se modifique Hotel, la K técnica, la reserva, los trabajos ajenos o la auditoría; tampoco permite producir un recibo de adopción si se deniega.

## Alcance y garantías

La K de MANTENIMENT es día de recogida, **no hora**. No generar hora automáticamente, no dar por realizada una T sin hechos acreditados, no usar fila física/PA/DFM como identidad, no recuperar vehículo ni liberar reserva automáticamente. El administrador de Metroges identifica su acto de adopción, no a la persona original que editó Google. La PR permanece DRAFT, el emisor de Google y la SINCRO real siguen apagados.

Los ensayos se ejecutan sobre nuevas bases sintéticas. La coincidencia de SHA certifica la identidad de las funciones/triggers capturados; no demuestra que el entorno instalado no haya cambiado desde el último corte, ni sustituye el primer E2E autorizado y supervisado.

**Pendiente:** probar la Edge con credencial Google independiente, aceptar un primer hecho real no destructivo, asegurar que el circuito de ida y vuelta no modifica datos recientes manuales y validar Alpha75 únicamente cuando la sincronización sea operativa. R1515, V1/F2 e históricos no se tocan.
