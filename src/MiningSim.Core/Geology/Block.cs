namespace MiningSim.Core.Geology;

public enum RockType
{
    Overburden,
    Host,
    Ore,
}

/// <summary>One cell of the block model. True values are hidden from the player.</summary>
public sealed class Block
{
    public Block(int i, int j, int k, RockType rock, double trueGrade)
    {
        I = i;
        J = j;
        K = k;
        Rock = rock;
        TrueGrade = trueGrade;
    }

    public int I { get; }
    public int J { get; }
    /// <summary>Level index; 0 is the surface level, increasing with depth.</summary>
    public int K { get; }
    public RockType Rock { get; }
    /// <summary>Gold grade in grams per tonne.</summary>
    public double TrueGrade { get; }
}
