// src/utils/plEngine.js
// BizTrack Pro - Profit & Loss Engine
// Central calculation engine used by reports, dashboard KPIs, and exports

/**
 * Compute full P&L metrics from raw data arrays
 * @param {Array} sales
 * @param {Array} expenses
 * @param {Array} returns
 * @param {Object} settings
 * @returns {Object} Full P&L metrics
 */
export function computePL(sales = [], expenses = [], returns = [], settings = {}) {
  const now = new Date();

  // Revenue metrics
  const revenue    = sales.reduce((s, r) => s + (r.total || 0), 0);
  const collected  = sales.reduce((s, r) => s + (r.paid || 0), 0);
  const cogs       = sales.reduce((s, r) => s + ((r.qty || 0) * (r.costPrice || 0)), 0);
  const grossP     = revenue - cogs;
  const totalExp   = expenses.reduce((s, r) => s + (r.amount || 0), 0);
  const netP       = grossP - totalExp;
  const refunds    = returns.reduce((s, r) => s + (r.refund || 0), 0);
  const outstanding = sales.reduce((s, r) => s + (r.balance || 0), 0);

  // Rates
  const cr = revenue > 0 ? ((collected / revenue) * 100).toFixed(1) : '0.0';
  const gm = revenue > 0 ? ((grossP / revenue) * 100).toFixed(1)    : '0.0';
  const nm = revenue > 0 ? ((netP / revenue) * 100).toFixed(1)       : '0.0';

  // Debt segmentation
  const isOverdue = (s) => {
    if (s.status === 'PAID') return false;
    if (!s.dueDate) return false;
    return new Date(s.dueDate) < now;
  };
  const overdueDebt  = sales.filter(s => isOverdue(s) && (s.balance || 0) > 0)
                           .reduce((s, r) => s + (r.balance || 0), 0);
  const upcomingDebt = sales.filter(s => !isOverdue(s) && s.status !== 'PAID' && (s.balance || 0) > 0)
                           .reduce((s, r) => s + (r.balance || 0), 0);

  // Category breakdown
  const categoryBreakdown = {};
  sales.forEach(s => {
    const c = s.category || 'Uncategorised';
    if (!categoryBreakdown[c]) categoryBreakdown[c] = { revenue: 0, cogs: 0, profit: 0, qty: 0, count: 0 };
    const rev = s.total || 0;
    const cost = (s.qty || 0) * (s.costPrice || 0);
    categoryBreakdown[c].revenue += rev;
    categoryBreakdown[c].cogs    += cost;
    categoryBreakdown[c].profit  += rev - cost;
    categoryBreakdown[c].qty     += s.qty || 0;
    categoryBreakdown[c].count   += 1;
  });
  const categorySorted = Object.entries(categoryBreakdown)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([name, d]) => ({ name, ...d, margin: d.revenue > 0 ? ((d.profit / d.revenue) * 100).toFixed(1) : '0.0' }));

  // Payment methods
  const paymentMethods = {};
  sales.forEach(s => {
    const m = s.method || 'Cash';
    paymentMethods[m] = (paymentMethods[m] || 0) + (s.paid || 0);
  });
  const paymentMethodsSorted = Object.entries(paymentMethods)
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount]) => ({
      method, amount,
      pct: collected > 0 ? ((amount / collected) * 100).toFixed(1) : '0.0'
    }));

  // Expense categories
  const expenseByCategory = {};
  expenses.forEach(e => {
    expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + (e.amount || 0);
  });
  const expenseSorted = Object.entries(expenseByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({
      category, amount,
      pct: totalExp > 0 ? ((amount / totalExp) * 100).toFixed(1) : '0.0'
    }));

  // Top customers by revenue
  const customerRevenue = {};
  sales.forEach(s => {
    const c = s.customer || 'Walk-in';
    if (!customerRevenue[c]) customerRevenue[c] = { revenue: 0, paid: 0, balance: 0, count: 0 };
    customerRevenue[c].revenue  += s.total || 0;
    customerRevenue[c].paid     += s.paid || 0;
    customerRevenue[c].balance  += s.balance || 0;
    customerRevenue[c].count    += 1;
  });
  const topCustomers = Object.entries(customerRevenue)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10)
    .map(([name, d]) => ({ name, ...d }));

  // Daily revenue trend (last 30 days)
  const dailyTrend = {};
  sales.forEach(s => {
    const day = (s.date || '').slice(0, 10);
    if (day) {
      if (!dailyTrend[day]) dailyTrend[day] = { revenue: 0, profit: 0 };
      dailyTrend[day].revenue += s.total || 0;
      dailyTrend[day].profit  += (s.total || 0) - ((s.qty || 0) * (s.costPrice || 0));
    }
  });
  const trendSorted = Object.entries(dailyTrend)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({ date, ...d }));

  // Status counts
  const statusCounts = { PAID: 0, PARTIAL: 0, UNPAID: 0, OVERDUE: 0 };
  sales.forEach(s => { statusCounts[s.status] = (statusCounts[s.status] || 0) + 1; });

  return {
    // Core metrics
    revenue,
    collected,
    outstanding,
    cogs,
    grossProfit: grossP,
    grossMargin: gm,
    totalExpenses: totalExp,
    netProfit: netP,
    netMargin: nm,
    collectionRate: cr,
    refunds,
    overdueDebt,
    upcomingDebt,

    // Counts
    salesCount: sales.length,
    uniqueCustomers: [...new Set(sales.map(s => s.customer))].length,
    unitsSold: sales.reduce((s, r) => s + (r.qty || 0), 0),
    statusCounts,

    // Breakdowns
    categoryBreakdown: categorySorted,
    paymentMethods: paymentMethodsSorted,
    expenseBreakdown: expenseSorted,
    topCustomers,
    dailyTrend: trendSorted,

    // Meta
    computedAt: new Date().toISOString()
  };
}

