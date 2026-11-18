/**
 * All sound is synthesised in the browser with the Web Audio API: there are no
 * audio files, so every note of the music and every effect is original.
 * Each track has its own style (tempo, scale, drum and bass patterns, voices);
 * the music changes with the race: lobby, countdown, racing, final lap, results,
 * and it is muffled under water.
 */
import type { Settings } from "./store";

type Wave = OscillatorType;
export type MusicState = "off" | "lobby" | "countdown" | "race" | "final" | "results";

interface Style {
  tempo: number;
  root: number;
  scale: number[];
  chords: number[];
  /** 16-step patterns: 1 = hit. */
  kick: string;
  snare: string;
  hat: string;
  bass: string;
  bassWave: Wave;
  leadWave: Wave;
  /** How busy the lead is, 0..1, and which octave it sits in. */
  density: number;
  leadOct: number;
  toms?: string;
  pad: boolean;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const PENTA = [0, 3, 5, 7, 10];
const PHRYG = [0, 1, 3, 5, 7, 8, 10];

/** One style per track (by its `music` number), plus a ninth for the lobby. */
const STYLES: Style[] = [
  { tempo: 112, root: 40, scale: DORIAN, chords: [0, 3, 4, 0], kick: "1000001010000010", snare: "0000100000001000", hat: "1010101010101011", bass: "1001001000101001", bassWave: "square", leadWave: "square", density: 0.5, leadOct: 2, pad: false },
  { tempo: 96, root: 38, scale: MINOR, chords: [0, 5, 3, 4], kick: "1000000010010000", snare: "0000100000001000", hat: "0010001000100010", bass: "1000001010000010", bassWave: "sawtooth", leadWave: "sawtooth", density: 0.35, leadOct: 1, toms: "1001001010010011", pad: true },
  { tempo: 100, root: 43, scale: LYDIAN, chords: [0, 4, 1, 3], kick: "1000000010000000", snare: "0000000000001000", hat: "0010001000100010", bass: "1000000010001000", bassWave: "triangle", leadWave: "triangle", density: 0.6, leadOct: 2, pad: true },
  { tempo: 128, root: 41, scale: MAJOR, chords: [0, 4, 5, 3], kick: "1000100010001000", snare: "0000100000001000", hat: "0010001000100010", bass: "0010001000100010", bassWave: "sawtooth", leadWave: "sawtooth", density: 0.85, leadOct: 2, pad: true },
  { tempo: 138, root: 38, scale: MINOR, chords: [0, 5, 2, 4], kick: "1000001010000010", snare: "0000100000001000", hat: "1111111111111111", bass: "1010101010101010", bassWave: "sawtooth", leadWave: "sawtooth", density: 0.9, leadOct: 2, pad: false },
  { tempo: 104, root: 41, scale: PENTA, chords: [0, 2, 3, 1], kick: "1000000010100000", snare: "0000000000001000", hat: "0000000000000000", bass: "1000100000101000", bassWave: "triangle", leadWave: "sine", density: 0.65, leadOct: 2, toms: "1011010110110101", pad: false },
  { tempo: 108, root: 36, scale: MINOR, chords: [0, 5, 3, 6], kick: "1000100010001000", snare: "0000100000001000", hat: "0010001000100010", bass: "1111111111111111", bassWave: "sawtooth", leadWave: "square", density: 0.45, leadOct: 2, pad: true },
  { tempo: 150, root: 37, scale: PHRYG, chords: [0, 1, 5, 4], kick: "1010001010100010", snare: "0000100000001010", hat: "1011101110111011", bass: "1011011010110110", bassWave: "sawtooth", leadWave: "square", density: 0.95, leadOct: 2, toms: "0000000100000011", pad: false },
  { tempo: 96, root: 43, scale: MAJOR, chords: [0, 3, 4, 3], kick: "1000000010000000", snare: "0000100000001000", hat: "0010001000100010", bass: "1000001000100000", bassWave: "triangle", leadWave: "triangle", density: 0.4, leadOct: 2, pad: true },
];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private settings: Settings | null = null;

  private state: MusicState = "off";
  private style = STYLES[8];
  private styleIndex = 8;
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private seed = 1;

