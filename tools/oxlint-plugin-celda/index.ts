import { definePlugin } from "@oxlint/plugins";

import namespaceNodeImports from "./reglas/namespace-node-imports.ts";
import noEffectErrorSwallow from "./reglas/no-effect-error-swallow.ts";
import noInlineSchemaCompile from "./reglas/no-inline-schema-compile.ts";
import noManualEffectRuntimeInTests from "./reglas/no-manual-effect-runtime-in-tests.ts";
import sinEstilosAMedida from "./reglas/sin-estilos-a-medida.ts";

export default definePlugin({
  meta: {
    name: "celda",
  },
  rules: {
    "namespace-node-imports": namespaceNodeImports,
    "no-effect-error-swallow": noEffectErrorSwallow,
    "no-inline-schema-compile": noInlineSchemaCompile,
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests,
    "sin-estilos-a-medida": sinEstilosAMedida,
  },
});
