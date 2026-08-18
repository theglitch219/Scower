import { Router } from "express";
import { pool } from "../database/db.js";
import { requireAuth } from "./auth.js";
const router=Router();

router.get("/me",requireAuth,async(req,res)=>{
  const {rows}=await pool.query("SELECT id,address,network,created_at FROM wallets WHERE user_id=$1",[req.user.sub]);
  res.json(rows[0]||null);
});
router.post("/connect",requireAuth,async(req,res)=>{
  const {address,network="algorand-mainnet"}=req.body;
  if(!address) return res.status(400).json({error:"Wallet address required"});
  const {rows}=await pool.query(`
    INSERT INTO wallets(user_id,address,network) VALUES($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET address=EXCLUDED.address,network=EXCLUDED.network
    RETURNING id,address,network,created_at
  `,[req.user.sub,address,network]);
  res.json(rows[0]);
});
export default router;