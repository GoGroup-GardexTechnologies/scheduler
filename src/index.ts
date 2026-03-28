import express from "express";
import { createServer } from "http";
import { config } from "./config";
import { logger } from "./utils";
import { initScheduler, stopScheduler } from "./scheduler";
import { router } from "./routes";
import { redisManager } from "./services/RedisManager";

// Initialize express app
const app = express();

// Middleware
app.use(express.json());

// Add request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    ip: req.ip || req.socket.remoteAddress
  });
  next();
});

// Routes
app.use('/', router);

// Create HTTP server
const server = createServer(app);

// Track if we're shutting down
let isShuttingDown = false;

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    logger.warn(`Received ${signal} during shutdown, forcing exit...`);
    process.exit(1);
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, initiating graceful shutdown...`);

  // Force exit after 30 seconds if cleanup stalls — unref so it doesn't block natural exit
  const forceExit = setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
  forceExit.unref();

  try {
    // Stop accepting new HTTP requests and wait for in-flight requests to finish
    await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info('HTTP server closed');

    // Stop scheduler jobs and release any held Redis locks
    await stopScheduler();
    logger.info('Scheduler stopped');

    // Close Redis connection
    await redisManager.disconnect();
    logger.info('Redis connection closed');

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
};

// Start server
async function startServer() {
  try {
    logger.info('Starting IVDMS Distributed Scheduler...', {
      nodeEnv: config.nodeEnv,
      instanceId: config.instanceId,
      port: config.port,
      logLevel: config.logLevel
    });

    // Start HTTP server
    server.listen(config.port, () => {
      logger.info(`HTTP Server running on port ${config.port}`, {
        port: config.port,
        instanceId: config.instanceId
      });
    });

    // Initialize scheduler after server starts
    await initScheduler();
    logger.info('Scheduler initialization completed');

  } catch (error) {
    logger.error('Failed to start server:', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}


// Signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', {
    error: error.message, 
    stack: error.stack 
  });
  
  if (!isShuttingDown) {
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
  
  if (!isShuttingDown) {
    gracefulShutdown('UNHANDLED_REJECTION');
  }
});

// Start the server
startServer();