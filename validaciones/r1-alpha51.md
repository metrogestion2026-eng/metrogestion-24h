# r1.0.0-alpha.51 · EN PRUEBAS

Fecha de publicación: 23/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha51/

Base conservada:
- Parte íntegramente de Alpha50, que permanece cerrada e inmutable.
- Conserva el bloque validado de Activar 24H, incidencias, modificación, anulación, restauración, histórico y listados.

Cambio en prueba:
- Nueva pestaña principal `Usuarios`.
- La pestaña solo aparece al administrador principal o a una cuenta autorizada expresamente mediante `permisos.usuarios`.
- El administrador principal puede crear cuentas, bloquear/reactivar usuarios, conceder o retirar acceso a `Usuarios` y resolver solicitudes de dispositivos.
- Las cuentas autorizadas no administradoras acceden en modo de solo lectura.
- La lista completa queda protegida también en Supabase mediante RLS; ocultar el botón no es la única barrera.

Corrección durante las pruebas · 25/08/2026:
- La pestaña `Reservas` mostraba el valor almacenado en `reservas_hotel.estado`, que no se recalculaba al cambiar la pizarra.
- El estado de cada reserva se calcula ahora desde el Hotel activo: `ocupada` cuando sustituye a otra unidad, `fuera_servicio` cuando la propia reserva está parada, `disponible_con_pendientes` cuando queda libre pero conserva trabajos propios y `libre` cuando no está ocupada ni tiene pendientes.
- Se añadieron sincronizaciones automáticas al crear, modificar, recuperar, anular o retirar paradas, y al cambiar la pizarra en curso.
- Se recalcularon los estados ya existentes para eliminar los valores antiguos.

Ampliación del Hotel durante las pruebas · 25/08/2026:
- Se incorpora el bloque `Pendientes de parar` dentro del resumen de fichas activas.
- El contador se obtiene directamente de las fichas cuyo estado real es `planificado`.
- El bloque es pulsable y muestra únicamente las fichas pendientes de parar.
- Se conserva el resto de bloques y filtros: fichas activas, pendientes de taller, en taller, pendientes de recoger y pendientes de recuperar.
- El bloque se genera en el mismo render del Hotel; no modifica Alpha50 ni añade datos duplicados.

La versión no debe declararse validada ni cerrada hasta recibir confirmación expresa del usuario.
