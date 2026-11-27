import { test, expect } from "@playwright/test";

test("schedule, settings and train calculation explain units and preserve values", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("summary").filter({ hasText: "Проверка сети" }).click();
  const validation = page.locator(".validation");
  await expect(validation).toContainText("Вес использования парка");
  await expect(validation).toContainText("Случайный вход пассажиров");
  await expect(validation).toContainText("6 чел./с");
  await expect(validation).toContainText("Каждый период: 3 мин");
  await expect(validation).not.toContainText("false");
  await expect(validation).not.toContainText("true");
  const schedule = page.getByRole("table", {
    name: "Интервалы и парк по веткам",
  });
  await expect(schedule.getByText("Интервал, секунд").first()).toBeVisible();
  await expect(schedule.getByText("3 мин").first()).toBeVisible();
  await expect(schedule.getByText("по умолчанию").first()).toBeVisible();
  await page.getByRole("button", { name: "Конструктор", exact: true }).click();
  await page.getByText("Случайные задержки", { exact: true }).click();
  const probability = page.getByLabel("Вероятность задержки, %", {
    exact: true,
  });
  await expect(probability).toHaveValue("5");
  await probability.fill("8");
  await page.getByText("Время и спрос", { exact: true }).click();
  await expect(page.getByLabel("Начало работы", { exact: true })).toHaveValue(
    "05:00",
  );
  await expect(page.getByLabel("Конец работы", { exact: true })).toHaveValue(
    "01:00",
  );
  await expect(
    page.getByLabel("День окончания работы", { exact: true }),
  ).toHaveValue("1");
  await page.getByLabel("Конец работы", { exact: true }).fill("02:30");
  await page.getByLabel("Начало работы", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ Сохранить", exact: true }).click();
  const saved = await download;
  const fs = await import("node:fs/promises");
  const doc = JSON.parse(await fs.readFile((await saved.path())!, "utf8"));
  expect(doc.settings.delays.p0.value).toBe(0.08);
  expect(doc.settings.day_end_s.value).toBe(95400);
  // Restore the original day and ensure percent-based service targets retain model units.
  await page.getByLabel("Конец работы", { exact: true }).fill("01:00");
  await page.getByLabel("Начало работы", { exact: true }).click();
  await page.getByRole("button", { name: "Симуляция", exact: true }).click();
  await page.getByText("Параметры поиска", { exact: true }).click();
  await expect(
    page.getByLabel("Отказов на 100 посадок, максимум", { exact: true }),
  ).toHaveValue("2");
  await page
    .getByLabel("Прогонов для итоговой оценки", { exact: true })
    .fill("1");
  const fixture = {
    line_id: "L1",
    period_index: 0,
    formula_trains: 5,
    mode: "by_headway",
    status: "found",
    simulation: { trains: 4, headway_s: 180 },
    available_fleet: 11,
    seeds: [42],
    checked: [{}, {}],
    explanation: "Technical text must not be the primary UI",
    diagnostics: {
      trains: 4,
      headway_s: 180,
      deadlock: false,
      releases: 20,
      release_delay_s: 11.9,
      denied_share: 0,
      boarding_s: 164.8,
      random_delay_s: 2.9,
      blocking_s: 0,
      shared_blocking_s: 0,
      passenger_exchange: 989,
    },
  };
  await page.route("**/api/train-count", (r) => r.fulfill({ json: fixture }));
  await page
    .getByRole("button", { name: "Рассчитать количество поездов", exact: true })
    .click();
  const result = page.getByRole("region", {
    name: "Результат подбора поездов",
  });
  await expect(
    result.getByRole("heading", {
      name: "Подходящий вариант найден",
      exact: true,
    }),
  ).toBeVisible();
  await expect(result).toContainText("3 мин");
  await expect(result).toContainText("11,9 с");
  await expect(result).toContainText("18 с");
  await expect(result).toContainText("Результат не применён");
  await expect(result).not.toContainText("поезд-с");
  await result
    .getByText("Что влияло на работу поездов", { exact: true })
    .click();
  await expect(result).toContainText("164,8 с");
  await expect(result).toContainText("два поезда ждали по 10 секунд");
  await result.screenshot({ path: testInfo.outputPath("count-result.png") });
  await page.getByLabel("Режим расчёта поездов").selectOption("by_fleet");
  await expect(result).toHaveCount(0);
  await page.unroute("**/api/train-count");
  await page.route("**/api/train-count", (r) =>
    r.fulfill({
      json: {
        ...fixture,
        simulation: null,
        status: "not_found_in_range",
        diagnostics: null,
        checked: [],
        available_fleet: 1,
      },
    }),
  );
  await page
    .getByRole("button", { name: "Рассчитать количество поездов", exact: true })
    .click();
  await expect(result).toContainText(
    "Доступное число поездов для этой ветки: 1",
  );
  await expect(result).not.toContainText("Выполнено");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
