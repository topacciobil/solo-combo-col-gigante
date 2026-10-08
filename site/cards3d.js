// How each card looks on the 2.5D arena: a KayKit CC0 character with its own weapons, size, colour and
// attack style, or a procedural model (flyers, golems, spirits, buildings). The engine decides what a
// card does; this table only decides what it looks like. Anything not listed gets a sensible default
// from the engine's own data (flying, radius, hit points).
import * as THREE from "three";

// The weapon/accessory meshes each full character carries; every one not listed in a spec is hidden.
export const WEAPON_MESHES = {
  knight_full: ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Round_Shield", "Spike_Shield", "1H_Sword", "2H_Sword", "Knight_Helmet"],
  barbarian_full: ["1H_Axe_Offhand", "Barbarian_Round_Shield", "1H_Axe", "2H_Axe", "Mug", "Barbarian_Hat"],
  mage_full: ["Spellbook", "Spellbook_open", "1H_Wand", "2H_Staff", "Mage_Hat"],
  rogue_full: ["Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Knife", "Throwable"],
  rogue_hooded_full: ["Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Knife", "Throwable"],
  skel_warrior: ["Skeleton_Warrior_Helmet"], skel_mage: ["Skeleton_Mage_Hat"], skel_rogue: ["Skeleton_Rogue_Hood"], skel_minion: [],
};

// Attack styles -> animation clips (the shared set the full characters carry).
const STYLE = {
  melee1: { idle: "Idle", move: "Running_A", attack: "1H_Melee_Attack_Chop" },
  melee2: { idle: "2H_Melee_Idle", move: "Running_A", attack: "2H_Melee_Attack_Chop" },
  heavy: { idle: "2H_Melee_Idle", move: "Walking_A", attack: "2H_Melee_Attack_Chop" },
  punch: { idle: "Idle", move: "Walking_A", attack: "Unarmed_Melee_Attack_Punch_A" },
  bow: { idle: "2H_Melee_Idle", move: "Running_A", attack: "2H_Ranged_Shoot" },
  shoot1: { idle: "Idle", move: "Running_A", attack: "1H_Ranged_Shoot" },
  cast: { idle: "Idle", move: "Walking_A", attack: "Spellcast_Shoot" },
  throw: { idle: "Idle", move: "Running_A", attack: "Throw" },
  ride: { idle: "Sit_Chair_Idle", move: "Sit_Chair_Idle", attack: "1H_Melee_Attack_Chop" },
};
const DEATH = "Death_A";

// character helpers: model, visible meshes, style, height in tiles, body tint, extras
const kn = (show, style, h, tint, x = {}) => ({ model: "knight_full", show, style, h, tint, ...x });
const ba = (show, style, h, tint, x = {}) => ({ model: "barbarian_full", show, style, h, tint, ...x });
const ma = (show, style, h, tint, x = {}) => ({ model: "mage_full", show, style, h, tint, ...x });
const ro = (show, style, h, tint, x = {}) => ({ model: "rogue_full", show, style, h, tint, ...x });
const rh = (show, style, h, tint, x = {}) => ({ model: "rogue_hooded_full", show, style, h, tint, ...x });
const sk = (model, attach, style, h, tint, x = {}) => ({ model, show: WEAPON_MESHES[model], attach, style, h, tint, ...x });
const P = (proc, color, size = 1, x = {}) => ({ proc, color, size, ...x });
const GREEN = "#8fdc6a";

