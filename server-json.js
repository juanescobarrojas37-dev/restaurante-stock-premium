const express = require('express');
const cors = require('cors');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

console.log('Iniciando servidor local (JSON mode)...');
const app = express();
const port = 3000;
const JWT_SECRET = 'secret_key_restaurant_2026';
const DB_FILE = './local-db.json';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Estructura de base de datos
let db = {
  users: [],
  products: [],
  movements: [],
  audit_logs: [],
  settings: {
    n8n_webhook_url: '',
    app_name: 'Las Margaritas (Local)'
  }
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) { console.log('Error leyendo db.json'); }
} else {
  // Inicializar admin
  db.users.push({
    id: 1,
    username: 'gaelguapo500@gmail.com',
    password: bcrypt.hashSync('123456#', 10),
    role: 'admin'
  });
  saveDb();
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function logActivity(userId, username, action, details) {
  const fecha = new Date().toLocaleString('es-CL');
  db.audit_logs.push({
    id: Date.now(),
    user_id: userId,
    username,
    action,
    details,
    fecha
  });
  saveDb();
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// ── AUTH ENDPOINTS ──
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: 'Credenciales inválidas' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  logActivity(user.id, user.username, 'Login', 'Usuario ingresó al sistema');
  res.json({ token, user: { username: user.username, role: user.role } });
});

// ── API ENDPOINTS ──
app.get('/api/products', authenticateToken, (req, res) => res.json(db.products));

app.post('/api/products', authenticateToken, (req, res) => {
  const p = req.body;
  p.id = Date.now();
  db.products.push(p);
  logActivity(req.user.id, req.user.username, 'Agregar Producto', `Creó: ${p.nombre}`);
  saveDb();
  res.json({ id: p.id });
});

app.put('/api/products/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id);
  const index = db.products.findIndex(p => p.id === id || p.id === req.params.id);
  if (index !== -1) {
    db.products[index] = { ...db.products[index], ...req.body };
    logActivity(req.user.id, req.user.username, 'Editar Producto', `Editó: ${db.products[index].nombre}`);
    saveDb();
  }
  res.json({ success: true });
});

app.delete('/api/products/:id', authenticateToken, (req, res) => {
  const id = parseInt(req.params.id);
  db.movements = db.movements.filter(m => m.product_id !== id);
  db.products = db.products.filter(p => p.id !== id);
  logActivity(req.user.id, req.user.username, 'Eliminar Producto', `Borró producto ID: ${id}`);
  saveDb();
  res.json({ success: true });
});

app.get('/api/settings', (req, res) => res.json(db.settings));

app.post('/api/settings', authenticateToken, (req, res) => {
  db.settings = { ...db.settings, ...req.body };
  logActivity(req.user.id, req.user.username, 'Ajustes', 'Actualizó configuración');
  saveDb();
  res.json({ success: true });
});

app.get('/api/audit', authenticateToken, (req, res) => {
  res.json([...db.audit_logs].reverse().slice(0, 200));
});

app.get('/api/movements', authenticateToken, (req, res) => {
  res.json([...db.movements].reverse());
});

app.post('/api/movements', authenticateToken, (req, res) => {
  const m = req.body;
  m.id = Date.now();
  db.movements.push(m);
  
  const p = db.products.find(p => p.id === m.product_id);
  let newStock = p ? p.stock : 0;
  if (p) {
    if (m.tipo === 'in') newStock += m.qty;
    else if (m.tipo === 'out') newStock = Math.max(0, newStock - m.qty);
    else if (m.tipo === 'adj') newStock = m.qty;
    p.stock = newStock;
  }
  
  logActivity(req.user.id, req.user.username, 'Movimiento', `${m.tipo.toUpperCase()}: ${m.prod_nombre}`);
  saveDb();
  res.json({ success: true, newStock });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Server running at http://127.0.0.1:${port}`);
});
