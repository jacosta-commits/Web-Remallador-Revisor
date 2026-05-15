// Lógica de autenticación y cambio de rol
import { getZentPool, sql } from '../../config/db.js';
import { TODAY_LOCAL_SQL, NOW_LOCAL_SQL } from '../../config/time.js';
import { getTrabajadorByCodigo } from '../ext/service.js';

/* ============================================================
   Helpers
   ============================================================ */
function fallbackRoles() {
  return [
    { rolcod: 'RM', rolnom: 'Remallador' },
    { rolcod: 'RV', rolnom: 'Revisor' },
  ];
}
function fail(code, message, info = undefined) {
  const err = new Error(message || code);
  err.code = code;
  if (info) err.info = info;
  return err;
}

/* ============================================================
   Catálogo de roles
   ============================================================ */
export async function listarRolesActivos() {
  const pool = await getZentPool();
  const r = await pool.request().query(`
    SELECT rolcod, rolnom
    FROM dbo.RCN_REM_ROL WITH (NOLOCK)
    WHERE rolstd = 1
    ORDER BY rolcod;
  `);
  return r.recordset.length ? r.recordset : fallbackRoles();
}

/* ============================================================
   Inicio de sesión (con control de dispositivo) - ATÓMICO
   ============================================================ */
/**
 * Reglas:
 * - 1 sola sesión abierta por trabajador (independiente del turno).
 * - Si existe abierta en otro día → se cierran TODAS y se crea nueva para hoy.
 * - Si existe abierta hoy:
 *    a) mismo devuuid o legacy NULL → reutilizar
 *    b) distinto devuuid:
 *       - forceClose === true → cerrar TODAS y crear nueva para este dispositivo
 *       - else → error 'SESSION_OPEN_OTHER_DEVICE'
 *
 * Además: setea active_jti DENTRO de la misma transacción.
 */
