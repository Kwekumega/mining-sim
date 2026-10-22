namespace MiningSim.Core.Geology;

/// <summary>
/// A regular 3D grid of blocks. Coordinates are metres from the grid origin,
/// with x east, y north and z depth below surface (positive down).
/// </summary>
public sealed class BlockModel
{
    private readonly Block[,,] _blocks;

    public BlockModel(int nx, int ny, int nz, double blockSize, double density, Func<int, int, int, Block> create)
    {
        if (nx <= 0 || ny <= 0 || nz <= 0) throw new ArgumentOutOfRangeException(nameof(nx), "Grid dimensions must be positive.");
        if (blockSize <= 0) throw new ArgumentOutOfRangeException(nameof(blockSize));
        if (density <= 0) throw new ArgumentOutOfRangeException(nameof(density));

        Nx = nx;
        Ny = ny;
        Nz = nz;
        BlockSize = blockSize;
        Density = density;
        _blocks = new Block[nx, ny, nz];
        for (var i = 0; i < nx; i++)
            for (var j = 0; j < ny; j++)
                for (var k = 0; k < nz; k++)
                    _blocks[i, j, k] = create(i, j, k);
    }

    public int Nx { get; }
    public int Ny { get; }
    public int Nz { get; }
    /// <summary>Edge length of each cubic block in metres.</summary>
    public double BlockSize { get; }
    /// <summary>Rock density in tonnes per cubic metre.</summary>
    public double Density { get; }

    public double BlockTonnes => BlockSize * BlockSize * BlockSize * Density;
    public double Width => Nx * BlockSize;
    public double Length => Ny * BlockSize;
    public double Depth => Nz * BlockSize;

    public Block this[int i, int j, int k] => _blocks[i, j, k];

    public IEnumerable<Block> All()
    {
        foreach (var block in _blocks) yield return block;
    }

    public (double X, double Y, double Z) Centre(int i, int j, int k) =>
        ((i + 0.5) * BlockSize, (j + 0.5) * BlockSize, (k + 0.5) * BlockSize);

    public bool Contains(double x, double y, double z) =>
        x >= 0 && x < Width && y >= 0 && y < Length && z >= 0 && z < Depth;

    public Block At(double x, double y, double z)
    {
        if (!Contains(x, y, z)) throw new ArgumentOutOfRangeException(nameof(x), "Point lies outside the block model.");
        return _blocks[(int)(x / BlockSize), (int)(y / BlockSize), (int)(z / BlockSize)];
    }
}
