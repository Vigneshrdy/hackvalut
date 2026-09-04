-- Run once in Supabase Dashboard -> SQL Editor.
-- Vercel functions use the private transaction-pooler DATABASE_URL.
--
-- The problem statements are NOT here. They are the Markdown in data/, parsed by
-- lib/catalog.js, and this database holds only what genuinely needs a database:
-- accounts, teams, reviews and comments. problem_key is a plain TEXT key with no
-- foreign key -- the Markdown catalog, not Postgres, decides which problems exist.
CREATE TABLE IF NOT EXISTS browse_sessions (
  id UUID PRIMARY KEY, refresh_hash TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
  ip_hash TEXT NOT NULL, user_agent TEXT NOT NULL, group_key TEXT, display_name TEXT
);
ALTER TABLE browse_sessions ADD COLUMN IF NOT EXISTS display_name TEXT;

-- A team's membership lives in team_members. Seat 1 is the team lead.
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, leader_name TEXT NOT NULL, leader_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS leader_id UUID;

-- seat BETWEEN 1 AND 6 plus UNIQUE (team_id, seat) makes a 7th row impossible to
-- insert, so the cap holds even against a direct database write.
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  is_lead BOOLEAN NOT NULL DEFAULT FALSE,
  seat INTEGER NOT NULL CHECK (seat BETWEEN 1 AND 6),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id),
  UNIQUE (team_id, seat)
);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_one_lead_idx ON team_members (team_id) WHERE is_lead;
CREATE UNIQUE INDEX IF NOT EXISTS team_members_single_team_idx ON team_members (user_id);
CREATE INDEX IF NOT EXISTS browse_sessions_group_idx ON browse_sessions (group_key);
CREATE TABLE IF NOT EXISTS api_rate_buckets (
  session_id UUID NOT NULL REFERENCES browse_sessions(id) ON DELETE CASCADE, route TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL, request_count INTEGER NOT NULL,
  PRIMARY KEY (session_id, route, window_start)
);

-- Limits for callers that have no session yet (login/signup by IP) or that must be
-- capped per target rather than per account (team password attempts).
CREATE TABLE IF NOT EXISTS throttle_buckets (
  bucket_key TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL, request_count INTEGER NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);
CREATE TABLE IF NOT EXISTS group_comments (
  id BIGSERIAL PRIMARY KEY, group_key TEXT NOT NULL,
  problem_key TEXT NOT NULL,
  display_name TEXT NOT NULL, body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_problem_reviews (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_key TEXT NOT NULL,
  reading_status TEXT CHECK (reading_status IN ('to-read', 'read')),
  decision_status TEXT CHECK (decision_status IN ('keep', 'accept', 'reject')),
  private_note TEXT NOT NULL DEFAULT '' CHECK (char_length(private_note) <= 4000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, problem_key)
);
CREATE TABLE IF NOT EXISTS team_problem_votes (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_key TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'maybe', 'no')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id, problem_key)
);
CREATE INDEX IF NOT EXISTS browse_sessions_expiry_idx ON browse_sessions (expires_at);
CREATE INDEX IF NOT EXISTS group_comments_lookup_idx ON group_comments (group_key, problem_key, created_at DESC);
CREATE INDEX IF NOT EXISTS user_problem_reviews_lookup_idx ON user_problem_reviews (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS team_problem_votes_lookup_idx ON team_problem_votes (team_id, problem_key, updated_at DESC);

ALTER TABLE browse_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_rate_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_problem_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_problem_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE throttle_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON browse_sessions, api_rate_buckets, group_comments, user_problem_reviews, team_problem_votes, teams, team_members, throttle_buckets FROM anon, authenticated;
REVOKE ALL ON SEQUENCE group_comments_id_seq FROM anon, authenticated;
