"use strict";
// Royale Arena 1v1, web build. engine-worker.js runs the real engine and the bot; this page only
// draws the frames at their tick times and sends the human's plays.

const $ = (id) => document.getElementById(id);
const E = { UID: 0, TEAM: 1, KIND: 2, CARD: 3, SLOT: 4, X: 5, Y: 6, HP: 7, MAXHP: 8, R: 9, FLY: 10, DEPLOY: 11, STUN: 12, SHIELD: 13 };
const KIND = { TROOP: 0, BUILDING: 1, KING: 2, PRINCESS: 3 };
const TEAM_COLOR = ["#3d8bff", "#ff4d5e"];
const TEAM_DARK = ["#1d4fa3", "#a3222f"];

// Look of each card: short label, symbol, card colour. Anything else falls back to its initials.
const LOOK = {
  HogRider: { s: "Hog", i: "♞", c: "#b5651d" },
  Musketeer: { s: "Mus", i: "⌖", c: "#7b5cd6" },
  Cannon: { s: "Can", i: "▣", c: "#6d7380" },
  IceGolemite: { s: "IGo", i: "❄", c: "#5fb7d9" },
  IceSpirits: { s: "ISp", i: "✳", c: "#7fd6ff" },
  Skeletons: { s: "Ske", i: "☠", c: "#c9c9c9" },
  Fireball: { s: "Fir", i: "☄", c: "#ff7a1a" },
  Log: { s: "Log", i: "▬", c: "#8a5a2b" },
};
const SPELL_RADIUS = { Fireball: 2.5, Log: 1.95, Zap: 2.5, Arrows: 4, Snowball: 2.5 };

let META = null;
let state = {
  frames: [],          // [{at, f}] received frames, newest last
  last: null,          // newest frame
  mask: null,          // Uint8Array bits, 4*ny*nx
  selected: -1,
  pending: null,       // {slot, card}
  hover: null,         // {tx, ty}
  dragging: false,
  towers: {},          // uid -> {x, y, kind, team} remembered for rubble
  fx: [],              // floating effects
  lastTowerHp: {},
  inGame: false,
  opponent: null,
  debug: false,
  plays: [0, 0],
};

const canvas = $("arena");
const ctx = canvas.getContext("2d");
let T = 20; // pixels per tile
const RENDER_DELAY = 0; // frames are already scheduled at their own tick time

// ------------------------------------------------------------------ setup

// The engine runs in a Web Worker (Pyodide + RoyaleSim in WebAssembly + the bot in onnxruntime-web).
const worker = new Worker("engine-worker.js");
let clock = null;      // {t0, firstTick, tickMs}: when each tick is due on this page's clock
const queue = [];      // events waiting for their tick to be shown: {due, kind, data}
let replayBytes = null;

async function init() {
  const sel = $("opponent");
  const bots = await (await fetch("bots/index.json")).json();
  for (const o of bots) {
    const opt = document.createElement("option");
    opt.value = o.id; opt.textContent = o.label;
    sel.appendChild(opt);
  }
  $("play").disabled = true;
  $("play").onclick = () => start(sel.value, $("seed").value);
  $("rematch").onclick = () => start(state.opponent, "");
  $("to-menu").onclick = () => { worker.postMessage({ type: "stop" }); state.inGame = false; show("menu"); };
  $("download-replay").onclick = downloadReplay;
  connect();
  worker.postMessage({ type: "boot" });
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(draw);
}

function downloadReplay() {
  if (!replayBytes) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([replayBytes], { type: "application/octet-stream" }));
  a.download = `royale_arena_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.msgpack`;
  a.click();
}

function show(id) {
  for (const s of ["menu", "game", "end"]) $(s).classList.toggle("hidden", s !== id);
  if (id === "game") resize();
}

async function start(opponent, seed) {
  state.opponent = opponent;
  state.debug = $("debug").checked;
  $("bot-hand").classList.toggle("hidden", !state.debug);
  Object.assign(state, { frames: [], last: null, mask: null, selected: -1, pending: null, towers: {}, fx: [], lastTowerHp: {}, plays: [0, 0] });
  queue.length = 0; clock = null; replayBytes = null;
  $("menu-error").textContent = "";
  worker.postMessage({ type: "stop" });
  worker.postMessage({ type: "play", opponent, seed: seed === "" ? Math.floor(Math.random() * 1e6) : Number(seed) });
  state.inGame = true;
  show("game");
  renderHand();
}

