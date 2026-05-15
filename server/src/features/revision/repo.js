// server/src/features/revision/repo.js
import { getZentPool, getMedPool, sql } from '../../config/db.js';
import { NOW_LOCAL_SQL } from '../../config/time.js';

/* =====================================================================
   CONSULTAS DE LECTURA (datos del remallador + externos)
   ===================================================================== */

/**
 * Fallas agrupadas de los remalladores para una tarjeta (lotcod).
 * Devuelve [{ codfal, desfal, tipfal, cant_remalle }]
 */
export async function getRemalleFallas(lotcod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('lotcod', sql.VarChar(50), String(lotcod))
    .query(`
      SELECT
        f.codfal,
        f.desfal,
        f.tipfal,
        SUM(d.cantidad) AS cant_remalle
      FROM dbo.RCN_REM_PARTE_DET d
      JOIN dbo.RCN_REM_PARTE p ON d.partecod = p.partecod
      JOIN dbo.RCN_REM_FALLA f ON CAST(d.codfal AS VARCHAR(10)) = f.codfal
      WHERE UPPER(p.lotcod) = UPPER(@lotcod)
      GROUP BY f.codfal, f.desfal, f.tipfal
      ORDER BY f.codfal
    `);
  return r.recordset;
}

/**
 * Producto/OT de una tarjeta buscando PRIMERO en ZENTRIK (RCN_REM_PARTE)
 * y luego en Medidores_2023 si hace falta.
 * Devuelve { tarjeta, otcod, producto, nombre, titulo } o null.
 */
export async function getInfoTarjeta(lotcod) {
  const pool = await getZentPool();

  // 1) Buscar en ZENTRIK
  const rz = await pool.request()
    .input('lotcod', sql.VarChar(50), String(lotcod))
    .query(`
      SELECT TOP 1
        p.lotcod  AS tarjeta,
        p.otcod,
        p.prodnom AS nombre
      FROM dbo.RCN_REM_PARTE p
      WHERE UPPER(p.lotcod) = UPPER(@lotcod)
      ORDER BY p.fecins DESC
    `);

  let info = rz.recordset[0] || null;

  // 2) Complementar con Medidores_2023 (VIEW_PRD_SCADA001)
  try {
    const med = await getMedPool();
    const rm = await med.request()
      .input('tarjeta', sql.VarChar(50), String(lotcod))
      .query(`
        SELECT TOP 1
          Tarjeta   AS tarjeta,
          OT        AS otcod,
          Producto  AS producto,
          Nombre    AS nombre
        FROM Medidores_2023.dbo.VIEW_PRD_SCADA001 WITH (NOLOCK)
        WHERE Tarjeta = @tarjeta
      `);

    const med1 = rm.recordset[0];
    if (med1) {
      if (!info) {
        info = {
          tarjeta: med1.tarjeta,
          otcod:   med1.otcod,
          producto: med1.producto,
          nombre:  med1.nombre,
        };
      } else {
        // Complementar lo que falta
        info.otcod    = info.otcod    || med1.otcod;
        info.producto = info.producto || med1.producto;
        info.nombre   = info.nombre   || med1.nombre;
      }
    }
  } catch (e) {
    console.warn('[revision/repo] No se pudo consultar Medidores_2023:', e.message);
  }

  return info;
}

/**
 * Última tarjeta registrada en VIEW_PRD_SCADA013 (Medidores_2023).
 */
export async function getUltimaTarjeta() {
  const med = await getMedPool();
  const r = await med.request().query(`
    SELECT TOP 1 tarjeta
    FROM [Medidores_2023].[dbo].[VIEW_PRD_SCADA013]
    WHERE fecins <= GETDATE()
    ORDER BY fecins DESC, tarjeta DESC
  `);
  return r.recordset[0]?.tarjeta || null;
}

/**
 * Filtra tarjetas agrupadas por OT desde VIEW_PRD_SCADA013.
 */
