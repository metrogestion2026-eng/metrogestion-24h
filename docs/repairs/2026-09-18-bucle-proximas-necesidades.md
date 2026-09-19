# Próximas necesidades detenidas en dos pendientes

Versión preparada: `alpha75-2026.09.18.1`.

El usuario informa de tandas repetidas con «0 creadas; 2 cambios por procesar».
La lectura de MANTENIMENT del 18/09 identifica dos siguientes necesidades SG:
2724 / 4590NGW y 2746 / 7349NKN, ambas con próxima fecha 01/04/2027.
El plan también requiere completar M y la identidad del origen del 2724.
No se ha escrito en la hoja durante este diagnóstico.

El script .5 fijaba un límite de 60 segundos al inicio de la llamada, antes de
abrir y leer toda la hoja. La fase de escritura podía recibir ese límite ya
agotado, aplicar cero cambios y devolver los mismos pendientes. El diálogo
volvía a llamar automáticamente sin comprobar que hubiese avance.

Se reproduce con un reloj simulado y 75 segundos de lectura: la versión
anterior devuelve dos pendientes en tres tandas consecutivas y crea cero filas.
No se dispone del registro de tiempos de la ejecución del usuario; la prueba
demuestra el fallo del código y reproduce exactamente el estado comunicado.

## Corrección

- El minuto para escribir empieza después de leer y planificar.
- El límite global de cuatro minutos se cuenta desde el inicio de la llamada;
  deja margen para confirmar y guardar antes del límite de ejecución.
- Se mantienen tandas de tres cambios o una inserción y la preparación del
  origen antes de insertar, para conservar la recuperación sin duplicados.
- El mensaje distingue próximas necesidades por crear y filas por actualizar.
- Tres lecturas con el mismo plan completo y aún pendientes detienen la
  continuación automática e identifican los vehículos, tipos y filas.
- Si la propia lectura agota el límite global, se muestra un error concreto.
- Al actualizar un ciclo .5 se conservan su ID, las órdenes confirmadas y los
  contadores. No se borra el avance ni la clave de conexión.

El límite y las operaciones por tandas se contrastaron con las referencias de
[cuotas de Apps Script](https://developers.google.com/apps-script/guides/services/quotas)
y [buenas prácticas](https://developers.google.com/apps-script/guides/support/best-practices).

## Verificación

Siete pruebas específicas: reproducción del bloqueo anterior, creación de dos
SG con lectura lenta, preparación de los padres, agotamiento del límite global,
detención de reintentos automáticos sin avance, conservación del ciclo al
actualizar y pausa de predictivas. Todas pasan.

También pasan las 16 regresiones de asignaciones, reintentos, confirmaciones y
cortes al insertar, ejecutadas contra el script corregido de Alpha75, y las seis
comprobaciones de compatibilidad/consulta de Alpha76.

## Instalación

El archivo completo está en
`r1-alpha75/google-apps-script/sincronizar_manteniment.gs` de esta rama.
Cerrar el diálogo que repite la sincronización, sustituir el contenido del
script de MANTENIMIENTOS, guardar y abrir «Sincronizar ahora». El ciclo guardado
se conserva. «Ver estado local» debe indicar `alpha75-2026.09.18.1`.

Esta entrega modifica únicamente el script de Alpha75. No se publica una nueva
interfaz ni se modifica el script distribuido de Alpha76. La instalación en el
editor de Apps Script de la hoja sigue pendiente; guardar el código en GitHub
no actualiza automáticamente ese proyecto.
