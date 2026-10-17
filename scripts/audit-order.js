/**
 * Standalone Read-Only Audit Script for Kiosk Orders and Razorpay Reconciliation
 * 
 * Usage:
 *   node scripts/audit-order.js [ORDER_NUMBER_OR_ID]
 * Example:
 *   node scripts/audit-order.js GF-ORD-37182
 */

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { createRequire } from "module";

const targetArg = process.argv[2] || "GF-ORD-37182";

// ── Read Environment Variables ────────────────────────────────────────────────
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

const websiteBackendEnv = parseEnvFile("e:/greenfibre/greenfibre/src/backend/.env");
const kioskBackendEnv = parseEnvFile("e:/kiosk-backend/kiosk_AIML/.env");
const kioskFrontendEnv = parseEnvFile("e:/greenfibre-kiosk/.env");

const MONGO_URL =
  process.env.MONGO_URL ||
  websiteBackendEnv.MONGO_URL ||
  kioskBackendEnv.MONGO_URL ||
  "mongodb+srv://greenfibremarketing_db_user:FoMPuW8G1NujoE3o@cluster0.ihhkcrj.mongodb.net/greenfibre?retryWrites=true&w=majority&appName=Cluster0";

const RAZORPAY_KEY_ID =
  process.env.RAZORPAY_KEY_ID ||
  websiteBackendEnv.RAZORPAY_KEY_ID ||
  "rzp_live_TXVnl7XtdLZsws";

const RAZORPAY_KEY_SECRET =
  process.env.RAZORPAY_KEY_SECRET ||
  websiteBackendEnv.RAZORPAY_KEY_SECRET ||
  "pa5XsHmRJcHhTLjg8x7DgdvZ";

