using Godot;
using MiningSim.Core.Exploration;
using MiningSim.Core.Geology;

namespace MiningGame;

/// <summary>Placeholder entry scene: builds a deposit, drills a grid and logs the result.</summary>
public partial class Main : Node3D
{
    [Export] public int Seed { get; set; } = 42;
    [Export] public double Budget { get; set; } = 2_000_000;
    [Export] public double HoleSpacing { get; set; } = 80;

    public override void _Ready()
    {
        var model = DepositGenerator.Generate(Seed);
        var program = new DrillingProgram(model, Budget, seed: Seed);

        for (var x = HoleSpacing / 2; x < model.Width; x += HoleSpacing)
            for (var y = HoleSpacing / 2; y < model.Length; y += HoleSpacing)
                if (program.CanAfford(model.Depth))
                    program.Drill(x, y, model.Depth);

        var estimates = new GradeEstimator().EstimateAll(model, program.Assays);
        var covered = 0;
        foreach (var e in estimates)
            if (e.IsEstimated) covered++;

        GD.Print($"Drilled {program.Holes.Count} holes, {program.Budget:N0} left; {covered} of {model.Nx * model.Ny * model.Nz} blocks estimated.");
    }
}
