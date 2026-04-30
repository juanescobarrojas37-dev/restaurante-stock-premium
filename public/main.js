// ── CONFIG ────────────────────────────────────────────────────────────────
const API_URL = '/api';
let AUTH_TOKEN = sessionStorage.getItem('auth_token');

// ── ESTADO ────────────────────────────────────────────────────────────────
let products = [];
let movements = [];
let auditLogs = [];
let settings  = { n8n_webhook_url: '', app_name: 'Las Rositas' };
let editId = null;
let currentPage = 'inventario';
let alertsDismissed = false;

// ── AUTH ──────────────────────────────────────────────────────────────────
function checkAuth() {
  const loginScreen = document.getElementById('login-screen');
  if (!AUTH_TOKEN) {
    loginScreen.style.display = 'flex';
  } else {
    loginScreen.style.display = 'none';
    const user = JSON.parse(sessionStorage.getItem('user_data') || '{}');
    document.getElementById('user-display').textContent = user.username || 'Admin';
    fetchData();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-user').value.toLowerCase().trim();
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
        sessionStorage.setItem('auth_token', data.token);
        sessionStorage.setItem('user_data', JSON.stringify(data.user));
        
        // Limpiamos los campos del formulario por si se cierra la sesión
        document.getElementById('login-user').value = '';
        document.getElementById('login-pass').value = '';
        errorEl.style.display = 'none';
        
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
  sessionStorage.removeItem('auth_token');
  sessionStorage.removeItem('user_data');
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
  
  if (alertsDismissed) {
    document.getElementById('badge-alertas').style.display = 'none';
  } else {
    document.getElementById('badge-alertas').textContent = tot;
    document.getElementById('badge-alertas').style.display = tot ? 'inline-block' : 'none';
  }
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
    return `<tr class="card-tr">
      <td data-label="Producto" class="td-name">${p.nombre}</td>
      <td data-label="Categoría"><span class="cat-pill">${p.cat}</span></td>
      <td data-label="Stock"><b>${p.stock}</b> <span class="td-muted">${p.unit}</span></td>
      <td data-label="Mínimo" class="td-muted">${p.min} ${p.unit}</td>
      <td data-label="Nivel"><div class="progress"><div class="progress-bar" style="width:${pct}%;background:${barColor}"></div></div></td>
      <td data-label="Valor unit.">$${p.valor.toFixed(2)}</td>
      <td data-label="Valor total">$${(p.stock * p.valor).toFixed(2)}</td>
      <td data-label="Estado"><span class="badge badge-${st === 'ok' ? 'ok' : st === 'warn' ? 'warn' : 'danger'}">${statusLabel(st)}</span></td>
      <td data-label="Acciones" class="td-actions">
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

function renderAlerts() {
  const alertList = document.getElementById('alert-list');
  if (!alertList) return;
  
  if (alertsDismissed) {
    alertList.innerHTML = '<div class="empty" style="color:var(--gray-text);">Las alertas han sido borradas de la vista temporalmente.</div>';
    return;
  }
  
  const alerts = products.filter(p => getStatus(p) !== 'ok').sort((a,b) => a.stock - b.stock);
  if (alerts.length === 0) {
    alertList.innerHTML = '<div class="empty">No hay alertas de stock en este momento</div>';
    return;
  }
  
  alertList.innerHTML = '<div class="card-body" style="padding-top:0">' + alerts.map(p => {
    const st = getStatus(p);
    const badgeClass = st === 'danger' ? 'badge-danger' : 'badge-warn';
    const label = st === 'danger' ? 'Agotado' : 'Bajo Stock';
    return `
      <div class="report-row" style="display:flex; justify-content:space-between; align-items:center; padding: 12px 0; border-bottom: 1px solid var(--border);">
        <div style="display:flex; align-items:center; gap:12px;">
          <span class="badge ${badgeClass}">${label}</span>
          <span style="font-weight:600; color: var(--text);">${p.nombre}</span>
        </div>
        <div style="text-align:right;">
          <b style="color:var(--text);">${p.stock}</b> <span class="td-muted">${p.unit}</span>
          <div style="font-size: 11px; color: var(--gray-text);">Mín: ${p.min}</div>
        </div>
      </div>
    `;
  }).join('') + '</div>';
}

function renderReports() {
  const catsDiv = document.getElementById('report-cats');
  const critDiv = document.getElementById('report-criticos');
  const sumDiv = document.getElementById('report-summary');
  
  if (!catsDiv || !critDiv || !sumDiv) return;

  const catsMap = {};
  products.forEach(p => {
    if (!catsMap[p.cat]) catsMap[p.cat] = 0;
    catsMap[p.cat] += (p.stock * p.valor);
  });
  
  let catsHtml = '';
  // Asegurarnos de que estas categorías siempre se muestren si tienen 0 valor, o solo las que tienen
  const allCats = ['Carnes', 'Lácteos', 'Verduras', 'Bebidas', 'Granos', 'Especias', 'Enlatados', 'Cereales', 'Procesados', 'Empaquetados', 'Otros'];
  allCats.forEach(cat => {
    if (catsMap[cat] !== undefined || catsMap[cat] > 0) {
      catsHtml += `
        <div class="report-row">
          <span><span class="cat-pill">${cat}</span></span>
          <span style="font-weight:600">$${(catsMap[cat] || 0).toLocaleString('es-CL', {minimumFractionDigits:2})}</span>
        </div>
      `;
    }
  });
  if (!catsHtml) catsHtml = '<div class="empty">No hay valor registrado</div>';
  catsDiv.innerHTML = catsHtml;

  const crits = products.filter(p => p.stock <= p.min).sort((a,b) => a.stock - b.stock).slice(0, 5);
  if (crits.length === 0) {
    critDiv.innerHTML = '<div class="empty">No hay productos en estado crítico</div>';
  } else {
    critDiv.innerHTML = '<div class="card-body" style="padding-top:0">' + crits.map(p => `
      <div class="report-row">
        <span>${p.nombre}</span>
        <span class="badge badge-danger">${p.stock} ${p.unit} (Mín: ${p.min})</span>
      </div>
    `).join('') + '</div>';
  }

  const totalInvertido = products.reduce((acc, p) => acc + (p.stock * p.valor), 0);
  const prodMayorValor = [...products].sort((a,b) => (b.stock*b.valor) - (a.stock*a.valor))[0];
  
  sumDiv.innerHTML = `
    <div class="report-row">
      <span>Total de ítems registrados</span>
      <b>${products.length}</b>
    </div>
    <div class="report-row">
      <span>Total de movs. históricos</span>
      <b>${movements.length}</b>
    </div>
    <div class="report-row">
      <span>Producto con mayor inversión</span>
      <b>${prodMayorValor ? prodMayorValor.nombre + ' ($' + (prodMayorValor.stock*prodMayorValor.valor).toLocaleString('es-CL') + ')' : '-'}</b>
    </div>
    <div class="report-total">
      <span>Capital Total Estimado</span>
      <span>$${totalInvertido.toLocaleString('es-CL', {minimumFractionDigits:2})}</span>
    </div>
  `;
}

function renderAll() {
  renderMetrics();
  renderTable();
  renderMovements();
  renderAuditLogs();
  renderAlerts();
  renderReports();
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
    btn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="fab-text">Agregar producto</span>';
    btn.onclick = openAddProduct;
  } else if (name === 'movimientos') {
    btn.style.display = 'inline-flex';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="fab-text">Registrar mov.</span>';
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

async function saveProduct(btn) {
  const submitBtn = btn || document.querySelector('#modal-product .btn.primary');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';
  
  try {
    const data = {
      nombre: document.getElementById('f-nombre').value,
      cat: document.getElementById('f-cat').value,
      unit: document.getElementById('f-unit').value,
      stock: parseFloat(document.getElementById('f-stock').value) || 0,
      min: parseFloat(document.getElementById('f-min').value) || 0,
      valor: parseFloat(document.getElementById('f-valor').value) || 0,
      prov: document.getElementById('f-prov').value
    };
    
    if (!data.nombre) {
      showToast('Por favor ingresa un nombre para el producto');
      return;
    }

    const url = editId ? `${API_URL}/products/${editId}` : `${API_URL}/products`;
    const res = await secureFetch(url, {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!res.ok) throw new Error('Error al guardar el producto');
    
    closeModal('modal-product');
    fetchData();
    showToast(editId ? 'Producto editado' : 'Producto creado', 'green');
  } catch (err) {
    showToast(err.message || 'Ocurrió un error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
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

async function saveMovement(btn) {
  const submitBtn = btn || document.querySelector('#modal-mv .btn.primary');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Registrando...';

  try {
    const pid = parseInt(document.getElementById('mv-prod').value);
    if (!pid) {
      showToast('Selecciona un producto primero');
      return;
    }
    const prod = products.find(p => p.id === pid);
    const qty = parseFloat(document.getElementById('mv-qty').value);
    
    if (!qty || qty <= 0) {
      showToast('La cantidad debe ser mayor a 0');
      return;
    }

    const data = {
      product_id: pid,
      prod_nombre: prod.nombre,
      tipo: document.getElementById('mv-tipo').value,
      qty: qty,
      nota: document.getElementById('mv-nota').value,
      resp: document.getElementById('mv-resp').value || 'Usuario',
      fecha: fmtNow()
    };
    
    const res = await secureFetch(`${API_URL}/movements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!res.ok) throw new Error('Error al registrar movimiento');

    closeModal('modal-mv');
    fetchData();
    showToast('Movimiento registrado', 'green');
  } catch (err) {
    showToast(err.message || 'Ocurrió un error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

function fillSettingsForm() {
  const urlEl = document.getElementById('set-n8n-url');
  const nameEl = document.getElementById('set-app-name');
  if (urlEl) urlEl.value = settings.n8n_webhook_url || '';
  if (nameEl) nameEl.value = settings.app_name || 'Las Rositas';
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
function showToast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show';
  if (color === 'green') t.style.background = '#1D9E75';
  else t.style.background = '#333';
  setTimeout(() => { t.classList.remove('show'); t.style.background = '#333'; }, 2000);
}

function clearAlerts() {
  alertsDismissed = true;
  renderAll();
  showToast('Alertas borradas de la vista', 'green');
}

// ── INIT ──────────────────────────────────────────────────────────────────
checkAuth();
