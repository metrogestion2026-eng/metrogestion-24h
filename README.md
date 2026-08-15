# Metrogestión · clean-r1

Base nueva y aislada para reconstruir Metrogestión sin heredar los service workers, sustituciones de HTML ni capas superpuestas de v36/v39.

## Estado

- Rama de desarrollo: `clean-r1`.
- No está publicada como aplicación de uso.
- No modifica v36 ni v39.
- No modifica la base de datos.
- No registra service worker.
- No contiene `service_role` ni secretos privados.
- Supabase JS está fijado a una versión exacta (`2.111.0`).

## Primera validación incluida

1. Login únicamente mediante el botón Entrar.
2. Comprobación de cuenta activa.
3. Identificador de dispositivo generado mediante `crypto.getRandomValues`.
4. Token del dispositivo enviado en la cabecera `x-device-token`.
5. Solicitud y comprobación de autorización del dispositivo.
6. Mismo frontend para administrador y usuarios.
7. Navegación visible según permisos.
8. Hotel actual en lectura desde `hotel_actual_v39`.
9. Histórico por un día concreto, cargando solo la pizarra seleccionada.
10. Panel marcado expresamente como EN CONSTRUCCIÓN.

## Regla de seguridad

La interfaz nunca concede permisos. Los permisos efectivos deben seguir siendo aplicados por RLS y funciones SQL de Supabase. La clave pública puede estar en el navegador; la clave `service_role` nunca.
