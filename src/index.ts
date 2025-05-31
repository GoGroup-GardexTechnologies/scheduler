import express from "express";
import { createServer } from "http";
import { config } from "./config";
import { logger } from "./utils";
import { initScheduler } from "./scheduler";
import { router } from "./routes";

// Initialize express app
const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/', router);

// Create HTTP server
const server = createServer(app);

// Start server
server.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
  
  // Initialize scheduler after server starts
  initScheduler();
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  logger.info('Received shutdown signal, closing server...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force close after 10s if server doesn't close gracefully
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});