function connect() {
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "progress") {
      $("load-text").textContent = m.text;
      $("load-fill").style.width = m.pct + "%";
    } else if (m.type === "ready") {
      META = m.meta;
      $("loading").classList.add("hidden");
      $("play").disabled = false;
    } else if (m.type === "start") {
      clock = { t0: performance.now() + 400, firstTick: m.firstTick, tickMs: m.tickMs };
    } else if (m.type === "events") {
      if (m.mask) onMask({ bits: m.mask });
      for (const [kind, data] of m.events) {
        const tick = kind === "frame" ? data.t : data.tick;
        const due = clock ? clock.t0 + (tick - clock.firstTick) * clock.tickMs : performance.now();
        if (kind === "frame") state.frames.push({ at: due, f: data });
        queue.push({ due, kind, data });
      }
      if (state.frames.length > 60) state.frames.splice(0, state.frames.length - 60);
    } else if (m.type === "rejected") {
      state.pending = null; renderHand(); toast(m.reason, true);
    } else if (m.type === "end") {
      replayBytes = m.replay;
      const lastDue = queue.length ? queue[queue.length - 1].due : performance.now();
      queue.push({ due: lastDue + 1, kind: "end", data: m });
    } else if (m.type === "error") {
      $("menu-error").textContent = "Errore: " + m.message;
      toast("Errore: " + m.message, true);
    }
  };
}

// Show queued events whose tick has come.
function pump() {
  const now = performance.now();
  while (queue.length && queue[0].due <= now) {
    const { kind, data } = queue.shift();
    if (kind === "frame") onFrame(data);
    else if (kind === "play") onPlay(data);
    else if (kind === "end") onEnd(data);
  }
}

function resize() {
  const availH = window.innerHeight - 250;
  const availW = Math.min(window.innerWidth - 16, 560);
  T = Math.max(10, Math.floor(Math.min(availH / 32, availW / 18)));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 18 * T * dpr; canvas.height = 32 * T * dpr;
  canvas.style.width = 18 * T + "px"; canvas.style.height = 32 * T + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  document.documentElement.style.setProperty("--arena-w", 18 * T + "px");
}

// ------------------------------------------------------------------ stream handlers

function onFrame(f) {
  if (!state.inGame) return;
  const prev = state.last;
  state.last = f;
  // Remember towers for rubble, spot tower damage for floating numbers.
  for (const e of f.e) {
    if (e[E.KIND] >= KIND.KING) {
      state.towers[e[E.UID]] = { x: e[E.X], y: e[E.Y], kind: e[E.KIND], team: e[E.TEAM] };
      const before = state.lastTowerHp[e[E.UID]];
      if (before !== undefined && e[E.HP] < before) addFx("dmg", e[E.X], e[E.Y] + 1.5, `-${before - e[E.HP]}`, e[E.TEAM]);
      state.lastTowerHp[e[E.UID]] = e[E.HP];
    }
  }
  if (prev) {
    if (f.crowns[0] > prev.crowns[0]) banner("+1 ♛ per te!");
    if (f.crowns[1] > prev.crowns[1]) banner("Il bot prende una corona");
    if (prev.left > 60 && f.left <= 60 && !f.ot) banner("60 secondi! Elisir x2");
    if (!prev.ot && f.ot) banner("OVERTIME!");
  }
  updateHud(f);
}

function onMask(m) {
  const raw = atob(m.bits);
  const bits = new Uint8Array(raw.length * 8);
  for (let i = 0; i < raw.length; i++) {
    const b = raw.charCodeAt(i);
    for (let k = 0; k < 8; k++) bits[i * 8 + k] = (b >> (7 - k)) & 1;
  }
  state.mask = bits;
}

function onPlay(p) {
  const look = LOOK[p.name] || {};
  if (p.ok) {
    state.plays[p.team] += 1;
    addFx("ring", p.x, p.y, "", p.team, 900);
    if (p.team === 0 && state.pending) { state.pending = null; state.selected = -1; }
    if (p.team === 1) toast(`Bot: ${look.s || p.name}`);
  } else if (p.team === 0) {
    state.pending = null;
    toast("Giocata rifiutata dal motore", true);
  }
  renderHand();
}

