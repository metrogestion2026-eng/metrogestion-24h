# SINCRO 14 · Corrección del ID_FILA borrado por Deshacer
**21/11/2026 · HOTFIX basado en REV4, pendiente de instalar en Apps Script real**

## Causa identificada
Metro crea períodos de facturación copiando **solo A:Q**. Es el procedimiento correcto: no copia R/S ni T. Apps Script REV4 había emitido T/ID_FILA y marcado REGISTRO_FILAS como ACTIVA, pero al pulsar Deshacer Google podía borrar el valor T mientras permanecía el ID activo en el registro. El activador onEdit no recibe todas las operaciones de Deshacer ni escrituras por API, y el watchdog REV4 detectaba pero no recuperaba.

Episodio real: dos PARADA TANCAMENT 12 de 2718/PA-2600292 y 2553/PA-2600295 quedaron sin T. 7011/7012 ACTIVA sin presencia no pudieron asignarse por parecido; se retiraron como BORRADA no reutilizables. Se asignaron de modo controlado las nuevas **T7013 y T7014**, con anclas nativas de FILA `METROGES_S14_ID_FILA` que ya constan en Google, y H2 quedó 7014; auditoría completa posterior: 6.784 T únicas activas, 0 huecos, 0 duplicados, 0 huérfanos.

## Corrección preparada (REV4-HF-DESHACER)
Basada en los **5.005 renglones REV4 realmente instalada**, sin incorporar todavía el receptor de REV5.
- SHA256 de base REV4: `2f5203b937c8f8753b2197ca45104011eaf421a0c324e89063be4de79a2550af`.
- SHA256 del hotfix REV4 entregado: **pendiente de fijar del artefacto final**. El código y sus pruebas completas se entregaron al usuario en archivo ZIP + TXT en el chat del 21/11/2026.
- Mantiene 3 handlers `metrogestionIdentidadFilasCambio`, `metrogestionS14IdentidadEdicion`, `metrogestionS14VigilarSoloLectura` y **0 sincronización programada**.
- Antes de escribir una T nueva crea **DeveloperMetadata de FILA** con clave corta `s14`, valor de ID en base 36 y visibilidad DOCUMENT. Esta referencia sigue la fila al moverse; no depende de número de fila.
- Reconoce asimismo las dos anclas largas `METROGES_S14_ID_FILA` de T7013/T7014.
- Al detectar un agujero en T, solo restaura el **mismo** ID si `REGISTRO_FILAS` lo conserva ACTIVA, está ausente de toda T, existe una sola ancla de FILA válida y hay contenido operativo en A y H. Si hay conflicto, ID duplicado, ancla ausente o fila realmente eliminada, falla cerrado. Nunca infiere ID de DFM, PA o posición.
- Vigilancia existente cada 15 minutos intenta reparación conservadora si el evento onEdit/onChange no llegó. El nuevo menú `Metrogestión → Recuperar ID tras Deshacer` fuerza el cotejo y la recuperación inmediata.
- La primera activación exige censo limpio, los tres activadores ya instalados y anclas T7013/T7014 válidas si siguen presentes. Desbloquea solo una alarma antigua de identidad ya resuelta y habilita la restitución; no cambia las celdas.
- El tamaño de metadatos está limitado por Google a **30.000 caracteres por hoja**. Por ello se usa clave corta y se sellan las T nuevas, **no** se reescriben masivamente todas las filas históricas.

## Pruebas locales completas
En dobles sintéticos de Apps Script con fila móvil y DeveloperMetadata:
- REV4 con hotfix: **50 de 50 PASS**, sintaxis JS comprobada.
- REV5 candidata con el mismo hotfix, manteniendo además recibos T idempotentes: **67 de 67 PASS**, sintaxis JS comprobada.
- Casos: Deshacer tras copiar A:Q, readmisión por vigilancia, onEdit en T, edición posterior A:Q, dos ausentes, reordenación, ancla antigua, eliminación física, duplicados, ancla falsa o ausente, fallo al crear metadata que deja RESERVADA y bloquea, botón de recuperación y activación sin crear más triggers.
**No es una prueba REAL de Apps Script instalado**: hay que instalar hotfix REV4 en el editor vinculado bajo upcpract y hacer lectura real, activación y un siguiente Undo supervisado.

## Instalación por Metro
1. Guardar una copia del código principal REV4 visible hoy.
2. Reemplazarlo ENTERO por el TXT del hotfix REV4 (no usar REV5 todavía), guardar; no borrar el archivo aislado de diagnóstico.
3. Ejecutar `metrogestionVerificarIdentidadFilas` (solo lectura); debe indicar `correcto:true`.
4. Ejecutar una vez `metrogestionS14ActivarReparacionDeshacer`; debe registrar `S14-DESHACER ACTIVADO` y verificar los 3 triggers existentes, sin instalar nuevos.
5. Ejecutar `metrogestionS14RepararDeshacerAhora`; si no hay huecos `restauradas:0`.
6. Recargar MANTENIMIENTOS para ver `Metrogestión → Recuperar ID tras Deshacer`. Seguir copiando solo A:Q. Ante un nuevo Undo usar el menú si T no reaparece inmediatamente; enviar log de prueba real.

## Barreras conservadas
No tocar R/S/T manualmente; no modificar A:Q, Hotel, TANCAMENT ni R1515 para probar. No activar sincronización de seis horas, escritura automática ni el receptor S13 hasta concluir recorrido seguro Google→Hotel→K. Supabase pruebas sigue protegido, Alpha75 SIN VALIDAR.
