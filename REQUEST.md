# REQUEST.md — openclaw-monarch-money-ingestor

## Goal
Automatically ingest Monarch Money transaction history into the OpenClaw PostgreSQL database on a schedule, using the unofficial Monarch Money GraphQL API.

## References
- JS library: https://github.com/pbassham/monarch-money-api (`npm i monarch-money-api`)
- Python library (for API hints): https://github.com/hammem/monarchmoney
- Endpoint: `https://api.monarchmoney.com/graphql`

## Stack
- TypeScript + Node.js
- `monarch-money-api` npm package (handles auth + GraphQL)
- PostgreSQL (`DATABASE_URL` env var)
- Runs as a scheduled cron (daily or hourly)

## Auth
One-time interactive login via CLI:
```bash
npx ts-node login.ts
```
Saves session token to `.env` as `MONARCH_TOKEN`. Subsequent runs are fully automatic using the saved token.

## Database Target
Upsert into a `transactions` table:
```sql
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  monarch_id TEXT UNIQUE,           -- Monarch's transaction ID (dedup key)
  date DATE NOT NULL,
  merchant TEXT,
  category TEXT,
  account TEXT,
  amount NUMERIC(10,2) NOT NULL,    -- positive = income, negative = expense
  notes TEXT,
  tags TEXT[],
  is_recurring BOOLEAN,
  source TEXT DEFAULT 'monarch',
  raw JSONB,                        -- full Monarch response
  imported_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Behavior
- On first run: fetch ALL transactions (paginate from the beginning)
- On subsequent runs: fetch only since last imported date (stored in a `sync_state` table or a watermark file)
- Upsert by `monarch_id` — safe to re-run
- Print summary: X new, Y updated, Z skipped
- `--full` flag to force a complete re-sync

## Key API Method
```ts
import { getTransactions } from 'monarch-money-api';

const txns = await getTransactions({
  limit: 100,
  offset: 0,
  startDate: '2024-01-01',
  endDate: '2026-12-31',
});
```

## Scheduling
Intended to run as a cron job inside OpenClaw/Dokploy — daily pull of new transactions. No manual intervention after initial auth.

## Out of Scope (v1)
- No budgets, accounts, or net worth data (transactions only)
- No category normalization
- No web UI

---

## Status Endpoint

Exposes `GET /api/status` for health reporting and usage data. Used by OpenClaw directly or via an aggregator.

```json
{
  "service": "monarch-money",
  "status": "ok",
  "last_sync": "2026-02-25T03:00:00Z",
  "accounts_count": 12,
  "transactions_total": 15420,
  "transactions_last_30_days": 142,
  "net_worth": 45231.50,
  "last_balance_update": "2026-02-25T02:00:00Z",
  "api_reachable": true,
  "cached_at": "2026-02-25T03:00:00Z"
}
```

Cache TTL: 5 minutes. Force refresh with `GET /api/status?refresh=true`.