export const CARD_LOOK = {
  // --- people
  Knight: kn(["1H_Sword", "Round_Shield", "Knight_Helmet"], "melee1", 1.55),
  Archer: rh(["2H_Crossbow"], "bow", 1.35, "#ffd0e0"),
  Goblins: ro(["Knife"], "melee1", 1.0, GREEN),
  Giant: ba([], "punch", 2.7, "#f2d2a0"),
  Pekka: kn(["2H_Sword", "Knight_Helmet"], "heavy", 2.2, "#6a5aa8"),
  Witch: ma(["2H_Staff", "Mage_Hat"], "cast", 1.6, "#c08ae0"),
  Barbarians: ba(["1H_Axe", "Barbarian_Hat"], "melee1", 1.45),
  Valkyrie: ba(["2H_Axe"], "melee2", 1.5, "#ffb070"),
  Musketeer: rh(["2H_Crossbow"], "bow", 1.55),
  Prince: kn(["2H_Sword", "Knight_Helmet"], "ride", 1.3, "#ffe08a", { mount: "horse" }),
  Wizard: ma(["2H_Staff", "Mage_Hat"], "cast", 1.6),
  MiniPekka: kn(["2H_Sword", "Knight_Helmet"], "melee2", 1.35, "#5a7ac8"),
  SpearGoblins: ro(["Throwable"], "throw", 1.0, GREEN),
  HogRider: ba(["1H_Axe", "Barbarian_Hat"], "ride", 1.15, null, { mount: "pig" }),
  IceWizard: ma(["2H_Staff", "Mage_Hat"], "cast", 1.6, "#a8e4ff"),
  RoyalGiant: ba([], "throw", 2.5, "#ffd76a"),
  Princess: rh(["2H_Crossbow"], "bow", 1.4, "#ffb6d6"),
  DarkPrince: kn(["2H_Sword", "Knight_Helmet", "Spike_Shield"], "ride", 1.3, "#5c5c6e", { mount: "horse", mountColor: "#3a3a44" }),
  ThreeMusketeers: rh(["2H_Crossbow"], "bow", 1.5, "#d0e0ff"),
  Miner: ba(["1H_Axe"], "melee1", 1.4, "#c8a070"),
  Bowler: ba([], "throw", 2.0, "#8fb0ff"),
  RageBarbarian: ba(["2H_Axe"], "melee2", 1.55, "#d08050"),
  BlowdartGoblin: ro(["1H_Crossbow"], "shoot1", 1.05, GREEN),
  GoblinGang: ro(["Knife"], "melee1", 1.0, GREEN),
  ElectroWizard: ma(["1H_Wand", "Mage_Hat"], "cast", 1.6, "#7fe8ff"),
  AngryBarbarians: ba(["1H_Axe", "1H_Axe_Offhand"], "melee1", 1.5, "#ff9a7a"),
  Hunter: rh(["2H_Crossbow"], "bow", 1.65, "#c8a080"),
  AxeMan: ba(["2H_Axe", "Barbarian_Hat"], "melee2", 1.75, "#7a6a90"),
  Assassin: ro(["Knife", "Knife_Offhand"], "melee1", 1.35, "#d8b0ff"),
  RoyalRecruits: kn(["1H_Sword", "Rectangle_Shield", "Knight_Helmet"], "melee1", 1.4),
  DarkWitch: ma(["1H_Wand", "Mage_Hat"], "cast", 1.65, "#7a5aa0"),
  Ghost: kn(["1H_Sword"], "melee1", 1.5, "#d8f0ff", { ghostly: true, hover: 0.25 }),
  RamRider: ba(["Throwable"], "ride", 1.1, "#ffb0c0", { mount: "ram" }),
  Rascals: ba([], "punch", 1.6, "#ffd0a0"),
  MegaKnight: kn(["2H_Sword", "Knight_Helmet", "Spike_Shield"], "heavy", 2.4, "#4a4a5a"),
  Wallbreakers: sk("skel_minion", [["handslot.r", "barrel"]], "melee1", 1.05),
  GoblinGiant: ba([], "punch", 2.6, GREEN),
  Fisherman: ba(["1H_Axe", "Barbarian_Hat"], "melee1", 1.6, "#a0c8e0"),
  EliteArcher: rh(["2H_Crossbow"], "bow", 1.55, "#9ae08a"),
  Firecracker: ro(["2H_Crossbow"], "bow", 1.35, "#ffb060"),
  MightyMiner: ba(["2H_Axe"], "melee2", 1.65, "#ffb050"),
  BattleHealer: kn(["1H_Sword", "Badge_Shield", "Knight_Helmet"], "melee1", 1.6, "#ffe6a0"),
  ArcherQueen: rh(["2H_Crossbow"], "bow", 1.7, "#c89aff"),
  GoldenKnight: kn(["1H_Sword", "Knight_Helmet"], "melee1", 1.65, "#ffd24a"),
  Monk: ba([], "punch", 1.6, "#ffb070"),
  GoblinDemolisher: ro(["Throwable"], "throw", 1.15, GREEN),
  Berserker: ba(["1H_Axe", "1H_Axe_Offhand"], "melee1", 1.45, "#ff8080"),
  Ronin: kn(["2H_Sword"], "melee2", 1.55, "#c86a6a"),
  LittlePrince: kn(["1H_Sword", "Knight_Helmet"], "melee1", 1.2, "#ffe08a"),
  Goblinstein: ba([], "punch", 2.4, "#7ac860"),
  BossBandit: ro(["Knife", "Knife_Offhand"], "melee1", 1.7, "#e0a0ff"),
  ElectroGiant: ba([], "punch", 2.7, "#8fe8ff"),
  WitchMother: ma(["2H_Staff", "Mage_Hat"], "cast", 1.6, "#a070c8"),
  // --- skeletons
  Skeletons: sk("skel_minion", [["handslot.r", "skeleton_blade"]], "melee1", 1.05),
  SkeletonArmy: sk("skel_minion", [["handslot.r", "skeleton_blade"]], "melee1", 1.05),
  Bomber: sk("skel_rogue", [], "throw", 1.15),
  GiantSkeleton: sk("skel_warrior", [["handslot.r", "skel_axe"]], "heavy", 2.6),
  SkeletonWarriors: sk("skel_warrior", [["handslot.r", "skeleton_blade"], ["handslot.l", "skel_shield"]], "melee1", 1.3),
  SkeletonKing: sk("skel_warrior", [["handslot.r", "skel_axe"], ["handslot.l", "skel_shield_large"]], "heavy", 2.1),
  // --- procedural: flyers, beasts, machines
  Minions: P("imp", "#5aa0ff", 0.8),
  MinionHorde: P("imp", "#5aa0ff", 0.8),
  MegaMinion: P("imp", "#3a6ad0", 1.2),
  Bats: P("bat", "#6a4a8a", 0.6),
  BabyDragon: P("dragon", "#7ad86a", 1.1),
  InfernoDragon: P("dragon", "#e04a2a", 1.25),
  ElectroDragon: P("dragon", "#4ad8ff", 1.3),
  SkeletonDragons: P("dragon", "#e8e4d8", 0.9),
  Phoenix: P("dragon", "#ff8a2a", 1.15),
  LavaHound: P("hound", "#c0402a", 1.6),
  Balloon: P("balloon", "#c8a060", 1.4),
  SkeletonBalloon: P("balloon", "#e8e4d8", 0.9),
  DartBarrell: P("flyingmachine", "#c8a060", 1.1),
  Golem: P("golem", "#8a7a6a", 2.0),
  ElixirGolem: P("golem", "#c070e0", 1.3),
  IceGolemite: P("golem", "#bfe9ff", 1.15, { ice: true }),
  IceSpirits: P("spirit", "#dff6ff", 1),
  FireSpirits: P("spirit", "#ffb04a", 1),
  ElectroSpirit: P("spirit", "#9af0ff", 1),
  Heal: P("spirit", "#ffe680", 1),
  ZapMachine: P("sparky", "#ffcc40", 1.4),
  MiniSparkys: P("sparky", "#ffcc40", 0.8),
  BattleRam: P("ram", "#8a5a2b", 1.2),
  MovingCannon: P("cart", "#6a6a72", 1.0),
  RoyalHogs: P("pig", "#f0a4a4", 1.0),
  SuspiciousBush: P("bush", "#3a8a3a", 1.0),
  GoblinMachine: P("mech", "#6aa050", 1.4),
  // --- buildings
  Cannon: P("cannon", "#3d3f45", 1.0),
  GoblinHut: P("hut", "#6aa050", 1.2),
  BarbarianHut: P("hut", "#a07040", 1.3),
  FirespiritHut: P("hut", "#e07030", 1.1),
  Mortar: P("mortar", "#6a6a72", 1.1),
  InfernoTower: P("inferno", "#c04030", 1.2),
  BombTower: P("bombtower", "#8a7a6a", 1.2),
  Tesla: P("tesla", "#ffd040", 1.0),
  "Elixir Collector": P("collector", "#c050e0", 1.2),
  Xbow: P("xbow", "#8a6a45", 1.2),
  Tombstone: P("tombstone", "#8a8a90", 1.0),
  GoblinCage: P("cage", "#8a6a45", 1.1),
  GoblinDrill: P("drill", "#7a7a80", 1.0),
};

