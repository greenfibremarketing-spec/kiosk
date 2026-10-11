// kioskWebSocket.js — Real-time Protocol v2 WebSocket Client for Greenie AI Backend
import { getWsUrl, CURRENT_ENV, KIOSK_ID } from "@/lib/apiConfig";

class KioskWebSocketClient {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.turnCounter = 0;

    // Active request resolvers: Map<turnId, { resolve, reject, timeout, onToken, onSentence, onAction }>
    this.activeTurns = new Map();

    // Global event listeners
    this.listeners = {
      token: new Set(),
      sentence: new Set(),
      action: new Set(),
      done: new Set(),
      error: new Set(),
      status: new Set(),
    };

    // Store last action received from backend (e.g. for speech_id acknowledgement)
    this.lastAction = null;
    this.currentResponse = "";
    this.pendingSpeechId = null;
    this.speechDoneTimer = null;
  }

  generateTurnId() {
    this.turnCounter += 1;
    return `turn-${Date.now()}-${this.turnCounter}`;
  }

  // ── Event Subscription API ──
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].add(callback);
    }
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.warn(`[KioskWS] Error in ${event} listener:`, e);
        }
      });
    }
  }

  // ── Connection Management ──
  connect(sessionId = "kiosk-session") {
    if (typeof window === "undefined") return;

    // If already connected to the requested session, skip reconnecting
    if (
      this.ws &&
      this.sessionId === sessionId &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // Close previous session connection if session changed
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    this.sessionId = sessionId;
    const wsUrl = getWsUrl(this.sessionId, KIOSK_ID);

    try {
      console.log(`[KioskWS] Connecting (${CURRENT_ENV}) to:`, wsUrl);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        clearTimeout(this.reconnectTimer);
        this.startHeartbeat();
        this.emit("status", { connected: true, sessionId: this.sessionId });
        console.log(`[KioskWS] Connected to backend session: ${this.sessionId}`);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.ws.onerror = (err) => {
        console.warn("[KioskWS] WebSocket error:", err);
        this.emit("error", { type: "connection", error: err });
      };

      this.ws.onclose = (event) => {
        this.connected = false;
        this.stopHeartbeat();
        if (this.speechDoneTimer) {
          clearTimeout(this.speechDoneTimer);
          this.speechDoneTimer = null;
        }
        this.pendingSpeechId = null;
        this.emit("status", { connected: false, sessionId: this.sessionId });

        // Reject any pending turns
        for (const [turnId, pending] of this.activeTurns.entries()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("WebSocket connection closed"));
        }
        this.activeTurns.clear();

        // Auto-reconnect after 2 seconds
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (this.sessionId) {
            this.connect(this.sessionId);
          }
        }, 2000);
      };
    } catch (e) {
      console.warn("[KioskWS] WebSocket init error:", e);
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch (_) {}
      }
    }, 25000);
  }

  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ── Incoming Frame Parser ──
  handleMessage(event) {
    try {
      const payload = JSON.parse(event.data);
      const { type, data, meta, metadata } = payload;

      // Extract action data whether structured as type="action" or top-level action payload
      const actionData = (type === "action" || payload.action || data?.action)
        ? (data || payload?.data || payload)
        : null;

      // 1. Check if action requires speech completion acknowledgement (Option 1: 1.5s timer)
      const isAwaitingSpeech = Boolean(
        actionData?.awaiting_speech_done ||
        payload?.awaiting_speech_done ||
        meta?.awaiting_speech_done ||
        data?.awaiting_speech_done
      );

      const incomingSpeechId =
        actionData?.speech_id ||
        payload?.speech_id ||
        meta?.speech_id ||
        data?.speech_id;

      if (isAwaitingSpeech && incomingSpeechId) {
        console.log(`[KioskWS] Greeting/Action awaiting SPEECH_DONE (speech_id: ${incomingSpeechId})`);
        this.pendingSpeechId = incomingSpeechId;

        // Reset any existing timer
        if (this.speechDoneTimer) {
          clearTimeout(this.speechDoneTimer);
        }

        // Auto-acknowledge speech completion after 1.5s delay to allow greeting audio to play
        this.speechDoneTimer = setTimeout(() => {
          this.flushSpeechDone(incomingSpeechId);
        }, 1500);
      }

      switch (type) {
        case "token": {
          const tokenStr = typeof data === "string" ? data : "";
          this.currentResponse += tokenStr;
          this.emit("token", tokenStr);

          // Notify turn-specific callbacks
          for (const pending of this.activeTurns.values()) {
            pending.onToken?.(tokenStr, this.currentResponse);
          }
          break;
        }

        case "sentence": {
          const sentenceStr = typeof data === "string" ? data : "";
          this.emit("sentence", sentenceStr);

          for (const pending of this.activeTurns.values()) {
            pending.onSentence?.(sentenceStr);
          }
          break;
        }

        case "action": {
          const act = actionData || data || payload?.data || payload;
          this.lastAction = act;
          this.emit("action", act);

          for (const pending of this.activeTurns.values()) {
            pending.onAction?.(act);
          }
          break;
        }

        case "done": {
          this.isBusy = false;
          this.currentTurnId = null;
          const fullText = typeof data === "string" ? data : this.currentResponse;
          const turnId = meta?.turn_id;
          const resolvedAction = meta?.action || this.lastAction || null;
          const result = {
            reply: fullText,
            salesStage: meta?.sales_stage,
            turnId,
            action: resolvedAction,
            meta,
          };

          this.emit("done", result);

          // Resolve matching turn or the oldest pending turn
          if (turnId && this.activeTurns.has(turnId)) {
            const pending = this.activeTurns.get(turnId);
            clearTimeout(pending.timeout);
            this.activeTurns.delete(turnId);
            pending.resolve(result);
          } else if (this.activeTurns.size > 0) {
            const [firstTurnId, pending] = this.activeTurns.entries().next().value;
            clearTimeout(pending.timeout);
            this.activeTurns.delete(firstTurnId);
            pending.resolve(result);
          }

          this.lastAction = null;
          this.currentResponse = "";
          break;
        }

        case "cancelled": {
          this.isBusy = false;
          this.currentTurnId = null;
          this.emit("cancelled", { turnId: meta?.turn_id });
          if (meta?.turn_id && this.activeTurns.has(meta.turn_id)) {
            const pending = this.activeTurns.get(meta.turn_id);
            clearTimeout(pending.timeout);
            this.activeTurns.delete(meta.turn_id);
            pending.reject(new Error("Turn cancelled"));
          }
          this.currentResponse = "";
          break;
        }

        case "error": {
          this.isBusy = false;
          this.currentTurnId = null;
          const errMessage = typeof data === "string" ? data : "Backend error";
          this.emit("error", { message: errMessage, metadata });

          // Reject active turns if critical
          for (const [turnId, pending] of this.activeTurns.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(errMessage));
          }
          this.activeTurns.clear();
          this.currentResponse = "";
          break;
        }

        case "pong":
          // Heartbeat ack, no-op
          break;

        default:
          console.log("[KioskWS] Unknown message frame:", payload);
      }
    } catch (e) {
      console.warn("[KioskWS] Failed to parse incoming frame:", e);
    }
  }

  // ── Wait for WebSocket Connection ──
  async ensureConnected(sessionId = "kiosk-session") {
    if (!this.ws || this.sessionId !== sessionId || this.ws.readyState !== WebSocket.OPEN) {
      this.connect(sessionId);
      await new Promise((res) => {
        let attempts = 0;
        const check = setInterval(() => {
          attempts++;
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            clearInterval(check);
            res(true);
          } else if (attempts > 35) {
            clearInterval(check);
            res(false);
          }
        }, 100);
      });
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Unable to establish WebSocket connection to AI backend");
    }
  }

  // ── Send Natural Language Query Frame ──
  async sendQuery(message, sessionId = "kiosk-session", callbacks = {}) {
    await this.ensureConnected(sessionId);

    // If speech completion acknowledgement is pending, flush it immediately before query
    if (this.pendingSpeechId) {
      console.log(`[KioskWS] Pre-flushing SPEECH_DONE (${this.pendingSpeechId}) before sendQuery to prevent 409 conflict`);
      this.flushSpeechDone(this.pendingSpeechId);
      await new Promise((r) => setTimeout(r, 60));
    }

    const onToken = typeof callbacks === "function" ? callbacks : callbacks?.onToken;
    const onSentence = callbacks?.onSentence;
    const onAction = callbacks?.onAction;

    // If backend is still generating a previous turn, cleanly cancel it to release coordinator lock
    if (this.isBusy && this.currentTurnId) {
      console.log(`[KioskWS] Preempting previous turn ${this.currentTurnId} for new query`);
      this.cancel(this.currentTurnId);
      await new Promise((r) => setTimeout(r, 40));
    }

    const turnId = this.generateTurnId();
    this.isBusy = true;
    this.currentTurnId = turnId;
    this.currentResponse = "";
    this.lastAction = null;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.activeTurns.has(turnId)) {
          this.activeTurns.delete(turnId);
          if (this.currentTurnId === turnId) {
            this.isBusy = false;
            this.currentTurnId = null;
          }
          reject(new Error(`WebSocket turn timed out (${turnId})`));
        }
      }, 15000);

      this.activeTurns.set(turnId, {
        resolve,
        reject,
        timeout,
        onToken,
        onSentence,
        onAction,
      });

      const frame = {
        v: 2,
        message: String(message || ""),
        turn_id: turnId,
        input_mode: callbacks?.inputMode || "text",
      };

      this.ws.send(JSON.stringify(frame));
    });
  }

  // ── Send Guided Flow Action Frame ──
  async sendAction(action, payload = {}, options = {}) {
    const sessionId = options.sessionId || this.sessionId || "kiosk-session";
    await this.ensureConnected(sessionId);

    // If action is SPEECH_DONE itself, handle directly without locking isBusy / activeTurns
    if (action === "SPEECH_DONE") {
      const sid = payload?.speech_id || this.pendingSpeechId;
      this.flushSpeechDone(sid);
      return { success: true };
    }

    // If speech completion acknowledgement is pending, flush it immediately before sending action
    if (this.pendingSpeechId) {
      console.log(`[KioskWS] Pre-flushing SPEECH_DONE (${this.pendingSpeechId}) before sendAction (${action}) to prevent 409 conflict`);
      this.flushSpeechDone(this.pendingSpeechId);
      await new Promise((r) => setTimeout(r, 60));
    }

    // If backend is still generating a previous turn, cleanly cancel it to release coordinator lock
    if (this.isBusy && this.currentTurnId) {
      console.log(`[KioskWS] Preempting previous turn ${this.currentTurnId} for action ${action}`);
      this.cancel(this.currentTurnId);
      await new Promise((r) => setTimeout(r, 40));
    }

    const turnId = options.turnId || this.generateTurnId();
    this.isBusy = true;
    this.currentTurnId = turnId;
    this.currentResponse = "";
    this.lastAction = null;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.activeTurns.has(turnId)) {
          this.activeTurns.delete(turnId);
          if (this.currentTurnId === turnId) {
            this.isBusy = false;
            this.currentTurnId = null;
          }
          reject(new Error(`WebSocket action timed out (${turnId})`));
        }
      }, 15000);

      this.activeTurns.set(turnId, {
        resolve,
        reject,
        timeout,
        onToken: options.onToken,
        onSentence: options.onSentence,
        onAction: options.onAction,
      });

      // Strict frame construction to respect backend Pydantic (extra = 'forbid')
      const frame = {
        v: 2,
        action,
        turn_id: turnId,
        input_mode: options.inputMode || "button",
      };

      if (action === "SET_NAME" && payload.name) {
        frame.name = String(payload.name).trim();
      } else if (action === "SELECT_CATEGORY" && (payload.category_id || payload.categoryId)) {
        frame.category_id = String(payload.category_id || payload.categoryId).trim().toLowerCase();
      } else if (action === "SELECT_PRODUCT" && (payload.sku || payload.id)) {
        const rawSku = String(payload.sku || payload.id).trim();
        frame.sku = rawSku.startsWith("GF:") ? rawSku : `GF:${rawSku}`;
      }

      console.log(`[KioskWS] Sending sanitized flow action: ${action}`, frame);
      this.ws.send(JSON.stringify(frame));
    });
  }

  // ── Send SPEECH_DONE Acknowledgement Frame (Crucial for Sales Stage Transition) ──
  flushSpeechDone(speechId = null) {
    const sid = speechId || this.pendingSpeechId;
    if (!sid) return;

    if (this.speechDoneTimer) {
      clearTimeout(this.speechDoneTimer);
      this.speechDoneTimer = null;
    }
    this.pendingSpeechId = null;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const ackFrame = {
        v: 2,
        action: "SPEECH_DONE",
        speech_id: sid,
        turn_id: `ack-${Date.now()}`,
        input_mode: "button",
      };
      console.log(`[KioskWS] Emitting SPEECH_DONE frame (speech_id: ${sid}):`, ackFrame);
      try {
        this.ws.send(JSON.stringify(ackFrame));
      } catch (err) {
        console.warn("[KioskWS] Failed to send SPEECH_DONE frame:", err);
      }
    }
  }

  // Legacy/external callable
  sendSpeechDone(speechId) {
    this.flushSpeechDone(speechId);
    return Promise.resolve({ success: true });
  }

  // ── Cancel Ongoing Inference Frame ──
  cancel(turnId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const frame = {
          v: 2,
          type: "cancel",
          turn_id: turnId || undefined,
        };
        this.ws.send(JSON.stringify(frame));
      } catch (_) {}
    }
  }
}

export const kioskWS = new KioskWebSocketClient();

if (typeof window !== "undefined") {
  kioskWS.connect("kiosk-session");
}

export default kioskWS;
