"use client";
import AvatarPanel from "@/components/avatar/AvatarPanel";
import ProductShowcase from "@/components/products/ProductShowcase";
import { useKiosk } from "@/hooks/useKiosk";

export default function KioskShell() {
  const k = useKiosk();

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
        setStageRef={k.setStageRef}
        vadSpeech={k.vadSpeech}
        audioLevel={k.audioLevel}
        micError={k.micError}
        evidence={k.evidence}
        speakingForMs={k.speakingForMs}
        silentForMs={k.silentForMs}
      />

      <ProductShowcase
        category={k.category}
        product={k.product}
        products={k.products}
        onCategory={k.selectCategory}
        onSelect={k.selectProduct}
        onEnquire={k.enquire}
      />
    </main>
  );
}
