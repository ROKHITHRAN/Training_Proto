import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { auth, db } from "../../firebase.js";
import providerApi from "./providerApi.js";

const app = express();
app.use(express.json());
app.use("/api/provider", providerApi);

/* ================= CONFIG ================= */

const MAX_PROVIDERS_PER_ROUND = 2;
const ROUND_TIMEOUT_MS = 15000;
const PROVIDER_TIMEOUT_MS = 12000;
const ROUND_DURATION_MIN = 5;

/* ================= STATE ================= */

const providers = new Map(); // runtime-only
let currentRound = 1;
let roundActive = false;
let roundParticipants = [];

/* ================= PATH SETUP ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../");
const STORAGE_DIR = path.join(ROOT_DIR, "storage");

const GLOBAL_MODEL_DIR = path.join(STORAGE_DIR, "global-models");
const PROVIDER_UPDATES_DIR = path.join(STORAGE_DIR, "provider-updates");

fs.mkdirSync(GLOBAL_MODEL_DIR, { recursive: true });
fs.mkdirSync(PROVIDER_UPDATES_DIR, { recursive: true });

/* ================= MODEL INIT ================= */

function initGlobalModel() {
  const modelPath = path.join(GLOBAL_MODEL_DIR, "round-0.pt");
  if (!fs.existsSync(modelPath)) {
    console.log("Initializing global model...");
    spawn("python", ["src/models/init_model.py", GLOBAL_MODEL_DIR]);
  }
}
initGlobalModel();

/* ================= AUTH MIDDLEWARE ================= */

async function verifyFirebaseToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = await auth.verifyIdToken(header.split(" ")[1]);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* ================= PROVIDER REGISTER ================= */

app.post("/provider/register", verifyFirebaseToken, async (req, res) => {
  const providerId = req.user.uid;
  const systemInfo = req.body;

  const doc = await db.collection("providers").doc(providerId).get();
  if (!doc.exists) {
    return res.status(400).json({ error: "Provider profile not found" });
  }

  const profile = doc.data();

  if (profile.status !== "READY") {
    return res.status(403).json({
      error: "Provider not READY (set availability first)",
    });
  }

  providers.set(providerId, {
    providerId,
    gpu: systemInfo.gpu,
    vram: systemInfo.vram,
    cpuCores: systemInfo.cpuCores,
    ramGB: systemInfo.ramGB,
    availabilityMinutes: profile.availabilityMinutes,
    reliabilityScore: profile.reliabilityScore,
    status: "IDLE",
    lastSeen: Date.now(),
  });

  console.log("Provider ONLINE:", providerId);
  res.json({ status: "ONLINE" });
});

/* ================= HEARTBEAT ================= */

app.post("/provider/heartbeat", (req, res) => {
  const { providerId } = req.body;
  const p = providers.get(providerId);
  if (!p) return res.status(404).end();

  p.lastSeen = Date.now();
  res.json({ status: "alive" });
});

/* ================= ROUND STATUS ================= */

app.get("/round/current", (req, res) => {
  res.json({ round: currentRound, active: roundActive });
});

/* ================= MODEL FETCH ================= */

app.get("/model/latest", (req, res) => {
  const files = fs
    .readdirSync(GLOBAL_MODEL_DIR)
    .filter((f) => f.startsWith("round-"))
    .sort((a, b) => parseInt(b.split("-")[1]) - parseInt(a.split("-")[1]));

  res.sendFile(path.join(GLOBAL_MODEL_DIR, files[0]));
});

/* ================= SCHEDULER ================= */

function gpuPowerScore(gpu) {
  if (!gpu) return 0.5;
  if (gpu.includes("4090")) return 1.0;
  if (gpu.includes("3080")) return 0.8;
  if (gpu.includes("3060")) return 0.6;
  return 0.5;
}

function selectProvidersForRound() {
  const now = Date.now();

  return Array.from(providers.values())
    .filter(
      (p) =>
        p.status === "IDLE" &&
        p.availabilityMinutes > 0 &&
        now - p.lastSeen < PROVIDER_TIMEOUT_MS
    )
    .sort((a, b) => {
      const scoreA = a.reliabilityScore * gpuPowerScore(a.gpu);
      const scoreB = b.reliabilityScore * gpuPowerScore(b.gpu);
      return scoreB - scoreA;
    })
    .slice(0, MAX_PROVIDERS_PER_ROUND);
}

/* ================= ROUND LOOP ================= */

function startRound() {
  if (roundActive) return;

  const selected = selectProvidersForRound();

  if (selected.length === 0) {
    console.log("No available providers. Waiting...");
    return setTimeout(startRound, 3000);
  }

  roundActive = true;
  roundParticipants = selected.map((p) => p.providerId);

  console.log(
    `Round ${currentRound} started with providers:`,
    roundParticipants
  );

  selected.forEach((p) => (p.status = "BUSY"));
  setTimeout(endRound, ROUND_TIMEOUT_MS);
}

async function endRound() {
  console.log(`Round ${currentRound} ended`);

  spawn("python", [
    "src/models/aggregate.py",
    GLOBAL_MODEL_DIR,
    PROVIDER_UPDATES_DIR,
    currentRound.toString(),
  ]);

  // Availability enforcement
  for (const pid of roundParticipants) {
    const p = providers.get(pid);
    if (!p) continue;

    p.availabilityMinutes -= ROUND_DURATION_MIN;
    p.status = "IDLE";

    if (p.availabilityMinutes <= 0) {
      console.log("Availability exhausted:", pid);
      providers.delete(pid);

      await db.collection("providers").doc(pid).update({
        availabilityMinutes: 0,
        status: "EXHAUSTED",
      });
    }
  }

  currentRound++;
  roundActive = false;
  startRound();
}

/* ================= OFFLINE CLEANUP ================= */

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of providers.entries()) {
    if (now - p.lastSeen > PROVIDER_TIMEOUT_MS) {
      console.log("Provider offline:", id);
      providers.delete(id);
    }
  }
}, 5000);

/* ================= START ================= */

app.listen(7000, () => {
  console.log("Orchestrator running");
  setTimeout(startRound, 3000);
});
