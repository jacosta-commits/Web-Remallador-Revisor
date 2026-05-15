// server/src/public/js/revision.js
// Módulo principal de la página de Revisión (RV)
(() => {
  /* ===== Auth check ===== */
  const token = auth.getToken?.();
  if (!token) { location.href = '/login.html'; return; }

  const srolcod = sessionStorage.getItem('rcn.srolcod');
  if (!srolcod) { location.href = '/role.html'; return; }

  /* ===== State ===== */
  let currentTarjeta = '';
  let currentRpartecod = null;       // parte abierto del revisor (null si no hay)
  let currentFallas = [];             // fallas fusionadas actuales
  let gruposFiltrados = [];

  /* ===== DOM refs ===== */
  const $  = id => document.getElementById(id);
  const filterFecha   = $('filterFecha');
  const filterTurno   = $('filterTurno');
  const filterBtn     = $('filterBtn');
  const otDropWrap    = $('otDropdownWrapper');
  const otDropdown    = $('otDropdown');
  const otCount       = $('otCount');
  const loteDropWrap  = $('loteDropdownWrapper');
  const loteDropdown  = $('loteDropdown');
  const loteCount     = $('loteCount');
  const searchInput   = $('searchInput');
  const searchBtn     = $('searchBtn');
  const loading       = $('loading');
  const content       = $('content');
  const errorSection  = $('errorSection');
  const errorTxt      = $('errorTxt');
  const faultsBody    = $('faultsBody');
  const valTarjeta    = $('valTarjeta');
  const valOT         = $('valOT');
  const valNombre     = $('valNombre');
  const btnConforme   = $('btnConforme');
  const btnNoConforme = $('btnNoConforme');
  const obsText       = $('obsText');
  const obsCount      = $('obsCount');
  const addSection    = $('addFallaSection');
  const newCodfal     = $('newCodfal');
  const newCantidad   = $('newCantidad');
  const newFallaInfo  = $('newFallaInfo');
  const btnAddFalla   = $('btnAddFalla');
  const btnBack       = $('btnBack');
  const btnFinTurno   = $('btnFinTurno');

  /* ===== Helpers ===== */
  function show(el)  { el.classList.remove('hidden'); }
  function hide(el)  { el.classList.add('hidden'); }
  function showLoading() { hide(content); hide(errorSection); show(loading); }
  function showContent() { hide(loading); hide(errorSection); show(content); }
  function showError(msg) { hide(loading); hide(content); show(errorSection); errorTxt.textContent = msg; }

  /* ===== Obs counter ===== */
  obsText.addEventListener('input', () => {
    obsCount.textContent = `${obsText.value.length}/500`;
  });

  /* ===== Buscar tarjeta ===== */
  async function buscarTarjeta(tarjeta) {
    if (!tarjeta) return;
    currentTarjeta = tarjeta.trim();

    // Persist in URL
    const url = new URL(window.location);
    url.searchParams.set('q', currentTarjeta);
    window.history.pushState({}, '', url);

    showLoading();

    try {
      const data = await api.get(`/api/revision/buscar/${encodeURIComponent(currentTarjeta)}`);

      valTarjeta.value = data.header.tarjeta || '';
      valOT.value = data.header.otcod || '';
      valNombre.value = [data.header.producto, data.header.nombre].filter(Boolean).join(' — ') || '';

      currentFallas = data.fallas || [];
      renderFallas();

      // Check si ya hay parte abierto del revisor
      await checkParteAbierta();

      showContent();
    } catch (e) {
      showError(`Error: ${e.message}`);
    }
  }

  /* ===== Render fallas ===== */
  function renderFallas() {
    faultsBody.innerHTML = '';

    if (currentFallas.length === 0) {
      faultsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;">No se encontraron fallas registradas</td></tr>';
      return;
    }

    currentFallas.forEach(f => {
      const tr = document.createElement('tr');
      const isDiff = f.cant_revision > 0 && f.cant_revision !== f.cant_remalle;
      if (isDiff) tr.classList.add('diff-row');

      tr.innerHTML = `
        <td>${f.codfal}</td>
        <td>${f.desfal}</td>
        <td class="cant-col">${f.cant_remalle}</td>
        <td class="rev-cant-col">${f.cant_revision || 0}</td>
        <td>
          <div class="rev-row-actions">
            <button class="btn ghost small rev-minus" data-cod="${f.codfal}" title="Restar 1">−</button>
            <button class="btn primary small rev-plus" data-cod="${f.codfal}" title="Sumar 1">+</button>
          </div>
        </td>
      `;
      faultsBody.appendChild(tr);
    });

    // Event listeners for +/-
    faultsBody.querySelectorAll('.rev-plus').forEach(btn => {
      btn.addEventListener('click', () => ajustarFalla(btn.dataset.cod, +1));
    });
    faultsBody.querySelectorAll('.rev-minus').forEach(btn => {
      btn.addEventListener('click', () => ajustarFalla(btn.dataset.cod, -1));
    });
  }

  /* ===== Check/crear parte abierta del revisor ===== */
  async function checkParteAbierta() {
    try {
      const data = await api.get(`/api/revision/parte/abierta?lotcod=${encodeURIComponent(currentTarjeta)}&srolcod=${srolcod}`);
      if (data && data.rpartecod) {
        currentRpartecod = data.rpartecod;
        // Load existing details
        const detalles = await api.get(`/api/revision/parte/detalles?rpartecod=${currentRpartecod}`);
        if (detalles && detalles.length > 0) {
          // Merge into currentFallas
          detalles.forEach(d => {
            const f = currentFallas.find(x => x.codfal === d.codfal);
            if (f) {
              f.cant_revision = Number(d.cantidad);
            } else {
              currentFallas.push({
                codfal: d.codfal,
                desfal: d.desfal,
                tipfal: d.tipfal,
                cant_remalle: 0,
                cant_revision: Number(d.cantidad),
              });
            }
          });
          renderFallas();
        }
      } else {
        currentRpartecod = null;
      }
    } catch {
      currentRpartecod = null;
    }
  }

  /** Ensures a parte exists for this reviewer session */
  async function ensureParte() {
    if (currentRpartecod) return currentRpartecod;
    try {
      const data = await api.post('/api/revision/parte', {
        srolcod: Number(srolcod),
        lotcod: currentTarjeta,
        placod: 'RCN',
      });
      currentRpartecod = data.rpartecod;
      return currentRpartecod;
    } catch (e) {
      alert('Error creando parte de revisión: ' + e.message);
      return null;
    }
  }

  /* ===== Ajustar falla (+/-) ===== */
  async function ajustarFalla(codfal, delta) {
    const rpartecod = await ensureParte();
    if (!rpartecod) return;

    try {
      const { cantidad } = await api.post('/api/revision/det/ajustar', {
        rpartecod,
        codfal: String(codfal),
        delta,
      });

      // Update local state
      const f = currentFallas.find(x => x.codfal === String(codfal));
      if (f) {
        f.cant_revision = Number(cantidad);
      }
      renderFallas();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  /* ===== Agregar nueva falla ===== */
  async function agregarNuevaFalla() {
    const cod = newCodfal.value.trim();
    const cant = Number(newCantidad.value) || 1;
    if (!cod) { newCodfal.focus(); return; }

    const rpartecod = await ensureParte();
    if (!rpartecod) return;

    try {
      const { cantidad } = await api.post('/api/revision/det/ajustar', {
        rpartecod,
        codfal: cod,
        delta: cant,
      });

      // Check if already in list
      const existing = currentFallas.find(x => x.codfal === cod);
      if (existing) {
        existing.cant_revision = Number(cantidad);
      } else {
        // Fetch falla info
        let desfal = `COD ${cod}`, tipfal = '';
        try {
          const fallas = await api.get(`/api/ext/fallas?cod=${encodeURIComponent(cod)}`);
          if (fallas && fallas.length > 0) {
            desfal = fallas[0].desfal;
            tipfal = fallas[0].tipfal;
          }
        } catch {}
        currentFallas.push({
          codfal: cod,
          desfal,
          tipfal,
          cant_remalle: 0,
          cant_revision: Number(cantidad),
        });
      }

      renderFallas();
      newCodfal.value = '';
      newCantidad.value = '';
      hide(newFallaInfo);
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  /* ===== Lookup falla info while typing ===== */
  let lookupTimeout;
  newCodfal.addEventListener('input', () => {
    clearTimeout(lookupTimeout);
    const cod = newCodfal.value.trim();
    if (!cod) { hide(newFallaInfo); return; }
    lookupTimeout = setTimeout(async () => {
      try {
        const fallas = await api.get(`/api/ext/fallas?cod=${encodeURIComponent(cod)}`);
        if (fallas && fallas.length > 0) {
          newFallaInfo.textContent = `${fallas[0].desfal} (${fallas[0].tipfal})`;
          show(newFallaInfo);
        } else {
          newFallaInfo.textContent = 'Código no encontrado';
          show(newFallaInfo);
        }
      } catch {
        hide(newFallaInfo);
      }
    }, 400);
  });

  /* ===== Conforme / No Conforme ===== */
  async function cerrarRevision(conforme) {
    const rpartecod = await ensureParte();
    if (!rpartecod) return;

    const label = conforme ? 'CONFORME' : 'NO CONFORME';
    if (!confirm(`¿Confirmar revisión como ${label}?`)) return;

    try {
      await api.post('/api/revision/parte/cerrar', {
        rpartecod,
        conforme,
        observaciones: obsText.value.trim() || null,
      });
      alert(`Revisión enviada como ${label}`);
      // Reset
      currentRpartecod = null;
      obsText.value = '';
      obsCount.textContent = '0/500';
      // Reload data
      buscarTarjeta(currentTarjeta);
    } catch (e) {
      alert('Error al cerrar: ' + e.message);
    }
  }

  btnConforme.addEventListener('click', () => cerrarRevision(true));
  btnNoConforme.addEventListener('click', () => cerrarRevision(false));

  /* ===== Filtros ===== */
  async function filtrar() {
    const fecha = filterFecha.value;
    const turno = filterTurno.value;

    if (!fecha && !turno) {
      ocultarDropdowns();
      cargarUltimaTarjeta();
      return;
    }

    showLoading();

    try {
      const data = await api.get(`/api/revision/tarjetas/filter?fecha=${fecha || ''}&turno=${turno || ''}`);
      hide(loading);

      gruposFiltrados = data.grupos || [];
      otDropdown.innerHTML = '<option value="">-- Seleccione una OT --</option>';
      hide(loteDropWrap);

      if (gruposFiltrados.length === 0) {
        otCount.textContent = '0 resultados';
        show(otDropWrap);
        showError('No se encontraron tarjetas para los filtros seleccionados');
        return;
      }

      gruposFiltrados.forEach((g, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${g.otcod || 'SIN OT'} — ${g.lotes} lote${g.lotes !== 1 ? 's' : ''}`;
        otDropdown.appendChild(opt);
      });

      otCount.textContent = `${gruposFiltrados.length} OT${gruposFiltrados.length !== 1 ? 's' : ''} · ${data.totalTarjetas} tarjeta${data.totalTarjetas !== 1 ? 's' : ''}`;
      show(otDropWrap);

      if (gruposFiltrados.length === 1) {
        otDropdown.value = '0';
        seleccionarOT(0);
      }
    } catch (e) {
      showError(`Error: ${e.message}`);
    }
  }

  function seleccionarOT(idx) {
    const grupo = gruposFiltrados[idx];
    if (!grupo) return;

    loteDropdown.innerHTML = '<option value="">-- Seleccione un lote --</option>';

    if (grupo.lotes === 1) {
      hide(loteDropWrap);
      buscarTarjeta(grupo.tarjetas[0]);
      return;
    }

    grupo.tarjetas.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      loteDropdown.appendChild(opt);
    });

    loteCount.textContent = `${grupo.lotes} lotes`;
    show(loteDropWrap);
    loteDropdown.value = grupo.tarjetas[0];
    buscarTarjeta(grupo.tarjetas[0]);
  }

  function ocultarDropdowns() {
    hide(otDropWrap);
    hide(loteDropWrap);
    gruposFiltrados = [];
  }

  async function cargarUltimaTarjeta() {
    try {
      const data = await api.get('/api/revision/last');
      if (data.tarjeta) buscarTarjeta(data.tarjeta);
    } catch {
      hide(loading);
    }
  }

  /* ===== Event Listeners ===== */
  filterBtn.addEventListener('click', filtrar);

  otDropdown.addEventListener('change', e => {
    const idx = e.target.value;
    if (idx !== '') seleccionarOT(parseInt(idx));
    else hide(loteDropWrap);
  });

  loteDropdown.addEventListener('change', e => {
    if (e.target.value) buscarTarjeta(e.target.value);
  });

  searchBtn.addEventListener('click', () => {
    const v = searchInput.value.trim();
    if (v) buscarTarjeta(v);
  });

  searchInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      const v = searchInput.value.trim();
      if (v) buscarTarjeta(v);
    }
  });

  btnAddFalla.addEventListener('click', agregarNuevaFalla);
  newCantidad.addEventListener('keypress', e => {
    if (e.key === 'Enter') agregarNuevaFalla();
  });
  newCodfal.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      if (newCantidad.value) agregarNuevaFalla();
      else newCantidad.focus();
    }
  });

  btnBack.addEventListener('click', () => { location.href = '/role.html'; });

  btnFinTurno.addEventListener('click', async () => {
    if (!confirm('¿Cerrar turno y salir?')) return;
    try {
      await api.post('/api/fin-turno');
    } catch {}
    auth.hardLogout?.('turn-closed');
  });

  /* ===== Init ===== */
  const urlParams = new URLSearchParams(window.location.search);
  const q = urlParams.get('q');
  if (q) {
    searchInput.value = q;
    buscarTarjeta(q);
  } else {
    cargarUltimaTarjeta();
  }
})();
