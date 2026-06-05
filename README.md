# onboard — Lancers 半自律応募システム

Lancersのおすすめ案件通知メールをGmailから収集し、ポートフォリオをもとにAIが提案文を生成、Telegramで承認・編集してから応募するシステム。

```
Gmail(通知メール) → パース → SQLite(正) → スコアリング → 提案文生成(Claude)
                                                    ↓
Notion(応募管理DB) ←── 投影 ──── Telegram承認 [✅承認 / ✏️編集 / ⏭スキップ]
```

設計原則: **AIは生成、実行(応募)は人間の承認を必ず経る。全遷移を監査ログに記録。**

## セットアップ

```powershell
npm install
copy .env.example .env   # 値を埋める(下記)
```

### 1. Telegram ボット
1. [@BotFather](https://t.me/BotFather) で `/newbot` → トークンを `TELEGRAM_BOT_TOKEN` へ
2. 作ったボットに何かメッセージを送り、`https://api.telegram.org/bot<TOKEN>/getUpdates` で自分の `chat.id` を確認 → `TELEGRAM_CHAT_ID` へ

### 2. Claude API
- [console.anthropic.com](https://console.anthropic.com/) でAPIキー → `ANTHROPIC_API_KEY`

### 3. Notion(任意。未設定なら投影スキップ)
1. [notion.so/my-integrations](https://www.notion.so/my-integrations) でintegration作成 → `NOTION_TOKEN`
2. 親ページをintegrationに共有し、ページIDを `NOTION_PARENT_PAGE_ID` へ
3. `npm run notion:setup` → 出力された `NOTION_DATABASE_ID` を .env へ

### 4. Gmail(任意。未設定ならポーリング無効)
1. GCPコンソールでプロジェクト作成 → Gmail API有効化 → OAuthクライアント(デスクトップ)作成
2. `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` を設定
3. `npm run gmail:auth` → **Lancers通知が届くアカウント**で認可 → `GMAIL_REFRESH_TOKEN` を .env へ

## 動かす

```powershell
npm run e2e:dummy   # ダミー案件で 生成→Telegramカード まで疎通確認
npm run dev         # 常駐(ポーリング+承認ボット)
npm test            # ユニットテスト
```

## 運用フロー

1. 通知メールから新着案件を自動登録(URLで冪等)
2. 適合スコア < `MIN_FIT_SCORE` は自動スキップ(Notionには記録)
3. 提案文を生成してTelegramへ承認カード送信
4. ✅承認 → 手動送信モード(`SUBMIT_MODE=manual`)では案件URLが届くので貼り付けて応募 → 「🚀送信済みにする」で記録
5. ✏️編集 → 修正指示を返信すると再生成して再確認(「差し替え:」で直接差し替えも可)
6. 受注・返信などのクライアント反応はNotion上で手動更新

## 設計メモ

- **正(source of truth)**: パイプライン状態はSQLite。Notionは人間向けの投影(一方向同期)
- **profile.yaml**: 提案文生成の唯一の正。実績・数値成果・スキル・NG条件・稼働条件
- **提案文ロジック**: `src/generator/` のinterface越しに差し替え可能。v1はLancersベストプラクティス(7パーツ構成・300〜500字・数値実績・案件名を冒頭に)を織り込んだClaude呼び出し+自己検査
- **メールパーサー**: 実フォーマット未入手のため汎用ヒューリスティック。実メール入手後に `tests/parser.test.ts` のフィクスチャを差し替えて精度を上げる
- **Phase 4(未実装)**: `SUBMIT_MODE=auto` でのPlaywright自動送信。規約リスク(利用規約33条)を理解の上で導入する。レート制限(`MAX_APPLICATIONS_PER_DAY`)・営業時間内送信・証跡スクショを必須とする