// Spells: what flies (FLIGHT), rolls (ROLLING) or sits on the ground (area kinds), and its colour.
export const SPELL_LOOK = {
  Fireball: { fly: "ball", color: "#ff7a1a", radius: 2.5 },
  Arrows: { fly: "arrows", color: "#e8d8b0", radius: 4 },
  Rocket: { fly: "rocket", color: "#ff5030", radius: 2 },
  GoblinBarrel: { fly: "barrel", color: "#8a5a2b", radius: 1.5 },
  Snowball: { fly: "snow", color: "#ffffff", radius: 2.5 },
  RoyalDelivery: { fly: "box", color: "#ffd24a", radius: 3 },
  Log: { roll: 3.9, color: "#8a5a2b", radius: 1.95 },
  BarbLog: { roll: 2.6, color: "#a0703a", radius: 1.3 },
  Zap: { area: "#9fe8ff", radius: 2.5 },
  Freeze: { area: "#bfefff", radius: 3 },
  Rage: { area: "#c060ff", radius: 3 },
  Poison: { area: "#7ad040", radius: 3.5 },
  Lightning: { area: "#fff4a0", radius: 3.5, bolts: true },
  Tornado: { area: "#c8d8e8", radius: 5.5, swirl: true },
  Earthquake: { area: "#a07848", radius: 3.5 },
  Graveyard: { area: "#4a4a5a", radius: 4 },
  Clone: { area: "#7ae8ff", radius: 3 },
  Mirror: { area: "#e0e0ff", radius: 2 },
  GoblinCurse: { area: "#6ad040", radius: 3 },
  Vines: { area: "#4aa040", radius: 2.5 },
  DarkMagic: { area: "#6a3aa0", radius: 3 },
  WarmSpell: { area: "#ff9a60", radius: 3 },
};

