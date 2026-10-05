import fs from 'fs';
import path from 'path';
import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;

// Strip BOM and normalize line endings
function cleanSql(raw) {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

async function runMigrations() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to database.');

  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration file(s).`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = cleanSql(fs.readFileSync(filePath, 'utf8'));
    console.log(`\nRunning: ${file}`);
    try {
      const result = await client.query(sql);
      if (Array.isArray(result)) {
        const last = result[result.length - 1];
        if (last && last.rows && last.rows.length > 0) {
          console.log('Tables created:');
          for (const row of last.rows) {
            console.log('  -', row.tablename);
          }
        }
      }
      console.log(`  OK`);
    } catch (err) {
      console.error(`  FAILED:`, err.message);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log('\nAll migrations applied successfully.');
}

runMigrations().catch((err) => {
  console.error('Migration runner error:', err);
  process.exit(1);
});
