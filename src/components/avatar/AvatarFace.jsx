"use client";
import Image from "next/image";

export default function AvatarFace({ speaking, listening }) {
  return (
    <div className={`avatar-model-container ${speaking ? "avatar-model--speaking" : ""} ${listening ? "avatar-model--listening" : ""}`}>
      {/* Background ambient lighting aura */}
      <div className="avatar-model-glow" />

      {/* Realistic Human Portrait Photo */}
      <div className="avatar-model-frame">
        <img
          src="/images/avatar/model-maya.jpg"
          alt="Maya - GreenFibre Brand Ambassador"
          className="avatar-model-img"
        />
        
        {/* Subtle dynamic glass overlay gradient for realistic lighting */}
        <div className="avatar-model-lighting" />

        {/* Live Speaking Audio Waveform Visualizer */}
        <div className={`avatar-wave-overlay ${speaking ? "avatar-wave--active" : ""}`}>
          <div className="wave-bar bar-1" />
          <div className="wave-bar bar-2" />
          <div className="wave-bar bar-3" />
          <div className="wave-bar bar-4" />
          <div className="wave-bar bar-5" />
          <div className="wave-bar bar-6" />
          <div className="wave-bar bar-7" />
        </div>

        {/* Floating Identity & Status Pill */}
        <div className="avatar-model-tag">
          <span className={`status-dot ${speaking ? "status-dot--speaking" : listening ? "status-dot--listening" : "status-dot--online"}`} />
          <div className="avatar-tag-text">
            <strong>Maya</strong>
            <small>{speaking ? "Explaining..." : listening ? "Listening..." : "AI Sustainability Guide"}</small>
          </div>
        </div>
      </div>
    </div>
  );
}
