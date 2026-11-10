import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/ruang-simpan-quota.vitest.ts", "tests/object-storage-cleanup.vitest.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
