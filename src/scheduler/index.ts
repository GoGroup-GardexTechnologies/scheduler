import { ToadScheduler, SimpleIntervalJob, AsyncTask } from 'toad-scheduler';
import { config } from '../config';
import { logger } from '../utils';
import { webhookService } from '../services/WebhookService';
import { TaskCoordinator } from '../services/TaskCoordinator';
import { redisManager } from '../services/RedisManager';

// Global scheduler instance
const scheduler = new ToadScheduler();
let taskCoordinator: TaskCoordinator;

// Task execution statistics
interface TaskStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  skippedExecutions: number;
  lastExecution?: Date;
  averageExecutionTime: number;
}

const taskStats = new Map<string, TaskStats>();

/**
 * Updates task statistics
 */
function updateTaskStats(
  webhookId: string, 
  executed: boolean, 
  success: boolean, 
  executionTime: number,
  reason?: string
): void {
  const stats = taskStats.get(webhookId) || {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    skippedExecutions: 0,
    averageExecutionTime: 0
  };

  if (executed) {
    stats.totalExecutions++;
    if (success) {
      stats.successfulExecutions++;
    } else {
      stats.failedExecutions++;
    }
    
    // Update average execution time
    const totalSuccessful = stats.successfulExecutions + stats.failedExecutions;
    stats.averageExecutionTime = (
      (stats.averageExecutionTime * (totalSuccessful - 1) + executionTime) / totalSuccessful
    );
  } else {
    stats.skippedExecutions++;
  }

  stats.lastExecution = new Date();
  taskStats.set(webhookId, stats);

  logger.debug(`Updated stats for ${webhookId}:`, {
    webhookId,
    stats,
    reason 
  });
}

/**
 * Creates a webhook task
 */
