"use client";
import { useEffect, useRef } from "react";
import { compareBurst, hasEnrolled } from "@/lib/presence/faceIdentity";

const BASELINE_EVERY_MS = 1000;
const JUMP_RATIO = 0.35; // face center/size changed by 35% between ticks = suspicious
const MAX_UNSURE_RETRIES = 2;

export function useFaceGuard({
  videoRef,
  active,
  faceVisible,
  getFaceBox,
  onSuspect,
  onSame,
  onDifferent,
  onUnsure,
}) {
  const s = useRef({ visible: false, lostAt: 0, checking: false, lastBox: null, strikes: 0 });
  const cb = useRef({});
  cb.current = { onSuspect, onSame, onDifferent, onUnsure };

  async function verify(reason, gapMs) {
    const st = s.current;
    if (st.checking || !hasEnrolled() || !videoRef.current) return;
    st.checking = true;
    cb.current.onSuspect?.(reason); // hide name + stop voice right away
    try {
      for (let attempt = 0; attempt <= MAX_UNSURE_RETRIES; attempt++) {
        const { status } = await compareBurst(videoRef.current);
        if (status === "different") {
          st.strikes = 0;
          cb.current.onDifferent?.(reason, gapMs);
          return;
        }
        if (status === "same") {
          st.strikes = 0;
          cb.current.onSame?.(reason, gapMs);
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      cb.current.onUnsure?.(reason, gapMs); // fall back to "Are you still X?"
    } finally {
      st.checking = false;
    }
  }

  // Trigger A: face lost -> face back (any gap length)
  useEffect(() => {
    if (!active) return;
    const st = s.current;
    if (faceVisible && !st.visible) {
      const gap = st.lostAt ? Date.now() - st.lostAt : 0;
      if (st.lostAt) verify("return", gap);
    }
    if (!faceVisible && st.visible) st.lostAt = Date.now();
    if (faceVisible) st.lostAt = st.lostAt && !st.visible ? 0 : st.lostAt;
    st.visible = faceVisible;
  }, [faceVisible, active]);

  // Trigger B: sudden jump (swap without a "lost" event) + Trigger C: 1s baseline check
  useEffect(() => {
    if (!active) return;
    const id = setInterval(async () => {
      const st = s.current;
      if (!faceVisible || st.checking || !hasEnrolled()) return;

      const box = getFaceBox?.(); // { cx, cy, w } in 0..1, or null
      if (box && st.lastBox) {
        const jump =
          Math.hypot(box.cx - st.lastBox.cx, box.cy - st.lastBox.cy) > JUMP_RATIO ||
          Math.abs(box.w - st.lastBox.w) / Math.max(st.lastBox.w, 0.01) > JUMP_RATIO;
        if (jump) {
          st.lastBox = box;
          verify("jump", 0);
          return;
        }
      }
      st.lastBox = box || null;

      // Baseline: single burst every second, needs 2 "different" strikes in a row
      st.checking = true;
      try {
        const { status } = await compareBurst(videoRef.current, 2, 100);
        if (status === "different") st.strikes += 1;
        else if (status === "same") st.strikes = 0;
      } finally {
        st.checking = false;
      }
      if (st.strikes >= 2) {
        st.strikes = 0;
        verify("baseline", 0);
      }
    }, BASELINE_EVERY_MS);
    return () => clearInterval(id);
  }, [active, faceVisible, getFaceBox, videoRef]);
}

export default useFaceGuard;
