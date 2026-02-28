import {
  FixedTokenAuthProvider,
  EmailPasswordAuthProvider,
  type AuthProvider,
  type LoginResponse,
} from 'monarch-money-ts';
import { MonarchGraphQLClient, getTransactions, getAccounts } from 'monarch-money-ts';
import type { MonarchTransaction } from './types.js';

export interface MonarchClientOptions {
  token?: string;
}

export class MonarchClient {
  private auth: AuthProvider;
  private client: MonarchGraphQLClient;
  private cachedToken: string | null = null;

  constructor(options: MonarchClientOptions = {}) {
    this.client = new MonarchGraphQLClient();

    if (options.token) {
      this.cachedToken = options.token;
      this.auth = new FixedTokenAuthProvider(options.token);
    } else {
      // Create a placeholder auth - will need to set token later
      this.auth = new FixedTokenAuthProvider('');
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

  // Interactive login flow
  async login(email?: string, password?: string): Promise<{ token: string }> {
    if (!email || !password) {
      throw new Error(
        'Email and password required for login. Use: login --email <email> --password <password>'
      );
    }

    const authProvider = new EmailPasswordAuthProvider({
      email,
      password,
      onTokenUpdate: (token) => {
        this.cachedToken = token;
      },
    });

    // Trigger login by getting token
    const token = await authProvider.getToken();
    this.auth = authProvider;
    this.cachedToken = token;

    return { token };
  }

  // Test API connectivity
  async testConnection(): Promise<boolean> {
    try {
      const accounts = await getAccounts(this.auth, this.client);
      return Array.isArray(accounts) && accounts.length >= 0;
    } catch {
      return false;
    }
  }

  // Get accounts summary
  async getAccounts(): Promise<{ accounts: unknown[]; netWorth: number | null }> {
    try {
      const accounts = await getAccounts(this.auth, this.client);
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
      const result = await getTransactions(this.auth, this.client, {
        limit,
        offset,
        orderBy: 'date',
        filters: {
          startDate: startDate || this.getDefaultStartDate(),
          endDate: endDate || this.getDefaultEndDate(),
        },
      });

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
    const date = new Date();
    date.setFullYear(date.getFullYear() - 2);
    return date.toISOString().split('T')[0];
  }

  private getDefaultEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}

// Factory function for convenience
export function createMonarchClient(token?: string): MonarchClient {
  return new MonarchClient({ token });
}
