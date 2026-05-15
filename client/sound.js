// ── Game Audio (Web Audio API — no external files) ───────────────────────────
class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.musicPlaying = false;
    this.musicTimer = null;
    this.muted = false;
  }

  // ── Init (called on first user interaction) ──────────────────────────────
  _boot() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master   = this._gain(0.85);
    this.sfxBus   = this._gain(0.9, this.master);
    this.musicBus = this._gain(0.22, this.master);
    this.master.connect(this.ctx.destination);
  }

  _resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  _gain(val, dest = null) {
    const g = this.ctx.createGain();
    g.gain.value = val;
    if (dest) g.connect(dest);
    return g;
  }

  // ── Low-level tone builder ───────────────────────────────────────────────
  _tone({ freq = 440, dur = 0.2, type = 'square', vol = 0.3, when = 0,
          slide = null, bus = null }) {
    this._boot(); this._resume();
    if (this.muted) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g   = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(bus ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // ── SFX ─────────────────────────────────────────────────────────────────
  pizza() {
    this._tone({ freq: 440, dur: 0.08, vol: 0.4 });
    this._tone({ freq: 660, dur: 0.12, vol: 0.28, when: 0.07 });
  }

  goldPizza() {
    [440, 554, 659, 880].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.14, type: 'square', vol: 0.32, when: i * 0.065 }));
  }

  powerup(type) {
    if (type === 'speed') {
      this._tone({ freq: 300, dur: 0.35, type: 'sawtooth', vol: 0.3, slide: 900 });
    } else if (type === 'slow') {
      this._tone({ freq: 600, dur: 0.35, type: 'sawtooth', vol: 0.28, slide: 150 });
    } else {
      // shield — shimmery arpeggio
      [523, 659, 784, 1047].forEach((f, i) =>
        this._tone({ freq: f, dur: 0.18, type: 'sine', vol: 0.3, when: i * 0.07 }));
    }
  }

  hit() {
    this._tone({ freq: 220, dur: 0.28, type: 'sawtooth', vol: 0.5, slide: 55 });
  }

  gameStart() {
    [262, 330, 392, 523].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.22, type: 'square', vol: 0.32, when: i * 0.13 }));
  }

  countdown() {
    this._tone({ freq: 880, dur: 0.06, type: 'square', vol: 0.25 });
  }

  win() {
    const m = [523,659,784,659,784,1047];
    const d = [0.18,0.18,0.18,0.1,0.1,0.5];
    let t = 0;
    m.forEach((f, i) => { this._tone({ freq: f, dur: d[i], type: 'square', vol: 0.32, when: t }); t += d[i] + 0.02; });
  }

  lose() {
    [392, 349, 311, 262].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.32, type: 'sawtooth', vol: 0.25, when: i * 0.2 }));
  }

  // ── Background Music ─────────────────────────────────────────────────────
  // 8-bit style upbeat loop, no external files
  startMusic() {
    if (this.musicPlaying) return;
    this._boot(); this._resume();
    this.musicPlaying = true;
    this._loop();
  }

  stopMusic() {
    this.musicPlaying = false;
    clearTimeout(this.musicTimer);
    // Fade out
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(0.001, this.ctx.currentTime, 0.4);
      setTimeout(() => { if (this.musicBus) this.musicBus.gain.value = 0.22; }, 1500);
    }
  }

  _loop() {
    if (!this.musicPlaying || this.muted) return;
    const BPM = 156;
    const b = 60 / BPM;         // one beat in seconds
    const h = b / 2;            // half beat

    // ── Melody (square wave) ───────────────────────────────────────────
    // Pattern: fun, pizza-game energy, 8 bars of 4/4
    const M = [
      // Bar 1-2
      [523,h],[659,h],[784,h],[659,h],  [523,h],[440,h],[392,b],
      // Bar 3-4
      [440,h],[523,h],[659,h],[523,h],  [440,h],[392,h],[349,b],
      // Bar 5-6
      [523,h],[659,h],[784,h],[880,h],  [784,h],[659,h],[523,b],
      // Bar 7-8
      [659,h],[523,h],[440,h],[392,h],  [330,b],[262,b],
    ];

    // ── Bass (triangle wave) ───────────────────────────────────────────
    const BAS = [
      [131,b],[131,b],[196,b],[196,b],
      [165,b],[165,b],[175,b],[175,b],
      [131,b],[131,b],[220,b],[220,b],
      [175,b],[175,b],[131,b*2],
    ];

    // ── Hi-hat (noise sim via high detuned square) ─────────────────────
    const HAT_BEAT = b / 2;
    const totalBeats = M.reduce((s,[,d])=>s+d,0);

    let mt = 0;
    M.forEach(([f, d]) => {
      this._tone({ freq: f, dur: d * 0.82, type: 'square', vol: 0.18, when: mt, bus: this.musicBus });
      mt += d;
    });

    let bt = 0;
    BAS.forEach(([f, d]) => {
      this._tone({ freq: f, dur: d * 0.65, type: 'triangle', vol: 0.28, when: bt, bus: this.musicBus });
      bt += d;
    });

    // Hi-hat pattern
    for (let i = 0; i < totalBeats / HAT_BEAT; i++) {
      this._tone({ freq: 4400 + (i % 2) * 800, dur: 0.04, type: 'square', vol: 0.04, when: i * HAT_BEAT, bus: this.musicBus });
    }

    const loopMs = totalBeats * 1000 - 80; // start next loop slightly early
    this.musicTimer = setTimeout(() => this._loop(), loopMs);
  }

  // ── Mute toggle ──────────────────────────────────────────────────────────
  toggleMute() {
    this._boot();
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.1);
    if (!this.muted && this.musicPlaying) {
      this.musicBus.gain.setTargetAtTime(0.22, this.ctx.currentTime, 0.2);
    }
    return this.muted;
  }
}

const audio = new GameAudio();
