"use strict";
// Web Worker: Pyodide + the RoyaleSim engine (WebAssembly) + royalegym, and the bot's network in
// onnxruntime-web. Runs the battle in real time and posts frames to the page.

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
// onnxruntime-web 1.17.3, not 1.20: 1.20 ships only a SIMD build, which phones without WebAssembly SIMD
// (e.g. iOS before 16.4) cannot load ("no available backend found"). 1.17.3 also ships the plain
// ort-wasm.wasm and picks the SIMD one by itself where it is supported.
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/";
importScripts(PYODIDE + "pyodide.js");
let ortLoaded = false;
function loadOrt() {
  if (ortLoaded) return;
  importScripts(ORT + "ort.wasm.min.js");
  ort.env.wasm.wasmPaths = ORT;
  ort.env.wasm.numThreads = 1;  // no SharedArrayBuffer on GitHub Pages
  ort.env.wasm.proxy = false;
  ortLoaded = true;
}

let py = null, game = null, session = null, inputsMeta = null;
let running = false, pending = 0, seq = 0;
const say = (type, data = {}) => postMessage({ type, ...data });
const progress = (text, pct) => say("progress", { text, pct });

async function boot() {
  progress("Carico Python (Pyodide)...", 5);
  py = await loadPyodide({ indexURL: PYODIDE });
  progress("Carico numpy e le librerie...", 25);
  await py.loadPackage(["micropip", "numpy", "msgspec"]);
  const micropip = py.pyimport("micropip");
  await micropip.install(["gymnasium", "pettingzoo", "cloudpickle", "farama-notifications", "typing-extensions"]);
  progress("Carico il motore di gioco (RoyaleSim)...", 55);
  const wheels = (await (await fetch("wheels/index.txt", { cache: "no-store" })).text()).split(/\s+/).filter((w) => w.endsWith(".whl"));
  for (const w of wheels) {
    await micropip.install.callKwargs(new URL("wheels/" + w, self.location.href).href, { deps: false });
  }
  progress("Preparo l'arena...", 80);
  py.runPython(await (await fetch("py/game.py", { cache: "no-store" })).text(), { globals: py.globals });
  game = py.globals.get("Game")();
  say("ready", { meta: JSON.parse(game.meta()) });
}

async function loadBot(name) {
  progress("Carico il bot...", 90);
  loadOrt();
  try {
    session = await ort.InferenceSession.create("bots/" + name + ".onnx", { executionProviders: ["wasm"] });
  } catch (e) {
    throw new Error("Il bot non si avvia su questo dispositivo (onnxruntime: " + (e && e.message || e) +
      "). Puoi giocare contro i bot 'Script'.");
  }
  inputsMeta = await (await fetch("bots/" + name + ".json")).json();
}

// Masked softmax + inverse-CDF sample: RoyaleLearn's MaskedCategorical.sample, the "stochastic" mode.
function sampleAction(logits, mask) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (mask[i] && logits[i] > max) max = logits[i];
  const cdf = new Float64Array(logits.length);
  let acc = 0;
  for (let i = 0; i < logits.length; i++) { if (mask[i]) acc += Math.exp(logits[i] - max); cdf[i] = acc; }
  const u = Math.min(Math.random(), 1 - 1e-7) * acc;
  for (let i = 0; i < cdf.length; i++) if (cdf[i] > u && mask[i]) return i;
  return 0;
}

async function botAction() {
  const parts = game.bot_inputs().toJs();
  const f32 = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const shp = inputsMeta.inputs;
  const feeds = {
    spatial: new ort.Tensor("float32", f32(parts[0]), shp.spatial),
    mask_planes: new ort.Tensor("float32", f32(parts[1]), shp.mask_planes),
    vector: new ort.Tensor("float32", f32(parts[2]), shp.vector),
  };
  const out = await session.run(feeds);
  return sampleAction(out.logits.data, parts[3]);
}

async function play(opponent, seed) {
  const id = ++seq;
  running = true;
  pending = 0;
  const scripted = opponent.startsWith("script:") ? opponent.slice(7) : "";
  if (!scripted) await loadBot(opponent);
  progress("Si gioca!", 100);
  let res = JSON.parse(game.reset(seed, scripted));
  const tickMs = 50;
  const t0 = performance.now() + 400;
  const firstTick = res.events.find((e) => e[0] === "frame")[1].t;
  say("start", { t0, firstTick, tickMs });
  say("events", { events: res.events, mask: res.mask });
  while (running && id === seq) {
    // Decide at the time the last posted tick will be shown, so decisions keep real-time pace.
    const lastTick = res.events.filter((e) => e[0] === "frame").pop()[1].t;
    const due = t0 + (lastTick - firstTick) * tickMs - 500;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!running || id !== seq) return;
    const a_blue = pending; pending = 0;
    const a_red = scripted ? game.scripted_action() : await botAction();
    res = JSON.parse(game.step(a_blue, a_red));
    say("events", { events: res.events, mask: res.mask || null });
    if (a_blue && !res.blue_ok) say("rejected", { reason: "la posizione non e' piu' valida" });
    if (res.done) {
      const bytes = game.replay_bytes().toJs();
      say("end", { ...res.end, replay: bytes }, );
      running = false;
    }
  }
}

onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === "boot") await boot();
    else if (m.type === "play") await play(m.opponent, m.seed);
    else if (m.type === "action") pending = m.action;
    else if (m.type === "stop") { running = false; seq++; }
  } catch (e) {
    say("error", { message: String(e && e.message || e), stack: String(e && e.stack || "").slice(0, 800),
                   where: m.type, ua: navigator.userAgent });
  }
};
