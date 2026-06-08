import type { Job, ScoreResult } from '../types.js';
import type { JobAnalysis } from './analysis.js';
import type { Profile } from './profile.js';

/** 生成結果。分析(Stage 1)は失敗してもnullで続行する。 */
export interface GeneratedProposal {
  readonly content: string;
  readonly analysis: JobAnalysis | null;
}

/**
 * 提案文ジェネレーターの差し替え点。
 * v2は2段階生成(案件分析→人物像逆算→執筆)。将来、
 * 受注実績フィードバック・A/Bテンプレート等をここに差し替える。
 */
export interface ProposalGenerator {
  generate(job: Job, profile: Profile, score: ScoreResult, editInstruction?: string, previousProposal?: string): Promise<GeneratedProposal>;
}

/** 適合度スコアラーの差し替え点。v1はキーワード一致ベース。 */
export interface Scorer {
  score(job: Job, profile: Profile): ScoreResult;
}
