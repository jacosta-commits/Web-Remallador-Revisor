/* =======================================================================
   ZENTRIK · RCN Remallado (modelo con SESION_ROL)
   EJECUTAR en la BD ZENTRIK.
   -----------------------------------------------------------------------
   IMPORTANTE (solo COMENTARIOS, no crea nada en APPSHEET001):
   - El catálogo de fallas NO se replica aquí.
     Se consulta desde:  APPSHEET001.dbo.fallas_remalle
       * codigo  -> (se guarda en ZENTRIK como RCN_REM_PARTE_DET.codfal)
       * defecto -> nombre/descripcion de la falla (para reportes)
       * tipo    -> unidad/tipo (ej. 'MALLA') para interpretar la cantidad
     No existe FK a esa tabla por ser cross-database. Si se requiere, se puede
     validar por aplicación o con un trigger en ZENTRIK (opcional).

   - El código de trabajador (RCN_REM_SESION.tracod) se valida/obtiene desde:
       APPSHEET001.dbo.VIEW_FISA_RRHH_TRABAJADOR (solo lectura)
     Tampoco se crea FK aquí.

   - Para mostrar nombres/unidades en los listados, hacer JOIN a
     ZENTRIK.dbo.RCN_REM_FALLA usando RCN_REM_PARTE_DET.codfal = codigo
   ======================================================================= */


/* ==============================================================
   1) Catálogo de roles (RM=Remallador, RV=Revisor)
   (tabla interna en ZENTRIK)
   ============================================================== */
IF OBJECT_ID('dbo.RCN_REM_ROL','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_REM_ROL(
    rolcod  CHAR(2)      NOT NULL,        -- 'RM','RV'
    rolnom  VARCHAR(60)  NOT NULL,
    rolstd  BIT          NOT NULL CONSTRAINT DF_RCN_REM_ROL_rolstd DEFAULT (1),
    CONSTRAINT PK_RCN_REM_ROL PRIMARY KEY (rolcod)
  );

  /* Datos mínimos 
  INSERT INTO dbo.RCN_REM_ROL(rolcod, rolnom) VALUES ('RM','Remallador');
  INSERT INTO dbo.RCN_REM_ROL(rolcod, rolnom) VALUES ('RV','Revisor');*/
END
GO


/* ==============================================================
   2) Sesión/turno del trabajador
   - tracod: código de trabajador (viene de APPSHEET001.dbo.VIEW_FISA_RRHH_TRABAJADOR)
   - turnum: 1,2,3,4,5,7,8
   ============================================================== */
IF OBJECT_ID('dbo.RCN_REM_SESION','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_REM_SESION(
    sescod  BIGINT        IDENTITY(1,1) NOT NULL,
    tracod  VARCHAR(30)   NOT NULL,             -- código RRHH (AppSheet)
    turnum  TINYINT       NOT NULL,             -- 1,2,3,4,5,7,8
    fecdia  DATE          NOT NULL,             -- fecha operativa
    fecini  DATETIME2(0)  NOT NULL CONSTRAINT DF_RCN_REM_SESION_fecini DEFAULT (SYSUTCDATETIME()),
    fecfin  DATETIME2(0)  NULL,
    devuuid CHAR(36)      NULL,                 -- opcional: dispositivo desde donde se creo el registro
    sesstd  BIT           NOT NULL CONSTRAINT DF_RCN_REM_SESION_sesstd DEFAULT (1),
    CONSTRAINT PK_RCN_REM_SESION PRIMARY KEY (sescod),
    CONSTRAINT CK_RCN_REM_SESION_turnum CHECK (turnum BETWEEN 1 AND 8)
  );

  /* Búsquedas por trabajador/fecha/turno */
  CREATE INDEX IX_RCN_REM_SESION_lookup 
    ON dbo.RCN_REM_SESION(tracod, fecdia, turnum) INCLUDE (sescod);

  /* Evita 2 sesiones abiertas para el mismo trabajador en la misma fecha+turno */
  CREATE UNIQUE INDEX UX_RCN_REM_SESION_abierta
    ON dbo.RCN_REM_SESION(tracod, fecdia, turnum)
    WHERE fecfin IS NULL;
END
GO


ALTER TABLE dbo.RCN_REM_SESION
  ADD active_jti VARCHAR(64) NULL; 

/* ==============================================================
   3) Tramos por rol dentro de la sesión (permite cambios de rol)
   ============================================================== */
