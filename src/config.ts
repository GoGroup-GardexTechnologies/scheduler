import dotenv from "dotenv";
import { join } from "path";

// Load environment variables
dotenv.config({
  path: join(__dirname, "../development.env") // TODO: Change to production
});

import { SERVICE_URLS, webhookTypes } from "./globals";

// Load environment variables
dotenv.config();

export interface WebhookConfig {
  id: string;          // Unique identifier for the webhook
  url: string;         // URL to send requests to
  type: string;        // Type of webhook (used to determine payload and handling)
  intervalMinutes: number;
  enabled: boolean;
  headers?: Record<string, string>; // Optional custom headers
}

interface Config {
  port: number;
  nodeEnv: string;
  logLevel: string;
  ivdmsAPIKey: string;
  webhooks: WebhookConfig[];
}

// Helper function to parse webhook URLs from environment
function parseWebhooks(): WebhookConfig[] {
  const webhooks: WebhookConfig[] = [];

  webhooks.push({
    id: webhookTypes.trackApplicationWorkflow,
    url: `${SERVICE_URLS.ivdmsServiceURI}/trackApplicationWorkflow`,
    type: webhookTypes.trackApplicationWorkflow,
    intervalMinutes: 0.5,
    enabled: true,
  });

  webhooks.push({
    id: webhookTypes.trackRenewMotorVehicleLicenseApplication,
    url: `${SERVICE_URLS.ivdmsServiceURI}/trackRenewMotorVehicleLicenseApplication`,
    type: webhookTypes.trackRenewMotorVehicleLicenseApplication,
    intervalMinutes: 0.5,
    enabled: true,
  });

  webhooks.push({
    id: webhookTypes.trackMotorVehicleLicenseCertificate,
    url: `${SERVICE_URLS.ivdmsServiceURI}/trackMotorVehicleLicenseCertificate`,
    type: webhookTypes.trackMotorVehicleLicenseCertificate,
    intervalMinutes: 0.5,
    enabled: true,
  });

  return webhooks;
}

export const config: Config = {
  port: parseInt(process.env.PORT || "6767", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  ivdmsAPIKey: process.env.IVDMS_API_KEY || "",
  logLevel: process.env.LOG_LEVEL || "info",
  webhooks: parseWebhooks(),
};