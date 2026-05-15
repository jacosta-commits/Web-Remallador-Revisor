/**
 * device.js — ID de dispositivo único y estable (web)
 * - Genera un UUID una sola vez por navegador y lo persiste.
 * - Usa localStorage si está disponible; además guarda cookie (2 años) como respaldo.
 * - Expone: window.deviceId y window.DEVICE.getId()
 */
(() => {
  const KEY = 'devuuid';

  function supportsLocalStorage() {
    try {
      localStorage.setItem('__test__', '1');
      localStorage.removeItem('__test__');
      return true;
    } catch {
      return false;
    }
  }

  function genUUID() {
    // Preferir crypto.randomUUID si existe
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback RFC-4122-ish
    const rnd = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
    return `${rnd()}${rnd()}-${rnd()}-${rnd()}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([$?*|{}\]\\^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
  }

  function persistId(id) {
    if (supportsLocalStorage()) {
      try { localStorage.setItem(KEY, id); } catch {}
    }
    // Cookie como respaldo por 730 días (~2 años)
    try { setCookie(KEY, id, 730); } catch {}
  }

  function loadId() {
    let id = null;
    // 1) Intentar localStorage
    if (supportsLocalStorage()) {
      try { id = localStorage.getItem(KEY); } catch {}
    }
    // 2) Intentar cookie
    if (!id) {
      try { id = getCookie(KEY); } catch {}
    }
    // 3) Generar si no existe
    if (!id) {
      id = genUUID();
      persistId(id);
    }
    return id;
  }

  const id = loadId();

  // Exponer global
  Object.defineProperty(window, 'deviceId', { value: id, writable: false, configurable: false });
  window.DEVICE = Object.freeze({
    key: KEY,
    id,
    getId: () => id
  });

  // Mantener sincronizado entre pestañas (por si se borra en otra)
  if (supportsLocalStorage()) {
    window.addEventListener('storage', (ev) => {
      if (ev.key === KEY && ev.newValue && ev.newValue !== id) {
        try { setCookie(KEY, ev.newValue, 730); } catch {}
      }
    });
  }
})();
