import { defineConfig } from "@playwright/test";
const python =
  process.platform === "win32"
    ? "../.venv/Scripts/python"
    : "../.venv/bin/python";
export default defineConfig({
  testDir: "e2e",
  timeout: 180000,
  expect: { timeout: 90000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1100 },
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run dev -- --strictPort",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
    },
    {
      command: `${python} -m uvicorn api.main:app --app-dir .. --host 127.0.0.1 --port 8000`,
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
    },
  ],
});
