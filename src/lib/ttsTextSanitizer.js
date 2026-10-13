/**
 * ttsTextSanitizer.js
 * Cleans text before sending to Deepgram Aura TTS.
 *
 * Rules applied in order:
 *  1. ₹ currency → "<amount> rupees"
 *  2. unit abbreviations after numbers → expanded form
 *  3. "&" → "and"
 *  4. Collapse repeated punctuation (.., ..., ???, !!!) → single char
 *  5. Strip emojis and non-printable characters
 *  6. Strip markdown symbols (*, #, _, `, ~, |, >)
 *  7. Collapse excessive whitespace / trim
 */

/**
 * @param {string} text
 * @returns {string} sanitized text safe for TTS
 */
export function sanitizeTtsText(text) {
  if (!text || typeof text !== "string") return "";

  let t = text;

  // 1. ₹ currency amounts  →  "<amount> rupees"
  //    Handles: ₹1,199  ₹1199  ₹12.50  ₹1,99,000
  t = t.replace(/₹\s*([\d,]+(?:\.\d{1,2})?)/g, (_, amount) => `${amount} rupees`);

  // 2. Unit abbreviations that follow a number
  //    Order matters: longer abbreviations first
  const unitMap = [
    [/(\d)\s*ml\b/gi, "$1 millilitres"],
    [/(\d)\s*l\b(?!\w)/gi, "$1 litres"],          // "500 l" but not "500 litre" or "500 lbs"
    [/(\d)\s*kg\b/gi, "$1 kilograms"],
    [/(\d)\s*g\b(?!\w)/gi, "$1 grams"],
    [/(\d)\s*cm\b/gi, "$1 centimetres"],
    [/(\d)\s*mm\b/gi, "$1 millimetres"],
    [/(\d)\s*m\b(?!\w)/gi, "$1 metres"],
    [/(\d)\s*km\b/gi, "$1 kilometres"],
    [/(\d)\s*%/g, "$1 percent"],
  ];
  for (const [pattern, replacement] of unitMap) {
    t = t.replace(pattern, replacement);
  }

  // 3. "&" → "and"  (but not inside HTML entities like &amp; just in case)
  t = t.replace(/\s*&\s*/g, " and ");

  // 4. Collapse repeated punctuation
  //    "..." → "."   ".." → "."   "??" → "?"   "!!" → "!"
  t = t.replace(/\.{2,}/g, ".");
  t = t.replace(/\?{2,}/g, "?");
  t = t.replace(/!{2,}/g, "!");
  t = t.replace(/,{2,}/g, ",");

  // 5. Strip emojis and other non-printable / private-use Unicode
  //    This covers the main emoji ranges without breaking accented Latin chars.
  t = t.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{E000}-\u{F8FF}\u{200B}-\u{200D}\u{FEFF}]/gu,
    " "
  );

  // 6. Strip markdown / special symbols
  //    *, #, _, `, ~, |, >  when used as formatting (not inside words)
  t = t.replace(/[*#_`~|>]/g, " ");

  // 7. Collapse excessive whitespace and trim
  t = t.replace(/[ \t]+/g, " ").trim();

  return t;
}

/**
 * Split a full reply text into TTS sentences for early streaming.
 * Splits on sentence-ending punctuation (. ? !) or after ~120 chars at a word boundary.
 *
 * @param {string} text
 * @returns {string[]} array of non-empty sentence strings
 */
export function splitIntoSentences(text) {
  if (!text || typeof text !== "string") return [];

  const sentences = [];
  // Split on . ? ! that are followed by whitespace or end of string
  // Use a regex that keeps the delimiter in the sentence
  const raw = text.split(/(?<=[.?!])\s+/);

  for (const part of raw) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // If a single segment is longer than 120 chars, break further at word boundaries
    if (trimmed.length > 120) {
      const words = trimmed.split(/\s+/);
      let chunk = "";
      for (const word of words) {
        if (chunk && (chunk + " " + word).length > 120) {
          if (chunk.trim()) sentences.push(chunk.trim());
          chunk = word;
        } else {
          chunk = chunk ? chunk + " " + word : word;
        }
      }
      if (chunk.trim()) sentences.push(chunk.trim());
    } else {
      sentences.push(trimmed);
    }
  }

  return sentences.filter(Boolean);
}

/**
 * Buffers streamed tokens and emits sentences as soon as completed.
 * Splits on punctuation (. ? !) followed by whitespace, or after ~120 characters at a word boundary.
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
          this.onSentence(sentence);
        }
        continue;
      }

      // If buffer has grown beyond 120 chars without punctuation, break at word boundary
      if (this.buffer.length >= 120) {
        const slice = this.buffer.slice(0, 140);
        const lastSpace = slice.lastIndexOf(" ");
        if (lastSpace > 40) {
          const sentence = this.buffer.slice(0, lastSpace).trim();
          this.buffer = this.buffer.slice(lastSpace).trimStart();
          if (sentence && this.onSentence) {
            this.onSentence(sentence);
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
      this.onSentence(remaining);
    }
  }

  reset() {
    this.buffer = "";
  }
}

