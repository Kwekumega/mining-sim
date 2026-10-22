import { LiveMine } from "./live";

function ready() {
  const live = new LiveMine(42, { explorationBudget: 1e12, startingCash: 2e12 });
  for (let x = 25; x < 400; x += 50) for (let y = 25; y < 400; y += 50) live.mine.exploration.drill(x, y, 200);
  live.mine.updateEstimates();
  live.mine.planPit();
  return live;
}

describe("live mine", () => {
  it("starts at 06:00 on day 1", () => {
    const live = new LiveMine(1);
    expect(live.clock).toBe(6);
    expect(live.day).toBe(1);
  });

  it("closes a shift every 12 hours", () => {
    const live = new LiveMine(1);
    expect(live.advance(5, 0)).toHaveLength(0);
    expect(live.advance(8, 0)).toHaveLength(1);
    expect(live.advance(24, 0)).toHaveLength(2);
    expect(live.shift.number).toBe(4);
  });

  it("feeds the plant from ore delivered to the crusher", () => {
    const live = ready();
    let load = live.loadTruck();
    while (load && load.destination !== "ore") load = live.loadTruck();
    live.deliver(load!, "crusher");
    expect(live.mine.plant.feed.tonnes).toBe(load!.tonnes);
    expect(live.reconciliation).toBeCloseTo(load!.trueGrade / load!.plannedGrade);
  });

  it("loses ore tipped on the waste dump", () => {
    const live = ready();
    let load = live.loadTruck();
    while (load && load.destination !== "ore") load = live.loadTruck();
    live.deliver(load!, "dump");
    expect(live.shift.oreLost).toBe(load!.tonnes);
    expect(live.mine.plant.feed.tonnes).toBe(0);
  });

  it("charges for trucks and earns from milled gold", () => {
    const live = ready();
    const cash = live.mine.cash;
    live.advance(1, 4);
    expect(live.mine.cash).toBeLessThan(cash);

    for (let n = 0; n < 3000; n++) {
      const load = live.loadTruck();
      if (load) live.deliver(load, load.destination === "ore" ? "crusher" : "dump");
    }
    live.advance(12, 0);
    expect(live.totalOunces).toBeGreaterThan(0);
  });

  it("returns no load without a plan", () => {
    expect(new LiveMine(1).loadTruck()).toBeNull();
  });
});
