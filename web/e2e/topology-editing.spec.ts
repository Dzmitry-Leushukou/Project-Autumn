import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import type { Network } from "../src/model";
import { removeConnection, removeStation } from "../src/topologyEditing";

const fixture = (): Network => ({
  meta: {
    name: "Редактор схемы",
    synthetic: true,
    format_version: "1.0",
    description: "",
  },
  stations: [100, 350, 650, 900].map((x, i) => ({
    id: "ABCD"[i],
    name: "ABCD"[i],
    x,
    y: 500,
  })),
  lines: [
    {
      id: "L1",
      name: "Линия",
      color: "#397DAD",
      stations: ["A", "B", "C", "D"],
    },
  ],
  segments: ["AB", "BC", "CD"].map(([from, to]) => ({
    from,
    to,
    run_time_s: 60,
  })),
  transfers: [
    { from: "A", to: "D", walk_time_s: 120 },
    { from: "B", to: "D", walk_time_s: 120 },
  ],
  train: { capacity: 100 },
  fleet: 8,
  fleet_assignment: { L1: 8 },
  demand: [
    { station: "A", start_min: 300, len_min: 15, entries: 100 },
    { station: "B", start_min: 300, len_min: 15, entries: 50 },
  ],
  schedule: { period_len_min: 60, headways: { L1: [180] } },
  settings: {
    day_start_s: 18000,
    day_end_s: 21600,
    demand_noise: false,
    group_step_s: 60,
  },
});

test("station removal cleans references and never bridges its neighbours", () => {
  const network = fixture();
  network.lines[0].depot_station = "B";
  network.od_matrix = [
    { origin: "A", destination: "B", start_min: 300, len_min: 15, trips: 10 },
    { origin: "B", destination: "D", start_min: 300, len_min: 15, trips: 20 },
    { origin: "A", destination: "D", start_min: 300, len_min: 15, trips: 30 },
  ];
  removeStation(network, "B");
  expect(network.stations.map((s) => s.id)).toEqual(["A", "C", "D"]);
  expect(network.segments.map((s) => [s.from, s.to])).toEqual([["C", "D"]]);
  expect(network.lines[0].stations).toEqual(["C", "D"]);
  expect(network.lines[0].depot_station).toBeUndefined();
  expect(network.transfers.map((s) => [s.from, s.to])).toEqual([["A", "D"]]);
  expect(network.demand.map((r) => r.station)).toEqual(["A"]);
  expect(network.od_matrix.map((r) => [r.origin, r.destination])).toEqual([
    ["A", "D"],
  ]);
  expect(network.fleet_assignment).toBeUndefined();
});

test("a shared segment cut splits routes with unique ids and preserves schedules", () => {
  const network = fixture();
  network.lines.push({
    ...network.lines[0],
    id: "L1_2",
    name: "Общая",
    stations: ["D", "C", "B", "A"],
  });
  network.schedule!.headways.L1_2 = [240];
  removeConnection(network, "segment", 1);
  expect(network.lines.map((l) => l.stations)).toEqual([
    ["A", "B"],
    ["C", "D"],
    ["D", "C"],
    ["B", "A"],
  ]);
  expect(new Set(network.lines.map((l) => l.id)).size).toBe(4);
  for (const line of network.lines)
    expect(network.schedule!.headways[line.id]).toEqual(
      line.name.startsWith("Общая") ? [240] : [180],
    );
});

test("a cut opens a ring at that edge, including the closing edge", () => {
  for (const index of [1, 3]) {
    const network = fixture();
    network.lines[0].is_loop = true;
    network.segments.push({ from: "D", to: "A", run_time_s: 60 });
    removeConnection(network, "segment", index);
    expect(network.lines).toHaveLength(1);
    expect(network.lines[0].is_loop).toBe(false);
    expect(network.lines[0].stations).toEqual(
      index === 1 ? ["C", "D", "A", "B"] : ["A", "B", "C", "D"],
    );
  }
});

