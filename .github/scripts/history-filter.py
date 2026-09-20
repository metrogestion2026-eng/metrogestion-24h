import re
import hashlib
from pathlib import PurePosixPath
RETIRED = {'index.html','activar-24h.html','beta-1-8-prueba.html','beta-1-9-prueba.html','beta-1-9-1.html','metrogestion-2-0.html','v39-tablet.html','v39-preview/index.html','v39-preview/metrogestion-2-0.html','v39-login/index.html','v39-mobile/index.html'}
NOTICE = b"-- Correccion puntual de datos excluida del repositorio publico.\n"
DATA_ONLY = {'20260911123500_alpha74_limpiar_24h_2552_2625.sql','20260911124000_alpha74_completar_limpieza_24h_2625.sql','20260911125000_alpha74_normalizar_recuperacion_24h_2552.sql'}
CUT = {
'20260905064733_alpha72_cierre_automatico_pendientes_reserva.sql': '-- Corrección validada del caso histórico',
'20260905200000_alpha73_bloqueo_identidad_ficha.sql': '-- Corrección de datos localizada y auditable.',
'20260911113000_alpha74_evitar_t_infinitas_2523.sql': '-- Reparación dirigida de la parada',
'20260912110000_liberar_reserva_al_anular_y_reactivar_pa2600152.sql': 'do $repair$'
}
PLATE = re.compile(rb'(?<![A-Z0-9])R?[0-9]{4}[ -]?[BCDFGHJKLMNPRSTVWXYZ]{3}(?![A-Z0-9])')
def transform(path,data):
    if path.startswith(('docs/repairs/','supabase/repairs/')) or path in {'tests/alpha76-agrupacion-manteniment.sql','tests/alpha75-cierre-necesidades-t-actual.sql','tests/alpha75-identidad-visita-por-lugar.sql','Manual_24H_DFM_v2_1.pdf'}:
        return None
    if path in RETIRED:
        link='../'*(len(PurePosixPath(path).parts)-1)+'r1-alpha76/'
        return ('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>Metrogestión · Versión retirada</title><h1>Esta versión ha sido retirada</h1><p><a href="'+link+'">Abrir Metrogestión actualizada</a></p></html>').encode()
    name=PurePosixPath(path).name
    if path.startswith('supabase/migrations/'):
        if name in DATA_ONLY: return NOTICE
        marker=CUT.get(name)
        if marker and marker.encode() in data:
            prefix=data.split(marker.encode())[0]
            return prefix+NOTICE+(b'\ncommit;\n' if data.lstrip().lower().startswith(b'begin;') else b'')
        if name in ('20260911124500_alpha74_reconocer_averia_24h_acentuada.sql','20260911130000_alpha74_av24h_hacia_manteniment.sql'):
            blocks=list(re.finditer(rb'do \$do\$.*?\$do\$;',data,re.S|re.I))
            for m in reversed(blocks):
                if b"= '2625'" in m.group(): data=data[:m.start()]+NOTICE+data[m.end():]
        return data
    if path.endswith(('.js','.mjs','.md','.json','.html','.gs','.sql','.txt')):
        # Use stable fictitious strings in examples and fixtures, preserving equality.
        data=PLATE.sub(lambda m:b'TEST-'+hashlib.sha256(m.group()).hexdigest()[:8].encode(), data)
        if path.startswith('validaciones/'):
            data=re.sub(rb'\bR[0-9]{3,5}\b',b'RESERVA-DE-EJEMPLO',data)
    return data

new_data=transform(filename.decode(), value.get_contents_by_identifier(blob_id))
if new_data is None:
    return (None, mode, blob_id)
new_id=value.insert_file_with_contents(new_data)
return (filename, mode, new_id)
