import {
  FixedTokenAuthProvider,
  type AuthProvider,
  type LoginResponse,
  buildAuthHeaders,
} from 'monarch-money-ts';
import { MonarchGraphQLClient, getTransactions, getAccounts } from 'monarch-money-ts';
import { GraphQLClient } from 'graphql-request';
import type { MonarchTransaction } from './types.js';

// Monarch has migrated from api.monarchmoney.com to api.monarch.com
const MONARCH_API_BASE = 'https://api.monarch.com';
const MONARCH_GRAPHQL_ENDPOINT = `${MONARCH_API_BASE}/graphql`;
const MONARCH_LOGIN_ENDPOINT = `${MONARCH_API_BASE}/auth/login/`;

const MONARCH_EXTRA_HEADERS: Record<string, string> = {
  'Monarch-Client': 'monarch-core-web-app-graphql',
  'Monarch-Client-Version': 'v1.0.1772',
  'Origin': 'https://app.monarch.com',
};

// Subclass to inject required Monarch headers that the library doesn't send
class PatchedMonarchGraphQLClient extends MonarchGraphQLClient {
  constructor(endpoint: string) {
    super(endpoint);
    // Override the internal graphql-request client with extra default headers
    (this as any).client = new GraphQLClient(endpoint, {
      headers: MONARCH_EXTRA_HEADERS,
    });
  }
}

export interface MonarchClientOptions {
  token?: string;
}

export class MonarchClient {
  private auth: AuthProvider;
  private client: MonarchGraphQLClient;
  private cachedToken: string | null = null;

  constructor(options: MonarchClientOptions = {}) {
    // Use new api.monarch.com endpoint with required Monarch headers
    this.client = new PatchedMonarchGraphQLClient(MONARCH_GRAPHQL_ENDPOINT);

    if (options.token) {
      this.cachedToken = options.token;
      this.auth = new FixedTokenAuthProvider(options.token);
    } else {
      // Leave auth unset - will be set by login() or setToken()
      this.auth = null as unknown as AuthProvider;
    }
  }

  // Set authentication token
  setToken(token: string): void {
    this.cachedToken = token;
    this.auth = new FixedTokenAuthProvider(token);
  }

  // Check if authenticated
  isAuthenticated(): boolean {
    return this.cachedToken !== null;
  }

