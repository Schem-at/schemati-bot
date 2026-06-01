import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config.js';

export const pool = new Pool({ connectionString: config.database.url });

// A dropped/broken Postgres connection emits 'error' on an idle client. Without a listener
// node-postgres would throw it as an uncaught exception (or it would pass unnoticed). Log it
// loudly instead; the pool recreates connections on the next query.
pool.on('error', (err) => {
  console.error('[db] unexpected error on idle PostgreSQL client:', err.message);
});

export const db = drizzle(pool);

/** Verify the database is reachable. Throws if it is not. Used at startup. */
export async function checkDatabaseConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
