import { DistributedLock } from '../locks/DistributedLock';

jest.mock('../config', () => ({
  config: { instanceId: 'test-instance-abc123' },
}));
jest.mock('../utils', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

function makeRedis(overrides: Partial<Record<string, jest.Mock>> = {}): any {
  return {
    set: jest.fn().mockResolvedValue(null),
    get: jest.fn().mockResolvedValue(null),
    pexpire: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('DistributedLock.acquire()', () => {
  it('returns acquired:true and isNew:true when no lock exists', async () => {
    const redis = makeRedis({ set: jest.fn().mockResolvedValue('OK') });
    const lock = new DistributedLock('test-job', redis, 30000);

    const result = await lock.acquire();

    expect(result.acquired).toBe(true);
    expect(result.isNew).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('test-job'),
      expect.any(String),
      'PX', 30000,
      'NX'
    );
  });

  it('returns acquired:false when lock is held by a different instance', async () => {
    const redis = makeRedis({
      set: jest.fn().mockResolvedValue(null), // NX fails — lock exists
      get: jest.fn().mockResolvedValue('other-instance-xyz-lockid'),
    });
    const lock = new DistributedLock('test-job', redis, 30000);

    const result = await lock.acquire();

    expect(result.acquired).toBe(false);
  });

  it('returns acquired:false and does not throw on Redis error', async () => {
    const redis = makeRedis({
      set: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
    });
    const lock = new DistributedLock('test-job', redis, 30000);

    const result = await lock.acquire();

    expect(result.acquired).toBe(false);
  });
});

describe('DistributedLock.release()', () => {
  it('returns true and deletes the key when we own the lock', async () => {
    const redis = makeRedis({
      eval: jest.fn().mockResolvedValue(1), // Lua script: deleted
    });
    const lock = new DistributedLock('test-job', redis, 30000);

    const released = await lock.release();

    expect(released).toBe(true);
    expect(redis.eval).toHaveBeenCalled();
  });

  it('returns false when the lock is owned by a different instance', async () => {
    const redis = makeRedis({
      eval: jest.fn().mockResolvedValue(0), // Lua script: key mismatch, not deleted
    });
    const lock = new DistributedLock('test-job', redis, 30000);

    const released = await lock.release();

    expect(released).toBe(false);
  });

  it('returns false and does not throw on Redis error', async () => {
    const redis = makeRedis({
      eval: jest.fn().mockRejectedValue(new Error('Redis timeout')),
    });
    const lock = new DistributedLock('test-job', redis, 30000);

    const released = await lock.release();

    expect(released).toBe(false);
  });
});
