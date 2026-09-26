import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Un solo fichero para Node con todo dentro: el código que genera Confect importa sin
  // extensiones y Node no lo resolvería.
  build: {
    ssr: "src/principal.ts",
    outDir: "dist",
    target: "node24",
    rolldownOptions: { output: { entryFileNames: "capas.js" } },
  },
  ssr: { noExternal: true },
  test: {
    environment: "node",
    sequence: { shuffle: true },
  },
});
