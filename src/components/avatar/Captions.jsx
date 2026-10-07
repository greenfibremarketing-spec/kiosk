"use client";
import { useEffect, useState, useMemo } from "react";

/**
 * Splits a long text paragraph into clean 5-8 word subtitle cards.
 * Avoids orphan single-word chunks and calculates character offsets.
 */
function splitIntoSubtitles(fullText, wordsPerChunk = 6) {
  if (!fullText) return [];
  const clean = String(fullText).trim();
  if (!clean) return [];

  // Split by natural sentence punctuation first (. ! ?) or clauses (, ; —)
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunkList = [];

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    if (words.length <= wordsPerChunk + 2) {
      chunkList.push(words.join(" "));
    } else {
      // Break into segments of ~5-7 words
      for (let i = 0; i < words.length; i += wordsPerChunk) {
        const slice = words.slice(i, i + wordsPerChunk);
        // Avoid leaving trailing 1-2 words alone
        if (i + wordsPerChunk >= words.length && slice.length <= 2 && chunkList.length > 0) {
          chunkList[chunkList.length - 1] += " " + slice.join(" ");
        } else {
          chunkList.push(slice.join(" "));
        }
      }
    }
  }

  // Ensure last chunk is never a lonely 1-2 word orphan
  if (chunkList.length > 1) {
    const last = chunkList[chunkList.length - 1];
    if (last.split(/\s+/).length <= 2) {
      const popped = chunkList.pop();
      chunkList[chunkList.length - 1] += " " + popped;
    }
  }

  // Calculate start and end character positions for each chunk
  let searchPos = 0;
  return chunkList.map((text) => {
    const startChar = clean.indexOf(text, searchPos);
    const endChar = startChar !== -1 ? startChar + text.length : searchPos + text.length;
    searchPos = endChar;
    return {
      text,
      startChar: Math.max(0, startChar),
      endChar,
      wordCount: text.split(/\s+/).length,
    };
  });
}

export default function Captions({ text, speaking, status, charIndex = 0 }) {
  const [chunkIndex, setChunkIndex] = useState(0);
  const chunks = useMemo(() => splitIntoSubtitles(text, 6), [text]);

  // Reset to first chunk on new text
  useEffect(() => {
    setChunkIndex(0);
  }, [text]);

  // Real-time synchronization with speech boundary charIndex
  useEffect(() => {
    if (!speaking || chunks.length <= 1) {
      if (!speaking) {
        // Keep final chunk or reset
      }
      return;
    }

    // Match the current speech boundary character position to the right subtitle card
    const activeIdx = chunks.findIndex(
      (c) => charIndex >= c.startChar && charIndex <= c.endChar + 4
    );

    if (activeIdx !== -1) {
      setChunkIndex(activeIdx);
    }
  }, [charIndex, speaking, chunks]);

  // Fallback timer pacing if browser doesn't emit onboundary
  useEffect(() => {
    if (!speaking || chunks.length <= 1 || charIndex > 0) return;

    const currentChunk = chunks[chunkIndex];
    if (!currentChunk) return;

    // ~240ms per word matches speech rate 1.02
    const durationMs = Math.max(900, currentChunk.wordCount * 240);

    const timer = setTimeout(() => {
      setChunkIndex((prev) => (prev < chunks.length - 1 ? prev + 1 : prev));
    }, durationMs);

    return () => clearTimeout(timer);
  }, [speaking, chunkIndex, chunks, charIndex]);

  const activeChunk = chunks[Math.min(chunkIndex, chunks.length - 1)];
  const displayText = activeChunk?.text || status || "Ready to chat";

  if (!displayText) return null;

  return (
    <div
      className={`subs-bar ${speaking ? "subs-bar--speaking" : ""}`}
      aria-live="polite"
      role="region"
      aria-label="Speech Subtitles"
    >
      <div className="subs-badge">
        <span>CC</span>
      </div>

      <div className="subs-text-wrap">
        <div className="subs-header">
          <span className="subs-speaker">Greenie</span>
          {speaking && (
            <span className="subs-wave-mini">
              <span className="wave-dot" />
              <span className="wave-dot" />
              <span className="wave-dot" />
            </span>
          )}
          {chunks.length > 1 && speaking && (
            <span className="subs-progress">
              {chunkIndex + 1}/{chunks.length}
            </span>
          )}
        </div>
        <p key={`${text}-${chunkIndex}`} className="subs-text subs-text--animate">
          {displayText}
        </p>
      </div>
    </div>
  );
}
