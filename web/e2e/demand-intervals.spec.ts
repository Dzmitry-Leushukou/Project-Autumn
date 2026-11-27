import { expect, test } from "@playwright/test";
import {
  alignedDemandStep,
  plannedEntries,
  replaceDemand,
} from "../src/demandIntervals";
import type { Network } from "../src/model";

test("interval replacement preserves other stations and the unedited flow", () => {
  const rows = [
    {
      station: "A",
      start_min: 300,
      len_min: 60,
      entries: { value: 600, source: "data" },
    },
    { station: "B", start_min: 300, len_min: 60, entries: 60 },
  ];
  const next = replaceDemand(rows, "A", 18900, 19800, 300);
  expect(rows[0].entries).toEqual({ value: 600, source: "data" });
  expect(next.find((r) => r.station === "B")).toBe(rows[1]);
  const network = {
    demand: next,
    settings: { day_start_s: 18000, day_end_s: 21600, group_step_s: 120 },
  } as Network;
  expect(plannedEntries(network, "A", 18000, 18900)).toBe(150);
  expect(plannedEntries(network, "A", 18900, 19800)).toBe(300);
  expect(plannedEntries(network, "A", 19800, 21600)).toBe(300);
  expect(plannedEntries(network, "", 18000, 21600)).toBe(810);
  expect(alignedDemandStep(network.demand, 120, 18000, 21600)).toBe(60);
  expect(
    plannedEntries({ ...network, od_matrix: [] } as Network, "A", 18000, 21600),
  ).toBe(0);
});

test("intervals across midnight preserve exact totals and timing alignment", () => {
  const network = {
    demand: replaceDemand([], "A", 85500, 87300, 120),
    settings: { day_start_s: 82800, day_end_s: 90000, group_step_s: 120 },
  } as Network;
  expect(plannedEntries(network, "A", 85500, 86400)).toBe(60);
  expect(plannedEntries(network, "A", 86400, 87300)).toBe(60);
  expect(alignedDemandStep(network.demand, 120, 82800, 90000)).toBe(60);
  expect(alignedDemandStep(network.demand, 0.5, 82800, 90000)).toBe(0.5);
});

