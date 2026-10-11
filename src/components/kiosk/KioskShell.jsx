"use client";
import { useState, useEffect } from "react";
import AvatarPanel from "@/components/avatar/AvatarPanel";
import ProductShowcase from "@/components/products/ProductShowcase";
import RightOnboardingFlow from "@/components/kiosk/RightOnboardingFlow";
import CartConfirmationModal from "@/components/modals/CartConfirmationModal";
import CheckoutQRModal from "@/components/modals/CheckoutQRModal";
import GoodbyeOverlay from "@/components/modals/GoodbyeOverlay";
import StaffAssistanceBanner from "@/components/kiosk/StaffAssistanceBanner";
import HintTooltip from "@/components/kiosk/HintTooltip";
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
      {/* ── Top Staff Assistance Notification (REQUEST_HUMAN) ── */}
      {k.staffBanner && (
        <StaffAssistanceBanner
          message={k.staffBanner}
          onDismiss={() => k.setStaffBanner(null)}
        />
      )}

      {/* ── Left Column: Avatar & Stage ── */}
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

      {/* ── Help Tooltip / Suggestions (SHOW_HINT) ── */}
      {k.hintBubble && (
        <HintTooltip
          hint={k.hintBubble}
          onTapHint={(hint) => k.send(typeof hint === "string" ? hint : hint.text || hint.message)}
          onDismiss={() => k.setHintBubble(null)}
        />
      )}

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
          actionButtons={k.actionButtons}
          onButtonClick={k.handleButtonClick}
        />

        {/* ── Right-Side Onboarding Flow (Step 1: Ask Name, Step 2: Categories) ── */}
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

        {/* ── Cart Confirmation Modal (CONFIRM_BUY) ── */}
        <CartConfirmationModal
          isOpen={k.cartModalOpen}
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
          isOpen={k.qrModalOpen}
          sku={k.qrModalData?.sku || k.product?.sku}
          productUrl={k.qrModalData?.product_url}
          product={k.qrModalData?.product || k.product}
          onClose={() => k.setQrModalOpen(false)}
          onComplete={() => k.setQrModalOpen(false)}
        />

        {/* ── Farewell / Thank You Screen (GOODBYE) ── */}
        <GoodbyeOverlay
          isOpen={k.goodbyeOpen}
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
