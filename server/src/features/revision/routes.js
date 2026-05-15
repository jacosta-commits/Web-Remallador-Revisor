// server/src/features/revision/routes.js
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import {
  buscarTarjeta,
  ultimaTarjeta,
  filtrarTarjetas,
  crearRevParte,
  obtenerRevParteAbierta,
  obtenerRevDetalles,
  ajustarRevDetalle,
  setRevDetalle,
  cerrarRevParte,
} from './service.js';

const r = Router();
r.use(authMiddleware);

/* ---- Consultas de lectura ---- */

// GET /api/revision/last → última tarjeta
r.get('/last', async (req, res) => {
  try {
    const data = await ultimaTarjeta();
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: e.message || 'No se encontraron tarjetas' });
  }
});

// GET /api/revision/tarjetas/filter?fecha=...&turno=...
r.get('/tarjetas/filter', async (req, res) => {
  try {
    const { fecha, turno } = req.query;
    const data = await filtrarTarjetas({ fecha, turno });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Error al filtrar tarjetas' });
  }
});

// GET /api/revision/buscar/:lotcod → header + fallas fusionadas
r.get('/buscar/:lotcod', async (req, res) => {
  try {
    const data = await buscarTarjeta(req.params.lotcod);
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: e.message || 'No se encontraron datos' });
  }
});

/* ---- Partes del revisor ---- */

// GET /api/revision/parte/abierta?lotcod=...&srolcod=...
r.get('/parte/abierta', async (req, res) => {
  try {
    const { lotcod, srolcod } = req.query;
    if (!lotcod || !srolcod) return res.status(400).json({ error: 'lotcod y srolcod requeridos' });
    const data = await obtenerRevParteAbierta(srolcod, lotcod);
    res.json(data || {});
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/revision/parte/detalles?rpartecod=...
r.get('/parte/detalles', async (req, res) => {
  try {
    const { rpartecod } = req.query;
    if (!rpartecod) return res.status(400).json({ error: 'rpartecod requerido' });
    const data = await obtenerRevDetalles(rpartecod);
    res.json(data || []);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/revision/parte → crear parte de revisión
r.post('/parte', async (req, res) => {
  try {
    const { srolcod, lotcod, placod } = req.body || {};
    if (!srolcod || !lotcod) return res.status(400).json({ error: 'srolcod y lotcod requeridos' });
    const data = await crearRevParte({ srolcod, lotcod, placod });
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/revision/det/ajustar → ajustar (+/-) cantidad de falla del revisor
r.post('/det/ajustar', async (req, res) => {
  try {
    const { rpartecod, codfal, delta } = req.body || {};
    if (!rpartecod || codfal == null || delta === undefined) {
      return res.status(400).json({ error: 'rpartecod, codfal y delta requeridos' });
    }
    const data = await ajustarRevDetalle({ rpartecod, codfal, delta });
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/revision/det/set → establecer cantidad absoluta
r.post('/det/set', async (req, res) => {
  try {
    const { rpartecod, codfal, cantidad } = req.body || {};
    if (!rpartecod || codfal == null) {
      return res.status(400).json({ error: 'rpartecod y codfal requeridos' });
    }
    const data = await setRevDetalle({ rpartecod, codfal, cantidad });
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/revision/parte/cerrar → cierra parte con conforme/no conforme
r.post('/parte/cerrar', async (req, res) => {
  try {
    const { rpartecod, conforme, observaciones } = req.body || {};
    if (!rpartecod) return res.status(400).json({ error: 'rpartecod requerido' });
    if (conforme === undefined || conforme === null) {
      return res.status(400).json({ error: 'conforme requerido (true/false)' });
    }
    const data = await cerrarRevParte(rpartecod, conforme, observaciones);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default r;