test("UI accepts an interval, simulates its exact demand and keeps daily axes stable", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const network = {
    meta: {
      name: "Interval regression",
      synthetic: true,
      format_version: "1.0",
      description: "",
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
    demand: [
      {
        station: "A",
        start_min: 300,
        len_min: 15,
        entries: { value: 24.2632, source: "assumption" },
      },
    ],
    schedule: { period_len_min: 60, headways: { L1: [180] } },
    settings: {
      day_start_s: 18000,
      day_end_s: 21600,
      demand_noise: false,
      group_step_s: 120,
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
  await constructorTab.click();
  const editor = page.getByRole("region", {
    name: "Спрос по интервалам",
    exact: true,
  });
  const counts = editor
    .getByRole("table", { name: "Интервалы спроса станции" })
    .locator("tbody tr td:nth-child(3)");
  await expect(counts).toHaveText(["24"]);
  await editor
    .getByRole("button", { name: "Изменить интервал 05:00", exact: true })
    .click();
  const countInput = editor.getByLabel("Входящих за интервал, чел.", {
    exact: true,
  });
  await expect(countInput).toHaveValue("24");
  await expect(countInput).toHaveAttribute("step", "1");
  for (const invalid of ["24.5", "-1", "", "9007199254740992"]) {
    await countInput.fill(invalid);
    await editor
      .getByRole("button", { name: "Сохранить интервал", exact: true })
      .click();
    await expect(editor.getByRole("alert")).toContainText("целое");
    await expect(counts).toHaveText(["24"]);
  }
  await countInput.fill("24");
  await editor
    .getByRole("button", { name: "Сохранить интервал", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect(editor).toContainText("24 чел.");
  await editor
    .getByLabel("Начало интервала спроса", { exact: true })
    .fill("05:00");
  await editor
    .getByLabel("Конец интервала спроса", { exact: true })
    .fill("05:15");
  await editor
    .getByLabel("Входящих за интервал, чел.", { exact: true })
    .fill("150");
  await editor
    .getByRole("button", { name: "Задать вход за интервал", exact: true })
    .click();
  await expect(editor).toContainText("Шаг появления: 60 с");
  const graph = page.getByRole("region", {
    name: "График за день",
    exact: true,
  });
  await simulationTab.click();
  await graph.getByLabel("Станция на графике").selectOption("A");
  await expect(graph.getByTestId("day-readout")).toContainText("150 чел.");
  await constructorTab.click();
  await editor.getByLabel("Станция для спроса").selectOption("B");
  await editor
    .getByLabel("Входящих за интервал, чел.", { exact: true })
    .fill("100");
  await editor
    .getByRole("button", { name: "Задать вход за интервал", exact: true })
    .click();
  await editor.screenshot({ path: testInfo.outputPath("demand-editor.png") });
  await simulationTab.click();
  await graph.getByLabel("Станция на графике").selectOption("");
  await expect(graph.getByTestId("day-readout")).toContainText("250 чел.");
  await constructorTab.click();
  await editor
    .getByLabel("Конец интервала спроса", { exact: true })
    .fill("04:00");
  await editor
    .getByRole("button", { name: "Задать вход за интервал", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("конец позже начала");
  await editor
    .getByLabel("Конец интервала спроса", { exact: true })
    .fill("05:15");

  const responseEvent = page.waitForResponse(
    (r) => r.url().endsWith("/api/simulate") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  const result = await (await responseEvent).json();
  expect(result.metrics.appeared).toBeCloseTo(250, 8);
  await page.getByLabel("Пауза", { exact: true }).click();
  const paths = await graph
    .locator(".day-line")
    .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")));
  for (const t of ["18000", "18900", "21000", "18000"]) {
    await graph.getByLabel("Время на графике", { exact: true }).fill(t);
    await expect(
      page.getByLabel("Время симуляции", { exact: true }),
    ).toHaveValue(t);
    expect(
      await graph
        .locator(".day-line")
        .evaluateAll((paths) => paths.map((p) => p.getAttribute("d"))),
    ).toEqual(paths);
  }
  await graph.screenshot({ path: testInfo.outputPath("daily-timeline.png") });
  const queuePlot = graph.getByRole("img", {
    name: "Ожидают на станциях",
    exact: true,
  });
  const plotBox = (await queuePlot.boundingBox())!;
  await queuePlot.click({
    position: { x: plotBox.width * 0.52, y: plotBox.height * 0.5 },
  });
  expect(
    Number(
      await page.getByLabel("Время симуляции", { exact: true }).inputValue(),
    ),
  ).toBeGreaterThan(19000);
  expect(
    await graph
      .locator(".day-line")
      .evaluateAll((paths) => paths.map((p) => p.getAttribute("d"))),
  ).toEqual(paths);
  await graph.getByLabel("Время на графике", { exact: true }).fill("18000");
  await constructorTab.click();
  await editor.getByLabel("Станция для спроса").selectOption("A");
  await editor
    .getByRole("button", { name: "Изменить интервал 05:00", exact: true })
    .click();
  await expect(
    editor.getByLabel("Входящих за интервал, чел.", { exact: true }),
  ).toHaveValue("150");
  await editor
    .getByLabel("Входящих за интервал, чел.", { exact: true })
    .fill("200");
  await editor
    .getByRole("button", { name: "Сохранить интервал", exact: true })
    .click();
  await simulationTab.click();
  await expect(graph).toContainText("После запуска симуляции");
  await graph.getByLabel("Станция на графике").selectOption("A");
  await expect(graph.getByTestId("day-readout")).toContainText("200 чел.");
  await constructorTab.click();
  await editor
    .getByRole("button", { name: "Удалить интервал 05:00", exact: true })
    .click();
  await expect(editor).toContainText("Интервалы не заданы");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
