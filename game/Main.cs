using Godot;
using MiningSim.Core;

namespace MiningGame;

/// <summary>Placeholder entry scene: drills a grid, plans the pit, runs a week of shifts and logs reports.</summary>
public partial class Main : Node3D
{
    [Export] public int Seed { get; set; } = 42;
    [Export] public double HoleSpacing { get; set; } = 80;
    [Export] public int Shifts { get; set; } = 14;

    public override void _Ready()
    {
        var mine = new Mine(Seed);
        for (var x = HoleSpacing / 2; x < mine.Model.Width; x += HoleSpacing)
            for (var y = HoleSpacing / 2; y < mine.Model.Length; y += HoleSpacing)
                if (mine.Exploration.CanAfford(mine.Model.Depth))
                    mine.Exploration.Drill(x, y, mine.Model.Depth);
        mine.UpdateEstimates();

        var plan = mine.PlanPit();
        GD.Print($"Drilled {mine.Exploration.Holes.Count} holes. Pit: {plan.OreTonnes:N0} t ore at {plan.AverageOreGrade:F2} g/t, strip ratio {plan.StripRatio:F1}.");

        for (var n = 0; n < Shifts; n++)
        {
            var r = mine.RunShift();
            GD.Print($"Shift {r.Shift}: ore {r.OreHauled:N0} t (planned {r.PlannedOreGrade:F2} g/t, actual {r.TrueOreGrade:F2}), milled {r.Plant.TonnesMilled:N0} t, {r.Plant.GoldOunces:N0} oz, profit {r.Profit:N0}, cash {r.CashAfter:N0}");
        }
    }
}
