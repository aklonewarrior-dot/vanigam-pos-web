import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { pool } from './db.js';
import authRoutes from './routes/auth.js';
import companiesRoutes from './routes/companies.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as now, version() as version');
    res.json({
      ok: true,
      db: 'connected',
      time: result.rows[0].now,
      postgres: result.rows[0].version.split(' ').slice(0, 2).join(' '),
    });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ name: 'Vanigam POS API', version: '0.1.0', status: 'running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/companies', companiesRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vanigam POS API listening on http://localhost:${PORT}`);
});
