// server/src/features/remallado/repo.js
import { getZentPool, sql } from '../../config/db.js';
import { NOW_LOCAL_SQL } from '../../config/time.js';

/* =====================================================================
   PARTES Y DETALLES
   ===================================================================== */

/** Crea la parte (fecins) y retorna partecod */
export async function insertParte({ srolcod, lotcod, prodnom, otcod, observaciones /* <- no se guarda aquí */ }) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('srolcod', sql.BigInt, srolcod)
    .input('lotcod', sql.VarChar(50), String(lotcod))
    .input('prodnom', sql.VarChar(150), prodnom ?? null)
    .input('otcod', sql.VarChar(50), otcod ?? null)
    .query(`
      INSERT INTO dbo.RCN_REM_PARTE(srolcod, lotcod, prodnom, otcod, fecins)
      VALUES (@srolcod, @lotcod, @prodnom, @otcod, ${NOW_LOCAL_SQL});
      SELECT SCOPE_IDENTITY() AS partecod;
    `);
  return Number(r.recordset[0].partecod);
}

/** Actualiza/guarda observaciones de una parte abierta (opcional) */
export async function updateParteObservaciones({ partecod, observaciones }) {
  const pool = await getZentPool();
  await pool.request()
    .input('partecod', sql.BigInt, partecod)
    .input('observaciones', sql.VarChar(500), observaciones ?? null)
    .query(`
      UPDATE dbo.RCN_REM_PARTE
      SET observaciones = @observaciones
      WHERE partecod = @partecod AND fecult IS NULL;
    `);
  return { ok: true };
}

/**
 * Ajusta (delta) la cantidad de un detalle; crea si no existe.
 * - Si no existe → inserta con fecins = fecult = now
 * - Si existe → actualiza cantidad y setea fecult = now
 * Devuelve la cantidad nueva del detalle.
 *
 * NOTA: Si tu columna dbo.RCN_REM_PARTE_DET.codfal fuese INT,
 * cambia el tipo del input a sql.Int y castea donde insertas.
 */
export async function upsertDetalleDelta({ partecod, codfal, delta }) {
  const pool = await getZentPool();

  // 1) Lee actual con bloqueo
  const sel = await pool.request()
    .input('partecod', sql.BigInt, partecod)
    .input('codfal', sql.VarChar(10), String(codfal)) // ver nota si tu col es INT
    .query(`
      SELECT detcod, cantidad
      FROM dbo.RCN_REM_PARTE_DET WITH (UPDLOCK, HOLDLOCK)
      WHERE partecod = @partecod AND codfal = @codfal
    `);

  // 2) Inserta si no existe (marca fecins & fecult)
  if (sel.recordset.length === 0) {
    if (delta <= 0) return 0;
    const ins = await pool.request()
      .input('partecod', sql.BigInt, partecod)
      .input('codfal', sql.VarChar(10), String(codfal))
      .input('cantidad', sql.Decimal(12, 2), delta)
      .query(`
        INSERT INTO dbo.RCN_REM_PARTE_DET(partecod, codfal, cantidad, fecins, fecult)
        VALUES (@partecod, @codfal, @cantidad, ${NOW_LOCAL_SQL}, ${NOW_LOCAL_SQL});
        SELECT @cantidad AS cantidad;
      `);
    return Number(ins.recordset[0].cantidad);
  }

  // 3) Actualiza si ya existe (y marca fecult)
  const actual = Number(sel.recordset[0].cantidad);
  const nuevo = Math.max(0, +(actual + delta).toFixed(2));

  await pool.request()
    .input('detcod', sql.BigInt, sel.recordset[0].detcod)
    .input('nuevo', sql.Decimal(12, 2), nuevo)
    .query(`
      UPDATE dbo.RCN_REM_PARTE_DET
      SET cantidad = @nuevo,
          fecult   = ${NOW_LOCAL_SQL}
      WHERE detcod = @detcod
    `);

  return nuevo;
}