IF OBJECT_ID('dbo.RCN_REM_SESION_ROL','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_REM_SESION_ROL(
    srolcod BIGINT        IDENTITY(1,1) NOT NULL,
    sescod  BIGINT        NOT NULL,
    rolcod  CHAR(2)       NOT NULL,             -- FK a catálogo interno de roles
    fecini  DATETIME2(0)  NOT NULL CONSTRAINT DF_RCN_REM_SESION_ROL_fecini DEFAULT (SYSUTCDATETIME()),
    fecfin  DATETIME2(0)  NULL,
    srolstd BIT           NOT NULL CONSTRAINT DF_RCN_REM_SESION_ROL_srolstd DEFAULT (1),
    CONSTRAINT PK_RCN_REM_SESION_ROL PRIMARY KEY (srolcod),
    CONSTRAINT FK_RCN_REM_SESION_ROL_sesion FOREIGN KEY (sescod)
      REFERENCES dbo.RCN_REM_SESION(sescod),
    CONSTRAINT FK_RCN_REM_SESION_ROL_rol FOREIGN KEY (rolcod)
      REFERENCES dbo.RCN_REM_ROL(rolcod)
  );

  /* Un rol “abierto” a la vez por sesión/rol */
  CREATE UNIQUE INDEX UX_RCN_REM_SESION_ROL_abierto
    ON dbo.RCN_REM_SESION_ROL(sescod, rolcod)
    WHERE fecfin IS NULL;

  CREATE INDEX IX_RCN_REM_SESION_ROL_sescod
    ON dbo.RCN_REM_SESION_ROL(sescod) INCLUDE (rolcod, fecini, fecfin);
END
GO

/* ==============================================================
   4) Parte (cabecera por envío / N° de lote)
   ============================================================== */
