const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

console.log('Starting server...');
const app = express();
const port = 3000;
console.log('Connecting to database...');
const db = new Database('inventory.db');
console.log('Database connected.');

// ── CONFIGURACIÓN N8N ────────────────────────────────────────────────────────
// Reemplaza esta URL con la que te proporcione tu nodo Webhook en n8n
const N8N_WEBHOOK_URL = 'http://REEMPLAZAR_CON_TU_URL_DE_N8N';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

console.log('Setting up tables...');

// ── DATABASE SETUP ──────────────────────────────────────────────────────────
db.exec(`
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

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Inicializar ajustes por defecto
const initSettings = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
initSettings.run('n8n_webhook_url', '');
initSettings.run('app_name', 'BOND Stock');

// Seed initial data if empty
const count = db.prepare('SELECT COUNT(*) as count FROM products').get();
if (count.count === 0) {
  const initialProducts = [
    ["Pechuga de pollo", "Carnes", 12, 5, "kg", 4.5, "Avícola Sur"],
    ["Carne molida", "Carnes", 3, 6, "kg", 5.2, "Avícola Sur"],
    ["Leche entera", "Lácteos", 20, 10, "litros", 0.9, ""],
    ["Queso mantecoso", "Lácteos", 0, 3, "kg", 8.0, "Lácteos del Sur"],
    ["Tomate", "Verduras", 8, 5, "kg", 1.1, ""],
    ["Lechuga", "Verduras", 4, 6, "unidades", 0.5, ""],
    ["Coca-Cola 2L", "Bebidas", 24, 12, "unidades", 1.8, "Distribuidora Norte"],
    ["Arroz grano largo", "Granos", 15, 10, "kg", 0.7, ""],
    ["Sal fina", "Especias", 2, 4, "kg", 0.4, ""]
  ];
  const insertProd = db.prepare('INSERT INTO products (nombre, cat, stock, min, unit, valor, prov) VALUES (?, ?, ?, ?, ?, ?, ?)');
  initialProducts.forEach(p => insertProd.run(p));
}

// ── API ENDPOINTS ────────────────────────────────────────────────────────────

// Products
app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products').all();
  res.json(products);
});

app.post('/api/products', (req, res) => {
  const { nombre, cat, stock, min, unit, valor, prov } = req.body;
  const info = db.prepare('INSERT INTO products (nombre, cat, stock, min, unit, valor, prov) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nombre, cat, stock, min, unit, valor, prov);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, cat, stock, min, unit, valor, prov } = req.body;
  db.prepare('UPDATE products SET nombre=?, cat=?, stock=?, min=?, unit=?, valor=?, prov=? WHERE id=?')
    .run(nombre, cat, stock, min, unit, valor, prov, id);
  res.json({ success: true });
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM products WHERE id=?').run(id);
  res.json({ success: true });
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

app.post('/api/settings', (req, res) => {
  const settings = req.body;
  const updateSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  
  const transaction = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      updateSetting.run(key, value);
    }
  });

  transaction(settings);
  res.json({ success: true });
});

// Movements
app.get('/api/movements', (req, res) => {
  const movements = db.prepare('SELECT * FROM movements ORDER BY id DESC').all();
  res.json(movements);
});

app.post('/api/movements', (req, res) => {
  const { product_id, prod_nombre, tipo, qty, nota, resp, fecha } = req.body;
  
  // Start transaction
  const transaction = db.transaction(() => {
    // Insert movement
    db.prepare('INSERT INTO movements (product_id, prod_nombre, tipo, qty, nota, resp, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(product_id, prod_nombre, tipo, qty, nota, resp, fecha);
    
    // Update product stock
    const product = db.prepare('SELECT stock FROM products WHERE id=?').get(product_id);
    let newStock = product.stock;
    if (tipo === 'in') newStock += qty;
    else if (tipo === 'out') newStock = Math.max(0, newStock - qty);
    else if (tipo === 'adj') newStock = qty;
    
    db.prepare('UPDATE products SET stock=? WHERE id=?').run(newStock, product_id);
    return newStock;
  });

  const newStock = transaction();

  // ENVÍO A N8N (En segundo plano para no ralentizar la app)
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
