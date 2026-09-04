import crypto from "node:crypto";
import { db } from "../../lib/db.js";
const sql = db();
const email = `sih-diag-${crypto.randomBytes(4).toString("hex")}@sihcheck.local`;
const rows = await sql`INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token, is_sso_user, is_anonymous
  ) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email},
    extensions.crypt('DiagPassword123!', extensions.gen_salt('bf')), NOW(), NOW(), NOW(),
    '', '', '', '', '', '', '', '', FALSE, FALSE) RETURNING id`;
await sql`INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (${email}, ${rows[0].id}, ${JSON.stringify({ sub: rows[0].id, email, email_verified: true, phone_verified: false })}::jsonb, 'email', NOW(), NOW(), NOW())`;
console.log(email);
process.exit(0);
