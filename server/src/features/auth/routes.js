// server/src/features/auth/routes.js
import express from 'express';
import crypto from 'node:crypto';
import {
  loginService,
  cambiarRolService,
  listarRolesActivos,
  cerrarSesionService,
} from './service.js';
import { createToken, verifyToken } from '../../lib/jwt.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { kickByTracodExceptJti } from '../../lib/ws.js'; // evita patearte a ti mismo

const router = express.Router();

/**
 * POST /api/login
 * Body: { codigo, turno, devuuid?, forceClose? }
 * - Si hay sesión hoy en otro dispositivo y forceClose !== true → 400 con code='SESSION_OPEN_OTHER_DEVICE'
 * - Si forceClose === true → cierra la(s) anterior(es) y abre nueva en este dispositivo
 * - Fija active_jti (single-login) DENTRO del service (transacción)
 * - Luego patea WS viejos (distinto jti) para logout inmediato
 */
router.post('/login', async (req, res) => {
  try {
    const { codigo, turno, devuuid, forceClose } = req.body || {};
    if (!codigo || !turno) {
      return res.status(400).json({ error: 'codigo y turno requeridos' });
    }

    // jti único para este login
    const jti = crypto.randomUUID();

    // El service maneja cierre/creación/reuso y escribe active_jti ATÓMICAMENTE
    const out = await loginService({
      codigo,
      turno,
      devuuid,
      forceClose: !!forceClose,
      jti, // <- importante: se fija dentro del service en la misma transacción
    });

    // Expulsar WS de este trabajador con jti distinto (ya con DB consistente)
    try { kickByTracodExceptJti(out.trabajador.tracod, jti, 'replaced'); } catch {}

    // Firmar token con jti
    const token = createToken({
      sescod: out.sescod,
      tracod: out.trabajador.tracod,
      jti,
    });

    return res.json({
      token,
      sescod: out.sescod,
      trabajador: out.trabajador,
      roles: out.roles,
    });
  } catch (e) {
    const payload = { error: e?.message || 'No se pudo iniciar sesión' };
    if (e?.code) payload.code = e.code; // p.ej. 'SESSION_OPEN_OTHER_DEVICE'
    if (e?.info) payload.info = e.info; // datos útiles para el front
    return res.status(400).json(payload);
  }
});

/** GET /api/roles -> catálogo dinámico desde DB */
router.get('/roles', authMiddleware, async (_req, res) => {
  try {
    const roles = await listarRolesActivos();
    return res.json(roles);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'No se pudo leer roles' });
  }
});

/**
 * POST /api/rol  (Bearer <token>)
 * Body: { rolcod }
 * - Abre/cambia tramo de rol dentro de la sesión actual (srolcod devuelto).
 */
router.post('/rol', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'token requerido' });

    const user = verifyToken(m[1]); // { sescod, tracod, jti }
    const { rolcod } = req.body || {};
    if (!rolcod) return res.status(400).json({ error: 'rolcod requerido' });

    const { srolcod } = await cambiarRolService({ sescod: user.sescod, rolcod });
    return res.json({ srolcod });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'No se pudo cambiar de rol' });
  }
});

/**
 * POST /api/fin-turno
 * - Cierra sesión y cualquier tramo de rol abierto (fecfin).
 */
router.post('/fin-turno', authMiddleware, async (req, res) => {
  try {
    await cerrarSesionService(req.user.sescod);
    return res.status(204).end();
  } catch (e) {
    return res.status(400).json({ error: e.message || 'No se pudo terminar el turno' });
  }
});

export default router;
