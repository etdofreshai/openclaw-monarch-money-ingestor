// Transaction types from Monarch Money API
export interface MonarchTransaction {
  id: string;
  date: string;
  merchant?: string;
  merchantName?: string;
  category?: { id: string; name: string };
  categoryIcon?: string;
  categoryName?: string;
  account?: { id: string; name: string };
  accountName?: string;
  amount: number;
  originalAmount?: number;
  currency?: string;
  pending?: boolean;
  isRecurring?: boolean;
  isRecurringTransfer?: boolean;
  frequency?: string;
  notes?: string;
  tags?: Array<{ id: string; name: string }>;
  plaidName?: string;
  importer?: string;
  externalId?: string;
  isManual?: boolean;
  updatedAt?: string;
  createdAt?: string;
}

// Status endpoint response
export interface StatusResponse {
  service: string;
  status: 'ok' | 'error' | 'syncing';
  last_sync: string | null;
  accounts_count: number;
  transactions_total: number;
  transactions_last_30_days: number;
  net_worth: number | null;
  last_balance_update: string | null;
  api_reachable: boolean;
  cached_at: string;
  error?: string;
}

// Sync result summary
export interface SyncResult {
  new: number;
  updated: number;
  skipped: number;
  errors: number;
  total_fetched: number;
  sync_type: 'incremental' | 'full';
  started_at: Date;
  completed_at: Date;
  duration_ms: number;
}
