import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany } from '../middleware/companyAuth.js';

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireCompany);

// POST
router.post('/', async (req, res) => {
  try {
    const { name, symbol, factor } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, error: 'Unit name is required' });
    }
    if (!symbol || !String(symbol).trim()) {
      return res.status(400).json({ ok: false, error: 'Unit symbol is required' });
    }
    const f = parseInt(factor, 10);
    if (!f || f < 1) {
      return res.status(400).json({ ok: false, error: 'Factor must be a positive integer (1 for pieces, 1000 for kg→g)' });
    }
    const existing = await pool.query(
      'SELECT id FROM unit WHERE company_id = $1 AND LOWER(name) = LOWER($2)',
      [req.company_id, String(name).trim()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: 'Unit name already exists' });
    }
    const result = await pool.query(
      'INSERT INTO unit (company_id, name, symbol, factor) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.company_id, String(name).trim(), String(symbol).trim(), f]
    );
    res.status(201).json({ ok: true, unit: result.rows[0] });
  } catch (err) {
    console.error('create unit error', err);
    res.status(500).json({ ok: false, error: 'Failed to create unit' });
  }
});

// GET list
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM unit WHERE company_id = $1 AND status = 'ACTIVE' ORDER BY name",
      [req.company_id]
    );
    res.json({ ok: true, units: result.rows });
  } catch (err) {
    console.error('list units error', err);
    res.status(500).json({ ok: false, error: 'Failed to list units' });
  }
});

// PATCH
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, symbol, factor } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(String(name).trim()); }
    if (symbol !== undefined) { updates.push(`symbol = $${idx++}`); values.push(String(symbol).trim()); }
    if (factor !== undefined) {
      const f = parseInt(factor, 10);
      if (!f || f < 1) return res.status(400).json({ ok: false, error: 'Invalid factor' });
      updates.push(`factor = $${idx++}`); values.push(f);
    }
    if (updates.length === 0) return res.status(400).json({ ok: false, error: 'No fields to update' });
    values.push(id, req.company_id);
    const result = await pool.query(
      `UPDATE unit SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Unit not found' });
    res.json({ ok: true, unit: result.rows[0] });
  } catch (err) {
    console.error('update unit error', err);
    res.status(500).json({ ok: false, error: 'Failed to update unit' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const inUse = await pool.query(
      "SELECT COUNT(*) as c FROM item WHERE unit_id = $1 AND company_id = $2 AND status = 'ACTIVE'",
      [id, req.company_id]
    );
    if (parseInt(inUse.rows[0].c, 10) > 0) {
      return res.status(409).json({
        ok: false,
        error: `Cannot delete: ${inUse.rows[0].c} active item(s) use this unit`
      });
    }
    const result = await pool.query(
      "UPDATE unit SET status = 'DELETED' WHERE id = $1 AND company_id = $2 AND status = 'ACTIVE' RETURNING id",
      [id, req.company_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Unit not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('delete unit error', err);
    res.status(500).json({ ok: false, error: 'Failed to delete unit' });
  }
});

export default router;
