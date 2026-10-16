// src/lib/debugTrace.js
// Ring buffer of last 300 diagnostic trace events for Kiosk debugging

const MAX_BUFFER = 300;
const buffer = [];

export function trace(tag, data) {
  const entry = {
    time: new Date().toISOString(),
    tag,
    data,
  };

  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) {
    buffer.shift();
  }

  try {
    console.log(`[TRACE] ${tag}`, data);
  } catch (_) {}
}

export function dumpTrace() {
  const json = JSON.stringify(buffer, null, 2);
  console.log(json);
  return json;
}

export function getTraceBuffer() {
  return buffer;
}

if (typeof window !== "undefined") {
  window.dumpTrace = () => {
    const json = JSON.stringify(buffer);
    console.log(json);
    return json;
  };
  window.__kioskTrace = trace;
  window.__kioskTraceBuffer = buffer;

  // Global unhandled error & rejection tracing (Requirement 4d)
  window.addEventListener("error", (e) => {
    trace("error", {
      message: e.message || String(e),
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack || null,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    trace("unhandledrejection", {
      message: e.reason?.message || String(e.reason),
      stack: e.reason?.stack || null,
    });
  });

  // RequestAnimationFrame FPS Meter (Requirement 4b: every 5 seconds)
  let frameCount = 0;
  let lastFpsCheck = performance.now();
  let longestFrameMs = 0;
  let lastRafTime = performance.now();

  function rafLoop(now) {
    frameCount += 1;
    const delta = now - lastRafTime;
    lastRafTime = now;
    if (delta > longestFrameMs) {
      longestFrameMs = delta;
    }

    const elapsed = now - lastFpsCheck;
    if (elapsed >= 5000) {
      const fps = Math.round((frameCount * 1000) / elapsed);
      trace("fps", {
        fps,
        longestFrameMs: Math.round(longestFrameMs),
      });
      frameCount = 0;
      longestFrameMs = 0;
      lastFpsCheck = now;
    }

    requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);

  // JS Heap Memory Tracker (Requirement 4c: every 30 seconds if performance.memory exists)
  if (typeof performance !== "undefined" && performance.memory) {
    setInterval(() => {
      try {
        if (performance.memory) {
          const usedJSHeapMB = Number((performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2));
          const totalJSHeapMB = Number((performance.memory.totalJSHeapSize / (1024 * 1024)).toFixed(2));
          trace("memory", { usedJSHeapMB, totalJSHeapMB });
        }
      } catch (_) {}
    }, 30000);
  }
}
