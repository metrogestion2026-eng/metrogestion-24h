# Estado de Metrogestión clean-r1

Fecha: 18/08/2026

## Aislamiento
- Base: `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción no modificada.
- Versiones r1 inmutables por carpeta.

## Estado actual
- Hotel activo de pruebas ya contiene 13 fichas reales de la pizarra del 17/08/2026.
- 31 T activas importadas.
- 13/13 fichas con anotaciones validadas guardadas en `registros_hotel.observaciones`.
- 2 sustituciones de tipo FLOTA.
- 1 ficha con trazo marrón independiente.
- 2 fichas ficticias anteriores retiradas lógicamente, no borradas.
- 46 eventos de auditoría generados durante la importación.

## Reglas visuales
- Blanco = pendiente de taller.
- Amarillo = pendiente de parar.
- Verde = reserva libre.
- Lila = en taller.
- Azul = pendiente de recoger.
- Calabaza = pendiente de recuperar.
- Marrón = vehículo de flota sustituyendo temporalmente a otro de flota.
- Trazo marrón = reparación/reparado sin sustitución; puede coexistir con cualquier fondo posterior.

## Reservas fijas
2499 PIÑA; 2497 IVECO; 2686 MAN; 2715 IVECO; 2501 ALICANTE; 2573 MAN DUO; 2545 IVECO; 2610 MERCEDES; 2676 21P/CAP; 2493 18/CB; 2745 21/CB; R1434 33 PLANCHA; R1524 33PL; R1334 33/SD; R1187 T27/ALTO; R1269 T33.

## Edición
- Las 13 fichas reales están habilitadas en el circuito de edición atómico/auditado ya probado.
- Se mantiene control de versión, dispositivo y permisos.
- La tabla `hotel_edicion_piloto` se conserva por compatibilidad interna, pero ya no representa una única ficha piloto.

## Alpha 12
- Carpeta `r1-alpha12` separada.
- Hotel activo muestra fondo real, trazo marrón, RESERVA/FLOTA y anotaciones definitivas.
- Todas las fichas autorizadas pueden abrir edición completa al activar `Lectura y edición`.
- No se ha modificado producción.
