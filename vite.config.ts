import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
  // agent worktrees hold full repo copies; never collect their tests
  test: { environment: "node", exclude: ["**/node_modules/**", "e2e/**", "**/dist/**", ".claude/**"] },
} as any);
