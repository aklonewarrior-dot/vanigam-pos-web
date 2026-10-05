import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

function publicCompany(row) {
  return {
    id: row.id,
    name: row.name,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    phone: row.phone,
    email: row.email,
    gstin: row.gstin,
    created_at: row.created_at,
  };
}

// ---------- POST /api/companies ----------
// Create a new company and link current user to it
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, address_line1, address_line2, phone, email, gstin } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, error: 'Company name is required' });
    }

    await client.query('BEGIN');

    const companyResult = await client.query(
      'INSERT INTO company (name, address_line1, address_line2, phone, email, gstin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [
        String(name).trim(),
        address_line1 ? String(address_line1).trim() : null,
        address_line2 ? String(address_line2).trim() : null,
        phone ? String(phone).trim() : null,
        email ? String(email).trim() : null,
        gstin ? String(gstin).trim() : null,
      ]
    );

    const company = companyResult.rows[0];

    await client.query(
      'INSERT INTO user_company (user_id, company_id) VALUES ($1, $2)',
      [req.user.user_id, company.id]
    );

    await client.query('COMMIT');

    res.status(201).json({ ok: true, company: publicCompany(company) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('create company error', err);
    res.status(500).json({ ok: false, error: 'Failed to create company' });
  } finally {
    client.release();
  }
});

// ---------- GET /api/companies ----------
// List companies current user is linked to
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.* FROM company c
       JOIN user_company uc ON uc.company_id = c.id
       WHERE uc.user_id = $1
       ORDER BY c.id`,
      [req.user.user_id]
    );

    res.json({ ok: true, companies: result.rows.map(publicCompany) });
  } catch (err) {
    console.error('list companies error', err);
    res.status(500).json({ ok: false, error: 'Failed to list companies' });
  }
});

// ---------- GET /api/companies/:id ----------
router.get('/:id', async (req, res) => {
  try {
    const companyId = parseInt(req.params.id, 10);
    if (!companyId) return res.status(400).json({ ok: false, error: 'Invalid company id' });

    const link = await pool.query(
      'SELECT 1 FROM user_company WHERE user_id = $1 AND company_id = $2',
      [req.user.user_id, companyId]
    );
    if (link.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    const result = await pool.query('SELECT * FROM company WHERE id = $1', [companyId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    res.json({ ok: true, company: publicCompany(result.rows[0]) });
  } catch (err) {
    console.error('get company error', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch company' });
  }
});

// ---------- PATCH /api/companies/:id ----------
router.patch('/:id', async (req, res) => {
  try {
    const companyId = parseInt(req.params.id, 10);
    if (!companyId) return res.status(400).json({ ok: false, error: 'Invalid company id' });

    const link = await pool.query(
      'SELECT 1 FROM user_company WHERE user_id = $1 AND company_id = $2',
      [req.user.user_id, companyId]
    );
    if (link.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    const allowed = ['name', 'address_line1', 'address_line2', 'phone', 'email', 'gstin', 'printer_name', 'printer_name_a4'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx}`);
        values.push(req.body[field]);
        idx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(companyId);

    const result = await pool.query(
      `UPDATE company SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json({ ok: true, company: publicCompany(result.rows[0]) });
  } catch (err) {
    console.error('update company error', err);
    res.status(500).json({ ok: false, error: 'Failed to update company' });
  }
});

export default router;
