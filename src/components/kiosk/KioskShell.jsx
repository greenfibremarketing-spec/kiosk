"use client";
import { useState, useEffect, useRef } from "react";
import AvatarPanel from "@/components/avatar/AvatarPanel";
import ProductShowcase from "@/components/products/ProductShowcase";
import RightOnboardingFlow from "@/components/kiosk/RightOnboardingFlow";
import CartConfirmationModal from "@/components/modals/CartConfirmationModal";
import CheckoutQRModal from "@/components/modals/CheckoutQRModal";
import GoodbyeOverlay from "@/components/modals/GoodbyeOverlay";
import StaffAssistanceBanner from "@/components/kiosk/StaffAssistanceBanner";
import HintTooltip from "@/components/kiosk/HintTooltip";
import SessionTimeoutBanner from "@/components/kiosk/SessionTimeoutBanner";
import IdentityVerificationModal from "@/components/modals/IdentityVerificationModal";
import { useKiosk } from "@/hooks/useKiosk";

/**
 * Fullscreen Idle Promo Video
 * Fades out smoothly on ENGAGED (700ms), pauses, and hides.
 * Resumes and fades in when returning to IDLE.
 */
function IdlePromoVideo({ isEngaged, onTap }) {
  const videoRef = useRef(null);
  const [visible, setVisible] = useState(!isEngaged);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isEngaged) {
      const timer = setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.pause();
          setVisible(false);
        }
      }, 720);
      return () => clearTimeout(timer);
    } else {
      setVisible(true);
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  }, [isEngaged]);

  if (!visible && isEngaged) return null;

  return (
    <div
      className={`kiosk-idle-video-layer ${isEngaged ? "kiosk-idle-video-layer--hidden" : "kiosk-idle-video-layer--visible"}`}
      onClick={(e) => {
        e.stopPropagation();
        onTap?.();
      }}
      role="button"
      tabIndex={0}
      aria-label="Touch Screen to Begin"
    >
      <video
        ref={videoRef}
        src="/videos/promo.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="kiosk-idle-video"
      />
      <div className="kiosk-idle-gradient-overlay" />
      <div className="kiosk-idle-cta-container">
        <div className="attract-tap-hint">✨ Touch Screen or Step Closer to Begin</div>
      </div>
    </div>
  );
}

