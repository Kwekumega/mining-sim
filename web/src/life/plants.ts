import * as THREE from "three";
import { Random } from "../sim/random";
import { bark, blob, grassBlades, leaves, normalMap } from "./textures";
import { heightAt } from "./terrain";

/**
 * Vegetation: broadleaf shade trees and coconut palms built from leaf cards, grass tufts, and
 * soft contact shadows under every tree so they sit on the ground even beyond the shadow map.
 * Everything is instanced; the wind is a shared uniform the game advances each frame.
 */

export const wind = { time: { value: 0 }, strength: { value: 1 } };

/** Adds a wind sway to a material's vertex shader. `bend` comes from height in the model. */
function sway(m: THREE.Material, amount: number, byUv = false): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = wind.time;
    shader.uniforms.windStrength = wind.strength;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float windTime, windStrength;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
  vec3 iPos = vec3(0.0);
#endif
  float bend = ${byUv ? "uv.y" : "max(position.y, 0.0) * 0.12"};
  float ph = iPos.x * 0.21 + iPos.z * 0.17;
  float w = sin(windTime * 1.7 + ph) * 0.6 + sin(windTime * 3.9 + ph * 2.3) * 0.25;
  transformed.x += w * bend * ${amount.toFixed(3)} * windStrength;
  transformed.z += cos(windTime * 1.3 + ph) * 0.4 * bend * ${amount.toFixed(3)} * windStrength;`,
      );
  };
}

/** Points leaf-card normals away from the crown centre, so a card cluster shades like a soft mass. */
function roundNormals(geo: THREE.BufferGeometry, centre: THREE.Vector3): void {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(centre).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const g0 of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
    uv.push(...(g.attributes.uv.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

/** A crown of crossed leaf cards around (0, y, 0). */
function crownGeometry(rng: Random, radius: number, y: number, cards: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < cards; i++) {
    const q = new THREE.PlaneGeometry(radius * 1.25, radius * 1.25);
    const a = rng.next() * Math.PI * 2;
    const e = (rng.next() - 0.35) * 1.2;
    const d = radius * (0.35 + rng.next() * 0.45);
    q.rotateX(-Math.PI / 2 + (rng.next() - 0.5) * 1.6);
    q.rotateY(rng.next() * Math.PI * 2);
    q.translate(Math.cos(a) * Math.cos(e) * d, y + Math.sin(e) * d * 0.7, Math.sin(a) * Math.cos(e) * d);
    parts.push(q);
  }
  const g = merge(parts);
  roundNormals(g, new THREE.Vector3(0, y - radius * 0.3, 0));
  return g;
}

function trunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(0.26, 0.5, 5.4, 8, 3);
  main.translate(0, 2.7, 0);
  parts.push(main);
  // Three limbs reaching into the crown.
  for (let i = 0; i < 3; i++) {
    const limb = new THREE.CylinderGeometry(0.1, 0.2, 2.6, 6);
    limb.translate(0, 1.3, 0);
    limb.rotateZ(0.7);
    limb.rotateY(i * 2.1);
    limb.translate(0, 4.2, 0);
    parts.push(limb);
  }
  return merge(parts);
}

/** A curved palm trunk with a ring of drooping fronds. */
function palmGeometry(rng: Random): { trunk: THREE.BufferGeometry; fronds: THREE.BufferGeometry } {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(Math.sin(t * 1.4) * 1.4 * t, t * 9, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(curve, 16, 0.28, 7);
  const top = pts[pts.length - 1];
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    // A frond is a strip bent down along its length.
    const f = new THREE.PlaneGeometry(2.6, 6.5, 1, 6);
    const p = f.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const along = (p.getY(k) + 3.25) / 6.5;
      p.setXYZ(k, p.getX(k), along * 6.5, -along * along * 3.4);
    }
    f.rotateX(-Math.PI / 2 + 0.9 + (rng.next() - 0.5) * 0.4);
    f.rotateY((i / 9) * Math.PI * 2 + rng.next() * 0.3);
    f.translate(top.x, top.y, top.z);
    parts.push(f);
  }
  const fronds = merge(parts);
  roundNormals(fronds, top.clone().add(new THREE.Vector3(0, -1.5, 0)));
  return { trunk, fronds };
}

export interface PlantOptions {
  /** True where a tree may stand. */
  treeOk: (x: number, z: number) => boolean;
  /** True where palms grow: around the town. */
  palmZone: (x: number, z: number) => boolean;
  /** Grass density 0 to 1 at a point. */
  grassAt: (x: number, z: number) => number;
}

export interface Plants {
  grass: THREE.InstancedMesh;
  /** Every tree base and radius, for collisions. */
  trunks: { x: number; z: number }[];
}

export function plant(scene: THREE.Scene, rng: Random, o: PlantOptions): Plants {
  const broad: [number, number, number][] = [];
  const palms: [number, number, number][] = [];
  for (let tries = 0; tries < 6000 && broad.length + palms.length < 420; tries++) {
    const x = rng.between(-254, 274);
    const z = rng.between(-254, 214);
    if (!o.treeOk(x, z)) continue;
    if (o.palmZone(x, z) && rng.next() < 0.55) palms.push([x, z, rng.between(0.85, 1.2)]);
    else broad.push([x, z, rng.between(0.8, 1.5)]);
  }

  const barkTex = bark();
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, color: "#7a6a58", roughness: 1, normalMap: normalMap(barkTex, "bark", 3) });
  barkTex.repeat.set(2, 2);
  const leafMat = new THREE.MeshStandardMaterial({ map: leaves("broad"), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: "#ffffff" });
  sway(leafMat, 0.2);
  const palmMat = new THREE.MeshStandardMaterial({ map: leaves("palm"), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
  sway(palmMat, 0.5);
  const palmBark = new THREE.MeshStandardMaterial({ map: barkTex, color: "#8f8270", roughness: 1 });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  // Broadleaf: one trunk mesh and two crown variants.
  const trunkGeo = trunkGeometry();
  const crowns = [crownGeometry(new Random(3), 3.2, 6.6, 26), crownGeometry(new Random(4), 2.6, 5.8, 20)];
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, broad.length);
  const crownMeshes = crowns.map((g, k) => new THREE.InstancedMesh(g, leafMat, broad.filter((_, i) => i % 2 === k).length));
  const crownCount = [0, 0];
  broad.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(up, rng.next() * 6.3);
    m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.1, z), q, new THREE.Vector3(s, s * rng.between(0.9, 1.15), s));
    trunks.setMatrixAt(i, m);
    const k = i % 2;
    crownMeshes[k].setMatrixAt(crownCount[k], m);
    col.setHSL(0.2 + rng.next() * 0.08, 0.2 + rng.next() * 0.2, 0.62 + rng.next() * 0.2);
    crownMeshes[k].setColorAt(crownCount[k]++, col);
  });
  // Palms.
  const palmGeo = palmGeometry(new Random(8));
  const palmTrunks = new THREE.InstancedMesh(palmGeo.trunk, palmBark, palms.length);
  const palmFronds = new THREE.InstancedMesh(palmGeo.fronds, palmMat, palms.length);
  palms.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(up, rng.next() * 6.3);
    m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.1, z), q, new THREE.Vector3(s, s, s));
    palmTrunks.setMatrixAt(i, m);
    palmFronds.setMatrixAt(i, m);
    palmFronds.setColorAt(i, col.setHSL(0.16 + rng.next() * 0.05, 0.25, 0.7 + rng.next() * 0.15));
  });
  for (const mesh of [trunks, ...crownMeshes, palmTrunks, palmFronds]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Soft contact shadows under every tree.
  const blobMat = new THREE.MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false, opacity: 0.55, color: "#000000", alphaMap: blob() });
  blobMat.polygonOffset = true;
  blobMat.polygonOffsetFactor = -2;
  const blobGeo = new THREE.PlaneGeometry(1, 1);
  blobGeo.rotateX(-Math.PI / 2);
  const all = [...broad.map(([x, z, s]) => [x, z, s * 7.5] as const), ...palms.map(([x, z, s]) => [x + 1.6 * s, z, s * 5] as const)];
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, all.length);
  all.forEach(([x, z, r], i) => {
    m.compose(new THREE.Vector3(x, heightAt(x, z) + 0.05, z), q.identity(), new THREE.Vector3(r, 1, r));
    blobs.setMatrixAt(i, m);
  });
  blobs.renderOrder = 1;
  scene.add(blobs);

  // Grass tufts: two crossed cards each, denser where the ground is grassy.
  const tuft = merge([0, Math.PI / 2].map((a) => {
    const p = new THREE.PlaneGeometry(1.4, 0.9);
    p.translate(0, 0.45, 0);
    p.rotateY(a);
    return p;
  }));
  // Upward normals light tufts like the ground they grow from.
  const tn = tuft.attributes.normal;
  for (let i = 0; i < tn.count; i++) tn.setXYZ(i, 0, 1, 0);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassBlades(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
  sway(grassMat, 0.25, true);
  const spots: [number, number][] = [];
  for (let tries = 0; tries < 60000 && spots.length < 14000; tries++) {
    const x = rng.between(-254, 274);
    const z = rng.between(-254, 214);
    if (rng.next() < o.grassAt(x, z)) spots.push([x, z]);
  }
  const grass = new THREE.InstancedMesh(tuft, grassMat, spots.length);
  spots.forEach(([x, z], i) => {
    q.setFromAxisAngle(up, rng.next() * 6.3);
    const s = rng.between(0.55, 1.2);
    m.compose(new THREE.Vector3(x, heightAt(x, z), z), q, new THREE.Vector3(s, s * rng.between(0.7, 1.3), s));
    grass.setMatrixAt(i, m);
    grass.setColorAt(i, col.setHSL(0.11 + rng.next() * 0.08, 0.2 + rng.next() * 0.2, 0.42 + rng.next() * 0.16));
  });
  grass.receiveShadow = true;
  scene.add(grass);

  return { grass, trunks: [...broad, ...palms].map(([x, z]) => ({ x, z })) };
}
