-- SINCRO13: prerequisitos EXCLUSIVAMENTE de la réplica Hotel en
-- PostgreSQL17 LOCAL. Las funciones que siguen son copias READ-ONLY
-- del Supabase de pruebas. Ningún trigger ni dato real se modifica.
CREATE SEQUENCE IF NOT EXISTS public.numero_parada_seq START WITH 990001;
CREATE TABLE IF NOT EXISTS app_private.numeros_parada_temporales_alpha75 (
  numero_parada bigint PRIMARY KEY,
  expira_en timestamptz NOT NULL
);
-- Metadata de ativación del trigger ya existente que difiere por la
-- columna fecha_entrada: sustituirlo SOLO en la base local de prueba.
DROP TRIGGER IF EXISTS registros_hotel_manteniment_encolar ON public.registros_hotel;
CREATE TRIGGER registros_hotel_manteniment_encolar
  AFTER INSERT OR UPDATE OF
   vehiculo_sustituido,matricula_sustituido,vehiculo_reserva,
   tipo_unidad,upc,marca,fecha_parada,fecha_entrada,
   retirado_hotel_activo,fecha_retirado_hotel,estado,cancelado
  ON public.registros_hotel
  FOR EACH ROW EXECUTE FUNCTION app_private.manteniment_registro_hotel_trigger();
