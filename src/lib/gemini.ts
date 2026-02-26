import { GoogleGenAI } from "@google/genai";
import type { ChatMessage, EssayConfig, TargetLevel } from "@/types";

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
    elementary_low: "小学低学年",
    elementary_high: "小学高学年",
    junior_high: "中学生",
    high_school: "高校生",
    general: "一般",
    other: "その他",
  };
  return map[level];
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
  return text;
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
  return text;
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
