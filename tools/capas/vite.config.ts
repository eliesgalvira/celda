import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Un solo fichero para Node con todo dentro: los paquetes del monorepo se exportan como
  // TypeScript sin compilar.
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
    // `limitesReal.test.ts` lee los límites de municipios de toda España y recorre cada vértice
    // de la frontera: con la máquina cargada pasa de los 5 s por defecto (7,4 s en la CI).
    testTimeout: 30_000,
  },
});