/** Cierra/enviar parte → pone fecult y (opcional) guarda observaciones */
export async function cerrarParte(partecod, observaciones) {
  const pool = await getZentPool();
  await pool.request()
    .input('partecod', sql.BigInt, partecod)
    .input('observaciones', sql.VarChar(500), observaciones ?? null)
    .query(`
      UPDATE dbo.RCN_REM_PARTE
      SET fecult = ${NOW_LOCAL_SQL},
          observaciones = COALESCE(@observaciones, observaciones)
      WHERE partecod = @partecod;
    `);
  return { ok: true };
}

/**
 * DESCARTAR una parte abierta (solo si pertenece a mi sesión y no está cerrada):
 * - Borra detalles (RCN_REM_PARTE_DET)
 * - Borra cabecera (RCN_REM_PARTE)
 * Todo dentro de una transacción.
 */
export async function descartarParte({ partecod, sescod }) {
  const pool = await getZentPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // 1) Borra DETALLES de esa parte si pertenece a mi sesión y sigue abierta
    await (new sql.Request(tx))
      .input('partecod', sql.BigInt, partecod)
      .input('sescod', sql.BigInt, sescod)
      .query(`
        DELETE D
        FROM dbo.RCN_REM_PARTE_DET AS D
        JOIN dbo.RCN_REM_PARTE      AS P ON P.partecod = D.partecod
        JOIN dbo.RCN_REM_SESION_ROL AS R ON R.srolcod  = P.srolcod
        JOIN dbo.RCN_REM_SESION     AS S ON S.sescod   = R.sescod
        WHERE P.partecod = @partecod
          AND S.sescod   = @sescod
          AND P.fecult IS NULL;
      `);

    // 2) Borra la PARTE (cabecera) si aún está abierta y es de mi sesión
    await (new sql.Request(tx))
      .input('partecod', sql.BigInt, partecod)
      .input('sescod', sql.BigInt, sescod)
      .query(`
        DELETE P
        FROM dbo.RCN_REM_PARTE AS P
        JOIN dbo.RCN_REM_SESION_ROL AS R ON R.srolcod = P.srolcod
        JOIN dbo.RCN_REM_SESION     AS S ON S.sescod  = R.sescod
        WHERE P.partecod = @partecod
          AND S.sescod   = @sescod
          AND P.fecult IS NULL;
      `);

    await tx.commit();
    return { ok: true };
  } catch (e) {
    try { await tx.rollback(); } catch { }
    throw e;
  }
}

/* =====================================================================
   RESÚMENES (JOIN directo por VARCHAR(10), sin CAST)
   ===================================================================== */

/**
 * (A) Totales por TIPFAL del lote (TODAS las sesiones).
 * Devuelve: [{ tipfal, total }]
 */
export async function resumenPorLote(lotcod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('lotcod', sql.VarChar(50), lotcod)
    .query(`
      SELECT ISNULL(f.tipfal, 'DESCONOCIDO') AS tipfal,
             SUM(d.cantidad)                 AS total
      FROM dbo.RCN_REM_PARTE p
      JOIN dbo.RCN_REM_PARTE_DET d ON d.partecod = p.partecod
      LEFT JOIN dbo.RCN_REM_FALLA  f ON f.codfal = d.codfal
      WHERE UPPER(p.lotcod) = UPPER(@lotcod)
      GROUP BY f.tipfal
      ORDER BY f.tipfal
    `);
  return r.recordset;
}

/**
 * (A1) Totales Falla/Yarda del lote SOLO de mi sesión.
 * Devuelve: { falla, yarda, total }
 */
export async function totalesPorLoteSesion(sescod, lotcod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('sescod', sql.BigInt, sescod)
    .input('lotcod', sql.VarChar(50), lotcod)
    .query(`
      SELECT
        SUM(CASE WHEN UPPER(ISNULL(f.tipfal,'')) = 'YARDA' THEN d.cantidad ELSE 0 END) AS yarda,
        SUM(CASE WHEN UPPER(ISNULL(f.tipfal,'')) <> 'YARDA' THEN d.cantidad ELSE 0 END) AS falla
      FROM dbo.RCN_REM_SESION s
      JOIN dbo.RCN_REM_SESION_ROL sr ON sr.sescod = s.sescod
      JOIN dbo.RCN_REM_PARTE        p ON p.srolcod = sr.srolcod
      JOIN dbo.RCN_REM_PARTE_DET    d ON d.partecod = p.partecod
      LEFT JOIN dbo.RCN_REM_FALLA   f ON f.codfal = d.codfal
      WHERE s.sescod = @sescod
        AND UPPER(p.lotcod) = UPPER(@lotcod);
    `);
  const row = r.recordset[0] || { falla: 0, yarda: 0 };
  const falla = Number(row.falla || 0);
  const yarda = Number(row.yarda || 0);
  return { falla, yarda, total: falla + yarda };
}

