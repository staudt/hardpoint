/**
 * Procedural sound effects built on the Web Audio API. No audio files: every sound is
 * synthesised from oscillators and a shared white-noise buffer. All calls are safe no-ops
 * when `AudioContext` is unavailable (node, tests) or the context has not been unlocked.
 */

export type SfxName =
  | 'laser_light' | 'laser_med' | 'laser_heavy' | 'pcannon' | 'mg' | 'ac_light' | 'ac_heavy'
  | 'missile_launch' | 'impact_small' | 'impact_large' | 'explosion' | 'ammo_explosion'
  | 'footstep_heavy' | 'footstep_medium' | 'heat_warning' | 'shutdown' | 'startup' | 'coolant'
  | 'lock_tone' | 'locked' | 'hit_taken' | 'ui_click';

export interface V3 { x: number; y: number; z: number }

export interface SfxOpts { volume?: number; pitch?: number; duration?: number }

const SILENT = 0.0001;
const MAX_VOICES = 48;
const NAME_CAP: Partial<Record<SfxName, number>> = { footstep_heavy: 4, footstep_medium: 4, mg: 8 };
const DEFAULT_CAP = 6;

interface ToneOpts { at?: number; attack?: number; sustain?: boolean; sweep?: number; rel?: number; detune?: number }
interface NoiseOpts { at?: number; attack?: number; q?: number }

/** One playing sound: a gain bus plus bookkeeping so every node is released when it ends. */
class Voice {
  readonly nodes: AudioNode[] = [];
  private pending = 0;
  private done = false;
  constructor(
    readonly ctx: AudioContext,
    readonly noiseBuf: AudioBuffer,
    readonly out: GainNode,
    readonly pitch: number,
    readonly onDone: (v: Voice) => void,
  ) {
    this.nodes.push(out);
  }

  private get t0(): number { return this.ctx.currentTime + 0.005; }

  /** Gain envelope: attack to `peak`, then either exponential decay or hold + release, ending at `dur`. */
  private env(at: number, dur: number, peak: number, attack: number, sustain: boolean, rel: number): GainNode {
    const g = this.ctx.createGain();
    const s = this.t0 + at;
    const a = Math.min(attack, dur * 0.5);
    g.gain.setValueAtTime(SILENT, s);
    g.gain.linearRampToValueAtTime(peak, s + a);
    if (sustain) g.gain.setValueAtTime(peak, s + Math.max(a, dur - rel));
    g.gain.exponentialRampToValueAtTime(SILENT, s + dur);
    g.connect(this.out);
    this.nodes.push(g);
    return g;
  }

  private track(src: AudioScheduledSourceNode, stopAt: number): void {
    this.nodes.push(src);
    this.pending++;
    src.onended = () => {
      if (--this.pending === 0) this.finish();
    };
    src.stop(stopAt + 0.03);
  }

  /** Oscillator sweeping f0 -> f1 (exponentially) over `sweep` seconds (default whole length). */
  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, o: ToneOpts = {}): void {
    if (this.done) return;
    const s = this.t0 + (o.at ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.detune.value = o.detune ?? 0;
    osc.frequency.setValueAtTime(f0 * this.pitch, s);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1 * this.pitch, s + (o.sweep ?? dur));
    osc.connect(this.env(o.at ?? 0, dur, vol, o.attack ?? 0.004, o.sustain ?? false, o.rel ?? 0.06));
    osc.start(s);
    this.track(osc, s + dur);
  }

  /** Filtered noise with the filter cutoff sweeping f0 -> f1 over the duration. */
  noise(type: BiquadFilterType, f0: number, f1: number, dur: number, vol: number, o: NoiseOpts = {}): void {
    if (this.done) return;
    const s = this.t0 + (o.at ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = this.pitch;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(f0 * this.pitch, s);
    f.frequency.exponentialRampToValueAtTime(f1 * this.pitch, s + dur);
    src.connect(f);
    f.connect(this.env(o.at ?? 0, dur, vol, o.attack ?? 0.002, false, 0));
    this.nodes.push(f);
    src.start(s, Math.random() * (this.noiseBuf.duration - 0.5));
    this.track(src, s + dur);
  }

  /** Fade out quickly and stop (used when voice limits drop the oldest sound). */
  kill(): void {
    if (this.done) return;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, 0.01);
    for (const n of this.nodes) {
      if (n instanceof AudioScheduledSourceNode) {
        try { n.stop(now + 0.06); } catch { /* already stopped */ }
      }
    }
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    for (const n of this.nodes) n.disconnect();
    this.onDone(this);
  }
}

type Recipe = (v: Voice, duration: number | undefined) => void;

