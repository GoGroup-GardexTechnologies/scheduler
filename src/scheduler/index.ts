import { ToadScheduler, SimpleIntervalJob, AsyncTask } from 'toad-scheduler';
import { config } from '../config';
import { logger } from '../utils';
import { webhookService } from '../services';

// Create a new scheduler instance
const scheduler = new ToadScheduler();

/**
 * Creates a scheduler task for a specific webhook
 */
function createWebhookTask(webhook: any) {
  return new AsyncTask(
    `webhook-task-${webhook.id}`,
    async () => {
      try {
        await webhookService.sendWebhookRequest(webhook);
        logger.debug(`Successfully sent webhook request to ${webhook.url}`, {
          webhookId: webhook.id,
          type: webhook.type
        });
      } catch (error) {
        // Don't let the error crash the scheduler
        logger.error(`Failed to send webhook request to ${webhook.url}`, { 
          webhookId: webhook.id,
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    },
    (error) => {
      logger.error(`Error in webhook job for ${webhook.url}`, { 
        webhookId: webhook.id,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  );
}

/**
 * Initializes the scheduler and sets up all webhook jobs
 */
export const initScheduler = (): void => {
  logger.info('Initializing scheduler...');

  // Schedule jobs for each configured webhook
  config.webhooks.forEach((webhook) => {
    if (!webhook.enabled) {
      logger.info(`Webhook ${webhook.id} (${webhook.url}) is disabled, skipping...`);
      return;
    }
    
    // Create a task for sending webhook
    const webhookTask = createWebhookTask(webhook);

    // Create a job to run the task
    const webhookJob = new SimpleIntervalJob(
      { minutes: webhook.intervalMinutes, runImmediately: true },
      webhookTask
    );

    // Add the job to the scheduler
    scheduler.addSimpleIntervalJob(webhookJob);
    
    logger.info(`Scheduled ${webhook.type} webhook job for ${webhook.url} to run every ${webhook.intervalMinutes} minute(s)`, {
      webhookId: webhook.id
    });
  });
  
  logger.info(`Scheduler initialized with ${config.webhooks.filter(w => w.enabled).length} active webhooks`);
};

/**
 * Stops the scheduler
 */
export const stopScheduler = (): void => {
  logger.info('Stopping scheduler...');
  scheduler.stop();
};