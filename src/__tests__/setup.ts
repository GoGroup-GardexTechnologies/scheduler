// Set required env vars before any module is loaded.
// config.ts exits the process on startup if these are missing.
process.env.SCHEDULER_SECRET = 'test-scheduler-secret';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.ADMIN_SECRET = 'test-admin-secret';
process.env.IVDMS_SERVICE_URI = 'http://localhost:8888/api/cron';
