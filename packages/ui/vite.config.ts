import "vite-plus/test/config";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "happy-dom",
    sequence: { shuffle: true },
    // Una prueba falla si algún recurso se abre en bucle (ver `src/recurso.ts`).
    setupFiles: ["./src/pruebas/vigilante.ts"],
    // Sin esto Vitest entrega vacío `tema.css?raw`, que las pruebas leen.
    css: { include: [/tema\.css/u] },
    // Solid 2 resuelve a la build de servidor con la condición "node"; las
    // pruebas usan la build de navegador en desarrollo.
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
  },
  resolve: { conditions: ["browser", "development"] },
});