function createWebhookTask(webhook: any) {
  return new AsyncTask(
    `webhook-task-${webhook.id}`,
    async () => {
      const taskId = `webhook:${webhook.id}`;
      const startTime = Date.now();
      
      try {
        // Use task coordinator to manage distributed execution
        const result = await taskCoordinator.coordinateTask(
          taskId,
          async () => {
            logger.info(`Executing webhook: ${webhook.id}`, {
              webhookId: webhook.id,
              type: webhook.type,
              url: webhook.url
            });

            // Execute the actual webhook request
            await webhookService.sendWebhookRequest(webhook);
            
            return {
              webhookId: webhook.id,
              status: 'success',
              timestamp: new Date().toISOString()
            };
          },
          { skipIfProcessing: true } // Skip if already processing
        );

        const executionTime = Date.now() - startTime;

        if (result.executed) {
          logger.info(`Webhook executed successfully: ${webhook.id}`, {
            webhookId: webhook.id,
            executionTime,
            result: result.result
          });
          
          updateTaskStats(webhook.id, true, true, executionTime);
        } else {
          logger.debug(`Webhook execution skipped: ${webhook.id}`, {
            webhookId: webhook.id,
            reason: result.reason
          });
          
          updateTaskStats(webhook.id, false, false, executionTime, result.reason);
        }

      } catch (error) {
        const executionTime = Date.now() - startTime;
        
        logger.error(`Webhook execution failed: ${webhook.id}`, {
          webhookId: webhook.id,
          type: webhook.type,
          url: webhook.url,
          error: error instanceof Error ? error.message : String(error),
          executionTime
        });
        
        updateTaskStats(webhook.id, true, false, executionTime);
        
        // Don't re-throw to prevent scheduler from stopping
      }
    },
    (error) => {
      logger.error(`Critical error in webhook job: ${webhook.id}`, {
        webhookId: webhook.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  );
}

/**
 * Initializes the scheduler with distributed coordination
 */
export const initScheduler = async (): Promise<void> => {
  try {
    logger.info('Initializing distributed scheduler...');

    // Initialize Redis connection
    await redisManager.connect();
    
    // Initialize task coordinator
    taskCoordinator = new TaskCoordinator({
      lockTTL: 30000,        // 30 seconds lock TTL
      heartbeatInterval: 10000, // 10 seconds heartbeat
      staleTaskTimeout: 60000   // 1 minute stale timeout
    });

    logger.info('Redis connection and task coordinator initialized');

    // Schedule jobs for each configured webhook
    const enabledWebhooks = config.webhooks.filter(webhook => webhook.enabled);
    
    for (const webhook of enabledWebhooks) {
      logger.info(`Setting up webhook: ${webhook.id}`, {
        webhookId: webhook.id,
        url: webhook.url,
        type: webhook.type,
        intervalSeconds: webhook.intervalSeconds
      });
      
      // Create coordinated task
      const webhookTask = createWebhookTask(webhook);

      // Create job with specified interval
      const webhookJob = new SimpleIntervalJob(
        { 
          seconds: webhook.intervalSeconds, 
          runImmediately: false // Don't run immediately to allow staggered starts
        },
        webhookTask
      );

      // Add job to scheduler
      scheduler.addSimpleIntervalJob(webhookJob);
      
      logger.info(`Scheduled webhook: ${webhook.id}`, {
        webhookId: webhook.id,
        intervalSeconds: webhook.intervalSeconds
      });
    }
    
    logger.info(`Distributed scheduler initialized successfully`, {
      activeWebhooks: enabledWebhooks.length,
      totalWebhooks: config.webhooks.length,
      instanceId: config.instanceId
    });

    // Log scheduler health periodically
    setInterval(async () => {
      await logSchedulerHealth();
    }, 60000); // Every minute

  } catch (error) {
    logger.error('Failed to initialize scheduler:', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

/**
 * Logs scheduler health and statistics
 */
async function logSchedulerHealth(): Promise<void> {
  try {
    // Get Redis health
    const redisHealth = await redisManager.healthCheck();
    
    // Get task stats
    const coordinatorStats = await taskCoordinator.getTaskStats();
    
    logger.info('Scheduler Health Report', {
      redis: redisHealth,
      activeCoordinatedTasks: Object.keys(coordinatorStats).length,
      taskExecutionStats: Object.fromEntries(taskStats),
      coordinatedTaskStates: coordinatorStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error generating health report:', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Stops the scheduler gracefully
 */
export const stopScheduler = async (): Promise<void> => {
  logger.info('Stopping distributed scheduler...');
  
  try {
    // Stop the task scheduler
    scheduler.stop();
    
    // Cleanup task coordinator
    if (taskCoordinator) {
      await taskCoordinator.cleanup();
    }
    
    // Disconnect from Redis
    await redisManager.disconnect();
    
    logger.info('Scheduler stopped gracefully');
  } catch (error) {
    logger.error('Error stopping scheduler:', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Gets current scheduler statistics
 */
export const getSchedulerStats = async () => {
  try {
    const redisHealth = await redisManager.healthCheck();
    const coordinatedTasks = await taskCoordinator.getTaskStats();
    
    return {
      redis: redisHealth,
      instance: {
        id: config.instanceId,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      },
      webhooks: {
        total: config.webhooks.length,
        enabled: config.webhooks.filter(w => w.enabled).length,
        disabled: config.webhooks.filter(w => !w.enabled).length
      },
      taskExecutionStats: Object.fromEntries(taskStats),
      coordinatedTaskStates: coordinatedTasks,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error getting scheduler stats:', {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
};

// /**
//  * Manually triggers a specific webhook (useful for testing)
//  */
// export const triggerWebhookManually = async (webhookId: string) => {
//   const webhook = config.webhooks.find(w => w.id === webhookId);
//   if (!webhook) {
//     throw new Error(`Webhook with ID ${webhookId} not found`);
//   }

//   if (!webhook.enabled) {
//     throw new Error(`Webhook ${webhookId} is disabled`);
//   }

//   logger.info(`Manual trigger requested for webhook: ${webhookId}`);
  
//   const taskId = `manual:webhook:${webhookId}`;
  
//   return await taskCoordinator.coordinateTask(
//     taskId,
//     async () => {
//       logger.info(`Manually executing webhook: ${webhookId}`);
//       await webhookService.sendWebhookRequest(webhook);
//       return {
//         webhookId,
//         status: 'success',
//         timestamp: new Date().toISOString(),
//         trigger: 'manual'
//       };
//     },
//     { skipIfProcessing: false } // Allow manual triggers even if processing
//   );
// };