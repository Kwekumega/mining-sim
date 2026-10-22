# Mining Sim

A single-player, realistic mining simulation for PC where you can work any role in a mine.

- `src/MiningSim.Core`: the simulation, with no engine dependency (geology, exploration, later equipment, plant and economy).
- `tests/MiningSim.Tests`: xUnit tests for the simulation.
- `game`: the Godot 4 (.NET) project that renders the sim.
- `web`: the browser game, **MineLife**: a 3D low-poly life sim (three.js) in Sikakrom, a fictional Ghanaian gold-mining town. Take mine jobs from your phone (labourer, core shed, truck driver, excavator, plant, geologist), earn cedis, train for promotions, and keep hunger, energy, fun, social and hygiene up while paying rent. Code in `web/src/life`. The earlier Phaser top-down mine (`web/src/game`) and the TypeScript sim (`web/src/sim`) are still in the repo.

## Web version

```
cd web
npm install
npm test        # sim and life-model tests
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
