import { GoogleGenAI } from "@google/genai";
import type { ChatMessage, EssayConfig, TargetLevel, ImageReviewResult } from "@/types";

const getApiKey = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY が .env.local に設定されていません");
  }
  return key;
};

/** 使用するモデル（環境変数で上書き可能。未設定時は gemini-2.5-flash） */
const getModelName = () =>
  process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

/** 新 SDK のクライアント（API キーはサーバー側でのみ使用） */
function getClient() {
  return new GoogleGenAI({ apiKey: getApiKey() });
}

/** 対象レベルを日本語ラベルに変換（プロンプト用） */
function targetLevelToLabel(level: TargetLevel): string {
  const map: Record<TargetLevel, string> = {
    grade_1: "小学1年",
    grade_2: "小学2年",
    grade_3: "小学3年",
    grade_4: "小学4年",
    grade_5: "小学5年",
    grade_6: "小学6年",
    junior_high: "中学生",
    high_school: "高校生",
    general: "一般",
    other: "その他",
  };
  return map[level];
}

/** Gemini が THOUGHT: を出力した場合、思考部分を除き本文（質問など）だけを返す */
function stripThoughtBlock(raw: string): string {
  const trimmed = raw.trim();
  const parts = trimmed.split(/\s*THOUGHT:\s*/i);
  if (parts.length <= 1) return trimmed;
  const afterThought = parts[parts.length - 1].trim();
  const lines = afterThought.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return trimmed;
  // 思考の続きでない行：日本語を含むか「これで十分です」で、かつ英語の説明行で始まらない
  const isReasoningLine = (l: string) =>
    /^(Let's|I |This |So |We |Given|Consider|A question|Question|The |It |To )/i.test(l);
  const startIdx = lines.findIndex(
    (l) =>
      (/[ぁ-んァ-ン一-龥]/.test(l) || /これで十分です/.test(l)) && !isReasoningLine(l)
  );
  if (startIdx >= 0) return lines.slice(startIdx).join("\n");
  return lines[lines.length - 1];
}

/**
 * 質問フェーズ: 1回につき1問だけ質問を生成する
 * 履歴（messages）と設定（config）を渡し、次のAI質問テキストを返す
 */
export async function generateNextQuestion(
  config: EssayConfig,
  messages: ChatMessage[]
): Promise<string> {
  const ai = getClient();
  const levelLabel = targetLevelToLabel(config.targetLevel);
  const conversationText =
    messages.length > 0
      ? messages
          .map((m) =>
            m.role === "ai" ? `【質問】${m.content}` : `【回答】${m.content}`
          )
          .join("\n")
      : "（まだやり取りなし）";

  const lastMsg = messages[messages.length - 1];
  const prevMsg = messages[messages.length - 2];
  const lastAiWasMorikomi =
    lastMsg?.role === "user" &&
    prevMsg?.role === "ai" &&
    /もりこみ|他に作文に/.test(prevMsg?.content ?? "");

  const getInstruction = () => {
    if (messages.length === 0) {
      return "最初の質問を1つだけ出力してください。質問だけを返し、余計な説明は不要です。";
    }
    if (lastAiWasMorikomi) {
      return "直前の質問「他に作文にもりこみたいことはありますか」にユーザーが答えたので、質問は終了です。「これで十分です。作文を書くか、ヒントを見るか選んでください。」とだけ返してください。他は出力しないでください。";
    }
    return "上の回答を踏まえて、次の質問を1つだけ出力してください。対象レベルに合わせた語彙で、短く明確に。十分な情報が集まっていると判断したら、いったん「他に作文にもりこみたいことはありますか」とだけ質問してください（まだ「これで十分です」とは言わないでください）。それ以外で情報が足りない場合は、通常どおり次の質問を1つ出力してください。質問以外は出力しないでください。";
  };

  const prompt = `あなたは作文の指導者です。

【設定】
テーマ: ${config.theme}
目標文字数: ${config.wordCount}字
対象レベル: ${levelLabel}
${config.extraRules ? `その他ルール: ${config.extraRules}` : ""}

【これまでのやり取り】
${conversationText}

このテーマで作文を書くために必要な情報を、1回につき1問だけ質問してください。
${getInstruction()}`;

  const response = await ai.models.generateContent({
    model: getModelName(),
    contents: prompt,
  });
  const text = response.text?.trim();
  if (!text) throw new Error("Gemini から空の応答が返りました");
  return stripThoughtBlock(text);
}

/**
 * 「これまでの質問で作文を書きたい」用:
 * 情報が十分なら終了案内を、足りなければ「もう少しだけ情報が必要です」＋最低限の質問を1つ返す
 */
export async function generateCheckReadyOrContinue(
  config: EssayConfig,
  messages: ChatMessage[]
): Promise<string> {
  const ai = getClient();
  const levelLabel = targetLevelToLabel(config.targetLevel);
  const conversationText =
    messages.length > 0
      ? messages
          .map((m) =>
            m.role === "ai" ? `【質問】${m.content}` : `【回答】${m.content}`
          )
          .join("\n")
      : "（まだやり取りなし）";

  const prompt = `あなたは作文の指導者です。

【設定】
テーマ: ${config.theme}
目標文字数: ${config.wordCount}字
対象レベル: ${levelLabel}
${config.extraRules ? `その他ルール: ${config.extraRules}` : ""}

【これまでのやり取り】
${conversationText}

【ユーザーからの希望】
ユーザーは「これまでの質問の情報だけで作文を書きたい」と言っています。

次のどちらか一方だけを実行してください。

・情報が十分だと判断した場合：「これで十分です。作文を書くか、ヒントを見るか選んでください。」とだけ返してください。他の文は付けないでください。

・まだ指定文字数に足りる情報が足りないと判断した場合：まず「もう少しだけ情報が必要です。」と述べたあと、改行して、指定文字数に足りる最低限のためにもう1つだけ質問をしてください。対象レベルに合わせた語彙で、短く明確な質問にしてください。`;

  const response = await ai.models.generateContent({
    model: getModelName(),
    contents: prompt,
  });
  const text = response.text?.trim();
  if (!text) throw new Error("Gemini から空の応答が返りました");
  return stripThoughtBlock(text);
}

/**
 * 作文完成モード: これまでの会話と設定から作文本文を生成
 * extraContent がある場合は「以下の内容を必ず盛り込む」としてプロンプトに追加
 */
export async function generateEssay(
  config: EssayConfig,
  messages: ChatMessage[],
  extraContent?: string
): Promise<string> {
  const ai = getClient();
  const levelLabel = targetLevelToLabel(config.targetLevel);
  const conversationText = messages
    .map((m) => (m.role === "ai" ? `質問: ${m.content}` : `回答: ${m.content}`))
    .join("\n");

  const extraBlock =
    extraContent?.trim() ?
      `

【必ず盛り込んでほしい内容（ユーザー指定）】
${extraContent.trim()}

上記の「必ず盛り込んでほしい内容」を反映したうえで、`
    : "";

  const prompt = `【設定】
テーマ: ${config.theme}
目標文字数: ${config.wordCount}字（前後で可）
対象: ${levelLabel}
${config.extraRules ? `その他: ${config.extraRules}` : ""}

【これまでのやり取り】
${conversationText}
${extraBlock}
上記の情報を元に、指定文字数前後で作文を完成させてください。
作文の本文だけを出力し、見出しや説明は付けないでください。`;

  const response = await ai.models.generateContent({
    model: getModelName(),
    contents: prompt,
  });
  const text = response.text?.trim();
  if (!text) throw new Error("Gemini から空の応答が返りました");
  return text;
}

/**
 * ヒントモード: 作文の手順・コツをステップ形式で生成（作文は書かない）
 * extraContent がある場合は「以下の内容を反映したヒント」としてプロンプトに追加
 */
export async function generateHints(
  config: EssayConfig,
  messages: ChatMessage[],
  extraContent?: string
): Promise<string> {
  const ai = getClient();
  const levelLabel = targetLevelToLabel(config.targetLevel);
  const conversationText = messages
    .map((m) => (m.role === "ai" ? `質問: ${m.content}` : `回答: ${m.content}`))
    .join("\n");

  const extraBlock =
    extraContent?.trim() ?
      `

【ヒントに必ず反映してほしい内容（ユーザー指定）】
${extraContent.trim()}

上記の内容を踏まえたうえで、`
    : "";

  const prompt = `【設定】
テーマ: ${config.theme}
対象: ${levelLabel}
${config.extraRules ? `その他: ${config.extraRules}` : ""}

【これまでのやり取り】
${conversationText}
${extraBlock}
作文は生成せず、このテーマで作文を書くための「手順」と「コツ」を、ステップ形式（1. 2. 3. …）で教えてください。
対象レベルに合わせた表現にしてください。`;

  const response = await ai.models.generateContent({
    model: getModelName(),
    contents: prompt,
  });
  const text = response.text?.trim();
  if (!text) throw new Error("Gemini から空の応答が返りました");
  return text;
}

/**
 * 手書き作文画像の添削（Gemini Vision）
 * OCR・誤字脱字・文字数・ルール・良い点・改善点を返す
 * targetLevel に応じて評価文の表現を年齢に合わせる
 */
export async function generateImageReview(
  imageBase64: string,
  mimeType: string,
  options: { theme?: string; wordCount?: number; rules?: string; targetLevel?: TargetLevel }
): Promise<ImageReviewResult> {
  const ai = getClient();
  const { theme = "", wordCount, rules = "", targetLevel } = options;
  const levelLabel = targetLevel ? targetLevelToLabel(targetLevel) : "一般";

  const prompt = `この画像は手書きの作文です。以下を実行し、**必ず指定のJSON形式のみ**で返してください。他の説明やマークダウンは付けないでください。

【対象者】
この作文を書いたのは**${levelLabel}**の子です。誤字脱字・文字数評価・ルール評価・良い点・改善点の**すべて**のテキストは、その年齢の子どもが自分で読んで理解できる表現で書いてください。
- 小学1年・2年：ひらがなを中心に、短い文で、やさしいことばだけを使う。「〜だね」「〜しよう」など話しかけるような調子で。
- 小学3年・4年：小学校で習う漢字を少しずつ使ってよい。短めの文で、子どもに伝わる言い回しに。
- 小学5年・6年：小学校で習う漢字を使ってよい。短めの文で、子どもに伝わる言い回しに。
- 中学生：常用漢字を使ってよい。少し丁寧な表現で、励ましを込めて。
- 高校生・一般：大人に近い表現でよいが、押し付けがましくならないように。

【誤字脱字・表記のチェック（厳密に）】
- 誤字脱字と文章表現の間違いについては**厳密に**チェックしてください。甘く見ないでください。
- 画像に書かれた文字を正しい表記と照らし合わせ、次のような誤りは見逃さずすべて指摘してください：
  - 似た字の誤り（例：き↔さ、め↔ぬ、わ↔れ、あ↔お）
  - 漢字の形の誤り（トメ・ハネ・画数の誤り。例：「目」の横線の本数、「田」の縦横の本数）
  - 送り仮名の誤り、同音異義語の誤用、文法・表現の不自然さ
- 「誤字脱字はなし」「特になし」と書くのは、**本当に誤りが一つもない場合だけ**にしてください。少しでも疑わしければ指摘してください。

【その他の評価の心がけ】
- ルール違反（指定されたルールがある場合）はきちんと指摘してください。
- 良い点はしっかり具体的に伝えてください。
- 改善点（表現の工夫や構成など）は、本当に必要な場合だけ簡潔に。おおざっぱに作文として成り立っていれば合格と評価してかまいません。

【出力形式（このJSONのみを1つ出力）】
{"extractedText":"...","typos":"...","wordCountEval":"...","ruleEval":"...","goodPoints":"...","improvements":"..."}
（各値は文字列。改行は\\\\nで表す。説明は不要でJSONのみ出力。extractedText は画像の文字をそのまま。それ以外の5項目は上記の対象者に合わせた表現で）
${theme ? `\n【テーマ】${theme}` : ""}
`;

  const contents: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [
    { inlineData: { mimeType, data: imageBase64 } },
    { text: prompt },
  ];

  const response = await ai.models.generateContent({
    model: getModelName(),
    contents,
  });
  const raw = response.text?.trim();
  if (!raw) throw new Error("Gemini から空の応答が返りました");

  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as ImageReviewResult;
    if (
      typeof parsed.extractedText !== "string" ||
      typeof parsed.typos !== "string" ||
      typeof parsed.wordCountEval !== "string" ||
      typeof parsed.ruleEval !== "string" ||
      typeof parsed.goodPoints !== "string" ||
      typeof parsed.improvements !== "string"
    ) {
      throw new Error("必須フィールドが不足しています");
    }
    return parsed;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error("添削結果の解析に失敗しました。もう一度お試しください。");
    }
    throw e;
  }
}
