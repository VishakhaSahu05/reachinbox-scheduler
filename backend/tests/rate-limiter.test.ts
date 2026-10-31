import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limiterKeys, SendRateLimiter, type LimitSpec } from '../src/queue/rate-limiter.js';

// Runs against a real Redis (REDIS_URL or localhost). Every test uses fresh ids so nothing collides.
const WINDOW = 60_000;
// Counters expire two windows after their window ends, so test windows must be real (future) ones.
const W = Math.floor(Date.now() / WINDOW) + 10;
const T0 = W * WINDOW + 1_000; // one second into window W

let redis: Redis;
let limiter: SendRateLimiter;

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 });
  await redis.ping();
  limiter = new SendRateLimiter(redis, { windowMs: WINDOW, maxInlineWaitMs: 5_000, slotToleranceMs: 2_000, lookaheadWindows: 10 });
});

afterAll(async () => {
  await redis.quit();
});

const senderLimit = (limit: number): LimitSpec => ({ kind: 'sender', key: limiterKeys.senderWindow(randomUUID()), limit });

describe('SendRateLimiter', () => {
  it('grants up to the limit, then reserves places in later windows in order', async () => {
    const limit = senderLimit(3);
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await limiter.acquire({ limits: [limit], throttles: [], now: T0 }));

    expect(results.slice(0, 3).map((r) => r.type === 'granted' && r.counts[0])).toEqual([1, 2, 3]);
    expect(results.slice(3).map((r) => r.type === 'reserved' && [r.window, r.position])).toEqual([
      [W + 1, 1],
      [W + 1, 2],
      [W + 1, 3],
      [W + 2, 1],
    ]);
  });

  it('lets a job with a reservation through without counting it twice', async () => {
    const limit = senderLimit(1);
    await limiter.acquire({ limits: [limit], throttles: [], now: T0 });
    const pushed = await limiter.acquire({ limits: [limit], throttles: [], now: T0 });
    expect(pushed).toMatchObject({ type: 'reserved', window: W + 1 });

    const later = await limiter.acquire({ limits: [limit], throttles: [], heldWindow: W + 1, now: (W + 1) * WINDOW });
    expect(later).toMatchObject({ type: 'granted', window: W + 1, counts: [1] });

    // The window is now full for everyone else.
    const other = await limiter.acquire({ limits: [limit], throttles: [], now: (W + 1) * WINDOW + 10 });
    expect(other).toMatchObject({ type: 'reserved', window: W + 2 });
  });

  it('enforces whichever limit is hit first', async () => {
    const sender = senderLimit(10);
    const campaign: LimitSpec = { kind: 'campaign', key: limiterKeys.campaignWindow(randomUUID()), limit: 2 };

    await limiter.acquire({ limits: [sender, campaign], throttles: [], now: T0 });
    await limiter.acquire({ limits: [sender, campaign], throttles: [], now: T0 });
    const third = await limiter.acquire({ limits: [sender, campaign], throttles: [], now: T0 });

    expect(third.type).toBe('reserved');
    expect(third.type === 'reserved' && third.limit.kind).toBe('campaign');
  });

  it('spaces sends and hands out future slots when the wait is too long', async () => {
    const throttle = { key: limiterKeys.senderThrottle(randomUUID()), intervalMs: 2_000 };
    const at = async (now: number, heldSlot?: number) => limiter.acquire({ limits: [], throttles: [throttle], now, heldSlot });

    expect(await at(T0)).toMatchObject({ type: 'granted', sendAt: T0 });
    expect(await at(T0)).toMatchObject({ type: 'granted', sendAt: T0 + 2_000 });
    expect(await at(T0)).toMatchObject({ type: 'granted', sendAt: T0 + 4_000 });
    expect(await at(T0)).toEqual({ type: 'wait', slotAt: T0 + 6_000 });
    expect(await at(T0)).toEqual({ type: 'wait', slotAt: T0 + 8_000 });

    // The job that reserved T0+6000 comes back on time and keeps its slot.
    expect(await at(T0 + 6_000, T0 + 6_000)).toMatchObject({ type: 'granted', sendAt: T0 + 6_000 });
    // Anyone new queues after every reserved slot.
    expect(await at(T0 + 6_000)).toMatchObject({ type: 'granted', sendAt: T0 + 10_000 });
  });

  it('drops a reserved slot if the job shows up too late', async () => {
    const throttle = { key: limiterKeys.senderThrottle(randomUUID()), intervalMs: 2_000 };
    await limiter.acquire({ limits: [], throttles: [throttle], now: T0 });

    const late = await limiter.acquire({ limits: [], throttles: [throttle], now: T0 + 30_000, heldSlot: T0 + 2_000 });
    expect(late).toMatchObject({ type: 'granted', sendAt: T0 + 30_000 });
  });

  it('does not reserve a send slot when the hourly limit rejects the email', async () => {
    const limit = senderLimit(1);
    const throttle = { key: limiterKeys.senderThrottle(randomUUID()), intervalMs: 2_000 };

    await limiter.acquire({ limits: [limit], throttles: [throttle], now: T0 });
    for (let i = 0; i < 50; i++) await limiter.acquire({ limits: [limit], throttles: [throttle], now: T0 + 2_000 });

    expect(Number(await redis.get(throttle.key))).toBe(T0 + 2_000);
  });

  it('release gives a granted place back', async () => {
    const limit = senderLimit(1);
    const granted = await limiter.acquire({ limits: [limit], throttles: [], now: T0 });
    expect(granted.type).toBe('granted');

    await limiter.release(W, [limit]);
    expect(await limiter.acquire({ limits: [limit], throttles: [], now: T0 })).toMatchObject({ type: 'granted' });
  });
});
