# METROGES · SINCRO 11 · Guardia de conflictos futuros (16/11/2026)

**CANDIDATA DE LABORATORIO — NO INSTALAR, FUSIONAR NI EJECUTAR EN PRODUCCIÓN.**

## Qué se ha hecho

Se añade el módulo puro `shared/sincro11-guardia-conflictos.mjs` que recibe un informe **F2 de solo lectura** (`metroSincro11F2Comparar`) y un conjunto de **propuestas** de prueba y devuelve un listado de motivos de retención. El módulo no posee conexiones ni permisos. No escribe, no crea T o PA, no convierte PR provisionales, no modifica fechas ni fórmulas.

**Identidad exclusiva: valor de columna T = ID_FILA.** PA, PR, DFM, UUID, orden físico y fechas I/J/K son información contextual: nunca se usan como identidad de una fila. Si una propuesta carece de T, se retiene; jamás se empareja por PA o DFM. Si una T difiere en MANTENIMENT, se retiene cualquier propuesta remota hasta un cotejo con el operador. No se atribuye autor humano a un cambio por el hecho de haberlo observado.

Las referencias de F2 son fotografías de hashes; no garantizan captar ediciones intermedias revertidas. Un informe parcial, una referencia ausente, cifras inconsistentes o múltiples propuestas para la misma T impiden usarlo como prueba de identidad. **Incluso sin diferencias el resultado siempre es RETENER_SIN_ESCRIBIR** hasta obtener nueva lectura, pruebas completas, decisión manual y autorización real separada. Ningún resultado concede permiso automático.

## Resultado de pruebas

`node --test tests/security-sincro11-base-futuro.test.mjs tests/security-sincro11-futuro.test.mjs tests/security-sincro11-f2-checkpoint.test.mjs tests/security-sincro11-guardia-conflictos.test.mjs`

**115/115 pruebas locales correctas**: 79 del trabajo anterior (V1 + detector futuro + F2) y **36 nuevas** de la guardia. Incluyen 6.742 filas sintéticas, TANCAMENT editado después del corte, identidad T fija, PR/PA, conflictos, duplicidades, código con datos privados (nunca incluidos en la respuesta) y rechazo de reportes inconsistentes.

## Situación real

- V1 sellada el 16/11/2026 a las 06:30:25: **no se modifica ni se vuelve a sellar**.
- F2: candidato no instalado; no tiene referencia creada todavía, por lo que **no hay intercambios reales**.
- Guardia: código puro y aislado; **no tiene consumidor, conector, fuente autenticada ni efecto operativo**.
- MANTENIMENT, TANCAMENT, PISSARRA, Supabase y Apps Script real: **sin escrituras por este trabajo**.

La siguiente fase deberá acreditar cómo llegan las propuestas del servidor con su `ID_FILA` correcto y cómo se valida que una modificación local es manual antes de una sincronización futura. No basta con poner el código en Apps Script: esto **no es el sincronizador definitivo**.

Revisión en rama separada: <https://github.com/metrogestion2026-eng/metrogestion-24h/pull/132>.