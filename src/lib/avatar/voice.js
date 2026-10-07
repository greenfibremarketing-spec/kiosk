// Default Voice Configuration for Greenie
// Locked to: "Google हिन्दी · hi-IN" (Warm, natural Google voice)
// Fallback: Other Hindi / Indian female voices if Google हिन्दी is unavailable

export function preferredVoice(voices, lang = "hi-IN") {
  if (!voices || voices.length === 0) return null;

  return (
    voices
      .map((v) => {
        let score = 0;
        const name = (v.name || "").toLowerCase();
        const vLang = (v.lang || "").toLowerCase().replace("_", "-");

        // 1. Top Target: "Google हिन्दी" / "Google hi-IN"
        if (
          name.includes("google") &&
          (name.includes("हिन्दी") || name.includes("hindi") || vLang.startsWith("hi"))
        ) {
          score += 1000;
        }

        // 2. Exact match for "Google हिन्दी"
        if (/google\s*हिन्दी/i.test(v.name) || /google\s*hindi/i.test(v.name)) {
          score += 800;
        }

        // 3. Any Hindi language voice (hi-IN)
        if (vLang === "hi-in" || vLang.startsWith("hi")) {
          score += 500;
        }

        // 4. Other Google Indian voices
        if (name.includes("google") && (vLang.includes("in") || name.includes("india"))) {
          score += 300;
        }

        // 5. Indian female voices (Swara, Heera, Aditi, Priya, etc.)
        if (/swara|heera|aditi|priya|neerja|sangeeta|veena|kalpana|geeta/i.test(name)) {
          score += 200;
        }

        if (v.default) {
          score += 10;
        }

        return { v, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.v || voices[0] || null
  );
}

export function isPreferredFemale(voice) {
  return /google|हिन्दी|hindi|hi-in|swara|heera|aditi|priya|neerja|sangeeta|veena/i.test(
    voice?.name || ""
  );
}
