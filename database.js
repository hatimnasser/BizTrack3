// src/utils/database.js
// BizTrack Pro - SQLite Database Service
// Uses @capacitor-community/sqlite for persistent on-device storage

import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

const DB_NAME = 'biztrack_pro';
const DB_VERSION = 1;

let db = null;
let sqliteConnection = null;

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
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
    unit TEXT DEFAULT 'pcs',
    costPrice REAL DEFAULT 0,
    sellPrice REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    reorderLevel INTEGER DEFAULT 5,
    supplierId TEXT,
    notes TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    product TEXT NOT NULL,
    category TEXT,
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

  INSERT OR IGNORE INTO settings (id) VALUES (1);
`;

// ─── INIT ─────────────────────────────────────────────────────────────────────
export async function initDB() {
  try {
    if (Capacitor.isNativePlatform()) {
      sqliteConnection = new SQLiteConnection(CapacitorSQLite);
      const ret = await sqliteConnection.checkConnectionsConsistency();
      const isConn = (await sqliteConnection.isConnection(DB_NAME, false)).result;

      if (ret.result && isConn) {
        db = await sqliteConnection.retrieveConnection(DB_NAME, false);
      } else {
        db = await sqliteConnection.createConnection(
          DB_NAME, false, 'no-encryption', DB_VERSION, false
        );
      }
      await db.open();
    } else {
      // Web fallback using jeep-sqlite
      sqliteConnection = new SQLiteConnection(CapacitorSQLite);
      db = await sqliteConnection.createConnection(
        DB_NAME, false, 'no-encryption', DB_VERSION, false
      );
      await db.open();
    }

    // Execute schema
    const statements = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      await db.execute(stmt + ';');
    }

    console.log('BizTrack DB initialised');
    return true;
  } catch (err) {
    console.error('DB init failed:', err);
    return false;
  }
}

// ─── GENERIC HELPERS ─────────────────────────────────────────────────────────
export async function dbQuery(sql, values = []) {
  if (!db) await initDB();
  const res = await db.query(sql, values);
  return res.values || [];
}

export async function dbRun(sql, values = []) {
  if (!db) await initDB();
  return await db.run(sql, values);
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
export async function getSettings() {
  const rows = await dbQuery('SELECT * FROM settings WHERE id = 1');
  return rows[0] || {};
}

export async function saveSettings(s) {
  await dbRun(`
    UPDATE settings SET
      bizName=?, owner=?, type=?, currency=?, payTerms=?,
      taxRate=?, lowStock=?, invoiceFooter=?
    WHERE id=1
  `, [s.bizName, s.owner, s.type, s.currency, s.payTerms,
      s.taxRate, s.lowStock, s.invoiceFooter]);
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────
export async function getInventory() {
  return await dbQuery('SELECT * FROM inventory ORDER BY name ASC');
}

export async function addProduct(p) {
  const id = 'PRD-' + Date.now();
  await dbRun(`
    INSERT INTO inventory (id,name,category,unit,costPrice,sellPrice,stock,reorderLevel,supplierId,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `, [id, p.name, p.category, p.unit, p.costPrice, p.sellPrice,
      p.stock, p.reorderLevel, p.supplierId, p.notes]);
  return id;
}

export async function updateProductStock(id, newStock, costPrice, sellPrice) {
  const updates = ['stock=?'];
  const vals = [newStock];
  if (costPrice !== null) { updates.push('costPrice=?'); vals.push(costPrice); }
  if (sellPrice !== null) { updates.push('sellPrice=?'); vals.push(sellPrice); }
  vals.push(id);
  await dbRun(`UPDATE inventory SET ${updates.join(',')} WHERE id=?`, vals);
}

export async function deleteProduct(id) {
  await dbRun('DELETE FROM inventory WHERE id=?', [id]);
}

// ─── SALES ────────────────────────────────────────────────────────────────────
export async function getSales() {
  return await dbQuery('SELECT * FROM sales ORDER BY date DESC');
}

export async function getSaleById(id) {
  const rows = await dbQuery('SELECT * FROM sales WHERE id=?', [id]);
  return rows[0] || null;
}

export async function addSale(s) {
  const id = 'SL-' + Date.now();
  await dbRun(`
    INSERT INTO sales (id,product,category,qty,unitPrice,costPrice,discount,total,paid,balance,status,customer,phone,method,notes,dueDate,date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [id, s.product, s.category, s.qty, s.unitPrice, s.costPrice,
      s.discount, s.total, s.paid, s.balance, s.status,
      s.customer, s.phone, s.method, s.notes, s.dueDate,
      s.date || new Date().toISOString()]);

  // Deduct inventory
  if (s.inventoryId) {
    await dbRun('UPDATE inventory SET stock = MAX(0, stock - ?) WHERE id=?',
      [s.qty, s.inventoryId]);
  }
  return id;
}

