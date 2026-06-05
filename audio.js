// audio.js — programmatic synth via Web Audio API. No external files.
// Initialized on the first user gesture (Engage click) because browsers
// block AudioContext from auto-starting on page load.
"use strict";

const Audio = {
  ctx: null,
  master: null,
  ambient: { nodes: [], lfo: null, started: false },
  alarmActive: false,
  alarmTimer: 0,
  muted: false,
};

function initAudio() {
  if (Audio.ctx) {
    if (Audio.ctx.state === "suspended") Audio.ctx.resume();
    return;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    Audio.ctx = new Ctx();
    Audio.master = Audio.ctx.createGain();
    Audio.master.gain.value = Audio.muted ? 0 : 0.45;
    Audio.master.connect(Audio.ctx.destination);
  } catch (e) {
    console.warn("Audio init failed:", e);
  }
}

function muteAudio(mute) {
  Audio.muted = mute;
  if (Audio.master) Audio.master.gain.value = mute ? 0 : 0.45;
}

function _now() { return Audio.ctx ? Audio.ctx.currentTime : 0; }

// ---- Helpers ----
function _envOsc(type, freqStart, freqEnd, attack, release, peakGain, fadeShape = "exponentialRampToValueAtTime") {
  const t = _now();
  const o = Audio.ctx.createOscillator();
  const g = Audio.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freqStart, t);
  if (freqEnd !== freqStart) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + attack + release);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peakGain, t + attack);
  g.gain[fadeShape](0.0001, t + attack + release);
  o.connect(g); g.connect(Audio.master);
  o.start(t); o.stop(t + attack + release + 0.05);
}

// ---- Weapon sounds ----
function playPhaserSound(volScale) {
  if (!Audio.ctx || Audio.muted) return;
  const v = Math.max(0.0, Math.min(1.0, volScale === undefined ? 1 : volScale));
  if (v < 0.05) return;
  _envOsc("sawtooth", 1600, 200, 0.005, 0.28, 0.15 * v);
  _envOsc("square",   800, 120, 0.005, 0.20, 0.06 * v);
}

function playTorpSound(volScale) {
  if (!Audio.ctx || Audio.muted) return;
  const v = Math.max(0.0, Math.min(1.0, volScale === undefined ? 1 : volScale));
  if (v < 0.05) return;
  _envOsc("square",   140, 50, 0.005, 0.45, 0.16 * v);
  _envOsc("sine",     220, 90, 0.005, 0.35, 0.10 * v);
}

function playHitSound(kind, volScale) {
  if (!Audio.ctx || Audio.muted) return;
  const v = Math.max(0.0, Math.min(1.0, volScale === undefined ? 1 : volScale));
  if (v < 0.05) return;
  if (kind === "torp") {
    _envOsc("square",   90, 40, 0.005, 0.30, 0.18 * v);
    _envOsc("sawtooth", 300, 120, 0.005, 0.20, 0.10 * v);
  } else {
    _envOsc("triangle", 320, 180, 0.005, 0.15, 0.10 * v);
  }
}

// Distance-attenuated SFX based on player position. Used by weapons.js so any
// nearby enemy fire is also audible.
function fxFromShip(s, world, fn) {
  if (!Audio.ctx || Audio.muted || !world || !world.playerShip) return;
  const me = world.playerShip;
  if (s === me) { fn(1); return; }
  const d = Math.hypot(s.x - me.x, s.y - me.y);
  if (d > TACTICAL_RANGE) return;  // only nearby ships audible
  const scale = Math.max(0.0, 1 - d / TACTICAL_RANGE);
  fn(scale * 0.9);
}

// ---- Intro fanfare (NOT the Star Trek theme — original sci-fi opener) ----
function playIntroFanfare() {
  if (!Audio.ctx || Audio.muted) return;
  const t0 = _now();
  // Notes: melody + 5th harmony. Rising heroic shape with a held final.
  const seq = [
    { f: 261.63, t: 0.00, d: 0.35 },  // C4
    { f: 329.63, t: 0.30, d: 0.35 },  // E4
    { f: 392.00, t: 0.60, d: 0.35 },  // G4
    { f: 523.25, t: 0.90, d: 0.80 },  // C5
    { f: 659.25, t: 1.65, d: 0.60 },  // E5
    { f: 587.33, t: 2.15, d: 0.30 },  // D5
    { f: 783.99, t: 2.40, d: 1.30 },  // G5 — held
  ];
  for (const n of seq) {
    for (const harm of [1, 1.5]) {  // root + perfect 5th
      const o = Audio.ctx.createOscillator();
      const g = Audio.ctx.createGain();
      o.type = "triangle";
      o.frequency.value = n.f * harm;
      const peak = harm === 1 ? 0.13 : 0.06;
      g.gain.setValueAtTime(0, t0 + n.t);
      g.gain.linearRampToValueAtTime(peak, t0 + n.t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
      o.connect(g); g.connect(Audio.master);
      o.start(t0 + n.t); o.stop(t0 + n.t + n.d + 0.05);
    }
  }
}

// ---- Ambient space drone (loops while playing) ----
function startAmbient() {
  if (!Audio.ctx || Audio.muted || Audio.ambient.started) return;
  Audio.ambient.started = true;
  const t = _now();
  // Soft chord: A2 + E3 + A3 (open fifth + octave) — quiet pad
  const freqs = [110, 164.81, 220];
  for (const f of freqs) {
    const o = Audio.ctx.createOscillator();
    const g = Audio.ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.022, t + 4);
    o.connect(g); g.connect(Audio.master);
    o.start(t);
    Audio.ambient.nodes.push({ o, g });
  }
  // Very slow LFO modulating gain so the chord "breathes"
  const lfo = Audio.ctx.createOscillator();
  const lfoGain = Audio.ctx.createGain();
  lfo.type = "sine";
  lfo.frequency.value = 0.06;
  lfoGain.gain.value = 0.012;
  lfo.connect(lfoGain);
  for (const n of Audio.ambient.nodes) lfoGain.connect(n.g.gain);
  lfo.start(t);
  Audio.ambient.lfo = lfo;
}

function stopAmbient() {
  if (!Audio.ctx) return;
  const t = _now();
  for (const n of Audio.ambient.nodes) {
    try {
      n.g.gain.cancelScheduledValues(t);
      n.g.gain.setValueAtTime(n.g.gain.value, t);
      n.g.gain.linearRampToValueAtTime(0, t + 1);
      n.o.stop(t + 1.1);
    } catch (e) {}
  }
  if (Audio.ambient.lfo) { try { Audio.ambient.lfo.stop(t + 1.1); } catch (e) {} }
  Audio.ambient.nodes = [];
  Audio.ambient.lfo = null;
  Audio.ambient.started = false;
}

// ---- Torpedo-lock alarm — repeating beep while incoming hostile torp ----
function startTorpAlarm() {
  if (!Audio.ctx || Audio.muted || Audio.alarmActive) return;
  Audio.alarmActive = true;
  _alarmBeep();
}
function stopTorpAlarm() { Audio.alarmActive = false; }

function _alarmBeep() {
  if (!Audio.alarmActive || !Audio.ctx || Audio.muted) return;
  const t = _now();
  for (const f of [880, 1175]) {  // two-tone alarm
    const o = Audio.ctx.createOscillator();
    const g = Audio.ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.10, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(Audio.master);
    o.start(t); o.stop(t + 0.18);
  }
  setTimeout(_alarmBeep, 380);
}
