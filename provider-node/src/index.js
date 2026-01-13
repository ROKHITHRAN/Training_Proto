// import axios from "axios";
// import fs from "fs";
// import { spawn } from "child_process";
// import { login } from "../firebase";

// const ORCH_URL = "http://localhost:7000";
// const PROVIDER_ID = process.env.PROVIDER_ID || "provider-1";

// const HEARTBEAT_INTERVAL_MS = 2000; // 2 seconds
// const POLL_INTERVAL_MS = 2000; // 2 seconds

// function sleep(ms) {
//   return new Promise((r) => setTimeout(r, ms));
// }

// let lastTrainedRound = 0;

// async function trainAndUpload(round) {
//   console.log(`🧠 Training for round ${round}`);

//   // 1. Download latest global model
//   const modelRes = await axios.get(`${ORCH_URL}/model/latest`, {
//     responseType: "arraybuffer",
//   });
//   fs.writeFileSync("global.pt", modelRes.data);

//   // 2. Run local training
//   await new Promise((resolve) => {
//     const py = spawn("python", [
//       "src/trainer/train.py",
//       "global.pt",
//       "updated.pt",
//     ]);

//     py.stdout.on("data", (d) => console.log(d.toString()));
//     py.stderr.on("data", (d) => console.error(d.toString()));
//     py.on("close", resolve);
//   });

//   // 3. Upload update
//   const buffer = fs.readFileSync("updated.pt");

//   await axios.post(`${ORCH_URL}/update`, buffer, {
//     headers: {
//       "Content-Type": "application/octet-stream",
//       "x-provider-id": PROVIDER_ID,
//       "x-round": round.toString(),
//     },
//   });

//   console.log(`📤 Update sent for round ${round}`);
// }

// async function sendHeartbeat() {
//   try {
//     await axios.post(`${ORCH_URL}/provider/heartbeat`, {
//       providerId: PROVIDER_ID,
//     });
//   } catch (err) {
//     console.error("Heartbeat failed:", err.message);
//   }
// }

// async function run() {
//   const systemInfo = detectSystemInfo();

//   console.log("Detected system:", systemInfo);

//   /* -------- Register ONCE -------- */
//   await axios.post(
//     `${ORCH_URL}/provider/register`,
//     {
//       gpu: systemInfo.gpu,
//       vram: systemInfo.vram,
//       cpuCores: systemInfo.cpuCores,
//       ramGB: systemInfo.ramGB,
//     },
//     {
//       headers: {
//         Authorization: `Bearer ${token}`,
//       },
//     }
//   );

//   console.log("🖥️ Provider registered:", PROVIDER_ID);

//   /* -------- Worker Loop -------- */
//   while (true) {
//     try {
//       // 1. Get current round state
//       const { data } = await axios.get(`${ORCH_URL}/round/current`);
//       const { round, active } = data;

//       // 2. Train only once per round
//       if (active && round > lastTrainedRound) {
//         await trainAndUpload(round);
//         lastTrainedRound = round;
//       }

//       // 3. Send heartbeat
//       await sendHeartbeat();
//     } catch (err) {
//       console.error("Provider loop error:", err.message);
//     }

//     await sleep(POLL_INTERVAL_MS);
//   }
// }
// const token = await login(
//   process.env.PROVIDER_EMAIL,
//   process.env.PROVIDER_PASSWORD
// );

// run();
import axios from "axios";
import fs from "fs";
import { spawn } from "child_process";
import { login } from "../firebase.js";
import "dotenv/config";

const ORCH_URL = "http://localhost:7000";

const POLL_INTERVAL_MS = 2000;

/* ---------------- UTILS ---------------- */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeUidFromToken(token) {
  const payload = token.split(".")[1];
  const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
  return decoded.user_id;
}

/* ---------------- TRAINING ---------------- */

let lastTrainedRound = 0;

async function trainAndUpload(round, providerId) {
  console.log(`Training for round ${round}`);

  const modelRes = await axios.get(`${ORCH_URL}/model/latest`, {
    responseType: "arraybuffer",
  });
  fs.writeFileSync("global.pt", modelRes.data);

  await new Promise((resolve) => {
    const py = spawn("python", [
      "src/trainer/train.py",
      "global.pt",
      "updated.pt",
    ]);
    py.on("close", resolve);
  });

  const buffer = fs.readFileSync("updated.pt");

  await axios.post(`${ORCH_URL}/update`, buffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "x-provider-id": providerId,
      "x-round": round.toString(),
    },
  });

  console.log(`Update sent for round ${round}`);
}

/* ---------------- HEARTBEAT ---------------- */

async function sendHeartbeat(providerId) {
  await axios.post(`${ORCH_URL}/provider/heartbeat`, {
    providerId,
  });
}

/* ---------------- SYSTEM INFO ---------------- */

function detectSystemInfo() {
  return {
    gpu: "RTX 3060", // mock for now
    vram: 12,
    cpuCores: 8,
    ramGB: 16,
  };
}

/* ---------------- MAIN ---------------- */

async function run() {
  // 1️⃣ Login programmatically (NO UI)
  const token = await login(
    process.env.PROVIDER_EMAIL,
    process.env.PROVIDER_PASSWORD
  );

  // 2️⃣ Extract Firebase UID
  const providerId = decodeUidFromToken(token);

  console.log("Authenticated provider UID:", providerId);

  // 3️⃣ Detect system
  const systemInfo = detectSystemInfo();
  console.log("Detected system:", systemInfo);

  // 4️⃣ Runtime register with orchestrator
  await axios.post(`${ORCH_URL}/provider/register`, systemInfo, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  console.log("Provider ONLINE");

  // 5️⃣ Worker loop
  while (true) {
    try {
      const { data } = await axios.get(`${ORCH_URL}/round/current`);
      const { round, active } = data;

      if (active && round > lastTrainedRound) {
        await trainAndUpload(round, providerId);
        lastTrainedRound = round;
      }

      await sendHeartbeat(providerId);
    } catch (err) {
      console.error("Provider error:", err.message);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

run();
