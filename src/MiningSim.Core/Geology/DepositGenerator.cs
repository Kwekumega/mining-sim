namespace MiningSim.Core.Geology;

public sealed record DepositSettings
{
    public int Nx { get; init; } = 40;
    public int Ny { get; init; } = 40;
    public int Nz { get; init; } = 20;
    public double BlockSize { get; init; } = 10;
    public double Density { get; init; } = 2.7;
    /// <summary>Depth of barren cover in metres.</summary>
    public double OverburdenDepth { get; init; } = 10;
    public int OreShoots { get; init; } = 3;
    /// <summary>Mean grade at the core of an ore shoot, grams per tonne.</summary>
    public double PeakGrade { get; init; } = 4.0;
    /// <summary>Background grade of unmineralised host rock, grams per tonne.</summary>
    public double BackgroundGrade { get; init; } = 0.05;
    /// <summary>Grade below which a block is classed as host rather than ore.</summary>
    public double OreThreshold { get; init; } = 0.5;
}

/// <summary>
/// Builds a synthetic gold deposit: a few ellipsoidal ore shoots with grade
/// falling off from their cores, plus lognormal noise. Same seed, same deposit.
/// </summary>
public static class DepositGenerator
{
    private sealed record Shoot(double X, double Y, double Z, double Rx, double Ry, double Rz);

    public static BlockModel Generate(int seed, DepositSettings? settings = null)
    {
        var s = settings ?? new DepositSettings();
        var rng = new Random(seed);
        var width = s.Nx * s.BlockSize;
        var length = s.Ny * s.BlockSize;
        var depth = s.Nz * s.BlockSize;

        var shoots = new List<Shoot>();
        for (var n = 0; n < s.OreShoots; n++)
        {
            shoots.Add(new Shoot(
                X: Between(rng, 0.2, 0.8) * width,
                Y: Between(rng, 0.2, 0.8) * length,
                Z: Between(rng, 0.3, 0.7) * depth,
                Rx: Between(rng, 0.08, 0.2) * width,
                Ry: Between(rng, 0.08, 0.2) * length,
                Rz: Between(rng, 0.15, 0.35) * depth));
        }

        return new BlockModel(s.Nx, s.Ny, s.Nz, s.BlockSize, s.Density, (i, j, k) =>
        {
            var x = (i + 0.5) * s.BlockSize;
            var y = (j + 0.5) * s.BlockSize;
            var z = (k + 0.5) * s.BlockSize;

            if (z < s.OverburdenDepth) return new Block(i, j, k, RockType.Overburden, 0);

            var strength = 0.0;
            foreach (var shoot in shoots)
            {
                var dx = (x - shoot.X) / shoot.Rx;
                var dy = (y - shoot.Y) / shoot.Ry;
                var dz = (z - shoot.Z) / shoot.Rz;
                strength = Math.Max(strength, Math.Exp(-(dx * dx + dy * dy + dz * dz)));
            }

            var mean = s.BackgroundGrade + (s.PeakGrade - s.BackgroundGrade) * strength;
            var grade = mean * LognormalNoise(rng, sigma: 0.4);
            var rock = grade >= s.OreThreshold ? RockType.Ore : RockType.Host;
            return new Block(i, j, k, rock, grade);
        });
    }

    private static double Between(Random rng, double lo, double hi) => lo + rng.NextDouble() * (hi - lo);

    /// <summary>Multiplicative noise with mean 1.</summary>
    private static double LognormalNoise(Random rng, double sigma)
    {
        // Box-Muller transform for a standard normal sample.
        var u1 = 1.0 - rng.NextDouble();
        var u2 = rng.NextDouble();
        var normal = Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
        return Math.Exp(sigma * normal - sigma * sigma / 2);
    }
}
