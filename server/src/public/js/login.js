// server/src/public/js/login.js
(() => {
  const $ = (id) => document.getElementById(id);

  // Turnos permitidos (sin el 6)
  const ALLOWED_TURNS = [1, 2, 3, 4, 5, 7, 8];

  // Renderiza los turnos permitidos y recuerda el último seleccionado
  const $turnos = $('turnos');
  const lastTurnoRaw = Number(localStorage.getItem('rcn:lastTurno')) || 1;
  const lastTurno = ALLOWED_TURNS.includes(lastTurnoRaw) ? lastTurnoRaw : ALLOWED_TURNS[0];

  if ($turnos) {
    $turnos.innerHTML = '';
    ALLOWED_TURNS.forEach((n) => {
      const id = `t${n}`;
      $turnos.insertAdjacentHTML(
        'beforeend',
        `
        <input id="${id}" class="kbd-opt" name="turno" type="radio" value="${n}" ${n === lastTurno ? 'checked' : ''}>
        <label for="${id}" class="kbd-lbl">${n}</label>
        `
      );
    });
  }

  const $codigo = $('codigo');
  const $btnLogin = $('btnLogin');
  const $msg = $('msg');
  const $whois = $('whois');

  const setMsg = (text) => { if ($msg) $msg.textContent = text || ''; };

  const setLoading = (v) => {
    if (!$btnLogin) return;
    $btnLogin.disabled = v;
    $btnLogin.classList.toggle('is-loading', v);
  };

  // === WHOIS en vivo ========================================================
  let whoisTimer = null;
  let lastQuery = '';
  let lastShownCode = '';

  function renderWhois({ code, name, ok, clear = false }) {
    if (!$whois) return;
    if (clear) {
      $whois.className = 'whois-chip';
      $whois.textContent = '';
      $whois.classList.remove('show');
      lastShownCode = '';
      return;
    }
    const cls = ok ? 'whois-chip ok show' : 'whois-chip bad show';
    $whois.className = cls;
    $whois.innerHTML = ok
      ? `<strong class="name">${name}</strong>`
      : `<span class="code">Código ${code}</span><strong class="name">No encontrado</strong>`;
    lastShownCode = String(code);
  }

  async function lookupTrabajadorLive(codigo5) {
    const code = String(codigo5).padStart(5, '0');
    try {
      const res = await fetch(`/api/ext/trabajador?codigo=${encodeURIComponent(code)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (res.ok) {
        const t = await res.json();
        const tracod = String((t?.tracod || '')).trim();
        renderWhois({ code: tracod || code, name: t?.nombre || '', ok: true });
        return;
      }
      if (res.status === 404) {
        renderWhois({ code, ok: false });
        return;
      }
      let payload = {};
      try { payload = await res.json(); } catch { }
      console.error('[whois] HTTP', res.status, payload);
      renderWhois({ code, ok: false });
    } catch (e) {
      console.error('[whois] fetch error', e);
      renderWhois({ code: String(codigo5).padStart(5, '0'), ok: false });
    }
  }

  // Solo dígitos + lookup con debounce mientras escribe
  if ($codigo) {
    $codigo.addEventListener('input', () => {
      // normaliza entrada
      let v = String($codigo.value || '').replace(/\D/g, '').slice(0, 5);
      if ($codigo.value !== v) $codigo.value = v;

      setMsg(''); // limpia error previo

      if (!v) { // vacío
        if (whoisTimer) clearTimeout(whoisTimer);
        renderWhois({ clear: true });
        lastQuery = '';
        return;
      }

      // Debounce para no saturar el endpoint
      if (whoisTimer) clearTimeout(whoisTimer);
      whoisTimer = setTimeout(() => {
        // Evita consultas duplicadas
        if (v === lastQuery) return;
        lastQuery = v;
        lookupTrabajadorLive(v);
      }, 250);
    });

    // Evitar que Enter dispare el login (no hace nada)
    $codigo.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        // no action
      }
    });

    // Bloquea teclas no numéricas al teclear
    $codigo.addEventListener('keypress', (ev) => {
      if (!/\d/.test(ev.key)) ev.preventDefault();
    });
  }

  // === Login ================================================================
  async function loginOnce({ codigo, turno, forceClose = false }) {
    const devuuid = window.deviceId; // de device.js
    return api.post('/api/login', { codigo, turno, devuuid, forceClose });
  }

  async function doLogin() {
    const raw = ($codigo?.value || '').trim();
    const codigo = raw.padStart(5, '0');
    const turnoSel = document.querySelector('input[name="turno"]:checked');
    const turno = Number(turnoSel?.value);

    setMsg('');

    if (!raw) {
      setMsg('Ingresa tu código FISA.');
      $codigo?.focus();
      return;
    }
    if (!ALLOWED_TURNS.includes(turno)) {
      setMsg('Selecciona tu turno (1,2,3,4,5,7 u 8).');
      return;
    }

    setLoading(true);
    try {
      // persistir último turno
      localStorage.setItem('rcn:lastTurno', String(turno));

      // 1er intento
      let data;
      try {
        data = await loginOnce({ codigo, turno, forceClose: false });
      } catch (e1) {
        const emsg = String(e1?.message || '');
        const isOpenElsewhere = /otro dispositivo/i.test(emsg) || /sesión ya abierta/i.test(emsg);

        if (isOpenElsewhere) {
          const ok = window.confirm(
            'Esta sesión ya está abierta en otro dispositivo.\n¿Deseas cerrarla para continuar en este dispositivo?'
          );
          if (!ok) {
            setMsg('Inicio cancelado por el usuario.');
            setLoading(false);
            return;
          }
          // Reintento con cierre forzado
          data = await loginOnce({ codigo, turno, forceClose: true });
        } else {
          throw e1;
        }
      }

      // Guardar credenciales mínimas
      auth.save({
        token: data.token,
        sescod: data.sescod,
        trabajador: data.trabajador,
        roles: data.roles
      });
      // === datos para reanudar sesión sin pasar por login ===
      try {
        localStorage.setItem('rcn:lastCode', codigo);               // ej. "00023"
        localStorage.setItem('rcn:lastTurno', String(turno));       // ej. "3"
        localStorage.setItem('rcn:sescod', String(data.sescod || ''));
      } catch { }
      try { localStorage.removeItem('rcn:noResume'); } catch { }

      // Conectar WebSocket si está disponible
      if (window.ws && data?.token) {
        try { window.ws.connect(data.token); } catch { /* noop */ }
      }

      // Ir a selección de rol
      location.href = '/role.html';
    } catch (e) {
      setMsg(e?.message || 'No se pudo iniciar sesión. Reintenta.');
      console.error('[login] error', e);
    } finally {
      setLoading(false);
    }
  }

  $btnLogin?.addEventListener('click', doLogin);
})();

// --- Ajuste automático para que el panel quepa en altura sin scroll ---
(function fitLoginCard() {
  const card = document.getElementById('loginCard');
  if (!card) return;
  const apply = () => {
    card.style.transform = 'scale(1)';
    const h = card.getBoundingClientRect().height;
    const avail = window.innerHeight - 24; // margen de seguridad
    const s = Math.min(1, avail / h);
    card.style.transform = `scale(${s})`;
  };
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  setTimeout(apply, 0);
})();
