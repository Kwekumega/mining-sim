using MiningSim.Core;

namespace MiningSim.Tests;

public class MineTests
{
    private static Mine DrilledMine(double spacing, int seed = 42)
    {
        var mine = new Mine(seed, new MineSettings { ExplorationBudget = double.MaxValue / 4, StartingCash = double.MaxValue / 2 });
        for (var x = spacing / 2; x < mine.Model.Width; x += spacing)
            for (var y = spacing / 2; y < mine.Model.Length; y += spacing)
                mine.Exploration.Drill(x, y, mine.Model.Depth);
        mine.UpdateEstimates();
        return mine;
    }

    [Fact]
    public void ExplorationBudgetComesOutOfCash()
    {
        var mine = new Mine(1, new MineSettings { StartingCash = 10_000_000, ExplorationBudget = 2_000_000 });

        Assert.Equal(8_000_000, mine.Cash);
        Assert.Equal(2_000_000, mine.Exploration.Budget);
    }

    [Fact]
    public void SwitchingRoleKeepsSharedState()
    {
        var mine = DrilledMine(spacing: 50);
        var plan = mine.PlanPit();

        mine.SwitchRole(Role.PlantOperator);

        Assert.Equal(Role.PlantOperator, mine.ActiveRole);
        Assert.Same(plan, mine.Plan);
    }

    [Fact]
    public void ShiftsProduceGoldAndUpdateCash()
    {
        var mine = DrilledMine(spacing: 50);
        mine.PlanPit();
        var cashBefore = mine.Cash;

        ShiftReport? last = null;
        for (var n = 0; n < 60; n++) last = mine.RunShift();

        Assert.Equal(60, mine.ShiftsWorked);
        Assert.True(mine.Reports.Sum(r => r.Plant.GoldOunces) > 0);
        Assert.Equal(cashBefore + mine.Reports.Sum(r => r.Profit), last!.CashAfter, precision: 3);
    }

    [Fact]
    public void ReportComparesPlannedAndTrueGrade()
    {
        var mine = DrilledMine(spacing: 50);
        mine.PlanPit();

        var reports = Enumerable.Range(0, 60).Select(_ => mine.RunShift()).Where(r => r.OreHauled > 0).ToList();

        Assert.NotEmpty(reports);
        Assert.All(reports, r => Assert.True(r.PlannedOreGrade > 0));
        Assert.All(reports, r => Assert.True(r.TrueOreGrade >= 0));
    }

    [Fact]
    public void RunningAShiftWithoutAPlanPlansAutomatically()
    {
        var mine = DrilledMine(spacing: 50);

        mine.RunShift();

        Assert.NotNull(mine.Plan);
    }

    [Fact]
    public void ChangingTrucksAffectsNextShift()
    {
        var one = DrilledMine(spacing: 50);
        one.Trucks = 1;
        var four = DrilledMine(spacing: 50);
        four.Trucks = 4;

        var slow = one.RunShift();
        var fast = four.RunShift();

        Assert.True(fast.OreHauled + fast.WasteHauled > slow.OreHauled + slow.WasteHauled);
        Assert.Throws<ArgumentOutOfRangeException>(() => one.Trucks = 0);
    }

    [Fact]
    public void BlocksDugTracksPlanProgress()
    {
        var mine = DrilledMine(spacing: 50);
        mine.PlanPit();

        mine.RunShift();

        Assert.True(mine.BlocksDug > 0);
    }
}
