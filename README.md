# OpenClaw Monarch Money Ingestor

A production-ready TypeScript service that syncs Monarch Money transaction data into the OpenClaw PostgreSQL database.

## Features

- **Incremental & Full Sync**: Efficient incremental syncs with watermark tracking, or force full re-syncs
- **Idempotent Upserts**: Safe to re-run without duplicates
- **Status API**: RESTful `/api/status` endpoint for monitoring
- **CLI Interface**: Easy-to-use commands for sync, login, and status
- **Session Persistence**: Saves sync state to track last sync and watermark

## Quick Start

### 1. Install Dependencies

```bash
NODE_ENV=development npm install
```

> **Note:** `NODE_ENV=development` is required to install TypeScript type declaration packages (devDependencies). If your environment defaults to `NODE_ENV=production`, always prefix install/build commands with `NODE_ENV=development`.

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Monarch Money token (get via npm run login)
MONARCH_TOKEN=your_token_here

# Database connection
DATABASE_URL=postgresql://user:pass@host:5432/database

# Server port (optional)
PORT=3001
```

### 3. Login to Monarch Money

Get your API token by logging in:

```bash
npm run login -- --email your@email.com --password yourpassword
```

Or use environment variables:

```bash
MONARCH_EMAIL=your@email.com MONARCH_PASSWORD=yourpassword npm run login
```

The token will be saved to your `.env` file.

### 4. Run Your First Sync

```bash
# Incremental sync (default)
npm run sync

# Full sync (all transactions)
npm run sync:full
```

### 5. Start the Server (Optional)

```bash
npm run server
```

Then access:
- Status: http://localhost:3001/api/status
- Health: http://localhost:3001/health

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm run sync` | Run incremental sync (default) |
| `npm run sync:full` | Force full sync of all transactions |
| `npm run login` | Login to get Monarch API token |
| `npm run server` | Start HTTP server with status endpoint |
| `npm run dev:*` | Run commands in development mode (ts-node) |

### Development Commands

```bash
# Using ts-node directly
npm run dev:sync         # Incremental sync
npm run dev:sync -- --full  # Full sync
npm run dev:login       # Login flow
npm run dev:server      # Start server
```

## API Endpoints

### GET /api/status

Returns current sync status and statistics:

```json
{
  "service": "monarch-money",
  "status": "ok",
  "last_sync": "2026-02-28T05:00:00Z",
  "accounts_count": 12,
  "transactions_total": 15420,
  "transactions_last_30_days": 142,
  "net_worth": null,
  "api_reachable": true,
  "cached_at": "2026-02-28T05:30:00Z"
}
```

Query parameters:
- `?refresh=true` - Force refresh (bypass 5-minute cache)

### GET /health

Simple health check endpoint.

### POST /api/status/refresh

Clear cache and refresh status.

### POST /api/sync

Trigger a sync operation (runs in background).

Query parameters:
- `?full=true` - Run full sync instead of incremental

## Database Schema

### transactions

```sql
CREATE TABLE transactions (
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
);
```

### sync_state

```sql
CREATE TABLE sync_state (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  last_sync_date TIMESTAMPTZ,
  last_transaction_date DATE,
  total_transactions INTEGER DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  error_message TEXT
);
```

## Scheduling

The ingestor is designed to run on a schedule. Here are some options:

### Cron (Linux/macOS)

```crontab
# Run hourly
0 * * * * cd /path/to/ingestor && npm run sync >> /var/log/monarch-sync.log 2>&1

# Run daily at 3 AM
0 3 * * * cd /path/to/ingestor && npm run sync >> /var/log/monarch-sync.log 2>&1
```

### Docker + Dokploy

Build and deploy as a container with a health check:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY .env.example .env
CMD ["npm", "run", "server"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3001/health || exit 1
```

### Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: monarch-sync
spec:
  schedule: "0 * * * *"  # Every hour
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: sync
            image: monarch-ingestor:latest
            command: ["npm", "run", "sync"]
            envFrom:
            - secretRef:
                name: monarch-secrets
```

## Sync Behavior

### Incremental Sync (Default)

1. Reads last sync watermark from `sync_state` table
2. Fetches transactions from Monarch starting 7 days before last sync date
3. Upserts transactions by `monarch_id` (idempotent)
4. Updates watermark with latest transaction date
5. Reports: new, updated, skipped counts

### Full Sync (`--full`)

1. Fetches all available transactions from Monarch
2. Upserts all transactions by `monarch_id`
3. Updates watermark
4. Use for initial sync or data recovery

## Error Handling

- Failed syncs update `sync_state.error_message` for visibility
- API connection issues are caught and reported
- Transaction batches are processed in transactions for rollback safety

## Development

```bash
# Build TypeScript
NODE_ENV=development npm run build

# Watch mode (if you add tsc-watch)
NODE_ENV=development npm run build -- --watch

# Run tests (add your test framework)
npm test
```

## Troubleshooting

### "MONARCH_TOKEN not configured"

Run `npm run login` to get your token, or set `MONARCH_TOKEN` in your `.env` file.

### "Failed to connect to Monarch Money API"

Your token may have expired. Re-run `npm run login` to get a fresh token.

### "Database connection failed"

Check your `DATABASE_URL` in `.env`. Ensure the database is accessible and the schema is initialized (happens automatically on first run).

## License

MIT
