import * as THREE from "three";
import { Random } from "../sim/random";
import { box, concreteMat, cylinder, label, lampGlow, mat, paint, roofMat, slab, steel, taxi } from "./models";
import { heightAt } from "./terrain";
import type { Box2 } from "./world";

/**
 * Street life that makes the town read as a real place: power poles and sagging wires, street
 * lamps, open drains, parked taxis, container shops, umbrella stalls, a billboard, compound walls,
 * and on the mine, light towers, a fuel tank and safety berms along the haul road.
 */
export function decorate(scene: THREE.Scene, rng: Random, colliders: Box2[], roads: [number, number][][]): void {
  const add = (o: THREE.Object3D, x: number, z: number, yaw = 0) => {
    o.position.set(x, heightAt(x, z), z);
    o.rotation.y = yaw;
    scene.add(o);
    return o;
  };
  const solid = (x: number, z: number, hw: number, hd: number) => colliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });

  // Open concrete drains along both sides of the main street.
  for (const z of [83.6, 96.4]) {
    const len = 190;
    scene.add(slab(len, 0.1, 1.1, mat("#24221e"), -117.5, 0.02, z, 4));
    scene.add(slab(len, 0.35, 0.25, concreteMat("#9c978c"), -117.5, 0.17, z - 0.65, 3), slab(len, 0.35, 0.25, concreteMat("#9c978c"), -117.5, 0.17, z + 0.65, 3));
  }

  // Wooden power poles with two sagging wires, along the street and out to the mine.
  const wire = new THREE.LineBasicMaterial({ color: "#1a1a1a" });
  const poleLine = (pts: [number, number][]) => {
    const tops: THREE.Vector3[] = [];
    for (const [x, z] of pts) {
      const g = new THREE.Group();
      const pole = cylinder(0.16, 0.22, 10, mat("#4a3a2a"), 7);
      pole.position.y = 5;
      const arm = box(2.6, 0.18, 0.18, mat("#3a2e22"), 0, 9.3, 0);
      g.add(pole, arm, box(0.18, 0.25, 0.18, mat("#d8d8d0"), -1.1, 9.5, 0), box(0.18, 0.25, 0.18, mat("#d8d8d0"), 1.1, 9.5, 0));
      if (rng.next() < 0.3) g.add(cylinder(0.35, 0.35, 0.9, mat("#7c7f80"), 10).translateY(8.2).translateX(0.5)); // transformer
      const yaw = tops.length ? Math.atan2(x - tops[tops.length - 1].x, z - tops[tops.length - 1].z) + Math.PI / 2 : Math.PI / 2;
      add(g, x, z, yaw);
      tops.push(new THREE.Vector3(x, heightAt(x, z) + 9.5, z));
      if (tops.length > 1) {
        const a = tops[tops.length - 2];
        const b = tops[tops.length - 1];
        for (const side of [-1.1, 1.1]) {
          const dir = new THREE.Vector3(Math.cos(yaw) * side, 0, -Math.sin(yaw) * side);
          const pts3: THREE.Vector3[] = [];
          for (let k = 0; k <= 10; k++) {
            const t = k / 10;
            const p = a.clone().lerp(b, t).add(dir);
            p.y -= Math.sin(t * Math.PI) * 0.9;
            pts3.push(p);
          }
          scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts3), wire));
        }
      }
    }
  };
  const north: [number, number][] = [];
  for (let x = -208; x <= -24; x += 23) north.push([x, 82.2]);
  north.push([-14, 80], [2, 60], [16, 44]);
  poleLine(north);

  // Street lamps on the south side.
  for (let x = -196; x <= -30; x += 33) {
    const g = new THREE.Group();
    const post = cylinder(0.12, 0.16, 7.5, steel, 8);
    post.position.y = 3.75;
    const armMesh = box(0.12, 0.12, 2.2, steel, 0, 7.4, -1.0);
    const head = box(0.7, 0.22, 1.1, mat("#3a3a3a"), 0, 7.3, -2.0);
    const bulb = box(0.5, 0.08, 0.8, lampGlow, 0, 7.17, -2.0);
    g.add(post, armMesh, head, bulb);
    add(g, x, 97.6);
  }

  // Parked taxis.
  add(taxi(), -95, 86.6, Math.PI / 2);
  add(taxi(), -162, 93.4, -Math.PI / 2);
  add(taxi(), -40, 101.5, 0.3);
  solid(-95, 86.6, 2.6, 1.3);
  solid(-162, 93.4, 2.6, 1.3);
  solid(-40, 101.5, 1.4, 2.6);

  // Shipping-container shops with a canopy.
  const container = (x: number, z: number, colour: string, sign: string) => {
    const g = new THREE.Group();
    g.add(slab(6, 2.6, 2.4, roofMat(colour), 0, 1.3, 0, 3));
    g.add(box(5.4, 2.2, 0.1, mat("#1d1d1d"), 0, 1.25, 1.21)); // open front
    g.add(box(5.6, 0.9, 1.2, mat("#6b4a2f"), 0, 0.45, 1.9)); // counter
    for (let i = 0; i < 8; i++) g.add(box(0.4, 0.5, 0.35, mat(["#c8342c", "#f2b705", "#2f7fc1", "#e9e3d3"][i % 4]), -2.4 + i * 0.68, 1.15, 1.85)); // goods
    const canopy = box(7, 0.12, 2.6, roofMat("#c9c4b6"), 0, 3.0, 2.0);
    canopy.rotation.x = 0.15;
    g.add(canopy);
    add(g, x, z);
    const s = label(sign, "#ffffff", "rgba(150,30,30,0.85)");
    s.position.set(x, 4.4, z + 1);
    s.scale.multiplyScalar(0.7);
    scene.add(s);
    solid(x, z + 0.6, 3, 1.9);
  };
  container(-172, 78.6, "#2c5d8a", "Mobile phones & credit");
  container(-94, 78.6, "#a8402e", "Provisions");

  // Umbrella stalls.
  const stall = (x: number, z: number, colour: string) => {
    const g = new THREE.Group();
    g.add(cylinder(0.05, 0.05, 3.2, steel, 6).translateY(1.6));
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.7, 8, 1, true), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8, side: THREE.DoubleSide }));
    top.position.y = 3.2;
    top.castShadow = true;
    g.add(top, box(1.8, 0.1, 1.1, mat("#7a5230"), 0, 1.0, 0), box(0.1, 1, 0.1, mat("#5a3a20"), 0, 0.5, 0));
    for (let i = 0; i < 6; i++) g.add(cylinder(0.16, 0.16, 0.2, mat(["#d9a514", "#c8342c", "#4f7a3a"][i % 3]), 8).translateY(1.15).translateX(-0.6 + (i % 3) * 0.6).translateZ(i < 3 ? -0.25 : 0.25));
    add(g, x, z);
    solid(x, z, 0.9, 0.6);
  };
  stall(-132, 81.4, "#2f7fc1");
  stall(-84, 81.4, "#c8342c");
  stall(-54, 81.8, "#f2b705");

  // Billboard at the junction.
  const boardTex = (() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 384;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 384);
    g.addColorStop(0, "#1e3d2b");
    g.addColorStop(1, "#0f2418");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 384);
    ctx.fillStyle = "#e0b33a";
    ctx.font = "700 92px Georgia, serif";
    ctx.fillText("SIKAKROM GOLDFIELDS", 48, 150);
    ctx.fillStyle = "#e9e3d3";
    ctx.font = "italic 54px Georgia, serif";
    ctx.fillText("Safety is our first gold. Now hiring.", 50, 250);
    ctx.fillStyle = "rgba(90,60,30,0.35)";
    for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * 1024, 300 + Math.random() * 84, 3, 30 + Math.random() * 60);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  {
    const g = new THREE.Group();
    g.add(box(0.4, 9, 0.4, steel, -5, 4.5, 0), box(0.4, 9, 0.4, steel, 5, 4.5, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.5), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.7 }));
    face.position.set(0, 8.5, 0.25);
    g.add(box(12.4, 4.9, 0.4, mat("#2a2a2a"), 0, 8.5, 0), face);
    add(g, -4, 66, -0.6);
    solid(-4, 66, 1, 1);
  }

  // Compound walls behind the south row.
  for (const [x0, x1] of [[-208, -170], [-160, -80]] as const) {
    const len = x1 - x0;
    scene.add(slab(len, 2.4, 0.4, concreteMat("#b4ab98"), (x0 + x1) / 2, 1.2, 113, 3));
    colliders.push({ minX: x0, maxX: x1, minZ: 112.6, maxZ: 113.4 });
  }

  // Mine: light towers, fuel tank, berms.
  for (const [x, z] of [[70, -32], [128, -62], [-30, -100], [104, -160]] as const) {
    const g = new THREE.Group();
    g.add(box(2.2, 1, 3.4, paint("#e8a700"), 0, 0.9, 0), cylinder(0.15, 0.2, 11, steel, 8).translateY(6));
    for (let i = 0; i < 4; i++) g.add(box(0.8, 0.6, 0.25, lampGlow, -1.3 + (i % 2) * 2.6 - 0.0, 11.2 + Math.floor(i / 2) * 0.7, 0.3));
    g.add(box(3.4, 0.15, 0.3, steel, 0, 11.5, 0));
    add(g, x, z, Math.atan2(40 - x, -110 - z));
    solid(x, z, 1.4, 1.8);
  }
  {
    const tank = cylinder(2, 2, 9, paint("#d8d4c8"), 18);
    tank.rotation.z = Math.PI / 2;
    tank.position.y = 3;
    const g = new THREE.Group();
    g.add(tank, box(1, 1, 3, concreteMat(), -3, 0.5, 0), box(1, 1, 3, concreteMat(), 3, 0.5, 0));
    const s = label("DIESEL", "#ffffff", "rgba(180,30,30,0.85)");
    s.position.set(0, 6.2, 0);
    s.scale.multiplyScalar(0.6);
    g.add(s);
    add(g, 150, -4);
    solid(150, -4, 5, 2.2);
  }
  const haul = roads[4];
  const berm = mat("#8a5636");
  for (let i = 1; i < haul.length - 1; i++) {
    const [ax, az] = haul[i - 1];
    const [bx, bz] = haul[i];
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);
    const nx = Math.cos(yaw);
    const nz = -Math.sin(yaw);
    for (const side of [-8.5, 8.5]) {
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, len), berm);
      ridge.castShadow = ridge.receiveShadow = true;
      ridge.position.set((ax + bx) / 2 + nx * side, 0.5, (az + bz) / 2 + nz * side);
      ridge.rotation.y = yaw;
      scene.add(ridge);
    }
  }
}
