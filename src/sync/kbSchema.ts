import { z } from 'zod';

/**
 * knowledge-base 側ドキュメントの構造定義(Zod)。
 * KBは外部データ境界として扱い、読み込み時に必ずここを通して fail-fast する。
 */

/**
 * 公開層タグ。KB上は「private（公開枠は Coming Soon のみ public）」のような
 * 付記つき表記が許されているため、前方一致で正規化する。
 */
export const disclosureSchema = z
  .string()
  .transform((raw) => raw.trim())
  .pipe(
    z.string().transform((raw, ctx) => {
      for (const tag of ['public', 'anonymized', 'private'] as const) {
        if (raw.startsWith(tag)) return tag;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `disclosure は public/anonymized/private で始まる必要があります: "${raw}"`,
      });
      return z.NEVER;
    }),
  );

export type Disclosure = z.infer<typeof disclosureSchema>;

/**
 * works/*.md の frontmatter。
 * 注意: client / period は社名・役職等の private 情報を含みうるため、
 * 意図的にスキーマから落とす(LLMにも渡らない)。
 */
export const kbWorkFrontmatterSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  disclosure: disclosureSchema,
  stack: z.array(z.coerce.string()).default([]),
  links: z.record(z.coerce.string()).default({}),
});

export type KbWorkFrontmatter = z.infer<typeof kbWorkFrontmatterSchema>;

/** 読み込み済みの実績1件(frontmatter + 本文セクション)。 */
export interface KbWork {
  readonly slug: string;
  readonly name: string;
  readonly disclosure: Disclosure;
  readonly stack: readonly string[];
  readonly links: Readonly<Record<string, string>>;
  /** `## 見出し` → 本文。見出しは「概要（1段落）」等の付記ゆれを含む生の文字列 */
  readonly sections: ReadonlyMap<string, string>;
  /** KBルートからの相対パス(エラーメッセージ・ハッシュ記録用) */
  readonly relativePath: string;
}

/** channels.md の機械可読ブロック。 */
export const lancersAllowlistSchema = z.object({
  lancers_works: z.array(z.string().min(1)).min(1),
});

/** DISCLOSURE.md の機械可読ブロック。 */
export const forbiddenTermsSchema = z.object({
  forbidden_terms: z.array(z.coerce.string().min(1)).min(1),
});

/** KB全体を読み込んだスナップショット(同期パイプラインの入力)。 */
export interface KbSnapshot {
  /** works/*.md 全件(_template.md を除く)。選別前 */
  readonly works: readonly KbWork[];
  /** channels.md 由来の Lancers 掲載 slug リスト(並び順 = profile.yaml works の並び順) */
  readonly lancersAllowlist: readonly string[];
  /** DISCLOSURE.md 由来の禁止語 */
  readonly forbiddenTerms: readonly string[];
  /** profile/profile.md 公開名 */
  readonly displayName: string;
  /** texts/intro.md 公開(日本語)肩書き */
  readonly headline: string;
  /** texts/self-pr.md ショート版(公開・社名なし) */
  readonly intro: string;
  /** texts/self-pr.md スタンス・設計思想の要素文 */
  readonly strengths: readonly string[];
  /** profile/career.md 全文(careerSummary 生成のLLM入力。private情報を含むため出力は必ず禁止語検査を通す) */
  readonly careerMd: string;
  /** texts/outcomes.md 全文(定量成果の正規値。LLM入力) */
  readonly outcomesMd: string;
  /** KBルートからの相対パス → ファイル内容(ハッシュ記録用) */
  readonly fileContents: Readonly<Record<string, string>>;
}
