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
        speaking={k.speaking}
        presenceState={k.presence.state}
        onTap={k.presence.triggerTouchEngaged}
        videoRef={k.presence.videoRef}
        debugOpen={k.presence.debugOpen}
        debugStats={k.presence.debugStats}
        config={k.presence.config}
        onCalibrate={k.presence.calibrate100Cm}
        onCloseDebug={() => k.presence.setDebugOpen(false)}
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
