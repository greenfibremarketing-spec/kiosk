"use client";
import { useEffect, useRef } from "react";
import Captions from "./Captions";
import DebugOverlay from "@/components/debug/DebugOverlay";

export default function AvatarPanel({
  caption,
  speaking,
  stream,
  presenceState = "IDLE",
  onTap,
  videoRef,
  debugOpen,
  debugStats,
  config,
  onCalibrate,
  onCloseDebug
}) {
  const isEngaged = presenceState === "ENGAGED";
  const attractVideoRef = useRef(null);

  // Guarantee continuous video autoplay whenever in IDLE / Attract mode
  useEffect(() => {
    const video = attractVideoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;

    const playVideo = () => {
      video.muted = true;
      video.play().catch((err) => {
        console.warn("Attract video play catch:", err);
      });
    };

    playVideo();

    video.addEventListener("loadeddata", playVideo);
    video.addEventListener("canplay", playVideo);
    video.addEventListener("pause", () => {
      if (!isEngaged) playVideo();
    });

    if (!isEngaged) {
      playVideo();
    }

    return () => {
      video.removeEventListener("loadeddata", playVideo);
      video.removeEventListener("canplay", playVideo);
    };
  }, [isEngaged]);

  return (
    <section className="avatar-immersive" aria-label="GreenFibre Kiosk Display">
      {/* Hidden Webcam Element (Off-screen positioned to allow Media Foundation buffer recycling) */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: "fixed",
          top: "-9999px",
          left: "-9999px",
          width: "640px",
          height: "480px",
          opacity: 0,
          pointerEvents: "none"
        }}
        width={640}
        height={480}
      />

      {/* 1. ATTRACT SCREEN (When nobody is near / IDLE) */}
      <div
        className={`kiosk-layer attract-container ${!isEngaged ? "kiosk-layer--active" : ""}`}
        onClick={onTap}
        role="button"
        tabIndex={0}
      >
        <video
          ref={attractVideoRef}
          src="/videos/promo.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedData={(e) => {
            e.target.muted = true;
            e.target.play().catch(() => {});
          }}
          onCanPlay={(e) => {
            e.target.muted = true;
            e.target.play().catch(() => {});
          }}
          onEnded={(e) => {
            if (e.target) {
              e.target.currentTime = 0;
              e.target.play().catch(() => {});
            }
          }}
          className="attract-video"
        />
        <div className="attract-gradient-overlay" />

        {/* Top Brand Tag */}
        <div className="attract-top-brand">
          <span className="attract-brand-badge">🌾 GREENFIBRE</span>
        </div>
      </div>

      {/* 2. AI AVATAR SCREEN (When person is near / ENGAGED) */}
      <div
        className={`kiosk-layer ${isEngaged ? "kiosk-layer--active" : ""}`}
        onClick={onTap}
      >
        <div className={`avatar-viewport ${speaking ? "avatar--speaking" : ""}`}>
          {stream ? (
            <video
              autoPlay
              playsInline
              className="avatar-viewport-media"
              ref={(el) => {
                if (el && el.srcObject !== stream) el.srcObject = stream;
              }}
            />
          ) : (
            <img
              src="/images/avatar/model-maya.jpg"
              alt="Maya - GreenFibre Virtual Assistant"
              className="avatar-viewport-media"
            />
          )}

          <div className="avatar-ambient-gradient" />

          <div className="avatar-bottom-overlay">
            <Captions text={caption} speaking={speaking} />
          </div>
        </div>
      </div>

      {/* 3. DEBUG OVERLAY (Toggled via Ctrl+Shift+D) */}
      {debugOpen && (
        <DebugOverlay
          stats={debugStats}
          config={config}
          state={presenceState}
          onCalibrate={onCalibrate}
          onClose={onCloseDebug}
        />
      )}
    </section>
  );
}
