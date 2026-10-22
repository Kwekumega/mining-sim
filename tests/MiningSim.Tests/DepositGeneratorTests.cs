using MiningSim.Core.Geology;

namespace MiningSim.Tests;

public class DepositGeneratorTests
{
    [Fact]
    public void SameSeedGivesSameDeposit()
    {
        var a = DepositGenerator.Generate(seed: 7);
        var b = DepositGenerator.Generate(seed: 7);

        Assert.Equal(a.All().Select(x => x.TrueGrade), b.All().Select(x => x.TrueGrade));
    }

    [Fact]
    public void DifferentSeedsGiveDifferentDeposits()
    {
        var a = DepositGenerator.Generate(seed: 1);
        var b = DepositGenerator.Generate(seed: 2);

        Assert.NotEqual(a.All().Select(x => x.TrueGrade), b.All().Select(x => x.TrueGrade));
    }

    [Fact]
    public void OverburdenIsBarren()
    {
        var model = DepositGenerator.Generate(seed: 3, new DepositSettings { OverburdenDepth = 20 });

        var cover = model.All().Where(b => b.K < 2).ToList();
        Assert.All(cover, b => Assert.Equal(RockType.Overburden, b.Rock));
        Assert.All(cover, b => Assert.Equal(0, b.TrueGrade));
    }

    [Fact]
    public void DepositHasSomeOreButMostlyWaste()
    {
        var model = DepositGenerator.Generate(seed: 11);

        var oreShare = model.All().Count(b => b.Rock == RockType.Ore) / (double)model.All().Count();
        Assert.InRange(oreShare, 0.01, 0.5);
    }

    [Fact]
    public void BlockTonnesUsesSizeAndDensity()
    {
        var model = DepositGenerator.Generate(seed: 1, new DepositSettings { BlockSize = 10, Density = 2.7 });

        Assert.Equal(2700, model.BlockTonnes, precision: 6);
    }
}
