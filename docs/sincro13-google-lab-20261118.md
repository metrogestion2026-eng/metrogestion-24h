# SINCRO 13 · Ensayo aislado de Google Sheets por T/ID_FILA

Fecha: 18/11/2026. **Sin instalación ni ejecución de SINCRO operativa.**

## Hoja nativa de prueba

Libro Google Sheets creado únicamente con datos inventados:
https://docs.google.com/spreadsheets/d/1QOA6D__GKWse6BRvPJE5m0wrOFhCgvA_i43b2Isc9KQ/edit

**No es copia de MANTENIMENT ni contiene vehículos, datos, facturas, fórmulas o enlaces de flota reales.** Las cabeceras de MANTENIMENT A:T y REGISTRO_FILAS A:H se contrastaron por lectura de la fuente, pero los registros son LAB-001, LAB-002 y LAB-003 con T 800001, 800002 y 800003. Dos notas E contienen UUID de test inequívocamente ficticios. REGISTRO_FILAS se marca oculta con origen ORDEN_AUTORIZADA para 800001/800003 e INSERT_ROW para 800002; estas etiquetas **son fixtures manuales y NO acreditan el Apps Script instalado**.

## Pruebas realizadas con API nativa y comprobación posterior

1. **Reordenación**: se movió la fila de LAB-001 desde la segunda hasta la cuarta posición usando moveDimension. La lectura posterior comprobó que T=800001 conservó su DFM y nota de prueba, 800002 siguió siendo PARADA y 800003 conservó su nota. La identidad no se derivó de la posición física.
2. **T duplicada**: en una celda T de la hoja sintética se cambió 800002 por 800003. La lectura detectó dos valores T=800003. Se restauró 800002 y se verificó que T2:T4 terminó como 800002, 800003, 800001.
3. **Nota de trabajo contradictoria**: en la celda E4 de LAB-001 se cambió momentáneamente la nota METROGESTION_T:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa por la nota del otro trabajo ficticio. La lectura detectó la discrepancia y después se restauró la nota original, verificada por la API.

Los cambios solo se hicieron en el archivo de laboratorio; MANTENIMENT, TANCAMENT, PISSARRA, V1, F2, R1515 y Supabase real quedaron sin alteraciones.

## Implementación nueva, candidata no desplegada

- `shared/sincro13-google-idfila-readback.mjs` compara dos fotografías suministradas del libro y su REGISTRO_FILAS exclusivamente por valor T, con notas de trabajos, clase y origen como contrastes. Devuelve retención ante duplicados de T en cualquiera de las fuentes, nota incoherente, clase PARADA, T ausente, baja, origen que no sea ORDEN_AUTORIZADA, R1515 o UUID compartido.
- `tests/security-sincro13-google-idfila-readback.test.mjs` ejercita los escenarios sintéticos, incluida la permutación de filas.
- Una coincidencia técnica conserva `persona_que_edito_acreditada=false`, `vinculo_t_objeto_real_acreditado=false` y `autoriza_sincronizar=false`. Ni la lectura de Google ni un origen manuscrito en REGISTRO_FILAS demuestran por sí mismos autoría, acto autorizado o procedencia genuina.

## Restricciones para un siguiente paso utilizable

La prueba no acredita concurrencia de un activador onChange con la asignación T, el emisor verdadero de Google, la firma autenticada de su observación, o una transacción productiva de vuelta por T/campo. El comprobador es puro y no llama por su cuenta a Google o Supabase. Se necesita un puente autenticado con relectura posterior y una prueba E2E controlada antes de desbloquear el receptor. Alpha75.26 no queda validada.

**PR #133 sigue OPEN/DRAFT: no fusionar ni desplegar ni activar nada.**
