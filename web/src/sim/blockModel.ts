export type RockType = "overburden" | "host" | "ore";

/** One cell of the block model. True values are hidden from the player. */
export interface Block {
  readonly i: number;
  readonly j: number;
  /** Level index; 0 is the surface level, increasing with depth. */
  readonly k: number;
  readonly rock: RockType;
  /** Gold grade in grams per tonne. */
  readonly trueGrade: number;
}

/**
 * A regular 3D grid of blocks. Coordinates are metres from the grid origin,
 * with x east, y north and z depth below surface (positive down).
 */
export class BlockModel {
  private readonly blocks: Block[];

  constructor(
    readonly nx: number,
    readonly ny: number,
    readonly nz: number,
    /** Edge length of each cubic block in metres. */
    readonly blockSize: number,
    /** Rock density in tonnes per cubic metre. */
    readonly density: number,
    create: (i: number, j: number, k: number) => Block,
  ) {
    if (nx <= 0 || ny <= 0 || nz <= 0) throw new RangeError("Grid dimensions must be positive.");
    if (blockSize <= 0 || density <= 0) throw new RangeError("Block size and density must be positive.");
    this.blocks = new Array(nx * ny * nz);
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) this.blocks[this.index(i, j, k)] = create(i, j, k);
  }

  get blockTonnes(): number {
    return this.blockSize ** 3 * this.density;
  }
  get width(): number {
    return this.nx * this.blockSize;
  }
  get length(): number {
    return this.ny * this.blockSize;
  }
  get depth(): number {
    return this.nz * this.blockSize;
  }
  get count(): number {
    return this.blocks.length;
  }

  index(i: number, j: number, k: number): number {
    return (k * this.ny + j) * this.nx + i;
  }

  get(i: number, j: number, k: number): Block {
    return this.blocks[this.index(i, j, k)];
  }

  all(): readonly Block[] {
    return this.blocks;
  }

  centre(i: number, j: number, k: number): [number, number, number] {
    const s = this.blockSize;
    return [(i + 0.5) * s, (j + 0.5) * s, (k + 0.5) * s];
  }

  contains(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.length && z >= 0 && z < this.depth;
  }

  at(x: number, y: number, z: number): Block {
    if (!this.contains(x, y, z)) throw new RangeError("Point lies outside the block model.");
    const s = this.blockSize;
    return this.get(Math.floor(x / s), Math.floor(y / s), Math.floor(z / s));
  }
}
