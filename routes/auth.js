import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const TOKEN_DAYS = 7;

function signToken(user) {
  return jwt.sign(
    { user_id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: `${TOKEN_DAYS}d` }
  );
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
  };
}

// ---------- POST /api/auth/signup ----------
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};

    if (!email || !password || !name) {
      return res.status(400).json({ ok: false, error: 'email, password and name are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await pool.query('SELECT id FROM app_user WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    const result = await pool.query(
      'INSERT INTO app_user (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, status, created_at',
      [normalizedEmail, hash, String(name).trim()]
    );

    const user = result.rows[0];
    const token = signToken(user);

    res.status(201).json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error('signup error', err);
    res.status(500).json({ ok: false, error: 'Signup failed' });
  }
});

// ---------- POST /api/auth/login ----------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const result = await pool.query('SELECT * FROM app_user WHERE email = $1', [normalizedEmail]);

    if (result.rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ ok: false, error: 'Account is ' + user.status });
    }

    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const token = signToken(user);

    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ ok: false, error: 'Login failed' });
  }
});

// ---------- GET /api/auth/me ----------
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, status, created_at FROM app_user WHERE id = $1',
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    res.json({ ok: true, user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error('me error', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch user' });
  }
});

export default router;
