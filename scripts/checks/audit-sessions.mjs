import { db } from "../../lib/db.js";
const sql = db();
const rows = await sql`SELECT b.id, u.is_anonymous, b.expires_at > NOW() AS still_valid, b.revoked_at IS NULL AS not_revoked, b.group_key
  FROM browse_sessions b JOIN auth.users u ON u.id = b.id ORDER BY b.created_at`;
console.log(`browse_sessions rows: ${rows.length}`);
for (const r of rows) console.log(`  anon=${r.is_anonymous} valid=${r.still_valid} notRevoked=${r.not_revoked} team=${r.group_key || "-"}`);
const usable = rows.filter((r) => r.is_anonymous && r.still_valid && r.not_revoked);
console.log(`\nLEGACY ANONYMOUS SESSIONS STILL ACCEPTED BY rotateSession: ${usable.length}`);
process.exit(0);
