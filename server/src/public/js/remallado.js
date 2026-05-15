// server/src/public/js/remallado.js
// Frontend Remallado (flujo por pasos, persistencia inmediata + autosave)
const $ = (id) => document.getElementById(id);
$('foot').textContent = auth.getUser()?.nombre || '';

// Ajusta la separación para que la botonera quede sobre el footer
(function syncHFVars() {
  const foot = document.getElementById('foot');
  const head = document.querySelector('.header');
  const mainCont = document.querySelector('main.container');

  const setVars = () => {
    const root = document.documentElement;

    // header / footer
    root.style.setProperty('--footer-h', (foot?.offsetHeight || 0) + 'px');
    root.style.setProperty('--header-h', (head?.offsetHeight || 0) + 'px');

    // padding-top + padding-bottom del container (para que #remCard
    // calcule bien su altura y no genere scroll extra)
    let py = 0;
    if (mainCont) {
      const cs = getComputedStyle(mainCont);
      py = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    }
    root.style.setProperty('--container-py', py + 'px');

    // altura visible de la barra inferior (sec-bottom o sec-bottom-lote)
    const b1 = document.getElementById('sec-bottom');
    const b2 = document.getElementById('sec-bottom-lote');
    let bh = 0;

    // Si el teclado está abierto, NO reservamos altura para la barra
    if (!root.classList.contains('kb-open')) {
      if (b1 && b1.offsetParent !== null) bh = b1.offsetHeight || 0;
      else if (b2 && b2.offsetParent !== null) bh = b2.offsetHeight || 0;
    }

    root.style.setProperty('--bottom-h', bh + 'px');
  };

  setVars();
  window.addEventListener('resize', setVars);
  window.addEventListener('orientationchange', setVars);
  window.__syncHFVars = setVars;
})();

// === Ajuste dinámico por teclado virtual (móvil) ===
(function watchKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return; // fallback: no soportado → no tocamos nada

  const root = document.documentElement;
  let raf = 0;

  const update = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      // Altura del “layout viewport” vs “visual viewport” → diferencia ~ teclado
      const layoutH = window.innerHeight || document.documentElement.clientHeight || 0;
      const kb = Math.max(0, Math.round(layoutH - vv.height - vv.offsetTop));
      root.style.setProperty('--kb-h', kb + 'px');

      // Detecta si el teclado está abierto (umbral bajo + heurística de viewport/foco)
      const open =
        kb > 30 ||                       // diferencia por teclado
        (vv.height < layoutH * 0.9) ||   // viewport recortado
        /^(INPUT|TEXTAREA|SELECT)$/i.test(document.activeElement?.tagName || '');

      root.classList.toggle('kb-open', open);

      // Recalcula alturas dependientes (footer/header/bottom-h)
      if (window.__syncHFVars) window.__syncHFVars();
    });
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
})();

// Mantiene kb-open en foco de campos (refuerzo universal)
(function kbFocusSync() {
  const root = document.documentElement;
  const isField = (el) =>
    el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  let t;

  document.addEventListener('focusin', (e) => { if (isField(e.target)) root.classList.add('kb-open'); });
  document.addEventListener('focusout', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const still = document.querySelector('input:focus, textarea:focus, select:focus, [contenteditable]:focus');
      if (!still) root.classList.remove('kb-open');
      if (window.__syncHFVars) window.__syncHFVars();
    }, 120);
  });
})();

// Fallback: si no hay visualViewport en este dispositivo, usa focusin/out
(function kbFallback() {
  if (window.visualViewport) return; // ya tenemos el bueno
  const root = document.documentElement;
  let tid;
  const isField = (el) => el && (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable ||
    el.tagName === 'SELECT'
  );

  document.addEventListener('focusin', (e) => {
    if (isField(e.target)) {
      root.classList.add('kb-open');
      if (window.__syncHFVars) window.__syncHFVars();
    }
  });
  document.addEventListener('focusout', () => {
    clearTimeout(tid);
    tid = setTimeout(() => {
      root.classList.remove('kb-open');
      if (window.__syncHFVars) window.__syncHFVars();
    }, 120);
  });
})();

