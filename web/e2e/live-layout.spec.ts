import { expect, test } from "@playwright/test";

test("real demo keeps station rows stable at different times", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await page
    .getByRole("button", { name: "Пауза таблиц и карты", exact: true })
    .click();
  const slider = page.getByLabel("Время симуляции");
  const snapshot = () =>
    page.locator("#station-panel").evaluate((panel) => ({
      rows: [...panel.querySelectorAll("tbody tr")].map((row) => ({
        height: row.getBoundingClientRect().height,
        widths: [...row.children].map(
          (cell) => cell.getBoundingClientRect().width,
        ),
        directions: [...row.querySelectorAll(".direction-list span")].map(
          (s) => s.textContent,
        ),
      })),
      height: panel.getBoundingClientRect().height,
    }));
  const initial = await snapshot();
  for (const time of ["18544", "30600", "64800", "18000"]) {
    await slider.fill(time);
    expect(await snapshot()).toEqual(initial);
  }
  await slider.fill("18544");
  await page
    .getByRole("region", { name: "Состояние сети сейчас" })
    .screenshot({ path: testInfo.outputPath("demo-stations.png") });
  await page.getByRole("tab", { name: "Поезда (10)" }).click();
  await page
    .getByRole("region", { name: "Состояние сети сейчас" })
    .screenshot({ path: testInfo.outputPath("demo-trains.png") });
});

test("station directions and train rows keep their positions during replay", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const stations = Array.from({ length: 12 }, (_, i) => ({
    id: `S${i}`,
    name: `Станция ${i + 1}`,
    x: 100 + i * 60,
    y: 500,
  }));
  const network = {
    meta: { name: "Stable tables", synthetic: true },
    stations,
    lines: [
      {
        id: "L1",
        name: "Линия 1",
        color: "#397DAD",
        stations: stations.map((s) => s.id),
      },
    ],
    segments: stations
      .slice(1)
      .map((s, i) => ({ from: stations[i].id, to: s.id, run_time_s: 30 })),
    transfers: [],
    train: { capacity: 100, turnaround_s: 120 },
    fleet: 2,
    demand: [],
    settings: { day_start_s: 18000, day_end_s: 18600 },
  };
  const trajectory = {
    meta: { day_start_s: 18000, day_end_s: 18600, simulation_end_s: 18600 },
    trains: [
      { train: 0, line: "L1", station: "S0", direction: 1 },
      { train: 1, line: "L1", station: "S11", direction: -1 },
    ],
    stops: [
      {
        train: 0,
        line: "L1",
        direction: 1,
        station: "S0",
        arrival: 18000,
        ready: 18020,
        departure: 18080,
        load: 12.4,
      },
    ],
    trips: [
      {
        train: 0,
        line: "L1",
        direction: 1,
        from: "S0",
        to: "S1",
        departure: 18080,
        ready: 18110,
        arrival: 18150,
        load: 12.4,
      },
    ],
    series: [],
    queue_events: [
      { time: 18000, station: "S0", delta: 12 },
      { time: 18060, station: "S0", delta: 0 },
      { time: 18090, station: "S0", delta: -12 },
    ],
    queue_directions: [
      { time: 18000, station: "S0", towards: "S1", delta: 10 },
      { time: 18000, station: "S0", towards: "S2", delta: 2 },
      { time: 18060, station: "S0", towards: "S1", delta: -9 },
      { time: 18060, station: "S0", towards: "S2", delta: 9 },
      { time: 18090, station: "S0", towards: "S1", delta: -1 },
      { time: 18090, station: "S0", towards: "S2", delta: -11 },
    ],
  };
  await page.route("**/api/networks/b_transfer", (r) =>
    r.fulfill({ json: network }),
  );
  await page.route("**/api/simulate", (r) =>
    r.fulfill({
      json: {
        run_id: "layout",
        deadlock: false,
        validation: { errors: [] },
        metrics: {
          W: 0,
          LF: 0,
          transported: 0,
          unfinished: 0,
          used_trains: 1,
          release_delay_s: 0,
        },
      },
    }),
  );
  await page.route("**/api/runs/layout/trajectory", (r) =>
    r.fulfill({ json: trajectory }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await page.getByLabel("Пауза", { exact: true }).click();
  const slider = page.getByLabel("Время симуляции");
  const station = page.getByTestId("station-state-S0");
  await slider.fill("18010");
  const geometry = () =>
    page.locator("#station-panel").evaluate((panel) => ({
      height: panel.getBoundingClientRect().height,
      rows: [...panel.querySelectorAll("tbody tr")].map((r) => ({
        top: r.getBoundingClientRect().top - panel.getBoundingClientRect().top,
        height: r.getBoundingClientRect().height,
        cells: [...r.children].map((c) => c.getBoundingClientRect().width),
      })),
    }));
  const initial = await geometry();
  const order = await station.locator(".direction-list span").allTextContents();
  for (const time of ["18070", "18100", "18010"]) {
    await slider.fill(time);
    expect(
      await station.locator(".direction-list span").allTextContents(),
    ).toEqual(order);
    expect(await geometry()).toEqual(initial);
  }
  await slider.fill("18100");
  await expect(station.locator(".direction-list b")).toHaveText(["0", "0"]);
  await page.locator("#station-panel").evaluate((panel) => {
    panel.scrollTop = 140;
  });
  const scroll = await page
    .locator("#station-panel")
    .evaluate((p) => p.scrollTop);
  await slider.fill("18010");
  expect(
    await page.locator("#station-panel").evaluate((p) => p.scrollTop),
  ).toBe(scroll);
  await page.locator("#station-panel").evaluate((p) => {
    p.scrollTop = 0;
  });
  await page.getByLabel("Скорость времени").selectOption("60");
  await page
    .getByRole("button", { name: "Продолжить таблицы и карту", exact: true })
    .click();
  await expect(station.getByTestId("station-waiting")).toHaveText("0", {
    timeout: 5000,
  });
  await page
    .getByRole("button", { name: "Пауза таблиц и карты", exact: true })
    .click();
  expect(
    await station.locator(".direction-list span").allTextContents(),
  ).toEqual(order);
  expect(await geometry()).toEqual(initial);

  await page.getByRole("tab", { name: "Поезда (2)" }).click();
  const train = page.getByTestId("train-state-0");
  const first = await train.boundingBox();
  for (const time of ["18030", "18090", "18130", "18200"]) {
    await slider.fill(time);
    expect(await train.boundingBox()).toEqual(first);
  }
  await page
    .getByRole("region", { name: "Состояние сети сейчас" })
    .screenshot({ path: testInfo.outputPath("trains-stable.png") });
  await page.getByRole("tab", { name: "Станции (12)" }).click();
  await page.locator("#station-panel").evaluate((p) => {
    p.scrollTop = 0;
  });
  await page
    .getByRole("region", { name: "Состояние сети сейчас" })
    .screenshot({ path: testInfo.outputPath("stations-stable.png") });
  await page
    .getByRole("button", { name: "Продолжить таблицы и карту", exact: true })
    .click();
  await expect(page.getByLabel("Пауза", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Пауза таблиц и карты", exact: true })
    .click();
  await expect(page.getByLabel("Продолжить", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
