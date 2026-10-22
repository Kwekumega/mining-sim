using MiningSim.Core.Geology;

namespace MiningSim.Core.Exploration;

/// <summary>Estimated grade for one block, with how much the estimate can be trusted.</summary>
public sealed record BlockEstimate(int I, int J, int K, double Grade, double Confidence, int SampleCount)
{
    public bool IsEstimated => SampleCount > 0;
}

public sealed record EstimatorSettings
{
    /// <summary>Samples beyond this distance in metres are ignored.</summary>
    public double SearchRadius { get; init; } = 60;
    public int MaxSamples { get; init; } = 12;
    /// <summary>Inverse distance power; 2 is the industry default.</summary>
    public double Power { get; init; } = 2;
    /// <summary>Vertical distances are multiplied by this, so samples along a hole count less than ones beside it.</summary>
    public double VerticalAnisotropy { get; init; } = 2;
}

/// <summary>
/// Estimates block grades from drill assays by inverse distance weighting.
/// Confidence falls with distance to the nearest sample and rises with sample count.
/// </summary>
public sealed class GradeEstimator
{
    public GradeEstimator(EstimatorSettings? settings = null)
    {
        Settings = settings ?? new EstimatorSettings();
    }

    public EstimatorSettings Settings { get; }

    public BlockEstimate[,,] EstimateAll(BlockModel model, IEnumerable<Assay> assays)
    {
        var samples = assays.ToList();
        var result = new BlockEstimate[model.Nx, model.Ny, model.Nz];
        for (var i = 0; i < model.Nx; i++)
            for (var j = 0; j < model.Ny; j++)
                for (var k = 0; k < model.Nz; k++)
                {
                    var (x, y, z) = model.Centre(i, j, k);
                    var (grade, confidence, count) = EstimateAt(x, y, z, samples);
                    result[i, j, k] = new BlockEstimate(i, j, k, grade, confidence, count);
                }
        return result;
    }

    public (double Grade, double Confidence, int SampleCount) EstimateAt(double x, double y, double z, IReadOnlyList<Assay> assays)
    {
        var nearest = assays
            .Select(a => (Assay: a, Distance: Distance(x, y, z, a)))
            .Where(s => s.Distance <= Settings.SearchRadius)
            .OrderBy(s => s.Distance)
            .Take(Settings.MaxSamples)
            .ToList();

        if (nearest.Count == 0) return (0, 0, 0);

        // A sample at the point itself is the estimate.
        if (nearest[0].Distance < 1e-6) return (nearest[0].Assay.Grade, 1, nearest.Count);

        double weighted = 0, totalWeight = 0;
        foreach (var (assay, distance) in nearest)
        {
            var weight = 1 / Math.Pow(distance, Settings.Power);
            weighted += weight * assay.Grade;
            totalWeight += weight;
        }

        var proximity = 1 - nearest[0].Distance / Settings.SearchRadius;
        var coverage = Math.Min(1, (double)nearest.Count / Settings.MaxSamples);
        var confidence = Math.Clamp(proximity * (0.5 + 0.5 * coverage), 0, 1);
        return (weighted / totalWeight, confidence, nearest.Count);
    }

    private double Distance(double x, double y, double z, Assay a)
    {
        var dx = x - a.X;
        var dy = y - a.Y;
        var dz = (z - a.MidDepth) * Settings.VerticalAnisotropy;
        return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }
}
