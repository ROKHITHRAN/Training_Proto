import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

/* ---------------- GLOBAL STATE ---------------- */

const providers = new Map();

let currentRound = 1;
let roundActive = false;

const ROUND_TIMEOUT_MS = 15000; // round duration
const AGGREGATION_DELAY_MS = 2000; // wait for uploads to finish
const PROVIDER_TIMEOUT_MS = 12000; // offline if no heartbeat

/* ---------------- PATH SETUP ---------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, "../../../");
const STORAGE_DIR = path.join(ROOT_DIR, "storage");

const GLOBAL_MODEL_DIR = path.join(STORAGE_DIR, "global-models");
const PROVIDER_UPDATES_DIR = path.join(STORAGE_DIR, "provider-updates");

fs.mkdirSync(GLOBAL_MODEL_DIR, { recursive: true });
fs.mkdirSync(PROVIDER_UPDATES_DIR, { recursive: true });

/* ---------------- MODEL INIT ---------------- */

function initGlobalModel() {
  const modelPath = path.join(GLOBAL_MODEL_DIR, "round-0.pt");
  if (fs.existsSync(modelPath)) return;

  console.log("Initializing global model...");
  spawn("python", ["src/models/init_model.py", GLOBAL_MODEL_DIR]);
}

initGlobalModel();

/* ---------------- ROUND LOGIC ---------------- */

function startRound() {
  if (roundActive) return;

  roundActive = true;
  console.log(`Round ${currentRound} started`);

  setTimeout(endRound, ROUND_TIMEOUT_MS);
}

function endRound() {
  console.log(`Round ${currentRound} timeout reached`);

  const roundToAggregate = currentRound;

  // delay aggregation to avoid race condition
  setTimeout(() => {
    const py = spawn("python", [
      "src/models/aggregate.py",
      GLOBAL_MODEL_DIR,
      PROVIDER_UPDATES_DIR,
      roundToAggregate.toString(),
    ]);

    py.stdout.on("data", (d) => console.log("[AGG]", d.toString().trim()));
    py.stderr.on("data", (d) =>
      console.error("[AGG ERR]", d.toString().trim())
    );

    // cleanup provider updates for this round
    py.on("close", () => {
      for (const f of fs.readdirSync(PROVIDER_UPDATES_DIR)) {
        if (f.startsWith(`round-${roundToAggregate}-`)) {
          fs.unlinkSync(path.join(PROVIDER_UPDATES_DIR, f));
        }
      }
    });
  }, AGGREGATION_DELAY_MS);

  currentRound += 1;
  roundActive = false;

  startRound();
}

/* ---------------- API ---------------- */

app.get("/round/current", (req, res) => {
  res.json({ round: currentRound, active: roundActive });
});

app.get("/model/latest", (req, res) => {
  const files = fs
    .readdirSync(GLOBAL_MODEL_DIR)
    .filter((f) => f.startsWith("round-"));

  if (files.length === 0) {
    return res.status(404).json({ error: "No model found" });
  }

  files.sort((a, b) => parseInt(b.split("-")[1]) - parseInt(a.split("-")[1]));

  res.sendFile(path.join(GLOBAL_MODEL_DIR, files[0]));
});

app.post("/provider/register", (req, res) => {
  const { providerId, gpu, vram, availabilityMinutes } = req.body;

  if (!providerId) {
    return res.status(400).json({ error: "providerId required" });
  }

  providers.set(providerId, {
    providerId,
    gpu: gpu || "unknown",
    vram: vram || 0,
    availabilityMinutes: availabilityMinutes || 0,
    lastSeen: Date.now(),
  });

  console.log("Provider registered:", providerId);
  res.json({ status: "registered" });
});

app.post("/provider/heartbeat", (req, res) => {
  const { providerId } = req.body;

  const provider = providers.get(providerId);
  if (!provider) {
    return res.status(404).json({ error: "Provider not registered" });
  }

  provider.lastSeen = Date.now();
  res.json({ status: "alive" });
});

app.post("/update", (req, res) => {
  const providerId = req.headers["x-provider-id"];
  const round = req.headers["x-round"];

  const updatePath = path.join(
    PROVIDER_UPDATES_DIR,
    `round-${round}-${providerId}.pt`
  );

  const stream = fs.createWriteStream(updatePath);
  req.pipe(stream);

  stream.on("finish", () => {
    console.log(`Update received from ${providerId} (round ${round})`);
    res.json({ status: "stored" });
  });
});

/* ---------------- OFFLINE DETECTION ---------------- */

setInterval(() => {
  const now = Date.now();

  for (const [id, provider] of providers.entries()) {
    if (now - provider.lastSeen > PROVIDER_TIMEOUT_MS) {
      console.log(`Provider offline: ${id}`);
      providers.delete(id);
    }
  }
}, 5000);

/* ---------------- START SERVER ---------------- */

app.listen(7000, () => {
  console.log("Orchestrator running on port 7000");

  // allow providers to register
  setTimeout(startRound, 3000);
});
