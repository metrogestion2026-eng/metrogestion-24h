# Alpha68 · sincronización automática de MANTENIMIENTOS

Alpha68 conserva íntegramente Alpha67 y añade el control protegido de actualización de flota.

## Fuente

- Archivo privado: `MANTENIMIENTOS`
- Hoja: `MANTENIMENT`
- Solo se aceptan filas cuyo campo `MANTENIMENT` sea exactamente `ALTA`.
- Se tratan tanto los DFM como los semirremolques R.
- La sincronización es de una sola dirección: Google Sheets → Metrogestión. El script no escribe ni cambia permisos en la hoja.

## Funcionamiento

1. El administrador principal genera desde Alpha68 una clave de conexión de un solo uso.
2. La clave se guarda únicamente en las Propiedades del Apps Script ligado a la hoja.
3. El script envía una fotografía cada seis horas al webhook aislado `manteniment-sync-r1`.
4. El webhook no admite el RPC público: valida formato y volumen y entrega la petición internamente con `service_role`.
5. Supabase compara el hash de la clave y valida archivo, hoja, estructura, fechas, duplicados y volumen mínimo antes de modificar el maestro.
6. Los vehículos que dejan de figurar como `ALTA` se desactivan; no se borran.
7. Los registros creados manualmente en Metrogestión se conservan.

No se guarda en Apps Script ninguna clave pública de Supabase. El RPC de recepción no concede ejecución a `anon` ni a `authenticated`.

## Instalación

1. Abrir Alpha68 como administrador principal y pulsar el indicador **Flota**.
2. Pulsar **Preparar conexión con Google** y copiar la clave mostrada.
3. En el archivo [MANTENIMIENTOS](https://docs.google.com/spreadsheets/d/1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU/edit), abrir **Extensiones → Apps Script**.
4. Copiar el contenido actualizado de [`google-apps-script/sincronizar_manteniment.gs`](./google-apps-script/sincronizar_manteniment.gs) en el proyecto ligado al archivo y guardar.
5. Volver a la hoja, recargarla y usar **Metrogestión → Guardar clave de conexión**.
6. Ejecutar **Metrogestión → Sincronizar ahora** y comprobar el resultado.
7. Ejecutar **Metrogestión → Instalar actualización cada 6 horas**.
8. En **Metrogestión → Ver estado local**, comprobar que constan clave, disparador y última ejecución.

La clave no debe añadirse al repositorio, a una celda, a un correo ni a los registros de ejecución.

## Validación previa del 30 de agosto de 2026

- Archivo y pestaña esperados: correctos.
- Cabeceras A:Q: correctas.
- Filas exactamente `ALTA` en la hoja: 135.
- Filas de la carga inicial conservadas en Supabase: 135.
- El receptor directo de Data API está cerrado para usuarios anónimos y autenticados.
- La función Edge `manteniment-sync-r1` está activa con autenticación propia mediante clave aleatoria almacenada como hash.
