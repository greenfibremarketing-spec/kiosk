"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ProductArt from "../products/ProductArt";
import {
  getPaymentApi,
  loadRazorpayScript,
  validateAndBuildCheckoutPayload,
} from "@/lib/paymentApi";
import { KioskStepCache } from "@/lib/kioskStepCache";
import { inr } from "@/lib/format";

export default function CheckoutPage({
  order,
  catalog = [],
  sessionId = null,
  onBack,
  onOrderSuccess,
  onOrderError,
  onRemoveItem,
}) {
  const { product = {}, selectedColor = "Natural Olive", savings = 0 } = order || {};

  const [qty, setQty] = useState(order?.quantity || 1);
  const [includeGiftWrap, setIncludeGiftWrap] = useState(true);
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false);

  // Customer delivery form state
  const [formData, setFormData] = useState({
    fullName: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    landmark: "",
  });

  // UI adapter status: "idle" | "preparing" | "paying" | "verifying" | "pending" | "confirmed" | "review" | "problem"
  const [statusState, setStatusState] = useState("idle");
  const [statusData, setStatusData] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isScriptReady, setIsScriptReady] = useState(false);
  const [validationError, setValidationError] = useState("");

  const checkoutBusyRef = useRef(false);
  const pollTimerRef = useRef(null);
  const pollCountRef = useRef(0);
  const paymentApi = useMemo(() => getPaymentApi(), []);

  const resolvedSessionId = useMemo(() => {
    return sessionId || KioskStepCache.getOrCreateSessionId();
  }, [sessionId]);

  // Determine active cart items
  const hasCartItems = Array.isArray(order?.cartItems) && order.cartItems.length > 0;
  const activeCart = useMemo(() => {
    if (hasCartItems) {
      return order.cartItems;
    }
    return [
      {
        id: product.id || product.sku,
        sku: product.sku || product.id,
        name: product.name,
        price: product.salePrice || product.price || 0,
        quantity: qty,
        selectedColor,
        image: product.image,
        shape: product.shape,
      },
    ];
  }, [hasCartItems, order?.cartItems, product, qty, selectedColor]);

  const unitPrice = product.salePrice || product.price || 0;
  const itemsSubtotal = hasCartItems
    ? order.cartTotals?.subtotal ||
      order.cartItems.reduce(
        (acc, i) => acc + Number(i.price || i.salePrice || 0) * (Number(i.quantity) || 1),
        0
      )
    : unitPrice * qty;

  const hasPairUpInOrder = Boolean(
    order.cartTotals?.hasPairUpDiscount ||
    (hasCartItems && order.cartItems.some((i) => i.isPairUp))
  );

  const pairUpDiscount = hasPairUpInOrder
    ? (typeof order.cartTotals?.discount === "number"
        ? order.cartTotals.discount
        : Math.round(itemsSubtotal * 0.05))
    : 0;

  const grandTotal = Math.max(0, itemsSubtotal - pairUpDiscount);
  const totalUnits = activeCart.reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);

  // ── UI View Adapter ────────────────────────────────────────────────────────
  const ui = useMemo(
    () => ({
      setBusy(busy) {
        setIsBusy(Boolean(busy));
        checkoutBusyRef.current = Boolean(busy);
      },
      showStatus(state, data = null) {
        setStatusState(state);
        setStatusData(data);
      },
    }),
    []
  );

  // ── Render Proof & Completion ──────────────────────────────────────────────
  const renderProof = useCallback(
    (proof) => {
      if (!proof) return;

      if (proof.saved_to_database === true && proof.paid === true) {
        const isReview = Boolean(proof.stock_conflict);
        ui.showStatus(isReview ? "review" : "confirmed", proof);

        // Notify parent application of successful payment
        if (onOrderSuccess) {
          const completedResult = {
            orderId: proof.order_number || proof.database_order_id,
            databaseOrderId: proof.database_order_id,
            orderNumber: proof.order_number,
            amount: (proof.amount || 0) / 100,
            currency: proof.currency || "INR",
            orderStatus: proof.order_status || "confirmed",
            confirmedAt: proof.confirmed_at || new Date().toISOString(),
            stockConflict: isReview,
            emailStatus: proof.email_status || "sent",
            customer: {
              fullName: formData.fullName,
              phone: formData.phone,
              email: formData.email,
              address: formData.address,
              city: formData.city,
              state: formData.state,
              pincode: formData.pincode,
              landmark: formData.landmark || "",
            },
            product: activeCart[0] || product,
            quantity: totalUnits,
            selectedColor,
            grandTotal: (proof.amount ? proof.amount / 100 : grandTotal),
            paymentMethod: "RAZORPAY",
            timestamp: new Date().toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          };

          // Delay slightly so user can view confirmation feedback before transition
          setTimeout(() => {
            onOrderSuccess(completedResult);
          }, 1200);
        }
      } else {
        ui.showStatus("pending", proof);
      }
    },
    [ui, onOrderSuccess, formData, activeCart, product, totalUnits, selectedColor, grandTotal]
  );

  // ── Check Saved Order (Status / Recovery / Reconcile) ──────────────────────
  const checkSavedOrder = useCallback(
    async (reference) => {
      if (!reference?.database_order_id) return;
      ui.showStatus("verifying", reference);
      try {
        const proof = await paymentApi.recover(reference);
        renderProof(proof);
      } catch (error) {
        console.warn("[Checkout] checkSavedOrder error:", error);
        ui.showStatus("pending", { ...reference, error });
      }
    },
    [paymentApi, ui, renderProof]
  );

  // ── Mount: Load Razorpay SDK and Recover Pending Orders ───────────────────
  useEffect(() => {
    let isMounted = true;

    loadRazorpayScript().then((ready) => {
      if (isMounted) setIsScriptReady(Boolean(ready));
    });

    // Inspect pending payment reference from previous session
    const pending = paymentApi.getPendingReference();
    if (pending && pending.database_order_id) {
      console.log("[Checkout] Found pending checkout reference, recovering order...", pending);
      checkSavedOrder(pending);
    }

    return () => {
      isMounted = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [paymentApi, checkSavedOrder]);

  // ── Bounded Polling for Pending Payments (Every 4s up to 60s) ─────────────
  useEffect(() => {
    if (statusState === "pending") {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollCountRef.current = 0;

      pollTimerRef.current = setInterval(async () => {
        pollCountRef.current += 1;
        if (pollCountRef.current > 15) {
          // 15 * 4s = 60s timeout: stop polling, keep pending, offer manual check
          clearInterval(pollTimerRef.current);
          return;
        }

        const pendingRef = statusData || paymentApi.getPendingReference();
        if (pendingRef && pendingRef.database_order_id) {
          try {
            const proof = await paymentApi.recover(pendingRef);
            if (proof.paid === true) {
              clearInterval(pollTimerRef.current);
              renderProof(proof);
            }
          } catch (err) {
            if (err?.status === 401 || err?.status === 403) {
              clearInterval(pollTimerRef.current);
            }
          }
        }
      }, 4000);
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [statusState, statusData, paymentApi, renderProof]);

  // ── Form Input Change Handler ─────────────────────────────────────────────
  const handleInputChange = (field, value) => {
    setValidationError("");
    if (field === "phone") {
      const numeric = value.replace(/\D/g, "").slice(0, 10);
      setFormData((prev) => ({ ...prev, phone: numeric }));
      return;
    }
    if (field === "pincode") {
      const numeric = value.replace(/\D/g, "").slice(0, 6);
      setFormData((prev) => ({ ...prev, pincode: numeric }));
      return;
    }
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // ── Proceed to Pay Flow ───────────────────────────────────────────────────
  const onPayClick = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (checkoutBusyRef.current || isBusy) return;

    setValidationError("");

    if (!deliveryConfirmed) {
      setValidationError("Please confirm that you understand your order will be delivered on 28th–29th.");
      return;
    }

    // Build and validate canonical Section 2 payload
    let payload;
    try {
      payload = validateAndBuildCheckoutPayload({
        form: {
          name: formData.fullName,
          email: formData.email,
          phone: formData.phone,
          streetAddress: formData.address,
          city: formData.city,
          state: formData.state,
          pincode: formData.pincode,
          landmark: formData.landmark || "",
        },
        cart: activeCart,
        sessionId: resolvedSessionId,
        catalog,
      });
    } catch (valErr) {
      setValidationError(valErr.message || "Please check delivery details.");
      return;
    }

    ui.setBusy(true);
    let orderRecord = null;
    let callbackReceived = false;
    const unlock = () => {
      ui.setBusy(false);
    };

    try {
      if (typeof window === "undefined" || !window.Razorpay) {
        const loaded = await loadRazorpayScript();
        if (!loaded || !window.Razorpay) {
          throw new Error("Payment window is not available yet. Please check internet connection or retry.");
        }
      }

      ui.showStatus("preparing");
      orderRecord = await paymentApi.createOrder(payload);
      // AUDIT-TEMP: Log created order record received by UI
      console.log(`// AUDIT-TEMP [${new Date().toISOString()}] CheckoutPage: Created orderRecord:`, orderRecord);

      if (orderRecord.paid === true) {
        renderProof(orderRecord);
        unlock();
        return;
      }

      const customer = payload.customer;
      // AUDIT-TEMP: Log initializing Razorpay checkout options
      console.log(`// AUDIT-TEMP [${new Date().toISOString()}] CheckoutPage: Initializing window.Razorpay with:`, {
        key: orderRecord.key_id,
        order_id: orderRecord.order_id,
        amount: orderRecord.amount,
        currency: orderRecord.currency,
      });

      const checkout = new window.Razorpay({
        key: orderRecord.key_id,
        order_id: orderRecord.order_id,
        amount: orderRecord.amount, // Already integer paise from backend
        currency: orderRecord.currency || "INR",
        name: "GreenFibre",
        description: orderRecord.order_number,
        prefill: {
          name: customer.name,
          email: customer.email,
          contact: customer.phone,
        },
        theme: { color: "#15803d" },
        handler: async (callback) => {
          if (callbackReceived) return;
          callbackReceived = true;
          // AUDIT-TEMP: Log Razorpay success handler callback
          console.log(`// AUDIT-TEMP [${new Date().toISOString()}] CheckoutPage: Razorpay handler callback:`, callback);
          ui.showStatus("verifying", orderRecord);
          try {
            const proof = await paymentApi.verify(orderRecord, callback);
            // AUDIT-TEMP: Log verification proof result
            console.log(`// AUDIT-TEMP [${new Date().toISOString()}] CheckoutPage: verify returned proof:`, proof);
            if (proof && proof.saved_to_database === true && proof.paid === true) {
              renderProof(proof);
            } else {
              if (onOrderError) {
                onOrderError({
                  title: "Order Placement Failed",
                  message: "The backend could not confirm payment capture for this order.",
                  orderId: orderRecord.order_number,
                  databaseOrderId: orderRecord.database_order_id,
                  orderNumber: orderRecord.order_number,
                  product: activeCart[0] || product,
                  items: activeCart,
                  quantity: totalUnits,
                  selectedColor,
                  grandTotal,
                  amount: orderRecord.amount ? orderRecord.amount / 100 : grandTotal,
                  customer: formData,
                });
              } else {
                await checkSavedOrder(orderRecord);
              }
            }
          } catch (verifyErr) {
            console.warn("[Checkout] Verification failed, attempting recovery...", verifyErr);
            try {
              const proof = await paymentApi.recover(orderRecord);
              if (proof && proof.saved_to_database === true && proof.paid === true) {
                renderProof(proof);
                return;
              }
            } catch (_) {}

            if (onOrderError) {
              onOrderError({
                title: "Payment Verification Failed",
                message: verifyErr?.message || "Verification request could not be completed with the store backend.",
                orderId: orderRecord.order_number,
                databaseOrderId: orderRecord.database_order_id,
                orderNumber: orderRecord.order_number,
                product: activeCart[0] || product,
                items: activeCart,
                quantity: totalUnits,
                selectedColor,
                grandTotal,
                amount: orderRecord.amount ? orderRecord.amount / 100 : grandTotal,
                customer: formData,
                error: verifyErr,
              });
            } else {
              await checkSavedOrder(orderRecord);
            }
          } finally {
            unlock();
          }
        },
        modal: {
          ondismiss: async () => {
            // AUDIT-TEMP: Log modal ondismiss trigger
            console.log(`// AUDIT-TEMP [${new Date().toISOString()}] CheckoutPage: Razorpay modal dismissed by user! callbackReceived=${callbackReceived}`);
            if (callbackReceived) return;
            // Closing Checkout checks status before allowing fresh order
            await checkSavedOrder(orderRecord);
            unlock();
          },
        },
      });

      checkout.on("payment.failed", (failResponse) => {
        // AUDIT-TEMP: Log payment.failed event
        console.warn(`// AUDIT-TEMP [${new Date().toISOString()}] CheckoutPage: Razorpay payment.failed:`, failResponse);
        if (onOrderError) {
          const desc = failResponse?.error?.description || failResponse?.error?.reason || "Payment was declined by your bank or payment method.";
          onOrderError({
            title: "Payment Failed",
            message: desc,
            orderId: orderRecord?.order_number,
            databaseOrderId: orderRecord?.database_order_id,
            orderNumber: orderRecord?.order_number,
            product: activeCart[0] || product,
            items: activeCart,
            quantity: totalUnits,
            selectedColor,
            grandTotal,
            amount: orderRecord?.amount ? orderRecord.amount / 100 : grandTotal,
            customer: formData,
            failureReason: failResponse?.error?.code || failResponse?.error?.reason,
          });
        } else if (!callbackReceived) {
          ui.showStatus("pending", orderRecord);
        }
      });

      ui.showStatus("paying", orderRecord);
      checkout.open();
    } catch (error) {
      console.error("[Checkout] Payment process error:", error);
      if (onOrderError && !orderRecord) {
        onOrderError({
          title: "Unable to Start Checkout",
          message: error?.message || "Could not create a saved order in the store backend.",
          product: activeCart[0] || product,
          items: activeCart,
          quantity: totalUnits,
          selectedColor,
          grandTotal,
          customer: formData,
          error,
        });
      } else {
        ui.showStatus(orderRecord ? "pending" : "problem", { order: orderRecord, error });
      }
      unlock();
    }
  };

  const handleManualCheckStatus = () => {
    const ref = statusData || paymentApi.getPendingReference();
    if (ref) checkSavedOrder(ref);
  };

  return (
    <div className="checkout-wrapper" aria-label="Secure Kiosk Checkout">
      {/* ── Top Navigation Bar ── */}
      <nav className="checkout-nav-bar">
        <button
          type="button"
          className="checkout-back-btn"
          onClick={onBack}
          disabled={isBusy}
          aria-label="Back to Product Details"
        >
          <span className="back-arrow">←</span>
          <span>Back to Product</span>
        </button>

        <div className="checkout-steps-badge">
          <span className="step-dot step-active" />
          <span>Step 2 of 2: Shipping & Payment</span>
        </div>
      </nav>

      {/* ── Status Message Banners (Preparing / Verifying / Pending / Review / Problem) ── */}
      {statusState !== "idle" && (
        <div
          className={`checkout-status-banner checkout-status--${statusState}`}
          style={{
            margin: "0 24px 20px 24px",
            padding: "16px 20px",
            borderRadius: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background:
              statusState === "confirmed" || statusState === "review"
                ? "#eaf8ef"
                : statusState === "problem"
                ? "#fff1f0"
                : statusState === "pending"
                ? "#fffbf0"
                : "#f0f7ff",
            border: `1.5px solid ${
              statusState === "confirmed" || statusState === "review"
                ? "#2e7d32"
                : statusState === "problem"
                ? "#d32f2f"
                : statusState === "pending"
                ? "#ed6c02"
                : "#0288d1"
            }`,
            color: "#1f2937",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "22px" }}>
              {statusState === "preparing" && "⏳"}
              {statusState === "paying" && "⚡"}
              {statusState === "verifying" && "🔄"}
              {statusState === "pending" && "⚠️"}
              {statusState === "confirmed" && "✅"}
              {statusState === "review" && "📋"}
              {statusState === "problem" && "❌"}
            </span>
            <div>
              <strong style={{ fontSize: "15px", display: "block" }}>
                {statusState === "preparing" && "Preparing Order..."}
                {statusState === "paying" && "Razorpay Payment Window Open"}
                {statusState === "verifying" && "Verifying Payment Confirmation..."}
                {statusState === "pending" && "Payment Pending / Unconfirmed"}
                {statusState === "confirmed" && "Payment Received; Order Confirmed!"}
                {statusState === "review" && "Payment Received; Availability Requires Staff Review"}
                {statusState === "problem" && "Unable to Process Checkout"}
              </strong>
              <span style={{ fontSize: "13px", color: "#4b5563" }}>
                {statusState === "preparing" && "Creating saved website order with GreenFibre backend..."}
                {statusState === "paying" && "Please complete your UPI, Card, or Netbanking payment."}
                {statusState === "verifying" && "Confirming bank response with authoritative backend..."}
                {statusState === "pending" && "We're checking your payment status with the bank. No need to repay."}
                {statusState === "confirmed" && "Redirecting to your order confirmation..."}
                {statusState === "review" && "Your payment was captured; stock allocation is being reviewed by staff."}
                {statusState === "problem" && (statusData?.error?.message || "Payment request could not be completed.")}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            {statusState === "pending" && (
              <>
                <button
                  type="button"
                  onClick={handleManualCheckStatus}
                  style={{
                    background: "#00A63E",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 14px",
                    fontWeight: "700",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  🔄 Check Payment Status
                </button>
                <button
                  type="button"
                  onClick={() => alert("Store staff has been notified to assist at this kiosk.")}
                  style={{
                    background: "#fff",
                    color: "#374151",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    padding: "8px 14px",
                    fontWeight: "600",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  🛎️ Call Staff Assistance
                </button>
              </>
            )}

            {statusState === "problem" && (
              <button
                type="button"
                onClick={() => setStatusState("idle")}
                style={{
                  background: "#1f2937",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 14px",
                  fontWeight: "700",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                Dismiss &amp; Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Main Checkout Columns ── */}
      <form className="checkout-grid" onSubmit={onPayClick}>
        {/* Left Column: Order Summary & Eco Bag */}
        <div className="checkout-summary-col">
          <div className="summary-header-row">
            <h2 className="summary-col-title">Order Bag</h2>
            <span className="bag-count-pill">
              {totalUnits} Item{totalUnits > 1 ? "s" : ""}
            </span>
          </div>

          {/* Cart Item(s) */}
          {hasCartItems ? (
            order.cartItems.map((item, idx) => {
              const itemId = item.id || item.sku || `co_${idx}`;
              const itemQty = Number(item.quantity) || 1;
              const price = Number(item.price || item.salePrice || 0);
              return (
                <div key={itemId} className="order-item-card" style={{ marginBottom: "12px" }}>
                  <div className="order-item-thumb">
                    <ProductArt image={item.image} name={item.name} shape={item.shape} />
                  </div>
                  <div className="order-item-details">
                    <h3 className="order-item-name">{item.name}</h3>
                    <span className="order-item-color">Finish: {item.selectedColor || selectedColor}</span>
                    <div className="order-item-qty-row">
                      <span style={{ fontSize: "16px", fontWeight: "600", color: "#4a5c46" }}>
                        Qty: {itemQty}
                      </span>
                      <span className="order-item-price">₹{(price * itemQty).toLocaleString("en-IN")}</span>
                    </div>
                    {item.isPairUp && (
                      <div style={{ marginTop: "4px" }}>
                        <span className="cart-pairup-tag">✨ Pair-up item</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="order-item-card">
              <div className="order-item-thumb">
                <ProductArt image={product.image} name={product.name} shape={product.shape} />
              </div>
              <div className="order-item-details">
                <h3 className="order-item-name">{product.name}</h3>
                <span className="order-item-color">Finish: {selectedColor}</span>
                <div className="order-item-qty-row">
                  <div className="checkout-qty-mini">
                    <button
                      type="button"
                      onClick={() => setQty(Math.max(1, qty - 1))}
                      disabled={qty <= 1 || isBusy}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span>{qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(qty + 1)}
                      disabled={isBusy}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <span className="order-item-price">₹{itemsSubtotal.toLocaleString("en-IN")}</span>
                </div>
              </div>
            </div>
          )}

          {/* Plantable Gift Wrap Toggle */}
          <label className="gift-wrap-option">
            <input
              type="checkbox"
              checked={includeGiftWrap}
              disabled={isBusy}
              onChange={(e) => setIncludeGiftWrap(e.target.checked)}
            />
            <div className="gift-wrap-meta">
              <strong>🎁 Free Plantable Seed Card &amp; Kraft Box</strong>
              <span>Includes plantable marigold seed paper card and zero-plastic kraft wrap.</span>
            </div>
          </label>

          {/* Eco Guarantee Banner */}
          <div className="checkout-eco-guarantee">
            <span className="eco-badge-icon">🌾</span>
            <div>
              <strong>100% Upcycled Agricultural Biocomposite</strong>
              <p>Your order diverts {totalUnits * 210}g of crop residue from open-field burning.</p>
            </div>
          </div>

          {/* Cost Breakdown Table */}
          <div className="checkout-price-table">
            <div className="price-row">
              <span>Item Subtotal ({totalUnits} unit{totalUnits > 1 ? "s" : ""})</span>
              <span>₹{itemsSubtotal.toLocaleString("en-IN")}</span>
            </div>
            {pairUpDiscount > 0 && (
              <>
                <div className="price-row price-row--green">
                  <span>Pair-up discount (5%)</span>
                  <span style={{ color: "#2e7d32", fontWeight: "700" }}>
                    -₹{pairUpDiscount.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="cart-savings-banner" style={{ margin: "6px 0", fontSize: "15px" }}>
                  <span>✨</span>
                  <span>You saved ₹{pairUpDiscount.toLocaleString("en-IN")} (5% off whole cart)</span>
                </div>
              </>
            )}
            {savings > 0 && pairUpDiscount === 0 && (
              <div className="price-row price-row--green">
                <span>Special Kiosk Instant Discount</span>
                <span>-₹{savings.toLocaleString("en-IN")}</span>
              </div>
            )}
            <div className="price-row">
              <span>Carbon-Neutral Courier Delivery</span>
              <span className="price-free">FREE</span>
            </div>
            <div className="price-row">
              <span>Eco Gift Packaging</span>
              <span className="price-free">FREE</span>
            </div>
            <div className="price-divider" />
            <div className="price-row price-row--total">
              <strong>Grand Total</strong>
              <strong className="grand-total-val">₹{grandTotal.toLocaleString("en-IN")}</strong>
            </div>
          </div>
        </div>

        {/* Right Column: Customer Details & Proceed to Pay CTA */}
        <div className="checkout-form-col">
          {/* Section: Shipping Details */}
          <div className="checkout-card">
            <div className="checkout-card-head">
              <span className="card-num-badge">1</span>
              <div>
                <h3>Delivery Address &amp; Contact</h3>
                <p className="card-head-sub">Where should we deliver your handcrafted eco products?</p>
              </div>
            </div>

            <div className="form-fields-grid">
              <div className="form-field form-field--half">
                <label>Full Name *</label>
                <input
                  type="text"
                  required
                  disabled={isBusy}
                  value={formData.fullName}
                  onChange={(e) => handleInputChange("fullName", e.target.value)}
                  placeholder="Enter full name"
                />
              </div>

              <div className="form-field form-field--half">
                <label>Mobile Number (for tracking) *</label>
                <input
                  type="tel"
                  required
                  maxLength={10}
                  inputMode="numeric"
                  disabled={isBusy}
                  value={formData.phone}
                  onChange={(e) => handleInputChange("phone", e.target.value)}
                  placeholder="10-digit mobile number"
                />
              </div>

              <div className="form-field form-field--full">
                <label>Email Address *</label>
                <input
                  type="email"
                  required
                  disabled={isBusy}
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  placeholder="name@example.com"
                />
              </div>

              <div className="form-field form-field--full">
                <label>Street Address / Apartment *</label>
                <input
                  type="text"
                  required
                  disabled={isBusy}
                  value={formData.address}
                  onChange={(e) => handleInputChange("address", e.target.value)}
                  placeholder="House number, building name, street"
                />
              </div>

              <div className="form-field form-field--third">
                <label>City *</label>
                <input
                  type="text"
                  required
                  disabled={isBusy}
                  value={formData.city}
                  onChange={(e) => handleInputChange("city", e.target.value)}
                  placeholder="City"
                />
              </div>

              <div className="form-field form-field--third">
                <label>State *</label>
                <input
                  type="text"
                  required
                  disabled={isBusy}
                  value={formData.state}
                  onChange={(e) => handleInputChange("state", e.target.value)}
                  placeholder="State"
                />
              </div>

              <div className="form-field form-field--third">
                <label>PIN Code (6 digits) *</label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  inputMode="numeric"
                  disabled={isBusy}
                  value={formData.pincode}
                  onChange={(e) => handleInputChange("pincode", e.target.value)}
                  placeholder="6-digit PIN code"
                />
              </div>
            </div>
          </div>

          {/* Section: Proceed to Pay Banner with Razorpay Trust */}
          <div className="checkout-payment-box">
            <div className="payment-gateway-strip">
              <div className="gateway-brand">
                <span className="gateway-logo">⚡</span>
                <div>
                  <strong>Razorpay Secure Checkout</strong>
                  <span>Supports GPay, PhonePe, Paytm, All Cards &amp; Netbanking</span>
                </div>
              </div>
              <div className="gateway-badges">
                <span className="pay-tag">UPI</span>
                <span className="pay-tag">CARDS</span>
                <span className="pay-tag">NETBANKING</span>
              </div>
            </div>

            {/* Delivery Notice Box */}
            <div
              className="delivery-notice-box"
              style={{
                background: "#fdfaf3",
                border: "1.5px solid #ebdfce",
                borderRadius: "14px",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <strong style={{ fontSize: "14px", fontWeight: "800", color: "#14271c" }}>
                  📦 Important Delivery Information
                </strong>
              </div>
              <p style={{ margin: 0, fontSize: "12.5px", color: "#4a6153", lineHeight: "1.4" }}>
                Our B2B store goes live on the 25th. Orders placed now will be delivered between 28th – 29th.
              </p>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginTop: "4px",
                  paddingTop: "10px",
                  borderTop: "1px solid #ebdfce",
                  cursor: isBusy ? "not-allowed" : "pointer",
                  fontSize: "12.5px",
                  fontWeight: "700",
                  color: "#14271c",
                }}
              >
                <input
                  type="checkbox"
                  checked={deliveryConfirmed}
                  disabled={isBusy}
                  onChange={(e) => {
                    setDeliveryConfirmed(e.target.checked);
                    if (e.target.checked) setValidationError("");
                  }}
                  style={{
                    width: "18px",
                    height: "18px",
                    accentColor: "#00A63E",
                    cursor: isBusy ? "not-allowed" : "pointer",
                    flexShrink: 0,
                  }}
                />
                <span>I understand my order will be delivered on 28th–29th. *</span>
              </label>
            </div>

            {/* Validation Error Message */}
            {validationError && (
              <div
                style={{
                  background: "#fff1f0",
                  border: "1px solid #ffccc7",
                  color: "#cf1322",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
              >
                ⚠️ {validationError}
              </div>
            )}

            {/* Direct Proceed to Pay Button */}
            <button
              type="submit"
              className="checkout-proceed-btn"
              disabled={isBusy || statusState === "confirmed" || statusState === "paying"}
              style={{
                opacity: isBusy || statusState === "paying" ? 0.7 : 1,
                cursor: isBusy || statusState === "paying" ? "not-allowed" : "pointer",
              }}
            >
              <div className="btn-content-left">
                <span className="lock-emblem">
                  {isBusy || statusState === "preparing" || statusState === "verifying" ? "🔄" : "🔒"}
                </span>
                <span className="btn-main-title">
                  {statusState === "preparing"
                    ? "Preparing Order..."
                    : statusState === "paying"
                    ? "Waiting for Payment..."
                    : statusState === "verifying"
                    ? "Verifying Payment..."
                    : statusState === "confirmed"
                    ? "Order Confirmed!"
                    : "Proceed to Pay"}
                </span>
              </div>
              <div className="btn-content-right">
                <span className="btn-amount-badge">₹{grandTotal.toLocaleString("en-IN")}</span>
                <span className="btn-arrow">→</span>
              </div>
            </button>

            <p className="checkout-trust-footnote">
              Clicking &ldquo;Proceed to Pay&rdquo; will open the official Razorpay Checkout window.
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}
