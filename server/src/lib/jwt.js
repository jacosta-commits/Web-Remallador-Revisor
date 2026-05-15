// server/src/lib/jwt.js
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ALG = 'HS256';
const TTL = '12h';

export function createToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { algorithm: ALG, expiresIn: TTL });
}

export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: [ALG] });
}

// === Aliases de compatibilidad (para código existente) ===
export const verify = verifyToken;  // <— esto resuelve tu import en server.js

// Utilidades opcionales
export function decodeToken(token) {
  try { return jwt.decode(token); } catch { return null; }
}
export function bearerFrom(req) {
  const h = req.headers?.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
