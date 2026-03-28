import dotenv from "dotenv";
import { join } from "path";
import { nanoid } from "nanoid";

// Load environment variables
dotenv.config({
  path: join(__dirname, "../development.env") // TODO: Change to production
});

import {
  SERVICE_URLS,
  REDIS_HOST,
  webhookTypes,
  REDIS_PORT,
  REDIS_PASSWORD,
  INSTANCE_ID
} from "./globals";

// Load environment variables
dotenv.config();

export interface WebhookConfig {
  id: string;          // Unique identifier for the webhook
  url: string;         // URL to send requests to
  type: string;        // Type of webhook (used to determine payload and handling)
  intervalSeconds: number;
  enabled: boolean;
  headers?: Record<string, string>; // Optional custom headers
  timeoutMs?: number;  // Optional per-webhook HTTP timeout (overrides default 5 000 ms)
}

export interface IRedisConfig {
  host: string;
  port: number;
  password?: string;
}

interface Config {
  port: number;
  nodeEnv: string;
  logLevel: string;
  schedulerSecret: string;
  webhooks: WebhookConfig[];
  redis: IRedisConfig;
  instanceId: string;
}

// Helper function to parse webhook URLs from environment
function parseWebhooks(): WebhookConfig[] {
  const webhooks: WebhookConfig[] = [];

  // Mark examinations as failed if their end time has passed (run every 5 minutes)
  webhooks.push({
    id: webhookTypes.trackExaminationExpiry,
    url: `${SERVICE_URLS.ivdmsServiceURI}/trackExaminationExpiry`,
    type: webhookTypes.trackExaminationExpiry,
    intervalSeconds: 300,
    enabled: true,
  });

  // Expire active process output documents whose validUntil has passed (run every 30 minutes)
  webhooks.push({
    id: webhookTypes.trackProcessOutputDocumentExpiry,
    url: `${SERVICE_URLS.ivdmsServiceURI}/trackProcessOutputDocumentExpiry`,
    type: webhookTypes.trackProcessOutputDocumentExpiry,
    intervalSeconds: 1800,
    enabled: true,
  });

  // Enqueue penalty-fee generation for expired documents (run every 30 minutes)
  webhooks.push({
    id: webhookTypes.trackProcessOutputDocumentForPenaltyFees,
    url: `${SERVICE_URLS.ivdmsServiceURI}/trackProcessOutputDocumentForPenaltyFees`,
    type: webhookTypes.trackProcessOutputDocumentForPenaltyFees,
    intervalSeconds: 1800,
    enabled: true,
  });

  // Release payment locks whose release time has passed (run every 5 minutes)
  webhooks.push({
    id: webhookTypes.trackPaymentLockExpiry,
    url: `${SERVICE_URLS.ivdmsServiceURI}/trackPaymentLockExpiry`,
    type: webhookTypes.trackPaymentLockExpiry,
    intervalSeconds: 300,
    enabled: true,
  });

  // Refresh OCAS compliance scores for all operators active in the scoring window (run nightly)
  webhooks.push({
    id: webhookTypes.refreshOcasComplianceScores,
    url: `${SERVICE_URLS.ivdmsServiceURI}/refreshOcasComplianceScores`,
    type: webhookTypes.refreshOcasComplianceScores,
    intervalSeconds: 86400,
    enabled: true,
    timeoutMs: 300000, // 5-minute timeout — job iterates over all active operators
  });

  return webhooks;
}

// Fail fast on missing required secrets — prevents silent misconfiguration
const REQUIRED_ENV: string[] = ['SCHEDULER_SECRET', 'REDIS_HOST', 'REDIS_PORT'];
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`[Config] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

export const config: Config = {
  port: parseInt(process.env.PORT || "6767", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  schedulerSecret: process.env.SCHEDULER_SECRET || "",
  logLevel: process.env.LOG_LEVEL || "info",
  instanceId: `${INSTANCE_ID}-${nanoid(32)}`,
  webhooks: parseWebhooks(),
  redis: {
    host: REDIS_HOST || "localhost",
    port: parseInt(REDIS_PORT || "6379", 10),
    password: REDIS_PASSWORD || ""
  }
};