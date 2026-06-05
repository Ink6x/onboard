/**
 * Gmail APIのOAuth2初回認証フロー。
 * Google Cloud Consoleで「デスクトップアプリ」タイプのOAuthクライアントを作成し、
 * GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET を .env に設定してから実行する。
 *
 * ブラウザが開く認可URLを表示し、ローカルサーバーでコードを受け取って
 * リフレッシュトークンを表示する。表示された値を .env に追記すること。
 *
 * 使い方: npm run gmail:auth
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { google } from 'googleapis';

const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

async function main(): Promise<void> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GMAIL_CLIENT_ID と GMAIL_CLIENT_SECRET を .env に設定してください');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('以下のURLをブラウザで開いて認可してください:\n');
  console.log(url);
  console.log('\n(Lancers通知メールが届くGoogleアカウントでログインすること)');

  const code = await waitForCode();
  const { tokens } = await auth.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error('refresh_tokenが取得できませんでした。再実行してください');
  }
  console.log('\n✅ 認証成功。以下を .env に追記してください:');
  console.log(`   GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
}

function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? '/', REDIRECT_URI);
      if (requestUrl.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = requestUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400).end('認可コードがありません');
        reject(new Error('認可コードがありません'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('認証完了。このタブは閉じて構いません。');
      server.close();
      resolve(code);
    });
    server.listen(REDIRECT_PORT);
  });
}

main().catch((error) => {
  console.error('❌ 認証に失敗しました:', error);
  process.exit(1);
});
