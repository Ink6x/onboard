import type { Job, ScoreResult } from '../types.js';
import type { Profile } from './profile.js';

/**
 * 提案文ジェネレーターの差し替え点。
 * v1はシンプルなClaude API呼び出し。将来、7パーツ構成の厳密化・
 * 受注実績フィードバック・A/Bテンプレート等をここに差し替える。
 */
export interface ProposalGenerator {
  generate(job: Job, profile: Profile, score: ScoreResult, editInstruction?: string, previousProposal?: string): Promise<string>;
}

/** 適合度スコアラーの差し替え点。v1はキーワード一致ベース。 */
export interface Scorer {
  score(job: Job, profile: Profile): ScoreResult;
}
