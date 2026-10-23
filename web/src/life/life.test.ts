import { BIKE_PRICE, friendLevel, HOMES, JOBS, levelFor, Life, OFFERS, RENT, TASKS_PER_SHIFT, xpForLevel } from "./life";

const life = (bg: "family" | "hustler" = "hustler") => new Life(1, bg);

describe("life", () => {
  it("starts on day 1 at 07:00 with background cash", () => {
    expect(life().clock).toBe("07:00");
    expect(life("family").money).toBe(1500);
    expect(life("hustler").money).toBe(300);
  });

  it("needs drain with time, faster at work", () => {
    const idle = life();
    idle.tick(120, "idle");
    const worker = life();
    worker.takeJob("labourer");
    worker.clockIn();
    worker.tick(120, "idle");
    expect(idle.needs.hunger).toBeLessThan(70);
    expect(worker.needs.energy).toBeLessThan(idle.needs.energy);
  });

  it("food costs cedis and fills you up", () => {
    const l = life();
    l.needs.hunger = 20;
    const waakye = OFFERS.chopBar!.find((o) => o.id === "waakye")!;
    expect(l.use(waakye)).toBeNull();
    expect(l.money).toBe(280);
    expect(l.needs.hunger).toBe(60);
  });

  it("refuses what you can't afford", () => {
    const l = life();
    l.money = 5;
    expect(l.use(OFFERS.chopBar![2])).toMatch(/GH₵ 45/);
    expect(l.money).toBe(5);
  });

  it("locks jobs behind training and experience", () => {
    const l = life("family");
    expect(l.takeJob("driver")).toMatch(/licence/);
    expect(l.train("haulLicence")).toBeNull();
    expect(l.takeJob("driver")).toBeNull();
    expect(l.blocker("geologist")).toMatch(/diploma/);
  });

  it("pays a shift on clock-out and counts it after enough tasks", () => {
    const l = life();
    l.takeJob("labourer");
    expect(l.clockIn()).toBeNull();
    for (let n = 0; n < TASKS_PER_SHIFT; n++) l.completeTask();
    const { paid, counted } = l.clockOut();
    expect(paid).toBe(JOBS.labourer.pay * (TASKS_PER_SHIFT - 1) + Math.round(JOBS.labourer.pay * 1.05)); // level 1 after three tasks
    expect(counted).toBe(true);
    expect(l.money).toBe(300 + paid);
    expect(l.shiftsWorked.labourer).toBe(1);
  });

  it("only lets you clock in during shift hours", () => {
    const l = life();
    l.takeJob("labourer");
    l.passTime(12 * 60);
    expect(l.clockIn()).toMatch(/Shifts run/);
  });

  it("ends the shift when the shift hours end", () => {
    const l = life();
    l.takeJob("labourer");
    l.clockIn();
    l.completeTask();
    l.tick(12 * 60, "idle");
    expect(l.onShift).toBe(false);
    expect(l.money).toBe(300 + JOBS.labourer.pay);
  });

  it("pays less when you neglect yourself", () => {
    const l = life();
    l.takeJob("labourer");
    l.clockIn();
    l.needs.hunger = 5;
    expect(l.completeTask()).toBe(Math.round(JOBS.labourer.pay * 0.6));
  });

  it("sleep restores energy and moves to morning", () => {
    const l = life();
    l.passTime(15 * 60);
    l.needs.energy = 10;
    l.sleep();
    expect(l.needs.energy).toBeGreaterThan(90);
    expect(l.day).toBe(2);
    expect(l.clock).toBe("06:00");
  });

  it("evicts you when rent is too late and lets you back in once paid", () => {
    const l = life();
    l.money = 0;
    l.tick((RENT.everyDays + RENT.graceDays + 1) * 1440, "idle");
    expect(l.evicted).toBe(true);
    expect(l.sleep()).toBe(0);
    l.money = 1000;
    expect(l.payRent()).toBeNull();
    expect(l.evicted).toBe(false);
  });

  it("random events offer choices that change your life", () => {
    const l = life("family");
    const e = l.randomEvent();
    expect(e.choices.length).toBeGreaterThan(0);
    expect(typeof e.choices[0].apply(l)).toBe("string");
  });

  it("levels up a job with experience and pays more", () => {
    expect(levelFor(0)).toBe(0);
    expect(levelFor(xpForLevel(3))).toBe(3);
    const l = life();
    l.takeJob("labourer");
    l.clockIn();
    const first = l.completeTask(1);
    l.xp.labourer = xpForLevel(4) - 5;
    l.completeTask(1);
    expect(l.levelledUp).toBe(4);
    expect(l.completeTask(1)).toBe(Math.round(first * 1.2));
  });

  it("supervisor needs the safety certificate and driver shifts", () => {
    const l = life("family");
    expect(l.takeJob("supervisor")).toMatch(/safety/);
    l.certs.add("safetyCert");
    expect(l.takeJob("supervisor")).toMatch(/2 shifts/);
    l.shiftsWorked.driver = 2;
    expect(l.takeJob("supervisor")).toBeNull();
  });

  it("moving home pays the first week and changes the rent and sleep", () => {
    const l = life("family");
    l.minutes = 22 * 60;
    expect(l.moveHome("chamber")).toBeNull();
    expect(l.money).toBe(1500 - HOMES.chamber.rent);
    expect(l.rent).toBe(450);
    expect(l.rentDueDay).toBe(l.day + RENT.everyDays);
    l.needs.energy = 0;
    const hours = l.sleep();
    expect(l.needs.energy).toBeCloseTo(Math.min(100, hours * HOMES.chamber.rest));
  });

  it("buys a motorbike once", () => {
    const l = life();
    expect(l.buyBike()).toMatch(/costs/);
    l.money = BIKE_PRICE + 10;
    expect(l.buyBike()).toBeNull();
    expect(l.money).toBe(10);
    expect(l.buyBike()).toMatch(/already/);
  });

  it("friendship grows once a day per person", () => {
    const l = life();
    expect(l.chat("Esi")).toBe(12);
    expect(l.chat("Esi")).toBe(0);
    expect(friendLevel(l.friends.Esi)).toBe("Acquaintance");
    l.minutes += 1440;
    l.chat("Esi");
    l.minutes += 1440;
    l.chat("Esi");
    expect(friendLevel(l.friends.Esi)).toBe("Friend");
  });

  it("goals pay once", () => {
    const l = life();
    expect(l.checkGoals()).toEqual([]);
    l.takeJob("labourer");
    l.certs.add("haulLicence");
    const money = l.money;
    expect(l.checkGoals().map((g) => g.id).sort()).toEqual(["cert", "hired"]);
    expect(l.money).toBe(money + 30);
    expect(l.checkGoals()).toEqual([]);
  });
});
