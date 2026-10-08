// Royale Arena: 2.5D renderer (three.js). The engine's frames are the only source of truth: this file
// interprets them (positions, attack phases, deploy and stun timers) and never anticipates them.
// Models: KayKit by Kay Lousberg, CC0 (assets/CREDITS.txt). Everything else is procedural.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { CARD_LOOK, SPELL_LOOK, WEAPON_MESHES, buildProc, clipsFor, displayName, lookFor, modelFilesFor, PROC, toon as toonMat } from "./cards3d.js?v=202610082253";
window.cardDisplayName = displayName;

const E = { UID: 0, TEAM: 1, KIND: 2, CARD: 3, SLOT: 4, X: 5, Y: 6, HP: 7, MAXHP: 8, R: 9, FLY: 10, DEPLOY: 11,
  STUN: 12, SHIELD: 13, PHASE: 14, TARGET: 15, FX: 16, FY: 17 };
const KIND = { TROOP: 0, BUILDING: 1, KING: 2, PRINCESS: 3 };
const TEAM = [new THREE.Color("#3d8bff"), new THREE.Color("#ff4d5e")];
const TEAM_BAR = [new THREE.Color("#4fa3ff"), new THREE.Color("#ff5a6a")];
const HP_LOW = new THREE.Color("#ffb020"), HP_CRIT = new THREE.Color("#ff3030");
const GHOST_OK = new THREE.Color("#d8ecff"), GHOST_BAD = new THREE.Color("#ff6070");
const ELEV = THREE.MathUtils.degToRad(52); // camera elevation above the ground plane
const FLY_H = 1.8;
const sfx = (n, gap) => window.SFX && window.SFX.play(n, gap);
const STYLE_SFX = { bow: "shoot", shoot1: "shoot", cast: "ice", throw: "pop", punch: "swing", melee1: "swing", melee2: "swing", heavy: "swing", ride: "swing" };
const PROC_SFX = { cannon: "cannon", mortar: "cannon", xbow: "arrow", tesla: "ice", inferno: "ice", spirit: "ice", sparky: "boom", dragon: "boom", imp: "swing" };

// engine tiles (x right, y towards red) -> world (X right, Z towards the viewer, Y up)
const wx = (x) => x - 9;
const wz = (y) => 16 - y;

const ASSETS = ["archer", "king", "tower_blue", "tower_red",
  "castle_blue", "castle_red", "bridge", "tree_a", "tree_b", "trees_large", "rock_a", "rock_c", "barrel", "wall"];

class Renderer3D {
  constructor() {
    this.ready = false;
    this.units = new Map();   // uid -> unit
    this.towers = new Map();  // uid -> tower
    this.dying = [];          // units playing their death
    this.fx = [];             // short-lived effects
    this.spells = new Map();  // key -> spell visual
    this.models = {};
    this.clock = new THREE.Clock();
  }

