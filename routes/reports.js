import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany } from '../middleware/companyAuth.js';

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireCompany);

// -------------------------------------------------------------------
// GET /pl?from=YYYY-MM-DD&to=YYYY-MM-DD
// Trading + P&L figures for a period
// -------------------------------------------------------------------
router.get('/pl', async (req, res) => {
  try {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!from || !to) {
      return res.status(400).json({ ok: false, error: 'from and to are required (YYYY-MM-DD)' });
    }
    const cid = req.company_id;

    // Revenue (all POSTED sales in range)
    const revRow = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as revenue,
              COUNT(*) as bills
         FROM sales_invoice
        WHERE company_id = $1 AND invoice_date >= $2 AND invoice_date <= $3 AND status = 'POSTED'`,
      [cid, from, to]
    );
    const revenue = Number(revRow.rows[0].revenue);
    const bills = Number(revRow.rows[0].bills);

    // Cost of goods sold (sum of cost snapshots × qty)
    const cogsRow = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(l.cost_price_at_sale, 0) * l.quantity), 0) as cogs
         FROM sales_invoice_line l
         JOIN sales_invoice inv ON inv.id = l.invoice_id
        WHERE inv.company_id = $1 AND inv.invoice_date >= $2 AND inv.invoice_date <= $3 AND inv.status = 'POSTED'`,
      [cid, from, to]
    );
    const cogs = Number(cogsRow.rows[0].cogs);
    const grossProfit = revenue - cogs;

    // Purchases in range
    const purRow = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as purchases
         FROM purchase_invoice
        WHERE company_id = $1 AND purchase_date >= $2 AND purchase_date <= $3 AND status = 'POSTED'`,
      [cid, from, to]
    );
    const purchases = Number(purRow.rows[0].purchases);

    // Closing stock value (current stock × cost_price)
    const stockRow = await pool.query(
      "SELECT COALESCE(SUM(stock_quantity * cost_price), 0) as stock_value FROM item WHERE company_id = $1 AND status = 'ACTIVE'",
      [cid]
    );
    const closingStock = Number(stockRow.rows[0].stock_value);

    // Opening stock derived: closing − purchases + cogs
    let openingStock = closingStock - purchases + cogs;
    if (openingStock < 0) openingStock = 0;

    // Expense breakdown by category
    const expRows = await pool.query(
      `SELECT category, COALESCE(SUM(amount), 0) as total
         FROM expense
        WHERE company_id = $1 AND expense_date >= $2 AND expense_date <= $3 AND status = 'POSTED'
        GROUP BY category
        ORDER BY total DESC`,
      [cid, from, to]
    );
    const expenses = expRows.rows.map((r) => ({
      category: r.category,
      total: Number(r.total),
    }));
    const totalExpenses = expenses.reduce((s, e) => s + e.total, 0);

    const netProfit = grossProfit - totalExpenses;

    res.json({
      ok: true,
      from, to,
      revenue,
      bills,
      cogs,
      grossProfit,
      purchases,
      openingStock,
      closingStock,
      expenses,
      totalExpenses,
      netProfit,
    });
  } catch (err) {
    console.error('reports/pl error', err);
    res.status(500).json({ ok: false, error: 'Failed to compute P&L' });
  }
});

// -------------------------------------------------------------------
// GET /balance-sheet?asOf=YYYY-MM-DD
// -------------------------------------------------------------------
router.get('/balance-sheet', async (req, res) => {
  try {
    const asOf = String(req.query.asOf || new Date().toISOString().slice(0, 10));
    const cid = req.company_id;

    // Cash in hand: cash sales + receipts − cash purchases − payments − expenses
    const cashSalesRow = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as t FROM sales_invoice
        WHERE company_id = $1 AND invoice_date <= $2 AND status = 'POSTED' AND payment_mode = 'CASH'`,
      [cid, asOf]
    );
    const cashPurchRow = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as t FROM purchase_invoice
        WHERE company_id = $1 AND purchase_date <= $2 AND status = 'POSTED' AND payment_mode = 'CASH'`,
      [cid, asOf]
    );
    const receiptsRow = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as t FROM receipt
        WHERE company_id = $1 AND receipt_date <= $2 AND status = 'POSTED'`,
      [cid, asOf]
    );
    const paymentsRow = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as t FROM payment
        WHERE company_id = $1 AND payment_date <= $2 AND status = 'POSTED'`,
      [cid, asOf]
    );
    const expensesRow = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as t FROM expense
        WHERE company_id = $1 AND expense_date <= $2 AND status = 'POSTED'`,
      [cid, asOf]
    );

    const cash = Number(cashSalesRow.rows[0].t)
      - Number(cashPurchRow.rows[0].t)
      + Number(receiptsRow.rows[0].t)
      - Number(paymentsRow.rows[0].t)
      - Number(expensesRow.rows[0].t);

    // Debtors: credit sales − receipts
    const creditSalesRow = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as t FROM sales_invoice
        WHERE company_id = $1 AND invoice_date <= $2 AND status = 'POSTED' AND payment_mode = 'CREDIT'`,
      [cid, asOf]
    );
    const debtors = Number(creditSalesRow.rows[0].t) - Number(receiptsRow.rows[0].t);

    // Creditors: credit purchases − payments
    const creditPurchRow = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as t FROM purchase_invoice
        WHERE company_id = $1 AND purchase_date <= $2 AND status = 'POSTED' AND payment_mode = 'CREDIT'`,
      [cid, asOf]
    );
    const creditors = Number(creditPurchRow.rows[0].t) - Number(paymentsRow.rows[0].t);

    // Stock at cost
    const stockRow = await pool.query(
      "SELECT COALESCE(SUM(stock_quantity * cost_price), 0) as t FROM item WHERE company_id = $1 AND status = 'ACTIVE'",
      [cid]
    );
    const stock = Number(stockRow.rows[0].t);

    const fixedAssets = 0;
    const loans = 0;

    const totalAssets = fixedAssets + Math.max(cash, 0) + Math.max(debtors, 0) + stock;
    const capitalDerived = totalAssets - Math.max(creditors, 0) - loans;

    res.json({
      ok: true,
      asOf,
      assets: {
        fixedAssets,
        cash,
        debtors: Math.max(debtors, 0),
        stock,
        total: totalAssets,
      },
      liabilities: {
        capital: capitalDerived,
        loans,
        creditors: Math.max(creditors, 0),
        total: capitalDerived + loans + Math.max(creditors, 0),
      },
    });
  } catch (err) {
    console.error('reports/bs error', err);
    res.status(500).json({ ok: false, error: 'Failed to compute balance sheet' });
  }
});

