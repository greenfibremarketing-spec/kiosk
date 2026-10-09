// src/lib/lipSync.js
let ctx = null,
  analyser = null,
  delay = null,
  timeBuf = null,
  freqBuf = null;

const LEAD_S = 0.07; // sound is delayed 70 ms, mouth reads it live
const S = { open: 0, wide: 0, round: 0, hiss: 0, emph: 0, peak: 0.06, prevLevel: 0 };

export function attachLipSync(audioEl) {
  if (typeof window === "undefined" || !audioEl) return () => {};
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return () => {};
    ctx ??= new AC();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      timeBuf = new Uint8Array(analyser.fftSize);
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
      delay = ctx.createDelay(0.5);
      delay.delayTime.value = LEAD_S;
      delay.connect(ctx.destination); // what you hear (delayed)
    }

    const src = ctx.createMediaElementSource(audioEl);
    src.connect(analyser); // what the mouth reads (live)
    src.connect(delay);
    S.peak = 0.06;
    return () => {
      try {
        src.disconnect();
      } catch (_) {}
    };
  } catch (err) {
    console.warn("[LipSync] attachLipSync error:", err?.message);
    return () => {};
  }
}

const band = (f1, f2) => {
  if (!analyser || !ctx || !freqBuf) return 0;
  const hz = ctx.sampleRate / analyser.fftSize;
  const a = Math.max(1, Math.floor(f1 / hz)),
    b = Math.min(freqBuf.length - 1, Math.ceil(f2 / hz));
  if (b < a) return 0;
  let s = 0;
  for (let i = a; i <= b; i++) s += freqBuf[i];
  return s / ((b - a + 1) * 255);
};

const ease = (cur, tgt, attack, release, dt) => {
  const k = 1 - Math.pow(Math.max(0, 1 - (tgt > cur ? attack : release)), dt * 60);
  return cur + (tgt - cur) * k;
};

// call every frame. dt = seconds since last frame
export function getMouth(isSpeaking, dt = 1 / 60) {
  let tOpen = 0,
    tWide = 0,
    tRound = 0,
    tHiss = 0,
    level = 0;

  if (analyser && isSpeaking && timeBuf && freqBuf) {
    analyser.getByteTimeDomainData(timeBuf);
    analyser.getByteFrequencyData(freqBuf);

    let sum = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const v = (timeBuf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / timeBuf.length);

    S.peak = Math.max(rms, S.peak * Math.pow(0.995, dt * 60), 0.05);
    level = rms / S.peak;

    if (level > 0.15) {
      const low = band(250, 900);
      const mid = band(900, 2800);
      const high = band(3500, 8000);
      const tot = low + mid + high + 1e-4;

      const hiss = high / tot;
      tOpen = Math.pow(Math.min(1, level), 0.9) * (1 - hiss * 0.7);
      tWide = Math.min(1, (mid / tot) * 1.8);
      tRound =
        Math.min(1, Math.max(0, (low - mid) / (low + mid + 1e-4)) * 1.5) *
        (1 - tWide);
      tHiss = hiss;
    }
  }

  S.open = ease(S.open, tOpen, 0.55, 0.2, dt);
  S.wide = ease(S.wide, tWide, 0.25, 0.15, dt);
  S.round = ease(S.round, tRound, 0.25, 0.15, dt);
  S.hiss = ease(S.hiss, tHiss, 0.3, 0.2, dt);

  const rise = Math.max(0, level - S.prevLevel);
  S.prevLevel = level;
  S.emph = ease(S.emph, Math.min(1, rise * 3), 0.6, 0.06, dt);

  return { open: S.open, wide: S.wide, round: S.round, hiss: S.hiss, emph: S.emph, level };
}

export function resetLipSync() {
  S.open = 0;
  S.wide = 0;
  S.round = 0;
  S.hiss = 0;
  S.emph = 0;
  S.peak = 0.06;
  S.prevLevel = 0;
}
