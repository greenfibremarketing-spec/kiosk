"use client";
import { useState, useEffect, useRef } from "react";
import AvatarPanel from "@/components/avatar/AvatarPanel";
import ProductShowcase from "@/components/products/ProductShowcase";
import RightOnboardingFlow from "@/components/kiosk/RightOnboardingFlow";
import CartConfirmationModal from "@/components/modals/CartConfirmationModal";
import RecommendationModal from "@/components/modals/RecommendationModal";
import CheckoutQRModal from "@/components/modals/CheckoutQRModal";
import GoodbyeOverlay from "@/components/modals/GoodbyeOverlay";
import StaffAssistanceBanner from "@/components/kiosk/StaffAssistanceBanner";
import HintTooltip from "@/components/kiosk/HintTooltip";
import SessionTimeoutBanner from "@/components/kiosk/SessionTimeoutBanner";
import IdentityVerificationModal from "@/components/modals/IdentityVerificationModal";
import PairUpPromptCard from "@/components/modals/PairUpPromptCard";
import PairUpModal from "@/components/modals/PairUpModal";
import { useKiosk } from "@/hooks/useKiosk";
import ErrorBoundary from "@/components/debug/ErrorBoundary";
import TranscriptDebug from "@/components/debug/TranscriptDebug";
import { trace } from "@/lib/debugTrace";

