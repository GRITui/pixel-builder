import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    // agent worktrees hold full repo copies; never collect their tests
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"],
  },
});