const LOT_RE = /^R\d{6}$/i;
const DRAFT_KEY = 'rcn.rem.draft.v1';

const ui = {
  lblLote: $('lblLote'),
  lotcod: $('lotcod'),
  prodnom: $('prodnom'),
  otcod: $('otcod'),
  rowProd: $('row-prod'),
  secOps: $('sec-ops'),
  secTable: $('sec-table'),
  secBottom: $('sec-bottom'),
  secBottomLote: $('sec-bottom-lote'),
  btnMain: $('btnMain'),
  btnVolver: $('btnVolver'),
  btnResFalla: $('btnResFalla'),
  miniWrap: $('miniTotals'),
  miniFalla: $('miniFalla'),
  miniYarda: $('miniYarda'),
  rowTipo: $('row-tipo'),
  tipoFalla: $('tipoFalla'),
  // Observaciones
  rowObs: $('row-obs'),
  observ: $('observ'),
  obsCount: $('obsCount'),
  // Header & menú
  btnBack: $('btnBack'),
  btnMore: $('btnMore'),
  moreMenu: $('moreMenu'),
  miObserv: $('miObserv'),
  miResFalla: $('miResFalla'),
  miResumenDia: $('miResumenDia'),
  // Modal Observaciones
  obsModal: $('obsModal'),
  obsText: $('obsText'),
  obsCountModal: $('obsCountModal'),
  btnObsSave: $('btnObsSave'),
  btnObsClear: $('btnObsClear'),

};

const state = {
  step: 'lote',                  // 'lote' | 'full'
  partecod: null,                // se crea al primer "+"
  rows: new Map(),               // codfal(string) -> { desfal, tipfal, cantidad }
  obs: '',                       // observaciones
};

/* ---------- helpers UI ---------- */
if (ui.lblLote) ui.lblLote.style.display = 'none';
ensureVolverVisible();

function ensureMiniDom() {
  if (ui.miniWrap && ui.miniFalla && ui.miniYarda) return;
  const wrap = document.createElement('div');
  wrap.id = 'miniTotals';
  wrap.style.cssText = 'display:flex;gap:.75rem;align-items:center;opacity:.9;font-size:.95rem;margin-top:.35rem;';
  const f = document.createElement('span'); f.id = 'miniFalla'; f.textContent = 'Falla: 0';
  const y = document.createElement('span'); y.id = 'miniYarda'; y.textContent = 'Yarda: 0';
  wrap.appendChild(f); wrap.appendChild(y);
  (ui.lotcod?.parentElement || document.body).appendChild(wrap);
  ui.miniWrap = wrap; ui.miniFalla = f; ui.miniYarda = y;
}

function refreshVolverLabel() {
  if (!ui?.btnVolver) return;
  ui.btnVolver.textContent = state.partecod ? 'Descartar y volver' : 'Volver';
}

function ensureVolverVisible() {
  if (!ui?.btnVolver) return;
  // por si quedó algo de una versión anterior
  ui.btnVolver.classList.remove('keep-space');
  ui.btnVolver.style.removeProperty('visibility');
  ui.btnVolver.style.removeProperty('pointer-events');
  ui.btnVolver.style.display = ''; // asegúrate que no esté oculto
}

// Ajusta el ancho del input del lote según el texto (en caracteres)
function fitLotToText() {
  const el = ui.lotcod;
  if (!el) return;
  // mínimo 8, máximo razonable para evitar saltos
  const len = Math.max(8, (el.value || '').length);
  el.setAttribute('size', String(len + 1));
}

async function infoFalla(codfal) {
  try {
    const res = await api.get(`/api/ext/fallas?cod=${encodeURIComponent(codfal)}`);
    let item, exists = false;
    if (Array.isArray(res)) { item = res[0]; exists = !!item; }
    else { item = res; exists = !!item; }
    return {
      desfal: item?.desfal || `Falla ${codfal}`,
      tipfal: (item?.tipfal || '').toUpperCase(),
      exists
    };
  } catch {
    return { desfal: `Falla ${codfal}`, tipfal: '', exists: false };
  }
}

