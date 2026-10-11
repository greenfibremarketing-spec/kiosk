/**
 * apiConfig.js — Centralized environment & endpoint configuration.
 *
 * Full support for Greenie AI Kiosk Backend:
 * - Environment switching: "local" | "testing" | "production"
 * - REST endpoints: /health, /products, /chat, /session/reset, /auth/kiosk/token, /ws/status
 * - Real-Time Streaming WebSocket: ws://.../ws/{session_id}?v=2&kiosk_id={kiosk_id}
 */

const PRESETS = {
  production: {
    backendUrl: "https://kioskai.greenfibre.org",
    wsBaseUrl: "wss://kioskai.greenfibre.org",
  },
  local: {
    backendUrl: "http://localhost:5007",
    wsBaseUrl: "ws://localhost:5007",
  },
  testing: {
    backendUrl: "http://localhost:5007",
    wsBaseUrl: "ws://localhost:5007",
  },
};

// 1. Resolve current environment name (default: "local")
export const CURRENT_ENV = (
  process.env.NEXT_PUBLIC_ENV ||
  process.env.NEXT_PUBLIC_APP_ENV ||
  "local"
).toLowerCase();

export const IS_PRODUCTION =
  CURRENT_ENV === "production" || CURRENT_ENV === "prod";

const activePreset = IS_PRODUCTION ? PRESETS.production : PRESETS.local;

// 2. Base URLs
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (IS_PRODUCTION
    ? process.env.NEXT_PUBLIC_PROD_BACKEND_URL || activePreset.backendUrl
    : process.env.NEXT_PUBLIC_LOCAL_BACKEND_URL || activePreset.backendUrl);

export const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_BASE_URL ||
  BACKEND_URL.replace(/^http/, "ws");

export const KIOSK_ID =
  process.env.NEXT_PUBLIC_KIOSK_ID || "kiosk-01";

// 3. Helper to build WebSocket connection URL
export function getWsUrl(sessionId = "kiosk-session", kioskId = KIOSK_ID) {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  const cleanBase = WS_BASE_URL.replace(/\/+$/, "");
  const cleanSess = encodeURIComponent(String(sessionId || "kiosk-session"));
  const cleanKiosk = encodeURIComponent(String(kioskId || KIOSK_ID));
  return `${cleanBase}/ws/${cleanSess}?v=2&kiosk_id=${cleanKiosk}`;
}

// 4. REST Endpoints
export const ENDPOINTS = {
  health: `${BACKEND_URL}/health`,
  products: `${BACKEND_URL}/products`,
  chat: `${BACKEND_URL}/chat`,
  sessionReset: `${BACKEND_URL}/session/reset`,
  token: `${BACKEND_URL}/auth/kiosk/token`,
  wsStatus: `${BACKEND_URL}/ws/status`,
};

// Backward-compatible exports
export const API_URL = process.env.NEXT_PUBLIC_API_URL || ENDPOINTS.chat;
export const WS_URL = getWsUrl();

export function getApiConfig(sessionId = "kiosk-session") {
  return {
    env: CURRENT_ENV,
    isProduction: IS_PRODUCTION,
    kioskId: KIOSK_ID,
    backendUrl: BACKEND_URL,
    wsBaseUrl: WS_BASE_URL,
    wsUrl: getWsUrl(sessionId),
    endpoints: ENDPOINTS,
  };
}

const apiConfig = {
  CURRENT_ENV,
  IS_PRODUCTION,
  KIOSK_ID,
  BACKEND_URL,
  WS_BASE_URL,
  getWsUrl,
  ENDPOINTS,
  API_URL,
  WS_URL,
  getApiConfig,
};

export default apiConfig;
