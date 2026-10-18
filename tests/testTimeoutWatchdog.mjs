// testTimeoutWatchdog.mjs — Simulates 6s backend delay vs normal fast reply
import { getHonestFallback } from "../src/lib/safetyNet.js";

async function runWatchdogSimulation() {
  console.log("=================================================================");
  console.log("  AI TIMEOUT WATCHDOG SIMULATION TEST");
  console.log("=================================================================\n");

  // Simulated state
  let convState = "THINKING";
  let aiTurnTimeout = null;
  let timedOutTurnId = null;
  const spokenLog = [];

  function simulateSendTranscript(turnId, text, backendDelayMs) {
    console.log(`\n[User Turn] User said: "${text}" (turnId: ${turnId})`);
    convState = "THINKING";

    // Arm 4s watchdog
    clearTimeout(aiTurnTimeout);
    aiTurnTimeout = setTimeout(() => {
      if (convState === "THINKING") {
        console.log(`[Watchdog] 4000ms elapsed. Watchdog FIRED for turnId: ${turnId}`);
        timedOutTurnId = turnId;
        const fallback = getHonestFallback("taking_longer");
        convState = "SPEAKING";
        spokenLog.push({ turnId: `fallback_${turnId}`, text: fallback });
        console.log(`[Greeny Audio] Spoke fallback: "${fallback}"`);
      }
    }, 4000);

    // Simulate backend response after backendDelayMs
    return new Promise((resolve) => {
      setTimeout(() => {
        const sentence = `Here is the details for your question about ${text}`;
        console.log(`[Backend WS] Received sentence after ${backendDelayMs}ms for turnId: ${turnId}`);

        // Frontend sentence receiver logic
        clearTimeout(aiTurnTimeout);
        if (timedOutTurnId && (turnId === timedOutTurnId)) {
          console.log(`[Frontend] IGNORING late sentence for timed-out turnId: ${turnId} (never speak both!)`);
        } else {
          convState = "SPEAKING";
          spokenLog.push({ turnId, text: sentence });
          console.log(`[Greeny Audio] Spoke AI sentence: "${sentence}"`);
        }
        resolve();
      }, backendDelayMs);
    });
  }

  // TEST 1: Simulate 6-second slow backend delay
  console.log("--- TEST CASE 1: Slow Backend (6000ms delay) ---");
  await simulateSendTranscript("turn_slow_101", "tell me about this canister", 6000);

  // TEST 2: Simulate normal fast backend (500ms delay)
  console.log("\n--- TEST CASE 2: Fast Backend (500ms delay) ---");
  await simulateSendTranscript("turn_fast_202", "how much is the bottle", 500);

  console.log("\n-----------------------------------------------------------------");
  console.log("  SIMULATION RESULTS & VERIFICATION:");
  console.log("-----------------------------------------------------------------");
  console.log("Spoken events:", JSON.stringify(spokenLog, null, 2));

  const slowTurnSpokeFallback = spokenLog.some(e => e.turnId.startsWith("fallback_turn_slow_101"));
  const slowTurnDroppedLateReply = !spokenLog.some(e => e.turnId === "turn_slow_101");
  const fastTurnSpokeNormal = spokenLog.some(e => e.turnId === "turn_fast_202");

  if (slowTurnSpokeFallback && slowTurnDroppedLateReply && fastTurnSpokeNormal) {
    console.log("\n✓ [PASS] Watchdog successfully fired for 6s delay, dropped late reply, and allowed fast reply!");
    process.exit(0);
  } else {
    console.error("\n✗ [FAIL] Watchdog simulation failed.");
    process.exit(1);
  }
}

runWatchdogSimulation();
