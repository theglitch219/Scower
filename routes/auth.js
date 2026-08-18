import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../database/db.js";

const router = Router();
const secret = () => process.env.JWT_SECRET || "dev-only-change-this";

router.post("/signup", async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !name || !["buyer","researcher"].includes(role))
      return res.status(400).json({ error: "email, password, name and valid role are required" });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,$3,$4) RETURNING id,email,name,role,reputation",
      [email.toLowerCase(), hash, name, role]
    );
    const user = rows[0];
    const token = jwt.sign({ sub: user.id, role: user.role }, secret(), { expiresIn: "7d" });
    res.status(201).json({ user, token });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    res.status(500).json({ error: "Signup failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [email?.toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password || "", user.password_hash)))
      return res.status(401).json({ error: "Invalid email or password" });
    const safe = { id:user.id, email:user.email, name:user.name, role:user.role, reputation:user.reputation };
    const token = jwt.sign({ sub: user.id, role: user.role }, secret(), { expiresIn: "7d" });
    res.json({ user: safe, token });
  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});

export function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const payload = jwt.verify(token, secret());
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Authentication required" });
  }
}
export default router;
