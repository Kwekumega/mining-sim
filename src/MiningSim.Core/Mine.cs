using MiningSim.Core.Exploration;
using MiningSim.Core.Geology;
using MiningSim.Core.Hauling;
using MiningSim.Core.Planning;
using MiningSim.Core.Processing;

namespace MiningSim.Core;

public enum Role
{
    Geologist,
    MinePlanner,
    EquipmentOperator,
    PlantOperator,
}

public sealed record MineSettings
{
    public DepositSettings Deposit { get; init; } = new();
    public double StartingCash { get; init; } = 20_000_000;
    public double ExplorationBudget { get; init; } = 3_000_000;
    public double GoldPricePerOunce { get; init; } = 2_400;
    public double DieselPerLitre { get; init; } = 1.3;
    /// <summary>Crew, maintenance and ownership cost per truck hour, excluding fuel.</summary>
    public double TruckCostPerHour { get; init; } = 180;
    public int Trucks { get; init; } = 4;
    public Excavator Excavator { get; init; } = new();
    public HaulTruck Truck { get; init; } = new();
    public HaulRoutes Routes { get; init; } = new();
    public PlantDesign Plant { get; init; } = new();
    public PlanSettings Plan { get; init; } = new();
    public PlantSettings PlantSettings { get; init; } = new(FeedRateTph: 400, GrindP80: 106);
}

/// <summary>What happened in one shift, for the shift report screen.</summary>
public sealed record ShiftReport(
    int Shift,
    double OreHauled,
    double WasteHauled,
    double PlannedOreGrade,
    double TrueOreGrade,
    PlantShift Plant,
    double Revenue,
    double HaulCost,
    double CashAfter)
{
    public double Profit => Revenue - HaulCost - Plant.Cost;
}

/// <summary>
/// One mine and everything every role shares. The player works one role at a time;
/// the others run on their current settings.
/// </summary>
public sealed class Mine
{
    private HaulOperation? _haul;

    public Mine(int seed, MineSettings? settings = null)
    {
        Settings = settings ?? new MineSettings();
        Model = DepositGenerator.Generate(seed, Settings.Deposit);
        Cash = Settings.StartingCash - Settings.ExplorationBudget;
        Exploration = new DrillingProgram(Model, Settings.ExplorationBudget, seed: seed);
        Plant = new Plant(Settings.Plant);
        PlanSettings = Settings.Plan;
        PlantSettings = Settings.PlantSettings;
        _trucks = Settings.Trucks;
    }

    private int _trucks;

    /// <summary>Equipment Operator: trucks on the haul fleet. Takes effect from the next shift.</summary>
    public int Trucks
    {
        get => _trucks;
        set
        {
            if (value <= 0) throw new ArgumentOutOfRangeException(nameof(value), "Fleet needs at least one truck.");
            _trucks = value;
            if (_haul is not null) _haul.Trucks = value;
        }
    }

    /// <summary>Blocks of the current plan already dug, in plan order.</summary>
    public int BlocksDug => _haul?.BlocksDug ?? 0;

    public MineSettings Settings { get; }
    public BlockModel Model { get; }
    public DrillingProgram Exploration { get; }
    public Plant Plant { get; }
    public double Cash { get; private set; }
    public Role ActiveRole { get; private set; } = Role.Geologist;
    public int ShiftsWorked { get; private set; }
    public BlockEstimate[,,]? Estimates { get; private set; }
    public DigPlan? Plan { get; private set; }
    public PlanSettings PlanSettings { get; set; }
    public PlantSettings PlantSettings { get; set; }
    public List<ShiftReport> Reports { get; } = new();

    public void SwitchRole(Role role) => ActiveRole = role;

    /// <summary>Geologist: rebuild the grade estimate from all assays so far.</summary>
    public void UpdateEstimates() => Estimates = new GradeEstimator().EstimateAll(Model, Exploration.Assays);

    /// <summary>Mine Planner: plan a pit around every block above cutoff. Replaces any earlier plan.</summary>
    public DigPlan PlanPit()
    {
        if (Estimates is null) UpdateEstimates();
        Plan = DigPlan.CreateForAllOre(Model, Estimates!, PlanSettings);
        _haul = new HaulOperation(Model, Plan, Settings.Excavator, Settings.Truck, Trucks, Settings.Routes);
        return Plan;
    }

    /// <summary>Runs one shift for every role: haul to plan, feed the plant, sell the gold.</summary>
    public ShiftReport RunShift(double hours = 12)
    {
        if (_haul is null) PlanPit();

        var haul = _haul!.RunShift(hours);
        var ore = haul.Loads.Where(l => l.Destination == Destination.Ore).ToList();
        foreach (var load in ore) Plant.Feed.Add(load.Tonnes, load.TrueGrade);

        var plant = Plant.RunShift(hours, PlantSettings);
        var revenue = plant.GoldOunces * Settings.GoldPricePerOunce;
        var haulCost = haul.FuelLitres * Settings.DieselPerLitre + haul.Hours * Trucks * Settings.TruckCostPerHour;
        Cash += revenue - haulCost - plant.Cost;
        ShiftsWorked++;

        var oreTonnes = ore.Sum(l => l.Tonnes);
        var report = new ShiftReport(
            ShiftsWorked,
            oreTonnes,
            haul.WasteTonnes,
            PlannedOreGrade: oreTonnes > 0 ? ore.Sum(l => l.Tonnes * l.PlannedGrade) / oreTonnes : 0,
            TrueOreGrade: oreTonnes > 0 ? ore.Sum(l => l.Tonnes * l.TrueGrade) / oreTonnes : 0,
            plant,
            revenue,
            haulCost,
            Cash);
        Reports.Add(report);
        return report;
    }
}
