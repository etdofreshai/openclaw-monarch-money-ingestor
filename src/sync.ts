import {
  initDb,
  upsertTransactions,
  getSyncState,
  updateSyncState,
  getTransactionCount,
  getRecentTransactionCount,
  getAccountCount,
  closeDb,
} from './db.js';
import { createMonarchClient } from './monarch-client.js';
import type { MonarchTransaction, DbTransaction, SyncResult, StatusResponse } from './types.js';

export interface SyncOptions {
  full?: boolean;
  token?: string;
  onProgress?: (message: string) => void;
}

// Convert Monarch transaction to database format
function toDbTransaction(txn: MonarchTransaction): DbTransaction {
  return {
    monarch_id: txn.id,
    date: new Date(txn.date),
    merchant: txn.merchant || txn.merchantName || null,
    category: txn.category?.name || txn.categoryName || null,
    account: txn.account?.name || txn.accountName || null,
    amount: txn.amount,
    notes: txn.notes || null,
    tags: Array.isArray(txn.tags)
      ? txn.tags.map((t) => (typeof t === 'string' ? t : t.name || ''))
      : [],
    is_recurring: txn.isRecurring || false,
    source: 'monarch',
    raw: txn,
  };
}

// Get the latest transaction date from a list
function getLatestDate(txns: MonarchTransaction[]): Date | null {
  if (txns.length === 0) return null;

  return txns.reduce((latest, txn) => {
    const txnDate = new Date(txn.date);
    return txnDate > latest ? txnDate : latest;
  }, new Date(txns[0].date));
}

// Run sync
export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const started_at = new Date();
  const { full = false, token, onProgress } = options;

  const log = (msg: string) => {
    console.log(msg);
    onProgress?.(msg);
  };

  log(`Starting ${full ? 'full' : 'incremental'} sync...`);

  // Initialize database
  await initDb();

  // Get current sync state
  const syncState = await getSyncState();
  const lastTransactionDate = syncState?.last_transaction_date;

  // Determine date range for fetch
  let startDate: string | undefined;
  if (!full && lastTransactionDate) {
    // Fetch from last transaction date - 7 days (to catch updates)
    const bufferDate = new Date(lastTransactionDate);
    bufferDate.setDate(bufferDate.getDate() - 7);
    startDate = bufferDate.toISOString().split('T')[0];
    log(`Incremental sync from ${startDate}`);
  } else {
    log('Full sync - fetching all transactions');
  }

  // Create Monarch client
  const monarchToken = token || process.env.MONARCH_TOKEN;
  if (!monarchToken) {
    throw new Error('MONARCH_TOKEN not configured. Run `npm run login` first.');
  }

  const client = createMonarchClient(monarchToken);

  // Test connection
  const isConnected = await client.testConnection();
  if (!isConnected) {
    throw new Error('Failed to connect to Monarch Money API. Token may be expired.');
  }
  log('✓ Connected to Monarch Money API');

  // Fetch transactions
  const startTime = Date.now();
  let fetchCount = 0;
  const transactions = await client.getAllTransactions({
    startDate,
    onProgress: (count) => {
      fetchCount = count;
      if (count % 500 === 0) {
        log(`Fetched ${count} transactions...`);
      }
    },
  });

  log(`Fetched ${transactions.length} transactions in ${Date.now() - startTime}ms`);

  // Convert to database format
  const dbTransactions = transactions.map(toDbTransaction);

  // Upsert transactions
  log('Upserting transactions...');
  const upsertResult = await upsertTransactions(dbTransactions);

  // Update sync state
  const latestDate = getLatestDate(transactions);
  const totalCount = await getTransactionCount();

  await updateSyncState({
    last_sync_date: new Date(),
    last_transaction_date: latestDate || undefined,
    total_transactions: totalCount,
    last_run_at: new Date(),
    error_message: null,
  });

  const completed_at = new Date();
  const result: SyncResult = {
    new: upsertResult.new,
    updated: upsertResult.updated,
    skipped: upsertResult.skipped,
    errors: 0,
    total_fetched: transactions.length,
    sync_type: full ? 'full' : 'incremental',
    started_at,
    completed_at,
    duration_ms: completed_at.getTime() - started_at.getTime(),
  };

  log('');
  log('=== Sync Summary ===');
  log(`  New:       ${result.new}`);
  log(`  Updated:   ${result.updated}`);
  log(`  Skipped:   ${result.skipped}`);
  log(`  Fetched:   ${result.total_fetched}`);
  log(`  Duration:  ${result.duration_ms}ms`);
  log('===================');

  return result;
}

// Cache timestamp for tracking
let cacheTimestamp: Date | null = null;

// Get status for API endpoint
export async function getStatus(useCache: boolean = false): Promise<StatusResponse> {
  // Check if we have a cached status (simple in-memory cache)
  if (useCache && statusCache && cacheTimestamp && Date.now() - cacheTimestamp.getTime() < 5 * 60 * 1000) {
    return statusCache;
  }

  await initDb();

  const syncState = await getSyncState();
  const transactionsTotal = await getTransactionCount();
  const transactionsLast30Days = await getRecentTransactionCount(30);
  const accountsCount = await getAccountCount();

  // Test API connectivity
  let apiReachable = false;
  const token = process.env.MONARCH_TOKEN;
  if (token) {
    try {
      const client = createMonarchClient(token);
      apiReachable = await client.testConnection();
    } catch {
      apiReachable = false;
    }
  }

  const status: StatusResponse = {
    service: 'monarch-money',
    status: syncState?.error_message ? 'error' : 'ok',
    last_sync: syncState?.last_sync_date?.toISOString() || null,
    accounts_count: accountsCount,
    transactions_total: transactionsTotal,
    transactions_last_30_days: transactionsLast30Days,
    net_worth: null, // Would require additional API call
    last_balance_update: null,
    api_reachable: apiReachable,
    cached_at: new Date().toISOString(),
    error: syncState?.error_message || undefined,
  };

  statusCache = status;
  cacheTimestamp = new Date();

  return status;
}

// Simple in-memory cache
let statusCache: StatusResponse | null = null;

// Clear cache
export function clearStatusCache(): void {
  statusCache = null;
  cacheTimestamp = null;
}
