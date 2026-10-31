import { describe, expect, it } from 'vitest';
import { planSchedule } from '../src/modules/campaigns/schedule-planner.js';

const HOUR = 3_600_000;

describe('planSchedule', () => {
  it('spaces emails by the delay', () => {
    expect(planSchedule({ startAt: 10 * HOUR, count: 3, delayMs: 1000, hourlyLimit: 100, windowMs: HOUR })).toEqual([
      10 * HOUR,
      10 * HOUR + 1000,
      10 * HOUR + 2000,
    ]);
  });

  it('moves overflow to the start of the next window', () => {
    expect(planSchedule({ startAt: 10 * HOUR, count: 5, delayMs: 1000, hourlyLimit: 2, windowMs: HOUR })).toEqual([
      10 * HOUR,
      10 * HOUR + 1000,
      11 * HOUR,
      11 * HOUR + 1000,
      12 * HOUR,
    ]);
  });

  it('starts counting fresh when the delay naturally crosses into a new window', () => {
    const start = 11 * HOUR - 1000;
    expect(planSchedule({ startAt: start, count: 3, delayMs: 1000, hourlyLimit: 1, windowMs: HOUR })).toEqual([
      start,
      11 * HOUR,
      12 * HOUR,
    ]);
  });

  it('never puts more than the limit in one window for a large campaign', () => {
    const times = planSchedule({ startAt: 10 * HOUR + 1234, count: 1000, delayMs: 0, hourlyLimit: 200, windowMs: HOUR });
    const perWindow = new Map<number, number>();
    for (const t of times) perWindow.set(Math.floor(t / HOUR), (perWindow.get(Math.floor(t / HOUR)) ?? 0) + 1);

    expect([...perWindow.values()]).toEqual([200, 200, 200, 200, 200]);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
