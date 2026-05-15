import sql from 'mssql';
import { env } from './env.js';

let zentPool, appPool;

export async function getZentPool() {
  if (zentPool) return zentPool;
  zentPool = await new sql.ConnectionPool(env.SQL).connect();
  return zentPool;
}

export async function getAppPool() {
  if (appPool) return appPool;
  appPool = await new sql.ConnectionPool(env.APP_SQL).connect();
  return appPool;
}

export { sql };
