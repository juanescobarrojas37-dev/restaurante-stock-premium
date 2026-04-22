// ── CONFIG ────────────────────────────────────────────────────────────────
const API_URL = '/api';

// ── ESTADO ────────────────────────────────────────────────────────────────
let products = [];
let movements = [];
let settings  = { n8n_webhook_url: '', app_name: 'BOND Stock' };
let editId = null;
let currentPage = 'inventario';

// ── DATA FETCHING ─────────────────────────────────────────────────────────
async function fetchData() {
  try {
    const [pRes, mRes, sRes] = await Promise.all([
      fetch(`${API_URL}/products`),
      fetch(`${API_URL}/movements`),
      fetch(`${API_URL}/settings`)
    ]);
    products  = await pRes.json();
    movements = await mRes.json();
    settings  = await sRes.json();
    
    // Aplicar nombre de app
    if (settings.app_name) {
      document.querySelector('.sidebar-logo span').textContent = settings.app_name;
      document.title = settings.app_name + ' — Inventario Premium';
    }

    renderAll();
    fillSettingsForm();
  } catch (err) {
    showToast('Error al conectar con el servidor', 'red');
    console.error(err);
  }
}

function fmtNow() {
  const d = new Date();
  return d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit',minute:'2-digit'});
}

// ── STATUS ────────────────────────────────────────────────────────────────
function getStatus(p) {
  if (p.stock === 0) return 'danger';
  if (p.stock < p.min) return 'warn';
  return 'ok';
}
function statusLabel(s) {
  return s === 'ok' ? 'Normal' : s === 'warn' ? 'Bajo' : 'Agotado';
}

// ── METRICS ───────────────────────────────────────────────────────────────
function renderMetrics() {
  const valor = products.reduce((a,p) => a + p.stock * p.valor, 0);
  const warn  = products.filter(p => getStatus(p) === 'warn').length;
  const crit  = products.filter(p => getStatus(p) === 'danger').length;
  document.getElementById('m-total').textContent = products.length;
  document.getElementById('m-valor').textContent = '$' + valor.toLocaleString('es-CL', { minimumFractionDigits: 2 });
  document.getElementById('m-warn').textContent  = warn;
  document.getElementById('m-crit').textContent  = crit;
  const tot = warn + crit;
  document.getElementById('badge-alertas').textContent = tot;
  document.getElementById('badge-alertas').style.display = tot ? 'inline-block' : 'none';
}

