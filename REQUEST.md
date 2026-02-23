# REQUEST.md — openclaw-monarch-money-ingestor

## Goal
Ingest transaction exports from Monarch Money into the OpenClaw PostgreSQL messages/transactions database for AI-assisted financial analysis.

## Background
ET exports transaction CSVs from Monarch Money. These need to be parsed and stored in a structured way so the OpenClaw agent can query spending history, identify subscriptions, answer questions like "what did I spend on food last month?", and support future budgeting features.

## Input Format
Monarch Money CSV export with columns:
- `Date` — YYYY-MM-DD
- `Merchant` — display name
- `Category` — Monarch's category label
- `Account` — e.g. "Apple Card", "Savings", "TOTAL CHECKING (...4000)"
- `Original Statement` — raw bank string
- `Notes` — user notes
- `Amount` — positive = income, negative = expense
- `Tags` — comma-separated
- `Owner` — e.g. "Shared"
- `Business Entity` — optional

## Stack
- TypeScript (ET's preference)
- Node.js CLI — run as `npx ts-node ingest.ts <file.csv>`
- PostgreSQL (existing OpenClaw DB)
- Connection: read from env var `DATABASE_URL`

## Database Target
Create a `transactions` table if it doesn't exist:
```sql
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  merchant TEXT,
  category TEXT,
  account TEXT,
  original_statement TEXT,
  notes TEXT,
  amount NUMERIC(10,2) NOT NULL,
  tags TEXT[],
  owner TEXT,
  business_entity TEXT,
  source TEXT DEFAULT 'monarch',
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, original_statement, amount)
);
```

## Behavior
- Parse CSV, skip header
- Upsert rows (skip duplicates via UNIQUE constraint)
- Print summary: X rows inserted, Y skipped (duplicates)
- Support `--dry-run` flag to preview without writing

## Out of Scope (v1)
- No web UI
- No automatic export/scraping — manual CSV drop only
- No category normalization (keep Monarch's categories as-is)
