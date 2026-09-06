# MANTENIMENT ↔ Metrogestión · Alpha74

Este script sustituye el contenido del proyecto de Google Apps Script vinculado al archivo madre **MANTENIMIENTOS**.

## Qué sincroniza

- Solo usa la hoja `MANTENIMENT` del archivo madre configurado.
- Las filas `ALTA` mantienen el comportamiento bidireccional existente entre Google y Supabase.
- Las bajas se conservan como `BAJA` y nunca borran el histórico.
- La columna I se interpreta como **fecha de matriculación**.
- La columna J se interpreta como **fecha de alta en delegación**.
- Las fichas nuevas de Hotel crean o actualizan una fila `PARADA` identificada mediante una nota técnica en la celda A.
- Solo las filas `PARADA` creadas por Metrogestión pueden volver desde Google a su ficha. Las filas históricas sin identificador no se importan automáticamente.
- En las filas `PARADA` vinculadas, **MANTENIMENT gobierna I, J, K, L, P y Q**: fechas, días, kilómetros y TANCAMENT.
- **Metrogestión protege A-E, G y O**: DFM, matrícula, tipo, UPC, número de parada, sustituto y marca. Los cambios de esas columnas se ignoran al importar y la orden siguiente restaura los valores de la ficha.
- La columna E conserva su enlace de Drive cuando el número de parada protegido no ha cambiado.
- `TANCAMENT n` utiliza la fecha K como corte de facturación y no como recuperación operativa.
- La celda Q permanece rosa pastel mientras el cierre no esté supervisado.
- En las necesidades predictivas, el fondo de la columna H es autoritativo:
  **blanco significa pendiente**; cualquier otro color no crea una T nueva.
- Los trabajos que comparten taller en F se agrupan dentro de una sola visita:
  una T de entrada, todos sus trabajos y una T de recogida.
- Una H diferente en el mismo taller crea otro trabajo dentro de la visita,
  no otra T. `GESTIÓN` y `TRÁMITE` sí conservan una T propia.

## Instalación

1. Abrir **Extensiones → Apps Script** desde el archivo madre.
2. Sustituir el código anterior por `sincronizar_manteniment.gs`.
3. Guardar el proyecto.
4. Volver a la hoja y recargarla.
5. Ejecutar **Metrogestión → Sincronizar ahora** y aceptar los permisos si Google los solicita.
6. Comprobar **Metrogestión → Ver estado local**.

La clave sigue guardada en las propiedades del script y no debe copiarse a ninguna celda ni al código.
