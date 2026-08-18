# Estado de Metrogestión clean-r1

Fecha de validación: 18/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: proyecto gratuito `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- La configuración y la Content Security Policy solo permiten conectar con `metrogestion-pruebas`.
- No existe service worker ni actualización automática.
- Cada prueba publicada es inmutable y utiliza una carpeta distinta.
- Alpha 4 a Alpha 10 permanecen separadas.
- Alpha 10: `https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha10/`.
- Las publicaciones solo añaden carpetas `r1-*`; no sustituyen archivos de v36 o v39.

## Migraciones aplicadas en metrogestion-pruebas

1. `001_core_tables`
2. `002_security_functions`
3. `003_rls_policies`
4. `004_private_security_core`
5. `005_audit_and_no_physical_delete`
6. `006_hotel_source_views`
7. `007_indexes_and_rls_initplan`
8. `008_bootstrap_admin_config`
9. `009_hotel_edit_pilot`
10. `010_audit_request_context`
11. `011_noop_updates_without_audit`
12. `012_ignore_generated_stage_position_in_noop`
13. `013_bootstrap_config_explicit_deny`
14. `014_hotel_card_stage_summary`
15. `015_hotel_drive_staging`
16. `016_hotel_transformation_preview`
17. `017_hotel_manual_review`
18. `018_harden_manual_review_writes`
19. `019_hotel_color_model`
20. `020_hotel_visual_state_model`: separa estado operativo, color de fondo y trazo; incorpora amarillo y resuelve sustituciones temporales desde las relaciones/anotaciones validadas.

## Seguridad

- `anon` no puede consultar Hotel, usuarios, transformación ni revisiones.
- La instantánea original de Drive permanece congelada.
- Las revisiones están separadas, versionadas y auditadas.
- La capa de presentación de Alpha 10 es solo lectura y no aplica datos al Hotel activo.

## Hotel real

Fuente: `RESERVAS 2026`, hoja `8`, pizarra del 17/08/2026.

- 19 filas capturadas.
- 13 paradas activas revisadas y validadas.
- 6 reservas libres automáticas.
- Columna L = `PARADA / Nº de parada`.
- INC separado y vinculado manualmente a la parada.
- 31 de 31 T reconocidas.

## Modelo visual definitivo

El modelo separa tres conceptos que no deben mezclarse:

1. **Estado operativo**: qué situación tiene la unidad.
2. **Fondo**: representación visual principal del estado o de la ocupación temporal de una unidad de flota.
3. **Trazo marrón**: indicador adicional independiente del fondo.

Reglas:

- `blanco` ↔ **Pendiente de taller**.
- `amarillo` ↔ **Pendiente de parar**.
- `lila` ↔ **Vehículo en taller / realizando trabajos**.
- `azul` ↔ **Pendiente de recoger en taller**.
- `calabaza` ↔ **Pendiente de recuperar**.
- `verde` ↔ **Reserva libre y disponible para asignar**.
- `marrón` ↔ **Vehículo de flota que sustituye temporalmente a otro vehículo de flota por una urgencia**. Mientras está marrón no está disponible para otra asignación.
- `trazo marrón` ↔ **Vehículo en reparación sin sustitución**. El trazo se conserva aunque después cambie el fondo por su nuevo estado; por ejemplo, pendiente de recuperar = fondo calabaza + trazo marrón.

El color nunca sustituye al dato. Se interpreta junto con estado, número de parada, relaciones de sustitución y anotación validada.

## Resultado sobre las fichas validadas actuales

La vista `hotel_importacion_presentacion_previa` usa las relaciones entre DFM y las anotaciones ya validadas.

Resultado actual:

- marrón: 2 fichas (`2498` sustituyendo a `2604`, y `2516` sustituyendo a `2544`);
- amarillo: 1 ficha (`2604`, pendiente de parar / entrada programada);
- lila: 3 fichas;
- azul: 4 fichas, todas con estado `Pendiente de recoger`;
- calabaza: 3 fichas, todas con estado `Pendiente de recuperar`;
- verde: 6 reservas libres;
- blanco: 0 fichas en esta instantánea concreta;
- trazo marrón: 1 ficha (`2612`), que además queda calabaza por estar pendiente de recuperar.

Casos clave resueltos:

- `2498`: fondo marrón porque está ocupado sustituyendo temporalmente al `2604`, aunque su propio estado base sea pendiente de taller.
- `2604`: amarillo, estado `Pendiente de parar`.
- `2516`: fondo marrón porque está ocupado sustituyendo temporalmente al `2544`.
- `2544`: calabaza, estado `Pendiente de recuperar`; al recuperar su ruta libera al `2516`.
- `2612`: calabaza + trazo marrón, porque fue reparado sin sustitución y está pendiente de recuperar su ruta.

## Alpha 10

Versión: `r1.0.0-alpha.10`.

- Parte de Alpha 8 completa y añade `Estados y colores`.
- Muestra estado, fondo y trazo por separado.
- Incluye la leyenda completa con el nuevo amarillo.
- Muestra las relaciones de sustitución entre DFM y las anotaciones validadas.
- Representa visualmente el trazo marrón de forma independiente del fondo.
- No contiene acción de importar o aplicar al Hotel activo.

## Estado del bloque actual

Pendiente de validación humana de Alpha 10:

1. Confirmar que `2498` y `2516` aparecen marrón.
2. Confirmar que `2604` aparece amarillo con estado `Pendiente de parar`.
3. Confirmar que las fichas azules muestran `Pendiente de recoger`.
4. Confirmar que las fichas calabaza muestran `Pendiente de recuperar`.
5. Confirmar que `2612` aparece calabaza + trazo marrón.
6. Confirmar las 6 reservas libres en verde.
7. No aplicar todavía ninguna importación al Hotel activo.
