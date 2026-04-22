const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

console.log('Starting secured server...');
const app = express();
const port = process.env.PORT || 3000;
const dbPath = process.env.DB_PATH || 'inventory.db';
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_restaurant_2026';

const db = new Database(dbPath);
console.log('Database connected.');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

console.log('Setting up tables...');

// ── DATABASE SETUP ──────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    cat TEXT,
    stock REAL DEFAULT 0,
    min REAL DEFAULT 0,
    unit TEXT,
    valor REAL DEFAULT 0,
    prov TEXT
  );

  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    prod_nombre TEXT,
    tipo TEXT,
    qty REAL,
    nota TEXT,
    resp TEXT,
    fecha TEXT,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT,
    details TEXT,
    fecha TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Inicializar ajustes por defecto
const initSettings = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
initSettings.run('n8n_webhook_url', '');
initSettings.run('app_name', 'BOND Stock');

// Crear usuario administrador por defecto si no existe (gaelguapo500@gmail.com / 123456#)
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('gaelguapo500@gmail.com');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('123456#', 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
    .run('gaelguapo500@gmail.com', hashedPassword, 'admin');
}

// Helper: Registrar actividad
function logActivity(userId, username, action, details) {
  const fecha = new Date().toLocaleString('es-CL');
  db.prepare('INSERT INTO audit_logs (user_id, username, action, details, fecha) VALUES (?, ?, ?, ?, ?)')
    .run(userId, username, action, details, fecha);
}

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
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

// ── AUTH ENDPOINTS ────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: 'Credenciales inválidas' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  logActivity(user.id, user.username, 'Login', 'Usuario ingresó al sistema');
  res.json({ token, user: { username: user.username, role: user.role } });
});

// ── API ENDPOINTS (PROTECTED) ────────────────────────────────────────────────

// Products
app.get('/api/products', authenticateToken, (req, res) => {
  const products = db.prepare('SELECT * FROM products').all();
  res.json(products);
});

app.post('/api/products', authenticateToken, (req, res) => {
  const { nombre, cat, stock, min, unit, valor, prov } = req.body;
  const info = db.prepare('INSERT INTO products (nombre, cat, stock, min, unit, valor, prov) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nombre, cat, stock, min, unit, valor, prov);
  logActivity(req.user.id, req.user.username, 'Agregar Producto', `Creó: ${nombre}`);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/products/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { nombre, cat, stock, min, unit, valor, prov } = req.body;
  db.prepare('UPDATE products SET nombre=?, cat=?, stock=?, min=?, unit=?, valor=?, prov=? WHERE id=?')
    .run(nombre, cat, stock, min, unit, valor, prov, id);
  logActivity(req.user.id, req.user.username, 'Editar Producto', `Editó: ${nombre} (ID: ${id})`);
  res.json({ success: true });
});

app.delete('/api/products/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const product = db.prepare('SELECT nombre FROM products WHERE id = ?').get(id);
    
    // Primero, para que sea seguro, borramos el historial de movimientos de este producto
    db.prepare('DELETE FROM movements WHERE product_id=?').run(id);
    
    // Luego borramos el producto principal
    db.prepare('DELETE FROM products WHERE id=?').run(id);
    
    logActivity(req.user.id, req.user.username, 'Eliminar Producto', `Borró: ${product ? product.nombre : id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Error al borrar producto:', err);
    res.status(500).json({ error: 'No se pudo eliminar el producto' });
  }
});

// Settings
app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const settingsMap = settings.reduce((acc, curr) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});
  res.json(settingsMap);
});

app.post('/api/settings', authenticateToken, (req, res) => {
  const settings = req.body;
  const updateSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  
  const transaction = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      updateSetting.run(key, value);
    }
  });

  transaction(settings);
  logActivity(req.user.id, req.user.username, 'Ajustes', 'Actualizó configuración del sistema');
  res.json({ success: true });
});

// Audit Logs
app.get('/api/audit', authenticateToken, (req, res) => {
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all();
  res.json(logs);
});

// Movements
app.get('/api/movements', authenticateToken, (req, res) => {
  const movements = db.prepare('SELECT * FROM movements ORDER BY id DESC').all();
  res.json(movements);
});

app.post('/api/movements', authenticateToken, (req, res) => {
  const { product_id, prod_nombre, tipo, qty, nota, resp, fecha } = req.body;
  
  const transaction = db.transaction(() => {
    db.prepare('INSERT INTO movements (product_id, prod_nombre, tipo, qty, nota, resp, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(product_id, prod_nombre, tipo, qty, nota, resp, fecha);
    
    const product = db.prepare('SELECT stock FROM products WHERE id=?').get(product_id);
    let newStock = product.stock;
    if (tipo === 'in') newStock += qty;
    else if (tipo === 'out') newStock = Math.max(0, newStock - qty);
    else if (tipo === 'adj') newStock = qty;
    
    db.prepare('UPDATE products SET stock=? WHERE id=?').run(newStock, product_id);
    return newStock;
  });

  const newStock = transaction();
  logActivity(req.user.id, req.user.username, 'Movimiento', `${tipo.toUpperCase()}: ${prod_nombre} (${qty})`);

  // ENVÍO A N8N
  const settings = db.prepare('SELECT value FROM settings WHERE key = ?').get('n8n_webhook_url');
  const n8nUrl = settings ? settings.value : null;

  if (n8nUrl && n8nUrl.startsWith('http')) {
    fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_producto: product_id,
        producto: prod_nombre,
        tipo: tipo === 'in' ? 'Entrada' : (tipo === 'out' ? 'Salida' : 'Ajuste'),
        cantidad: qty,
        nota: nota || '',
        responsable: resp || '',
        usuario_sistema: req.user.username,
        fecha: fecha,
        stock_resultante: newStock
      })
    }).catch(err => console.error('Error enviando a n8n:', err));
  }

  res.json({ success: true, newStock });
});

console.log('Starting listener...');
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
