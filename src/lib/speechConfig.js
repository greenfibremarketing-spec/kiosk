/**
 * speechConfig.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Central configuration for all speech-state thresholds.
 * Tune these values without touching hook logic.
 */

const speechConfig = {
  // ─── Audio / VAD ────────────────────────────────────────────────────────────

  /** Minimum RMS level (0–1) to consider audio "present" */
  audioLevelThreshold: 0.012,

  /** Rolling window (ms) for computing jaw-open VARIANCE */
  jawVarianceWindowMs: 300,

  /**
   * Minimum jaw-open VARIANCE to consider the mouth "actively moving".
   * Variance of a static jaw ≈ 0, variance of speech movement ≈ 0.003–0.02.
   */
  jawVarianceThreshold: 0.0010,

  // ─── Face / Presence ────────────────────────────────────────────────────────

  /**
   * Minimum faceSizeRatio for the user to be "near enough" to count for
   * face-based speech detection. FaceSizeRatio ≈ jaw-width / frame-width.
   * A value around 0.08 corresponds to roughly 120 cm away on a 640-wide feed.
   */
  faceSizeRatioThreshold: 0.08,

  // ─── Debounce & Hangover ─────────────────────────────────────────────────────

  /** Onset debounce: evidence must persist for this long before userSpeaking → true (ms) */
  onsetDebounceMs: 0,

  /**
   * Hangover: keep userSpeaking = true for this long after the LAST piece of
   * evidence, so short mic dropouts or jaw pauses don't flip the state (ms).
   */
  hangoverMs: 450,

  // ─── End-of-Turn Detection ──────────────────────────────────────────────────

  /**
   * After userSpeaking goes false, wait this long before finalising the turn
   * and sending the transcript to the AI backend (ms).
   */
  endOfTurnSilenceMs: 2000,

  // ─── Pre-roll buffer ─────────────────────────────────────────────────────────

  /** How many ms of audio to keep in the pre-roll ring-buffer (ms) */
  preRollMs: 500,

  // ─── "Can't hear you" rules ──────────────────────────────────────────────────

  /**
   * If face says speaking but audioLevel stays below audioLevelThreshold for
   * this long, show a "please speak closer" nudge (ms).
   */
  lowAudioWithFaceMs: 2000,

  /** After this many consecutive STT failures, show touch/push-to-talk buttons */
  failuresBeforePTT: 2,

  // ─── Proactive "mm" filler ───────────────────────────────────────────────────

  /**
   * If THINKING state lasts longer than this, play a short filler utterance
   * ("Let me think…") to signal the avatar is processing (ms).
   */
  thinkingFillerMs: 1500,
};

export default speechConfig;