function onEnd(d) {
  state.inGame = false;
  const t = $("end-title");
  t.className = "";
  if (d.winner === 0) { t.textContent = "VITTORIA!"; t.classList.add("win"); }
  else if (d.winner === 1) { t.textContent = "SCONFITTA"; t.classList.add("lose"); }
  else { t.textContent = "PAREGGIO"; }
  $("end-crowns").innerHTML = `<span style="color:#9cc4ff">${d.crowns[0]}</span> – <span style="color:#ff98a2">${d.crowns[1]}</span>`;
  const secs = state.last ? Math.round((state.last.t - (clock ? clock.firstTick : 0)) * 0.05) : 0;
  $("end-detail").innerHTML = `Durata ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}
    &middot; carte giocate: tu ${state.plays[0]}, bot ${state.plays[1]}<br>
    Il replay si apre con <code>royaleviser FILE</code> (pacchetto RoyaleGym).`;
  setTimeout(() => show("end"), 1200);
}

// ------------------------------------------------------------------ HUD

function cardInfo(id) { return META.cards[id] || { name: "?", elixir: 0 }; }

function cardHtml(id, slot) {
  const c = cardInfo(id);
  const look = LOOK[c.name] || { s: c.name.slice(0, 3), i: c.name.slice(0, 2), c: "#555" };
  return `<div class="cost"><b>${c.elixir}</b></div><div class="icon">${look.i}</div><div class="name">${look.s === "?" ? c.name : c.name}</div>` +
    (slot !== undefined ? `<div class="key">${slot + 1}</div>` : "");
}

function renderHand() {
  const f = state.last;
  const hand = $("hand");
  hand.innerHTML = "";
  if (!f) return;
  f.hand.forEach((id, slot) => {
    const el = document.createElement("div");
    el.className = "card";
    const c = cardInfo(id);
    el.style.background = (LOOK[c.name] || { c: "#555" }).c;
    el.innerHTML = cardHtml(id, slot);
    if (f.elixir[0] < c.elixir) el.classList.add("poor");
    if (state.selected === slot) el.classList.add("selected");
    if (state.pending && state.pending.slot === slot) el.classList.add("pending");
    el.addEventListener("pointerdown", (ev) => { ev.preventDefault(); select(slot); state.dragging = true; });
    hand.appendChild(el);
  });
  const nc = cardInfo(f.next);
  $("next").innerHTML = `<div class="card" style="background:${(LOOK[nc.name] || { c: "#555" }).c}">${cardHtml(f.next)}</div>`;
  if (state.debug) {
    $("bot-hand").innerHTML = "Mano del bot: " + f.bot_hand.map((id) => {
      const c = cardInfo(id);
      return `<div class="card" style="background:${(LOOK[c.name] || { c: "#555" }).c}">${cardHtml(id)}</div>`;
    }).join("");
  }
}

let lastHandKey = "";
function updateHud(f) {
  const left = Math.ceil(f.left);
  $("timer").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  $("timer").classList.toggle("urgent", f.ot || f.left <= 60);
  $("rate").textContent = (f.ot ? "OVERTIME " : "") + (f.rate > 1 ? `ELISIR x${f.rate}` : "");
  $("crowns-blue").textContent = f.crowns[0];
  $("crowns-red").textContent = f.crowns[1];
  $("elixir-fill").style.width = `${Math.min(10, f.elixir[0]) * 10}%`;
  $("elixir-num").textContent = Math.floor(f.elixir[0]);
  const key = f.hand.join(",") + "|" + f.next + "|" + Math.floor(f.elixir[0]) + "|" + (state.debug ? f.bot_hand.join(",") : "");
  if (key !== lastHandKey) { lastHandKey = key; renderHand(); }
}

function toast(text, bad) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.textContent = text;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

function banner(text) {
  const b = $("banner");
  b.textContent = text;
  b.classList.remove("hidden");
  b.style.animation = "none"; void b.offsetWidth; b.style.animation = "";
  clearTimeout(banner.t);
  banner.t = setTimeout(() => b.classList.add("hidden"), 1800);
}

function addFx(type, x, y, text, team, life = 1000) {
  state.fx.push({ type, x, y, text, team, born: performance.now(), life });
}

// ------------------------------------------------------------------ input

function select(slot) {
  const f = state.last;
  if (!f || !state.inGame) return;
  state.selected = state.selected === slot && !state.dragging ? -1 : slot;
  renderHand();
}

function tileAt(ev) {
  const r = canvas.getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  if (mx < 0 || my < 0 || mx >= 18 * T || my >= 32 * T) return null;
  return { tx: Math.floor(mx / T), ty: Math.floor((32 * T - my) / T) };
}

