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
- En las filas `PARADA` vinculadas, **MANTENIMENT gobierna I, J, K, L y P**. En Q conserva lo ya escrito; si está vacío, Metrogestión añade automáticamente el período abierto como `TANCAMENT n`.
- **Metrogestión protege A-E, G y O**: DFM, matrícula, tipo, UPC, número de actuación, sustituto y marca. Los cambios de esas columnas se ignoran al importar y la orden siguiente restaura los valores de la ficha.
- La columna E conserva su enlace de Drive cuando el número de actuación protegido no ha cambiado.

## Taller F automático para R y DFM

Si F está vacío, Metrogestión lo completa al importar sin modificar la hoja:

- GESTIÓN → `UPC`.
- MANTENIMIENTO + H=`BPW` → `DIRECAUTO`.
- MANTENIMIENTO + H=`MCD` + Q=`THERMO KING` → `FRIGICOLL`.
- MANTENIMIENTO + H=`MCD` + Q=`CARRIER` → `FRIDIEL`.
- TRÁMITE + H=`ITV` → `APPLUS (RED DE ITV)`.
- TRÁMITE + H=`RT` → `AUTODIS`.
- TRÁMITE + H=`TMG` o `ATP` → `INVERYCA`.
- TRÁMITE + H=`EXTINTOR` → `UPC`.

Para los DFM, si F está vacío y H=`MCD` o H=`AV`, la marca de O asigna el taller:

- `MERCEDES` → `STERN MOTOR`.
- `IVECO` → `AUTO DISTRIBUCIÓN`.
- `MAN` → `MAN`.
- `VOLVO` → `VOLVO`.

Si O no permite identificar exactamente una de estas cuatro marcas, el taller
queda vacío para revisión manual.

Un valor escrito en F tiene prioridad salvo en `TRÁMITE` y `GESTIÓN`, donde manda G.
`LKT` y `EXTINTOR` se consideran siempre `TRÁMITE`. REPARACIÓN no infiere taller.
- `TANCAMENT n` utiliza la fecha K como corte de facturación y no como recuperación operativa.
- La celda Q permanece rosa pastel mientras el cierre no esté supervisado.
- En las necesidades predictivas, el fondo de la columna H es autoritativo:
  **blanco significa pendiente**; cualquier otro color no crea una T nueva.
- Las necesidades predictivas incluyen tanto unidades R como DFM.
- Los trabajos que comparten taller en F se agrupan dentro de una sola visita:
  una T de entrada, todos sus trabajos y una T de recogida.
- Una H diferente en el mismo taller crea otro trabajo dentro de la visita,
  no otra T. `GESTIÓN` y `TRÁMITE` sí conservan una T propia.
- `TM` crea una entrada con sus trabajos, pero no crea T de recogida.
- `LKT`, `EXTINTOR` y los demás `TRÁMITE` crean una sola T propia y nunca recogida.

## Instalación

1. Abrir **Extensiones → Apps Script** desde el archivo madre.
2. Sustituir el código anterior por `sincronizar_manteniment.gs`.
3. Guardar el proyecto.
4. Volver a la hoja y recargarla.
5. Ejecutar **Metrogestión → Sincronizar ahora** y aceptar los permisos si Google los solicita.
6. Comprobar **Metrogestión → Ver estado local**.

La clave sigue guardada en las propiedades del script y no debe copiarse a ninguna celda ni al código.