  async init(canvas, meta, onProgress) {
    this.meta = meta;
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    this.lost = false;
    canvas.addEventListener("webglcontextlost", (ev) => { ev.preventDefault(); this.lost = true; this.onLost && this.onLost(); });
    canvas.addEventListener("webglcontextrestored", () => { this.lost = false; this.onRestored && this.onRestored(); });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#2f5a2a");
    this.camera = new THREE.OrthographicCamera(-10, 10, 18, -18, 0.1, 200);
    this.camera.position.set(0, Math.sin(ELEV) * 60, Math.cos(ELEV) * 60 + 0.2);
    this.camera.lookAt(0, 0, 0.2);
    this.scene.add(new THREE.HemisphereLight("#fff6e0", "#3a5a30", 1.55));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(-6, 14, 8);
    this.scene.add(sun);
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.loader = loader;
    let done = 0;
    await Promise.all(ASSETS.map(async (name) => {
      const g = await loader.loadAsync(`assets/${name}.glb`);
      this.models[name] = g;
      onProgress && onProgress(++done / ASSETS.length);
    }));
    this.buildArena();
    this.buildOverlay();
    this.resize();
    this.ready = true;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // Fit the arena (18 wide, 32 deep seen at ELEV) plus a margin for towers and the border.
    let halfW = 9.7, halfH = halfW / aspect;
    const needH = (32 * Math.sin(ELEV)) / 2 + 2.9; // + the king castle's height at the far end
    if (halfH < needH) { halfH = needH; halfW = halfH * aspect; }
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ arena
  buildArena() {
    const m = this.meta;
    // Field texture: two greens in a soft checker, dirt lanes from the towers to the bridges, darker edge.
    const c = document.createElement("canvas");
    c.width = 18 * 32; c.height = 32 * 32;
    const g = c.getContext("2d");
    for (let y = 0; y < 32; y++) for (let x = 0; x < 18; x++) {
      g.fillStyle = (x + y) % 2 ? "#79c24f" : "#82ca57";
      g.fillRect(x * 32, (31 - y) * 32, 32, 32);
    }
    g.fillStyle = "#c9b27a";
    for (const lx of [3.5, 14.5]) {
      g.globalAlpha = 0.38;
      g.fillRect((lx - 1) * 32, 0, 64, 32 * 32);
    }
    g.globalAlpha = 1;
    // speckles
    const rnd = mulberry32(7);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rnd() < 0.5 ? "#6fb246" : "#93d466";
      g.fillRect(rnd() * c.width, rnd() * c.height, 3, 3);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const field = new THREE.Mesh(new THREE.PlaneGeometry(18, 32), new THREE.MeshLambertMaterial({ map: tex }));
    field.rotation.x = -Math.PI / 2;
    this.scene.add(field);
    // Outer ground and a stone rim
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(80, 90), new THREE.MeshLambertMaterial({ color: "#4f8a3a" }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02;
    this.scene.add(outer);
    const rimMat = new THREE.MeshLambertMaterial({ color: "#8d8a80" });
    for (const [x, z, w, d] of [[-9.25, 0, 0.5, 32.5], [9.25, 0, 0.5, 32.5], [0, -16.25, 19, 0.5], [0, 16.25, 19, 0.5]]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, d), rimMat);
      rim.position.set(x, 0.17, z);
      this.scene.add(rim);
    }
    // River: rows between the water half rows, animated stripes.
    const [w0, w1] = m.water_half_rows;
    const yBot = w0 / 2, yTop = (w1 + 1) / 2;
    this.water = { yBot, yTop, bridges: m.bridges_half_cols.map(([b0, b1]) => [b0 / 2, (b1 + 1) / 2]) };
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: `varying vec2 vUv; uniform float t;
        void main(){ float w = sin(vUv.x*40.0 + t*1.5 + sin(vUv.y*6.0+t)*2.0)*0.5+0.5;
          float edge = smoothstep(0.0,0.12,vUv.y)*smoothstep(1.0,0.88,vUv.y);
          vec3 deep = vec3(0.16,0.55,0.86), light = vec3(0.45,0.78,0.98);
          vec3 col = mix(deep, light, w*0.35 + (1.0-edge)*0.5);
          gl_FragColor = vec4(col,1.0); }`,
    });
    const river = new THREE.Mesh(new THREE.PlaneGeometry(18.6, yTop - yBot), this.waterMat);
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, 0.01, wz((yBot + yTop) / 2));
    this.scene.add(river);
    for (const zEdge of [wz(yBot), wz(yTop)]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(18.6, 0.25, 0.22), new THREE.MeshLambertMaterial({ color: "#a39a86" }));
      bank.position.set(0, 0.1, zEdge);
      this.scene.add(bank);
    }
    // Bridges
    for (const [b0, b1] of m.bridges_half_cols) {
      const xc = (b0 / 2 + (b1 + 1) / 2) / 2;
      const br = makeBridge(2.2, yTop - yBot + 1.1);
      br.position.set(wx(xc), 0, wz((yBot + yTop) / 2));
      this.scene.add(br);
    }
    // Decor outside the field (deterministic)
    const deco = ["tree_a", "tree_b", "trees_large", "rock_a", "rock_c", "tree_a", "barrel"];
    const r2 = mulberry32(11);
    for (let i = 0; i < 46; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (10.2 + r2() * 5.5);
      const z = -17 + r2() * 34;
      const name = deco[Math.floor(r2() * deco.length)];
      const o = this.placeModel(name, { height: name.startsWith("tree") ? 1.8 + r2() * 1.4 : 0.8 + r2() * 0.6 });
      o.position.set(x, 0, z);
      o.rotation.y = r2() * Math.PI * 2;
      this.scene.add(o);
    }
    for (let i = 0; i < 12; i++) {
      const o = this.placeModel(i % 3 ? "tree_b" : "trees_large", { height: 2.4 });
      o.position.set(-12 + i * 2.2, 0, -19 - (i % 2));
      this.scene.add(o);
    }
  }

  // A clone of a static model scaled to a footprint.
  placeModel(name, { width, depth, height, alongZ } = {}) {
    const src = this.models[name].scene;
    const o = src.clone(true);
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const wrap = new THREE.Group();
    if (alongZ && size.x > size.z) o.rotation.y = Math.PI / 2;
    const sx = alongZ && size.x > size.z ? size.z : size.x;
    const sz = alongZ && size.x > size.z ? size.x : size.z;
    let s = 1;
    if (height) s = height / size.y;
    else if (width) s = Math.min(width / sx, depth ? depth / sz : Infinity);
    o.scale.setScalar(s);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
    o.position.set(-center.x, -box.min.y * s, -center.z);
    if (alongZ && size.x > size.z) o.position.set(center.z, -box.min.y * s, -center.x);
    wrap.add(o);
    return wrap;
  }

  // ------------------------------------------------------------------ models on demand
  // The characters weigh ~0.6 MB each: load only those the two decks (and their spawns) need.
  async ensureModels(cardNames, onProgress) {
    const files = new Set(modelFilesFor(cardNames));
    files.add("skel_minion"); // spawned units that are not cards of their own
    const todo = [...files].filter((f) => !this.models[f]);
    let done = 0;
    await Promise.all(todo.map(async (f) => {
      this.models[f] = await this.loader.loadAsync(`assets/${f}.glb`);
      onProgress && onProgress(++done / todo.length);
    }));
  }

  cardByName(name) {
    if (!this._byName) {
      this._byName = {};
      for (const c of Object.values(this.meta.cards)) this._byName[c.name] = c;
    }
    return this._byName[name] || { name };
  }

  // One actor for a card (or a spawned unit): {root, mixer, actions, clips, proc, mount, h}.
  buildActor(name, team, entity = null, card = null) {
    const look = lookFor(card || this.cardByName(name), entity);
    if (look.proc) {
      const p = buildProc(look);
      return { root: p.root, proc: p, h: 1.2 * (look.size || 1), look };
    }
    if (!this.models[look.model]) {  // not loaded (should not happen after ensureModels): a stand-in
      const p = buildProc({ proc: "golem", color: "#999", size: 0.7 });
      return { root: p.root, proc: p, h: 1, look };
    }
    const ch = this.character(look.model, team, look);
    const group = new THREE.Group();
    const h = look.h || 1.4;
    let mount = null;
    if (look.mount) {
      const color = look.mountColor || { pig: "#f0a4a4", horse: "#9a6a3a", ram: "#c8c8c8" }[look.mount];
      mount = PROC.pig(color);
      mount.root.scale.setScalar(1.35);
      if (look.mount === "horse") mount.root.scale.set(1.3, 1.55, 1.6);
      if (look.mount === "ram") for (const x of [-0.18, 0.18]) {
        const horn = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 6, 10, Math.PI * 1.3), toonMat("#e8dcc0"));
        horn.position.set(x, 0.7, 0.55); horn.rotation.y = Math.PI / 2; mount.root.add(horn);
      }
      group.add(mount.root);
    }
    this.fitHeight(ch.root, h);
    for (const [bone, prop] of look.attach || []) this.attachToBone(ch.root, bone, prop);
    if (mount) ch.root.position.set(0, 0.68 * (look.mount === "horse" ? 1.45 : 1), -0.07);
    if (look.hover) ch.root.position.y += look.hover;
    group.add(ch.root);
    return { root: group, model: ch.root, mixer: ch.mixer, actions: ch.actions, clips: clipsFor(look), mount, h, look };
  }

  // ------------------------------------------------------------------ card portraits
  // Each card's own model, rendered once into a small image for the hand (no game art involved).
  // Rendered with the arena's own renderer into an off-screen target: a second WebGL context per call made
  // iOS Safari (which keeps very few contexts) throw away the arena's, leaving the battle black.
  portraits(cardNames) {
    const W = 160, H = 200;
    const r = this.renderer;
    if (!this._rt) {
      this._rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
      this._rt.texture.colorSpace = THREE.SRGBColorSpace;
      this._px = new Uint8Array(W * H * 4);
      this._pc = document.createElement("canvas"); this._pc.width = W; this._pc.height = H;
    }
    const ctx2 = this._pc.getContext("2d");
    const img = ctx2.createImageData(W, H);
    const prevAlpha = r.getClearAlpha();
    const out = {};
    for (const name of cardNames) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight("#fff6e0", "#506070", 2.0));
      const sun = new THREE.DirectionalLight("#ffffff", 1.8); sun.position.set(2, 4, 5); scene.add(sun);
      const holder = new THREE.Group();
      if (SPELL_LOOK[name]) {
        const look = SPELL_LOOK[name];
        const sp = makeSpell(name, 0);
        holder.add(sp);
        if (look.roll) holder.scale.setScalar(0.45);
        if (look.area) { sp.rotation.x = 1.1; sp.scale.setScalar(0.5); }  // tilt the disc towards the camera
      } else {
        const a = this.buildActor(name, 0);
        if (a.actions) { const idle = a.actions[a.clips.idle]; if (idle) { idle.play(); a.mixer.update(0.3); } }
        holder.add(a.root);
      }
      holder.rotation.y = 0.5;
      scene.add(holder);
      const box = new THREE.Box3().setFromObject(holder);
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
      const dist = Math.max(size.y, size.x * H / W, 0.4) / (2 * Math.tan(THREE.MathUtils.degToRad(15))) * 1.15;
      cam.position.set(c.x, c.y + size.y * 0.15, c.z + dist);
      cam.lookAt(c);
      r.setRenderTarget(this._rt);
      r.setClearAlpha(0);
      r.clear();
      r.render(scene, cam);
      r.readRenderTargetPixels(this._rt, 0, 0, W, H, this._px);
      for (let y = 0; y < H; y++) img.data.set(this._px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4); // flip
      ctx2.putImageData(img, 0, 0);
      out[name] = this._pc.toDataURL("image/png");
    }
    r.setRenderTarget(null);
    r.setClearAlpha(prevAlpha);
    return out;
  }

  // ------------------------------------------------------------------ overlay (legal tiles, ghost)
  buildOverlay() {
    const geo = new THREE.PlaneGeometry(0.94, 0.94);
    geo.rotateX(-Math.PI / 2);
    this.tileMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false }), 576);
    const m4 = new THREE.Matrix4();
    for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 18; tx++) {
      m4.makeTranslation(wx(tx + 0.5), 0.04, wz(ty + 0.5));
      this.tileMesh.setMatrixAt(ty * 18 + tx, m4);
      this.tileMesh.setColorAt(ty * 18 + tx, new THREE.Color("#ffffff"));
    }
    this.tileMesh.visible = false;
    this.scene.add(this.tileMesh);
    this.ghostRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, depthWrite: false }));
    this.ghostDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.22, depthWrite: false }));
    this.ghost = new THREE.Group();
    this.ghost.add(this.ghostRing, this.ghostDisc);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.lastMaskKey = "";
  }

  setOverlay(ui) {
    const slot = ui.selected;
    const show = slot >= 0 && ui.mask && ui.inGame;
    this.tileMesh.visible = !!show;
    this.ghost.visible = false;
    if (this.activeGhost) this.activeGhost.visible = false;
    if (!show) return;
    const key = slot + ":" + ui.maskVersion;
    if (key !== this.lastMaskKey) {
      this.lastMaskKey = key;
      const legal = new THREE.Color("#ffffff"), bad = new THREE.Color("#ff3344");
      for (let i = 0; i < 576; i++) this.tileMesh.setColorAt(i, ui.mask[slot * 576 + i] ? legal : bad);
      this.tileMesh.instanceColor.needsUpdate = true;
    }
    const h = ui.hover;
    if (!h) return;
    const card = this.meta.cards[ui.hand[slot]] || {};
    const spell = card.placement === 2 || card.placement === 3 || card.placement === 4;
    const r = spell ? ({ Fireball: 2.5, Log: 1.95 }[card.name] || 2.5) : Math.max(0.6, (card.radius || 0.5) * 1.6);
    const ok = ui.mask[slot * 576 + h.ty * 18 + h.tx] === 1;
    // the unit itself, translucent, floating over the tile (troops and buildings)
    const gm = spell ? null : this.ghostModel(card.name);
    if (this.activeGhost && this.activeGhost !== gm) this.activeGhost.visible = false;
    this.activeGhost = gm;
    if (gm) {
      gm.visible = true;
      const t = performance.now() / 1000;
      gm.position.set(wx(h.tx + 0.5), 0.25 + Math.sin(t * 5) * 0.12, wz(h.ty + 0.5));
      gm.traverse((o) => { if (o.isMesh && o.material && o.material.color && !o.userData.ring) o.material.color.copy(ok ? GHOST_OK : GHOST_BAD); });
    }
    this.ghost.visible = true;
    this.ghost.position.set(wx(h.tx + 0.5), 0.06, wz(h.ty + 0.5));
    this.ghost.scale.setScalar(r);
    this.ghostRing.material.color.set(ok ? "#ffffff" : "#ff3344");
    this.ghostDisc.material.color.set(ok ? "#ffffff" : "#ff3344");
  }

  // A translucent copy of a card's unit, built once per card.
  ghostModel(name) {
    this.ghosts = this.ghosts || {};
    if (name in this.ghosts) return this.ghosts[name];
    let root = null;
    if (!SPELL_LOOK[name]) {
      const a = this.buildActor(name, 0);
      if (a.actions) { const idle = a.actions[a.clips.idle]; if (idle) { idle.play(); a.mixer.update(0.2); } }
      root = new THREE.Group();
      root.add(a.root);
      root.rotation.y = Math.PI; // facing the enemy
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.material = new THREE.MeshLambertMaterial({ color: GHOST_OK, emissive: "#3a5f8a", transparent: true, opacity: 0.72, depthWrite: false });
        o.frustumCulled = false;
      });
      root.visible = false;
      this.scene.add(root);
    }
    this.ghosts[name] = root;
    return root;
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, p)) return null;
    const x = p.x + 9, y = 16 - p.z;
    if (x < 0 || x >= 18 || y < 0 || y >= 32) return null;
    return { tx: Math.floor(x), ty: Math.floor(y) };
  }

  // ------------------------------------------------------------------ actors
  character(name, team, look = null) {
    const g = this.models[name];
    const root = SkeletonUtils.clone(g.scene);
    const weapons = WEAPON_MESHES[name] || [];
    const tint = look && look.tint ? new THREE.Color(look.tint) : null;
    root.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        if (look && weapons.includes(o.name) && !(look.show || []).includes(o.name)) { o.visible = false; return; }
        // Own materials per unit: flashes and fades must not leak to every unit of the same type.
        o.material = o.material.clone();
        if (/Cape|Cloak/.test(o.name)) o.material.color = TEAM[team].clone().lerp(new THREE.Color("#ffffff"), 0.15);
        else if (tint && !weapons.includes(o.name)) o.material.color.multiply(tint);
        if (look && look.ghostly) { o.material.transparent = true; o.material.opacity = 0.6; }
      }
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const clip of g.animations) actions[clip.name] = mixer.clipAction(clip);
    return { root, mixer, actions };
  }

  fitHeight(obj, h) {
    const box = new THREE.Box3().setFromObject(obj);
    const s = h / Math.max(0.01, box.max.y - box.min.y);
    obj.scale.setScalar(s);
  }

  attachToBone(root, boneName, model) {
    let bone = null;
    root.traverse((o) => { if (o.isBone && o.name === boneName) bone = o; });
    if (!bone) return;
    const w = this.models[model].scene.clone(true);
    bone.add(w);
  }

  blobShadow(radius) {
    if (!this._shadowTex) {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const g = c.getContext("2d"); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      gr.addColorStop(0, "rgba(0,0,0,0.45)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      this._shadowTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this._shadowTex, transparent: true, depthWrite: false }));
    m.scale.setScalar(radius * 2.4);
    m.position.y = 0.03;
    return m;
  }

  teamRing(team, radius) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: TEAM[team], transparent: true, opacity: 0.75, depthWrite: false }));
    m.scale.setScalar(radius * 1.15);
    m.position.y = 0.035;
    return m;
  }

  hpBar(width, label = false) {
    // Both quads transparent with no depth test: three.js draws transparent objects after opaque ones, so a
    // transparent background over an opaque fill would hide the fill. Same pass + renderOrder keeps it on top.
    const g = new THREE.Group();
    const h = label ? 0.3 : 0.2;
    const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity });
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.08, h + 0.08), mat("#000000", 0.85));
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width, h), mat("#3a3a3a", 1));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(width, h), mat("#ffffff", 1));
    edge.renderOrder = 1000; bg.renderOrder = 1001; fg.renderOrder = 1002;
    g.add(edge, bg, fg);
    let text = null;
    if (label) {
      const c = document.createElement("canvas"); c.width = 128; c.height = 40;
      text = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false }));
      text.position.y = h / 2 + 0.3;
      text.renderOrder = 1003;
      text.userData = { canvas: c, value: null };
      g.add(text);
    }
    g.quaternion.copy(this.camera.quaternion);
    g.userData = { fg, width, text };
    return g;
  }

  setHp(bar, p, team, hp) {
    const { fg, width, text } = bar.userData;
    const w = Math.max(0.001, Math.min(1, p));
    fg.scale.x = w;
    fg.position.x = -width * (1 - w) / 2;
    // bright team colour; turns orange then red as it drops
    fg.material.color.copy(w > 0.5 ? TEAM_BAR[team] : w > 0.25 ? HP_LOW : HP_CRIT);
    if (text && hp !== undefined && text.userData.value !== hp) {
      text.userData.value = hp;
      const g = text.userData.canvas.getContext("2d");
      g.clearRect(0, 0, 128, 40);
      g.font = "bold 30px sans-serif"; g.textAlign = "center"; g.lineWidth = 6; g.strokeStyle = "#000";
      g.strokeText(String(hp), 64, 31); g.fillStyle = "#fff"; g.fillText(String(hp), 64, 31);
      text.material.map.needsUpdate = true;
    }
  }


  makeUnit(e) {
    const card = this.meta.cards[e[E.CARD]] || { name: "?" };
    const team = e[E.TEAM];
    const radius = Math.max(0.3, e[E.R]);
    const unit = { uid: e[E.UID], team, card: card.name, holder: new THREE.Group(), body: new THREE.Group(), state: "",
      lastX: e[E.X], lastY: e[E.Y], yaw: team === 0 ? Math.PI : 0, flash: 0, hp: e[E.HP], born: performance.now() };
    unit.holder.add(this.blobShadow(radius), this.teamRing(team, radius), unit.body);
    const a = this.buildActor(card.name, team, e, this.meta.cards[e[E.CARD]] || null);
    addOutline(a.root, a.actions ? 0.035 : 0.03);
    unit.body.add(a.root);
    unit.look = a.look;
    if (a.actions) { unit.mixer = a.mixer; unit.actions = a.actions; unit.clips = a.clips; unit.model = a.model; }
    if (a.proc) unit.proc = a.proc;
    if (a.mount) unit.pig = { legs: a.mount.legs, position: a.mount.root.position };
    if (e[E.FLY]) unit.body.position.y = FLY_H;
    const barW = Math.max(0.7, radius * 2);
    unit.bar = this.hpBar(barW);
    unit.bar.position.y = a.h + (a.mount ? 0.7 : 0) + (e[E.FLY] ? FLY_H : 0) + 0.35;
    unit.bar.visible = false;
    unit.holder.add(unit.bar);
    this.scene.add(unit.holder);
    this.play(unit, e[E.DEPLOY] > 0 && unit.clips && unit.clips.spawn ? "spawn" : "idle");
    return unit;
  }

  play(unit, state) {
    if (unit.state === state) return;
    unit.state = state;
    if (!unit.actions) return;
    const name = unit.clips[state] || unit.clips.idle;
    const next = unit.actions[name];
    if (!next) return;
    const once = state === "death" || state === "spawn" || state === "attack";
    next.reset();
    next.setLoop(once && state !== "attack" ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = state === "death";
    if (unit.current && unit.current !== next) next.crossFadeFrom(unit.current, 0.15, false);
    next.play();
    unit.current = next;
  }

  makeTower(e) {
    const team = e[E.TEAM];
    const king = e[E.KIND] === KIND.KING;
    const t = { uid: e[E.UID], team, king, holder: new THREE.Group(), x: e[E.X], y: e[E.Y], hp: e[E.HP], shake: 0 };
    const model = this.placeModel(`${king ? "castle" : "tower"}_${team ? "red" : "blue"}`, { width: king ? 3.6 : 2.7, depth: king ? 3.6 : 2.7 });
    model.scale.y = king ? 0.85 : 0.72;
    t.holder.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const top = box.max.y;
    const ch = this.character(king ? "king" : "archer", team);
    this.fitHeight(ch.root, king ? 1.25 : 1.05);
    addOutline(ch.root, 0.035);
    ch.root.position.set(0, top - (king ? 0.35 : 0.15), 0.25);
    ch.root.rotation.y = team === 0 ? Math.PI : 0;
    t.holder.add(ch.root);
    t.guard = { mixer: ch.mixer, actions: ch.actions, root: ch.root, state: "" };
    t.bar = this.hpBar(king ? 2.6 : 2.0, true);
    t.bar.position.y = top + 1.6;
    t.holder.add(t.bar);
    t.holder.position.set(wx(e[E.X]), 0, wz(e[E.Y]));
    this.scene.add(t.holder);
    return t;
  }

  guardPlay(t, name) {
    const g = t.guard;
    if (g.state === name) return;
    const a = g.actions[name];
    if (!a) return;
    a.reset().play();
    if (g.cur && g.cur !== a) a.crossFadeFrom(g.cur, 0.2, false);
    g.cur = a; g.state = name;
  }

  // ------------------------------------------------------------------ per frame
  reset() {
    for (const u of this.units.values()) this.scene.remove(u.holder);
    for (const t of this.towers.values()) this.scene.remove(t.holder);
    for (const d of this.dying) this.scene.remove(d.holder);
    for (const f of this.fx) this.scene.remove(f.obj);
    for (const s of this.spells.values()) this.scene.remove(s.obj);
    this.units.clear(); this.towers.clear(); this.spells.clear();
    this.dying = []; this.fx = [];
  }

  render(cur, ui) {
    const dt = Math.min(0.1, this.clock.getDelta());
    const now = performance.now();
    this.waterMat.uniforms.t.value += dt;
    if (cur) this.sync(cur, dt, now);
    for (const u of this.units.values()) {
      u.mixer && u.mixer.update(dt);
      u.proc && u.proc.update(dt, u);
      if (u.pig) { // gallop
        u.gait = (u.gait || 0) + dt * (u.moving ? 16 : 0);
        u.pig.legs.forEach((l, i) => { l.rotation.x = u.moving ? Math.sin(u.gait + (i % 2 ? Math.PI : 0)) * 0.7 : 0; });
        u.pig.position.y = u.moving ? Math.abs(Math.sin(u.gait)) * 0.08 : 0;
      }
    }
    for (const t of this.towers.values()) t.guard.mixer.update(dt);
    this.updateDying(dt, now);
    this.updateFx(dt, now);
    this.setOverlay(ui);
    this.renderer.render(this.scene, this.camera);
  }

  sync(cur, dt, now) {
    const f = cur.f;
    const seen = new Set();
    for (const e of cur.ents) {
      const uid = e[E.UID];
      seen.add(uid);
      if (e[E.KIND] >= KIND.KING) { this.syncTower(e, f, dt); continue; }
      let u = this.units.get(uid);
      if (!u) { u = this.makeUnit(e); this.units.set(uid, u); }
      this.syncUnit(u, e, dt, now, cur.ents);
    }
    for (const [uid, u] of this.units) if (!seen.has(uid)) this.kill(u, now);
    for (const [uid, t] of this.towers) if (!seen.has(uid)) this.destroyTower(t, now);
    this.syncSpells(f, now);
    this.syncProjectiles(f);
  }

  syncUnit(u, e, dt, now, ents) {
    const X = wx(e[E.X]), Z = wz(e[E.Y]);
    const moved = Math.hypot(e[E.X] - u.lastX, e[E.Y] - u.lastY);
    u.holder.position.set(X, 0, Z);
    // Facing: the engine's direction when it gives one, else the target, else the way it moves.
    let dx = e[E.FX], dz = -e[E.FY];
    const tgt = e[E.TARGET] >= 0 ? ents.find((o) => o[E.UID] === e[E.TARGET]) : null;
    if (tgt && e[E.PHASE] > 0) { dx = tgt[E.X] - e[E.X]; dz = -(tgt[E.Y] - e[E.Y]); }
    else if (moved > 0.004) { dx = e[E.X] - u.lastX; dz = -(e[E.Y] - u.lastY); }
    if (Math.abs(dx) + Math.abs(dz) > 1e-6) {
      const want = Math.atan2(dx, dz);
      let d = want - u.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      u.yaw += d * Math.min(1, dt * 12);
    }
    u.body.rotation.y = u.yaw;
    u.lastX = e[E.X]; u.lastY = e[E.Y];
    // Animation state from the engine's own fields.
    let state = "idle";
    if (e[E.DEPLOY] > 0) state = u.clips && u.clips.spawn ? "spawn" : "idle";
    else if (e[E.PHASE] > 0 && e[E.TARGET] >= 0) state = "attack";
    else if (moved > 0.004) state = "move";
    if (state === "attack" && u.state !== "attack") sfx((u.look && (STYLE_SFX[u.look.style] || PROC_SFX[u.look.proc])) || "swing", 60);
    if (u.state !== "spawn" || e[E.DEPLOY] <= 0) this.play(u, state);
    u.moving = state === "move";
    u.attacking = state === "attack";
    // Deploying: drop in from above, translucent.
    const dep = e[E.DEPLOY] > 0;
    u.body.position.y = (e[E.FLY] ? FLY_H : 0) + (dep ? Math.min(1.2, e[E.DEPLOY] * 0.06) : 0) + this.riverJump(u, e);
    u.body.traverse((o) => { if (o.isMesh && o.material) { o.material.transparent = dep; o.material.opacity = dep ? 0.55 : 1; } });
    // Stun: freeze the animation.
    if (u.mixer) u.mixer.timeScale = e[E.STUN] > 0 ? 0 : 1;
    // Hit flash and HP bar.
    if (e[E.HP] < u.hp) u.flash = 0.12;
    u.hp = e[E.HP];
    u.flash = Math.max(0, u.flash - dt);
    u.body.traverse((o) => { if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setScalar(u.flash > 0 ? 0.6 : 0); });
    u.bar.visible = e[E.HP] < e[E.MAXHP];
    if (u.bar.visible) this.setHp(u.bar, e[E.HP] / e[E.MAXHP], u.team);
  }

  // A ground unit the engine moves across the water away from the bridges is jumping the river (Hog Rider):
  // an arc over the water band, highest mid-river.
  riverJump(u, e) {
    const w = this.water;
    if (!w || e[E.FLY]) return 0;
    const y = e[E.Y], x = e[E.X];
    const margin = 0.6;
    if (y < w.yBot - margin || y > w.yTop + margin) return 0;
    if (w.bridges.some(([a, b]) => x >= a - 0.2 && x <= b + 0.2)) return 0;
    const p = (y - (w.yBot - margin)) / (w.yTop - w.yBot + 2 * margin);
    return Math.sin(Math.PI * Math.min(1, Math.max(0, p))) * 1.4;
  }

  kill(u, now) {
    this.units.delete(u.uid);
    u.diedAt = now;
    if (u.actions && u.clips.death) this.play(u, "death");
    u.bar.visible = false;
    this.dying.push(u);
    this.burst(u.holder.position, u.team === 0 ? "#9cc4ff" : "#ff98a2", 6, 0.6);
    sfx(u.card === "IceSpirits" || u.card === "IceGolemite" ? "ice" : "pop", 50);
  }

  updateDying(dt, now) {
    this.dying = this.dying.filter((u) => {
      const age = (now - u.diedAt) / 1000;
      u.mixer && u.mixer.update(dt);
      if (age > 0.7) {
        const k = Math.max(0, 1 - (age - 0.7) / 0.5);
        u.holder.traverse((o) => { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = k; } });
      }
      if (age > 1.2) { this.scene.remove(u.holder); return false; }
      return true;
    });
  }

  syncTower(e, f, dt) {
    let t = this.towers.get(e[E.UID]);
    if (!t) { t = this.makeTower(e); this.towers.set(e[E.UID], t); }
    if (e[E.HP] < t.hp) { t.shake = 0.15; this.floatText(t, `-${t.hp - e[E.HP]}`); }
    t.hp = e[E.HP];
    t.shake = Math.max(0, t.shake - dt);
    t.holder.position.x = wx(t.x) + (t.shake > 0 ? (Math.random() - 0.5) * 0.12 : 0);
    this.setHp(t.bar, e[E.HP] / e[E.MAXHP], t.team, e[E.HP]);
    t.bar.visible = true;
    const awake = !t.king || f.kings[t.team];
    if (e[E.PHASE] > 0 && e[E.TARGET] >= 0) {
      if (t.guard.state !== (t.king ? "Throw" : "2H_Ranged_Shoot")) sfx(t.king ? "cannon" : "arrow", 120);
      this.guardPlay(t, t.king ? "Throw" : "2H_Ranged_Shoot");
    }
    else this.guardPlay(t, awake ? (t.king ? "Idle" : "2H_Melee_Idle") : "Sit_Floor_Idle");
    const tgtId = e[E.TARGET];
    if (tgtId >= 0) {
      const tg = f.e.find((o) => o[E.UID] === tgtId);
      if (tg) t.guard.root.rotation.y = Math.atan2(tg[E.X] - t.x, -(tg[E.Y] - t.y));
    }
  }

  destroyTower(t, now) {
    this.towers.delete(t.uid);
    this.burst(t.holder.position, "#bdb6a6", 26, 1.8);
    this.burst(t.holder.position, "#6b6457", 14, 1.4);
    t.bar.visible = false;
    // Replace the tower with a pile of rubble.
    while (t.holder.children.length) t.holder.remove(t.holder.children[0]);
    const r = mulberry32(t.uid * 97 + 3);
    const stone = toon("#8f8a80"), dark = toon("#5f5b55");
    const size = t.king ? 3.4 : 2.6;
    for (let i = 0; i < 16; i++) {
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + r() * 0.3, 0), r() < 0.6 ? stone : dark);
      b.position.set((r() - 0.5) * size, 0.1 + r() * 0.3, (r() - 0.5) * size);
      b.rotation.set(r() * 3, r() * 3, r() * 3);
      t.holder.add(b);
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.55, size * 0.6, 0.25, 8), dark);
    base.position.y = 0.12;
    t.holder.add(base);
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: "#777", transparent: true, opacity: 0.5, depthWrite: false }));
    smoke.position.y = 1;
    t.holder.add(smoke);
    this.fx.push({ obj: smoke, born: performance.now(), life: 2500, update: (k) => { smoke.position.y = 1 + k * 2.5; smoke.scale.setScalar(1 + k * 2); smoke.material.opacity = 0.5 * (1 - k); } });
    this.camShake = 0.35;
    sfx("crash", 200);
  }

  // ------------------------------------------------------------------ spells, projectiles, effects
  syncSpells(f, now) {
    const live = new Set();
    const t = now / 1000;
    for (const sp of f.sp) {
      const [team, cid, motion, x, y, ax, ay] = sp;
      const card = (this.meta.cards[cid] || {}).name || "?";
      const look = SPELL_LOOK[card] || { area: "#9fe8ff", radius: 2.5 };
      const key = `${team}:${cid}:${ax}:${ay}`;
      live.add(key);
      let v = this.spells.get(key);
      if (!v) {
        v = { obj: makeSpell(card, team, motion), card, look, team, ax, ay, startX: x, startY: y };
        if (look.roll) sfx("roll", 300);
        this.spells.set(key, v);
        this.scene.add(v.obj);
      }
      v.last = { x, y, motion };
      if (look.roll) {                                  // The Log, Barbarian Barrel
        v.obj.position.set(wx(x), motion === 1 ? 1.2 : 0.45, wz(y));
        v.obj.rotation.x += motion === 2 ? 0.35 : 0;
      } else if (motion === 0) {                        // flying to its target
        const total = Math.hypot(ax - v.startX, ay - v.startY) || 1;
        const p = 1 - Math.hypot(ax - x, ay - y) / total;
        v.obj.position.set(wx(x), 0.6 + Math.sin(Math.PI * p) * Math.min(6, total * 0.35), wz(y));
        if (look.fly === "rocket" || look.fly === "arrows") v.obj.lookAt(wx(ax), 0, wz(ay));
        else v.obj.rotation.y += 0.2;
      } else {                                          // an area on the ground
        v.obj.position.set(wx(x), 0.06, wz(y));
        const pulse = 1 + Math.sin(t * 6) * 0.04;
        v.obj.scale.set(pulse, 1, pulse);
        if (look.swirl) v.obj.rotation.y += 0.25;
        if (look.bolts && v.obj.userData.bolts) v.obj.userData.bolts.forEach((b, i) => { b.visible = Math.sin(t * 25 + i * 2) > 0.2; });
      }
    }
    for (const [key, v] of this.spells) {
      if (live.has(key)) continue;
      this.scene.remove(v.obj);
      this.spells.delete(key);
      const look = v.look;
      if (look.fly) this.explosion(wx(v.ax), wz(v.ay), look.radius || 2, look.color);
      else if (look.roll) this.burst(new THREE.Vector3(wx(v.last.x), 0, wz(v.last.y)), "#a77b4b", 10, 1.4);
      else this.burst(new THREE.Vector3(wx(v.last.x), 0, wz(v.last.y)), look.area || "#9fe8ff", 8, 1.2);
    }
  }

  syncProjectiles(f) {
    if (!this.projPool) this.projPool = [];
    while (this.projPool.length < f.pr.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: "#fff6c0" }));
      this.scene.add(m);
      this.projPool.push(m);
    }
    this.projPool.forEach((m, i) => {
      const p = f.pr[i];
      m.visible = !!p;
      if (!p) return;
      const [team, x, y, ax, ay, splash, firer] = p;
      const d = Math.hypot(ax - x, ay - y);
      m.position.set(wx(x), 1.1 + Math.min(1.5, d * 0.12), wz(y));
      m.material.color.set(firer === -1 ? (team ? "#ffd0d6" : "#d6e7ff") : splash > 0 ? "#333" : "#fff6c0");
      m.scale.setScalar(splash > 0 ? 2.2 : 1);
    });
  }

  burst(pos, color, n, spread) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09 + Math.random() * 0.08, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.position.set(pos.x, 0.3 + Math.random() * 0.4, pos.z);
      const v = new THREE.Vector3((Math.random() - 0.5) * spread * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * spread * 4);
      this.scene.add(m);
      this.fx.push({ obj: m, born: performance.now(), life: 700, update: (k, dt) => { v.y -= 9 * dt; m.position.addScaledVector(v, dt); m.material.opacity = 1 - k; } });
    }
  }

  explosion(x, z, radius, color) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    ring.position.set(x, 0.08, z);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
    ball.position.set(x, 0.4, z);
    this.scene.add(ring, ball);
    this.fx.push({ obj: ring, born: performance.now(), life: 550, update: (k) => { ring.scale.setScalar(radius * (0.3 + k)); ring.material.opacity = 1 - k; } });
    this.fx.push({ obj: ball, born: performance.now(), life: 450, update: (k) => { ball.scale.setScalar(radius * 0.7 * (0.4 + k)); ball.material.opacity = 0.8 * (1 - k); } });
    this.burst(new THREE.Vector3(x, 0, z), color, 10, radius * 0.5);
    this.camShake = Math.max(this.camShake || 0, 0.12);
    sfx(color === "#9fe8ff" ? "ice" : "boom", 100);
  }

  floatText(t, text) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 48;
    const g = c.getContext("2d");
    g.font = "bold 34px sans-serif"; g.textAlign = "center"; g.lineWidth = 5; g.strokeStyle = "#000";
    g.strokeText(text, 64, 36); g.fillStyle = "#fff"; g.fillText(text, 64, 36);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    sp.scale.set(1.6, 0.6, 1);
    sp.renderOrder = 20;
    const base = t.bar.position.clone().add(t.holder.position);
    sp.position.copy(base);
    this.scene.add(sp);
    this.fx.push({ obj: sp, born: performance.now(), life: 800, update: (k) => { sp.position.y = base.y + k * 1.2; sp.material.opacity = 1 - k; } });
  }

  playFx(p) {
    sfx("place", 30);
    // a card landing: a ring of the player's colour
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: TEAM[p.team], transparent: true, depthWrite: false }));
    ring.position.set(wx(p.x), 0.07, wz(p.y));
    this.scene.add(ring);
    this.fx.push({ obj: ring, born: performance.now(), life: 700, update: (k) => { ring.scale.setScalar(0.4 + k * 1.6); ring.material.opacity = 1 - k; } });
  }

  updateFx(dt, now) {
    this.fx = this.fx.filter((f) => {
      const k = (now - f.born) / f.life;
      if (k >= 1) { if (f.obj.parent) f.obj.parent.remove(f.obj); return false; }
      f.update(k, dt);
      return true;
    });
    if (this.camShake > 0) {
      this.camShake = Math.max(0, this.camShake - dt);
      this.camera.position.x = (Math.random() - 0.5) * this.camShake * 0.6;
    } else this.camera.position.x = 0;
  }
}

