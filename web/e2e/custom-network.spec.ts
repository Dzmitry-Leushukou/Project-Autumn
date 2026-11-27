import { expect, test } from "@playwright/test";

for (const initialMode of ["Симуляция", "Конструктор"]) {
  test(`own network opens a usable constructor from ${initialMode}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const catalogueRequests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (/\/api\/networks\/?$/.test(new URL(r.url()).pathname))
        catalogueRequests.push(r.url());
    });
    await page.goto("/");
    await expect(page.getByLabel("Демо-сеть")).toHaveValue("b_transfer");
    if (initialMode === "Конструктор")
      await page
        .getByRole("button", { name: initialMode, exact: true })
        .click();
    const before = catalogueRequests.length;
    await page.getByLabel("Демо-сеть").selectOption("");
    await expect(
      page.getByRole("heading", { name: "Конструктор", exact: true }),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".scenario-name")).toContainText("Моя сеть");
    await expect(page.locator(".scenario-size")).toContainText("0 станций");
    await expect(
      page.getByRole("button", { name: "Станции", exact: true }),
    ).toHaveClass("selected");
    await expect(
      page.getByRole("button", { name: "▶ Запустить симуляцию" }),
    ).toBeDisabled();
    expect(catalogueRequests.length).toBe(before);

    const canvas = page.getByLabel("Карта сети метро");
    const box = (await canvas.boundingBox())!;
    const scale = Math.min((box.width - 120) / 1000, (box.height - 100) / 1000);
    const positions = [300, 700].map((x) => ({
      x: (box.width - 1000 * scale) / 2 + x * scale,
      y: box.height / 2,
    }));
    for (const position of positions) await canvas.click({ position });
    await page.getByRole("button", { name: "Ветка", exact: true }).click();
    for (const position of positions) await canvas.click({ position });
    const run = page.getByRole("button", { name: "▶ Запустить симуляцию" });
    await expect(run).toBeEnabled();
    await run.click();
    await expect(page.locator("div[role=status]")).toContainText(
      "Прогон готов",
    );

    await page.getByLabel("Демо-сеть").selectOption("b_transfer");
    await expect(page.locator(".scenario-name")).toContainText("Две линии");
    await page.getByLabel("Демо-сеть").selectOption("");
    await expect(page.locator(".scenario-size")).toContainText("0 станций");
    await expect(
      page.getByRole("button", { name: "Станции", exact: true }),
    ).toHaveClass("selected");
    expect(catalogueRequests.length).toBe(before);
    expect(errors).toEqual([]);
  });
}