test("removing a station from a triangular ring retains the remaining edge", () => {
  const network = fixture();
  network.lines[0].stations = ["A", "B", "C"];
  network.lines[0].is_loop = true;
  network.segments.push({ from: "C", to: "A", run_time_s: 60 });
  removeStation(network, "B");
  expect(network.lines[0].is_loop).toBe(false);
  expect([...network.lines[0].stations].sort()).toEqual(["A", "C"]);
});

async function savedNetwork(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ Сохранить", exact: true }).click();
  return JSON.parse(
    await fs.readFile((await (await download).path())!, "utf8"),
  );
}

test("map and property deletion, undo, JSON save/reload and simulation work together", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/networks/b_transfer", (r) =>
    r.fulfill({ json: fixture() }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Конструктор", exact: true }).click();
  const undo = page.getByRole("button", {
    name: "Отменить последнее изменение",
    exact: true,
  });
  await expect(undo).toBeDisabled();
  const original = await savedNetwork(page);
  const canvas = page.getByLabel("Карта сети метро");
  const box = (await canvas.boundingBox())!;
  const scale = Math.min((box.width - 120) / 1000, (box.height - 100) / 1000);
  const at = (x: number) => ({
    x: (box.width - 1000 * scale) / 2 + x * scale,
    y: box.height / 2,
  });
  await canvas.click({ position: at(350) });
  await page
    .getByRole("button", { name: "Удалить станцию", exact: true })
    .click();
  expect((await savedNetwork(page)).stations.map((s: any) => s.id)).toEqual([
    "A",
    "C",
    "D",
  ]);
  await page.keyboard.press("Control+KeyZ");
  expect(await savedNetwork(page)).toEqual(original);
  await expect(undo).toBeDisabled();

  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await canvas.click({ position: at(500) });
  const cut = await savedNetwork(page);
  expect(cut.segments.map((s: any) => [s.from, s.to])).toEqual([
    ["A", "B"],
    ["C", "D"],
  ]);
  expect(cut.lines.map((l: any) => l.stations)).toEqual([
    ["A", "B"],
    ["C", "D"],
  ]);
  await page.getByLabel("Название сети", { exact: true }).focus();
  await page.keyboard.press("Control+KeyZ");
  expect(await savedNetwork(page)).toEqual(cut);
  await undo.click();
  expect(await savedNetwork(page)).toEqual(original);

  await canvas.click({ position: at(350) });
  expect((await savedNetwork(page)).stations).toHaveLength(3);
  await undo.click();
  expect(await savedNetwork(page)).toEqual(original);
  await page.getByText("Перегоны и переходы", { exact: true }).click();
  await page
    .getByRole("button", { name: "Удалить переход B — D", exact: true })
    .click();
  expect((await savedNetwork(page)).transfers).toHaveLength(1);
  await page.keyboard.press("Control+KeyZ");
  expect(await savedNetwork(page)).toEqual(original);
  await page
    .getByRole("button", { name: "Удалить перегон B — C", exact: true })
    .click();
  expect(await savedNetwork(page)).toEqual(cut);
  await page.screenshot({ path: testInfo.outputPath("delete-and-undo.png") });
  await page.getByLabel("Файл сети").setInputFiles({
    name: "edited.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(cut)),
  });
  await expect(undo).toBeDisabled();
  expect(await savedNetwork(page)).toEqual(cut);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/simulate") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "▶ Запустить симуляцию", exact: true })
    .click();
  const result = await response;
  expect(result.ok()).toBeTruthy();
  expect((await result.json()).metrics.appeared).toBeCloseTo(150, 8);
  await expect(page.getByLabel("Пауза", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("adding a station or a line connection can be undone as one action", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Демо-сеть").selectOption("");
  const undo = page.getByRole("button", {
    name: "Отменить последнее изменение",
    exact: true,
  });
  const canvas = page.getByLabel("Карта сети метро");
  const box = (await canvas.boundingBox())!;
  const left = { x: box.width * 0.35, y: box.height * 0.5 };
  const right = { x: box.width * 0.65, y: box.height * 0.5 };
  const empty = await savedNetwork(page);
  await canvas.click({ position: left });
  await page.keyboard.press("Control+KeyZ");
  expect(await savedNetwork(page)).toEqual(empty);
  await canvas.click({ position: left });
  await canvas.click({ position: right });
  await page.getByRole("button", { name: "Ветка", exact: true }).click();
  await canvas.click({ position: left });
  const first = await savedNetwork(page);
  await canvas.click({ position: right });
  expect((await savedNetwork(page)).segments).toHaveLength(1);
  await undo.click();
  expect(await savedNetwork(page)).toEqual(first);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("Delete removes only the selected object and respects text fields and view modes", async ({
  page,
}) => {
  const network = fixture();
  network.stations[3].y = 250;
  await page.route("**/api/networks/b_transfer", (r) =>
    r.fulfill({ json: network }),
  );
  await page.goto("/");
  const constructorTab = page.getByRole("button", {
    name: "Конструктор",
    exact: true,
  });
  await constructorTab.click();
  const canvas = page.getByLabel("Карта сети метро");
  const box = (await canvas.boundingBox())!;
  const scale = Math.min((box.width - 120) / 1000, (box.height - 100) / 1000);
  const at = (x: number, y = 500) => ({
    x: (box.width - 1000 * scale) / 2 + x * scale,
    y: (box.height - 1000 * scale) / 2 + y * scale,
  });
  await expect(
    page.getByRole("button", { name: "Выбрать", exact: true }),
  ).toHaveClass("selected");
  await canvas.click({ position: at(350) });
  await expect(page.locator(".map-note")).toContainText("Станция B");
  await page.keyboard.press("Delete");
  expect((await savedNetwork(page)).stations.map((s: any) => s.id)).toEqual([
    "A",
    "C",
    "D",
  ]);
  await page.keyboard.press("Control+KeyZ");
  expect(await savedNetwork(page)).toEqual(network);
  // Undo restores the selected station, so another Delete acts on the same object.
  await page.keyboard.press("Delete");
  expect((await savedNetwork(page)).stations).toHaveLength(3);
  await page.keyboard.press("Control+KeyZ");
  await canvas.click({ position: at(500) });
  await expect(page.locator(".map-note")).toContainText("Перегон B — C");
  expect(await savedNetwork(page)).toEqual(network);
  await page.keyboard.press("Delete");
  const cut = await savedNetwork(page);
  expect(cut.segments.map((s: any) => [s.from, s.to])).toEqual([
    ["A", "B"],
    ["C", "D"],
  ]);
  expect(cut.stations).toEqual(network.stations);
  await page.keyboard.press("Control+KeyZ");
  await expect(page.locator(".map-note")).toContainText("Перегон B — C");
  expect(await savedNetwork(page)).toEqual(network);
  await canvas.click({ position: at(500, 375) });
  await expect(page.locator(".map-note")).toContainText("Переход A — D");
  await page.keyboard.press("Delete");
  expect(
    (await savedNetwork(page)).transfers.map((t: any) => [t.from, t.to]),
  ).toEqual([["B", "D"]]);
  await page.keyboard.press("Control+KeyZ");
  expect(await savedNetwork(page)).toEqual(network);
  await canvas.click({ position: at(500, 750) });
  await page.keyboard.press("Delete");
  expect(await savedNetwork(page)).toEqual(network);
  await canvas.click({ position: at(350) });
  const nameInput = page.getByLabel("Название станции", { exact: true });
  await nameInput.focus();
  await nameInput.press("Home");
  await nameInput.press("Delete");
  await expect(nameInput).toHaveValue("");
  expect((await savedNetwork(page)).stations).toHaveLength(4);
  await nameInput.fill("B");
  await page.getByRole("button", { name: "Симуляция", exact: true }).click();
  await page.keyboard.press("Delete");
  expect(await savedNetwork(page)).toEqual(network);
  await page.getByRole("button", { name: "Матмодели", exact: true }).click();
  await page.keyboard.press("Delete");
  await constructorTab.click();
  expect(await savedNetwork(page)).toEqual(network);
  await canvas.click({ position: at(500, 750) });
  await page.keyboard.press("Delete");
  expect(await savedNetwork(page)).toEqual(network);
});
