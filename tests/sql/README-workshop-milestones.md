# Confirmaciones de hitos de taller · Alpha75

La suite usa fichas, vehículos, documentos, trabajos y personas sintéticos. Nunca
se conecta a Supabase ni lee credenciales, filas operativas o archivos reales.

## Ejecución

- `node --test tests/alpha75-workshop-milestones.test.mjs`: semántica pura de los botones.
- `node --test tests/sql/alpha75-workshop-milestones.test.mjs`: PGlite / PostgreSQL17
  cuando no existe `METROGESTION_LOCAL_PG_DSN`; PostgreSQL17 nativo cuando la variable
  apunta al servidor Unix aislado permitido por `local-postgres-harness.mjs`.
- `node tests/integration/alpha75-workshop-milestones.test.mjs`: Chromium y PostgreSQL17
  nativo. El navegador solo puede alcanzar el servidor HTTP local del fixture.

La suite SQL carga la migración completa
`20261113171227_alpha75_botones_hitos_taller.sql`, con sus anclas comprobadas, sobre
el runtime sintético existente y las migraciones operativas anteriores. Comprueba
que instalarla no cambia los hechos históricos ni las barreras de sincronización
del fixture. Cada confirmación posterior ejecuta el RPC público y los triggers
de la base, dentro de una transacción real.

## Evidencia cubierta

Se comprueban las tres confirmaciones independientes, la hora del servidor,
la conservación exacta de las fechas anteriores y el estado de la ficha. El fin
del trabajo mantiene la T en curso hasta la recogida. La siguiente T se informa
según su orden manual y permanece pendiente; el sustituto sigue ocupado hasta
una confirmación de recuperación separada. Los trabajos, documentos, grupos y
posiciones previos se comparan completos. También se prueban los rechazos por
versión, secuencia de hechos, fechas incoherentes, autorización, ficha histórica,
T anulada y modelo legacy, y el bloqueo de la ruta rápida genérica en una entrada
del modelo por hitos.

La prueba de navegador usa los controles y la tarjeta reales de Alpha75. La
primera pulsación arma el botón; solo la segunda llama al RPC. Las tres acciones
actualizan la misma tarjeta y muestran el siguiente hito sin recargar la app.
Un cambio concurrente se muestra como conflicto y no registra una fecha.
La pérdida inducida del cuerpo HTTP después del commit se resuelve leyendo el
hecho guardado: aparece el siguiente hito y se actualiza la misma cabecera sin
repetir la mutación ni alterar documentos o la T de recuperación.

## Límite de MANTENIMENT y otros dobles

`fixtures/workshop-runtime.sql` contiene la definición genérica del trigger
`manteniment_fechas_desde_etapa` inspeccionada el 13/11/2026, con MD5 previo
`44beb99baf31bfedddb7fc99453a34cb`, y el resolvedor real `manteniment_etapa_actual`
ya capturado en los fixtures existentes. No contiene filas ni identificadores
operativos. La candidata modifica la rama de hitos del trigger real para aceptar
los alias de entrada. Los trabajos, visitas y paradas son tablas locales
sintéticas: se verifica `terminado → fecha_realizada` y después
`recogido → fecha_recogida`, sin anticipar esta última.

Solo `manteniment_encolar_parada` se sustituye por un registro local de intención.
Las pruebas acreditan la propagación de fechas y que se alcanza esa llamada;
no acreditan transporte, entrega, ACK ni escritura en MANTENIMENT o Google Sheets.
Auth, dispositivo, rol y auditoría mantienen los dobles declarados del harness.
Por tanto los rechazos cubren las ramas del RPC y sus privilegios SQL, no una
sesión real de Supabase Auth/RLS.

Las suites anteriores de navegador conservan su runtime congelado. El servidor
de pruebas les instala únicamente el bloque real de lectura de contexto de la
candidata; así sus controles nuevos obtienen modelo y T de SQL sin cambiar las
reglas de recuperación que ya estaban bajo prueba.
