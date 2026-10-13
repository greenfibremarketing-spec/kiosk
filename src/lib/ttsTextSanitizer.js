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
  return splitIntoTtsChunks(text);
}

/**
 * Splits text into optimal TTS chunks (~25 to 80 chars) for low-latency synthesis.
 *
 * Rules:
 *  1. Isolate name-personalised intros ("Nice to meet you, <name>!", "<name>,", "Great choice, <name>!")
 *     so the remainder of the sentence matches the pre-warmed static disk cache.
 *  2. Split at sentence endings (. ? !).
 *  3. Split long sentences (> 80 chars) at commas, semicolons, colons, or " and " into chunks of ~25-80 chars.
 *  4. Fall back to word boundaries if a segment still exceeds 80 chars.
 *
 * @param {string} text
 * @returns {string[]} array of sanitized, non-empty chunks
 */
export function splitIntoTtsChunks(text) {
  if (!text || typeof text !== "string") return [];

  const raw = text.trim();
  if (!raw) return [];

  const chunks = [];

  // 1. Isolate name-personalised prefix if present
  // Matches e.g. "Nice to meet you, David!", "Hello David!", "David,", "Great choice, Sarah!"
  const namePrefixRegex = /^(?:(?:Nice to meet you|Pleased to meet you|Welcome|Hello|Hi|Hey|Great choice|Nice pick|Wonderful choice),\s*[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)?[!.,?]|(?:[A-Z][a-zA-Z]*,))\s*/i;
  let remainingText = raw;
  const nameMatch = raw.match(namePrefixRegex);
  if (nameMatch) {
    const nameChunk = nameMatch[0].trim();
    if (nameChunk) {
      chunks.push(nameChunk);
    }
    remainingText = raw.slice(nameMatch[0].length).trim();
  }

  if (!remainingText) {
    return chunks.map(sanitizeTtsText).filter(Boolean);
  }

  // 2. Split on sentence boundaries (. ? !)
  const rawSentences = remainingText.split(/(?<=[.?!])\s+/);

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // If within ideal chunk length, keep intact
    if (trimmed.length <= 80) {
      chunks.push(trimmed);
      continue;
    }

    // 3. For long sentences (> 80 chars), split at commas, semicolons, colons, or " and " / " but "
    // Look for comma/semicolon/colon followed by space, or " and ", " but ", " or "
    const pauseSplitRegex = /(?:,\s*|;\s*|:\s*|\s+(?:and|but|or)\s+)/gi;
    let match;
    let lastIndex = 0;
    let currentChunk = "";

    const segments = [];
    // Manual sub-split preserving readable phrasing
    const parts = trimmed.split(/(?<=[,;:])\s+|\s+(?=and\b|\bbut\b|\bor\b)/i);

    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;

      if (!currentChunk) {
        currentChunk = p;
      } else if ((currentChunk + " " + p).length <= 80) {
        currentChunk += " " + p;
      } else {
        if (currentChunk.length >= 20) {
          segments.push(currentChunk.trim());
          currentChunk = p;
        } else {
          // If currentChunk is too small (<20 chars), combine anyway or push
          currentChunk += " " + p;
          if (currentChunk.length > 80) {
            segments.push(currentChunk.trim());
            currentChunk = "";
          }
        }
      }
    }
    if (currentChunk.trim()) {
      segments.push(currentChunk.trim());
    }

    // 4. Fallback: if any segment is still > 80 chars, break at word boundary
    for (const seg of segments) {
      if (seg.length <= 80) {
        chunks.push(seg);
      } else {
        const words = seg.split(/\s+/);
        let wordChunk = "";
        for (const w of words) {
          if (wordChunk && (wordChunk + " " + w).length > 80) {
            chunks.push(wordChunk.trim());
            wordChunk = w;
          } else {
            wordChunk = wordChunk ? wordChunk + " " + w : w;
          }
        }
        if (wordChunk.trim()) {
          chunks.push(wordChunk.trim());
        }
      }
    }
  }

  return chunks.map(sanitizeTtsText).filter(Boolean);
}

/**
 * Buffers streamed tokens and emits chunks as soon as completed.
 * Splits on punctuation (. ? !) or after ~60-80 characters at natural break points.
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
          // Emit sub-chunks if sentence is long
          const chunks = splitIntoTtsChunks(sentence);
          for (const c of chunks) {
            this.onSentence(c);
          }
        }
        continue;
      }

      // If buffer has grown beyond 75 chars without ending punctuation, break at comma or word boundary
      if (this.buffer.length >= 75) {
        const slice = this.buffer.slice(0, 85);
        const commaIdx = slice.lastIndexOf(",");
        const spaceIdx = slice.lastIndexOf(" ");
        const splitIdx = commaIdx > 25 ? commaIdx + 1 : (spaceIdx > 35 ? spaceIdx : -1);

        if (splitIdx > 25) {
          const chunk = this.buffer.slice(0, splitIdx).trim();
          this.buffer = this.buffer.slice(splitIdx).trimStart();
          if (chunk && this.onSentence) {
            this.onSentence(chunk);
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

