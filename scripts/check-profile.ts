/** profile.yaml がスキーマ検証を通るかの簡易チェック。 */
import { loadProfile } from '../src/generator/profile.js';

const profile = loadProfile('./profile.yaml');
console.log(`works: ${profile.works.length}件 / strengths: ${profile.strengths.length}件 / careerSummary: ${profile.careerSummary.length}字`);
console.log(`experienceNote付き実績: ${profile.works.filter((w) => w.experienceNote).length}件`);