async function autofillProducto() {
  const lot = ui.lotcod.value.trim();
  if (!lot) return;
  try {
    const data = await api.get(`/api/ext/producto?lotcod=${encodeURIComponent(lot)}`);
    if (data && (data.ftdes || data.producto || data.otcod)) {
      ui.prodnom.value = data.ftdes || data.producto || '';
      if (ui.otcod) ui.otcod.value = data.otcod || '';
    }
  } catch { /* silencio: si no hay datos, no rompe UI */ }
}

function breakMiddle(txt) {
  const s = String(txt || '').trim();
  if (s.length <= 24) return s;
  const mid = Math.floor(s.length / 2);
  return `${s.slice(0, mid)}<br>${s.slice(mid)}`;
}

function calcTotales() {
  let falla = 0, yarda = 0;
  for (const [, obj] of state.rows) {
    if ((obj.tipfal || '').toUpperCase() === 'YARDA') yarda += obj.cantidad;
    else falla += obj.cantidad;
  }
  return { falla: +falla.toFixed(2), yarda: +yarda.toFixed(2) };
}

function renderMini() {
  ensureMiniDom();
  const { falla, yarda } = calcTotales();
  ui.miniFalla.textContent = `Falla: ${falla}`;
  ui.miniYarda.textContent = `Yarda: ${yarda}`;
}

function setMenuForStep() {
  const isFull = state.step === 'full';
  const isLote = state.step === 'lote';
  if (ui.miObserv) ui.miObserv.style.display = isFull ? '' : 'none';
  if (ui.miResFalla) ui.miResFalla.style.display = isFull ? '' : 'none';
  if (ui.miResumenDia) ui.miResumenDia.style.display = isLote ? '' : 'none';
}

function setMainButtonForStep() {
  if (!ui.btnMain) return;
  if (state.step === 'full') {
    ui.btnMain.textContent = 'Enviar';
    ui.btnMain.classList.remove('warn');
    ui.btnMain.classList.add('success');
  } else { // 'lote'
    ui.btnMain.textContent = 'Salir';
    ui.btnMain.classList.remove('success');
    ui.btnMain.classList.add('warn');
  }
}

