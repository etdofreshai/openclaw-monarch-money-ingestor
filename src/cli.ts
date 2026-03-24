import 'dotenv/config';
import { Command } from 'commander';
import { runSync } from './sync.js';
import { startServer } from './server.js';
import { createMonarchClient } from './monarch-client.js';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const program = new Command();

program
  .name('monarch-ingestor')
  .description('Ingest Monarch Money transactions into OpenClaw database')
  .version('1.0.0');

// Sync command (default)
program
  .command('sync', { isDefault: true })
  .description('Sync transactions from Monarch Money to database')
  .option('--full', 'Force full sync instead of incremental', false)
  .option('--token <token>', 'Monarch API token (overrides env)')
  .action(async (options) => {
    try {
      await runSync({
        full: options.full,
        token: options.token,
      });
      process.exit(0);
    } catch (error) {
      console.error('Sync failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Login command
program
  .command('login')
  .description('Login to Monarch Money and save token')
  .option('--email <email>', 'Monarch Money email')
  .option('--password <password>', 'Monarch Money password')
  .option('--mfa-code <code>', 'MFA/TOTP code from authenticator app')
  .option('--output <file>', 'Output file for token', '.env')
  .action(async (options) => {
    try {
      if (!options.email || !options.password) {
        console.log('');
        console.log('=== Monarch Money Login ===');
        console.log('');
        console.log('You need to provide your Monarch Money credentials to get an API token.');
        console.log('');
        console.log('Usage:');
        console.log('  npm run dev:login -- --email your@email.com --password yourpassword');
        console.log('  npm run dev:login -- --email your@email.com --password yourpassword --mfa-code 123456');
        console.log('');
        console.log('If MFA is enabled, you will be prompted for a code from your authenticator app.');
        console.log('After login, your token will be saved to .env file.');
        process.exit(1);
      }

      console.log('Logging in to Monarch Money...');
      const client = createMonarchClient();

      let token: string;
      try {
        ({ token } = await client.login(options.email, options.password, options.mfaCode));
      } catch (error) {
        if (error instanceof Error && error.message === 'MFA_REQUIRED') {
          console.log('MFA is required for this account.');
          const mfaCode = options.mfaCode || await promptUser('Enter your 6-digit MFA code: ');
          ({ token } = await client.login(options.email, options.password, mfaCode));
        } else {
          throw error;
        }
      }

      // Read existing .env if it exists
      const envPath = path.resolve(options.output);
      let envContent = '';

      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
      }

      // Update or add MONARCH_TOKEN
      const lines = envContent.split('\n').filter((line) => !line.startsWith('MONARCH_TOKEN='));
      lines.push(`MONARCH_TOKEN=${token}`);

      fs.writeFileSync(envPath, lines.join('\n'));
      console.log(`✓ Token saved to ${envPath}`);
      console.log('');
      console.log('You can now run: npm run dev:sync');
    } catch (error) {
      console.error('Login failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Server command
program
  .command('server')
  .description('Start the HTTP server with /api/status endpoint')
  .option('--port <port>', 'Server port', process.env.PORT || '3001')
  .action(async (options) => {
    try {
      const port = parseInt(options.port, 10);
      startServer(port);
    } catch (error) {
      console.error('Server failed to start:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show current sync status')
  .action(async () => {
    try {
      const { getStatus } = await import('./sync.js');
      const status = await getStatus(false);

      console.log('');
      console.log('=== Monarch Money Ingestor Status ===');
      console.log(`  Status:               ${status.status}`);
      console.log(`  Last Sync:            ${status.last_sync || 'Never'}`);
      console.log(`  Total Transactions:   ${status.transactions_total}`);
      console.log(`  Last 30 Days:         ${status.transactions_last_30_days}`);
      console.log(`  Accounts:             ${status.accounts_count}`);
      console.log(`  API Reachable:        ${status.api_reachable}`);
      if (status.error) {
        console.log(`  Error:                ${status.error}`);
      }
      console.log('');
    } catch (error) {
      console.error('Failed to get status:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Test command
program
  .command('test')
  .description('Test Monarch API connection')
  .action(async () => {
    try {
      const token = process.env.MONARCH_TOKEN;
      if (!token) {
        console.error('MONARCH_TOKEN not set. Run `npm run dev:login` first.');
        process.exit(1);
      }

      console.log('Testing Monarch Money API connection...');
      const client = createMonarchClient(token);

      const isConnected = await client.testConnection();
      if (isConnected) {
        console.log('✓ API connection successful');

        const { accounts, netWorth } = await client.getAccounts();
        console.log(`✓ Found ${accounts.length} accounts`);
        if (netWorth !== null) {
          console.log(`✓ Net Worth: $${netWorth.toLocaleString()}`);
        }

        // Try to fetch a few transactions
        const transactions = await client.getTransactions({ limit: 5 });
        console.log(`✓ Fetched ${transactions.length} sample transactions`);
      } else {
        console.error('✗ API connection failed');
        process.exit(1);
      }
    } catch (error) {
      console.error('Test failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
