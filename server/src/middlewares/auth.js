// server/src/middlewares/auth.js
import { verifyToken } from '../lib/jwt.js';
import { getZentPool, sql } from '../config/db.js';

/**
 * Rutas públicas (no requieren Bearer token).
 * Considera ambos casos: montado en '/api' (req.path = '/ext/...') o sin prefijo.
 */
const PUBLIC_PATHS = [
  // login
  /^\/api\/login$/i,
  /^\/login$/i,

  // todo el subárbol /ext (trabajador, fallas, producto)
  /^\/api\/ext(?:\/|$)/i,
  /^\/ext(?:\/|$)/i,
];

/** Devuelve la ruta efectiva para matchear, sin querystring */
function effectivePath(req) {
  // cuando se monta como app.use('/api', auth, router), req.path = '/ext/...'
  // y req.baseUrl = '/api'; combinamos ambos para chequear con regex
  const p = `${req.baseUrl || ''}${req.path || ''}`;
  if (p) return p;
  // fallback
  const oi = (req.originalUrl || '').split('?')[0];
  return oi || '/';
}

/**
 * Verifica:
 *  - Si la ruta es pública, deja pasar.
 *  - Token válido (firma/exp).
 *  - Sesión abierta (fecfin IS NULL).
 *  - jti del token coincide con active_jti de la sesión (single-login).
 */
export async function authMiddleware(req, res, next) {
  // Preflight CORS
  if (req.method === 'OPTIONS') return next();

  const path = effectivePath(req);
  if (PUBLIC_PATHS.some((re) => re.test(path))) return next();

  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'token requerido' });

  try {
    const payload = verifyToken(m[1]); // { sescod, tracod, jti }
    const pool = await getZentPool();
    const r = await pool.request()
      .input('sescod', sql.BigInt, payload.sescod)
      .query(`
        SELECT active_jti, fecfin
        FROM dbo.RCN_REM_SESION WITH (NOLOCK)
        WHERE sescod = @sescod
      `);

    const row = r.recordset[0];
    if (!row || row.fecfin !== null || row.active_jti !== payload.jti) {
      return res.status(401).json({ error: 'token inválido' });
    }

    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'token inválido' });
  }
}
