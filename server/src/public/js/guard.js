// /js/guard.js
(() => {
  const path = location.pathname;

  // Vistas que requieren tener tramo de rol seleccionado
  const needRole = ['/remallado.html', '/resumen.html'];

  // Páginas públicas (no requieren token)
  const publicPaths = new Set(['/login.html', '/']);

  // Flag para NO reanudar (se pone al cerrar turno)
  const noResume = (() => {
    try { return localStorage.getItem('rcn:noResume') === '1'; } catch { return false; }
  })();

  function hasToken() {
    try {
      return !!(window.auth && typeof window.auth.getToken === 'function' && window.auth.getToken());
    } catch { return false; }
  }

  // Reanudación SOLO si hay lastCode + lastTurno (nada de sescod)
  function canResume() {
    try {
      const lastCode = localStorage.getItem('rcn:lastCode');
      const lastTurno = localStorage.getItem('rcn:lastTurno');
      return !!(lastCode && lastTurno);
    } catch { return false; }
  }

  function redirect(url) {
    try {
      if (typeof __hardGoToLogin === 'function' && /login\.html/i.test(url)) {
        __hardGoToLogin('guard');
        return;
      }
    } catch { }
    try { location.replace(url); } catch { location.href = url; }
  }


  function check(tries = 0) {
    const token = hasToken();

    // 1) Si estamos en login y ya hay token o podemos reanudar (y NO venimos de "cerrar turno"), saltar a role
    if (path === '/login.html') {
      if (!noResume && (token || canResume())) {
        return redirect('/role.html');
      }
      return; // quedarse en login
    }

    // 2) Páginas públicas siempre permitidas
    if (publicPaths.has(path)) return;

    // 3) Con token válido
    if (token) {
      // En vistas de trabajo exigir tramo de rol
      if (needRole.includes(path)) {
        const srol = sessionStorage.getItem('rcn.srolcod');
        if (!srol) return redirect('/role.html');
      }
      return;
    }

    // 4) Sin token: permitir entrar a role/remallado/resumen si podemos reanudar (api.js hará autologin)
    if (!noResume && canResume()) {
      if (path === '/role.html' || needRole.includes(path)) return;
    }

    // 5) Puede que auth.js aún no haya cargado → reintenta breve
    if (tries < 6) {
      return setTimeout(() => check(tries + 1), 80);
    }

    // 6) Sin token y sin posibilidad de reanudar → a login
    return redirect('/login.html');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => check());
  } else {
    check();
  }
})();
