/**
 * ttsConfig.js
 * Source of truth for Text-To-Speech (Deepgram Aura) configuration.
 * Pinned model: aura-2-luna-en (warm, polite, cute young female avatar voice)
 */

export const TTS_CONFIG = {
  provider: "deepgram",
  model: process.env.NEXT_PUBLIC_TTS_MODEL || "aura-2-luna-en",
  fallbackModel: "aura-luna-en",
  encoding: "mp3",
  sampleRate: 24000,
  container: "none",
};

export const TTS_ENDPOINT =
  process.env.NEXT_PUBLIC_TTS_URL || "http://localhost:4000/api/tts";

export default TTS_CONFIG;