function legal(slot, tx, ty) {
  if (!state.mask || slot < 0) return false;
  return state.mask[slot * 576 + ty * 18 + tx] === 1;
}

async function playAt(tile) {
  const slot = state.selected;
  if (slot < 0 || !tile) return;
  const f = state.last;
  const card = f.hand[slot];
  if (!legal(slot, tile.tx, tile.ty)) {
    const c = cardInfo(card);
    toast(f.elixir[0] < c.elixir ? `Elisir insufficiente (${c.elixir})` : "Posizione non valida", true);
    return;
  }
  state.pending = { slot, card };
  renderHand();
  worker.postMessage({ type: "action", action: 1 + slot * 576 + tile.ty * 18 + tile.tx });
}

document.addEventListener("pointermove", (ev) => { state.hover = tileAt(ev); });
document.addEventListener("pointerup", (ev) => {
  if (state.dragging) {
    state.dragging = false;
    const t = tileAt(ev);
    if (t) playAt(t);
  }
});
canvas.addEventListener("pointerdown", (ev) => { if (ev.button === 0) playAt(tileAt(ev)); });
canvas.addEventListener("contextmenu", (ev) => { ev.preventDefault(); state.selected = -1; renderHand(); });
document.addEventListener("keydown", (ev) => {
  if (!state.inGame) return;
  if (ev.key >= "1" && ev.key <= "4") select(Number(ev.key) - 1);
  if (ev.key === "Escape") { state.selected = -1; renderHand(); }
});

// ------------------------------------------------------------------ drawing

const sx = (x) => x * T;
const sy = (y) => (32 - y) * T;

function interpolated() {
  const fr = state.frames;
  if (!fr.length) return null;
  const t = performance.now() - RENDER_DELAY;
  let i = fr.length - 1;
  while (i > 0 && fr[i].at > t) i--;
  const a = fr[i], b = fr[i + 1];
  if (!b) return { f: a.f, ents: a.f.e };
  const alpha = Math.max(0, Math.min(1, (t - a.at) / Math.max(1, b.at - a.at)));
  const next = new Map(b.f.e.map((e) => [e[E.UID], e]));
  const ents = a.f.e.map((e) => {
    const n = next.get(e[E.UID]);
    if (!n) return e;
    const c = e.slice();
    c[E.X] = e[E.X] + (n[E.X] - e[E.X]) * alpha;
    c[E.Y] = e[E.Y] + (n[E.Y] - e[E.Y]) * alpha;
    return c;
  });
  return { f: a.f, ents };
}

function drawField() {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 18; x++) {
    ctx.fillStyle = (x + y) % 2 ? "#6fbf4a" : "#78c952";
    ctx.fillRect(x * T, y * T, T, T);
  }
  // own half tint
  ctx.fillStyle = "#3d8bff10"; ctx.fillRect(0, sy(15), 18 * T, 15 * T);
  ctx.fillStyle = "#ff4d5e10"; ctx.fillRect(0, 0, 18 * T, sy(17));
  const [w0, w1] = META.water_half_rows;
  const yTop = (w1 + 1) / 2, yBot = w0 / 2;
  ctx.fillStyle = "#3aa7e0";
  ctx.fillRect(0, sy(yTop), 18 * T, (yTop - yBot) * T);
  ctx.fillStyle = "#ffffff30";
  for (let x = 0; x < 18; x += 1.5) ctx.fillRect(x * T, sy(yTop) + T * 0.5 + Math.sin(performance.now() / 600 + x) * 2, T * 0.6, 2);
  for (const [b0, b1] of META.bridges_half_cols) {
    const x0 = b0 / 2, x1 = (b1 + 1) / 2;
    ctx.fillStyle = "#a9773f";
    ctx.fillRect(sx(x0), sy(yTop) - 2, (x1 - x0) * T, (yTop - yBot) * T + 4);
    ctx.strokeStyle = "#6b4520"; ctx.lineWidth = 1;
    for (let y = yBot; y < yTop; y += 0.33) { ctx.beginPath(); ctx.moveTo(sx(x0), sy(y)); ctx.lineTo(sx(x1), sy(y)); ctx.stroke(); }
  }
}

