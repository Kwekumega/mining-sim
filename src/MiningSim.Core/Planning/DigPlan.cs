using MiningSim.Core.Exploration;
using MiningSim.Core.Geology;

namespace MiningSim.Core.Planning;

public enum Destination
{
    Waste,
    Ore,
}

/// <summary>One block in the dig sequence, with where it should be hauled and the grade the plan expects.</summary>
public sealed record PlannedBlock(int I, int J, int K, Destination Destination, double EstimatedGrade, double DilutedGrade);

public sealed record PlanSettings
{
    /// <summary>Blocks estimated at or above this grade, in grams per tonne, go to the plant.</summary>
    public double CutoffGrade { get; init; } = 0.8;
    /// <summary>Waste mixed into an ore block for each waste neighbour on the same level.</summary>
    public double DilutionPerWasteNeighbour { get; init; } = 0.03;
    /// <summary>Blocks with lower confidence are not trusted as ore and are sent to waste.</summary>
    public double MinConfidence { get; init; } = 0.2;
}

/// <summary>
/// The Mine Planner's output: which blocks to dig, in what order, and where each goes.
/// Pit walls follow a 45 degree slope: a block can be dug only after the 3 by 3 blocks above it.
/// </summary>
public sealed class DigPlan
{
    private const double GramsPerTroyOunce = 31.1035;

    private DigPlan(BlockModel model, IReadOnlyList<PlannedBlock> sequence)
    {
        Sequence = sequence;
        OreTonnes = sequence.Count(b => b.Destination == Destination.Ore) * model.BlockTonnes;
        WasteTonnes = sequence.Count(b => b.Destination == Destination.Waste) * model.BlockTonnes;
        ContainedOunces = sequence.Where(b => b.Destination == Destination.Ore)
            .Sum(b => b.DilutedGrade * model.BlockTonnes / GramsPerTroyOunce);
    }

    public IReadOnlyList<PlannedBlock> Sequence { get; }
    public double OreTonnes { get; }
    public double WasteTonnes { get; }
    /// <summary>Tonnes of waste moved per tonne of ore; infinite when the plan has no ore.</summary>
    public double StripRatio => OreTonnes > 0 ? WasteTonnes / OreTonnes : double.PositiveInfinity;
    /// <summary>Gold sent to the plant, before plant recovery, in troy ounces.</summary>
    public double ContainedOunces { get; }
    public double AverageOreGrade => OreTonnes > 0 ? ContainedOunces * GramsPerTroyOunce / OreTonnes : 0;

    /// <summary>
    /// Plans a pit that reaches every target block. Each target pulls in the cone of blocks above it;
    /// targets are reached shallowest first, and each new cone is dug level by level.
    /// </summary>
    public static DigPlan Create(BlockModel model, BlockEstimate[,,] estimates, IEnumerable<(int I, int J, int K)> targets, PlanSettings? settings = null)
    {
        var s = settings ?? new PlanSettings();
        var pit = new HashSet<(int I, int J, int K)>();
        var sequence = new List<PlannedBlock>();

        // Reach the shallowest, richest ore first so the plant gets feed early. Each target's cone
        // contains the cone of every block inside it, so digging cones in turn keeps the walls safe.
        var ordered = targets
            .Distinct()
            .OrderBy(t => t.K)
            .ThenByDescending(t => estimates[t.I, t.J, t.K].Grade);
        foreach (var target in ordered)
        {
            var added = new List<(int I, int J, int K)>();
            AddWithCone(model, target, pit, added);
            sequence.AddRange(added
                .OrderBy(b => b.K)
                .ThenBy(b => b.J)
                .ThenBy(b => b.I)
                .Select(b => PlanBlock(model, estimates, b, s)));
        }
        return new DigPlan(model, sequence);
    }

    /// <summary>Plans a pit reaching every block whose estimate clears the cutoff.</summary>
    public static DigPlan CreateForAllOre(BlockModel model, BlockEstimate[,,] estimates, PlanSettings? settings = null)
    {
        var s = settings ?? new PlanSettings();
        var targets = new List<(int, int, int)>();
        foreach (var e in estimates)
            if (IsOre(e, s)) targets.Add((e.I, e.J, e.K));
        return Create(model, estimates, targets, s);
    }

    public static bool IsOre(BlockEstimate estimate, PlanSettings settings) =>
        estimate.IsEstimated && estimate.Confidence >= settings.MinConfidence && estimate.Grade >= settings.CutoffGrade;

    private static void AddWithCone(BlockModel model, (int I, int J, int K) target, HashSet<(int I, int J, int K)> pit, List<(int I, int J, int K)> added)
    {
        for (var k = 0; k <= target.K; k++)
        {
            var reach = target.K - k;
            for (var i = Math.Max(0, target.I - reach); i <= Math.Min(model.Nx - 1, target.I + reach); i++)
                for (var j = Math.Max(0, target.J - reach); j <= Math.Min(model.Ny - 1, target.J + reach); j++)
                    if (pit.Add((i, j, k))) added.Add((i, j, k));
        }
    }

    private static PlannedBlock PlanBlock(BlockModel model, BlockEstimate[,,] estimates, (int I, int J, int K) b, PlanSettings s)
    {
        var estimate = estimates[b.I, b.J, b.K];
        if (!IsOre(estimate, s)) return new PlannedBlock(b.I, b.J, b.K, Destination.Waste, estimate.Grade, estimate.Grade);

        var wasteNeighbours = 0;
        var wasteGrade = 0.0;
        foreach (var (di, dj) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
        {
            var (i, j) = (b.I + di, b.J + dj);
            if (i < 0 || j < 0 || i >= model.Nx || j >= model.Ny) continue;
            var neighbour = estimates[i, j, b.K];
            if (IsOre(neighbour, s)) continue;
            wasteNeighbours++;
            wasteGrade += neighbour.Grade;
        }

        var dilution = wasteNeighbours * s.DilutionPerWasteNeighbour;
        var averageWaste = wasteNeighbours > 0 ? wasteGrade / wasteNeighbours : 0;
        var diluted = estimate.Grade * (1 - dilution) + averageWaste * dilution;
        return new PlannedBlock(b.I, b.J, b.K, Destination.Ore, estimate.Grade, diluted);
    }
}
