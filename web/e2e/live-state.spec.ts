import { test, expect } from "@playwright/test";

test("station tooltip and state tables follow playback without moving the pointer", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const network = {
    meta: { name: "Live replay", synthetic: true },
    stations: [
      { id: "A", name: "Станция A", x: 200, y: 500 },
      { id: "B", name: "Станция B", x: 800, y: 500 },
    ],
    lines: [
      { id: "L1", name: "Линия 1", color: "#397DAD", stations: ["A", "B"] },
    ],
    segments: [{ from: "A", to: "B", run_time_s: 100 }],
    transfers: [],
    train: { capacity: 100, turnaround_s: 120 },
    fleet: 2,
    demand: [],
    settings: { day_start_s: 18000, day_end_s: 18600 },
  };
  const trajectory = {
    meta: { day_start_s: 18000, day_end_s: 18600, simulation_end_s: 18600 },
    trains: [
      { train: 0, line: "L1", station: "B", direction: -1 },
      { train: 1, line: "L1", station: "A", direction: 1 },
    ],
    trips: [
      {
        train: 0,
        line: "L1",
        direction: -1,
        from: "B",
        to: "A",
        departure: 18020,
        ready: 18120,
        arrival: 18150,
        load: 12.4,
      },
    ],
    stops: [
      {
        train: 0,
        line: "L1",
        direction: -1,
        station: "B",
        arrival: 18000,
        ready: 18020,
        departure: 18020,
        load: 12.4,
        delay_s: 0,
        retire: false,
      },
      {
        train: 0,
        line: "L1",
        direction: -1,
        station: "A",
        arrival: 18150,
        ready: 18170,
        departure: 18170,
        load: 0,
        delay_s: 0,
        retire: true,
      },
    ],
    series: [],
    queue_events: [
      { time: 18000, station: "A", delta: 4.2 },
      { time: 18060, station: "A", delta: 5.6 },
      { time: 18090, station: "A", delta: -9.8 },
    ],
    queue_directions: [
      { time: 18000, station: "A", towards: "B", delta: 4.2 },
      { time: 18060, station: "A", towards: "B", delta: 5.6 },
      { time: 18090, station: "A", towards: "B", delta: -9.8 },
    ],
  };
  await page.route("**/api/networks/b_transfer", (route) =>
    route.fulfill({ json: network }),
  );
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      json: {
        run_id: "live-state",
        deadlock: false,
        validation: { errors: [] },
        metrics: {
          W: 0,
          LF: 0,
          transported: 10,
          unfinished: 0,
          used_trains: 1,
          release_delay_s: 0,
          waiting: 0,
        },
      },
    }),
  );
  await page.route("**/api/runs/live-state/trajectory", (route) =>
    route.fulfill({ json: trajectory }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await expect(page.locator("div[role=status]")).toContainText("Прогон готов");
  await page.getByLabel("Пауза", { exact: true }).click();
  const slider = page.getByLabel("Время симуляции");
  await slider.fill("18030");
  const canvas = page.getByLabel("Карта сети метро");
  const box = (await canvas.boundingBox())!;
  const scale = Math.min((box.width - 120) / 1000, (box.height - 100) / 1000);
  await canvas.hover({
    position: {
      x: (box.width - 1000 * scale) / 2 + 200 * scale,
      y: box.height / 2,
    },
  });
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Ожидают ≈4 пасс.");
  const station = page.getByTestId("station-state-A");
  await expect(station.getByTestId("station-waiting")).toHaveText("4");
  await expect(station).toContainText("Станция B");
  // DOM input events do not move the physical pointer away from the station.
  await slider.fill("18070");
  await expect(tooltip).toContainText("Ожидают ≈10 пасс.");
  await expect(station.getByTestId("station-waiting")).toHaveText("10");
  await slider.fill("18100");
  await expect(tooltip).toContainText("Ожидают ≈0 пасс.");
  await slider.fill("18030");
  await expect(tooltip).toContainText("Ожидают ≈4 пасс.");
  // Playback crosses the next queue event under a stationary pointer.
  await page.getByLabel("Скорость времени").selectOption("10");
  await page.getByLabel("Продолжить", { exact: true }).click();
  await canvas.hover({
    position: {
      x: (box.width - 1000 * scale) / 2 + 200 * scale,
      y: box.height / 2,
    },
  });
  await expect(tooltip).toContainText("Ожидают ≈10 пасс.", { timeout: 7000 });
  await page.getByLabel("Пауза", { exact: true }).click();
  await page.getByRole("tab", { name: "Поезда (2)" }).click();
  await slider.fill("18030");
  await expect(page.getByTestId("train-state-0")).toContainText("В пути");
  await expect(page.getByTestId("train-state-0")).toContainText("12 / 100");
  await expect(page.getByTestId("train-state-1")).toContainText("В депо");
  await slider.fill("18130");
  await expect(page.getByTestId("train-state-0")).toContainText(
    "Ждёт платформу",
  );
  await slider.fill("18160");
  await expect(page.getByTestId("train-state-0")).toContainText("Стоянка");
  await slider.fill("18180");
  await expect(page.getByTestId("train-state-0")).toContainText("Разворот");
  await slider.fill("18300");
  await expect(page.getByTestId("train-state-0")).toContainText("В депо");
  await slider.fill("18030");
  await expect(page.getByTestId("train-state-0")).toContainText("В пути");
  await page
    .getByRole("region", { name: "Состояние сети сейчас" })
    .screenshot({ path: testInfo.outputPath("trains.png") });
  await page.getByRole("tab", { name: "Станции (2)" }).click();
  await page
    .getByRole("region", { name: "Состояние сети сейчас" })
    .screenshot({ path: testInfo.outputPath("stations.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
