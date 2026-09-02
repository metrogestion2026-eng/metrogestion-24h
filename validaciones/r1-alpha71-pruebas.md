# Alpha71 · comprobaciones técnicas

Fecha: 02/09/2026

Estado: **en pruebas**. Alpha70 permanece validada y cerrada.

## Comprobaciones realizadas

- Sintaxis JavaScript de todos los módulos de Alpha71.
- Sintaxis del Google Apps Script y de la Edge Function.
- Migraciones completas ejecutadas primero dentro de una transacción con `ROLLBACK`.
- Prueba transaccional de Hotel → outbox → MANTENIMENT → Hotel sin dejar registros de prueba.
- Prueba transaccional de alta, edición y baja de Activos hacia MANTENIMENT sin dejar registros de prueba.
- Verificación de fecha de matriculación como base del fin de contrato.
- Verificación de próxima ITV = fecha de matriculación + 1 año.
- Prueba de lectura de I/J, PARADA, días, kilómetros y `TANCAMENT n` en Apps Script.
- Edge Function `manteniment-sync-r1` desplegada activa con autenticación propia por token y confirmación idempotente.
- Revisión de asesores de seguridad después de las migraciones.

## Estado de datos tras las pruebas

- 140 activos totales.
- 139 activos en servicio.
- 135 vinculados al maestro MANTENIMENT.
- 60 vehículos con fecha de matriculación: los 60 tienen ITV inicial correcta y ningún fin de contrato incoherente.
- Ninguna fila o vehículo de prueba permanente.

## Paso externo pendiente

El proyecto vinculado de Google Apps Script debe sustituir el código anterior por el archivo de Alpha71. Hasta completar ese paso, la hoja seguirá ejecutando la versión anterior del script y no consumirá las órdenes bidireccionales nuevas.