// ------------------------------------------------------------------ cartoon outline (inverted hull)
// A copy of each mesh, pushed out along its normals and drawn back faces only, in black: only a rim shows.
function outlineMaterial(thickness) {
  const m = new THREE.MeshBasicMaterial({ color: "#1a1410", side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>",
      `#include <begin_vertex>
      transformed += normalize(normal) * ${thickness.toFixed(4)};`);
  };
  m.userData.outline = true;
  return m;
}

function addOutline(root, thickness) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !(o.material && o.material.userData && o.material.userData.outline)) meshes.push(o); });
  const mat = outlineMaterial(thickness);
  for (const o of meshes) {
    let line;
    if (o.isSkinnedMesh) {
      line = new THREE.SkinnedMesh(o.geometry, mat);
      line.bind(o.skeleton, o.bindMatrix);
    } else {
      line = new THREE.Mesh(o.geometry, mat);
    }
    line.position.copy(o.position); line.quaternion.copy(o.quaternion); line.scale.copy(o.scale);
    line.frustumCulled = false;
    line.renderOrder = -1;
    o.parent.add(line);
  }
}

// ------------------------------------------------------------------ procedural models
function toon(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, flatShading: true, ...extra }); }


function makeBridge(width, length) {
  const g = new THREE.Group();
  const wood = toon("#a8743f"), dark = toon("#6e4721");
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, length), wood);
  deck.position.y = 0.12;
  g.add(deck);
  for (let z = -length / 2 + 0.2; z < length / 2; z += 0.38) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.05, 0.05), dark);
    plank.position.set(0, 0.23, z);
    g.add(plank);
  }
  for (const x of [-width / 2, width / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, length), dark);
    rail.position.set(x, 0.5, 0);
    g.add(rail);
    for (let z = -length / 2 + 0.1; z <= length / 2; z += length / 3) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), dark);
      post.position.set(x, 0.3, z);
      g.add(post);
    }
  }
  return g;
}

