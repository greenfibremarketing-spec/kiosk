// src/lib/presenceConfig.js
// Configuration constants for presence-based session handling.
// Single source of truth for engagement distances, absence thresholds, and optics.

export const PRESENCE_CONFIG = {
  // ── Engagement Distance Thresholds & Hysteresis ───────────────────────────
  ENTER_DISTANCE_CM: 150,     // 150 cm: enter engagement
  EXIT_DISTANCE_CM: 190,      // 190 cm: hysteresis exit engagement
  ENTER_STABLE_MS: 500,       // 500 ms: face must stay in range before engaging

  // ── Optics & Distance Formula Constants ──────────────────────────────────
  // Pinhole distance formula: cm = (FACE_REAL_WIDTH_CM * FOCAL_PX) / faceWidthPx
  FOCAL_PX: 580,              // Camera focal length in pixels (tune with calibration log/overlay)
  FACE_REAL_WIDTH_CM: 15,     // Average human face width in cm
  MIN_FACE_WIDTH_PX: 35,      // Minimum face width in px to be considered reliable (ignore tiny/far faces)

  // ── Absence thresholds ───────────────────────────────────────────────────
  ABSENT_SHORT_MS: 4000,      // 4.0s: Face absent >= 4s before present -> absent_short
  ABSENT_LONG_MS: 10000,      // 10s: Customer departed, reset session even if idle

  // Continuous face detection threshold: require >= 500ms before absent -> present
  PRESENT_CONTINUOUS_MS: 500,

  // Debounce: consecutive frames with a face required to confirm presence
  PRESENCE_FRAMES: 3,

  // Identity verification modal timeout (8s per prompt, max 2 prompts)
  CONFIRMATION_TIMEOUT_MS: 8000,

  // Session reset debounce (under 1000ms so swaps trigger immediate reset)
  RESET_DEBOUNCE_MS: 800,

  // Maximum faces to detect with FaceLandmarker
  MAX_FACES: 4,

  // ── Face Identity (In-Memory Returning Face Comparison) ───────────────────
  FACE_ID_ENABLED: true,
  FACE_ID_DEBUG: true,

  // Similarity thresholds using @vladmandic/human similarity function (0.0 to 1.0).
  FACE_SAME_MIN_SIMILARITY: 0.65,       // >= 0.65 considered the same customer
  FACE_DIFFERENT_MAX_SIMILARITY: 0.40,  // <= 0.40 considered a different person; (0.40..0.65 = "unsure")

  // Maximum absence gap (30s): If customer is absent longer than this, treat as new customer even if face matches
  FACE_MAX_SAME_GAP_MS: 30000,
};

export const ENTER_DISTANCE_CM = PRESENCE_CONFIG.ENTER_DISTANCE_CM;
export const EXIT_DISTANCE_CM = PRESENCE_CONFIG.EXIT_DISTANCE_CM;
export const ENTER_STABLE_MS = PRESENCE_CONFIG.ENTER_STABLE_MS;
export const FOCAL_PX = PRESENCE_CONFIG.FOCAL_PX;
export const FACE_REAL_WIDTH_CM = PRESENCE_CONFIG.FACE_REAL_WIDTH_CM;
export const MIN_FACE_WIDTH_PX = PRESENCE_CONFIG.MIN_FACE_WIDTH_PX;

export const ABSENT_SHORT_MS = PRESENCE_CONFIG.ABSENT_SHORT_MS;
export const ABSENT_LONG_MS = PRESENCE_CONFIG.ABSENT_LONG_MS;
export const PRESENT_CONTINUOUS_MS = PRESENCE_CONFIG.PRESENT_CONTINUOUS_MS;
export const PRESENCE_FRAMES = PRESENCE_CONFIG.PRESENCE_FRAMES;
export const CONFIRMATION_TIMEOUT_MS = PRESENCE_CONFIG.CONFIRMATION_TIMEOUT_MS;
export const RESET_DEBOUNCE_MS = PRESENCE_CONFIG.RESET_DEBOUNCE_MS;
export const MAX_FACES = PRESENCE_CONFIG.MAX_FACES;

export const FACE_ID_ENABLED = PRESENCE_CONFIG.FACE_ID_ENABLED;
export const FACE_ID_DEBUG = PRESENCE_CONFIG.FACE_ID_DEBUG;
export const FACE_SAME_MIN_SIMILARITY = PRESENCE_CONFIG.FACE_SAME_MIN_SIMILARITY;
export const FACE_DIFFERENT_MAX_SIMILARITY = PRESENCE_CONFIG.FACE_DIFFERENT_MAX_SIMILARITY;
export const FACE_MAX_SAME_GAP_MS = PRESENCE_CONFIG.FACE_MAX_SAME_GAP_MS;

export default PRESENCE_CONFIG;
