// src/lib/presenceConfig.js
// Configuration constants for presence-based session handling.
// No facial recognition, embeddings, or identity matching is used.

export const PRESENCE_CONFIG = {
  // Absence thresholds
  ABSENT_SHORT_MS: 4000,  // 4.0s: Face absent >= 4s before present -> absent_short
  ABSENT_LONG_MS: 10000,  // 10s: Customer departed, reset session even if idle

  // Continuous face detection threshold: require >= 500ms before absent -> present
  PRESENT_CONTINUOUS_MS: 500,

  // Debounce: consecutive frames with a face required to confirm presence
  PRESENCE_FRAMES: 3,

  // Identity verification modal timeout (8s per prompt, max 2 prompts)
  CONFIRMATION_TIMEOUT_MS: 8000,

  // Session reset debounce (cannot run twice within 2s)
  RESET_DEBOUNCE_MS: 2000,

  // Maximum faces to detect with FaceLandmarker
  MAX_FACES: 4,
};

export const ABSENT_SHORT_MS = PRESENCE_CONFIG.ABSENT_SHORT_MS;
export const ABSENT_LONG_MS = PRESENCE_CONFIG.ABSENT_LONG_MS;
export const PRESENT_CONTINUOUS_MS = PRESENCE_CONFIG.PRESENT_CONTINUOUS_MS;
export const PRESENCE_FRAMES = PRESENCE_CONFIG.PRESENCE_FRAMES;
export const CONFIRMATION_TIMEOUT_MS = PRESENCE_CONFIG.CONFIRMATION_TIMEOUT_MS;
export const RESET_DEBOUNCE_MS = PRESENCE_CONFIG.RESET_DEBOUNCE_MS;
export const MAX_FACES = PRESENCE_CONFIG.MAX_FACES;

export default PRESENCE_CONFIG;
