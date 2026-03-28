import { DistributedLock, LockResult } from '../locks/DistributedLock';
import { redisManager } from './RedisManager';
import { logger } from '../utils';
import { config } from '../config';
import Redis from 'ioredis';

interface TaskExecutionState {
  status: 'processing' | 'completed' | 'failed' | 'idle';
  startTime?: number;
  endTime?: number;
  instanceId?: string;
  result?: any;
  error?: string;
  lastHeartbeat?: number;
}

interface TaskCoordinatorOptions {
  lockTTL?: number;
  heartbeatInterval?: number;
  staleTaskTimeout?: number;
}

export class TaskCoordinator {
  private redis: Redis;
  private activeHeartbeats = new Map<string, NodeJS.Timeout>();
  private options: Required<TaskCoordinatorOptions>;

  constructor(options: TaskCoordinatorOptions = {}) {
    this.redis = redisManager.getClient();
    this.options = {
      lockTTL: options.lockTTL || 30000, // 30 seconds
      heartbeatInterval: options.heartbeatInterval || 10000, // 10 seconds
      staleTaskTimeout: options.staleTaskTimeout || 60000, // 1 minute
    };
  }

  /**
   * Coordinates task execution with distributed locking and state tracking
   */
  async coordinateTask<T>(
    taskId: string,
    taskExecutor: () => Promise<T>,
    options: { skipIfProcessing?: boolean } = {}
  ): Promise<{ executed: boolean; result?: T; reason?: string }> {
    const stateKey = `task_state:${taskId}`;
    const lockKey = `task_lock:${taskId}`;

    try {
      // Check current task state
      const currentState = await this.getTaskState(stateKey);
      
      // Handle different states
      if (currentState.status === 'processing') {
        const isStale = await this.isTaskStale(currentState);
        
        if (!isStale && options.skipIfProcessing) {
          logger.debug(`Task ${taskId} is already being processed, skipping`, {
            taskId,
            processingInstance: currentState.instanceId,
            startTime: currentState.startTime
          });
          return { executed: false, reason: 'already_processing' };
        }
        
        if (isStale) {
          logger.warn(`Task ${taskId} appears to be stale, attempting takeover`, {
            taskId,
            staleInstance: currentState.instanceId,
            startTime: currentState.startTime
          });
        } else {
          logger.debug(`Task ${taskId} is actively being processed`, {
            taskId,
            processingInstance: currentState.instanceId
          });
          return { executed: false, reason: 'actively_processing' };
        }
      }

      // Attempt to acquire distributed lock
      const lock = new DistributedLock(lockKey, this.redis, this.options.lockTTL);
      const lockResult = await lock.acquire();

      if (!lockResult.acquired) {
        logger.debug(`Could not acquire lock for task ${taskId}`, { taskId });
        return { executed: false, reason: 'lock_not_acquired' };
      }

      // Handle re-entry case
      if (!lockResult.isNew) {
        if (options.skipIfProcessing) {
          logger.debug(`Re-entry detected for task ${taskId}, skipping execution`, {
            taskId,
            existingLockId: lockResult.existingLockId
          });
          return { executed: false, reason: 'reentry_skip' };
        }
        
        logger.debug(`Re-entry detected for task ${taskId}, extending lock`, {
          taskId,
          existingLockId: lockResult.existingLockId
        });
      }

      try {
        // Set processing state
        await this.setTaskState(stateKey, {
          status: 'processing',
          startTime: Date.now(),
          instanceId: config.instanceId,
          lastHeartbeat: Date.now()
        });

        // Start heartbeat for long-running tasks
        this.startHeartbeat(taskId, stateKey);

        logger.info(`Starting task execution: ${taskId}`, { taskId });

        // Execute the task
        const result = await taskExecutor();

        // Set completion state
        await this.setTaskState(stateKey, {
          status: 'completed',
          endTime: Date.now(),
          result: JSON.stringify(result),
          instanceId: config.instanceId
        });

        // Set expiration on state (cleanup after 5 minutes)
        await this.redis.expire(stateKey, 300);

        logger.info(`Task completed successfully: ${taskId}`, { 
          taskId,
          executionTime: Date.now() - (await this.getTaskState(stateKey)).startTime!
        });

        return { executed: true, result };

      } catch (error) {
        // Set failed state
        await this.setTaskState(stateKey, {
          status: 'failed',
          endTime: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          instanceId: config.instanceId
        });

        logger.error(`Task failed: ${taskId}`, {
          taskId,
          error: error instanceof Error ? error.message : String(error)
        });

        throw error;

      } finally {
        // Stop heartbeat
        this.stopHeartbeat(taskId);
        
        // Release the lock
        await lock.release();
        
        logger.debug(`Released lock for task: ${taskId}`, { taskId });
      }

    } catch (error) {
      logger.error(`Task coordination error for ${taskId}:`, {
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Gets the current state of a task
   */
  private async getTaskState(stateKey: string): Promise<TaskExecutionState> {
    try {
      const state = await this.redis.hgetall(stateKey);
      
      if (Object.keys(state).length === 0) {
        return { status: 'idle' };
      }

      return {
        status: (state.status as TaskExecutionState['status']) || 'idle',
        startTime: state.startTime ? parseInt(state.startTime) : undefined,
        endTime: state.endTime ? parseInt(state.endTime) : undefined,
        instanceId: state.instanceId,
        result: state.result,
        error: state.error,
        lastHeartbeat: state.lastHeartbeat ? parseInt(state.lastHeartbeat) : undefined
      };
    } catch (error) {
      logger.error('Error getting task state:', { 
        stateKey,
        error: error instanceof Error ? error.message : String(error) 
      });
      return { status: 'idle' };
    }
  }

  /**
   * Sets the task state
   */
  private async setTaskState(stateKey: string, state: Partial<TaskExecutionState>): Promise<void> {
    try {
      const stateToSet: Record<string, string> = {};
      
      if (state.status) stateToSet.status = state.status;
      if (state.startTime) stateToSet.startTime = state.startTime.toString();
      if (state.endTime) stateToSet.endTime = state.endTime.toString();
      if (state.instanceId) stateToSet.instanceId = state.instanceId;
      if (state.result !== undefined) stateToSet.result = state.result;
      if (state.error) stateToSet.error = state.error;
      if (state.lastHeartbeat) stateToSet.lastHeartbeat = state.lastHeartbeat.toString();

      await this.redis.hset(stateKey, stateToSet);
    } catch (error) {
      logger.error('Error setting task state:', { 
        stateKey,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Determines if a task is stale based on heartbeat
   */
  private async isTaskStale(state: TaskExecutionState): Promise<boolean> {
    if (!state.startTime) return true;

    const now = Date.now();
    const lastActivity = state.lastHeartbeat || state.startTime;
    const timeSinceActivity = now - lastActivity;

    return timeSinceActivity > this.options.staleTaskTimeout;
  }

  /**
   * Starts heartbeat for a task
   */
  private startHeartbeat(taskId: string, stateKey: string): void {
    const heartbeatInterval = setInterval(async () => {
      try {
        await this.redis.hset(stateKey, 'lastHeartbeat', Date.now().toString());
        logger.debug(`Heartbeat sent for task: ${taskId}`, { taskId });
      } catch (error) {
        logger.error(`Error sending heartbeat for task ${taskId}:`, {
          taskId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, this.options.heartbeatInterval);

    this.activeHeartbeats.set(taskId, heartbeatInterval);
  }

  /**
   * Stops heartbeat for a task
   */
  private stopHeartbeat(taskId: string): void {
    const heartbeatInterval = this.activeHeartbeats.get(taskId);
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      this.activeHeartbeats.delete(taskId);
      logger.debug(`Stopped heartbeat for task: ${taskId}`, { taskId });
    }
  }

  /**
   * Gets statistics for all active tasks
   */
  async getTaskStats(): Promise<Record<string, TaskExecutionState>> {
    try {
      const keys = await this.redis.keys('task_state:*');
      const stats: Record<string, TaskExecutionState> = {};

      for (const key of keys) {
        const taskId = key.replace('task_state:', '');
        stats[taskId] = await this.getTaskState(key);
      }

      return stats;
    } catch (error) {
      logger.error('Error getting task stats:', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return {};
    }
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async cleanup(): Promise<void> {
    // Stop all active heartbeats
    for (const [taskId, interval] of this.activeHeartbeats) {
      clearInterval(interval);
      logger.debug(`Stopped heartbeat for task during cleanup: ${taskId}`);
    }
    this.activeHeartbeats.clear();
    
    logger.info('Task coordinator cleanup completed');
  }
}