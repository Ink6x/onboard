import { describe, expect, it } from 'vitest';
import { buildJob, parseJobFile, parseProposeArgs } from '../../src/propose/input.js';

describe('parseProposeArgs', () => {
  it('URL指定をパースする', () => {
    const args = parseProposeArgs(['--url=https://www.lancers.jp/work/detail/123']);
    expect(args.source).toEqual({ kind: 'url', url: 'https://www.lancers.jp/work/detail/123' });
  });

  it('テキスト+タイトル指定をパースする', () => {
    const args = parseProposeArgs(['--text=AIチャットボットを作りたい', '--title=チャットボット開発']);
    expect(args.source).toEqual({ kind: 'text', text: 'AIチャットボットを作りたい' });
    expect(args.title).toBe('チャットボット開発');
  });

  it('テキスト指定にタイトルが無いとエラー', () => {
    expect(() => parseProposeArgs(['--text=本文だけ'])).toThrow(/--title/);
  });

  it('ファイル指定をパースする', () => {
    const args = parseProposeArgs(['--file=./inbox/job1.md']);
    expect(args.source).toEqual({ kind: 'file', path: './inbox/job1.md' });
  });

  it('inbox指定をパースする', () => {
    const args = parseProposeArgs(['--inbox=./proposals-inbox']);
    expect(args.source).toEqual({ kind: 'inbox', dir: './proposals-inbox' });
  });

  it('入力元の指定が無いとエラー', () => {
    expect(() => parseProposeArgs([])).toThrow(/--url|--text|--file|--inbox/);
  });

  it('入力元を複数指定するとエラー', () => {
    expect(() => parseProposeArgs(['--url=https://a', '--text=b', '--title=c'])).toThrow(/いずれか1つ/);
  });

  it('任意メタ(予算・カテゴリ・締切・提案数)を取り込む', () => {
    const args = parseProposeArgs([
      '--url=https://www.lancers.jp/work/detail/123',
      '--budget=10万円〜20万円',
      '--category=システム開発',
      '--deadline=2026-06-20',
      '--proposal-count=5',
    ]);
    expect(args.budget).toBe('10万円〜20万円');
    expect(args.category).toBe('システム開発');
    expect(args.deadline).toBe('2026-06-20');
    expect(args.proposalCount).toBe(5);
  });

  it('提案数が数値でないとエラー', () => {
    expect(() => parseProposeArgs(['--url=https://a', '--proposal-count=abc'])).toThrow(/proposal-count/);
  });

  it('出力先(--out)を取り込む', () => {
    const args = parseProposeArgs(['--url=https://a', '--out=./out/proposal.md']);
    expect(args.out).toBe('./out/proposal.md');
  });

  it('未知のフラグはエラー(タイポ検出)', () => {
    expect(() => parseProposeArgs(['--url=https://a', '--unknown=x'])).toThrow(/--unknown/);
  });

  it('https以外のURLはエラー(SSRF・ローカルファイル参照の防止)', () => {
    expect(() => parseProposeArgs(['--url=http://example.com/work/1'])).toThrow(/https/);
    expect(() => parseProposeArgs(['--url=file:///etc/passwd'])).toThrow(/https/);
    expect(() => parseProposeArgs(['--url=not-a-url'])).toThrow(/URL|https/);
  });

  it('--text は改行を含む本文を受け付ける', () => {
    const args = parseProposeArgs(['--text=1行目\n2行目', '--title=複数行案件']);
    expect(args.source).toEqual({ kind: 'text', text: '1行目\n2行目' });
  });
});

describe('parseJobFile', () => {
  it('先頭行をタイトル、残りを本文として扱う', () => {
    const parsed = parseJobFile('ECサイト構築の依頼\n\n要件は以下の通りです。\n- 会員機能');
    expect(parsed.title).toBe('ECサイト構築の依頼');
    expect(parsed.description).toBe('要件は以下の通りです。\n- 会員機能');
  });

  it('先頭の空行は読み飛ばす', () => {
    const parsed = parseJobFile('\n\nタイトル行\n本文');
    expect(parsed.title).toBe('タイトル行');
    expect(parsed.description).toBe('本文');
  });

  it('本文が無い場合はdescriptionがnull', () => {
    const parsed = parseJobFile('タイトルのみ');
    expect(parsed.title).toBe('タイトルのみ');
    expect(parsed.description).toBeNull();
  });

  it('空のファイルはエラー', () => {
    expect(() => parseJobFile('   \n  ')).toThrow(/空/);
  });
});

describe('buildJob', () => {
  it('生成に必要なフィールドを持つJobを組み立てる', () => {
    const job = buildJob({
      url: 'https://www.lancers.jp/work/detail/123',
      title: 'チャットボット開発',
      description: '社内FAQボットを作りたい',
      budgetText: '10万円',
      category: 'AI開発',
      deadline: '2026-06-20',
      proposalCount: 3,
    });
    expect(job.title).toBe('チャットボット開発');
    expect(job.description).toBe('社内FAQボットを作りたい');
    expect(job.budgetText).toBe('10万円');
    expect(job.category).toBe('AI開発');
    expect(job.deadline).toBe('2026-06-20');
    expect(job.proposalCount).toBe(3);
    expect(job.source).toBe('dummy');
    expect(job.status).toBe('new');
  });

  it('省略フィールドはnullで埋める', () => {
    const job = buildJob({ url: '', title: 'タイトル' });
    expect(job.description).toBeNull();
    expect(job.budgetText).toBeNull();
    expect(job.category).toBeNull();
    expect(job.deadline).toBeNull();
    expect(job.proposalCount).toBeNull();
  });
});
