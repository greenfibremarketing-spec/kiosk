"use client";
import { useState, useEffect } from "react";
import AvatarPanel from "@/components/avatar/AvatarPanel";
import ProductShowcase from "@/components/products/ProductShowcase";
import RightOnboardingFlow from "@/components/kiosk/RightOnboardingFlow";
import { useKiosk } from "@/hooks/useKiosk";

export default function KioskShell() {
  const k = useKiosk();
  const isEngaged = k.presence.state === "ENGAGED";

  return (
    <main
      className="kiosk"
      onClick={() => k.presence.triggerTouchEngaged()}
      onTouchStart={() => k.presence.triggerTouchEngaged()}
    >
      <AvatarPanel
        caption={k.caption}
        speechId={k.speechId}
        speaking={k.speaking}
        onSpeakingChange={k.handleSpeakingChange}
        presenceState={k.presence.state}
        convState={k.convState}
        userSpeaking={k.userSpeaking}
        onTap={k.presence.triggerTouchEngaged}
        videoRef={k.presence.videoRef}
        debugOpen={k.presence.debugOpen}
        debugStats={k.presence.debugStats}
        config={k.presence.config}
        onCalibrate={k.presence.calibrate100Cm}
        onCloseDebug={() => k.presence.setDebugOpen(false)}
        onQuickPick={k.send}
        listening={k.listening}
        liveTranscript={k.liveTranscript}
        lastUserSpeech={k.lastUserSpeech}
        onToggleMic={() => {}}
        signals={k.signals}
        backendAction={k.backendAction}
        onSkipName={k.skipName}
        onSubmitName={k.submitName}
        setStageRef={k.setStageRef}
        vadSpeech={k.vadSpeech}
        audioLevel={k.audioLevel}
        micError={k.micError}
        evidence={k.evidence}
        speakingForMs={k.speakingForMs}
        silentForMs={k.silentForMs}
      />

      {/* ── Right Column: Catalog + Right-Side Separate Onboarding Flow ── */}
      <div className="kiosk-right-pane" style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
        <ProductShowcase
          category={k.category}
          categories={k.categories}
          product={k.product}
          products={k.products}
          onCategory={k.selectCategory}
          onSelect={k.selectProduct}
          onEnquire={k.enquire}
          onQuickPick={k.send}
          showDetail={k.showDetail}
          onCloseDetail={() => k.setShowDetail(false)}
        />

        {/* ── Right-Side Onboarding Flow (Step 1: Ask Name) ── */}
        <RightOnboardingFlow
          isOpen={k.onboardingOpen}
          step={k.onboardingStep}
          backendAction={k.backendAction}
          categories={k.categories}
          products={k.products}
          onClose={() => k.setOnboardingOpen(false)}
          name={k.name}
          onSubmitName={(name) => {
            k.submitName(name);
          }}
          onSkipName={() => {
            k.skipName();
          }}
          onSelectCategory={(catId) => {
            k.selectCategory(catId);
          }}
          onSelectProduct={(p) => {
            k.selectProduct(p);
          }}
          onGoToAllProducts={() => {
            k.showAll();
          }}
        />
      </div>
    </main>
  );
}
