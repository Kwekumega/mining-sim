import * as THREE from "three";

/**
 * Procedural surface textures painted on canvases at start-up: weathered plaster, rusty
 * corrugated zinc, concrete, and a fine grain used as a bump map. Grey-scale where possible
 * so one texture can be tinted per building by the material colour.
 */

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Speckle noise over the whole canvas. */
function speckle(ctx: CanvasRenderingContext2D, size: number, r: () => number, count: number, alpha: number, light = false) {
  for (let i = 0; i < count; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    const s = r() * 2.2 + 0.4;
    ctx.fillRect(r() * size, r() * size, s, s);
  }
}

let cache: Record<string, THREE.CanvasTexture> = {};

/** Painted plaster that covers one storey: clean-ish at the top, rain streaks, grime and splash at the foot. */
export function plaster(): THREE.CanvasTexture {
  if (cache.plaster) return cache.plaster;
  const size = 512;
  const [c, ctx] = canvas(size);
  const r = rand(11);
  ctx.fillStyle = "#e9e6df";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(120,110,95,${r() * 0.08})`;
    ctx.beginPath();
    ctx.arc(r() * size, r() * size, 10 + r() * 60, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, size, r, 9000, 0.12);
  speckle(ctx, size, r, 3000, 0.12, true);
  // Rain streaks from the roof line.
  for (let i = 0; i < 70; i++) {
    const x = r() * size;
    const len = 40 + r() * 260;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(70,60,45,${0.12 + r() * 0.15})`);
    g.addColorStop(1, "rgba(70,60,45,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 2 + r() * 6, len);
  }
  // Red-dust splash and grime along the bottom.
  const foot = ctx.createLinearGradient(0, size, 0, size * 0.62);
  foot.addColorStop(0, "rgba(120,62,30,0.75)");
  foot.addColorStop(0.35, "rgba(120,70,40,0.3)");
  foot.addColorStop(1, "rgba(120,70,40,0)");
  ctx.fillStyle = foot;
  ctx.fillRect(0, size * 0.62, size, size * 0.38);
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(110,55,25,${r() * 0.35})`;
    const y = size - Math.pow(r(), 2) * size * 0.3;
    ctx.fillRect(r() * size, y, 1.5, 1.5);
  }
  // Hairline cracks.
  ctx.strokeStyle = "rgba(60,50,40,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    let x = r() * size;
    let y = r() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (r() - 0.5) * 30;
      y += r() * 20;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return (cache.plaster = finish(c));
}

/** Corrugated zinc roofing with rust blooms; ridges run along v. */
export function zinc(): THREE.CanvasTexture {
  if (cache.zinc) return cache.zinc;
  const size = 512;
  const [c, ctx] = canvas(size);
  const r = rand(23);
  const ridges = 24;
  for (let i = 0; i < size; i++) {
    const v = 0.5 + 0.5 * Math.sin((i / size) * ridges * Math.PI * 2);
    const g = Math.round(150 + v * 70);
    ctx.fillStyle = `rgb(${g},${g},${g + 4})`;
    ctx.fillRect(i, 0, 1, size);
  }
  for (let i = 0; i < 90; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 6 + r() * 55;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(140,58,20,${0.55 + r() * 0.3})`);
    g.addColorStop(1, "rgba(140,70,30,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  speckle(ctx, size, r, 6000, 0.25);
  // Sheet overlaps.
  ctx.fillStyle = "rgba(40,30,20,0.35)";
  for (let y = 0; y < size; y += 128) ctx.fillRect(0, y, size, 3);
  return (cache.zinc = finish(c));
}

/** Concrete, block-work or slab. */
export function concrete(): THREE.CanvasTexture {
  if (cache.concrete) return cache.concrete;
  const size = 512;
  const [c, ctx] = canvas(size);
  const r = rand(37);
  ctx.fillStyle = "#c9c6bf";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? 60 : 200},${r() < 0.5 ? 55 : 195},50,${r() * 0.07})`;
    ctx.beginPath();
    ctx.arc(r() * size, r() * size, 10 + r() * 70, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, size, r, 16000, 0.2);
  speckle(ctx, size, r, 5000, 0.15, true);
  ctx.strokeStyle = "rgba(70,65,60,0.25)";
  ctx.lineWidth = 2;
  for (let y = 0; y <= size; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
    for (let x = (y / 64) % 2 ? 0 : 64; x < size; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 64);
      ctx.stroke();
    }
  }
  return (cache.concrete = finish(c));
}

/** Fine grain for bump maps: gives every surface some tooth under low sun. */
export function grain(): THREE.CanvasTexture {
  if (cache.grain) return cache.grain;
  const size = 256;
  const [c, ctx] = canvas(size);
  const r = rand(51);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (r() - 0.5) * 120;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  ctx.filter = "blur(1px)";
  ctx.drawImage(c, 0, 0);
  return (cache.grain = finish(c, false));
}

/** Tyre-worn red earth and gravel for the pit, tinted by vertex colour. */
export function dirt(): THREE.CanvasTexture {
  if (cache.dirt) return cache.dirt;
  const size = 512;
  const [c, ctx] = canvas(size);
  const r = rand(77);
  ctx.fillStyle = "#d0cbc4";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 400; i++) {
    const v = 120 + r() * 120;
    ctx.fillStyle = `rgba(${v},${v * 0.95},${v * 0.9},${0.3 + r() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(r() * size, r() * size, 1 + r() * 5, 1 + r() * 4, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, size, r, 20000, 0.25);
  return (cache.dirt = finish(c));
}

/**
 * A tangent-space normal map from a texture's brightness (Sobel), so surfaces catch light
 * like real relief. `strength` scales the slopes; `invert` treats dark as raised.
 */
export function normalMap(src: THREE.CanvasTexture, key: string, strength = 2, invert = false): THREE.CanvasTexture {
  const id = `n|${key}`;
  if (cache[id]) return cache[id];
  const img = src.image as HTMLCanvasElement;
  const size = img.width;
  const [c, ctx] = canvas(size);
  const data = img.getContext("2d")!.getImageData(0, 0, size, size).data;
  const lum = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) lum[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) / 255;
  const at = (x: number, y: number) => lum[((y + size) % size) * size + ((x + size) % size)];
  const out = ctx.createImageData(size, size);
  const sign = invert ? -1 : 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength * sign;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength * sign;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      out.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[o + 2] = (1 / len) * 0.5 * 255 + 127.5;
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return (cache[id] = finish(c, false));
}