function drawMask() {
  const slot = state.selected;
  if (slot < 0 || !state.mask || !state.inGame) return;
  ctx.fillStyle = "#ffffff2e";
  for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 18; tx++) {
    if (state.mask[slot * 576 + ty * 18 + tx]) ctx.fillRect(tx * T + 1, sy(ty + 1) + 1, T - 2, T - 2);
  }
  const h = state.hover;
  if (h) {
    const ok = legal(slot, h.tx, h.ty);
    const c = cardInfo(state.last.hand[slot]);
    const cx = sx(h.tx + 0.5), cy = sy(h.ty + 0.5);
    const isSpell = c.placement === 2 || c.placement === 3 || c.placement === 4;
    const r = (isSpell ? (SPELL_RADIUS[c.name] || 2.5) : Math.max(0.5, c.radius)) * T;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ok ? "#ffffff" : "#ff3344";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? "#fff" : "#ff3344"; ctx.lineWidth = 2;
    ctx.strokeRect(h.tx * T, sy(h.ty + 1), T, T);
  }
}

function hpBar(x, y, w, hp, max, team) {
  if (max <= 0) return;
  const p = Math.max(0, hp / max);
  ctx.fillStyle = "#000a"; ctx.fillRect(x - w / 2, y, w, 5);
  ctx.fillStyle = TEAM_COLOR[team]; ctx.fillRect(x - w / 2 + 1, y + 1, (w - 2) * p, 3);
}

function drawTowers(ents, f) {
  const alive = new Set(ents.filter((e) => e[E.KIND] >= KIND.KING).map((e) => e[E.UID]));
  for (const [uid, t] of Object.entries(state.towers)) {
    if (alive.has(Number(uid))) continue;
    const s = (t.kind === KIND.KING ? 4 : 3) * T;
    ctx.fillStyle = "#555b"; ctx.fillRect(sx(t.x) - s / 2, sy(t.y) - s / 2, s, s);
    ctx.fillStyle = "#333"; ctx.font = `${T}px sans-serif`; ctx.textAlign = "center"; ctx.fillText("✖", sx(t.x), sy(t.y) + T / 3);
  }
  for (const e of ents) {
    if (e[E.KIND] < KIND.KING) continue;
    const king = e[E.KIND] === KIND.KING;
    const s = (king ? 4 : 3) * T;
    const x = sx(e[E.X]), y = sy(e[E.Y]);
    let shake = 0;
    const recent = state.fx.find((fx) => fx.type === "dmg" && Math.abs(fx.x - e[E.X]) < 0.1 && performance.now() - fx.born < 150);
    if (recent) shake = (Math.random() - 0.5) * 3;
    ctx.fillStyle = TEAM_DARK[e[E.TEAM]];
    ctx.fillRect(x - s / 2 + shake, y - s / 2, s, s);
    ctx.fillStyle = TEAM_COLOR[e[E.TEAM]];
    ctx.fillRect(x - s / 2 + 3 + shake, y - s / 2 + 3, s - 6, s - 6);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.font = `bold ${Math.round(T * (king ? 1.4 : 1.1))}px sans-serif`;
    ctx.fillText(king ? "♛" : "♖", x + shake, y + T * 0.45);
    if (king && !f.kings[e[E.TEAM]]) { ctx.font = `bold ${Math.round(T * 0.7)}px sans-serif`; ctx.fillText("zZ", x + s / 2 - T * 0.5, y - s / 2 + T * 0.7); }
    hpBar(x, e[E.TEAM] === 0 ? y + s / 2 + 2 : y - s / 2 - 8, s, e[E.HP], e[E.MAXHP], e[E.TEAM]);
    ctx.font = `bold ${Math.max(9, Math.round(T * 0.55))}px sans-serif`; ctx.fillStyle = "#fff";
    ctx.fillText(e[E.HP], x, e[E.TEAM] === 0 ? y + s / 2 + 8 + T * 0.55 : y - s / 2 - 10);
  }
}

