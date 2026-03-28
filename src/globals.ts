export const REDIS_HOST = process.env.REDIS_HOST as string;
export const REDIS_PORT = process.env.REDIS_PORT as string;
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD as string;
export const INSTANCE_ID = process.env.INSTANCE_ID || process.env.HOSTNAME || 'scheduler';

export const SERVICE_URLS: {[key: string]: string} = {
  ivdmsServiceURI: process.env.IVDMS_SERVICE_URI || "http://localhost:8888/api/cron"
};

export const webhookTypes = {
  trackExaminationExpiry: "track-examination-expiry",
  trackProcessOutputDocumentExpiry: "track-process-output-document-expiry",
  trackProcessOutputDocumentForPenaltyFees: "track-process-output-document-for-penalty-fees",
  trackPaymentLockExpiry: "track-payment-lock-expiry",
  refreshOcasComplianceScores: "refresh-ocas-compliance-scores",
};