// ── TABLE ─────────────────────────────────────────────────────────────────
function renderTable() {
  const q   = document.getElementById('search').value.toLowerCase();
  const cat = document.getElementById('cat-filter').value;
  const filtered = products.filter(p =>
    (!q   || p.nombre.toLowerCase().includes(q)) &&
    (!cat || p.cat === cat)
  );
  const tbody = document.getElementById('tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><div class="e-icon">🔍</div>Sin resultados</div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const st  = getStatus(p);
    const pct = Math.min(100, Math.round(p.stock / Math.max(p.min * 2, 1) * 100));
    const barColor = st === 'ok' ? '#1D9E75' : st === 'warn' ? '#EF9F27' : '#E24B4A';
    const total = (p.stock * p.valor).toFixed(2);
    return `<tr>
      <td class="td-name">${p.nombre}${p.prov ? `<br><span class="td-muted" style="font-size:11px">${p.prov}</span>` : ''}</td>
      <td><span class="cat-pill">${p.cat}</span></td>
      <td><b>${p.stock}</b> <span class="td-muted">${p.unit}</span></td>
      <td class="td-muted">${p.min} ${p.unit}</td>
      <td><div class="progress"><div class="progress-bar" style="width:${pct}%;background:${barColor}"></div></div></td>
      <td>$${p.valor.toFixed(2)}</td>
      <td>$${total}</td>
      <td><span class="badge badge-${st === 'ok' ? 'ok' : st === 'warn' ? 'warn' : 'danger'}">${statusLabel(st)}</span></td>
      <td style="white-space:nowrap">
        <button class="btn sm" onclick="openEditProduct(${p.id})">Editar</button>
        <button class="btn sm" onclick="openMovement(${p.id})">Mover</button>
        <button class="btn sm danger" onclick="deleteProduct(${p.id})">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ── ALERTS ────────────────────────────────────────────────────────────────
function renderAlerts() {
  const alerts = products.filter(p => getStatus(p) !== 'ok')
    .sort((a,b) => (getStatus(a) === 'danger' ? -1 : 1));
  const list = document.getElementById('alert-list');
  if (!alerts.length) {
    list.innerHTML = '<div class="empty"><div class="e-icon">✅</div>Todo el stock está en orden</div>';
    return;
  }
  list.innerHTML = alerts.map(p => {
    const st = getStatus(p);
    const msg = st === 'danger'
      ? `Agotado — mínimo requerido: ${p.min} ${p.unit}`
      : `Stock actual: ${p.stock} ${p.unit} — mínimo: ${p.min} ${p.unit}`;
    return `<div class="alert-item">
      <div class="alert-dot dot-${st === 'danger' ? 'danger' : 'warn'}">${st === 'danger' ? '✕' : '!'}</div>
      <div class="alert-info">
        <div class="a-title">${p.nombre} <span class="td-muted" style="font-size:11px">${p.cat}</span></div>
        <div class="a-desc">${msg}</div>
      </div>
      <span class="badge badge-${st === 'danger' ? 'danger' : 'warn'}">${statusLabel(st)}</span>
      <button class="btn sm" style="margin-left:8px" onclick="openMovement(${p.id})">Reponer</button>
    </div>`;
  }).join('');
}

// ── MOVEMENTS ─────────────────────────────────────────────────────────────
function renderMovements() {
  const list = document.getElementById('mv-list');
  if (!movements.length) {
    list.innerHTML = '<div class="empty"><div class="e-icon">📋</div>Sin movimientos registrados</div>';
    return;
  }
  list.innerHTML = [...movements].map(m => {
    const cls  = m.tipo === 'in' ? 'in' : m.tipo === 'out' ? 'out' : 'adj';
    const lbl  = m.tipo === 'in' ? 'Entrada' : m.tipo === 'out' ? 'Salida' : 'Ajuste';
    const sign = m.tipo === 'in' ? '+' : m.tipo === 'out' ? '-' : '~';
    return `<div class="mv-item">
      <span class="mv-tag tag-${cls}">${lbl}</span>
      <div class="mv-info">
        <div class="mv-name">${m.prod_nombre}</div>
        <div class="mv-sub">${m.nota || '—'} ${m.resp ? '· ' + m.resp : ''} · ${m.fecha}</div>
      </div>
      <div class="mv-qty qty-${cls}">${sign}${m.qty}</div>
    </div>`;
  }).join('');
}

// ── REPORTS ───────────────────────────────────────────────────────────────
function renderReports() {
  const cats = [...new Set(products.map(p => p.cat))];
  const total = products.reduce((a,p) => a + p.stock * p.valor, 0);

  // Por categoría
  document.getElementById('report-cats').innerHTML = cats.map(c => {
    const prods = products.filter(p => p.cat === c);
    const val   = prods.reduce((a,p) => a + p.stock * p.valor, 0);
    const pct   = total > 0 ? (val / total * 100).toFixed(1) : 0;
    return `<div class="report-row">
      <span class="cat-pill">${c}</span>
      <span class="td-muted">${prods.length} productos</span>
      <span><b>$${val.toFixed(2)}</b> <span class="td-muted">(${pct}%)</span></span>
    </div>`;
  }).join('') + `<div class="report-total"><span>Total inventario</span><span>$${total.toFixed(2)}</span></div>`;

  // Críticos
  const criticos = products.filter(p => getStatus(p) !== 'ok');
  document.getElementById('report-criticos').innerHTML = criticos.length
    ? criticos.map(p => `<div class="alert-item">
        <div class="alert-dot dot-${getStatus(p) === 'danger' ? 'danger' : 'warn'}">${getStatus(p) === 'danger' ? '✕' : '!'}</div>
        <div class="alert-info"><div class="a-title">${p.nombre}</div><div class="a-desc">${p.stock} / ${p.min} ${p.unit}</div></div>
      </div>`).join('')
    : '<div class="empty">Sin productos críticos</div>';

  // Summary
  const avgVal = products.length ? (total / products.length).toFixed(2) : 0;
  const topVal = [...products].sort((a,b) => b.stock*b.valor - a.stock*a.valor)[0];
  document.getElementById('report-summary').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      <div><div class="m-label">Valor promedio</div><div style="font-size:18px;font-weight:700">$${avgVal}</div></div>
      <div><div class="m-label">Más valioso</div><div style="font-size:13px;font-weight:600">${topVal ? topVal.nombre : '—'}</div></div>
      <div><div class="m-label">Total movimientos</div><div style="font-size:18px;font-weight:700">${movements.length}</div></div>
    </div>`;
}

function renderAll() {
  renderMetrics();
  renderTable();
  renderAlerts();
  renderMovements();
  renderReports();
  updateN8nUI();
}

// ── NAVIGATION ────────────────────────────────────────────────────────────
function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  currentPage = name;
  const btn = document.getElementById('btn-action');
  if (name === 'inventario') {
    btn.style.display = 'inline-flex';
    btn.textContent = '+ Agregar producto';
    btn.onclick = openAddProduct;
  } else if (name === 'movimientos') {
    btn.style.display = 'inline-flex';
    btn.textContent = '+ Registrar movimiento';
    btn.onclick = () => openMovement(null);
  } else {
    btn.style.display = 'none';
  }

  // Update Topbar
  const titles = {
    'inventario': ['Inventario', 'Gestiona todos tus insumos'],
    'alertas': ['Alertas', 'Productos que requieren atención'],
    'movimientos': ['Movimientos', 'Historial reciente de stock'],
    'reportes': ['Reportes', 'Análisis detallado de inventario'],
    'ajustes': ['Ajustes', 'Configuración de n8n y aplicación']
  };
  const [t, s] = titles[name] || ['Stock', ''];
  document.getElementById('page-title').textContent = t;
  document.getElementById('page-sub').textContent = s;
}

