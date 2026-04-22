// ── CONFIG ────────────────────────────────────────────────────────────────
const API_URL = '/api';
let AUTH_TOKEN = localStorage.getItem('auth_token');

// ── ESTADO ────────────────────────────────────────────────────────────────
let products = [];
let movements = [];
let auditLogs = [];
let settings  = { n8n_webhook_url: '', app_name: 'BOND Stock' };
let editId = null;
let currentPage = 'inventario';

// ── AUTH ──────────────────────────────────────────────────────────────────
function checkAuth() {
  const loginScreen = document.getElementById('login-screen');
  if (!AUTH_TOKEN) {
    loginScreen.style.display = 'flex';
  } else {
    loginScreen.style.display = 'none';
    const user = JSON.parse(localStorage.getItem('user_data') || '{}');
    document.getElementById('user-display').textContent = user.username || 'Admin';
    fetchData();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-user').value;
  const password = document.getElementById('login-pass').value;
  const errorEl = document.getElementById('login-error');
  
  try {
    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    if (res.ok) {
      const data = await res.json();
      AUTH_TOKEN = data.token;
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('user_data', JSON.stringify(data.user));
      checkAuth();
    } else {
      errorEl.textContent = 'Usuario o contraseña incorrectos';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'Error al conectar con el servidor';
    errorEl.style.display = 'block';
  }
}

function logout() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user_data');
  location.reload();
}

// ── DATA FETCHING ─────────────────────────────────────────────────────────
async function secureFetch(url, options = {}) {
  options.headers = {
    ...options.headers,
    'Authorization': `Bearer ${AUTH_TOKEN}`
  };
  const res = await fetch(url, options);
  if (res.status === 401 || res.status === 403) logout();
  return res;
}

async function fetchData() {
  try {
    const [pRes, mRes, sRes, aRes] = await Promise.all([
      secureFetch(`${API_URL}/products`),
      secureFetch(`${API_URL}/movements`),
      secureFetch(`${API_URL}/settings`),
      secureFetch(`${API_URL}/audit`)
    ]);
    
    products  = await pRes.json();
    movements = await mRes.json();
    settings  = await sRes.json();
    auditLogs = await aRes.json();
    
    if (settings.app_name) {
      document.querySelector('.sidebar-logo span').textContent = settings.app_name;
      document.title = settings.app_name + ' — Inventario Premium';
    }

    renderAll();
    fillSettingsForm();
  } catch (err) {
    console.error(err);
  }
}

function fmtNow() {
  const d = new Date();
  return d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', {hour:'2-digit',minute:'2-digit'});
}

// ── RENDERING ─────────────────────────────────────────────────────────────
function renderAuditLogs() {
  const tbody = document.getElementById('audit-body');
  if (!auditLogs.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">No hay registros</td></tr>';
    return;
  }
  tbody.innerHTML = auditLogs.map(log => `
    <tr>
      <td style="font-size:12px">${log.fecha}</td>
      <td><b>${log.username}</b></td>
      <td><span class="badge badge-ok">${log.action}</span></td>
      <td class="td-muted">${log.details}</td>
    </tr>
  `).join('');
}

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

function getStatus(p) {
  if (p.stock === 0) return 'danger';
  if (p.stock < p.min) return 'warn';
  return 'ok';
}
function statusLabel(s) {
  return s === 'ok' ? 'Normal' : s === 'warn' ? 'Bajo' : 'Agotado';
}

function renderTable() {
  const q = document.getElementById('search').value.toLowerCase();
  const cat = document.getElementById('cat-filter').value;
  const filtered = products.filter(p => (!q || p.nombre.toLowerCase().includes(q)) && (!cat || p.cat === cat));
  const tbody = document.getElementById('tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><div class="e-icon">🔍</div>Sin resultados</div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const st = getStatus(p);
    const pct = Math.min(100, Math.round(p.stock / Math.max(p.min * 2, 1) * 100));
    const barColor = st === 'ok' ? '#1D9E75' : st === 'warn' ? '#EF9F27' : '#E24B4A';
    return `<tr>
      <td class="td-name">${p.nombre}</td>
      <td><span class="cat-pill">${p.cat}</span></td>
      <td><b>${p.stock}</b> <span class="td-muted">${p.unit}</span></td>
      <td class="td-muted">${p.min} ${p.unit}</td>
      <td><div class="progress"><div class="progress-bar" style="width:${pct}%;background:${barColor}"></div></div></td>
      <td>$${p.valor.toFixed(2)}</td>
      <td>$${(p.stock * p.valor).toFixed(2)}</td>
      <td><span class="badge badge-${st === 'ok' ? 'ok' : st === 'warn' ? 'warn' : 'danger'}">${statusLabel(st)}</span></td>
      <td>
        <button class="btn sm" onclick="openEditProduct(${p.id})">Editar</button>
        <button class="btn sm" onclick="openMovement(${p.id})">Mover</button>
        <button class="btn sm danger" onclick="deleteProduct(${p.id})">Borrar</button>
      </td>
    </tr>`;
  }).join('');
}

