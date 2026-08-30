# Alpha69 · presencia y control de acceso en tiempo real

Alpha69 conserva Alpha68 y añade un control exclusivo del administrador principal para saber quién está dentro de Metrogestión y cortar su acceso.

## Panel «En línea»

Muestra en tiempo real:

- nombre y correo;
- rango real leído de `usuarios`;
- dispositivo autorizado;
- pantalla abierta;
- versión de la aplicación;
- hora de conexión y última actividad;
- pestaña activa o en segundo plano.

La presencia no confía en datos declarados por el navegador. Cada pulso vuelve a comprobar sesión, vigencia de credenciales, cuenta activa y dispositivo autorizado.

## Bloqueos

Desde una conexión reconocida, el administrador principal puede:

- **Revocar dispositivo:** bloquea ese móvil u ordenador. Todas las pestañas del mismo dispositivo quedan cerradas.
- **Bloquear cuenta:** desactiva el usuario, revoca sus dispositivos autorizados y cierra todas sus pestañas.

El administrador principal no puede bloquearse a sí mismo.

Los bloqueos se aplican en la base de datos y quedan registrados en `auditoria_cambios`. No dependen únicamente de ocultar la interfaz.

## Accesos no reconocidos

La pantalla de identificación comunica con la función aislada `acceso-anonimo-r1`. Solo registra:

- huella aleatoria del navegador, almacenada como hash;
- dirección de red almacenada como hash con sal del servidor;
- correo escrito únicamente cuando Supabase rechaza las credenciales;
- navegador, ruta, horas y número de intentos.

No se registra ninguna contraseña.

Un acceso no reconocido aparece separado y rotulado como **detenido en el acceso**. No se considera una persona dentro de la aplicación y no puede consultar las tablas.

El administrador principal puede bloquear esa huella. La medida impide nuevos intentos desde el mismo almacenamiento del navegador. Si se borra por completo el almacenamiento, se generará una huella distinta; aun así, sin cuenta, credencial y dispositivo autorizado no se accede a los datos.

## Tiempo real y respaldo

- Pulso de seguridad autenticado: cada 15 segundos.
- Consideración «en línea»: actividad durante los últimos 45 segundos.
- Aviso inmediato mediante Supabase Realtime cuando una presencia o un intento cambia.
- Si Realtime se interrumpe, el pulso periódico mantiene el bloqueo como respaldo.
- Los usuarios no pueden escribir directamente en las tablas de presencia.
- `anon` no puede leer las tablas ni ejecutar los RPC internos.

## Componentes

- Aplicación: `r1-alpha69/`
- Cliente: `r1-alpha69/src/presence-security.js`
- Edge Function: `supabase/functions/acceso-anonimo-r1/index.ts`
- Migración: `20260830160358_alpha69_presencia_seguridad_tiempo_real.sql`
