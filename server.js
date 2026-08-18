import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_RENDER";
const port = process.env.PORT || 10000;

async function init() {
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL is not set. Add it in Render Environment.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('buyer','researcher')),
      wallet_address TEXT,
      reputation INTEGER DEFAULT 0,
      earnings NUMERIC(12,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bounties (
      id SERIAL PRIMARY KEY,
      buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      budget NUMERIC(12,2) NOT NULL CHECK (budget > 0),
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      bounty_id INTEGER NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
      researcher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answer TEXT NOT NULL,
      evidence TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(bounty_id, researcher_id)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      bounty_id INTEGER REFERENCES bounties(id) ON DELETE SET NULL,
      submission_id INTEGER REFERENCES submissions(id) ON DELETE SET NULL,
      payer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      payee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      asset TEXT DEFAULT 'USDC',
      network TEXT DEFAULT 'algorand',
      status TEXT DEFAULT 'pending',
      tx_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("Scower database ready");
}

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) throw new Error();
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Please sign in." });
  }
}
function requireRole(role) {
  return (req, res, next) => req.user.role === role ? next() : res.status(403).json({ error: `Only ${role}s can do this.` });
}

app.get("/healthz", (_, res) => res.json({ ok: true, service: "scower" }));

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !["buyer","researcher"].includes(role)) return res.status(400).json({ error: "Name, email, password and role are required." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,reputation,earnings,wallet_address",
      [name.trim(), email.trim().toLowerCase(), hash, role]
    );
    res.status(201).json({ token: sign(rows[0]), user: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    console.error(e); res.status(500).json({ error: "Unable to create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [email.trim().toLowerCase()]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: "Invalid email or password." });
    const user = { id:u.id,name:u.name,email:u.email,role:u.role,reputation:u.reputation,earnings:u.earnings,wallet_address:u.wallet_address };
    res.json({ token: sign(user), user });
  } catch (e) { console.error(e); res.status(500).json({ error: "Unable to sign in." }); }
});

app.get("/api/me", auth, async (req,res) => {
  const { rows } = await pool.query("SELECT id,name,email,role,reputation,earnings,wallet_address FROM users WHERE id=$1",[req.user.id]);
  res.json(rows[0]);
});

app.put("/api/me/wallet", auth, async (req,res) => {
  const { wallet_address } = req.body;
  if (!wallet_address || wallet_address.length < 20) return res.status(400).json({error:"Enter a valid Algorand address."});
  const { rows } = await pool.query("UPDATE users SET wallet_address=$1 WHERE id=$2 RETURNING id,name,email,role,reputation,earnings,wallet_address",[wallet_address.trim(),req.user.id]);
  res.json(rows[0]);
});

app.get("/api/bounties", async (_,res) => {
  const { rows } = await pool.query(`
    SELECT b.id,b.title,b.description,b.category,b.budget,b.status,
           COUNT(s.id)::int AS submissions
    FROM bounties b LEFT JOIN submissions s ON s.bounty_id=b.id
    WHERE b.status IN ('open','funded')
    GROUP BY b.id ORDER BY b.created_at DESC
  `);
  res.json(rows);
});

app.get("/api/bounties/:id", async (req,res) => {
  const b = await pool.query("SELECT * FROM bounties WHERE id=$1",[req.params.id]);
  if (!b.rows[0]) return res.status(404).json({error:"Bounty not found."});
  const s = await pool.query(`
    SELECT s.id,s.answer,s.evidence,s.status,u.name AS researcher,u.reputation
    FROM submissions s JOIN users u ON u.id=s.researcher_id
    WHERE s.bounty_id=$1 ORDER BY s.created_at DESC
  `,[req.params.id]);
  res.json({...b.rows[0], submissions:s.rows});
});

app.get("/api/my/bounties",auth,requireRole("buyer"),async(req,res)=>{
  const {rows}=await pool.query(`
    SELECT b.*,COUNT(s.id)::int AS submissions
    FROM bounties b LEFT JOIN submissions s ON s.bounty_id=b.id
    WHERE b.buyer_id=$1 GROUP BY b.id ORDER BY b.created_at DESC
  `,[req.user.id]); res.json(rows);
});

app.post("/api/bounties",auth,requireRole("buyer"),async(req,res)=>{
  const {title,description,category,budget}=req.body;
  if(!title||!description||!category||!(Number(budget)>0))return res.status(400).json({error:"Complete all bounty fields."});
  const {rows}=await pool.query(
    "INSERT INTO bounties(buyer_id,title,description,category,budget) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [req.user.id,title.trim(),description.trim(),category,Number(budget)]
  );
  res.status(201).json(rows[0]);
});

app.post("/api/bounties/:id/submissions",auth,requireRole("researcher"),async(req,res)=>{
  const {answer,evidence}=req.body;
  if(!answer||!evidence)return res.status(400).json({error:"Answer and evidence are required."});
  try{
    const b=await pool.query("SELECT id,status FROM bounties WHERE id=$1",[req.params.id]);
    if(!b.rows[0]||!["open","funded"].includes(b.rows[0].status))return res.status(400).json({error:"This bounty is not open."});
    const {rows}=await pool.query(
      "INSERT INTO submissions(bounty_id,researcher_id,answer,evidence) VALUES($1,$2,$3,$4) RETURNING *",
      [req.params.id,req.user.id,answer.trim(),evidence.trim()]
    ); res.status(201).json(rows[0]);
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"You already submitted to this bounty."});console.error(e);res.status(500).json({error:"Could not submit research."})}
});

