import Redis from 'ioredis';
import { nanoid } from 'nanoid';
import { config } from '../config';
import { logger } from '../utils';

export interface LockResult {
  acquired: boolean;
  isNew?: boolean;
  existingLockId?: string;
  lockId?: string;
}

export class DistributedLock {
  private key: string;
  private ttl: number;
  private lockId: string;
  private instanceId: string;
  private redis: Redis;

  constructor(key: string, redis: Redis, ttl = 30000) {
    this.key = `lock:${key}`;
    this.ttl = ttl;
    this.instanceId = config.instanceId;
    this.lockId = `${this.instanceId}-${nanoid(32)}`;
    this.redis = redis;
  }

  /**
   * Attempts to acquire the distributed lock with re-entry support
   */
  async acquire(): Promise<LockResult> {
    try {
      // First, try to set new lock (atomic operation)
      const newLock = await this.redis.set(
        this.key,
        this.lockId,
        'PX', this.ttl,
        'NX'  // Only set if not exists
      );

      if (newLock === 'OK') {
        logger.debug(`New lock acquired: ${this.lockId}`, { 
          key: this.key, 
          ttl: this.ttl 
        });
        return { 
          acquired: true, 
          isNew: true, 
          lockId: this.lockId 
        };
      }

      // Check if existing lock belongs to same instance (re-entry)
      const existingLockId = await this.redis.get(this.key);
      
      if (!existingLockId) {
        // Lock was released between our attempts, try again
        return await this.acquire();
      }

      const existingInstanceId = existingLockId.split('-')[0];

      if (existingInstanceId === this.instanceId) {
        logger.debug(`Lock re-entry detected: ${existingLockId}`, { 
          key: this.key 
        });
        
        // Extend the existing lock TTL
        const extended = await this.redis.pexpire(this.key, this.ttl);
        
        if (extended === 1) {
          return { 
            acquired: true, 
            isNew: false, 
            existingLockId,
            lockId: this.lockId 
          };
        } else {
          // Lock expired between checks, try to acquire new lock
          return await this.acquire();
        }
      }

      logger.debug(`Lock held by different instance: ${existingLockId}`, { 
        key: this.key,
        currentInstance: this.instanceId,
        lockHolderInstance: existingInstanceId
      });
      
      return { acquired: false };

    } catch (error) {
      logger.error(`Error acquiring lock for ${this.key}:`, { 
        error: error instanceof Error ? error.message : String(error),
        lockId: this.lockId 
      });
      return { acquired: false };
    }
  }

  /**
   * Releases the lock (only if we own it)
   */
  async release(): Promise<boolean> {
    try {
      // Lua script to atomically check and delete only if we own the lock
      const script = `
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('del', KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(script, 1, this.key, this.lockId);
      
      if (result === 1) {
        logger.debug(`Lock released: ${this.lockId}`, { key: this.key });
        return true;
      } else {
        logger.warn(`Attempted to release lock not owned by us`, { 
          key: this.key, 
          lockId: this.lockId 
        });
        return false;
      }
    } catch (error) {
      logger.error(`Error releasing lock ${this.key}:`, { 
        error: error instanceof Error ? error.message : String(error),
        lockId: this.lockId 
      });
      return false;
    }
  }

  /**
   * Extends the lock TTL (only if we own it)
   */
  async extend(): Promise<boolean> {
    try {
      const script = `
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('pexpire', KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(script, 1, this.key, this.lockId, this.ttl);
      
      if (result === 1) {
        logger.debug(`Lock extended: ${this.lockId}`, { 
          key: this.key, 
          ttl: this.ttl 
        });
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`Error extending lock ${this.key}:`, { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  /**
   * Gets information about the current lock
   */
  async getInfo(): Promise<{ exists: boolean; ownedByUs: boolean; ttl: number; lockId?: string }> {
    try {
      const [existingLockId, ttl] = await Promise.all([
        this.redis.get(this.key),
        this.redis.pttl(this.key)
      ]);

      const exists = existingLockId !== null;
      const ownedByUs = existingLockId === this.lockId;

      return {
        exists,
        ownedByUs,
        ttl: ttl || 0,
        lockId: existingLockId || undefined
      };
    } catch (error) {
      logger.error(`Error getting lock info for ${this.key}:`, { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { exists: false, ownedByUs: false, ttl: 0 };
    }
  }
}