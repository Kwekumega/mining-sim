# Mining Sim

A single-player, realistic mining simulation for PC where you can work any role in a mine.

- `src/MiningSim.Core`: the simulation, with no engine dependency (geology, exploration, later equipment, plant and economy).
- `tests/MiningSim.Tests`: xUnit tests for the simulation.
- `game`: the Godot 4 (.NET) project that renders the sim.

## Run the tests

```
dotnet test
```

## Open the game

Install Godot 4.3 .NET edition, open `game/project.godot`, then press Play. The placeholder scene builds a deposit, drills a grid of holes and logs the result.
