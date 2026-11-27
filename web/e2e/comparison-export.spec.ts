import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";

test("Excel compares the original search snapshot and selected plan across midnight", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const network = {
    meta: { name: "Excel regression", synthetic: true, format_version: "1.0" },
    stations: [
      { id: "A", name: "Alpha", x: 200, y: 500 },
      { id: "B", name: "Beta", x: 500, y: 500 },
      { id: "C", name: "Gamma", x: 800, y: 500 },
    ],
    lines: [
      { id: "L1", name: "Первая", color: "#397DAD", stations: ["A", "B"] },
      { id: "L2", name: "Вторая", color: "#C65B49", stations: ["B", "C"] },
    ],
    segments: [
      { from: "A", to: "B", run_time_s: 60 },
      { from: "B", to: "C", run_time_s: 60 },
    ],
    transfers: [],
    train: { capacity: 100 },
    fleet: 4,
    demand: [],
    settings: { day_start_s: 82800, day_end_s: 93600 },
    schedule: {
      period_len_min: 60,
      headways: { L1: [180, 300, 600], L2: [200, 400, 800] },
    },
    fleet_assignment: { L1: 2, L2: 2 },
  };
  const baseMetrics = {
    W: 120,
    transported: 1000,
    unfinished: 20,
    LF: 0.5,
    E: 0.5,
    used_trains: 4,
    release_delay_s: 8,
    D: 0.02,
    Qn: 0.3,
  };
  const baseline = {
    headways: network.schedule.headways,
    fleet_assignment: { L1: 2, L2: 2 },
    metrics: baseMetrics,
    f_A: 130,
    f_B: 0.5,
    std: { W: 2 },
  };
  const point = {
    headways: { L1: [120, 180, 240], L2: [150, 300, 600] },
    fleet_assignment: { L1: 3, L2: 1 },
    metrics: {
      ...baseMetrics,
      W: 90,
      transported: 1010,
      unfinished: 10,
      LF: 0.7,
      E: 0.3,
      release_delay_s: 4,
    },
    f_A: 100,
    f_B: 0.4,
    std: { W: 1 },
  };
  const names = [
    "Минимум ожидания",
    "Минимум пустых поездов",
    "Сбалансированный",
    "Мой вариант",
  ];
  const result = {
    baseline,
    front: [point],
    options: names.map((name, i) => ({
      ...(i === 3 ? baseline : point),
      name,
    })),
    generations_completed: 1,
    evaluations: 4,
    compute_seconds: 1,
    od_source: "model",
    reproducible: true,
    stop_reason: "evaluation_budget",
  };
  await page.route("**/api/networks/b_transfer", (r) =>
    r.fulfill({ json: network }),
  );
  await page.route("**/api/optimize", (r) =>
    r.fulfill({ json: { job_id: "excel-test" } }),
  );
  await page.route("**/api/jobs/excel-test", (r) =>
    r.fulfill({ json: { status: "done", result } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Все периоды", exact: true }).click();
  const schedule = page.getByRole("table", {
    name: "Интервалы и парк по веткам",
  });
  await expect(schedule).toContainText("00:00 (следующий день)");
  await expect(schedule).not.toContainText("24:00");
  await expect(schedule).not.toContainText("25:00");
  await page
    .getByRole("button", { name: "Оптимизировать", exact: true })
    .click();
  await expect(page.getByTestId("export-option-2")).toBeVisible();
  // Editing the current network after the search must not alter the exported baseline.
  await page
    .getByLabel("Интервал Первая период 1", { exact: true })
    .fill("900");
  const downloadEvent = page.waitForEvent("download");
  await page.getByTestId("export-option-2").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(
    "metro-comparison-Сбалансированный.xlsx",
  );
  const filename = testInfo.outputPath("comparison.xlsx");
  await download.saveAs(filename);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(filename);
  expect(book.worksheets.map((s) => s.name)).toEqual([
    "Интервалы",
    "Показатели",
  ]);
  const plan = book.getWorksheet("Интервалы")!;
  expect(plan.rowCount).toBe(7);
  expect(plan.getRow(1).values).toEqual([
    undefined,
    "Ветка",
    "Начало",
    "Конец",
    "Исходный интервал, с",
    "Новый интервал, с",
    "Разница, с",
    "Разница, %",
    "Исходный парк",
    "Новый парк",
  ]);
  const old = [180, 300, 600, 200, 400, 800],
    next = [120, 180, 240, 150, 300, 600];
  for (let i = 0; i < 6; i++) {
    const row = i + 2;
    expect(plan.getCell(row, 4).value).toBe(old[i]);
    expect(plan.getCell(row, 5).value).toBe(next[i]);
    expect(plan.getCell(row, 6).value).toEqual({
      formula: `E${row}-D${row}`,
      result: next[i] - old[i],
    });
    expect((plan.getCell(row, 7).value as any).result).toBeCloseTo(
      (next[i] - old[i]) / old[i],
    );
    expect(plan.getCell(row, 8).value).toBe(2);
    expect(plan.getCell(row, 9).value).toBe(i < 3 ? 3 : 1);
  }
  const serial = (v: any) =>
    v instanceof Date ? (v.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : v;
  expect(serial(plan.getCell("B2").value)).toBeCloseTo(23 / 24);
  expect(serial(plan.getCell("C2").value)).toBe(1);
  expect(plan.getCell("C2").numFmt).toContain("следующий день");
  expect(serial(plan.getCell("C4").value)).toBeCloseTo(26 / 24);
  expect(plan.getCell("B3").numFmt).not.toContain("[h]");
  const metrics = book.getWorksheet("Показатели")!;
  expect(metrics.getCell("C2").value).toBe(120);
  expect(metrics.getCell("D2").value).toBe(90);
  expect(metrics.getCell("E2").value).toEqual({
    formula: "D2-C2",
    result: -30,
  });
  expect(metrics.getCell("C5").value).toBe(50);
  expect(metrics.getCell("D5").value).toBe(70);
  // The file is two plain tables: no instruction paragraphs or extra sheets.
  expect(metrics.rowCount).toBe(10);
  expect(errors).toEqual([]);
});

test("playback preserves clock and day after crossing midnight", async ({
  page,
}) => {
  const network = {
    meta: { name: "Midnight", synthetic: true },
    stations: [
      { id: "A", name: "Alpha", x: 200, y: 500 },
      { id: "B", name: "Beta", x: 800, y: 500 },
    ],
    lines: [
      { id: "L1", name: "Линия", color: "#397DAD", stations: ["A", "B"] },
    ],
    segments: [{ from: "A", to: "B", run_time_s: 60 }],
    transfers: [],
    train: { capacity: 100 },
    fleet: 2,
    demand: [],
    settings: { day_start_s: 82800, day_end_s: 93600 },
  };
  const trajectory = {
    meta: { day_start_s: 82800, day_end_s: 93600, simulation_end_s: 93600 },
    trips: [],
    stops: [],
    series: [],
    trains: [],
    queue_events: [{ time: 86400, station: "A", delta: 4 }],
    queue_directions: [{ time: 86400, station: "A", towards: "B", delta: 4 }],
  };
  await page.route("**/api/networks/b_transfer", (r) =>
    r.fulfill({ json: network }),
  );
  await page.route("**/api/simulate", (r) =>
    r.fulfill({
      json: {
        run_id: "midnight",
        validation: { errors: [] },
        metrics: {
          W: 0,
          LF: 0,
          transported: 0,
          unfinished: 4,
          used_trains: 0,
          release_delay_s: 0,
        },
        deadlock: false,
      },
    }),
  );
  await page.route("**/api/runs/midnight/trajectory", (r) =>
    r.fulfill({ json: trajectory }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await page.getByLabel("Пауза", { exact: true }).click();
  await page.getByLabel("Время симуляции").fill("90034");
  await expect(page.getByTestId("live-time")).toHaveText(
    "01:00:34следующий день",
  );
  await expect(page.locator(".playback .clock")).toContainText("01:00");
  await expect(page.locator(".playback .clock")).toContainText(
    "следующий день",
  );
  await expect(
    page.getByTestId("station-state-A").getByTestId("station-waiting"),
  ).toHaveText("4");
  await page.getByLabel("Время симуляции").fill("83000");
  await expect(page.getByTestId("live-time")).not.toContainText(
    "следующий день",
  );
  await expect(
    page.getByTestId("station-state-A").getByTestId("station-waiting"),
  ).toHaveText("0");
});
