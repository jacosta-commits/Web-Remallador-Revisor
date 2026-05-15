// server/src/server.js
import http from 'node:http';
import url from 'node:url';
import os from 'node:os';
import { WebSocketServer } from 'ws';
import app from './app.js';
import { env } from './config/env.js';
import { verify } from './lib/jwt.js';
import { registerWS } from './lib/ws.js';
import { getZentPool, sql } from './config/db.js';
import { startOTSyncer } from './tasks/ot-syncer.js';

// Iniciar procesos de fondo
startOTSyncer();

function firstLanIPv4() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const net of ifs[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '0.0.0.0';
}

const server = http.createServer(app);

// Afinar timeouts (conexiones lentas en LAN / móviles)
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;

// WebSocket en /ws?token=...
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  (async () => {
    try {
      const { pathname, query } = url.parse(req.url, true);
      if (pathname !== '/ws') {
        socket.destroy();
        return;
      }

      const token = query?.token;
      if (!token) {
        socket.destroy();
        return;
      }

      // 1) Verificar firma y extraer { sescod, jti, ... }
      let payload;
      try {
        payload = verify(token); // { sescod, tracod, jti }
      } catch {
        socket.destroy(); // token inválido/expirado
        return;
      }

      // 2) Validar contra DB: sesión abierta y jti vigente (single-login)
      const pool = await getZentPool();
      const r = await pool.request()
        .input('sescod', sql.BigInt, payload.sescod)
        .query(`
          SELECT active_jti, fecfin
          FROM dbo.RCN_REM_SESION WITH (NOLOCK)
          WHERE sescod = @sescod
        `);

      const row = r.recordset[0];
      if (!row || row.fecfin !== null || row.active_jti !== payload.jti) {
        // No autorizar WS (expulsado, sesión cerrada o token reemplazado)
        socket.destroy();
        return;
      }

      // 3) Upgrade aceptado
      wss.handleUpgrade(req, socket, head, (ws) => {
        // Guarda el usuario en la conexión WS (útil para logs/broadcasts)
        ws.user = payload; // { sescod, tracod, jti }

        // Opcional: heartbeat para detectar sockets colgados
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        // Registrar este WS (tu registerWS puede expulsar el anterior de esta sesión)
        registerWS(ws, payload.sescod);

        // Hola inicial
        try {
          ws.send(JSON.stringify({ type: 'hello', sescod: payload.sescod }));
        } catch { }

      });
    } catch {
      try { socket.destroy(); } catch { }
    }
  })();
});

// Heartbeat global (cada 30s) para cerrar inactivos
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch { }
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { }
  });
}, 30_000);

// Escuchar en todas las interfaces (LAN)
server.listen(env.PORT, '0.0.0.0', () => {
  const lan = firstLanIPv4();
  console.log(
    `RCN Remallado
  • Local:   http://localhost:${env.PORT}
  • Red LAN: http://${lan}:${env.PORT}
  • WS:      ws://${lan}:${env.PORT}/ws
  (listening on 0.0.0.0)`
  );
});

// Apagado elegante
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  clearInterval(interval);
  wss.close(() => server.close(() => process.exit(0)));
});
process.on('SIGTERM', () => {
  clearInterval(interval);
  wss.close(() => server.close(() => process.exit(0)));
});
