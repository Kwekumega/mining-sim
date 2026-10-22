using Godot;
using MiningGame.Ui;
using MiningSim.Core;

namespace MiningGame;

/// <summary>
/// Prototype screen: a mine map beside one control panel per role, and a shift report.
/// Built in code so the layout lives next to the sim calls it drives.
/// </summary>
public partial class Main : Control
{
    [Export] public int Seed { get; set; } = 42;
    [Export] public double HoleDepth { get; set; } = 200;

    private Mine _mine = null!;
    private MineMap _map = null!;
    private Label _status = null!;
    private Label _levelLabel = null!;
    private Label _geologistInfo = null!;
    private Label _planInfo = null!;
    private Label _fleetInfo = null!;
    private Label _plantInfo = null!;
    private RichTextLabel _report = null!;

    public override void _Ready()
    {
        _mine = new Mine(Seed);
        SetAnchorsPreset(LayoutPreset.FullRect);

        var root = new VBoxContainer();
        root.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(root);

        _status = new Label();
        root.AddChild(_status);

        var body = new HBoxContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        root.AddChild(body);

        var mapColumn = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        body.AddChild(mapColumn);
        _map = new MineMap { Mine = _mine, SizeFlagsVertical = SizeFlags.ExpandFill };
        _map.Clicked += OnMapClicked;
        mapColumn.AddChild(_map);
        mapColumn.AddChild(LevelControls());

        var tabs = new TabContainer { CustomMinimumSize = new Vector2(360, 0) };
        tabs.TabChanged += tab => OnRoleChanged((Role)(int)tab);
        body.AddChild(tabs);
        tabs.AddChild(GeologistPanel());
        tabs.AddChild(PlannerPanel());
        tabs.AddChild(OperatorPanel());
        tabs.AddChild(PlantPanel());

        var shiftRow = new HBoxContainer();
        root.AddChild(shiftRow);
        var runShift = new Button { Text = "Run 12 hour shift" };
        runShift.Pressed += OnRunShift;
        shiftRow.AddChild(runShift);

        _report = new RichTextLabel { CustomMinimumSize = new Vector2(0, 140), ScrollFollowing = true };
        root.AddChild(_report);

        Refresh();
    }

    private Control LevelControls()
    {
        var row = new HBoxContainer();
        _levelLabel = new Label();
        var slider = new HSlider
        {
            MinValue = 0,
            MaxValue = _mine.Model.Nz - 1,
            Step = 1,
            SizeFlagsHorizontal = SizeFlags.ExpandFill,
        };
        slider.ValueChanged += value =>
        {
            _map.Level = (int)value;
            Refresh();
        };
        row.AddChild(_levelLabel);
        row.AddChild(slider);
        return row;
    }

    private Control GeologistPanel()
    {
        var panel = new VBoxContainer { Name = "Geologist" };
        panel.AddChild(new Label { Text = "Click the map to drill a vertical hole.", AutowrapMode = TextServer.AutowrapMode.WordSmart });
        _geologistInfo = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        panel.AddChild(_geologistInfo);
        var estimate = new Button { Text = "Update grade estimate" };
        estimate.Pressed += () =>
        {
            _mine.UpdateEstimates();
            Refresh();
        };
        panel.AddChild(estimate);
        return panel;
    }

    private Control PlannerPanel()
    {
        var panel = new VBoxContainer { Name = "Mine Planner" };
        var cutoffLabel = new Label();
        var cutoff = new HSlider { MinValue = 0.2, MaxValue = 3, Step = 0.05, Value = _mine.PlanSettings.CutoffGrade };
        cutoffLabel.Text = $"Cutoff grade: {cutoff.Value:F2} g/t";
        cutoff.ValueChanged += value =>
        {
            _mine.PlanSettings = _mine.PlanSettings with { CutoffGrade = value };
            cutoffLabel.Text = $"Cutoff grade: {value:F2} g/t";
        };
        panel.AddChild(cutoffLabel);
        panel.AddChild(cutoff);

        var plan = new Button { Text = "Plan pit" };
        plan.Pressed += () =>
        {
            _mine.PlanPit();
            _map.Mode = MapMode.Plan;
            Refresh();
        };
        panel.AddChild(plan);
        _planInfo = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        panel.AddChild(_planInfo);
        return panel;
    }

    private Control OperatorPanel()
    {
        var panel = new VBoxContainer { Name = "Equipment Operator" };
        panel.AddChild(new Label { Text = "Haul trucks" });
        var trucks = new SpinBox { MinValue = 1, MaxValue = 20, Value = _mine.Trucks };
        trucks.ValueChanged += value =>
        {
            _mine.Trucks = (int)value;
            Refresh();
        };
        panel.AddChild(trucks);
        _fleetInfo = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        panel.AddChild(_fleetInfo);
        return panel;
    }

