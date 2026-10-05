import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany } from '../middleware/companyAuth.js';

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireCompany);

async function nextItemCode(companyId) {
  const key = `item_${companyId}`;
  const result = await pool.query(
    `INSERT INTO sequence (company_id, key, value) VALUES ($1, $2, 1)
     ON CONFLICT (company_id, key) DO UPDATE SET value = sequence.value + 1
     RETURNING value`,
    [companyId, key]
  );
  return 'ITEM-' + String(result.rows[0].value).padStart(4, '0');
}

// POST create
router.post('/', async (req, res) => {
  try {
    const {
      name, code, unit_id, category_id, brand,
      cost_price, selling_price, mrp,
      stock_quantity, reorder_level, reorder_quantity, description,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, error: 'Item name is required' });
    }
    if (!unit_id) {
      return res.status(400).json({ ok: false, error: 'unit_id is required' });
    }

    let finalCode = code ? String(code).trim() : await nextItemCode(req.company_id);

    const result = await pool.query(
      `INSERT INTO item (company_id, name, code, unit_id, category_id, brand,
                         cost_price, selling_price, mrp, stock_quantity,
                         reorder_level, reorder_quantity, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.company_id,
        String(name).trim(),
        finalCode,
        parseInt(unit_id, 10),
        category_id ? parseInt(category_id, 10) : null,
        brand ? String(brand).trim() : null,
        parseInt(cost_price || 0, 10),
        parseInt(selling_price || 0, 10),
        parseInt(mrp || 0, 10),
        parseInt(stock_quantity || 0, 10),
        parseInt(reorder_level || 0, 10),
        parseInt(reorder_quantity || 0, 10),
        description ? String(description).trim() : null,
      ]
    );
    res.status(201).json({ ok: true, item: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Item code already exists' });
    }
    console.error('create item error', err);
    res.status(500).json({ ok: false, error: 'Failed to create item' });
  }
});

// GET list
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, c.name as category_name, u.name as unit_name, u.symbol as unit_symbol
       FROM item i
       LEFT JOIN item_category c ON c.id = i.category_id
       LEFT JOIN unit u ON u.id = i.unit_id
       WHERE i.company_id = $1 AND i.status = 'ACTIVE'
       ORDER BY i.name`,
      [req.company_id]
    );
    res.json({ ok: true, items: result.rows });
  } catch (err) {
    console.error('list items error', err);
    res.status(500).json({ ok: false, error: 'Failed to list items' });
  }
});

// GET search
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ ok: true, items: [] });
    const result = await pool.query(
      `SELECT i.*, c.name as category_name, u.name as unit_name, u.symbol as unit_symbol
       FROM item i
       LEFT JOIN item_category c ON c.id = i.category_id
       LEFT JOIN unit u ON u.id = i.unit_id
       WHERE i.company_id = $1 AND i.status = 'ACTIVE'
         AND (LOWER(i.name) LIKE LOWER($2) OR LOWER(i.code) LIKE LOWER($2) OR LOWER(i.brand) LIKE LOWER($2))
       ORDER BY i.name LIMIT 30`,
      [req.company_id, '%' + q + '%']
    );
    res.json({ ok: true, items: result.rows });
  } catch (err) {
    console.error('search items error', err);
    res.status(500).json({ ok: false, error: 'Failed to search items' });
  }
});

// GET one
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const result = await pool.query(
      `SELECT i.*, c.name as category_name, u.name as unit_name, u.symbol as unit_symbol
       FROM item i
       LEFT JOIN item_category c ON c.id = i.category_id
       LEFT JOIN unit u ON u.id = i.unit_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [id, req.company_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Item not found' });
    res.json({ ok: true, item: result.rows[0] });
  } catch (err) {
    console.error('get item error', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch item' });
  }
});

// PATCH
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const allowed = ['name','code','unit_id','category_id','brand','cost_price','selling_price','mrp','stock_quantity','reorder_level','reorder_quantity','description'];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        values.push(req.body[field]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ ok: false, error: 'No fields to update' });
    updates.push(`updated_at = NOW()`);
    values.push(id, req.company_id);
    const result = await pool.query(
      `UPDATE item SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Item not found' });
    res.json({ ok: true, item: result.rows[0] });
  } catch (err) {
    console.error('update item error', err);
    res.status(500).json({ ok: false, error: 'Failed to update item' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const inUse = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM sales_invoice_line WHERE item_id = $1) +
        (SELECT COUNT(*) FROM purchase_invoice_line WHERE item_id = $1) as c`,
      [id]
    );
    if (parseInt(inUse.rows[0].c, 10) > 0) {
      return res.status(409).json({
        ok: false,
        error: `Cannot delete: item appears on ${inUse.rows[0].c} transaction(s)`
      });
    }
    const result = await pool.query(
      "UPDATE item SET status = 'DELETED' WHERE id = $1 AND company_id = $2 AND status = 'ACTIVE' RETURNING id",
      [id, req.company_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('delete item error', err);
    res.status(500).json({ ok: false, error: 'Failed to delete item' });
  }
});

export default router;
