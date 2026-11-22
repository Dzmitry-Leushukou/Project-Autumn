import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
const screenshots = path.resolve("../docs/screenshots");
fs.mkdirSync(screenshots, { recursive: true });
async function configureSearch(page: Page) {
  await page.getByText("Параметры поиска", { exact: true }).click();
  await page.getByLabel("Популяция", { exact: true }).fill("4");
  await page.getByLabel("Поколения", { exact: true }).fill("1");
  await page.getByLabel("Seed при поиске", { exact: true }).fill("1");
  await page.getByLabel("Seed итоговой оценки", { exact: true }).fill("1");
  await page.getByText("Параметры поиска", { exact: true }).click();
}
test("demo: simulate, edit, optimize, replay and compare", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  let trajectories = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/trajectory")) trajectories++;
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Город в движении" }),
  ).toBeVisible();
  await page.getByLabel("Демо-сеть").selectOption("b_transfer");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await expect(page.locator("div[role=status]")).toContainText("Прогон готов");
  await page.getByLabel("Пауза", { exact: true }).click();
  await page
    .getByLabel("Интервал Линия 1 период 1", { exact: true })
    .fill("1200");
  await page
    .getByLabel("Чувствительность ко времени θ", { exact: true })
    .fill("0.03");
  await expect(page.locator("div[role=status]")).toContainText("Прогон готов");
  await configureSearch(page);
  await page
    .getByRole("button", { name: "Оптимизировать", exact: true })
    .click();
  await expect(page.getByTestId("option-3")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Фронт Парето: ожидание и ресурсы" }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(screenshots, "01-demo-options.png"),
    fullPage: true,
  });
  await page.getByTestId("option-2").click();
  await expect(page.locator("div[role=status]")).toContainText("Прогон готов");
  await page.getByLabel("Скорость времени").selectOption("300");
  await page.getByLabel("Тепловая карта").selectOption("queues");
  await page.getByLabel("Время симуляции").fill("30600");
  const count = trajectories;
  await page.waitForTimeout(2000);
  expect(trajectories).toBe(count);
  await page.screenshot({
    path: path.join(screenshots, "02-demo-replay.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("medium replay performance and mobile layout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Демо-сеть").selectOption("e_medium");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await expect(page.locator("div[role=status]")).toContainText("Прогон готов");
  await page.getByLabel("Скорость времени").selectOption("300");
  await page.waitForTimeout(2500);
  const times: number[] = await page.evaluate(
    () => (window as any).__metroFrameMs,
  );
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)],
    p95 = times[Math.floor(times.length * 0.95)];
  fs.writeFileSync(
    path.resolve("../docs/animation_benchmark.json"),
    JSON.stringify(
      { median_frame_ms: median, p95_frame_ms: p95, samples: times.length },
      null,
      2,
    ),
  );
  expect(median).toBeLessThan(22);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(screenshots, "05-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
test("constructor: build from clicks, doors, demand, optimize and run", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Конструктор", exact: true }).click();
  await page.getByRole("button", { name: "Новая сеть", exact: true }).click();
  const canvas = page.getByLabel("Карта сети метро");
  const box = (await canvas.boundingBox())!;
  const scale = Math.min((box.width - 120) / 1000, (box.height - 100) / 1000),
    ox = (box.width - 1000 * scale) / 2,
    oy = (box.height - 1000 * scale) / 2;
  const positions = [
    { x: ox + 200 * scale, y: oy + 350 * scale },
    { x: ox + 500 * scale, y: oy + 500 * scale },
    { x: ox + 800 * scale, y: oy + 350 * scale },
  ];
  for (const position of positions) await canvas.click({ position });
  await page.getByLabel("Название станции", { exact: true }).fill("Восточная");
  await page.getByLabel("Платформенные двери", { exact: true }).check();
  await page.getByLabel("Открытие дверей, с", { exact: true }).fill("5");
  await page.getByLabel("Пик, человек / 15 минут", { exact: true }).fill("150");
  await page.getByRole("button", { name: "Применить спрос к станции" }).click();
  await page.getByRole("button", { name: "Ветка", exact: true }).click();
  for (const position of positions) await canvas.click({ position });
  await configureSearch(page);
  await expect(
    page.getByRole("button", { name: "Оптимизировать", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: path.join(screenshots, "03-constructor.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Оптимизировать", exact: true })
    .click();
  await expect(page.getByTestId("option-0")).toBeVisible();
  await page.getByTestId("option-0").click();
  await expect(page.locator("div[role=status]")).toContainText("Прогон готов");
  await page.screenshot({
    path: path.join(screenshots, "04-custom-simulation.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("London TfL data loads in one action and compares options", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Демо-сеть").selectOption("london_subset");
  await expect(page.locator(".scenario-name")).toContainText("Лондон");
  await expect(page.locator(".scenario-name")).toContainText("NUMBAT 2025 TWT");
  await expect(page.locator(".scenario-name")).toContainText("Данные TfL");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await expect(page.locator("div[role=status]")).toContainText("Прогон готов");
  await configureSearch(page);
  await page
    .getByRole("button", { name: "Оптимизировать", exact: true })
    .click();
  await expect(page.getByTestId("option-3")).toBeVisible();
  await page.getByTestId("option-0").click();
  await expect(page.locator("div[role=status]")).toContainText("Прогон готов");
  await page.getByLabel("Время симуляции").fill("30600");
  await page.screenshot({
    path: path.join(screenshots, "06-london-comparison.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("queue panel and station tooltip agree between minute samples and after rewind", async ({
  page,
}) => {
  const network = {
    meta: {
      name: "Queue regression",
      synthetic: true,
      format_version: "1.0",
      description: "Synthetic",
    },
    stations: [
      { id: "A", name: "Alpha", x: 200, y: 500 },
      { id: "B", name: "Beta", x: 800, y: 500 },
    ],
    lines: [
      {
        id: "L1",
        name: "Line",
        color: "#397DAD",
        is_loop: false,
        stations: ["A", "B"],
      },
    ],
    segments: [{ from: "A", to: "B", run_time_s: 55 }],
    transfers: [],
    train: { capacity: 100 },
    fleet: 2,
    demand: [],
    settings: { day_start_s: 18000, day_end_s: 18600 },
  };
  const trajectory = {
    meta: { day_start_s: 18000, day_end_s: 18600, simulation_end_s: 18600 },
    trips: [],
    stops: [],
    series: [
      { time: 18000, waiting: { A: 10 } },
      { time: 18060, waiting: { A: 10 } },
      { time: 18120, waiting: { A: 0 } },
    ],
    queue_events: [
      { time: 18000, station: "A", delta: 10 },
      { time: 18075, station: "A", delta: -10 },
    ],
  };
  await page.route("**/api/networks/b_transfer", (route) =>
    route.fulfill({ json: network }),
  );
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      json: {
        run_id: "queue-repro",
        deadlock: false,
        validation: { errors: [] },
        metrics: {
          W: 0,
          LF: 0,
          transported: 10,
          unfinished: 0,
          used_trains: 2,
          release_delay_s: 0,
          waiting: 0,
        },
      },
    }),
  );
  await page.route("**/api/runs/queue-repro/trajectory", (route) =>
    route.fulfill({ json: trajectory }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await expect(page.locator("div[role=status]")).toContainText("Прогон готов");
  await page.getByLabel("Пауза", { exact: true }).click();
  const waiting = page
    .locator(".metric")
    .filter({ hasText: "Ожидают" })
    .locator("b");
  const canvas = page.getByLabel("Карта сети метро");
  const box = (await canvas.boundingBox())!;
  const scale = Math.min((box.width - 120) / 1000, (box.height - 100) / 1000);
  const position = {
    x: (box.width - 1000 * scale) / 2 + 200 * scale,
    y: box.height / 2,
  };
  for (const [time, expected] of [
    [18100, 0],
    [18070, 10],
    [18100, 0],
  ]) {
    await page.getByLabel("Время симуляции").fill(String(time));
    await expect(waiting).toHaveText(String(expected));
    await canvas.hover({ position });
    await expect(page.locator(".map-tooltip")).toContainText(
      `Ожидают ${expected.toFixed(1)}`,
    );
    await canvas.hover({ position: { x: 10, y: 10 } });
  }
});