// ── SETTINGS ──────────────────────────────────────────────────────────────
function fillSettingsForm() {
  if (document.getElementById('set-n8n-url')) {
    document.getElementById('set-n8n-url').value = settings.n8n_webhook_url || '';
    document.getElementById('set-app-name').value = settings.app_name || 'BOND Stock';
  }
}

async function saveSettings() {
  const data = {
    n8n_webhook_url: document.getElementById('set-n8n-url').value.trim(),
    app_name: document.getElementById('set-app-name').value.trim()
  };

  try {
    await fetch(`${API_URL}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    showToast('Ajustes guardados', 'green');
    settings = { ...settings, ...data };
    
    // Aplicar visualmente
    document.querySelector('.sidebar-logo span').textContent = data.app_name;
    updateN8nUI();
  } catch (err) {
    showToast('Error al guardar ajustes', 'red');
  }
}

function updateN8nUI() {
  const statusEl = document.getElementById('n8n-status');
  if (!statusEl) return;
  const dot = statusEl.querySelector('.alert-dot');
  const desc = document.getElementById('n8n-desc');
  
  if (settings.n8n_webhook_url && settings.n8n_webhook_url.startsWith('http')) {
    dot.className = 'alert-dot';
    dot.style.background = 'var(--green-light)';
    dot.style.color = 'var(--green-dark)';
    dot.textContent = '✓';
    desc.textContent = 'Integración activa. Los movimientos se están sincronizando.';
  } else {
    dot.className = 'alert-dot dot-warn';
    dot.style.background = '';
    dot.style.color = '';
    dot.textContent = '!';
    desc.textContent = 'Introduce una URL válida para activar la sincronización automática.';
  }
}

// ── PRODUCT MODAL ─────────────────────────────────────────────────────────
function openAddProduct() {
  editId = null;
  document.getElementById('modal-title').textContent = 'Agregar producto';
  ['f-nombre','f-stock','f-min','f-valor','f-prov'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('modal-product').classList.add('open');
}
function openEditProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  editId = id;
  document.getElementById('modal-title').textContent = 'Editar producto';
  document.getElementById('f-nombre').value = p.nombre;
  document.getElementById('f-cat').value    = p.cat;
  document.getElementById('f-unit').value   = p.unit;
  document.getElementById('f-stock').value  = p.stock;
  document.getElementById('f-min').value    = p.min;
  document.getElementById('f-valor').value  = p.valor;
  document.getElementById('f-prov').value   = p.prov || '';
  document.getElementById('modal-product').classList.add('open');
}

async function saveProduct() {
  const nombre = document.getElementById('f-nombre').value.trim();
  if (!nombre) { showToast('Escribe el nombre'); return; }
  const data = {
    nombre,
    cat: document.getElementById('f-cat').value,
    unit: document.getElementById('f-unit').value,
    stock: parseFloat(document.getElementById('f-stock').value) || 0,
    min: parseFloat(document.getElementById('f-min').value) || 0,
    valor: parseFloat(document.getElementById('f-valor').value) || 0,
    prov: document.getElementById('f-prov').value.trim()
  };

  try {
    const url = editId ? `${API_URL}/products/${editId}` : `${API_URL}/products`;
    const method = editId ? 'PUT' : 'POST';
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    showToast(editId ? 'Actualizado' : 'Agregado', 'green');
    closeModal('modal-product');
    fetchData();
  } catch (err) {
    showToast('Error al guardar', 'red');
  }
}

async function deleteProduct(id) {
  if (!confirm('¿Eliminar?')) return;
  try {
    await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
    showToast('Eliminado');
    fetchData();
  } catch (err) {
    showToast('Error al eliminar', 'red');
  }
}

// ── MOVEMENT MODAL ────────────────────────────────────────────────────────
function openMovement(preId) {
  const sel = document.getElementById('mv-prod');
  sel.innerHTML = products.map(p => `<option value="${p.id}">${p.nombre} (${p.stock} ${p.unit})</option>`).join('');
  if (preId) sel.value = preId;
  document.getElementById('modal-mv').classList.add('open');
}

async function saveMovement() {
  const pid = parseInt(document.getElementById('mv-prod').value);
  const prod = products.find(p => p.id === pid);
  const data = {
    product_id: pid,
    prod_nombre: prod.nombre,
    tipo: document.getElementById('mv-tipo').value,
    qty: parseFloat(document.getElementById('mv-qty').value) || 0,
    nota: document.getElementById('mv-nota').value.trim(),
    resp: document.getElementById('mv-resp').value.trim(),
    fecha: fmtNow()
  };

  if (data.qty <= 0) { showToast('Cantidad inválida'); return; }

  try {
    await fetch(`${API_URL}/movements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    showToast('Movimiento registrado', 'green');
    closeModal('modal-mv');
    fetchData();
  } catch (err) {
    showToast('Error al registrar', 'red');
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function showToast(msg, cls) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (cls || '');
  setTimeout(() => t.classList.remove('show'), 2000);
}

document.querySelectorAll('.modal-bg').forEach(bg => {
  bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); });
});

// ── INIT ──────────────────────────────────────────────────────────────────
fetchData();
