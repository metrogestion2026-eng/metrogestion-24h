# SINCRO 14 · Cierre de incidencias ID_FILA y endurecimiento candidato (20/11/2026)

## Fuente y alcance
Libro auténtico MANTENIMIENTOS, pestaña MANTENIMENT, columna **T = ID_FILA**, y pestaña oculta REGISTRO_FILAS. Norma MG75-ID-FILA-001 de la Biblia: T identifica una línea, **jamás** su número físico de fila; los IDs eliminados o reservados no se reutilizan. El usuario no pega/copía columnas R:T.

## Corrección REAL aplicada a Google Sheets
Se habían localizado 17 T repetidas en las líneas de R1597, usadas ya por R1595, y una ITV de R1194 sin T. Se verificó la identidad por vehículo, tipo de actuación, valor T y registro técnico antes de cambiar exclusivamente T. R1595 conservó los 17 IDs originales; R1597 recibió 6985–7001, sin modificar el 6983 válido de ARCHIVO; la ITV de R1194 recibió 6984. En REGISTRO_FILAS se añadieron las 18 altas con su razón literal y se elevó ULTIMO_ID_EMITIDO de 6983 a 7001.

Auditoría completa POSTERIOR: **6.773** filas con T literal positivo único; **cero vacías, cero repetidas, cero inválidas, cero ajenas al registro, cero ACTIVA ausentes y cero BORRADA reaparecidas**. REGISTRO_FILAS: **7.001** IDs registrados, **6.773 ACTIVA y 228 BORRADA**, sin duplicados. Ningún dato A:S, nota, fecha, TANCAMENT ni Pizarra se modificó en esta reparación.

## Protección de rango real
El 20/11/2026 se añadió protección nativa restrictiva a MANTENIMENT T2:T (protectedRangeId **1702467621**). Esta protección no es de advertencia. **Límite importante:** al instalarse quedó upcpract@gmail.com como editor permitido y el propietario upcnocturno@gmail.com siempre puede editar según Google; por ello NO se puede afirmar «T solo lectura absoluta para Metro» ni dar esta barrera por cerrada. El código del activador técnico debe correr bajo un principal autorizado ANTES de restringir al operador; modificar ahora la lista de editores sin conocer la cuenta creadora del activador podría dejar todas las filas nuevas sin ID. Google no permite excluir al propietario de un rango protegido.

## Cambios de CÓDIGO CANDIDATO, NO INSTALADOS
Rama `sincro13-recibo-t-positivo-20261118`, PR #133 OPEN/DRAFT/UNMERGED. Se ha endurecido `r1-alpha75/google-apps-script/sincronizar_manteniment.gs` sin cambiar el protocolo SINCRO 13:
- `metrogestionAuditarIdentidadFilas_`: fotografía solo lectura de T literal, unicidad, registro, estados y contador; rechaza fórmulas, texto, repetición, BORRADA, IDs desconocidos y contador retrocedido.
- `metrogestionVerificarIdentidadFilas`: **ya no reconcilia ni asigna**, solo muestra informe.
- `metrogestionReconciliarIdentidadFilas_`: doble lectura bajo DocumentLock; `INSERT_ROW` y `EDICION_FILA_NUEVA` pueden crear T, pero **NUNCA declaran bajas**. Solo `REMOVE_ROW` puede marcar ausentes BORRADA después de comprobar la fotografía. Cambio mezclado o identidad incierta = detener, sin reintento automático.
- `metrogestionIdentidadFilasEdicion`: detecta una fila nueva con A:S y T vacía después de un evento de inserción perdido; edición directa de T crea bloqueo técnico, no presume autor.
- `metrogestionVigilarIdentidadSoloLectura`: alarma lectora cada 15 min sin cambios de hoja; el instalador reemplaza solo los activadores propios de identidad, no otros.
- La asignación nueva consume contador antes de usar el ID y guarda RESERVADA si se corta a mitad; nunca reutilizar ese número.

## CI y límites
Commit GitHub **5f41047af85af0f64dcd374bc19543d46f64f5f2**: GitHub Actions seguridad run 44760281448 **SUCCESS (397/397 pruebas, 0 fallos)** y native-integration **SUCCESS**; PostgreSQL17 laboratorio run 44760281421 **SUCCESS**. Se añadieron nueve tests de identidad, incluso duplicados, onChange perdido, edición directa T y lecturas sin escritura. Estas pruebas son sintéticas: no acreditan funcionamiento de un trigger Google real ni instalación de la candidata.

### Puerta técnica todavía necesaria antes de declarar «nada pendiente»
1. Cotejar el código y los triggers verdaderamente instalados en Google Apps Script, y el usuario que los creó. El conector Google Drive NO permite consultar ni desplegar Apps Script, por lo que no está acreditado que la versión de GitHub funcione en el proyecto real.
2. Instalar versión S14 desde una cuenta técnica autorizada, ejecutar prueba controlada de insertar fila y editarla, incluyendo rango protegido, y comprobar ID nuevo en T y REGISTRO_FILAS sin borrar registro de otra T. No sustituir sin comparación el proyecto Apps Script vivo, que gestiona otros trabajos.
3. Restringir T al usuario técnico real tras verificar que el trigger puede escribir. El propietario del libro es excepción irrenunciable de Google Sheets. Quien opere desde la cuenta propietaria no queda jurídicamente en solo lectura por esta protección.
4. Ensayar interrupción/duplicación y verificar la alerta, mientras SINCRO global permanece cerrada y Alpha 75 no validada.

**No declarar cerrado el control preventivo hasta superar la prueba instalada.** No modificar R1515, V1, F2, TANCAMENT ni datos operativos por el desarrollo en GitHub.