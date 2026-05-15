// server/src/config/time.js
// Zona: Bogotá/Lima/Quito (sin DST)  => UTC-05:00
// Evitamos "AT TIME ZONE" y usamos SWITCHOFFSET, que ajusta la hora
// manteniendo el mismo instante en el tiempo.
export const TZ_OFFSET = '-05:00'; // cambia si tu zona cambia

// NOW con hora local, sin milisegundos (datetime2(0))
export const NOW_LOCAL_SQL =
  `CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '${TZ_OFFSET}') AS datetime2(0))`;

// TODAY (solo la fecha) en hora local
export const TODAY_LOCAL_SQL =
  `CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '${TZ_OFFSET}') AS date)`;

// Utilidades por si necesitas convertir columnas almacenadas en UTC:
export const TO_LOCAL_SQL = (col) =>
  `CAST(SWITCHOFFSET(${col}, '${TZ_OFFSET}') AS datetime2(0))`;

export const TO_LOCAL_DATE_SQL = (col) =>
  `CAST(SWITCHOFFSET(${col}, '${TZ_OFFSET}') AS date)`;
