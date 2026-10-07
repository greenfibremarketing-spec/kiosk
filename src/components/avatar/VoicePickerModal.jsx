"use client";
import { useEffect, useState, useCallback } from "react";

const SAMPLE_PHRASES_HI = [
  "नमस्ते! मैं ग्रीनिए हूँ, ग्रीनफाइबर पर आपकी 3D इको साथी! मैं आपकी क्या मदद कर सकती हूँ?",
  "यह हमारा सस्टेनेबल राइस-हस्क कलेक्शन है — 100% प्लास्टिक-मुक्त और पर्यावरण के अनुकूल!",
  "अरे वाह! आइए मिलकर अपनी धरती को और हरा-भरा और सुंदर बनाएं! 🌸",
];

const SAMPLE_PHRASES_EN = [
  "Hello! I am Greenie, your 3D eco companion at GreenFibre! How can I help you today?",
  "This is our sustainable rice-husk collection — 100% plastic-free and eco-friendly!",
  "Aww, you made me smile! Let's make the planet greener together! 🌸",
];

export default function VoicePickerModal({ isOpen, onClose, onSelectVoice, currentVoiceName }) {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(currentVoiceName || "");
  const [pitch, setPitch] = useState(1.15);
  const [rate, setRate] = useState(0.95);
  const [sampleLang, setSampleLang] = useState("hi"); // "hi" | "en"
  const [playingName, setPlayingName] = useState(null);
  const [filter, setFilter] = useState("all"); // "all" | "female" | "indian"

  // Load available system voices
  useEffect(() => {
    function loadVoices() {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
    }

    loadVoices();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Audition voice sample
  const playSample = useCallback(
    (voice, phraseIndex = 0) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

      window.speechSynthesis.cancel();
      setPlayingName(voice.name);

      const isVoiceHindi =
        (voice.lang || "").toLowerCase().startsWith("hi") ||
        /हिन्दी|hindi/i.test(voice.name);
      
      const phraseList = (sampleLang === "hi" || isVoiceHindi) ? SAMPLE_PHRASES_HI : SAMPLE_PHRASES_EN;
      const phrase = phraseList[phraseIndex % phraseList.length];
      const u = new SpeechSynthesisUtterance(phrase);
      u.voice = voice;
      u.rate = rate;
      u.pitch = pitch;
      u.lang = isVoiceHindi ? "hi-IN" : voice.lang || "en-IN";

      u.onend = () => setPlayingName(null);
      u.onerror = () => setPlayingName(null);

      window.speechSynthesis.speak(u);
    },
    [pitch, rate, sampleLang]
  );

  const stopSample = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setPlayingName(null);
  }, []);

  const handleApply = (voice) => {
    setSelectedVoice(voice.name);
    if (typeof window !== "undefined") {
      localStorage.setItem("greenie_selected_voice", voice.name);
      localStorage.setItem("greenie_pitch", String(pitch));
      localStorage.setItem("greenie_rate", String(rate));
    }
    onSelectVoice?.(voice, { pitch, rate });
  };

  if (!isOpen) return null;

  // Filter & Sort voices with Google हिन्दी at top
  const filteredVoices = voices
    .filter((v) => {
      const name = v.name.toLowerCase();
      const lang = v.lang.toLowerCase();
      if (filter === "female") {
        return /female|zira|aria|jenny|sara|susan|hazel|samantha|victoria|karen|moira|tessa|veena|heera|swara|aditi|neerja|natasha|sonia|libby|sangeeta/i.test(
          name
        );
      }
      if (filter === "indian") {
        return (
          lang.includes("in") ||
          /india|hindi|हिन्दी|swara|heera|aditi|neerja|priya|sangeeta|veena/i.test(name)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const aIsGoogleHindi =
        /google\s*(?:हिन्दी|hindi)/i.test(a.name) ||
        (a.name.toLowerCase().includes("google") && (a.lang || "").toLowerCase().startsWith("hi"));
      const bIsGoogleHindi =
        /google\s*(?:हिन्दी|hindi)/i.test(b.name) ||
        (b.name.toLowerCase().includes("google") && (b.lang || "").toLowerCase().startsWith("hi"));
      if (aIsGoogleHindi && !bIsGoogleHindi) return -1;
      if (!aIsGoogleHindi && bIsGoogleHindi) return 1;

      const aIsHindi = (a.lang || "").toLowerCase().startsWith("hi");
      const bIsHindi = (b.lang || "").toLowerCase().startsWith("hi");
      if (aIsHindi && !bIsHindi) return -1;
      if (!aIsHindi && bIsHindi) return 1;
      return 0;
    });

  return (
    <div className="voice-modal-backdrop" onClick={onClose}>
      <div className="voice-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="voice-modal-header">
          <div>
            <h2 className="voice-modal-title">🎙️ Audition & Select Greenie Voice</h2>
            <p className="voice-modal-sub">
              Click &quot;▶️ Test Sample&quot; to hear how each voice sounds on your device, then select your favorite.
            </p>
          </div>
          <button className="voice-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Sliders for Pitch and Speed */}
        <div className="voice-tuner-card">
          <div className="tuner-row">
            <label>
              <strong>Sweet Pitch:</strong> {pitch.toFixed(2)}x
              <span className="tuner-hint">(Higher = Sweeter/Cuter small girl tone)</span>
            </label>
            <input
              type="range"
              min="0.8"
              max="1.8"
              step="0.05"
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
            />
          </div>

          <div className="tuner-row">
            <label>
              <strong>Speaking Speed:</strong> {rate.toFixed(2)}x
              <span className="tuner-hint">(1.02x = cheerful & natural)</span>
            </label>
            <input
              type="range"
              min="0.7"
              max="1.4"
              step="0.05"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="voice-filter-pills">
          <button
            className={`filter-pill ${filter === "all" ? "filter-pill--active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All Voices ({voices.length})
          </button>
          <button
            className={`filter-pill ${filter === "female" ? "filter-pill--active" : ""}`}
            onClick={() => setFilter("female")}
          >
            🌸 Female / Sweet Voices
          </button>
          <button
            className={`filter-pill ${filter === "indian" ? "filter-pill--active" : ""}`}
            onClick={() => setFilter("indian")}
          >
            🇮🇳 Indian &amp; Hindi Voices
          </button>
        </div>

        {/* Voice List */}
        <div className="voice-cards-grid">
          {filteredVoices.map((v) => {
            const isPlaying = playingName === v.name;
            const isCurrent = selectedVoice === v.name;
            const isGoogleHindi =
              /google\s*(?:हिन्दी|hindi)/i.test(v.name) ||
              (v.name.toLowerCase().includes("google") && (v.lang || "").toLowerCase().startsWith("hi"));

            return (
              <div
                key={v.name}
                className={`voice-card ${isCurrent ? "voice-card--selected" : ""} ${
                  isGoogleHindi ? "voice-card--recommended" : ""
                }`}
              >
                <div className="voice-card-info">
                  <div className="voice-card-name-row">
                    <strong className="voice-name">{v.name}</strong>
                    {isGoogleHindi && <span className="recommended-badge">⭐ GOOGLE HINDI</span>}
                    {isCurrent && <span className="active-badge">✓ ACTIVE</span>}
                  </div>
                  <span className="voice-meta">
                    {v.lang} {v.default ? "• (System Default)" : ""}
                  </span>
                </div>

                <div className="voice-card-actions">
                  <button
                    className={`btn-play-sample ${isPlaying ? "btn-play-sample--playing" : ""}`}
                    onClick={() => (isPlaying ? stopSample() : playSample(v))}
                  >
                    {isPlaying ? "⏹️ Stop" : "▶️ Test Sample"}
                  </button>

                  <button
                    className={`btn-select-voice ${isCurrent ? "btn-select-voice--active" : ""}`}
                    onClick={() => handleApply(v)}
                  >
                    {isCurrent ? "Selected" : "Use This Voice"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