  /** Browsers only allow sound after a click or key press; call this from one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = (this.ctx = new Ctor());
    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    this.master.connect(limiter).connect(ctx.destination);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = "lowpass";
    this.musicFilter.frequency.value = 18000;
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicFilter).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Engine: two oscillators through a filter, pitched by speed.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 700;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = "square";
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.sfxBus);
    this.engineOsc.start();
    this.engineSub.start();
    // Tyre squeal: filtered noise, faded in while drifting.
    const skid = ctx.createBufferSource();
    skid.buffer = this.noise;
    skid.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2600;
    band.Q.value = 6;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    skid.connect(band).connect(this.skidGain).connect(this.sfxBus);
    skid.start();

    if (this.settings) this.applySettings(this.settings);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx) return;
    this.master.gain.value = s.master;
    this.musicBus.gain.value = s.music * 0.5;
    this.sfxBus.gain.value = s.sfx;
  }

  // ------------------------------------------------------------------ music

  setMusic(state: MusicState, styleIndex = 8): void {
    const idx = state === "lobby" || state === "results" ? 8 : styleIndex;
    if (state === this.state && idx === this.styleIndex) return;
    const restart = idx !== this.styleIndex || this.state === "off" || state === "results" || this.state === "results";
    this.state = state;
    this.styleIndex = idx;
    this.style = STYLES[idx] ?? STYLES[8];
    if (restart && this.ctx) {
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.08;
    }
  }

  setUnderwater(on: boolean): void {
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(on ? 520 : 18000, this.ctx.currentTime, 0.15);
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private note(t: number, midi: number, dur: number, wave: Wave, gain: number, cutoff = 4000, bus = this.musicBus): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = hz(midi);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private drum(t: number, kind: "kick" | "snare" | "hat" | "tom", gain: number, pitch = 0): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.musicBus);
    if (kind === "kick" || kind === "tom") {
      const o = ctx.createOscillator();
      const base = kind === "kick" ? 150 : 110 + pitch * 40;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(kind === "kick" ? 42 : base * 0.55, t + 0.14);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "kick" ? 0.22 : 0.18));
      o.connect(g);
      o.start(t);
      o.stop(t + 0.25);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === "hat" ? "highpass" : "bandpass";
    f.frequency.value = kind === "hat" ? 7500 : 1900;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "hat" ? 0.045 : 0.16));
    src.connect(f).connect(g);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.2);
  }

  private degree(chord: number, n: number, octave: number, lift: number): number {
    const sc = this.style.scale;
    const i = chord + n;
    return this.style.root + lift + 12 * octave + sc[((i % sc.length) + sc.length) % sc.length] + 12 * Math.floor(i / sc.length);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.state === "off") return;
    const s = this.style;
    const final = this.state === "final";
    const calm = this.state === "lobby" || this.state === "results";
    const tense = this.state === "countdown";
    const stepLen = 60 / (s.tempo * (final ? 1.12 : 1)) / 4;
    const lift = final ? 2 : 0;
    while (this.nextTime < ctx.currentTime + 0.14) {
      const t = this.nextTime;
      const i = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const chord = s.chords[bar % s.chords.length];
      // The lead line is generated from the bar number, so it repeats musically instead of wandering.
      this.seed = (bar % 4) * 7919 + i * 104729 + this.styleIndex * 31 + 1;
      const r = this.rand();
      if (tense) {
        if (i % 4 === 0) this.drum(t, "tom", 0.5, (this.step / 4) % 3);
        if (i === 0) this.note(t, this.degree(0, 0, 0, 0), stepLen * 12, "sawtooth", 0.12, 500);
      } else {
        if (s.kick[i] === "1" && !calm) this.drum(t, "kick", 0.85);
        if (s.kick[i] === "1" && calm && i === 0) this.drum(t, "kick", 0.4);
        if (s.snare[i] === "1") this.drum(t, "snare", calm ? 0.15 : 0.38);
        if (s.hat[i] === "1" || (final && i % 2 === 1)) this.drum(t, "hat", calm ? 0.07 : 0.16);
        if (s.toms && s.toms[i] === "1" && !calm) this.drum(t, "tom", 0.4, (i * 7) % 3);
        if (s.bass[i] === "1") this.note(t, this.degree(chord, 0, 0, lift), stepLen * 1.7, s.bassWave, calm ? 0.16 : 0.26, calm ? 500 : 900);
        if (r < s.density * (calm ? 0.5 : 1)) {
          const tone = [0, 2, 4, 7, 4, 2, 9, 7][Math.floor(this.rand() * 8)];
          this.note(t, this.degree(chord, tone, s.leadOct, lift), stepLen * (this.rand() < 0.3 ? 3 : 1.4), s.leadWave, calm ? 0.07 : 0.1, final ? 5200 : 3200);
        }
        if (s.pad && i === 0) for (const n of [0, 2, 4]) this.note(t, this.degree(chord, n, 1, lift), stepLen * 15.5, "sawtooth", 0.035, 1100);
      }
      this.step++;
      this.nextTime += stepLen;
    }
  }

  // ---------------------------------------------------------------- effects

  /** Call every frame or so with the local kart's state. */
  engine(speed: number, active: boolean, boosting: boolean, drifting: boolean, underwater: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineOsc || !this.engineSub) return;
    const t = ctx.currentTime;
    const v = Math.min(1.4, Math.abs(speed) / 30);
    // Revs climb through each gear and fall back on the change, matching the dashboard.
    const kmh = Math.abs(speed) * 3.6;
    const gear = Math.min(6, 1 + Math.floor(kmh / 38));
    const rev = gear >= 6 ? Math.min(1.15, 0.25 + ((kmh - 190) / 38) * 0.75) : 0.25 + ((kmh % 38) / 38) * 0.75;
    const f = 62 + rev * 128 + gear * 5 + (boosting ? 30 : 0);
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.05);
    this.engineSub.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(underwater ? 260 : 500 + v * 1500, t, 0.08);
    this.engineGain.gain.setTargetAtTime(active ? 0.05 + v * 0.05 : 0, t, 0.08);
    this.skidGain.gain.setTargetAtTime(active && drifting && !underwater ? 0.06 : 0, t, 0.05);
  }

  private sweep(from: number, to: number, dur: number, wave: Wave, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, gain: number, type: BiquadFilterType = "bandpass"): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.3), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }

  private chime(notes: number[], gap: number, wave: Wave = "triangle", gain = 0.2): void {
    if (!this.ctx) return;
    notes.forEach((n, i) => this.note(this.ctx!.currentTime + i * gap, n, 0.28, wave, gain, 5000, this.sfxBus));
  }

  play(kind: string, volume = 1): void {
    if (!this.ctx) return;
    switch (kind) {
      case "beep":
        this.sweep(660, 660, 0.16, "square", 0.16 * volume);
        break;
      case "go":
        this.sweep(1320, 1320, 0.5, "square", 0.2 * volume);
        break;
      case "boost":
        this.burst(0.5, 900, 0.3 * volume, "highpass");
        this.sweep(180, 720, 0.4, "sawtooth", 0.12 * volume);
        break;
      case "trick":
        this.chime([784, 1047, 1319], 0.055, "square", 0.11 * volume);
        break;
      case "rocket":
        this.burst(0.7, 700, 0.34 * volume, "highpass");
        this.sweep(140, 980, 0.55, "sawtooth", 0.15 * volume);
        break;
      case "draft":
        this.burst(0.45, 1400, 0.24 * volume, "highpass");
        this.sweep(420, 1100, 0.3, "triangle", 0.12 * volume);
        break;
      case "jump":
        this.sweep(300, 760, 0.22, "triangle", 0.16 * volume);
        break;
      case "land":
        this.sweep(140, 45, 0.2, "sine", 0.5 * volume);
        this.burst(0.14, 500, 0.2 * volume, "lowpass");
        break;
      case "hit":
        this.burst(0.3, 1400, 0.5 * volume);
        this.sweep(420, 70, 0.4, "sawtooth", 0.2 * volume);
        break;
      case "pickup":
        this.chime([84, 88, 91, 96], 0.05, "square", 0.12 * volume);
        break;
      case "item":
        this.sweep(500, 1500, 0.2, "square", 0.13 * volume);
        this.burst(0.2, 3000, 0.14 * volume, "highpass");
        break;
      case "impact":
        this.burst(0.6, 300, 0.6 * volume, "lowpass");
        this.sweep(110, 30, 0.6, "sine", 0.6 * volume);
        break;
      case "lap":
        this.chime([79, 84], 0.09, "triangle", 0.2 * volume);
        break;
      case "final":
        this.chime([79, 79, 84, 88], 0.11, "square", 0.16 * volume);
        break;
      case "overtake":
        this.chime([88, 93], 0.06, "triangle", 0.11 * volume);
        break;
      case "finish":
        this.chime([72, 76, 79, 84, 88, 91], 0.1, "square", 0.17 * volume);
        break;
      case "win":
        this.chime([72, 76, 79, 84, 79, 84, 88, 96], 0.12, "sawtooth", 0.16 * volume);
        break;
      case "event":
        this.sweep(880, 440, 0.25, "sawtooth", 0.14 * volume);
        this.sweep(880, 440, 0.25, "sawtooth", 0.14 * volume, 0.3);
        break;
      case "bubbles":
        for (let i = 0; i < 4; i++) this.sweep(300 + Math.random() * 500, 900 + Math.random() * 600, 0.09, "sine", 0.08 * volume, i * 0.05);
        break;
      case "click":
        this.sweep(900, 600, 0.05, "square", 0.07 * volume);
        break;
    }
  }
}

export const audio = new AudioEngine();
