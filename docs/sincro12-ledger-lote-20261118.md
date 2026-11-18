# SINCRO 12 · Registro duradero de lotes en PostgreSQL 17 (laboratorio)

**18/11/2026 · CANDIDATA DE PRUEBAS. NO FUSIONAR, INSTALAR NI ABRIR ESCRITURA.**

## Punto de partida normativo
Biblia / SYNC-001: https://docs.google.com/document/d/1fDaBwYiYh_o2uHV4qwMCOxX0Otqw4vtkWszEx-pptkE
Bitácora común: https://docs.google.com/document/d/1jwqM3rPzD0FyvN0GvCRj4Ht3r5u0CrtZoFFM480W50s
Diccionario: https://docs.google.com/document/d/1CNaBqGxo4VDvNjNrzJt3yChM5ffS69MBdRDKS40nh_o

**ID_FILA = valor de la columna T, nunca posición física ni fórmula, PA/PR/DFM, fecha o UUID compartido.** Solo hechos genuinamente nuevos desde el 16/11/2026, aunque afecten a T antiguas. El dato manual acreditado prevalece por campo/objeto/significado. No abrir retro-sincro de 2552/2712/2746 ni tocar R1515. V1 sellada el 16/11/2026 a las 06:30:25 intacta; F2 no instalada.

## Alcance exacto

Se preparó un laboratorio PostgreSQL 17 en una base efímera cuyo nombre debe ser exactamente sincro11_lab. El script de preparación rechaza cualquier otro nombre antes de crear objetos. Solo utiliza un esquema descartable llamado s12_lab y sesiones, UUID, T, huellas y lotes **inventados**. La prueba no contiene acceso de red, Google ni credenciales operativas; no se conecta al Supabase real. El workflow tiene limpieza obligatoria, y verifica desaparición del esquema.

Archivos implementados:
- sql/sincro12_lote_durable_setup_20261118.sql
- sql/sincro12_lote_durable_teardown_20261118.sql
- tests/integration-sincro12-lote-durable.pg.test.mjs
- tests/security-sincro12-lote-durable.test.mjs
- .github/workflows/sincro12-lote-durable-lab.yml

El ensayo crea un registro relacional de identidades T, vínculos T/columna/objeto, lotes, eventos por campo, sesiones ficticias, lecturas de hoja, revisiones de destino y recibos únicos. El sello del lote vincula SHA-256 del conjunto completo de eventos, actor/sesión/nonce de prueba y la acción aprobada. El recibo es idempotente ante reintento idéntico y rechaza un reintento con payload diferente; un trigger impide UPDATE/DELETE del recibo y cambios de eventos tras sellar.

Se admiten en esta PR **solo** dos categorías de ensayo:
1. CONTROLADO_LAB: supuesto editor controlado, SIN autenticación real del origen.
2. ADOPTAR_ACTUAL_LAB: aprobación explícita simulada del valor actual, que NO acredita quién editó la celda antes; NO equivale a autorizar un histórico descubierto por F2 u onEdit.

Una consulta posterior comprueba T+campo+revisión+huella contra una lectura posterior al sello, y comprueba el campo concreto del destino, sin ninguna UPDATE real de destino. Incluso cuando todo encaja el resultado sigue siendo CANDIDATO_LAB_NO_AUTORIZADO y autoriza_sincronizar=false. Si la hoja ha cambiado, el resultado es HOJA_NO_RELEIDA_O_CAMBIADA; si el destino ya coincide, DESTINO_YA_COINCIDE.

**Limitación semántica intencionada:** únicamente TRABAJO/K (recogida real en taller) se ensaya contra fecha_recogida de un objeto de trabajo ficticio acreditado por vínculo explícito. TRABAJO/J no se asocia a fecha_realizada por semejanza de nombre; PARADA/J/K no son fechas de taller. Ninguna regla se infiere de la posición física, PA, DFM o nota UUID.

## Comprobación real de seguridad (18/11)

El SELECT en Supabase metrogestion-pruebas confirmó:
- mg9_filas_identidad = 0.
- mg9_cambios_recibidos = 0.
- mg9_entregas_registradas = 0.

Por tanto, NO existe aún un mapa positivo T→objeto en esas tablas ni un receptor productivo de esta vía. La prueba NO pobló esas tablas. No se alteraron MANTENIMENT, TANCAMENT, PISSARRA, Apps Script, activadores, base V1 ni datos operativos Supabase.

## Resultado de GitHub Actions

La primera ejecución de laboratorio 44263299932 creó con éxito las tablas ficticias y ejecutó los 8 controles estáticos, pero fallaron las pruebas de integración por un nombre de constante LOT frente a LOTE en el archivo Node. **No fue un fallo de datos o de autenticación**; la limpieza del esquema al fallar quedó confirmada.

Tras la corrección, run 44263501640:
- 8/8 controles estáticos SUCCESS.
- 19/19 pruebas con PostgreSQL 17 y procesos psql independientes SUCCESS.
- Confirmado un recibo único y reintento idempotente entre dos conexiones reales, rechazo de cambio de payload, nonce reutilizado, sesiones ficticias AAL1/revocadas, T sin vínculo, T excluidas, fecha anterior al corte y J sin mapeo.
- Confirmado que K cambiada después de la aprobación queda retenida sin alterar otra T.
- Confirmado DROP SCHEMA s12_lab y ausencia de residuos.

Run 44263501836 del receptor CAS anterior, también PostgreSQL aislado: SUCCESS. La batería general de seguridad/integración de la PR debe comprobarse por separado antes de darla por cerrada.

## Próximo trabajo sin reinicio

Conectar **en diseño** el origen nuevo de corrección con un servicio auténtico de captura y autorización, sin desplegarlo. Para la edición manual directa de Metro en TANCAMENT, no fingir autoría mediante onEdit; estudiar una aprobación expresa de un lote limitado y seleccionado, compatible con su trabajo sin pedir validaciones repetitivas. El futuro receptor debe validar de nuevo vínculo T→objeto, campo, versión base, huella vigente y nonce en la MISMA transacción y registrar un ACK inequívoco. Los avances de laboratorio nunca se confunden con instalación real.

**PR #132 debe seguir OPEN/DRAFT, no fusionada. Biblia, Bitácora y Diccionario son fuente de continuidad al cambiar de chat.**
