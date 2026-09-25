import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    // Solo `test/`: los `*.spec.ts` de Confect son la especificación de la API, no pruebas.
    include: ["test/**/*.test.ts"],
    sequence: { shuffle: true },
    server: { deps: { inline: ["convex-test"] } },
  },
});
