# さくっと作文（sakutto-sakubun）

AIが質問形式で情報を引き出し、作文作成を支援する Web アプリです。

- **作文完成モード**: 質疑で集めた情報から、指定文字数前後で作文を生成
- **ヒントモード**: 作文の手順とコツをステップ形式で表示（ワンステップ表示／まるごと表示）
- **手書き作文の画像添削**: 手書き作文の画像をアップロードすると、OCR・誤字脱字・ルール評価・良い点・改善点を添削（Gemini Vision）
- **ユーザー機能（ログイン必須）**: テーマ履歴・保存したルールの利用・作文ルールの保存

## 技術構成

| 項目 | 技術 |
|------|------|
| フレームワーク | Next.js 16（App Router） |
| 言語 | TypeScript |
| スタイル | Tailwind CSS v4 |
| AI | Google Gemini API（`@google/genai`） |
| 認証 | Supabase Auth |
| DB（ユーザーごとデータ） | Neon（PostgreSQL）、`@neondatabase/serverless` |
| API 呼び出し | Server Actions（Gemini・DB はサーバー側のみ） |

## ディレクトリ構成

```
sakutto-sakubun/
├── src/
│   ├── app/
│   │   ├── actions.ts        # Server Actions（Gemini・テーマ履歴・保存ルール）
│   │   ├── globals.css       # グローバルスタイル・CSS 変数・アニメーション
│   │   ├── layout.tsx        # ルートレイアウト・メタデータ（noindex）
│   │   ├── page.tsx          # メイン画面（設定・質問・作文/ヒント/画像添削）
│   │   ├── login/page.tsx    # ログインページ
│   │   ├── signup/page.tsx   # 新規登録ページ
│   │   └── rules/save/page.tsx  # 作文ルールの保存ページ
│   ├── lib/
│   │   ├── gemini.ts         # Gemini API（質問・作文・ヒント・画像添削）
│   │   ├── db.ts             # Neon DB（テーマ履歴・保存ルール）
│   │   └── supabase/
│   │       ├── client.ts     # ブラウザ用 Supabase クライアント
│   │       └── server.ts     # サーバー用 Supabase クライアント
│   ├── proxy.ts              # 認証ガード・セッション更新
│   └── types/
│       ├── index.ts          # EssayConfig, ChatMessage, AppPhase, TargetLevel 等
│       └── speech.d.ts       # 音声入力（Web Speech API）型
├── supabase/
│   └── schema.sql            # Neon 用テーブル定義（theme_history, saved_rules）
├── .env.example
├── next.config.ts
├── package.json
└── README.md
```

## セットアップ（ステップバイステップ）

### 1. リポジトリのクローンとパッケージインストール

```bash
git clone <リポジトリURL>
cd sakutto-sakubun
npm install
```

### 2. 環境変数の設定

