import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Dedicated ports + a throwaway data dir so the smoke test never touches a dev session.
const WEB = 5183, API = 8797;
const data = mkdtempSync(join(tmpdir(), "pixel-builder-e2e-"));

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${WEB}`, viewport: { width: 1280, height: 800 }, acceptDownloads: true },
  webServer: [
    {
      command: "npx tsx server/index.ts",
      url: `http://localhost:${API}/api/health`,
      env: { PORT: String(API), PIXEL_BUILDER_DATA: data, ANTHROPIC_API_KEY: "" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB} --strictPort`,
      url: `http://localhost:${WEB}`,
      env: { API_PORT: String(API) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
