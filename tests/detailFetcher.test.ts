import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseJobDetailHtml } from '../src/collector/detailFetcher.js';

/** 実案件ページ(work/detail/5552617、2026-06-05取得)のHTMLフィクスチャ。 */
const html = readFileSync('./tests/fixtures/detail-sample.html', 'utf8');

describe('parseJobDetailHtml', () => {
  const detail = parseJobDetailHtml(html);

  it('依頼概要の本文を抽出する', () => {
    expect(detail.description).not.toBeNull();
    expect(detail.description).toContain('ECサイトの運営効率を向上させるため');
    expect(detail.description).toContain('【依頼したい業務範囲】');
    expect(detail.description).toContain('JavaScript/TypeScript');
  });

  it('HTMLタグが残っていない', () => {
    expect(detail.description).not.toMatch(/<br|<dd|<dl/);
  });

  it('追記内容も含める', () => {
    expect(detail.description).toContain('【追記】');
    expect(detail.description).toContain('セキュリティ・リスク管理');
  });

  it('依頼主の業種を抽出する', () => {
    expect(detail.industry).toBe('IT・通信・インターネット');
  });

  it('既存提案数を抽出する', () => {
    expect(detail.proposalCount).toBe(105);
  });

  it('案件ページでないHTMLでは空の結果を返す', () => {
    const empty = parseJobDetailHtml('<html><body>not a job page</body></html>');
    expect(empty.description).toBeNull();
    expect(empty.industry).toBeNull();
    expect(empty.proposalCount).toBeNull();
  });
});
