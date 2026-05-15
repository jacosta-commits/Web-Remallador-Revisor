// server/src/features/revision/service.js
import {
  getRemalleFallas,
  getInfoTarjeta,
  getUltimaTarjeta,
  filtrarTarjetas as repoFiltrar,
  insertRevParte,
  getRevParteAbierta as repoParteAbierta,
  getRevDetallesParte as repoDetalles,
  upsertRevDetalleDelta,
  setRevDetalleCantidad as repoSetCant,
  cerrarRevParte as repoCerrar,
  getRevisionFallasPorLote,
} from './repo.js';

/* ===================== CONSULTAS ===================== */

/**
 * Buscar tarjeta: devuelve header + fallas remalle + fallas revisión.
 * Fusiona ambas listas para la tabla comparativa.
 */
export async function buscarTarjeta(lotcod) {
  if (!lotcod) throw new Error('Falta lotcod');

  const info = await getInfoTarjeta(lotcod);
  if (!info) throw new Error('No se encontraron datos para esta tarjeta');

  const header = {
    tarjeta: info.tarjeta || lotcod,
    otcod: info.otcod || '',
    producto: info.producto || '',
    nombre: info.nombre || '',
  };

  // Fallas del remallador
  const remalle = await getRemalleFallas(lotcod);

  // Fallas del revisor (todas las sesiones)
  const revision = await getRevisionFallasPorLote(lotcod);

  // Fusionar
  const allFaults = {};

  remalle.forEach(item => {
    const key = item.codfal.toString().trim();
    allFaults[key] = {
      codfal: key,
      desfal: item.desfal,
      tipfal: item.tipfal,
      cant_remalle: Number(item.cant_remalle || 0),
      cant_revision: 0,
    };
  });

  revision.forEach(item => {
    const key = item.codfal.toString().trim();
    if (allFaults[key]) {
      allFaults[key].cant_revision = Number(item.cant_revision || 0);
    } else {
      allFaults[key] = {
        codfal: key,
        desfal: item.desfal,
        tipfal: item.tipfal,
        cant_remalle: 0,
        cant_revision: Number(item.cant_revision || 0),
      };
    }
  });

  return {
    header,
    fallas: Object.values(allFaults),
  };
}

/** Última tarjeta registrada */
export async function ultimaTarjeta() {
  const t = await getUltimaTarjeta();
  if (!t) throw new Error('No se encontraron tarjetas');
  return { tarjeta: t };
}

/** Filtrar tarjetas por fecha/turno agrupadas por OT */
export async function filtrarTarjetas({ fecha, turno }) {
  return repoFiltrar({ fecha, turno });
}

/* ===================== PARTES / DETALLES ===================== */

/** Crear parte de revisión */
export async function crearRevParte({ srolcod, lotcod, placod }) {
  if (!srolcod || !lotcod) throw new Error('srolcod y lotcod requeridos');
  const rpartecod = await insertRevParte({
    srolcod: Number(srolcod),
    lotcod: String(lotcod),
    placod: placod || 'RCN',
  });
  return { rpartecod };
}

/** Buscar parte abierto del revisor */
export async function obtenerRevParteAbierta(srolcod, lotcod) {
  const row = await repoParteAbierta(Number(srolcod), String(lotcod));
  return row ? { rpartecod: Number(row.rpartecod), conforme: row.conforme, observaciones: row.observaciones } : null;
}

/** Detalles de un parte del revisor */
export async function obtenerRevDetalles(rpartecod) {
  return repoDetalles(Number(rpartecod));
}

/** Ajustar (+/-) un detalle del revisor */
export async function ajustarRevDetalle({ rpartecod, codfal, delta }) {
  if (!rpartecod) throw new Error('rpartecod requerido');
  if (codfal === undefined || codfal === null || codfal === '') throw new Error('codfal requerido');
  if (delta === undefined || Number.isNaN(Number(delta))) throw new Error('delta inválido');

  const cantidad = await upsertRevDetalleDelta({
    rpartecod: Number(rpartecod),
    codfal: String(codfal).trim(),
    delta: Number(delta),
  });
  return { cantidad };
}

/** Establecer cantidad absoluta */
export async function setRevDetalle({ rpartecod, codfal, cantidad }) {
  if (!rpartecod) throw new Error('rpartecod requerido');
  if (codfal === undefined || codfal === null || codfal === '') throw new Error('codfal requerido');

  const cant = await repoSetCant({
    rpartecod: Number(rpartecod),
    codfal: String(codfal).trim(),
    cantidad: Number(cantidad) || 0,
  });
  return { cantidad: cant };
}

/** Cerrar parte con conforme/no conforme */
export async function cerrarRevParte(rpartecod, conforme, observaciones) {
  const id = Number(rpartecod);
  if (!id) throw new Error('rpartecod requerido');
  await repoCerrar(id, !!conforme, observaciones ?? null);
  return { ok: true };
}
