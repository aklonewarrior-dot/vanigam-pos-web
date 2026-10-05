import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany } from '../middleware/companyAuth.js';

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireCompany);

router.post('/', async (req, res) => {
  try {
    const { name, phone, email, address, opening_balance } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: 'Supplier name is required' });
    const result = await pool.query(
      `INSERT INTO supplier (company_id, name, phone, email, address, opening_balance) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.company_id, String(name).trim(), phone ? String(phone).trim() : null, email ? String(email).trim() : null, address ? String(address).trim() : null, parseInt(opening_balance || 0, 10)]
    );
    res.status(201).json({ ok: true, supplier: result.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Failed to create supplier' }); }
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM supplier WHERE company_id = $1 AND status = 'ACTIVE' ORDER BY name", [req.company_id]);
    res.json({ ok: true, suppliers: result.rows });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Failed to list suppliers' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const result = await pool.query('SELECT * FROM supplier WHERE id = $1 AND company_id = $2', [id, req.company_id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, supplier: result.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Failed to fetch supplier' }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const allowed = ['name','phone','email','address','opening_balance'];
    const updates = []; const values = []; let idx = 1;
    for (const f of allowed) if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); }
    if (updates.length === 0) return res.status(400).json({ ok: false, error: 'No fields' });
    updates.push('updated_at = NOW()');
    values.push(id, req.company_id);
    const result = await pool.query(`UPDATE supplier SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`, values);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, supplier: result.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Failed to update supplier' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const inUse = await pool.query('SELECT COUNT(*) as c FROM purchase_invoice WHERE supplier_id = $1', [id]);
    if (parseInt(inUse.rows[0].c, 10) > 0) return res.status(409).json({ ok: false, error: `Cannot delete: ${inUse.rows[0].c} purchase(s) reference this supplier` });
    const result = await pool.query("UPDATE supplier SET status = 'DELETED' WHERE id = $1 AND company_id = $2 AND status = 'ACTIVE' RETURNING id", [id, req.company_id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ ok: false, error: 'Failed to delete supplier' }); }
});

export default router;