// The look for an entity: the card's own, else one guessed from what the engine says about it
// (units a card spawns, such as golemites, lava pups or a hut's goblins, are not cards of their own).
export function lookFor(card, entity) {
  if (card && CARD_LOOK[card.name]) return CARD_LOOK[card.name];
  const flying = entity ? !!entity[10] : card ? card.flying : false;
  const r = entity ? entity[9] : card ? card.radius : 0.5;
  const building = entity ? entity[2] === 1 : card ? card.placement === 1 : false;
  if (building) return P("hut", "#8a8a90", Math.max(0.8, r));
  if (flying) return P(r > 0.9 ? "hound" : "imp", "#c06040", Math.max(0.6, r * 1.2));
  if (r > 0.9) return P("golem", "#8a7a6a", Math.max(1, r * 1.3));
  return sk("skel_minion", [], "melee1", 1.0);
}

export function modelFilesFor(names) {
  const files = new Set();
  for (const n of names) {
    const l = CARD_LOOK[n];
    if (!l) continue;
    if (l.model) files.add(l.model);
    for (const [, prop] of l.attach || []) files.add(prop);
  }
  return [...files];
}

export function clipsFor(look) {
  return { ...STYLE[look.style || "melee1"], death: DEATH };
}

// ------------------------------------------------------------------ procedural models
export const toon = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, flatShading: true, ...extra });
const add = (g, mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const ball = (r, m, d = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, d, Math.max(6, d - 2)), m);
const cyl = (r0, r1, h, m, s = 10) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, s), m);
const cone = (r, h, m, s = 8) => new THREE.Mesh(new THREE.ConeGeometry(r, h, s), m);

function wings(g, m, span, y, z = 0) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, span, 0.05, -0.25, span * 0.75, 0, 0.35], 3));
  geo.computeVertexNormals();
  const mat = m.clone(); mat.side = THREE.DoubleSide;
  const L = new THREE.Group(), R = new THREE.Group();
  const wl = new THREE.Mesh(geo, mat), wr = new THREE.Mesh(geo, mat);
  wr.scale.x = -1;
  L.add(wl); R.add(wr);
  L.position.set(0.12, y, z); R.position.set(-0.12, y, z);
  g.add(L, R);
  return [L, R];
}

