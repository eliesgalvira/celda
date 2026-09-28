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
  build: {
    // MapLibre (casi 1 MB) va en su propio trozo, que se pide al empezar a evaluar la web
    // (`src/mapa/precarga.ts`) y se descarga mientras se monta la pantalla.
    chunkSizeWarningLimit: 1100,
    modulePreload: {
      // Un `import()` pide su trozo al acabar la tarea que lo llama, y evaluar la web es una tarea
      // larga. Con el propio trozo en la lista, el cargador de Vite lo pide en el acto con un
      // `<link rel="modulepreload">`.
      resolveDependencies: (trozo, dependencias, { hostType }) =>
        hostType === "js" ? [trozo, ...dependencias] : dependencias,
    },
  },
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
