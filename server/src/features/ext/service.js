// server/src/features/ext/service.js
import { getAppPool, getZentPool, sql } from '../../config/db.js';

/** Trabajador desde AppSheet (se mantiene igual) */
export async function getTrabajadorByCodigo(codigo) {
  const pool   = await getAppPool();
  const padded = String(codigo).trim().padStart(5, '0'); // '4' -> '00004'
  const req = pool.request();
  req.timeout = Number(process.env.APP_RRHH_TIMEOUT_MS || 7000);
  const rs = await req
    .input('tracod', sql.VarChar(30), padded)
    .query(`
      SELECT TOP (1)
        LTRIM(RTRIM(TRACOD)) AS tracod,   -- <<< TRIM
        TRARAZ AS nombre
      FROM APPSHEET001.dbo.VIEW_FISA_RRHH_TRABAJADOR WITH (NOLOCK)
      WHERE TRACOD = @tracod
    `);
  return rs.recordset[0] || null;
}

/** Fallas desde ZENTRIK.dbo.RCN_REM_FALLA (nuevo catálogo interno) */
async function getFallaByCodigoZent(cod) {
  const pool = await getZentPool();
  const rs = await pool.request()
    .input('cod', sql.VarChar(10), String(cod))
    .query(`
      SELECT TOP (1)
        codfal,      -- VARCHAR(10): soporta '1' y '1.1'
        desfal,
        tipfal
      FROM dbo.RCN_REM_FALLA WITH (NOLOCK)
      WHERE codfal = @cod
    `);
  return rs.recordset[0] || null;
}

export async function listarFallasLike(q = '') {
  const pool = await getZentPool();
  const rs = await pool.request()
    .input('q', sql.VarChar(120), `%${q}%`)
    .query(`
      SELECT TOP (30)
        codfal, desfal, tipfal
      FROM dbo.RCN_REM_FALLA WITH (NOLOCK)
      WHERE desfal LIKE @q
      ORDER BY desfal
    `);
  return rs.recordset;
}

/** Helper usado en routes: por código exacto o por texto */
export async function getFallas({ cod, q } = {}) {
  if (cod != null) {
    const f = await getFallaByCodigoZent(cod);
    return f ? [f] : [];
  }
  return listarFallasLike(q || '');
}
