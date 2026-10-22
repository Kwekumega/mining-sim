import Phaser from "phaser";

export const ROLE_COLOURS = {
  geologist: 0x2f7fc1,
  planner: 0xf2f2ee,
  operator: 0xf08a1c,
  plant: 0x3fa35a,
  driller: 0xd94f2b,
} as const;

/**
 * Draws every sprite in code so the game ships as one file with no image assets.
 * Characters are seen from above: hard hat, shoulders in a hi-vis vest, and legs that swing.
 */
export function makeTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  for (const [name, colour] of Object.entries(ROLE_COLOURS)) {
    for (const frame of [0, 1]) {
      g.clear();
      // Legs, swinging between frames.
      g.fillStyle(0x2b2f36);
      g.fillRect(5, frame ? 13 : 15, 3, 6);
      g.fillRect(10, frame ? 15 : 13, 3, 6);
      // Shoulders and vest.
      g.fillStyle(colour);
      g.fillEllipse(9, 11, 16, 9);
      g.fillStyle(0xe9f06b, 0.9);
      g.fillRect(3, 10, 12, 1.5);
      // Arms.
      g.fillStyle(0xc68b62);
      g.fillCircle(2, frame ? 9 : 12, 2);
      g.fillCircle(16, frame ? 12 : 9, 2);
      // Hard hat.
      const hat = name === "planner" ? 0xffffff : name === "geologist" ? 0x1f5f99 : 0xffd23a;
      g.fillStyle(hat);
      g.fillCircle(9, 7, 5);
      g.lineStyle(1, 0x000000, 0.35);
      g.strokeCircle(9, 7, 5);
      g.generateTexture(`person-${name}-${frame}`, 18, 22);
    }
  }

  // Haul truck, nose pointing right.
  g.clear();
  g.fillStyle(0x222222);
  for (const [x, y] of [[6, 0], [6, 22], [30, 0], [30, 22], [36, 0], [36, 22]]) g.fillRect(x, y, 7, 4);
  g.fillStyle(0xf2c12e);
  g.fillRect(2, 3, 42, 20);
  g.fillStyle(0xc9971b);
  g.fillRect(4, 5, 30, 16);
  g.fillStyle(0x2f3a44);
  g.fillRect(37, 6, 6, 8);
  g.lineStyle(1, 0x000000, 0.4);
  g.strokeRect(2, 3, 42, 20);
  g.generateTexture("truck", 46, 26);

  // Heaps of rock in the tray: gold-brown ore, grey waste. Canvas rendering has no tinting, so each colour is its own texture.
  for (const [name, colour, fleck] of [["ore", 0xc8902c, 0xf1c75a], ["waste", 0x8d8073, 0xb3a898]] as const) {
    g.clear();
    g.fillStyle(colour);
    g.fillEllipse(14, 7, 26, 13);
    g.fillStyle(fleck);
    for (const [x, y] of [[8, 5], [15, 8], [20, 4], [11, 9]]) g.fillCircle(x, y, 1.6);
    g.generateTexture(`load-${name}`, 28, 14);
  }

  // Excavator body on tracks.
  g.clear();
  g.fillStyle(0x2a2a2a);
  g.fillRect(0, 2, 36, 7);
  g.fillRect(0, 27, 36, 7);
  g.fillStyle(0xf2b705);
  g.fillRoundedRect(4, 6, 28, 24, 4);
  g.fillStyle(0x34495e);
  g.fillRect(20, 9, 9, 9);
  g.lineStyle(1, 0x000000, 0.4);
  g.strokeRoundedRect(4, 6, 28, 24, 4);
  g.generateTexture("excavator", 36, 36);

  // Boom and bucket, pointing right from its pivot.
  g.clear();
  g.fillStyle(0xd99e04);
  g.fillRect(0, 3, 34, 6);
  g.fillStyle(0x3a3a3a);
  g.fillRect(32, 0, 9, 12);
  g.generateTexture("boom", 42, 12);

  // Drill rig: truck with a mast lying along its back.
  g.clear();
  g.fillStyle(0x222222);
  for (const [x, y] of [[4, 0], [4, 16], [26, 0], [26, 16]]) g.fillRect(x, y, 7, 4);
  g.fillStyle(0xcf3b2a);
  g.fillRect(1, 3, 40, 14);
  g.fillStyle(0x2f3a44);
  g.fillRect(33, 5, 6, 10);
  g.fillStyle(0x9aa3ab);
  g.fillRect(3, 8, 28, 4);
  g.generateTexture("rig", 42, 20);

  // Dust puff.
  g.clear();
  g.fillStyle(0xd2c3a5);
  g.fillCircle(4, 4, 4);
  g.generateTexture("puff", 8, 8);

  // Drill collar markers: plain, and gold for a hole that hit at least 1 g/t.
  for (const [name, fill] of [["collar", 0xffffff], ["collar-gold", 0xffd75a]] as const) {
    g.clear();
    g.fillStyle(fill);
    g.fillCircle(5, 5, 5);
    g.lineStyle(2, 0x1c6b88);
    g.strokeCircle(5, 5, 4);
    g.generateTexture(name, 10, 10);
  }

  // Gold bar.
  g.clear();
  g.fillStyle(0xf5c542);
  g.fillRect(0, 2, 14, 7);
  g.fillStyle(0xffe58a);
  g.fillRect(2, 0, 10, 3);
  g.generateTexture("bar", 14, 9);

  // Mill drum seen from above, with liner stripes so its turning shows.
  g.clear();
  g.fillStyle(0x7d8790);
  g.fillCircle(30, 30, 30);
  g.fillStyle(0x5c656d);
  for (let n = 0; n < 6; n++) {
    const a = (n / 6) * Math.PI * 2;
    g.fillTriangle(30, 30, 30 + Math.cos(a) * 30, 30 + Math.sin(a) * 30, 30 + Math.cos(a + 0.35) * 30, 30 + Math.sin(a + 0.35) * 30);
  }
  g.fillStyle(0x9aa4ad);
  g.fillCircle(30, 30, 9);
  g.generateTexture("drum", 60, 60);

  // Leach tank agitator blade.
  g.clear();
  g.fillStyle(0x3b444c);
  g.fillRect(0, 13, 40, 4);
  g.fillCircle(20, 15, 4);
  g.generateTexture("agitator", 40, 30);

  g.destroy();
}