/** Descending pew-zap that sustains as a buzzing tone for the beam length, then releases. */
function laser(f: number, defLen: number, vol: number): Recipe {
  return (v, d) => {
    const len = d ?? defLen;
    v.tone('sawtooth', f, f * 0.4, len, vol, { sweep: 0.16, sustain: true, rel: 0.08 });
    v.tone('square', f * 1.01, f * 0.4, len, vol * 0.45, { sweep: 0.18, sustain: true, rel: 0.08, detune: 14 });
    v.tone('square', f * 0.2, f * 0.2, len, vol * 0.3, { sustain: true, rel: 0.08, detune: -8 });
    v.noise('highpass', 5000, 3000, 0.05, vol * 0.5);
  };
}

function footstep(thud: number, vol: number, clank: number): Recipe {
  return (v) => {
    v.tone('sine', thud * 1.4, thud * 0.55, 0.35, vol, { sweep: 0.12 });
    v.noise('lowpass', 500, 100, 0.12, vol * 0.35);
    v.noise('bandpass', clank, clank * 0.6, 0.07, vol * 0.2, { at: 0.015, q: 5 });
  };
}

const RECIPES: Record<SfxName, Recipe> = {
  laser_light: laser(1500, 0.3, 0.16),
  laser_med: laser(950, 0.45, 0.2),
  laser_heavy: laser(520, 0.5, 0.25),
  pcannon: (v) => {
    v.noise('bandpass', 4000, 400, 0.35, 0.5, { q: 3 });
    v.noise('highpass', 3000, 6000, 0.18, 0.25, { at: 0.03 });
    v.tone('sine', 110, 35, 0.3, 0.6, { sweep: 0.2 });
  },
  mg: (v) => {
    v.noise('lowpass', 3500, 800, 0.05, 0.3);
    v.tone('square', 200, 90, 0.03, 0.08);
  },
  ac_light: (v) => {
    v.noise('lowpass', 2800, 300, 0.2, 0.6);
    v.tone('sine', 150, 50, 0.22, 0.7, { sweep: 0.15 });
  },
  ac_heavy: (v) => {
    v.noise('lowpass', 2000, 150, 0.6, 0.8);
    v.noise('lowpass', 400, 70, 1.0, 0.35, { at: 0.1 });
    v.tone('sine', 85, 26, 0.7, 0.95, { sweep: 0.5 });
  },
  missile_launch: (v) => {
    v.noise('bandpass', 300, 2600, 0.4, 0.5, { q: 2, attack: 0.08 });
    v.noise('lowpass', 900, 200, 0.3, 0.3);
  },
  impact_small: (v) => {
    v.noise('bandpass', 2200, 600, 0.12, 0.5, { q: 0.8 });
    v.tone('sine', 220, 80, 0.09, 0.3, { sweep: 0.08 });
  },
  impact_large: (v) => {
    v.noise('lowpass', 3500, 300, 0.28, 0.7);
    v.noise('bandpass', 1500, 500, 0.12, 0.3, { q: 0.8 });
    v.tone('sine', 95, 30, 0.45, 0.85, { sweep: 0.35 });
  },
  explosion: (v) => {
    v.noise('lowpass', 1400, 70, 1.5, 1, { attack: 0.01 });
    v.tone('sine', 95, 26, 1.2, 0.9, { sweep: 0.9 });
    v.noise('highpass', 2500, 1500, 0.3, 0.2, { at: 0.02 });
  },
  ammo_explosion: (v) => {
    v.noise('lowpass', 2200, 55, 2.5, 1, { attack: 0.01 });
    v.tone('sine', 80, 20, 2.2, 1, { sweep: 1.6 });
    v.noise('lowpass', 600, 50, 1.8, 0.5, { at: 0.2 });
    for (let i = 0; i < 12; i++) {
      v.noise('bandpass', 1500 + Math.random() * 3000, 800, 0.05 + Math.random() * 0.06, 0.3 + Math.random() * 0.3,
        { at: 0.1 + Math.random() * 1.6, q: 2 });
    }
  },
  footstep_heavy: footstep(48, 1, 1800),
  footstep_medium: footstep(66, 0.7, 2600),
  heat_warning: (v) => {
    v.tone('square', 880, 880, 0.13, 0.22, { sustain: true, rel: 0.03 });
    v.tone('square', 660, 660, 0.13, 0.22, { at: 0.16, sustain: true, rel: 0.03 });
  },
  shutdown: (v) => {
    v.tone('sawtooth', 700, 40, 1.2, 0.25);
    v.tone('sine', 300, 30, 1.2, 0.3);
    v.noise('lowpass', 800, 60, 0.5, 0.2);
  },
  startup: (v) => {
    v.tone('sawtooth', 60, 800, 1.1, 0.2, { sustain: true, rel: 0.25 });
    v.tone('sine', 120, 1200, 1.1, 0.2, { sustain: true, rel: 0.25 });
    v.tone('square', 900, 900, 0.06, 0.15, { at: 1.1 });
  },
  coolant: (v) => {
    v.noise('highpass', 3500, 6500, 1.0, 0.35, { attack: 0.12 });
    v.noise('bandpass', 6000, 3000, 0.6, 0.15, { q: 1.5 });
  },
  lock_tone: (v) => v.tone('sine', 1800, 1800, 0.07, 0.3, { sustain: true, rel: 0.02 }),
  locked: (v) => {
    v.tone('sine', 1400, 1400, 0.1, 0.3, { sustain: true, rel: 0.02 });
    v.tone('sine', 1400, 1400, 0.1, 0.3, { at: 0.16, sustain: true, rel: 0.02 });
  },
  hit_taken: (v) => {
    v.noise('bandpass', 1400, 400, 0.2, 0.6, { q: 1 });
    v.tone('sine', 75, 35, 0.3, 0.7, { sweep: 0.2 });
    v.tone('triangle', 640, 600, 0.35, 0.2, { detune: 20 });
    v.tone('square', 230, 120, 0.2, 0.25, { sweep: 0.15 });
  },
  ui_click: (v) => v.tone('square', 1200, 600, 0.02, 0.12),
};

