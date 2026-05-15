import dotenv from 'dotenv';
dotenv.config();

const must = (k) => {
  const v = process.env[k];
  if (v === undefined) throw new Error(`Falta variable de entorno: ${k}`);
  return v;
};

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  JWT_SECRET: must('JWT_SECRET'),

  // ZENTRIK (escritura)
  SQL: {
    server: must('SQL_SERVER'),
    database: must('SQL_DB'),
    user: must('SQL_USER'),
    password: must('SQL_PASSWORD'),
    options: {
      encrypt: (process.env.SQL_ENCRYPT ?? 'false') === 'true',
      trustServerCertificate: (process.env.SQL_TRUST_CERT ?? 'true') === 'true'
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 30000,
    connectionTimeout: 15000
  },

  // MEDIDORES_2023 (solo lectura – revisión)
  MED_SQL: {
    server: process.env.MED_SQL_SERVER || process.env.SQL_SERVER,
    database: process.env.MED_SQL_DB || 'Medidores_2023',
    user: process.env.MED_SQL_USER || process.env.SQL_USER,
    password: process.env.MED_SQL_PASSWORD || process.env.SQL_PASSWORD,
    options: {
      encrypt: (process.env.MED_SQL_ENCRYPT ?? 'false') === 'true',
      trustServerCertificate: (process.env.MED_SQL_TRUST_CERT ?? 'true') === 'true'
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 30000,
    connectionTimeout: 15000
  },

  // APPSHEET001 (solo lectura)
  APP_SQL: {
    server: must('APP_SQL_SERVER'),
    database: must('APP_SQL_DB'),
    user: must('APP_SQL_USER'),
    password: must('APP_SQL_PASSWORD'),
    options: {
      encrypt: (process.env.APP_SQL_ENCRYPT ?? 'false') === 'true',
      trustServerCertificate: (process.env.APP_SQL_TRUST_CERT ?? 'true') === 'true'
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 30000,
    connectionTimeout: 15000
  }
};
