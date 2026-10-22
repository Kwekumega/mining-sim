namespace MiningSim.Core.Hauling;

public sealed record Excavator
{
    public string Name { get; init; } = "Hydraulic excavator";
    /// <summary>Tonnes per bucket pass.</summary>
    public double BucketTonnes { get; init; } = 25;
    /// <summary>Seconds per dig, swing, dump and return.</summary>
    public double PassSeconds { get; init; } = 30;
}

public sealed record HaulTruck
{
    public string Name { get; init; } = "100 t haul truck";
    public double PayloadTonnes { get; init; } = 100;
    public double LoadedSpeedKmh { get; init; } = 20;
    public double EmptySpeedKmh { get; init; } = 35;
    public double DumpSeconds { get; init; } = 60;
    /// <summary>Time to reverse up to the excavator before loading.</summary>
    public double SpotSeconds { get; init; } = 45;
    public double FuelLitresPerHour { get; init; } = 90;
}

public sealed record HaulRoutes
{
    /// <summary>Surface distance from the pit rim to the crusher, metres.</summary>
    public double CrusherDistance { get; init; } = 1_200;
    /// <summary>Surface distance from the pit rim to the waste dump, metres.</summary>
    public double DumpDistance { get; init; } = 800;
    /// <summary>Ramp gradient; at 10 percent each metre of depth adds 10 m of road.</summary>
    public double RampGrade { get; init; } = 0.10;

    public double DistanceTo(Planning.Destination destination, double depth) =>
        (destination == Planning.Destination.Ore ? CrusherDistance : DumpDistance) + depth / RampGrade;
}
