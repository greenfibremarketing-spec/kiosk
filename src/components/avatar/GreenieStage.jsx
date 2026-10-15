"use client";
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { GreenieAvatar } from "@/lib/avatar/GreenieAvatar";

const GreenieStage = forwardRef(function GreenieStage(
  { onStatus, onSpeakingChange, onBoundary, onChunk, isEngaged },
  ref
) {
  const containerRef = useRef(null);
  const avatarRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const onStatusRef = useRef(onStatus);
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  const onBoundaryRef = useRef(onBoundary);
  const onChunkRef = useRef(onChunk);

  useEffect(() => {
    onStatusRef.current = onStatus;
    onSpeakingChangeRef.current = onSpeakingChange;
    onBoundaryRef.current = onBoundary;
    onChunkRef.current = onChunk;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let avatarInstance = null;
    try {
      avatarInstance = new GreenieAvatar(container, {
        modelUrl: "/avatar/greenie.glb",
        onStatus: (msg) => {
          onStatusRef.current?.(msg);
        },
        onSpeakingChange: (speaking) => {
          onSpeakingChangeRef.current?.(speaking);
        },
        onBoundary: (charIndex) => {
          onBoundaryRef.current?.(charIndex);
        },
        onChunk: (chunkText) => {
          onChunkRef.current?.(chunkText);
        },
      });

      avatarRef.current = avatarInstance;

      avatarInstance.ready
        .then(() => {
          setLoaded(true);
          if (isEngaged) {
            avatarInstance.setEngaged(true);
          }
        })
        .catch((err) => {
          console.error("Avatar initialization failed:", err);
          setLoadError("Unable to load 3D character");
        });
    } catch (e) {
      console.error("WebGL / Three.js error:", e);
      setLoadError("WebGL is not supported on this device.");
    }

    return () => {
      if (avatarInstance) {
        avatarInstance.dispose();
      }
      avatarRef.current = null;
    };
  }, []); // Run once on mount to keep WebGL context stable

  useEffect(() => {
    if (avatarRef.current) {
      avatarRef.current.setEngaged(isEngaged);
    }
  }, [isEngaged]);

  useImperativeHandle(
    ref,
    () => ({
      flyIn: (duration) => avatarRef.current?.flyIn(duration),
      speak: (text, options) => avatarRef.current?.speak(text, options),
      enqueueSentence: (sentence, options) => avatarRef.current?.enqueueSentence(sentence, options),
      startTurn: (turnId) => avatarRef.current?.startTurn(turnId),
      finishTurn: (turnId) => avatarRef.current?.finishTurn(turnId),
      isSpeaking: () => avatarRef.current?.isSpeaking(),
      isQueueEmpty: () => avatarRef.current?.isQueueEmpty(),
      onQueueEmpty: (cb) => avatarRef.current?.onQueueEmpty(cb),
      wave: (duration) => avatarRef.current?.wave(duration),

      react: (kind) => avatarRef.current?.react(kind),
      stop: () => avatarRef.current?.stop(),
      clearQueue: (reason) => avatarRef.current?.clearQueue(reason),
      playSpeech: (url, cues) => avatarRef.current?.playSpeech(url, cues),
      setListening: (active) => avatarRef.current?.setListening(active),
      setEngaged: (engaged) => avatarRef.current?.setEngaged(engaged),
      setExpression: (name) => avatarRef.current?.setExpression(name),
      getInstance: () => avatarRef.current,
    }),
    []
  );


  return (
    <div className="greenie-stage-wrapper">
      {/* 3D Canvas Viewport */}
      <div
        ref={containerRef}
        className="greenie-canvas-viewport"
        aria-label="Greenie 3D Avatar"
      />

      {/* Loading / Error States (Transparent, no colored box) */}
      {!loaded && !loadError && (
        <div className="greenie-loader-overlay">
          <div className="greenie-spinner" />
        </div>
      )}

      {loadError && (
        <div className="greenie-error-banner">
          <span>{loadError}</span>
        </div>
      )}
    </div>
  );
});

export default GreenieStage;
