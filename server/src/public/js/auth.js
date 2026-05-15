// server/src/public/js/auth.js
const auth = {
  save({ token, sescod, trabajador, roles }) {
    localStorage.setItem('rcn.token', token);
    localStorage.setItem('rcn.sescod', String(sescod));
    localStorage.setItem('rcn.trab', JSON.stringify(trabajador || {}));
    localStorage.setItem('rcn.roles', JSON.stringify(roles || []));
    // Conectar/reconectar WS inmediatamente en esta pestaña
    try {
      if (window.ws && token) window.ws.connect(token);
    } catch { }
  },
  clear() {
    localStorage.removeItem('rcn.token');
    localStorage.removeItem('rcn.sescod');
    localStorage.removeItem('rcn.trab');
    localStorage.removeItem('rcn.roles');
    sessionStorage.removeItem('rcn.srolcod');
  },
  getToken() { return localStorage.getItem('rcn.token'); },
  getSession() { return { sescod: Number(localStorage.getItem('rcn.sescod')) }; },
  getUser() { return JSON.parse(localStorage.getItem('rcn.trab') || '{}'); },
};
window.auth = auth;

function __hardGoToLogin(reason = 'logout') {
  const ts = Date.now();
  const url = `/login.html?reason=${encodeURIComponent(reason)}&_=${ts}`;

  // 1) Si Fully Kiosk JS API está habilitada, úsala
  try {
    if (window.fully?.loadUrl) { window.fully.loadUrl(url); return; }
    if (window.FullyKiosk?.loadUrl) { window.FullyKiosk.loadUrl(url); return; }
  } catch { }

  // 2) Secuencia agresiva de redirección
  try { location.replace(url); return; } catch { }
  try { location.assign(url); return; } catch { }
  try { location.href = url; return; } catch { }

  // 3) Último recurso: meta refresh (algunas WebView lo acatan)
  try {
    const m = document.createElement('meta');
    m.httpEquiv = 'refresh';
    m.content = `0;url=${url}`;
    document.head.appendChild(m);
  } catch { }
}

auth.hardLogout = function hardLogout(reason = '') {
  if (window.__logoutLock) return;
  window.__logoutLock = true;

  try {
    // Señal: no reanudar sesión silenciosamente
    localStorage.setItem('rcn:noResume', '1');

    // Limpia credenciales
    localStorage.removeItem('rcn.token');
    localStorage.removeItem('rcn.sescod');
    localStorage.removeItem('rcn.trab');
    localStorage.removeItem('rcn.roles');
    sessionStorage.removeItem('rcn.srolcod');
  } catch { }

  // Deshabilita reconexión WS
  try {
    window.ws?.disableReconnect?.();
    window.ws?.disconnect?.();
  } catch { }

  // Evita redirect loop: si ya estás en login, no redirijas otra vez
  const isOnLogin = /\/login\.html$/i.test(location.pathname);
  if (!isOnLogin) {
    __hardGoToLogin(reason || 'logout');
  }
};

/** Auto-conectar WS en cualquier página que cargue y tenga token */
(function bootWS() {
  const start = () => {
    const t = auth.getToken?.();
    if (t && window.ws) {
      const s = window.ws.socket;
      const need =
        !s ||
        s.readyState === WebSocket.CLOSING ||
        s.readyState === WebSocket.CLOSED;
      if (need) {
        try { window.ws.connect(t); } catch { }
      }
    }
  };

  // Al cargar la página
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // Sincronizar entre pestañas: si se borra/actualiza el token en otra, actuamos aquí
  window.addEventListener('storage', (ev) => {
    if (ev.key === 'rcn.token') {
      const newToken = ev.newValue;
      if (!newToken) {
        try { auth.hardLogout?.('token-removed'); } catch { }
      } else {
        try { window.ws?.connect?.(newToken); } catch { }
      }
    }
  });

  // Reintenta conectar al volver al foco (útil en móviles)
  window.addEventListener('focus', () => {
    try {
      const t = auth.getToken?.();
      if (t && window.ws) window.ws.connect(t);
    } catch { }
  });
})();
