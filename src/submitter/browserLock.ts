/**
 * 永続プロファイル(.playwright-profile)へのアクセスを直列化するプロセス内ミューテックス。
 *
 * submitter(応募送信)とWebログイン巡回は同じログイン済みプロファイルを共有する。
 * Chromiumの永続コンテキストは同一user-data-dirで二重起動するとロックエラーで
 * クラッシュするため、両者がこのロックを必ず経由して同時起動を防ぐ。
 *
 * 注意: これはプロセス内の排他であり、別プロセス(npm run lancers:login 等)とは
 * 競合しうる。常駐プロセス稼働中は手動スクリプトを同時に走らせないこと。
 */

let chain: Promise<unknown> = Promise.resolve();

/**
 * fn の実行が前の実行の完了後になるよう直列化する。
 * fn の成否に関わらずチェーンは継続する(片方の失敗が後続を巻き込まない)。
 */
export function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  // チェーン継続用に成否を吸収する(戻り値は呼び出し元へそのまま返す)
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}
