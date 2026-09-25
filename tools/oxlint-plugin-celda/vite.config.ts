import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    sequence: { shuffle: true },
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
