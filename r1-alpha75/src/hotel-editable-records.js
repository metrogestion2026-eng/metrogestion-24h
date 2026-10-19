// Consulta solo las fichas visibles: el histórico de autorizaciones puede superar
// el límite de respuesta de la API. La autorización definitiva sigue en el RPC.
export async function loadEditableHotelRecords(client, recordIds, canEdit) {
  const ids = [...new Set((recordIds || []).filter(Boolean))];
  if (!canEdit || !ids.length) return { data: [], error: null };
  const rows = [];
  try {
    for (let index = 0; index < ids.length; index += 80) {
      const batch = ids.slice(index, index + 80);
      const { data, error } = await client.from('hotel_edicion_piloto')
        .select('registro_hotel_id').eq('activo', true)
        .in('registro_hotel_id', batch);
      // Sin permisos parciales si una consulta falla; nunca se infieren altas.
      if (error) return { data: [], error };
      const requested = new Set(batch);
      rows.push(...(data || []).filter(row => requested.has(row.registro_hotel_id)));
    }
    return { data: rows, error: null };
  } catch (error) {
    return { data: [], error };
  }
}