export async function filtrarTarjetas({ fecha, turno }) {
  const med = await getMedPool();
  let query = `
    SELECT DISTINCT tarjeta, otcod
    FROM [Medidores_2023].[dbo].[VIEW_PRD_SCADA013]
    WHERE fecins <= GETDATE()
  `;
  const request = med.request();
  if (fecha) {
    query += ` AND CONVERT(date, fecins) = @fecha`;
    request.input('fecha', sql.Date, fecha);
  }
  if (turno) {
    query += ` AND turins = @turno`;
    request.input('turno', sql.Int, parseInt(turno));
  }
  query += ` ORDER BY otcod, tarjeta`;

  const result = await request.query(query);

  // Agrupar tarjetas por OT
  const otMap = {};
  result.recordset.forEach(row => {
    const ot = row.otcod || 'SIN_OT';
    if (!otMap[ot]) otMap[ot] = { otcod: row.otcod, tarjetas: [] };
    otMap[ot].tarjetas.push(row.tarjeta);
  });

  const grupos = Object.values(otMap).map(g => ({
    otcod: g.otcod,
    lotes: g.tarjetas.length,
    tarjetas: g.tarjetas,
  }));

  return { grupos, totalTarjetas: result.recordset.length };
}


/* =====================================================================
   PARTES Y DETALLES DEL REVISOR (RCN_REV_*)
   ===================================================================== */

/** Crea cabecera de revisión y retorna rpartecod */
export async function insertRevParte({ srolcod, lotcod, placod }) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('srolcod', sql.BigInt, srolcod)
    .input('lotcod', sql.VarChar(50), String(lotcod))
    .input('placod', sql.VarChar(10), placod || 'RCN')
    .query(`
      INSERT INTO dbo.RCN_REV_PARTE(srolcod, lotcod, placod, fecins)
      VALUES (@srolcod, @lotcod, @placod, ${NOW_LOCAL_SQL});
      SELECT SCOPE_IDENTITY() AS rpartecod;
    `);
  return Number(r.recordset[0].rpartecod);
}

/** Busca parte abierto del revisor para esa tarjeta+srolcod */
export async function getRevParteAbierta(srolcod, lotcod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('srolcod', sql.BigInt, srolcod)
    .input('lotcod', sql.VarChar(50), String(lotcod))
    .query(`
      SELECT TOP 1 rpartecod, conforme, observaciones
      FROM dbo.RCN_REV_PARTE
      WHERE srolcod = @srolcod
        AND UPPER(lotcod) = UPPER(@lotcod)
        AND fecult IS NULL
      ORDER BY rpartecod DESC;
    `);
  return r.recordset[0] || null;
}

/** Detalles completos de un parte del revisor */
export async function getRevDetallesParte(rpartecod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('rpartecod', sql.BigInt, rpartecod)
    .query(`
      SELECT d.codfal, ISNULL(f.desfal, CONCAT('COD ', d.codfal)) AS desfal,
             UPPER(ISNULL(f.tipfal,'')) AS tipfal, d.cantidad
      FROM dbo.RCN_REV_PARTE_DET d
      LEFT JOIN dbo.RCN_REM_FALLA f ON f.codfal = d.codfal
      WHERE d.rpartecod = @rpartecod
      ORDER BY f.desfal, d.codfal;
    `);
  return r.recordset;
}

/**
 * Ajusta (delta) la cantidad de un detalle del revisor; crea si no existe.
 * Misma lógica que el remallador pero en tablas RCN_REV_*.
 */
export async function upsertRevDetalleDelta({ rpartecod, codfal, delta }) {
  const pool = await getZentPool();

  const sel = await pool.request()
    .input('rpartecod', sql.BigInt, rpartecod)
    .input('codfal', sql.VarChar(10), String(codfal))
    .query(`
      SELECT rdetcod, cantidad
      FROM dbo.RCN_REV_PARTE_DET WITH (UPDLOCK, HOLDLOCK)
      WHERE rpartecod = @rpartecod AND codfal = @codfal
    `);

  if (sel.recordset.length === 0) {
    if (delta <= 0) return 0;
    const ins = await pool.request()
      .input('rpartecod', sql.BigInt, rpartecod)
      .input('codfal', sql.VarChar(10), String(codfal))
      .input('cantidad', sql.Decimal(12, 2), delta)
      .query(`
        INSERT INTO dbo.RCN_REV_PARTE_DET(rpartecod, codfal, cantidad, fecins, fecult)
        VALUES (@rpartecod, @codfal, @cantidad, ${NOW_LOCAL_SQL}, ${NOW_LOCAL_SQL});
        SELECT @cantidad AS cantidad;
      `);
    return Number(ins.recordset[0].cantidad);
  }

  const actual = Number(sel.recordset[0].cantidad);
  const nuevo = Math.max(0, +(actual + delta).toFixed(2));

  await pool.request()
    .input('rdetcod', sql.BigInt, sel.recordset[0].rdetcod)
    .input('nuevo', sql.Decimal(12, 2), nuevo)
    .query(`
      UPDATE dbo.RCN_REV_PARTE_DET
      SET cantidad = @nuevo,
          fecult   = ${NOW_LOCAL_SQL}
      WHERE rdetcod = @rdetcod
    `);

  return nuevo;
}

