import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: { DATABASE_URL: "file:./test.db" },
    fileParallelism: false, // integration tests share one sqlite file
  },
});
