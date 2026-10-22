using MiningSim.Core.Exploration;
using MiningSim.Core.Geology;

namespace MiningSim.Tests;

public class DrillingProgramTests
{
    private static readonly BlockModel Model = DepositGenerator.Generate(seed: 5);

    [Fact]
    public void DrillingSpendsMetresPlusAssays()
    {
        var program = new DrillingProgram(Model, budget: 100_000,
            new DrillingCosts { PerMetre = 100, PerAssay = 50, AssayInterval = 5 });

        program.Drill(105, 105, 50);

        // 50 m at 100 plus 10 assays at 50.
        Assert.Equal(100_000 - 5_000 - 500, program.Budget, precision: 6);
    }

    [Fact]
    public void HoleReturnsOneAssayPerInterval()
    {
        var program = new DrillingProgram(Model, budget: 1_000_000);

        var hole = program.Drill(105, 105, 100);

        Assert.Equal(20, hole.Assays.Count);
        Assert.Equal(0, hole.Assays[0].FromDepth);
        Assert.Equal(100, hole.Assays[^1].ToDepth);
    }

    [Fact]
    public void AssaysWithoutErrorMatchTrueGrade()
    {
        var program = new DrillingProgram(Model, budget: 1_000_000, new DrillingCosts { AssayError = 0 });

        var hole = program.Drill(205, 195, 150);

        Assert.All(hole.Assays, a => Assert.Equal(Model.At(a.X, a.Y, a.MidDepth).TrueGrade, a.Grade, precision: 9));
    }

    [Fact]
    public void CannotOverspendBudget()
    {
        var program = new DrillingProgram(Model, budget: 1_000);

        Assert.Throws<InvalidOperationException>(() => program.Drill(105, 105, 100));
        Assert.Empty(program.Holes);
        Assert.Equal(1_000, program.Budget);
    }

    [Fact]
    public void CannotDrillOutsideLease()
    {
        var program = new DrillingProgram(Model, budget: 1_000_000);

        Assert.Throws<ArgumentOutOfRangeException>(() => program.Drill(-10, 50, 50));
    }

    [Fact]
    public void HoleDepthIsCappedAtModelDepth()
    {
        var program = new DrillingProgram(Model, budget: 10_000_000);

        var hole = program.Drill(105, 105, Model.Depth + 500);

        Assert.Equal(Model.Depth, hole.Depth);
    }
}
