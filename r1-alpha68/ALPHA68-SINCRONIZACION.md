# Alpha68 · sincronización diaria de MANTENIMIENTOS

Alpha68 conserva íntegramente Alpha67 y añade el control protegido de actualización de flota.

## Fuente

- Archivo privado: `MANTENIMIENTOS`
- Hoja: `MANTENIMENT`
- Solo se aceptan filas cuyo campo `MANTENIMENT` sea exactamente `ALTA`.
- Se tratan tanto los DFM como los semirremolques R.

## Funcionamiento

1. El administrador principal genera desde Alpha68 una clave de conexión de un solo uso.
2. La clave se guarda únicamente en las Propiedades del Apps Script ligado a la hoja.
3. El script envía un snapshot cada seis horas mediante la función protegida `recibir_snapshot_manteniment`.
4. Supabase valida archivo, hoja, estructura, fechas, duplicados y volumen mínimo antes de modificar el maestro.
5. Los vehículos que dejan de figurar como `ALTA` se desactivan; no se borran.
6. Los registros creados manualmente en Metrogestión se conservan.

## Instalación

1. Abrir Alpha68 como administrador principal y pulsar el indicador **Flota**.
2. Pulsar **Preparar conexión con Google** y copiar la clave mostrada.
3. En el archivo `MANTENIMIENTOS`, abrir **Extensiones → Apps Script**.
4. Copiar el contenido de `google-apps-script/sincronizar_manteniment.gs` en el proyecto ligado al archivo y guardar.
5. Volver a la hoja, recargarla y usar **Metrogestión → Guardar clave de conexión**.
6. Ejecutar **Metrogestión → Sincronizar ahora** y comprobar el resultado.
7. Ejecutar **Metrogestión → Instalar actualización cada 6 horas**.

La clave no debe añadirse al repositorio, a una celda ni a los registros de ejecución.
