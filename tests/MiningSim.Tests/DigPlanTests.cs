using MiningSim.Core.Exploration;
using MiningSim.Core.Geology;
using MiningSim.Core.Planning;

namespace MiningSim.Tests;

public class DigPlanTests
{
    private static readonly BlockModel Model = new(5, 5, 3, blockSize: 10, density: 2.5,
        (i, j, k) => new Block(i, j, k, RockType.Host, 0));

    /// <summary>Every block estimated at 0.1 g/t with full confidence, except the overrides.</summary>
    private static BlockEstimate[,,] Estimates(params (int I, int J, int K, double Grade)[] overrides)
    {
        var e = new BlockEstimate[Model.Nx, Model.Ny, Model.Nz];
        for (var i = 0; i < Model.Nx; i++)
            for (var j = 0; j < Model.Ny; j++)
                for (var k = 0; k < Model.Nz; k++)
                    e[i, j, k] = new BlockEstimate(i, j, k, 0.1, 1, 5);
        foreach (var o in overrides) e[o.I, o.J, o.K] = new BlockEstimate(o.I, o.J, o.K, o.Grade, 1, 5);
        return e;
    }

    [Fact]
    public void TargetPullsInSlopeConeAbove()
    {
        var plan = DigPlan.Create(Model, Estimates(), new[] { (2, 2, 2) });

        // Level 2: 1 block, level 1: 3 by 3, level 0: 5 by 5.
        Assert.Equal(1 + 9 + 25, plan.Sequence.Count);
    }

    [Fact]
    public void SequenceRunsTopDown()
    {
        var plan = DigPlan.Create(Model, Estimates(), new[] { (2, 2, 2) });

        var levels = plan.Sequence.Select(b => b.K).ToList();
        Assert.Equal(levels.OrderBy(k => k), levels);
    }

    [Fact]
    public void CutoffDecidesDestination()
    {
        var estimates = Estimates((2, 2, 1, 1.5), (1, 2, 1, 0.5));

        var plan = DigPlan.Create(Model, estimates, new[] { (2, 2, 1), (1, 2, 1) }, new PlanSettings { CutoffGrade = 1.0 });

        Assert.Equal(Destination.Ore, plan.Sequence.Single(b => (b.I, b.J, b.K) == (2, 2, 1)).Destination);
        Assert.Equal(Destination.Waste, plan.Sequence.Single(b => (b.I, b.J, b.K) == (1, 2, 1)).Destination);
    }

    [Fact]
    public void LowConfidenceOreGoesToWaste()
    {
        var estimates = Estimates();
        estimates[2, 2, 1] = new BlockEstimate(2, 2, 1, 5.0, 0.05, 1);

        var plan = DigPlan.Create(Model, estimates, new[] { (2, 2, 1) }, new PlanSettings { MinConfidence = 0.2 });

        Assert.Equal(Destination.Waste, plan.Sequence.Single(b => (b.I, b.J, b.K) == (2, 2, 1)).Destination);
    }

    [Fact]
    public void IsolatedOreBlockIsDiluted()
    {
        var plan = DigPlan.Create(Model, Estimates((2, 2, 1, 2.0)), new[] { (2, 2, 1) },
            new PlanSettings { CutoffGrade = 1.0, DilutionPerWasteNeighbour = 0.05 });

        // Four waste neighbours at 0.1 g/t: 2.0 * 0.8 + 0.1 * 0.2 = 1.62.
        var ore = plan.Sequence.Single(b => b.Destination == Destination.Ore);
        Assert.Equal(1.62, ore.DilutedGrade, precision: 9);
    }

    [Fact]
    public void TotalsAndStripRatio()
    {
        var plan = DigPlan.Create(Model, Estimates((2, 2, 1, 2.0)), new[] { (2, 2, 1) },
            new PlanSettings { CutoffGrade = 1.0, DilutionPerWasteNeighbour = 0 });

        // 1 ore block and 9 waste blocks of 2,500 t each.
        Assert.Equal(2_500, plan.OreTonnes);
        Assert.Equal(22_500, plan.WasteTonnes);
        Assert.Equal(9, plan.StripRatio);
        Assert.Equal(2_500 * 2.0 / 31.1035, plan.ContainedOunces, precision: 6);
    }

    [Fact]
    public void EveryBlockIsDugAfterTheBlocksAboveIt()
    {
        var plan = DigPlan.Create(Model, Estimates((4, 4, 2, 2.0), (0, 0, 1, 3.0)), new[] { (4, 4, 2), (0, 0, 1) });

        var dug = new HashSet<(int, int, int)>();
        foreach (var b in plan.Sequence)
        {
            for (var i = Math.Max(0, b.I - 1); i <= Math.Min(Model.Nx - 1, b.I + 1); i++)
                for (var j = Math.Max(0, b.J - 1); j <= Math.Min(Model.Ny - 1, b.J + 1); j++)
                    if (b.K > 0) Assert.Contains((i, j, b.K - 1), dug);
            dug.Add((b.I, b.J, b.K));
        }
    }

    [Fact]
    public void ShallowOreIsReachedFirst()
    {
        var plan = DigPlan.Create(Model, Estimates((4, 4, 2, 2.0), (0, 0, 1, 3.0)), new[] { (4, 4, 2), (0, 0, 1) },
            new PlanSettings { CutoffGrade = 1.0 });

        var first = plan.Sequence.First(b => b.Destination == Destination.Ore);
        Assert.Equal((0, 0, 1), (first.I, first.J, first.K));
    }

    [Fact]
    public void AllOrePlanOnRealDepositHasOre()
    {
        var model = DepositGenerator.Generate(seed: 42);
        var program = new DrillingProgram(model, budget: double.MaxValue, seed: 1);
        for (var x = 25.0; x < model.Width; x += 50)
            for (var y = 25.0; y < model.Length; y += 50)
                program.Drill(x, y, model.Depth);
        var estimates = new GradeEstimator().EstimateAll(model, program.Assays);

        var plan = DigPlan.CreateForAllOre(model, estimates);

        Assert.True(plan.OreTonnes > 0);
        Assert.True(plan.AverageOreGrade >= new PlanSettings().CutoffGrade * 0.8);
    }
}
