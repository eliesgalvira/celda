import "vite-plus/test/config";
import { iconosDeCelda } from "@celda/ui/marca/iconos.ts";
import { temaAntesDePintar } from "@celda/ui/temaElegido.ts";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

import { VARIABLES_DE_LA_WEB } from "./src/variables.ts";
import { soloLasVariablesDeLaWeb } from "./src/variablesDelBuild.ts";

export default defineConfig(({ mode }) => ({
  // El favicon, los iconos y el manifiesto salen de la marca y los tokens de @celda/ui. El guion
  // del tema elegido va detrás, porque ajusta las etiquetas `theme-color` que pone `iconosDeCelda`.
  // El build falla si lleva una variable de entorno que la web no lee (#83).
  plugins: [
    tailwindcss(),
    solid(),
    iconosDeCelda(),
    temaAntesDePintar(),
    soloLasVariablesDeLaWeb(),
  ],
  // `import.meta.env` solo tiene las variables de la lista, aunque el entorno tenga más (#83).
  // El `ConfigProvider` por defecto de Effect lee `import.meta.env` como objeto, así que con
  // `VITE_` Vite escribiría en el JavaScript todas las `VITE_*` del build, también las
  // `VITE_VERCEL_*`. Cada nombre de la lista vale como prefijo de sí mismo.
  envPrefix: [...VARIABLES_DE_LA_WEB],
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
    // Una prueba falla si algún recurso se abre en bucle (ver `@celda/ui/recurso.ts`).
    setupFiles: ["@celda/ui/pruebas/vigilante.ts"],
    // Solid 2 resuelve a la build de servidor con la condición "node"; las
    // pruebas usan la build de navegador en desarrollo.
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
  },
  // Solo en las pruebas: con la condición "development" la build llevaría el Solid de desarrollo,
  // con sus comprobaciones en cada lectura.
  resolve: mode === "test" ? { conditions: ["browser", "development"] } : {},
}));
