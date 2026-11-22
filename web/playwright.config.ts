import { defineConfig } from "@playwright/test";
import path from "node:path";
const webPort = process.env.METRO_WEB_PORT ?? "5173";
const apiPort = process.env.METRO_API_PORT ?? "8000";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const reuse = process.env.METRO_E2E_FRESH !== "1";
const python = path.resolve(
  "..",
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
export default defineConfig({
  testDir: "e2e",
  timeout: 180000,
  expect: { timeout: 90000 },
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    viewport: { width: 1440, height: 1100 },
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `npm run dev -- --strictPort --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      env: { METRO_API_URL: apiUrl },
      reuseExistingServer: reuse,
    },
    {
      command: `"${python}" -m uvicorn api.main:app --app-dir .. --host 127.0.0.1 --port ${apiPort}`,
      url: `${apiUrl}/health`,
      reuseExistingServer: reuse,
    },
  ],
});
