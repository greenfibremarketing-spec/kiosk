"use client";
// src/hooks/usePresence.js
// Presence tracking state machine driven by MediaPipe FaceLandmarker.
// Provides presence state (present, absent_short, absent_long, confirming)
// and passes continuous face bounding box telemetry to useFaceGuard.

import { useState, useRef, useCallback, useEffect } from "react";
import {
  PRESENCE_CONFIG,
  ABSENT_SHORT_MS,
  ABSENT_LONG_MS,
  PRESENT_CONTINUOUS_MS,
  PRESENCE_FRAMES,
  FACE_ID_ENABLED,
  FACE_MAX_SAME_GAP_MS,
} from "@/lib/presenceConfig";
import { hasEnrolled } from "@/lib/presence/faceIdentity";

/**
 * usePresence hook
 * States:
 *   - "present": Confirmed face present within last 4s
 *   - "absent_short": Face gone for 4s - 10s
 *   - "absent_long": Face gone for >= 10s (resets session)
 *   - "confirming": Short gap return awaiting identity confirmation ("Are you still <name>?")
 */
export function usePresence({
  onTransition,
  onShortGapReturn,
  onLongGapAbsent,
  getName,
} = {}) {
  const [presenceState, setPresenceState] = useState("absent_long");
  const [facesCount, setFacesCount] = useState(0);
  const [multipleFaces, setMultipleFaces] = useState(false);
  const [largestFace, setLargestFace] = useState(null);

  const stateRef = useRef("absent_long");
  const consecutiveFaceFramesRef = useRef(0);
  const continuousFaceStartRef = useRef(0);
  const lastConfirmedPresentAtRef = useRef(0);
  const lastMultiLogRef = useRef(0);

  // Transition helper with standardized logging
  const transitionTo = useCallback(
    (nextState, meta = {}) => {
      const prevState = stateRef.current;
      if (prevState === nextState) return;

      const ts = new Date().toISOString();
      const elapsed =
        meta.elapsed ??
        (lastConfirmedPresentAtRef.current
          ? Date.now() - lastConfirmedPresentAtRef.current
          : 0);

      console.log(
        `[Presence] ts=${ts} Transition: ${prevState} -> ${nextState} (elapsed=${elapsed}ms${
          meta.reason ? `, reason=${meta.reason}` : ""
        })`
      );

      stateRef.current = nextState;
      setPresenceState(nextState);

      onTransition?.({
        from: prevState,
        to: nextState,
        timestamp: ts,
        elapsed,
        ...meta,
      });
    },
    [onTransition]
  );

  // Called on every frame processed by MediaPipe FaceLandmarker
  const handleFaceLandmarks = useCallback(
    (faceLandmarks, timestamp, extra = {}) => {
      const now = Date.now();
      const count = Array.isArray(faceLandmarks) ? faceLandmarks.length : 0;
      const hasFace = count > 0;

      // Extract largest face bounding box if provided or calculate
      let maxFace = extra.largestFace || null;
      if (!maxFace && count > 0) {
        let maxArea = -1;
        for (let i = 0; i < count; i++) {
          const landmarks = faceLandmarks[i];
          if (!landmarks || landmarks.length === 0) continue;
          let minX = 1,
            maxX = 0,
            minY = 1,
            maxY = 0;
          for (const pt of landmarks) {
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
            maxFace = { index: i, box: { minX, maxX, minY, maxY, width, height }, area };
          }
        }
      }

      setFacesCount(count);
      const isMulti = count > 1;
      setMultipleFaces(isMulti);
      setLargestFace(maxFace);

      if (isMulti && now - lastMultiLogRef.current > 3000) {
        lastMultiLogRef.current = now;
        console.log(`[Presence] multiple faces (${count})`);
      }

      if (hasFace) {
        consecutiveFaceFramesRef.current += 1;
        if (!continuousFaceStartRef.current) {
          continuousFaceStartRef.current = now;
        }

        const continuousDetectionMs = now - continuousFaceStartRef.current;

        // Debounce: must have >= PRESENCE_FRAMES consecutive frames AND >= PRESENT_CONTINUOUS_MS (500ms) continuous detection
        if (
          consecutiveFaceFramesRef.current >= PRESENCE_FRAMES &&
          continuousDetectionMs >= PRESENT_CONTINUOUS_MS
        ) {
          const previousConfirmedTime = lastConfirmedPresentAtRef.current;
          lastConfirmedPresentAtRef.current = now;

          const currState = stateRef.current;
          const elapsed = previousConfirmedTime ? now - previousConfirmedTime : 0;

          if (currState === "absent_long") {
            transitionTo("present", {
              reason: "face_detected_after_long_absence",
              consecutiveFrames: consecutiveFaceFramesRef.current,
              continuousMs: continuousDetectionMs,
            });
          } else if (currState === "absent_short") {
            // Face returned after 4s - 10s gap
            const currentName = typeof getName === "function" ? getName() : "";
            if (currentName) {
              transitionTo("confirming", {
                elapsed,
                reason: "short_gap_face_return_with_name",
                name: currentName,
              });
              onShortGapReturn?.({ elapsed, name: currentName });
            } else {
              transitionTo("present", {
                elapsed,
                reason: "short_gap_face_return_no_name",
              });
            }
          } else if (currState === "confirming") {
            // Already verifying identity, stay in confirming state
          } else if (currState !== "present") {
            transitionTo("present", { reason: "face_confirmed" });
          }
        }
      } else {
        consecutiveFaceFramesRef.current = 0;
        continuousFaceStartRef.current = 0;
      }
    },
    [getName, onShortGapReturn, transitionTo]
  );

  // Periodic absence timer: checks elapsed time since last confirmed frame with a face
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const lastPresent = lastConfirmedPresentAtRef.current;
      if (!lastPresent) return; // Haven't detected a face yet

      const elapsed = now - lastPresent;
      const currState = stateRef.current;

      // Long gap threshold: if face is enrolled, allow return up to FACE_MAX_SAME_GAP_MS (30s)
      const longGapThreshold =
        FACE_ID_ENABLED && hasEnrolled() ? FACE_MAX_SAME_GAP_MS : ABSENT_LONG_MS;

      if (elapsed >= longGapThreshold) {
        if (currState !== "absent_long") {
          transitionTo("absent_long", {
            elapsed,
            reason: "elapsed_exceeded_absent_long",
          });
          onLongGapAbsent?.({ elapsed });
        }
      } else if (elapsed >= ABSENT_SHORT_MS) {
        // Short gap: absent >= 4,000 ms
        if (currState === "present") {
          transitionTo("absent_short", {
            elapsed,
            reason: "elapsed_exceeded_absent_short",
          });
        }
      }
    }, 100);

    return () => clearInterval(timer);
  }, [onLongGapAbsent, transitionTo]);

  // Caller confirms user is indeed the same person
  const confirmSamePerson = useCallback(() => {
    lastConfirmedPresentAtRef.current = Date.now();
    transitionTo("present", { reason: "user_confirmed_same_person" });
  }, [transitionTo]);

  // Force reset presence state (called on session reset)
  const forceResetPresence = useCallback(() => {
    consecutiveFaceFramesRef.current = 0;
    continuousFaceStartRef.current = 0;
    lastConfirmedPresentAtRef.current = 0;
    stateRef.current = "absent_long";
    setPresenceState("absent_long");
  }, []);

  return {
    presenceState,
    stateRef,
    facesCount,
    multipleFaces,
    largestFace,
    hasFace: consecutiveFaceFramesRef.current >= PRESENCE_FRAMES,
    handleFaceLandmarks,
    confirmSamePerson,
    forceResetPresence,
    lastConfirmedPresentAtRef,
  };
}

export default usePresence;
