import { Router, Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { logger } from '../utils';
import { getSchedulerStats } from '../scheduler';
import { redisManager } from '../services/RedisManager';

export const router = Router();

/**
 * Guard for management endpoints (/stats, /webhooks).
 * Requires the x-admin-secret header to match ADMIN_SECRET env var.
 * Uses timing-safe comparison to prevent brute-force timing attacks.
 */
function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers['x-admin-secret'];
  const expected = process.env.ADMIN_SECRET;

  if (
    !expected ||
    typeof provided !== 'string' ||
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

/**
 * Health check endpoint
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const stats = await getSchedulerStats();
    
    const isHealthy = stats.redis!.status === 'healthy' && !stats.error;
    
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      ...stats
    });
  } catch (error) {
    logger.error('Health check failed:', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Detailed stats endpoint
 */
router.get('/stats', requireAdminSecret, async (req: Request, res: Response) => {
  try {
    const stats = await getSchedulerStats();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get stats:', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Redis health check endpoint
 */
router.get('/redis/health', async (req: Request, res: Response) => {
  try {
    const health = await redisManager.healthCheck();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// /**
//  * Manual webhook trigger endpoint
//  */
// router.post('/webhook/:webhookId/trigger', async (req: Request, res: Response) => {
//   const { webhookId } = req.params;
  
//   try {
//     logger.info(`Manual webhook trigger requested`, {
//       webhookId,
//       remoteAddress: req.ip || req.socket.remoteAddress
//     });
    
//     const result = await triggerWebhookManually(webhookId);
    
//     res.json({
//       success: true,
//       executed: result.executed,
//       result: result.result,
//       reason: result.reason,
//       timestamp: new Date().toISOString()
//     });
    
//   } catch (error) {
//     logger.error(`Failed to trigger webhook ${webhookId}:`, {
//       webhookId,
//       error: error instanceof Error ? error.message : String(error)
//     });
    
//     res.status(400).json({
//       success: false,
//       error: error instanceof Error ? error.message : String(error),
//       webhookId,
//       timestamp: new Date().toISOString()
//     });
//   }
// });

/**
 * List all webhooks endpoint
 */
router.get('/webhooks', requireAdminSecret, (req: Request, res: Response) => {
  try {
    const { config } = require('../config');
    
    res.json({
      webhooks: config.webhooks.map((webhook: any) => ({
        id: webhook.id,
        type: webhook.type,
        url: webhook.url,
        intervalSeconds: webhook.intervalSeconds,
        enabled: webhook.enabled
      })),
      total: config.webhooks.length,
      enabled: config.webhooks.filter((w: any) => w.enabled).length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Root endpoint
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'IVDMS Distributed Scheduler',
    version: '1.0.0',
    status: 'running',
    instance: process.env.INSTANCE_ID || process.env.HOSTNAME || 'default',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      stats: '/stats',
      redis: '/redis/health',
      webhooks: '/webhooks',
      trigger: '/webhook/:webhookId/trigger'
    }
  });
});