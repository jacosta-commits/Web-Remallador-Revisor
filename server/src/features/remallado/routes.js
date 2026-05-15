// server/src/features/remallado/routes.js
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { getZentPool, sql } from '../../config/db.js';
import { NOW_LOCAL_SQL } from '../../config/time.js';
import { kickBySession } from '../../lib/ws.js';
import {
  crearParte,
  cerrarParte,             // cerrar/enviar parte (setea fecult)
  descartarParte,          // descartar parte abierta
  ajustarDetalle,
  resumenLote,
  resumenDia,
  resumenLotesDia,         // [{ lotcod, falla, yarda, total }]
  detalleLoteSesion,
  detalleLoteOtros,
  totalesPorLoteSesion,    // { falla, yarda, total } de mi sesión
  totalesPorLoteOtros,     // { falla, yarda, total } de otras sesiones
  obtenerProductoPorTarjeta,
  obtenerParteAbierta,
  obtenerDetallesParte,
  actualizarObs,           // <— NUEVO: set observaciones
} from './service.js';

const r = Router();

// Todas requieren auth
r.use(authMiddleware);

// GET /api/parte/abierta?lotcod=Rxxxxxx&srolcod=123
r.get('/parte/abierta', async (req, res) => {
  try {
    const { lotcod, srolcod } = req.query || {};
    if (!lotcod || !srolcod) {
      return res.status(400).json({ ok: false, error: 'lotcod y srolcod son requeridos' });
    }
    const data = await obtenerParteAbierta(srolcod, lotcod);
    res.json(data || {});
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener parte abierta' });
  }
});

// GET /api/parte/detalles?partecod=999
r.get('/parte/detalles', async (req, res) => {
  try {
    const { partecod } = req.query || {};
    if (!partecod) return res.status(400).json({ ok: false, error: 'partecod requerido' });
    const data = await obtenerDetallesParte(partecod);
    res.json(data || []);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener detalles' });
  }
});

// GET /api/ext/producto?lotcod=...
r.get('/ext/producto', async (req, res) => {
  try {
    const { lotcod } = req.query || {};
    if (!lotcod) return res.status(400).json({ ok: false, error: 'Falta lotcod' });
    const data = await obtenerProductoPorTarjeta(lotcod);
    res.json(data || {});   // { producto, ftcod, ftdes }
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener producto' });
  }
});

/* ------------------------- PARTES / DETALLES ------------------------- */

// POST /api/parte  -> crea la parte (fecins)
r.post('/parte', async (req, res) => {
  try {
    const { srolcod, lotcod, prodnom, otcod, observaciones } = req.body || {};
    if (!srolcod || !lotcod) return res.status(400).json({ error: 'srolcod y lotcod requeridos' });

    console.log('[PARTE] POST /parte →', { srolcod, lotcod, prodnom, otcod });
    const data = await crearParte({ srolcod, lotcod, prodnom, otcod, observaciones });
    res.json(data); // { partecod }
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo crear el parte' });
  }
});

// POST /api/parte/obs -> guarda/actualiza observaciones
r.post('/parte/obs', async (req, res) => {
  try {
    const { partecod, observaciones } = req.body || {};
    if (!partecod) return res.status(400).json({ ok: false, error: 'partecod requerido' });
    await actualizarObs(partecod, observaciones ?? null);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo actualizar observaciones' });
  }
});

// POST /api/parte/cerrar  -> marca fecult en la parte
r.post('/parte/cerrar', async (req, res) => {
  try {
    const { partecod } = req.body || {};
    if (!partecod) return res.status(400).json({ ok: false, error: 'partecod requerido' });
    await cerrarParte(partecod);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo cerrar la parte' });
  }
});

// POST /api/parte/descartar -> elimina detalles y cabecera si aún no fue cerrada
r.post('/parte/descartar', async (req, res) => {
  try {
    const { partecod } = req.body || {};
    if (!partecod) return res.status(400).json({ ok: false, error: 'partecod requerido' });
    const sescod = req.query.sescod || req.user.sescod; // del token o query
    if (!sescod) return res.status(400).json({ ok: false, error: 'sescod requerido' });
    await descartarParte(partecod, sescod);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo descartar la parte' });
  }
});

