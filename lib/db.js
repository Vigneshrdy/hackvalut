import pg from "pg";
import fs from "node:fs";

const { Pool } = pg;
let pool;

// Supabase's shared transaction pooler intermittently drops a socket while the pool
// is still opening it, which surfaces as an acquisition timeout before any statement
// is sent. Retrying that once is safe precisely because nothing reached the server.
// A real SQL error always carries a SQLSTATE `code`, so it is never retried here.
const isAcquireFailure = (error) => !error?.code && /Connection terminated/i.test(error?.message || "");

async function run(text, values) {
  try {
    return (await pool.query(text, values)).rows;
  } catch (error) {
    if (!isAcquireFailure(error)) throw error;
    return (await pool.query(text, values)).rows;
  }
}

function queryFactory(client) {
  const sql = (strings, ...values) => client.query(strings.reduce((query, string, index) => `${query}${string}${index < values.length ? `$${index + 1}` : ""}`, ""), values).then((result) => result.rows);
  sql.query = async (text, values) => (await client.query(text, values)).rows;
  return sql;
}

export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  const ca = process.env.SUPABASE_DB_CA_CERT
    ? fs.readFileSync(process.env.SUPABASE_DB_CA_CERT, "utf8")
    : (process.env.SUPABASE_DB_CA_CERT_PEM || "").trim() || null;
  pool ||= new Pool({
    connectionString: process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]+&?/i, "$1").replace(/[?&]$/, ""),
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 12000,   // Supabase's shared pooler is regularly slower than 5s
    // Prefer verified TLS when the Supabase CA is configured. Without it, keep the
    // previous fallback so auth and session writes still work on platforms like Vercel.
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  });
  pool.on("error", () => {});  // a dropped idle client must not take the process down
  const sql = (strings, ...values) => run(strings.reduce((query, string, index) => `${query}${string}${index < values.length ? `$${index + 1}` : ""}`, ""), values);
  sql.query = (text, values) => run(text, values);
  sql.transaction = async (work) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(queryFactory(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  return sql;
}
