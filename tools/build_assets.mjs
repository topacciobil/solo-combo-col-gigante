// Build the web assets from the KayKit CC0 packs: keep only the meshes and animations the arena
// uses, then prune, dedup, quantize and meshopt-compress. Output: web/repo/site/assets/*.glb
//
//   node build_assets.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('../assets_src');
const OUT = path.resolve('../repo/site/assets');
fs.mkdirSync(OUT, { recursive: true });

const ADV = `${SRC}/KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf`;
const SKL = `${SRC}/KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons/Characters/gltf`;
const SKA = `${SRC}/KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons/Assets/gltf`;
const HEX = `${SRC}/KayKit-Medieval-Hexagon-Pack-1.0/addons/kaykit_medieval_hexagon_pack/Assets/gltf`;

// name -> source, the weapon/prop meshes to keep (the body meshes are always kept), animations to keep.
const CHARACTERS = {
  hog_rider: { src: `${ADV}/Barbarian.glb`, drop: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '2H_Axe', 'Mug'],
    anims: ['Sit_Chair_Idle', 'Sit_Chair_Pose', '1H_Melee_Attack_Chop', 'Death_A', 'Cheer'] },
  musketeer: { src: `${ADV}/Rogue_Hooded.glb`, drop: ['Knife_Offhand', '1H_Crossbow', 'Knife', 'Throwable'],
    anims: ['2H_Melee_Idle', 'Running_A', '2H_Ranged_Shoot', '2H_Ranged_Aiming', 'Death_A', 'Jump_Land'] },
  archer: { src: `${ADV}/Rogue.glb`, drop: ['Knife_Offhand', '1H_Crossbow', 'Knife', 'Throwable'],
    anims: ['2H_Melee_Idle', '2H_Ranged_Shoot', 'Cheer', 'Death_A'] },
  king: { src: `${ADV}/Knight.glb`, drop: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '2H_Sword', 'Round_Shield'],
    anims: ['Idle', 'Sit_Floor_Idle', 'Cheer', 'Throw', 'Death_A'] },
  skeleton: { src: `${SKL}/Skeleton_Minion.glb`, drop: [],
    anims: ['Idle', 'Running_C', '1H_Melee_Attack_Chop', 'Death_C_Skeletons', 'Spawn_Ground_Skeletons'] },
};

const PROPS = {
  skeleton_blade: `${SKA}/Skeleton_Blade.gltf`,
  tower_blue: `${HEX}/buildings/blue/building_tower_A_blue.gltf`,
  tower_red: `${HEX}/buildings/red/building_tower_A_red.gltf`,
  castle_blue: `${HEX}/buildings/blue/building_castle_blue.gltf`,
  castle_red: `${HEX}/buildings/red/building_castle_red.gltf`,
  bridge: `${HEX}/buildings/neutral/building_bridge_A.gltf`,
  tree_a: `${HEX}/decoration/nature/tree_single_A.gltf`,
  tree_b: `${HEX}/decoration/nature/tree_single_B.gltf`,
  trees_large: `${HEX}/decoration/nature/trees_A_large.gltf`,
  rock_a: `${HEX}/decoration/nature/rock_single_A.gltf`,
  rock_c: `${HEX}/decoration/nature/rock_single_C.gltf`,
  barrel: `${HEX}/decoration/props/barrel.gltf`,
  wall: `${HEX}/buildings/neutral/wall_straight.gltf`,
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;

function findFile(p) {
  if (fs.existsSync(p)) return p;
  // the pack's folder layout varies: search by file name
  const name = path.basename(p);
  const stack = [path.dirname(path.dirname(p))];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) stack.push(f);
      else if (e.name === name) return f;
    }
  }
  throw new Error(`not found: ${p}`);
}

async function finish(doc, out) {
  await doc.transform(prune(), prune(), dedup(), weld(), resample(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(out, doc);
  return fs.statSync(out).size;
}

const report = [];
for (const [name, c] of Object.entries(CHARACTERS)) {
  const doc = await io.read(c.src);
  const root = doc.getRoot();
  for (const n of root.listNodes()) if (n.getMesh() && c.drop.includes(n.getName())) n.setMesh(null);
  const have = root.listAnimations().map((a) => a.getName());
  for (const a of root.listAnimations()) {
    if (c.anims.includes(a.getName())) continue;
    // Animation.dispose() leaves its samplers (and their keyframe accessors) behind: dispose them too.
    for (const ch of a.listChannels()) ch.dispose();
    for (const sm of a.listSamplers()) sm.dispose();  // accessors may be shared: prune() drops the orphans
    a.dispose();
  }
  const missing = c.anims.filter((a) => !have.includes(a));
  if (missing.length) throw new Error(`${name}: missing animations ${missing}`);
  const size = await finish(doc, `${OUT}/${name}.glb`);
  report.push(`${name}.glb ${(size / 1024).toFixed(0)} KB, anims: ${c.anims.join(', ')}`);
}
for (const [name, src] of Object.entries(PROPS)) {
  const doc = await io.read(findFile(src));
  const size = await finish(doc, `${OUT}/${name}.glb`);
  report.push(`${name}.glb ${(size / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(`${OUT}/CREDITS.txt`, 'Models: KayKit by Kay Lousberg (www.kaylousberg.com), CC0 1.0.\n' +
  'Character Pack: Adventurers 1.0, Character Pack: Skeletons 1.0, Medieval Hexagon Pack 1.0.\n' +
  'Reduced (meshes/animations kept: see web build script) and meshopt-compressed.\n');
console.log(report.join('\n'));
const total = fs.readdirSync(OUT).filter((f) => f.endsWith('.glb')).reduce((s, f) => s + fs.statSync(`${OUT}/${f}`).size, 0);
console.log(`TOTAL ${(total / 1024 / 1024).toFixed(2)} MB`);
