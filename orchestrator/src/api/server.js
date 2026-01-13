import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

/* ================= GLOBAL CONFIG ================= */

const MAX_PROVIDERS_PER_ROUND = 2;
const ROUND_TIMEOUT_MS = 15000;
const PROVIDER_TIMEOUT_MS = 12000;
const ROUND_DURATION_MIN = 5;

/* ================= STATE ================= */

const providers = new Map();
let currentRound = 1;
let roundActive = false;

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
  if (fs.existsSync(modelPath)) return;

  console.log("Initializing global model...");
  spawn("python", ["src/models/init_model.py", GLOBAL_MODEL_DIR]);
}

initGlobalModel();

/* ================= UTILS ================= */

function gpuPowerScore(gpu) {
  if (!gpu) return 0.5;
  if (gpu.includes("4090")) return 1.0;
  if (gpu.includes("3080")) return 0.8;
  if (gpu.includes("3060")) return 0.6;
  return 0.5;
}

/* ================= SCHEDULER ================= */

function selectProvidersForRound() {
  const now = Date.now();

  const eligible = Array.from(providers.values()).filter((p) => {
    return p.status === "IDLE" && now - p.lastSeen < PROVIDER_TIMEOUT_MS;
  });

  eligible.forEach((p) => {
    const gpuScore = gpuPowerScore(p.gpu);
    const availabilityFactor = Math.min(
      (p.availabilityMinutes || ROUND_DURATION_MIN) / ROUND_DURATION_MIN,
      1.0
    );

    p.scheduleScore = p.reliabilityScore * gpuScore * availabilityFactor;
  });

  eligible.sort((a, b) => b.scheduleScore - a.scheduleScore);

  return eligible.slice(0, MAX_PROVIDERS_PER_ROUND);
}

/* ================= ROUND LOOP ================= */

function startRound() {
  if (roundActive) return;

  const selected = selectProvidersForRound();

  if (selected.length === 0) {
    console.log("No providers available for round", currentRound);
    setTimeout(startRound, 3000);
    return;
  }

  roundActive = true;
  console.log(
    `Round ${currentRound} started with providers:`,
    selected.map((p) => p.providerId)
  );

  selected.forEach((p) => {
    p.status = "BUSY";
    p.lastScheduledAt = Date.now();
  });

  setTimeout(endRound, ROUND_TIMEOUT_MS);
}

function endRound() {
  console.log(`Round ${currentRound} timeout reached`);

  spawn("python", [
    "src/models/aggregate.py",
    GLOBAL_MODEL_DIR,
    PROVIDER_UPDATES_DIR,
    currentRound.toString(),
  ]);

  for (const p of providers.values()) {
    p.status = "IDLE";
  }

  currentRound += 1;
  roundActive = false;

  startRound();
}

/* ================= HEARTBEAT CLEANUP ================= */

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of providers.entries()) {
    if (now - p.lastSeen > PROVIDER_TIMEOUT_MS) {
      console.log("Provider offline:", id);
      providers.delete(id);
    }
  }
}, 5000);

/* ================= API ================= */

app.get("/round/current", (req, res) => {
  res.json({ round: currentRound, active: roundActive });
});

app.get("/model/latest", (req, res) => {
  const files = fs
    .readdirSync(GLOBAL_MODEL_DIR)
    .filter((f) => f.startsWith("round-"))
    .sort((a, b) => parseInt(b.split("-")[1]) - parseInt(a.split("-")[1]));

  res.sendFile(path.join(GLOBAL_MODEL_DIR, files[0]));
});

app.post("/provider/register", (req, res) => {
  const { providerId, gpu, vram, availabilityMinutes } = req.body;

  providers.set(providerId, {
    providerId,
    gpu: gpu || "unknown",
    vram: vram || 0,
    availabilityMinutes: availabilityMinutes || ROUND_DURATION_MIN,
    reliabilityScore: 1.0,
    status: "IDLE",
    lastSeen: Date.now(),
    lastScheduledAt: 0,
  });

  console.log("Provider registered:", providerId);
  res.json({ status: "registered" });
});

app.post("/provider/heartbeat", (req, res) => {
  const { providerId } = req.body;
  const p = providers.get(providerId);
  if (!p) return res.status(404).end();

  p.lastSeen = Date.now();
  res.json({ status: "alive" });
});

app.post("/update", (req, res) => {
  const providerId = req.headers["x-provider-id"];
  const round = req.headers["x-round"];

  const filePath = path.join(
    PROVIDER_UPDATES_DIR,
    `round-${round}-${providerId}.pt`
  );

  const stream = fs.createWriteStream(filePath);
  req.pipe(stream);

  stream.on("finish", () => {
    console.log(`Update received from ${providerId} for round ${round}`);
    res.json({ status: "stored" });
  });
});

/* ================= START ================= */

app.listen(7000, () => {
  console.log("Orchestrator running on port 7000");
  setTimeout(startRound, 3000);
});
