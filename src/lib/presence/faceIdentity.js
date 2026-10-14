// src/lib/presence/faceIdentity.js
// Face identity comparison using @vladmandic/human browser build.
// Embeddings are kept strictly IN MEMORY ONLY (gallery in RAM).
// Never written to disk, localStorage, sessionStorage, or the network.

import {
  FACE_ID_ENABLED,
  FACE_ID_DEBUG,
  FACE_SAME_MIN_SIMILARITY,
  FACE_DIFFERENT_MAX_SIMILARITY,
} from "@/lib/presenceConfig";

const FACE_SAME_MIN = FACE_SAME_MIN_SIMILARITY ?? 0.65;
const FACE_DIFFERENT_MAX = FACE_DIFFERENT_MAX_SIMILARITY ?? 0.40;

// ── In-Memory Gallery (RAM Only) ────────────────────────────────────────────
let gallery = []; // number[][] in RAM only
let humanInstance = null;
let humanLoadPromise = null;

// Wipe RAM on page unload for complete privacy
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    gallery = [];
    humanInstance = null;
  });
}

/**
 * Lazy load and configure @vladmandic/human instance once.
 * Only face description/embedding model is enabled. Emotion, age, gender,
 * body, hand, gesture, and object models are disabled to keep it ultra-lightweight.
 */
async function getHuman() {
  if (typeof window === "undefined" || !FACE_ID_ENABLED) return null;
  if (humanInstance) return humanInstance;
  if (humanLoadPromise) return humanLoadPromise;

  humanLoadPromise = (async () => {
    try {
      const humanModule = await import("../../../node_modules/@vladmandic/human/dist/human.esm.js");
      const HumanClass = humanModule.Human || humanModule.default;

      const config = {
        modelBasePath: "/models/",
        backend: "webgl",
        debug: false,
        cacheModels: false,
        face: {
          enabled: true,
          detector: { rotation: false, maxDetected: 1, minConfidence: 0.5 },
          mesh: { enabled: true },
          iris: { enabled: false },
          description: { enabled: true },
          emotion: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false },
          gear: { enabled: false },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        gesture: { enabled: false },
        segmentation: { enabled: false },
        filter: { enabled: false },
      };

      let instance = null;
      try {
        instance = new HumanClass(config);
        await instance.load();
      } catch (gpuErr) {
        if (FACE_ID_DEBUG) {
          console.warn("[FaceID] WebGL backend failed for Human, trying WASM/CPU:", gpuErr);
        }
        const fallbackConfig = { ...config, backend: "wasm" };
        instance = new HumanClass(fallbackConfig);
        await instance.load();
      }

      humanInstance = instance;
      if (FACE_ID_DEBUG) {
        console.log("[FaceID] Human model loaded successfully for face description.");
      }
      return humanInstance;
    } catch (err) {
      console.warn("[FaceID] Failed to load Human model:", err);
      return null;
    } finally {
      humanLoadPromise = null;
    }
  })();

  return humanLoadPromise;
}

/**
 * Helper to read a face from the video element and verify frontal orientation.
 */
async function readFace(video) {
  if (!video || video.readyState < 2 || video.paused) {
    return { face: null, count: 0, notFrontal: false };
  }
  const h = await getHuman();
  if (!h) return { face: null, count: 0, notFrontal: false };

  try {
    const result = await h.detect(video);
    const faces = result?.face || [];
    const count = faces.length;
    if (count === 0) return { face: null, count: 0, notFrontal: false };

    const face = faces[0];
    if (!face?.embedding || !Array.isArray(face.embedding)) {
      return { face: null, count, notFrontal: false };
    }

    // Check frontal orientation from face rotation or eye/nose offset
    let notFrontal = false;
    if (face.rotation?.angle) {
      const { yaw, pitch } = face.rotation.angle;
      if (Math.abs(yaw) > 30 || Math.abs(pitch) > 25) {
        notFrontal = true;
      }
    }

    return { face, count, notFrontal };
  } catch (err) {
    if (FACE_ID_DEBUG) console.warn("[FaceID] readFace error:", err);
    return { face: null, count: 0, notFrontal: false };
  }
}

export function hasEnrolled() {
  return gallery.length > 0;
}

export function clearFace() {
  gallery = [];
  if (FACE_ID_DEBUG) {
    console.log("[FaceID] Face gallery cleared from memory.");
  }
}

/**
 * Enroll face by capturing up to 6 good samples across 12 attempts
 * spread over time (~200ms) to capture different natural head poses.
 */
export async function enrollFace(video) {
  try {
    const samples = [];
    for (let i = 0; i < 12 && samples.length < 6; i++) {
      const { face, count } = await readFace(video);
      if (face && count === 1) samples.push(face.embedding);
      await new Promise((r) => setTimeout(r, 200)); // spread over time = different head poses
    }
    if (samples.length < 3) return false;
    gallery = samples;
    console.log(`[FaceID] enrolled frames=${samples.length}`);
    return true;
  } catch (e) {
    console.warn("[FaceID] enroll failed", e);
    return false;
  }
}

/**
 * One reading: best match against the whole gallery of head poses.
 */
async function compareOnce(video) {
  const h = await getHuman();
  if (!h) return { status: "unsure", similarity: null, faceCount: 0 };
  const { face, count, notFrontal } = await readFace(video);
  if (!face) return { status: notFrontal ? "unsure" : "no_face", similarity: null, faceCount: count };

  const similarity = Math.max(...gallery.map((g) => h.match.similarity(g, face.embedding)));
  let status = "unsure";
  if (similarity >= FACE_SAME_MIN) status = "same";
  else if (similarity <= FACE_DIFFERENT_MAX) status = "different";
  return { status, similarity, faceCount: count };
}

/**
 * 3 quick readings, majority vote. Far more reliable than a single frame.
 */
export async function compareBurst(video, n = 3, gapMs = 120) {
  if (!gallery.length) return { status: "unsure", votes: {} };
  const votes = { same: 0, different: 0, other: 0 };
  let last = null;
  for (let i = 0; i < n; i++) {
    try {
      last = await compareOnce(video);
      if (last.status === "same") votes.same++;
      else if (last.status === "different") votes.different++;
      else votes.other++;
    } catch {
      votes.other++;
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  let status = "unsure";
  if (votes.different >= 2 && votes.same === 0) status = "different";
  else if (votes.same >= 2 && votes.different === 0) status = "same";
  console.log(`[FaceID] burst ${JSON.stringify(votes)} lastSim=${last?.similarity?.toFixed(2)} -> ${status}`);
  return { status, votes, similarity: last?.similarity ?? null };
}

/**
 * Convenience wrapper for callers expecting compareFace
 */
export async function compareFace(video) {
  return compareBurst(video, 3, 120);
}
