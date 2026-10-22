using MiningSim.Core.Geology;

namespace MiningSim.Core.Exploration;

public sealed record DrillingCosts
{
    /// <summary>Cost per metre drilled.</summary>
    public double PerMetre { get; init; } = 150;
    /// <summary>Cost per assay sample sent to the lab.</summary>
    public double PerAssay { get; init; } = 40;
    /// <summary>Length of each assay interval in metres.</summary>
    public double AssayInterval { get; init; } = 5;
    /// <summary>Relative standard deviation of lab assay error.</summary>
    public double AssayError { get; init; } = 0.1;
}

/// <summary>
/// The Geologist's drilling campaign: spends a budget on vertical holes and
/// returns assays sampled from the hidden true grades.
/// </summary>
public sealed class DrillingProgram
{
    private readonly BlockModel _model;
    private readonly Random _rng;
    private readonly List<DrillHole> _holes = new();

    public DrillingProgram(BlockModel model, double budget, DrillingCosts? costs = null, int seed = 0)
    {
        if (budget < 0) throw new ArgumentOutOfRangeException(nameof(budget));
        _model = model;
        Budget = budget;
        Costs = costs ?? new DrillingCosts();
        _rng = new Random(seed);
    }

    public double Budget { get; private set; }
    public DrillingCosts Costs { get; }
    public IReadOnlyList<DrillHole> Holes => _holes;
    public IEnumerable<Assay> Assays => _holes.SelectMany(h => h.Assays);

    public double CostOf(double depth)
    {
        var samples = (int)Math.Ceiling(depth / Costs.AssayInterval);
        return depth * Costs.PerMetre + samples * Costs.PerAssay;
    }

    public bool CanAfford(double depth) => CostOf(depth) <= Budget;

    public DrillHole Drill(double x, double y, double depth)
    {
        if (depth <= 0) throw new ArgumentOutOfRangeException(nameof(depth), "Depth must be positive.");
        if (!_model.Contains(x, y, 0)) throw new ArgumentOutOfRangeException(nameof(x), "Collar lies outside the lease.");
        depth = Math.Min(depth, _model.Depth);

        var cost = CostOf(depth);
        if (cost > Budget) throw new InvalidOperationException($"Hole costs {cost:N0} but only {Budget:N0} is left.");
        Budget -= cost;

        var assays = new List<Assay>();
        for (var from = 0.0; from < depth; from += Costs.AssayInterval)
        {
            var to = Math.Min(from + Costs.AssayInterval, depth);
            var truth = _model.At(x, y, (from + to) / 2).TrueGrade;
            var measured = Math.Max(0, truth * (1 + Costs.AssayError * NextNormal()));
            assays.Add(new Assay(x, y, from, to, measured));
        }

        var hole = new DrillHole(_holes.Count + 1, x, y, depth, assays);
        _holes.Add(hole);
        return hole;
    }

    private double NextNormal()
    {
        var u1 = 1.0 - _rng.NextDouble();
        var u2 = _rng.NextDouble();
        return Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
    }
}
