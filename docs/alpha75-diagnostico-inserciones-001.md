# Alpha75 · diagnóstico de fórmulas según la posición de inserción

Fecha: 1 de noviembre de 2026. Complemento de
[la nota del ejecutor](alpha75-ejecutor-cliente-001.md).

## Resultado y alcance

La candidata distingue entre una referencia que realmente cambiaría al insertar
y una referencia entre filas cuya expresión R1C1 se conservaría. El comprobador
recibe las operaciones `insertRowAfter` del plan en su orden real; un booleano
no permite establecer esa distinción.

**El diagnóstico no habilita una inserción retenida por el comprobador anterior.**
Se mantiene esa retención aunque todas las fórmulas originales leídas de A:Q
resulten invariantes. El mensaje explica entonces que falta cobertura estructural
fuera de esa fotografía, sin afirmar incorrectamente que la referencia se va a
alterar. Los planes que ya superaban el comprobador conservan ese recorrido;
una sintaxis desconocida o una reescritura no modelada pueden añadir un rechazo
concreto antes de autorizar o escribir.

La función pura y reutilizable es:

```javascript
const diagnostico = metrogestionDiagnosticarInsercionesOrden_(
  fotografia,
  operacionesEnMemoria
);
```

No abre hojas, no llama a Drive o HTTP, no pide autorización, no crea un journal
y no escribe datos. Trabaja con la fotografía y las operaciones recibidas. El
resultado declara siempre `cobertura_estructural_completa: false` y
`habilita_ejecucion: false`. Cuando el plan completo supera sus comprobaciones,
incluye este diagnóstico en su huella como evidencia, no como permiso.

## Qué se demuestra con las posiciones

Cada corte se expresa en las coordenadas existentes **en ese paso** del plan.
Al insertar después de la fila `k`, una fila existente `r` pasa a `r + 1` sólo
si `r > k`. La composición secuencial de esos desplazamientos define `M(r)`.

Para una fórmula original situada en `s` que referencia una fila `t`:

| Referencia | Condición para conservar la expresión R1C1 |
| --- | --- |
| Relativa, misma hoja | `M(t) - M(s) === t - s` |
| Absoluta, misma hoja | `M(t) === t` |
| Relativa, otra hoja | `t - M(s) === t - s`; la inserción local no desplaza `t` |
| Absoluta, otra hoja | El índice absoluto permanece igual; no acredita los datos de esa otra hoja |

Dos celdas situadas antes del corte pueden mantener su referencia. También
pueden hacerlo dos celdas que se desplazan juntas. Una inserción entre ambas
puede cambiar la expresión R1C1 y exige una reescritura que el adaptador actual
no modela. No se utiliza una fila de inserción fija ni un vehículo operativo en
estas reglas o sus pruebas.

Los rangos explícitos se revisan por ambos extremos y deben estar dentro de
la fotografía local. Una expresión con extremo absoluto en cabecera y extremo
relativo en la fila actual puede conservar su texto aunque el rango incorpore
una fila nueva. **Texto R1C1 invariante no significa mismas celdas incluidas ni
mismos resultados calculados.** Tampoco valida los datos que se escribirían en
la nueva fila.

## Gramática cerrada

El analizador consume la expresión completa. Admite referencias R1C1 explícitas,
calificadores de hoja simples o entre comillas, literales, operadores y un
subconjunto declarado de funciones comunes. Las cadenas de texto y los
apóstrofos escapados en nombres de hoja no se buscan como referencias sueltas.

Se rechazan, entre otros, `INDIRECT`, `OFFSET`, funciones desconocidas, rangos
con nombre, referencias parciales, índices inválidos, rangos abiertos, rangos
de columnas o filas completas, rangos de otra hoja y destinos locales fuera
de A:Q o de las filas fotografiadas. La restricción preexistente de fórmulas
matriciales e importaciones de A:Q se conserva, también sin inserción.

El analizador no pretende ejecutar el lenguaje completo de Google Sheets. Una
fórmula válida para Google pero fuera de ese subconjunto requiere revisión;
no se acepta por no haber encontrado referencias con una expresión regular.

## Límites estructurales que siguen pendientes

- La lectura del ejecutor sigue limitada a A:Q hasta la última fila con datos.
  El diagnóstico no lee R:Z, otras pestañas, protecciones, formatos condicionales,
  rangos con nombre ni validaciones fuera del rectángulo fotografiado.
- No simula las fórmulas que se copian o crean durante el plan. Las fórmulas
  originales invariantes no sustituyen la validación completa de la fila nueva.
- Las validaciones con rangos o fórmulas personalizadas se señalan como no
  modeladas. El serializador anterior de criterios de rango conserva su A1,
  pero no identifica la hoja de ese rango; no basta para demostrar su traslado.
- El informe compara las anclas del filtro desplazadas por las inserciones con
  el rango que reconstruiría el restaurador actual. Puede detectar diferencias:
  por ejemplo, un filtro preparado hasta la última fila disponible puede perder
  esa última fila al reconstruirse con la longitud anterior. Esta fase expone
  el desfase, sin cambiar la política de restauración ni afirmar equivalencia
  con todos los comportamientos nativos de Google.
- Los criterios del filtro que usan fórmulas o rangos se marcan igualmente como
  no modelados. Su contenido no se reescribe por aproximación.
- La identidad de la orden, sus fechas y la procedencia manual de sus datos
  pertenecen a comprobaciones distintas. Este diagnóstico no las acredita.

## Evidencia sintética

`tests/alpha75-insertion-formula-diagnostic.test.mjs` ejecuta el GS distribuido y
el adaptador real de planificación sobre la plataforma sintética. Cubre cortes
antes, después y entre referencias; cortes secuenciales; referencias absolutas
y de otras hojas; sintaxis no cubierta; matrices; filtros y validaciones.

Un oráculo independiente desplaza identidades de filas en un array y comprueba
448 combinaciones pequeñas de origen, destino y corte. Otro caso recorre el
ejecutor completo: una referencia original invariante que el gate histórico
retenía sigue deteniéndose antes de HTTP, journal y efectos en hoja o Drive.
Los casos positivos previos del ejecutor permanecen en sus suites originales.

En Node 24 de este entorno, el recuento de casos individuales se obtiene con:

```bash
node --test --test-isolation=none --test-reporter=spec tests/alpha75-insertion-formula-diagnostic.test.mjs
```

Esta evidencia es local y sintética. No constituye una ejecución de una orden
operativa, una validación de todo el libro ni un despliegue en Apps Script.
