import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Un solo fichero para Node 24 con todo dentro, que es lo que empaqueta Nix (#36).
  build: {
    ssr: "src/principal.ts",
    outDir: "dist",
    target: "node24",
    rolldownOptions: { output: { entryFileNames: "nocturna.js" } },
  },
  ssr: { noExternal: true },
  test: {
    environment: "node",
    sequence: { shuffle: true },
    // Las noches con copias y las que esperan a la publicación leen y escriben en disco de
    // verdad: con la máquina cargada pasan de los 5 s por defecto.
    testTimeout: 30_000,
  },
});
