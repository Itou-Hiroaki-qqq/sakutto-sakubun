"use server";

import {
  generateNextQuestion,
  generateCheckReadyOrContinue,
  generateEssay,
  generateHints,
  generateImageReview,
} from "@/lib/gemini";
import { createClient } from "@/lib/supabase/server";
import {
  addThemeHistory as dbAddThemeHistory,
  getThemeHistory as dbGetThemeHistory,
  getSavedRules as dbGetSavedRules,
  saveRule as dbSaveRule,
} from "@/lib/db";
import type { ChatMessage, EssayConfig, ImageReviewResult, TargetLevel } from "@/types";

async function getUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) throw new Error("ログインしてください");
  return user.id;
}

/** テーマ履歴を取得（直近7件） */
export async function getThemeHistory(): Promise<string[]> {
  const userId = await getUserId();
  return dbGetThemeHistory(userId);
}

/** テーマを履歴に追加 */
export async function addThemeToHistory(theme: string): Promise<void> {
  const userId = await getUserId();
  await dbAddThemeHistory(userId, theme);
}

/** 保存したルール一覧を取得 */
export async function getSavedRules(): Promise<
  { id: number; name: string; content: string }[]
> {
  const userId = await getUserId();
  return dbGetSavedRules(userId);
}

/** ルールを保存 */
export async function saveRuleAction(name: string, content: string): Promise<void> {
  const userId = await getUserId();
  await dbSaveRule(userId, name, content);
}

/**
 * 質問フェーズ: 次のAI質問を1つ取得
 * サーバー側でのみ Gemini を呼ぶ
 */
export async function getNextQuestion(
  config: EssayConfig,
  messages: ChatMessage[]
): Promise<{ text: string; done: boolean }> {
  await getUserId();
  const text = await generateNextQuestion(config, messages);
  const done = /^これで十分です[。.]/.test(text.trimStart());
  return { text, done };
}

/**
 * 「これまでの質問で作文を書きたい」: 十分なら done=true、足りなければ「もう少し…」＋質問を返す
 */
export async function checkReadyOrGetMore(
  config: EssayConfig,
  messages: ChatMessage[]
): Promise<{ text: string; done: boolean }> {
  await getUserId();
  const text = await generateCheckReadyOrContinue(config, messages);
  const done = /^これで十分です[。.]/.test(text.trimStart());
  return { text, done };
}

/**
 * 作文完成モード: 作文本文を生成
 * extraContent を渡すと、その内容を盛り込んで再生成する
 */
export async function getEssay(
  config: EssayConfig,
  messages: ChatMessage[],
  extraContent?: string
): Promise<string> {
  await getUserId();
  return generateEssay(config, messages, extraContent);
}

/**
 * ヒントモード: 手順・コツをステップ形式で取得
 * extraContent を渡すと、その内容を反映したヒントを再生成する
 */
export async function getHints(
  config: EssayConfig,
  messages: ChatMessage[],
  extraContent?: string
): Promise<string> {
  await getUserId();
  return generateHints(config, messages, extraContent);
}

/**
 * 手書き作文画像の添削（Gemini Vision）
 * 画像は base64 で渡す（クライアントでファイル読み込み）
 * targetLevel を渡すと評価文をその年齢向けの表現にする
 */
export async function reviewHandwrittenImage(
  imageBase64: string,
  mimeType: string,
  options: { theme?: string; wordCount?: number; rules?: string; targetLevel?: TargetLevel }
): Promise<ImageReviewResult> {
  await getUserId();
  return generateImageReview(imageBase64, mimeType, options);
}
