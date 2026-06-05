import { describe, expect, it } from 'vitest';
import { parseLancersEmail, canonicalWorkUrl } from '../src/collector/parser.js';

/**
 * 注意: Lancersメールの実フォーマットは未入手のため、このフィクスチャは
 * 「URL+周辺行」という汎用構造の仮置き。実メール入手後に差し替えること(Task #1)。
 */
const PROVISIONAL_FIXTURE = `
Ink6xさん、あなたへのおすすめの仕事が届いています。

────────────────────
■ 【AI活用】ChatGPT APIを使った業務自動化ツールの開発
予算: 300,000円 〜 500,000円
https://www.lancers.jp/work/detail/1234567?utm_source=mail

■ Next.jsを使ったコーポレートサイトのリニューアル
予算: 200,000円
http://lancers.jp/work/detail/7654321
────────────────────

通知設定の変更はこちら
https://www.lancers.jp/mypage/setting
`;

describe('parseLancersEmail', () => {
  it('案件URLごとに候補を抽出し、URLを正規化する', () => {
    const candidates = parseLancersEmail(PROVISIONAL_FIXTURE);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.url).toBe('https://www.lancers.jp/work/detail/1234567');
    expect(candidates[1]?.url).toBe('https://www.lancers.jp/work/detail/7654321');
  });

  it('URL直前の行からタイトルを抽出する(予算行はスキップ)', () => {
    const candidates = parseLancersEmail(PROVISIONAL_FIXTURE);
    expect(candidates[0]?.title).toContain('ChatGPT APIを使った業務自動化ツールの開発');
    expect(candidates[1]?.title).toContain('Next.jsを使ったコーポレートサイトのリニューアル');
  });

  it('予算テキストを抽出する', () => {
    const candidates = parseLancersEmail(PROVISIONAL_FIXTURE);
    expect(candidates[0]?.budgetText).toContain('300,000');
  });

  it('案件以外のlancers.jpリンクは拾わない', () => {
    const candidates = parseLancersEmail(PROVISIONAL_FIXTURE);
    expect(candidates.every((c) => c.url.includes('/work/detail/'))).toBe(true);
  });

  it('同じ案件IDが複数回出ても1件にまとめる', () => {
    const body = `案件A\nhttps://www.lancers.jp/work/detail/111\n再掲\nhttps://www.lancers.jp/work/detail/111`;
    expect(parseLancersEmail(body)).toHaveLength(1);
  });

  it('案件URLが無いメールは空配列を返す', () => {
    expect(parseLancersEmail('ただのお知らせメールです')).toEqual([]);
  });
});

describe('canonicalWorkUrl', () => {
  it('クエリパラメータを含まない正規URLを生成する', () => {
    expect(canonicalWorkUrl('42')).toBe('https://www.lancers.jp/work/detail/42');
  });
});
