import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
  test: {
    environment: "node",
    // Full-map renders (HD biomes, animated villages) take 2-5s each and cross
    // vitest's 5s default when the suite runs in parallel on a small machine.
    testTimeout: 30000,
    // agent worktrees hold full repo copies; never collect their tests
    exclude: ["**/node_modules/**", "e2e/**", "**/dist/**", ".claude/**"] },
} as any);
