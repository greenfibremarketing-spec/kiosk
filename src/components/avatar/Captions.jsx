"use client";
import { useEffect, useState, useMemo, useRef } from "react";

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

export default function Captions({ text, speaking, status, charIndex = 0, activeChunkText = "", showDetail = false }) {
  // Show Greeny's current spoken line as text in the existing avatar bubble, in sync with each chunk as it starts playing, and clear it when she finishes.
  const displayText = speaking ? (activeChunkText || text || "") : "";
  const isVisible = Boolean(speaking && displayText);

  if (!displayText && !isVisible) return null;

  // Split displayText into primary sentence (Line 1: bold) and secondary text (Line 2: grey-green)
  const sentences = displayText ? String(displayText).trim().split(/(?<=[.!?])\s+/) : [];
  let line1 = sentences[0] || displayText || "";
  let line2 = sentences.slice(1).join(" ") || "";

  if (!line2 && line1.length > 55) {
    const clauseMatch = line1.match(/^([^,;—]{18,55}[,;—])\s*(.+)$/);
    if (clauseMatch) {
      line1 = clauseMatch[1];
      line2 = clauseMatch[2];
    }
  }

  return (
    <div
      className={`speech-bubble-card ${showDetail ? "speech-bubble-card--pdp" : ""} ${
        isVisible ? "speech-bubble-card--active" : "speech-bubble-card--hidden"
      }`}
      aria-live="polite"
      role="region"
      aria-label="Greeny Speech"
    >
      <div className="speech-bubble-content">
        <div className="speech-bubble-line1">{line1}</div>
        {line2 ? <div className="speech-bubble-line2">{line2}</div> : null}
      </div>
      <div className="speech-bubble-tail" aria-hidden="true" />
    </div>
  );
}
