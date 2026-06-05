/** Claude API疎通テスト: モデル・応答IDと短い日本語応答を確認する。 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

async function main(): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{ role: 'user', content: '「1+1=2」とだけ日本語で答えてください' }],
  });
  console.log('model:', response.model);
  console.log('id:', response.id);
  console.log('stop_reason:', response.stop_reason);
  const block = response.content[0];
  console.log('text:', block?.type === 'text' ? block.text : block?.type);
}

main().catch((error) => {
  console.error('API error:', error?.status ?? '', error?.message ?? error);
  process.exit(1);
});
