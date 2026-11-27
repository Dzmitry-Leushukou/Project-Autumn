import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";

test("constructor edits the scenario; simulation runs it and preserves navigation state", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const network = {
    meta: {
      name: "Разделение вкладок",
      synthetic: true,
      format_version: "1.0",
    },
    stations: [
      { id: "A", name: "Первая", x: 200, y: 500 },
      { id: "B", name: "Вторая", x: 800, y: 500 },
    ],
    lines: [
      { id: "L1", name: "Линия", color: "#397DAD", stations: ["A", "B"] },
    ],
    segments: [{ from: "A", to: "B", run_time_s: 60 }],
    transfers: [],
    train: { capacity: 100 },
    fleet: 4,
    fleet_assignment: { L1: 4 },
    demand: [{ station: "A", start_min: 300, len_min: 15, entries: 100 }],
    schedule: { period_len_min: 60, headways: { L1: [180] } },
    settings: {
      day_start_s: 18000,
      day_end_s: 21600,
      demand_noise: false,
      group_step_s: 60,
    },
  };
  await page.route("**/api/networks/b_transfer", (r) =>
    r.fulfill({ json: network }),
  );
  await page.goto("/");
  const constructorTab = page.getByRole("button", {
    name: "Конструктор",
    exact: true,
  });
  const simulationTab = page.getByRole("button", {
    name: "Симуляция",
    exact: true,
  });
  const demand = page.getByRole("region", {
    name: "Спрос по интервалам",
    exact: true,
  });
  const daily = page.getByRole("region", {
    name: "График за день",
    exact: true,
  });
  const schedule = page.getByRole("table", {
    name: "Интервалы и парк по веткам",
  });
  const optimize = page.getByRole("button", {
    name: "Оптимизировать",
    exact: true,
  });
  await expect(simulationTab).toHaveAttribute("aria-pressed", "true");
  await expect(demand).toBeHidden();
  await expect(page.getByLabel("Название сети", { exact: true })).toBeHidden();
  await expect(
    page.locator("summary").filter({ hasText: /^Пассажиры$/ }),
  ).toBeHidden();
  await expect(page.getByText("Время и спрос", { exact: true })).toBeHidden();
  await expect(daily).toBeVisible();
  await expect(schedule).toBeVisible();
  await expect(optimize).toBeVisible();

  await constructorTab.click();
  await expect(demand).toBeVisible();
  await expect(daily).toBeHidden();
  await expect(schedule).toBeHidden();
  await expect(optimize).toBeHidden();
  await expect(
    page.getByText("Параметры поиска", { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Показатели симуляции" }),
  ).toBeHidden();
  await page
    .getByLabel("Название сети", { exact: true })
    .fill("Сеть преподавателя");
  await page.getByLabel("Вместимость поезда", { exact: true }).fill("120");
  await demand
    .getByRole("button", { name: "Изменить интервал 05:00", exact: true })
    .click();
  await demand
    .getByLabel("Входящих за интервал, чел.", { exact: true })
    .fill("200");
  await demand
    .getByRole("button", { name: "Сохранить интервал", exact: true })
    .click();
  await page.getByText("Время и спрос", { exact: true }).click();
  await page.getByLabel("Файл спроса CSV").setInputFiles({
    name: "demand.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("station,start_min,len_min,entries\nB,300,15,50\n"),
  });
  await demand.getByLabel("Станция для спроса").selectOption("B");
  await expect(
    demand.getByRole("cell", { name: "50", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("constructor.png"),
    fullPage: true,
  });

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ Сохранить", exact: true }).click();
  const saved = JSON.parse(
    await fs.readFile((await (await downloadEvent).path())!, "utf8"),
  );
  expect(saved.meta.name).toBe("Сеть преподавателя");
  expect(saved.train.capacity.value).toBe(120);
  expect(
    saved.demand.map((r: any) =>
      typeof r.entries === "number" ? r.entries : r.entries.value,
    ),
  ).toEqual([200, 50]);
  await page.getByLabel("Файл сети").setInputFiles({
    name: "network.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(constructorTab).toHaveAttribute("aria-pressed", "true");
  await expect(demand).toBeVisible();

  const responseEvent = page.waitForResponse(
    (r) => r.url().endsWith("/api/simulate") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  const response = await responseEvent;
  expect(response.ok()).toBeTruthy();
  const completedRun = await response.json();
  expect(completedRun.metrics.appeared).toBeCloseTo(250, 8);
  await expect(simulationTab).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Пауза", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Станции и поезда", exact: true }),
  ).toBeVisible();
  await expect(demand).toBeHidden();
  await expect(daily).toBeVisible();
  await page.getByLabel("Скорость времени").selectOption("1");
  await constructorTab.click();
  const time = await page
    .getByLabel("Время на графике", { exact: true })
    .inputValue();
  await page.waitForTimeout(500);
  expect(
    await page.getByLabel("Время на графике", { exact: true }).inputValue(),
  ).toBe(time);
  await expect(
    page.getByLabel("Вместимость поезда", { exact: true }),
  ).toHaveValue("120");
  await simulationTab.click();
  await expect(page.getByLabel("Продолжить", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Время симуляции", { exact: true })).toHaveValue(
    time,
  );
  await expect(page.locator(".scenario-name")).toContainText(
    "Сеть преподавателя",
  );
  // A response received after leaving simulation must not restart hidden playback.
  let deliver!: () => void;
  const reply = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  await page.route("**/api/simulate", async (route) => {
    await reply;
    await route.fulfill({ json: completedRun });
  });
  const pending = page.waitForRequest("**/api/simulate");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await pending;
  await constructorTab.click();
  deliver();
  await expect(
    page.getByRole("button", { name: "▶ Запустить симуляцию" }),
  ).toBeEnabled();
  await simulationTab.click();
  await expect(page.getByLabel("Продолжить", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("simulation.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of [simulationTab, constructorTab]) {
    await tab.click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  }
  expect(errors).toEqual([]);
});