// Each builder returns {root, update(dt, unit)}; sizes are in tiles before the spec's own scale.
export const PROC = {
  imp(c) {
    const g = new THREE.Group(), m = toon(c);
    add(g, ball(0.32, m), 0, 0.45);
    add(g, ball(0.2, m), 0, 0.82, 0.05);
    add(g, cone(0.06, 0.18, toon("#ffe0a0")), -0.1, 1.0, 0); add(g, cone(0.06, 0.18, toon("#ffe0a0")), 0.1, 1.0, 0);
    const [L, R] = wings(g, toon("#2a3a6a"), 0.55, 0.6, -0.1);
    let t = Math.random() * 6;
    return { root: g, update(dt) { t += dt * 14; L.rotation.z = Math.sin(t) * 0.6; R.rotation.z = -Math.sin(t) * 0.6; } };
  },
  bat(c) {
    const g = new THREE.Group(), m = toon(c);
    add(g, ball(0.18, m), 0, 0.4);
    const [L, R] = wings(g, toon("#3a2a4a"), 0.45, 0.42);
    let t = Math.random() * 6;
    return { root: g, update(dt) { t += dt * 20; L.rotation.z = Math.sin(t) * 0.8; R.rotation.z = -Math.sin(t) * 0.8; } };
  },
  dragon(c) {
    const g = new THREE.Group(), m = toon(c);
    add(g, ball(0.42, m), 0, 0.5).scale.set(0.9, 0.8, 1.3);
    const head = add(g, ball(0.28, m), 0, 0.75, 0.55);
    add(g, box(0.18, 0.12, 0.25, m), 0, 0.7, 0.8);
    add(g, cone(0.06, 0.22, toon("#fff2c0")), -0.12, 1.0, 0.5); add(g, cone(0.06, 0.22, toon("#fff2c0")), 0.12, 1.0, 0.5);
    const tail = add(g, cone(0.14, 0.7, m), 0, 0.45, -0.75); tail.rotation.x = -Math.PI / 2;
    const [L, R] = wings(g, toon(new THREE.Color(c).multiplyScalar(0.7)), 0.9, 0.7, -0.05);
    let t = Math.random() * 6;
    return { root: g, update(dt, u) { t += dt * 7; L.rotation.z = Math.sin(t) * 0.5; R.rotation.z = -Math.sin(t) * 0.5;
      head.position.y = 0.75 + (u && u.attacking ? Math.sin(t * 2) * 0.05 : 0); } };
  },
  hound(c) {
    const g = new THREE.Group(), m = toon(c, { emissive: "#401000", emissiveIntensity: 0.4 });
    add(g, ball(0.6, m), 0, 0.6).scale.set(1, 0.8, 1.3);
    add(g, ball(0.32, m), 0, 0.8, 0.75);
    for (const x of [-0.3, 0.3]) add(g, cone(0.08, 0.25, toon("#ffb040")), x, 1.1, 0.7);
    const [L, R] = wings(g, toon("#6a2010"), 1.0, 0.9);
    let t = 0;
    return { root: g, update(dt) { t += dt * 4; L.rotation.z = Math.sin(t) * 0.35; R.rotation.z = -Math.sin(t) * 0.35; } };
  },
  balloon(c) {
    const g = new THREE.Group();
    add(g, ball(0.6, toon("#e8e0d0"), 14), 0, 1.25).scale.set(1, 1.15, 1);
    add(g, box(0.5, 0.35, 0.5, toon(c)), 0, 0.35);
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) add(g, cyl(0.01, 0.01, 0.6, toon("#5a4030"), 4), x, 0.75, z);
    add(g, ball(0.12, toon("#333")), 0, 0.15);
    let t = Math.random() * 6;
    return { root: g, update(dt) { t += dt * 2; g.rotation.z = Math.sin(t) * 0.05; } };
  },
  flyingmachine(c) {
    const g = new THREE.Group(), m = toon(c);
    add(g, box(0.6, 0.3, 0.8, m), 0, 0.4);
    const prop = add(g, box(1.2, 0.04, 0.12, toon("#ddd")), 0, 0.75);
    add(g, cyl(0.1, 0.1, 0.5, toon("#555")).rotateX(Math.PI / 2), 0, 0.4, 0.55);
    return { root: g, update(dt) { prop.rotation.y += dt * 25; } };
  },
  golem(c, opt = {}) {
    const g = new THREE.Group();
    const m = opt.ice ? toon(c, { emissive: "#2a6f8f", emissiveIntensity: 0.25 }) : toon(c);
    const body = add(g, new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), m), 0, 0.75);
    add(g, new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), m), 0, 1.4);
    const armL = add(g, box(0.28, 0.6, 0.28, m), -0.6, 0.75), armR = add(g, box(0.28, 0.6, 0.28, m), 0.6, 0.75);
    const legL = add(g, box(0.26, 0.4, 0.26, m), -0.22, 0.2), legR = add(g, box(0.26, 0.4, 0.26, m), 0.22, 0.2);
    let t = 0;
    return { root: g, update(dt, u) { t += dt * (u.moving ? 6 : 2); const s = Math.sin(t);
      legL.rotation.x = u.moving ? s * 0.6 : 0; legR.rotation.x = u.moving ? -s * 0.6 : 0;
      armR.rotation.x = u.attacking ? -Math.abs(Math.sin(t * 1.5)) * 1.6 : s * 0.2; armL.rotation.x = -armR.rotation.x * 0.3;
      body.position.y = 0.75 + (u.moving ? Math.abs(s) * 0.06 : 0); } };
  },
  spirit(c) {
    const g = new THREE.Group();
    add(g, new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), toon(c, { emissive: c, emissiveIntensity: 0.45 })), 0, 0.45);
    const eye = new THREE.MeshBasicMaterial({ color: "#123" });
    add(g, ball(0.05, eye, 6), -0.1, 0.52, 0.28); add(g, ball(0.05, eye, 6), 0.1, 0.52, 0.28);
    let t = Math.random() * 6;
    return { root: g, update(dt, u) { t += dt * 10; g.position.y = Math.abs(Math.sin(t)) * (u.moving ? 0.35 : 0.08); } };
  },
  sparky(c) {
    const g = new THREE.Group();
    add(g, box(0.9, 0.3, 1.1, toon("#7a5a3a")), 0, 0.35);
    for (const [x, z] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]]) add(g, cyl(0.2, 0.2, 0.08, toon("#333"), 10).rotateZ(Math.PI / 2), x, 0.2, z);
    const coil = add(g, new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 6, 14), toon(c, { emissive: c, emissiveIntensity: 0.3 })), 0, 0.85, 0);
    let t = 0;
    return { root: g, update(dt, u) { t += dt; coil.material.emissiveIntensity = u.attacking ? 0.4 + Math.abs(Math.sin(t * 12)) : 0.3; coil.rotation.y += dt; } };
  },
  ram(c) {
    const g = new THREE.Group();
    add(g, cyl(0.25, 0.25, 1.6, toon(c), 10).rotateX(Math.PI / 2), 0, 0.5);
    add(g, ball(0.28, toon("#bbb")), 0, 0.5, 0.85);
    for (const x of [-0.4, 0.4]) add(g, box(0.25, 0.7, 0.25, toon("#d8a070")), x, 0.35, 0);
    return { root: g, update() {} };
  },
  cart(c) {
    const g = new THREE.Group();
    add(g, box(0.8, 0.25, 1.0, toon("#7a5a3a")), 0, 0.35);
    for (const [x, z] of [[-0.45, -0.35], [0.45, -0.35], [-0.45, 0.35], [0.45, 0.35]]) add(g, cyl(0.2, 0.2, 0.08, toon("#333"), 10).rotateZ(Math.PI / 2), x, 0.2, z);
    add(g, cyl(0.16, 0.2, 0.9, toon(c, { metalness: 0.5 }), 12).rotateX(Math.PI / 2), 0, 0.65, 0.2);
    return { root: g, update() {} };
  },
  pig(c) {
    const g = new THREE.Group(), m = toon(c);
    add(g, ball(0.42, m, 12), 0, 0.45).scale.set(0.85, 0.75, 1.3);
    add(g, ball(0.26, m), 0, 0.55, 0.55);
    add(g, cyl(0.1, 0.12, 0.12, toon("#e48a8a")).rotateX(Math.PI / 2), 0, 0.52, 0.8);
    const legs = [];
    for (const [x, z] of [[-0.18, 0.32], [0.18, 0.32], [-0.18, -0.32], [0.18, -0.32]]) legs.push(add(g, cyl(0.06, 0.05, 0.3, toon("#d98c8c"), 6), x, 0.15, z));
    let t = 0;
    return { root: g, legs, update(dt, u) { t += dt * (u.moving ? 16 : 0); legs.forEach((l, i) => { l.rotation.x = u.moving ? Math.sin(t + (i % 2 ? Math.PI : 0)) * 0.7 : 0; }); } };
  },
  bush(c) {
    const g = new THREE.Group(), m = toon(c);
    for (const [x, y, z, r] of [[0, 0.4, 0, 0.45], [-0.3, 0.3, 0.1, 0.3], [0.3, 0.3, -0.1, 0.32], [0.05, 0.65, 0, 0.3]]) add(g, ball(r, m), x, y, z);
    return { root: g, update() {} };
  },
  mech(c) {
    const g = new THREE.Group(), m = toon(c);
    add(g, box(0.8, 0.7, 0.7, m), 0, 0.9);
    for (const x of [-0.25, 0.25]) add(g, box(0.2, 0.6, 0.2, toon("#555")), x, 0.3);
    add(g, box(0.25, 0.25, 0.7, toon("#555")), 0.55, 0.9, 0.2);
    return { root: g, update() {} };
  },
  // buildings
  cannon(c) {
    const g = new THREE.Group();
    add(g, cyl(0.75, 0.85, 0.35, toon("#8a6a45")), 0, 0.18);
    const turret = new THREE.Group(); turret.position.y = 0.55; g.add(turret);
    const barrel = add(turret, cyl(0.2, 0.26, 1.1, toon(c, { metalness: 0.5, roughness: 0.4 }), 12).rotateX(Math.PI / 2), 0, 0, 0.35);
    add(turret, ball(0.33, toon("#4a4c52"), 12));
    let recoil = 0;
    return { root: g, update(dt, u) { if (u.attacking && recoil <= 0) recoil = 0.6; recoil = Math.max(0, recoil - dt);
      barrel.position.z = 0.35 - (recoil > 0.45 ? (recoil - 0.45) * 2 : 0); } };
  },
  hut(c) {
    const g = new THREE.Group();
    add(g, cyl(0.7, 0.8, 0.8, toon("#9a8060"), 8), 0, 0.4);
    add(g, cone(1.0, 0.9, toon(c), 8), 0, 1.25);
    add(g, box(0.3, 0.45, 0.05, toon("#3a2a1a")), 0, 0.25, 0.76);
    return { root: g, update() {} };
  },
  mortar(c) {
    const g = new THREE.Group();
    add(g, cyl(0.7, 0.8, 0.3, toon("#8a7a6a"), 8), 0, 0.15);
    const tube = add(g, cyl(0.3, 0.35, 0.8, toon(c, { metalness: 0.4 }), 12), 0, 0.6, 0.1); tube.rotation.x = 0.5;
    return { root: g, update() {} };
  },
  inferno(c) {
    const g = new THREE.Group();
    add(g, cyl(0.5, 0.8, 1.6, toon("#5a5a62"), 6), 0, 0.8);
    const core = add(g, ball(0.3, toon(c, { emissive: "#ff4010", emissiveIntensity: 0.6 })), 0, 1.75);
    let t = 0;
    return { root: g, update(dt, u) { t += dt * 8; core.material.emissiveIntensity = u.attacking ? 0.8 + Math.sin(t) * 0.4 : 0.4; } };
  },
  bombtower(c) {
    const g = new THREE.Group();
    add(g, cyl(0.7, 0.85, 1.3, toon(c), 8), 0, 0.65);
    add(g, ball(0.35, toon("#2a2a30")), 0, 1.5);
    add(g, cyl(0.04, 0.04, 0.2, toon("#d0a050"), 4), 0, 1.9);
    return { root: g, update() {} };
  },
  tesla(c) {
    const g = new THREE.Group();
    add(g, cyl(0.6, 0.7, 0.3, toon("#6a6a72"), 8), 0, 0.15);
    add(g, cyl(0.12, 0.18, 1.1, toon("#9a9aa2", { metalness: 0.6 }), 8), 0, 0.85);
    const orb = add(g, ball(0.25, toon(c, { emissive: c, emissiveIntensity: 0.5 })), 0, 1.55);
    let t = 0;
    return { root: g, update(dt, u) { t += dt * 14; orb.scale.setScalar(u.attacking ? 1 + Math.abs(Math.sin(t)) * 0.3 : 1); } };
  },
  collector(c) {
    const g = new THREE.Group();
    add(g, cyl(0.7, 0.8, 0.5, toon("#8a6a45"), 8), 0, 0.25);
    const tank = add(g, ball(0.55, toon(c, { emissive: c, emissiveIntensity: 0.25, transparent: true, opacity: 0.85 }), 14), 0, 1.0);
    let t = 0;
    return { root: g, update(dt) { t += dt * 2; tank.scale.y = 1 + Math.sin(t) * 0.05; } };
  },
  xbow(c) {
    const g = new THREE.Group();
    add(g, box(1.2, 0.4, 1.2, toon("#7a6a5a")), 0, 0.2);
    add(g, box(0.25, 0.25, 1.4, toon(c)), 0, 0.7);
    add(g, box(1.4, 0.12, 0.15, toon("#5a4030")), 0, 0.7, 0.4);
    return { root: g, update() {} };
  },
  tombstone(c) {
    const g = new THREE.Group();
    add(g, box(0.7, 1.0, 0.25, toon(c)), 0, 0.5);
    add(g, box(0.9, 0.15, 0.6, toon("#6a5a4a")), 0, 0.07, 0.15);
    return { root: g, update() {} };
  },
  cage(c) {
    const g = new THREE.Group();
    add(g, box(1.0, 0.15, 1.0, toon(c)), 0, 0.07);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(g, cyl(0.04, 0.04, 1.0, toon("#555"), 4), Math.cos(a) * 0.45, 0.55, Math.sin(a) * 0.45); }
    add(g, box(1.0, 0.12, 1.0, toon(c)), 0, 1.05);
    return { root: g, update() {} };
  },
  drill(c) {
    const g = new THREE.Group();
    const bit = add(g, cone(0.5, 1.4, toon(c, { metalness: 0.5 }), 10), 0, 0.7);
    add(g, cyl(0.6, 0.7, 0.25, toon("#6a5a4a"), 10), 0, 0.12);
    return { root: g, update(dt) { bit.rotation.y += dt * 6; } };
  },
};

