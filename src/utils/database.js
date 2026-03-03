// src/utils/database.js — BizTrack Pro v4.3
// Additions over v4.2:
//   • stock_transactions: userId + movementType (PURCHASE/SALE/ADJUST_IN/ADJUST_OUT/DAMAGE/RETURN_IN/RETURN_OUT)
//   • sales: receiptId for multi-item receipts
//   • addSaleCart()       — batch-save a full multi-item receipt
//   • getSalesByReceiptId() — fetch all line items for a receipt
//   • addStockAdjustment() — mandatory-reason manual correction (no direct stock editing)
//   • recordDamage()      — write-off damaged stock
//
// RULE: NO inline SQL comments (--) inside the SCHEMA template literal.

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

const DB_NAME = 'biztrack_pro';
const DB_VERSION = 6;
let db = null;
let sqliteConnection = null;

// Movement type vocabulary (used in stock_transactions.movementType):
//   PURCHASE    = stock received from supplier  (+)
//   SALE        = stock sold to customer        (-)
//   ADJUST_IN   = manual positive correction    (+)
//   ADJUST_OUT  = manual negative correction    (-)
//   DAMAGE      = stock written off as damaged  (-)
//   RETURN_IN   = customer returns product      (+)
//   RETURN_OUT  = return stock to supplier      (-)
//   OPENING     = initial stock entry           (+)
export const MOVEMENT_TYPES = {
  PURCHASE:   'PURCHASE',
  SALE:       'SALE',
  ADJUST_IN:  'ADJUST_IN',
  ADJUST_OUT: 'ADJUST_OUT',
  DAMAGE:     'DAMAGE',
  RETURN_IN:  'RETURN_IN',
  RETURN_OUT: 'RETURN_OUT',
  OPENING:    'OPENING',
};

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
  unitClass TEXT DEFAULT 'each',
  wmaCost REAL DEFAULT 0,
  costPrice REAL DEFAULT 0,
  sellPrice REAL DEFAULT 0,
  stock REAL DEFAULT 0,
  reorderLevel REAL DEFAULT 5,
  supplierId TEXT,
  notes TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_transactions (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  productId TEXT NOT NULL,
  productName TEXT NOT NULL,
  movementType TEXT NOT NULL,
  purchaseUnit TEXT NOT NULL,
  purchaseQty REAL NOT NULL,
  baseUnit TEXT NOT NULL,
  baseQty REAL NOT NULL,
  unitCost REAL NOT NULL,
  totalValue REAL NOT NULL,
  resultingBalance REAL NOT NULL,
  reference TEXT,
  userId TEXT DEFAULT 'owner',
  notes TEXT
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
  receiptId TEXT,
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

function validateSchema() {
  const stmts = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
  const bad = stmts.filter(s => !/^(CREATE|INSERT|ALTER)/i.test(s));
  if (bad.length > 0) console.error('SCHEMA SPLIT BUG:', bad.map(s => s.substring(0, 80)));
  return bad.length === 0;
}

export async function initDB() {
  try {
    validateSchema();
    sqliteConnection = new SQLiteConnection(CapacitorSQLite);

    if (Capacitor.isNativePlatform()) {
      const ret    = await sqliteConnection.checkConnectionsConsistency();
      const isConn = (await sqliteConnection.isConnection(DB_NAME, false)).result;
      db = (ret.result && isConn)
        ? await sqliteConnection.retrieveConnection(DB_NAME, false)
        : await sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
    } else {
      await sqliteConnection.initWebStore();
      db = await sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
    }

    await db.open();

    const stmts = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const s of stmts) await db.execute(s + ';');

    // Safe migrations — wrapped in try/catch since ALTER TABLE fails if column exists
    const migrations = [
      `CREATE TABLE IF NOT EXISTS payables (id TEXT PRIMARY KEY, creditor TEXT NOT NULL, category TEXT DEFAULT 'Supplier Invoice', description TEXT NOT NULL, amount REAL DEFAULT 0, amountPaid REAL DEFAULT 0, balance REAL DEFAULT 0, status TEXT DEFAULT 'UNPAID', dueDate TEXT, date TEXT DEFAULT (datetime('now')), notes TEXT)`,
      `CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, tableName TEXT NOT NULL, recordId TEXT, data TEXT, reason TEXT, date TEXT DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS wma_history (id TEXT PRIMARY KEY, productId TEXT NOT NULL, productName TEXT NOT NULL, purchaseQty REAL NOT NULL, purchaseUnit TEXT NOT NULL, baseUnitsAdded REAL NOT NULL, baseUnit TEXT NOT NULL, bulkCostPerPurchaseUnit REAL NOT NULL, newCostPerBaseUnit REAL NOT NULL, prevStock REAL NOT NULL, prevWMACost REAL NOT NULL, newStock REAL NOT NULL, newWMACost REAL NOT NULL, alertType TEXT NOT NULL, alertData TEXT, date TEXT DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS stock_transactions (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, productId TEXT NOT NULL, productName TEXT NOT NULL, movementType TEXT NOT NULL, purchaseUnit TEXT NOT NULL, purchaseQty REAL NOT NULL, baseUnit TEXT NOT NULL, baseQty REAL NOT NULL, unitCost REAL NOT NULL, totalValue REAL NOT NULL, resultingBalance REAL NOT NULL, reference TEXT, userId TEXT DEFAULT 'owner', notes TEXT)`,
      // Legacy column renames / additions
      `ALTER TABLE inventory ADD COLUMN purchaseUnit TEXT DEFAULT 'pcs'`,
      `ALTER TABLE inventory ADD COLUMN saleUnit TEXT DEFAULT 'pcs'`,
      `ALTER TABLE inventory ADD COLUMN conversionFactor REAL DEFAULT 1`,
      `ALTER TABLE inventory ADD COLUMN baseUnit TEXT DEFAULT 'pcs'`,
      `ALTER TABLE inventory ADD COLUMN wmaCost REAL DEFAULT 0`,
      `ALTER TABLE inventory ADD COLUMN unitClass TEXT DEFAULT 'each'`,
      `ALTER TABLE sales ADD COLUMN saleUnit TEXT DEFAULT 'pcs'`,
      `ALTER TABLE sales ADD COLUMN receiptId TEXT`,
      // New columns on stock_transactions (for upgrades from v4.2)
      `ALTER TABLE stock_transactions ADD COLUMN movementType TEXT DEFAULT 'PURCHASE'`,
      `ALTER TABLE stock_transactions ADD COLUMN userId TEXT DEFAULT 'owner'`,
    ];
    for (const m of migrations) { try { await db.execute(m + ';'); } catch (_) {} }

    // Back-fill legacy data
    await db.execute(`UPDATE inventory SET wmaCost = costPrice WHERE wmaCost = 0 AND costPrice > 0;`);
    await db.execute(`UPDATE inventory SET baseUnit = COALESCE(NULLIF(saleUnit,''), 'pcs') WHERE baseUnit = 'pcs' AND saleUnit != '';`);
    // Back-fill movementType from old 'type' column if it exists (v4.2 → v4.3 upgrade)
    try { await db.execute(`UPDATE stock_transactions SET movementType = CASE type WHEN 'IN' THEN 'PURCHASE' WHEN 'OUT' THEN 'SALE' WHEN 'RETURN' THEN 'RETURN_IN' WHEN 'ADJUST' THEN 'ADJUST_IN' ELSE type END WHERE movementType = 'PURCHASE' AND type IS NOT NULL;`); } catch (_) {}

    console.log('BizTrack DB v4.3 (WMA + UCE + Stock Ledger + Cart Sales) ready');
    return true;
  } catch (err) {
    console.error('DB init failed:', err);
    return false;
  }
}

