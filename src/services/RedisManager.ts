import { Redis, RedisOptions} from 'ioredis';
import { logger } from '../utils';
import { config } from '../config';

class RedisManager {
  private static instance: RedisManager;
  private redis: Redis | null = null;
  private isConnected = false;

  private constructor() {}

  static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  async connect(): Promise<Redis> {
    if (this.redis && this.isConnected) {
      return this.redis;
    }

    try {
      const redisOptions: RedisOptions = {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
        family: 4
      };

      console.log("redisOptions: ", redisOptions);

      // TODO:
      // retryDelayOnFailover: 100,
      // retryConnectOnFailover: true,

      this.redis = new Redis(redisOptions);

      // Set up event listeners
      this.redis.on('connect', () => {
        logger.info('Redis connected successfully');
        this.isConnected = true;
      });

      this.redis.on('error', (error) => {
        logger.error('Redis connection error:', { 
          error: error.message
        });
        this.isConnected = false;
      });

      this.redis.on('close', () => {
        logger.warn('Redis connection closed');
        this.isConnected = false;
      });

      this.redis.on('reconnecting', () => {
        logger.info('Redis reconnecting...');
      });

      // Actually connect
      await this.redis.connect();
      
      // Test the connection
      await this.redis.ping();
      
      logger.info('Redis connection established and tested');
      return this.redis;

    } catch (error) {
      logger.error('Failed to connect to Redis:', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  getClient(): Redis {
    if (!this.redis || !this.isConnected) {
      throw new Error('Redis client not connected. Call connect() first.');
    }
    return this.redis;
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.disconnect();
      this.redis = null;
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }

  isReady(): boolean {
    return this.isConnected && this.redis !== null;
  }

  /**
   * Health check for Redis connection
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number; error?: string }> {
    try {
      if (!this.redis || !this.isConnected) {
        return { status: 'unhealthy', error: 'Not connected' };
      }

      const start = Date.now();
      await this.redis.ping();
      const latency = Date.now() - start;

      return { status: 'healthy', latency };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }
}

export const redisManager = RedisManager.getInstance();