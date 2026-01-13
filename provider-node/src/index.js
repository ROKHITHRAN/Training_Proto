// import axios from "axios";
// import fs from "fs";
// import { spawn } from "child_process";

// const ORCH_URL = "http://localhost:7000";
// const PROVIDER_ID = "provider-1";

// async function run() {
//   /* 1. Download global model */
//   const res = await axios.get(`${ORCH_URL}/model/latest`, {
//     responseType: "arraybuffer",
//   });

//   fs.writeFileSync("global.pt", res.data);
//   console.log("⬇️ Global model downloaded");

//   /* 2. Train locally */
//   const py = spawn("python", [
//     "src/trainer/train.py",
//     "global.pt",
//     "updated.pt",
//   ]);

//   py.stdout.on("data", (d) => console.log(d.toString()));

//   py.on("close", async () => {
//     /* 3. Upload update */
//     const buffer = fs.readFileSync("updated.pt");

//     await axios.post(`${ORCH_URL}/update`, buffer, {
//       headers: {
//         "Content-Type": "application/octet-stream",
//         "x-provider-id": PROVIDER_ID,
//         "x-round": "1",
//       },
//     });

//     console.log("📤 Update sent");
//   });
// }

// run();

import axios from "axios";
import fs from "fs";
import { spawn } from "child_process";

const ORCH_URL = "http://localhost:7000";
const PROVIDER_ID = process.env.PROVIDER_ID || "provider-1";

const HEARTBEAT_INTERVAL_MS = 2000; // 2 seconds
const POLL_INTERVAL_MS = 2000; // 2 seconds

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let lastTrainedRound = 0;

async function trainAndUpload(round) {
  console.log(`🧠 Training for round ${round}`);

  // 1. Download latest global model
  const modelRes = await axios.get(`${ORCH_URL}/model/latest`, {
    responseType: "arraybuffer",
  });
  fs.writeFileSync("global.pt", modelRes.data);

  // 2. Run local training
  await new Promise((resolve) => {
    const py = spawn("python", [
      "src/trainer/train.py",
      "global.pt",
      "updated.pt",
    ]);

    py.stdout.on("data", (d) => console.log(d.toString()));
    py.stderr.on("data", (d) => console.error(d.toString()));
    py.on("close", resolve);
  });

  // 3. Upload update
  const buffer = fs.readFileSync("updated.pt");

  await axios.post(`${ORCH_URL}/update`, buffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "x-provider-id": PROVIDER_ID,
      "x-round": round.toString(),
    },
  });

  console.log(`📤 Update sent for round ${round}`);
}

async function sendHeartbeat() {
  try {
    await axios.post(`${ORCH_URL}/provider/heartbeat`, {
      providerId: PROVIDER_ID,
    });
  } catch (err) {
    console.error("Heartbeat failed:", err.message);
  }
}

async function run() {
  /* -------- Register ONCE -------- */
  await axios.post(`${ORCH_URL}/provider/register`, {
    providerId: PROVIDER_ID,
    gpu: "Mock GPU",
    vram: 8,
    availabilityMinutes: 20,
  });

  console.log("🖥️ Provider registered:", PROVIDER_ID);

  /* -------- Worker Loop -------- */
  while (true) {
    try {
      // 1. Get current round state
      const { data } = await axios.get(`${ORCH_URL}/round/current`);
      const { round, active } = data;

      // 2. Train only once per round
      if (active && round > lastTrainedRound) {
        await trainAndUpload(round);
        lastTrainedRound = round;
      }

      // 3. Send heartbeat
      await sendHeartbeat();
    } catch (err) {
      console.error("Provider loop error:", err.message);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

run();
