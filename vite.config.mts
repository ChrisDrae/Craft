import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  server: {
    watch: {
      // Native file events get dropped on Windows when files change in quick succession
      usePolling: true,
      interval: 100,
      ignored: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
    },
  },
  build: { target: "es2022" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
