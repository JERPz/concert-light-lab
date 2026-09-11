/**
 * audio.js — optional microphone analyser.
 *
 * A YouTube iframe is cross-origin, so its audio can never be read by script.
 * The honest workaround for beat-reactive lighting is to listen to the room:
 * the user opts in, we analyse the mic, and the lights follow whatever is
 * coming out of their speakers. Nothing is recorded or transmitted.
 */

export class AudioReactor {
  constructor() {
    this.enabled = false;
    this.bands = { level: 0, bass: 0, mid: 0, high: 0 };
    this._ctx = null;
    this._analyser = null;
    this._data = null;
    this._stream = null;
  }

  async enable() {
    if (this.enabled) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser has no microphone API.");
    }

    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this._ctx = new Ctx();
    const src = this._ctx.createMediaStreamSource(this._stream);
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._analyser.smoothingTimeConstant = 0.72;
    src.connect(this._analyser);
    this._data = new Uint8Array(this._analyser.frequencyBinCount);

    this.enabled = true;
    return true;
  }

  disable() {
    this._stream?.getTracks().forEach((t) => t.stop());
    this._ctx?.close();
    this._ctx = this._analyser = this._data = this._stream = null;
    this.enabled = false;
    this.bands = { level: 0, bass: 0, mid: 0, high: 0 };
  }

  /** Average three frequency ranges into 0..1 values, lightly smoothed. */
  sample() {
    if (!this.enabled) return this.bands;
    this._analyser.getByteFrequencyData(this._data);

    const bins = this._data.length;
    const avg = (from, to) => {
      let sum = 0;
      const a = Math.floor(bins * from);
      const b = Math.floor(bins * to);
      for (let i = a; i < b; i++) sum += this._data[i];
      return sum / Math.max(1, b - a) / 255;
    };

    const bass = avg(0.0, 0.08);
    const mid = avg(0.08, 0.35);
    const high = avg(0.35, 0.8);

    // Gentle attack, slower release, so lights punch then settle.
    const ease = (cur, next) => (next > cur ? next : cur + (next - cur) * 0.18);
    this.bands.bass = ease(this.bands.bass, Math.min(1, bass * 1.5));
    this.bands.mid = ease(this.bands.mid, Math.min(1, mid * 1.8));
    this.bands.high = ease(this.bands.high, Math.min(1, high * 2.2));
    this.bands.level = (this.bands.bass + this.bands.mid + this.bands.high) / 3;
    return this.bands;
  }
}
