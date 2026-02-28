-- Neon で実行するスキーマ（Supabase Auth の user.id を user_id として使用）

-- 作文テーマの入力履歴（過去7件表示用）
CREATE TABLE IF NOT EXISTS theme_history (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL,
  theme      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_theme_history_user_created
  ON theme_history (user_id, created_at DESC);

-- 保存した作文ルール（ユーザーごと・ルール名で一意）
CREATE TABLE IF NOT EXISTS saved_rules (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_rules_user
  ON saved_rules (user_id);