function renderMovements() {
  const list = document.getElementById('mv-list');
  list.innerHTML = movements.map(m => `
    <div class="mv-item">
      <span class="mv-tag tag-${m.tipo}">${m.tipo.toUpperCase()}</span>
      <div class="mv-info">
        <div class="mv-name">${m.prod_nombre}</div>
        <div class="mv-sub">${m.nota} · ${m.resp} · ${m.fecha}</div>
      </div>
      <div class="mv-qty qty-${m.tipo}">${m.tipo === 'in' ? '+' : '-'}${m.qty}</div>
    </div>
  `).join('');
}

function renderAll() {
  renderMetrics();
  renderTable();
  renderMovements();
  renderAuditLogs();
  updateN8nUI();
}

// ── NAVIGATION ────────────────────────────────────────────────────────────
function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  
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
}

// ── MODALS & ACTIONS ──────────────────────────────────────────────────────
function openAddProduct() {
  editId = null;
  document.getElementById('modal-title').textContent = 'Agregar producto';
  ['f-nombre','f-stock','f-min','f-valor','f-prov'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('modal-product').classList.add('open');
}

function openEditProduct(id) {
  const p = products.find(x => x.id === id);
  editId = id;
  document.getElementById('modal-title').textContent = 'Editar producto';
  document.getElementById('f-nombre').value = p.nombre;
  document.getElementById('f-cat').value = p.cat;
  document.getElementById('f-unit').value = p.unit;
  document.getElementById('f-stock').value = p.stock;
  document.getElementById('f-min').value = p.min;
  document.getElementById('f-valor').value = p.valor;
  document.getElementById('f-prov').value = p.prov || '';
  document.getElementById('modal-product').classList.add('open');
}

async function saveProduct() {
  const data = {
    nombre: document.getElementById('f-nombre').value,
    cat: document.getElementById('f-cat').value,
    unit: document.getElementById('f-unit').value,
    stock: parseFloat(document.getElementById('f-stock').value),
    min: parseFloat(document.getElementById('f-min').value),
    valor: parseFloat(document.getElementById('f-valor').value),
    prov: document.getElementById('f-prov').value
  };
  const url = editId ? `${API_URL}/products/${editId}` : `${API_URL}/products`;
  await secureFetch(url, {
    method: editId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  closeModal('modal-product');
  fetchData();
}

async function deleteProduct(id) {
  if (!confirm('¿Eliminar producto de forma permanente?')) return;
  try {
    const res = await secureFetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error en el servidor');
    showToast('Producto borrado');
    fetchData();
  } catch(e) {
    showToast('Error al borrar producto');
  }
}

function openMovement(preId) {
  const sel = document.getElementById('mv-prod');
  sel.innerHTML = products.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
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
    qty: parseFloat(document.getElementById('mv-qty').value),
    nota: document.getElementById('mv-nota').value,
    resp: document.getElementById('mv-resp').value,
    fecha: fmtNow()
  };
  await secureFetch(`${API_URL}/movements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  closeModal('modal-mv');
  fetchData();
}

function fillSettingsForm() {
  const urlEl = document.getElementById('set-n8n-url');
  const nameEl = document.getElementById('set-app-name');
  if (urlEl) urlEl.value = settings.n8n_webhook_url || '';
  if (nameEl) nameEl.value = settings.app_name || 'BOND Stock';
}

async function saveSettings() {
  const data = {
    n8n_webhook_url: document.getElementById('set-n8n-url').value,
    app_name: document.getElementById('set-app-name').value
  };
  await secureFetch(`${API_URL}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  showToast('Ajustes guardados');
  fetchData();
}

function updateN8nUI() {
  const statusEl = document.getElementById('n8n-status');
  if (!statusEl) return;
  const isOk = settings.n8n_webhook_url && settings.n8n_webhook_url.startsWith('http');
  statusEl.querySelector('.alert-dot').className = `alert-dot ${isOk ? '' : 'dot-warn'}`;
  document.getElementById('n8n-desc').textContent = isOk ? 'Sincronización activa' : 'Pendiente de configurar';
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show';
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ── INIT ──────────────────────────────────────────────────────────────────
checkAuth();
