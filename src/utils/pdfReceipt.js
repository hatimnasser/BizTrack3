// src/utils/pdfReceipt.js — BizTrack Pro v4.2
// PDF receipt + P&L report generator.
//
// BUG FIXED: pdfReceipt v4.1 passed `encoding: Encoding.Base64` to Filesystem.writeFile
// for a binary (base64) file. That flag tells Capacitor to write the content as a UTF-8
// text string — turning binary PDF bytes into literal base64 ASCII characters, making the
// file unreadable. For binary files, OMIT the encoding parameter entirely so Capacitor
// auto-decodes the base64 input into proper binary bytes.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

// Internal helper — write a base64 PDF to cache and share it
async function _savePdfAndShare(pdfBase64, fileName, title, text) {
  if (Capacitor.isNativePlatform()) {
    try {
      // Write to Cache — always permitted, no storage permission needed
      // CRITICAL: no `encoding` field here — omitting it = binary/base64 mode
      const result = await Filesystem.writeFile({
        path: fileName,
        data: pdfBase64,
        directory: Directory.Cache
      });
      await Share.share({
        title,
        text,
        url: result.uri,
        dialogTitle: title
      });
    } catch (err) {
      console.error('PDF share failed, falling back to download:', err);
      // jsPDF browser-save as last resort
      const doc_dummy = new jsPDF();
      // We already have a finished doc — just trigger download via data URI
      const link = document.createElement('a');
      link.href = 'data:application/pdf;base64,' + pdfBase64;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } else {
    // Web: trigger browser download
    const link = document.createElement('a');
    link.href = 'data:application/pdf;base64,' + pdfBase64;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * Generate a PDF receipt for a single sale and share/download it.
 */
export async function generateAndShareReceipt(sale, settings) {
  const doc      = new jsPDF({ unit: 'mm', format: 'a6', orientation: 'portrait' });
  const currency = settings.currency || 'UGX';
  const fmt      = n => `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;
  const pageW    = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(27, 58, 75);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.bizName || 'My Business', pageW / 2, 11, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  if (settings.owner) doc.text(settings.owner, pageW / 2, 16, { align: 'center' });
  doc.setTextColor(232, 160, 32);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('RECEIPT', pageW / 2, 23, { align: 'center' });

  // Receipt info rows
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const y0 = 33;
  const infoRows = [
    ['Receipt #', sale.id || 'N/A'],
    ['Date',      new Date(sale.date || Date.now()).toLocaleString()],
    ['Customer',  sale.customer || 'Walk-in'],
    ['Phone',     sale.phone || '-'],
    ['Payment',   sale.method || 'Cash'],
  ];
  infoRows.forEach(([label, value], i) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text(label + ':', 8, y0 + i * 5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text(String(value), 38, y0 + i * 5);
  });

  // Divider
  const divY = y0 + infoRows.length * 5 + 2;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(8, divY, pageW - 8, divY);

  // Items table
  const tableY   = divY + 3;
  const discount = sale.discount || 0;
  const subtotal = (sale.qty || 1) * (sale.unitPrice || 0);
  const discAmt  = subtotal * (discount / 100);
  const total    = sale.total || subtotal - discAmt;
  const tax      = settings.taxRate > 0 ? total * (settings.taxRate / 100) : 0;
  const grandTotal = total + tax;

  autoTable(doc, {
    startY: tableY,
    margin: { left: 8, right: 8 },
    headStyles: { fillColor: [27, 58, 75], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [247, 244, 239] },
    head: [['Item', 'Qty', 'Unit Price', 'Amount']],
    body: [[
      (sale.product || 'Item') + (sale.saleUnit && sale.saleUnit !== 'pcs' ? ' ('+sale.saleUnit+')' : ''),
      String(sale.qty || 1), fmt(sale.unitPrice || 0), fmt(subtotal)
    ]],
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 22, halign: 'right' }
    }
  });

  // Totals
  let tY = doc.lastAutoTable.finalY + 4;
  doc.setFontSize(8);
  const totals = [];
  if (discount > 0) totals.push([`Discount (${discount}%)`, `-${fmt(discAmt)}`]);
  if (tax > 0)      totals.push([`Tax (${settings.taxRate}%)`, fmt(tax)]);
  totals.push(['TOTAL', fmt(grandTotal)]);
  totals.push(['Amount Paid', fmt(sale.paid || 0)]);
  if ((sale.balance || 0) > 0) totals.push(['Balance Due', fmt(sale.balance)]);

  totals.forEach(([label, val]) => {
    const isTotal   = label === 'TOTAL';
    const isBalance = label === 'Balance Due';
    if (isTotal) {
      doc.setFillColor(27, 58, 75);
      doc.roundedRect(8, tY - 3, pageW - 16, 8, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
    } else if (isBalance) {
      doc.setTextColor(193, 68, 14);
      doc.setFont('helvetica', 'bold');
    } else {
      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'normal');
    }
    doc.text(label, 12, tY + 2);
    doc.text(val, pageW - 12, tY + 2, { align: 'right' });
    tY += isTotal ? 9 : 6;
    if (isTotal) doc.setTextColor(30, 30, 30);
  });

  // Status badge
  tY += 2;
  const badgeColors = { PAID: [45,106,79], PARTIAL: [181,122,0], UNPAID: [232,160,32], OVERDUE: [193,68,14] };
  const bc = badgeColors[sale.status] || [100,100,100];
  doc.setFillColor(...bc);
  doc.roundedRect(pageW / 2 - 15, tY, 30, 7, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(sale.status || 'UNPAID', pageW / 2, tY + 4.5, { align: 'center' });

  // Footer
  tY += 12;
  doc.setDrawColor(200, 200, 200);
  doc.line(8, tY, pageW - 8, tY);
  tY += 4;
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(120, 120, 120);
  doc.text(settings.invoiceFooter || 'Thank you for your business!', pageW / 2, tY, { align: 'center' });
  tY += 5;
  doc.setFont('helvetica', 'normal');
  doc.text('Generated by BizTrack Pro', pageW / 2, tY, { align: 'center' });

  const fileName  = `receipt_${sale.id}_${Date.now()}.pdf`;
  const pdfBase64 = doc.output('datauristring').split(',')[1];
  await _savePdfAndShare(
    pdfBase64, fileName,
    `Receipt from ${settings.bizName || 'BizTrack Pro'}`,
    `Receipt for ${sale.product} — ${fmt(sale.total || 0)}`
  );
}

/**
 * Generate a P&L Summary PDF report and share/download it.
 */
export async function generatePLReport(reportData, settings, fromDate, toDate) {
  const doc      = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const currency = settings.currency || 'UGX';
  const fmt      = n => `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;
  const pageW    = doc.internal.pageSize.getWidth();

  const { sales, expenses, returns } = reportData;
  const revenue  = sales.reduce((s, r) => s + (r.total || 0), 0);
  const collected= sales.reduce((s, r) => s + (r.paid || 0), 0);
  const cogs     = sales.reduce((s, r) => s + ((r.qty || 0) * (r.costPrice || 0)), 0);
  const grossP   = revenue - cogs;
  const totalExp = expenses.reduce((s, r) => s + (r.amount || 0), 0);
  const netP     = grossP - totalExp;
  const refunds  = (returns || []).reduce((s, r) => s + (r.refund || 0), 0);
  const gm       = revenue > 0 ? ((grossP / revenue) * 100).toFixed(1) : '0.0';
  const nm       = revenue > 0 ? ((netP   / revenue) * 100).toFixed(1) : '0.0';

  // Header banner
  doc.setFillColor(27, 58, 75);
  doc.rect(0, 0, pageW, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.bizName || 'My Business', 15, 15);
  doc.setFontSize(12);
  doc.text('Profit & Loss Report', 15, 24);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Period: ${fromDate} to ${toDate}`, 15, 32);
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageW - 15, 32, { align: 'right' });

  // P&L summary table
  let startY = 48;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(27, 58, 75);
  doc.text('Income Statement', 15, startY);

  autoTable(doc, {
    startY: startY + 4,
    margin: { left: 15, right: 15 },
    head: [['Description', 'Amount']],
    headStyles: { fillColor: [27, 58, 75], textColor: [255, 255, 255], fontStyle: 'bold' },
    body: [
      [{ content: 'REVENUE', styles: { fontStyle: 'bold', fillColor: [235, 240, 243] } }, ''],
      ['Total Revenue',     fmt(revenue)],
      ['Total Collected',   fmt(collected)],
      ['Collection Rate',   `${revenue > 0 ? ((collected/revenue)*100).toFixed(1) : 0}%`],
      ['Less: Refunds',     `(${fmt(refunds)})`],
      [{ content: 'COST OF GOODS', styles: { fontStyle: 'bold', fillColor: [235, 240, 243] } }, ''],
      ['Cost of Goods Sold (WMA)', `(${fmt(cogs)})`],
      [{ content: `GROSS PROFIT — Margin ${gm}%`, styles: { fontStyle: 'bold', fillColor: [234, 244, 238] } },
       { content: fmt(grossP), styles: { fontStyle: 'bold', textColor: grossP >= 0 ? [45,106,79] : [193,68,14] } }],
      [{ content: 'OPERATING EXPENSES', styles: { fontStyle: 'bold', fillColor: [235, 240, 243] } }, ''],
      ['Total Expenses',    `(${fmt(totalExp)})`],
      [{ content: `NET PROFIT — Margin ${nm}%`, styles: { fontStyle: 'bold', fillColor: netP >= 0 ? [234,244,238] : [253,238,232] } },
       { content: fmt(netP), styles: { fontStyle: 'bold', textColor: netP >= 0 ? [45,106,79] : [193,68,14] } }],
    ],
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 45, halign: 'right' } }
  });

  // Sales by category
  const cats = {};
  sales.forEach(s => {
    const c = s.category || 'Uncategorised';
    if (!cats[c]) cats[c] = { rev: 0, qty: 0 };
    cats[c].rev += (s.total || 0);
    cats[c].qty += (s.qty || 0);
  });
  const catRows = Object.entries(cats).sort((a, b) => b[1].rev - a[1].rev).map(([c, d]) => [c, d.qty, fmt(d.rev)]);
  if (catRows.length > 0) {
    let y = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(27, 58, 75);
    doc.text('Sales by Category', 15, y);
    autoTable(doc, {
      startY: y + 4, margin: { left: 15, right: 15 },
      head: [['Category', 'Units Sold', 'Revenue']],
      headStyles: { fillColor: [27, 58, 75], textColor: [255, 255, 255] },
      body: catRows,
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } }
    });
  }

  // Expense breakdown
  const expCats = {};
  expenses.forEach(e => { expCats[e.category] = (expCats[e.category] || 0) + (e.amount || 0); });
  const expRows = Object.entries(expCats).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, fmt(v)]);
  if (expRows.length > 0) {
    let y = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(27, 58, 75);
    doc.text('Expense Breakdown', 15, y);
    autoTable(doc, {
      startY: y + 4, margin: { left: 15, right: 15 },
      head: [['Expense Category', 'Amount']],
      headStyles: { fillColor: [193, 68, 14], textColor: [255, 255, 255] },
      body: expRows,
      columnStyles: { 1: { halign: 'right' } }
    });
  }

  // Page numbers
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(150, 150, 150);
    const pH = doc.internal.pageSize.getHeight();
    doc.text(`Page ${i} of ${pageCount}`, pageW / 2, pH - 8, { align: 'center' });
    doc.text('BizTrack Pro', 15, pH - 8);
  }

  const fileName  = `pl_report_${fromDate}_${toDate}.pdf`;
  const pdfBase64 = doc.output('datauristring').split(',')[1];
  await _savePdfAndShare(
    pdfBase64, fileName,
    `P&L Report — ${settings.bizName || 'BizTrack Pro'}`,
    `Profit & Loss Report: ${fromDate} to ${toDate}`
  );
}
