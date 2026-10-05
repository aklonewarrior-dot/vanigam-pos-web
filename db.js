import pg from 'pg';
import 'dotenv/config';

// Parse BIGINT (OID 20) as JS number.
// Safe up to 2^53 (9 quadrillion), which is way beyond any realistic rupee/paise value.
pg.types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