// TEST ONLY: set to true via NEXT_PUBLIC_DEBUG_TRANSCRIPT=true for mic overlay
const SHOW_TRANSCRIPT_DEBUG = process.env.NEXT_PUBLIC_DEBUG_TRANSCRIPT === "true";

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
      if (videoRef.current) {
        videoRef.current.pause();
      }
      const timer = setTimeout(() => {
        setVisible(false);
      }, 720);
      return () => clearTimeout(timer);
    } else {
      setVisible(true);
      video.currentTime = 0;
      video.play().catch(() => { });
    }
  }, [isEngaged]);

  const handleTap = (e) => {
    e?.stopPropagation?.();
    if (videoRef.current) {
      videoRef.current.pause();
    }
    onTap?.();
  };

  if (!visible && isEngaged) return null;

  return (
    <div
      className={`kiosk-idle-video-layer ${isEngaged ? "kiosk-idle-video-layer--hidden" : "kiosk-idle-video-layer--visible"}`}
      onClick={handleTap}
      onTouchStart={handleTap}
      onPointerDown={handleTap}
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

  // Diagnostic: 5-second Blank Area / Layout Health Check (Requirement 5)
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof window === "undefined" || typeof document === "undefined") return;
      const pane = document.querySelector(".kiosk-right-pane");
      const paneStyle = pane ? window.getComputedStyle(pane) : null;
      const grid = document.querySelector(".products-grid");
      const detailPage = document.querySelector(".pdp-redesign-wrapper");
      const idleVideo = document.querySelector(".kiosk-idle-video") || document.querySelector(".kiosk-idle-video-layer video");
      const idleLayer = document.querySelector(".kiosk-idle-video-layer");
      const idleStyle = idleLayer ? window.getComputedStyle(idleLayer) : (idleVideo ? window.getComputedStyle(idleVideo) : null);

      trace("layout", {
        productPaneOpacity: paneStyle?.opacity ?? null,
        productPaneVisibility: paneStyle?.visibility ?? null,
        productPaneHeight: paneStyle?.height ?? null,
        productGridChildCount: grid ? grid.children.length : 0,
        detailPageMounted: Boolean(detailPage),
        idleVideoOpacity: idleStyle?.opacity ?? null,
        idleVideoPaused: idleVideo ? Boolean(idleVideo.paused) : null,
        idleVideoVisibility: idleStyle?.visibility ?? null,
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const isAnyModalOrPanelOpen = Boolean(
    k.onboardingOpen ||
    k.showCheckout ||
    k.showDetail ||
    k.cartModalOpen ||
    k.cartPrompt?.active ||
    k.recommendationPrompt?.active ||
    k.checkoutQR?.active ||
    k.goodbye?.active ||
    k.identityPrompt?.active ||
    k.pairUpModalOpen ||
    k.sessionTimeoutWarning?.active
  );

  return (
    <main
      className="kiosk"
      onClick={() => {
        if (!isEngaged) k.enterEngaged("screen_touch");
        k.presence?.triggerTouchEngaged?.();
      }}
      onTouchStart={() => {
        if (!isEngaged) k.enterEngaged("screen_touch");
        k.presence?.triggerTouchEngaged?.();
      }}
      onPointerDown={() => {
        if (!isEngaged) k.enterEngaged("screen_touch");
        k.presence?.triggerTouchEngaged?.();
      }}
    >
      {SHOW_TRANSCRIPT_DEBUG && (
        <TranscriptDebug
          liveTranscript={k.liveTranscript}
          lastUserSpeech={k.lastUserSpeech}
          userSpeaking={k.userSpeaking}
          vadSpeech={k.vadSpeech}
          audioLevel={k.audioLevel}
        />
      )}

      {/* ── Fullscreen Idle Video Layer (IDLE only, fades out 700ms) ── */}
      <IdlePromoVideo
        isEngaged={isEngaged}
        onTap={() => {
          k.enterEngaged("screen_touch");
          k.presence?.triggerTouchEngaged?.("screen_touch");
        }}
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
        onToggleMic={() => { }}
        signals={k.signals}
        backendAction={k.backendAction}
        onSkipName={k.skipName}
        onSubmitName={k.submitName}
        setStageRef={k.setStageRef}
        showDetail={k.showDetail}
        isPairUpOpen={Boolean(k.pairUpModalOpen)}
        vadSpeech={k.vadSpeech}
        audioLevel={k.audioLevel}
        micError={k.micError}
        evidence={k.evidence}
        speakingForMs={k.speakingForMs}
        silentForMs={k.silentForMs}
      />

      {/* ── Help Tooltip / Suggestions (SHOW_HINT) ── */}
      {isEngaged && !isAnyModalOrPanelOpen && k.hintBubble && (
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
        <ErrorBoundary name="ProductShowcase">
          <ProductShowcase
            key={k.sessionResetKey}
            category={k.category}
            categories={k.categories}
            product={k.product}
            products={k.products}
            catalog={k.catalog}
            backendCatalog={k.backendCatalog || k.catalog}
            isLoading={k.isLoadingCatalog}
            onCategory={k.selectCategory}
            onSelect={k.selectProduct}
            onEnquire={k.enquire}
            onQuickPick={k.send}
            showDetail={k.showDetail}
            onCloseDetail={k.navigateBack}
            actionButtons={k.actionButtons}
            onButtonClick={k.handleButtonClick}
            name={k.name}
            onResetSession={k.resetSession}
            kioskModeRef={k.kioskModeRef}
            replayingRef={k.replayingRef}
            onAddToCart={k.handleAddToCart}
            cartItems={k.cartItems}
            cartTotals={k.cartTotals}
            onRemoveItem={k.removeCartItem}
            showCheckout={k.showCheckout}
            onCloseCheckout={() => k.setShowCheckout(false)}
            filtersApplied={k.filtersApplied}
            onClearFilters={k.clearFilters}
            highlightSku={k.highlightSku}
            sessionId={k.sessionId}
          />
        </ErrorBoundary>

        {/* ── Onboarding Flow (Step 1: Ask Name, Step 2: Categories) ── */}
        {isEngaged && (
          <ErrorBoundary name="RightOnboardingFlow">
            <RightOnboardingFlow
              key={k.sessionResetKey}
              isOpen={k.onboardingOpen}
              step={k.onboardingStep}
              backendAction={k.backendAction}
              categories={k.categories}
              products={k.products}
              onboardingDone={k.onboardingDone}
              onClose={() => {
                k.setOnboardingOpen(false);
                k.markOnboardingDone?.("onboarding_closed");
              }}
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
                k.markOnboardingDone?.("browse_all");
              }}
              onResetSession={k.resetSession}
            />
          </ErrorBoundary>
        )}

        {/* ── Cart Confirmation Modal (CONFIRM_BUY) ── */}
        <CartConfirmationModal
          isOpen={isEngaged && Boolean(k.cartModalOpen)}
          product={k.cartModalData?.product || k.product}
          sku={k.cartModalData?.sku || k.product?.sku}
          buttons={k.cartModalData?.buttons || ["Proceed", "Skip"]}
          cartItems={k.cartItems}
          cartTotals={k.cartTotals}
          suggestions={k.pairUpProducts}
          onAddPairUp={k.handlePairUpAddProduct}
          onRemoveItem={k.removeCartItem}
          onClose={() => k.openCart({ fromPairUp: true })}
          onButtonClick={k.handleButtonClick}
          onProceedToCheckout={() => k.openCart({ fromPairUp: true })}
        />

        {/* ── Pair-Up Floating Prompt Card ── */}
        <PairUpPromptCard
          isOpen={isEngaged && Boolean(k.pairUpPromptOpen)}
          question={k.pairUpQuestionText}
          onYes={k.handlePairUpYes}
          onNo={k.handlePairUpNo}
        />

        {/* ── Pair-Up Bottom Sheet Modal ── */}
        <PairUpModal
          isOpen={isEngaged && Boolean(k.pairUpModalOpen)}
          products={k.pairUpProducts}
          addedIds={k.cartItems?.filter((i) => i.isPairUp).map((i) => i.id || i.sku) || []}
          savings={k.cartTotals?.savings || 0}
          hasDiscount={Boolean(k.cartTotals?.hasPairUpDiscount)}
          captionText={k.pairUpCaption}
          onAddProduct={k.handlePairUpAddProduct}
          onSkip={k.handlePairUpSkip}
          onProceed={k.handlePairUpProceed}
          onClose={k.handlePairUpClose}
        />

        {/* ── Recommendation Bundle Modal (SHOW_RECOMMENDATION) ── */}
        <RecommendationModal
          isOpen={isEngaged && Boolean(k.recommendationOpen)}
          data={k.recommendationData}
          onAccept={k.acceptRecommendation}
          onDecline={k.declineRecommendation}
          onClose={() => k.setRecommendationOpen(false)}
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