// POST /api/det/ajustar  -> crea/ajusta detalle (fecins / fecult)
r.post('/det/ajustar', async (req, res) => {
  try {
    const { partecod, codfal, delta } = req.body || {};
    // Acepta codfal como string/decimal (p.e. "1.1") y delta numérico o string numérico
    if (!partecod || codfal === undefined || codfal === null || codfal === '' || delta === undefined) {
      return res.status(400).json({ ok: false, error: 'partecod, codfal y delta son requeridos' });
    }
    const data = await ajustarDetalle({ partecod, codfal, delta });
    res.json(data); // { cantidad }
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo ajustar' });
  }
});

/* --------------------------- RESÚMENES --------------------------- */

// GET /api/resumen/lotes -> por sesión (Lote, Falla, Yarda, Total)
r.get('/resumen/lotes', async (req, res) => {
  try {
    const sescod = req.query.sescod || req.user.sescod;
    const data = await resumenLotesDia(sescod);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener resumen de lotes' });
  }
});

// GET /api/resumen/lote/sesion?lotcod=... -> detalle SOLO de mi sesión (por desfal)
r.get('/resumen/lote/sesion', async (req, res) => {
  try {
    const sescod = req.query.sescod || req.user.sescod;
    const { lotcod } = req.query || {};
    if (!lotcod) return res.status(400).json({ ok: false, error: 'Falta lotcod' });
    const data = await detalleLoteSesion(sescod, lotcod);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener detalle' });
  }
});

// GET /api/resumen/lote/otros?lotcod=... -> detalle EXCLUYENDO mi sesión (por desfal)
r.get('/resumen/lote/otros', async (req, res) => {
  try {
    const sescod = req.query.sescod || req.user.sescod;
    const { lotcod } = req.query || {};
    if (!lotcod) return res.status(400).json({ ok: false, error: 'Falta lotcod' });
    const data = await detalleLoteOtros(lotcod, sescod);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener detalle de otros' });
  }
});

// (compat) GET /api/resumen/lote?lotcod=... (todas las sesiones por TIPFAL)
r.get('/resumen/lote', async (req, res) => {
  try {
    const { lotcod } = req.query || {};
    if (!lotcod) return res.status(400).json({ ok: false, error: 'Falta lotcod' });
    const data = await resumenLote(lotcod);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener resumen' });
  }
});

// (compat) GET /api/resumen/dia?sescod=...
r.get('/resumen/dia', async (req, res) => {
  try {
    const sescod = req.query.sescod || req.user.sescod;
    const data = await resumenDia(sescod);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener resumen' });
  }
});

/* --------- MINI-BARRA Falla/Yarda --------- */
// GET /api/resumen/lote/totales?lotcod=... [&sescod=...]
// Devuelve { falla, yarda, total } EXCLUSIVO de la sesión actual
r.get('/resumen/lote/totales', async (req, res) => {
  try {
    const sescod = req.query.sescod || req.user.sescod;
    const { lotcod } = req.query || {};
    if (!lotcod) return res.status(400).json({ ok: false, error: 'Falta lotcod' });
    if (!sescod) return res.status(400).json({ ok: false, error: 'Falta sescod' });
    const data = await totalesPorLoteSesion(sescod, lotcod);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener totales del lote' });
  }
});

/* --------- Totales de OTROS (mismo lote, otras sesiones) --------- */
// GET /api/resumen/lote/otros-totales?lotcod=... [&sescod=...]
// Devuelve { falla, yarda, total } de otras sesiones para ese lote
r.get('/resumen/lote/otros-totales', async (req, res) => {
  try {
    const sescod = req.query.sescod || req.user.sescod;
    const { lotcod } = req.query || {};
    if (!lotcod) return res.status(400).json({ ok: false, error: 'Falta lotcod' });
    if (!sescod) return res.status(400).json({ ok: false, error: 'Falta sescod' });
    const data = await totalesPorLoteOtros(lotcod, sescod);
    res.json({ lotcod, ...data });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'No se pudo obtener totales de otros' });
  }
});

// POST /api/fin-turno -> marca fecfin y expulsa WS de esta sesión
r.post('/fin-turno', async (req, res) => {
  try {
    const sescod = req.user?.sescod;
    if (!sescod) return res.status(401).json({ error: 'No autenticado' });

    const pool = await getZentPool();
    await pool.request()
      .input('sescod', sql.BigInt, sescod)
      .query(`
        UPDATE dbo.RCN_REM_SESION
        SET fecfin = ${NOW_LOCAL_SQL}, active_jti = NULL
        WHERE sescod = @sescod AND fecfin IS NULL;
      `);

    // Notifica al/los clientes para que hagan logout inmediato
    try { kickBySession(sescod, 'turn-closed'); } catch { }

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'No se pudo cerrar el turno' });
  }
});

export default r;
