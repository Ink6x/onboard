import { describe, expect, it } from 'vitest';
import { assertDenylistUsable, scanForbiddenTerms } from '../../src/sync/denylist.js';

// テスト用の禁止語(実際の値とは無関係のダミー。下限5件を満たす)
const TERMS = ['架空商事', 'ダミー名前', 'CTO', 'examplecorp', 'secret-service'] as const;

describe('scanForbiddenTerms', () => {
  it('禁止語を含まないテキストは空配列(合格)', () => {
    expect(scanForbiddenTerms('クライアント業務の自動化を提案します。', [...TERMS])).toEqual([]);
  });

  it('日本語の禁止語を部分一致で検出する', () => {
    expect(scanForbiddenTerms('株式会社架空商事で勤務', [...TERMS])).toContain('架空商事');
  });

  it('全角・空白挿入のすり抜けを検出する(NFKC正規化+空白除去)', () => {
    expect(scanForbiddenTerms('架空 商事の案件です', [...TERMS])).toContain('架空商事');
    expect(scanForbiddenTerms('ＣＴＯを務めた', [...TERMS])).toContain('CTO');
  });

  it('短い英字語は語境界つきで検出する(偽陽性を防ぐ)', () => {
    // constructor / Vector DB に "cto" が含まれるが誤検出しない
    expect(scanForbiddenTerms('Vector DBとconstructorパターンを使用', [...TERMS])).toEqual([]);
    expect(scanForbiddenTerms('前職ではCTOとして', [...TERMS])).toContain('CTO');
    expect(scanForbiddenTerms('CTO就任', [...TERMS])).toContain('CTO');
  });

  it('短い英字語への空白挿入バイパスも検出する', () => {
    expect(scanForbiddenTerms('役職はC T Oでした', [...TERMS])).toContain('CTO');
    expect(scanForbiddenTerms('役職はC​T​Oでした', [...TERMS])).toContain('CTO'); // ゼロ幅文字
  });

  it('カタカナ/ひらがなの表記ゆれを同一視する', () => {
    const terms = ['かくうしょうじ', 'ダミー名前', 'CTO', 'examplecorp', 'secret-service'];
    expect(scanForbiddenTerms('カクウショウジの案件', terms)).toContain('かくうしょうじ');
  });

  it('長い英字語はドメイン連結でも検出する', () => {
    expect(scanForbiddenTerms('mail@examplecorpgroup.co.jp', [...TERMS])).toContain('examplecorp');
  });

  it('大文字小文字を無視して検出する', () => {
    expect(scanForbiddenTerms('EXAMPLECORP の案件', [...TERMS])).toContain('examplecorp');
  });

  it('複数ヒットをすべて返す', () => {
    const hits = scanForbiddenTerms('架空商事のCTOです', [...TERMS]);
    expect(hits).toEqual(['架空商事', 'CTO']);
  });
});

describe('assertDenylistUsable (fail-closed)', () => {
  it('下限未満の禁止語リストはthrowする', () => {
    expect(() => assertDenylistUsable(['一語だけ'])).toThrow(/fail-closed/);
    expect(() => assertDenylistUsable([])).toThrow(/fail-closed/);
  });

  it('空白だけの語はカウントしない', () => {
    expect(() => assertDenylistUsable(['  ', 'a', 'b', 'c', 'd'])).toThrow(/fail-closed/);
  });

  it('下限以上ならthrowしない', () => {
    expect(() => assertDenylistUsable([...TERMS])).not.toThrow();
  });

  it('scanForbiddenTermsも空リストでthrowする(検査の無効化を許さない)', () => {
    expect(() => scanForbiddenTerms('任意のテキスト', [])).toThrow(/fail-closed/);
  });
});
