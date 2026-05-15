// server/src/lib/ws.js
// Gestión de conexiones WebSocket del lado servidor:
// - Un solo WS por sesión (sescod)
// - Evita patearte a ti mismo en reconexiones con el mismo jti
// - Expulsión por sesión o por trabajador (tracod), con opción de excluir un jti

import { WebSocket } from 'ws';

const clientBySession = new Map(); // sescod -> ws

function isOpen(ws) {
  return ws && ws.readyState === WebSocket.OPEN;
}

function safeSend(ws, data) {
  try {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    ws.send(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Registra una conexión WS para la sesión dada.
 * Si ya existía otra conexión para la misma sescod:
 *  - Si el jti es IGUAL (reconexión del mismo login) => cerrar en silencio (sin "logout")
 *  - Si el jti es DISTINTO => enviar "logout" y cerrar (expulsión real)
 */
export function registerWS(ws, sescod) {
  const prev = clientBySession.get(sescod);

  if (prev && isOpen(prev)) {
    const prevJti = prev?.user?.jti;
    const newJti  = ws?.user?.jti;

    if (prevJti && newJti && prevJti === newJti) {
      // MISMO login (reconnect): NO mandamos "logout" para no botarnos a nosotros mismos
      try { prev.close(4000, 'reconnect'); } catch {}
    } else {
      // Login distinto: expulsión real
      safeSend(prev, { type: 'logout', reason: 'replaced' });
      try { prev.close(4001, 'replaced'); } catch {}
    }
  }

  clientBySession.set(sescod, ws);

  ws.on('close', () => {
    if (clientBySession.get(sescod) === ws) {
      clientBySession.delete(sescod);
    }
  });
}

/** Expulsa la conexión WS de una sesión específica. */
export function kickBySession(sescod, reason = 'replaced') {
  const ws = clientBySession.get(sescod);
  if (isOpen(ws)) {
    safeSend(ws, { type: 'logout', reason });
    try { ws.close(4001, reason); } catch {}
    clientBySession.delete(sescod);
    return 1;
  }
  clientBySession.delete(sescod);
  return 0;
}

/**
 * Expulsa TODAS las conexiones WS asociadas a un trabajador (tracod).
 * Requiere que en server.js, al aceptar el upgrade, hagas: ws.user = payload (incluye tracod y jti).
 */
export function kickByTracod(tracod, reason = 'replaced') {
  let n = 0;
  for (const [sescod, ws] of clientBySession.entries()) {
    if (ws?.user?.tracod === tracod) {
      if (isOpen(ws)) {
        safeSend(ws, { type: 'logout', reason });
        try { ws.close(4001, reason); } catch {}
      }
      clientBySession.delete(sescod);
      n++;
    }
  }
  return n;
}

/**
 * Expulsa TODAS las conexiones WS de un trabajador, EXCEPTO la que tenga el jti indicado.
 * Útil justo después de /api/login para no patear la conexión nueva.
 */
export function kickByTracodExceptJti(tracod, keepJti, reason = 'replaced') {
  let n = 0;
  for (const [sescod, ws] of clientBySession.entries()) {
    const u = ws?.user;
    if (u?.tracod === tracod && u?.jti !== keepJti) {
      if (isOpen(ws)) {
        safeSend(ws, { type: 'logout', reason });
        try { ws.close(4001, reason); } catch {}
      }
      clientBySession.delete(sescod);
      n++;
    }
  }
  return n;
}

/** Envía un mensaje a la sesión actual (si tiene WS abierto). */
export function broadcastToSession(sescod, data) {
  const ws = clientBySession.get(sescod);
  if (isOpen(ws)) safeSend(ws, data);
}
