/* =======================================================================
   SCRIPT DE MIGRACIÓN: RELLENAR otcod EN RCN_REM_PARTE
   Este script debe ejecutarse una sola vez en la BD ZENTRIK
   ======================================================================= */

-- Usar la BD de Zentrik
USE ZENTRIK;
GO

PRINT 'Buscando OTs en Medidores_2023 y actualizando ZENTRIK.dbo.RCN_REM_PARTE...';

-- Hacer un UPDATE usando un JOIN entre tu tabla local y la vista de SCADA externa
UPDATE P
SET P.otcod = V.OT
FROM dbo.RCN_REM_PARTE AS P
INNER JOIN Medidores_2023.dbo.VIEW_PRD_SCADA001 AS V
    ON P.lotcod = V.Tarjeta
WHERE P.otcod IS NULL; -- Solo actualizar los que estén vacíos

PRINT 'Actualización finalizada.';
GO
