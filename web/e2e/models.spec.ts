import { expect, test } from "@playwright/test";

test("math models render and navigation preserves the experiment", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  let simulations = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/api/simulate")) simulations++;
  });
  await page.goto("/");
  const interval = page.getByLabel("Интервал Линия 1 период 1", {
    exact: true,
  });
  await interval.fill("195");
  await page.getByRole("button", { name: "▶ Запустить симуляцию" }).click();
  await expect(page.getByLabel("Пауза", { exact: true })).toBeVisible();
  await page.getByLabel("Время симуляции", { exact: true }).fill("30600");
  await page.getByRole("button", { name: "Матмодели", exact: true }).click();
  const models = page.getByRole("main", { name: "Математические модели" });
  await expect(models).toBeVisible();
  await expect(models.getByRole("article")).toHaveCount(22);
  expect(await models.locator(".math-formulas math").count()).toBeGreaterThan(
    35,
  );
  await expect(models.locator(".katex-error")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Симуляция", exact: true }),
  ).not.toBeVisible();
  await expect(
    models.getByRole("heading", { name: /Гравитационная модель назначений/ }),
  ).toBeVisible();
  await expect(models.locator("#math-gravity")).toContainText(
    "Влияние удалённости назначения β",
  );
  const time = await page
    .getByLabel("Время симуляции", { exact: true })
    .inputValue();
  const metrics = await page.locator(".metric b").allTextContents();

  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath("math-models-desktop.png"),
  });
  await models
    .getByRole("link", { name: /Независимые потоки случайности/ })
    .click();
  await expect(page).toHaveURL(/#math-random-streams$/);
  await page.getByRole("button", { name: "Симуляция", exact: true }).click();
  await expect(interval).toHaveValue("195");
  await expect(page.getByLabel("Время симуляции", { exact: true })).toHaveValue(
    time,
  );
  await expect(page.getByLabel("Продолжить", { exact: true })).toBeVisible();
  expect(await page.locator(".metric b").allTextContents()).toEqual(metrics);
  expect(simulations).toBe(1);

  await page.getByRole("button", { name: "Конструктор", exact: true }).click();
  await page
    .getByLabel("Название сети", { exact: true })
    .fill("Сеть для защиты");
  await page.getByRole("button", { name: "Матмодели", exact: true }).click();
  await expect(models).toBeVisible();
  await page.getByRole("button", { name: "Конструктор", exact: true }).click();
  await expect(page.getByLabel("Название сети", { exact: true })).toHaveValue(
    "Сеть для защиты",
  );
  expect(errors).toEqual([]);
});

test("math models fit a mobile screen and every model has variables and usage", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Матмодели", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Матмодели", exact: true }).click();
  const models = page.getByRole("main", { name: "Математические модели" });
  await expect(models.getByRole("article")).toHaveCount(22);
  for (const card of await models.getByRole("article").all()) {
    expect(await card.locator(".math-formulas math").count()).toBeGreaterThan(
      0,
    );
    expect(await card.locator(".math-variables dd").count()).toBeGreaterThan(0);
    await expect(card.locator(".math-usage")).toContainText("Использование");
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("math-models-mobile.png"),
  });
  await expect(models.locator(".katex-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});
