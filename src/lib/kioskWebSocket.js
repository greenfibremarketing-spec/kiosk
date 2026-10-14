// kioskWebSocket.js — Real-time Protocol v2 WebSocket Client for Greenie AI Backend
import { getWsUrl, CURRENT_ENV, KIOSK_ID } from "@/lib/apiConfig";
import KioskStepCache, { KIOSK_STEPS } from "@/lib/kioskStepCache";
import { SentenceTokenStreamer } from "@/lib/ttsTextSanitizer";

class KioskWebSocketClient {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.turnCounter = 0;

    // Streamed sentence buffer to emit sentences as tokens arrive
    this.sentenceStreamer = new SentenceTokenStreamer((sentence) => {
      console.log(`[BACKEND >> SENTENCE (streamed)] "${sentence}"`);
      this.emit("sentence", sentence, this.currentTurnId);
      for (const pending of this.activeTurns.values()) {
        pending.onSentence?.(sentence, this.currentTurnId);
      }
    });

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
      hint: new Set(),
      ping_silence: new Set(),
      auto_reset: new Set(),
      cancelled: new Set(),
    };

    // Store last action received from backend (e.g. for speech_id acknowledgement)
    this.lastAction = null;
    this.currentResponse = "";
    this.currentSpeechId = null;
    this.pendingSpeechId = null;
    this.speechDoneTimer = null;
    this.inFlightTurnId = null;   // turn currently streaming from the backend
    this.staleTurns = new Set();  // turns the user cancelled; their frames are ignored
  }

  generateTurnId() {
    this.turnCounter += 1;
    return `turn_${Date.now()}`;
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
  connect(sessionId = null, autoGreet = true) {
    if (typeof window === "undefined") return;

    const resolvedSessionId = sessionId || KioskStepCache.getOrCreateSessionId();

    // If already connected to the requested session, skip reconnecting
    if (
      this.ws &&
      this.sessionId === resolvedSessionId &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // Close previous session connection if session changed
    this.staleTurns.clear();
    this.inFlightTurnId = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    this.sessionId = resolvedSessionId;
    KioskStepCache.setSessionId(resolvedSessionId);

    // shouldAutoGreet = Boolean(autoGreet) when the caller explicitly requests it
    const shouldAutoGreet = Boolean(autoGreet);

    const wsUrl = getWsUrl(this.sessionId, KIOSK_ID, shouldAutoGreet);

    try {
      console.log(`[FRONTEND >> WS CONNECT] Connecting (${CURRENT_ENV}) to:`, wsUrl, `[autoGreet=${shouldAutoGreet}, step=${KioskStepCache.getCurrentStep()}]`);
      this.ws = new WebSocket(wsUrl);
      this.ws.sessionId = resolvedSessionId;

      this.ws.onopen = () => {
        this.connected = true;
        clearTimeout(this.reconnectTimer);
        this.startHeartbeat();
        this.emit("status", { connected: true, sessionId: this.sessionId });
        console.log(`[BACKEND >> WS CONNECTED] Session: ${this.sessionId}`);
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

        // Auto-reconnect after 2 seconds (with autoGreet=false so reconnect never re-greets)
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (this.sessionId) {
            this.connect(this.sessionId, false);
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
    // Guard: ignore messages from old/closed sockets
    if (event.target && event.target !== this.ws) {
      console.log(`[KioskWS] Dropping late frame from closed socket (sockSession=${event.target?.sessionId}, currentSession=${this.sessionId})`);
      return;
    }

    try {
      const payload = JSON.parse(event.data);
      const { type, data, meta, metadata } = payload;

      // Check session ID if present in payload or meta to drop stale messages from previous session
      const incomingSession = payload.session_id || payload.sessionId || meta?.session_id;
      if (incomingSession && incomingSession !== this.sessionId) {
        console.log(`[KioskWS] Dropping late frame for session mismatch (msgSession=${incomingSession}, currentSession=${this.sessionId})`);
        return;
      }

      const frameTurnId = meta?.turn_id || payload.turn_id || data?.turn_id || null;
      if (frameTurnId && this.staleTurns.has(frameTurnId)) {
        if (type === "done" || type === "cancelled" || type === "error") {
          this.staleTurns.delete(frameTurnId);
        }
        if (type !== "token") console.log(`[KioskWS] Dropping stale ${type} frame from cancelled turn ${frameTurnId}`);
        return;
      }
      if (frameTurnId && !this.inFlightTurnId && (type === "token" || type === "action" || type === "sentence")) {
        this.inFlightTurnId = frameTurnId; // backend-started turn (e.g. auto greet)
      }

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
        this.currentSpeechId = incomingSpeechId;
      }

      switch (type) {
        case "token": {
          const tokenStr = typeof data === "string" ? data : "";
          this.currentResponse += tokenStr;
          console.log(`[BACKEND >> TOKEN] turn=${frameTurnId || "?"} "${tokenStr}"`);
          this.emit("token", tokenStr);

          // Buffer streamed tokens into sentences and emit completed sentences for early TTS
          this.sentenceStreamer?.push(tokenStr);

          // Notify turn-specific callbacks
          for (const pending of this.activeTurns.values()) {
            pending.onToken?.(tokenStr, this.currentResponse);
          }
          break;
        }

        case "sentence": {
          const sentenceStr = typeof data === "string" ? data : "";
          console.log(`[BACKEND >> SENTENCE] "${sentenceStr}"`);
          this.emit("sentence", sentenceStr);

          for (const pending of this.activeTurns.values()) {
            pending.onSentence?.(sentenceStr);
          }
          break;
        }

        case "action": {
          const act = actionData || data || payload?.data || payload;
          if (act?.speech_id) {
            this.currentSpeechId = act.speech_id;
          }
          this.lastAction = act;
          const actName = act?.action || act?.type || "ACTION";
          const actMsg = act?.message || act?.prompt || (act?.products ? `${act.products.length} products` : "") || "";
          console.log(`[BACKEND >> ACTION] ${actName}${actMsg ? ` | "${actMsg}"` : ""}`, act);
          this.emit("action", act);

          for (const pending of this.activeTurns.values()) {
            pending.onAction?.(act);
          }
          break;
        }

        case "hint": {
          console.log(`[BACKEND >> HINT]`, data);
          this.emit("hint", data);
          break;
        }

        case "done": {
          this.inFlightTurnId = null;
          this.isBusy = false;
          // Flush any remaining buffered tokens as the final sentence
          this.sentenceStreamer?.flush();
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

          console.log(`[BACKEND >> DONE] stage: ${meta?.sales_stage || "complete"} | turn: ${turnId || "N/A"}\n  reply: "${fullText}"`);

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
          this.inFlightTurnId = null;
          this.isBusy = false;
          this.sentenceStreamer?.reset();
          this.currentTurnId = null;
          console.log(`[BACKEND >> CANCELLED] turn: ${meta?.turn_id || "N/A"}`);
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
          this.inFlightTurnId = null;
          this.isBusy = false;
          this.sentenceStreamer?.reset();
          this.currentTurnId = null;

          const errMessage = typeof data === "string" ? data : "Backend error";
          console.log(`[BACKEND >> ERROR] "${errMessage}"`, metadata);
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

        case "ping_silence": {
          // Backend inactivity nudge after 8s silence
          const silenceMsg = typeof data === "string" ? data : "Still there? Say something or tap a button.";
          console.log(`[BACKEND >> SILENCE PING] "${silenceMsg}"`);
          this.emit("ping_silence", silenceMsg);
          break;
        }

        case "auto_reset": {
          // Backend auto-reset after 2 silence strikes (16s idle)
          const resetMsg = typeof data === "string" ? data : "Resetting for the next customer...";
          console.log(`[BACKEND >> AUTO RESET] "${resetMsg}"`);
          this.emit("auto_reset", resetMsg);
          break;
        }

        default:
          console.log(`[BACKEND >> FRAME] [${type || "unknown"}]`, payload);
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
    const prevTurn = this.inFlightTurnId || (this.isBusy ? this.currentTurnId : null);
    if (prevTurn) {
      console.log(`[KioskWS] Preempting previous turn ${prevTurn} for new query`);
      this._markStale(prevTurn);
      this.cancel(prevTurn);
      await new Promise((r) => setTimeout(r, 40));
    }

    const turnId = this.generateTurnId();
    this.isBusy = true;
    this.currentTurnId = turnId;
    this.inFlightTurnId = turnId;
    this.sentenceStreamer?.reset();
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
        message: String(message || ""),
        turn_id: turnId,
      };

      console.log(`[FRONTEND >> BACKEND QUERY] "${frame.message}" (turn: ${turnId})`);
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
    const prevTurn = this.inFlightTurnId || (this.isBusy ? this.currentTurnId : null);
    if (prevTurn) {
      console.log(`[KioskWS] Preempting previous turn ${prevTurn} for action ${action}`);
      this._markStale(prevTurn);
      this.cancel(prevTurn);
      await new Promise((r) => setTimeout(r, 40));
    }

    const turnId = options.turnId || this.generateTurnId();
    this.isBusy = true;
    this.currentTurnId = turnId;
    this.inFlightTurnId = turnId;
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
      const frame = this.buildActionFrame(action, payload, turnId);

      console.log(`[FRONTEND >> BACKEND ACTION] ${action} (turn: ${turnId})`, frame);
      this.ws.send(JSON.stringify(frame));
    });
  }

  // ── Construct Validated Pydantic-Compliant Action Frame (Section 4.4 Helper) ──
  buildActionFrame(action, payload = {}, turnId = null) {
    const tid = turnId || this.generateTurnId();
    const frame = {
      v: 2,
      action,
      turn_id: tid,
    };

    switch (action) {
      case "SET_NAME":
        frame.name = String(payload.name || payload.customer_name || "").trim();
        break;
      case "SELECT_CATEGORY":
        if (payload.category_id || payload.categoryId) {
          frame.category_id = String(payload.category_id || payload.categoryId).trim().toLowerCase();
        }
        if (payload.category_name || payload.categoryName) {
          frame.category_name = String(payload.category_name || payload.categoryName).trim();
        }
        break;
      case "SELECT_PRODUCT":
        if (payload.product_name || payload.name) {
          frame.product_name = String(payload.product_name || payload.name).trim();
        }
        if (payload.sku || payload.id) {
          frame.sku = String(payload.sku || payload.id).trim();
        }
        break;
      case "SPEECH_DONE":
        if (payload.speech_id) {
          frame.speech_id = String(payload.speech_id).trim();
        }
        break;
      case "SKIP_NAME":
      case "SHOW_ALL":
      case "NAVIGATE_BACK":
      case "RESTART":
        break;
    }
    return frame;
  }

  // ── Send SPEECH_DONE Acknowledgement Frame (Crucial for Sales Stage Transition) ──
  flushSpeechDone(speechId = null) {
    const sid = speechId || this.pendingSpeechId || this.currentSpeechId;
    if (!sid) return;

    if (this.speechDoneTimer) {
      clearTimeout(this.speechDoneTimer);
      this.speechDoneTimer = null;
    }
    this.pendingSpeechId = null;
    this.currentSpeechId = null;

    // Check if already acknowledged to prevent redundant frame
    if (KioskStepCache.isSpeechAcked(sid)) {
      console.log(`[KioskWS] speech_id ${sid} already acknowledged. Skipping redundant frame.`);
      return;
    }
    KioskStepCache.markSpeechDone(sid);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const turnId = this.generateTurnId();
      const ackFrame = {
        v: 2,
        action: "SPEECH_DONE",
        speech_id: sid,
        turn_id: turnId,
      };
      console.log(`[FRONTEND >> BACKEND ACK] SPEECH_DONE (speech_id: ${sid}):`, ackFrame);
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

  _markStale(turnId) {
    if (!turnId) return;
    this.staleTurns.add(turnId);
    if (this.staleTurns.size > 50) {
      this.staleTurns.delete(this.staleTurns.values().next().value);
    }
  }

  // Every user-initiated frame (tap / typed message) goes through here
  _dispatchUserFrame(frame, turnId, label) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[KioskWS] WebSocket not open when sending ${label}:`, frame);
      return;
    }
    const previous = this.inFlightTurnId;
    let delayMs = 0;
    if (previous && previous !== turnId) {
      console.log(`[KioskWS] Cancelling stale turn ${previous} for new ${label} (turn ${turnId})`);
      this._markStale(previous);
      this.cancel(previous);
      delayMs = 40; // same small gap your sendQuery uses so the backend lock is released
    }
    this.inFlightTurnId = turnId;
    this.currentTurnId = turnId;
    this.sentenceStreamer?.reset();
    this.currentResponse = "";
    this.lastAction = null;

    const send = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log(`[KioskWS] Sending ${label} frame:`, frame);
        this.ws.send(JSON.stringify(frame));
      }
    };
    delayMs ? setTimeout(send, delayMs) : send();
  }

  // ── Standard Protocol v2 Sending API ──
  sendWsMessage(text) {
    const turnId = this.generateTurnId();
    const frame = { message: String(text || ""), turn_id: turnId };
    this._dispatchUserFrame(frame, turnId, "message");
    return turnId;
  }

  sendWsAction(actionPayload = {}) {
    const action = actionPayload?.action;
    const turnId = actionPayload?.turn_id || this.generateTurnId();
    const frame = this.buildActionFrame(action, actionPayload, turnId);
    this._dispatchUserFrame(frame, turnId, "action");
    return turnId;
  }

  // Section 4 convenience methods
  sendSetName(name) {
    KioskStepCache.setCustomerName(name);
    return this.sendWsAction({
      action: "SET_NAME",
      name: String(name || "").trim(),
    });
  }

  sendSkipName() {
    KioskStepCache.setCurrentStep(KIOSK_STEPS.NAME_SET);
    return this.sendWsAction({
      action: "SKIP_NAME",
    });
  }

  sendSelectCategory(category) {
    const payload = { action: "SELECT_CATEGORY" };
    if (typeof category === "string") {
      payload.category_id = category.trim().toLowerCase();
    } else if (category) {
      if (category.category_id || category.id) {
        payload.category_id = String(category.category_id || category.id).trim().toLowerCase();
      }
      if (category.category_name || category.name || category.label) {
        payload.category_name = String(category.category_name || category.name || category.label).trim();
      }
    }
    return this.sendWsAction(payload);
  }

  sendSelectProduct(product) {
    const payload = { action: "SELECT_PRODUCT" };
    if (typeof product === "string") {
      payload.product_name = product.trim();
    } else if (product) {
      if (product.name) payload.product_name = String(product.name).trim();
      if (product.sku) payload.sku = String(product.sku).trim();
      else if (product.id && !product.name) payload.sku = String(product.id).trim();
    }
    KioskStepCache.setSelectedProduct(product);
    return this.sendWsAction(payload);
  }

  sendButtonClick(button) {
    if (!button) return;
    if (typeof button === "string") {
      return this.sendWsMessage(button);
    }
    if (button.action) {
      return this.sendWsAction({ action: button.action, ...button });
    }
    if (button.id === "skip_name") {
      return this.sendSkipName();
    }
    const val = button.id || button.label || button.name || "";
    return this.sendWsMessage(val);
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

export default kioskWS;
