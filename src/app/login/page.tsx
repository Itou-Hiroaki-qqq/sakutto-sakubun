"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-bold mb-6 text-center">ログインページ</h1>
        <section
          className="rounded-lg border border-card-border bg-card p-6 shadow-sm"
          aria-label="ログイン"
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
              <label htmlFor="email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-sm border border-card-border bg-background px-3 py-2 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-sm border border-card-border bg-background px-3 py-2 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                autoComplete="current-password"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="remember"
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-card-border"
              />
              <label htmlFor="remember" className="text-sm">
                ログイン情報を記録する
              </label>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={loading}
                className="rounded-sm bg-primary px-4 py-2 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "ログイン中…" : "ログイン"}
              </button>
            </div>
            <p className="text-sm text-muted-foreground pt-4 text-center">
              初めての方は
              <Link
                href="/signup"
                className="text-primary underline hover:no-underline ml-1"
              >
                新規登録はこちら
              </Link>
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}
