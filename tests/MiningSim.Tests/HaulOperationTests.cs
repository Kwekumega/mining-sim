using MiningSim.Core.Exploration;
using MiningSim.Core.Geology;
using MiningSim.Core.Hauling;
using MiningSim.Core.Planning;

namespace MiningSim.Tests;

public class HaulOperationTests
{
    private static readonly BlockModel Model = new(3, 3, 2, blockSize: 10, density: 2.5,
        (i, j, k) => new Block(i, j, k, RockType.Host, k == 1 ? 3.0 : 0.1));

    private static DigPlan Plan()
    {
        var e = new BlockEstimate[3, 3, 2];
        foreach (var b in Model.All()) e[b.I, b.J, b.K] = new BlockEstimate(b.I, b.J, b.K, b.TrueGrade, 1, 5);
        return DigPlan.Create(Model, e, new[] { (1, 1, 1) }, new PlanSettings { DilutionPerWasteNeighbour = 0 });
    }

    private static HaulOperation Operation(int trucks = 3) =>
        new(Model, Plan(), new Excavator(), new HaulTruck(), trucks, new HaulRoutes());

    [Fact]
    public void LoadTimeCountsBucketPassesAndSpotting()
    {
        // 100 t truck, 25 t bucket: 4 passes of 30 s plus 45 s spotting.
        Assert.Equal(165, Operation().LoadSeconds);
    }

    [Fact]
    public void DeeperBlocksTakeLonger()
    {
        var op = Operation();

        Assert.True(op.CycleSeconds(Destination.Ore, 50) > op.CycleSeconds(Destination.Ore, 5));
    }

    [Fact]
    public void ShiftMovesWholeBlockInTruckloads()
    {
        var op = Operation();

        var shift = op.RunShift(hours: 12);

        // 10 blocks of 2,500 t, 25 loads each.
        Assert.True(op.IsFinished);
        Assert.Equal(10, shift.BlocksCompleted);
        Assert.Equal(250, shift.Loads.Count);
        Assert.Equal(2_500, shift.OreTonnes);
        Assert.Equal(22_500, shift.WasteTonnes);
    }

    [Fact]
    public void LoadsCarryTrueGrade()
    {
        var shift = Operation().RunShift(hours: 12);

        Assert.All(shift.Loads.Where(l => l.Destination == Destination.Ore), l => Assert.Equal(3.0, l.TrueGrade));
    }

    [Fact]
    public void MoreTrucksMoveMoreUntilExcavatorLimits()
    {
        double Tonnes(int trucks) => Operation(trucks).RunShift(hours: 1).Loads.Sum(l => l.Tonnes);

        Assert.True(Tonnes(3) > Tonnes(1));
        // The excavator loads one truck per 165 s, so at most 21 loads an hour.
        Assert.True(Tonnes(50) <= 22 * 100);
    }

    [Fact]
    public void ShiftsResumeWhereTheLastStopped()
    {
        var op = Operation(trucks: 1);

        var first = op.RunShift(hours: 1);
        var second = op.RunShift(hours: 1);

        Assert.NotEmpty(second.Loads);
        Assert.Equal(first.Loads.Count + second.Loads.Count, first.Loads.Concat(second.Loads).Count());
        Assert.False(op.IsFinished);
    }
}
