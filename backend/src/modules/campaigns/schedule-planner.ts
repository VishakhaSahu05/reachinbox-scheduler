export interface PlanInput {
  startAt: number;
  count: number;
  delayMs: number;
  hourlyLimit: number;
  windowMs: number;
}

/**
 * Works out when each email of a campaign should go out: `delayMs` apart, and never more than
 * `hourlyLimit` inside one clock window (the same fixed windows the runtime limiter counts in).
 * Once a window is full the next email moves to the start of the following window.
 */
export function planSchedule({ startAt, count, delayMs, hourlyLimit, windowMs }: PlanInput): number[] {
  const times: number[] = [];
  let at = startAt;
  let window = Math.floor(at / windowMs);
  let usedInWindow = 0;

  for (let i = 0; i < count; i++) {
    if (i > 0) at += delayMs;

    const current = Math.floor(at / windowMs);
    if (current !== window) {
      window = current;
      usedInWindow = 0;
    }

    if (hourlyLimit > 0 && usedInWindow >= hourlyLimit) {
      window += 1;
      at = window * windowMs;
      usedInWindow = 0;
    }

    times.push(at);
    usedInWindow++;
  }

  return times;
}