function drawUnits(ents) {
  const sorted = ents.filter((e) => e[E.KIND] < KIND.KING).sort((a, b) => a[E.FLY] - b[E.FLY] || b[E.Y] - a[E.Y]);
  for (const e of sorted) {
    const c = cardInfo(e[E.CARD]);
    const look = LOOK[c.name] || { i: c.name.slice(0, 2) };
    const x = sx(e[E.X]), y = sy(e[E.Y]);
    const r = Math.max(0.5, e[E.R] * 1.3) * T;
    const fly = e[E.FLY] === 1;
    const lift = fly ? T * 0.6 : 0;
    ctx.globalAlpha = e[E.DEPLOY] > 0 ? 0.45 : 1;
    if (fly) { ctx.fillStyle = "#0004"; ctx.beginPath(); ctx.ellipse(x, y + r * 0.3, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); }
    if (e[E.KIND] === KIND.BUILDING) {
      ctx.fillStyle = TEAM_DARK[e[E.TEAM]]; ctx.fillRect(x - r, y - r - lift, 2 * r, 2 * r);
      ctx.fillStyle = TEAM_COLOR[e[E.TEAM]]; ctx.fillRect(x - r + 2, y - r + 2 - lift, 2 * r - 4, 2 * r - 4);
    } else {
      ctx.fillStyle = TEAM_DARK[e[E.TEAM]]; ctx.beginPath(); ctx.arc(x, y - lift, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = TEAM_COLOR[e[E.TEAM]]; ctx.beginPath(); ctx.arc(x, y - lift, r - 2, 0, Math.PI * 2); ctx.fill();
    }
    if (e[E.STUN] > 0) { ctx.strokeStyle = "#9fe8ff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y - lift, r + 2, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.font = `bold ${Math.round(Math.max(10, r * 1.1))}px sans-serif`;
    ctx.fillText(look.i, x, y - lift + r * 0.38);
    ctx.globalAlpha = 1;
    if (e[E.DEPLOY] > 0) {
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - lift, r + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, e[E.DEPLOY] / 20)); ctx.stroke();
    }
    if (e[E.HP] < e[E.MAXHP]) hpBar(x, y - lift - r - 7, Math.max(T, 2 * r), e[E.HP], e[E.MAXHP], e[E.TEAM]);
  }
}

function drawSpells(f) {
  for (const s of f.sp) {
    const [team, cid, motion, x, y, ax, ay, travelled, length] = s;
    const c = cardInfo(cid);
    const rad = (SPELL_RADIUS[c.name] || 2.5) * T;
    if (motion === 2 || motion === 1) { // Log: rolling (or airborne before it lands)
      const w = 2 * rad, h = T * 0.9;
      ctx.fillStyle = "#8a5a2b"; ctx.strokeStyle = "#4a2e12"; ctx.lineWidth = 2;
      ctx.fillRect(sx(x) - w / 2, sy(y) - h / 2, w, h); ctx.strokeRect(sx(x) - w / 2, sy(y) - h / 2, w, h);
    } else if (motion === 0) { // in flight towards aim
      ctx.strokeStyle = TEAM_COLOR[team]; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx(ax), sy(ay), rad, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#ff8a1a"; ctx.beginPath(); ctx.arc(sx(x), sy(y), T * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd36b"; ctx.beginPath(); ctx.arc(sx(x), sy(y), T * 0.3, 0, Math.PI * 2); ctx.fill();
    } else { // area effects
      ctx.fillStyle = c.name === "Fireball" ? "#ff7a1a66" : "#9fe8ff66";
      ctx.beginPath(); ctx.arc(sx(x), sy(y), rad, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const p of f.pr) {
    const [team, x, y, ax, ay] = p;
    const dx = ax - x, dy = ay - y, n = Math.hypot(dx, dy) || 1;
    ctx.strokeStyle = TEAM_COLOR[team]; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx(x), sy(y)); ctx.lineTo(sx(x - dx / n * 0.6), sy(y - dy / n * 0.6)); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(sx(x), sy(y), 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawFx() {
  const now = performance.now();
  state.fx = state.fx.filter((fx) => now - fx.born < fx.life);
  for (const fx of state.fx) {
    const k = (now - fx.born) / fx.life;
    if (fx.type === "dmg") {
      ctx.globalAlpha = 1 - k; ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(T * 0.7)}px sans-serif`; ctx.textAlign = "center";
      ctx.fillText(fx.text, sx(fx.x), sy(fx.y + k * 1.5)); ctx.globalAlpha = 1;
    } else if (fx.type === "ring") {
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = TEAM_COLOR[fx.team]; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx(fx.x), sy(fx.y), T * (0.5 + 1.5 * k), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
}

function draw() {
  requestAnimationFrame(draw);
  if (!META || $("game").classList.contains("hidden")) return;
  pump();
  ctx.clearRect(0, 0, 18 * T, 32 * T);
  drawField();
  const cur = interpolated();
  drawMask();
  if (!cur) {
    ctx.fillStyle = "#fff"; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Avvio della partita...", 9 * T, 16 * T);
    return;
  }
  drawTowers(cur.ents, cur.f);
  drawUnits(cur.ents);
  drawSpells(cur.f);
  drawFx();
}

init().catch((e) => { $("menu-error").textContent = "Server non raggiungibile: " + e; });
