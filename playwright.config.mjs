import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const localBrave = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(localBrave) ? localBrave : undefined);
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18763",
    headless: true,
    launchOptions: { executablePath, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev", url: "http://127.0.0.1:18763", reuseExistingServer: false,
    env: { PORT: "18763" },
  },
});
