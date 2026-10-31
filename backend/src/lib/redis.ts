import { Redis } from 'ioredis';
import { env } from '../config/env.js';

// BullMQ workers need maxRetriesPerRequest: null so blocking commands survive reconnects.
export function createRedisConnection(name: string): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, connectionName: name });
}

let shared: Redis | null = null;

export function getRedis(): Redis {
  if (!shared) shared = createRedisConnection('app');
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit();
    shared = null;
  }
}
