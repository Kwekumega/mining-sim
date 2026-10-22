import Phaser from "phaser";
import { dist, type Point } from "./world";

/** A person on foot who walks to targets and can pause to work. */
export class Walker {
  readonly sprite: Phaser.GameObjects.Sprite;
  private path: Point[] = [];
  private stepTimer = 0;
  private frame = 0;
  waitLeft = 0;

  constructor(
    scene: Phaser.Scene,
    public role: string,
    at: Point,
    readonly speed = 46,
  ) {
    this.sprite = scene.add.sprite(at.x, at.y, `person-${role}-0`).setDepth(30);
  }

  get pos(): Point {
    return { x: this.sprite.x, y: this.sprite.y };
  }
  get idle(): boolean {
    return this.path.length === 0 && this.waitLeft <= 0;
  }

  walkTo(...points: Point[]): void {
    this.path = points.map((p) => ({ ...p }));
  }

  wait(seconds: number): void {
    this.waitLeft = seconds;
  }

  /** Moves along the path; legs swing while walking. */
  update(dt: number): void {
    if (this.waitLeft > 0) {
      this.waitLeft -= dt;
      return;
    }
    const target = this.path[0];
    if (!target) return;
    const d = dist(this.pos, target);
    const step = this.speed * dt;
    if (d <= step) {
      this.sprite.setPosition(target.x, target.y);
      this.path.shift();
    } else {
      const a = Math.atan2(target.y - this.sprite.y, target.x - this.sprite.x);
      this.sprite.x += Math.cos(a) * step;
      this.sprite.y += Math.sin(a) * step;
      this.sprite.rotation = a + Math.PI / 2;
    }
    this.animate(dt);
  }

  animate(dt: number): void {
    this.stepTimer += dt;
    if (this.stepTimer > 0.18) {
      this.stepTimer = 0;
      this.frame = 1 - this.frame;
      this.sprite.setTexture(`person-${this.role}-${this.frame}`);
    }
  }
}

/** A vehicle sprite with an optional load heap in its tray, driven along polylines. */
export class Vehicle {
  readonly body: Phaser.GameObjects.Container;
  readonly heap: Phaser.GameObjects.Image;
  private path: Point[] = [];
  private onArrive: (() => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    texture: string,
    at: Point,
    public speed = 80,
  ) {
    const base = scene.add.image(0, 0, texture);
    this.heap = scene.add.image(-6, 0, "load-ore").setVisible(false);
    this.body = scene.add.container(at.x, at.y, [base, this.heap]).setDepth(25);
  }

  get pos(): Point {
    return { x: this.body.x, y: this.body.y };
  }
  get moving(): boolean {
    return this.path.length > 0;
  }

  driveTo(points: Point[], onArrive?: () => void): void {
    this.path = points.map((p) => ({ ...p }));
    this.onArrive = onArrive ?? null;
  }

  setLoad(kind: "ore" | "waste" | null): void {
    this.heap.setVisible(kind !== null);
    if (kind) this.heap.setTexture(`load-${kind}`);
  }

  update(dt: number): void {
    const target = this.path[0];
    if (!target) return;
    const d = dist(this.pos, target);
    const step = this.speed * dt;
    const a = Math.atan2(target.y - this.body.y, target.x - this.body.x);
    // Ease the heading round rather than snapping it.
    this.body.rotation = Phaser.Math.Angle.RotateTo(this.body.rotation, a, 6 * dt);
    if (d <= step) {
      this.body.setPosition(target.x, target.y);
      this.path.shift();
      if (this.path.length === 0 && this.onArrive) {
        const done = this.onArrive;
        this.onArrive = null;
        done();
      }
    } else {
      this.body.x += Math.cos(a) * step;
      this.body.y += Math.sin(a) * step;
    }
  }
}
