/* =======================================================================
   ZENTRIK · RCN Remallado — Revisión (tablas del REVISOR)
   EJECUTAR en la BD ZENTRIK.
   ----------------------------------------------------------------------- 
   Estas tablas almacenan la conformidad/no-conformidad del Revisor
   sobre las fallas reportadas por los Remalladores.
   NO se modifica nada de RCN_REM_* (remallador).
   ======================================================================= */


/* ==============================================================
   1) Catálogo de Plantas (preparado para multi-planta)
   ============================================================== */
IF OBJECT_ID('dbo.RCN_REM_PLANTA','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_REM_PLANTA(
    placod  VARCHAR(10)  NOT NULL,       -- 'RCN', 'PLT2', etc.
    planom  VARCHAR(80)  NOT NULL,       -- 'RCN Remallado', 'Planta 2', ...
    plastd  BIT          NOT NULL CONSTRAINT DF_RCN_REM_PLANTA_plastd DEFAULT (1),
    CONSTRAINT PK_RCN_REM_PLANTA PRIMARY KEY (placod)
  );

  INSERT INTO dbo.RCN_REM_PLANTA(placod, planom) VALUES ('RCN', 'RCN Remallado');
END
GO


/* ==============================================================
   2) Cabecera de revisión (parte del Revisor)
   ============================================================== */
IF OBJECT_ID('dbo.RCN_REV_PARTE','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_REV_PARTE(
    rpartecod    BIGINT        IDENTITY(1,1) NOT NULL,
    srolcod      BIGINT        NOT NULL,              -- tramo de rol del revisor (FK a SESION_ROL)
    lotcod       VARCHAR(50)   NOT NULL,              -- tarjeta revisada
    placod       VARCHAR(10)   NOT NULL CONSTRAINT DF_RCN_REV_PARTE_placod DEFAULT ('RCN'),
    conforme     BIT           NULL,                  -- NULL=pendiente, 1=conforme, 0=no conforme
    observaciones VARCHAR(500) NULL,
    fecins       DATETIME2(0)  NOT NULL CONSTRAINT DF_RCN_REV_PARTE_fecins
                 DEFAULT (CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00') AS datetime2(0))),
    fecult       DATETIME2(0)  NULL,                  -- hora de cierre/envío
    rpstd        BIT           NOT NULL CONSTRAINT DF_RCN_REV_PARTE_rpstd DEFAULT (1),
    CONSTRAINT PK_RCN_REV_PARTE PRIMARY KEY (rpartecod),
    CONSTRAINT FK_RCN_REV_PARTE_srol FOREIGN KEY (srolcod)
      REFERENCES dbo.RCN_REM_SESION_ROL(srolcod),
    CONSTRAINT FK_RCN_REV_PARTE_planta FOREIGN KEY (placod)
      REFERENCES dbo.RCN_REM_PLANTA(placod)
  );

  CREATE INDEX IX_RCN_REV_PARTE_lote   ON dbo.RCN_REV_PARTE(lotcod);
  CREATE INDEX IX_RCN_REV_PARTE_fecins ON dbo.RCN_REV_PARTE(fecins);
  CREATE INDEX IX_RCN_REV_PARTE_fecult ON dbo.RCN_REV_PARTE(fecult);
END
GO


/* ==============================================================
   3) Detalle de fallas del Revisor
   ============================================================== */
IF OBJECT_ID('dbo.RCN_REV_PARTE_DET','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_REV_PARTE_DET(
    rdetcod    BIGINT         IDENTITY(1,1) NOT NULL,
    rpartecod  BIGINT         NOT NULL,
    codfal     VARCHAR(10)    NOT NULL,                -- misma referencia que RCN_REM_FALLA
    cantidad   DECIMAL(12,2)  NOT NULL,
    fecins     DATETIME2(0)   NOT NULL CONSTRAINT DF_RCN_REV_PARTE_DET_fecins
               DEFAULT (CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00') AS datetime2(0))),
    fecult     DATETIME2(0)   NULL,
    rdstd      BIT            NOT NULL CONSTRAINT DF_RCN_REV_PARTE_DET_rdstd DEFAULT (1),
    CONSTRAINT PK_RCN_REV_PARTE_DET PRIMARY KEY (rdetcod),
    CONSTRAINT FK_RCN_REV_PARTE_DET_parte FOREIGN KEY (rpartecod)
      REFERENCES dbo.RCN_REV_PARTE(rpartecod) ON DELETE CASCADE,
    CONSTRAINT UQ_RCN_REV_PARTE_DET UNIQUE (rpartecod, codfal),
    CONSTRAINT CK_RCN_REV_PARTE_DET_cant CHECK (cantidad >= 0)
  );

  CREATE INDEX IX_RCN_REV_PARTE_DET_parte  ON dbo.RCN_REV_PARTE_DET(rpartecod);
  CREATE INDEX IX_RCN_REV_PARTE_DET_falla  ON dbo.RCN_REV_PARTE_DET(codfal);
  CREATE INDEX IX_RCN_REV_PARTE_DET_fecult ON dbo.RCN_REV_PARTE_DET(fecult);
END
GO
