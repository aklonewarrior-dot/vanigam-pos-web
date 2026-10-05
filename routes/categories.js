import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany } from '../middleware/companyAuth.js';

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireCompany);

async function nextCode(companyId) {
  const key = `category_${companyId}`;
  const result = await pool.query(
    `INSERT INTO sequence (company_id, key, value) VALUES ($1, $2, 1)
     ON CONFLICT (company_id, key) DO UPDATE SET value = sequence.value + 1
     RETURNING value`,
    [companyId, key]
  );
  return 'CAT-' + String(result.rows[0].value).padStart(4, '0');
}

// POST create
router.post('/', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, error: 'Category name is required' });
    }
    const existing = await pool.query(
      'SELECT id FROM item_category WHERE company_id = $1 AND LOWER(name) = LOWER($2)',
      [req.company_id, String(name).trim()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: 'Category name already exists' });
    }
    const result = await pool.query(
      'INSERT INTO item_category (company_id, name) VALUES ($1, $2) RETURNING *',
      [req.company_id, String(name).trim()]
    );
    res.status(201).json({ ok: true, category: result.rows[0] });
  } catch (err) {
    console.error('create category error', err);
    res.status(500).json({ ok: false, error: 'Failed to create category' });
  }
});

// GET list
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM item_category WHERE company_id = $1 AND status = 'ACTIVE' ORDER BY name",
      [req.company_id]
    );
    res.json({ ok: true, categories: result.rows });
  } catch (err) {
    console.error('list categories error', err);
    res.status(500).json({ ok: false, error: 'Failed to list categories' });
  }
});

// PATCH update
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, error: 'Name is required' });
    }
    const existing = await pool.query(
      'SELECT id FROM item_category WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND id != $3',
      [req.company_id, String(name).trim(), id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: 'Category name already exists' });
    }
    const result = await pool.query(
      'UPDATE item_category SET name = $1 WHERE id = $2 AND company_id = $3 RETURNING *',
      [String(name).trim(), id, req.company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Category not found' });
    }
    res.json({ ok: true, category: result.rows[0] });
  } catch (err) {
    console.error('update category error', err);
    res.status(500).json({ ok: false, error: 'Failed to update category' });
  }
});

// DELETE (soft, or refuse if used)
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const inUse = await pool.query(
      "SELECT COUNT(*) as c FROM item WHERE category_id = $1 AND company_id = $2 AND status = 'ACTIVE'",
      [id, req.company_id]
    );
    if (parseInt(inUse.rows[0].c, 10) > 0) {
      return res.status(409).json({
        ok: false,
        error: `Cannot delete: ${inUse.rows[0].c} active item(s) use this category`
      });
    }
    const result = await pool.query(
      "UPDATE item_category SET status = 'DELETED' WHERE id = $1 AND company_id = $2 AND status = 'ACTIVE' RETURNING id",
      [id, req.company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Category not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('delete category error', err);
    res.status(500).json({ ok: false, error: 'Failed to delete category' });
  }
});

export default router;
