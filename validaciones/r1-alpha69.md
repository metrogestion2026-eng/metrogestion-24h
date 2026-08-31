# r1.0.0-alpha.69 · VALIDADA Y CERRADA

Fecha de publicación: 30/08/2026

Fecha de validación: 31/08/2026

Estado: VALIDADA POR EL USUARIO Y CERRADA.

Enlace histórico:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha69/

## Reglas de cierre

- La carpeta `r1-alpha69` queda inmutable.
- No se modificará ni se sobrescribirá su código.
- Cualquier corrección o mejora posterior se realizará en una versión nueva.
- Alpha70 y todas las versiones siguientes deberán conservar íntegramente las funciones validadas de Alpha69.
- Alpha67 permanece validada, cerrada e inmutable.
- Alpha68 no se modifica ni se reabre.

## Base conservada

- Alpha69 parte íntegramente de Alpha68.
- Conserva el marcado rápido y seguro de T validado en Alpha67.
- Conserva las fechas operativas, la sustitución y la facturación validadas en Alpha66.
- Conserva la sincronización automática de MANTENIMENT incorporada en Alpha68, incluida la actualización de vehículos ALTA y el control visible de su estado.
- Conserva la autenticación, la autorización de dispositivos, los rangos de usuario, el Hotel, el Panel, el Histórico, las reservas y la documentación existente.

## Bloque validado · presencia en tiempo real

- El administrador principal dispone del panel exclusivo `🛡️ En línea`.
- El panel muestra las conexiones reconocidas que han enviado actividad durante los últimos 45 segundos.
- Cada conexión presenta nombre, correo, rango real, dispositivo, pantalla, versión, hora de conexión, última actividad y visibilidad de la pestaña.
- Los rangos proceden de `usuarios.tipo_usuario`; el navegador no puede declararse administrador.
- Se distinguen administrador principal, administrador secundario y usuario.
- Cada pestaña utiliza una instancia propia y envía un pulso de seguridad cada 15 segundos.
- El pulso vuelve a comprobar sesión, usuario activo, vigencia de credenciales y dispositivo autorizado.
- Se observó actividad real de Alpha69 tanto para el administrador principal como para un usuario normal.

## Bloque validado · cortar accesos

- El administrador principal puede revocar un dispositivo reconocido.
- También puede bloquear una cuenta, desactivar el usuario y revocar sus dispositivos autorizados.
- El administrador principal no puede bloquearse a sí mismo.
- El motivo del bloqueo es obligatorio.
- El bloqueo se ejecuta en Supabase y no depende de ocultar controles en el navegador.
- Las sesiones afectadas cambian a estado `bloqueado` y reciben el cierre por Realtime.
- Si Realtime se interrumpe, el siguiente pulso periódico vuelve a comprobar el permiso y fuerza la salida.
- Las operaciones de bloqueo quedan registradas en `auditoria_cambios`.

## Bloque validado · anónimos y accesos no reconocidos

- Una persona sin sesión válida queda detenida en la pantalla de identificación y no se considera dentro de Metrogestión.
- Los intentos no reconocidos aparecen en un bloque separado para el administrador principal.
- La función aislada `acceso-anonimo-r1` está desplegada y activa.
- La función registra únicamente hashes de huella y red, el correo escrito cuando las credenciales han sido rechazadas, el navegador, la ruta, las horas y el número de intentos.
- No se registra ninguna contraseña.
- El administrador principal puede bloquear o desbloquear una huella.
- El bloqueo de huella impide nuevos intentos desde el mismo almacenamiento del navegador; borrar completamente ese almacenamiento puede generar una huella distinta.
- Aunque cambie la huella, ninguna persona puede entrar en los datos sin cuenta, credenciales válidas y dispositivo autorizado.

## Seguridad de base de datos validada

- Las cinco migraciones de seguridad y presencia de Alpha69 están aplicadas en Supabase:
  - `alpha69_seguridad_integral_rls_vistas_rpc`;
  - `optimizar_rls_auth_uid_initplan`;
  - `alpha69_presencia_seguridad_tiempo_real`;
  - `alpha69_corregir_auditoria_bloqueos`;
  - `alpha69_indices_bloqueos_presencia`.
- `sesiones_presencia` e `intentos_acceso_no_reconocido` tienen RLS activado.
- Las dos tablas solo conceden lectura autenticada bajo sus políticas; no conceden lectura a `anon`.
- Un usuario autenticado sin identidad válida obtiene cero filas.
- `anon` no puede ejecutar los RPC de presencia, consulta administrativa, bloqueo ni registro interno.
- Los RPC administrativos vuelven a comprobar que el solicitante sea administrador principal y use un dispositivo autorizado.
- Las funciones con privilegios elevados fijan explícitamente su `search_path`.
- Las tablas de presencia están incluidas en la publicación `supabase_realtime`.
- Existen los índices de actividad, usuario, dispositivo, huella, red y bloqueo necesarios.
- El asesor de seguridad de Supabase no muestra ninguna incidencia crítica ni tabla pública sin RLS.
- Permanece una recomendación general de Auth para activar la protección contra contraseñas filtradas; no es una exposición de tablas ni un defecto propio de Alpha69.

## Verificaciones finales

- La Edge Function `acceso-anonimo-r1` respondió correctamente a las llamadas observadas.
- Se comprobaron las políticas, concesiones, funciones, publicación Realtime, índices y recuentos operativos sin consultar ni publicar datos personales.
- La prueba anónima confirmó ausencia de permisos de lectura y ejecución.
- La publicación histórica carga `r1.0.0-alpha.69` y muestra la identificación segura.
- La comprobación automática de sintaxis JavaScript finalizó correctamente.
- La publicación de GitHub Pages finalizó correctamente.
- No se observaron errores propios de Alpha69 en la carga pública.

## Continuidad

- Alpha70 importa directamente `r1-alpha69/src/app.js`.
- Alpha70 y las versiones siguientes deberán conservar íntegramente la presencia, los rangos, los bloqueos y las defensas de Alpha69.
- Alpha70 continúa en pruebas y no modifica ni reabre Alpha69.
