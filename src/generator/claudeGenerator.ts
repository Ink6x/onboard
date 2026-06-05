import Anthropic from '@anthropic-ai/sdk';
import type { Job, ScoreResult } from '../types.js';
import type { Profile } from './profile.js';
import type { ProposalGenerator } from './types.js';

const MODEL = 'claude-sonnet-4-6';
const MIN_LENGTH = 300;
const MAX_LENGTH = 500;
const MAX_ATTEMPTS = 2;

/**
 * v1ジェネレーター: Lancers受注ベストプラクティス(7パーツ構成・300〜500字・
 * 数値実績・案件名の冒頭含有)をプロンプトに織り込んだシンプル実装。
 * 自己検査(字数・案件キーワード含有)に不合格なら1回だけ再生成する。
 */
export class ClaudeProposalGenerator implements ProposalGenerator {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    job: Job,
    profile: Profile,
    score: ScoreResult,
    editInstruction?: string,
    previousProposal?: string,
  ): Promise<string> {
    let feedback = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const proposal = await this.callClaude(job, profile, score, editInstruction, previousProposal, feedback);
      const issues = validateProposal(proposal, job);
      if (issues.length === 0) return proposal;
      feedback = `前回の出力には次の問題がありました。修正してください: ${issues.join(' / ')}`;
    }
    // 再生成しても完璧でない場合は最後の出力を返す(人間が承認前に確認するため致命的ではない)
    return this.callClaude(job, profile, score, editInstruction, previousProposal, feedback);
  }

  private async callClaude(
    job: Job,
    profile: Profile,
    score: ScoreResult,
    editInstruction?: string,
    previousProposal?: string,
    feedback?: string,
  ): Promise<string> {
    const matchedWorks = profile.works.filter((w) => score.matchedWorks.includes(w.name));
    const worksToShow = matchedWorks.length > 0 ? matchedWorks : profile.works.slice(0, 2);

    const editBlock =
      editInstruction && previousProposal
        ? `\n# 編集指示\n前回の提案文:\n${previousProposal}\n\n依頼者からの修正指示: ${editInstruction}\nこの指示を反映して書き直してください。`
        : '';

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `# 案件情報
タイトル: ${job.title}
URL: ${job.url}
予算: ${job.budgetText ?? '不明'}
詳細: ${job.description ?? '(詳細未取得。タイトルから推測される範囲で書くこと)'}

# 応募者プロファイル
名前: ${profile.displayName}
肩書き: ${profile.headline}
自己紹介素材: ${profile.intro}

# この案件に関連する実績(数値成果を必ず使うこと)
${worksToShow.map((w) => `- ${w.name}: ${w.summary} / 成果: ${w.outcomes.join('、')} / 技術: ${w.stack.join(', ')}`).join('\n')}

# 稼働条件(具体数値で提示すること)
- 稼働時間: ${profile.conditions.weeklyHours}
- 返信: ${profile.conditions.responseSla}
- 初稿: ${profile.conditions.firstDraftDays}
${editBlock}
${feedback ? `\n# 修正フィードバック\n${feedback}` : ''}

提案文のみを出力してください(前置き・解説は不要)。`,
        },
      ],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('Claude APIから予期しない応答形式が返されました');
    }
    return block.text.trim();
  }
}

const SYSTEM_PROMPT = `あなたはLancers(ランサーズ)で受注率の高い提案文を書く専門家です。
以下のベストプラクティスを厳守してください:

1. 構成は7パーツ: 挨拶+案件への言及 → 経歴 → 実績(数値) → 案件への具体的提案 → 稼働時間・納期 → 特典/安心材料 → 締め
2. 全体で300〜500文字(これは厳守。500字を超えない)
3. 冒頭1〜2文に必ず案件名のキーワードを入れ、募集要項を読んだことが伝わる具体的な一文を書く。「はじめまして」だけで始めない
4. 実績は数値で語る(時間削減、コスト削減率など)。案件に関係ある実績のみ
5. 価格・納期・返信速度は抽象表現を避けて具体数値で書く
6. 丁寧だが過剰にへりくだらない。信頼性(連絡が取れる・納期を守る)を技術力と同等に訴求する
7. 汎用文の使い回しに見える表現を避け、この案件固有の課題に踏み込む`;

/** 自己検査: 字数レンジと案件キーワードの含有をチェックする。 */
export function validateProposal(proposal: string, job: Job): readonly string[] {
  const issues: string[] = [];
  if (proposal.length < MIN_LENGTH) issues.push(`${MIN_LENGTH}字未満(現在${proposal.length}字)`);
  if (proposal.length > MAX_LENGTH + 100) issues.push(`${MAX_LENGTH}字を大幅超過(現在${proposal.length}字)`);

  const titleKeywords = extractKeywords(job.title);
  const mentionsJob = titleKeywords.some((keyword) => proposal.includes(keyword));
  if (titleKeywords.length > 0 && !mentionsJob) issues.push('案件タイトルのキーワードが含まれていない');

  return issues;
}

/** タイトルから3文字以上の名詞っぽい語を雑に抽出する(v1ヒューリスティック)。 */
function extractKeywords(title: string): readonly string[] {
  return title
    .split(/[\s【】\[\]()()、。・/|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}
