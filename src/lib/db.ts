import { neon } from "@neondatabase/serverless";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

/** テーマ履歴を追加し、ユーザーごと直近7件を返す */
export async function addThemeHistory(userId: string, theme: string) {
  const sql = getSql();
  const t = theme.trim();
  if (!t) return [];
  await sql`
    INSERT INTO theme_history (user_id, theme)
    VALUES (${userId}, ${t})
  `;
  return getThemeHistory(userId);
}

/** ユーザーのテーマ履歴を直近7件取得（同じテーマは1回だけ、新しい順） */
export async function getThemeHistory(userId: string): Promise<string[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT sub.theme FROM (
      SELECT theme, created_at,
        ROW_NUMBER() OVER (PARTITION BY theme ORDER BY created_at DESC) AS rn
      FROM theme_history
      WHERE user_id = ${userId}
    ) sub
    WHERE sub.rn = 1
    ORDER BY sub.created_at DESC
    LIMIT 7
  `;
  return rows.map((r) => (r as { theme: string }).theme);
}

/** 保存したルール一覧（ルール名・内容）を取得 */
export async function getSavedRules(
  userId: string
): Promise<{ id: number; name: string; content: string }[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, content FROM saved_rules
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;
  return rows as { id: number; name: string; content: string }[];
}

/** ルールを1件保存（同名なら上書き） */
export async function saveRule(
  userId: string,
  name: string,
  content: string
): Promise<void> {
  const sql = getSql();
  const n = name.trim();
  const c = content.trim();
  if (!n || !c) throw new Error("ルール名と内容は必須です");
  await sql`
    INSERT INTO saved_rules (user_id, name, content)
    VALUES (${userId}, ${n}, ${c})
    ON CONFLICT (user_id, name) DO UPDATE SET
      content = EXCLUDED.content,
      updated_at = now()
  `;
}
