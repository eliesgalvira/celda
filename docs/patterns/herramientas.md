# Herramientas

Cómo está montada la cadena de herramientas y qué hubo que ajustar para que funcionara con las RC. Las versiones exactas están en el catálogo de `pnpm-workspace.yaml`.

## Lo que funciona tal cual

- **vite-plus** (`vp`) hace el build, el lint con oxlint, el formato con oxfmt y las pruebas con Vitest 5. `vite` es un alias de `@voidzero-dev/vite-plus-core`.
- **TypeScript 7** (`typescript@7.0.2`, el compilador nativo) con el parche de `@effect/tsgo`. El script `prepare` lo aplica en cada `pnpm install`. `tsc --noEmit` da los errores de tipos y los diagnósticos de Effect del `tsconfig.base.json` como errores. En un worktree nuevo el parche no estaba aplicado tras `pnpm install`, y `typecheck` pasaba en local sin los diagnósticos de Effect que la CI sí da. Si dudas, ejecuta `pnpm run prepare` antes de `typecheck`.
- **Solid 2** RC con `@solidjs/vite-plugin` en modo SPA. Las pruebas de componentes usan `@solidjs/testing-library` sobre happy-dom.
- **Nix** con flake-parts e import-tree: cada `nix/*.mod.nix` se carga solo.

## Ajustes

- **`@types/node` fijado con `overrides`.** Sin él, pnpm instalaba dos copias de vite-plus y de Vitest (una por versión de `@types/node`) y `@effect/vitest` fallaba con `Cannot read properties of undefined (reading 'config')`.
- **`peerDependencyRules` para `vite`.** Los plugins piden `vite@^8` y encuentran el alias de vite-plus. Funciona; la regla solo silencia el aviso.
- **Diagnóstico `importFromBarrel` quitado.** `@effect/tsgo` 0.46 ya no lo tiene y avisa de regla desconocida.
- **El worker de MapLibre 6.** MapLibre busca `maplibre-gl-worker.mjs` junto a su propio fichero, y el empaquetador lo mueve. `apps/web/src/mapa/mapaBase.ts` lo importa con `?worker&url` y llama a `setWorkerUrl`.
- **`modulePreload.resolveDependencies` en `apps/web/vite.config.ts`.** Un `import()` pide su trozo cuando acaba la tarea que lo llama, y evaluar la web es una tarea larga. Con el propio trozo en la lista, el cargador de Vite lo pide en el acto con un `<link rel="modulepreload">`. Así MapLibre empieza a bajar desde `src/mapa/precarga.ts` mientras se evalúa el resto (ver [rendimiento.md](rendimiento.md)).
- **Solid de desarrollo solo en las pruebas.** `apps/web/vite.config.ts` pide la condición `development` solo con `mode === "test"`. Antes la pedía siempre y la build publicada llevaba el Solid de desarrollo, con sus avisos en la consola y comprobaciones en cada lectura.
- **`tema.css?raw` en Vitest.** Vitest devuelve vacías las hojas de estilo; `packages/ui/vite.config.ts` incluye `tema.css` en `test.css` para que las pruebas lean los tokens.
- **`maplibre-gl.css` en una capa.** Se importa con `layer(base)` para que las utilidades de Tailwind ganen a sus reglas.
- **oxfmt no toca la prosa.** Markdown y HTML quedan fuera del formateador.

## Medida

`tools/rendimiento` mide la carga y la fluidez con Chromium sin interfaz y `playwright-core`, que no descarga navegadores: usa el Chromium del sistema (`--chromium` o `CELDA_CHROMIUM`). Cómo se usa y qué salió: [rendimiento.md](rendimiento.md). No tiene pruebas ni corre en la CI, porque necesita GPU y conexión con OpenFreeMap. Sus ficheros llevan `@effect-diagnostics` apagados para `node:*` y `setTimeout`: el script no usa Effect.

## Lint

`vite.config.ts` de la raíz configura oxlint: categorías de corrección, sospechosos y rendimiento como errores, `jsx-a11y`, y tres plugins locales de `tools/oxlint-plugin-celda`:

- `celda`: la regla de estilos (ver [ui.md](ui.md)) y cuatro reglas genéricas de Effect copiadas de un proyecto anterior del autor.
- `anti-slop` y `anti-slop-effect`: copia de `dmmulroy/anti-slop` (MIT), con su licencia en la carpeta.

El modo con tipos de oxlint está apagado: los diagnósticos de Effect los da `typecheck`.

## Mudanza

Al mover Celda a su propio repositorio se mueve también `.github/workflows/celda.yml`, que hoy vive en la raíz del archivo. Allí sobran el filtro de rutas y el `working-directory`.
