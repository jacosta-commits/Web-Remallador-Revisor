// server/src/features/remallado/service.js
import {
  insertParte,
  upsertDetalleDelta,
  resumenPorLote,
  resumenDelDiaPorSesion,                 // wrapper de lotesTotalesPorSesion
  lotesTotalesPorSesion as repoLotesTotalesPorSesion,
  resumenLoteSoloSesion,
  resumenLoteExcluyendoSesion,
  totalesPorLoteSesion as repoTotalesPorLoteSesion,
  totalesPorLoteOtros as repoTotalesPorLoteOtros,
  cerrarParte as repoCerrarParte,
  productoPorTarjeta as repoProductoPorTarjeta,
  parteAbiertaPorLote as repoParteAbiertaPorLote,
  detallesDeParte as repoDetallesDeParte,
  descartarParte as repoDescartarParte,
  updateParteObservaciones as repoUpdateObs,   // guarda/actualiza observaciones
} from './repo.js';

/* ===================== PARTES / DETALLES ===================== */

export async function crearParte({ srolcod, lotcod, prodnom, otcod, observaciones }) {
  if (!srolcod || !lotcod) throw new Error('Faltan datos de parte');
  const partecod = await insertParte({
    srolcod: Number(srolcod),
    lotcod: String(lotcod),
    prodnom: prodnom ?? null,
    otcod: otcod ?? null,
    observaciones: observaciones ?? null, // repo puede ignorarlo; luego se usa actualizarObs
  });
  return { partecod };
}

export async function actualizarObs(partecod, observaciones) {
  const id = Number(partecod);
  if (!id) throw new Error('partecod requerido');
  await repoUpdateObs({ partecod: id, observaciones: (observaciones ?? null) });
  return { ok: true };
}

export async function cerrarParte(partecod, observaciones = null) {
  const id = Number(partecod);
  if (!id) throw new Error('partecod requerido');
  // repoCerrarParte acepta opcionalmente observaciones (si se envía null, conserva lo existente)
  await repoCerrarParte(id, observaciones ?? null);
  return { ok: true };
}

export async function descartarParte(partecod, sescod) {
  const id = Number(partecod);
  if (!id) throw new Error('partecod requerido');
  await repoDescartarParte({ partecod: id, sescod: Number(sescod) });
  return { ok: true };
}

export async function ajustarDetalle({ partecod, codfal, delta }) {
  // Validaciones para evitar 400 por FKs o NaN
  if (!partecod) throw new Error('partecod requerido');
  if (codfal === undefined || codfal === null || codfal === '') {
    throw new Error('codfal requerido');
  }
  if (delta === undefined || delta === null || Number.isNaN(Number(delta))) {
    throw new Error('delta inválido');
  }

  const cantidad = await upsertDetalleDelta({
    partecod: Number(partecod),
    codfal: String(codfal).trim(),   // soporta "1.1"
    delta: Number(delta),
  });
  return { cantidad };
}

/* ========================= RESÚMENES ========================= */

export async function resumenLote(lotcod) {
  return await resumenPorLote(String(lotcod));
}

export async function resumenDia(sescod) {
  // compat: devuelve [{ lotcod, falla, yarda, total }]
  return await resumenDelDiaPorSesion(Number(sescod));
}

/** Resumen del día agrupado por LOTE (Falla, Yarda, Total) */
export async function resumenLotesDia(sescod) {
  return await repoLotesTotalesPorSesion(Number(sescod));
}

/** Detalle de un lote SOLO de la sesión actual (por desfal) */
export async function detalleLoteSesion(sescod, lotcod) {
  return await resumenLoteSoloSesion(Number(sescod), String(lotcod));
}

/** Detalle de un lote EXCLUYENDO la sesión actual (por desfal) */
export async function detalleLoteOtros(lotcod, sescod) {
  return await resumenLoteExcluyendoSesion(String(lotcod), Number(sescod));
}

/** Totales Falla/Yarda del lote SOLO de mi sesión (mini-barra) */
export async function totalesPorLoteSesion(sescod, lotcod) {
  return await repoTotalesPorLoteSesion(Number(sescod), String(lotcod));
}

/** Totales Falla/Yarda del MISMO lote, pero de OTRAS sesiones */
export async function totalesPorLoteOtros(lotcod, sescod) {
  return await repoTotalesPorLoteOtros(String(lotcod), Number(sescod));
}

export async function obtenerProductoPorTarjeta(lotcod) {
  if (!lotcod) return null;
  const row = await repoProductoPorTarjeta(String(lotcod));
  // normaliza el payload para el front
  return row ? { producto: row.Producto, otcod: row.OT, ftcod: row.ftcod, ftdes: row.ftdes } : null;
}

export async function obtenerParteAbierta(srolcod, lotcod) {
  const row = await repoParteAbiertaPorLote(Number(srolcod), String(lotcod));
  return row ? { partecod: Number(row.partecod) } : null;
}

export async function obtenerDetallesParte(partecod) {
  return await repoDetallesDeParte(Number(partecod));
}