// -------------------------------------------------------------------
// GET /dashboard
// -------------------------------------------------------------------
router.get('/dashboard', async (req, res) => {
  try {
    const cid = req.company_id;
    const today = new Date().toISOString().slice(0, 10);
    const ym = today.slice(0, 7);

    const todaySales = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
         FROM sales_invoice WHERE company_id = $1 AND invoice_date = $2 AND status = 'POSTED'`,
      [cid, today]
    );
    const monthSales = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM sales_invoice
        WHERE company_id = $1 AND substr(invoice_date::text, 1, 7) = $2 AND status = 'POSTED'`,
      [cid, ym]
    );
    const todayPurch = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM purchase_invoice
        WHERE company_id = $1 AND purchase_date = $2 AND status = 'POSTED'`,
      [cid, today]
    );
    const monthPurch = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM purchase_invoice
        WHERE company_id = $1 AND substr(purchase_date::text, 1, 7) = $2 AND status = 'POSTED'`,
      [cid, ym]
    );
    const todayExp = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expense
        WHERE company_id = $1 AND expense_date = $2 AND status = 'POSTED'`,
      [cid, today]
    );
    const monthExp = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expense
        WHERE company_id = $1 AND substr(expense_date::text, 1, 7) = $2 AND status = 'POSTED'`,
      [cid, ym]
    );
    const lowStock = await pool.query(
      "SELECT COUNT(*) as c FROM item WHERE company_id = $1 AND status = 'ACTIVE' AND stock_quantity <= reorder_level",
      [cid]
    );

    res.json({
      ok: true,
      today: {
        sales: Number(todaySales.rows[0].total),
        salesCount: Number(todaySales.rows[0].count),
        purchases: Number(todayPurch.rows[0].total),
        expenses: Number(todayExp.rows[0].total),
      },
      month: {
        sales: Number(monthSales.rows[0].total),
        purchases: Number(monthPurch.rows[0].total),
        expenses: Number(monthExp.rows[0].total),
      },
      lowStockCount: Number(lowStock.rows[0].c),
    });
  } catch (err) {
    console.error('reports/dashboard error', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch dashboard' });
  }
});

export default router;
