"use client";
/**
 * useUserSpeechState.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fuses VAD audio signal + facial jaw movement to produce a single,
 * stable `userSpeaking` boolean with onset debounce and end hangover.
 *
 * Inputs:
 *   vadSpeech      – boolean from useAudioCapture
 *   audioLevel     – RMS 0–1 from useAudioCapture
 *   face           – { present, jawOpen, lookingAtScreen, faceSizeRatio }
 *                    (subset of useUserSignals output)
 *
 * Outputs:
 *   { userSpeaking, evidence, speakingForMs, silentForMs }
 *     evidence: "audio" | "face" | "both" | "none"
 */

import { useEffect, useRef, useState } from "react";
import speechConfig from "@/lib/speechConfig";

const TICK_MS = 60; // internal poll interval

export function useUserSpeechState({ vadSpeech = false, audioLevel = 0, face = {} } = {}) {
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [evidence, setEvidence]         = useState("none");
  const [speakingForMs, setSpeakingForMs] = useState(0);
  const [silentForMs, setSilentForMs]     = useState(0);

  // ── jaw variance ring-buffer ─────────────────────────────────────────────
  const jawHistoryRef  = useRef([]); // { value, ts }
  const onsetStartRef  = useRef(null); // when raw evidence first appeared
  const lastEvidenceTs = useRef(0);    // last time we had any evidence
  const speakStartRef  = useRef(null); // when userSpeaking became true
  const silenceStartRef = useRef(null);
  const tickRef        = useRef(null);

  // Keep stable refs to inputs and state (avoids stale closures in interval)
  const vadRef          = useRef(vadSpeech);
  const levelRef        = useRef(audioLevel);
  const faceRef         = useRef(face);
  const userSpeakingRef = useRef(false);
  const evidenceRef     = useRef("none");

  vadRef.current   = vadSpeech;
  levelRef.current = audioLevel;
  faceRef.current  = face;

  useEffect(() => {
    clearInterval(tickRef.current);

    tickRef.current = setInterval(() => {
      const now = Date.now();
      const vad = vadRef.current;
      const lvl = levelRef.current;
      const f   = faceRef.current;

      // ── 1. Jaw variance over rolling window ────────────────────────────
      const jawVal = f.jawOpen ?? 0;
      jawHistoryRef.current.push({ value: jawVal, ts: now });

      // Prune entries older than the window
      const windowStart = now - speechConfig.jawVarianceWindowMs;
      jawHistoryRef.current = jawHistoryRef.current.filter((e) => e.ts >= windowStart);

      let mouthActive = false;
      if (jawHistoryRef.current.length >= 3) {
        const vals = jawHistoryRef.current.map((e) => e.value);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
        mouthActive = variance > speechConfig.jawVarianceThreshold;
      }

      // ── 2. Face-based speech condition ────────────────────────────────
      const faceNearEnough = (f.faceSizeRatio ?? 0) >= speechConfig.faceSizeRatioThreshold;
      const faceSpeaking   =
        mouthActive &&
        !!f.present &&
        !!f.lookingAtScreen &&
        faceNearEnough;

      // ── 3. Determine evidence source ──────────────────────────────────
      let ev = "none";
      if (vad && faceSpeaking) ev = "both";
      else if (vad)           ev = "audio";
      else if (faceSpeaking)  ev = "face";

      const hasEvidence = ev !== "none";

      // ── 4. Onset debounce → userSpeaking becomes true ─────────────────
      if (hasEvidence) {
        lastEvidenceTs.current = now;

        if (!onsetStartRef.current) {
          onsetStartRef.current = now;
        }

        if (
          !userSpeakingRef.current &&
          now - onsetStartRef.current >= speechConfig.onsetDebounceMs
        ) {
          userSpeakingRef.current = true;
          setUserSpeaking(true);
          speakStartRef.current = now;
          silenceStartRef.current = null;
        }
      } else {
        onsetStartRef.current = null;
      }

      // ── 5. Hangover → userSpeaking stays true after evidence stops ────
      if (userSpeakingRef.current) {
        const elapsed = now - (lastEvidenceTs.current || now);
        if (elapsed > speechConfig.hangoverMs) {
          userSpeakingRef.current = false;
          setUserSpeaking(false);
          silenceStartRef.current = now;
          speakStartRef.current   = null;
        }
      }

      // ── 6. Expose evidence & duration counters ─────────────────────────
      const nextEv = hasEvidence ? ev : (userSpeakingRef.current ? evidenceRef.current : "none");
      evidenceRef.current = nextEv;
      setEvidence(nextEv);

      if (speakStartRef.current) {
        setSpeakingForMs(now - speakStartRef.current);
        setSilentForMs(0);
      } else if (silenceStartRef.current) {
        setSilentForMs(now - silenceStartRef.current);
        setSpeakingForMs(0);
      }
    }, TICK_MS);

    return () => clearInterval(tickRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty – we use refs for inputs

  return { userSpeaking, evidence, speakingForMs, silentForMs };
}
