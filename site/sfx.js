"use strict";
// Synthesised sound effects (WebAudio): no recorded or game audio is used.
const SFX = (() => {
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem("ra_muted") === "1"; } catch (e) { /* storage blocked */ }
  const ensure = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  const last = {};
  function tone({ type = "sine", f0 = 440, f1 = f0, dur = 0.15, vol = 0.5, delay = 0 }) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise({ dur = 0.3, vol = 0.5, lp = 1200, delay = 0, hp = 0 }) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node = s;
    if (hp) { const h = c.createBiquadFilter(); h.type = "highpass"; h.frequency.value = hp; s.connect(h); node = h; }
    node.connect(f); f.connect(g); g.connect(master); s.start(t);
  }
  const SOUNDS = {
    select: () => tone({ type: "triangle", f0: 660, f1: 880, dur: 0.07, vol: 0.25 }),
    place: () => { tone({ type: "sine", f0: 300, f1: 120, dur: 0.18, vol: 0.5 }); noise({ dur: 0.12, vol: 0.25, lp: 900 }); },
    swing: () => noise({ dur: 0.12, vol: 0.18, lp: 3000, hp: 800 }),
    shoot: () => { noise({ dur: 0.08, vol: 0.3, lp: 4000, hp: 1000 }); tone({ type: "square", f0: 220, f1: 90, dur: 0.06, vol: 0.12 }); },
    arrow: () => noise({ dur: 0.07, vol: 0.12, lp: 5000, hp: 2000 }),
    cannon: () => { tone({ type: "sine", f0: 120, f1: 40, dur: 0.3, vol: 0.6 }); noise({ dur: 0.25, vol: 0.35, lp: 600 }); },
    boom: () => { tone({ type: "sine", f0: 90, f1: 30, dur: 0.6, vol: 0.8 }); noise({ dur: 0.6, vol: 0.6, lp: 900 }); },
    ice: () => { tone({ type: "triangle", f0: 1800, f1: 600, dur: 0.25, vol: 0.2 }); noise({ dur: 0.2, vol: 0.15, lp: 6000, hp: 2500 }); },
    roll: () => noise({ dur: 0.7, vol: 0.3, lp: 400 }),
    pop: () => tone({ type: "triangle", f0: 500, f1: 180, dur: 0.12, vol: 0.18 }),
    crash: () => { noise({ dur: 1.2, vol: 0.8, lp: 700 }); tone({ type: "sine", f0: 70, f1: 25, dur: 1.0, vol: 0.7 }); },
    crown: () => [523, 659, 784].forEach((f, i) => tone({ type: "triangle", f0: f, dur: 0.25, vol: 0.3, delay: i * 0.1 })),
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone({ type: "triangle", f0: f, dur: 0.4, vol: 0.35, delay: i * 0.15 })),
    lose: () => [392, 349, 311, 262].forEach((f, i) => tone({ type: "triangle", f0: f, dur: 0.45, vol: 0.3, delay: i * 0.18 })),
    tick: () => tone({ type: "square", f0: 1000, dur: 0.04, vol: 0.12 }),
  };
  return {
    play(name, minGapMs = 40) {
      const now = performance.now();
      if (last[name] && now - last[name] < minGapMs) return; // many units attacking at once: no wall of sound
      last[name] = now;
      try { (SOUNDS[name] || (() => {}))(); } catch (e) { /* audio is optional */ }
    },
    unlock: ensure,
    get muted() { return muted; },
    set muted(v) { muted = v; try { localStorage.setItem("ra_muted", v ? "1" : "0"); } catch (e) { /* ignore */ } },
  };
})();
window.SFX = SFX;
