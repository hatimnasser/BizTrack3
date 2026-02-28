// src/utils/excelExport.js
// BizTrack Pro - Excel Export Utility
// Exports data as .xlsx readable by Excel and Google Sheets
// Uses SheetJS (xlsx) library

import * as XLSX from 'xlsx';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

const fmt = (n, currency = 'UGX') =>
  `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;

/**
 * Export all business data to a multi-sheet .xlsx file
 * @param {Object} data - { sales, inventory, expenses, suppliers, customers, returns, settings }
 */
export async function exportToExcel(data) {
  const wb = XLSX.utils.book_new();
  const cur = data.settings?.currency || 'UGX';

  // ─── SALES SHEET ─────────────────────────────────────────────
  const salesRows = (data.sales || []).map(s => ({
    'Receipt ID': s.id,
    'Date': new Date(s.date).toLocaleString(),
    'Customer': s.customer,
    'Phone': s.phone || '',
    'Product': s.product,
    'Category': s.category || '',
    'Qty': s.qty,
    'Unit Price': s.unitPrice,
    'Cost Price': s.costPrice,
    'Discount %': s.discount || 0,
    'Total': s.total,
    'Amount Paid': s.paid,
    'Balance': s.balance,
    'Status': s.status,
    'Payment Method': s.method,
    'Notes': s.notes || '',
    'Due Date': s.dueDate || ''
  }));
  const wsS = XLSX.utils.json_to_sheet(salesRows.length ? salesRows : [{}]);
  applySheetStyles(wsS, ['Total', 'Amount Paid', 'Balance', 'Unit Price', 'Cost Price']);
  XLSX.utils.book_append_sheet(wb, wsS, 'Sales');

  // ─── INVENTORY SHEET ─────────────────────────────────────────
  const invRows = (data.inventory || []).map(p => ({
    'Product ID': p.id,
    'Product Name': p.name,
    'Category': p.category,
    'Unit': p.unit,
    'Cost Price': p.costPrice,
    'Selling Price': p.sellPrice,
    'Current Stock': p.stock,
    'Reorder Level': p.reorderLevel,
    'Stock Value (Cost)': (p.stock || 0) * (p.costPrice || 0),
    'Stock Value (Sell)': (p.stock || 0) * (p.sellPrice || 0),
    'Profit/Unit': (p.sellPrice || 0) - (p.costPrice || 0),
    'Margin %': p.sellPrice > 0 ? (((p.sellPrice - p.costPrice) / p.sellPrice) * 100).toFixed(1) + '%' : '0%',
    'Supplier ID': p.supplierId || '',
    'Notes': p.notes || '',
    'Added': new Date(p.createdAt || Date.now()).toLocaleDateString()
  }));
  const wsI = XLSX.utils.json_to_sheet(invRows.length ? invRows : [{}]);
  XLSX.utils.book_append_sheet(wb, wsI, 'Inventory');

  // ─── EXPENSES SHEET ──────────────────────────────────────────
  const expRows = (data.expenses || []).map(e => ({
    'Expense ID': e.id,
    'Date': new Date(e.date).toLocaleString(),
    'Category': e.category,
    'Description': e.description,
    'Amount': e.amount,
    'Payment Method': e.method,
    'Reference': e.reference || ''
  }));
  const wsE = XLSX.utils.json_to_sheet(expRows.length ? expRows : [{}]);
  XLSX.utils.book_append_sheet(wb, wsE, 'Expenses');

  // ─── P&L SUMMARY SHEET ───────────────────────────────────────
  const allSales = data.sales || [];
  const allExp   = data.expenses || [];
  const allRet   = data.returns || [];
  const revenue  = allSales.reduce((s, r) => s + (r.total || 0), 0);
  const collected = allSales.reduce((s, r) => s + (r.paid || 0), 0);
  const cogs     = allSales.reduce((s, r) => s + ((r.qty || 0) * (r.costPrice || 0)), 0);
  const grossP   = revenue - cogs;
  const totalExp = allExp.reduce((s, r) => s + (r.amount || 0), 0);
  const netP     = grossP - totalExp;
  const refunds  = allRet.reduce((s, r) => s + (r.refund || 0), 0);

  const plRows = [
    ['INCOME STATEMENT', '', ''],
    ['', '', ''],
    ['REVENUE', '', ''],
    ['Total Revenue', revenue, ''],
    ['Total Collected', collected, ''],
    ['Collection Rate', revenue > 0 ? ((collected / revenue) * 100).toFixed(1) + '%' : '0%', ''],
    ['Total Refunds', refunds, ''],
    ['', '', ''],
    ['COST OF GOODS SOLD', '', ''],
    ['Cost of Goods Sold (COGS)', cogs, ''],
    ['', '', ''],
    ['GROSS PROFIT', grossP, revenue > 0 ? ((grossP / revenue) * 100).toFixed(1) + '% margin' : ''],
    ['', '', ''],
    ['OPERATING EXPENSES', '', ''],
    ['Total Expenses', totalExp, ''],
    ['', '', ''],
    ['NET PROFIT', netP, revenue > 0 ? ((netP / revenue) * 100).toFixed(1) + '% margin' : ''],
    ['', '', ''],
    ['TRANSACTIONS SUMMARY', '', ''],
    ['Total Sales Count', allSales.length, ''],
    ['Unique Customers', [...new Set(allSales.map(s => s.customer))].length, ''],
    ['Products Sold (units)', allSales.reduce((s, r) => s + (r.qty || 0), 0), ''],
    ['Paid Sales', allSales.filter(s => s.status === 'PAID').length, ''],
    ['Overdue Sales', allSales.filter(s => s.status === 'OVERDUE').length, ''],
  ];

  const wsPL = XLSX.utils.aoa_to_sheet(plRows);
  wsPL['!cols'] = [{ wch: 35 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsPL, 'P&L Summary');

  // ─── CUSTOMERS SHEET ─────────────────────────────────────────
  const cusRows = (data.customers || []).map(c => ({
    'Customer ID': c.id,
    'Name': c.name,
    'Phone': c.phone || '',
    'Email': c.email || '',
    'Address': c.address || '',
    'Notes': c.notes || '',
    'Member Since': new Date(c.createdAt || Date.now()).toLocaleDateString()
  }));
  const wsC = XLSX.utils.json_to_sheet(cusRows.length ? cusRows : [{}]);
  XLSX.utils.book_append_sheet(wb, wsC, 'Customers');

  // ─── SUPPLIERS SHEET ─────────────────────────────────────────
  const supRows = (data.suppliers || []).map(s => ({
    'Supplier ID': s.id,
    'Name': s.name,
    'Contact Person': s.contact || '',
    'Phone': s.phone || '',
    'Email': s.email || '',
    'Address': s.address || '',
    'Notes': s.notes || ''
  }));
  const wsSup = XLSX.utils.json_to_sheet(supRows.length ? supRows : [{}]);
  XLSX.utils.book_append_sheet(wb, wsSup, 'Suppliers');

  // ─── WRITE & SHARE ────────────────────────────────────────────
  const fileName = `biztrack_export_${new Date().toISOString().slice(0, 10)}.xlsx`;

  if (Capacitor.isNativePlatform()) {
    const wbOut = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    try {
      const result = await Filesystem.writeFile({
        path: fileName,
        data: wbOut,
        directory: Directory.Documents
      });
      await Share.share({
        title: 'BizTrack Pro Export',
        text: 'Your BizTrack Pro business data export',
        url: result.uri,
        dialogTitle: 'Open with Excel or Google Sheets'
      });
    } catch (err) {
      console.error('Export share failed:', err);
      // Fallback download
      downloadExcel(wb, fileName);
    }
  } else {
    downloadExcel(wb, fileName);
  }
}

function downloadExcel(wb, fileName) {
  XLSX.writeFile(wb, fileName);
}

function applySheetStyles(ws, numberCols) {
  // Auto-fit columns
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const colWidths = [];
  for (let C = range.s.c; C <= range.e.c; C++) {
    let maxLen = 10;
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v) maxLen = Math.max(maxLen, String(cell.v).length + 2);
    }
    colWidths.push({ wch: Math.min(maxLen, 40) });
  }
  ws['!cols'] = colWidths;
}

/**
 * Export a date-range filtered report to Excel
 */
export async function exportReportToExcel(reportData, settings, fromDate, toDate) {
  const filteredData = {
    sales: reportData.sales,
    expenses: reportData.expenses,
    returns: reportData.returns,
    inventory: [],
    customers: [],
    suppliers: [],
    settings
  };
  await exportToExcel(filteredData);
}
