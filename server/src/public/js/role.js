// Dinámico según catálogo en DB
(() => {
    // 1) Debe existir token guardado tras el login
    const token = auth.getToken?.();
    if (!token) { location.href = '/login.html'; return; }

    const box = document.getElementById('rolesBox');

    // Render de botones a partir de un arreglo [{rolcod, rolnom}]
    function render(roles) {
        box.innerHTML = '';
        roles.forEach(r => {
            const btn = document.createElement('button');
            btn.className = 'btn-role';
            btn.textContent = r.rolnom;
            btn.dataset.rol = r.rolcod;
            btn.addEventListener('click', () => elegir(r.rolcod));
            box.appendChild(btn);
        });
    }

    // Acción al elegir un rol
    async function elegir(rolcod) {
        try {
            const { srolcod } = await api.post('/api/rol', { rolcod });
            sessionStorage.setItem('rcn.srolcod', String(srolcod));
            if (rolcod === 'RM') location.href = '/remallado.html';
            else if (rolcod === 'RV') location.href = '/revision.html';
            else location.href = '/resumen.html';
        } catch (e) {
            alert(e?.message || 'No se pudo cambiar de rol.');
        }
    }

    // 2) Intentamos leer desde API (si falla, usamos lo guardado en login)
    (async () => {
        try {
            const roles = await api.get('/api/roles');       // <-- siempre fresco desde DB
            render(roles);
            localStorage.setItem('rcn.roles', JSON.stringify(roles)); // cache por si acaso
        } catch {
            // Fallback a lo que dejó /login
            const cached = JSON.parse(localStorage.getItem('rcn.roles') || '[]');
            if (cached.length) render(cached);
            else render([{ rolcod: 'RM', rolnom: 'Remallador' }, { rolcod: 'RV', rolnom: 'Revisor' }]);
        }
    })();
})();
