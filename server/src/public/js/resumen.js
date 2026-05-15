const $ = (id) => document.getElementById(id);
$('foot').textContent = auth.getUser()?.nombre || '';

// Salto "a la mitad" para nombres largos
function breakMiddle(txt) {
  const s = String(txt || '').trim();
  if (s.length <= 22) return s;
  const mid = Math.floor(s.length / 2);
  return `${s.slice(0, mid)}<br>${s.slice(mid)}`;
}

async function cargarLotes() {
  const sescod = auth.getSession()?.sescod;

  // API devuelve: [{ lotcod, falla, yarda, total }]
  const data = await api.get(`/api/resumen/lotes?sescod=${encodeURIComponent(sescod)}`);
  const tbody = $('tablaLotes').querySelector('tbody');
  tbody.innerHTML = '';

  (data || []).forEach(row => {
    const tr = document.createElement('tr');
    tr.dataset.lot = row.lotcod;
    tr.innerHTML = `
      <td><a href="#" data-lot="${row.lotcod}">${row.lotcod}</a></td>
      <td>${Number(row.falla || 0)}</td>
      <td>${Number(row.yarda || 0)}</td>
      <td>${Number(row.total || 0)}</td>
    `;
    tr.addEventListener('click', (e) => {
      e.preventDefault();
      const lot = e.target?.closest('[data-lot]')?.dataset?.lot || tr.dataset.lot;
      if (lot) abrirDetalle(lot);
    });
    tbody.appendChild(tr);
  });
}

async function abrirDetalle(lotcod) {
  // Título del modal = N° de lote (sin prefijos)
  $('detTitulo').textContent = lotcod;

  const sescod = auth.getSession()?.sescod;

  // Detalle por nombre de falla (mi sesión): [{ desfal, total }]
  const data = await api.get(`/api/resumen/lote/sesion?lotcod=${encodeURIComponent(lotcod)}&sescod=${encodeURIComponent(sescod)}`);
  const tbody = $('tablaDet').querySelector('tbody');
  tbody.innerHTML = '';

  (data || []).forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="wrap">${breakMiddle(row.desfal || '')}</td>
      <td>${Number(row.total || 0)}</td>
    `;
    tbody.appendChild(tr);
  });

  openModal(true);
}

function openModal(v) {
  const m = $('modalDet');
  if (v) m.classList.add('open'); else m.classList.remove('open');
}
document.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => openModal(false))
);

(async function init() {
  try { await cargarLotes(); }
  catch (e) { alert(e.message || 'No se pudo cargar el resumen de lotes'); }
})();

// Flecha de volver (preferir historial; si no, ir a Remallado)
document.getElementById('btnBack')?.addEventListener('click', (e) => {
  e.preventDefault();
  try {
    if (document.referrer && new URL(document.referrer).pathname === '/remallado.html') {
      location.href = '/remallado.html';
    } else if (history.length > 1) {
      history.back();
    } else {
      location.href = '/remallado.html';
    }
  } catch {
    location.href = '/remallado.html';
  }
});
