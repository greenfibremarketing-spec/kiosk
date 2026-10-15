"use client";
// CartRecommendationStrip.jsx — NEW component, additive only.
// Renders two large touch buttons inside the cart modal.
// "Show me suggestions" sends REQUEST_RECOMMENDATION via kioskWS.
// "No thanks" sends DECLINE_RECOMMENDATION and hides the strip.
// If SHOW_RECOMMENDATION does not arrive in 3 s, shows a timeout message.

import React, { useState, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { kioskWS } from "@/lib/kioskWebSocket";
import { speechController } from "@/lib/avatar/SpeechController";

const TIMEOUT_MS = 3000;

export default function CartRecommendationStrip({
  stopSpeech,         // () => void  — call stopSpeechForUserAction before WS action
  onRequest,          // () => void  — called when user taps "Show me suggestions"
  onDecline,          // () => void  — called when user taps "No thanks"
  dismissed,          // bool        — controlled: strip should not render
}) {
  const [timedOut, setTimedOut] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [internalDismissed, setInternalDismissed] = useState(false);
  const timerRef = useRef(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (dismissed || internalDismissed) return null;

  const handleRequest = () => {
    if (waiting) return;
    try { speechController?.cancelAll("user_reco"); } catch (e) {}
    stopSpeech?.();
    setWaiting(true);
    setTimedOut(false);
    console.log("[Reco] requested");
    onRequest?.();
    kioskWS.sendWsAction({ action: "REQUEST_RECOMMENDATION" });
    timerRef.current = setTimeout(() => {
      setWaiting(false);
      setTimedOut(true);
      console.log("[Reco] timeout");
    }, TIMEOUT_MS);
  };

  const handleDecline = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try { speechController?.cancelAll("user_reco"); } catch (e) {}
    stopSpeech?.();
    setInternalDismissed(true);
    console.log("[Reco] declined");
    onDecline?.();
    kioskWS.sendWsAction({ action: "DECLINE_RECOMMENDATION" });
  };

  return (
    <div className="reco-strip">
      {timedOut ? (
        <p className="reco-strip__timeout-msg">
          Suggestions are not available right now.
        </p>
      ) : (
        <>
          <p className="reco-strip__question">
            Would you like me to show you something that goes well with this?
          </p>
          <div className="reco-strip__actions">
            <button
              type="button"
              className="reco-strip__btn reco-strip__btn--primary"
              onClick={handleRequest}
              disabled={waiting}
              aria-label="Show me suggestions"
            >
              <Sparkles size={18} strokeWidth={2} />
              {waiting ? "Looking…" : "Show me suggestions"}
            </button>
            <button
              type="button"
              className="reco-strip__btn reco-strip__btn--secondary"
              onClick={handleDecline}
              aria-label="No thanks"
            >
              No thanks
            </button>
          </div>
        </>
      )}
    </div>
  );
}
