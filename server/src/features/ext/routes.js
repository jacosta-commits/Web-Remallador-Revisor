// server/src/features/ext/routes.js
import express from 'express';
import { getFallas, getTrabajadorByCodigo } from './service.js';
import { obtenerProductoPorTarjeta } from '../remallado/service.js';

const router = express.Router();

/**
 * GET /api/ext/fallas
 * Query:
 *   - cod: código exacto de falla (ej. "9" o "1.1")
 *   - q:   texto para búsqueda por nombre (LIKE)
 * Responde siempre una lista ([]) aunque sea 1 resultado.
 */
router.get('/fallas', async (req, res) => {
  try {
    const { cod, q } = req.query || {};
    console.log('[EXT] GET /fallas', { cod, q });

    const list = await getFallas({ cod, q });
    return res.json(Array.isArray(list) ? list : (list ? [list] : []));
  } catch (e) {
    console.error('[EXT] /fallas error:', e?.message);
    return res.status(400).json({ error: e.message || 'No se pudo obtener fallas' });
  }
});

/**
 * GET /api/ext/producto
 * Query:
 *   - lotcod: N° de lote/tarjeta (ej. "R123456")
 * Devuelve { producto, ftcod, ftdes } o {} si no hay coincidencia.
 */
router.get('/producto', async (req, res) => {
  try {
    const lotcod = String(req.query.lotcod || '').trim();
    console.log('[EXT] GET /producto', { lotcod });

    if (!lotcod) return res.status(400).json({ error: 'lotcod requerido' });

    const data = await obtenerProductoPorTarjeta(lotcod);
    // Para el front es más cómodo responder 200 con {} si no hay data
    return res.json(data || {});
  } catch (e) {
    console.error('[EXT] /producto error:', e?.message);
    return res.status(400).json({ error: e.message || 'No se pudo obtener producto' });
  }
});

/**
 * GET /api/ext/trabajador
 * Query:
 *   - codigo: código FISA del trabajador
 * Devuelve { tracod, nombre } o 404 si no existe.
 * (Usado en login para modal de confirmación)
 */
router.get('/trabajador', async (req, res) => {
  const codigo = String(req.query.codigo || '').trim();
  if (!codigo) return res.status(400).json({ error: 'codigo requerido' });

  try {
    console.log('[EXT] GET /trabajador', { codigo });

    const t = await getTrabajadorByCodigo(codigo);
    console.log('[EXT] /trabajador →', t);

    if (!t) return res.status(404).json({ error: 'no encontrado' });
    return res.json(t);
  } catch (e) {
    console.error('[EXT] /trabajador error:', e?.message);
    return res.status(400).json({ error: e.message || 'No se pudo obtener trabajador' });
  }
});

export default router;