/**
 * Establece la cantidad absoluta de un detalle del revisor.
 * Si no existe, crea. Si cantidad = 0 y existe, borra.
 */
export async function setRevDetalleCantidad({ rpartecod, codfal, cantidad }) {
  const pool = await getZentPool();
  const cant = Math.max(0, Number(cantidad) || 0);

  const sel = await pool.request()
    .input('rpartecod', sql.BigInt, rpartecod)
    .input('codfal', sql.VarChar(10), String(codfal))
    .query(`
      SELECT rdetcod
      FROM dbo.RCN_REV_PARTE_DET
      WHERE rpartecod = @rpartecod AND codfal = @codfal
    `);

  if (sel.recordset.length === 0) {
    if (cant <= 0) return 0;
    await pool.request()
      .input('rpartecod', sql.BigInt, rpartecod)
      .input('codfal', sql.VarChar(10), String(codfal))
      .input('cantidad', sql.Decimal(12, 2), cant)
      .query(`
        INSERT INTO dbo.RCN_REV_PARTE_DET(rpartecod, codfal, cantidad, fecins, fecult)
        VALUES (@rpartecod, @codfal, @cantidad, ${NOW_LOCAL_SQL}, ${NOW_LOCAL_SQL});
      `);
    return cant;
  }

  if (cant <= 0) {
    await pool.request()
      .input('rdetcod', sql.BigInt, sel.recordset[0].rdetcod)
      .query(`DELETE FROM dbo.RCN_REV_PARTE_DET WHERE rdetcod = @rdetcod`);
    return 0;
  }

  await pool.request()
    .input('rdetcod', sql.BigInt, sel.recordset[0].rdetcod)
    .input('cant', sql.Decimal(12, 2), cant)
    .query(`
      UPDATE dbo.RCN_REV_PARTE_DET
      SET cantidad = @cant, fecult = ${NOW_LOCAL_SQL}
      WHERE rdetcod = @rdetcod
    `);

  return cant;
}

/** Cierra el parte del revisor y marca conforme/no conforme */
export async function cerrarRevParte(rpartecod, conforme, observaciones) {
  const pool = await getZentPool();
  await pool.request()
    .input('rpartecod', sql.BigInt, rpartecod)
    .input('conforme', sql.Bit, conforme ? 1 : 0)
    .input('observaciones', sql.VarChar(500), observaciones ?? null)
    .query(`
      UPDATE dbo.RCN_REV_PARTE
      SET fecult = ${NOW_LOCAL_SQL},
          conforme = @conforme,
          observaciones = COALESCE(@observaciones, observaciones)
      WHERE rpartecod = @rpartecod;
    `);
  return { ok: true };
}

/** Obtiene todas las fallas del revisor para una tarjeta (todas las sesiones) */
export async function getRevisionFallasPorLote(lotcod) {
  const pool = await getZentPool();
  const r = await pool.request()
    .input('lotcod', sql.VarChar(50), String(lotcod))
    .query(`
      SELECT
        f.codfal,
        f.desfal,
        f.tipfal,
        SUM(d.cantidad) AS cant_revision
      FROM dbo.RCN_REV_PARTE_DET d
      JOIN dbo.RCN_REV_PARTE p ON d.rpartecod = p.rpartecod
      JOIN dbo.RCN_REM_FALLA f ON d.codfal = f.codfal
      WHERE UPPER(p.lotcod) = UPPER(@lotcod)
      GROUP BY f.codfal, f.desfal, f.tipfal
      ORDER BY f.codfal
    `);
  return r.recordset;
}