app.get("/api/my/submissions",auth,requireRole("researcher"),async(req,res)=>{
  const {rows}=await pool.query(`
    SELECT s.*,b.title,b.category,b.budget
    FROM submissions s JOIN bounties b ON b.id=s.bounty_id
    WHERE s.researcher_id=$1 ORDER BY s.created_at DESC
  `,[req.user.id]);res.json(rows);
});

app.post("/api/submissions/:id/decision",auth,requireRole("buyer"),async(req,res)=>{
  const {decision}=req.body;
  if(!["accepted","rejected"].includes(decision))return res.status(400).json({error:"Invalid decision."});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const q=await client.query(`
      SELECT s.*,b.buyer_id,b.budget,b.id AS bounty_id
      FROM submissions s JOIN bounties b ON b.id=s.bounty_id
      WHERE s.id=$1 FOR UPDATE
    `,[req.params.id]);
    const s=q.rows[0];
    if(!s||s.buyer_id!==req.user.id)throw Object.assign(new Error("Not allowed."),{status:403});
    if(s.status!=="pending")throw Object.assign(new Error("Submission already decided."),{status:400});
    await client.query("UPDATE submissions SET status=$1 WHERE id=$2",[decision,s.id]);
    if(decision==="accepted"){
      await client.query("UPDATE bounties SET status='paid' WHERE id=$1",[s.bounty_id]);
      await client.query("UPDATE users SET reputation=reputation+8 WHERE id=$1",[s.researcher_id]);
      await client.query(`
        INSERT INTO payments(bounty_id,submission_id,payer_id,payee_id,amount,status)
        VALUES($1,$2,$3,$4,$5,'pending')
      `,[s.bounty_id,s.id,req.user.id,s.researcher_id,s.budget]);
    }
    await client.query("COMMIT");
    res.json({ok:true,status:decision,payment:decision==="accepted"?"pending_settlement":null});
  }catch(e){await client.query("ROLLBACK");console.error(e);res.status(e.status||500).json({error:e.message||"Decision failed."})}
  finally{client.release()}
});

/*
  x402 integration point.
  This route deliberately returns 402 until the GoPlausible facilitator
  and Mainnet USDC settlement are configured. Do not fake a successful payment.
*/
app.get("/api/x402/research/:id", async (req,res)=>{
  const {rows}=await pool.query(`
    SELECT s.id,s.answer,s.evidence,b.budget,b.status
    FROM submissions s JOIN bounties b ON b.id=s.bounty_id
    WHERE s.id=$1 AND s.status='accepted'
  `,[req.params.id]);
  if(!rows[0])return res.status(404).json({error:"Accepted research not found."});
  return res.status(402).json({
    x402Version:1,
    error:"Payment Required",
    accepts:[{
      scheme:"exact",
      network:process.env.X402_NETWORK||"algorand-testnet",
      asset:"USDC",
      amount:String(rows[0].budget),
      payTo:process.env.X402_PAY_TO||"CONFIGURE_PAY_TO",
      resource:`/api/x402/research/${req.params.id}`
    }]
  });
});

app.use(express.static(path.join(__dirname,"Public")));
app.get("/healthz", (_,res)=>res.json({ok:true}));
app.use((req,res,next)=>{
  if(req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname,"Public","index.html"));
});
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Server error."})});

init().catch(e=>console.error("Database initialization failed:",e));
app.listen(port,()=>console.log(`Scower running on ${port}`));