function makeSpell(card, team, motion = 0) {
  const look = SPELL_LOOK[card] || { area: "#9fe8ff", radius: 2.5 };
  const g = new THREE.Group();
  if (look.roll) {
    const len = look.roll;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, len, 12).rotateZ(Math.PI / 2), toon(look.color)));
    const ring = new THREE.Mesh(new THREE.CircleGeometry(0.4, 12).rotateY(Math.PI / 2), toon("#d9b07a"));
    ring.position.x = len / 2 + 0.01;
    const ring2 = ring.clone(); ring2.position.x = -len / 2 - 0.01; ring2.rotation.y = -Math.PI / 2;
    g.add(ring, ring2);
    return g;
  }
  if (look.fly) {
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
    if (look.fly === "ball") { g.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), basic(look.color))); g.add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), basic("#ffe08a"))); }
    else if (look.fly === "snow") g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), toon("#ffffff")));
    else if (look.fly === "barrel") g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.7, 10), toon(look.color)));
    else if (look.fly === "box") g.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), toon(look.color)));
    else if (look.fly === "rocket") {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 10).rotateX(Math.PI / 2), toon("#d0d0d8"));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 10).rotateX(Math.PI / 2), toon(look.color));
      tip.position.z = 0.8;
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8).rotateX(-Math.PI / 2), basic("#ffb040"));
      fire.position.z = -0.85;
      g.add(body, tip, fire);
    } else if (look.fly === "arrows") {
      for (let i = 0; i < 9; i++) {
        const a = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 4).rotateX(Math.PI / 2), toon(look.color));
        a.position.set((i % 3 - 1) * 0.6, (Math.floor(i / 3) - 1) * 0.3, (Math.floor(i / 3) - 1) * 0.4);
        g.add(a);
      }
    }
    return g;
  }
  // an area: a translucent disc of the spell's radius with a rim
  const r = look.radius || 2.5;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: look.area, transparent: true, opacity: 0.35, depthWrite: false }));
  const rim = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: look.area, transparent: true, opacity: 0.85, depthWrite: false }));
  g.add(disc, rim);
  if (look.swirl) for (let i = 0; i < 3; i++) {
    const arm = new THREE.Mesh(new THREE.TorusGeometry(r * (0.35 + i * 0.2), 0.06, 4, 24, Math.PI), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.6 }));
    arm.rotation.x = -Math.PI / 2; arm.position.y = 0.3 + i * 0.3; g.add(arm);
  }
  if (look.bolts) {
    g.userData.bolts = [];
    for (let i = 0; i < 3; i++) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.02, 6, 5), new THREE.MeshBasicMaterial({ color: "#fffbd0" }));
      bolt.position.set((i - 1) * r * 0.5, 3, (i % 2) * r * 0.3);
      g.add(bolt); g.userData.bolts.push(bolt);
    }
  }
  return g;
}

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

window.Renderer3D = Renderer3D;
window.dispatchEvent(new Event("renderer3d-loaded"));