  // Login flow using new api.monarch.com endpoint
  // Supports optional MFA code (6-digit TOTP from authenticator app)
  async login(email?: string, password?: string, mfaCode?: string): Promise<{ token: string }> {
    if (!email || !password) {
      throw new Error(
        'Email and password required for login. Use: login --email <email> --password <password>'
      );
    }

    const body: Record<string, unknown> = {
      username: email,
      password: password,
      supports_mfa: true,
      trusted_device: false,
    };

    if (mfaCode) {
      body.totp = mfaCode;
    }

    const response = await fetch(MONARCH_LOGIN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Client-Platform': 'web',
        'Monarch-Client': 'monarch-core-web-app-rest',
        'Monarch-Client-Version': 'v1.0.1772',
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();

    if (response.status === 403) {
      throw new Error('MFA_REQUIRED');
    }

    if (!response.ok) {
      throw new Error(`Login failed: HTTP ${response.status} ${response.statusText} - ${raw}`);
    }

    const data = JSON.parse(raw);
    const token = data.token;

    if (!token) {
      throw new Error('Login response did not contain a token');
    }

    this.cachedToken = token;
    this.auth = new FixedTokenAuthProvider(token);

    return { token };
  }

  // Re-login using env credentials, update token in .env
  private async refreshToken(): Promise<boolean> {
    const email = process.env.MONARCH_EMAIL;
    const password = process.env.MONARCH_PASSWORD;
    if (!email || !password) {
      console.error('Cannot refresh token: MONARCH_EMAIL and MONARCH_PASSWORD not set in .env');
      return false;
    }
    try {
      console.log('Token expired, re-authenticating...');
      const { token } = await this.login(email, password);
      // Update .env file with new token
      const fs = await import('fs');
      const path = await import('path');
      const envPath = path.default.resolve(process.cwd(), '.env');
      if (fs.default.existsSync(envPath)) {
        let envContent = fs.default.readFileSync(envPath, 'utf-8');
        envContent = envContent.replace(/^MONARCH_TOKEN=.*/m, `MONARCH_TOKEN=${token}`);
        fs.default.writeFileSync(envPath, envContent);
      }
      process.env.MONARCH_TOKEN = token;
      console.log('Re-authenticated successfully, token updated in .env');
      return true;
    } catch (err) {
      console.error('Re-authentication failed:', err);
      return false;
    }
  }

  // Wrapper that retries once on auth failure
  private async withAutoRefresh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      const isAuthErr = msg.includes('unauthoriz') || msg.includes('forbidden') || msg.includes('401') || msg.includes('403');
      if (isAuthErr && process.env.MONARCH_EMAIL && process.env.MONARCH_PASSWORD) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          return await fn();
        }
      }
      throw err;
    }
  }

  // Test API connectivity
  async testConnection(): Promise<boolean> {
    try {
      const accounts = await this.withAutoRefresh(() => getAccounts(this.auth, this.client));
      return Array.isArray(accounts) && accounts.length >= 0;
    } catch {
      return false;
    }
  }

  // Get accounts summary
  async getAccounts(): Promise<{ accounts: unknown[]; netWorth: number | null }> {
    try {
      const accounts = await this.withAutoRefresh(() => getAccounts(this.auth, this.client));
      return {
        accounts: accounts || [],
        netWorth: null, // Would need separate call for net worth
      };
    } catch {
      return { accounts: [], netWorth: null };
    }
  }

  // Fetch transactions with pagination
  async getTransactions(options: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<MonarchTransaction[]> {
    const { limit = 100, offset = 0, startDate, endDate } = options;

    try {
      const result = await this.withAutoRefresh(() => getTransactions(this.auth, this.client, {
        limit,
        offset,
        orderBy: 'date',
        filters: {
          startDate: startDate || this.getDefaultStartDate(),
          endDate: endDate || this.getDefaultEndDate(),
        },
      }));

      return (result.transactions || []).map(this.normalizeTransaction);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      throw error;
    }
  }

  // Fetch all transactions (handles pagination automatically)
  async getAllTransactions(options: {
    startDate?: string;
    endDate?: string;
    onProgress?: (fetched: number, total?: number) => void;
  } = {}): Promise<MonarchTransaction[]> {
    const allTransactions: MonarchTransaction[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const batch = await this.getTransactions({
        limit,
        offset,
        startDate: options.startDate,
        endDate: options.endDate,
      });

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      allTransactions.push(...batch);

      if (options.onProgress) {
        options.onProgress(allTransactions.length);
      }

      // If we got fewer than requested, we've reached the end
      if (batch.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    return allTransactions;
  }

  // Normalize transaction from monarch-money-ts format
  private normalizeTransaction = (txn: Record<string, unknown>): MonarchTransaction => {
    // Extract merchant name from nested merchant object
    const merchant = txn.merchant && typeof txn.merchant === 'object'
      ? (txn.merchant as Record<string, unknown>)?.name
      : txn.merchant;

    // Extract category from nested category object
    const categoryObj = txn.category && typeof txn.category === 'object'
      ? txn.category as Record<string, unknown>
      : null;

    // Extract account from nested account object
    const accountObj = txn.account && typeof txn.account === 'object'
      ? txn.account as Record<string, unknown>
      : null;

    return {
      id: String(txn.id || ''),
      date: String(txn.date || ''),
      merchant: merchant as string | undefined,
      merchantName: merchant as string | undefined,
      category: categoryObj ? {
        id: String(categoryObj.id || ''),
        name: String(categoryObj.name || ''),
      } : undefined,
      categoryName: categoryObj?.name as string | undefined,
      account: accountObj ? {
        id: String(accountObj.id || ''),
        name: String(accountObj.name || ''),
      } : undefined,
      accountName: accountObj?.name as string | undefined,
      amount: typeof txn.amount === 'number' ? txn.amount : parseFloat(String(txn.amount || 0)),
      currency: txn.currency as string | undefined,
      pending: txn.pending as boolean | undefined,
      isRecurring: txn.isRecurring as boolean | undefined,
      frequency: txn.frequency as string | undefined,
      notes: txn.notes as string | undefined,
      tags: Array.isArray(txn.tags) ? txn.tags : [],
      plaidName: txn.plaidName as string | undefined,
      importer: txn.importer as string | undefined,
      isManual: txn.isManual as boolean | undefined,
      updatedAt: txn.updatedAt as string | undefined,
      createdAt: txn.createdAt as string | undefined,
    };
  };

  private getDefaultStartDate(): string {
    // Fetch all historical data (Monarch accounts may have data back to 2008+)
    return '2000-01-01';
  }

  private getDefaultEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}

// Factory function for convenience
export function createMonarchClient(token?: string): MonarchClient {
  return new MonarchClient({ token });
}
