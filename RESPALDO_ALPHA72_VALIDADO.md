# Respaldo único de Metrogestión Alpha72

Este punto conserva la versión **r1.0.0-alpha.72**, validada el 5 de septiembre de 2026.

- Código de origen fijado: `db172967868e14f7c3d1ee222c9bae4faef10d69`.
- Entrada de la aplicación: `r1-alpha72/index.html`.
- Rama exclusiva de respaldo: no se asigna a usuarios y no debe recibir actualizaciones ordinarias.
- `MANIFEST_ALPHA72_SHA256.txt` protege todos los archivos que Alpha72 necesita para ejecutarse.
- Los directorios con nombres Alpha anteriores son dependencias internas heredadas y congeladas; no representan respaldos adicionales.
- El cliente `@supabase/supabase-js` está fijado en la versión exacta `2.111.0`.

## Alcance

Este respaldo conserva el código de la aplicación. No contiene los datos, usuarios, sesiones ni la configuración almacenada en Supabase, por lo que no sustituye una copia de seguridad de la base de datos.

## Restauración

1. Descargar esta rama.
2. Verificar los archivos con `sha256sum -c MANIFEST_ALPHA72_SHA256.txt`.
3. Publicar la raíz del repositorio como web estática.
4. Abrir `/r1-alpha72/`.
5. Validar el estado de Supabase antes de volver a ponerla en servicio.

No fusionar esta rama con `main`. Su finalidad es únicamente recuperar Alpha72 si una publicación posterior quedara dañada.