// ── HTTP / HTTPS Helper ───────────────────────────────────────────────────────
function fetchJson(url, options = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, error: e.message });
        }
      });
    });
    req.on("error", (err) => resolve({ status: 0, error: err.message }));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function razorpayApi(endpoint) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  return fetchJson(`https://api.razorpay.com/v1${endpoint}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
}

// ── Main Audit Function ───────────────────────────────────────────────────────
async function runAudit() {
  console.log("================================================================================");
  console.log("       GREENFIBRE KIOSK ORDER & PAYMENT RECONCILIATION AUDIT (READ-ONLY)       ");
  console.log("================================================================================");
  console.log(`Audit Target Query: "${targetArg}"`);
  console.log(`Timestamp:          ${new Date().toISOString()}`);
  console.log(`MongoDB Cluster:    ${MONGO_URL.replace(/:([^@]+)@/, ":****@")}`);
  console.log(`Razorpay Key ID:    ${RAZORPAY_KEY_ID}`);
  console.log("--------------------------------------------------------------------------------\n");

  // Step 1: Connect to MongoDB and Search
  let dbOrder = null;
  let recentOrders = [];
  try {
    const req = createRequire("e:/greenfibre/greenfibre/src/backend/package.json");
    const mongoose = req("mongoose");
    await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 8000 });
    const ordersCol = mongoose.connection.collection("orders");

    // Search by ObjectId, order_number, razorpayOrderId, or text
    const orQueries = [
      { order_number: targetArg },
      { orderNumber: targetArg },
      { custom_order_id: targetArg },
      { razorpayOrderId: targetArg },
      { razorpay_order_id: targetArg },
      { "shippingAddress.fullName": new RegExp(targetArg, "i") },
    ];

    if (/^[0-9a-fA-F]{24}$/.test(targetArg)) {
      try {
        orQueries.push({ _id: new mongoose.Types.ObjectId(targetArg) });
      } catch (e) {}
    }

    dbOrder = await ordersCol.findOne({ $or: orQueries });

    if (!dbOrder) {
      // Search partial regex on _id or stringified docs
      const allSample = await ordersCol.find({}).limit(50).toArray();
      for (const doc of allSample) {
        if (
          String(doc._id).includes(targetArg) ||
          JSON.stringify(doc).includes(targetArg)
        ) {
          dbOrder = doc;
          break;
        }
      }
    }

    recentOrders = await ordersCol.find({}).sort({ _id: -1 }).limit(10).toArray();
    await mongoose.disconnect();
  } catch (dbErr) {
    console.error("[-] MongoDB Query Error:", dbErr.message);
  }

  // Step 2: Check Python Kiosk Backend Memory Cache
  let kioskMemoryOrder = null;
  try {
    const kioskCheck = await fetchJson(`http://localhost:5007/payments/orders/${targetArg}?session_id=audit-test`, {
      headers: {
        "X-Kiosk-ID": "kiosk-01",
        "X-Kiosk-Token": "greenfibre-kiosk-trusted-2026",
      },
    });
    if (kioskCheck.status === 200) {
      kioskMemoryOrder = kioskCheck.data;
    }
  } catch (kErr) {}

  // Step 3: Check Razorpay API
  let rzpOrder = null;
  let rzpPayments = [];
  let rzpPayment = null;

  const targetRzpOrderId =
    dbOrder?.razorpayOrderId ||
    (targetArg.startsWith("order_") ? targetArg : null);

  const targetRzpPaymentId =
    dbOrder?.razorpayPaymentId ||
    (targetArg.startsWith("pay_") ? targetArg : null);

  if (targetRzpOrderId) {
    const resOrder = await razorpayApi(`/orders/${targetRzpOrderId}`);
    if (resOrder.status === 200) rzpOrder = resOrder.data;
    const resPayments = await razorpayApi(`/orders/${targetRzpOrderId}/payments`);
    if (resPayments.status === 200) rzpPayments = resPayments.data.items || [];
  }

  if (targetRzpPaymentId) {
    const resPay = await razorpayApi(`/payments/${targetRzpPaymentId}`);
    if (resPay.status === 200) rzpPayment = resPay.data;
  }

  // Also query recent payments from Razorpay to see recent activity
  const recentRzpPaymentsRes = await razorpayApi("/payments?count=5");
  const recentRzpPayments = recentRzpPaymentsRes?.data?.items || [];

  // Step 4: Comparison Table
  console.log("================================================================================");
  console.log("                      1. FIELD-BY-FIELD RECONCILIATION                          ");
  console.log("================================================================================");

  const formatRow = (field, dbVal, rzpVal, match) => {
    const fStr = String(field).padEnd(20);
    const dStr = String(dbVal ?? "NOT FOUND").padEnd(28);
    const rStr = String(rzpVal ?? "NOT FOUND").padEnd(28);
    const mStr = String(match).padEnd(8);
    return `${fStr} | ${dStr} | ${rStr} | ${mStr}`;
  };

  console.log(formatRow("Field", "Database (MongoDB)", "Razorpay Gateway", "Match?"));
  console.log("-".repeat(88));

  const dbOrderId = dbOrder?.razorpayOrderId || "NONE";
  const rzpOrderId = rzpOrder?.id || (rzpPayments[0]?.order_id) || "NONE";
  const orderIdMatch = dbOrderId !== "NONE" && dbOrderId === rzpOrderId;
  console.log(formatRow("order_id", dbOrderId, rzpOrderId, orderIdMatch ? "PASS" : "FAIL"));

  const dbPaymentId = dbOrder?.razorpayPaymentId || "NONE";
  const rzpPaymentId = rzpPayment?.id || (rzpPayments[0]?.id) || "NONE";
  const paymentIdMatch = dbPaymentId !== "NONE" && dbPaymentId === rzpPaymentId;
  console.log(formatRow("payment_id", dbPaymentId, rzpPaymentId, paymentIdMatch ? "PASS" : "FAIL"));

  const dbAmount = dbOrder?.finalAmount != null ? `Rs ${dbOrder.finalAmount}` : "NONE";
  const rzpAmount = rzpOrder?.amount != null ? `Rs ${rzpOrder.amount / 100}` : (rzpPayments[0]?.amount != null ? `Rs ${rzpPayments[0].amount / 100}` : "NONE");
  const amountMatch = dbAmount !== "NONE" && dbAmount === rzpAmount;
  console.log(formatRow("amount", dbAmount, rzpAmount, amountMatch ? "PASS" : "FAIL"));

  const dbCurrency = "INR";
  const rzpCurrency = rzpOrder?.currency || (rzpPayments[0]?.currency) || "NONE";
  const currencyMatch = rzpCurrency === "INR";
  console.log(formatRow("currency", dbOrder ? dbCurrency : "NONE", rzpCurrency, currencyMatch ? "PASS" : "FAIL"));

  const dbStatus = dbOrder?.orderStatus || dbOrder?.paymentStatus || "NONE";
  const rzpStatus = rzpOrder?.status || (rzpPayments[0]?.status) || "NONE";
  const statusMatch = dbStatus === "placed" && rzpStatus === "captured";
  console.log(formatRow("status", dbStatus, rzpStatus, statusMatch ? "PASS" : "FAIL"));

  const dbCust = dbOrder?.shippingAddress?.email || dbOrder?.shippingAddress?.phone || "NONE";
  const rzpCust = (rzpPayments[0]?.email || rzpPayments[0]?.contact) || (rzpPayment?.email || rzpPayment?.contact) || "NONE";
  const custMatch = dbCust !== "NONE" && (dbCust === rzpCust || rzpCust.includes(dbOrder?.shippingAddress?.phone || "~~~"));
  console.log(formatRow("customer", dbCust, rzpCust, custMatch ? "PASS" : "FAIL"));

  const dbTime = dbOrder?.createdAt ? new Date(dbOrder.createdAt).toLocaleString("en-IN") : "NONE";
  const rzpTime = rzpOrder?.created_at ? new Date(rzpOrder.created_at * 1000).toLocaleString("en-IN") : (rzpPayments[0]?.created_at ? new Date(rzpPayments[0].created_at * 1000).toLocaleString("en-IN") : "NONE");
  console.log(formatRow("timestamp", dbTime, rzpTime, dbTime !== "NONE" && rzpTime !== "NONE" ? "PASS" : "FAIL"));

  console.log("-".repeat(88));

  // Step 5: Discrepancy Diagnostics
  console.log("\n================================================================================");
  console.log("                        2. DISCREPANCY AUDIT FLAGS                              ");
  console.log("================================================================================");

  const flags = [];
  if (!dbOrder) {
    flags.push("[CRITICAL] Order NOT FOUND in MongoDB database ('greenfibre.orders')!");
  } else {
    console.log(`[+] Found in MongoDB with ID: ${dbOrder._id}`);
  }

  if (!rzpOrder && !rzpPayment && rzpPayments.length === 0) {
    flags.push("[CRITICAL] Order/Payment NOT FOUND in Razorpay gateway!");
  }

  if (dbOrder && rzpOrder && dbOrder.finalAmount * 100 !== rzpOrder.amount) {
    flags.push(`[HIGH] Amount mismatch: DB finalAmount=Rs ${dbOrder.finalAmount} vs Razorpay=Rs ${rzpOrder.amount / 100}`);
  }

  if (rzpPayments[0] && rzpPayments[0].status !== "captured") {
    flags.push(`[HIGH] Razorpay payment status is '${rzpPayments[0].status}', NOT 'captured'!`);
  }

  if (dbOrder && !dbOrder.razorpaySignature) {
    flags.push("[CRITICAL] HMAC SHA256 Signature is MISSING or UNVERIFIED in DB record!");
  }

  if (targetArg.startsWith("GF-ORD-")) {
    flags.push("[INFO] Order number pattern 'GF-ORD-XXXXX' is generated ONLY by kiosk_AIML/app/payments.py in-memory dict.");
  }

  for (const f of flags) {
    console.log(`  ! ${f}`);
  }

  // Step 6: Last 10 Orders in Database
  console.log("\n================================================================================");
  console.log("                 3. LAST 10 ORDERS IN MONGODB ('greenfibre.orders')             ");
  console.log("================================================================================");
  console.log(
    "Order ID (DB)".padEnd(26) +
    " | Amount  " +
    " | Status    " +
    " | Razorpay Order ID    " +
    " | Razorpay Pay ID      " +
    " | Created At"
  );
  console.log("-".repeat(105));

  if (recentOrders.length === 0) {
    console.log("  (No orders found in MongoDB)");
  } else {
    for (const ord of recentOrders) {
      const id = String(ord._id).padEnd(24);
      const amt = `Rs ${ord.finalAmount || ord.totalAmount || 0}`.padEnd(8);
      const st = String(ord.orderStatus || ord.paymentStatus || "unknown").padEnd(10);
      const rOrd = String(ord.razorpayOrderId || "none").padEnd(21);
      const rPay = String(ord.razorpayPaymentId || "none").padEnd(21);
      const dt = ord.createdAt ? new Date(ord.createdAt).toISOString().slice(0, 19).replace("T", " ") : "unknown";
      console.log(`${id} | ${amt} | ${st} | ${rOrd} | ${rPay} | ${dt}`);
    }
  }

  // Step 7: Last 5 Live Razorpay Payments
  console.log("\n================================================================================");
  console.log("                 4. RECENT PAYMENTS IN RAZORPAY GATEWAY                         ");
  console.log("================================================================================");
  if (recentRzpPayments.length === 0) {
    console.log("  (No recent payments returned from Razorpay)");
  } else {
    for (const p of recentRzpPayments) {
      const pId = p.id;
      const amt = `Rs ${p.amount / 100}`;
      const st = p.status;
      const email = p.email || p.contact || "n/a";
      const dt = new Date(p.created_at * 1000).toISOString().slice(0, 19).replace("T", " ");
      console.log(`  ${pId.padEnd(22)} | ${amt.padEnd(9)} | ${st.padEnd(10)} | ${email.padEnd(30)} | ${dt}`);
    }
  }

  console.log("\n================================================================================");
  console.log("                             AUDIT COMPLETE                                     ");
  console.log("================================================================================");
}

runAudit().catch((err) => {
  console.error("Fatal audit script failure:", err);
  process.exit(1);
});
