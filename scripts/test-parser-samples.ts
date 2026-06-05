/** 保存済みの実メールサンプル(data/email-samples/)全件に対してパーサーを検証する。 */
import { readdirSync, readFileSync } from 'node:fs';
import { parseLancersEmail } from '../src/collector/parser.js';

const DIR = './data/email-samples';

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.txt'))) {
  const content = readFileSync(`${DIR}/${file}`, 'utf8');
  const subjectLine = content.split('\n')[0] ?? '';
  const body = content.split('\n\n').slice(1).join('\n\n');
  const candidates = parseLancersEmail(body);
  console.log(`\n=== ${file}: ${subjectLine.slice(0, 70)}`);
  console.log(`    抽出: ${candidates.length}件`);
  for (const c of candidates) {
    console.log(`    - [${c.category ?? '?'}] ${c.title}`);
    console.log(`      ${c.budgetText ?? '予算不明'} / 締切 ${c.deadline ?? '不明'} / ${c.url}`);
  }
}
