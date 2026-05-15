// Cliente ligero para llamadas HTTP desde el frontend

// === Autologin silencioso para reanudar sesión ===
async function __silentRelogin() {
  try {
    // Si se indicó explícitamente no reanudar (p. ej. al cerrar turno), no hagas nada
    try {
      if (localStorage.getItem('rcn:noResume') === '1') return false;
    } catch { }

    var codigo = null;
    var turnoStr = null;
    var devuuid = null;

    try { codigo = localStorage.getItem('rcn:lastCode'); } catch { }
    try { turnoStr = localStorage.getItem('rcn:lastTurno'); } catch { }
    try { devuuid = window.deviceId; } catch { }

    if (!codigo || !turnoStr || !devuuid) return false;
    var turno = Number(turnoStr) || 0;
    if (!turno) return false;

    // Llamar directo al login para evitar recursión con api.request()
    var res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: codigo, turno: turno, devuuid: devuuid, forceClose: true })
    });
    if (!res.ok) return false;

    var data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!data || !data.token) return false;

    // Guardar nueva sesión/token
    try {
      if (window.auth && typeof window.auth.save === 'function') {
        window.auth.save({
          token: data.token,
          sescod: data.sescod,
          trabajador: data.trabajador,
          roles: data.roles
        });
      }
      localStorage.setItem('rcn:sescod', String(data.sescod || ''));
    } catch { }

    // Reconectar WS si aplica
    try {
      if (window.ws && data.token && typeof window.ws.connect === 'function') {
        window.ws.connect(data.token);
      }
    } catch { }

    return true;
  } catch {
    return false;
  }
}

// --- helpers 401 ---
let __didHardLogout = false;
function __isOnLogin() { return /\/login\.html$/i.test(location.pathname); }


const api = {
  async request(method, url, body, __noRetry = false) {
    // headers + token actual
    const headers = { 'Content-Type': 'application/json' };
    let token = null;
    try {
      token = (window.auth && typeof window.auth.getToken === 'function') ? window.auth.getToken() : null;
    } catch { }
    if (token) headers.Authorization = 'Bearer ' + token;

    // 1er intento
    let res;
    try {
      res = await fetch(url, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (_) {
      throw new Error('No hay conexión con el servidor.');
    }

    // 204 No Content
    if (res.status === 204) return {};

    let ct = res.headers.get('content-type') || '';
    let isJson = ct.indexOf('application/json') >= 0;
    let payload = isJson ? await res.json().catch(function () { return {}; }) : await res.text();

    if (res.ok) return payload;

    // 401: intenta re-login silencioso SOLO si no venimos de un cierre forzado;
    // si falla, obliga logout duro + redirect siempre.
    if (res.status === 401 && url.indexOf('/api/login') === -1 && !__noRetry) {
      // si ya nos dijeron "no reanudar", no intentes relogin
      const noResume = (() => { try { return localStorage.getItem('rcn:noResume') === '1'; } catch { return false; } })();

      if (!noResume) {
        const relog = await __silentRelogin();
        if (relog) {
          // reconstruir headers con el nuevo token y reintentar UNA vez
          const headers2 = { 'Content-Type': 'application/json' };
          let newTok = null;
          try { newTok = (window.auth && typeof window.auth.getToken === 'function') ? window.auth.getToken() : null; } catch { }
          if (newTok) headers2.Authorization = 'Bearer ' + newTok;

          let res2;
          try {
            res2 = await fetch(url, { method, headers: headers2, body: body ? JSON.stringify(body) : undefined });
          } catch (_) {
            throw new Error('No hay conexión con el servidor.');
          }

          if (res2.status === 204) return {};
          const ct2 = res2.headers.get('content-type') || '';
          const isJson2 = ct2.indexOf('application/json') >= 0;
          const payload2 = isJson2 ? await res2.json().catch(() => ({})) : await res2.text();
          if (res2.ok) return payload2;
          // si el segundo intento también da 401 → cae al hardLogout de abajo
        }
      }

      // Llegar aquí significa: no reanudamos. Forzamos logout y redirect SIEMPRE.
      if (!__didHardLogout && !__isOnLogin()) {
        __didHardLogout = true;
        try { auth.hardLogout?.('unauthorized'); } catch { }
      }
      throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
    }


    const msg = (isJson && payload && payload.error) ? payload.error : ('HTTP ' + res.status);
    throw new Error(msg);
  },

  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); }
};

window.api = api;
