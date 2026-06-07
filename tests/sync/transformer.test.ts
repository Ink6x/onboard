import { describe, expect, it } from 'vitest';
import { KbTransformer, type MessageCreator } from '../../src/sync/transformer.js';
import type { KbWork } from '../../src/sync/kbSchema.js';

const work: KbWork = {
  slug: 'sample-work',
  name: 'サンプル実績(完全版)',
  disclosure: 'anonymized',
  stack: ['TypeScript'],
  links: {},
  sections: new Map([
    ['概要', '概要本文'],
    ['課題背景', '背景本文'],
  ]),
  relativePath: 'works/sample-work.md',
};

const validWorkJson = JSON.stringify({
  name: '匿名化された実績',
  summary: '概要',
  experienceNote: '経験の語り',
  outcomes: ['成果1'],
});

/** 応答列を順に返すLLMスタブ。呼び出し内容も記録する。 */
function makeStub(responses: readonly string[]): { creator: MessageCreator; calls: { system: string; content: string }[] } {
  const calls: { system: string; content: string }[] = [];
  let i = 0;
  return {
    calls,
    creator: {
      create: async (params) => {
        calls.push({ system: params.system, content: params.messages[0]?.content ?? '' });
        const text = responses[Math.min(i, responses.length - 1)] ?? '';
        i++;
        return { content: [{ type: 'text', text }] };
      },
    },
  };
}

describe('KbTransformer.transformWork', () => {
  it('LLMのJSON応答をパースして返す', async () => {
    const { creator } = makeStub([validWorkJson]);
    const result = await new KbTransformer(creator).transformWork(work, '正規値');
    expect(result.name).toBe('匿名化された実績');
    expect(result.outcomes).toEqual(['成果1']);
  });

  it('コードフェンス・前置きが混ざってもパースできる', async () => {
    const { creator } = makeStub([`変換結果:\n\`\`\`json\n${validWorkJson}\n\`\`\``]);
    const result = await new KbTransformer(creator).transformWork(work, '正規値');
    expect(result.summary).toBe('概要');
  });

  it('複数のJSONオブジェクトが混在しても最初の1つを取り出す', async () => {
    const stub = makeStub([`${validWorkJson}\n補足: {"note": "おまけ"}`]);
    const result = await new KbTransformer(stub.creator).transformWork(work, '正規値');
    expect(result.name).toBe('匿名化された実績');
    expect(stub.calls).toHaveLength(1); // 再試行に落ちない
  });

  it('JSON文字列内の括弧に惑わされない', async () => {
    const json = JSON.stringify({ name: '実績{仮}', summary: '概"要', experienceNote: '語り', outcomes: [] });
    const { creator } = makeStub([json]);
    const result = await new KbTransformer(creator).transformWork(work, '正規値');
    expect(result.name).toBe('実績{仮}');
  });

  it('不正な応答は1回だけ再試行し、フィードバックを添える', async () => {
    const stub = makeStub(['これはJSONではない', validWorkJson]);
    const result = await new KbTransformer(stub.creator).transformWork(work, '正規値');
    expect(result.name).toBe('匿名化された実績');
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1]?.content).toContain('前回の出力は不正でした');
  });

  it('再試行しても不正ならslugつきでthrowする', async () => {
    const { creator } = makeStub(['不正1', '不正2']);
    await expect(new KbTransformer(creator).transformWork(work, '正規値')).rejects.toThrow(/sample-work/);
  });

  it('プロンプトにKB原文と正規値がタグつきで含まれる', async () => {
    const stub = makeStub([validWorkJson]);
    await new KbTransformer(stub.creator).transformWork(work, '## 正規値テーブル');
    expect(stub.calls[0]?.content).toContain('<kb_work>');
    expect(stub.calls[0]?.content).toContain('概要本文');
    expect(stub.calls[0]?.content).toContain('<kb_outcomes>');
    expect(stub.calls[0]?.system).toContain('匿名化ルール');
  });
});

describe('KbTransformer.generateCareerSummary', () => {
  it('テキスト応答をそのまま返す', async () => {
    const summary = '2022年から約3年半、AI開発とWebアプリ開発の実務に携わってきました。規模の異なる複数の現場を経験しています。';
    const { creator } = makeStub([summary]);
    expect(await new KbTransformer(creator).generateCareerSummary('career全文', '2026-06-07')).toBe(summary);
  });

  it('短すぎる応答はthrowする', async () => {
    const { creator } = makeStub(['短い']);
    await expect(new KbTransformer(creator).generateCareerSummary('career全文', '2026-06-07')).rejects.toThrow(
      /短すぎ/,
    );
  });

  it('プロンプトに今日の日付が含まれる(経験年数の計算用)', async () => {
    const stub = makeStub(['a'.repeat(60)]);
    await new KbTransformer(stub.creator).generateCareerSummary('career全文', '2026-06-07');
    expect(stub.calls[0]?.content).toContain('2026-06-07');
  });
});
