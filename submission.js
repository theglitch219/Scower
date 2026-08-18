import { Router } from "express";
import { pool } from "../database/db.js";
import { requireAuth } from "./auth.js";
const router = Router();

router.post("/", requireAuth, async (req,res) => {
  if (req.user.role !== "researcher") return res.status(403).json({error:"Researcher account required"});
  const { bountyId, answer, evidence } = req.body;
  const { rows: b } = await pool.query("SELECT * FROM bounties WHERE id=$1 AND status='open'",[bountyId]);
  if (!b[0]) return res.status(404).json({error:"Open bounty not found"});
  const { rows } = await pool.query(
    "INSERT INTO submissions(bounty_id,researcher_id,answer,evidence) VALUES($1,$2,$3,$4) RETURNING *",
    [bountyId,req.user.sub,answer,evidence||null]
  );
  res.status(201).json(rows[0]);
});

router.get("/mine", requireAuth, async (req,res) => {
  const { rows } = await pool.query(`
    SELECT s.*, b.title, b.amount_cents
    FROM submissions s JOIN bounties b ON b.id=s.bounty_id
    WHERE s.researcher_id=$1 ORDER BY s.created_at DESC
  `,[req.user.sub]);
  res.json(rows);
});

router.get("/bounty/:id", requireAuth, async (req,res) => {
  const { rows } = await pool.query(`
    SELECT s.*, u.name AS researcher_name, u.reputation
    FROM submissions s JOIN users u ON u.id=s.researcher_id
    WHERE s.bounty_id=$1 ORDER BY s.created_at DESC
  `,[req.params.id]);
  res.json(rows);
});

router.post("/:id/review", requireAuth, async (req,res) => {
  if (req.user.role !== "buyer") return res.status(403).json({error:"Buyer account required"});
  const { decision } = req.body;
  if (!["accepted","rejected"].includes(decision)) return res.status(400).json({error:"Invalid decision"});
  const { rows } = await pool.query(`
    SELECT s.*,b.buyer_id,b.amount_cents FROM submissions s
    JOIN bounties b ON b.id=s.bounty_id WHERE s.id=$1
  `,[req.params.id]);
  const s=rows[0];
  if (!s || s.buyer_id !== Number(req.user.sub)) return res.status(403).json({error:"Not your bounty"});
  const result = await pool.query("UPDATE submissions SET status=$1 WHERE id=$2 RETURNING *",[decision,s.id]);
  if (decision==="accepted") {
    await pool.query("UPDATE users SET reputation=reputation+8 WHERE id=$1",[s.researcher_id]);
  }
  res.json(result.rows[0]);
});

export default router;