export async function dbQuery(sql, values = []) {
  if (!db) { const ok = await initDB(); if (!ok) throw new Error('Database unavailable'); }
  const res = await db.query(sql, values);
  return res.values || [];
}
export async function dbRun(sql, values = []) {
  if (!db) { const ok = await initDB(); if (!ok) throw new Error('Database unavailable'); }
  return await db.run(sql, values);
}

async function auditLog(action, tableName, recordId, data, reason = '', userId = 'owner') {
  const id = 'AUD-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
  await dbRun(
    `INSERT INTO audit_log (id,action,tableName,recordId,data,reason,date) VALUES (?,?,?,?,?,?,?)`,
    [id, action + (userId !== 'owner' ? `[${userId}]` : ''), tableName, recordId, JSON.stringify(data), reason, new Date().toISOString()]
  );
}

// ─── STOCK LEDGER ─────────────────────────────────────────────────────────────
// Central function — every stock movement passes through here.
// movementType must be one of the MOVEMENT_TYPES constants.
// baseQty is SIGNED: positive = stock in, negative = stock out.
async function writeStockTx(opts) {
  const id = 'STX-' + Date.now() + '-' + Math.floor(Math.random() * 99999);
  const {
    productId, productName,
    movementType,
    purchaseUnit = 'pcs', purchaseQty = 0,
    baseUnit = 'pcs', baseQty,
    unitCost,
    resultingBalance,
    reference = '',
    userId = 'owner',
    notes = ''
  } = opts;
  const totalValue = Math.abs(baseQty) * (unitCost || 0);
  await dbRun(
    `INSERT INTO stock_transactions (id,timestamp,productId,productName,movementType,purchaseUnit,purchaseQty,baseUnit,baseQty,unitCost,totalValue,resultingBalance,reference,userId,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, new Date().toISOString(),
     productId, productName,
     movementType,
     purchaseUnit, Math.abs(purchaseQty),
     baseUnit, baseQty,
     unitCost || 0, totalValue,
     resultingBalance,
     reference, userId, notes]
  );
}

export async function getStockLedger(productId) {
  return dbQuery(
    `SELECT * FROM stock_transactions WHERE productId=? ORDER BY timestamp DESC LIMIT 150`,
    [productId]
  );
}
export async function getAllStockTransactions(limit = 300) {
  return dbQuery(
    `SELECT st.*, i.name as pname FROM stock_transactions st
     LEFT JOIN inventory i ON st.productId = i.id
     ORDER BY st.timestamp DESC LIMIT ?`,
    [limit]
  );
}

// ─── STOCK ADJUSTMENT (no direct editing — all corrections go through movements) ─
// adjustType: 'ADJUST_IN' | 'ADJUST_OUT' | 'DAMAGE'
// reason is REQUIRED — caller must enforce this
export async function addStockAdjustment(productId, adjustType, qty, reason, userId = 'owner') {
  if (!reason || reason.trim() === '') throw new Error('Reason is required for stock adjustments');
  if (!['ADJUST_IN', 'ADJUST_OUT', 'DAMAGE'].includes(adjustType)) throw new Error('Invalid adjustment type');
  if (qty <= 0) throw new Error('Quantity must be greater than 0');

  const rows = await dbQuery('SELECT * FROM inventory WHERE id=?', [productId]);
  if (!rows[0]) throw new Error('Product not found');
  const p = rows[0];
  const bu = p.baseUnit || 'pcs';
  const pu = p.purchaseUnit || bu;
  const cf = p.conversionFactor || 1;
  const wma = p.wmaCost || p.costPrice || 0;

  // ADJUST_IN and DAMAGE both modify balance, but with different signs
  const isPositive = adjustType === 'ADJUST_IN';
  const signedQty  = isPositive ? +qty : -qty;
  const newBalance = Math.max(0, (p.stock || 0) + signedQty);

  // Update inventory balance
  await dbRun('UPDATE inventory SET stock=? WHERE id=?', [newBalance, productId]);

  // Write movement record
  await writeStockTx({
    productId, productName: p.name,
    movementType: adjustType,
    purchaseUnit: pu, purchaseQty: qty / cf,
    baseUnit: bu, baseQty: signedQty,
    unitCost: wma,
    resultingBalance: newBalance,
    reference: 'ADJ-' + Date.now(),
    userId,
    notes: reason.trim()
  });

  await auditLog(adjustType, 'inventory', productId, { qty, adjustType, prevStock: p.stock, newBalance }, reason, userId);

  return { prevStock: p.stock, newBalance, adjustType, qty };
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
  const id          = p.id || ('PRD-' + Date.now());
  const baseUnit    = p.baseUnit || p.saleUnit || p.unit || 'pcs';
  const purchaseUnit= p.purchaseUnit || baseUnit;
  const cf          = p.conversionFactor || 1;
  const costPerBase = p.wmaCost || p.costPrice || 0;
  const unitClass   = p.unitClass || 'each';

  await dbRun(
    `INSERT INTO inventory (id,name,category,baseUnit,purchaseUnit,conversionFactor,saleUnit,unit,unitClass,wmaCost,costPrice,sellPrice,stock,reorderLevel,supplierId,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, p.name, p.category || 'Other',
     baseUnit, purchaseUnit, cf, baseUnit, baseUnit, unitClass,
     costPerBase, costPerBase, p.sellPrice || 0, p.stock || 0,
     p.reorderLevel != null ? p.reorderLevel : 5,
     p.supplierId || '', p.notes || '']
  );

  // Opening stock — write OPENING movement
  if ((p.stock || 0) > 0 && costPerBase > 0) {
    await writeStockTx({
      productId: id, productName: p.name,
      movementType: MOVEMENT_TYPES.OPENING,
      purchaseUnit, purchaseQty: p.stock / cf,
      baseUnit, baseQty: p.stock,
      unitCost: costPerBase,
      resultingBalance: p.stock,
      reference: 'OPENING',
      userId: 'owner',
      notes: 'Opening stock'
    });
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

export async function updateProductStock(id, newStock, costPrice, sellPrice) {
  const updates = ['stock=?']; const vals = [newStock];
  if (costPrice != null) { updates.push('costPrice=?', 'wmaCost=?'); vals.push(costPrice, costPrice); }
  if (sellPrice != null) { updates.push('sellPrice=?'); vals.push(sellPrice); }
  vals.push(id);
  await dbRun(`UPDATE inventory SET ${updates.join(',')} WHERE id=?`, vals);
}

// ─── UNIT CONVERSION ENGINE + WEIGHTED MOVING AVERAGE ─────────────────────────
export async function restockWithWMA(productId, purchaseQty, bulkCostPerPurchaseUnit, newSellPrice = null, userId = 'owner') {
  const rows = await dbQuery('SELECT * FROM inventory WHERE id=?', [productId]);
  if (!rows[0]) throw new Error('Product not found: ' + productId);
  const p = rows[0];

  const cf            = p.conversionFactor || 1;
  const baseUnit      = p.baseUnit || p.saleUnit || 'pcs';
  const purchaseUnit  = p.purchaseUnit || baseUnit;
  const baseUnitsAdded= purchaseQty * cf;
  const newCostPerBase= bulkCostPerPurchaseUnit / cf;
  const prevStock     = p.stock || 0;
  const prevWMACost   = p.wmaCost || p.costPrice || 0;
  const currentSell   = newSellPrice != null ? newSellPrice : (p.sellPrice || 0);

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

  let alertType = 'NO_CHANGE'; let alertData = {};
  const isInitial = prevStock <= 0 || prevWMACost <= 0;

  if (isInitial) {
    alertType = 'INITIAL';
    alertData = { newWMACost, baseUnit, purchaseUnit, cf };
  } else if (costDelta < -0.001) {
    alertType = 'MARGIN_GAIN';
    const oldMgn = currentSell > 0 ? ((currentSell - prevWMACost) / currentSell) * 100 : 0;
    const newMgn = currentSell > 0 ? ((currentSell - newWMACost)  / currentSell) * 100 : 0;
    alertData = { prevWMACost, newWMACost, costDelta,
      costDeltaPct: (costDelta / prevWMACost) * 100, currentSellPrice: currentSell,
      oldMarginPct: +oldMgn.toFixed(2), newMarginPct: +newMgn.toFixed(2),
      marginGainPct: +(newMgn - oldMgn).toFixed(2), profitGainPerUnit: +(prevWMACost - newWMACost).toFixed(4) };
  } else if (costDelta > 0.001) {
    alertType = 'PRICE_PROTECTION';
    const minSell = newWMACost / (1 - MIN_MARGIN);
    const curMgn  = currentSell > 0 ? ((currentSell - newWMACost) / currentSell) * 100 : -999;
    const below   = currentSell < minSell;
    alertData = { prevWMACost, newWMACost, costDelta,
      costDeltaPct: (costDelta / prevWMACost) * 100, currentSellPrice: currentSell,
      minSellPrice30pct: +minSell.toFixed(2), currentMarginPct: +curMgn.toFixed(2),
      marginFloor: MIN_MARGIN * 100, isBelowFloor: below,
      shortfallPct: below ? +(MIN_MARGIN * 100 - curMgn).toFixed(2) : 0 };
  }

  const sellToSave = newSellPrice != null ? newSellPrice : p.sellPrice;
  await dbRun(`UPDATE inventory SET stock=?, wmaCost=?, costPrice=?, sellPrice=? WHERE id=?`,
    [newStock, newWMACost, newWMACost, sellToSave, productId]);

  // Write PURCHASE movement
  const restockRef = 'RST-' + Date.now();
  await writeStockTx({
    productId, productName: p.name,
    movementType: MOVEMENT_TYPES.PURCHASE,
    purchaseUnit, purchaseQty,
    baseUnit, baseQty: baseUnitsAdded,
    unitCost: newWMACost,
    resultingBalance: newStock,
    reference: restockRef, userId,
    notes: `Purchase: ${purchaseQty} ${purchaseUnit} @ ${bulkCostPerPurchaseUnit} each (WMA: ${newWMACost.toFixed(4)}/${baseUnit})`
  });

  const histId = 'WMA-' + Date.now();
  await dbRun(
    `INSERT INTO wma_history (id,productId,productName,purchaseQty,purchaseUnit,baseUnitsAdded,baseUnit,bulkCostPerPurchaseUnit,newCostPerBaseUnit,prevStock,prevWMACost,newStock,newWMACost,alertType,alertData,date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [histId, productId, p.name,
     purchaseQty, purchaseUnit, baseUnitsAdded, baseUnit,
     bulkCostPerPurchaseUnit, newCostPerBase,
     prevStock, prevWMACost, newStock, newWMACost,
     alertType, JSON.stringify(alertData), new Date().toISOString()]
  );
  await auditLog('RESTOCK_WMA', 'inventory', productId, {
    purchaseQty, bulkCostPerPurchaseUnit, baseUnitsAdded, newCostPerBase,
    prevStock, prevWMACost, newStock, newWMACost, alertType }, '', userId);

  return {
    product: { ...p, stock: newStock, wmaCost: newWMACost, costPrice: newWMACost, sellPrice: sellToSave },
    purchaseQty, baseUnitsAdded, bulkCostPerPurchaseUnit, newCostPerBase,
    prevStock, prevWMACost, newStock, newWMACost,
    alertType, alertData, baseUnit, purchaseUnit, cf,
  };
}

export async function getWMAHistory(productId) {
  return dbQuery('SELECT * FROM wma_history WHERE productId=? ORDER BY date DESC LIMIT 30', [productId]);
}

// ─── SALES ────────────────────────────────────────────────────────────────────
export async function getSales() { return dbQuery('SELECT * FROM sales ORDER BY date DESC'); }
export async function getSaleById(id) { const r = await dbQuery('SELECT * FROM sales WHERE id=?', [id]); return r[0] || null; }

export async function getSalesByReceiptId(receiptId) {
  if (!receiptId) return [];
  return dbQuery('SELECT * FROM sales WHERE receiptId=? ORDER BY date ASC', [receiptId]);
}

// Single-item sale (backward-compat)
export async function addSale(s) {
  const id        = s.id || ('SL-' + Date.now());
  const receiptId = s.receiptId || id; // single-item receipt = same as sale id
  await dbRun(
    `INSERT INTO sales (id,receiptId,product,category,saleUnit,qty,unitPrice,costPrice,discount,total,paid,balance,status,customer,phone,method,notes,dueDate,date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, receiptId, s.product, s.category || '', s.saleUnit || 'pcs', s.qty, s.unitPrice, s.costPrice || 0,
     s.discount || 0, s.total, s.paid || 0, s.balance != null ? s.balance : s.total, s.status || 'UNPAID',
     s.customer || 'Walk-in', s.phone || '', s.method || 'Cash', s.notes || '',
     s.dueDate || '', s.date || new Date().toISOString()]
  );
  if (s.inventoryId) {
    const inv = await dbQuery('SELECT stock, wmaCost, costPrice, baseUnit, purchaseUnit FROM inventory WHERE id=?', [s.inventoryId]);
    if (inv[0]) {
      const newBal = Math.max(0, (inv[0].stock || 0) - s.qty);
      await dbRun('UPDATE inventory SET stock=? WHERE id=?', [newBal, s.inventoryId]);
      await writeStockTx({
        productId: s.inventoryId, productName: s.product,
        movementType: MOVEMENT_TYPES.SALE,
        purchaseUnit: inv[0].purchaseUnit || inv[0].baseUnit || 'pcs',
        purchaseQty: s.qty,
        baseUnit: inv[0].baseUnit || s.saleUnit || 'pcs',
        baseQty: -s.qty,
        unitCost: inv[0].wmaCost || inv[0].costPrice || s.costPrice || 0,
        resultingBalance: newBal,
        reference: receiptId,
        userId: s.userId || 'owner',
        notes: `Sale to ${s.customer || 'Walk-in'} @ ${s.unitPrice} each — Receipt ${receiptId}`
      });
    }
  }
  return id;
}

// Multi-item cart sale — all items share one receiptId
// cartItems: Array<{ product, category, saleUnit, qty, unitPrice, costPrice, discount, lineTotal, inventoryId, inventoryItem }>
// receipt: { customer, phone, method, notes, totalPaid, receiptTotal, dueDate, userId }
export async function addSaleCart(cartItems, receipt) {
  if (!cartItems || cartItems.length === 0) throw new Error('Cart is empty');
  const receiptId    = receipt.receiptId || ('RCP-' + Date.now());
  const receiptTotal = cartItems.reduce((s, i) => s + (i.lineTotal || 0), 0);
  const totalPaid    = receipt.totalPaid || 0;
  const dueDate      = receipt.dueDate   || new Date(Date.now() + ((receipt.payTerms || 30) * 86400000)).toISOString().slice(0, 10);
  const now          = new Date().toISOString();
  const userId       = receipt.userId || 'owner';

  const savedIds = [];

  for (const item of cartItems) {
    const id = 'SL-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
    // Distribute payment proportionally across line items
    const lineRatio  = receiptTotal > 0 ? (item.lineTotal || 0) / receiptTotal : 1 / cartItems.length;
    const linePaid   = Math.round(totalPaid * lineRatio * 100) / 100;
    const lineBalance= Math.max(0, (item.lineTotal || 0) - linePaid);
    const status     = totalPaid <= 0 ? 'UNPAID' : lineBalance <= 0.01 ? 'PAID' : 'PARTIAL';

    await dbRun(
      `INSERT INTO sales (id,receiptId,product,category,saleUnit,qty,unitPrice,costPrice,discount,total,paid,balance,status,customer,phone,method,notes,dueDate,date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, receiptId, item.product, item.category || '', item.saleUnit || 'pcs',
       item.qty, item.unitPrice, item.costPrice || 0, item.discount || 0,
       item.lineTotal, linePaid, lineBalance, status,
       receipt.customer || 'Walk-in', receipt.phone || '', receipt.method || 'Cash',
       receipt.notes || '', dueDate, now]
    );
    savedIds.push(id);

    // Deduct stock + write SALE movement
    if (item.inventoryId) {
      const inv = await dbQuery('SELECT stock, wmaCost, costPrice, baseUnit, purchaseUnit FROM inventory WHERE id=?', [item.inventoryId]);
      if (inv[0]) {
        const newBal = Math.max(0, (inv[0].stock || 0) - item.qty);
        await dbRun('UPDATE inventory SET stock=? WHERE id=?', [newBal, item.inventoryId]);
        await writeStockTx({
          productId: item.inventoryId, productName: item.product,
          movementType: MOVEMENT_TYPES.SALE,
          purchaseUnit: inv[0].purchaseUnit || inv[0].baseUnit || 'pcs',
          purchaseQty: item.qty,
          baseUnit: inv[0].baseUnit || item.saleUnit || 'pcs',
          baseQty: -item.qty,
          unitCost: inv[0].wmaCost || inv[0].costPrice || item.costPrice || 0,
          resultingBalance: newBal,
          reference: receiptId, userId,
          notes: `Cart sale to ${receipt.customer || 'Walk-in'} — Receipt ${receiptId}`
        });

        // Low stock alert check
        const re = inv[0].reorderLevel != null ? inv[0].reorderLevel : 5;
        if (newBal <= re && newBal >= 0) {
          await auditLog('LOW_STOCK_ALERT', 'inventory', item.inventoryId,
            { stock: newBal, reorderLevel: re, product: item.product }, '', userId);
        }
      }
    }
  }

  // Save customer record
  if (receipt.customer && receipt.customer !== 'Walk-in') {
    await upsertCustomer(receipt.customer, receipt.phone || '');
  }

  await auditLog('SALE_CART', 'sales', receiptId,
    { receiptId, items: cartItems.length, receiptTotal, totalPaid, customer: receipt.customer }, '', userId);

  return { receiptId, savedIds, receiptTotal };
}

export async function recordPayment(saleId, amount) {
  const sale = await getSaleById(saleId); if (!sale) return null;
  const newPaid    = (sale.paid || 0) + amount;
  const newBalance = Math.max(0, (sale.total || 0) - newPaid);
  const status     = newBalance <= 0 ? 'PAID' : 'PARTIAL';
  await dbRun('UPDATE sales SET paid=?,balance=?,status=? WHERE id=?', [newPaid, newBalance, status, saleId]);
  return { paid: newPaid, balance: newBalance, status };
}

// Record payment for an entire receipt (all line items with same receiptId)
export async function recordReceiptPayment(receiptId, amount) {
  const items = await getSalesByReceiptId(receiptId);
  if (!items.length) return null;
  const unpaidTotal = items.reduce((s, i) => s + (i.balance || 0), 0);
  if (unpaidTotal <= 0) return { status: 'PAID', message: 'Already fully paid' };

  for (const item of items) {
    if ((item.balance || 0) <= 0) continue;
    const ratio     = unpaidTotal > 0 ? (item.balance / unpaidTotal) : (1 / items.length);
    const itemPay   = Math.min(item.balance, amount * ratio);
    const newPaid   = (item.paid || 0) + itemPay;
    const newBal    = Math.max(0, (item.total || 0) - newPaid);
    const status    = newBal <= 0.01 ? 'PAID' : 'PARTIAL';
    await dbRun('UPDATE sales SET paid=?,balance=?,status=? WHERE id=?', [newPaid, newBal, status, item.id]);
  }
  return { receiptId, amountApplied: amount };
}

export async function deleteSale(id, reason = '') {
  const rows = await dbQuery('SELECT * FROM sales WHERE id=?', [id]);
  if (rows[0]) {
    await auditLog('DELETE', 'sales', id, rows[0], reason);
    const sale = rows[0];
    if (sale.product) {
      const inv = await dbQuery('SELECT id, stock, wmaCost, costPrice, baseUnit, purchaseUnit FROM inventory WHERE name=? COLLATE NOCASE', [sale.product]);
      if (inv[0]) {
        const newBal = (inv[0].stock || 0) + (sale.qty || 0);
        await dbRun('UPDATE inventory SET stock=? WHERE id=?', [newBal, inv[0].id]);
        await writeStockTx({
          productId: inv[0].id, productName: sale.product,
          movementType: MOVEMENT_TYPES.ADJUST_IN,
          purchaseUnit: inv[0].purchaseUnit || inv[0].baseUnit || 'pcs',
          purchaseQty: sale.qty || 0,
          baseUnit: inv[0].baseUnit || 'pcs',
          baseQty: sale.qty || 0,
          unitCost: inv[0].wmaCost || inv[0].costPrice || sale.costPrice || 0,
          resultingBalance: newBal,
          reference: 'DEL-' + id,
          userId: 'owner',
          notes: `Sale ${id} deleted — stock restored. Reason: ${reason || 'none'}`
        });
      }
    }
  }
  await dbRun('DELETE FROM sales WHERE id=?', [id]);
}

export async function deleteReceiptSales(receiptId, reason = '') {
  const items = await getSalesByReceiptId(receiptId);
  for (const item of items) await deleteSale(item.id, reason);
}

// ─── EXPENSES ────────────────────────────────────────────────────────────────
export async function getExpenses() { return dbQuery('SELECT * FROM expenses ORDER BY date DESC'); }
export async function addExpense(e) {
  const id = e.id || ('EXP-' + Date.now());
  await dbRun(`INSERT INTO expenses (id,category,description,amount,method,reference,date) VALUES (?,?,?,?,?,?,?)`,
    [id, e.category, e.description, e.amount, e.method || 'Cash', e.reference || '', e.date || new Date().toISOString()]);
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
  await dbRun(`INSERT INTO payables (id,creditor,category,description,amount,amountPaid,balance,status,dueDate,date,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, p.creditor, p.category || 'Supplier Invoice', p.description, p.amount, p.amountPaid || 0,
     p.balance != null ? p.balance : p.amount, p.status || 'UNPAID', p.dueDate || '', p.date || new Date().toISOString(), p.notes || '']);
  return id;
}
export async function settlePayable(id, amount) {
  const rows = await dbQuery('SELECT * FROM payables WHERE id=?', [id]); if (!rows[0]) return null;
  const p = rows[0];
  const newPaid = (p.amountPaid || 0) + amount;
  const newBalance = Math.max(0, (p.amount || 0) - newPaid);
  const status = newBalance <= 0 ? 'PAID' : 'PARTIAL';
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
  await dbRun(`INSERT INTO suppliers (id,name,contact,phone,email,address,notes) VALUES (?,?,?,?,?,?,?)`,
    [id, s.name, s.contact || '', s.phone || '', s.email || '', s.address || '', s.notes || '']);
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
  await dbRun(`INSERT INTO returns_log (id,saleId,product,qty,refund,reason,date) VALUES (?,?,?,?,?,?,?)`,
    [id, r.saleId || '', r.product, r.qty, r.refund, r.reason || '', r.date || new Date().toISOString()]);
  if (r.inventoryId) {
    const inv = await dbQuery('SELECT stock, wmaCost, costPrice, baseUnit, purchaseUnit FROM inventory WHERE id=?', [r.inventoryId]);
    if (inv[0]) {
      const newBal = (inv[0].stock || 0) + r.qty;
      await dbRun('UPDATE inventory SET stock=? WHERE id=?', [newBal, r.inventoryId]);
      await writeStockTx({
        productId: r.inventoryId, productName: r.product,
        movementType: MOVEMENT_TYPES.RETURN_IN,
        purchaseUnit: inv[0].purchaseUnit || inv[0].baseUnit || 'pcs',
        purchaseQty: r.qty,
        baseUnit: inv[0].baseUnit || 'pcs',
        baseQty: r.qty,
        unitCost: inv[0].wmaCost || inv[0].costPrice || 0,
        resultingBalance: newBal,
        reference: r.saleId || id,
        userId: r.userId || 'owner',
        notes: `Customer return — ${r.reason || 'no reason'}`
      });
    }
  }
  return id;
}

// ─── AUDIT & WMA LOG ─────────────────────────────────────────────────────────
export async function getAuditLog() { return dbQuery('SELECT * FROM audit_log ORDER BY date DESC LIMIT 200'); }

// ─── REPORTS ─────────────────────────────────────────────────────────────────
export async function getReportData(from, to) {
  const end = to + 'T23:59:59';
  return {
    sales:    await dbQuery(`SELECT * FROM sales WHERE date>=? AND date<=? ORDER BY date DESC`, [from, end]),
    expenses: await dbQuery(`SELECT * FROM expenses WHERE date>=? AND date<=? ORDER BY date DESC`, [from, end]),
    returns:  await dbQuery(`SELECT * FROM returns_log WHERE date>=? AND date<=? ORDER BY date DESC`, [from, end]),
    payables: await dbQuery(`SELECT * FROM payables WHERE date>=? AND date<=? ORDER BY date DESC`, [from, end]),
  };
}

// ─── EXPORT / IMPORT ─────────────────────────────────────────────────────────
export async function exportAllData() {
  return {
    settings:          await getSettings(),
    inventory:         await getInventory(),
    wmaHistory:        await dbQuery('SELECT * FROM wma_history ORDER BY date DESC'),
    stockTransactions: await dbQuery('SELECT * FROM stock_transactions ORDER BY timestamp DESC'),
    sales:             await getSales(),
    expenses:          await getExpenses(),
    payables:          await getPayables(),
    suppliers:         await getSuppliers(),
    customers:         await getCustomers(),
    returns:           await getReturns(),
    auditLog:          await getAuditLog(),
  };
}
export async function importAllData(data) {
  for (const t of ['sales','inventory','expenses','payables','suppliers','customers','returns_log','wma_history','stock_transactions'])
    await dbRun(`DELETE FROM ${t}`);
  for (const item of (data.inventory  || [])) await addProduct(item);
  for (const item of (data.expenses   || [])) await addExpense(item);
  for (const item of (data.payables   || [])) await addPayable(item);
  for (const item of (data.suppliers  || [])) await addSupplier(item);
  if (data.settings) await saveSettings(data.settings);
}
