import type { Redis, Result } from 'ioredis';
import { KEY_PREFIX } from '../lib/keys.js';

declare module 'ioredis' {
  interface RedisCommander<Context> {
    acquireSendPermit(...args: (string | number)[]): Result<number[], Context>;
  }
}

/*
 * One atomic script decides whether an email may be sent right now. Everything lives in Redis,
 * so every worker process sees the same counters and spacing.
 *
 * Throttles: keys holding the earliest timestamp the next send may happen (min gap between sends).
 * Limits:    per-window counters, key = prefix + window index (window = floor(ts / windowMs)).
 *
 * Replies:
 *   {1, sendAt, window, count1..countN}  granted; counters already incremented
 *   {2, slotAt}                          next free slot is too far away to wait inline; the slot is
 *                                        reserved for this job and it should come back at slotAt
 *   {3, limitIndex, window, position}    hourly limit hit; a place was reserved in a later window
 *   {4, limitIndex, window}              no room within the look-ahead; retry at that window
 */
const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxWait = tonumber(ARGV[3])
local heldWindow = tonumber(ARGV[4])
local heldSlot = tonumber(ARGV[5])
local tolerance = tonumber(ARGV[6])
local lookahead = tonumber(ARGV[7])

local i = 8
local throttles = {}
for t = 1, tonumber(ARGV[i]) do
  throttles[t] = { ARGV[i + 1], tonumber(ARGV[i + 2]) }
  i = i + 2
end
i = i + 1
local limits = {}
for l = 1, tonumber(ARGV[i]) do
  limits[l] = { ARGV[i + 1], tonumber(ARGV[i + 2]) }
  i = i + 2
end

local function reserveThrottles(at)
  for t = 1, #throttles do
    local nextFree = at + throttles[t][2]
    redis.call('SET', throttles[t][1], nextFree, 'PX', math.max(nextFree - now, 0) + 60000)
  end
end

local function countOf(l, w)
  return tonumber(redis.call('GET', limits[l][1] .. w) or '0')
end

local function incrAll(w)
  local counts = {}
  for l = 1, #limits do
    local key = limits[l][1] .. w
    counts[l] = redis.call('INCR', key)
    redis.call('PEXPIREAT', key, (w + 2) * windowMs)
  end
  return counts
end

-- A job that already reserved a send slot only keeps it if it shows up on time;
-- a late job (e.g. workers were saturated) has to queue for a fresh slot.
local holdingSlot = heldSlot > 0 and now <= heldSlot + tolerance
local sendAt = now
if holdingSlot then
  sendAt = math.max(now, heldSlot)
else
  for t = 1, #throttles do
    local nextFree = tonumber(redis.call('GET', throttles[t][1]) or '0')
    if nextFree > sendAt then sendAt = nextFree end
  end
  if sendAt - now > maxWait then
    reserveThrottles(sendAt)
    return {2, sendAt}
  end
end

local window = math.floor(sendAt / windowMs)
local counts

if heldWindow == window then
  -- Counted when the reservation was made.
  counts = {}
  for l = 1, #limits do counts[l] = countOf(l, window) end
else
  for l = 1, #limits do
    if countOf(l, window) >= limits[l][2] then
      for w = window + 1, window + lookahead do
        local fits = true
        for m = 1, #limits do
          if countOf(m, w) >= limits[m][2] then
            fits = false
            break
          end
        end
        if fits then
          local reserved = incrAll(w)
          local position = 0
          for m = 1, #reserved do
            if reserved[m] > position then position = reserved[m] end
          end
          return {3, l, w, position}
        end
      end
      return {4, l, window + lookahead}
    end
  end
  counts = incrAll(window)
end

if not holdingSlot then reserveThrottles(sendAt) end

local reply = {1, sendAt, window}
for l = 1, #counts do reply[#reply + 1] = counts[l] end
return reply
`;

export type LimitKind = 'sender' | 'campaign' | 'global';

export interface LimitSpec {
  kind: LimitKind;
  key: string;
  limit: number;
}

export interface ThrottleSpec {
  key: string;
  intervalMs: number;
}

export type Permit =
  | { type: 'granted'; sendAt: number; window: number; counts: number[] }
  | { type: 'wait'; slotAt: number }
  | { type: 'reserved'; limit: LimitSpec; window: number; position: number }
  | { type: 'exhausted'; limit: LimitSpec; window: number };

export interface AcquireInput {
  throttles: ThrottleSpec[];
  limits: LimitSpec[];
  heldWindow?: number | null;
  heldSlot?: number | null;
  now?: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxInlineWaitMs: number;
  slotToleranceMs: number;
  lookaheadWindows: number;
}

export const limiterKeys = {
  senderWindow: (senderId: string) => `${KEY_PREFIX}:rl:sender:${senderId}:`,
  campaignWindow: (campaignId: string) => `${KEY_PREFIX}:rl:campaign:${campaignId}:`,
  globalWindow: () => `${KEY_PREFIX}:rl:global:`,
  senderThrottle: (senderId: string) => `${KEY_PREFIX}:throttle:sender:${senderId}`,
  campaignThrottle: (campaignId: string) => `${KEY_PREFIX}:throttle:campaign:${campaignId}`,
};

export class SendRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly options: RateLimiterOptions,
  ) {
    redis.defineCommand('acquireSendPermit', { numberOfKeys: 0, lua: ACQUIRE_SCRIPT });
  }

  get windowMs(): number {
    return this.options.windowMs;
  }

  windowOf(timestamp: number): number {
    return Math.floor(timestamp / this.options.windowMs);
  }

  windowStart(window: number): number {
    return window * this.options.windowMs;
  }

  async acquire(input: AcquireInput): Promise<Permit> {
    const limits = input.limits.filter((l) => l.limit > 0);
    const args: (string | number)[] = [
      input.now ?? Date.now(),
      this.options.windowMs,
      this.options.maxInlineWaitMs,
      input.heldWindow ?? -1,
      input.heldSlot ?? 0,
      this.options.slotToleranceMs,
      this.options.lookaheadWindows,
      input.throttles.length,
      ...input.throttles.flatMap((t) => [t.key, t.intervalMs]),
      limits.length,
      ...limits.flatMap((l) => [l.key, l.limit]),
    ];

    const reply = await this.redis.acquireSendPermit(...args);

    switch (reply[0]) {
      case 1:
        return { type: 'granted', sendAt: reply[1], window: reply[2], counts: reply.slice(3) };
      case 2:
        return { type: 'wait', slotAt: reply[1] };
      case 3:
        return { type: 'reserved', limit: limits[reply[1] - 1], window: reply[2], position: reply[3] };
      case 4:
        return { type: 'exhausted', limit: limits[reply[1] - 1], window: reply[2] };
      default:
        throw new Error(`Unexpected rate limiter reply: ${JSON.stringify(reply)}`);
    }
  }

  // Gives back a granted permit that ended up unused (e.g. another worker had already claimed the email).
  async release(window: number, limits: LimitSpec[]): Promise<void> {
    const multi = this.redis.multi();
    for (const limit of limits.filter((l) => l.limit > 0)) {
      multi.decr(limit.key + window);
    }
    await multi.exec();
  }
}
