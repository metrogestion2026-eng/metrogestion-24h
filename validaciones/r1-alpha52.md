# r1.0.0-alpha.52 · EN PRUEBAS

Fecha de publicación: 25/08/2026

Estado: PENDIENTE DE VALIDACIÓN COMPLETA DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha52/

Punto de partida:
- Parte de Alpha51 sin modificar Alpha50, que permanece validada y cerrada.
- Conserva Usuarios, el estado real de Reservas y los seis bloques operativos del Hotel.

🟨 VALIDADO POR EL USUARIO · Panel general:
- La pestaña `Panel` pasa a ser un módulo operativo y aparece en primera posición del menú.
- Resume en una sola pantalla: Hotel, alertas, Reservas, Activar 24H, T programadas, facturación de sustituciones, contratos y Usuarios/accesos.
- Los bloques muestran datos reales de Supabase, no cifras fijas.
- Cada indicador abre su detalle con un clic y conserva un botón para acceder al módulo de origen.
- El Panel respeta los permisos del usuario; Usuarios y dispositivos solo aparecen a administradores o autorizados.
- Incluye actualización manual, actualización automática cada minuto y nueva lectura al volver a la aplicación.
- Valoración del usuario: «Me parece perfecto, una pestaña muy útil».

Bloques del Hotel incluidos en el Panel:
- Fichas activas.
- Pendientes de parar.
- Pendientes de taller.
- En taller.
- Pendientes de recoger.
- Pendientes de recuperar.

La validación anterior corresponde al bloque `Panel general`. Alpha52 no se declarará cerrada hasta recibir confirmación expresa para validar la versión completa.
