// src/lib/greetConfig.js
// Greeting and transition speech configurations for Greenie Kiosk.

export const returnFromDetail = [
  "No rush! Take your time, there's lots more to explore.",
];

// Pair-up suggestion constants & speech lines
export const PAIRUP_ASK_TIMEOUT_MS = 12000;
export const PAIRUP_DISCOUNT_PERCENT = 5;
export const PAIRUP_MAX_PER_SESSION = 3;

export const pairUpIntro = [
  "Psst! Pick any one pair-up from here and unlock an extra 5% off your whole order!",
  "Before you go, here's a little bonus! Add any one of these and your whole order gets 5% off.",
];

export const pairUpIntroWithName = [
  "Psst, {name}! Pick any one pair-up from here and unlock an extra 5% off your whole order!",
  "Before you go, {name}, here's a little bonus! Add any one of these and your whole order gets 5% off.",
];

export const pairUpSkipped = [
  "No problem! Taking you to your cart.",
];

export const pairUpSkippedWithName = [
  "No problem, {name}! Taking you to your cart.",
];

export const pairUpAdded = [
  "Lovely! Your pair-up is added and your 5% discount is applied. Let's go to your cart!",
];

export const pairUpAddedWithName = [
  "Lovely, {name}! Your pair-up is added and your 5% discount is applied. Let's go to your cart!",
];

// Backward-compatibility aliases
export const pairUpAsk = pairUpIntro;
export const pairUpAskWithName = pairUpIntroWithName;
export const pairUpYes = pairUpIntro;
export const pairUpNo = pairUpSkipped;

/**
 * Rotate speech variants so she never repeats the same one twice in a row.
 * Uses customer name only if nameSubmitted is true.
 * Splits name lines into 2 chunks for instant (<400ms) playback with parallel fetching.
 */
export function getPairUpSpeech(type, { name = "", nameSubmitted = false, lastIndex = -1 } = {}) {
  let list = [];
  const cleanName = (name || "").trim();
  const hasValidName = Boolean(nameSubmitted && cleanName);

  if (type === "pairUpIntro" || type === "pairUpAsk" || type === "pairUpYes") {
    list = hasValidName ? pairUpIntroWithName : pairUpIntro;
  } else if (type === "pairUpSkipped" || type === "pairUpNo") {
    list = hasValidName ? pairUpSkippedWithName : pairUpSkipped;
  } else if (type === "pairUpAdded") {
    list = hasValidName ? pairUpAddedWithName : pairUpAdded;
  }

  if (!list || list.length === 0) {
    return { text: "", displayText: "", chunks: [], nextIndex: 0 };
  }

  const nextIndex = (lastIndex + 1) % list.length;
  let text = list[nextIndex];
  let chunks = [];

  if (hasValidName) {
    text = text.replace(/\{name\}/g, cleanName);

    // Split name lines into two chunks:
    // Chunk 1: Short first chunk with name (e.g. "Psst, Puneet!")
    // Chunk 2: Static remainder, which is pre-warmed in voice server cache
    if (type === "pairUpIntro" || type === "pairUpAsk" || type === "pairUpYes") {
      if (nextIndex === 0) {
        chunks = [
          `Psst, ${cleanName}!`,
          "Pick any one pair-up from here and unlock an extra 5% off your whole order!",
        ];
      } else {
        chunks = [
          `Before you go, ${cleanName}!`,
          "Here's a little bonus! Add any one of these and your whole order gets 5% off.",
        ];
      }
    } else if (type === "pairUpSkipped" || type === "pairUpNo") {
      chunks = [
        `No problem, ${cleanName}!`,
        "Taking you to your cart.",
      ];
    } else if (type === "pairUpAdded") {
      chunks = [
        `Lovely, ${cleanName}!`,
        "Your pair-up is added and your 5% discount is applied. Let's go to your cart!",
      ];
    } else {
      chunks = [text];
    }
  } else {
    // No-name versions are single pre-warmed line
    chunks = [text];
  }

  // Display text uses "5%" (not "5 percent") for caption chip UI
  const displayText = text;

  return { text, displayText, chunks, nextIndex };
}

export default {
  returnFromDetail,
  PAIRUP_ASK_TIMEOUT_MS,
  PAIRUP_DISCOUNT_PERCENT,
  PAIRUP_MAX_PER_SESSION,
  pairUpIntro,
  pairUpIntroWithName,
  pairUpSkipped,
  pairUpSkippedWithName,
  pairUpAdded,
  pairUpAddedWithName,
  pairUpAsk,
  pairUpAskWithName,
  pairUpYes,
  pairUpNo,
  getPairUpSpeech,
};

