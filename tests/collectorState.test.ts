import { describe, expect, it, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/store/db.js';
import {
  getCollectorState,
  setCollectorState,
  getDailyCount,
  incrementDailyCount,
} from '../src/store/collectorState.js';

describe('collectorState KV', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('未設定キーはnullを返す', () => {
    expect(getCollectorState(db, 'web:rotation')).toBeNull();
  });

  it('値を保存して読み戻せる(upsert)', () => {
    setCollectorState(db, 'web:rotation', '{"nextMethod":"category"}');
    expect(getCollectorState(db, 'web:rotation')).toBe('{"nextMethod":"category"}');
    setCollectorState(db, 'web:rotation', '{"nextMethod":"keyword"}');
    expect(getCollectorState(db, 'web:rotation')).toBe('{"nextMethod":"keyword"}');
  });

  it('別キーは独立して管理される(匿名/ログインのローテーション分離)', () => {
    setCollectorState(db, 'web:rotation', 'anon');
    setCollectorState(db, 'web:rotation:loggedin', 'auth');
    expect(getCollectorState(db, 'web:rotation')).toBe('anon');
    expect(getCollectorState(db, 'web:rotation:loggedin')).toBe('auth');
  });
});

describe('daily counter (日次ログイン上限)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('初期値は0', () => {
    expect(getDailyCount(db, 'web:loggedin:count')).toBe(0);
  });

  it('インクリメントで累積し、新しい値を返す', () => {
    expect(incrementDailyCount(db, 'web:loggedin:count')).toBe(1);
    expect(incrementDailyCount(db, 'web:loggedin:count')).toBe(2);
    expect(incrementDailyCount(db, 'web:loggedin:count', 3)).toBe(5);
    expect(getDailyCount(db, 'web:loggedin:count')).toBe(5);
  });

  it('prefixが違えば別カウンタ', () => {
    incrementDailyCount(db, 'a');
    incrementDailyCount(db, 'b');
    incrementDailyCount(db, 'b');
    expect(getDailyCount(db, 'a')).toBe(1);
    expect(getDailyCount(db, 'b')).toBe(2);
  });
});
