# Mining Sim

A single-player, realistic mining simulation for PC where you can work any role in a mine.

- `src/MiningSim.Core`: the simulation, with no engine dependency (geology, exploration, later equipment, plant and economy).
- `tests/MiningSim.Tests`: xUnit tests for the simulation.
- `game`: the Godot 4 (.NET) project that renders the sim.
- `web`: the browser game, **MineLife**: a 3D low-poly life sim (three.js) in Sikakrom, a fictional Ghanaian gold-mining town. Take mine jobs from your phone (labourer, core shed, truck driver, excavator, plant, geologist, shift supervisor), level up your skill in each job for better pay, earn cedis, train for promotions, make friends around town, buy a motorbike, move to a bigger home, chase goals on your phone, and keep hunger, energy, fun, social and hygiene up while paying rent. The town has a physically based sky with clouds and stars, afternoon rainstorms, grass, leafy trees and palms, and truck dust on the mine. Code in `web/src/life`. The earlier Phaser top-down mine (`web/src/game`) and the TypeScript sim (`web/src/sim`) are still in the repo.

## PC version (Windows)

`desktop` wraps the game in its own window with Electron, so it runs as a normal PC game with no browser.

- **Download:** every push to `main` builds it on GitHub. Open the repo's **Actions** tab, pick the latest **PC build** run, and download **MineLife-Windows**. It has an installer (`MineLife-…-nsis.exe`) and a portable `.exe` that runs without installing. Pushing a tag such as `v0.3.0` also attaches both to a GitHub Release.
- The build is not code-signed yet, so Windows SmartScreen may warn on first launch: choose **More info → Run anyway**.
- Controls: WASD to move, Shift to run, E to act (talk, work, ride), F to get off a vehicle, P for the phone, M for the map, F11 or Alt+Enter for fullscreen.
- Graphics: the game picks a preset from your GPU (High on a dedicated NVIDIA or AMD card, Medium on integrated graphics) and steps down if the frame rate drops. Change it under Phone → Me: Low, Medium, High (aimed at 2 GB laptop GPUs) or Ultra (adds ambient occlusion and sharper shadows).

Build it yourself (Node 20):

```
cd web && npm ci && npm run build
cd ../desktop && npm ci
npm start          # play
npm run dist:win   # Windows installer and portable .exe in desktop/release
```

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
