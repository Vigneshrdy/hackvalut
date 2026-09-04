import fs from "node:fs/promises";
import { db } from "../../lib/db.js";
const sql = db();
const schema = await fs.readFile(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
for (const s of schema.split(";").map((p) => p.trim()).filter(Boolean)) await sql.query(s);
console.log("schema applied (throttle_buckets created)");

// group_key has no foreign key, so deleting a team leaves members pointing at a team
// that no longer exists: verifyAccess still hands out that groupId for comments.
const fixed = await sql`UPDATE browse_sessions SET group_key = NULL
  WHERE group_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = browse_sessions.group_key)
  RETURNING id`;
console.log(`cleared ${fixed.length} browse_sessions row(s) pointing at a deleted team`);
const orphanComments = await sql`SELECT COUNT(*)::int n FROM group_comments c
  WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = c.group_key)`;
console.log(`orphaned comments (unreachable, harmless): ${orphanComments[0].n}`);
process.exit(0);
