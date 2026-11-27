import { expect, test } from "@playwright/test";
import {
  bernoulliMass,
  gravityShares,
  logitShares,
  lognormalCurve,
  lognormalDensity,
  lognormalParameters,
  mutationMass,
  normalDensity,
  poissonMass,
} from "../src/distributionMath";

test("Poisson probabilities preserve mass, mean and variance", () => {
  expect(poissonMass(0)).toEqual([{ x: 0, y: 1 }]);
  for (const mean of [0.2, 20, 200]) {
    const points = poissonMass(mean);
    expect(points.reduce((sum, p) => sum + p.y, 0)).toBeCloseTo(1, 6);
    expect(points.reduce((sum, p) => sum + p.x * p.y, 0)).toBeCloseTo(mean, 4);
    expect(
      points.reduce((sum, p) => sum + (p.x - mean) ** 2 * p.y, 0),
    ).toBeCloseTo(mean, 3);
  }
});

test("continuous densities have the documented normalization and moments", () => {
  expect(normalDensity(0)).toBeCloseTo(0.3989422804, 9);
  const step = 0.002;
  let mass = 0;
  for (let z = -8; z < 8; z += step) mass += normalDensity(z + step / 2) * step;
  expect(mass).toBeCloseTo(1, 8);

  const { mu, sigma } = lognormalParameters(5, 3);
  const logStep = (16 * sigma) / 8000;
  let total = 0,
    first = 0,
    second = 0;
  for (let i = 0; i < 8000; i++) {
    const x = Math.exp(mu - 8 * sigma + (i + 0.5) * logStep);
    const dm = lognormalDensity(x, 5, 3) * x * logStep;
    total += dm;
    first += dm * x;
    second += dm * x * x;
  }
  expect(total).toBeCloseTo(1, 7);
  expect(first).toBeCloseTo(5, 6);
  expect(second - first * first).toBeCloseTo(9, 5);
  expect(lognormalDensity(0, 5, 3)).toBe(0);
  expect(lognormalCurve(5, 0, 10)).toEqual([{ x: 5, y: 1 }]);
  for (const [mean, std] of [
    [5, 3],
    [0.1, 100],
  ]) {
    const parameters = lognormalParameters(mean, std);
    const mode = Math.exp(parameters.mu - parameters.sigma ** 2);
    const max = Math.max(
      mean + 4 * std,
      Math.exp(parameters.mu + 3.5 * parameters.sigma),
    );
    const points = lognormalCurve(mean, std, max);
    expect(
      points.every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y >= 0,
      ),
    ).toBe(true);
    expect(Math.max(...points.map((p) => p.y))).toBeGreaterThan(
      0.999 * lognormalDensity(mode, mean, std),
    );
  }
});

test("discrete laws and deterministic shares match independent reference cases", () => {
  expect(bernoulliMass(0).map((p) => p.y)).toEqual([1, 0]);
  expect(bernoulliMass(1).map((p) => p.y)).toEqual([0, 1]);
  expect(mutationMass().map((p) => p.x)).toEqual([-4, -3, -2, -1, 1, 2, 3, 4]);
  expect(mutationMass().reduce((s, p) => s + p.y, 0)).toBe(1);
  expect(gravityShares(0).map((p) => p.y)).toEqual([0.75, 0.25]);
  expect(gravityShares(1).map((p) => p.y)).toEqual([0.5, 0.5]);
  expect(logitShares(0).map((p) => p.y)).toEqual([0.5, 0.5]);
  expect(logitShares(0.02)[0].y).toBeCloseTo(0.7685247835, 9);
});

