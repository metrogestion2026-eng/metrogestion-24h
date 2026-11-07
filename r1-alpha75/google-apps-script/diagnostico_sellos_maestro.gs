// Diagnóstico puntual de las tres ediciones de bastidor ya comunicadas.
// Añadir como archivo separado al proyecto existente. No sustituye Código.gs.
// Solo lee estas tres propiedades: no enumera claves, no lee el token y no
// escribe propiedades, celdas, activadores, diarios ni datos del servidor.
function metrogestionComprobarSellosMaestroSoloLectura() {
  const props = PropertiesService.getScriptProperties();
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
  const sellos = ['R1315', 'R1317', 'R1318'].map(dfm => {
    const valor = props.getProperty(`METROGESTION_MAESTRO:${dfm}:bastidor`);
    const presente = typeof valor === 'string' && valor.trim() !== '';
    const valido = presente && iso.test(valor) && Number.isFinite(Date.parse(valor));
    return { dfm, campo: 'bastidor', presente, formato_iso: valido, sello: valido ? valor : null };
  });
  const resultado = {
    diagnostico: 'sellos_maestro_solo_lectura_v1',
    solo_lectura: true,
    sellos,
  };
  console.log(JSON.stringify(resultado));
  return resultado;
}
