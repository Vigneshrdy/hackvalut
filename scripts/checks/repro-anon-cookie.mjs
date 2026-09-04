// Rebuild the poisoned state: anonymous Supabase session + a browse_sessions row.
import crypto from "node:crypto";
import { db } from "../../lib/db.js";
const sql = db();
const url = process.env.SUPABASE_URL.replace(/\/$/, "");
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const r = await fetch(`${url}/auth/v1/signup`, { method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}" });
const j = await r.json();
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
await sql`INSERT INTO browse_sessions (id, refresh_hash, expires_at, ip_hash, user_agent)
  VALUES (${j.user.id}, ${hash(j.refresh_token)}, NOW() + INTERVAL '7 days', ${hash("r")}, 'repro')
  ON CONFLICT (id) DO UPDATE SET refresh_hash = EXCLUDED.refresh_hash, revoked_at = NULL, expires_at = EXCLUDED.expires_at`;
console.log(`${j.refresh_token} ${j.user.id}`);
process.exit(0);
