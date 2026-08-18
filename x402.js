import { Router } from "express";
import { pool } from "../database/db.js";
import { requireAuth } from "./auth.js";
const router=Router();

/*
  x402 payment boundary.
  This endpoint intentionally does not fake a blockchain settlement.
  A production verifier should validate the x402 payment proof against the
  configured payment facilitator/network before marking the payment settled.
*/
router.get("/research/:bountyId", async(req,res)=>{
  const {rows}=await pool.query("SELECT id,title,amount_cents FROM bounties WHERE id=$1",[req.params.bountyId]);
  if(!rows[0]) return res.status(404).json({error:"Bounty not found"});
  const amount=(rows[0].amount_cents/100).toFixed(2);
  return res.status(402).json({
    error:"Payment Required",
    protocol:"x402",
    bountyId:rows[0].id,
    amount,
    currency:"USDC",
    network:"algorand-mainnet",
    message:"Provide a valid x402 payment proof to access this paid resource."
  });
});

router.post("/settle",requireAuth,async(req,res)=>{
  if(req.user.role!=="buyer") return res.status(403).json({error:"Buyer account required"});
  const {bountyId,submissionId,txId}=req.body;
  if(!bountyId||!submissionId||!txId) return res.status(400).json({error:"bountyId, submissionId and txId are required"});
  const {rows}=await pool.query("SELECT amount_cents FROM bounties WHERE id=$1 AND buyer_id=$2",[bountyId,req.user.sub]);
  if(!rows[0]) return res.status(404).json({error:"Bounty not found"});
  const {rows: sub}=await pool.query("SELECT researcher_id FROM submissions WHERE id=$1 AND bounty_id=$2 AND status='accepted'",[submissionId,bountyId]);
  if(!sub[0]) return res.status(400).json({error:"Accepted submission required"});
  const {rows: p}=await pool.query(`
    INSERT INTO payments(bounty_id,submission_id,buyer_id,researcher_id,amount_cents,network,tx_id,status)
    VALUES($1,$2,$3,$4,$5,'algorand-mainnet',$6,'submitted') RETURNING *
  `,[bountyId,submissionId,req.user.sub,sub[0].researcher_id,rows[0].amount_cents,txId]);
  res.status(202).json({payment:p[0],message:"Settlement submitted for on-chain verification."});
});

export default router;