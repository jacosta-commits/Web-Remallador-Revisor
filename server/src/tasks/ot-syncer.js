import { getZentPool } from '../config/db.js';

/**
 * Busca registros en RCN_REM_PARTE que no tengan OT (NULL o vacío)
 * e intenta recuperarlos desde Medidores_2023.dbo.VIEW_PRD_SCADA001
 * buscando por lotcod (Tarjeta).
 * Solo revisa registros de los últimos 7 días.
 */
export async function syncMissingOTs() {
    try {
        const pool = await getZentPool();
        const result = await pool.request().query(`
      UPDATE P 
      SET P.otcod = V.OT 
      FROM dbo.RCN_REM_PARTE AS P 
      INNER JOIN Medidores_2023.dbo.VIEW_PRD_SCADA001 AS V ON P.lotcod = V.Tarjeta 
      WHERE (P.otcod IS NULL OR P.otcod = '') 
        AND P.fecins >= DATEADD(day, -7, GETDATE())
    `);

        if (result.rowsAffected[0] > 0) {
            console.log(`[OT-Syncer] Sincronización automática: ${result.rowsAffected[0]} registros actualizados.`);
        }
    } catch (error) {
        console.error('[OT-Syncer] Error durante la sincronización:', error.message);
    }
}

/**
 * Inicia el intervalo de sincronización (cada 5 minutos)
 */
export function startOTSyncer() {
    console.log('[OT-Syncer] Iniciado (frecuencia: 5 minutos)');

    // Ejecutar una vez al arrancar el servidor
    syncMissingOTs();

    // Programar cada 5 minutos
    setInterval(syncMissingOTs, 5 * 60 * 1000);
}
