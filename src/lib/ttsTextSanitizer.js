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

  // 6b. Sanitize hyphens / dashes in product names (" - " → ", ") so TTS doesn't stumble
  t = t.replace(/\s+[–—\-]\s+/g, ", ");

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
  return splitIntoTtsChunks(text);
}

/**
 * Splits text into natural sentence TTS chunks for smooth, low-latency synthesis.
 *
 * Rules:
 *  1. Split on sentence end (. ? !) first.
 *  2. Keep the first chunk to 40 characters or fewer (split at comma or clause boundary if longer).
 *  3. Dynamic prefix / greeting clauses ("Nice to meet you, {name}!", "Psst, {name}!") must NOT
 *     be merged into the static remainder, allowing the static part to hit persistent cache.
 *  4. Never split on commas unless a sentence exceeds ~140 chars or is the first chunk > 40 chars.
 *
 * @param {string} text
 * @returns {string[]} array of sanitized, non-empty chunks
 */
export function splitIntoTtsChunks(text) {
  if (!text || typeof text !== "string") return [];

  const raw = text.trim();
  if (!raw) return [];

  // Split on sentence boundaries (. ? !)
  const rawSentences = raw.split(/(?<=[.?!])\s+/);
  const pieces = [];

  for (let sIdx = 0; sIdx < rawSentences.length; sIdx++) {
    const s = rawSentences[sIdx].trim();
    if (!s) continue;

    // For the very first sentence, if it exceeds 40 chars, check for an early comma/clause boundary
    if (sIdx === 0 && s.length > 40) {
      const firstCommaIdx = s.indexOf(",");
      if (firstCommaIdx >= 8 && firstCommaIdx <= 40) {
        const c1 = s.slice(0, firstCommaIdx + 1).trim();
        const c2 = s.slice(firstCommaIdx + 1).trim();
        if (c1) pieces.push(c1);
        if (c2) pieces.push(c2);
        continue;
      }
    }

    if (s.length <= 140) {
      pieces.push(s);
    } else {
      // Sentence exceeds ~140 chars: find comma nearest the middle
      const mid = Math.floor(s.length / 2);
      let bestCommaIdx = -1;
      let minDistance = Infinity;

      for (let i = 0; i < s.length; i++) {
        if (s[i] === ",") {
          const dist = Math.abs(i - mid);
          if (dist < minDistance) {
            minDistance = dist;
            bestCommaIdx = i;
          }
        }
      }

      if (bestCommaIdx !== -1 && bestCommaIdx > 25 && bestCommaIdx < s.length - 25) {
        const p1 = s.slice(0, bestCommaIdx + 1).trim();
        const p2 = s.slice(bestCommaIdx + 1).trim();
        if (p1) pieces.push(p1);
        if (p2) pieces.push(p2);
      } else {
        // No suitable comma: split at word boundary nearest the middle
        let bestSpaceIdx = -1;
        let minSpaceDist = Infinity;
        for (let i = 0; i < s.length; i++) {
          if (s[i] === " ") {
            const dist = Math.abs(i - mid);
            if (dist < minSpaceDist) {
              minSpaceDist = dist;
              bestSpaceIdx = i;
            }
          }
        }
        if (bestSpaceIdx !== -1 && bestSpaceIdx > 25 && bestSpaceIdx < s.length - 25) {
          const p1 = s.slice(0, bestSpaceIdx).trim();
          const p2 = s.slice(bestSpaceIdx + 1).trim();
          if (p1) pieces.push(p1);
          if (p2) pieces.push(p2);
        } else {
          pieces.push(s);
        }
      }
    }
  }

  // Merge only dangling fragments (without ending punctuation or < 8 chars)
  // Greetings/exclamations ending in ! or . (like "Psst, Puneet!", "Nice to meet you, Puneet!") are kept distinct
  const merged = [];
  for (let i = 0; i < pieces.length; i++) {
    let current = pieces[i].trim();
    if (!current) continue;

    const isCompleteClause = /[.?!]$/.test(current) || (i === 0 && current.length <= 40);
    if (!isCompleteClause && current.length < 15 && i + 1 < pieces.length) {
      pieces[i + 1] = current + " " + pieces[i + 1].trim();
    } else if (!isCompleteClause && current.length < 15 && merged.length > 0) {
      merged[merged.length - 1] = merged[merged.length - 1] + " " + current;
    } else {
      merged.push(current);
    }
  }

  return merged.map(sanitizeTtsText).filter(Boolean);
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

