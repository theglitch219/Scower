import express from "express";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"Public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? {rejectUnauthorized:false} : false
});
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-render";

async function db(sql, params=[]){ return pool.query(sql,params); }
async function init(){
  if(!process.env.DATABASE_URL) console.warn("DATABASE_URL is not set yet.");
  await db(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('buyer','researcher')),
      reputation INTEGER NOT NULL DEFAULT 0,
      earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bounties(
      id BIGSERIAL PRIMARY KEY,
      buyer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      budget NUMERIC(12,2) NOT NULL CHECK(budget > 0),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','review','paid','closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS submissions(
      id BIGSERIAL PRIMARY KEY,
      bounty_id BIGINT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
      researcher_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answer TEXT NOT NULL,
      evidence TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(bounty_id,researcher_id)
    );
    CREATE TABLE IF NOT EXISTS payouts(
      id BIGSERIAL PRIMARY KEY,
      bounty_id BIGINT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
      submission_id BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      buyer_id BIGINT NOT NULL REFERENCES users(id),
      researcher_id BIGINT NOT NULL REFERENCES users(id),
      amount NUMERIC(12,2) NOT NULL,
      network TEXT NOT NULL DEFAULT 'algorand-testnet',
      asset TEXT NOT NULL DEFAULT 'USDC',
      status TEXT NOT NULL DEFAULT 'pending',
      tx_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
function tokenFor(u){return jwt.sign({id:u.id,name:u.name,role:u.role},JWT_SECRET,{expiresIn:"7d"});}
function auth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Authentication required"});
  try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next();}catch{res.status(401).json({error:"Invalid or expired session"});}
}

app.get("/api/health",async(req,res)=>{try{await db("SELECT 1");res.json({ok:true,service:"scower"});}catch(e){res.status(503).json({ok:false,error:"Database unavailable"});}});

app.post("/api/auth/signup",async(req,res)=>{
  const {name,email,password,role}=req.body||{};
  if(!name||!email||!password||!["buyer","researcher"].includes(role)) return res.status(400).json({error:"Name, email, password and role are required"});
  if(password.length<8) return res.status(400).json({error:"Password must be at least 8 characters"});
  const hash=await bcrypt.hash(password,12);
  try{
    const {rows}=await db("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,reputation,earnings",[name,email.toLowerCase(),hash,role]);
    res.status(201).json({user:rows[0],token:tokenFor(rows[0])});
  }catch(e){ if(e.code==="23505") return res.status(409).json({error:"An account with that email already exists"}); res.status(500).json({error:"Could not create account"});}
});
app.post("/api/auth/login",async(req,res)=>{
  const {email,password}=req.body||{};
  const {rows}=await db("SELECT * FROM users WHERE email=$1",[String(email||"").toLowerCase()]);
  if(!rows[0]||!(await bcrypt.compare(password||"",rows[0].password_hash))) return res.status(401).json({error:"Incorrect email or password"});
  const u=rows[0]; delete u.password_hash;
  res.json({user:u,token:tokenFor(u)});
});
app.get("/api/me",auth,async(req,res)=>{const {rows}=await db("SELECT id,name,email,role,reputation,earnings FROM users WHERE id=$1",[req.user.id]);res.json(rows[0]||null);});

app.get("/api/bounties",async(req,res)=>{
  const {rows}=await db(`SELECT b.*,u.name buyer,(SELECT count(*) FROM submissions s WHERE s.bounty_id=b.id)::int submissions
    FROM bounties b JOIN users u ON u.id=b.buyer_id ORDER BY b.created_at DESC`);
  res.json(rows);
});
app.post("/api/bounties",auth,async(req,res)=>{
  if(req.user.role!=="buyer") return res.status(403).json({error:"Only buyers can create bounties"});
  const {title,description,category,budget}=req.body||{};
  const amount=Number(budget);
  if(!title||!description||!category||!Number.isFinite(amount)||amount<=0) return res.status(400).json({error:"Complete all bounty fields"});
  const {rows}=await db("INSERT INTO bounties(buyer_id,title,description,category,budget) VALUES($1,$2,$3,$4,$5) RETURNING *",[req.user.id,title,description,category,amount]);
  res.status(201).json(rows[0]);
});
app.get("/api/bounties/:id",async(req,res)=>{
  const {rows}=await db(`SELECT b.*,u.name buyer FROM bounties b JOIN users u ON u.id=b.buyer_id WHERE b.id=$1`,[req.params.id]);
  if(!rows[0]) return res.status(404).json({error:"Bounty not found"});
  const subs=await db(`SELECT s.id,s.answer,s.evidence,s.status,s.created_at,u.id researcher_id,u.name researcher,u.reputation
    FROM submissions s JOIN users u ON u.id=s.researcher_id WHERE s.bounty_id=$1 ORDER BY s.created_at DESC`,[req.params.id]);
  res.json({...rows[0],submissions:subs.rows});
});
app.post("/api/bounties/:id/submissions",auth,async(req,res)=>{
  if(req.user.role!=="researcher") return res.status(403).json({error:"Only researchers can submit"});
  const {answer,evidence}=req.body||{};
  if(!answer||!evidence) return res.status(400).json({error:"Answer and evidence are required"});
  try{
    const {rows}=await db("INSERT INTO submissions(bounty_id,researcher_id,answer,evidence) VALUES($1,$2,$3,$4) RETURNING *",[req.params.id,req.user.id,answer,evidence]);
    await db("UPDATE bounties SET status='review' WHERE id=$1 AND status='open'",[req.params.id]);
    res.status(201).json(rows[0]);
  }catch(e){if(e.code==="23505") return res.status(409).json({error:"You already submitted to this bounty"});res.status(500).json({error:"Could not submit"});}
});
app.post("/api/submissions/:id/decision",auth,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const s=await client.query(`SELECT s.*,b.buyer_id,b.budget,b.status bounty_status FROM submissions s JOIN bounties b ON b.id=s.bounty_id WHERE s.id=$1 FOR UPDATE`,[req.params.id]);
    if(!s.rows[0]) throw Object.assign(new Error("Submission not found"),{status:404});
    const row=s.rows[0];
    if(String(row.buyer_id)!==String(req.user.id)) throw Object.assign(new Error("Only the bounty owner can decide"),{status:403});
    const decision=req.body.decision;
    if(!["accepted","rejected"].includes(decision)) throw Object.assign(new Error("Invalid decision"),{status:400});
    if(row.status!=="pending") throw Object.assign(new Error("Submission already decided"),{status:409});
    if(decision==="rejected"){
      await client.query("UPDATE submissions SET status='rejected' WHERE id=$1",[row.id]);
      await client.query("UPDATE bounties SET status='open' WHERE id=$1",[row.bounty_id]);
      await client.query("COMMIT"); return res.json({ok:true,status:"rejected"});
    }
    await client.query("UPDATE submissions SET status='accepted' WHERE id=$1",[row.id]);
    await client.query("UPDATE bounties SET status='paid' WHERE id=$1",[row.bounty_id]);
    await client.query("UPDATE users SET reputation=reputation+8, earnings=earnings+$1 WHERE id=$2",[row.budget,row.researcher_id]);
    await client.query("INSERT INTO payouts(bounty_id,submission_id,buyer_id,researcher_id,amount,status) VALUES($1,$2,$3,$4,$5,'pending')",[row.bounty_id,row.id,row.buyer_id,row.researcher_id,row.budget]);
    await client.query("COMMIT");
    res.json({ok:true,status:"accepted",amount:row.budget,payment:"pending"});
  }catch(e){await client.query("ROLLBACK").catch(()=>{});res.status(e.status||500).json({error:e.message||"Decision failed"});}finally{client.release();}
});
app.get("/api/my/submissions",auth,async(req,res)=>{
  const {rows}=await db(`SELECT s.*,b.title,b.budget,b.category FROM submissions s JOIN bounties b ON b.id=s.bounty_id WHERE s.researcher_id=$1 ORDER BY s.created_at DESC`,[req.user.id]);res.json(rows);
});
app.get("/api/my/bounties",auth,async(req,res)=>{
  const {rows}=await db(`SELECT b.*,(SELECT count(*) FROM submissions s WHERE s.bounty_id=b.id)::int submissions FROM bounties b WHERE b.buyer_id=$1 ORDER BY b.created_at DESC`,[req.user.id]);res.json(rows);
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "Public", "index.html"));
});;
init().then(()=>app.listen(process.env.PORT||10000,()=>console.log("Scower running"))).catch(e=>{console.error(e);process.exit(1);});
