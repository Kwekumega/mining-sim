namespace MiningSim.Core.Processing;

public sealed record PlantDesign
{
    /// <summary>Throughput in tonnes per hour at the design grind size.</summary>
    public double DesignCapacityTph { get; init; } = 400;
    /// <summary>Design grind size: 80 percent of particles pass this size, in microns.</summary>
    public double DesignP80 { get; init; } = 106;
    /// <summary>Best achievable recovery, at or below the optimal grind.</summary>
    public double MaxRecovery { get; init; } = 0.93;
    public double OptimalP80 { get; init; } = 75;
    /// <summary>Recovery lost per micron coarser than optimal.</summary>
    public double RecoveryLossPerMicron { get; init; } = 0.0012;
    /// <summary>Gold that stays in the tailings whatever the settings, grams per tonne.</summary>
    public double TailFloorGrade { get; init; } = 0.05;
    /// <summary>Processing cost per tonne at the design grind.</summary>
    public double CostPerTonne { get; init; } = 18;
}

/// <summary>The Plant Operator's controls.</summary>
public sealed record PlantSettings(double FeedRateTph, double GrindP80);

public sealed record PlantShift(double TonnesMilled, double HeadGrade, double Recovery, double GoldGrams, double Cost)
{
    public double GoldOunces => GoldGrams / 31.1035;
}

/// <summary>
/// Crush, grind and leach circuit fed from a run-of-mine stockpile. Finer grinding raises
/// recovery but lowers throughput and costs more power.
/// </summary>
public sealed class Plant
{
    public Plant(PlantDesign? design = null)
    {
        Design = design ?? new PlantDesign();
    }

    public PlantDesign Design { get; }
    public Stockpile Feed { get; } = new();

    /// <summary>Mill throughput limit at a grind size; grinding finer takes longer per tonne.</summary>
    public double CapacityTph(double p80) => Design.DesignCapacityTph * Math.Sqrt(p80 / Design.DesignP80);

    public double Recovery(double p80) =>
        Math.Clamp(Design.MaxRecovery - Design.RecoveryLossPerMicron * Math.Max(0, p80 - Design.OptimalP80), 0, 1);

    public double CostPerTonne(double p80) => Design.CostPerTonne * Math.Sqrt(Design.DesignP80 / p80);

    public PlantShift RunShift(double hours, PlantSettings settings)
    {
        if (hours <= 0) throw new ArgumentOutOfRangeException(nameof(hours));
        if (settings.GrindP80 <= 0) throw new ArgumentOutOfRangeException(nameof(settings), "Grind size must be positive.");
        if (settings.FeedRateTph < 0) throw new ArgumentOutOfRangeException(nameof(settings), "Feed rate cannot be negative.");

        var rate = Math.Min(settings.FeedRateTph, CapacityTph(settings.GrindP80));
        var (tonnes, head) = Feed.Take(rate * hours);
        var recovery = Recovery(settings.GrindP80);
        var grams = tonnes * Math.Max(0, head - Design.TailFloorGrade) * recovery;
        var cost = tonnes * CostPerTonne(settings.GrindP80);
        return new PlantShift(tonnes, head, recovery, grams, cost);
    }
}
