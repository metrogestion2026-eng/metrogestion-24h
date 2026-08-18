# Estado de Metrogestión clean-r1

Fecha de validación: 18/08/2026

## Aislamiento

- Rama de código: `clean-r1`.
- Base de datos: proyecto gratuito `metrogestion-pruebas` (`aemoouldgguyjsxrfuwo`).
- Producción `programa de gestión` no se ha modificado.
- La configuración y la Content Security Policy solo permiten conectar con `metrogestion-pruebas`.
- No existe service worker ni actualización automática.
- Cada prueba publicada es inmutable y utiliza una carpeta distinta.
- Alpha 4 a Alpha 9 permanecen separadas.
- Alpha 9: `https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha9/`.
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
19. `019_hotel_color_model`: catálogo formal de colores, propuesta desde estado/anotaciones y revisión manual auditada para casos ambiguos.

## Seguridad

- `anon` no puede consultar Hotel, usuarios, transformación ni revisiones.
- La revisión manual y la revisión de colores son exclusivas del administrador principal.
- La instantánea original de Drive permanece congelada.
- Las revisiones se guardan en tablas separadas, con control de versión y auditoría.
- Marrón y trazo marrón no se aceptan como decisión automática cuando dependen de una relación de sustitución entre vehículos de flota.

## Hotel real

Fuente: `RESERVAS 2026`, hoja `8`, pizarra del 17/08/2026.

- 19 filas capturadas.
- 13 paradas activas revisadas y validadas.
- 6 reservas libres automáticas.
- Columna L = `PARADA / Nº de parada`.
- INC separado y vinculado manualmente a la parada.
- 31 de 31 T reconocidas.

## Código operativo de colores

- `blanco`: pendiente de taller.
- `verde`: reserva libre y disponible para asignar.
- `calabaza`: pendiente de recuperar.
- `azul`: trabajo terminado, pendiente de recoger en taller.
- `marron`: vehículo de flota que sustituye temporalmente a otro vehículo de flota por una urgencia.
- `lila`: vehículo actualmente en taller.
- `trazo_marron`: vehículo en reparación que no ha sido sustituido.

El color no sustituye al dato. Se interpreta junto con estado, parada, relación flota/reserva y anotación validada.

## Propuesta de colores sobre las fichas validadas

La vista `hotel_importacion_color_previa` propone automáticamente únicamente casos inequívocos. En la instantánea actual:

- blanco: 3 fichas;
- verde: 6 reservas libres;
- calabaza: 3 fichas;
- azul: 4 fichas;
- lila: 3 fichas;
- marrón: 0 automáticas;
- trazo marrón: 0 automáticas.

Las propuestas usan primero las anotaciones validadas para detectar `pendiente de recoger` o `pendiente de recuperar`, y después el estado validado. Marrón y trazo marrón quedan disponibles para revisión explícita cuando corresponda.

## Alpha 9

Versión: `r1.0.0-alpha.9`.

- Añade `Colores · Previa`, visible solo para el administrador principal.
- Muestra la leyenda de los siete criterios visuales.
- Presenta cada ficha con su color propuesto, motivo y anotación validada.
- Permite corregir y validar manualmente el color mediante RPC auditada.
- Marrón/trazo marrón exigen explicación cuando se validan.
- No existe acción de importar o aplicar al Hotel activo.

## Estado del bloque actual

Pendiente de validación humana de Alpha 9:

1. Abrir `Colores · Previa`.
2. Confirmar visualmente blanco, verde, calabaza, azul y lila en las fichas inequívocas.
3. Revisar las sustituciones temporales entre vehículos de flota para decidir dónde corresponde marrón.
4. Revisar si algún vehículo reparado sin sustitución debe mostrarse con trazo marrón.
5. No aplicar todavía ninguna importación al Hotel activo.
