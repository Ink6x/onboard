import type { Config } from '../config.js';

export interface SubmitWindow {
  readonly allowed: boolean;
  readonly reason: string;
}

/** 現在時刻(ローカル)が送信可能な営業時間内かを判定する。 */
export function isWithinSubmitHours(config: Config, now: Date): SubmitWindow {
  const hour = now.getHours();
  const { SUBMIT_HOURS_START: start, SUBMIT_HOURS_END: end } = config;
  if (hour < start || hour >= end) {
    return {
      allowed: false,
      reason: `送信可能時間は ${start}:00〜${end}:00 です(現在 ${hour}時)`,
    };
  }
  return { allowed: true, reason: '' };
}

/** 送信前のランダム遅延ミリ秒(バースト送信パターンを避ける)。 */
export function randomSubmitDelayMs(config: Config, rnd: number = Math.random()): number {
  const min = config.SUBMIT_DELAY_MIN_SEC;
  const max = Math.max(min, config.SUBMIT_DELAY_MAX_SEC);
  return Math.round((min + rnd * (max - min)) * 1000);
}
