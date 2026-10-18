// measureServerColdStart.mjs — Runs 3 separate cold starts of server/index.js and measures step timings
import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.resolve(__dirname, "../server/index.js");

function runOneColdStart(iteration) {
  return new Promise((resolve, reject) => {
    const tStart = Date.now();
    console.log(`\n=================================================================`);
    console.log(`  COLD START RUN #${iteration} at ${new Date().toISOString()}`);
    console.log(`=================================================================`);

    const child = fork(serverScript, [], {
      silent: true,
      env: {
        ...process.env,
        PORT: String(4000 + iteration), // Use different port per run to avoid collision
        TTS_CACHE_DIR: path.resolve(__dirname, "../.cache/test_tts_" + iteration)
      }
    });

    const logs = [];

    child.stdout.on("data", (data) => {
      const line = data.toString().trim();
      const elapsed = Date.now() - tStart;
      console.log(`[+${elapsed}ms] ${line}`);
      logs.push({ elapsed, line });

      // When health check or server ready is confirmed, we can finish this run
      if (line.includes("format check OK") || line.includes("06_health_check_done") || line.includes("Deepgram Aura Voice server running")) {
        setTimeout(() => {
          child.kill();
          resolve(logs);
        }, 1500);
      }
    });

    child.stderr.on("data", (data) => {
      const line = data.toString().trim();
      console.warn(`[STDERR] ${line}`);
    });

    child.on("error", (err) => {
      console.error(`[Process Error]`, err);
      reject(err);
    });

    // Timeout safety
    setTimeout(() => {
      child.kill();
      resolve(logs);
    }, 15000);
  });
}

async function main() {
  for (let i = 1; i <= 3; i++) {
    await runOneColdStart(i);
  }
  console.log(`\n=================================================================`);
  console.log(`  ALL 3 COLD START RUNS COMPLETED`);
  console.log(`=================================================================`);
}

main().catch(console.error);