1. [Google AI Studio](https://aistudio.google.com/apikey) で API キーを取得する  
2. プロジェクト直下に `.env.local` を作成する  
3. 次の内容を記述する（`your_gemini_api_key_here` を実際のキーに置き換え）

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

**ログイン・ユーザーごと機能を使う場合**は、さらに以下を設定します。

- **Supabase**: [Supabase](https://supabase.com) でプロジェクトを作成し、設定の「API」から URL と anon key を取得。`.env.local` に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を追加。
- **Neon**: [Neon](https://neon.tech) で PostgreSQL データベースを作成し、接続文字列を `DATABASE_URL` として `.env.local` に追加。`supabase/schema.sql` を Neon の SQL エディタで実行してテーブル（`theme_history`, `saved_rules`）を作成。

参考用の例は `.env.example` にあります。

```bash
# Windows (PowerShell)
copy .env.example .env.local
# その後 .env.local を編集

# macOS / Linux
cp .env.example .env.local
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。未ログイン時はログイン／新規登録ページへ誘導されます。

### 4. 本番ビルド（任意）

```bash
npm run build
npm start
```

### 5. Vercel へのデプロイ

1. **Vercel アカウント**  
   [Vercel](https://vercel.com) にサインアップ（GitHub / GitLab / Bitbucket 連携がおすすめ）。

2. **リポジトリを Git で管理**  
   まだの場合、プロジェクトを Git で初期化し、GitHub 等にプッシュする。

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <あなたのリポジトリURL>
   git push -u origin main
   ```

3. **Vercel でプロジェクトをインポート**  
   - [Vercel Dashboard](https://vercel.com/dashboard) で **Add New…** → **Project** を選択。  
   - 対象の Git リポジトリを選び **Import**。  
   - Framework Preset は **Next.js** のまま（自動検出）。  
   - **Deploy** はまだ押さない。

4. **環境変数を設定**  
   Import 画面の **Environment Variables** で、次の変数を追加する（本番用の値に置き換える）。

   | 名前 | 値 | 備考 |
   |------|-----|------|
   | `GEMINI_API_KEY` | （Google AI Studio の API キー） | 必須 |
   | `NEXT_PUBLIC_SUPABASE_URL` | （Supabase の Project URL） | 認証用 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | （Supabase の anon key） | 認証用 |
   | `DATABASE_URL` | （Neon の接続文字列） | テーマ履歴・保存ルール用 |

   - すべて **Production**（必要なら Preview / Development にも同じ値を設定）。  
   - 保存したら **Deploy** を実行。

5. **デプロイ後**  
   - ビルドが成功すると、`https://＜プロジェクト名＞.vercel.app` のような URL で公開される。  
   - 未ログインでアクセスすると `/login` にリダイレクトされる。  
   - **Supabase の認証設定**: Supabase ダッシュボードの **Authentication** → **URL Configuration** で、**Site URL** に Vercel の URL（例: `https://xxx.vercel.app`）、**Redirect URLs** に `https://xxx.vercel.app/**` を追加する。

6. **今後の更新**  
   Git の `main`（またはデフォルトブランチ）にプッシュすると、Vercel が自動でビルド・デプロイする。

**Vercel CLI でデプロイする場合**

```bash
npm i -g vercel
vercel
```

初回はログインとプロジェクト設定の質問に答える。環境変数は `vercel env add` で追加するか、ダッシュボードで設定する。

## 使い方

### 認証

- **新規登録**（`/signup`）: Name・Email・Password・Confirm Password を入力し「登録する」。登録後はトップへ遷移。
- **ログイン**（`/login`）: Email・Password を入力し「ログイン」。未ログインでトップにアクセスするとログイン画面へリダイレクトされます。

### 作文の作成フロー

1. **設定画面（トップ）**
   - **作文テーマ**: 必須。入力欄をフォーカスすると、過去に入力したテーマ（同一ユーザー・直近7件・重複なし）が表示され、選択できる。
   - **文字数**・**対象レベル**（小学1年〜6年・中学生・高校生・一般・その他）を設定。
   - **その他ルール**（任意）: 自由入力。保存済みルールが1件以上ある場合は「保存したルールを使う」からルール名を選んで流用できる。保存済みルールを選んだ状態で「作文をはじめる」の場合は、ルール保存の確認は出さずそのまま質疑へ進む。
   - 「作文をはじめる」を押すと、その他ルールを入力済みのときは「設定したルールを今後も使えるように保存しますか」と確認。「いいえ」で質疑へ、「はい」で作文ルールの保存ページへ（ルール名を付けて保存後、質疑応答へ自動遷移）。

2. **質問フェーズ**
   - AI が 1 問ずつ質問。回答を入力して送信（回答欄は入力に応じて縦に伸びる）。AI の質問表示後、入力欄に自動フォーカス。
   - 「その質問は飛ばす」「これまでの質問で作文を書きたい」も選択可能。
   - 十分な情報が集まると「作文を書くか、ヒントを見るか選んでください」と表示される。

3. **モード選択**
   - 「作文を完成させる」: 集めた情報から作文を生成。
   - 「ヒントモード」: 手順とコツをステップ形式で取得。
   - 「手書き作文を添削する」: 手書き作文の画像（PNG/JPG）をアップロードして添削（OCR・誤字脱字・文字数・ルール・良い点・改善点）。添削結果の上に、AI 添削の精度についての注意書きを表示（小学1〜3年はひらがな表記）。

4. **結果**
   - **作文完成**: 指定文字数前後で作文を表示。音声入力・追加内容を入れての再生成が可能。
   - **ヒントモード**: 「ワンステップずつ表示」または「まるごと表示」を選択。表示は ◆ で冒頭・ステップタイトル（やや大きめ・太字）、＜＞ で項目（太字）、・ で箇条書き。ステップとステップの間に空行を挿入。
   - **画像添削**: 抽出テキスト・誤字脱字・文字数評価・ルール評価・良い点・改善点を表示。

5. 「1つ前の画面に戻る」「最初からやり直す」で設定画面やモード選択に戻れる。

### 作文ルールの保存

- その他ルールを入力した状態で「作文をはじめる」→「はい」を選ぶと、作文ルールの保存ページへ遷移。ルール名を付けて保存すると、トップの「保存したルールを使う」から呼び出せる。保存後は質疑応答画面へ自動で遷移する。

## 主なファイルの役割

| ファイル | 役割 |
|----------|------|
| `src/app/page.tsx` | メイン UI。設定・質問・モード選択・作文/ヒント/画像添削表示・テーマ履歴・保存ルール選択・ルール保存確認モーダル・ヒント整形表示（◆/＜＞/・） |
| `src/app/actions.ts` | Server Actions。Gemini 呼び出し、テーマ履歴・保存ルールの取得・保存（認証済みユーザー向け） |
| `src/app/login/page.tsx` | ログインページ |
| `src/app/signup/page.tsx` | 新規登録ページ |
| `src/app/rules/save/page.tsx` | 作文ルールの保存（ルール名・内容表示・保存後は質疑へ遷移） |
| `src/lib/gemini.ts` | 質問・作文・ヒント・画像添削の Gemini API 呼び出し。THOUGHT ブロック除去、対象レベル（小学1年〜6年等）のラベル変換 |
| `src/lib/db.ts` | Neon 用。テーマ履歴の追加・取得（直近7件・同一テーマは1回）、保存ルールの取得・保存 |
| `src/lib/supabase/client.ts` | ブラウザ用 Supabase クライアント（認証） |
| `src/lib/supabase/server.ts` | サーバー用 Supabase クライアント（Server Actions 等） |
| `src/proxy.ts` | セッション更新、未ログイン時は `/login` へリダイレクト |
| `src/types/index.ts` | `EssayConfig`・`TargetLevel`（grade_1〜6 等）・`AppPhase`・`ImageReviewResult` 等 |
| `supabase/schema.sql` | `theme_history`・`saved_rules` テーブル定義（Neon で実行） |

## セキュリティ

- Gemini API キー・Supabase のキー・Neon の接続文字列は **`.env.local` にのみ** 格納し、リポジトリにコミットしません。
- API 呼び出しと DB アクセスは **Server Actions 経由でサーバー側のみ** 行い、クライアントにキーを露出しません。
- 認証は Supabase Auth（セッション・Cookie）を使用し、ミドルウェアで未認証時はログインページへ誘導します。

## メタデータ・SEO

- タイトル: **さくっと作文**
- `layout.tsx` の `metadata` で `robots: "noindex, nofollow"` を指定しており、検索エンジンへのインデックスは行いません。

## ライセンス

MIT を想定（リポジトリのライセンスファイルに従ってください）。
