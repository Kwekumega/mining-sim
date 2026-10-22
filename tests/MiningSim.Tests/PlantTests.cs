using MiningSim.Core.Processing;

namespace MiningSim.Tests;

public class PlantTests
{
    [Fact]
    public void StockpileBlendsGrades()
    {
        var pile = new Stockpile();
        pile.Add(100, 2.0);
        pile.Add(300, 1.0);

        Assert.Equal(400, pile.Tonnes);
        Assert.Equal(1.25, pile.Grade, precision: 9);
    }

    [Fact]
    public void TakingMoreThanThePileEmptiesIt()
    {
        var pile = new Stockpile();
        pile.Add(50, 2.0);

        var (tonnes, grade) = pile.Take(80);

        Assert.Equal(50, tonnes);
        Assert.Equal(2.0, grade);
        Assert.Equal(0, pile.Tonnes);
    }

    [Fact]
    public void FinerGrindRecoversMoreButMillsLess()
    {
        var plant = new Plant();

        Assert.True(plant.Recovery(75) > plant.Recovery(150));
        Assert.True(plant.CapacityTph(75) < plant.CapacityTph(150));
        Assert.True(plant.CostPerTonne(75) > plant.CostPerTonne(150));
    }

    [Fact]
    public void RecoveryCapsAtMaximumBelowOptimalGrind()
    {
        var plant = new Plant();

        Assert.Equal(plant.Design.MaxRecovery, plant.Recovery(40));
    }

    [Fact]
    public void FeedRateIsLimitedByCapacity()
    {
        var plant = new Plant();
        plant.Feed.Add(100_000, 2.0);

        var shift = plant.RunShift(hours: 10, new PlantSettings(FeedRateTph: 10_000, GrindP80: 106));

        Assert.Equal(4_000, shift.TonnesMilled, precision: 6);
    }

    [Fact]
    public void GoldFollowsGradeRecoveryAndTailFloor()
    {
        var plant = new Plant(new PlantDesign { MaxRecovery = 0.9, OptimalP80 = 75, TailFloorGrade = 0.05 });
        plant.Feed.Add(1_000, 2.05);

        var shift = plant.RunShift(hours: 10, new PlantSettings(FeedRateTph: 100, GrindP80: 75));

        // 1,000 t at (2.05 - 0.05) g/t and 90 percent recovery.
        Assert.Equal(1_800, shift.GoldGrams, precision: 6);
    }

    [Fact]
    public void WasteGradeFeedYieldsAlmostNothing()
    {
        var plant = new Plant();
        plant.Feed.Add(1_000, 0.05);

        var shift = plant.RunShift(hours: 10, new PlantSettings(FeedRateTph: 400, GrindP80: 106));

        Assert.Equal(0, shift.GoldGrams);
        Assert.True(shift.Cost > 0);
    }
}
