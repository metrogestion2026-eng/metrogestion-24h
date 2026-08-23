# r1.0.0-alpha.51 · EN PRUEBAS

Fecha de publicación: 23/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Base conservada:
- Parte íntegramente de Alpha50, que permanece cerrada e inmutable.
- Conserva el bloque validado de Activar 24H, incidencias, modificación, anulación, restauración, histórico y listados.

Cambio en prueba:
- Nueva pestaña principal `Usuarios`.
- La pestaña solo aparece al administrador principal o a una cuenta autorizada expresamente mediante `permisos.usuarios`.
- El administrador principal puede crear cuentas, bloquear/reactivar usuarios, conceder o retirar acceso a `Usuarios` y resolver solicitudes de dispositivos.
- Las cuentas autorizadas no administradoras acceden en modo de solo lectura.
- La lista completa queda protegida también en Supabase mediante RLS; ocultar el botón no es la única barrera.

La versión no debe declararse validada ni cerrada hasta recibir confirmación expresa del usuario.