/* ====== Contador dentro del textarea (overlay) ====== */
function ensureObsOverlay() {
  if (!ui.observ) return;
  // Crea un contenedor relativo para poder posicionar el contador dentro
  if (!ui.observ.parentElement.classList.contains('obs-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'obs-wrap';
    wrap.style.position = 'relative';
    wrap.style.width = '100%';
    // inserta el wrap antes del textarea y mueve el textarea adentro
    ui.observ.parentElement.insertBefore(wrap, ui.observ);
    wrap.appendChild(ui.observ);
    // mueve el contador dentro del wrap (absoluto abajo-derecha)
    if (ui.obsCount) {
      wrap.appendChild(ui.obsCount);
      ui.obsCount.style.position = 'absolute';
      ui.obsCount.style.right = '10px';
      ui.obsCount.style.bottom = '8px';
      ui.obsCount.style.fontSize = '12px';
      ui.obsCount.style.opacity = '0.6';            // tono medio transparente
      ui.obsCount.style.pointerEvents = 'none';
      ui.obsCount.style.background = 'transparent'; // sin caja, liviano
      ui.obsCount.style.margin = '0';               // quita margen externo
    }
    // deja aire para que el contador no se superponga al texto
    const pb = parseFloat(getComputedStyle(ui.observ).paddingBottom) || 0;
    if (pb < 24) ui.observ.style.paddingBottom = '24px';
  }
}

/* ==================== AUTOSAVE local ==================== */
function saveDraft() {
  const rows = [...state.rows.entries()].map(([k, v]) => [k, {
    desfal: v.desfal,
    tipfal: v.tipfal,
    cantidad: v.cantidad,
    order: v.order || 0,       // << NUEVO
    last: v.last || 0          // legacy (por compat)
  }]);
  const draft = {
    lotcod: ui.lotcod.value.trim(),
    prodnom: ui.prodnom.value || '',
    otcod: (ui.otcod && ui.otcod.value) || '',
    partecod: state.partecod || null,
    rows,
    obs: (ui.observ?.value || state.obs || '').trim(),
  };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { }
}
window.addEventListener('beforeunload', saveDraft);

/* ==================== PERSISTENCIA EN BD ==================== */
async function syncObsToServer() {
  try {
    if (state.partecod) {
      const payload = {
        partecod: state.partecod,
        observaciones: (ui.observ?.value || state.obs || '').trim() || null,
      };
      await api.post('/api/parte/obs', payload);
    }
  } catch { /* silencioso: si no existe el endpoint aún, no rompe */ }
}

async function ensureParteOpen() {
  if (state.partecod) return state.partecod;

  const srolcod = Number(sessionStorage.getItem('rcn.srolcod'));
  const lotcod = ui.lotcod.value.trim().toUpperCase();
  const prodnom = ui.prodnom.value.trim();
  const otcod = (ui.otcod && ui.otcod.value.trim()) || '';
  const observaciones = (ui.observ?.value || state.obs || '').trim();

  if (!srolcod) throw new Error('No hay tramo de rol. Vuelve a elegir rol.');
  if (!LOT_RE.test(lotcod)) throw new Error('N° de lote inválido. Formato: R + 6 dígitos.');

  // Enviar observaciones si el backend ya lo soporta; si no, se ignorará sin romper.
  const { partecod } = await api.post('/api/parte', { srolcod, lotcod, prodnom, otcod, observaciones });
  state.partecod = partecod;
  setMainButtonForStep();
  refreshVolverLabel();
  saveDraft();

  // Intento de sincronizar obs nuevamente (por compatibilidad hacia atrás)
  if (observaciones) { try { await syncObsToServer(); } catch { } }

  return partecod;
}

async function ajustarDetalle(codfal, delta) {
  const partecod = await ensureParteOpen();
  await api.post('/api/det/ajustar', { partecod, codfal, delta });
}

/* ==================== RENDER TABLA ==================== */
function renderTabla() {
  const tbody = $('tabla').querySelector('tbody');
  tbody.innerHTML = '';

  // Orden: más reciente primero (descendente por 'last')
  const items = Array.from(state.rows.entries()).sort((a, b) => {
    const oa = (a[1] && a[1].order) ? a[1].order : 0;
    const ob = (b[1] && b[1].order) ? b[1].order : 0;
    return ob - oa;
  });

  for (let i = 0; i < items.length; i++) {
    const codfal = String(items[i][0]);
    const obj = items[i][1];

    const tr = document.createElement('tr');
    tr.dataset.id = codfal;
    tr.innerHTML = `
      <td><div class="wrap">${breakMiddle(obj.desfal)}</div></td>
      <td data-k="qty" class="qty-cell">${obj.cantidad}</td>
      <td>
        <div class="actions">
          <button class="btn square ghost" data-op="add" data-id="${codfal}">+</button>
          <button class="btn square ghost" data-op="sub" data-id="${codfal}">−</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  }

  // ===== Espaciador dinámico al final para que la última fila NUNCA quede oculta =====
  // Calcula altura visible de la barra pegada y compensa también el scrollbar.
  const wrap = document.querySelector('#sec-table .table-wrap');
  let extraPx = 0;
  try {
    const root = document.documentElement;
    const bh = parseFloat(getComputedStyle(root).getPropertyValue('--bottom-h')) || 0; // altura barra inferior
    const sb = wrap ? (wrap.offsetHeight - wrap.clientHeight) : 0; // grosor de scrollbar
    // 8–12px extra de aire
    extraPx = Math.max(16, Math.ceil(bh + sb + 12));
  } catch { extraPx = 32; }

  const colCount = $('tabla').querySelectorAll('thead th').length || 3;
  const trSpacer = document.createElement('tr');
  trSpacer.className = 'spacer-row';
  trSpacer.setAttribute('aria-hidden', 'true');
  trSpacer.innerHTML = `<td colspan="${colCount}" style="padding:0;border:0;height:${extraPx}px"></td>`;
  tbody.appendChild(trSpacer);

  // Mantener vista al tope (lo más reciente primero)
  if (wrap) wrap.scrollTop = 0;

  renderMini();
  saveDraft();
}

/* ---------- UI: modos ---------- */
function setStep(step) {
  // Si piden "full" pero el N° lote no cumple el patrón, forzamos "lote"
  if (step === 'full') {
    const lot = ui.lotcod.value.trim().toUpperCase();
    if (!LOT_RE.test(lot)) {
      step = 'lote';
    }
  }

  state.step = step;

  if (step === 'lote') {
    ui.lotcod.disabled = false;
    ui.lotcod.placeholder = 'N° de lote';

    ui.rowProd.style.display = 'none';
    ui.secOps.style.display = 'none';
    ui.secTable.style.display = 'none';
    ui.secBottom.style.display = 'none';
    ui.secBottomLote.style.display = 'none';

    if (ui.rowTipo) ui.rowTipo.style.display = 'none';
    if (ui.tipoFalla) ui.tipoFalla.value = '';
    if (ui.rowObs) ui.rowObs.style.display = 'none';
    if (ui.observ) ui.observ.value = '';
    state.obs = '';

    state.partecod = null;
    state.rows.clear();
    ui.prodnom.value = '';
    if (ui.otcod) ui.otcod.value = '';
    renderTabla();
    clearDraft();
  } else {
    // Paso FULL
    ui.lotcod.disabled = true;

    ui.rowProd.style.display = '';
    ui.prodnom.disabled = true;
    if (ui.otcod) ui.otcod.disabled = true;
    ui.secOps.style.display = '';
    ui.secTable.style.display = '';
    ui.secBottom.style.display = 'none';
    ui.secBottomLote.style.display = 'none';

    if (ui.rowTipo) ui.rowTipo.style.display = 'none';
    if (ui.tipoFalla) ui.tipoFalla.value = '';
    if (ui.rowObs) ui.rowObs.style.display = 'none';

    renderTabla();
    autofillProducto().catch(() => { });
  }
  fitLotToText();
  setMainButtonForStep();
  refreshVolverLabel();
  ensureVolverVisible();
  setMenuForStep();
  if (window.__syncHFVars) window.__syncHFVars();
}

/* ====== Restaurar si había borrador / parte abierta ====== */
async function restoreIfAny() {
  const draft = loadDraft();

  // Sin borrador → paso "lote"
  if (!draft) { setStep('lote'); return; }

  const lot = String(draft.lotcod || '').trim().toUpperCase();

  // Si no hay lote o el formato NO es válido, queda en paso "lote"
  if (!LOT_RE.test(lot)) {
    setStep('lote');           // UI en modo captura de lote
    ui.lotcod.value = lot;     // si había algo (p.ej. "R"), lo dejamos escrito pero editable
    state.partecod = null;     // seguridad: no hay parte abierta asociada
    state.rows.clear();
    return;
  }

  // Lote válido → paso FULL
  ui.lotcod.value = lot;
  setStep('full');
  ui.prodnom.value = draft.prodnom || '';
  if (ui.otcod) ui.otcod.value = draft.otcod || '';
  state.partecod = draft.partecod || null;
  state.obs = String(draft.obs || '');
  const MAX_OBS = ui.observ ? (+ui.observ.getAttribute('maxlength') || 500) : 500;
  if (ui.observ) {
    ui.observ.value = state.obs;
    if (ui.obsCount) ui.obsCount.textContent = `${state.obs.length}/${MAX_OBS}`;
  }
  setMainButtonForStep();
  refreshVolverLabel();

  try {
    const srolcod = Number(sessionStorage.getItem('rcn.srolcod'));
    if (!state.partecod && srolcod) {
      const p = await api.get(`/api/parte/abierta?lotcod=${encodeURIComponent(lot)}&srolcod=${srolcod}`);
      if (p?.partecod) state.partecod = p.partecod;
    }
    if (state.partecod) {
      const dets = await api.get(`/api/parte/detalles?partecod=${state.partecod}`);
      state.rows.clear();
      let i = 0;
      (dets || []).forEach(d => {
        state.rows.set(String(d.codfal), {
          desfal: d.desfal,
          tipfal: (d.tipfal || '').toUpperCase(),
          cantidad: Number(d.cantidad || 0),
          order: ++i,      // << NUEVO: base de orden
          last: i          // legacy (por compat)
        });
      });
      renderTabla();

    } else if (draft.rows?.length) {
      state.rows = new Map(draft.rows);
      let i2 = 0;
      for (const [, v] of state.rows) {
        if (typeof v.order !== 'number') {
          v.order = (typeof v.last === 'number' && v.last > 0) ? v.last : ++i2;
        }
      }
      renderTabla();
    }
    autofillProducto().catch(() => { });
  } catch {
    if (draft.rows?.length) {
      state.rows = new Map(draft.rows);
      renderTabla();
    }
  }
}

/* ---------- Navegación básica ---------- */
// Avanza a paso 2 al detectar R + 6 dígitos
ui.lotcod.addEventListener('input', () => {
  fitLotToText();
  if (state.step === 'lote' && LOT_RE.test(ui.lotcod.value.trim())) {
    setStep('full');
    saveDraft();
  }
});

// Flecha del header (volver)
ui.btnBack?.addEventListener('click', async () => {
  try {
    if (state.step === 'full') {
      if (state.partecod) {
        const lot = ui.lotcod.value.trim();
        const ok = confirm(`Esto borrará en la base de datos lo registrado del lote ${lot} (si aún no fue enviado). ¿Deseas continuar?`);
        if (!ok) return;
        try {
          await api.post('/api/parte/descartar', { partecod: state.partecod });
        } catch (e) {
          alert(e.message || 'No se pudo descartar la parte');
          return;
        }
      }
      ui.lotcod.value = '';
      setStep('lote');
    } else {
      // En el paso "lote", la flecha te lleva a elegir rol
      location.href = '/role.html';
    }
  } catch { }
});

/* ==================== Observaciones (modal) ==================== */
function updateObsCounter() {
  if (!ui.obsText || !ui.obsCountModal) return;
  const max = +(ui.obsText.getAttribute('maxlength') || 500);
  const len = (ui.obsText.value || '').length;
  ui.obsCountModal.textContent = `${len}/${max}`;
}

function openObs(v) {
  const m = ui.obsModal;
  if (!m) return;
  if (v) m.classList.add('open'); else m.classList.remove('open');
}

function showAlertModal(msg) {
  const m = $('alertModal');
  if (!m) { alert(msg); return; }
  const t = $('alertText');
  if (t) t.textContent = msg || 'Aviso';
  m.classList.add('open');
}
document.querySelectorAll('#alertModal [data-close]').forEach(el =>
  el.addEventListener('click', () => $('alertModal')?.classList.remove('open'))
);

// Abrir desde el menú
ui.miObserv?.addEventListener('click', () => {
  if (!ui.obsText) return;
  ui.moreMenu?.classList?.remove('open');
  ui.obsText.value = state.obs || '';
  updateObsCounter();
  openObs(true);
});

// Input dentro del modal (solo guarda en borrador local)
ui.obsText?.addEventListener('input', () => {
  const max = +(ui.obsText.getAttribute('maxlength') || 500);
  const val = String(ui.obsText.value || '').slice(0, max);
  if (val !== ui.obsText.value) ui.obsText.value = val;
  state.obs = val;
  updateObsCounter();
  saveDraft(); // NO se envía al servidor automáticamente
});

ui.btnObsClear?.addEventListener('click', () => {
  if (!ui.obsText) return;
  ui.obsText.value = '';
  state.obs = '';
  updateObsCounter();
  saveDraft();
});

ui.btnObsSave?.addEventListener('click', async () => {
  // Si ya existe la parte, persistimos las observaciones; cerrar modal luego
  try { await syncObsToServer(); } catch { }
  openObs(false);
});

// Cierre por [data-close]
document.querySelectorAll('#obsModal [data-close]').forEach(el =>
  el.addEventListener('click', () => openObs(false))
);

$('cantidad')?.addEventListener('input', (e) => {
  let v = (e.target.value || '').replace(/\D/g, '').slice(0, 5);
  e.target.value = v;
});

/* ==================== AGREGAR FALLAS (botón azul "+") ==================== */
$('btnAdd').addEventListener('click', async () => {
  const codfal = String(($('codfal').value || '').trim());
  const cantStr = String(($('cantidad').value || '').trim());
  const lot = ui.lotcod.value.trim().toUpperCase();

  if (!LOT_RE.test(lot)) return showAlertModal('N° de lote inválido (usa R + 6 dígitos).');
  if (!codfal) return showAlertModal('Ingresa un código de falla.');
  if (!/^\d{1,5}$/.test(cantStr)) return showAlertModal('Cantidad inválida (solo números, máx. 5 cifras).');

  // Verificar que el código exista
  const info = await infoFalla(codfal);
  if (!info.exists) {
    return showAlertModal('Este código no existe');
  }

  const cant = parseInt(cantStr, 10);

  try {
    await ajustarDetalle(codfal, cant);

    if (!state.rows.has(codfal)) {
      state.rows.set(codfal, { desfal: info.desfal, tipfal: info.tipfal, cantidad: 0, order: Date.now() });
    }
    const obj = state.rows.get(codfal);
    obj.cantidad = +(obj.cantidad + cant).toFixed(2);
    renderTabla();

    $('codfal').value = '';
    $('cantidad').value = '';
    if (ui.tipoFalla) ui.tipoFalla.value = '';
    if (ui.rowTipo) ui.rowTipo.style.display = 'none';
  } catch (e) {
    showAlertModal(e.message || 'No se pudo agregar la falla');
  }
});

/* ==================== BOTONES +/- EN LA TABLA ==================== */
$('tabla').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-op]');
  if (!btn) return;
  const id = String(btn.dataset.id);
  const op = btn.dataset.op;
  const obj = state.rows.get(id);
  if (!obj) return;

  const delta = op === 'add' ? 1 : -1;
  const nuevo = Math.max(0, +(obj.cantidad + delta).toFixed(2));

  try {
    await ajustarDetalle(id, nuevo - obj.cantidad);
    obj.cantidad = nuevo;
    renderTabla();
  } catch (e2) {
    alert(e2.message || 'No se pudo ajustar la cantidad');
  }
});

/* ====== Edición inline de la cantidad con click/tap ====== */
(function enableInlineQtyEditing() {
  const tbody = $('tabla')?.querySelector('tbody');
  if (!tbody) return;

  tbody.addEventListener('click', (ev) => {
    const td = ev.target.closest('td[data-k="qty"]');
    if (!td || td.querySelector('input')) return;

    const tr = td.closest('tr');
    const key = tr?.dataset?.id;
    if (!key || !state.rows.has(key)) return;

    const prev = parseFloat(String(td.textContent).replace(',', '.')) || 0;

    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = String(prev);
    input.className = 'qty-editor';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.padding = '6px 8px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid rgba(255,255,255,.15)';
    input.style.background = 'rgba(0,0,0,.25)';
    input.style.color = 'inherit';
    input.style.outline = 'none';

    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    const commit = async () => {
      const n = parseFloat(String(input.value).replace(',', '.'));
      td.removeChild(input);
      if (!Number.isFinite(n)) { td.textContent = String(prev); return; }

      const val = Math.max(0, +n.toFixed(2));
      const obj = state.rows.get(key);
      if (!obj) { td.textContent = String(prev); return; }

      const delta = +(val - obj.cantidad).toFixed(2);
      if (delta === 0) { td.textContent = String(prev); renderTabla(); return; }

      try {
        await ajustarDetalle(key, delta);
        obj.cantidad = val;
        renderTabla();
      } catch (e) {
        alert(e.message || 'No se pudo actualizar la cantidad');
        renderTabla();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { td.textContent = String(prev); input.blur(); }
    });
    input.addEventListener('blur', commit);
  });
})();

/* ====== Preview de nombre de falla mientras se escribe el código ====== */
let tipoTimer = null;
$('codfal').addEventListener('input', () => {
  const code = ($('codfal').value || '').trim();

  clearTimeout(tipoTimer);

  // Mantener visible SIEMPRE
  if (ui.rowTipo) ui.rowTipo.style.display = '';

  // Si está vacío, solo limpia el texto
  if (!code) {
    if (ui.tipoFalla) ui.tipoFalla.value = '';
    return;
  }

  // Buscar el nombre con un pequeño debounce
  tipoTimer = setTimeout(async () => {
    try {
      const info = await infoFalla(code);
      if (ui.tipoFalla) ui.tipoFalla.value = info?.desfal || '';
    } catch {
      if (ui.tipoFalla) ui.tipoFalla.value = '';
    }
  }, 200);
});

/* ==================== BOTÓN PRINCIPAL (Enviar / Salir) ==================== */
ui.btnMain?.addEventListener('click', async () => {
  if (state.step === 'full') {
    // Modo captura: botón = Enviar
    if (!state.partecod) return alert('No hay nada que enviar.');
    const lotcod = ui.lotcod.value.trim();
    const ok = confirm(`¿Enviar parte del lote ${lotcod}?`);
    if (!ok) return;
    try {
      try { await syncObsToServer(); } catch { /* opcional */ }
      await api.post('/api/parte/cerrar', { partecod: state.partecod });
      alert('Enviado 👍');
      ui.lotcod.value = '';
      setStep('lote');         // vuelve a paso de lote
    } catch (e) {
      alert(e.message || 'No se pudo cerrar/enviar la parte');
    }
  } else {
    // Paso "lote": botón = Salir
    const ok = confirm('¿Seguro que deseas terminar tu turno?');
    if (!ok) return;
    try { await api.post('/api/fin-turno'); } catch { }
    try { auth.hardLogout?.('turn-closed'); } catch { }
  }
});


/* -------- Resumen de falla (OTROS) desde menú --------------------- */
ui.miResFalla?.addEventListener('click', async () => {
  ui.moreMenu?.classList?.remove('open');
  const lotcod = ui.lotcod.value.trim();
  if (!lotcod) return alert('Ingresa N° de lote.');
  try {
    const data = await api.get(`/api/resumen/lote/otros?lotcod=${encodeURIComponent(lotcod)}`);
    const acc = new Map(); // desfal -> total
    (data || []).forEach(row => {
      const key = row.desfal || '(sin nombre)';
      const val = Number(row.total ?? row.cantidad ?? 0);
      acc.set(key, Number((acc.get(key) || 0) + val));
    });

    const tbody = $('tablaResumen').querySelector('tbody');
    tbody.innerHTML = '';
    for (const [desfal, total] of acc) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="wrap">${breakMiddle(desfal)}</td><td>${Number(total)}</td>`;
      tbody.appendChild(tr);
    }
    openModal(true);
  } catch (e) {
    alert(e.message || 'No se pudo cargar resumen');
  }
});

function openModal(v) {
  const m = $('modal');
  if (v) m.classList.add('open'); else m.classList.remove('open');
}
document.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => openModal(false))
);

/* ==================== Menú de tres puntitos ==================== */
ui.btnMore?.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenuForStep(); // asegura opciones correctas
  ui.moreMenu?.classList?.toggle('open');
});

// Cerrar menú si hago click fuera
document.addEventListener('click', (e) => {
  if (!ui.moreMenu) return;
  if (e.target.closest('.menu-anchor')) return;
  ui.moreMenu.classList.remove('open');
});

// === boot: intenta restaurar
restoreIfAny();
setMenuForStep();