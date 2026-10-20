/**
 * Las variables de entorno que lee la web (#83).
 *
 * Vite solo pone en `import.meta.env` las variables que empiezan por uno de los prefijos de
 * `envPrefix`, y `vite.config.ts` usa como prefijos los nombres de esta lista. Con el `VITE_` de
 * siempre, `import.meta.env` tendría todas las `VITE_*` del build, y en Vercel eso incluye las
 * `VITE_VERCEL_*` de cada despliegue, con el mensaje y el autor del commit, el repositorio y el
 * identificador del despliegue. El `ConfigProvider` por defecto de Effect lee `import.meta.env`
 * como objeto, así que Vite las escribiría todas en el JavaScript. `entrada.tsx` lee una a una las
 * de la lista, y con `strictImportMetaEnv` los tipos rechazan cualquier otra.
 * `soloLasVariablesDeLaWeb` (`variablesDelBuild.ts`) hace fallar el build si `dist` lleva otra.
 */
export const VARIABLES_DE_LA_WEB = [
  // La dirección del buzón de Convex (ADR 0020). Sin ella, el buzón está cerrado.
  "VITE_CELDA_CONVEX_URL",
  // El servidor de Nominatim (ADR 0013). Con `apagado`, el buscador queda apagado.
  "VITE_BUSCADOR_URL",
  // El origen de las capas en desarrollo (ADR 0018). El build de Vercel la quita.
  "VITE_CAPAS_ORIGEN",
] as const;

export type VariableDeLaWeb = (typeof VARIABLES_DE_LA_WEB)[number];

declare global {
  interface ViteTypeOptions {
    strictImportMetaEnv: unknown;
  }

  interface ImportMetaEnv extends Readonly<Partial<Record<VariableDeLaWeb, string>>> {}
}
