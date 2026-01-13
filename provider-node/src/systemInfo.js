import { execSync } from "child_process";
import os from "os";

export function detectSystemInfo() {
  let gpu = "unknown";
  let vram = 0;

  try {
    const output = execSync(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader",
      { encoding: "utf8" }
    ).trim();

    if (output) {
      const [name, mem] = output.split(",");
      gpu = name.trim();
      vram = parseInt(mem.replace("MiB", "").trim()) / 1024; // GB
    }
  } catch {
    // nvidia-smi not available (CPU-only system)
  }

  return {
    gpu,
    vram,
    cpuCores: os.cpus().length,
    ramGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
  };
}
