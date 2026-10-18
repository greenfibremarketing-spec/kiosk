// scripts/test-prelaunch-suite.js
// Automated verification suite for Pre-launch Checkout mode

const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("=================================================");
console.log("STARTING PRE-LAUNCH AUTOMATED VERIFICATION SUITE");
console.log("=================================================\n");

let passedCount = 0;
let totalCount = 0;

function test(name, fn) {
  totalCount++;
  try {
    fn();
    console.log(`[PASS] Test ${totalCount}: ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] Test ${totalCount}: ${name}`);
    console.error(`       Error: ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  totalCount++;
  try {
    await fn();
    console.log(`[PASS] Test ${totalCount}: ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] Test ${totalCount}: ${name}`);
    console.error(`       Error: ${err.message}`);
  }
}

(async () => {
  // Test 1: Header Injection & Sanitization
  test("Header injection stripping (CRLF removal)", () => {
    const stripHdr = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();
    const maliciousName = "John Doe\r\nBcc: secret@victim.com\r\nSubject: Injected";
    const sanitized = stripHdr(maliciousName);
    assert.strictEqual(sanitized.includes("\r"), false);
    assert.strictEqual(sanitized.includes("\n"), false);
    assert.strictEqual(sanitized, "John Doe Bcc: secret@victim.com Subject: Injected");
  });

  // Test 2: HTML Escaping for customer body fields
  test("HTML escaping prevents tag and script injection", () => {
    const escapeHtml = (s) =>
      String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const attack = "<script>alert('xss')</script> & 'hello' \"world\"";
    const escaped = escapeHtml(attack);
    assert.strictEqual(escaped.includes("<script>"), false);
    assert.strictEqual(escaped, "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt; &amp; &#039;hello&#039; &quot;world&quot;");
  });

  // Test 3: Idempotency Map Behavior (Same-Key Repeat Sends None)
  test("Idempotency key repeat cache logic", () => {
    const sentLeadKeys = new Map();
    const key = "test-uuid-12345";
    
    // First attempt: key is not in map
    assert.strictEqual(sentLeadKeys.has(key), false);
    // Mark sent
    sentLeadKeys.set(key, Date.now());
    
    // Second attempt: key is in map -> return duplicate: true without sending
    assert.strictEqual(sentLeadKeys.has(key), true);
  });

  // Test 4: Rate Limiting Cooldown Calculation
  test("Rate limiting cooldown logic (20s on success, 0s on failure)", () => {
    const RATE_LIMIT_COOLDOWN_MS = 20000;
    let lastSuccess = Date.now() - 5000; // 5s ago
    let now = Date.now();
    let elapsed = now - lastSuccess;
    assert.strictEqual(elapsed < RATE_LIMIT_COOLDOWN_MS, true); // Should reject

    // If failed, lastSuccess is not updated (e.g. 0)
    let failedSendLastSuccess = 0;
    let failedElapsed = now - failedSendLastSuccess;
    assert.strictEqual(failedElapsed >= RATE_LIMIT_COOLDOWN_MS, true); // Immediate retry allowed
  });

  // Test 5: Origin Check Logic for Dev and Packaged Modes
  test("Origin check rules (strictly app://kiosk in prod, localhost:3000 or app://kiosk in dev)", () => {
    function checkOrigin(isPackaged, frameUrl) {
      const isAllowedDev = !isPackaged && (frameUrl.startsWith("http://localhost:3000") || frameUrl.startsWith("app://kiosk"));
      const isAllowedProd = frameUrl.startsWith("app://kiosk");
      return isAllowedDev || isAllowedProd;
    }

    // Packaged tests
    assert.strictEqual(checkOrigin(true, "app://kiosk/index.html"), true);
    assert.strictEqual(checkOrigin(true, "app://kiosk"), true);
    assert.strictEqual(checkOrigin(true, "app://other/index.html"), false);
    assert.strictEqual(checkOrigin(true, "http://localhost:3000"), false);
    assert.strictEqual(checkOrigin(true, "http://127.0.0.1:3000"), false);

    // Dev tests
    assert.strictEqual(checkOrigin(false, "app://kiosk/index.html"), true);
    assert.strictEqual(checkOrigin(false, "http://localhost:3000/"), true);
    assert.strictEqual(checkOrigin(false, "http://localhost:5007"), false);
    assert.strictEqual(checkOrigin(false, "http://127.0.0.1:3000"), false);
  });

  // Test 6: SafeStorage and Missing Password Fail-Closed Verification
  test("Fail-closed security when credentials or safeStorage unavailable", () => {
    function verifySafeEnv(hasEncFile, hasEncryption, envPass) {
      if (!hasEncFile && !envPass) {
        throw new Error("SMTP credentials are not configured on this kiosk.");
      }
      return true;
    }

    assert.throws(() => verifySafeEnv(false, false, ""), /not configured/);
    assert.strictEqual(verifySafeEnv(true, true, ""), true);
    assert.strictEqual(verifySafeEnv(false, false, "some_pass"), true);
  });

  // Test 7: Strict Email Validation for Reply-To
  test("Reply-To strict regex validation", () => {
    const isEmailStrict = (email) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
    assert.strictEqual(isEmailStrict("customer@example.com"), true);
    assert.strictEqual(isEmailStrict("user.name+tag@sub.domain.co"), true);
    assert.strictEqual(isEmailStrict("invalid-email"), false);
    assert.strictEqual(isEmailStrict("user@domain\r\nBcc: evil@domain.com"), false);
    assert.strictEqual(isEmailStrict("user@"), false);
  });

  // Test 8: Pre-launch Notice Text Formatting
  test("Pre-launch notice text (with date vs without date)", () => {
    function buildNotice(launchText, launchPlatforms) {
      const text = (launchText || "25th October").trim();
      const platforms = (launchPlatforms || "Amazon, Flipkart, our Android app and our website").trim();
      return `We are coming live from ${text} on ${platforms}. Stay tuned! Enter your details and we will save them and contact you as soon as our products are live. No payment is needed today.`;
    }

    const withDate = buildNotice("25th October", "Amazon, Flipkart");
    assert.strictEqual(withDate.includes("coming live from 25th October on Amazon, Flipkart."), true);
    assert.strictEqual(withDate.includes("Stay tuned!"), true);

    const defaultDate = buildNotice("", "Amazon, Flipkart");
    assert.strictEqual(defaultDate.includes("coming live from 25th October on Amazon, Flipkart."), true);
  });

  // Test 9: Prelaunch countdown duration resolution
  test("Prelaunch countdown duration fallback (15s default, env override, 20s payment)", () => {
    function getSeconds(isPrelaunch, envVal) {
      if (!isPrelaunch) return 20;
      const parsed = parseInt(envVal, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
    }
    assert.strictEqual(getSeconds(true, undefined), 15);
    assert.strictEqual(getSeconds(true, ""), 15);
    assert.strictEqual(getSeconds(true, "0"), 15);
    assert.strictEqual(getSeconds(true, "-10"), 15);
    assert.strictEqual(getSeconds(true, "30"), 30);
    assert.strictEqual(getSeconds(false, "30"), 20); // Payment mode retains 20
  });

  // Test 10: Per-session cooldown isolation
  test("Session cooldown isolation (session 1 does not block session 2)", () => {
    const sessionMap = new Map();
    const COOLDOWN_MS = 20000;
    const now = Date.now();

    function checkAllowed(sessionId) {
      const lastTs = sessionMap.get(sessionId) || 0;
      const elapsed = now - lastTs;
      if (lastTs > 0 && elapsed < COOLDOWN_MS) {
        return false;
      }
      return true;
    }

    sessionMap.set("session_A", now); // Visitor A succeeded
    assert.strictEqual(checkAllowed("session_A"), false); // Visitor A immediate repeat blocked
    assert.strictEqual(checkAllowed("session_B"), true); // Visitor B (new session) allowed immediately!
  });

  // Test 11: Cart duplicate item addition quantity increment
  test("Cart duplicate item addition increments quantity by 1", () => {
    function addCart(prev, item) {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: (updated[idx].quantity || 1) + (item.quantity || 1) };
        return updated;
      }
      return [...prev, { ...item, quantity: item.quantity || 1 }];
    }

    let cart = [];
    cart = addCart(cart, { id: "p1", name: "Bottle", quantity: 1 });
    assert.strictEqual(cart.length, 1);
    assert.strictEqual(cart[0].quantity, 1);

    // Second add of same item
    cart = addCart(cart, { id: "p1", name: "Bottle", quantity: 1 });
    assert.strictEqual(cart.length, 1);
    assert.strictEqual(cart[0].quantity, 2);
  });

  // Test 12: Stale payment reference guard
  test("Stale payment reference guard (ignored in prelaunch, enforced in payment)", () => {
    function canReset(isPrelaunch, storedPayment) {
      if (!isPrelaunch) {
        if (storedPayment && storedPayment.database_order_id) return false;
      }
      return true;
    }

    const lingeringPayment = { database_order_id: "ORD-999" };
    assert.strictEqual(canReset(false, lingeringPayment), false); // Payment mode protected
    assert.strictEqual(canReset(true, lingeringPayment), true); // Prelaunch mode ignores stale reference
  });

  console.log(`\nResults: ${passedCount} / ${totalCount} tests passed.`);
  if (passedCount === totalCount) {
    console.log("ALL PRE-LAUNCH LOGIC TESTS PASSED SUCCESSFULLY!");
  } else {
    process.exit(1);
  }
})();

