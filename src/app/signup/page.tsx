"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("パスワードが一致しません");
      return;
    }
    if (password.length < 6) {
      setError("パスワードは6文字以上にしてください");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name.trim() } },
      });
      if (signUpError) throw signUpError;
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-bold mb-6 text-center">新規登録ページ</h1>
        <section
          className="rounded-lg border border-card-border bg-card p-6 shadow-sm"
          aria-label="新規登録"
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
              <label htmlFor="name" className="mb-1 block text-sm font-medium">
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-sm border border-card-border bg-background px-3 py-2 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                autoComplete="name"
              />
            </div>
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
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full rounded-sm border border-card-border bg-background px-3 py-2 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                autoComplete="new-password"
              />
            </div>
            <div className="flex items-center justify-between gap-4 pt-2">
              <span className="text-sm text-muted-foreground">
                すでに登録済みの方は
                <Link
                  href="/login"
                  className="text-primary underline hover:no-underline ml-1"
                >
                  ログインはこちら
                </Link>
              </span>
              <button
                type="submit"
                disabled={loading}
                className="rounded-sm bg-primary px-4 py-2 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "登録中…" : "登録する"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
