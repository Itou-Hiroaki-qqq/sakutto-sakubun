"use server";

import {
  generateNextQuestion,
  generateCheckReadyOrContinue,
  generateEssay,
  generateHints,
} from "@/lib/gemini";
import type { ChatMessage, EssayConfig } from "@/types";

/**
 * 質問フェーズ: 次のAI質問を1つ取得
 * サーバー側でのみ Gemini を呼ぶ
 */
export async function getNextQuestion(
  config: EssayConfig,
  messages: ChatMessage[]
): Promise<{ text: string; done: boolean }> {
  const text = await generateNextQuestion(config, messages);
  const done =
    /これで十分です|作文を書くか|ヒントを見るか/.test(text);
  return { text, done };
}

/**
 * 「これまでの質問で作文を書きたい」: 十分なら done=true、足りなければ「もう少し…」＋質問を返す
 */
export async function checkReadyOrGetMore(
  config: EssayConfig,
  messages: ChatMessage[]
): Promise<{ text: string; done: boolean }> {
  const text = await generateCheckReadyOrContinue(config, messages);
  const done = /これで十分です|作文を書くか|ヒントを見るか/.test(text);
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
  return generateHints(config, messages, extraContent);
}
