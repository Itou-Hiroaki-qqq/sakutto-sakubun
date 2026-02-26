# さくっと作文（sakutto-sakubun）

AIが質問形式で情報を引き出し、作文作成を支援する Web アプリの MVP です。

- **作文完成モード**: 集めた情報から指定文字数前後で作文を生成
- **ヒントモード**: 作文を書く手順とコツをステップ形式で表示

## 技術構成

| 項目 | 技術 |
|------|------|
| フレームワーク | Next.js 16（App Router） |
| 言語 | TypeScript |
| スタイル | Tailwind CSS v4 |
| AI | Google Gemini API（`@google/generative-ai`） |
| 状態管理 | React useState（DB なし） |
| API 呼び出し | Server Actions（サーバー側のみで Gemini を実行） |

## ディレクトリ構成

```
sakutto-sakubun/
├── src/
│   ├── app/
│   │   ├── actions.ts      # Server Actions（Gemini 呼び出しの窓口）
│   │   ├── globals.css     # グローバルスタイル・CSS 変数
│   │   ├── layout.tsx      # ルートレイアウト・メタデータ（noindex）
│   │   └── page.tsx        # メイン画面（設定・質問・作文/ヒント）
│   ├── lib/
│   │   └── gemini.ts       # Gemini API 呼び出し（質問・作文・ヒント生成）
│   └── types/
│       └── index.ts        # 型定義（EssayConfig, ChatMessage, AppPhase 等）
├── public/
├── .env.example            # 環境変数の例（GEMINI_API_KEY）
├── .env.local               # 本番用のキーはここに（git に含めない）
├── next.config.ts
├── package.json
├── tailwind.config.ts      # （Tailwind v4 の場合は postcss 等で設定）
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

参考用の例は `.env.example` にあります。コピーして使っても構いません。

```bash
# Windows (PowerShell)
copy .env.example .env.local
# その後 .env.local を開いて GEMINI_API_KEY を編集

# macOS / Linux
cp .env.example .env.local
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

### 4. 本番ビルド（任意）

```bash
npm run build
npm start
```

## 使い方

1. **設定画面**  
   作文テーマ・文字数・対象レベル・その他ルールを入力し、「作文をはじめる」を押す。
2. **質問フェーズ**  
   AI が 1 問ずつ質問するので、回答を入力して送信。十分な情報が集まると「作文を書くか、ヒントを見るか選んでください」と表示される。
3. **モード選択**  
   「作文を完成させる」または「ヒントモード」のどちらかを選択。
4. **結果**  
   - 作文完成: 指定文字数前後で作文が表示される。  
   - ヒントモード: 手順とコツがステップ形式で表示される。  
5. 「最初からやり直す」で設定画面に戻る。

## 主なファイルの役割

| ファイル | 役割 |
|----------|------|
| `src/app/page.tsx` | 1 ページ構成の UI。設定フォーム・チャット風質問・モード選択・作文/ヒント表示・ローディング |
| `src/app/actions.ts` | Server Actions。`getNextQuestion` / `getEssay` / `getHints` でクライアントから呼び出し、サーバー側で Gemini を実行 |
| `src/lib/gemini.ts` | Gemini API の直接呼び出し。`generateNextQuestion` / `generateEssay` / `generateHints` |
| `src/types/index.ts` | `EssayConfig`・`ChatMessage`・`AppPhase`・`TargetLevel` などの型定義 |

## セキュリティ

- Gemini API キーは **`.env.local` にのみ** 格納し、リポジトリにコミットしません。
- API 呼び出しは **Server Actions 経由でサーバー側のみ** 行い、クライアントにキーを露出しません。

## メタデータ・SEO

- タイトル: **さくっと作文**
- `layout.tsx` の `metadata` で `robots: "noindex, nofollow"` を指定しており、検索エンジンへのインデックスは行いません。

## ライセンス

MIT を想定（リポジトリのライセンスファイルに従ってください）。
