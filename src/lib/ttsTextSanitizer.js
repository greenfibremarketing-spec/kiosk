import { normalizeForSpeech, chunkText } from "./productSpeech.mjs";

/**
 * ttsTextSanitizer.js
 * Cleans text before sending to Deepgram Aura TTS.
 * Standardized on normalizeForSpeech and chunkText from productSpeech.mjs.
 */

/**
 * @param {string} text
 * @returns {string} sanitized text safe for TTS
 */
export function sanitizeTtsText(text) {
  return normalizeForSpeech(text);
}

/**
 * Split a full reply text into TTS sentences for early streaming.
 * Splits on sentence-ending punctuation (. ? !) without breaking inside numbers or at commas.
 *
 * @param {string} text
 * @returns {string[]} array of non-empty sentence strings
 */
export function splitIntoSentences(text) {
  return chunkText(text);
}

/**
 * Splits text into natural sentence TTS chunks for smooth, low-latency synthesis.
 * Uses chunkText: splits ONLY at sentence ends (. ! ?), never at commas or inside numbers.
 *
 * @param {string} text
 * @returns {string[]} array of sanitized, non-empty chunks
 */
export function splitIntoTtsChunks(text) {
  return chunkText(text);
}

/**
 * Buffers streamed tokens and emits completed sentences.
 * Follows the exact sentence boundaries (. ? !) without fragmenting on commas.
 */
export class SentenceTokenStreamer {
  constructor(onSentence) {
    this.onSentence = typeof onSentence === "function" ? onSentence : null;
    this.buffer = "";
  }

  push(token) {
    if (typeof token !== "string" || !token) return;
    this.buffer += token;

    while (this.buffer.length > 0) {
      // Punctuation (. ? !) optionally followed by quotes/parens, then whitespace
      const match = this.buffer.match(/^([\s\S]*?[.?!]+)["'”’)]*(\s+)/);
      if (match) {
        const sentence = match[1].trim();
        const advanceBy = match[0].length;
        this.buffer = this.buffer.slice(advanceBy);
        if (sentence && this.onSentence) {
          const chunks = splitIntoTtsChunks(sentence);
          for (const c of chunks) {
            this.onSentence(c);
          }
        }
        continue;
      }

      // If buffer has grown beyond 140 chars without ending punctuation, split at comma near middle
      if (this.buffer.length >= 140) {
        const mid = Math.floor(this.buffer.length / 2);
        let bestComma = -1;
        let minD = Infinity;
        for (let i = 0; i < this.buffer.length; i++) {
          if (this.buffer[i] === ",") {
            const d = Math.abs(i - mid);
            if (d < minD) {
              minD = d;
              bestComma = i;
            }
          }
        }

        if (bestComma > 30) {
          const chunk = this.buffer.slice(0, bestComma + 1).trim();
          this.buffer = this.buffer.slice(bestComma + 1).trimStart();
          if (chunk && this.onSentence) {
            const chunks = splitIntoTtsChunks(chunk);
            for (const c of chunks) {
              this.onSentence(c);
            }
          }
          continue;
        }
      }

      break;
    }
  }

  flush() {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (remaining && this.onSentence) {
      const chunks = splitIntoTtsChunks(remaining);
      for (const c of chunks) {
        this.onSentence(c);
      }
    }
  }

  reset() {
    this.buffer = "";
  }
}

