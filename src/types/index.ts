/**
 * 作文設定（設定画面で入力する項目）
 */
export type EssayConfig = {
  /** 作文テーマ */
  theme: string;
  /** 目標文字数 */
  wordCount: number;
  /** 対象レベル */
  targetLevel: TargetLevel;
  /** その他ルール（任意） */
  extraRules: string;
};

/** 対象レベル（select の選択肢） */
export type TargetLevel =
  | "grade_1"
  | "grade_2"
  | "grade_3"
  | "grade_4"
  | "grade_5"
  | "grade_6"
  | "junior_high"
  | "high_school"
  | "general"
  | "other";

/**
 * チャットメッセージ（質問フェーズの履歴）
 * 状態管理用の配列要素
 */
export type ChatMessage = {
  role: "ai" | "user";
  content: string;
};

/**
 * アプリのフェーズ
 * - config: 設定入力
 * - questions: 質問・回答のやり取り
 * - mode_select: 作文完成 or ヒントモード選択
 * - essay: 作文完成結果表示
 * - hints: ヒントモード結果表示
 * - image_review: 手書き作文の画像添削
 */
export type AppPhase =
  | "config"
  | "questions"
  | "mode_select"
  | "essay"
  | "hints"
  | "image_review";

/**
 * 手書き作文画像添削の結果（Gemini Vision の返答をパースした形）
 */
export type ImageReviewResult = {
  extractedText: string;
  typos: string;
  wordCountEval: string;
  ruleEval: string;
  goodPoints: string;
  improvements: string;
};
