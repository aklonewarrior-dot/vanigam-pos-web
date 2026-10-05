import { pool } from '../db.js';

/**
 * Assumes requireAuth has already populated req.user.
 * Verifies the user is a member of the company in the URL params.
 * Attaches req.company_id.
 */
export async function requireCompany(req, res, next) {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    if (!companyId) {
      return res.status(400).json({ ok: false, error: 'Invalid company id' });
    }

    const result = await pool.query(
      'SELECT 1 FROM user_company WHERE user_id = $1 AND company_id = $2',
      [req.user.user_id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Company not found or access denied' });
    }

    req.company_id = companyId;
    next();
  } catch (err) {
    console.error('requireCompany error', err);
    res.status(500).json({ ok: false, error: 'Company authorization failed' });
  }
}
