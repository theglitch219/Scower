import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { initDatabase } from "./database/db.js";
import authRoutes from "./routes/auth.js";
import bountyRoutes from "./routes/bounty.js";
import submissionRoutes from "./routes/submission.js";
import walletRoutes from "./routes/wallet.js";
import x402Routes from "./routes/x402.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "scower" }));

app.use("/api/auth", authRoutes);
app.use("/api/bounties", bountyRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/x402", x402Routes);

app.use(express.static(path.join(__dirname, "Public")));

app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "Public", "index.html"));
});

const port = process.env.PORT || 10000;

async function start() {
  await initDatabase();
  app.listen(port, () => console.log(`Scower running on ${port}`));
}
start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});