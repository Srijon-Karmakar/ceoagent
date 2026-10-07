import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Modules read env (data dir, limits) at import time — isolate each file.
    isolate: true,
    pool: "forks",
  },
});
