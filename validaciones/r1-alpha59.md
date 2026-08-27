# r1.0.0-alpha.59 · EN PRUEBAS

Fecha de publicación: 27/08/2026

Estado: PENDIENTE DE VALIDACIÓN DEL USUARIO.

Enlace de prueba:
- https://metrogestion2026-eng.github.io/metrogestion-24h/r1-alpha59/

Punto de partida:
- Parte íntegramente de Alpha58.
- Conserva la creación de fichas, la apertura estable de las T y los tipos de trabajo editables.
- Conserva el buscador de Pizarra, la documentación PDF/fotografías y la carga por arrastre.
- Conserva el Panel general validado en Alpha52.
- Alpha53 permanece validada, cerrada e inmutable.
- Alpha58 no se modifica.

Cambio en prueba · compartir documentación de una T:
- Cada PDF o fotografía activa incorpora el botón `Compartir`.
- El botón aparece tanto en la Pizarra activa como en las fichas del Histórico, porque ambas utilizan el mismo componente documental de la T.
- En dispositivos compatibles permite compartir el archivo directamente mediante el menú nativo del móvil, tableta u ordenador.
- También permite compartir un enlace privado temporal o copiarlo para pegarlo en WhatsApp, correo u otra aplicación.
- Los enlaces temporales caducan después de 1 hora.
- Los documentos anulados no se pueden compartir; deben restaurarse previamente.
- Abrir, descargar, histórico, modificar, anular y restaurar se conservan sin cambios.
- Cada compartición realizada o enlace copiado queda registrada en el histórico del documento con usuario, fecha, modalidad y caducidad.
- La generación del enlace se realiza únicamente al pulsar `Compartir`; no se crean enlaces permanentes ni públicos.

Integración sin capas posteriores:
- Alpha59 tiene su propio componente de tarjeta documental.
- Hotel activo e Histórico cargan el mismo componente nativo de documentación por T.
- La trazabilidad se registra mediante una operación de negocio protegida en Supabase.
- No se modifica ni sobrescribe ningún archivo de Alpha58.

Alpha59 no se declarará validada ni cerrada hasta recibir confirmación expresa del usuario.
