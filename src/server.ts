import express, { Request, Response } from 'express';
import { getStatus, clearStatusCache } from './sync.js';

export function createServer(): express.Application {
  const app = express();

  // Middleware
  app.use(express.json());

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy' });
  });

  // Status endpoint
  app.get('/api/status', async (req: Request, res: Response) => {
    try {
      const refresh = req.query.refresh === 'true';
      const status = await getStatus(!refresh);
      res.json(status);
    } catch (error) {
      console.error('Error getting status:', error);
      res.status(500).json({
        service: 'monarch-money',
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        cached_at: new Date().toISOString(),
      });
    }
  });

  // Force refresh
  app.post('/api/status/refresh', async (_req: Request, res: Response) => {
    try {
      clearStatusCache();
      const status = await getStatus(false);
      res.json(status);
    } catch (error) {
      console.error('Error refreshing status:', error);
      res.status(500).json({
        service: 'monarch-money',
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        cached_at: new Date().toISOString(),
      });
    }
  });

  // Trigger sync
  app.post('/api/sync', async (req: Request, res: Response) => {
    try {
      // Import sync function
      const { runSync } = await import('./sync.js');
      const full = req.query.full === 'true';

      // Run sync in background and return immediately
      res.json({
        status: 'syncing',
        message: `Starting ${full ? 'full' : 'incremental'} sync`,
        sync_type: full ? 'full' : 'incremental',
      });

      // Run sync (don't await - run in background)
      runSync({ full }).catch((error) => {
        console.error('Sync error:', error);
      });
    } catch (error) {
      console.error('Error starting sync:', error);
      res.status(500).json({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return app;
}

export function startServer(port: number = 3001): void {
  const app = createServer();

  app.listen(port, () => {
    console.log(`Monarch Money Ingestor server running on port ${port}`);
    console.log(`  Status:  http://localhost:${port}/api/status`);
    console.log(`  Health:  http://localhost:${port}/health`);
  });
}
