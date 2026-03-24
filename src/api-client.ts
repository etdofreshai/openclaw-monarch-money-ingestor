// HTTP client for the memory-database-api

export interface ApiTransaction {
  external_id: string;
  source: string;
  date: string;
  merchant: string | null;
  category: string | null;
  account_name: string | null;
  amount: number;
  notes: string | null;
  tags: string[];
  metadata: object;
}

export interface BatchUpsertResult {
  results: { new: number; updated: number; skipped: number };
}

export interface SyncStateResponse {
  key: string;
  source: string;
  last_sync_date: string | null;
  last_record_date: string | null;
  total_records: number;
  last_run_at: string | null;
  error_message: string | null;
  metadata: object;
}

export interface TransactionStats {
  total: number;
  recent_30d: number;
  distinct_accounts: number;
  distinct_categories: number;
  date_range: { earliest: string | null; latest: string | null };
}

export class MemoryDatabaseApiClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/api/health');
      return true;
    } catch {
      return false;
    }
  }

  async batchUpsertTransactions(transactions: ApiTransaction[]): Promise<BatchUpsertResult> {
    return this.request('/api/transactions/batch', {
      method: 'POST',
      body: JSON.stringify({ transactions }),
    });
  }

  async getSyncState(key: string): Promise<SyncStateResponse | null> {
    try {
      return await this.request(`/api/sync-state/${encodeURIComponent(key)}`);
    } catch (err: any) {
      if (err.message.includes('404')) return null;
      throw err;
    }
  }

  async updateSyncState(key: string, data: Partial<SyncStateResponse> & { source: string }): Promise<SyncStateResponse> {
    return this.request(`/api/sync-state/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getTransactionStats(): Promise<TransactionStats> {
    return this.request('/api/transactions/summary');
  }
}

export function createApiClient(): MemoryDatabaseApiClient {
  const baseUrl = process.env.MEMORY_DATABASE_API_URL;
  const token = process.env.MEMORY_DATABASE_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('MEMORY_DATABASE_API_URL and MEMORY_DATABASE_API_TOKEN must be set in .env');
  }
  return new MemoryDatabaseApiClient(baseUrl, token);
}
