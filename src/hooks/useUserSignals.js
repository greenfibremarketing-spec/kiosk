"use client";
// useUserSignals.js
// High-sensitivity on-device emotion & behaviour detector using MediaPipe FaceLandmarker.
// Detects: Happy (Smile), Sad (Frown/Pucker), Confused (Brow Furrow), Surprised (Eyes Wide),
// Attention (Screen vs Away), and Voice Activity (Jaw movement).

import { useEffect, useRef, useCallback, useState } from "react";

const SIGNAL_INTERVAL_MS = 150; // ~7 FPS
const LOG_INTERVAL_MS = 1200;   // Log update interval

const DEFAULT_SIGNALS = {
  present: false,
  attention: "away",
  mood: "Neutral 😐",
  moodScore: 0,
  smile: 0,
  sad: 0,
  confused: 0,
  surprised: 0,
  jawOpen: 0,
  speaking: false,
  silenceSec: 0,
  dwellMs: 0,
};

export function useUserSignals({ videoRef, isEngaged, onSpeechStart, onSpeechEnd } = {}) {
  const [signals, setSignals] = useState(DEFAULT_SIGNALS);
  const landmarkerRef = useRef(null);
  const timerRef = useRef(null);
  const engagedSinceRef = useRef(null);
  const lastSpeechRef = useRef(Date.now());
  const silenceSecRef = useRef(0);
  const jawOpenHistoryRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const lastTimestampRef = useRef(0);
  const lastLogTimeRef = useRef(0);
  const lastLoggedMoodRef = useRef("");

  // --- Initialise MediaPipe FaceLandmarker ---
  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const { FaceLandmarker, FilesetResolver } = vision;
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        if (!active) return;

        // Try GPU first, fallback to CPU
        let lm = null;
        try {
          lm = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: "/mediapipe/face_landmarker.task",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            outputFaceBlendshapes: true,
            numFaces: 1,
          });
        } catch (gpuErr) {
          console.warn("GPU delegate unavailable for FaceLandmarker, switching to CPU:", gpuErr);
          lm = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: "/mediapipe/face_landmarker.task",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            outputFaceBlendshapes: true,
            numFaces: 1,
          });
        }

        if (active && lm) {
          landmarkerRef.current = lm;
          console.log("%c[Greenie Vision] FaceLandmarker loaded successfully with 52 blendshapes", "color: #00A63E; font-weight: bold;");
        }
      } catch (e) {
        console.error("Critical: Could not load FaceLandmarker:", e);
      }
    }

    init();

    return () => {
      active = false;
      try { landmarkerRef.current?.close(); } catch (_) {}
      landmarkerRef.current = null;
    };
  }, []);

  // --- Helper: extract blendshape category score ---
  const score = useCallback((categories, name) => {
    return categories?.find((c) => c.categoryName === name)?.score ?? 0;
  }, []);

  // --- Main detection loop ---
  useEffect(() => {
    clearInterval(timerRef.current);

    if (!isEngaged) {
      engagedSinceRef.current = null;
      silenceSecRef.current = 0;
      isSpeakingRef.current = false;
      setSignals(DEFAULT_SIGNALS);
      return;
    }

    if (!engagedSinceRef.current) engagedSinceRef.current = Date.now();

    timerRef.current = setInterval(() => {
      const video = videoRef?.current;
      const lm = landmarkerRef.current;
      const now = Date.now();
      const perfNow = performance.now();

      // Guard: video must be ready and displaying frames
      if (!video || video.readyState < 2 || !lm || video.paused) {
        const dwell = now - (engagedSinceRef.current || now);
        silenceSecRef.current += SIGNAL_INTERVAL_MS / 1000;
        setSignals((prev) => ({
          ...prev,
          dwellMs: dwell,
          silenceSec: Math.round(silenceSecRef.current),
        }));
        return;
      }

      // MediaPipe requires strictly increasing timestamps
      if (perfNow <= lastTimestampRef.current) {
        return;
      }
      lastTimestampRef.current = perfNow;

      try {
        const result = lm.detectForVideo(video, perfNow);
        const bs = result.faceBlendshapes?.[0]?.categories ?? [];
        const present = bs.length > 0;

        if (!present) {
          silenceSecRef.current += SIGNAL_INTERVAL_MS / 1000;
          setSignals((prev) => ({
            ...prev,
            present: false,
            attention: "away",
            mood: "No Face Detected 👤",
            moodScore: 0,
            smile: 0,
            sad: 0,
            confused: 0,
            surprised: 0,
            speaking: false,
            silenceSec: Math.round(silenceSecRef.current),
          }));
          return;
        }

        // ─── 1. EXTRACT BLENDSHAPES (Calibrated for real human ranges) ───────────

        // Smile: natural smile is 0.15 - 0.45
        const smileL = score(bs, "mouthSmileLeft");
        const smileR = score(bs, "mouthSmileRight");
        const smileAvg = (smileL + smileR) / 2;

        // Sad / Frown: mouth corners down, pucker, lower lip shrug
        const frownL = score(bs, "mouthFrownLeft");
        const frownR = score(bs, "mouthFrownRight");
        const pucker = score(bs, "mouthPucker");
        const shrugLower = score(bs, "mouthShrugLower");
        const mouthRollLower = score(bs, "mouthRollLower");
        const sadAvg = Math.max(
          (frownL + frownR) / 2 * 1.5,
          pucker * 0.8,
          shrugLower * 0.9,
          mouthRollLower * 0.9
        );

        // Confused / Furrowed: brow down + inner brow raise
        const browDownL = score(bs, "browDownLeft");
        const browDownR = score(bs, "browDownRight");
        const browInnerUp = score(bs, "browInnerUp");
        const browDownAvg = (browDownL + browDownR) / 2;
        const confusedAvg = Math.max(browDownAvg * 1.2, browInnerUp * 0.9);

        // Surprised: eyes wide + outer brow raised
        const eyeWideL = score(bs, "eyeWideLeft");
        const eyeWideR = score(bs, "eyeWideRight");
        const browOuterL = score(bs, "browOuterUpLeft");
        const browOuterR = score(bs, "browOuterUpRight");
        const surprisedAvg = ((eyeWideL + eyeWideR) / 2 + (browOuterL + browOuterR) / 2) / 2;

        // Jaw Open for Speech Activity
        const jawOpenScore = score(bs, "jawOpen");

        // ─── 2. ATTENTION / GAZE ────────────────────────────────────────────────
        let attention = "away";
        if (result.faceLandmarks?.[0]) {
          const lms = result.faceLandmarks[0];
          const nose = lms[1];
          const leftEye = lms[33];
          const rightEye = lms[263];
          if (nose && leftEye && rightEye) {
            const midX = (leftEye.x + rightEye.x) / 2;
            const eyeSpan = Math.abs(rightEye.x - leftEye.x);
            const offset = Math.abs(nose.x - midX) / (eyeSpan || 0.001);
            attention = offset < 0.52 ? "screen" : "away";
          }
        }

        // ─── 3. DETERMINE DOMINANT MOOD ─────────────────────────────────────────
        let currentMood = "Neutral 😐";
        let dominantScore = 0;

        // Check against responsive thresholds
        if (smileAvg >= 0.16 && smileAvg > sadAvg && smileAvg > confusedAvg) {
          currentMood = "Happy 😊";
          dominantScore = Math.min(1, smileAvg * 2.2);
        } else if (sadAvg >= 0.12 && sadAvg > smileAvg) {
          currentMood = "Sad / Frowning 🙁";
          dominantScore = Math.min(1, sadAvg * 2.4);
        } else if (confusedAvg >= 0.18 && confusedAvg > smileAvg) {
          currentMood = "Confused 🤔";
          dominantScore = Math.min(1, confusedAvg * 2.0);
        } else if (surprisedAvg >= 0.18) {
          currentMood = "Surprised 😲";
          dominantScore = Math.min(1, surprisedAvg * 2.0);
        }

        // ─── 4. VOICE ACTIVITY DETECTION (JAW) ──────────────────────────────────
        jawOpenHistoryRef.current.push(jawOpenScore);
        if (jawOpenHistoryRef.current.length > 8) jawOpenHistoryRef.current.shift();
        const jawAvg =
          jawOpenHistoryRef.current.reduce((a, b) => a + b, 0) /
          jawOpenHistoryRef.current.length;

        const isSpeakingNow = jawAvg > 0.10;
        if (isSpeakingNow && !isSpeakingRef.current) {
          isSpeakingRef.current = true;
          lastSpeechRef.current = now;
          silenceSecRef.current = 0;
          onSpeechStart?.();
        }
        if (!isSpeakingNow && isSpeakingRef.current) {
          isSpeakingRef.current = false;
          onSpeechEnd?.();
        }

        if (!isSpeakingNow) {
          silenceSecRef.current = (now - lastSpeechRef.current) / 1000;
        } else {
          silenceSecRef.current = 0;
        }

        const dwell = now - (engagedSinceRef.current || now);

        // ─── 5. REAL-TIME CONSOLE TELEMETRY ─────────────────────────────────────
        const moodChanged = currentMood !== lastLoggedMoodRef.current;
        const timeSinceLastLog = now - lastLogTimeRef.current;

        if (moodChanged || timeSinceLastLog > LOG_INTERVAL_MS) {
          lastLoggedMoodRef.current = currentMood;
          lastLogTimeRef.current = now;

          const moodColor =
            currentMood.startsWith("Happy") ? "#10b981" :
            currentMood.startsWith("Sad")   ? "#ef4444" :
            currentMood.startsWith("Conf")  ? "#f59e0b" :
            currentMood.startsWith("Surp")  ? "#8b5cf6" : "#94a3b8";

          console.log(
            `%c[EMOTION LIVE]%c %c${currentMood} (${Math.round(dominantScore * 100)}%)%c | Smile: ${(smileAvg).toFixed(2)} | Sad: ${(sadAvg).toFixed(2)} | Confused: ${(confusedAvg).toFixed(2)} | Jaw: ${(jawOpenScore).toFixed(2)} (${isSpeakingNow ? "🗣️ SPEAKING" : "SILENT"}) | Gaze: ${attention === "screen" ? "👀 Screen" : "↩️ Away"}`,
            "background: #00A63E; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;",
            "color: #ffffff;",
            `color: ${moodColor}; font-weight: bold; font-size: 13px;`,
            "color: #cbd5e1;"
          );
        }

        setSignals({
          present: true,
          attention,
          mood: currentMood,
          moodScore: Math.round(dominantScore * 100),
          smile: Math.round(smileAvg * 100) / 100,
          sad: Math.round(sadAvg * 100) / 100,
          confused: Math.round(confusedAvg * 100) / 100,
          surprised: Math.round(surprisedAvg * 100) / 100,
          jawOpen: Math.round(jawOpenScore * 100) / 100,
          speaking: isSpeakingNow,
          silenceSec: Math.round(silenceSecRef.current),
          dwellMs: dwell,
        });
      } catch (err) {
        console.warn("FaceLandmarker detection notice:", err);
      }
    }, SIGNAL_INTERVAL_MS);

    return () => clearInterval(timerRef.current);
  }, [isEngaged, videoRef, score, onSpeechStart, onSpeechEnd]);

  return signals;
}
