import { describe, expect, it } from 'vitest';
import { parseLancersEmail, canonicalWorkUrl } from '../src/collector/parser.js';

/** 実メール(2026-06-05受信「【新着】AI・システム開発・運用カテゴリ」)に基づくフィクスチャ。 */
const REAL_FORMAT_FIXTURE = `Ink6x さん

いつもご利用ありがとうございます！ランサーズ事務局です。

Ink6x さんにマッチする新しいお仕事が届きました。
ぜひご確認ください！

━━━━━━━━━━━━━━━━━━━━━━━
■■　Webシステム開発・プログラミング　■■ （2件）
━━━━━━━━━━━━━━━━━━━━━━━
--------------------------------------------------------------------
▼ 【見積り募集】アンケートフォーム連携＆時間帯別配置基準を満たす「保育自動シフト作成アプリ」の開発
[依頼金額] 100,000円 ～ 200,000円
[方式] プロジェクト
[募集締切] 2026年6月6日 18:14
https://www.lancers.jp/work/monitor/5545030/new_work_mail/

--------------------------------------------------------------------
▼ 病院の業務効率化（DX）システム開発
[依頼金額] 200,000円 ～ 300,000円
[方式] プロジェクト
[募集締切] 2026年6月7日 15:53
https://www.lancers.jp/work/monitor/5553077/new_work_mail/

「Webシステム開発・プログラミング」カテゴリには本日【2件】の案件が登録されています。
以下のURLからぜひご確認ください！
https://www.lancers.jp/work/search/system/websystem?sort=Work.started&direction=desc


━━━━━━━━━━━━━━━━━━━━━━━
■■　AI自動化・エージェント開発　■■ （1件）
━━━━━━━━━━━━━━━━━━━━━━━
--------------------------------------------------------------------
▼ 【急募】EC運用業務のAIエージェント構築依頼
[依頼金額] 300,000円 ～ 500,000円
[方式] プロジェクト
[募集締切] 2026年6月10日 18:00
https://www.lancers.jp/work/monitor/5552617/new_work_mail/

「AI自動化・エージェント開発」カテゴリには本日【1件】の案件が登録されています。
https://www.lancers.jp/work/search/system/ai_agent?sort=Work.started&direction=desc

本メールでご紹介しているお仕事はシステムで自動抽出されたものとなります。
https://www.lancers.jp/mypage/receive_email
`;

describe('parseLancersEmail (新着仕事メール・実フォーマット)', () => {
  const candidates = parseLancersEmail(REAL_FORMAT_FIXTURE);

  it('全案件を抽出し、monitor URLを正規のdetail URLへ変換する', () => {
    expect(candidates).toHaveLength(3);
    expect(candidates[0]?.url).toBe('https://www.lancers.jp/work/detail/5545030');
    expect(candidates[1]?.url).toBe('https://www.lancers.jp/work/detail/5553077');
    expect(candidates[2]?.url).toBe('https://www.lancers.jp/work/detail/5552617');
  });

  it('▼行からタイトルを抽出する', () => {
    expect(candidates[0]?.title).toBe(
      '【見積り募集】アンケートフォーム連携＆時間帯別配置基準を満たす「保育自動シフト作成アプリ」の開発',
    );
    expect(candidates[2]?.title).toBe('【急募】EC運用業務のAIエージェント構築依頼');
  });

  it('[依頼金額]・[募集締切]・カテゴリを抽出する', () => {
    expect(candidates[0]?.budgetText).toBe('100,000円 ～ 200,000円');
    expect(candidates[0]?.deadline).toBe('2026年6月6日 18:14');
    expect(candidates[0]?.category).toBe('Webシステム開発・プログラミング');
    expect(candidates[2]?.category).toBe('AI自動化・エージェント開発');
  });

  it('案件一覧ページなどの非案件URLは拾わない', () => {
    expect(candidates.every((c) => /\/work\/detail\/\d+$/.test(c.url))).toBe(true);
  });

  it('同じ案件IDが複数回出ても1件にまとめる', () => {
    const doubled = `${REAL_FORMAT_FIXTURE}\n▼ 再掲\nhttps://www.lancers.jp/work/monitor/5545030/new_work_mail/`;
    expect(parseLancersEmail(doubled)).toHaveLength(3);
  });
});

describe('parseLancersEmail (フォールバック)', () => {
  it('構造化されていないメールでもURL直前の行をタイトルとして拾う', () => {
    const body = `仕事の招待状が届きました\n\nECサイトのAPI連携開発\nhttps://www.lancers.jp/work/detail/1234567?ref=invite`;
    const result = parseLancersEmail(body);
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe('https://www.lancers.jp/work/detail/1234567');
    expect(result[0]?.title).toBe('ECサイトのAPI連携開発');
  });

  it('案件URLが無いメール(ログイン通知等)は空配列を返す', () => {
    expect(parseLancersEmail('新しい端末からのログインを検知しました')).toEqual([]);
  });
});

describe('canonicalWorkUrl', () => {
  it('クエリパラメータを含まない正規URLを生成する', () => {
    expect(canonicalWorkUrl('42')).toBe('https://www.lancers.jp/work/detail/42');
  });
});
