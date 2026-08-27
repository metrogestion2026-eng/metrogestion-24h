# r1.0.0-alpha.64 · EN PRUEBAS

Fecha de publicación: 27/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha64/

Punto de partida:
- Parte de Alpha62 y conserva la gestión de dos dispositivos por usuario incorporada en Alpha63.
- Conserva la navegación estable entre Hotel y Panel.
- Conserva Usuarios exclusivo del administrador principal.
- Conserva la restricción de media manual y precio R al administrador principal.
- Conserva Activar 24H, documentación compartible, creación de fichas, apertura estable de T, tipos editables, buscador y Panel.
- Alpha58 permanece validada, cerrada e inmutable.
- Alpha63 no se modifica.

Cambio en prueba · recuperación de dispositivos revocados:
- Los dispositivos con estado `revocado` muestran el botón `Recuperar móvil` o `Recuperar ordenador` dentro de su plaza correspondiente.
- El botón aparece al desplegar `Revocados o rechazados`.
- Al recuperar, se solicita confirmación y un motivo obligatorio.
- El mismo registro y el mismo identificador del dispositivo vuelven a quedar autorizados; no se crea un duplicado.
- Un dispositivo rechazado o bloqueado no puede recuperarse con esta acción: debe volver a generar una solicitud pendiente desde ese equipo.
- La recuperación solo está disponible si la plaza de ese tipo está libre.
- Si ya existe otro móvil u otro ordenador autorizado para la cuenta, el botón queda deshabilitado hasta revocar el dispositivo que ocupa esa plaza.
- El límite continúa siendo un móvil y un ordenador simultáneos por usuario.

Caso comprobable · Josep Manel:
- Su ordenador permanece autorizado.
- Su Android aparece en `Móvil` → `Revocados o rechazados`.
- Como la plaza de móvil está libre, Alpha64 muestra `Recuperar móvil` habilitado.
- Pulsarlo vuelve a autorizar el Android sin desconectar el ordenador.

Seguridad:
- La recuperación se ejecuta mediante una función específica de Supabase.
- Solo el administrador principal puede ejecutarla.
- La función vuelve a comprobar el límite total de dos dispositivos y la exclusividad por tipo antes de autorizar.
- Alpha64 no autoriza automáticamente ningún dispositivo: la acción requiere una decisión expresa del administrador.

Alpha64 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