test("distribution graphs respond to example parameters without editing the network", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Конструктор", exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: "Случайные задержки" })
    .click();
  const realProbability = page.getByLabel("Вероятность задержки, %", {
    exact: true,
  });
  await realProbability.fill("8");
  await page.getByRole("button", { name: "Матмодели", exact: true }).click();
  const models = page.getByRole("main", { name: "Математические модели" });
  await expect(
    models.getByRole("heading", { name: "1. Кинематика поезда", exact: true }),
  ).toBeVisible();
  await expect(
    models.getByRole("heading", {
      name: "22. Независимые потоки случайности",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    models.getByRole("link", { name: "1. Кинематика поезда", exact: true }),
  ).toBeVisible();
  await expect(models.locator(".distribution-graph")).toHaveCount(10);

  const poisson = models.getByRole("region", {
    name: "Пуассон — число входящих за шаг",
    exact: true,
  });
  await poisson.getByLabel("λ — пассажиров за шаг").fill("0");
  await expect(poisson.locator(".graph-bar")).toHaveCount(1);
  await expect(poisson.locator(".graph-bar title")).toHaveText("0: 1");
  await poisson.getByLabel("λ — пассажиров за шаг").fill("20");
  expect(await poisson.locator(".graph-bar").count()).toBeGreaterThan(20);

  const bernoulli = models.getByRole("region", {
    name: "Бернулли — возникновение задержки",
    exact: true,
  });
  await expect(bernoulli.getByLabel("p₀, %")).toHaveValue("8");
  await bernoulli.getByLabel("p₀, %").fill("20");
  await bernoulli.getByLabel("x / C — обмен / вместимость").fill("2");
  await expect(bernoulli.locator("output")).toHaveText("p = 40%");
  await expect(bernoulli.locator(".graph-bar title")).toHaveText([
    "Нет: 0,6",
    "Да: 0,4",
  ]);

  const duration = models.getByRole("region", {
    name: "Логнормальное — длительность возникшей задержки",
    exact: true,
  });
  await duration.getByLabel("s, с", { exact: true }).fill("0");
  await expect(duration).toContainText(
    "Постоянное значение: 5 с. Вероятность 1.",
  );
  await expect(duration.locator(".graph-bar")).toHaveCount(1);
  await duration.getByLabel("s, с", { exact: true }).fill("3");
  await expect(duration.locator(".graph-curve")).toHaveCount(1);
  await duration.screenshot({ path: testInfo.outputPath("lognormal.png") });

  const classes = models.getByRole("region", {
    name: "Логнормальное — множители предпочтений",
    exact: true,
  });
  await classes.getByLabel("c — разнообразие").fill("0");
  await expect(classes).toContainText("Постоянное значение: 1. Вероятность 1.");
  await classes.getByLabel("c — разнообразие").fill("0.2");
  await classes.screenshot({
    path: testInfo.outputPath("class-multiplier.png"),
  });

  const profile = models.getByRole("region", {
    name: "Заданный профиль спроса",
    exact: true,
  });
  await expect(profile).toContainText("не плотность вероятности");
  await profile.getByLabel("Профиль", { exact: true }).selectOption("flat");
  expect(await profile.locator(".graph-curve").getAttribute("d")).not.toMatch(
    /NaN|Infinity/,
  );

  const logit = models.getByRole("region", {
    name: "Доли маршрутов по логиту",
    exact: true,
  });
  await logit.getByLabel("θ — чувствительность, 1/с").fill("0");
  await expect(logit.locator(".graph-bar title")).toHaveText([
    "Маршрут 1: 0,5",
    "Маршрут 2: 0,5",
  ]);
  await poisson.screenshot({ path: testInfo.outputPath("poisson.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await poisson.screenshot({ path: testInfo.outputPath("poisson-mobile.png") });
  await duration.screenshot({
    path: testInfo.outputPath("lognormal-mobile.png"),
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  for (const path of await models.locator(".graph-curve").all())
    expect(await path.getAttribute("d")).not.toMatch(/NaN|Infinity/);
  await page.getByRole("button", { name: "Конструктор", exact: true }).click();
  await expect(realProbability).toHaveValue("8");
  const realMean = page.getByLabel("Средняя задержка, с", { exact: true });
  await realMean.fill("0");
  await page.getByRole("button", { name: "Матмодели", exact: true }).click();
  await expect(duration.getByLabel("m, с", { exact: true })).toHaveValue("0.1");
  expect(await duration.locator(".graph-curve").getAttribute("d")).not.toMatch(
    /NaN|Infinity/,
  );
  await page.getByRole("button", { name: "Конструктор", exact: true }).click();
  await expect(realMean).toHaveValue("0");
  expect(errors).toEqual([]);
});
