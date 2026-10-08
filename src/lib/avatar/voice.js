// Voice Configuration for Greenie (English & Indian English pronunciation)
export function preferredVoice(voices, lang = "en-IN") {
  if (!voices || voices.length === 0) return null;

  return (
    voices
      .map((v) => {
        let score = 0;
        const name = (v.name || "").toLowerCase();
        const vLang = (v.lang || "").toLowerCase().replace("_", "-");

        // 1. Indian English female voices (Heera, Neerja, Swara, Priya, Google en-IN)
        if (
          /heera|neerja|swara|priya|sangeeta|veena|aditi/i.test(name) ||
          (vLang.startsWith("en-in") && /female|heera|neerja/i.test(name))
        ) {
          score += 1000;
        }

        // 2. Any Indian English voice
        if (vLang === "en-in" || (vLang.startsWith("en") && name.includes("india"))) {
          score += 800;
        }

        // 3. Google English voices
        if (name.includes("google") && vLang.startsWith("en")) {
          score += 600;
        }

        // 4. Natural female English voices (Zira, Jenny, Aria, Sonia, Samantha)
        if (/zira|jenny|aria|sonia|samantha|victoria|karen/i.test(name)) {
          score += 400;
        }

        // 5. Any English voice
        if (vLang.startsWith("en")) {
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
  return /heera|neerja|swara|priya|zira|jenny|aria|sonia|samantha/i.test(
    voice?.name || ""
  );
}
