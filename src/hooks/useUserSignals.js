"use client";
// useUserSignals.js
// High-sensitivity on-device emotion & behaviour detector using MediaPipe FaceLandmarker.
// Detects: Happy (Smile), Sad (Frown/Pucker), Confused (Brow Furrow), Surprised (Eyes Wide),
// Attention (Screen vs Away), and Voice Activity (Jaw movement).

import { useEffect, useRef, useCallback, useState } from "react";
import { MAX_FACES } from "@/lib/presenceConfig";

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

export function useUserSignals({ videoRef, isEngaged, onSpeechStart, onSpeechEnd, onFaceResult } = {}) {
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
  const lastMultiLogRef = useRef(0);

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
            numFaces: MAX_FACES || 4,
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
            numFaces: MAX_FACES || 4,
          });
        }

        if (active && lm) {
          landmarkerRef.current = lm;
          console.log("[Greenie Vision] FaceLandmarker loaded successfully with 52 blendshapes");
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

    timerRef.current = setInterval(() => {
      const video = videoRef?.current;
      const lm = landmarkerRef.current;
      const now = Date.now();
      const perfNow = performance.now();

      // Guard: video must be ready and displaying frames
      if (!video || video.readyState < 2 || !lm || video.paused) {
        if (isEngaged) {
          const dwell = now - (engagedSinceRef.current || now);
          silenceSecRef.current += SIGNAL_INTERVAL_MS / 1000;
          setSignals((prev) => ({
            ...prev,
            dwellMs: dwell,
            silenceSec: Math.round(silenceSecRef.current),
          }));
        }
        return;
      }

      // MediaPipe requires strictly increasing timestamps
      if (perfNow <= lastTimestampRef.current) {
        return;
      }
      lastTimestampRef.current = perfNow;

      try {
        const result = lm.detectForVideo(video, perfNow);
        const faceLandmarks = result.faceLandmarks || [];
        const facesCount = faceLandmarks.length;

        // Calculate largest face by 2D bounding box
        let largestFace = null;
        let maxArea = -1;
        if (facesCount > 0) {
          for (let i = 0; i < facesCount; i++) {
            const lmPoints = faceLandmarks[i];
            if (!lmPoints || lmPoints.length === 0) continue;
            let minX = 1, maxX = 0, minY = 1, maxY = 0;
            for (const pt of lmPoints) {
              if (pt.x < minX) minX = pt.x;
              if (pt.x > maxX) maxX = pt.x;
              if (pt.y < minY) minY = pt.y;
              if (pt.y > maxY) maxY = pt.y;
            }
            const width = Math.max(0, maxX - minX);
            const height = Math.max(0, maxY - minY);
            const area = width * height;
            if (area > maxArea) {
              maxArea = area;
              largestFace = { index: i, box: { minX, maxX, minY, maxY, width, height }, area };
            }
          }
        }

        // Log multiple faces if detected (throttled)
        if (facesCount > 1) {
          if (now - lastMultiLogRef.current > 3000) {
            lastMultiLogRef.current = now;
            console.log(`[Presence] multiple faces (${facesCount})`);
          }
        }

        // Calculate whether primary face is looking straight / frontal
        let isFrontal = false;
        const primaryLm = faceLandmarks[largestFace?.index ?? 0];
        if (primaryLm) {
          const nose = primaryLm[1];
          const leftEye = primaryLm[33];
          const rightEye = primaryLm[263];
          if (nose && leftEye && rightEye) {
            const midX = (leftEye.x + rightEye.x) / 2;
            const eyeSpan = Math.abs(rightEye.x - leftEye.x);
            const offset = Math.abs(nose.x - midX) / (eyeSpan || 0.001);
            isFrontal = offset < 0.52;
          }
        }

        // Feed presence tracking hook with raw face landmarks and orientation
        onFaceResult?.(faceLandmarks, perfNow, { facesCount, largestFace, isFrontal });

        // If kiosk is not engaged, reset engagement metrics and skip emotion processing
        if (!isEngaged) {
          engagedSinceRef.current = null;
          silenceSecRef.current = 0;
          isSpeakingRef.current = false;
          setSignals(DEFAULT_SIGNALS);
          return;
        }

        if (!engagedSinceRef.current) engagedSinceRef.current = Date.now();

        // Extract blendshapes for the primary (largest) face
        const primaryFaceIdx = largestFace?.index ?? 0;
        const bs = result.faceBlendshapes?.[primaryFaceIdx]?.categories ?? [];
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
        }

        setSignals((prev) => {
          const same =
            prev.present === true &&
            prev.attention === attention &&
            prev.mood === currentMood &&
            prev.speaking === isSpeakingNow &&
            Math.abs(prev.smile - smileAvg) < 0.08 &&
            Math.abs(prev.confused - confusedAvg) < 0.08 &&
            Math.abs(prev.jawOpen - jawOpenScore) < 0.08 &&
            Math.abs(prev.silenceSec - Math.round(silenceSecRef.current)) < 1;

          if (same) return prev; // Prevent unnecessary React re-render

          return {
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
          };
        });
      } catch (err) {
        console.warn("FaceLandmarker detection notice:", err);
      }
    }, SIGNAL_INTERVAL_MS);

    return () => clearInterval(timerRef.current);
  }, [isEngaged, videoRef, score, onSpeechStart, onSpeechEnd, onFaceResult]);

  return signals;
}
