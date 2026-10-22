namespace MiningSim.Core.Exploration;

/// <summary>Assayed grade over one depth interval, sampled at its midpoint.</summary>
public sealed record Assay(double X, double Y, double FromDepth, double ToDepth, double Grade)
{
    public double MidDepth => (FromDepth + ToDepth) / 2;
}

/// <summary>A vertical drill hole collared at (X, Y) on the surface.</summary>
public sealed record DrillHole(int Id, double X, double Y, double Depth, IReadOnlyList<Assay> Assays);
