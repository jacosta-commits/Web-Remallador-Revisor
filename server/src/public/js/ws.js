// server/src/public/js/ws.js
// Cliente WS con reconexión básica y manejo de "logout/replaced"
const ws = {
  socket: null,
  _token: null,
  _retry: 0,
  _forcedClose: false,
  _timer: null,

  disableReconnect() {
    this._forcedClose = true;
    clearTimeout(this._timer);
    try { this.socket?.close(1000, 'disabled'); } catch { }
  },

  connect(token) {
    this._token = token;
    this._forcedClose = false;
    this._open();
  },

  _open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(this._token)}`;

    try {
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        this._retry = 0;
        console.log('[WS] abierto');
      };

      this.socket.onmessage = (ev) => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch { /* texto simple */ }

        if (!msg || typeof msg !== 'object') {
          console.log('[WS]', ev.data);
          return;
        }

        switch (msg.type) {
          case 'hello':
            // handshake OK
            break;

          case 'logout':
            console.warn('[WS] expulsado:', msg.reason || 'replaced');
            this._forcedClose = true;
            try { this.socket.close(4001, msg.reason || 'replaced'); } catch { }
            try { window.auth?.hardLogout?.(msg.reason || 'kicked'); } catch { }
            return; // no sigas procesando




          // Otros mensajes que quieras manejar:
          // case 'update': onUpdate(msg.data); break;

          default:
            console.log('[WS] msg', msg);
        }
      };

      this.socket.onclose = (ev) => {
        console.log('[WS] cerrado', ev.code, ev.reason || '');
        // expulsado por servidor → no reconectar y fuerza logout por si el mensaje no llegó
        if (ev.code === 4001) {
          this._forcedClose = true;
          try { window.auth?.hardLogout?.(ev.reason || 'kicked'); } catch { }
          return;
        }
        if (this._forcedClose) return; // cierre intencional
        this._scheduleReconnect();
      };

      this.socket.onerror = (err) => {
        console.warn('[WS] error', err);
        // El onclose igualmente disparará después
      };
    } catch (e) {
      console.warn('[WS] error al abrir', e);
      this._scheduleReconnect();
    }
  },

  _scheduleReconnect() {
    if (this._forcedClose) return; // no reintentes tras hardLogout/expulsión
    const delay = Math.min(8000, 1000 * Math.pow(2, this._retry++));
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (this._forcedClose) return;
      // solo reconecta si todavía hay token
      let t = null;
      try { t = window.auth?.getToken?.(); } catch { }
      if (!t) return; // sin token: hardLogout ya debió redirigir
      this._token = t;
      this._open();
    }, delay);
  },



  disconnect() {
    this._forcedClose = true;
    clearTimeout(this._timer);
    try { this.socket?.close(1000, 'client close'); } catch { }
    this.socket = null;
  },

  send(obj) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      const payload = (typeof obj === 'string') ? obj : JSON.stringify(obj);
      this.socket.send(payload);
      return true;
    } catch { return false; }
  }
};

window.ws = ws;
