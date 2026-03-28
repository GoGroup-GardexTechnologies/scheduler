import axios, { AxiosRequestConfig } from 'axios';
import { logger } from '../utils';
import { webhookTypes } from '../globals'
import { config, WebhookConfig } from '../config';

export class WebhookService {
  /**
   * Generates the appropriate payload for the webhook based on its type
   */
  private generatePayload(_webhookType: string): Record<string, any> {
    // All scheduler endpoints accept the same minimal nonce body.
    return { nonce: true };
  }

  /**
   * Determines the appropriate HTTP headers based on webhook configuration
   */
  private getHeaders(webhook: WebhookConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'IVDMS-Scheduler',
      // Must match the x-scheduler-secret check in the backend's verifySchedulerSecret middleware
      'x-scheduler-secret': config.schedulerSecret,
    };

    // Per-webhook custom headers override defaults
    if (webhook.headers) {
      Object.assign(headers, webhook.headers);
    }

    return headers;
  }
  
  /**
   * Sends a POST request to a webhook endpoint
   * 
   * @param webhook The webhook configuration
   * @returns A promise that resolves when the request is complete
   */
  async sendWebhookRequest(webhook: WebhookConfig): Promise<void> {
    const payload = this.generatePayload(webhook.type);
    const headers = this.getHeaders(webhook);
    
    try {
      const startTime = Date.now();
      
      const axiosConfig: AxiosRequestConfig = {
        timeout: webhook.timeoutMs ?? 5000,
        headers
      };
      
      logger.debug(`Sending ${webhook.type} webhook to ${webhook.url}`, { 
        webhookId: webhook.id,
        payload 
      });
      
      await axios.post(webhook.url, payload, axiosConfig);
      
      const duration = Date.now() - startTime;
      logger.info(`Webhook request to ${webhook.url} completed in ${duration}ms`, {
        webhookId: webhook.id
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const responseData = error.response?.data;
        
        logger.error('Webhook request failed', {
          webhookId: webhook.id,
          url: webhook.url,
          type: webhook.type,
          status,
          data: responseData,
          error: error.message,
        });
      } else {
        logger.error('Webhook request failed with non-HTTP error', {
          webhookId: webhook.id,
          url: webhook.url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      
      // Re-throw for the caller to handle
      throw error;
    }
  }
}

export const webhookService = new WebhookService();