/**
 * Compute KPIs for the dashboard
 */
export function computeDashboardKPIs(sales = [], expenses = [], inventory = []) {
  const today = new Date().toISOString().slice(0, 10);
  const todaySales = sales.filter(s => (s.date || '').slice(0, 10) === today);
  const todayRevenue = todaySales.reduce((s, r) => s + (r.total || 0), 0);
  const todayProfit  = todaySales.reduce((s, r) => s + ((r.total || 0) - (r.qty || 0) * (r.costPrice || 0)), 0);

  const totalRevenue  = sales.reduce((s, r) => s + (r.total || 0), 0);
  const totalCollected = sales.reduce((s, r) => s + (r.paid || 0), 0);
  const totalBalance  = sales.reduce((s, r) => s + (r.balance || 0), 0);

  const now = new Date();
  const overdueCount = sales.filter(s => {
    if (s.status === 'PAID') return false;
    if (!s.dueDate) return false;
    return new Date(s.dueDate) < now && (s.balance || 0) > 0;
  }).length;

  const lowStockCount = inventory.filter(p => (p.stock || 0) <= (p.reorderLevel || 5)).length;
  const outOfStockCount = inventory.filter(p => (p.stock || 0) === 0).length;

  const totalExpenses = expenses.reduce((s, r) => s + (r.amount || 0), 0);
  const cogs = sales.reduce((s, r) => s + ((r.qty || 0) * (r.costPrice || 0)), 0);
  const grossProfit = totalRevenue - cogs;
  const netProfit = grossProfit - totalExpenses;

  return {
    todayRevenue,
    todayProfit,
    totalRevenue,
    totalCollected,
    totalBalance,
    overdueCount,
    lowStockCount,
    outOfStockCount,
    totalExpenses,
    grossProfit,
    netProfit,
    grossMargin: totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0.0',
    netMargin: totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0',
  };
}
