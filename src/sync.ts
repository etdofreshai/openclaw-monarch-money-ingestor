import { createApiClient, type ApiTransaction } from './api-client.js';
import { createMonarchClient } from './monarch-client.js';
import type { MonarchTransaction, SyncResult, StatusResponse } from './types.js';

export interface SyncOptions {
  full?: boolean;
  token?: string;
  onProgress?: (message: string) => void;
}

// Convert Monarch transaction to API format
function toApiTransaction(txn: MonarchTransaction): ApiTransaction {
  return {
    external_id: txn.id,
    source: 'monarch',
    date: new Date(txn.date).toISOString().split('T')[0],
    merchant: txn.merchant || txn.merchantName || null,
    category: txn.category?.name || txn.categoryName || null,
    account_name: txn.account?.name || txn.accountName || null,
    amount: txn.amount,
    notes: txn.notes || null,
    tags: Array.isArray(txn.tags)
      ? txn.tags.map((t) => (typeof t === 'string' ? t : t.name || ''))
      : [],
    metadata: txn,
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

  // Initialize API client
  const apiClient = createApiClient();

  // Get current sync state
  const syncState = await apiClient.getSyncState('monarch');
  const lastRecordDate = syncState?.last_record_date;

  // Determine date range for fetch
  let startDate: string | undefined;
  if (!full && lastRecordDate) {
    const bufferDate = new Date(lastRecordDate);
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

  const isConnected = await client.testConnection();
  if (!isConnected) {
    throw new Error('Failed to connect to Monarch Money API. Token may be expired.');
  }
  log('✓ Connected to Monarch Money API');

  // Fetch transactions
  const startTime = Date.now();
  const transactions = await client.getAllTransactions({
    startDate,
    onProgress: (count) => {
      if (count % 500 === 0) {
        log(`Fetched ${count} transactions...`);
      }
    },
  });

  log(`Fetched ${transactions.length} transactions in ${Date.now() - startTime}ms`);

  // Convert and batch upsert
  const apiTransactions = transactions.map(toApiTransaction);
  log('Upserting transactions...');

  const BATCH_SIZE = 200;
  let totalNew = 0, totalUpdated = 0, totalSkipped = 0;

  for (let i = 0; i < apiTransactions.length; i += BATCH_SIZE) {
    const chunk = apiTransactions.slice(i, i + BATCH_SIZE);
    const result = await apiClient.batchUpsertTransactions(chunk);
    totalNew += result.results.new;
    totalUpdated += result.results.updated;
    totalSkipped += result.results.skipped;

    if (apiTransactions.length > BATCH_SIZE) {
      log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(apiTransactions.length / BATCH_SIZE)}: +${result.results.new} ~${result.results.updated} =${result.results.skipped}`);
    }
  }

  // Update sync state
  const latestDate = getLatestDate(transactions);
  const stats = await apiClient.getTransactionStats();

  await apiClient.updateSyncState('monarch', {
    source: 'monarch',
    last_sync_date: new Date().toISOString(),
    last_record_date: latestDate?.toISOString().split('T')[0] || null,
    total_records: stats.total,
    last_run_at: new Date().toISOString(),
    error_message: null,
    metadata: {},
  });

  const completed_at = new Date();
  const result: SyncResult = {
    new: totalNew,
    updated: totalUpdated,
    skipped: totalSkipped,
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

// Cache
let statusCache: StatusResponse | null = null;
let cacheTimestamp: Date | null = null;

// Get status for API endpoint
export async function getStatus(useCache: boolean = false): Promise<StatusResponse> {
  if (useCache && statusCache && cacheTimestamp && Date.now() - cacheTimestamp.getTime() < 5 * 60 * 1000) {
    return statusCache;
  }

  const apiClient = createApiClient();
  const syncState = await apiClient.getSyncState('monarch');
  const stats = await apiClient.getTransactionStats();

  // Test Monarch API connectivity
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
    last_sync: syncState?.last_sync_date || null,
    accounts_count: stats.distinct_accounts,
    transactions_total: stats.total,
    transactions_last_30_days: stats.recent_30d,
    net_worth: null,
    last_balance_update: null,
    api_reachable: apiReachable,
    cached_at: new Date().toISOString(),
    error: syncState?.error_message || undefined,
  };

  statusCache = status;
  cacheTimestamp = new Date();

  return status;
}

export function clearStatusCache(): void {
  statusCache = null;
  cacheTimestamp = null;
}