export async function loginService({ codigo, turno, devuuid, forceClose = false, jti }) {
  if (!codigo) throw new Error('Falta código');
  if (!turno || turno < 1 || turno > 8) throw new Error('Turno inválido');
  if (!jti) throw new Error('Falta jti'); // lo genera routes.js

  // 1) Validar trabajador (AppSheet u origen externo)
  const trabajador = await getTrabajadorByCodigo(codigo);
  if (!trabajador) throw new Error('Código FISA no encontrado');

  const pool = await getZentPool();

  // === TRANSACCIÓN: cerrar/crear/reusar + set active_jti (todo junto)
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const todayRes = await (new sql.Request(tx)).query(`SELECT ${TODAY_LOCAL_SQL} AS today;`);
    const today = String(todayRes.recordset[0].today).slice(0, 10);

    // Sesión abierta (si hubiera). UPDLOCK+HOLDLOCK para serializar.
    const open = await (new sql.Request(tx))
      .input('tracod', sql.VarChar(30), trabajador.tracod)
      .query(`
        SELECT TOP (1)
          sescod, turnum, fecdia, fecini, devuuid
        FROM dbo.RCN_REM_SESION WITH (UPDLOCK, HOLDLOCK)
        WHERE tracod = @tracod AND fecfin IS NULL
        ORDER BY fecini DESC;
      `);

    let sescod;

    // Cierra TODAS las sesiones abiertas del trabajador y sus tramos de rol abiertos
    const closeAllOpenForTracod = async () => {
      const req = new sql.Request(tx).input('tracod', sql.VarChar(30), trabajador.tracod);
      // 1) Cerrar tramos (rol) de esas sesiones
      await req.query(`
        UPDATE R
          SET fecfin = ${NOW_LOCAL_SQL}
        FROM dbo.RCN_REM_SESION_ROL AS R
        INNER JOIN dbo.RCN_REM_SESION AS S
          ON S.sescod = R.sescod
        WHERE S.tracod = @tracod
          AND S.fecfin IS NULL
          AND R.fecfin IS NULL;
      `);
      // 2) Cerrar sesiones
      await req.query(`
        UPDATE dbo.RCN_REM_SESION
        SET fecfin = ${NOW_LOCAL_SQL}
        WHERE tracod = @tracod
          AND fecfin IS NULL;
      `);
    };

    if (open.recordset.length) {
      const row = open.recordset[0];
      const fecdiaStr = String(row.fecdia).slice(0, 10);
      const openDev = (row.devuuid || '').trim();
      const curDev  = (devuuid || '').trim();

      if (fecdiaStr !== today) {
        // Otro día → cerrar todas y crear nueva
        await closeAllOpenForTracod();

        const ins = await (new sql.Request(tx))
          .input('tracod', sql.VarChar(30), trabajador.tracod)
          .input('turnum', sql.TinyInt, turno)
          .input('devuuid', sql.Char(36), curDev || null)
          .query(`
            INSERT INTO dbo.RCN_REM_SESION (tracod, turnum, fecdia, fecini, devuuid)
            VALUES (@tracod, @turnum, ${TODAY_LOCAL_SQL}, ${NOW_LOCAL_SQL}, @devuuid);
            SELECT SCOPE_IDENTITY() AS sescod;
          `);
        sescod = Number(ins.recordset[0].sescod);

      } else {
        // Mismo día
        if (!openDev || !curDev || openDev === curDev) {
          // Reutilizar la misma sesión
          sescod = Number(row.sescod);
        } else {
          // Distinto dispositivo
          if (forceClose === true) {
            await closeAllOpenForTracod();

            const ins = await (new sql.Request(tx))
              .input('tracod', sql.VarChar(30), trabajador.tracod)
              .input('turnum', sql.TinyInt, turno)
              .input('devuuid', sql.Char(36), curDev || null)
              .query(`
                INSERT INTO dbo.RCN_REM_SESION (tracod, turnum, fecdia, fecini, devuuid)
                VALUES (@tracod, @turnum, ${TODAY_LOCAL_SQL}, ${NOW_LOCAL_SQL}, @devuuid);
                SELECT SCOPE_IDENTITY() AS sescod;
              `);
            sescod = Number(ins.recordset[0].sescod);
          } else {
            throw fail(
              'SESSION_OPEN_OTHER_DEVICE',
              'Sesión ya abierta en otro dispositivo',
              {
                sescod: Number(row.sescod),
                turnum: row.turnum,
                fecdia: fecdiaStr,
                fecini: row.fecini,
                devuuid: openDev
              }
            );
          }
        }
      }
    } else {
      // No hay abiertas → crear nueva
      const ins = await (new sql.Request(tx))
        .input('tracod', sql.VarChar(30), trabajador.tracod)
        .input('turnum', sql.TinyInt, turno)
        .input('devuuid', sql.Char(36), (devuuid || '').trim() || null)
        .query(`
          INSERT INTO dbo.RCN_REM_SESION (tracod, turnum, fecdia, fecini, devuuid)
          VALUES (@tracod, @turnum, ${TODAY_LOCAL_SQL}, ${NOW_LOCAL_SQL}, @devuuid);
          SELECT SCOPE_IDENTITY() AS sescod;
        `);
      sescod = Number(ins.recordset[0].sescod);
    }

    // Set active_jti en la sesión usada/creada (dentro de la misma TX)
    await (new sql.Request(tx))
      .input('sescod', sql.BigInt, sescod)
      .input('jti', sql.VarChar(64), jti)
      .query('UPDATE dbo.RCN_REM_SESION SET active_jti = @jti WHERE sescod = @sescod;');

    await tx.commit();

    // Devuelve catálogo de roles activo
    const roles = await listarRolesActivos();
    return { sescod, trabajador, roles };

  } catch (err) {
    try { await tx.rollback(); } catch {}
    throw err;
  }
}

/* ============================================================
   Cambio de rol
   ============================================================ */
export async function cambiarRolService({ sescod, rolcod }) {
  if (!sescod) throw new Error('Falta sescod');
  if (!rolcod) throw new Error('Falta rol');

  const pool = await getZentPool();

  // Cierra tramo abierto (si lo hubiera)
  await pool.request()
    .input('sescod', sql.BigInt, sescod)
    .query(`
      UPDATE dbo.RCN_REM_SESION_ROL
      SET fecfin = ${NOW_LOCAL_SQL}
      WHERE sescod = @sescod AND fecfin IS NULL;
    `);

  const ins = await pool.request()
    .input('sescod', sql.BigInt, sescod)
    .input('rolcod', sql.Char(2), rolcod)
    .query(`
      INSERT INTO dbo.RCN_REM_SESION_ROL (sescod, rolcod, fecini)
      VALUES (@sescod, @rolcod, ${NOW_LOCAL_SQL});
      SELECT SCOPE_IDENTITY() AS srolcod;
    `);

  return { srolcod: Number(ins.recordset[0].srolcod) };
}

/* ============================================================
   Cierre de sesión
   ============================================================ */
export async function cerrarSesionService(sescod) {
  const pool = await getZentPool();
  await pool.request()
    .input('sescod', sql.BigInt, sescod)
    .query(`
      UPDATE dbo.RCN_REM_SESION_ROL
      SET fecfin = ISNULL(fecfin, ${NOW_LOCAL_SQL})
      WHERE sescod = @sescod AND fecfin IS NULL;

      UPDATE dbo.RCN_REM_SESION
      SET fecfin = ${NOW_LOCAL_SQL}
      WHERE sescod = @sescod AND fecfin IS NULL;
    `);
  return true;
}