export default function KioskShell() {
  const k = useKiosk();
  const isEngaged = k.kioskMode === "ENGAGED";

  return (
    <main
      className="kiosk"
      onClick={() => k.presence.triggerTouchEngaged()}
      onTouchStart={() => k.presence.triggerTouchEngaged()}
    >
      {/* ── Fullscreen Idle Video Layer (IDLE only, fades out 700ms) ── */}
      <IdlePromoVideo
        isEngaged={isEngaged}
        onTap={() => k.presence.triggerTouchEngaged("screen_touch")}
      />

      {/* ── Identity Verification Modal (Step 3: Short Gap Return) ── */}
      <IdentityVerificationModal
        isOpen={isEngaged && Boolean(k.identityPrompt?.active)}
        name={k.identityPrompt?.name || k.name}
        secondsRemaining={k.identityPrompt?.secondsRemaining ?? 8}
        promptCount={k.identityPrompt?.promptCount ?? 1}
        onConfirm={k.confirmIdentity}
        onReject={() => k.resetSession("different_person")}
      />

      {/* ── Top-Right Inactivity Warning Banner ── */}
      <SessionTimeoutBanner
        isOpen={isEngaged && Boolean(k.sessionTimeoutWarning?.active)}
        secondsRemaining={k.sessionTimeoutWarning?.secondsRemaining}
        onContinue={k.continueSession}
        onExit={k.exitSession}
      />

      {/* ── Top Staff Assistance Notification (REQUEST_HUMAN) ── */}
      {isEngaged && k.staffBanner && (
        <StaffAssistanceBanner
          message={k.staffBanner}
          onDismiss={() => k.setStaffBanner(null)}
        />
      )}

      {/* ── Greenie Avatar, Captions, VoiceHUD, Camera Video Overlay ── */}
      <AvatarPanel
        caption={k.caption}
        speechId={k.speechId}
        speaking={k.speaking}
        onSpeakingChange={k.handleSpeakingChange}
        presenceState={k.presence.state}
        convState={k.convState}
        userSpeaking={k.userSpeaking}
        onTap={() => k.presence.triggerTouchEngaged("screen_touch")}
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
        showDetail={k.showDetail}
        vadSpeech={k.vadSpeech}
        audioLevel={k.audioLevel}
        micError={k.micError}
        evidence={k.evidence}
        speakingForMs={k.speakingForMs}
        silentForMs={k.silentForMs}
      />

      {/* ── Help Tooltip / Suggestions (SHOW_HINT) ── */}
      {isEngaged && k.hintBubble && (
        <HintTooltip
          hint={k.hintBubble}
          onTapHint={(hint) => k.send(typeof hint === "string" ? hint : hint.text || hint.message)}
          onDismiss={() => k.setHintBubble(null)}
        />
      )}

      {/* ── Fullscreen Products Pane (Always mounted; fades in 700ms with 24px slide in ENGAGED) ── */}
      <div
        className={`kiosk-right-pane ${isEngaged ? "kiosk-right-pane--engaged" : "kiosk-right-pane--idle"}`}
      >
        <ProductShowcase
          category={k.category}
          categories={k.categories}
          product={k.product}
          products={k.products}
          catalog={k.catalog}
          isLoading={k.isLoadingCatalog}
          onCategory={k.selectCategory}
          onSelect={k.selectProduct}
          onEnquire={k.enquire}
          onQuickPick={k.send}
          showDetail={k.showDetail}
          onCloseDetail={() => k.setShowDetail(false)}
          actionButtons={k.actionButtons}
          onButtonClick={k.handleButtonClick}
          name={k.name}
          onResetSession={k.resetSession}
        />

        {/* ── Onboarding Flow (Step 1: Ask Name, Step 2: Categories) ── */}
        {isEngaged && (
          <RightOnboardingFlow
            isOpen={k.onboardingOpen}
            step={k.onboardingStep}
            backendAction={k.backendAction}
            categories={k.categories}
            products={k.products}
            onClose={() => k.setOnboardingOpen(false)}
            name={k.name}
            liveTranscript={k.liveTranscript}
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
            onResetSession={k.resetSession}
          />
        )}

        {/* ── Cart Confirmation Modal (CONFIRM_BUY) ── */}
        <CartConfirmationModal
          isOpen={isEngaged && Boolean(k.cartModalOpen)}
          product={k.cartModalData?.product || k.product}
          sku={k.cartModalData?.sku || k.product?.sku}
          buttons={k.cartModalData?.buttons || k.actionButtons}
          onClose={() => k.setCartModalOpen(false)}
          onButtonClick={k.handleButtonClick}
          onProceedToCheckout={() => {
            k.setCartModalOpen(false);
            k.setQrModalOpen(true);
          }}
        />

        {/* ── Checkout & QR Screen (CHECKOUT_HANDOFF) ── */}
        <CheckoutQRModal
          isOpen={isEngaged && Boolean(k.qrModalOpen)}
          sku={k.qrModalData?.sku || k.product?.sku}
          productUrl={k.qrModalData?.product_url}
          product={k.qrModalData?.product || k.product}
          onClose={() => k.setQrModalOpen(false)}
          onComplete={() => k.setQrModalOpen(false)}
        />

        {/* ── Farewell / Thank You Screen (GOODBYE) ── */}
        <GoodbyeOverlay
          isOpen={isEngaged && Boolean(k.goodbyeOpen)}
          message={k.goodbyeData?.message}
          autoResetAfterMs={k.goodbyeData?.autoResetAfterMs || 4000}
          onReset={() => {
            k.setGoodbyeOpen(false);
            k.reset();
          }}
        />
      </div>
    </main>
  );
}
