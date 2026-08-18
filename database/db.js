import pg from "pg";
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) console.warn("DATABASE_URL is not set.");

export const pool = new Pool({
  connectionString: connectionString || "postgresql://localhost:5432/scowerdb",
  ssl: connectionString ? { rejectUnauthorized: false } : false
});

export async function initDatabase() {
  if (!connectionString) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('buyer','researcher')),
      reputation INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      network TEXT NOT NULL DEFAULT 'algorand-mainnet',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bounties (
      id SERIAL PRIMARY KEY,
      buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'RESEARCH',
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      bounty_id INTEGER NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
      researcher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answer TEXT NOT NULL,
      evidence TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      bounty_id INTEGER REFERENCES bounties(id) ON DELETE SET NULL,
      submission_id INTEGER REFERENCES submissions(id) ON DELETE SET NULL,
      buyer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      researcher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount_cents INTEGER NOT NULL,
      network TEXT,
      tx_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
