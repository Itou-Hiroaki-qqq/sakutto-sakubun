"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveRuleAction } from "@/app/actions";

const PENDING_RULE_KEY = "sakubun_pending_rule";
const AUTO_START_QUESTIONS_KEY = "sakubun_auto_start_questions";

export default function RuleSavePage() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const raw =
      typeof window !== "undefined" ? sessionStorage.getItem(PENDING_RULE_KEY) : null;
    if (raw) setContent(raw);
    else router.replace("/");
  }, [router]);

  const hasContent = content.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = name.trim();
    const c = content.trim();
    if (!n) {
      setError("ルール名を入力してください");
      return;
    }
    if (!c) {
      setError("ルール内容がありません");
      return;
    }
    const goToQuestions = () => {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(PENDING_RULE_KEY);
        sessionStorage.setItem(AUTO_START_QUESTIONS_KEY, "1");
      }
      router.push("/");
      router.refresh();
    };
    setLoading(true);
    const timeoutMs = 12000;
    try {
      await Promise.race([
        saveRuleAction(n, c),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
        ),
      ]);
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === "TIMEOUT";
      if (!isTimeout) {
        setError(err instanceof Error ? err.message : "保存に失敗しました");
        setLoading(false);
        return;
      }
    }
    goToQuestions();
  };

  if (!hasContent)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">読み込み中…</p>
      </div>
    );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="page-slide-in mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">作文ルールの保存</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ルール名を付けて保存すると、あとから「保存したルールを使う」で呼び出せます。
          </p>
        </header>

        <section
          className="rounded-lg border border-card-border bg-card p-5 shadow-sm sm:p-6"
          aria-label="ルールの保存"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div
                className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
                role="alert"
              >
                {error}
              </div>
            )}
            <div>
              <label htmlFor="ruleName" className="mb-1.5 block text-sm font-medium">
                ルール名 <span className="text-red-500">*</span>
              </label>
              <input
                id="ruleName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：3段落で書く"
                className="w-full rounded-sm border border-card-border bg-background px-3 py-2 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">ルール内容</label>
              <pre className="whitespace-pre-wrap rounded-sm border border-card-border bg-muted/50 px-3 py-2 text-sm">
                {content || "（読み込み中…）"}
              </pre>
            </div>
            <div className="flex gap-3 pt-2">
              <Link
                href="/"
                className="rounded-sm border border-card-border px-4 py-2 text-sm transition hover:bg-muted"
              >
                キャンセル
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="rounded-sm bg-primary px-4 py-2 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "保存中…" : "保存する"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