/** Procedural sound-effect player with master chain, 3D panning and voice limiting. */
export class Sfx {
  private _volume = 0.7;
  private _muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private readonly voices: { name: SfxName; voice: Voice }[] = [];

  constructor() {}

  /** Master volume 0..1 (default 0.7). */
  get volume(): number { return this._volume; }
  set volume(v: number) {
    this._volume = Math.min(1, Math.max(0, v));
    this.applyMaster();
  }

  get muted(): boolean { return this._muted; }
  set muted(m: boolean) {
    this._muted = m;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (this.master) this.master.gain.value = this._muted ? 0 : this._volume;
  }

  /** Call from a user gesture — creates/resumes the AudioContext. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (typeof AudioContext === 'undefined') return;
      if (!this.ctx) {
        const ctx = new AudioContext();
        const master = ctx.createGain();
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 2);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.ctx = ctx;
        this.master = master;
        this.noiseBuf = buf;
        this.applyMaster();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  /** Update the listener each frame (camera position + forward, up = +Y). */
  setListener(pos: V3, forward: V3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const l = ctx.listener;
      if (l.positionX) {
        l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
        l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      } else {
        l.setPosition(pos.x, pos.y, pos.z);
        l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
      }
    } catch { /* never throw from audio */ }
  }

  /** Fire-and-forget. `pos` = world position for 3D panning; omit for UI/cockpit sounds. */
  play(name: SfxName, pos?: V3, opts?: SfxOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf || ctx.state !== 'running') return;
    try {
      this.limit(name);
      const out = ctx.createGain();
      out.gain.value = opts?.volume ?? 1;
      if (pos) {
        const p = ctx.createPanner();
        p.panningModel = 'equalpower';
        p.distanceModel = 'inverse';
        p.refDistance = 25;
        p.rolloffFactor = 1;
        p.maxDistance = 2000;
        p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
        out.connect(p);
        p.connect(this.master);
      } else {
        out.connect(this.master);
      }
      const entry = { name, voice: null as unknown as Voice };
      const voice = new Voice(ctx, this.noiseBuf, out, opts?.pitch ?? 1, (v) => {
        const i = this.voices.findIndex((e) => e.voice === v);
        if (i >= 0) this.voices.splice(i, 1);
      });
      entry.voice = voice;
      this.voices.push(entry);
      RECIPES[name](voice, opts?.duration);
    } catch { /* never throw from audio */ }
  }

  /** Drop the oldest voices so a new `name` stays within per-name and global caps. */
  private limit(name: SfxName): void {
    const cap = NAME_CAP[name] ?? DEFAULT_CAP;
    const drop = (e: (typeof this.voices)[number]): void => {
      e.voice.kill();
      this.voices.splice(this.voices.indexOf(e), 1);
    };
    const same = this.voices.filter((e) => e.name === name);
    for (let i = 0; i <= same.length - cap; i++) drop(same[i] as (typeof this.voices)[number]);
    while (this.voices.length >= MAX_VOICES) drop(this.voices[0] as (typeof this.voices)[number]);
  }
}
