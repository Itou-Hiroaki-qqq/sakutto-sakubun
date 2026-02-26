"use client";

import { useState, useRef, useEffect } from "react";
import { getNextQuestion, checkReadyOrGetMore, getEssay, getHints } from "./actions";
import type { EssayConfig, ChatMessage, AppPhase, TargetLevel } from "@/types";

const TARGET_LEVEL_OPTIONS: { value: TargetLevel; label: string }[] = [
  { value: "elementary_low", label: "小学低学年" },
  { value: "elementary_high", label: "小学高学年" },
  { value: "junior_high", label: "中学生" },
  { value: "high_school", label: "高校生" },
  { value: "general", label: "一般" },
  { value: "other", label: "その他" },
];

export default function Home() {
  const [phase, setPhase] = useState<AppPhase>("config");
  const [config, setConfig] = useState<EssayConfig>({
    theme: "",
    wordCount: 400,
    targetLevel: "elementary_high",
    extraRules: "",
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [essayResult, setEssayResult] = useState("");
  const [hintsResult, setHintsResult] = useState("");
  const [essayExtraContent, setEssayExtraContent] = useState("");
  const [hintsExtraContent, setHintsExtraContent] = useState("");
  /** ヒントの表示方法: null=未選択, "step"=ワンステップずつ, "full"=まるごと */
  const [hintDisplayMode, setHintDisplayMode] = useState<null | "step" | "full">(null);
  /** ワンステップ表示で現在まで表示しているステップの index（0 始まり） */
  const [hintStepIndex, setHintStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  /** ヒント本文をステップの配列に分割（1. 2. や改行で区切る） */
  const parseHintSteps = (text: string): string[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const byNumbered = trimmed
      .split(/\n(?=\d+[\.\)]\s)/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (byNumbered.length > 1) return byNumbered;
    const byDoubleNewline = trimmed.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
    if (byDoubleNewline.length > 1) return byDoubleNewline;
    return [trimmed];
  };

  /** 質疑エリアを常に最新（下）までスクロール */
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  /** 設定送信 → 質問フェーズへ & 最初の質問を取得 */
  const handleStart = async () => {
    if (!config.theme.trim()) {
      setError("作文テーマを入力してください");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      setPhase("questions");
      setMessages([]);
      const { text, done } = await getNextQuestion(config, []);
      setMessages([{ role: "ai", content: text }]);
      if (done) setPhase("mode_select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "質問の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** これまでの質問で作文を書きたい → 十分ならモード選択へ、足りなければ「もう少し…」＋質問を続ける */
  const handleRequestEssayOrContinue = async () => {
    setError(null);
    setLoading(true);
    const userMessage: ChatMessage = {
      role: "user",
      content: "これまでの質問で作文を書きたいです。",
    };
    try {
      const { text, done } = await checkReadyOrGetMore(config, messages);
      setMessages((prev) => [
        ...prev,
        userMessage,
        { role: "ai", content: text },
      ]);
      if (done) setPhase("mode_select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** この質問を飛ばして次の質問を取得 */
  const handleSkipQuestion = async () => {
    setError(null);
    setLoading(true);
    const skipUserMessage: ChatMessage = {
      role: "user",
      content: "この質問はスキップして次の質問をしてください",
    };
    const newMessages: ChatMessage[] = [...messages, skipUserMessage];
    setMessages(newMessages);
    try {
      const { text, done } = await getNextQuestion(config, newMessages);
      setMessages((prev) => [...prev, { role: "ai", content: text }]);
      if (done) setPhase("mode_select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "質問の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 回答送信 → 次の質問を取得 */
  const handleSubmitAnswer = async () => {
    const answer = currentAnswer.trim();
    if (!answer) return;
    setError(null);
    setLoading(true);
    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: answer },
    ];
    setMessages(newMessages);
    setCurrentAnswer("");
    try {
      const { text, done } = await getNextQuestion(config, newMessages);
      setMessages((prev) => [...prev, { role: "ai", content: text }]);
      if (done) setPhase("mode_select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "質問の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 作文を完成させる */
  const handleCompleteEssay = async () => {
    setError(null);
    setLoading(true);
    setPhase("essay");
    setEssayResult("");
    try {
      const text = await getEssay(config, messages);
      setEssayResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作文の生成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** ヒントモード */
  const handleHints = async () => {
    setError(null);
    setLoading(true);
    setPhase("hints");
    setHintsResult("");
    setHintDisplayMode(null);
    setHintStepIndex(0);
    try {
      const text = await getHints(config, messages);
      setHintsResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ヒントの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 作文を追加内容で再生成 */
  const handleRecreateEssay = async () => {
    setError(null);
    setLoading(true);
    setEssayResult("");
    try {
      const text = await getEssay(config, messages, essayExtraContent.trim() || undefined);
      setEssayResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作文の再生成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** ヒントを追加内容で再生成 */
  const handleRecreateHints = async () => {
    setError(null);
    setLoading(true);
    setHintsResult("");
    setHintDisplayMode(null);
    setHintStepIndex(0);
    try {
      const text = await getHints(config, messages, hintsExtraContent.trim() || undefined);
      setHintsResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ヒントの再生成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 最初からやり直す */
  const handleReset = () => {
    setPhase("config");
    setMessages([]);
    setEssayResult("");
    setHintsResult("");
    setEssayExtraContent("");
    setHintsExtraContent("");
    setHintDisplayMode(null);
    setHintStepIndex(0);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        {/* ヘッダー */}
        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            さくっと作文
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AIが質問で情報を引き出し、作文をサポートします
          </p>
        </header>

        {/* エラー表示 */}
        {error && (
          <div
            className="mb-4 rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* ① 設定画面 */}
        {phase === "config" && (
          <section
            className="rounded-lg border border-card-border bg-card p-5 shadow-sm sm:p-6"
            aria-label="作文の設定"
          >
            <h2 className="mb-4 text-lg font-semibold">作文の設定</h2>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="theme"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  作文テーマ <span className="text-red-500">*</span>
                </label>
                <input
                  id="theme"
                  type="text"
                  value={config.theme}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, theme: e.target.value }))
                  }
                  placeholder="例：夏休みの思い出"
                  className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label
                  htmlFor="wordCount"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  文字数
                </label>
                <input
                  id="wordCount"
                  type="number"
                  min={100}
                  max={2000}
                  step={100}
                  value={config.wordCount}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      wordCount: Number(e.target.value) || 400,
                    }))
                  }
                  className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label
                  htmlFor="targetLevel"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  対象レベル
                </label>
                <select
                  id="targetLevel"
                  value={config.targetLevel}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      targetLevel: e.target.value as EssayConfig["targetLevel"],
                    }))
                  }
                  className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  {TARGET_LEVEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="extraRules"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  その他ルール <span className="text-muted-foreground">（任意）</span>
                </label>
                <textarea
                  id="extraRules"
                  value={config.extraRules}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, extraRules: e.target.value }))
                  }
                  placeholder="例：段落は3つに分ける"
                  rows={2}
                  className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
            </div>
            <div className="mt-6">
              <button
                type="button"
                onClick={handleStart}
                disabled={loading}
                className="w-full rounded-sm bg-primary px-4 py-3 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50 sm:w-auto sm:min-w-[200px]"
              >
                {loading ? "準備中…" : "作文をはじめる"}
              </button>
            </div>
          </section>
        )}

        {/* ② 質問フェーズ（チャット風） */}
        {(phase === "questions" || phase === "mode_select") && (
          <section
            className="rounded-lg border border-card-border bg-card shadow-sm"
            aria-label="質問と回答"
          >
            <div className="flex max-h-[50vh] flex-col overflow-hidden sm:max-h-[60vh]">
              <div
                ref={chatScrollRef}
                className="flex-1 space-y-4 overflow-y-auto p-4"
              >
                {messages.map((msg, i) => {
                  const isLatestAiMessage =
                    msg.role === "ai" &&
                    phase === "questions" &&
                    i === messages.length - 1;
                  return (
                    <div
                      key={i}
                      className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`flex max-w-[85%] flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`rounded-2xl px-4 py-2.5 text-sm ${
                            msg.role === "ai"
                              ? "bg-muted text-foreground"
                              : "bg-primary text-primary-foreground"
                          }`}
                        >
                          <span className="whitespace-pre-wrap">{msg.content}</span>
                        </div>
                        {isLatestAiMessage && (
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={handleSkipQuestion}
                              disabled={loading}
                              className="text-xs text-muted-foreground underline transition hover:text-foreground disabled:opacity-50"
                            >
                              その質問は飛ばす
                            </button>
                            <button
                              type="button"
                              onClick={handleRequestEssayOrContinue}
                              disabled={loading}
                              className="text-xs text-muted-foreground underline transition hover:text-foreground disabled:opacity-50"
                            >
                              これまでの質問で作文を書きたい
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {loading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                        <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.2s]" />
                        <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.4s]" />
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {phase === "questions" && !loading && (
                <div className="border-t border-card-border p-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={currentAnswer}
                      onChange={(e) => setCurrentAnswer(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && !e.shiftKey && handleSubmitAnswer()
                      }
                      placeholder="回答を入力..."
                      className="flex-1 rounded-sm border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                      aria-label="回答入力"
                    />
                    <button
                      type="button"
                      onClick={handleSubmitAnswer}
                      disabled={!currentAnswer.trim()}
                      className="rounded-sm bg-primary px-4 py-2 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                    >
                      送信
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ③ 作成モード選択 */}
            {phase === "mode_select" && !loading && (
              <div className="border-t border-card-border p-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  次のどちらにしますか？
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleCompleteEssay}
                    disabled={loading}
                    className="rounded-sm bg-primary px-4 py-2.5 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    作文を完成させる
                  </button>
                  <button
                    type="button"
                    onClick={handleHints}
                    disabled={loading}
                    className="rounded-sm border border-card-border bg-card px-4 py-2.5 font-medium transition hover:bg-muted disabled:opacity-50"
                  >
                    ヒントモード
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ④ 作文完成モード結果 */}
        {phase === "essay" && (
          <section
            className="rounded-lg border border-card-border bg-card p-5 shadow-sm sm:p-6"
            aria-label="完成した作文"
          >
            <h2 className="mb-4 text-lg font-semibold">完成した作文</h2>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.2s]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.4s]" />
                <span className="text-sm">作文を書いています…</span>
              </div>
            ) : (
              <div className="whitespace-pre-wrap rounded-sm bg-muted/50 p-4 text-foreground">
                {essayResult}
              </div>
            )}
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPhase("mode_select")}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  1つ前の画面に戻る
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  最初からやり直す
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleRecreateEssay}
                  disabled={loading}
                  className="w-full rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50 sm:w-auto"
                >
                  以下の内容を入れて作文をもう一度作成する
                </button>
                <textarea
                  value={essayExtraContent}
                  onChange={(e) => setEssayExtraContent(e.target.value)}
                  placeholder="盛り込みたい内容を入力（例：もっと具体的なエピソードを入れてほしい）"
                  rows={3}
                  className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                  aria-label="作文に盛り込む内容"
                />
              </div>
            </div>
          </section>
        )}

        {/* ⑤ ヒントモード結果 */}
        {phase === "hints" && (
          <section
            className="rounded-lg border border-card-border bg-card p-5 shadow-sm sm:p-6"
            aria-label="作文のヒント"
          >
            <h2 className="mb-4 text-lg font-semibold">作文の手順とコツ</h2>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.2s]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.4s]" />
                <span className="text-sm">ヒントを考えています…</span>
              </div>
            ) : hintsResult && hintDisplayMode === null ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  ヒントの表示方法を選んでください。
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setHintDisplayMode("step");
                      setHintStepIndex(0);
                    }}
                    className="rounded-sm border border-card-border bg-card px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
                  >
                    ヒントをワンステップずつ表示する
                  </button>
                  <button
                    type="button"
                    onClick={() => setHintDisplayMode("full")}
                    className="rounded-sm border border-card-border bg-card px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
                  >
                    ヒントをまるごと表示する
                  </button>
                </div>
              </div>
            ) : hintsResult && hintDisplayMode === "step" ? (
              <div className="flex flex-col gap-4">
                <div className="whitespace-pre-wrap rounded-sm bg-muted/50 p-4 text-foreground">
                  {parseHintSteps(hintsResult)
                    .slice(0, hintStepIndex + 1)
                    .join("\n\n")}
                </div>
                {parseHintSteps(hintsResult).length > hintStepIndex + 1 ? (
                  <button
                    type="button"
                    onClick={() => setHintStepIndex((i) => i + 1)}
                    className="w-full rounded-sm border border-primary bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 sm:w-auto"
                  >
                    次のステップ
                  </button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    すべてのステップを表示しました。
                  </p>
                )}
              </div>
            ) : hintsResult && hintDisplayMode === "full" ? (
              <div className="whitespace-pre-wrap rounded-sm bg-muted/50 p-4 text-foreground">
                {hintsResult}
              </div>
            ) : null}
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPhase("mode_select")}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  1つ前の画面に戻る
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  最初からやり直す
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleRecreateHints}
                  disabled={loading}
                  className="w-full rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50 sm:w-auto"
                >
                  以下の内容を入れてヒントをもう一度作成する
                </button>
                <textarea
                  value={hintsExtraContent}
                  onChange={(e) => setHintsExtraContent(e.target.value)}
                  placeholder="ヒントに反映したい内容を入力（例：段落の区切り方をもっと詳しく）"
                  rows={3}
                  className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                  aria-label="ヒントに反映する内容"
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