    private Control PlantPanel()
    {
        var panel = new VBoxContainer { Name = "Plant Operator" };
        var feedLabel = new Label();
        var feed = new HSlider { MinValue = 50, MaxValue = 800, Step = 10, Value = _mine.PlantSettings.FeedRateTph };
        var grindLabel = new Label();
        var grind = new HSlider { MinValue = 53, MaxValue = 250, Step = 1, Value = _mine.PlantSettings.GrindP80 };

        void Apply()
        {
            _mine.PlantSettings = new MiningSim.Core.Processing.PlantSettings(feed.Value, grind.Value);
            feedLabel.Text = $"Feed rate: {feed.Value:N0} t/h";
            grindLabel.Text = $"Grind size (P80): {grind.Value:N0} microns";
            Refresh();
        }

        feed.ValueChanged += _ => Apply();
        grind.ValueChanged += _ => Apply();
        panel.AddChild(feedLabel);
        panel.AddChild(feed);
        panel.AddChild(grindLabel);
        panel.AddChild(grind);
        _plantInfo = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        panel.AddChild(_plantInfo);
        feedLabel.Text = $"Feed rate: {feed.Value:N0} t/h";
        grindLabel.Text = $"Grind size (P80): {grind.Value:N0} microns";
        return panel;
    }

    private void OnRoleChanged(Role role)
    {
        _mine.SwitchRole(role);
        _map.Mode = role == Role.Geologist ? MapMode.Estimates : MapMode.Plan;
        Refresh();
    }

    private void OnMapClicked(double x, double y)
    {
        if (_mine.ActiveRole != Role.Geologist) return;
        if (!_mine.Exploration.CanAfford(HoleDepth))
        {
            _report.AppendText("[color=orange]Not enough exploration budget for another hole.[/color]\n");
            return;
        }

        var hole = _mine.Exploration.Drill(x, y, HoleDepth);
        var best = hole.Assays.MaxBy(a => a.Grade)!;
        _report.AppendText($"Hole {hole.Id} at ({x:N0}, {y:N0}): best {best.Grade:F2} g/t from {best.FromDepth:N0} to {best.ToDepth:N0} m.\n");
        _mine.UpdateEstimates();
        Refresh();
    }

    private void OnRunShift()
    {
        var r = _mine.RunShift();
        _report.AppendText(
            $"Shift {r.Shift}: ore {r.OreHauled:N0} t (planned {r.PlannedOreGrade:F2} g/t, actual {r.TrueOreGrade:F2}), " +
            $"waste {r.WasteHauled:N0} t, milled {r.Plant.TonnesMilled:N0} t at {r.Plant.Recovery:P0} recovery, " +
            $"{r.Plant.GoldOunces:N0} oz, profit {r.Profit:N0}.\n");
        Refresh();
    }

    private void Refresh()
    {
        var model = _mine.Model;
        _status.Text = $"Role: {_mine.ActiveRole}    Cash: {_mine.Cash:N0}    Shifts worked: {_mine.ShiftsWorked}";
        _levelLabel.Text = $"Level {_map.Level} ({_map.Level * model.BlockSize:N0} to {(_map.Level + 1) * model.BlockSize:N0} m)";

        _geologistInfo.Text =
            $"Holes drilled: {_mine.Exploration.Holes.Count}\n" +
            $"Budget left: {_mine.Exploration.Budget:N0}\n" +
            $"Next {HoleDepth:N0} m hole costs {_mine.Exploration.CostOf(HoleDepth):N0}";

        _planInfo.Text = _mine.Plan is { } plan
            ? $"Ore: {plan.OreTonnes:N0} t at {plan.AverageOreGrade:F2} g/t\nWaste: {plan.WasteTonnes:N0} t\nStrip ratio: {plan.StripRatio:F1}\nContained gold: {plan.ContainedOunces:N0} oz\nBlocks dug: {_mine.BlocksDug} of {plan.Sequence.Count}"
            : "No plan yet.";

        _fleetInfo.Text = $"{_mine.Trucks} trucks of {_mine.Settings.Truck.PayloadTonnes:N0} t, one {_mine.Settings.Excavator.Name.ToLowerInvariant()}.";

        var plant = _mine.Plant;
        var p80 = _mine.PlantSettings.GrindP80;
        _plantInfo.Text =
            $"Mill capacity at this grind: {plant.CapacityTph(p80):N0} t/h\n" +
            $"Expected recovery: {plant.Recovery(p80):P1}\n" +
            $"Cost: {plant.CostPerTonne(p80):N2} per tonne\n" +
            $"Ore waiting on the stockpile: {plant.Feed.Tonnes:N0} t at {plant.Feed.Grade:F2} g/t";

        _map.QueueRedraw();
    }
}
