/**
 * profile.yaml の鮮度チェックCLI: npm run profile:check [-- --kb=<path>]
 * KBが同期後に更新されていれば stale を報告し、終了コード1で終わる(CI等での検知用)。
 */
import 'dotenv/config';
import { checkProfileStaleness } from '../src/sync/staleness.js';

const kbArg = process.argv.find((a) => a.startsWith('--kb='))?.slice('--kb='.length);
const kbDir = kbArg ?? process.env.KB_PATH ?? '../knowledge-base';

const report = checkProfileStaleness(kbDir, './.kb-sync.json');
console.log(`[profile:check] ${report.status}: ${report.message}`);
if (report.status === 'stale' || report.status === 'unsynced') {
  process.exitCode = 1;
}
