import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany } from '../middleware/companyAuth.js';
import { nextSequence } from '../lib/sequence.js';

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireCompany);

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { customer_id, customer_name, payment_mode, invoice_date, lines } = req.body || {};
    if (!lines || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ ok: false, error: 'At least one line is required' });
    if (!['CASH', 'CREDIT'].includes(payment_mode)) return res.status(400).json({ ok: false, error: 'payment_mode must be CASH or CREDIT' });
    await client.query('BEGIN');
    let finalCustomerName = customer_name || 'Walk-in';
    if (customer_id) {
      const c = await client.query('SELECT name FROM customer WHERE id = $1 AND company_id = $2', [customer_id, req.company_id]);
      if (c.rows.length === 0) throw new Error('Customer not found');
      finalCustomerName = c.rows[0].name;
    }
    let subtotal = 0;
    for (const l of lines) subtotal += parseInt(l.amount || 0, 10);
    const invoiceNumber = await nextSequence(client, req.company_id, 'sales');
    const today = invoice_date || new Date().toISOString().slice(0, 10);
    const inv = await client.query(
      `INSERT INTO sales_invoice (company_id, invoice_number, invoice_date, customer_id, customer_name, subtotal, round_off, total_amount, payment_mode, status)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,'POSTED') RETURNING *`,
      [req.company_id, invoiceNumber, today, customer_id || null, finalCustomerName, subtotal, subtotal, payment_mode]
    );
    const invoice = inv.rows[0];
    for (const l of lines) {
      if (!l.item_id) throw new Error('Line missing item_id');
      const itemRow = await client.query('SELECT cost_price, name FROM item WHERE id = $1 AND company_id = $2', [l.item_id, req.company_id]);
      if (itemRow.rows.length === 0) throw new Error('Item ' + l.item_id + ' not found');
      const costAtSale = itemRow.rows[0].cost_price || 0;
      const qty = parseInt(l.quantity || 0, 10);
      const baseQtyMilli = parseInt(l.base_qty_milli || qty, 10);
      await client.query(
        `INSERT INTO sales_invoice_line (invoice_id, item_id, item_name, unit_id, unit_name, entered_qty, base_qty_milli, quantity, rate, amount, cost_price_at_sale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [invoice.id, l.item_id, l.item_name || itemRow.rows[0].name, l.unit_id || null, l.unit_name || null, qty, baseQtyMilli, qty, parseInt(l.rate || 0, 10), parseInt(l.amount || 0, 10), costAtSale]
      );
      await client.query('UPDATE item SET stock_quantity = stock_quantity - $1, updated_at = NOW() WHERE id = $2', [baseQtyMilli, l.item_id]);
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, invoice });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('create sale error', err);
    res.status(400).json({ ok: false, error: err.message || 'Failed to create sale' });
  } finally { client.release(); }
});

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const result = await pool.query('SELECT * FROM sales_invoice WHERE company_id = $1 ORDER BY id DESC LIMIT $2', [req.company_id, limit]);
    res.json({ ok: true, invoices: result.rows });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Failed to list sales' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const inv = await pool.query('SELECT * FROM sales_invoice WHERE id = $1 AND company_id = $2', [id, req.company_id]);
    if (inv.rows.length === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    const lines = await pool.query('SELECT * FROM sales_invoice_line WHERE invoice_id = $1 ORDER BY id', [id]);
    res.json({ ok: true, invoice: { ...inv.rows[0], lines: lines.rows } });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Failed to fetch sale' }); }
});

router.post('/:id/cancel', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    await client.query('BEGIN');
    const inv = await client.query("SELECT * FROM sales_invoice WHERE id = $1 AND company_id = $2 AND status = 'POSTED' FOR UPDATE", [id, req.company_id]);
    if (inv.rows.length === 0) throw new Error('Invoice not found or already cancelled');
    const lines = await client.query('SELECT * FROM sales_invoice_line WHERE invoice_id = $1', [id]);
    for (const l of lines.rows) {
      await client.query('UPDATE item SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2', [l.base_qty_milli, l.item_id]);
    }
    await client.query("UPDATE sales_invoice SET status = 'CANCELLED' WHERE id = $1", [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('cancel sale error', err);
    res.status(400).json({ ok: false, error: err.message || 'Failed to cancel' });
  } finally { client.release(); }
});

export default router;
