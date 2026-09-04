-- Manual migration for existing deployments.
-- Review in the target environment before running.

ALTER TABLE group_comments ADD COLUMN IF NOT EXISTS problem_key TEXT;
ALTER TABLE user_problem_reviews ADD COLUMN IF NOT EXISTS problem_key TEXT;
ALTER TABLE team_problem_votes ADD COLUMN IF NOT EXISTS problem_key TEXT;

UPDATE group_comments
SET problem_key = CONCAT('smart-india-hackathon:2026:', ps_number)
WHERE problem_key IS NULL AND ps_number ~ '^SIH26[0-9]{3}$';

UPDATE user_problem_reviews
SET problem_key = CONCAT('smart-india-hackathon:2026:', ps_number)
WHERE problem_key IS NULL AND ps_number ~ '^SIH26[0-9]{3}$';

UPDATE team_problem_votes
SET problem_key = CONCAT('smart-india-hackathon:2026:', ps_number)
WHERE problem_key IS NULL AND ps_number ~ '^SIH26[0-9]{3}$';

-- For installs that only ever stored the old 2026 site, the rows above are enough.
-- After verifying the backfill, move application reads/writes to problem_key and then
-- update primary keys and indexes in a separate maintenance window.
