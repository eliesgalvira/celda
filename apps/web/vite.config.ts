import "vite-plus/test/config";
import { iconosDeCelda } from "@celda/ui/marca/iconos.ts";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig(({ mode }) => ({
  // El favicon, los iconos y el manifiesto salen de la marca y los tokens de @celda/ui.
  plugins: [tailwindcss(), solid(), iconosDeCelda()],
  server: { port: 8840, strictPort: true },
  preview: { port: 8841, strictPort: true },
  // MapLibre (casi 1 MB) va en su propio trozo, que se descarga después de pintar la pantalla.
  build: { chunkSizeWarningLimit: 1100 },
  worker: { format: "es" },
  test: {
    environment: "happy-dom",
    sequence: { shuffle: true },
    // Solid 2 resuelve a la build de servidor con la condición "node"; las
    // pruebas usan la build de navegador en desarrollo.
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
  },
  // Solo en las pruebas: con la condición "development" la build llevaría el Solid de desarrollo,
  // con sus comprobaciones en cada lectura.
  resolve: mode === "test" ? { conditions: ["browser", "development"] } : {},
}));