export function buildProc(look) {
  const make = PROC[look.proc] || PROC.golem;
  const p = make(look.color, look);
  p.root.scale.multiplyScalar(look.size || 1);
  return p;
}

// Card names as people read them.
const NAME_FIX = {
  Archer: "Archers", Pekka: "P.E.K.K.A", MiniPekka: "Mini P.E.K.K.A", IceGolemite: "Ice Golem", IceSpirits: "Ice Spirit",
  FireSpirits: "Fire Spirit", ElectroSpirit: "Electro Spirit", Log: "The Log", BarbLog: "Barbarian Barrel",
  ZapMachine: "Sparky", RageBarbarian: "Lumberjack", AngryBarbarians: "Elite Barbarians", AxeMan: "Executioner",
  Assassin: "Bandit", Heal: "Heal Spirit", DarkWitch: "Night Witch", Ghost: "Royal Ghost", MiniSparkys: "Zappies", MovingCannon: "Cannon Cart",
  DartBarrell: "Flying Machine", BlowdartGoblin: "Dart Goblin", SkeletonWarriors: "Guards", EliteArcher: "Magic Archer",
  BattleHealer: "Battle Healer", Snowball: "Giant Snowball", Xbow: "X-Bow", WitchMother: "Mother Witch",
  SkeletonDragons: "Skeleton Dragons", GoblinDemolisher: "Goblin Demolisher", SuspiciousBush: "Suspicious Bush",
  GoblinMachine: "Goblin Machine", BossBandit: "Boss Bandit", RamRider: "Ram Rider", ThreeMusketeers: "Three Musketeers",
  "Elixir Collector": "Elixir Collector", GoblinCurse: "Goblin Curse", RoyalDelivery: "Royal Delivery",
};
export function displayName(name) {
  return NAME_FIX[name] || name.replace(/([a-z])([A-Z])/g, "$1 $2");
}
