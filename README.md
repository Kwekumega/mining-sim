# Mining Sim

A single-player, realistic mining simulation for PC where you can work any role in a mine.

- `src/MiningSim.Core`: the simulation, with no engine dependency (geology, exploration, later equipment, plant and economy).
- `tests/MiningSim.Tests`: xUnit tests for the simulation.
- `game`: the Godot 4 (.NET) project that renders the sim.
- `web`: the browser game. The sim is ported to TypeScript (`web/src/sim`); the animated top-down mine is built with Phaser (`web/src/game`).

## Web version

```
cd web
npm install
npm test        # sim tests
npm run dev     # play locally
npm run build   # one self-contained dist/index.html
```

## Run the tests

```
dotnet test
```

## Open the game

Install the Godot 4.3 .NET edition and the .NET 8 SDK, open `game/project.godot`, then press Play.

The prototype screen has a top-down map of one mine level and a tab per role:

- **Geologist**: click the map to drill a hole; the map shows estimated grade, faded where confidence is low.
- **Mine Planner**: set the cutoff grade and plan the pit; the map shows ore (gold) and waste (brown).
- **Equipment Operator**: set the number of haul trucks.
- **Plant Operator**: set feed rate and grind size, and see capacity, recovery and cost.

Press **Run 12 hour shift** to dig, haul, process and sell. The report compares planned and actual ore grade.
