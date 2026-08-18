# Estado de Metrogestión clean-r1

Fecha de validación: 18/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- Sin service worker ni actualización automática en las versiones r1.
- Versiones inmutables en carpetas separadas.

## Migraciones nuevas

19. `019_hotel_color_model`: catálogo formal de colores y revisión de color.
20. `020_hotel_visual_state_model`: separa estado, fondo y trazo; añade amarillo = pendiente de parar.
21. `021_reservas_fijas_y_relacion_flota_v4`: formaliza las 16 reservas fijas reales, conserva alta/baja y distingue RESERVA de FLOTA.

## Código operativo visual confirmado

- Blanco = pendiente de taller.
- Amarillo = pendiente de parar.
- Verde = reserva libre.
- Lila = vehículo en taller.
- Azul = pendiente de recoger en taller.
- Calabaza = pendiente de recuperar.
- Marrón = vehículo de flota sustituyendo temporalmente a otro vehículo de flota.
- Trazo marrón = vehículo en reparación/reparado sin sustitución; puede coexistir con cualquier fondo posterior.

## Correcciones de relación

- 2498 no es reserva fija; es FLOTA cuando sustituye temporalmente a 2604.
- 2604 está pendiente de taller y por tanto su fondo es blanco.
- 2516 no es reserva fija; es FLOTA cuando sustituye temporalmente a 2544.
- El campo de sustitución se rotula RESERVA solo si la unidad está en el catálogo fijo activo de reservas; en cualquier otro caso se rotula FLOTA.

## Catálogo fijo de reservas reales

2499 PIÑA; 2497 IVECO; 2686 MAN; 2715 IVECO; 2501 ALICANTE; 2573 MAN DUO; 2545 IVECO; 2610 MERCEDES; 2676 21P/CAP; 2493 18/CB; 2745 21/CB; R1434 33 PLANCHA; R1524 33PL; R1334 33/SD; R1187 T27/ALTO; R1269 T33.

Las reservas pueden estar de alta o de baja. La característica procede de la columna `PISSARRA` de la hoja origen.

## Alpha 11

- Nueva carpeta `r1-alpha11`.
- Integra la pestaña Reservas con las 16 reservas reales y su característica PISSARRA.
- Permite al administrador principal dar de alta/baja una reserva mediante RPC controlada.
- Corrige la presentación para mostrar RESERVA o FLOTA según catálogo.
- Refuerza visualmente la diferencia entre marrón y calabaza.
- Mantiene estado, fondo y trazo como capas separadas.
- No aplica todavía la instantánea al Hotel activo ni a producción.
