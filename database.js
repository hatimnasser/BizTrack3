// src/utils/database.js — BizTrack Pro v4.1
// Unit Conversion Engine + Weighted Moving Average Costing
// IMPORTANT: NO inline SQL comments (--) inside the SCHEMA template literal.
// A semicolon inside a -- comment causes SCHEMA.split(';') to produce invalid SQL fragments.
// All schema documentation is in JS comments (// style) outside the template literal.

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

const DB_NAME = 'biztrack_pro';
const DB_VERSION = 4;
let db = null;
let sqliteConnection = null;

// Schema fields reference (JS comments only - never put these inside the SQL strings):
//   inventory.baseUnit          = what you sell per (kg, bottle, pc)
//   inventory.purchaseUnit      = what you buy per (bag, crate, box)
//   inventory.conversionFactor  = base units per purchase unit (e.g. 24 bottles/crate)
//   inventory.wmaCost           = weighted moving average cost per BASE unit
//   inventory.costPrice         = alias for wmaCost, kept for backward compat
//   inventory.stock             = always stored in BASE units
//   inventory.reorderLevel      = per-product alert threshold in BASE units
//   wma_history.alertType       = INITIAL | NO_CHANGE | MARGIN_GAIN | PRICE_PROTECTION

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY,
  bizName TEXT DEFAULT 'My Business',
  owner TEXT DEFAULT '',
  type TEXT DEFAULT 'General Shop',
  currency TEXT DEFAULT 'UGX',
  payTerms INTEGER DEFAULT 30,
  taxRate REAL DEFAULT 0,
  lowStock INTEGER DEFAULT 5,
  invoiceFooter TEXT DEFAULT 'Thank you for your business!'
);
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'Other',
  baseUnit TEXT DEFAULT 'pcs',
  purchaseUnit TEXT DEFAULT 'pcs',
  conversionFactor REAL DEFAULT 1,
  saleUnit TEXT DEFAULT 'pcs',
  unit TEXT DEFAULT 'pcs',
  wmaCost REAL DEFAULT 0,
  costPrice REAL DEFAULT 0,
  sellPrice REAL DEFAULT 0,
  stock REAL DEFAULT 0,
  reorderLevel REAL DEFAULT 5,
  supplierId TEXT,
  notes TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wma_history (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  productName TEXT NOT NULL,
  purchaseQty REAL NOT NULL,
  purchaseUnit TEXT NOT NULL,
  baseUnitsAdded REAL NOT NULL,
  baseUnit TEXT NOT NULL,
  bulkCostPerPurchaseUnit REAL NOT NULL,
  newCostPerBaseUnit REAL NOT NULL,
  prevStock REAL NOT NULL,
  prevWMACost REAL NOT NULL,
  newStock REAL NOT NULL,
  newWMACost REAL NOT NULL,
  alertType TEXT NOT NULL,
  alertData TEXT,
  date TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL,
  category TEXT,
  saleUnit TEXT DEFAULT 'pcs',
  qty REAL DEFAULT 1,
  unitPrice REAL DEFAULT 0,
  costPrice REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  status TEXT DEFAULT 'UNPAID',
  customer TEXT DEFAULT 'Walk-in',
  phone TEXT,
  method TEXT DEFAULT 'Cash',
  notes TEXT,
  dueDate TEXT,
  date TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL DEFAULT 0,
  method TEXT DEFAULT 'Cash',
  reference TEXT,
  date TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payables (
  id TEXT PRIMARY KEY,
  creditor TEXT NOT NULL,
  category TEXT DEFAULT 'Supplier Invoice',
  description TEXT NOT NULL,
  amount REAL DEFAULT 0,
  amountPaid REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  status TEXT DEFAULT 'UNPAID',
  dueDate TEXT,
  date TEXT DEFAULT (datetime('now')),
  notes TEXT
);
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS returns_log (
  id TEXT PRIMARY KEY,
  saleId TEXT,
  product TEXT,
  qty REAL DEFAULT 1,
  refund REAL DEFAULT 0,
  reason TEXT,
  date TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  tableName TEXT NOT NULL,
  recordId TEXT,
  data TEXT,
  reason TEXT,
  date TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO settings (id) VALUES (1)
`;

// Validate that the schema split produces only valid SQL statements (dev check)
function validateSchema() {
  const stmts = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
  const invalid = stmts.filter(s => !/^(CREATE|INSERT|ALTER)/i.test(s));
  if (invalid.length > 0) {
    console.error('SCHEMA SPLIT BUG — invalid fragments:', invalid.map(s => s.substring(0, 60)));
  }
  return invalid.length === 0;
}

export async function initDB() {
  try {
    if (process.env.NODE_ENV !== 'production') validateSchema();

    sqliteConnection = new SQLiteConnection(CapacitorSQLite);

    if (Capacitor.isNativePlatform()) {
      const ret = await sqliteConnection.checkConnectionsConsistency();
      const isConn = (await sqliteConnection.isConnection(DB_NAME, false)).result;
      if (ret.result && isConn) {
        db = await sqliteConnection.retrieveConnection(DB_NAME, false);
      } else {
        db = await sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
      }
    } else {
      // Web / browser preview
      await sqliteConnection.initWebStore();
      db = await sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
    }

    await db.open();

    // Execute each schema statement individually (split is safe — no semicolons in comments)
    const stmts = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const s of stmts) {
      await db.execute(s + ';');
    }

    // Safe migrations — each wrapped in try/catch since ALTER TABLE fails if column exists
    const migrations = [
      `CREATE TABLE IF NOT EXISTS payables (id TEXT PRIMARY KEY, creditor TEXT NOT NULL, category TEXT DEFAULT 'Supplier Invoice', description TEXT NOT NULL, amount REAL DEFAULT 0, amountPaid REAL DEFAULT 0, balance REAL DEFAULT 0, status TEXT DEFAULT 'UNPAID', dueDate TEXT, date TEXT DEFAULT (datetime('now')), notes TEXT)`,
      `CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, tableName TEXT NOT NULL, recordId TEXT, data TEXT, reason TEXT, date TEXT DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS wma_history (id TEXT PRIMARY KEY, productId TEXT NOT NULL, productName TEXT NOT NULL, purchaseQty REAL NOT NULL, purchaseUnit TEXT NOT NULL, baseUnitsAdded REAL NOT NULL, baseUnit TEXT NOT NULL, bulkCostPerPurchaseUnit REAL NOT NULL, newCostPerBaseUnit REAL NOT NULL, prevStock REAL NOT NULL, prevWMACost REAL NOT NULL, newStock REAL NOT NULL, newWMACost REAL NOT NULL, alertType TEXT NOT NULL, alertData TEXT, date TEXT DEFAULT (datetime('now')))`,
      `ALTER TABLE inventory ADD COLUMN purchaseUnit TEXT DEFAULT 'pcs'`,
      `ALTER TABLE inventory ADD COLUMN saleUnit TEXT DEFAULT 'pcs'`,
      `ALTER TABLE inventory ADD COLUMN conversionFactor REAL DEFAULT 1`,
      `ALTER TABLE inventory ADD COLUMN baseUnit TEXT DEFAULT 'pcs'`,
      `ALTER TABLE inventory ADD COLUMN wmaCost REAL DEFAULT 0`,
      `ALTER TABLE sales ADD COLUMN saleUnit TEXT DEFAULT 'pcs'`,
    ];
    for (const m of migrations) {
      try { await db.execute(m + ';'); } catch (_) { /* column/table already exists — safe to ignore */ }
    }

    // Backfill wmaCost and baseUnit for existing data upgraded from v3
    await db.execute(`UPDATE inventory SET wmaCost = costPrice WHERE wmaCost = 0 AND costPrice > 0;`);
    await db.execute(`UPDATE inventory SET baseUnit = COALESCE(NULLIF(saleUnit,''), 'pcs') WHERE baseUnit = 'pcs' AND saleUnit != '';`);

    console.log('BizTrack DB v4.1 (WMA + UCE) ready');
    return true;
  } catch (err) {
    console.error('DB init failed:', err);
    return false;
  }
}

export async function dbQuery(sql, values = []) {
  if (!db) {
    const ok = await initDB();
    if (!ok) throw new Error('Database unavailable');
  }
  const res = await db.query(sql, values);
  return res.values || [];
}

export async function dbRun(sql, values = []) {
  if (!db) {
    const ok = await initDB();
    if (!ok) throw new Error('Database unavailable');
  }
  return await db.run(sql, values);
}

async function auditLog(action, tableName, recordId, data, reason = '') {
  const id = 'AUD-' + Date.now();
  await dbRun(
    `INSERT INTO audit_log (id,action,tableName,recordId,data,reason) VALUES (?,?,?,?,?,?)`,
    [id, action, tableName, recordId, JSON.stringify(data), reason]
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
export async function getSettings() {
  const r = await dbQuery('SELECT * FROM settings WHERE id=1');
  return r[0] || {};
}
export async function saveSettings(s) {
  await dbRun(
    `UPDATE settings SET bizName=?,owner=?,type=?,currency=?,payTerms=?,taxRate=?,lowStock=?,invoiceFooter=? WHERE id=1`,
    [s.bizName, s.owner, s.type, s.currency, s.payTerms, s.taxRate, s.lowStock, s.invoiceFooter]
  );
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────
export async function getInventory() {
  return dbQuery('SELECT * FROM inventory ORDER BY name ASC');
}

export async function addProduct(p) {
  const id = p.id || ('PRD-' + Date.now());
  const baseUnit    = p.baseUnit || p.saleUnit || p.unit || 'pcs';
  const purchaseUnit = p.purchaseUnit || baseUnit;
  const cf          = p.conversionFactor || 1;
  const costPerBase = p.wmaCost || p.costPrice || 0;
  await dbRun(
    `INSERT INTO inventory (id,name,category,baseUnit,purchaseUnit,conversionFactor,saleUnit,unit,wmaCost,costPrice,sellPrice,stock,reorderLevel,supplierId,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, p.name, p.category || 'Other',
     baseUnit, purchaseUnit, cf, baseUnit, baseUnit,
     costPerBase, costPerBase, p.sellPrice || 0, p.stock || 0,
     p.reorderLevel != null ? p.reorderLevel : 5,
     p.supplierId || '', p.notes || '']
  );
  // Record as initial WMA history entry if opening stock is set
  if ((p.stock || 0) > 0 && costPerBase > 0) {
    const histId = 'WMA-' + Date.now();
    await dbRun(
      `INSERT INTO wma_history (id,productId,productName,purchaseQty,purchaseUnit,baseUnitsAdded,baseUnit,bulkCostPerPurchaseUnit,newCostPerBaseUnit,prevStock,prevWMACost,newStock,newWMACost,alertType,alertData,date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [histId, id, p.name,
       p.stock / cf, purchaseUnit, p.stock, baseUnit,
       costPerBase * cf, costPerBase,
       0, 0, p.stock, costPerBase,
       'INITIAL', JSON.stringify({ note: 'Opening stock' }),
       new Date().toISOString()]
    );
  }
  return id;
}

export async function updateProduct(id, fields) {
  const keys = Object.keys(fields);
  const vals = [...Object.values(fields), id];
  await dbRun(`UPDATE inventory SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, vals);
}

export async function deleteProduct(id, reason = '') {
  const rows = await dbQuery('SELECT * FROM inventory WHERE id=?', [id]);
  if (rows[0]) await auditLog('DELETE', 'inventory', id, rows[0], reason);
  await dbRun('DELETE FROM inventory WHERE id=?', [id]);
}

// Legacy shim so old code paths still work
export async function updateProductStock(id, newStock, costPrice, sellPrice) {
  const updates = ['stock=?'];
  const vals = [newStock];
  if (costPrice != null) { updates.push('costPrice=?', 'wmaCost=?'); vals.push(costPrice, costPrice); }
  if (sellPrice != null) { updates.push('sellPrice=?'); vals.push(sellPrice); }
  vals.push(id);
  await dbRun(`UPDATE inventory SET ${updates.join(',')} WHERE id=?`, vals);
}

// ─── UNIT CONVERSION ENGINE + WEIGHTED MOVING AVERAGE ─────────────────────────
// Formula:
//   baseUnitsAdded  = purchaseQty × conversionFactor
//   newCostPerBase  = bulkCostPerPurchaseUnit / conversionFactor
//   newWMACost      = (prevStock × prevWMACost + baseUnitsAdded × newCostPerBase)
//                     / (prevStock + baseUnitsAdded)
//
// Alerts (price-direction neutral):
//   newWMACost < prevCost  => MARGIN_GAIN    (profit per unit increased)
//   newWMACost > prevCost  => PRICE_PROTECTION (suggest min sell for 30% margin)
//   first restock          => INITIAL

export async function restockWithWMA(productId, purchaseQty, bulkCostPerPurchaseUnit, newSellPrice = null) {
  const rows = await dbQuery('SELECT * FROM inventory WHERE id=?', [productId]);
  if (!rows[0]) throw new Error('Product not found: ' + productId);
  const p = rows[0];

  const cf           = p.conversionFactor || 1;
  const baseUnit     = p.baseUnit || p.saleUnit || 'pcs';
  const purchaseUnit = p.purchaseUnit || baseUnit;
  const baseUnitsAdded   = purchaseQty * cf;
  const newCostPerBase   = bulkCostPerPurchaseUnit / cf;
  const prevStock    = p.stock || 0;
  const prevWMACost  = p.wmaCost || p.costPrice || 0;
  const currentSell  = newSellPrice != null ? newSellPrice : (p.sellPrice || 0);

  // Weighted Moving Average
  let newWMACost;
  if (prevStock <= 0 || prevWMACost <= 0) {
    newWMACost = newCostPerBase;
  } else {
    newWMACost = (prevStock * prevWMACost + baseUnitsAdded * newCostPerBase) / (prevStock + baseUnitsAdded);
  }

  const newStock  = prevStock + baseUnitsAdded;
  const costDelta = newWMACost - prevWMACost;
  const MIN_MARGIN = 0.30;

  // Alert Engine
  let alertType = 'NO_CHANGE';
  let alertData = {};
  const isInitial = prevStock <= 0 || prevWMACost <= 0;

  if (isInitial) {
    alertType = 'INITIAL';
    alertData = { newWMACost, baseUnit, purchaseUnit, cf };
  } else if (costDelta < -0.001) {
    alertType = 'MARGIN_GAIN';
    const oldMarginPct = currentSell > 0 ? ((currentSell - prevWMACost) / currentSell) * 100 : 0;
    const newMarginPct = currentSell > 0 ? ((currentSell - newWMACost) / currentSell) * 100 : 0;
    alertData = {
      prevWMACost, newWMACost, costDelta,
      costDeltaPct: (costDelta / prevWMACost) * 100,
      currentSellPrice: currentSell,
      oldMarginPct: +oldMarginPct.toFixed(2),
      newMarginPct: +newMarginPct.toFixed(2),
      marginGainPct: +(newMarginPct - oldMarginPct).toFixed(2),
      profitGainPerUnit: +(prevWMACost - newWMACost).toFixed(4),
    };
  } else if (costDelta > 0.001) {
    alertType = 'PRICE_PROTECTION';
    const minSellPrice     = newWMACost / (1 - MIN_MARGIN);
    const currentMarginPct = currentSell > 0 ? ((currentSell - newWMACost) / currentSell) * 100 : -999;
    const isBelowFloor     = currentSell < minSellPrice;
    alertData = {
      prevWMACost, newWMACost, costDelta,
      costDeltaPct: (costDelta / prevWMACost) * 100,
      currentSellPrice: currentSell,
      minSellPrice30pct: +minSellPrice.toFixed(2),
      currentMarginPct: +currentMarginPct.toFixed(2),
      marginFloor: MIN_MARGIN * 100,
      isBelowFloor,
      shortfallPct: isBelowFloor ? +(MIN_MARGIN * 100 - currentMarginPct).toFixed(2) : 0,
    };
  }

  // Persist
  const sellToSave = newSellPrice != null ? newSellPrice : p.sellPrice;
  await dbRun(
    `UPDATE inventory SET stock=?, wmaCost=?, costPrice=?, sellPrice=? WHERE id=?`,
    [newStock, newWMACost, newWMACost, sellToSave, productId]
  );

  // WMA History
  const histId = 'WMA-' + Date.now();
  await dbRun(
    `INSERT INTO wma_history (id,productId,productName,purchaseQty,purchaseUnit,baseUnitsAdded,baseUnit,bulkCostPerPurchaseUnit,newCostPerBaseUnit,prevStock,prevWMACost,newStock,newWMACost,alertType,alertData,date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [histId, productId, p.name,
     purchaseQty, purchaseUnit, baseUnitsAdded, baseUnit,
     bulkCostPerPurchaseUnit, newCostPerBase,
     prevStock, prevWMACost, newStock, newWMACost,
     alertType, JSON.stringify(alertData),
     new Date().toISOString()]
  );

  await auditLog('RESTOCK_WMA', 'inventory', productId, {
    purchaseQty, bulkCostPerPurchaseUnit, baseUnitsAdded, newCostPerBase,
    prevStock, prevWMACost, newStock, newWMACost, alertType,
  });

  return {
    product: { ...p, stock: newStock, wmaCost: newWMACost, costPrice: newWMACost, sellPrice: sellToSave },
    purchaseQty, baseUnitsAdded, bulkCostPerPurchaseUnit, newCostPerBase,
    prevStock, prevWMACost, newStock, newWMACost,
    alertType, alertData,
    baseUnit, purchaseUnit, cf,
  };
}

export async function getWMAHistory(productId) {
  return dbQuery(
    'SELECT * FROM wma_history WHERE productId=? ORDER BY date DESC LIMIT 30',
    [productId]
  );
}

// ─── SALES ────────────────────────────────────────────────────────────────────
export async function getSales() { return dbQuery('SELECT * FROM sales ORDER BY date DESC'); }
export async function getSaleById(id) { const r = await dbQuery('SELECT * FROM sales WHERE id=?', [id]); return r[0] || null; }
export async function addSale(s) {
  const id = s.id || ('SL-' + Date.now());
  await dbRun(
    `INSERT INTO sales (id,product,category,saleUnit,qty,unitPrice,costPrice,discount,total,paid,balance,status,customer,phone,method,notes,dueDate,date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, s.product, s.category || '', s.saleUnit || 'pcs', s.qty, s.unitPrice, s.costPrice || 0,
     s.discount || 0, s.total, s.paid || 0, s.balance != null ? s.balance : s.total, s.status || 'UNPAID',
     s.customer || 'Walk-in', s.phone || '', s.method || 'Cash', s.notes || '',
     s.dueDate || '', s.date || new Date().toISOString()]
  );
  if (s.inventoryId) await dbRun('UPDATE inventory SET stock=MAX(0,stock-?) WHERE id=?', [s.qty, s.inventoryId]);
  return id;
}
export async function recordPayment(saleId, amount) {
  const sale = await getSaleById(saleId); if (!sale) return null;
  const newPaid    = (sale.paid || 0) + amount;
  const newBalance = Math.max(0, (sale.total || 0) - newPaid);
  const status     = newBalance <= 0 ? 'PAID' : 'PARTIAL';
  await dbRun('UPDATE sales SET paid=?,balance=?,status=? WHERE id=?', [newPaid, newBalance, status, saleId]);
  return { paid: newPaid, balance: newBalance, status };
}
export async function deleteSale(id, reason = '') {
  const rows = await dbQuery('SELECT * FROM sales WHERE id=?', [id]);
  if (rows[0]) {
    await auditLog('DELETE', 'sales', id, rows[0], reason);
    const sale = rows[0];
    if (sale.product) {
      const inv = await dbQuery('SELECT id,stock FROM inventory WHERE name=? COLLATE NOCASE', [sale.product]);
      if (inv[0]) await dbRun('UPDATE inventory SET stock=stock+? WHERE id=?', [sale.qty || 0, inv[0].id]);
    }
  }
  await dbRun('DELETE FROM sales WHERE id=?', [id]);
}

// ─── EXPENSES ────────────────────────────────────────────────────────────────
export async function getExpenses() { return dbQuery('SELECT * FROM expenses ORDER BY date DESC'); }
export async function addExpense(e) {
  const id = e.id || ('EXP-' + Date.now());
  await dbRun(
    `INSERT INTO expenses (id,category,description,amount,method,reference,date) VALUES (?,?,?,?,?,?,?)`,
    [id, e.category, e.description, e.amount, e.method || 'Cash', e.reference || '', e.date || new Date().toISOString()]
  );
  return id;
}
export async function deleteExpense(id, reason = '') {
  const rows = await dbQuery('SELECT * FROM expenses WHERE id=?', [id]);
  if (rows[0]) await auditLog('DELETE', 'expenses', id, rows[0], reason);
  await dbRun('DELETE FROM expenses WHERE id=?', [id]);
}

// ─── PAYABLES ────────────────────────────────────────────────────────────────
export async function getPayables() { return dbQuery('SELECT * FROM payables ORDER BY date DESC'); }
export async function addPayable(p) {
  const id = p.id || ('PAY-' + Date.now());
  await dbRun(
    `INSERT INTO payables (id,creditor,category,description,amount,amountPaid,balance,status,dueDate,date,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, p.creditor, p.category || 'Supplier Invoice', p.description, p.amount, p.amountPaid || 0,
     p.balance != null ? p.balance : p.amount, p.status || 'UNPAID', p.dueDate || '', p.date || new Date().toISOString(), p.notes || '']
  );
  return id;
}
export async function settlePayable(id, amount) {
  const rows = await dbQuery('SELECT * FROM payables WHERE id=?', [id]); if (!rows[0]) return null;
  const p = rows[0];
  const newPaid    = (p.amountPaid || 0) + amount;
  const newBalance = Math.max(0, (p.amount || 0) - newPaid);
  const status     = newBalance <= 0 ? 'PAID' : 'PARTIAL';
  await dbRun('UPDATE payables SET amountPaid=?,balance=?,status=? WHERE id=?', [newPaid, newBalance, status, id]);
  return { amountPaid: newPaid, balance: newBalance, status };
}
export async function deletePayable(id, reason = '') {
  const rows = await dbQuery('SELECT * FROM payables WHERE id=?', [id]);
  if (rows[0]) await auditLog('DELETE', 'payables', id, rows[0], reason);
  await dbRun('DELETE FROM payables WHERE id=?', [id]);
}

// ─── SUPPLIERS ────────────────────────────────────────────────────────────────
export async function getSuppliers() { return dbQuery('SELECT * FROM suppliers ORDER BY name ASC'); }
export async function addSupplier(s) {
  const id = s.id || ('SUP-' + Date.now());
  await dbRun(
    `INSERT INTO suppliers (id,name,contact,phone,email,address,notes) VALUES (?,?,?,?,?,?,?)`,
    [id, s.name, s.contact || '', s.phone || '', s.email || '', s.address || '', s.notes || '']
  );
  return id;
}
export async function deleteSupplier(id, reason = '') {
  const rows = await dbQuery('SELECT * FROM suppliers WHERE id=?', [id]);
  if (rows[0]) await auditLog('DELETE', 'suppliers', id, rows[0], reason);
  await dbRun('DELETE FROM suppliers WHERE id=?', [id]);
}

// ─── CUSTOMERS ────────────────────────────────────────────────────────────────
export async function getCustomers() { return dbQuery('SELECT * FROM customers ORDER BY name ASC'); }
export async function upsertCustomer(name, phone) {
  const ex = await dbQuery('SELECT id FROM customers WHERE name=? COLLATE NOCASE', [name]);
  if (ex.length > 0) return ex[0].id;
  const id = 'CUS-' + Date.now();
  await dbRun('INSERT INTO customers (id,name,phone) VALUES (?,?,?)', [id, name, phone || '']);
  return id;
}

// ─── RETURNS ─────────────────────────────────────────────────────────────────
export async function getReturns() { return dbQuery('SELECT * FROM returns_log ORDER BY date DESC'); }
export async function addReturn(r) {
  const id = r.id || ('RET-' + Date.now());
  await dbRun(
    `INSERT INTO returns_log (id,saleId,product,qty,refund,reason,date) VALUES (?,?,?,?,?,?,?)`,
    [id, r.saleId || '', r.product, r.qty, r.refund, r.reason || '', r.date || new Date().toISOString()]
  );
  if (r.inventoryId) await dbRun('UPDATE inventory SET stock=stock+? WHERE id=?', [r.qty, r.inventoryId]);
  return id;
}

// ─── AUDIT & WMA LOG ─────────────────────────────────────────────────────────
export async function getAuditLog() { return dbQuery('SELECT * FROM audit_log ORDER BY date DESC LIMIT 200'); }

// ─── REPORTS ─────────────────────────────────────────────────────────────────
export async function getReportData(from, to) {
  const end = to + 'T23:59:59';
  return {
    sales:    await dbQuery(`SELECT * FROM sales WHERE date>=? AND date<=? ORDER BY date DESC`,    [from, end]),
    expenses: await dbQuery(`SELECT * FROM expenses WHERE date>=? AND date<=? ORDER BY date DESC`, [from, end]),
    returns:  await dbQuery(`SELECT * FROM returns_log WHERE date>=? AND date<=? ORDER BY date DESC`, [from, end]),
    payables: await dbQuery(`SELECT * FROM payables WHERE date>=? AND date<=? ORDER BY date DESC`, [from, end]),
  };
}

// ─── EXPORT / IMPORT ─────────────────────────────────────────────────────────
export async function exportAllData() {
  return {
    settings:   await getSettings(),
    inventory:  await getInventory(),
    wmaHistory: await dbQuery('SELECT * FROM wma_history ORDER BY date DESC'),
    sales:      await getSales(),
    expenses:   await getExpenses(),
    payables:   await getPayables(),
    suppliers:  await getSuppliers(),
    customers:  await getCustomers(),
    returns:    await getReturns(),
    auditLog:   await getAuditLog(),
  };
}
export async function importAllData(data) {
  for (const t of ['sales', 'inventory', 'expenses', 'payables', 'suppliers', 'customers', 'returns_log', 'wma_history'])
    await dbRun(`DELETE FROM ${t}`);
  for (const item of (data.inventory  || [])) await addProduct(item);
  for (const item of (data.expenses   || [])) await addExpense(item);
  for (const item of (data.payables   || [])) await addPayable(item);
  for (const item of (data.suppliers  || [])) await addSupplier(item);
  if (data.settings) await saveSettings(data.settings);
}
