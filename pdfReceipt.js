// src/utils/pdfReceipt.js
// BizTrack Pro - PDF Receipt Generator
// Uses jsPDF + jsPDF-autotable, share via Capacitor Share API (WhatsApp, etc.)

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

/**
 * Generate a PDF receipt for a sale and offer sharing via WhatsApp/other apps.
 * @param {Object} sale - Sale record from DB
 * @param {Object} settings - Business settings
 * @returns {Promise<void>}
 */
export async function generateAndShareReceipt(sale, settings) {
  const doc = new jsPDF({ unit: 'mm', format: 'a6', orientation: 'portrait' });

  const currency = settings.currency || 'UGX';
  const fmt = (n) => `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;
  const pageW = doc.internal.pageSize.getWidth();

  // ─── Header ────────────────────────────────────────────────────
  doc.setFillColor(27, 58, 75); // --primary
  doc.rect(0, 0, pageW, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.bizName || 'My Business', pageW / 2, 11, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  if (settings.owner) doc.text(settings.owner, pageW / 2, 16, { align: 'center' });

  doc.setTextColor(232, 160, 32); // --accent
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('RECEIPT', pageW / 2, 23, { align: 'center' });

  // ─── Receipt Info ──────────────────────────────────────────────
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const saleDate = new Date(sale.date || Date.now()).toLocaleString();
  const y0 = 33;

  const infoRows = [
    ['Receipt #', sale.id || 'N/A'],
    ['Date', saleDate],
    ['Customer', sale.customer || 'Walk-in'],
    ['Phone', sale.phone || '-'],
    ['Payment', sale.method || 'Cash'],
  ];

  infoRows.forEach(([label, value], i) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text(label + ':', 8, y0 + i * 5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text(String(value), 38, y0 + i * 5);
  });

  // ─── Divider ───────────────────────────────────────────────────
  const divY = y0 + infoRows.length * 5 + 2;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(8, divY, pageW - 8, divY);

  // ─── Items Table ───────────────────────────────────────────────
  const tableY = divY + 3;
  const discount = sale.discount || 0;
  const subtotal = (sale.qty || 1) * (sale.unitPrice || 0);
  const discountAmt = subtotal * (discount / 100);
  const total = sale.total || subtotal - discountAmt;
  const tax = settings.taxRate > 0 ? total * (settings.taxRate / 100) : 0;
  const grandTotal = total + tax;

  autoTable(doc, {
    startY: tableY,
    margin: { left: 8, right: 8 },
    headStyles: {
      fillColor: [27, 58, 75],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8
    },
    bodyStyles: { fontSize: 8, textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [247, 244, 239] },
    head: [['Item', 'Qty', 'Unit Price', 'Amount']],
    body: [
      [
        sale.product || 'Item',
        String(sale.qty || 1),
        fmt(sale.unitPrice || 0),
        fmt(subtotal)
      ]
    ],
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 22, halign: 'right' }
    }
  });

  // ─── Totals ────────────────────────────────────────────────────
  let tY = doc.lastAutoTable.finalY + 4;
  doc.setFontSize(8);

  const totals = [];
  if (discount > 0) totals.push([`Discount (${discount}%)`, `-${fmt(discountAmt)}`]);
  if (tax > 0) totals.push([`Tax (${settings.taxRate}%)`, fmt(tax)]);
  totals.push(['TOTAL', fmt(grandTotal)]);
  totals.push(['Amount Paid', fmt(sale.paid || 0)]);
  if ((sale.balance || 0) > 0) totals.push(['Balance Due', fmt(sale.balance)]);

  totals.forEach(([label, val], i) => {
    const isTotal = label === 'TOTAL';
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

  // ─── Status Badge ─────────────────────────────────────────────
  tY += 2;
  const statusColors = {
    PAID: [45, 106, 79],
    PARTIAL: [181, 122, 0],
    UNPAID: [232, 160, 32],
    OVERDUE: [193, 68, 14]
  };
  const badgeColor = statusColors[sale.status] || [100, 100, 100];
  doc.setFillColor(...badgeColor);
  doc.roundedRect(pageW / 2 - 15, tY, 30, 7, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(sale.status || 'UNPAID', pageW / 2, tY + 4.5, { align: 'center' });

  // ─── Footer ────────────────────────────────────────────────────
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

  // ─── Save & Share ─────────────────────────────────────────────
  const pdfBase64 = doc.output('datauristring').split(',')[1];
  const fileName = `receipt_${sale.id}_${Date.now()}.pdf`;

  if (Capacitor.isNativePlatform()) {
    try {
      // Write to device storage
      const result = await Filesystem.writeFile({
        path: fileName,
        data: pdfBase64,
        directory: Directory.Cache,
        encoding: Encoding.Base64 // omit for binary
      });

      await Share.share({
        title: `Receipt from ${settings.bizName || 'BizTrack Pro'}`,
        text: `Here is your receipt for ${sale.product} — ${fmt(sale.total || 0)}`,
        url: result.uri,
        dialogTitle: 'Share Receipt'
      });
    } catch (err) {
      console.error('Share failed:', err);
      // Fallback: download
      doc.save(fileName);
    }
  } else {
    // Web fallback: download
    doc.save(fileName);
  }
}

/**
 * Generate a P&L Summary PDF and share/download
 */
export async function generatePLReport(reportData, settings, fromDate, toDate) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const currency = settings.currency || 'UGX';
  const fmt = (n) => `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;
  const pageW = doc.internal.pageSize.getWidth();

  const { sales, expenses, returns } = reportData;
  const revenue   = sales.reduce((s, r) => s + (r.total || 0), 0);
  const collected = sales.reduce((s, r) => s + (r.paid || 0), 0);
  const cogs      = sales.reduce((s, r) => s + ((r.qty || 0) * (r.costPrice || 0)), 0);
  const grossP    = revenue - cogs;
  const totalExp  = expenses.reduce((s, r) => s + (r.amount || 0), 0);
  const netP      = grossP - totalExp;
  const refunds   = returns.reduce((s, r) => s + (r.refund || 0), 0);
  const gm        = revenue > 0 ? ((grossP / revenue) * 100).toFixed(1) : '0.0';
  const nm        = revenue > 0 ? ((netP / revenue) * 100).toFixed(1) : '0.0';

  // Header
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

  // P&L Summary Table
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
      ['Total Revenue', fmt(revenue)],
      ['Total Collected', fmt(collected)],
      ['Collection Rate', `${revenue > 0 ? ((collected / revenue) * 100).toFixed(1) : 0}%`],
      ['Less: Refunds', `(${fmt(refunds)})`],
      [{ content: 'COST OF GOODS', styles: { fontStyle: 'bold', fillColor: [235, 240, 243] } }, ''],
      ['Cost of Goods Sold', `(${fmt(cogs)})`],
      [{ content: `GROSS PROFIT — Margin ${gm}%`, styles: { fontStyle: 'bold', fillColor: [234, 244, 238] } }, { content: fmt(grossP), styles: { fontStyle: 'bold', textColor: grossP >= 0 ? [45, 106, 79] : [193, 68, 14] } }],
      [{ content: 'OPERATING EXPENSES', styles: { fontStyle: 'bold', fillColor: [235, 240, 243] } }, ''],
      ['Total Expenses', `(${fmt(totalExp)})`],
      [{ content: `NET PROFIT — Margin ${nm}%`, styles: { fontStyle: 'bold', fillColor: netP >= 0 ? [234, 244, 238] : [253, 238, 232] } }, { content: fmt(netP), styles: { fontStyle: 'bold', textColor: netP >= 0 ? [45, 106, 79] : [193, 68, 14] } }],
    ],
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 45, halign: 'right' }
    }
  });

  // Category breakdown
  const cats = {};
  sales.forEach(s => {
    const c = s.category || 'Uncategorised';
    if (!cats[c]) cats[c] = { rev: 0, qty: 0 };
    cats[c].rev += (s.total || 0);
    cats[c].qty += (s.qty || 0);
  });
  const catRows = Object.entries(cats).sort((a, b) => b[1].rev - a[1].rev)
    .map(([c, d]) => [c, d.qty, fmt(d.rev)]);

  if (catRows.length > 0) {
    let yAfter = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(27, 58, 75);
    doc.text('Sales by Category', 15, yAfter);

    autoTable(doc, {
      startY: yAfter + 4,
      margin: { left: 15, right: 15 },
      head: [['Category', 'Units Sold', 'Revenue']],
      headStyles: { fillColor: [27, 58, 75], textColor: [255, 255, 255] },
      body: catRows,
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'right' }
      }
    });
  }

  // Expense breakdown
  const expCats = {};
  expenses.forEach(e => {
    expCats[e.category] = (expCats[e.category] || 0) + (e.amount || 0);
  });
  const expRows = Object.entries(expCats).sort((a, b) => b[1] - a[1])
    .map(([c, v]) => [c, fmt(v)]);

  if (expRows.length > 0) {
    let yAfter2 = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(27, 58, 75);
    doc.text('Expense Breakdown', 15, yAfter2);

    autoTable(doc, {
      startY: yAfter2 + 4,
      margin: { left: 15, right: 15 },
      head: [['Expense Category', 'Amount']],
      headStyles: { fillColor: [193, 68, 14], textColor: [255, 255, 255] },
      body: expRows,
      columnStyles: { 1: { halign: 'right' } }
    });
  }

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${pageCount}`, pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });
    doc.text('BizTrack Pro', 15, doc.internal.pageSize.getHeight() - 8);
  }

  const fileName = `pl_report_${fromDate}_${toDate}.pdf`;
  const pdfBase64 = doc.output('datauristring').split(',')[1];

  if (Capacitor.isNativePlatform()) {
    try {
      const result = await Filesystem.writeFile({
        path: fileName,
        data: pdfBase64,
        directory: Directory.Documents,
      });
      await Share.share({
        title: `P&L Report — ${settings.bizName}`,
        text: `Profit & Loss Report: ${fromDate} to ${toDate}`,
        url: result.uri,
        dialogTitle: 'Share P&L Report'
      });
    } catch (err) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
}
