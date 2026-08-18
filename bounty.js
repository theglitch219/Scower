import { Router } from "express";
import { pool } from "../database/db.js";
import { requireAuth } from "./auth.js";
const router = Router();

router.get("/", async (_req,res) => {
  const { rows } = await pool.query(`
    SELECT b.*, u.name AS buyer_name, COUNT(s.id)::int AS submission_count
    FROM bounties b JOIN users u ON u.id=b.buyer_id
    LEFT JOIN submissions s ON s.bounty_id=b.id
    WHERE b.status='open'
    GROUP BY b.id,u.name ORDER BY b.created_at DESC
  `);
  res.json(rows);
});

router.post("/", requireAuth, async (req,res) => {
  if (req.user.role !== "buyer") return res.status(403).json({error:"Buyer account required"});
  const { title, description, category, amountCents } = req.body;
  if (!title || !description || !Number.isInteger(amountCents) || amountCents < 1)
    return res.status(400).json({error:"Title, description and positive amountCents are required"});
  const { rows } = await pool.query(
    "INSERT INTO bounties(buyer_id,title,description,category,amount_cents) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [req.user.sub,title,description,category||"RESEARCH",amountCents]
  );
  res.status(201).json(rows[0]);
});

router.get("/mine", requireAuth, async (req,res) => {
  const { rows } = await pool.query(
    "SELECT * FROM bounties WHERE buyer_id=$1 ORDER BY created_at DESC",[req.user.sub]
  );
  res.json(rows);
});

export default router;