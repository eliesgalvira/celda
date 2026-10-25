# Herramientas

Cómo está montada la cadena de herramientas y qué hubo que ajustar para que funcionara con las RC. Las versiones exactas están en el catálogo de `pnpm-workspace.yaml`.

## Lo que funciona tal cual

- **vite-plus** (`vp`) hace el build, el lint con oxlint, el formato con oxfmt y las pruebas con Vitest 5. `vite` es un alias de `@voidzero-dev/vite-plus-core`.
- **TypeScript 7** (`typescript@7.0.2`, el compilador nativo) con el parche de `@effect/tsgo`. El script `prepare` lo aplica en cada `pnpm install`. `tsc --noEmit` da los errores de tipos y los diagnósticos de Effect del `tsconfig.base.json` como errores. En un worktree nuevo el parche no estaba aplicado tras `pnpm install`, y `typecheck` pasaba en local sin los diagnósticos de Effect que la CI sí da. Si dudas, ejecuta `pnpm run prepare` antes de `typecheck`.
- **Solid 2** RC con `@solidjs/vite-plugin` en modo SPA. Las pruebas de componentes usan `@solidjs/testing-library` sobre happy-dom.
- **Nix** con flake-parts e import-tree: cada `nix/*.mod.nix` se carga solo. El flake también exporta la ingesta nocturna como paquete y módulo de NixOS, con sus comprobaciones en `nix flake check`. Cómo se usa desde otro flake y cómo se actualiza el hash de sus dependencias de pnpm cuando cambia el lockfile: [nixos.md](nixos.md).
- **SQLite** en la ingesta nocturna con `@effect/sql-sqlite-node`, que en Effect 4 va sobre `node:sqlite` de Node 24, sin compilar nada. El módulo es síncrono: dos conexiones del mismo proceso que se esperan bloquean el bucle de eventos (ver [convex.md](convex.md)).

## Ajustes

- **`@types/node` fijado con `overrides`.** Sin él, pnpm instalaba dos copias de vite-plus y de Vitest (una por versión de `@types/node`) y `@effect/vitest` fallaba con `Cannot read properties of undefined (reading 'config')`.
- **`peerDependencyRules` para `vite`.** Los plugins piden `vite@^8` y encuentran el alias de vite-plus. Funciona; la regla solo silencia el aviso.
- **Diagnóstico `importFromBarrel` quitado.** `@effect/tsgo` 0.46 ya no lo tiene y avisa de regla desconocida.
- **El worker de MapLibre 6.** MapLibre busca `maplibre-gl-worker.mjs` junto a su propio fichero, y el empaquetador lo mueve. `apps/web/src/mapa/mapaBase.ts` lo importa con `?worker&url` y llama a `setWorkerUrl`.
- **`modulePreload.resolveDependencies` en `apps/web/vite.config.ts`.** Un `import()` pide su trozo cuando acaba la tarea que lo llama, y evaluar la web es una tarea larga. Con el propio trozo en la lista, el cargador de Vite lo pide en el acto con un `<link rel="modulepreload">`. Así MapLibre empieza a bajar desde `src/mapa/precarga.ts` mientras se evalúa el resto (ver [rendimiento.md](rendimiento.md)).
- **Solid de desarrollo solo en las pruebas.** `apps/web/vite.config.ts` pide la condición `development` solo con `mode === "test"`. Antes la pedía siempre y la build publicada llevaba el Solid de desarrollo, con sus avisos en la consola y comprobaciones en cada lectura.
- **`envPrefix` con las variables que lee la web.** El `ConfigProvider` por defecto de Effect lee `import.meta.env` como objeto, y Vite escribe ese objeto entero en el JavaScript. Con el prefijo `VITE_` de siempre, la web llevaba todas las `VITE_*` del build, también las `VITE_VERCEL_*` de cada despliegue (#83). `apps/web/vite.config.ts` pone como prefijos los nombres de `VARIABLES_DE_LA_WEB` (`apps/web/src/variables.ts`), y `entrada.tsx` lee cada una con su `import.meta.env.VITE_…` escrito entero. El plugin `soloLasVariablesDeLaWeb` hace fallar el build si `dist` lleva otra `VITE_*`, una `CELDA_R2_*` o el valor de alguna. Una variable nueva para la web se añade a esa lista.
- **`recurso()` para abrir cualquier cosa desde Solid.** En Solid 2 (RC 9) los efectos no comparan valores: la segunda función de `createEffect` corre otra vez cada vez que cambia algo que lee la primera, aunque devuelva lo mismo. Así el GPS se abrió 3135 veces en 7 s. `recurso()` pasa la clave por un memo que compara. Ver [efectos.md](efectos.md).
- **Las pruebas desmontan lo que montan.** `@solidjs/testing-library` solo lo hace sola con los globales de Vitest, que están apagados. Lo hace `packages/ui/src/pruebas/vigilante.ts`, que se carga en todas las pruebas de `apps/web` y `packages/ui`.
- **`tema.css?raw` en Vitest.** Vitest devuelve vacías las hojas de estilo; `packages/ui/vite.config.ts` incluye `tema.css` en `test.css` para que las pruebas lean los tokens.
- **`maplibre-gl.css` en una capa.** Se importa con `layer(base)` para que las utilidades de Tailwind ganen a sus reglas.
- **oxfmt no toca la prosa.** Markdown y HTML quedan fuera del formateador.
- **`convex/scripts/codegen.sh` en vez de `confect codegen`.** Un codegen matado de golpe dejaba `confect/*.bundled_*.mjs`, y el lint fallaba en ellos. El script los borra; el lint, el formateador y `.gitignore` los ignoran. Detalles en [convex.md](convex.md).

## Medida

`tools/rendimiento` también tiene la prueba de resistencia (`pnpm run resistencia`) y la de los puntos del paso a los logos (`pnpm run deriva`), que sí corren en la CI, en su propio trabajo y con el Chromium de `nix develop .#resistencia`. No necesitan conexión, porque contestan en local el mapa base que pide la página, y fallan con la URL si la página pide otra cosa fuera del sitio (`tools/rendimiento/src/red.ts`). Ver [efectos.md](efectos.md) y [rendimiento.md](rendimiento.md).

`tools/rendimiento` mide la carga y la fluidez con Chromium sin interfaz y `playwright-core`, que no descarga navegadores: usa el Chromium del sistema (`--chromium` o `CELDA_CHROMIUM`). Cómo se usa y qué salió: [rendimiento.md](rendimiento.md). No tiene pruebas ni corre en la CI, porque necesita GPU y conexión con OpenFreeMap. Sus ficheros llevan `@effect-diagnostics` apagados para `node:*` y `setTimeout`: el script no usa Effect.

## Lint

`vite.config.ts` de la raíz configura oxlint: categorías de corrección, sospechosos y rendimiento como errores, `jsx-a11y`, y tres plugins locales de `tools/oxlint-plugin-celda`:

- `celda`: la regla de estilos (ver [ui.md](ui.md)), `abrir-con-recurso` (ver [efectos.md](efectos.md)) y cuatro reglas genéricas copiadas de otro proyecto, tres de Effect y una de Node.
- `anti-slop` y `anti-slop-effect`: copia de `dmmulroy/anti-slop` (MIT), con su licencia en la carpeta.

El modo con tipos de oxlint está apagado: los diagnósticos de Effect los da `typecheck`.
