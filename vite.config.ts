import { defineConfig } from "vite-plus";

const IGNORADOS = [
  "dist",
  "**/dist/**",
  "node_modules",
  "pnpm-lock.yaml",
  "*.tsbuildinfo",
  // Bundles de `confect codegen` junto a cada fuente de convex/confect/. Los borra al acabar, pero
  // uno matado de golpe los deja, y llevan código de todo el monorepo (convex/scripts/codegen.sh).
  "**/*.bundled_*",
];

export default defineConfig({
  fmt: {
    // La prosa (Markdown y el documento de UX) se escribe a mano, sin formateador.
    ignorePatterns: [
      ...IGNORADOS,
      "tools/oxlint-plugin-celda/anti-slop/**",
      "flake.lock",
      "**/*.md",
      "*.html",
      // Respuestas grabadas byte a byte y resultados de referencia de las pruebas.
      "docs/investigacion/muestras/**",
      "**/referencia/**",
      // Límites de barrio que escribe `pnpm run barrios`, con un barrio por línea.
      "tools/capas/datos/**",
      // Límites de municipios y padrón que escribe `pnpm run municipios`, con un elemento por línea.
      "packages/publicacion/datos/municipios.json",
      "packages/publicacion/datos/padron.json",
      // Cuadros del registro que escribe `pnpm run cuadros`, en apps/nocturna, con uno por línea.
      "packages/dominio/datos/cuadros-del-registro.json",
      // Índice y contornos del ejercicio que escribe `pnpm run zonas`, con un elemento por línea.
      "apps/web/src/ejercicio/zonas/**",
      // Contorno de España que escribe `pnpm run espana`, con un polígono por línea.
      "packages/ui/src/mapa/espana.json",
      // Tabla de nombres de lugar y contorno de la Comunitat Valenciana que escribe
      // `pnpm run nombres`, con una fila o un polígono por línea.
      "packages/dominio/datos/nombres-de-lugar.json",
      "packages/dominio/datos/comunitat-valenciana.json",
      // Límites de comunidades y provincias que escribe `pnpm run limites`, con una línea por renglón.
      "apps/web/src/mapa/limites.json",
      "apps/web/src/mapa/limites-detalle.json",
      // Centros de provincia y habitantes de las ciudades que escribe `pnpm run centros`, con una
      // fila por línea.
      "packages/dominio/datos/centros-de-provincia.json",
      "packages/dominio/datos/habitantes-de-ciudades.json",
      // Código que generan Confect y Convex.
      "convex/convex/**",
      "convex/confect/_generated/**",
    ],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: [
      ...IGNORADOS,
      "tools/oxlint-plugin-celda/anti-slop/**",
      "convex/convex/**",
      "convex/confect/_generated/**",
      // Respuestas grabadas y guiones de un solo uso de las investigaciones: no son código de Celda.
      "docs/investigacion/muestras/**",
    ],
    plugins: ["eslint", "oxc", "unicorn", "typescript", "jsx-a11y"],
    jsPlugins: [
      "./tools/oxlint-plugin-celda/index.ts",
      "./tools/oxlint-plugin-celda/anti-slop/index.ts",
      "./tools/oxlint-plugin-celda/anti-slop/effect/index.ts",
    ],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    rules: {
      "eslint/complexity": ["error", { max: 20, variant: "modified" }],
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-array-sort": "off",
      "oxc/no-map-spread": "off",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
      "anti-slop-effect/no-service-constructor-imports": "error",
      "celda/abrir-con-recurso": "error",
      "celda/namespace-node-imports": "error",
      "celda/no-effect-error-swallow": "error",
      "celda/no-inline-schema-compile": "warn",
      "celda/no-manual-effect-runtime-in-tests": "error",
      "celda/sin-estilos-a-medida": "error",
    },
    overrides: [
      {
        // Las pruebas de las reglas escriben a propósito el código que prohíben.
        files: ["tools/oxlint-plugin-celda/**"],
        rules: { "celda/sin-estilos-a-medida": "off" },
      },
    ],
    options: {
      // Se revisará cuando el camino type-aware de oxlint (tsgolint) integre los
      // diagnósticos de @effect/tsgo; hoy los da `pnpm run typecheck`.
      typeAware: false,
      typeCheck: false,
    },
  },
});