/**
 * (B) Resumen del día por sesión → por LOTE (Falla, Yarda, Total).
 * Devuelve: [{ lotcod, falla, yarda, total }]
 */
export async function lotesTotalesPorSesion(sescod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('sescod', sql.BigInt, sescod)
    .query(`
      SELECT
        p.lotcod,
        SUM(CASE WHEN UPPER(ISNULL(f.tipfal,'')) = 'YARDA' THEN d.cantidad ELSE 0 END) AS yarda,
        SUM(CASE WHEN UPPER(ISNULL(f.tipfal,'')) <> 'YARDA' THEN d.cantidad ELSE 0 END) AS falla
      FROM dbo.RCN_REM_SESION s
      JOIN dbo.RCN_REM_SESION_ROL sr ON sr.sescod = s.sescod
      JOIN dbo.RCN_REM_PARTE p          ON p.srolcod = sr.srolcod
      LEFT JOIN dbo.RCN_REM_PARTE_DET d ON d.partecod = p.partecod
      LEFT JOIN dbo.RCN_REM_FALLA f     ON f.codfal = d.codfal
      WHERE s.sescod = @sescod
      GROUP BY p.lotcod
      ORDER BY p.lotcod;
    `);
  return (r.recordset || []).map(x => {
    const falla = Number(x.falla || 0);
    const yarda = Number(x.yarda || 0);
    return { lotcod: x.lotcod, falla, yarda, total: falla + yarda };
  });
}

/* ---- Compatibilidad: mismo nombre que usaba service.js ---- */
export async function resumenDelDiaPorSesion(sescod) {
  return lotesTotalesPorSesion(sescod);
}

/**
 * (C) Totales del MISMO lote pero EXCLUYENDO mi sesión (otros).
 * Devuelve: { falla, yarda, total }
 */
export async function totalesPorLoteOtros(lotcod, sescod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('lotcod', sql.VarChar(50), lotcod)
    .input('sescod', sql.BigInt, sescod)
    .query(`
      SELECT
        SUM(CASE WHEN UPPER(ISNULL(f.tipfal,'')) = 'YARDA' THEN d.cantidad ELSE 0 END) AS yarda,
        SUM(CASE WHEN UPPER(ISNULL(f.tipfal,'')) <> 'YARDA' THEN d.cantidad ELSE 0 END) AS falla
      FROM dbo.RCN_REM_PARTE p
      JOIN dbo.RCN_REM_SESION_ROL sr ON sr.srolcod = p.srolcod
      JOIN dbo.RCN_REM_SESION s      ON s.sescod  = sr.sescod
      LEFT JOIN dbo.RCN_REM_PARTE_DET d ON d.partecod = p.partecod
      LEFT JOIN dbo.RCN_REM_FALLA f     ON f.codfal = d.codfal
      WHERE UPPER(p.lotcod) = UPPER(@lotcod)
        AND s.sescod <> @sescod;
    `);
  const row = r.recordset[0] || { falla: 0, yarda: 0 };
  const falla = Number(row.falla || 0);
  const yarda = Number(row.yarda || 0);
  return { falla, yarda, total: falla + yarda };
}

/**
 * (D) Detalle del lote SOLO de mi sesión → agrupado por NOMBRE (desfal).
 * Devuelve: [{ desfal, total }]
 */
