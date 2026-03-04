---
name: openclaw-monarch-money-ingestor
description: Sync Monarch Money transactions into OpenClaw Postgres with incremental watermarking.
---

# openclaw-monarch-money-ingestor

## Purpose
Ingest Monarch Money transactions into a `transactions` table.

## Setup
```bash
npm install
cp .env.example .env
npm run build
```

Required env:
- `DATABASE_URL`
- `MONARCH_TOKEN` (or run login flow)

## Run
```bash
npm run sync        # incremental
npm run sync:full   # full re-sync
npm run server      # status API server
```

Dev shortcuts:
```bash
npm run dev:login
npm run dev:sync
npm run dev:server
```

## Notes
- Upsert key: `monarch_id`
- Persists sync state/watermark
