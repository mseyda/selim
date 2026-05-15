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
    // ── TMNT 1987 cartoon theme (approximate) ─────────────────────────
    const BPM = 164;
    const b = 60 / BPM;
    const h = b / 2;
    const q = b / 4;

    const E3=165, B2=123,
          B4=494, C5=523, D5=587, E5=659, G5=784, A5=880;

    // 4 staccato power-chord stabs + pause
    const STABS = [
      [E5,h*0.45],[0,h*0.55], [E5,h*0.45],[0,h*0.55],
      [E5,h*0.45],[0,h*0.55], [E5,h*0.45],[0,h*1.55],
    ];

    // "Teenage Mutant Ninja Turtles" — rise then fall
    const TMNT_PH = [
      [E5,h],[G5,h],
      [A5,b],
      [G5,h],[E5,h],
      [D5,h],[C5,h],
      [B4,b*2],
      [0,b],
    ];

    // "Heroes in a half-shell"
    const HEROES = [
      [G5,h],[G5,q],[A5,q],
      [G5,h],[E5,b],
      [D5,h],[C5,h+b],
      [0,h],
    ];

    // "Turtle power!"
    const POWER = [
      [E5,q],[G5,q],[A5,h],
      [G5,q],[E5,q],[C5,b+h],
      [0,h],
    ];

    const M = [...STABS, ...TMNT_PH, ...TMNT_PH, ...TMNT_PH, ...HEROES, ...POWER];
    const totalBeats = M.reduce((s,[,d]) => s + d, 0);

    // Melody (square wave)
    let mt = 0;
    M.forEach(([f, d]) => {
      if (f > 0) this._tone({ freq:f, dur:d*0.72, type:'square', vol:0.2, when:mt, bus:this.musicBus });
      mt += d;
    });

    // Bass: driving E power chord, one per beat
    for (let bt = 0; bt < totalBeats; bt += b) {
      this._tone({ freq:E3,      dur:b*0.82, type:'sawtooth', vol:0.26, when:bt, bus:this.musicBus });
      this._tone({ freq:E3*1.5,  dur:b*0.82, type:'sawtooth', vol:0.1,  when:bt, bus:this.musicBus });
    }

    // Hi-hat (every half-beat)
    for (let i = 0; i*h < totalBeats; i++) {
      this._tone({ freq:4200+(i%2)*1800, dur:0.038, type:'square', vol:0.042, when:i*h, bus:this.musicBus });
    }

    // Snare accent on beats 2 & 4
    for (let i = 1; i*b < totalBeats; i += 2) {
      this._tone({ freq:200, dur:0.09, type:'sawtooth', vol:0.1, when:i*b, bus:this.musicBus });
    }

    this.musicTimer = setTimeout(() => this._loop(), totalBeats * 1000 - 80);
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
