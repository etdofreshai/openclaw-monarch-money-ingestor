import { Pool, PoolClient } from 'pg';
import type { DbTransaction, SyncState } from './types.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
});

// Initialize database schema
export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        monarch_id TEXT UNIQUE NOT NULL,
        date DATE NOT NULL,
        merchant TEXT,
        category TEXT,
        account TEXT,
        amount NUMERIC(12,2) NOT NULL,
        notes TEXT,
        tags TEXT[],
        is_recurring BOOLEAN DEFAULT FALSE,
        source TEXT DEFAULT 'monarch',
        raw JSONB,
        imported_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create index on monarch_id for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_monarch_id ON transactions(monarch_id)
    `);

    // Create index on date for range queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC)
    `);

    // Create sync_state table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_state (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        last_sync_date TIMESTAMPTZ,
        last_transaction_date DATE,
        total_transactions INTEGER DEFAULT 0,
        last_run_at TIMESTAMPTZ,
        error_message TEXT
      )
    `);

    // Ensure default sync state row exists
    await client.query(`
      INSERT INTO sync_state (key, last_sync_date, last_transaction_date, total_transactions)
      VALUES ('monarch', NULL, NULL, 0)
      ON CONFLICT (key) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('✓ Database schema initialized');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Get sync state
export async function getSyncState(): Promise<SyncState | null> {
  const result = await pool.query<SyncState>(
    `SELECT * FROM sync_state WHERE key = 'monarch'`
  );
  return result.rows[0] || null;
}

// Update sync state
export async function updateSyncState(updates: Partial<SyncState>): Promise<void> {
  const fields: string[] = [];
  const values: (string | number | Date | null)[] = [];
  let paramIndex = 1;

  if (updates.last_sync_date !== undefined) {
    fields.push(`last_sync_date = $${paramIndex++}`);
    values.push(updates.last_sync_date);
  }
  if (updates.last_transaction_date !== undefined) {
    fields.push(`last_transaction_date = $${paramIndex++}`);
    values.push(updates.last_transaction_date);
  }
  if (updates.total_transactions !== undefined) {
    fields.push(`total_transactions = $${paramIndex++}`);
    values.push(updates.total_transactions);
  }
  if (updates.last_run_at !== undefined) {
    fields.push(`last_run_at = $${paramIndex++}`);
    values.push(updates.last_run_at);
  }
  if (updates.error_message !== undefined) {
    fields.push(`error_message = $${paramIndex++}`);
    values.push(updates.error_message);
  }

  if (fields.length === 0) return;

  values.push('monarch');
  await pool.query(
    `UPDATE sync_state SET ${fields.join(', ')} WHERE key = $${paramIndex}`,
    values
  );
}

// Upsert a single transaction
export async function upsertTransaction(txn: DbTransaction): Promise<'inserted' | 'updated' | 'skipped'> {
  const existingResult = await pool.query<{ amount: string; imported_at: Date }>(
    `SELECT amount, imported_at FROM transactions WHERE monarch_id = $1`,
    [txn.monarch_id]
  );

  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0];
    // Check if anything actually changed (compare amount as numbers)
    if (parseFloat(existing.amount) === txn.amount) {
      return 'skipped';
    }

    // Update the transaction
    await pool.query(
      `UPDATE transactions SET
        date = $2, merchant = $3, category = $4, account = $5,
        amount = $6, notes = $7, tags = $8, is_recurring = $9,
        source = $10, raw = $11, imported_at = NOW()
       WHERE monarch_id = $1`,
      [
        txn.monarch_id,
        txn.date,
        txn.merchant,
        txn.category,
        txn.account,
        txn.amount,
        txn.notes,
        txn.tags,
        txn.is_recurring,
        txn.source,
        JSON.stringify(txn.raw),
      ]
    );
    return 'updated';
  }

  // Insert new transaction
  await pool.query(
    `INSERT INTO transactions (
      monarch_id, date, merchant, category, account,
      amount, notes, tags, is_recurring, source, raw
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      txn.monarch_id,
      txn.date,
      txn.merchant,
      txn.category,
      txn.account,
      txn.amount,
      txn.notes,
      txn.tags,
      txn.is_recurring,
      txn.source,
      JSON.stringify(txn.raw),
    ]
  );
  return 'inserted';
}

// Batch upsert transactions for better performance
export async function upsertTransactions(
  txns: DbTransaction[]
): Promise<{ new: number; updated: number; skipped: number }> {
  const result = { new: 0, updated: 0, skipped: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const txn of txns) {
      const existingResult = await client.query<{ amount: string }>(
        `SELECT amount FROM transactions WHERE monarch_id = $1`,
        [txn.monarch_id]
      );

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        if (parseFloat(existing.amount) === txn.amount) {
          result.skipped++;
          continue;
        }

        await client.query(
          `UPDATE transactions SET
            date = $2, merchant = $3, category = $4, account = $5,
            amount = $6, notes = $7, tags = $8, is_recurring = $9,
            source = $10, raw = $11, imported_at = NOW()
           WHERE monarch_id = $1`,
          [
            txn.monarch_id,
            txn.date,
            txn.merchant,
            txn.category,
            txn.account,
            txn.amount,
            txn.notes,
            txn.tags,
            txn.is_recurring,
            txn.source,
            JSON.stringify(txn.raw),
          ]
        );
        result.updated++;
      } else {
        await client.query(
          `INSERT INTO transactions (
            monarch_id, date, merchant, category, account,
            amount, notes, tags, is_recurring, source, raw
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            txn.monarch_id,
            txn.date,
            txn.merchant,
            txn.category,
            txn.account,
            txn.amount,
            txn.notes,
            txn.tags,
            txn.is_recurring,
            txn.source,
            JSON.stringify(txn.raw),
          ]
        );
        result.new++;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return result;
}

// Get total transaction count
export async function getTransactionCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int as count FROM transactions`
  );
  return Number(result.rows[0]?.count) || 0;
}

// Get transaction count for last 30 days
export async function getRecentTransactionCount(days: number = 30): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int as count FROM transactions
     WHERE date >= CURRENT_DATE - INTERVAL '${days} days'`
  );
  return Number(result.rows[0]?.count) || 0;
}

// Get distinct account count from transactions
export async function getAccountCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT account)::int as count FROM transactions WHERE account IS NOT NULL`
  );
  return Number(result.rows[0]?.count) || 0;
}

// Close database connection
export async function closeDb(): Promise<void> {
  await pool.end();
}

export { pool };