/** Bark: vertical fissures. */
export function bark(): THREE.CanvasTexture {
  if (cache.bark) return cache.bark;
  const size = 256;
  const [c, ctx] = canvas(size);
  const r = rand(91);
  ctx.fillStyle = "#8a7a68";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 140; i++) {
    const x = r() * size;
    ctx.strokeStyle = `rgba(30,22,16,${0.3 + r() * 0.5})`;
    ctx.lineWidth = 1 + r() * 3;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    let xx = x;
    for (let y = 0; y <= size; y += 16) {
      xx += (r() - 0.5) * 6;
      ctx.lineTo(xx, y);
    }
    ctx.stroke();
  }
  speckle(ctx, size, r, 4000, 0.3);
  return (cache.bark = finish(c));
}

/** A cluster of leaves on transparent ground, for leaf cards on trees. */
export function leaves(kind: "broad" | "palm"): THREE.CanvasTexture {
  const id = `leaves|${kind}`;
  if (cache[id]) return cache[id];
  const size = 256;
  const [c, ctx] = canvas(size);
  const r = rand(kind === "palm" ? 7 : 5);
  if (kind === "broad") {
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * size * 0.42;
      const x = size / 2 + Math.cos(a) * d;
      const y = size / 2 + Math.sin(a) * d;
      const g = 70 + r() * 90;
      ctx.fillStyle = `rgb(${g * 0.55},${g},${g * 0.35})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r() * Math.PI * 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, 9 + r() * 6, 4 + r() * 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else {
    // One palm frond: a midrib with leaflets, drawn along the card's length.
    ctx.strokeStyle = "#6b6a35";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.stroke();
    for (let y = 6; y < size - 4; y += 5) {
      const len = Math.sin((y / size) * Math.PI) * size * 0.46 + 6;
      for (const side of [-1, 1]) {
        const g = 90 + r() * 70;
        ctx.strokeStyle = `rgb(${g * 0.6},${g},${g * 0.32})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(size / 2, y);
        ctx.quadraticCurveTo(size / 2 + side * len * 0.6, y + 4, size / 2 + side * len, y + 14 + r() * 8);
        ctx.stroke();
      }
    }
  }
  const t = finish(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return (cache[id] = t);
}

/** A soft round shadow, for contact shadows under people, vehicles and trees. */
export function blob(): THREE.CanvasTexture {
  if (cache.blob) return cache.blob;
  const size = 128;
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.75)");
  g.addColorStop(0.5, "rgba(0,0,0,0.4)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return (cache.blob = finish(c, false));
}

/** Grass blades on transparent ground, for grass tufts. */
export function grassBlades(): THREE.CanvasTexture {
  if (cache.grass) return cache.grass;
  const w = 128;
  const hgt = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext("2d")!;
  const r = rand(61);
  for (let i = 0; i < 46; i++) {
    const x = 8 + r() * (w - 16);
    const top = r() * hgt * 0.55;
    const lean = (r() - 0.5) * 30;
    const g = 80 + r() * 80;
    ctx.strokeStyle = `rgb(${g * 0.75},${g},${g * 0.38})`;
    ctx.lineWidth = 2 + r() * 2;
    ctx.beginPath();
    ctx.moveTo(x, hgt);
    ctx.quadraticCurveTo(x + lean * 0.3, (hgt + top) / 2, x + lean, top);
    ctx.stroke();
  }
  const t = finish(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return (cache.grass = t);
}

/**
 * Rewrites a box's UVs so a texture tiles in world units: `tile` units per repeat across,
 * and either per-`tile` or once over the full height (for wall textures with grime at the foot).
 */
export function worldUV(geo: THREE.BoxGeometry, tile: number, fullHeight = false): THREE.BoxGeometry {
  const { width: w, height: h, depth: d } = geo.parameters;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Faces in order: +x, -x, +y, -y, +z, -z; four vertices each.
  const spans: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    const vertical = f !== 2 && f !== 3;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * su) / tile, vertical && fullHeight ? uv.getY(i) : (uv.getY(i) * sv) / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}
