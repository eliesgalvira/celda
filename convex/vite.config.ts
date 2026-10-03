import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    // Solo `test/`: los `*.spec.ts` de Confect son la especificación de la API, no pruebas.
    include: ["test/**/*.test.ts"],
    sequence: { shuffle: true },
    // convex-test y el componente de límites usan `import.meta.glob`, que solo resuelve Vite.
    server: { deps: { inline: ["convex-test", /@convex-dev\//] } },
  },
});
