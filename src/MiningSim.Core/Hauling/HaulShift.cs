using MiningSim.Core.Geology;
using MiningSim.Core.Planning;

namespace MiningSim.Core.Hauling;

/// <summary>One truckload delivered. Grade is the block's true grade, which the plant will reveal.</summary>
public sealed record Load(int I, int J, int K, Destination Destination, double Tonnes, double TrueGrade, double PlannedGrade);

public sealed record ShiftResult(
    IReadOnlyList<Load> Loads,
    double Hours,
    double FuelLitres,
    int BlocksCompleted)
{
    public double OreTonnes => Loads.Where(l => l.Destination == Destination.Ore).Sum(l => l.Tonnes);
    public double WasteTonnes => Loads.Where(l => l.Destination == Destination.Waste).Sum(l => l.Tonnes);
}

/// <summary>
/// The Equipment Operator's work: one excavator loading a fleet of trucks, digging the
/// plan in order. Tracks partly dug blocks between shifts.
/// </summary>
public sealed class HaulOperation
{
    private readonly BlockModel _model;
    private readonly DigPlan _plan;
    private int _next;
    private double _remainingInBlock;

    public HaulOperation(BlockModel model, DigPlan plan, Excavator excavator, HaulTruck truck, int trucks, HaulRoutes routes)
    {
        if (trucks <= 0) throw new ArgumentOutOfRangeException(nameof(trucks));
        _model = model;
        _plan = plan;
        Excavator = excavator;
        Truck = truck;
        _trucks = trucks;
        Routes = routes;
        _remainingInBlock = plan.Sequence.Count > 0 ? model.BlockTonnes : 0;
    }

    public Excavator Excavator { get; }
    public HaulTruck Truck { get; }
    private int _trucks;

    /// <summary>Trucks in the fleet; can change between shifts.</summary>
    public int Trucks
    {
        get => _trucks;
        set => _trucks = value > 0 ? value : throw new ArgumentOutOfRangeException(nameof(value), "Fleet needs at least one truck.");
    }
    public HaulRoutes Routes { get; }
    public bool IsFinished => _next >= _plan.Sequence.Count;
    public int BlocksDug => _next;

    public double LoadSeconds => Math.Ceiling(Truck.PayloadTonnes / Excavator.BucketTonnes) * Excavator.PassSeconds + Truck.SpotSeconds;

    /// <summary>Seconds for one truck to load, haul, dump and return from a block at this depth.</summary>
    public double CycleSeconds(Destination destination, double depth)
    {
        var metres = Routes.DistanceTo(destination, depth);
        var haul = metres / (Truck.LoadedSpeedKmh / 3.6);
        var back = metres / (Truck.EmptySpeedKmh / 3.6);
        return LoadSeconds + haul + Truck.DumpSeconds + back;
    }

    /// <summary>
    /// Runs one shift. The excavator is the bottleneck when trucks queue; otherwise trucks are.
    /// Fleet output per hour is the lower of the two.
    /// </summary>
    public ShiftResult RunShift(double hours)
    {
        if (hours <= 0) throw new ArgumentOutOfRangeException(nameof(hours));
        var loads = new List<Load>();
        var secondsLeft = hours * 3600;
        var completed = 0;

        while (!IsFinished && secondsLeft > 0)
        {
            var block = _plan.Sequence[_next];
            var depth = (block.K + 0.5) * _model.BlockSize;
            var cycle = CycleSeconds(block.Destination, depth);
            // With N trucks, a load leaves every max(load time, cycle / N) seconds.
            var interval = Math.Max(LoadSeconds, cycle / Trucks);
            if (interval > secondsLeft) break;

            var tonnes = Math.Min(Truck.PayloadTonnes, _remainingInBlock);
            var truth = _model[block.I, block.J, block.K].TrueGrade;
            loads.Add(new Load(block.I, block.J, block.K, block.Destination, tonnes, truth, block.DilutedGrade));
            secondsLeft -= interval;
            _remainingInBlock -= tonnes;

            if (_remainingInBlock <= 1e-9)
            {
                _next++;
                completed++;
                _remainingInBlock = _model.BlockTonnes;
            }
        }

        var worked = hours - secondsLeft / 3600;
        var fuel = worked * Trucks * Truck.FuelLitresPerHour;
        return new ShiftResult(loads, worked, fuel, completed);
    }
}
