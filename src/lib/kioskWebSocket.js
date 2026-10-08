// kioskWebSocket.js — Real-time WebSocket connection to Greenie AI (wss://kioskai.greenfibre.org/ws/chat)

const WS_URL = "wss://kioskai.greenfibre.org/ws/chat";

class KioskWebSocketClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.pendingResolvers = [];
    this.currentResponse = "";
    this.reconnectTimer = null;
    this.onTokenCallback = null;
  }

  connect() {
    if (typeof window === "undefined") return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        this.connected = true;
        clearTimeout(this.reconnectTimer);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.type === "token") {
            this.currentResponse += payload.data || "";
            if (this.onTokenCallback) {
              this.onTokenCallback(payload.data, this.currentResponse);
            }
          } else if (payload.type === "done") {
            const finalReply = payload.data || this.currentResponse;
            const resolver = this.pendingResolvers.shift();
            if (resolver) {
              resolver.resolve(finalReply);
            }
            this.currentResponse = "";
          }
        } catch (e) {
          console.warn("WebSocket parse error:", e);
        }
      };

      this.ws.onerror = (err) => {
        console.warn("Kiosk WebSocket notice:", err);
      };

      this.ws.onclose = () => {
        this.connected = false;
        while (this.pendingResolvers.length > 0) {
          const resolver = this.pendingResolvers.shift();
          resolver.reject(new Error("WebSocket closed"));
        }
        this.currentResponse = "";

        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.connect();
        }, 2000);
      };
    } catch (e) {
      console.warn("WebSocket init error:", e);
    }
  }

  async sendQuery(message, sessionId = "kiosk-session", onToken = null) {
    this.onTokenCallback = onToken;
    this.currentResponse = "";

    // Ensure connection is open
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
      await new Promise((res) => {
        let attempts = 0;
        const check = setInterval(() => {
          attempts++;
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            clearInterval(check);
            res(true);
          } else if (attempts > 30) {
            clearInterval(check);
            res(false);
          }
        }, 100);
      });
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Unable to establish WebSocket connection to AI backend");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.pendingResolvers.findIndex((r) => r.resolve === resolve);
        if (idx !== -1) {
          this.pendingResolvers.splice(idx, 1);
        }
        reject(new Error("WebSocket response timeout"));
      }, 12000);

      this.pendingResolvers.push({
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.ws.send(
        JSON.stringify({
          message: String(message || ""),
          session_id: sessionId || undefined,
        })
      );
    });
  }
}

export const kioskWS = new KioskWebSocketClient();
if (typeof window !== "undefined") {
  kioskWS.connect();
}
