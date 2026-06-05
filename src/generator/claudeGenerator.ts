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
    let lastProposal = '';
    // 計MAX_ATTEMPTS回まで呼び出す(初回+自己検査NG時の再生成1回)
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      lastProposal = await this.callClaude(job, profile, score, editInstruction, previousProposal, feedback);
      const issues = validateProposal(lastProposal, job);
      if (issues.length === 0) return lastProposal;
      feedback = `前回の出力には次の問題がありました。修正してください: ${issues.join(' / ')}`;
    }
    // 再生成しても完璧でない場合は最後の出力を返す(人間が承認前に確認するため致命的ではない)
    return lastProposal;
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
カテゴリ: ${job.category ?? '不明'}
予算: ${job.budgetText ?? '不明'}
募集締切: ${job.deadline ?? '不明'}
既存提案数: ${job.proposalCount !== null ? `${job.proposalCount}件以上(競争が激しいため差別化を強く意識すること)` : '不明'}

# 依頼概要(クライアントが書いた募集要項)
${job.description ?? '(詳細未取得。タイトルから推測される範囲で書き、憶測の断定は避けること)'}

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

提案文のみを出力してください(前置き・解説・マークダウン見出しは不要)。`,
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

# 構成(7パーツ。この順序を守る)
1. 挨拶+案件への言及: 冒頭1〜2文に必ず案件名のキーワードと、依頼概要に書かれた固有の課題・状況への言及を入れる。「はじめまして」だけで始めない。依頼概要を読んだ人にしか書けない一文にする
2. 経歴: 案件に関係ある部分だけ1〜2文
3. 実績: 数値で語る(時間削減、コスト削減率など)。案件に関係ある実績のみ厳選
4. 案件への具体的提案: 依頼概要の要件に対して「どう作るか」を一歩踏み込んで書く。技術選定や進め方の方針を1つ具体的に示す
5. 稼働時間・納期: 具体数値で
6. 安心材料: 返信速度、承認フロー付き開発、納品後の説明など
7. 締め: 簡潔に。質問への回答も歓迎する姿勢

# ルール
- 全体で300〜500文字(厳守。500字を超えない)
- 依頼概要に「必要なスキル」「希望する言語・ツール」「依頼先選びで重視する点」「応募時に〜を記載してください」等の指定がある場合、必ずそれに応える(指定スキルの経験を明記、記載指示には回答)
- 依頼概要に質問形式の項目があれば先回りして簡潔に答える
- 価格・納期・返信速度は抽象表現を避けて具体数値で書く
- 丁寧だが過剰にへりくだらない。信頼性(連絡が取れる・納期を守る)を技術力と同等に訴求する
- 汎用文の使い回しに見える表現(「ぜひお手伝いさせてください」だけ等)を避け、この案件固有の課題に踏み込む
- 依頼概要が未取得の場合、書かれていない要件を断定しない(「〜と推察します」に留める)
- 箇条書きや【】見出しは2箇所まで。読みやすい段落文を基本とする`;

/** 自己検査: 字数レンジと案件キーワードの含有をチェックする。 */
export function validateProposal(proposal: string, job: Job): readonly string[] {
  const issues: string[] = [];
  if (proposal.length < MIN_LENGTH) issues.push(`${MIN_LENGTH}字未満(現在${proposal.length}字)`);
  if (proposal.length > MAX_LENGTH + 100) issues.push(`${MAX_LENGTH}字を大幅超過(現在${proposal.length}字)`);

  if (!mentionsTitle(proposal, job.title)) issues.push('案件タイトルのキーワードが含まれていない');

  return issues;
}

/**
 * タイトルへの言及チェック: 日本語は分かち書きできないため、
 * タイトルの4文字スライディングウィンドウのいずれかが提案文に含まれればOKとする。
 */
function mentionsTitle(proposal: string, title: string): boolean {
  const normalized = title.replace(/[\s【】\[\]()()、。・/|「」]+/g, '');
  if (normalized.length < 4) return true; // 短すぎるタイトルは判定不能としてパス
  for (let i = 0; i + 4 <= normalized.length; i++) {
    if (proposal.includes(normalized.slice(i, i + 4))) return true;
  }
  return false;
}
