class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(320); // 20 ms at 16 kHz
    this.n = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.sumSq += s * s;
      if (this.n === this.buf.length) {
        const rms = Math.sqrt(this.sumSq / this.n);
        const out = this.buf.slice().buffer;
        this.port.postMessage({ pcm: out, rms }, [out]);
        this.n = 0;
        this.sumSq = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
