// src/hooks/useFeedbackSpeech.js
// ADDITIVE-ONLY: new file. Does not change any existing code.
//
// Exposes speakFeedback(type, data) used by ProductDetailPage handlers.
// Uses the existing speechController begin/appendSentence/endReply path.
// Suppressed while replayingRef.current is true or kioskMode is IDLE.

import { useCallback, useRef } from "react";
import { speechController } from "@/lib/avatar/SpeechController";

// Colour line variants — rotated to avoid repetition
const COLOR_LINES = [
  (c) => `${c} selected. That one looks great!`,
  (c) => `Nice, ${c} it is.`,
  (c) => `${c}, lovely pick.`,
];

// Quantity debounce timer reference (module-level to survive re-renders)
let _qtyTimer = null;
let _lastQtyDir = null;

export function useFeedbackSpeech({ kioskModeRef, replayingRef }) {
  const colorVariantRef = useRef(0);
  const isFirstRenderRef = useRef(true);

  const _say = useCallback(
    (text) => {
      if (!text) return;
      if (kioskModeRef?.current === "IDLE") return;
      if (replayingRef?.current) return;
      speechController.cancelAll("local_feedback");
      const replyId = `fb_${Date.now()}`;
      speechController.beginReply(replyId, { source: "feedback" });
      speechController.appendSentence(replyId, text, { turnId: replyId });
      speechController.endReply(replyId);
    },
    [kioskModeRef, replayingRef]
  );

  const speakFeedback = useCallback(
    (type, data = {}) => {
      if (kioskModeRef?.current === "IDLE") return;
      if (replayingRef?.current) return;

      switch (type) {
        case "add_to_cart": {
          const { productName = "this item", qty = 1 } = data;
          let line;
          if (qty === 1) {
            line = `Lovely choice! Your ${productName} has been added to your cart.`;
          } else {
            line = `Wonderful! ${qty} ${productName} added to your cart.`;
          }
          console.log("[Feedback] spoke add_to_cart");
          _say(line);
          break;
        }

        case "colour_change": {
          // Suppressed on first render (initialisation, not user action)
          if (isFirstRenderRef.current) {
            isFirstRenderRef.current = false;
            return;
          }
          const { colour = "" } = data;
          if (!colour) return;
          const idx = colorVariantRef.current % COLOR_LINES.length;
          colorVariantRef.current += 1;
          const line = COLOR_LINES[idx](colour);
          console.log("[Feedback] spoke colour_change");
          _say(line);
          break;
        }

        case "quantity_up": {
          const { qty = 1 } = data;
          clearTimeout(_qtyTimer);
          _lastQtyDir = "up";
          _qtyTimer = setTimeout(() => {
            let line;
            if (qty > 5) {
              line = `That's ${qty} pieces. Great for gifting!`;
            } else {
              // Rotate between two lines
              line = colorVariantRef.current % 2 === 0
                ? `Quantity is now ${qty}.`
                : `${qty} it is.`;
            }
            colorVariantRef.current += 1;
            console.log("[Feedback] spoke quantity_up");
            _say(line);
          }, 700);
          break;
        }

        case "quantity_down": {
          const { qty = 1 } = data;
          clearTimeout(_qtyTimer);
          _lastQtyDir = "down";
          _qtyTimer = setTimeout(() => {
            let line;
            if (qty === 1) {
              line = "One is the minimum quantity.";
            } else {
              line = `Updated to ${qty}.`;
            }
            console.log("[Feedback] spoke quantity_down");
            _say(line);
          }, 700);
          break;
        }

        default:
          break;
      }
    },
    [_say, kioskModeRef, replayingRef]
  );

  return { speakFeedback };
}
