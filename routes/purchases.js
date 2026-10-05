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
    const { supplier_id, payment_mode, purchase_date, supplier_invoice_no, supplier_invoice_date, lines } = req.body || {};
    if (!supplier_id) return res.status(400).json({ ok: false, error: 'supplier_id is required' });
    if (!lines || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ ok: false, error: 'At least one line is required' });
    if (!['CASH', 'CREDIT'].includes(payment_mode)) return res.status(400).json({ ok: false, error: 'payment_mode must be CASH or CREDIT' });
    await client.query('BEGIN');
    const s = await client.query('SELECT name FROM supplier WHERE id = $1 AND company_id = $2', [supplier_id, req.company_id]);
    if (s.rows.length === 0) throw new Error('Supplier not found');
    const supplierName = s.rows[0].name;
    let subtotal = 0;
    for (const l of lines) subtotal += parseInt(l.amount || 0, 10);
    const purchaseNumber = await nextSequence(client, req.company_id, 'purchase');
    const today = purchase_date || new Date().toISOString().slice(0, 10);
    const inv = await client.query(
      `INSERT INTO purchase_invoice (company_id, purchase_number, purchase_date, supplier_id, supplier_name, payment_mode, subtotal, total_amount, supplier_invoice_no, supplier_invoice_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'POSTED') RETURNING *`,
      [req.company_id, purchaseNumber, today, supplier_id, supplierName, payment_mode, subtotal, subtotal, supplier_invoice_no || null, supplier_invoice_date || null]
    );
    const purchase = inv.rows[0];
    for (const l of lines) {
      if (!l.item_id) throw new Error('Line missing item_id');
      const qty = parseInt(l.quantity || 0, 10);
      const baseQtyMilli = parseInt(l.base_qty_milli || qty, 10);
      const rate = parseInt(l.rate || 0, 10);
      await client.query(
        `INSERT INTO purchase_invoice_line (purchase_id, item_id, item_name, unit_id, unit_name, entered_qty, base_qty_milli, quantity, rate, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [purchase.id, l.item_id, l.item_name || '', l.unit_id || null, l.unit_name || null, qty, baseQtyMilli, qty, rate, parseInt(l.amount || 0, 10)]
      );
      await client.query(
        'UPDATE item SET stock_quantity = stock_quantity + $1, cost_price = $2, updated_at = NOW() WHERE id = $3 AND company_id = $4',
        [baseQtyMilli, rate, l.item_id, req.company_id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, purchase });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('create purchase error', err);
    res.status(400).json({ ok: false, error: err.message || 'Failed to create purchase' });
  } finally { client.release(); }
});

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const result = await pool.query('SELECT * FROM purchase_invoice WHERE company_id = $1 ORDER BY id DESC LIMIT $2', [req.company_id, limit]);
    res.json({ ok: true, purchases: result.rows });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Failed to list purchases' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const inv = await pool.query('SELECT * FROM purchase_invoice WHERE id = $1 AND company_id = $2', [id, req.company_id]);
    if (inv.rows.length === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    const lines = await pool.query('SELECT * FROM purchase_invoice_line WHERE purchase_id = $1 ORDER BY id', [id]);
    res.json({ ok: true, purchase: { ...inv.rows[0], lines: lines.rows } });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Failed to fetch purchase' }); }
});

router.post('/:id/cancel', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    await client.query('BEGIN');
    const inv = await client.query("SELECT * FROM purchase_invoice WHERE id = $1 AND company_id = $2 AND status = 'POSTED' FOR UPDATE", [id, req.company_id]);
    if (inv.rows.length === 0) throw new Error('Purchase not found or already cancelled');
    const lines = await client.query('SELECT * FROM purchase_invoice_line WHERE purchase_id = $1', [id]);
    for (const l of lines.rows) {
      await client.query('UPDATE item SET stock_quantity = stock_quantity - $1, updated_at = NOW() WHERE id = $2', [l.base_qty_milli, l.item_id]);
    }
    await client.query("UPDATE purchase_invoice SET status = 'CANCELLED' WHERE id = $1", [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('cancel purchase error', err);
    res.status(400).json({ ok: false, error: err.message || 'Failed to cancel' });
  } finally { client.release(); }
});

export default router;
