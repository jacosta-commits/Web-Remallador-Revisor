// server/src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import api from './routes.js';

const app = express();

// --- seguridad mínima para HTTP (sin forzar HTTPS ni agentes aislados)
app.disable('x-powered-by');
app.use(helmet({
  hsts: false,
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
  crossOriginResourcePolicy: false
}));

// CORS y JSON
app.use(cors());
app.use(express.json());

// --- API (mantén ambas rutas por compatibilidad)
app.use('/api', api);
app.use('/api/v1', api);

// --- Static: frontend
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(__dirname, 'public');

// ⚠️ Clave: no cachear HTML (Fully Kiosk)
// (y sí cachear fuerte assets estáticos para performance)
app.use(express.static(pub, {
  index: false,
  fallthrough: true,
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf)$/i.test(filePath)) {
      // puedes ajustar el max-age si quieres
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Helper para enviar HTML con no-store también cuando usamos sendFile
function sendNoStoreHtml(res, fullPath) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return res.sendFile(fullPath);
}

// Home → login (sin caché)
app.get('/', (req, res) => sendNoStoreHtml(res, path.join(pub, 'login.html')));

// 404 para rutas no encontradas (sirve login si pides HTML) (sin caché)
app.use((req, res, next) => {
  if (req.accepts('html')) {
    return sendNoStoreHtml(res, path.join(pub, 'login.html'));
  }
  next();
});

export default app;
