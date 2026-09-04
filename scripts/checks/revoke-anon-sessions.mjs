import { db } from "../../lib/db.js";
const sql = db();
// Anonymous sign-in is no longer part of this app, so no anonymous browse_session
// should remain refreshable.
const revoked = await sql`UPDATE browse_sessions b SET revoked_at = NOW()
  FROM auth.users u WHERE u.id = b.id AND u.is_anonymous AND b.revoked_at IS NULL RETURNING b.id`;
console.log(`revoked ${revoked.length} anonymous browse_sessions`);
const left = await sql`SELECT COUNT(*)::int n FROM browse_sessions b JOIN auth.users u ON u.id = b.id
  WHERE u.is_anonymous AND b.revoked_at IS NULL`;
console.log(`anonymous sessions still refreshable: ${left[0].n}`);
// Cleanup part is optional: pass the repro account's user id as the first argument.
const id = process.argv[2];
if (id) {
  await sql`DELETE FROM browse_sessions WHERE id = ${id}`;
  await sql`DELETE FROM auth.identities WHERE user_id = ${id}`;
  await sql`DELETE FROM auth.users WHERE id = ${id}`;
  console.log("repro account removed");
}
process.exit(0);
