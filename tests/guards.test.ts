import { describe, expect, it } from 'vitest';
import { isWithinSubmitHours, randomSubmitDelayMs } from '../src/submitter/guards.js';
import type { Config } from '../src/config.js';

const config = {
  SUBMIT_HOURS_START: 9,
  SUBMIT_HOURS_END: 22,
  SUBMIT_DELAY_MIN_SEC: 20,
  SUBMIT_DELAY_MAX_SEC: 90,
} as Config;

function at(hour: number): Date {
  const d = new Date(2026, 5, 6, hour, 0, 0);
  return d;
}

describe('isWithinSubmitHours', () => {
  it('営業時間内は許可する', () => {
    expect(isWithinSubmitHours(config, at(9)).allowed).toBe(true);
    expect(isWithinSubmitHours(config, at(21)).allowed).toBe(true);
  });

  it('営業時間外は拒否し理由を返す', () => {
    expect(isWithinSubmitHours(config, at(8)).allowed).toBe(false);
    expect(isWithinSubmitHours(config, at(22)).allowed).toBe(false);
    expect(isWithinSubmitHours(config, at(3)).reason).toContain('9:00');
  });
});

describe('randomSubmitDelayMs', () => {
  it('rnd=0で下限、rnd=1で上限のミリ秒を返す', () => {
    expect(randomSubmitDelayMs(config, 0)).toBe(20000);
    expect(randomSubmitDelayMs(config, 1)).toBe(90000);
  });

  it('範囲内の値を返す', () => {
    const ms = randomSubmitDelayMs(config, 0.5);
    expect(ms).toBeGreaterThanOrEqual(20000);
    expect(ms).toBeLessThanOrEqual(90000);
  });
});
