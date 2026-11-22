# METROGES · SINCRO 12 · Inventario real y adaptador de diagnóstico solo lectura
**18/11/2026 · PR #132, candidata no instalada. Sin escribir en hojas ni en Supabase.**

## Relevo normativo
Fuentes: [Biblia SYNC-001](https://docs.google.com/document/d/1fDaBwYiYh_o2uHV4qwMCOxX0Otqw4vtkWszEx-pptkE), [Bitácora](https://docs.google.com/document/d/1jwqM3rPzD0FyvN0GvCRj4Ht3r5u0CrtZoFFM480W50s) y [Diccionario](https://docs.google.com/document/d/1CNaBqGxo4VDvNjNrzJt3yChM5ffS69MBdRDKS40nh_o).

La identidad de cada línea es **solo el valor de columna T / ID_FILA**. Nunca posiciones, referencias A1, DFM, PR, PA, fechas, fórmulas ni notas UUID compartidas. Solo actuaciones realmente nuevas desde el **16/11/2026** (corte anterior 15/11); ninguna lectura convierte un histórico en corrección nueva. La corrección manual acreditada debe prevalecer por T+campo+significado. No modificar R1515, no reseñar ni resellar V1 (sellada el 16/11 a las 06:30:25), no instalar F2 ni cambiar TANCAMENT o PISSARRA.

## Lectura contrastada hoy en el libro de Google
Libro nativo **MANTENIMIENTOS**; ID `1PQE5VsjTvDFvQZcqedyQKIs3RbSySHFK4JPQXBD0XyU`; zona `Europe/Madrid`. Pestañas verificadas por metadatos, sin modificar ninguna:

- **MANTENIMENT**, sheetId 1211148219: `T1 = ID_FILA`. Es el identificador de valor, no el número de la fila física.
- **REGISTRO_FILAS**, sheetId 2077110101, oculta: columnas `ID_FILA`, `ESTADO`, `FECHA_ASIGNACION`, `FECHA_ELIMINACION`, `OBSERVACION`. Control `G2:H2`: `ULTIMO_ID_EMITIDO = 6969` en la fotografía.
- Pequeña lectura acotada de registros al final: ID 6968 figuraba `ACTIVA`, asignada 17/11; ID 6969 figuraba `BORRADA`, fecha 18/11, observación de ausencia detectada. La fotografía **no prueba quién la modificó**, ni equivale a un evento manual o a un enlace de trabajo. La marca `INSERT_ROW` es un motivo técnico de asignación, no prueba de una persona.
- No se han leído todas las filas ni ampliado el registro a una base de sincronización. No se ha añadido ninguna fórmula.

**Descubrimiento práctico:** la pestaña de control de identidades confirma un historial técnico de altas/bajas, pero **no contiene el campo del objeto Metroges ni la autoría de cada corrección**. Nunca asignar un trabajo usando el contador `ULTIMO_ID_EMITIDO`, ni inferir que el número 6969 es la siguiente T reutilizable: en la fotografía figuraba borrada.

## Consulta real de Supabase, solo SELECT
Se añadió y ejecutó en **metrogestion-pruebas**, no producción:
`sql/sincro12_diagnostico_capacidades_solo_lectura_20261118.sql`

Resultado agregado contrastado el 18/11:
| Comprobación | Resultado | Límite |
| --- | ---: | --- |
| Filas T registradas en staging mg9 | 0 | No hay puente T→objeto acreditado en estas tablas |
| Identidades con estado `ACREDITADA` | 0 | No usar H/DFM/PA/UUID como sustituto |
| Cambios recibidos / entregas registradas | 0 / 0 | No se acredita un evento manual |
| Trabajos de mantenimiento catalogados | 318 | Estar en catálogo no vincula una T |
| Cuentas activas con permiso `sincro12_confirmar_lote` | 0 | No conceder permiso por defecto |
| Campos de auth.sessions, usuarios, dispositivos, staging | Presentes | Existencia de columnas no prueba identidad de sesión |
| Campo `fecha_recogida` del trabajo | Presente | TRABAJO/K solo equivalencia semántica plausible, sin vínculo |
| Outbox de parada con `id_fila` y `columna` juntas | **NO** | No puede invalidar órdenes obsoletas por T+campo con su estructura actual |
| Autoriza sincronizar | **NO** | El propio SELECT devuelve `false` |

La consulta devuelve únicamente recuentos y presencia estructural, sin nombres, valores privados o identificadores de usuarios. No realiza SQL de escritura.

## Código añadido de alcance controlado
`shared/sincro12-adaptador-readonly-diagnostico.mjs`

El adaptador define **puertos de lectura por inyección** (todavía no instalados): `hojas.leerMetadatos`, `hojas.leerRango` y `servidor.leerConsultaFija`. Ejecutaría *solo* las siguientes lecturas, en este orden y sin recorrer filas:
1. Metadatos del libro de Google con ID exacto.
2. `MANTENIMENT!T1:T1` para comprobar la etiqueta `ID_FILA`.
3. `REGISTRO_FILAS!A1:E1` para el contrato de cabeceras.
4. `REGISTRO_FILAS!G2:H2` para el contador, **no para identificar otra T ni capturar eventos**.
5. La consulta SQL anterior de capacidades, identificada por nombre fijo.

La entrada SQL debe ser un resultado ya normalizado del adaptador de servidor. Si faltan cabeceras, cambia el libro, la pestaña deja de ser la esperada o aparece un valor inesperado, devuelve `DIAGNOSTICO_INCOMPLETO`. Si todas las lecturas son coherentes, devuelve un conjunto de **motivos de bloqueo** y la clasificación `SINCRONIZACION_BLOQUEADA`, nunca un permiso.

Este módulo no implementa conexiones de red, tokens, métodos de escritura, administración de Apps Script ni receptores. **Todas** las salidas informan `autoriza_sincronizar=false`, `prueba_de_autor_de_edicion=false`, `acuse_de_T_objeto_real=false` y `escritura_google=false` / `escritura_supabase=false`. No devuelve filas privadas ni notas, solo contadores y razones.

Pruebas nuevas:
- `tests/security-sincro12-adaptador-readonly-diagnostico.test.mjs` (29 escenarios sintéticos: contrato literal, libro falso, pestaña oculta faltante, contador inválido, cambios de estructura, errores sanitizados, datos privados inesperados, no confundir contador con identidad y cerrojo sin escritura).
- `tests/security-sincro12-diagnostico-sql.test.mjs` (6 pruebas estáticas del SQL SELECT).

## Pendiente para operar (NO instalado)
No existe aún una relación T→trabajo acreditada, emisor duradero de autoría manual ni permiso para una confirmación real. El adaptador no es un sincronizador. El módulo anterior de autenticación por lote está solo en pruebas. La recepción productiva necesitaría un contrato exacto por T+campo+objeto, un origen verificable y una transacción CAS con idempotencia y revocación de propuesta obsoleta; **no permitir que un F2, un onEdit o una fecha de REGISTRO_FILAS se conviertan en autoría manual**.

**Continuidad:** PR #132 sigue DRAFT sin fusionar; en el próximo chat leer primero Biblia, Bitácora, Diccionario y este archivo. No pedir al operador repetir normas ni interrumpir su trabajo en TANCAMENT.

**Estado de CI de esta ampliación:** pendiente de verificar en los runs correspondientes al commit final, no anticipar pruebas antes de observar el log.
