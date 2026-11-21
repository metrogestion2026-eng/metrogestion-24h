# SINCRO 11 · Auditoría Pizarra 20→21 y preflight de concurrencia · 21/11/2026

**Contrato:** contrastados Biblia, Bitácora, Diccionario y código de las dos funciones existentes `app_private.crear_pizarra_diaria` y `crear_pizarra_diaria_sin_situacion_alpha75`. Solo SELECT y `pg_get_functiondef` en `metrogestion-pruebas`. Ni esta auditoría ni su código de laboratorio escriben Pizarras operativas o documentos del usuario.

## Lecturas verificadas
- La Pizarra 20/11 está `archivada`: 22 fichas (21 visibles), 70 etapas (68 vigentes) y 60 trabajos (57 vigentes). La del 21/11 está `en_curso`: 21 fichas (20 visibles), 67 etapas (66 vigentes), 54 trabajos (51 vigentes).
- **21/22 fichas** de origen conservan seguimiento; **R1532** no pasa, ya retirada el día 20. **0 desapariciones injustificadas**.
- **67/67 etapas** de las fichas continuadas conservan identidad de seguimiento, ficha y grupo documental. **67/67 mantienen el recuento total y activo de trabajos**. No confundir igualdad de recuento con igualdad exhaustiva de contenido ni atribuir autor.
- R1194 cambia una etapa de `en_curso` a `realizada` y ya aparece retirada el día 21; no revertir ni interpretar sin evento de edición acreditado. R1515 conserva el estado y el lugar vistos el día 20; 2633 no reaparece.
- Catálogo documental por grupos presentes: **51→33**. Los **18** documentos de los tres grupos de R1532 retirada dejaron de estar asociados a una ficha del día 21, pero **18/18 siguen en `documentos_gestion` y `storage.objects`**. No se ha ensayado acceso desde la UI. No son documentos borrados.
- Auditoría SELECT de todas las transiciones 15→21: **8 salidas registradas**, todas con retirada/cancelación acreditada en la Pizarra de origen, **0 salidas injustificadas**. No confundir las 24 entradas iniciales (23 fichas + reserva) con el grupo operativo de 23.

## Hallazgo nuevo de ingeniería
El código real comprueba con `SELECT` si la fecha existe antes de insertar; **no contiene bloqueo transaccional por fecha**. `public.pizarras` tiene `UNIQUE(fecha)`, de modo que una carrera podría arrojar `unique_violation` en una llamada, aunque la restricción evite dos filas fechadas iguales. `registros_hotel` solo tiene PK física, sin `UNIQUE(pizarra_id,seguimiento_id)` general. **No se ha ejecutado la función real en dos sesiones**.

Además, `crear_pizarra_diaria_sin_situacion_alpha75` cambia `hotel_edicion_piloto.observaciones` de las fichas de origen a «Histórico editable» con `ON CONFLICT DO UPDATE`. Existe riesgo de reemplazar una nota piloto anterior; no afirmar daño real sin conocer su uso.

## Trabajo local nuevo, sin instalar
Preparado el paquete **METROGES_SINCRO11_ROLLOVER_CARRERA_20261121_LAB.zip** (SHA256 `c47390ea28615591cc73f78889f02de4cbe340a506c70b90e40faeb4e48a19ae`): SQL `SELECT` reproducible, fixture ficticio PG17 `s11_roll`, dos funciones de LAB (patrón sin lock y candidata con advisory lock y relectura), prueba con dos procesos `psql`, verificación de continuidad de fichas/etapas/trabajos/notas/grupos y teardown exclusivo de `sincro11_lab`. **6/6 controles estáticos Node superados localmente**. **Las pruebas PostgreSQL reales no están ejecutadas aún** en este trabajo; nunca computarlas como PASS antes de CI. La subida adicional a Biblioteca resultó denegada (AccessDeny), por lo que el paquete se conserva como artefacto local descargable.

**Límites:** candidato no integrado en repositorio ni ejecución real de carrera; no confundir prueba de patrón con validación del procedimiento productivo completo y sus triggers. No activar ni modificar V1 sellada 16/11 06:30:25, F2, sincronización, credenciales, activadores, MANTENIMENT, TANCAMENT, RESERVAS, R1515 o Pizarras de producción. PR #132 en DRAFT. El próximo ensayo debe utilizar PG17 efímero y eliminar su esquema de prueba antes de recomendar una corrección de la función real.