export async function resumenLoteSoloSesion(sescod, lotcod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('sescod', sql.BigInt, sescod)
    .input('lotcod', sql.VarChar(50), lotcod)
    .query(`
      SELECT ISNULL(f.desfal, CONCAT('COD ', d.codfal)) AS desfal,
             SUM(d.cantidad) AS total
      FROM dbo.RCN_REM_SESION s
      JOIN dbo.RCN_REM_SESION_ROL sr ON sr.sescod = s.sescod
      JOIN dbo.RCN_REM_PARTE p        ON p.srolcod = sr.srolcod
      JOIN dbo.RCN_REM_PARTE_DET d    ON d.partecod = p.partecod
      LEFT JOIN dbo.RCN_REM_FALLA     f ON f.codfal = d.codfal
      WHERE s.sescod = @sescod
        AND UPPER(p.lotcod) = UPPER(@lotcod)
      GROUP BY f.desfal, d.codfal
      ORDER BY f.desfal
    `);
  return r.recordset;
}

/**
 * (E) Detalle del lote EXCLUYENDO mi sesión → agrupado por NOMBRE (desfal).
 * Devuelve: [{ desfal, total }]
 */
export async function resumenLoteExcluyendoSesion(lotcod, sescod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('lotcod', sql.VarChar(50), lotcod)
    .input('sescod', sql.BigInt, sescod)
    .query(`
      SELECT ISNULL(f.desfal, CONCAT('COD ', d.codfal)) AS desfal,
             SUM(d.cantidad) AS total
      FROM dbo.RCN_REM_PARTE p
      JOIN dbo.RCN_REM_SESION_ROL sr ON sr.srolcod = p.srolcod
      JOIN dbo.RCN_REM_SESION s      ON s.sescod  = sr.sescod
      JOIN dbo.RCN_REM_PARTE_DET d   ON d.partecod = p.partecod
      LEFT JOIN dbo.RCN_REM_FALLA    f ON f.codfal = d.codfal
      WHERE UPPER(p.lotcod) = UPPER(@lotcod)
        AND s.sescod <> @sescod
      GROUP BY f.desfal, d.codfal
      ORDER BY f.desfal
    `);
  return r.recordset;
}

// === Producto (ftdes) por Tarjeta (lote) desde Medidores_2023 ===
export async function productoPorTarjeta(lotcod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('tarjeta', sql.VarChar(50), String(lotcod))
    .query(`
      SELECT TOP 1
             A.Producto,       -- ej. 'R110J0180360.0-13150A02'
             A.OT,             -- ej. 'OT-4521'
             B.ftcod,          -- debe coincidir con A.Producto
             B.ftdes           -- descripción que quieres mostrar
      FROM Medidores_2023.dbo.VIEW_PRD_SCADA001 AS A WITH (NOLOCK)
      LEFT JOIN Medidores_2023.dbo.VIEW_PRD_SCADA004 AS B WITH (NOLOCK)
             ON B.ftcod = A.Producto
      WHERE A.Tarjeta = @tarjeta;
    `);
  return r.recordset[0] || null;
}

// === Parte abierta para un srolcod + lotcod ===
export async function parteAbiertaPorLote(srolcod, lotcod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('srolcod', sql.BigInt, srolcod)
    .input('lotcod', sql.VarChar(50), String(lotcod))
    .query(`
      SELECT TOP 1 partecod
      FROM dbo.RCN_REM_PARTE
      WHERE srolcod = @srolcod
        AND UPPER(lotcod) = UPPER(@lotcod)
        AND fecult IS NULL
      ORDER BY partecod DESC;
    `);
  return r.recordset[0] || null;
}

// === Detalles completos de una parte (para reconstruir UI) ===
export async function detallesDeParte(partecod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('partecod', sql.BigInt, partecod)
    .query(`
      SELECT d.codfal, ISNULL(f.desfal, CONCAT('COD ', d.codfal)) AS desfal,
             UPPER(ISNULL(f.tipfal,'')) AS tipfal, d.cantidad
      FROM dbo.RCN_REM_PARTE_DET d
      LEFT JOIN dbo.RCN_REM_FALLA f ON f.codfal = d.codfal
      WHERE d.partecod = @partecod
      ORDER BY f.desfal, d.codfal;
    `);
  return r.recordset;
}
