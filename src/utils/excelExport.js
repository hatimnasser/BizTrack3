// src/utils/excelExport.js
// BizTrack Pro - Excel Export (Fixed for Android native)
// Saves to Documents folder + opens share sheet

import * as XLSX from 'xlsx';
import { saveAndShare } from './fileManager.js';

export async function exportToExcel(data) {
  const wb = XLSX.utils.book_new();

  const salesRows = (data.sales || []).map(s => ({
    'Receipt ID': s.id || '', 'Date': s.date ? new Date(s.date).toLocaleString() : '',
    'Customer': s.customer || 'Walk-in', 'Phone': s.phone || '',
    'Product': s.product || '', 'Category': s.category || '',
    'Qty': s.qty || 0, 'Unit Price': s.unitPrice || 0, 'Cost Price': s.costPrice || 0,
    'Discount %': s.discount || 0, 'Total': s.total || 0,
    'Amount Paid': s.paid || 0, 'Balance': s.balance || 0,
    'Status': s.status || '', 'Payment Method': s.method || '',
    'Notes': s.notes || '', 'Due Date': s.dueDate || ''
  }));
  const wsS = XLSX.utils.json_to_sheet(salesRows.length ? salesRows : [{ 'No Data': 'No sales yet' }]);
  autoFitColumns(wsS);
  XLSX.utils.book_append_sheet(wb, wsS, 'Sales');

  const invRows = (data.inventory || []).map(p => ({
    'Product ID': p.id || '', 'Product Name': p.name || '', 'Category': p.category || '',
    'Unit': p.unit || '', 'Cost Price': p.costPrice || 0, 'Selling Price': p.sellPrice || 0,
    'Current Stock': p.stock || 0, 'Reorder Level': p.reorderLevel || 0,
    'Stock Value (Cost)': (p.stock || 0) * (p.costPrice || 0),
    'Stock Value (Sell)': (p.stock || 0) * (p.sellPrice || 0),
    'Profit Per Unit': (p.sellPrice || 0) - (p.costPrice || 0),
    'Margin %': p.sellPrice > 0 ? (((p.sellPrice - p.costPrice) / p.sellPrice) * 100).toFixed(1) + '%' : '0%',
    'Supplier ID': p.supplierId || '', 'Notes': p.notes || ''
  }));
  const wsI = XLSX.utils.json_to_sheet(invRows.length ? invRows : [{ 'No Data': 'No inventory yet' }]);
  autoFitColumns(wsI);
  XLSX.utils.book_append_sheet(wb, wsI, 'Inventory');

  const expRows = (data.expenses || []).map(e => ({
    'Expense ID': e.id || '', 'Date': e.date ? new Date(e.date).toLocaleString() : '',
    'Category': e.category || '', 'Description': e.description || '',
    'Amount': e.amount || 0, 'Payment Method': e.method || '', 'Reference': e.reference || ''
  }));
  const wsE = XLSX.utils.json_to_sheet(expRows.length ? expRows : [{ 'No Data': 'No expenses yet' }]);
  autoFitColumns(wsE);
  XLSX.utils.book_append_sheet(wb, wsE, 'Expenses');

  const allSales = data.sales || [], allExp = data.expenses || [], allRet = data.returns || [];
  const revenue = allSales.reduce((s, r) => s + (r.total || 0), 0);
  const collected = allSales.reduce((s, r) => s + (r.paid || 0), 0);
  const cogs = allSales.reduce((s, r) => s + ((r.qty || 0) * (r.costPrice || 0)), 0);
  const grossP = revenue - cogs;
  const totalExp = allExp.reduce((s, r) => s + (r.amount || 0), 0);
  const netP = grossP - totalExp;
  const refunds = allRet.reduce((s, r) => s + (r.refund || 0), 0);

  const plData = [
    ['BizTrack Pro — Profit & Loss Summary', ''],
    ['Generated', new Date().toLocaleString()],
    ['Business', data.settings?.bizName || ''],
    ['', ''],
    ['── REVENUE ──', ''],
    ['Total Revenue', revenue], ['Total Collected', collected],
    ['Collection Rate', revenue > 0 ? ((collected / revenue) * 100).toFixed(1) + '%' : '0%'],
    ['Total Refunds', refunds], ['', ''],
    ['── COST OF GOODS ──', ''],
    ['Cost of Goods Sold', cogs], ['', ''],
    ['GROSS PROFIT', grossP],
    ['Gross Margin', revenue > 0 ? ((grossP / revenue) * 100).toFixed(1) + '%' : '0%'],
    ['', ''],
    ['── EXPENSES ──', ''],
    ['Total Expenses', totalExp], ['', ''],
    ['NET PROFIT', netP],
    ['Net Margin', revenue > 0 ? ((netP / revenue) * 100).toFixed(1) + '%' : '0%'],
    ['', ''],
    ['── TRANSACTIONS ──', ''],
    ['Total Sales', allSales.length],
    ['Unique Customers', [...new Set(allSales.map(s => s.customer))].length],
    ['Units Sold', allSales.reduce((s, r) => s + (r.qty || 0), 0)],
    ['Paid Sales', allSales.filter(s => s.status === 'PAID').length],
    ['Unpaid Sales', allSales.filter(s => s.status === 'UNPAID').length],
    ['Overdue Sales', allSales.filter(s => s.status === 'OVERDUE').length],
  ];
  const wsPL = XLSX.utils.aoa_to_sheet(plData);
  wsPL['!cols'] = [{ wch: 35 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsPL, 'P&L Summary');

  const cusRows = (data.customers || []).map(c => ({
    'Customer ID': c.id || '', 'Name': c.name || '', 'Phone': c.phone || '',
    'Email': c.email || '', 'Address': c.address || '', 'Notes': c.notes || ''
  }));
  const wsC = XLSX.utils.json_to_sheet(cusRows.length ? cusRows : [{ 'No Data': 'No customers yet' }]);
  autoFitColumns(wsC);
  XLSX.utils.book_append_sheet(wb, wsC, 'Customers');

  const supRows = (data.suppliers || []).map(s => ({
    'Supplier ID': s.id || '', 'Name': s.name || '', 'Contact': s.contact || '',
    'Phone': s.phone || '', 'Email': s.email || '', 'Notes': s.notes || ''
  }));
  const wsSup = XLSX.utils.json_to_sheet(supRows.length ? supRows : [{ 'No Data': 'No suppliers yet' }]);
  autoFitColumns(wsSup);
  XLSX.utils.book_append_sheet(wb, wsSup, 'Suppliers');

  const fileName = `BizTrack_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const wbBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

  return saveAndShare(
    fileName, wbBase64,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'BizTrack Pro — Data Export',
    'Your BizTrack Pro business data. Open with Google Sheets or Excel.'
  );
}

export async function exportReportToExcel(reportData, settings, fromDate, toDate) {
  const wb = XLSX.utils.book_new();

  const salesRows = (reportData.sales || []).map(s => ({
    'Receipt ID': s.id || '', 'Date': s.date ? new Date(s.date).toLocaleString() : '',
    'Customer': s.customer || 'Walk-in', 'Product': s.product || '',
    'Category': s.category || '', 'Qty': s.qty || 0,
    'Unit Price': s.unitPrice || 0, 'Total': s.total || 0,
    'Paid': s.paid || 0, 'Balance': s.balance || 0,
    'Status': s.status || '', 'Payment': s.method || ''
  }));
  const wsS = XLSX.utils.json_to_sheet(salesRows.length ? salesRows : [{ 'No Data': 'No sales in period' }]);
  autoFitColumns(wsS);
  XLSX.utils.book_append_sheet(wb, wsS, 'Sales');

  const expRows = (reportData.expenses || []).map(e => ({
    'Date': e.date ? new Date(e.date).toLocaleString() : '',
    'Category': e.category || '', 'Description': e.description || '',
    'Amount': e.amount || 0, 'Method': e.method || ''
  }));
  const wsE = XLSX.utils.json_to_sheet(expRows.length ? expRows : [{ 'No Data': 'No expenses in period' }]);
  autoFitColumns(wsE);
  XLSX.utils.book_append_sheet(wb, wsE, 'Expenses');

  const revenue = (reportData.sales || []).reduce((s, r) => s + (r.total || 0), 0);
  const cogs = (reportData.sales || []).reduce((s, r) => s + ((r.qty || 0) * (r.costPrice || 0)), 0);
  const grossP = revenue - cogs;
  const totalExp = (reportData.expenses || []).reduce((s, r) => s + (r.amount || 0), 0);
  const netP = grossP - totalExp;

  const plData = [
    ['Period Report', `${fromDate} to ${toDate}`],
    ['Business', settings?.bizName || ''], ['Generated', new Date().toLocaleString()],
    ['', ''],
    ['Revenue', revenue], ['COGS', cogs], ['Gross Profit', grossP],
    ['Gross Margin', revenue > 0 ? ((grossP / revenue) * 100).toFixed(1) + '%' : '0%'],
    ['Total Expenses', totalExp], ['Net Profit', netP],
    ['Net Margin', revenue > 0 ? ((netP / revenue) * 100).toFixed(1) + '%' : '0%'],
  ];
  const wsPL = XLSX.utils.aoa_to_sheet(plData);
  wsPL['!cols'] = [{ wch: 25 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsPL, 'P&L Summary');

  const fileName = `BizTrack_Report_${fromDate}_to_${toDate}.xlsx`;
  const wbBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

  return saveAndShare(
    fileName, wbBase64,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    `BizTrack Report ${fromDate} to ${toDate}`,
    'Your BizTrack Pro report. Open with Google Sheets or Excel.'
  );
}

function autoFitColumns(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const cols = [];
  for (let C = range.s.c; C <= range.e.c; C++) {
    let max = 10;
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v) max = Math.max(max, String(cell.v).length + 2);
    }
    cols.push({ wch: Math.min(max, 40) });
  }
  ws['!cols'] = cols;
}
