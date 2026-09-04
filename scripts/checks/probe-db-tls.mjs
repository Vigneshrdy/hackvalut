// Does the Supabase pooler cert verify against the system CA store?
import pg from "pg";
const url = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]+&?/i, "$1").replace(/[?&]$/, "");
for (const [label, ssl] of [["rejectUnauthorized: true (system CAs)", { rejectUnauthorized: true }], ["rejectUnauthorized: false (current)", { rejectUnauthorized: false }]]) {
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 12000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    console.log(`OK    ${label}`);
    await client.end();
  } catch (error) {
    console.log(`FAIL  ${label} -> ${error.message.slice(0, 90)}`);
    try { await client.end(); } catch {}
  }
}
process.exit(0);