IF OBJECT_ID('dbo.RCN_REM_PARTE','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_REM_PARTE(
    partecod BIGINT       IDENTITY(1,1) NOT NULL,
    srolcod  BIGINT       NOT NULL,            -- tramo de rol que registró
    lotcod   VARCHAR(50)  NOT NULL,            -- N° de lote
    prodnom  VARCHAR(150) NULL,                -- nombre del producto (texto)
    otcod    VARCHAR(50)  NULL,                -- N° de Orden de Trabajo (OT)
    observaciones VARCHAR(500) NULL,           -- notas u observaciones del parte
    -- fecins: hora de CREACIÓN DE LA PARTE (primer "+")
    fecins   DATETIME2(0) NOT NULL CONSTRAINT DF_RCN_REM_PARTE_fecins
             DEFAULT (CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00') AS datetime2(0))),
    -- fecult: hora de CIERRE/ENVÍO de la parte (al presionar "Enviar")
    fecult   DATETIME2(0) NULL,
    parstd   BIT          NOT NULL CONSTRAINT DF_RCN_REM_PARTE_parstd DEFAULT (1),
    CONSTRAINT PK_RCN_REM_PARTE PRIMARY KEY (partecod),
    CONSTRAINT FK_RCN_REM_PARTE_srol FOREIGN KEY (srolcod)
      REFERENCES dbo.RCN_REM_SESION_ROL(srolcod)
  );

  /* Para el modal y consultas por fecha */
  CREATE INDEX IX_RCN_REM_PARTE_lote   ON dbo.RCN_REM_PARTE(lotcod);
  CREATE INDEX IX_RCN_REM_PARTE_fecins ON dbo.RCN_REM_PARTE(fecins);
  CREATE INDEX IX_RCN_REM_PARTE_fecult ON dbo.RCN_REM_PARTE(fecult);
END
ELSE
BEGIN
  /* Migración segura si ya existe la tabla */
  IF COL_LENGTH('dbo.RCN_REM_PARTE','fecins') IS NULL
  BEGIN
    ALTER TABLE dbo.RCN_REM_PARTE
      ADD fecins DATETIME2(0) NOT NULL
          CONSTRAINT DF_RCN_REM_PARTE_fecins
          DEFAULT (CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00') AS datetime2(0)));
    CREATE INDEX IX_RCN_REM_PARTE_fecins ON dbo.RCN_REM_PARTE(fecins);
  END

  IF COL_LENGTH('dbo.RCN_REM_PARTE','fecult') IS NULL
  BEGIN
    ALTER TABLE dbo.RCN_REM_PARTE
      ADD fecult DATETIME2(0) NULL;
    CREATE INDEX IX_RCN_REM_PARTE_fecult ON dbo.RCN_REM_PARTE(fecult);
  END

  IF COL_LENGTH('dbo.RCN_REM_PARTE','observaciones') IS NULL
  BEGIN
    ALTER TABLE dbo.RCN_REM_PARTE
      ADD observaciones VARCHAR(500) NULL;
  END

  /* Migración nueva columna otcod */
  IF COL_LENGTH('dbo.RCN_REM_PARTE','otcod') IS NULL
  BEGIN
    ALTER TABLE dbo.RCN_REM_PARTE
      ADD otcod VARCHAR(50) NULL;
  END
END
GO


/* ==============================================================
   5) Detalle de parte (fallas y cantidades)
   ============================================================== */
IF OBJECT_ID('dbo.RCN_REM_PARTE_DET','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_REM_PARTE_DET(
    detcod   BIGINT         IDENTITY(1,1) NOT NULL,
    partecod BIGINT         NOT NULL,
    codfal   INT            NOT NULL,              -- código de falla (catálogo externo)
    cantidad DECIMAL(12,2)  NOT NULL,              -- número; UND o YARD según “tipfal”
    fecins   DATETIME2(0)   NOT NULL CONSTRAINT DF_RCN_REM_PARTE_DET_fecins
             DEFAULT (CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00') AS datetime2(0))), -- 1er “+”
    fecult   DATETIME2(0)   NULL,                  -- último ajuste “+/-” previo a enviar
    detstd   BIT            NOT NULL CONSTRAINT DF_RCN_REM_PARTE_DET_detstd DEFAULT (1),
    CONSTRAINT PK_RCN_REM_PARTE_DET PRIMARY KEY (detcod),
    CONSTRAINT FK_RCN_REM_PARTE_DET_parte FOREIGN KEY (partecod)
      REFERENCES dbo.RCN_REM_PARTE(partecod) ON DELETE CASCADE,
    CONSTRAINT CK_RCN_REM_PARTE_DET_cantidad_nonneg CHECK (cantidad >= 0)
  );

  /* Una fila por (parte, falla) */
  ALTER TABLE dbo.RCN_REM_PARTE_DET
    ADD CONSTRAINT UQ_RCN_REM_PARTE_DET_parte_falla UNIQUE (partecod, codfal);

  /* Índices habituales + por hora de ajuste */
  CREATE INDEX IX_RCN_REM_PARTE_DET_parte  ON dbo.RCN_REM_PARTE_DET(partecod);
  CREATE INDEX IX_RCN_REM_PARTE_DET_falla  ON dbo.RCN_REM_PARTE_DET(codfal);
  CREATE INDEX IX_RCN_REM_PARTE_DET_fecult ON dbo.RCN_REM_PARTE_DET(fecult);
END
ELSE
BEGIN
  /* Migración segura si ya existe la tabla */
  IF COL_LENGTH('dbo.RCN_REM_PARTE_DET','fecins') IS NULL
  BEGIN
    ALTER TABLE dbo.RCN_REM_PARTE_DET
      ADD fecins DATETIME2(0) NOT NULL
          CONSTRAINT DF_RCN_REM_PARTE_DET_fecins
          DEFAULT (CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00') AS datetime2(0)));
  END

  IF COL_LENGTH('dbo.RCN_REM_PARTE_DET','fecult') IS NULL
  BEGIN
    ALTER TABLE dbo.RCN_REM_PARTE_DET
      ADD fecult DATETIME2(0) NULL;
    CREATE INDEX IX_RCN_REM_PARTE_DET_fecult ON dbo.RCN_REM_PARTE_DET(fecult);
  END
END
GO

/* 
   Nota de diseño:
   - Algunos códigos vienen con decimales (ej. 1.1). Para soportar ambos
     casos (enteros y con punto) usamos VARCHAR(10).
   - Tus detalles (RCN_REM_PARTE_DET.codfal) siguen siendo INT; en los
     JOINs haremos CAST del INT a VARCHAR(10) para poder empatar.
*/
CREATE TABLE dbo.RCN_REM_FALLA(
  codfal  VARCHAR(10)  NOT NULL,
  desfal  VARCHAR(150) NOT NULL,
  tipfal  VARCHAR(20)  NOT NULL,
  CONSTRAINT PK_RCN_REM_FALLA PRIMARY KEY (codfal)
);

INSERT INTO dbo.RCN_REM_FALLA (codfal, desfal, tipfal) VALUES
('1',   'M. HEXAGONAL',                               'MALLA'),
('2',   'NUDO FLOJO',                                  'MALLA'),
('3',   'M. CRUZADA',                                  'MALLA'),
('4',   'M. ENREDADA',                                 'MALLA'),
('5',   'M. TEMPLADA',                                 'MALLA'),
('6',   'M. GRANDE POR CAIDA DE PESA',                 'MALLA'),
('7',   'M.GRANDE POR NUDO O EMPATE',                  'MALLA'),
('8',   'M. ROTA',                                     'MALLA'),
('9',   'M. DEFORME',                                  'MALLA'),
('10',  'CORDEL CON PORCA TORSIÓN',                    'MALLA'),
('11',  'NUDO MONTADO',                                'MALLA'),
('12',  'ORILLO DEFECTUOSO',                           'MALLA'),
('13',  'M. CHICA',                                    'MALLA'),
('14',  'FALTA DE FILAMENTOS Y/O HILAZAS',             'MALLA'),
('15',  'PELUSEADO',                                   'MALLA'),
('16',  'EX. CRUCES Y/O MALA TORSIÓN',                 'MALLA'),
('17',  'MAL EMPATE',                                  'MALLA'),
('18',  'MEZCLA DE MATERIAL O CONTAMINACION',          'MALLA'),
('19',  'SIN ALMA',                                    'MALLA'),
('20',  'M. TEMPLADA A LO ANCHO - NOTORIA',            'MALLA'),
('21',  'M. CHICA A LO ANCHO',                         'MALLA'),
('22',  'M. GRANDE A LO ANCHO',                        'MALLA'),
('23',  'M. GRANDE',                                   'MALLA'),
('24',  'MALLA CORRIDA',                               'MALLA'),
('25',  'SIN FALLAS',                                  'MALLA'),
('39',  'MAL REMALLADO',                               'MALLA'),
('40',  'MEZCLA DE TITULO',                            'MALLA'),
('41',  'CONTAMINACIÓN DE MATERIAL',                   'MALLA'),
('42',  'MALA COMPOSICIÓN',                            'MALLA'),
('43',  'LAZO',                                        'MALLA'),
('1.1', 'M. HEXAGONAL - YARDAS',                       'YARDA'),
('2.1', 'NUDO FLOJO - YARDAS',                         'YARDA'),
('3.1', 'M. CRUZADA - YARDAS',                         'YARDA'),
('4.1', 'M. ENREDADA - YARDAS',                        'YARDA'),
('5.1', 'M. TEMPLADA - YARDAS',                        'YARDA'),
('8.1', 'M. ROTA - YARDAS',                            'YARDA'),
('9.1', 'M. DEFORME - YARDAS',                         'YARDA'),
('10.1','CORDEL CON POCA TORSIÓN - YARDAS',            'YARDA'),
('11.1','NUDO MONTADO - YARDAS',                       'YARDA'),
('12.1','ORILLO DEFECTUOSO - YARDAS',                  'YARDA'),
('13.1','M. CHICA - YARDAS',                           'YARDA'),
('14.1','FALTA DE FILAMENTOS Y/O HILAZAS - YARDAS',    'YARDA'),
('15.1','PELUSEADO - YARDAS',                          'YARDA'),
('16.1','EXC. CRUCES Y/O MALA TORSIÓN - YARDAS',       'YARDA'),
('18.1','MEZCLA DE MATERIAL O CONTAMINACION - YARDAS', 'YARDA'),
('19.1','SIN ALMA - YARDAS',                           'YARDA'),
('23.1','M. GRANDE - YARDAS',                          'YARDA'),
('24.1','MALLA CORRIDA - YARDAS',                      'YARDA'),
('26.1','YARDAS SIN REFUERZO',                         'YARDA'),
('39.1','MAL REMALLADO - YARDAS',                      'YARDA'),
('40.1','MEZCLA DE TITULOS - YARDAS',                  'YARDA'),
('41.1','CONTAMINACIÓN DE MATERIAL - YARDAS',          'YARDA'),
('42.1','MALA COMPOSICIÓN - YARDAS',                   'YARDA');

-- Índices útiles
CREATE INDEX IX_RCN_REM_FALLA_tipfal ON dbo.RCN_REM_FALLA(tipfal);

