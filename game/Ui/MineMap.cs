using Godot;
using MiningSim.Core;
using MiningSim.Core.Planning;

namespace MiningGame.Ui;

public enum MapMode
{
    Estimates,
    Plan,
}

/// <summary>
/// Top-down view of one level of the block model. Shows estimated grades or the dig plan,
/// drill hole collars and dug blocks. Clicking reports the clicked position in metres.
/// </summary>
public partial class MineMap : Control
{
    private static readonly Color Unknown = new(0.18f, 0.18f, 0.2f);
    private static readonly Color Dug = new(0.08f, 0.08f, 0.09f);
    private static readonly Color Waste = new(0.45f, 0.4f, 0.35f);
    private static readonly Color Ore = new(0.95f, 0.75f, 0.2f);
    private static readonly Color Hole = new(0.3f, 0.8f, 1f);

    public Mine? Mine { get; set; }
    public int Level { get; set; }
    public MapMode Mode { get; set; } = MapMode.Estimates;

    /// <summary>Raised with the clicked surface position in metres.</summary>
    public event Action<double, double>? Clicked;

    public MineMap()
    {
        CustomMinimumSize = new Vector2(480, 480);
    }

    private float CellSize => Mine is null ? 1 : Mathf.Min(Size.X / Mine.Model.Nx, Size.Y / Mine.Model.Ny);

    public override void _Draw()
    {
        if (Mine is null) return;
        var model = Mine.Model;
        var cell = CellSize;
        var dug = DugBlocks();
        var planned = PlannedBlocks();

        for (var i = 0; i < model.Nx; i++)
            for (var j = 0; j < model.Ny; j++)
            {
                var rect = new Rect2(i * cell, (model.Ny - 1 - j) * cell, cell - 1, cell - 1);
                DrawRect(rect, ColourFor(i, j, dug, planned));
            }

        foreach (var hole in Mine.Exploration.Holes)
        {
            var centre = new Vector2((float)(hole.X / model.BlockSize) * cell, (float)(model.Ny - hole.Y / model.BlockSize) * cell);
            DrawCircle(centre, Mathf.Max(2, cell * 0.25f), Hole);
        }
    }

    public override void _GuiInput(InputEvent @event)
    {
        if (Mine is null) return;
        if (@event is not InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } click) return;

        var model = Mine.Model;
        var cell = CellSize;
        var x = click.Position.X / cell * model.BlockSize;
        var y = (model.Ny - click.Position.Y / cell) * model.BlockSize;
        if (x < 0 || y < 0 || x >= model.Width || y >= model.Length) return;
        Clicked?.Invoke(x, y);
        AcceptEvent();
    }

    private Color ColourFor(int i, int j, HashSet<(int, int, int)> dug, Dictionary<(int, int, int), PlannedBlock> planned)
    {
        var key = (i, j, Level);
        if (dug.Contains(key)) return Dug;

        if (Mode == MapMode.Plan)
        {
            if (!planned.TryGetValue(key, out var block)) return Unknown;
            return block.Destination == Destination.Ore ? Ore : Waste;
        }

        var estimate = Mine!.Estimates?[i, j, Level];
        if (estimate is null || !estimate.IsEstimated) return Unknown;
        // Grade ramp from grey (0 g/t) to gold (3 g/t and above), faded by confidence.
        var t = Mathf.Clamp((float)estimate.Grade / 3f, 0, 1);
        var colour = Waste.Lerp(Ore, t);
        return Unknown.Lerp(colour, (float)Math.Max(0.25, estimate.Confidence));
    }

    private HashSet<(int, int, int)> DugBlocks()
    {
        var set = new HashSet<(int, int, int)>();
        if (Mine?.Plan is null) return set;
        for (var n = 0; n < Mine.BlocksDug; n++)
        {
            var b = Mine.Plan.Sequence[n];
            set.Add((b.I, b.J, b.K));
        }
        return set;
    }

    private Dictionary<(int, int, int), PlannedBlock> PlannedBlocks() =>
        Mine?.Plan?.Sequence.ToDictionary(b => (b.I, b.J, b.K)) ?? new();
}