export async function recordPayment(saleId, amount) {
  const sale = await getSaleById(saleId);
  if (!sale) return;
  const newPaid = (sale.paid || 0) + amount;
  const newBalance = Math.max(0, (sale.total || 0) - newPaid);
  const status = newBalance <= 0 ? 'PAID' : 'PARTIAL';
  await dbRun('UPDATE sales SET paid=?, balance=?, status=? WHERE id=?',
    [newPaid, newBalance, status, saleId]);
}

export async function deleteSale(id) {
  await dbRun('DELETE FROM sales WHERE id=?', [id]);
}

// ─── EXPENSES ────────────────────────────────────────────────────────────────
export async function getExpenses() {
  return await dbQuery('SELECT * FROM expenses ORDER BY date DESC');
}

export async function addExpense(e) {
  const id = 'EXP-' + Date.now();
  await dbRun(`
    INSERT INTO expenses (id,category,description,amount,method,reference,date)
    VALUES (?,?,?,?,?,?,?)
  `, [id, e.category, e.description, e.amount, e.method,
      e.reference, e.date || new Date().toISOString()]);
  return id;
}

export async function deleteExpense(id) {
  await dbRun('DELETE FROM expenses WHERE id=?', [id]);
}

// ─── SUPPLIERS ───────────────────────────────────────────────────────────────
export async function getSuppliers() {
  return await dbQuery('SELECT * FROM suppliers ORDER BY name ASC');
}

export async function addSupplier(s) {
  const id = 'SUP-' + Date.now();
  await dbRun(`
    INSERT INTO suppliers (id,name,contact,phone,email,address,notes)
    VALUES (?,?,?,?,?,?,?)
  `, [id, s.name, s.contact, s.phone, s.email, s.address, s.notes]);
  return id;
}

export async function deleteSupplier(id) {
  await dbRun('DELETE FROM suppliers WHERE id=?', [id]);
}

// ─── CUSTOMERS ───────────────────────────────────────────────────────────────
export async function getCustomers() {
  return await dbQuery('SELECT * FROM customers ORDER BY name ASC');
}

export async function upsertCustomer(name, phone) {
  const existing = await dbQuery('SELECT id FROM customers WHERE name=? COLLATE NOCASE', [name]);
  if (existing.length > 0) return existing[0].id;
  const id = 'CUS-' + Date.now();
  await dbRun('INSERT INTO customers (id,name,phone) VALUES (?,?,?)', [id, name, phone || '']);
  return id;
}

// ─── RETURNS ─────────────────────────────────────────────────────────────────
export async function getReturns() {
  return await dbQuery('SELECT * FROM returns_log ORDER BY date DESC');
}

export async function addReturn(r) {
  const id = 'RET-' + Date.now();
  await dbRun(`
    INSERT INTO returns_log (id,saleId,product,qty,refund,reason,date)
    VALUES (?,?,?,?,?,?,?)
  `, [id, r.saleId, r.product, r.qty, r.refund, r.reason,
      r.date || new Date().toISOString()]);
  // Restock inventory
  if (r.inventoryId) {
    await dbRun('UPDATE inventory SET stock = stock + ? WHERE id=?',
      [r.qty, r.inventoryId]);
  }
  return id;
}

// ─── REPORT DATA ─────────────────────────────────────────────────────────────
export async function getReportData(fromDate, toDate) {
  const sales = await dbQuery(
    `SELECT * FROM sales WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    [fromDate, toDate + 'T23:59:59']
  );
  const expenses = await dbQuery(
    `SELECT * FROM expenses WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    [fromDate, toDate + 'T23:59:59']
  );
  const returns = await dbQuery(
    `SELECT * FROM returns_log WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    [fromDate, toDate + 'T23:59:59']
  );
  return { sales, expenses, returns };
}

// ─── EXPORT ALL DATA ─────────────────────────────────────────────────────────
export async function exportAllData() {
  return {
    settings: await getSettings(),
    inventory: await getInventory(),
    sales: await getSales(),
    expenses: await getExpenses(),
    suppliers: await getSuppliers(),
    customers: await getCustomers(),
    returns: await getReturns()
  };
}

export async function importAllData(data) {
  if (!db) await initDB();
  // Clear all tables
  for (const table of ['sales', 'inventory', 'expenses', 'suppliers', 'customers', 'returns_log']) {
    await dbRun(`DELETE FROM ${table}`);
  }

  // Re-insert
  for (const item of (data.inventory || [])) await addProduct(item);
  for (const item of (data.expenses || [])) await addExpense(item);
  for (const item of (data.suppliers || [])) await addSupplier(item);
  if (data.settings) await saveSettings(data.settings);
}
